import Matter from "matter-js";
import { CELL, WORLD } from "./engine";
import { BASE_BREAK_STRETCH } from "./level";
import { computeLayout } from "./layout";
import {
  COLORS, shade, shipmentAura, shipmentColor,
  type PieceSize, type PieceType,
} from "./theme";
import { pieceOffsets, type Cube } from "./pieces";
import type { Compactor } from "./compactor";
import { Cannon, CANNON } from "./cannon";
import { blinkVisible } from "./lineClear";
import type { LevelConfig } from "./level";
import { FX_TTL, type FxEvent } from "./fx";

export interface Viewport {
  scale: number;
  ox: number;
  oy: number;
}

/**
 * Where the world sits in the canvas, in CSS px. Delegates to the layout solver
 * (layout.ts) rather than doing its own naive centered fit, so the field rect
 * accounts for reserved chrome bands and safe-area insets. That delegation is
 * what keeps input honest: screenToWorld below calls this same function, so a
 * tap always maps through the exact transform the frame was drawn with — a
 * separate fit here would silently offset every aim on any non-16:9 viewport.
 */
export function computeViewport(cw: number, ch: number): Viewport {
  const l = computeLayout(cw, ch);
  return { scale: l.scale, ox: l.ox, oy: l.oy };
}

/**
 * Plain centered letterbox fit of the world into a box — no chrome bands, no
 * safe-area insets. This is what an OFF-FIELD surface wants: computeViewport
 * above deliberately reserves a control-rail band out of the viewport (see
 * layout.ts's "snug" mode) and folds in the device's notch insets, both of
 * which are meaningless for a canvas nobody plays or taps. The menu's attract
 * demo (attract.ts) draws through this instead, so a phone's notch can't
 * offset a 300px decorative panel by a third of its width.
 */
export function fitViewport(cssW: number, cssH: number): Viewport {
  const scale = Math.max(0.0001, Math.min(cssW / WORLD.width, cssH / WORLD.height));
  return {
    scale,
    ox: (cssW - WORLD.width * scale) / 2,
    oy: (cssH - WORLD.height * scale) / 2,
  };
}

/** Map a client (CSS px) point to world coordinates. */
export function screenToWorld(
  cssW: number,
  cssH: number,
  rectLeft: number,
  rectTop: number,
  clientX: number,
  clientY: number,
): Matter.Vector {
  const vp = computeViewport(cssW, cssH);
  return {
    x: (clientX - rectLeft - vp.ox) / vp.scale,
    y: (clientY - rectTop - vp.oy) / vp.scale,
  };
}

export interface Scene {
  cubes: Cube[];
  /** The live piece joints, for the weld seams drawn between adjacent cubes
   *  (see drawJointSeams). Optional: a caller with nothing to say about
   *  structure simply draws no seams. */
  constraints?: Matter.Constraint[];
  compactor: Compactor;
  cannon: Cannon;
  trajectory: Matter.Vector[];
  now: number;
  aiming: boolean;
  /** Render-facing FX events (see fx.ts) — drawn by drawEffects() at the end
   *  of render(), over the settled field. */
  effects: FxEvent[];
  level: LevelConfig;
  /** Whether the NEXT shot fired will be a bomb — swaps the muzzle ghost. */
  nextIsBomb: boolean;
  bombs: Matter.Body[];
  /** Current signed wind acceleration (game.ts's windNow) — drives the HUD
   *  wind indicator's length/direction. Already post-stabilizer. */
  windNow: number;
  /** The bay's steady prevailing wind, or null to hide it — shown as a ghost
   *  marker on the gauge only when the Weather Survey unlock is owned (see
   *  meta.ts), so a headwind bay can be planned for rather than discovered. */
  windAverage: number | null;
  /** 0..1 reload progress (cannon.reloadRatio) — drives the muzzle ring. */
  reload: number;
  /** True while the bay's settle window is running (game.ts's Game.settling):
   *  the cannon is locked out, so it dims instead of promising a shot. */
  settling: boolean;
}

/**
 * `viewport` overrides where the world is placed inside the canvas. Omitted
 * (every in-game caller) it is the play-field solver's answer — the transform
 * input mapping also reads, which is what keeps a tap honest. The menu's
 * attract demo passes fitViewport() instead: it renders the same scene into a
 * small decorative canvas that reserves no controls and receives no input.
 */
/**
 * WELD SEAMS — how strong this bay's shipments are, and which of them is
 * currently coming apart.
 *
 * jointBreakStretch ramps 1.7 -> 2.8 across the ten bays and jointStiffness
 * with it (level.ts calls this "the core difficulty ramp"), and until now
 * nothing on screen said so: the player met stiffer cargo every bay with no
 * way to see it coming and no way to connect it to the press that answers it.
 *
 * WHY SEAMS RATHER THAN THE JOINTS THEMSELVES. pieces.ts joins every PAIR of
 * cubes in a shipment, so a four-cube piece carries six constraints and a bulk
 * one ten — and the constraint between two ADJACENT cubes runs centre to
 * centre, which is to say entirely underneath the two cubes it connects.
 * Stroking the constraints draws nothing at all where a seam belongs, and a
 * diagonal X across everything else; on a full field that is ~220 lines of
 * crosshatch in a colour that fights the cargo. What reads as structure is a
 * bar across the SHARED EDGE, which means adjacent pairs only — a rest length
 * longer than about one cube is a diagonal, and is skipped.
 *
 * Flat strokes, no shadowBlur, deliberately: the per-cube glow was profiled
 * out of drawCube for exactly this reason (see the note above cubeSprites),
 * and a seam per cube-pair would put the same cost straight back.
 */

/** Rest colour of a seam: dark graphite, and neither of the two obvious
 *  choices. Near-black read as a GAP between cubes rather than hardware
 *  holding them together — the field is already dark, so the darkest thing in
 *  it looks like absence. Full steel read as a stripe painted ON the piece,
 *  brighter than the cargo it is meant to be subordinate to. */
const SEAM_REST: readonly [number, number, number] = [47, 49, 60];
const SEAM_WARM: readonly [number, number, number] = [255, 176, 32];
const SEAM_HOT: readonly [number, number, number] = [255, 59, 59];

/** breakStretch 2.2 (bay 1) -> 0, 4.4 (bay 10) -> 1 — level.ts's ramp, and it
 *  has to be READ from there rather than hardcoded twice. When the ramp moved
 *  from 1.7-2.78 to 2.2-4.4 these constants stayed behind for a moment, and
 *  every bay's seams pinned at full width: the visualisation quietly stopped
 *  saying anything while still looking like it did. Rigid material is Infinity
 *  and pins at 1, which is correct — rebar is the strongest thing in the bay
 *  and should look it. */
const SEAM_MIN_STRETCH = BASE_BREAK_STRETCH;
const SEAM_MAX_STRETCH = BASE_BREAK_STRETCH * 2;
function seamStrength(breakStretch: number | undefined): number {
  if (!breakStretch || !Number.isFinite(breakStretch)) return 1;
  const span = SEAM_MAX_STRETCH - SEAM_MIN_STRETCH;
  return Math.max(0, Math.min(1, (breakStretch - SEAM_MIN_STRETCH) / span));
}

/** Graphite -> amber -> red by strain. */
function seamColor(strain: number, alpha: number): string {
  const seg = strain < 0.5 ? 0 : 1;
  const k = strain < 0.5 ? strain / 0.5 : (strain - 0.5) / 0.5;
  const a = seg === 0 ? SEAM_REST : SEAM_WARM;
  const b = seg === 0 ? SEAM_WARM : SEAM_HOT;
  const ch = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgba(${ch(0)}, ${ch(1)}, ${ch(2)}, ${alpha.toFixed(3)})`;
}

function drawJointSeams(ctx: CanvasRenderingContext2D, cs: Matter.Constraint[] | undefined): void {
  if (!cs?.length) return;
  ctx.save();
  ctx.lineCap = "butt";
  for (const c of cs) {
    const a = c.bodyA;
    const b = c.bodyB;
    if (!a || !b) continue;
    const meta = c as unknown as { restLength?: number; breakStretch?: number };
    const rest = meta.restLength
      ?? Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    // CELL, not a measurement off the body's vertices: pieces.ts builds cubes
    // with `chamfer: { radius: 3 }`, so a cube has EIGHT vertices and v[0]->v[1]
    // is a 3px chamfer chord rather than its side. Reading it that way makes
    // every rest length look like a diagonal and draws no seams at all.
    if (rest > CELL * 1.35) continue;
    const t = seamStrength(meta.breakStretch);
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const len = Math.hypot(dx, dy) || 1;
    // How far this joint is toward its OWN breaking point right now. Referenced
    // against min(breakStretch, 3) so rebar — Infinity — still shows strain
    // instead of flatlining at zero forever, which would make the one material
    // that cannot break also the one that never looks stressed.
    const limit = Math.min(meta.breakStretch ?? 2, 3);
    const strain = Math.max(0, Math.min(1, (len / rest - 1) / Math.max(0.05, limit - 1)));
    // Perpendicular to the joint axis: the seam lies ALONG the shared edge.
    const px = -dy / len;
    const py = dx / len;
    const half = CELL * (0.2 + 0.16 * t);
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    ctx.strokeStyle = seamColor(strain, 0.55 + 0.35 * t);
    ctx.lineWidth = 1.4 + 3.6 * t;
    ctx.beginPath();
    ctx.moveTo(mx - px * half, my - py * half);
    ctx.lineTo(mx + px * half, my + py * half);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * CONGESTION ROWS — how full the bay is, drawn as light on the floor.
 *
 * The congestion tax (level.ts's PILE_TIERS) prices a launch off the number of
 * live cubes, and a number the player cannot see is a rule they can only learn
 * by being charged for it. This turns the count into the one quantity the bay
 * already speaks in: LINES. compactorMinLineCells cubes make a line, so the
 * pile lights that many rows from the floor up, and the row where the colour
 * changes is the row where the price does.
 *
 * Green while a launch costs list price, amber from the row that triggers the
 * first tier, red from the row that triggers the second — the same three
 * colours, in the same order, that the Launch readout in the plant panel wears
 * (app.css's .pl-meta__launch--warn/--danger). One rule, stated twice, so a
 * player can be looking at either one when the price moves.
 *
 * Thresholds are DERIVED from the level rather than written here, so a bay
 * whose player bought Bay Extension lights amber later — the relief they
 * purchased is visible as the thing it actually is, more green rows.
 *
 * Behind everything: this is floor light, not a HUD overlay. It draws inside
 * the world clip after the cached backdrop and before the compactor, so cargo,
 * the press and the cannon all sit on top of it.
 */
function drawCongestionRows(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const tiers = scene.level.pileTiers;
  if (!tiers.length || !scene.cubes.length) return;
  const perLine = Math.max(1, scene.level.compactorMinLineCells);
  const allowance = scene.level.pileAllowance;
  const maxRows = Math.floor(WORLD.height / CELL);
  const lit = Math.min(maxRows, Math.ceil(scene.cubes.length / perLine));
  // The row index at which each tier starts biting. `> t.cubes + allowance`
  // is game.ts's own test, so the first taxed cube is t.cubes + allowance + 1
  // and the row holding it is that count divided by a line.
  const rowFor = (t: { cubes: number }): number =>
    Math.floor((t.cubes + allowance) / perLine);
  const warnRow = tiers[0] ? rowFor(tiers[0]) : Infinity;
  const dangerRow = tiers[1] ? rowFor(tiers[1]) : Infinity;

  ctx.save();
  for (let r = 0; r < lit; r++) {
    const rgb = r >= dangerRow ? "255, 45, 85" : r >= warnRow ? "255, 176, 32" : "0, 255, 156";
    // Rows are floor-anchored on the same grid lineClear snaps to (game.ts
    // aligns against WORLD.height - CELL/2), so row r spans the cell whose
    // bottom is r cells off the floor.
    const y = WORLD.height - (r + 1) * CELL;
    // 0.30 -> 0.09 up the row. Checked at the size that matters least: the
    // menu's attract panel is ~10px a row, and 0.16 was invisible there while
    // 0.55 turned the bay into a colour field the cargo had to fight. This
    // reads as floor light at panel size and stays background at bay size.
    const g = ctx.createLinearGradient(0, y + CELL, 0, y);
    g.addColorStop(0, `rgba(${rgb}, 0.30)`);
    g.addColorStop(1, `rgba(${rgb}, 0.09)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, y, WORLD.width, CELL);
    // A brighter rule on the row's own floor line, so the bands read as
    // discrete rows to count rather than one wash that happens to be taller.
    ctx.fillStyle = `rgba(${rgb}, 0.45)`;
    ctx.fillRect(0, y + CELL - 1.5, WORLD.width, 1.5);
  }
  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  scene: Scene,
  viewport?: Viewport,
): void {
  const vp = viewport ?? computeViewport(cssW, cssH);
  syncSpriteScale(vp.scale * dpr);

  // Backdrop, field gradient, grid and wall glow are static per viewport —
  // blit the cached opaque layer instead of re-painting them (no clearRect
  // needed underneath, the layer covers every device pixel).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(getBackgroundLayer(cssW, cssH, dpr, vp), 0, 0);

  ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.ox * dpr, vp.oy * dpr);
  // Clip to the world rect
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WORLD.width, WORLD.height);
  ctx.clip();

  drawCongestionRows(ctx, scene);
  drawWindIndicator(ctx, scene.level, scene.windNow, scene.windAverage);
  drawCompactor(ctx, scene.compactor);
  drawPistons(ctx, scene.compactor);
  for (const cube of scene.cubes) drawCube(ctx, cube, scene.now);
  // Over the cubes, not under: a seam between adjacent cubes is covered by the
  // very cubes it joins, so drawing it underneath draws nothing.
  drawJointSeams(ctx, scene.constraints);
  for (const bomb of scene.bombs) drawBomb(ctx, bomb);
  drawTrajectory(ctx, scene.trajectory, scene.reload, scene.now);
  // Drawn AFTER the cannon: the barrel is opaque and longer than its visual
  // tip, and previously painted over ghost cells at some aim angles.
  drawCannon(ctx, scene.cannon, scene.aiming, scene.settling);
  drawReloadRing(ctx, scene.cannon, scene.reload);
  if (!scene.settling) {
    drawLoadedPiece(ctx, scene.cannon, scene.level.pieceSize, scene.nextIsBomb, scene.now);
  }
  drawEffects(ctx, scene.effects, scene.now);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sprite + layer caches.
//
// Canvas shadowBlur is a full Gaussian blur pass over the filled shape, re-run
// on every fill that has it set. drawCube used to pay that per cube per frame
// (16-22px of glow × a 150+ cube field), drawTrajectory per dot (~47 of them),
// and render() re-painted the static backdrop gradient + grid + glowing walls
// every frame. On a slow phone that blur work dwarfs the physics step
// (sim/perf.ts measures physics at ~0.2ms/step with 200 cubes on this class
// of scene), so everything glow-blurred is baked ONCE into an offscreen
// canvas at the live device-pixel scale and stamped with drawImage afterward.
//
// Bakes are lazy, keyed by exactly the inputs that change the pixels, and the
// caches flush when the world→device scale drifts (resize / dpr change) so
// sprites stay crisp at the live resolution. shadowBlur is specified in
// device pixels of the target canvas (the spec exempts it from the CTM), and
// the bake canvas runs at the same device scale the live canvas does, so the
// baked glows use the same blur numbers drawCube always passed.
// ---------------------------------------------------------------------------

/** World-px margin around a sprite's shape for its baked glow: the widest
 *  blur used is 22 device px (cold cryo), which at the minimum bake scale of
 *  1 (see syncSpriteScale) spills at most 22 world px past the shape, plus
 *  the 1.25px of edge-highlight stroke outside the cube's face. */
const SPRITE_PAD = 26;

/** Device pixels per world px the current sprites are baked at; 0 = nothing
 *  baked yet. Clamped to [1, 3]: below 1 the glow would out-spill SPRITE_PAD,
 *  above 3 sprites cost memory with no visible gain. */
let spritePxScale = 0;

const cubeSprites = new Map<string, HTMLCanvasElement>();
/** Everything ELSE baked at the live scale — compactor bar, piston parts,
 *  cannon, FX shards/sparks, ghost cells — one map, keys prefixed by kind.
 *  These exist for the same reason cubeSprites does: shadowBlur is a full
 *  Gaussian pass per blurred fill, and the chrome here used to pay it every
 *  frame of every bay (the compactor bar alone was a 26px blur over a
 *  ~40x290 rect, plus two piston rigs and the cannon, at 60Hz, forever). */
const miscSprites = new Map<string, HTMLCanvasElement>();
let dotSprite: HTMLCanvasElement | null = null;

/** Adopt the frame's world→device scale, flushing the sprite caches when it
 *  has drifted >10% from what they were baked at — tighter would re-bake on
 *  mobile browser chrome show/hide, looser would leave sprites visibly soft
 *  after a real resize. */
function syncSpriteScale(pxScale: number): void {
  const target = Math.min(3, Math.max(1, pxScale));
  if (spritePxScale !== 0 && Math.abs(target - spritePxScale) / spritePxScale < 0.1) return;
  spritePxScale = target;
  cubeSprites.clear();
  miscSprites.clear();
  dotSprite = null;
}

/** An offscreen canvas covering worldW×worldH world px at the current bake
 *  scale, its context pre-scaled so callers draw in world units. Square when
 *  only one dimension is given. */
function makeSpriteCanvas(worldW: number, worldH = worldW): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = Math.ceil(worldW * spritePxScale);
  c.height = Math.ceil(worldH * spritePxScale);
  const ctx = c.getContext("2d")!;
  // Scale by the CEILED backing size, not by spritePxScale. Every caller draws
  // the whole backing store into a worldW x worldH box, so the two have to
  // correspond exactly. Baking at spritePxScale did not: the content filled
  // only worldW * spritePxScale of ceil(worldW * spritePxScale) device px, and
  // stretching that to the full box pulled everything toward the sprite's
  // top-left by up to half a world pixel — worst at the sizes where the ceil
  // rounds furthest. On the cannon base (a 112-world sprite) that was ~0.3
  // world px: the ring painted high and left of world (150,288), so the DOM
  // conveyor, which is placed there exactly, looked like it was sitting low
  // against it. The cost is a sub-percent difference between the baked pixel
  // scale and spritePxScale, which nothing can see.
  ctx.scale(c.width / worldW, c.height / worldH);
  return ctx;
}

/** Fetch-or-bake a misc sprite. `bake` draws in world units onto a canvas of
 *  worldW×worldH with (0,0) at the canvas's top-left — padding is the
 *  caller's business, baked into its key/geometry. */
function getSprite(
  key: string,
  worldW: number,
  worldH: number,
  bake: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const hit = miscSprites.get(key);
  if (hit) return hit;
  const ctx = makeSpriteCanvas(worldW, worldH);
  bake(ctx);
  miscSprites.set(key, ctx.canvas);
  return ctx.canvas;
}

/** The face a cube of this (type, color, material-state) stamps every frame:
 *  glow + fill, clipped interior (pattern / slag rubble / frost), edge
 *  highlight. Exactly the paint drawCube ran inline before the cache; the
 *  material flags are mutually exclusive (slag and cold can't both hold), and
 *  a thawed cryo cube deliberately shares the plain sprite of its color. */
function getCubeSprite(
  type: PieceType,
  color: string,
  slag: boolean,
  cold: boolean,
): HTMLCanvasElement {
  const key = `${type}|${color}|${slag ? "s" : cold ? "c" : "n"}`;
  const hit = cubeSprites.get(key);
  if (hit) return hit;

  const h = CELL / 2;
  const ctx = makeSpriteCanvas(CELL + SPRITE_PAD * 2);
  ctx.translate(SPRITE_PAD + h, SPRITE_PAD + h);
  const dark = shade(color, -70);
  const light = shade(color, 45);

  // Slag is inert, so it does not glow — every live shipment on the field
  // does. Cold cryo glows harder than it will once thawed: the frost is the
  // warning.
  ctx.shadowColor = color;
  ctx.shadowBlur = slag ? 0 : cold ? 22 : 16;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.clip();
  if (slag) {
    // Rubble hatching instead of the type pattern — slag has no shipment
    // identity left to advertise, which is precisely its point.
    drawSlagFace(ctx, -h, CELL, dark, light);
  } else {
    // Per-type interior pattern (ported from main.py draw_square_piece)
    drawPattern(ctx, type, -h, -h, CELL, dark, light);
    // Frost crystals over the type pattern, so a cryo O still reads as an O.
    // They vanish the instant it thaws — that transition IS the feedback that
    // the strike landed, and the row is now completable.
    if (cold) drawFrost(ctx, -h, CELL);
  }
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = light;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.stroke();

  cubeSprites.set(key, ctx.canvas);
  return ctx.canvas;
}

/** Trajectory dots are all stamps of one glowing disc scaled 0.5-1.5×. Baked
 *  at the mid radius of the 2..6px range drawTrajectory draws, so scaling
 *  stays near 1:1 and the glow scales with the dot. */
const DOT_R = 4;
const DOT_PAD = 12;

function getDotSprite(): HTMLCanvasElement {
  if (dotSprite) return dotSprite;
  const ctx = makeSpriteCanvas((DOT_R + DOT_PAD) * 2);
  ctx.translate(DOT_R + DOT_PAD, DOT_R + DOT_PAD);
  ctx.shadowColor = COLORS.trajectory;
  ctx.shadowBlur = 10;
  ctx.fillStyle = COLORS.trajectory;
  ctx.beginPath();
  ctx.arc(0, 0, DOT_R, 0, Math.PI * 2);
  ctx.fill();
  dotSprite = ctx.canvas;
  return dotSprite;
}

let bgLayer: HTMLCanvasElement | null = null;
let bgLayerKey = "";

/** Letterbox backdrop + field gradient + grid + glowing walls, composited
 *  once per viewport into an opaque device-resolution layer. Re-baked only
 *  when the canvas size or world placement changes (resize, rotation, dpr
 *  change); every frame in between is a single full-canvas drawImage. */
function getBackgroundLayer(
  cssW: number,
  cssH: number,
  dpr: number,
  vp: Viewport,
): HTMLCanvasElement {
  // Same Math.floor sizing as main.ts's onResize gives the live canvas, so
  // the layer maps 1:1 onto it.
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  const key = `${w}x${h}|${vp.scale}|${vp.ox}|${vp.oy}`;
  if (bgLayer && bgLayerKey === key) return bgLayer;

  if (!bgLayer) bgLayer = document.createElement("canvas");
  bgLayer.width = w; // also resets the context's transform
  bgLayer.height = h;
  const bctx = bgLayer.getContext("2d")!;
  bctx.fillStyle = COLORS.bg;
  bctx.fillRect(0, 0, w, h);
  bctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.ox * dpr, vp.oy * dpr);
  bctx.save();
  bctx.beginPath();
  bctx.rect(0, 0, WORLD.width, WORLD.height);
  bctx.clip();
  drawBackground(bctx);
  drawWalls(bctx);
  bctx.restore();
  bgLayerKey = key;
  return bgLayer;
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(
    WORLD.width * 0.5, -80, 80,
    WORLD.width * 0.5, WORLD.height * 0.4, WORLD.width * 0.8,
  );
  g.addColorStop(0, "#161636");
  g.addColorStop(1, "#07070f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.width; x += CELL) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
  }
  for (let y = 0; y <= WORLD.height; y += CELL) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
  }
  ctx.stroke();
}

/** Left/bottom/right glow only — the top is physically open (pieces can fly
 *  above the frame and fall back in), so the visuals leave the sky open too. */
function drawWalls(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = COLORS.aim;
  ctx.shadowColor = COLORS.wallGlow;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(2, WORLD.height - 2);
  ctx.lineTo(WORLD.width - 2, WORLD.height - 2);
  ctx.lineTo(WORLD.width - 2, 2);
  ctx.stroke();
  ctx.restore();
}

/** Linear-interpolate between two "#rrggbb" hex colors (t clamped 0..1) —
 *  used by the wind gauge to shift calm→dangerous with strength. */
function lerpHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const lerp = (sh: number) => {
    const ca = (na >> sh) & 255;
    const cb = (nb >> sh) & 255;
    return Math.round(ca + (cb - ca) * k);
  };
  return `rgb(${lerp(16)},${lerp(8)},${lerp(0)})`;
}

/**
 * HUD wind gauge: a bold, glowing directional bar drawn on a translucent pill
 * just below the top HUD strip (the old thin arrow sat at world-y 34, behind
 * the DOM HUD, and was effectively invisible — see the wind-rework PR). Its
 * length and direction track windNow / level.windMax (signed, so it points the
 * way the wind is actually pushing airborne pieces — see game.ts's
 * windNow/applyWind), and its color ramps calm-cyan → hot-red as the gust
 * strengthens so a strong wind reads as an obvious hazard at a glance. Inert
 * (no draw) when level.windMax is 0 (the calm early bays), matching the
 * mechanic itself.
 */
const WIND_HUD_Y = 108; // world-y, clear of the ~64px DOM HUD strip up top
const WIND_HUD_HALF_LEN = 150; // px of bar reach at full strength (|ratio| = 1)
const WIND_HUD_HEAD = 15;

function drawWindIndicator(
  ctx: CanvasRenderingContext2D,
  level: LevelConfig,
  windNow: number,
  windAverage: number | null,
): void {
  if (level.windMax <= 0) return;
  const ratio = Math.max(-1, Math.min(1, windNow / level.windMax));
  const mag = Math.abs(ratio);
  const dir = ratio >= 0 ? 1 : -1;
  const cx = WORLD.width / 2;
  const y = WIND_HUD_Y;
  const len = ratio * WIND_HUD_HALF_LEN;
  const col = lerpHex(COLORS.aim, COLORS.compactor, mag);

  ctx.save();
  ctx.textAlign = "center";

  // Translucent backing pill so the gauge stays legible over any field state.
  const padX = WIND_HUD_HALF_LEN + 34;
  const pillTop = y - 30;
  const pillH = 52;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(7,7,15,0.55)";
  roundRect(ctx, cx - padX, pillTop, padX * 2, pillH, 12);
  ctx.fill();

  // "WIND" label.
  ctx.font = "700 13px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = COLORS.textDim;
  ctx.globalAlpha = 0.9;
  ctx.fillText("WIND", cx, y - 14);

  // Baseline track + center tick (the calm/zero reference).
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = COLORS.textDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - WIND_HUD_HALF_LEN, y);
  ctx.lineTo(cx + WIND_HUD_HALF_LEN, y);
  ctx.moveTo(cx, y - 8);
  ctx.lineTo(cx, y + 8);
  ctx.stroke();

  // Glowing strength bar. Same double-stroke halo as drawReloadRing and for
  // the same reason: the bar's length tracks the live wind every frame, so
  // its glow can't be a baked sprite, and shadowBlur here was a per-frame
  // Gaussian pass for the whole windy half of a run.
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx + len, y);
  ctx.globalAlpha = 0.2 + 0.18 * mag;
  ctx.strokeStyle = col;
  ctx.lineWidth = 15;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = col;

  // Arrowhead pointing the way the wind pushes.
  if (mag > 0.02) {
    const tipX = cx + len;
    ctx.beginPath();
    ctx.moveTo(tipX + dir * WIND_HUD_HEAD, y);
    ctx.lineTo(tipX, y - WIND_HUD_HEAD * 0.72);
    ctx.lineTo(tipX, y + WIND_HUD_HEAD * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  // Weather Survey (meta unlock): a dim tick at the bay's STEADY average, so
  // the live gust reads as "drifting around a known baseline" instead of an
  // unknowable number. Drawn behind the numeric readout, in the neutral track
  // color, so it never competes with the live bar for attention.
  if (windAverage !== null) {
    const avgRatio = Math.max(-1, Math.min(1, windAverage / level.windMax));
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx + avgRatio * WIND_HUD_HALF_LEN, y - 11);
    ctx.lineTo(cx + avgRatio * WIND_HUD_HALF_LEN, y + 11);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Stabilizer tag: when the launcher cancels part of the wind, say so — the
  // gauge is showing the POST-assist number (game.ts's windNow), and without
  // this the upgrade would silently look like "the weather got easier".
  if (level.windAssist > 0) {
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = COLORS.trajectory;
    ctx.font = "700 11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText(`STAB −${Math.round(level.windAssist * 100)}%`, cx + padX - 44, y - 14);
  }

  // Numeric strength readout under the bar, on the pushing side.
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = col;
  ctx.font = "700 12px 'JetBrains Mono', ui-monospace, monospace";
  const pct = Math.round(mag * 100);
  const glyph = dir >= 0 ? "▶" : "◀";
  ctx.fillText(mag < 0.02 ? "CALM" : `${glyph} ${pct}%`, cx, y + 22);
  ctx.restore();
}

/** World-px margin around the bar sprite: the 26px glow plus the cap's 4px
 *  overhang, with slack (see SPRITE_PAD's derivation — same reasoning). */
const BAR_PAD = 34;

/** The compactor bar's full paint — glow, gradient, cap, hazard stripes —
 *  exactly as drawCompactor used to run it per frame, baked once per bay
 *  geometry. Only its x moves at runtime, and stripes are anchored to the
 *  bar's own top, so one sprite serves the whole bay. */
function getBarSprite(w: number, h: number): HTMLCanvasElement {
  return getSprite(`bar|${w}x${h}`, w + BAR_PAD * 2, h + BAR_PAD * 2, (ctx) => {
    const x = BAR_PAD;
    const top = BAR_PAD;
    ctx.save();
    ctx.shadowColor = COLORS.compactorGlow;
    ctx.shadowBlur = 26;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, "#ff5c78");
    grad.addColorStop(0.5, COLORS.compactor);
    grad.addColorStop(1, "#c31b3d");
    ctx.fillStyle = grad;
    ctx.fillRect(x, top, w, h);
    // glowing cap so the top edge (the "arc over" line) reads clearly
    ctx.fillStyle = "#ffd0d8";
    ctx.fillRect(x - 3, top - 4, w + 6, 6);
    // hazard stripes (bar bottom == WORLD.height in world space, == top + h here)
    ctx.beginPath();
    ctx.rect(x, top, w, h);
    ctx.clip();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#0a0a12";
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let y = top - w; y < top + h; y += 34) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + w);
    }
    ctx.stroke();
    ctx.restore();
  });
}

function drawCompactor(ctx: CanvasRenderingContext2D, c: Compactor): void {
  const sprite = getBarSprite(c.width, c.height);
  ctx.drawImage(
    sprite,
    c.x - c.width / 2 - BAR_PAD,
    c.top - BAR_PAD,
    c.width + BAR_PAD * 2,
    c.height + BAR_PAD * 2,
  );
}

/**
 * Two hydraulic pistons (1d "recycling-plant" layout — see
 * design/screens/gameplay-variants.html's `.piston`) visually "driving" the
 * compactor bar toward the right wall: a fixed barrel mounted so it tucks
 * just under the right edge of the DOM plant panel (the panel spans field
 * x 1.67%..48.75%, i.e. world x 624 — see app.css's .plant; the mockup
 * mounts its barrels at frame x 462/960 = world 616, 8px under the panel
 * edge, so they read as bolted onto the machine), a telescoping rod that
 * stretches/shrinks to the bar's LIVE x-position every frame, and a head
 * that "attaches" right at the bar's left face. Drawn here (not as DOM)
 * precisely because the rod length has to track compactor.x every physics
 * step, same as the bar itself. Two heights, spread inside the compactor's
 * own half-height band (c.top..c.top+c.height) at the mockup's fractions,
 * so they never desync if compactorHeightFrac changes. The bar CAN sweep
 * left of the default mount on a widened bay (leftX bottoms out at 547 < 616
 * at compactorOpenCells 18 — Bay Extension T3, see upgrades.ts), which used to bury
 * the head inside the barrel; the whole rig now slides left per-level so
 * the barrel tip always clears the bar's leftmost face (see drawPistons).
 */
const PISTON_BARREL_X = 616; // world-x, preferred mount — tucked under the plant panel's right edge (624); slides left for wide bays (see drawPistons)
const PISTON_BARREL_LEN = 93;
const PISTON_BARREL_H = 35;
const PISTON_ROD_H = 15;
const PISTON_HEAD_W = 17;
const PISTON_HEAD_H = 51;
const PISTON_Y_FRACS = [0.27, 0.73]; // fraction down the compactor's [top, top+height] band — mockup's two mounts

function drawPistons(ctx: CanvasRenderingContext2D, c: Compactor): void {
  // Mount the rig at the mockup's 616 when the bay allows, but slide it left
  // for wide bays: the barrel tip must stay clear of the bar's LEFTMOST face
  // (c.leftX is the open stop) plus the head's width, or the head would
  // sweep through the housing on full retreat (a fully-extended bay at 18 open
  // cells puts that face at 534, 175px left of the default barrel tip).
  const minFace = c.leftX - c.width / 2;
  const mountX = Math.min(PISTON_BARREL_X, minFace - PISTON_HEAD_W - PISTON_BARREL_LEN - 6);
  const barrelSprite = getPistonBarrelSprite();
  const rodSprite = getPistonRodSprite();
  const headSprite = getPistonHeadSprite();
  for (const frac of PISTON_Y_FRACS) {
    const y = c.top + c.height * frac;
    const barrelX0 = mountX;
    const barrelX1 = barrelX0 + PISTON_BARREL_LEN;
    const headX = c.x - c.width / 2; // the bar's left face — where the piston pushes it
    const rodX0 = barrelX1;
    const rodX1 = Math.max(rodX0, headX - PISTON_HEAD_W / 2);

    // Rod first (it tucks under both the barrel and the head). Crop away the
    // sprite's transparent glow padding before stretching: scaling that padding
    // created visible gaps at BOTH joints when the piston was fully extended.
    if (rodX1 > rodX0) {
      ctx.drawImage(
        rodSprite,
        PISTON_PART_PAD,
        PISTON_PART_PAD,
        PISTON_ROD_BAKE_LEN,
        PISTON_ROD_H,
        rodX0,
        y - PISTON_ROD_H / 2,
        rodX1 - rodX0,
        PISTON_ROD_H,
      );
    }
    ctx.drawImage(
      barrelSprite,
      barrelX0 - PISTON_PART_PAD,
      y - PISTON_BARREL_H / 2 - PISTON_PART_PAD,
      PISTON_BARREL_LEN + PISTON_PART_PAD * 2,
      PISTON_BARREL_H + PISTON_PART_PAD * 2,
    );
    ctx.drawImage(
      headSprite,
      headX - PISTON_HEAD_W - PISTON_PART_PAD,
      y - PISTON_HEAD_H / 2 - PISTON_PART_PAD,
      PISTON_HEAD_W + PISTON_PART_PAD * 2,
      PISTON_HEAD_H + PISTON_PART_PAD * 2,
    );
  }
}

/** Shared world-px margin for the piston part sprites: the widest glow is the
 *  head's 12, plus the barrel's stroke. */
const PISTON_PART_PAD = 16;
/** Rod bake length (world px) — the sprite is stretched horizontally to the
 *  live telescoping length at draw time. */
const PISTON_ROD_BAKE_LEN = 64;

function getPistonBarrelSprite(): HTMLCanvasElement {
  const w = PISTON_BARREL_LEN + PISTON_PART_PAD * 2;
  const h = PISTON_BARREL_H + PISTON_PART_PAD * 2;
  return getSprite("piston-barrel", w, h, (ctx) => {
    const grad = ctx.createLinearGradient(0, PISTON_PART_PAD, 0, PISTON_PART_PAD + PISTON_BARREL_H);
    grad.addColorStop(0, "#2c2c48");
    grad.addColorStop(1, "#171729");
    ctx.fillStyle = grad;
    roundRect(ctx, PISTON_PART_PAD, PISTON_PART_PAD, PISTON_BARREL_LEN, PISTON_BARREL_H, 3);
    ctx.fill();
    ctx.strokeStyle = "#3d3d63";
    ctx.lineWidth = 1.5;
    roundRect(ctx, PISTON_PART_PAD, PISTON_PART_PAD, PISTON_BARREL_LEN, PISTON_BARREL_H, 3);
    ctx.stroke();
  });
}

function getPistonRodSprite(): HTMLCanvasElement {
  const w = PISTON_ROD_BAKE_LEN + PISTON_PART_PAD * 2;
  const h = PISTON_ROD_H + PISTON_PART_PAD * 2;
  return getSprite("piston-rod", w, h, (ctx) => {
    const grad = ctx.createLinearGradient(0, PISTON_PART_PAD, 0, PISTON_PART_PAD + PISTON_ROD_H);
    grad.addColorStop(0, "#e2e2f5");
    grad.addColorStop(0.55, "#8f8fc0");
    grad.addColorStop(1, "#5c5c88");
    ctx.shadowColor = "rgba(0,240,255,0.4)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = grad;
    ctx.fillRect(PISTON_PART_PAD, PISTON_PART_PAD, PISTON_ROD_BAKE_LEN, PISTON_ROD_H);
  });
}

function getPistonHeadSprite(): HTMLCanvasElement {
  const w = PISTON_HEAD_W + PISTON_PART_PAD * 2;
  const h = PISTON_HEAD_H + PISTON_PART_PAD * 2;
  return getSprite("piston-head", w, h, (ctx) => {
    const grad = ctx.createLinearGradient(PISTON_PART_PAD, 0, PISTON_PART_PAD + PISTON_HEAD_W, 0);
    grad.addColorStop(0, "#ff6f8a");
    grad.addColorStop(1, "#ff2d55");
    ctx.shadowColor = "rgba(255,45,85,0.75)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = grad;
    roundRect(ctx, PISTON_PART_PAD, PISTON_PART_PAD, PISTON_HEAD_W, PISTON_HEAD_H, 2);
    ctx.fill();
  });
}

function drawCube(ctx: CanvasRenderingContext2D, cube: Cube, now: number): void {
  if (!blinkVisible(cube, now)) return;
  const color = cube.blinkStart !== null ? "#ff6464" : cube.color;
  // A cube's material is legible from its color alone (theme.ts's
  // MATERIAL_SPEC), but the two that CHANGE ITS WORTH get a second, non-color
  // cue as well: color alone would leave a colour-blind player reading slag as
  // just another shipment, and the whole mechanic is knowing which cubes count.
  // Both cues (and the glow) are baked into the sprite — see getCubeSprite.
  const slag = cube.material === "slag";
  const cold = cube.material === "cryo" && !cube.struck;
  const sprite = getCubeSprite(cube.type, color, slag, cold);

  const b = cube.body;
  const half = CELL / 2 + SPRITE_PAD;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  ctx.drawImage(sprite, -half, -half, half * 2, half * 2);
  ctx.restore();
}

/** Slag's interior: coarse diagonal rubble, deliberately irregular and matte.
 *  Derived from the cube's own local coords so it is stable under rotation
 *  rather than shimmering as the cube tumbles. */
function drawSlagFace(
  ctx: CanvasRenderingContext2D,
  o: number,
  size: number,
  dark: string,
  light: string,
): void {
  ctx.fillStyle = dark;
  ctx.fillRect(o, o, size, size);
  ctx.strokeStyle = light;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.5;
  for (let i = -1; i < 4; i++) {
    const s = o + i * (size / 3);
    ctx.beginPath();
    ctx.moveTo(s, o + size);
    ctx.lineTo(s + size * 0.55, o);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Cold cryo's frost: a few white needles radiating from the cube's center.
 *  Drawn only while frozen (see drawCube) so thawing is a visible event. */
function drawFrost(ctx: CanvasRenderingContext2D, o: number, size: number): void {
  const c = o + size / 2;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * size * 0.36, c + Math.sin(a) * size * 0.36);
    ctx.stroke();
  }
  ctx.restore();
}

/** A live flying/rolling bomb — dark sphere with a subtle red glow and a
 *  small fuse-spark highlight, so it reads as distinct from a cube in flight. */
function drawBomb(ctx: CanvasRenderingContext2D, body: Matter.Body): void {
  const r = CELL * 0.45;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.shadowColor = "#ff2d55";
  ctx.shadowBlur = 14;
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, "#3a3a4a");
  grad.addColorStop(1, "#0a0a12");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ff2d55";
  ctx.stroke();
  ctx.fillStyle = "#ffe066";
  ctx.beginPath();
  ctx.arc(0, -r * 0.9, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  type: PieceType,
  x: number,
  y: number,
  s: number,
  dark: string,
  light: string,
): void {
  ctx.lineWidth = 1.5;
  const line = (x1: number, y1: number, x2: number, y2: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (type) {
    case "I":
      for (let i = 0; i < s; i += 8) { line(x, y + i, x + s, y + i, dark); }
      break;
    case "O":
      for (let i = 4; i < s / 2; i += 6) {
        ctx.strokeStyle = i % 12 === 4 ? dark : light;
        ctx.strokeRect(x + i, y + i, s - 2 * i, s - 2 * i);
      }
      break;
    case "T":
      for (let i = -s; i < s; i += 9) { line(x + i, y, x + i + s, y + s, dark); }
      break;
    case "L":
      for (let i = 0; i < s; i += 8) { line(x + i, y, x + i, y + s, dark); }
      break;
    case "J":
      for (let i = 0; i < s * 2; i += 9) { line(x + s - i, y, x + 2 * s - i, y + s, dark); }
      break;
    case "S":
      ctx.fillStyle = dark;
      for (let i = 5; i < s; i += 8) {
        for (let j = 5; j < s; j += 8) {
          ctx.beginPath();
          ctx.arc(x + i, y + j, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case "Z":
      for (let i = 0; i < s; i += 9) { line(x, y + i, x + s, y + i, dark); }
      for (let i = 0; i < s; i += 9) { line(x + i, y, x + i, y + s, light); }
      break;
  }
}

/** The reduced-motion query, made once and READ per frame: a MediaQueryList
 *  keeps itself current, so a player who flips the preference mid-run is
 *  honoured without a matchMedia call inside the draw loop. */
let reduceMotionMQ: MediaQueryList | null | undefined;
function prefersReducedMotion(): boolean {
  if (reduceMotionMQ === undefined) {
    reduceMotionMQ = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  }
  return !!reduceMotionMQ?.matches;
}

/**
 * THE ARC IS THE RELOAD (and the aim re-forming on top of it).
 *
 * The muzzle ring and the plant panel's bar both already carry this number and
 * both are in the wrong place for it: the ring sits under the player's own
 * dragging thumb, the bar is at the bottom of the screen. The arc is the one
 * thing their eyes are actually on while a shot is lined up, so it says it
 * too — and it says it by not being there.
 *
 * Firing takes the arc away completely. It comes back on an EXPONENTIAL
 * curve, blinking, with its far end scattered, and every one of those three
 * settles at ready. A linear fade said the wrong thing: dim-but-readable the
 * whole way through reads as "wait a moment", when what is true is "there is
 * no shot yet". Gone, then forming, then solid is the honest shape of it.
 *
 * WHY THE BLINK'S PHASE COMES FROM `reload` AND NOT FROM `now`. The obvious
 * `sin(now * rate(reload))` jumps every time the rate changes, because
 * multiplying a WALL CLOCK by a rising frequency moves the phase itself: the
 * wave stutters and skips instead of accelerating. Running the phase through
 * the same exponential ramp makes the rate rise with the ratio, continuously,
 * with nothing to keep in sync frame to frame — and cos() of a whole number of
 * turns lands at 1 at BOTH ends, so the effect starts on a bright beat and
 * arrives at ready already at full alpha, with no pop at the hand-off.
 */

/** exp ease over 0..1: 0 at 0, 1 at 1, and the bigger k is the longer it
 *  stays near nothing before it moves. k -> 0 would be the linear ramp. */
function expRamp(x: number, k: number): number {
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
}

/** Steepness of the arc's return: nothing at the instant of the shot, a ghost
 *  within a beat of it, firming through the middle, unmistakable by the end.
 *
 *  Tuned on a real cycle, twice, and the plot lied both times. 3.5 held the
 *  arc under the perceptible floor until the last quarter, so the blink and
 *  the scatter had to say their piece inside 250ms — a pop, not a return. 2.5
 *  fixed the pop and left a subtler bug: the scatter is WIDEST while the arc
 *  is faintest, because the two share this curve (see ARC_JITTER), so the most
 *  interesting part of the forming happened below the visible floor and only
 *  its tail ever reached the screen. 1.6 lifts the arc into view early enough
 *  to watch it converge, and still leaves nothing at all the instant a shot
 *  goes. */
const ARC_RETURN_K = 1.6;
/** Blinks per cooldown, and how hard they bunch toward ready. A COUNT rather
 *  than a rate is what lets one constant serve every cooldown the game can
 *  produce (level.ts's 1350ms, the Magazine track's −15% a tier, congestion's
 *  live scale): the cycle always fits the same beats, so a faster reload IS a
 *  faster blink with no second number to keep in sync. */
const ARC_BLINKS = 3;
const ARC_BLINK_K = 2.5;
/** How much of the arc's alpha a blink swings. Shallow on purpose: by the time
 *  the blink is fast the arc is also the aim, and one that vanished on every
 *  downbeat would cost the player the shot they are lining up. */
const ARC_BLINK_DEPTH = 0.45;
/** Scatter of the FAR end of the arc, in world px — CELL is 40, so two thirds
 *  of a cube at its widest, on the frame after a shot.
 *  Driven by the INVERSE of the clarity curve rather than a decay of its own:
 *  the two are one statement — the less of the arc there is, the less it is
 *  sure of — and sharing the curve means the scatter reaches exactly zero at
 *  ready, with no second constant to tune and nothing to snap. Tapered along
 *  the arc as well: a solution converges from its far tip backwards, so the
 *  muzzle end moves least. */
const ARC_JITTER = 26;
/** Re-rolls a second. Per-frame would be 60Hz static — noise, not hardware;
 *  this is slow enough to read as a solution being re-tried. */
const ARC_JITTER_HZ = 18;
/** What the muzzle end keeps of the scatter. Not zero: a first dot nailed to
 *  the barrel while the rest of the arc swims reads as a hinge, and it is the
 *  whole solution that is unsure, not only its tail. Low enough that the taper
 *  is still what you see. */
const ARC_JITTER_BASE = 0.3;

/** Deterministic ±1 from (dot, time step, axis) — an integer hash rather than
 *  Math.random() so a paused frame redraws identically instead of crawling,
 *  and so nothing in the renderer consumes randomness the sim could want. */
function arcJitter(i: number, step: number, axis: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(step, 668265263) + Math.imul(axis, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 8) / 8388608 - 1;
}

function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  pts: Matter.Vector[],
  reload: number,
  now: number,
): void {
  if (pts.length < 2) return;
  // Reduced motion keeps the RAMP and drops the BLINK and the JITTER. The
  // three are not the same kind of thing: a brightness that tracks the
  // cooldown is information, and holds still to be read; the other two are
  // motion, which is the whole of what the preference asks about (same split
  // the rest of the app makes — see app.css's prefers-reduced-motion blocks).
  const calm = reload >= 1 || prefersReducedMotion();
  const clarity = reload >= 1 ? 1 : expRamp(reload, ARC_RETURN_K);
  const osc = calm
    ? 1
    : 0.5 + 0.5 * Math.cos(2 * Math.PI * ARC_BLINKS * expRamp(reload, ARC_BLINK_K));
  const cue = clarity * (1 - ARC_BLINK_DEPTH * (1 - osc));
  // Fully gone for the first beats of the cooldown — skip the loop rather than
  // stamp ~16 invisible sprites a frame.
  if (cue < 0.004) return;

  const jitter = calm ? 0 : ARC_JITTER * (1 - clarity);
  const step = Math.floor((now * ARC_JITTER_HZ) / 1000);
  const sprite = getDotSprite();
  ctx.save();
  for (let i = 0; i < pts.length; i += 3) {
    const t = i / pts.length;
    ctx.globalAlpha = (0.9 * (1 - t) + 0.15) * cue;
    // Scale the baked disc (radius DOT_R + its glow) to this dot's radius.
    const half = (DOT_R + DOT_PAD) * ((4 * (1 - t) + 2) / DOT_R);
    const spread = jitter * (ARC_JITTER_BASE + (1 - ARC_JITTER_BASE) * t);
    const jx = jitter ? arcJitter(i, step, 0) * spread : 0;
    const jy = jitter ? arcJitter(i, step, 1) * spread : 0;
    ctx.drawImage(sprite, pts[i].x + jx - half, pts[i].y + jy - half, half * 2, half * 2);
  }
  ctx.restore();
}

/** Loaded-piece "ghost" scale relative to CELL — small enough to not dominate the view. */
const GHOST_SCALE = 0.55;
/** Ghost piece opacity — see-through enough to read as a preview, not a real piece. */
const GHOST_ALPHA = 0.45;

/** One full breath of the material telegraph, ms. Matches the belt tiles'
 *  `mat-aura` (app.css) so the two previews of the same shipment pulse
 *  together — two glows on the same cargo at different rates would read as two
 *  unrelated warnings. */
const GHOST_AURA_MS = 1150;
/** Blur the aura sprite is baked at, world-px — wide enough to read as a halo
 *  around the cube rather than a fatter cube. The piece's own baked glow stays
 *  at 12; this rides under it. */
const GHOST_AURA_BLUR = 30;
/** World-px margin the aura sprite needs so its own blur is not clipped by the
 *  sprite's edge. GHOST_CELL_PAD (15) is sized for the 12px cell glow and is
 *  not enough for this one. */
const GHOST_AURA_PAD = 34;
/** Peak opacity of the aura stamp, under the piece. Well below GHOST_ALPHA:
 *  the ghost has to stay a preview, and a halo that competes with the cargo
 *  it rings is just a brighter piece. */
const GHOST_AURA_ALPHA = 0.5;

/**
 * Draw the currently loaded piece, semi-transparent, at the cannon's muzzle in
 * its current orientation — so aiming shows the real world-space rotation the
 * player will fire. Uses the same pieceOffsets helper as pieces.ts
 * createTetrisPiece (centroid-anchored rotation), scaled down by GHOST_SCALE
 * so it reads as a preview rather than a real piece. When the level's bomb
 * cadence means the NEXT shot is a bomb, the piece ghost is swapped for a
 * small ghost bomb — the muzzle preview must promise what actually fires.
 *
 * MATERIAL. The ghost used to colour straight from PIECE_COLORS, which made it
 * the one preview of a shipment that did not say what the shipment was made
 * of: a cryo L was drawn plain orange at the muzzle while the belt tile a
 * thumb away showed it pale blue. theme.ts's shipmentColor names this surface
 * as one of the three that have to agree; now it does. A non-standard
 * shipment also gets the same breathing aura the belt tiles carry, because the
 * muzzle is where the player is looking while they aim, and "what am I about
 * to fire" is the question the ghost exists to answer.
 */
function drawLoadedPiece(
  ctx: CanvasRenderingContext2D,
  cannon: Cannon,
  size: PieceSize,
  nextIsBomb: boolean,
  now: number,
): void {
  const tip = cannon.tip;

  if (nextIsBomb) {
    const r = CELL * GHOST_SCALE * 0.9;
    ctx.save();
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.shadowColor = "#ff2d55";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#1b1b2e";
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff2d55";
    ctx.stroke();
    ctx.restore();
    return;
  }

  const material = cannon.currentMaterial;
  const color = shipmentColor(cannon.currentType, material);
  const offsets = pieceOffsets(cannon.currentType, cannon.pieceRotation, size);
  const cell = CELL * GHOST_SCALE;
  const h = cell / 2;
  const box = cell + GHOST_CELL_PAD * 2;
  // One stamp per cube of the piece. `pad` is the sprite's own glow margin, so
  // the two sprites below can carry different blur radii and still land their
  // cells on the same centres.
  const stamp = (sprite: CanvasImageSource, pad: number): void => {
    const w = cell + pad * 2;
    for (const { x: ox, y: oy } of offsets) {
      ctx.drawImage(
        sprite,
        tip.x + ox * GHOST_SCALE - h - pad,
        tip.y + oy * GHOST_SCALE - h - pad,
        w, w,
      );
    }
  };

  ctx.save();

  // The material telegraph, stamped UNDER the ghost: the same silhouette baked
  // at a much wider blur, breathing on GHOST_AURA_MS. Two sprites rather than
  // one re-baked per frame — getSprite caches by key, and a blur radius that
  // changed with the pulse would miss the cache on every single frame and
  // re-run five gaussian fills for the privilege. The pulse rides globalAlpha
  // instead, which costs nothing.
  if (material !== "standard") {
    const aura = shipmentAura(cannon.currentType, material);
    const auraBox = cell + GHOST_AURA_PAD * 2;
    const glow = getSprite(`ghostAura|${aura}`, auraBox, auraBox, (c) => {
      c.shadowColor = aura;
      c.shadowBlur = GHOST_AURA_BLUR;
      c.fillStyle = aura;
      roundRect(c, GHOST_AURA_PAD, GHOST_AURA_PAD, cell, cell, 4);
      c.fill();
    });
    // 0..1..0 over one breath, sine-eased so neither end snaps.
    const t = (now % GHOST_AURA_MS) / GHOST_AURA_MS;
    ctx.globalAlpha = GHOST_AURA_ALPHA * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    stamp(glow, GHOST_AURA_PAD);
  }

  // One glowing cell per color, baked (the ghost is on screen whenever the
  // cannon is loaded — this was up to five live glow fills every frame).
  // Baked opaque; GHOST_ALPHA fades the stamp, glow included.
  const sprite = getSprite(`ghost|${color}`, box, box, (c) => {
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.fillStyle = color;
    roundRect(c, GHOST_CELL_PAD, GHOST_CELL_PAD, cell, cell, 4);
    c.fill();
  });
  ctx.globalAlpha = GHOST_ALPHA;
  stamp(sprite, GHOST_CELL_PAD);
  ctx.restore();
}

/** World-px margin for a ghost cell's 12px glow. */
const GHOST_CELL_PAD = 15;

/** Power buckets the barrel sprite is quantized to. The live color is a
 *  smooth lerp of the power ratio; 24 steps keeps adjacent buckets within a
 *  couple of RGB units of each other — beneath notice mid-drag, and it bounds
 *  the sprite cache at 48 entries (24 buckets × aiming on/off). */
const BARREL_BUCKETS = 24;
const BARREL_PAD = 26; // world-px margin for the aiming glow (22) + slack

function getBarrelSprite(bucket: number, aiming: boolean): HTMLCanvasElement {
  const w = CANNON.barrel + 8 + BARREL_PAD * 2;
  const h = 28 + BARREL_PAD * 2;
  return getSprite(`barrel|${bucket}|${aiming ? "a" : "r"}`, w, h, (ctx) => {
    const ratio = bucket / (BARREL_BUCKETS - 1);
    const color = `rgb(${Math.round(150 + 105 * ratio)}, ${Math.round(220 - 120 * ratio)}, 90)`;
    ctx.shadowColor = color;
    ctx.shadowBlur = aiming ? 22 : 12;
    ctx.fillStyle = color;
    roundRect(ctx, BARREL_PAD, BARREL_PAD, CANNON.barrel + 8, 28, 8);
    ctx.fill();
  });
}

function getCannonBaseSprite(): HTMLCanvasElement {
  const side = CANNON.size + BARREL_PAD * 2;
  return getSprite("cannon-base", side, side, (ctx) => {
    const c = side / 2;
    ctx.shadowColor = COLORS.aim;
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#1b1b2e";
    ctx.beginPath();
    ctx.arc(c, c, CANNON.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.aim;
    ctx.stroke();
  });
}

function drawCannon(
  ctx: CanvasRenderingContext2D,
  cannon: Cannon,
  aiming: boolean,
  settling = false,
): void {
  ctx.save();
  // Settle window: the cannon is locked out (game.ts's shoot() refuses), so it
  // reads as powered down rather than sitting there looking loaded.
  if (settling) ctx.globalAlpha = 0.35;

  // Barrel — baked per quantized power color (see BARREL_BUCKETS), rotated at
  // draw time exactly like the cube sprites are.
  const bucket = Math.round(cannon.powerRatio * (BARREL_BUCKETS - 1));
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  ctx.rotate(-cannon.angle);
  ctx.drawImage(
    getBarrelSprite(bucket, aiming),
    -BARREL_PAD,
    -14 - BARREL_PAD,
    CANNON.barrel + 8 + BARREL_PAD * 2,
    28 + BARREL_PAD * 2,
  );
  ctx.restore();

  // Base
  ctx.drawImage(
    getCannonBaseSprite(),
    cannon.x - CANNON.size / 2 - BARREL_PAD,
    cannon.y - CANNON.size / 2 - BARREL_PAD,
    CANNON.size + BARREL_PAD * 2,
    CANNON.size + BARREL_PAD * 2,
  );

  // Slingshot pull band while aiming
  if (aiming) {
    const tip = cannon.tip;
    ctx.save();
    ctx.strokeStyle = COLORS.aim;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cannon.x, cannon.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Launch cooldown, drawn as an arc sweeping around the cannon base: empty the
 * instant a shot fires, closing to a full ring as the loader finishes. The
 * player's attention is on the cannon while aiming the next shot, so THIS is
 * where "can I fire yet" belongs — the plant panel's reload bar (see
 * ui/screens.ts's .pl-load) carries the same value for peripheral vision, but
 * this is the one you actually read mid-aim. Hidden once fully reloaded so a
 * ready cannon isn't wearing a permanent decoration.
 */
const RELOAD_RING_R = CANNON.size / 2 + 9;

function drawReloadRing(ctx: CanvasRenderingContext2D, cannon: Cannon, reload: number): void {
  if (reload >= 1) return;
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  // Track.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = COLORS.textDim;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, RELOAD_RING_R, 0, Math.PI * 2);
  ctx.stroke();
  // Filled portion, starting at 12 o'clock and sweeping clockwise. Warm amber
  // while loading (it reads as "wait"), snapping to the aim cyan at the very
  // end so the moment it becomes fireable is visible in peripheral vision.
  // The glow is a wide translucent under-stroke rather than shadowBlur: the
  // arc length changes every frame, so this can't be baked like the static
  // chrome, and a live Gaussian pass 60×/s is exactly what this pass removes.
  const col = reload > 0.92 ? COLORS.aim : "#ffb020";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, RELOAD_RING_R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reload);
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = col;
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// FX layer — pure functions of (event, now). No mutable per-event state and
// no per-frame randomness (that would flicker): any "random-looking" spread
// (shard fling angles, spark placement) is derived from a fixed hash of the
// event's spawn position, so a given event always draws identically at a
// given `now`.
// ---------------------------------------------------------------------------

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Deterministic per-event angle offset (radians) so shard/spark fans don't
 *  all point the same way, without touching Math.random. */
function seedAngle(x: number, y: number): number {
  const seed = (x * 13 + y * 7) | 0;
  return (((seed % 360) + 360) % 360) * (Math.PI / 180);
}

/** Shatter (700ms): 7 shards flung outward from the cube's last position,
 *  plus a bright core flash for the first 120ms. */
const SHATTER_SHARD_COUNT = 7;
const SHATTER_FLING_DIST = 34;
const SHATTER_SHARD_SIZE = 5;
const SHATTER_SHARD_GLOW = 10;
const SHATTER_SPIN = Math.PI / 2;
const SHATTER_CORE_MS = 120;
const SHATTER_CORE_R = 10;

function drawShatterFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "shatter" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.shatter);
  if (t >= 1) return;

  const base = seedAngle(e.x, e.y);
  const dist = easeOutCubic(t) * SHATTER_FLING_DIST;
  const size = SHATTER_SHARD_SIZE * (1 - t);

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalAlpha = 1 - t;
  if (size > 0) {
    // One baked glowing shard per color, stamped scaled+rotated. A multi-row
    // clear spawns dozens of shatter events at once — 7 live glow fills each
    // was a couple hundred Gaussian passes in the exact frame the payout
    // logic is also busiest, i.e. the frame most likely to tip a full bay
    // into catch-up (see main.ts's MAX_CATCHUP_STEPS note).
    const pad = SHATTER_SHARD_SIZE * 2.4; // covers the 10px glow at bake scale
    const side = SHATTER_SHARD_SIZE + pad * 2;
    const sprite = getSprite(`shard|${e.color}`, side, side, (c) => {
      c.shadowColor = e.color;
      c.shadowBlur = SHATTER_SHARD_GLOW;
      c.fillStyle = e.color;
      c.fillRect(pad, pad, SHATTER_SHARD_SIZE, SHATTER_SHARD_SIZE);
    });
    const drawSide = side * (size / SHATTER_SHARD_SIZE);
    for (let i = 0; i < SHATTER_SHARD_COUNT; i++) {
      const angle = base + i * ((Math.PI * 2) / SHATTER_SHARD_COUNT);
      ctx.save();
      ctx.translate(Math.cos(angle) * dist, Math.sin(angle) * dist);
      ctx.rotate(angle + t * SHATTER_SPIN);
      ctx.drawImage(sprite, -drawSide / 2, -drawSide / 2, drawSide, drawSide);
      ctx.restore();
    }
  }

  if (elapsed >= 0 && elapsed < SHATTER_CORE_MS) {
    const coreT = elapsed / SHATTER_CORE_MS;
    ctx.save();
    ctx.globalAlpha = 1 - coreT;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, SHATTER_CORE_R * (1 - coreT), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Payout (1100ms): "+$amount" rising and fading over the cluster. */
const PAYOUT_RISE_PX = 48;
const PAYOUT_FADE_IN_MS = 80;
const PAYOUT_FADE_OUT_MS = 350;
const PAYOUT_CLAMP_MARGIN = 80;
const PAYOUT_FONT = "700 30px system-ui, sans-serif";
const PAYOUT_GLOW = 16;

function drawPayoutFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "payout" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.payout);
  if (t >= 1) return;

  const x = Math.min(Math.max(e.x, PAYOUT_CLAMP_MARGIN), WORLD.width - PAYOUT_CLAMP_MARGIN);
  const y = e.y - easeOutCubic(t) * PAYOUT_RISE_PX;

  let alpha: number;
  if (elapsed < PAYOUT_FADE_IN_MS) {
    alpha = elapsed / PAYOUT_FADE_IN_MS;
  } else if (elapsed > FX_TTL.payout - PAYOUT_FADE_OUT_MS) {
    alpha = (FX_TTL.payout - elapsed) / PAYOUT_FADE_OUT_MS;
  } else {
    alpha = 1;
  }
  alpha = clamp01(alpha);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.trajectory;
  ctx.shadowColor = COLORS.trajectory;
  ctx.shadowBlur = PAYOUT_GLOW;
  ctx.font = PAYOUT_FONT;
  ctx.textAlign = "center";
  ctx.fillText(`+$${e.amount}`, x, y);
  ctx.restore();
}

/** Salvage refund (1100ms): the funds a demolition charge paid back, rising
 *  from the blast. Same motion as a payout so it reads as income, but in the
 *  warn amber of the demolition kit rather than the payout green — at a glance
 *  the player can tell "a line sold" from "I sold scrap metal", which is the
 *  whole reason bombs refund instead of silently topping up the bankroll. */
const SALVAGE_COLOR = "#ffb020";

function drawSalvageFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "salvage" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.salvage);
  if (t >= 1) return;

  const x = Math.min(Math.max(e.x, PAYOUT_CLAMP_MARGIN), WORLD.width - PAYOUT_CLAMP_MARGIN);
  const y = e.y - easeOutCubic(t) * PAYOUT_RISE_PX;
  const alpha = clamp01(elapsed < PAYOUT_FADE_IN_MS ? elapsed / PAYOUT_FADE_IN_MS : 1 - t * t);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SALVAGE_COLOR;
  ctx.shadowColor = SALVAGE_COLOR;
  ctx.shadowBlur = PAYOUT_GLOW;
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`♻ +$${e.amount}`, x, y);
  ctx.restore();
}

/** Lost-cargo penalty (1100ms): "−$amount" SINKING from where the cubes
 *  blinked out, in the compactor's own red. The deliberate mirror of a payout:
 *  income rises green, an expense sinks red, so the two money verbs are
 *  distinguishable before the number is even read. Same fade envelope as the
 *  payout so the pair read as one family. */
const PENALTY_SINK_PX = 34;

function drawPenaltyFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "penalty" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL.penalty);
  if (t >= 1) return;

  const x = Math.min(Math.max(e.x, PAYOUT_CLAMP_MARGIN), WORLD.width - PAYOUT_CLAMP_MARGIN);
  const y = e.y + easeOutCubic(t) * PENALTY_SINK_PX;

  let alpha: number;
  if (elapsed < PAYOUT_FADE_IN_MS) {
    alpha = elapsed / PAYOUT_FADE_IN_MS;
  } else if (elapsed > FX_TTL.penalty - PAYOUT_FADE_OUT_MS) {
    alpha = (FX_TTL.penalty - elapsed) / PAYOUT_FADE_OUT_MS;
  } else {
    alpha = 1;
  }
  alpha = clamp01(alpha);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.compactor;
  ctx.shadowColor = COLORS.compactor;
  ctx.shadowBlur = PAYOUT_GLOW;
  ctx.font = "700 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`−$${e.amount}`, x, y);
  ctx.restore();
}

/** Bay cleared (1400ms): a bright band sweeping the field left-to-right plus an
 *  expanding ring, spawned once when the settle window resolves (game.ts's
 *  resolveWin). Deliberately a CANVAS effect rather than only a DOM banner: the
 *  moment belongs to the field the player just filled, so the celebration
 *  should wash over the pile itself before the ui/screens.ts banner and the
 *  draft modal take the screen. Additive, inside its own save/restore. */
const BAYCLEAR_BAND_W = 240;

function drawBayClearFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "bayclear" }>,
  now: number,
): void {
  const t = clamp01((now - e.t0) / FX_TTL.bayclear);
  if (t >= 1) return;
  const eased = easeOutCubic(t);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Sweeping band.
  const cxBand = -BAYCLEAR_BAND_W + eased * (WORLD.width + BAYCLEAR_BAND_W * 2);
  const grad = ctx.createLinearGradient(cxBand - BAYCLEAR_BAND_W, 0, cxBand + BAYCLEAR_BAND_W, 0);
  grad.addColorStop(0, "rgba(0,255,156,0)");
  grad.addColorStop(0.5, `rgba(0,255,156,${0.5 * (1 - t)})`);
  grad.addColorStop(1, "rgba(0,255,156,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  // Expanding ring at the event point.
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = COLORS.trajectory;
  ctx.shadowColor = COLORS.trajectory;
  ctx.shadowBlur = 24;
  ctx.lineWidth = 8 * (1 - t) + 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, 60 + eased * 380, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Rowflash (450ms): the cleared row band, bright toward the wall it just
 *  got crushed into. Drawn additively ("lighter") so it blooms rather than
 *  paints a flat white bar; that GCO is scoped to this function's own
 *  save/restore, never leaking into siblings drawn after it. */
const ROWFLASH_EDGE_ALPHA = 0.9;

function drawRowFlashFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "rowflash" }>,
  now: number,
): void {
  const t = clamp01((now - e.t0) / FX_TTL.rowflash);
  if (t >= 1) return;

  const left = Math.min(e.x0, e.x1);
  const width = Math.abs(e.x1 - e.x0);
  if (width <= 0) return;

  const grad = ctx.createLinearGradient(e.x0, 0, e.x1, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, `rgba(255,255,255,${ROWFLASH_EDGE_ALPHA})`);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = (1 - t) * (1 - t);
  ctx.fillStyle = grad;
  ctx.fillRect(left, e.y - CELL / 2, width, CELL);
  ctx.restore();
}

/** Explosion (600ms): expanding ring + brief white flash + orbiting sparks. */
const EXPLOSION_RING_COLOR = "#ffb347";
const EXPLOSION_RADIUS_BASE_FRAC = 0.25;
const EXPLOSION_RADIUS_GROWTH_FRAC = 0.95;
const EXPLOSION_LINEWIDTH_MAX = 10;
const EXPLOSION_LINEWIDTH_MIN = 2;
const EXPLOSION_FLASH_T = 0.25;
const EXPLOSION_FLASH_RADIUS_FRAC = 0.5;
const EXPLOSION_SPARK_COUNT = 6;
const EXPLOSION_SPARK_RADIUS = 3;
const EXPLOSION_SPARK_GLOW = 12;

function drawExplosionFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "explosion" }>,
  now: number,
): void {
  const t = clamp01((now - e.t0) / FX_TTL.explosion);
  if (t >= 1) return;

  const radius = e.r * (EXPLOSION_RADIUS_BASE_FRAC + EXPLOSION_RADIUS_GROWTH_FRAC * easeOutCubic(t));

  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = EXPLOSION_RING_COLOR;
  // Halo as a wide translucent under-stroke — the ring's radius grows every
  // frame, so like the reload ring this can't bake, and shadowBlur 28 on a
  // field-sized arc was the single widest live blur in the game.
  const ringW = EXPLOSION_LINEWIDTH_MAX * (1 - t) + EXPLOSION_LINEWIDTH_MIN;
  ctx.beginPath();
  ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.3;
  ctx.lineWidth = ringW + 14;
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = ringW;
  ctx.stroke();

  if (t < EXPLOSION_FLASH_T) {
    ctx.save();
    ctx.globalAlpha = 1 - t / EXPLOSION_FLASH_T;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * EXPLOSION_FLASH_RADIUS_FRAC * (1 - t / EXPLOSION_FLASH_T), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const base = seedAngle(e.x, e.y);
  ctx.globalAlpha = 1 - t;
  // Baked glowing disc, one per (fixed) spark color — same trade as shards.
  const sparkPad = EXPLOSION_SPARK_RADIUS + EXPLOSION_SPARK_GLOW;
  const sparkSide = EXPLOSION_SPARK_RADIUS * 2 + sparkPad * 2;
  const spark = getSprite("spark", sparkSide, sparkSide, (c) => {
    c.shadowColor = EXPLOSION_RING_COLOR;
    c.shadowBlur = EXPLOSION_SPARK_GLOW;
    c.fillStyle = EXPLOSION_RING_COLOR;
    c.beginPath();
    c.arc(sparkSide / 2, sparkSide / 2, EXPLOSION_SPARK_RADIUS, 0, Math.PI * 2);
    c.fill();
  });
  const sparkDraw = sparkSide * (1 - t);
  for (let i = 0; i < EXPLOSION_SPARK_COUNT; i++) {
    const angle = base + i * ((Math.PI * 2) / EXPLOSION_SPARK_COUNT);
    const sx = e.x + Math.cos(angle) * radius;
    const sy = e.y + Math.sin(angle) * radius;
    ctx.drawImage(spark, sx - sparkDraw / 2, sy - sparkDraw / 2, sparkDraw, sparkDraw);
  }
  ctx.restore();
}

/** Draw all live FX events on top of the settled field. Pure function of
 *  (effects, now): every sub-drawer derives its progress from `now - t0`
 *  and a position-derived hash, so nothing here holds state across frames. */
function drawEffects(ctx: CanvasRenderingContext2D, effects: FxEvent[], now: number): void {
  ctx.save();
  for (const e of effects) {
    switch (e.kind) {
      case "shatter":
        drawShatterFx(ctx, e, now);
        break;
      case "payout":
        drawPayoutFx(ctx, e, now);
        break;
      case "rowflash":
        drawRowFlashFx(ctx, e, now);
        break;
      case "explosion":
        drawExplosionFx(ctx, e, now);
        break;
      case "salvage":
        drawSalvageFx(ctx, e, now);
        break;
      case "penalty":
        drawPenaltyFx(ctx, e, now);
        break;
      case "bayclear":
        drawBayClearFx(ctx, e, now);
        break;
    }
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
