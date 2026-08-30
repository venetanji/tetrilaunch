/**
 * RENDER-COST HARNESS (browser half) — what does one drawn frame cost?
 *
 * sim/perf.ts times Game.update(): the PHYSICS half of a frame, in node, with
 * no canvas at all. That left the other half unmeasured, and the other half is
 * the one that grew a sprite cache, a background layer and a glow budget — all
 * of which are claims about rasterisation cost that node cannot check. This is
 * the missing half: a real Chromium 2D context, the real render() entry point,
 * the real scene shape, timed frame by frame.
 *
 * Scene construction deliberately mirrors sim/perf.ts's placeLoose/placeCliques
 * (same body opts, same K4 clique topology, same seeded jitter) so a count of
 * N here and a count of N there mean the same pile, and the two harnesses'
 * numbers can be added into a frame budget.
 *
 * Nothing here runs in the app. run.ts serves this directory through its own
 * Vite root; the app's build entry is index.html and index.html alone.
 */
import Matter from "matter-js";
import { Game } from "../../src/game/game";
import { makeBaseLevel } from "../../src/game/level";
import { CELL, WORLD } from "../../src/game/engine";
import { MATERIAL_SPEC, PIECE_COLORS, shipmentColor, type Material, type PieceType } from "../../src/game/theme";
import { mulberry32 } from "../../src/game/mods";
import { JOINT_DAMPING, type Cube } from "../../src/game/pieces";
import { render } from "../../src/game/render";
import { BLAST_AMBER, FX_TTL, type FxEvent } from "../../src/game/fx";
import { VOLATILE_BLAST_CELLS } from "../../src/game/lineClear";
import { setBlitSkipper, startCensus, stopCensus, type DrawCensus } from "./probe";

export interface RenderPerfOptions {
  /** Cubes on the field. */
  count: number;
  /** "loose" = unjointed cubes; "cliques" = 4-cube K4 groups, as pieces.ts welds
   *  them; "mixed" = cliques whose cargo VARIES, as a played bay's does. */
  variant: Variant;
  /** Timed frames (a 60-frame warmup runs first and is not timed). */
  frames: number;
  /** CSS viewport the frame is drawn at. */
  cssW: number;
  cssH: number;
  /** Device pixel ratio the backing store is sized at. */
  dpr: number;
  /** Draw the aim arc + a live effects burst — the busiest a frame gets. */
  busy: boolean;
  /**
   * Swap the ordinary FX set for a sustained CHAIN DETONATION (boomEffects):
   * five coloured blasts, permanently live at staggered ages, which is the
   * frame render.ts's DEBRIS_FRAME_CAP was written for. Implies `busy`.
   *
   * Its own flag rather than a bigger busyEffects, because the busy set is the
   * baseline every historical number in sim/results was measured against and
   * quietly making it more expensive would invalidate all of them.
   */
  boom?: boolean;
  /**
   * Which scene layers this frame carries. Omitted = all of them, which is the
   * ordinary sweep. The breakdown mode fills it in one layer at a time and
   * reads the DELTAS as each layer's cost — attribution without instrumenting
   * render.ts, which matters because instrumentation would have to ship in the
   * module under test.
   */
  layers?: SceneLayers;
}

export type Variant = "loose" | "cliques" | "mixed";
export const VARIANTS: readonly Variant[] = ["loose", "cliques", "mixed"];

export interface SceneLayers {
  cubes: boolean;
  seams: boolean;
  trajectory: boolean;
  effects: boolean;
}

const ALL_LAYERS: SceneLayers = { cubes: true, seams: true, trajectory: true, effects: true };

export interface RenderPerfResult {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  overBudgetPct: number;
  frames: number;
}

const DT = 1000 / 60;
const FRAME_BUDGET_MS = 1000 / 60;

const RIGHT_HALF_X0 = WORLD.width / 2;
const COLS = Math.floor((WORLD.width - RIGHT_HALF_X0) / CELL);
const START_X = RIGHT_HALF_X0 + CELL / 2;
const START_Y = WORLD.height - CELL / 2;
const JITTER = 2;

function makeCubeBody(x: number, y: number): Matter.Body {
  return Matter.Bodies.rectangle(x, y, CELL, CELL, {
    friction: 0.5,
    frictionAir: 0.012,
    restitution: 0.05,
    density: 0.001,
    label: "cube",
    chamfer: { radius: 3 },
  });
}

function placeLoose(g: Game, n: number, rng: () => number): void {
  for (let i = 0; i < n; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = START_X + col * CELL + (rng() * 2 - 1) * JITTER;
    const y = START_Y - row * CELL + (rng() * 2 - 1) * JITTER;
    const body = makeCubeBody(x, y);
    Matter.Composite.add(g.phys.world, body);
    g.cubes.push({
      body, type: "I", color: PIECE_COLORS.I, blinkStart: null,
      material: "standard", struck: true,
    });
  }
}

/**
 * WHAT A CLIQUE IS MADE OF, and why "mixed" had to exist.
 *
 * `placeCliques` gives every cube in the field the same type, the same colour
 * and the same material, so render.ts's sprite cache answers all of them from
 * ONE baked face. That is a fine scene for timing fill and a misleading one for
 * counting rasteriser state: a played bay stacks shipments of seven types in
 * six materials, and each combination is a different baked canvas for the
 * rasteriser to bind. sim/renderperf --probe counts source switches, and against a monochrome
 * pile that count is a property of the harness rather than of the game.
 *
 * So "mixed" varies the cargo the way a bay does — per PIECE, not per cube,
 * because pieces.ts spawns a shipment's four cubes together and game.ts keeps
 * them adjacent in `cubes`. That run structure is the whole point: it is what
 * decides whether consecutive stamps share a texture.
 */
const MIXED_TYPES: PieceType[] = ["I", "O", "T", "L", "J", "S", "Z"];
const MIXED_MATERIALS: Material[] = ["standard", "cryo", "rebar", "volatile", "tar", "magnetic"];

function cliqueCargo(index: number, mixed: boolean): { type: PieceType; color: string; material: Material } {
  if (!mixed) return { type: "O", color: PIECE_COLORS.O, material: "standard" };
  // The material stride must be COPRIME WITH THE LIST LENGTH, or it walks a
  // subgroup instead of the whole list. Six materials with a stride of 3 visits
  // indices {0, 3} and nothing else — standard and volatile forever — which is
  // the bug this comment used to describe itself as avoiding. Five is coprime
  // with six, so every material appears, and 5 against the 7 types gives 42 of
  // the 42 possible pairings rather than 14.
  const type = MIXED_TYPES[index % MIXED_TYPES.length];
  const material = MIXED_MATERIALS[(index * 5) % MIXED_MATERIALS.length];
  return { type, color: shipmentColor(type, material), material };
}

function placeCliques(g: Game, n: number, rng: () => number, jointStiffness: number, mixed: boolean): void {
  const cliqueCols = Math.max(1, Math.floor(COLS / 2));
  const offsets: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
  let placed = 0;
  let cliqueIndex = 0;
  while (placed < n) {
    const col = cliqueIndex % cliqueCols;
    const row = Math.floor(cliqueIndex / cliqueCols);
    const baseX = START_X + col * CELL * 2;
    const baseY = START_Y - row * CELL * 2;
    const cargo = cliqueCargo(cliqueIndex, mixed);
    const clique: Cube[] = [];
    for (const [ox, oy] of offsets) {
      if (placed >= n) break;
      const x = baseX + ox * CELL + (rng() * 2 - 1) * JITTER;
      const y = baseY - oy * CELL + (rng() * 2 - 1) * JITTER;
      const body = makeCubeBody(x, y);
      Matter.Composite.add(g.phys.world, body);
      const cube: Cube = {
        body, type: cargo.type, color: cargo.color, blinkStart: null,
        // Struck, like every other cube these harnesses place: an unstruck cryo
        // cube draws its frost sprite, which is a different bake and a valid
        // scene, but "which face is on screen" is not what the variant is
        // varying and one unlucky material should not silently change the
        // measurement's meaning.
        material: cargo.material, struck: true,
      };
      g.cubes.push(cube);
      clique.push(cube);
      placed += 1;
    }
    for (let i = 0; i < clique.length; i++) {
      for (let j = i + 1; j < clique.length; j++) {
        const a = clique[i].body;
        const b = clique[j].body;
        const rest = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        const constraint = Matter.Constraint.create({
          bodyA: a, bodyB: b, length: rest,
          stiffness: jointStiffness, damping: JOINT_DAMPING,
          render: { visible: false },
        });
        Matter.Composite.add(g.phys.world, constraint);
        g.constraints.push(constraint);
      }
    }
    cliqueIndex += 1;
  }
}

/** The FX set a busy frame carries: one of every animated kind, so the timed
 *  frame pays drawEffects' worst realistic case rather than its empty one. */
function busyEffects(now: number): FxEvent[] {
  return [
    { kind: "shatter", x: 900, y: 500, color: PIECE_COLORS.I, t0: now - 200 },
    // Graded, not null: the callout is a second `fillText` with its own shadow
    // on the busiest toast in the set, and a frame budget measured without it
    // would be a budget for a payout the game no longer draws.
    { kind: "payout", x: 700, y: 400, amount: 120, grade: "excellent", congested: false, t0: now - 300 },
    { kind: "rowflash", y: 640, x0: 0, x1: WORLD.width, t0: now - 100 },
    { kind: "explosion", x: 800, y: 560, r: 120, t0: now - 150 },
    // The Thaw Lance's crystal, mid-sweep: a hexagon, six spokes, an additive
    // bloom and a plume of motes. In the busy set for the reason stated above —
    // one of every animated kind — and at 180ms because that is where all four
    // of its layers are alive at once, which is the frame it actually costs.
    { kind: "thaw", x: 620, y: 520, t0: now - 180 },
    { kind: "salvage", x: 820, y: 520, amount: 9, t0: now - 250 },
    { kind: "penalty", x: 300, y: 600, amount: 40, t0: now - 400 },
    { kind: "snap", x: 860, y: 480, color: PIECE_COLORS.O, t0: now - 120 },
    { kind: "chunk", x: 880, y: 460, color: PIECE_COLORS.T, t0: now - 300 },
  ];
}

/**
 * THE CHAIN: five coloured detonations, all live, all at different ages, every
 * frame. The stress case render.ts's debris layer was designed against — a
 * volatile-heavy belt where one pop razes its neighbours, they land hard, and
 * the field is spraying from four places at once with a charge going off in
 * the middle of it.
 *
 * SUSTAINED rather than one-shot: each blast's t0 is derived from the frame
 * clock modulo FX_TTL.explosion, so blast i is permanently `i * 170 + 30`ms
 * old. Every timed frame therefore pays a full chain — a one-shot burst would
 * be alive for 54 of 240 frames and the p50 would report a frame with no
 * debris in it at all.
 *
 * The radii and colours are copied from game.ts's own spawners: 89.6 for a
 * volatile pop (VOLATILE_BLAST_CELLS * CELL * 1.4), CELL * 2.4 for a charge.
 */
const CHAIN_STAGGER_MS = 170;
function boomEffects(now: number): FxEvent[] {
  const volatileHue = MATERIAL_SPEC.volatile.color ?? BLAST_AMBER;
  const at: [number, number, number, string][] = [
    [760, 600, VOLATILE_BLAST_CELLS * CELL * 1.4, volatileHue],
    [880, 540, VOLATILE_BLAST_CELLS * CELL * 1.4, volatileHue],
    [660, 500, VOLATILE_BLAST_CELLS * CELL * 1.4, volatileHue],
    [940, 650, VOLATILE_BLAST_CELLS * CELL * 1.4, volatileHue],
    [800, 430, CELL * 2.4, BLAST_AMBER],
  ];
  return at.map(([x, y, r, color], i) => ({
    kind: "explosion" as const, x, y, r, color,
    t0: now - ((i * CHAIN_STAGGER_MS + 30) % FX_TTL.explosion),
  }));
}

function buildGame(variant: Variant, n: number): Game {
  const cfg = { ...makeBaseLevel(0), timeLimitSec: 0 };
  const g = new Game(cfg);
  const rng = mulberry32(1000 + n);
  if (variant === "loose") placeLoose(g, n, rng);
  else placeCliques(g, n, rng, cfg.jointStiffness, variant === "mixed");
  return g;
}

/** Same guard sim/perf.ts uses: a stress pile can legitimately trip a loss
 *  condition, and Game.update() no-ops once status !== "playing". Forced back
 *  OUTSIDE the timed window so it never lands in a measurement. */
function forcePlaying(g: Game): void {
  if (g.status !== "playing") {
    g.status = "playing";
    g.lossReason = null;
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Everything both the timed sweep and the draw-call census need: a sized
 * canvas, a settled pile, and a closure that paints one frame of it.
 *
 * Shared rather than copied because the census is only worth anything if it is
 * counting the SAME frame the sweep times — two scene builders that drifted
 * apart would have the counts describing one scene and the milliseconds
 * another, which is the failure mode that makes an attribution table lie.
 */
function prepare(opts: RenderPerfOptions): {
  canvas: HTMLCanvasElement;
  g: Game;
  draw: (t: number) => void;
  now: number;
} {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  canvas.style.width = `${opts.cssW}px`;
  canvas.style.height = `${opts.cssH}px`;
  canvas.width = Math.round(opts.cssW * opts.dpr);
  canvas.height = Math.round(opts.cssH * opts.dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const g = buildGame(opts.variant, opts.count);
  let now = performance.now();

  // Settle the pile first, un-timed: render cost depends on what the cubes are
  // DOING (a moving cube is awake, a blinking one draws its blink), so timing a
  // still-falling grid would measure a scene the game never shows for long.
  for (let i = 0; i < 60; i++) {
    now += DT;
    g.update(now);
    forcePlaying(g);
  }
  if (opts.busy || opts.boom) {
    g.aiming = true;
    g.updateTrajectory();
  }

  const layers = opts.layers ?? ALL_LAYERS;
  const noCubes: Cube[] = [];
  const noConstraints: Matter.Constraint[] = [];
  const noTrajectory: Matter.Vector[] = [];
  const noEffects: FxEvent[] = [];

  const draw = (t: number): void => {
    render(ctx, opts.cssW, opts.cssH, opts.dpr, {
      cubes: layers.cubes ? g.cubes : noCubes,
      constraints: layers.seams ? g.constraints : noConstraints,
      compactor: g.compactor, cannon: g.cannon,
      trajectory: (opts.busy || opts.boom) && layers.trajectory ? g.trajectory : noTrajectory,
      now: t, aiming: opts.busy || !!opts.boom,
      effects: layers.effects
        ? (opts.boom ? boomEffects(t) : (opts.busy ? busyEffects(t) : g.effects))
        : noEffects,
      level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
      windNow: g.windNow, windAverage: g.windAverage,
      reload: g.cannon.reloadRatio(t), settling: g.settling,
      strandWarning: g.trajectoryStrands,
    });
  };

  // Warmup: bakes the sprite + background caches and lets the JIT settle, so
  // the timed window measures a steady frame rather than a first one.
  for (let i = 0; i < 60; i++) {
    now += DT;
    draw(now);
  }
  return { canvas, g, draw, now };
}

export function runRenderPerf(opts: RenderPerfOptions): RenderPerfResult {
  const { canvas, g, draw, now: t0now } = prepare(opts);
  const ctx = canvas.getContext("2d")!;
  let now = t0now;

  const durations = new Array<number>(opts.frames);
  for (let i = 0; i < opts.frames; i++) {
    now += DT;
    const t0 = performance.now();
    draw(now);
    // getImageData forces the pending display list to actually rasterise.
    // Without it Chromium is free to defer the whole frame past our t1 and the
    // harness would report the cost of QUEUEING draw calls, not of running
    // them — which is exactly the mistake that makes canvas microbenchmarks
    // report implausible sub-0.1ms frames. One pixel is enough to flush.
    ctx.getImageData(0, 0, 1, 1);
    durations[i] = performance.now() - t0;
  }
  g.destroy();

  const sorted = [...durations].sort((a, b) => a - b);
  return {
    avgMs: sorted.reduce((s, d) => s + d, 0) / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    worstMs: sorted[sorted.length - 1],
    overBudgetPct: (durations.filter((d) => d > FRAME_BUDGET_MS).length / durations.length) * 100,
    frames: opts.frames,
  };
}

/**
 * COUNT one frame's draw commands instead of timing them.
 *
 * The counts are what survive the trip to a different machine. Headless
 * Chromium's milliseconds rank draw paths and compare a before against an
 * after; its `drawImage` count is the phone's `drawImage` count exactly, and so
 * is the number of texture switches inside it. When the spec's three open
 * questions are asked here, the answers are device answers.
 *
 * The frames counted are ordinary frames — same `prepare`, same warmup, so the
 * sprite and background caches are hot before the first counted frame. That is
 * load-bearing for question (3): a census that included the warmup would report
 * the bakes it CAUSED and say nothing about whether a steady frame re-bakes.
 */
export function probeScene(opts: RenderPerfOptions): DrawCensus & { cubesDrawn: number } {
  const { g, draw, now: t0now } = prepare(opts);
  let now = t0now;
  startCensus();
  for (let i = 0; i < opts.frames; i++) {
    now += DT;
    draw(now);
  }
  const census = stopCensus(opts.frames);
  // The pile that was actually on the field, not the N asked for: `prepare`
  // settles for 60 steps and the press clears lines during them, so a run
  // labelled N=300 draws whatever survived. Reporting the request instead of
  // the reality is how a census ends up with more draws at N=27 than at N=71.
  const cubesDrawn = g.cubes.length;
  g.destroy();
  return { ...census, cubesDrawn };
}

/**
 * WHAT THE BACKGROUND BLIT COSTS, asked the way the device was asked it.
 *
 * The background-split spec priced its own proposal on the CPH2573 by wrapping
 * drawImage, identifying the full-canvas blit exactly, and skipping it on
 * demand — wrong pixels, right cost. It measured −0.295ms, which is what zero
 * looks like through noise, and the split has stayed unbuilt on that reading.
 * Two confounds were later found in it, so the result is an indication rather
 * than a proof, and the spec now names the two-stacked-canvas page as the
 * decisive probe.
 *
 * This is the same probe on this machine, and it is here for one reason: a
 * render-perf effort that points at the sprite pass ought to be able to say how
 * big the thing it is NOT pointing at is. If the sprite pass cannot account for
 * the frame, that is worth knowing early and out loud.
 *
 * INTERLEAVED PER FRAME, which is stricter than the device probe could be. The
 * spec's own trap note says long A/B/A blocks are useless here — three
 * four-second blocks during live play returned a background "prize" of
 * −11.7fps purely because the scene was busier during the baseline. This scene
 * is frozen and driven from a fixed clock, so alternating every single frame
 * costs nothing and leaves the two conditions no room at all to drift apart.
 */
export interface BlitAbResult {
  drawnP50Ms: number;
  skippedP50Ms: number;
  drawnAvgMs: number;
  skippedAvgMs: number;
  frames: number;
}

export function blitAb(opts: RenderPerfOptions): BlitAbResult {
  const { canvas, g, draw, now: t0now } = prepare(opts);
  const ctx = canvas.getContext("2d")!;
  let now = t0now;
  let skip = false;
  setBlitSkipper(() => skip);
  const drawn: number[] = [];
  const skipped: number[] = [];
  for (let i = 0; i < opts.frames; i++) {
    now += DT;
    skip = i % 2 === 1;
    const t0 = performance.now();
    draw(now);
    ctx.getImageData(0, 0, 1, 1);
    (skip ? skipped : drawn).push(performance.now() - t0);
  }
  setBlitSkipper(null);
  g.destroy();
  const p50 = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const avg = (a: number[]): number => a.reduce((s, d) => s + d, 0) / a.length;
  return {
    drawnP50Ms: p50(drawn), skippedP50Ms: p50(skipped),
    drawnAvgMs: avg(drawn), skippedAvgMs: avg(skipped),
    frames: opts.frames,
  };
}

/**
 * PIXEL SNAPSHOT — the guard rail on everything above.
 *
 * A render optimisation that draws FEWER pixels is indistinguishable, from a
 * timer's point of view, from one that draws the WRONG pixels — and the wrong
 * ones are always faster. (Measured, not hypothetical: an early attempt at
 * hand-rolling drawCube's transform got the inverse wrong, launched every cube
 * off-screen, and reported a 74% speedup.) So the harness renders a fixed
 * scene and hashes the result: a change that is meant to be invisible must
 * leave this digest untouched, and one that is not must move it on purpose.
 *
 * FNV-1a over the raw RGBA bytes. The digest travels as a string because it is
 * crossing the Playwright bridge, and a full-canvas readback is far too much
 * to ship over it.
 */
export interface SnapshotResult {
  digest: string;
  /** The frame itself, as a PNG data URL, when the caller asked for it. Written
   *  to disk by run.ts so two branches' frames can be diffed pixel by pixel —
   *  a digest says "something changed", an image says WHAT. */
  png?: string;
  /**
   * Device pixels that differ between this scene and the SAME scene with an
   * empty cube list — i.e. how much of the frame the cargo actually paints.
   * The digest says "something moved"; this says whether what moved was the
   * pile disappearing, which is the specific way a drawCube optimisation
   * fails. A digest change with cargoPx near zero is a vanished pile.
   */
  cargoPx: number;
  width: number;
  height: number;
}

export function snapshotScene(opts: RenderPerfOptions & { png?: boolean }): SnapshotResult {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  canvas.style.width = `${opts.cssW}px`;
  canvas.style.height = `${opts.cssH}px`;
  canvas.width = Math.round(opts.cssW * opts.dpr);
  canvas.height = Math.round(opts.cssH * opts.dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const g = buildGame(opts.variant, opts.count);
  // A FIXED clock, not performance.now(): several draw paths animate on `now`
  // (the chute's mouth, the strand ring, every FX event's progress), so a
  // wall-clock digest would differ run to run for reasons that have nothing to
  // do with the change under test.
  const t0 = 100_000;
  let now = t0;
  for (let i = 0; i < 60; i++) {
    now += DT;
    g.update(now);
    forcePlaying(g);
  }
  g.aiming = true;
  g.updateTrajectory();

  const t = t0 + 1000;
  const paint = (cubes: Cube[], constraints: Matter.Constraint[]): Uint8ClampedArray => {
    render(ctx, opts.cssW, opts.cssH, opts.dpr, {
      cubes, constraints, compactor: g.compactor, cannon: g.cannon,
      trajectory: g.trajectory, now: t, aiming: true,
      effects: busyEffects(t),
      level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
      windNow: g.windNow, windAverage: g.windAverage,
      reload: g.cannon.reloadRatio(t), settling: g.settling,
      strandWarning: g.trajectoryStrands,
    });
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };

  // Cargo-free first, kept for the diff; then the real frame, whose bytes are
  // the ones hashed. drawCongestionRows reads scene.cubes.length, so the
  // cargo-free pass also drops the floor light — which is correct for this
  // measurement: both are things the cargo puts on screen.
  const bare = Uint8ClampedArray.from(paint([], []));
  const data = paint(g.cubes, g.constraints);

  let hash = 0x811c9dc5;
  let cargoPx = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], gg = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (r !== bare[i] || gg !== bare[i + 1] || b !== bare[i + 2] || a !== bare[i + 3]) cargoPx++;
    hash = Math.imul(hash ^ r, 0x01000193);
    hash = Math.imul(hash ^ gg, 0x01000193);
    hash = Math.imul(hash ^ b, 0x01000193);
    hash = Math.imul(hash ^ a, 0x01000193);
  }
  g.destroy();
  return {
    digest: (hash >>> 0).toString(16).padStart(8, "0"),
    cargoPx,
    width: canvas.width,
    height: canvas.height,
    png: opts.png ? canvas.toDataURL("image/png") : undefined,
  };
}

declare global {
  interface Window {
    __renderperf: {
      run: (opts: RenderPerfOptions) => RenderPerfResult;
      snapshot: (opts: RenderPerfOptions & { png?: boolean }) => SnapshotResult;
      probe: (opts: RenderPerfOptions) => DrawCensus & { cubesDrawn: number };
      blitAb: (opts: RenderPerfOptions) => BlitAbResult;
    };
  }
}

window.__renderperf = { run: runRenderPerf, snapshot: snapshotScene, probe: probeScene, blitAb };
