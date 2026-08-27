import Matter from "matter-js";
import { CELL, SKY, WORLD } from "./engine";
import { CHUTE, chuteMouth, chuteRightEdge } from "./chute";
import { BASE_BREAK_STRETCH } from "./level";
import { computeLayout, skyTop } from "./layout";
import {
  BAY_GLYPH_MATERIALS, COLORS, glyphInk, MATERIAL_GLYPH, PIECE_COLORS,
  shade, shipmentAura, shipmentColor,
  type Material, type PieceSize, type PieceType,
} from "./theme";
import { pieceOffsets, type Cube } from "./pieces";
import type { Compactor } from "./compactor";
import { Cannon, CANNON } from "./cannon";
import { blinkVisible } from "./lineClear";
import type { LevelConfig } from "./level";
import { FX_TTL, type FxEvent, PENALTY_SINK_PX } from "./fx";

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
  /** game.ts's trajectoryStrands — the current aim ends somewhere the bay can
   *  never use (down the intake chute, or short of the compactor's reach).
   *  Turns the arc red, lights the chute's mouth, and rings the muzzle.
   *
   *  Every one of those is on the CANVAS, which is the requirement rather than
   *  an implementation detail: the warning is about a shot heading for the
   *  bottom-left, and the bottom-left is exactly where the opaque plant panel
   *  sits over the field. A DOM cue would be hidden by the thing it is warning
   *  about. */
  strandWarning: boolean;
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
 * the world clip after the backdrop and before the compactor, so cargo, the
 * press and the cannon all sit on top of it.
 *
 * WHERE IT DRAWS FROM, and why it moved. Up to 18 of these bands cover the
 * full width of the field, so painting them live meant blending roughly a
 * whole canvas of translucent device pixels every frame: measured on
 * sim/renderperf at N=300, 11.1ms of a 31.4ms frame — second only to the cargo
 * itself, and more than the backdrop, press, cannon, seams, arc and effects
 * put together. Baking the strips into sprites and stamping them changed
 * nothing, which is the useful result: the cost is fill rate, not the
 * gradients, and the only way to stop paying it every frame is to stop
 * painting it every frame.
 *
 * So it paints into the background layer instead, at the end of that bake —
 * the same place in the z-order it occupied when it ran live, because it ran
 * first, immediately after that layer was blitted. The layer already covers
 * every device pixel and is already stamped once per frame, so these rows now
 * cost nothing between changes. What makes that safe is that the state is
 * coarse: congestionRows moves `lit` one row per line's worth of cubes, so the
 * layer re-bakes when the pile crosses a multiple of a line and not otherwise.
 */
interface CongestionRows {
  lit: number;
  warnRow: number;
  dangerRow: number;
}

/**
 * How many floor rows are lit, and where the two tiers start biting. Split out
 * of the drawing so the background layer can key its cache on it — see
 * getBackgroundLayer, which is where these rows are actually painted now.
 *
 * `lit` moves in steps of one row per `perLine` cubes, which is what makes
 * baking them viable: the state only changes when the pile crosses a multiple
 * of a line, a few times a second at worst, not every frame.
 */
function congestionRows(scene: Scene): CongestionRows | null {
  const tiers = scene.level.pileTiers;
  if (!tiers.length || !scene.cubes.length) return null;
  const perLine = Math.max(1, scene.level.compactorMinLineCells);
  const allowance = scene.level.pileAllowance;
  const maxRows = Math.floor(WORLD.height / CELL);
  const lit = Math.min(maxRows, Math.ceil(scene.cubes.length / perLine));
  // The row index at which each tier starts biting. `> t.cubes + allowance`
  // is game.ts's own test, so the first taxed cube is t.cubes + allowance + 1
  // and the row holding it is that count divided by a line.
  const rowFor = (t: { cubes: number }): number =>
    Math.floor((t.cubes + allowance) / perLine);
  return {
    lit,
    warnRow: tiers[0] ? rowFor(tiers[0]) : Infinity,
    dangerRow: tiers[1] ? rowFor(tiers[1]) : Infinity,
  };
}

function drawCongestionRows(ctx: CanvasRenderingContext2D, rows: CongestionRows): void {
  const { lit, warnRow, dangerRow } = rows;

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

  // Backdrop, field gradient, grid, wall glow AND the congestion floor are
  // static between changes of pile height — blit the cached opaque layer
  // instead of re-painting them (no clearRect needed underneath, the layer
  // covers every device pixel).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(getBackgroundLayer(cssW, cssH, dpr, vp, congestionRows(scene)), 0, 0);

  ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.ox * dpr, vp.oy * dpr);
  // Clip to the world rect, OPENED UPWARD to the top of the canvas (layout.ts's
  // skyTop). The world is authored 720 tall but its ceiling is not a wall —
  // engine.ts leaves the top boundary open so a lofted shot can apex ~250 world
  // px above y=0 and fall back in. Clipping at y=0 made those frames a lie:
  // the piece the player just launched vanished at the field's top edge, waited
  // out its arc in a black band, and reappeared. The sides and floor are not
  // opened with it — those are real walls, and cargo that reaches them stops.
  const sky = skyTop(vp.scale, vp.oy);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, sky, WORLD.width, WORLD.height - sky);
  ctx.clip();

  // The plant's intake, under everything: cargo falling in has to draw OVER
  // the mouth it is falling into, and the arc has to draw over both.
  drawChute(ctx, scene.strandWarning, scene.now, chuteRightEdge(scene.compactor.strandCutoffX));
  drawWindIndicator(ctx, scene.level, scene.windNow, scene.windAverage);
  drawCompactor(ctx, scene.compactor);
  drawPistons(ctx, scene.compactor);
  for (const cube of scene.cubes) drawCube(ctx, cube, scene.now);
  // Over the cubes, not under: a seam between adjacent cubes is covered by the
  // very cubes it joins, so drawing it underneath draws nothing.
  drawJointSeams(ctx, scene.constraints);
  for (const bomb of scene.bombs) drawBomb(ctx, bomb);
  drawTrajectory(ctx, scene.trajectory, scene.reload, scene.now, scene.strandWarning);
  // Drawn AFTER the cannon: the barrel is opaque and longer than its visual
  // tip, and previously painted over ghost cells at some aim angles.
  drawCannon(ctx, scene.cannon, scene.aiming, scene.settling);
  drawReloadRing(ctx, scene.cannon, scene.reload);
  drawStrandRing(ctx, scene.cannon, scene.strandWarning && scene.aiming, scene.now);
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

/**
 * World-px margin a cube sprite is BAKED with, before trimToInk hands back the
 * part of it that has ink in it. The widest blur used is 22 device px (cold
 * cryo), which at the minimum bake scale of 1 (see syncSpriteScale) spills 33
 * world px past the shape — canvas shadowBlur reaches 1.5x its value before
 * alpha hits zero, measured across blur 10/16/22/26 at bake scales 1/1.5/2/3 —
 * plus the 1.25px of edge-highlight stroke outside the cube's face. 26 does
 * not cover that worst case and never did; it is left exactly as it is,
 * because widening it would change what a cold cryo cube looks like at bake
 * scale 1 and this pass is not the place to make that call.
 *
 * What it is NOT any more is what every cube blits. It is only the canvas the
 * bake gets to grow into. That distinction is the biggest single lever in the
 * renderer, because a cube sprite is stamped once per cube per frame and what
 * it costs is its AREA: sim/renderperf measures cargo at 85% of a 300-cube
 * frame's draw cost (37.5ms of 44.1ms), and at a flat 26 the transparent
 * margin was 5.3x the area of the cube inside it.
 */
const SPRITE_PAD = 26;

/**
 * How many rows of KNOWN-TRANSPARENT margin trimToInk leaves around the ink.
 *
 * Two, and the number is measured rather than cautious. drawCube stamps a
 * sprite through a rotated, very slightly non-1:1 drawImage, so the rasteriser
 * filters it, and a filter kernel reads pixels just outside the ones it lands
 * on. Cropping flush to the ink puts the sprite's own edge inside that kernel
 * and changes what the outermost ink pixels blend against. Diffed against the
 * untrimmed frame at N=300: flush to the ink is ~430k pixels out by up to
 * 43/255, one guard row is ~1.2k out by 1, and two rows reach the floor below.
 * Three and four rows measure the same as two, so the extra margin buys
 * nothing and is not taken.
 */
const INK_GUARD = 2;

/**
 * Trim a freshly baked sprite to the pixels that actually carry ink, and hand
 * back the canvas to stamp plus the world extent to stamp it at.
 *
 * WHY MEASURE RATHER THAN DERIVE. The margin only has to hold the glow, and a
 * glow's reach in WORLD px falls as the bake scale rises: shadowBlur is
 * specified in device pixels and the spec exempts it from the CTM, so the same
 * blur covers a third as much world at 3x as at 1x. Computing a per-sprite pad
 * from the blur was tried first and it does shrink the sprites — but every
 * distinct pad rounds makeSpriteCanvas's ceil differently, which moves the
 * effective bake scale a fraction of a percent and re-rasterises the cube's
 * FACE against a different sub-pixel grid. That came to ~430k pixels of
 * difference at N=300: all of it antialiasing on neon edges, none of it
 * clipped glow, and none of it anything a change billed as invisible should
 * be doing.
 *
 * Cropping has neither problem. The pixels are the ones the old bake produced,
 * untouched; the crop is symmetric and lands on whole device pixels; and the
 * world extent handed back is the cropped device size divided by the scale the
 * bake ACTUALLY ran at, so the source-to-destination ratio drawCube stamps
 * with is the ratio it stamped before and every source pixel lands where it
 * landed. What goes away is margin whose alpha is zero, and source-over with
 * zero alpha is the identity — so the frame is the same frame, simply smaller
 * to draw.
 *
 * NOT bit-for-bit, and the honest number matters more than the round claim:
 * `half` is a different float than the constant it replaced, so the stamped
 * quad's device-space corners round differently in the last place. Measured
 * against the untrimmed frame at N=300, that is ~650 of 3,686,400 pixels
 * (0.018%) differing by 1/255, with a handful at 4. It does not fall further
 * with a wider guard, so that is the floor of the technique rather than a
 * setting left untuned. sim/renderperf --snapshot is what holds it there: a
 * change that clips a glow does not land in that range, it lands in the range
 * the note above records for a flush crop.
 *
 * The scan is per BAKE — a few dozen sprites over a run, each a few tens of
 * thousands of pixels — so it never lands in a frame.
 */
function trimToInk(ctx: CanvasRenderingContext2D, worldW: number): {
  canvas: HTMLCanvasElement;
  half: number;
} {
  const src = ctx.canvas;
  const { width: w, height: h } = src;
  // The scale the bake ACTUALLY ran at: the ceiled backing size over the world
  // box, not spritePxScale — see makeSpriteCanvas for why those differ. Every
  // world number below divides by this one.
  const baked = w / worldW;
  // A readback is the one thing here that can fail on a caller's terms rather
  // than ours (a context that refuses getImageData). The untrimmed sprite is
  // always a correct answer — it is what shipped before this function existed —
  // so a failure costs the optimisation and nothing else. Cargo must draw.
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return { canvas: src, half: worldW / 2 };
  }

  // Walk rings in from the edge until one has ink in it. Symmetric on purpose:
  // drawCube stamps sprites centred on the body, so an off-centre crop would
  // need an offset it has no way to know about.
  const alphaAt = (x: number, y: number): number => data[(y * w + x) * 4 + 3];
  const limit = Math.min(w, h) >> 1;
  let inset = limit;
  outer: for (let i = 0; i < limit; i++) {
    for (let x = i; x < w - i; x++) {
      if (alphaAt(x, i) !== 0 || alphaAt(x, h - 1 - i) !== 0) { inset = i; break outer; }
    }
    for (let y = i; y < h - i; y++) {
      if (alphaAt(i, y) !== 0 || alphaAt(w - 1 - i, y) !== 0) { inset = i; break outer; }
    }
  }
  inset -= INK_GUARD;
  if (inset <= 0) return { canvas: src, half: worldW / 2 };

  const size = w - inset * 2;
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  // A 1:1, integer-offset blit — an exact copy of those device pixels, with no
  // filter anywhere in the path to change one of them.
  out.getContext("2d")!.drawImage(src, inset, inset, size, size, 0, 0, size, size);
  return { canvas: out, half: size / baked / 2 };
}

/** Device pixels per world px the current sprites are baked at; 0 = nothing
 *  baked yet. Clamped to [1, 3]: below 1 the glow would out-spill SPRITE_PAD,
 *  above 3 sprites cost memory with no visible gain. */
let spritePxScale = 0;

/** A baked, ink-trimmed cube face and the world extent it stamps at. The
 *  extent travels WITH the sprite because trimToInk decides it per sprite:
 *  slag carries no glow at all, cold cryo carries the widest one, and the same
 *  face needs less world margin the higher the bake scale climbs. */
interface CubeSprite {
  canvas: HTMLCanvasElement;
  /** Half the sprite's world-px extent. */
  half: number;
}

const cubeSprites = new Map<string, CubeSprite>();
/** Everything ELSE baked at the live scale — compactor bar, piston parts,
 *  cannon, FX shards/sparks, ghost cells — one map, keys prefixed by kind.
 *  These exist for the same reason cubeSprites does: shadowBlur is a full
 *  Gaussian pass per blurred fill, and the chrome here used to pay it every
 *  frame of every bay (the compactor bar alone was a 26px blur over a
 *  ~40x290 rect, plus two piston rigs and the cannon, at 60Hz, forever). */
const miscSprites = new Map<string, HTMLCanvasElement>();
/** Trajectory dot discs, keyed by colour — the arc bakes a green one for a
 *  usable shot and a red one for a shot that strands (see drawTrajectory), and
 *  both are re-baked together when the scale drifts. */
const dotSprites = new Map<string, HTMLCanvasElement>();

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
  dotSprites.clear();
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
/** How much of the cube's half-width the shape-colour frame takes. The interior
 *  keeps ~55% of the cube's AREA, which is the point of the split: material has
 *  no second channel and shape has one (the silhouette), so the channel that is
 *  carrying more information gets the larger region and the glyph. */
const FRAME_PX = 5;

/** Bay glyphs are drawn under full opacity so a single cube is unmistakable but
 *  sixty of them read as surface texture rather than sixty competing icons.
 *  This is the dial to turn if a packed pile feels noisy — not the glyph's
 *  existence, which is load-bearing (theme.ts's MATERIAL_GLYPH). */
const BAY_GLYPH_ALPHA = 0.62;

/** Stamp a material glyph, authored in theme.ts's 24x24 box, centred on a
 *  `size`-wide square whose top-left is (o, o) in the current transform. */
function drawMaterialGlyph(
  ctx: CanvasRenderingContext2D,
  material: Material,
  o: number,
  size: number,
  ink: string,
  alpha: number,
): void {
  const glyph = MATERIAL_GLYPH[material as Exclude<Material, "standard">];
  if (!glyph) return;
  const s = size / 24;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(o, o);
  ctx.scale(s, s);
  const path = new Path2D(glyph.d);
  if (glyph.stroke === 0) {
    ctx.fillStyle = ink;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = ink;
    ctx.lineWidth = glyph.stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
  }
  ctx.restore();
}

/**
 * One cube face, baked.
 *
 * TWO-TONE. A non-standard cube is drawn as its SHAPE colour framing its
 * MATERIAL colour, with the material's glyph etched on the interior — see
 * theme.ts's MATERIAL_GLYPH for why colour alone stopped being enough. The split
 * matters because the two channels are not equally served: a shipment's TYPE is
 * already legible from its silhouette, so shape colour is redundant and can live
 * in a thin frame, while material has no second channel at all and takes the
 * interior plus the mark.
 *
 * A standard shipment's material colour IS its shape colour, so it falls out of
 * the same code as a plain solid cube — and that is a signal worth having rather
 * than an accident: solid means ordinary, framed means think. That distinction is
 * silhouette-level, so it survives at any size and any colour vision, which is
 * what actually rescues the one collision no hue could fix (volatile against a
 * standard O reads at dE00 3.3 under deuteranopia).
 *
 * `framed` is false for standing-wall cubes: pieces.ts gives them type "O"
 * arbitrarily, for looks, so a frame drawn from that type would be asserting a
 * shipment identity the cube does not have.
 */
function getCubeSprite(
  type: PieceType,
  color: string,
  material: Material,
  framed: boolean,
  slag: boolean,
  cold: boolean,
): CubeSprite {
  const shapeColor = PIECE_COLORS[type];
  // Two-tone only where the two colours actually differ. Standard shipments and
  // blinking cubes (whose colour is overridden wholesale) fall through to the
  // single-colour path that has always been here.
  const twoTone = framed && color !== shapeColor;
  const key = `${type}|${color}|${material}|${framed ? "f" : "u"}|${slag ? "s" : cold ? "c" : "n"}`;
  const hit = cubeSprites.get(key);
  if (hit) return hit;

  const h = CELL / 2;
  const ctx = makeSpriteCanvas(CELL + SPRITE_PAD * 2);
  ctx.translate(SPRITE_PAD + h, SPRITE_PAD + h);
  const dark = shade(color, -70);
  const light = shade(color, 45);

  // Slag is inert, so it does not glow — every live shipment on the field
  // does. Cold cryo glows harder than it will once thawed: the frost is the
  // warning. The glow keeps the MATERIAL colour even on a two-tone cube: it is
  // the channel with no redundancy, so it gets the halo.
  ctx.shadowColor = color;
  ctx.shadowBlur = slag ? 0 : cold ? 22 : 16;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.fillStyle = twoTone ? shapeColor : color;
  ctx.fill();
  ctx.shadowBlur = 0;

  // The material's own region, inset inside the shape-colour frame.
  const io = twoTone ? -h + FRAME_PX : -h;
  const isize = twoTone ? CELL - FRAME_PX * 2 : CELL;
  const ir = twoTone ? 2.5 : 5;
  if (twoTone) {
    roundRect(ctx, io, io, isize, isize, ir);
    ctx.fillStyle = color;
    ctx.fill();
  }

  const bayGlyph = BAY_GLYPH_MATERIALS.includes(material);
  ctx.save();
  roundRect(ctx, io, io, isize, isize, ir);
  ctx.clip();
  if (slag) {
    // Rubble hatching instead of the type pattern — slag has no shipment
    // identity left to advertise, which is precisely its point.
    drawSlagFace(ctx, io, isize, dark, light);
  } else if (!bayGlyph) {
    // Per-type interior pattern (ported from main.py draw_square_piece).
    // Skipped where a glyph is about to take the same space: pattern AND mark
    // is busier than either alone, and the mark is the one carrying something
    // the player cannot read anywhere else on a landed cube.
    drawPattern(ctx, type, io, io, isize, dark, light);
  }
  // Frost over whatever the interior holds, so a cryo O still reads as an O.
  // It vanishes the instant the cube thaws — that transition IS the feedback
  // that the strike landed, and the row is now completable.
  if (cold) drawFrost(ctx, io, isize);
  ctx.restore();

  if (bayGlyph) {
    drawMaterialGlyph(ctx, material, io, isize, glyphInk(color), BAY_GLYPH_ALPHA);
  }

  ctx.lineWidth = 2.5;
  // The rim belongs to whichever colour owns the cube's outer edge, so a
  // two-tone cube's frame reads as one object rather than as a material-colour
  // hairline sitting on an unrelated band.
  ctx.strokeStyle = twoTone ? shade(shapeColor, 45) : light;
  roundRect(ctx, -h, -h, CELL, CELL, 5);
  ctx.stroke();

  const sprite = trimToInk(ctx, CELL + SPRITE_PAD * 2);
  cubeSprites.set(key, sprite);
  return sprite;
}

/** Trajectory dots are all stamps of one glowing disc scaled 0.5-1.5×. Baked
 *  at the mid radius of the 2..6px range drawTrajectory draws, so scaling
 *  stays near 1:1 and the glow scales with the dot. */
const DOT_R = 4;
const DOT_PAD = 12;

function getDotSprite(color: string): HTMLCanvasElement {
  const hit = dotSprites.get(color);
  if (hit) return hit;
  const ctx = makeSpriteCanvas((DOT_R + DOT_PAD) * 2);
  ctx.translate(DOT_R + DOT_PAD, DOT_R + DOT_PAD);
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, DOT_R, 0, Math.PI * 2);
  ctx.fill();
  dotSprites.set(color, ctx.canvas);
  return ctx.canvas;
}

let bgLayer: HTMLCanvasElement | null = null;
let bgLayerKey = "";

/** Letterbox backdrop + field gradient + grid + glowing walls, composited
 *  once per viewport into an opaque device-resolution layer. Re-baked only
 *  when the canvas size or world placement changes (resize, rotation, dpr
 *  change); every frame in between is a single full-canvas drawImage.
 *
 *  The sky (see layout.ts's skyTop) needs no new cache key: it is a pure
 *  function of vp.scale and vp.oy, both of which are already in the key
 *  below, so any viewport that changes how far up the sky reaches changes the
 *  key that reaches it. */
function getBackgroundLayer(
  cssW: number,
  cssH: number,
  dpr: number,
  vp: Viewport,
  rows: CongestionRows | null,
): HTMLCanvasElement {
  // Same Math.floor sizing as main.ts's onResize gives the live canvas, so
  // the layer maps 1:1 onto it.
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  const key = `${w}x${h}|${vp.scale}|${vp.ox}|${vp.oy}|` +
    (rows ? `${rows.lit}:${rows.warnRow}:${rows.dangerRow}` : "-");
  if (bgLayer && bgLayerKey === key) return bgLayer;

  if (!bgLayer) bgLayer = document.createElement("canvas");
  bgLayer.width = w; // also resets the context's transform
  bgLayer.height = h;
  const bctx = bgLayer.getContext("2d")!;
  bctx.fillStyle = COLORS.bg;
  bctx.fillRect(0, 0, w, h);
  bctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.ox * dpr, vp.oy * dpr);
  const sky = skyTop(vp.scale, vp.oy);
  bctx.save();
  bctx.beginPath();
  bctx.rect(0, sky, WORLD.width, WORLD.height - sky);
  bctx.clip();
  drawBackground(bctx, sky);
  drawWalls(bctx, sky);
  // Over the walls' glow and under everything else, which is exactly where
  // this used to run when it ran live — see the note above drawCongestionRows.
  if (rows) drawCongestionRows(bctx, rows);
  bctx.restore();
  bgLayerKey = key;
  return bgLayer;
}

/**
 * `top` is the world-y the sky reaches (layout.ts's skyTop, <= 0) — the field
 * gradient and the grid are painted from there rather than from 0.
 *
 * The gradient's bright core was ALREADY authored above the field: its inner
 * circle is centred at y=-80, eighty world px over the world's own top edge.
 * Painting only from y=0 meant the field was lit by the outskirts of a glow
 * whose middle nobody ever saw, and the letterbox band above it was flat
 * backdrop — so the brightest part of the scene was the sliver just under the
 * hard edge of a black bar. Filling from `top` puts the core back on screen and
 * the atmosphere reads as depth above the shaft instead of a lid over it.
 *
 * The grid starts at the first CELL multiple at or above `top`, which keeps
 * every line on the same lattice y=0 always sat on — the sky's rows line up
 * with the field's rows, because they are the same rows.
 */
function drawBackground(ctx: CanvasRenderingContext2D, top: number): void {
  const g = ctx.createRadialGradient(
    WORLD.width * 0.5, -80, 80,
    WORLD.width * 0.5, WORLD.height * 0.4, WORLD.width * 0.8,
  );
  g.addColorStop(0, "#161636");
  g.addColorStop(1, "#07070f");
  ctx.fillStyle = g;
  ctx.fillRect(0, top, WORLD.width, WORLD.height - top);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.width; x += CELL) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, WORLD.height);
  }
  for (let y = Math.ceil(top / CELL) * CELL; y <= WORLD.height; y += CELL) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
  }
  ctx.stroke();
}

/**
 * Left/bottom/right glow only — the top is physically open (pieces fly above
 * the frame and fall back in), so the visuals leave the sky open too.
 *
 * What the side rails now do is FOLLOW that sky up. They used to stop at y=2,
 * which is where the drawn field stopped, not where the wall is: engine.ts
 * builds the left and right bodies spanning y=-SKY..H precisely so a lofted
 * shot cannot drift sideways out of the shaft while it is off the top of the
 * field. Ending the neon at the field's top edge drew a shaft that visibly
 * opened out into nothing, while the collider that piece would bounce off ran
 * on for another 600 world px. Clamped to -SKY for the same reason: past there
 * the walls genuinely are absent, and drawing them would be the opposite lie.
 */
function drawWalls(ctx: CanvasRenderingContext2D, top: number): void {
  // No sky: the authored 2px inset, unchanged. Sky: the sky's OWN top edge,
  // not `top + 2`. The stroke is butt-capped, so starting it two world px down
  // would leave a couple of device px of unlit sky above each rail — a
  // hairline gap at the exact edge of the screen, which is the smallest
  // possible version of the lid this change removes.
  const y0 = top < 0 ? Math.max(top, -SKY) : 2;
  ctx.save();
  ctx.strokeStyle = COLORS.aim;
  ctx.shadowColor = COLORS.wallGlow;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2, y0);
  ctx.lineTo(2, WORLD.height - 2);
  ctx.lineTo(WORLD.width - 2, WORLD.height - 2);
  ctx.lineTo(WORLD.width - 2, y0);
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

    ctx.beginPath();
    ctx.rect(x, top, w, h);
    ctx.clip();

    // A USED MACHINE, NOT A NEW ONE. This was clean 45-degree hazard stripes at
    // a flat alpha, which reads as fresh paint on a rental barrier — and the
    // press is the oldest, hardest-working thing in the bay.
    //
    // Everything below is baked into the same per-geometry sprite as the rest
    // of the bar, so it costs nothing per frame, and it is driven by a PRNG
    // seeded off (w, h) rather than Math.random: one bar geometry must always
    // bake the SAME texture, or the press would reshuffle its own rust every
    // time the sprite cache is invalidated.
    let seed = (Math.round(w) * 73856093) ^ (Math.round(h) * 19349663);
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) | 0;
      return ((seed >>> 8) & 0xffffff) / 0xffffff;
    };
    // Snapped to a 2px grid throughout. The game is pixel-art everywhere else
    // (the crest's cubes, the piece cells, the sparkle dots), and rust drawn at
    // sub-pixel positions is a smudge rather than damage.
    const snap = (v: number): number => Math.round(v / 2) * 2;

    // The broken hazard run. Same 34px cadence and 45 degrees as before, but
    // each tick is now a chain of short segments with bites missing, so the
    // stripe reads as worn through rather than painted on.
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#0a0a12";
    for (let y = top - w; y < top + h; y += 34) {
      for (let t = 0; t < w; t += 3) {
        if (rnd() < 0.28) continue;
        ctx.fillRect(snap(x + t), snap(y + t), 3, 5);
      }
    }

    // Grime, first: a sparse dark dither over the whole face. Without it the
    // rust below sits as spots on a showroom finish — the bar reads glossy and
    // the damage reads applied. Knocking the gloss back a few percent first is
    // what makes the patches look like the same surface.
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = "#1a0a10";
    for (let gx = 0; gx < w; gx += 2) {
      for (let gy = 0; gy < h; gy += 2) {
        if (rnd() < 0.22) ctx.fillRect(x + gx, top + gy, 2, 2);
      }
    }

    // Rust. Two tones over the red — a warm oxide and a dark pit — in blocks
    // biased toward the bar's edges, which is where a press actually wears.
    const patches = Math.max(24, Math.round((w * h) / 165));
    for (let i = 0; i < patches; i++) {
      const edge = rnd() < 0.62;
      const bx = edge ? (rnd() < 0.5 ? x : x + w - 4) + (rnd() * 5 - 2) : x + rnd() * w;
      const by = top + rnd() * h;
      const bw = 2 + Math.round(rnd() * 2) * 2;
      const bh = 2 + Math.round(rnd() * 3) * 2;
      const oxide = rnd() < 0.55;
      ctx.globalAlpha = oxide ? 0.18 + rnd() * 0.22 : 0.24 + rnd() * 0.28;
      ctx.fillStyle = oxide ? "#8a4a24" : "#2a0d14";
      ctx.fillRect(snap(bx), snap(by), bw, bh);
    }

    // GLITCH ROWS. A few scanlines that have gone wrong: a band of the bar
    // displaced sideways and re-tinted, the way a corrupted sprite tears. Rare
    // and short — this is a machine with a fault, not a broken renderer.
    const glitches = Math.max(4, Math.round(h / 72));
    for (let i = 0; i < glitches; i++) {
      const gy = snap(top + rnd() * h);
      const gh = 2 + Math.round(rnd() * 2) * 2;
      const shift = (rnd() < 0.5 ? -1 : 1) * (2 + Math.round(rnd() * 2) * 2);
      const hot = rnd() < 0.4;
      ctx.globalAlpha = hot ? 0.7 : 0.5;
      ctx.fillStyle = hot ? "#ff8a9c" : "#3d0f1c";
      ctx.fillRect(snap(x + shift), gy, w, gh);
      // The sliver the displacement leaves behind, so the tear has an edge.
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(shift > 0 ? x : x + w - Math.abs(shift), gy, Math.abs(shift), gh);
    }

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
 * THE INTAKE CHUTE (chute.ts's CHUTE) — the recycling plant's open maw, drawn
 * as part of the room.
 *
 * On the CANVAS rather than as DOM chrome, and that is the whole point. The
 * plant panel is not one size — a Contract's is shorter, the tutorial's is
 * taller, the attract demo has none — while the physics rect is a single
 * authored constant, because seed determinism requires it. Letting the panel
 * BE the chute would draw a different hazard than the one the sim enforces on
 * three quarters of the screens the game runs on. So the room owns the maw and
 * the panel is merely bolted into it.
 *
 * Nearly all of it sits behind that panel, so the drawing budget goes almost
 * entirely on the LIP: a machined bar across the mouth, at the one edge that
 * is visible at every panel height. The recess below is a flat wash that
 * reads through the panel's translucent aim-through state and does nothing
 * the rest of the time.
 *
 * NO TEETH here any more. The intake spikes moved to the DOM plant panel
 * (app.css's .plant__crest, mounted by screens.ts's hudHTML), because the
 * canvas could never trace the machine's real silhouette: the PWR cap is DOM,
 * painted over anything the world draws, so the canvas tooth run stopped dead
 * at the cap's left edge — a notch bitten out of the machine right above the
 * power bar. The crest also carries the states the teeth used to speak
 * (strand-warning red via .plant--maw; congestion recolours it), while THIS
 * function keeps the world's half of the cue — the lip bar and the rising
 * heat — which must stay canvas because the hazard also exists on screens
 * with no HUD at all (the attract demo).
 */
const CHUTE_LIP_H = 11;
/** How far the strand warning's heat rises ABOVE the lip. Above, deliberately:
 *  everything below the lip is behind an opaque panel, so a glow drawn into the
 *  maw is a warning nobody sees. This is the one band of open canvas the cue
 *  can occupy. */
const CHUTE_WARN_RISE = 58;
/**
 * How far in from each end of the mouth the heat's alpha ramps up from nothing.
 *
 * THE RISE ITSELF, because the plume has to be as soft sideways as it is
 * upward or it stops reading as gas. A rect of heat has four edges and only its
 * top one was ever fading: the band ran the mouth's full width at full strength
 * and then simply stopped, which above the panel's top — where 35 of those 58px
 * are open canvas with nothing occluding them — is a straight red line standing
 * in the air. Worst at the RIGHT end, where the raised PWR cap's shoulder
 * climbs past the panel's top edge and the cut runs up the cap's flank beside
 * the readout, which is exactly where the owner's screenshot caught it.
 *
 * A ramp this wide leaves 487 of the mouth's 603px at full strength on a stock
 * bay, so the cue itself is untouched — what changes is only the last ~10% at
 * each end, where there was an edge and there is now a falloff.
 */
const CHUTE_WARN_SPREAD = CHUTE_WARN_RISE;
/** Warning breath, ms — slow enough to read as a machine idling hot rather
 *  than an alarm strobing. */
const CHUTE_WARN_MS = 900;
/** The heat's alpha where it meets the lip, at the top of the breath. */
const CHUTE_WARN_ALPHA = 0.34;

/**
 * The heat plume, baked: alpha fading to nothing upward AND in from both ends
 * of the mouth.
 *
 * That product of two ramps is not a shape any one canvas gradient makes, and
 * the obvious two-fill version double-blends the corners it exists to soften.
 * So it is composed ONCE into an offscreen canvas — the vertical gradient laid
 * down, then the horizontal one multiplied into its alpha through
 * `destination-in`, which is a mask rather than a second coat of paint — and
 * stamped per frame with the breath riding globalAlpha. Same arithmetic as the
 * live fill it replaces (baked at the peak, multiplied by a breath of
 * 0.62..1), one drawImage instead of a per-frame gradient over the same band.
 *
 * Keyed by width because Bay Extension T3 walks the mouth's right edge left
 * (chute.ts's chuteRightEdge), and a bay only ever has a handful of widths.
 */
function getWarnPlumeSprite(w: number): HTMLCanvasElement {
  return getSprite(`maw-heat|${w}`, w, CHUTE_WARN_RISE, (ctx) => {
    const rise = ctx.createLinearGradient(0, 0, 0, CHUTE_WARN_RISE);
    rise.addColorStop(0, "rgba(255,45,85,0)");
    rise.addColorStop(1, `rgba(255,45,85,${CHUTE_WARN_ALPHA})`);
    ctx.fillStyle = rise;
    ctx.fillRect(0, 0, w, CHUTE_WARN_RISE);
    // The ends, multiplied into the alpha already there. Capped at half the
    // mouth so a mouth narrower than two spreads fades to a peak in the middle
    // instead of the stops crossing over and inverting the ramp.
    const t = Math.min(0.5, CHUTE_WARN_SPREAD / w);
    const ends = ctx.createLinearGradient(0, 0, w, 0);
    ends.addColorStop(0, "rgba(0,0,0,0)");
    ends.addColorStop(t, "rgba(0,0,0,1)");
    ends.addColorStop(1 - t, "rgba(0,0,0,1)");
    ends.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = ends;
    ctx.fillRect(0, 0, w, CHUTE_WARN_RISE);
  });
}

function drawChute(
  ctx: CanvasRenderingContext2D,
  strands: boolean,
  now: number,
  rightEdge: number,
): void {
  const { y0 } = CHUTE;
  // The MOUTH is what gets drawn, at whatever width this bay's press leaves it
  // (chute.ts's chuteRightEdge — Bay Extension T3 narrows it). Nothing below
  // the lip is drawn at all now: the throat is internal machinery, behind the
  // panel at every panel height, so painting it is painting in a sealed box.
  //
  // It starts at the PANEL's left edge, not at the rect's (chute.ts's
  // chuteMouth): the rect runs on to the wall so the dead sliver beside the
  // machine still shreds, and drawing to there put the lip bar — bright red
  // under a warning — straight across the field's glowing left wall, out past
  // the corner the crest turns.
  const { x0, w } = chuteMouth(rightEdge);
  if (w <= 0) return;
  ctx.save();

  // NO RECESS WASH. There used to be a flat rgba(4,4,10,0.55) fill across the
  // whole mouth here, to stop the maw reading as open field in the gaps the
  // panel leaves. It is gone, because those gaps are not gaps any more: the
  // panel's frame fractions leave a sliver down the left wall and a strip
  // along the floor, and the crest's band strips (app.css's
  // .plant__crest--port / --skirt) now fill both with cubes.
  //
  // Left in, it read as a black rectangle bleeding out of the HUD's left and
  // bottom edges — and it genuinely was one. The wash ran to the chute rect,
  // world x 0..624 and y 389..floor, while the panel only covers x 21..624
  // and stops ~21px above the floor. Every pixel of that difference was flat
  // near-black laid over the field's own grid, framed on two sides by a lit
  // crest, which is about the most visible place on the screen to put a
  // rectangle nobody drew on purpose.
  //
  // The mouth still reads: the lip bar below is the machined edge, and it is
  // the part that was doing the work at every panel height anyway. On the
  // HUD-less attract demo the lip is now the whole cue, which is the correct
  // amount of maw for a screen with no machine bolted into it.

  // Heat rising out of the mouth while the current aim feeds it. Drawn BEFORE
  // the lip so the bar stays crisp against it, and as a baked plume rather than
  // shadowBlur — a live Gaussian pass at 60Hz is exactly the cost this renderer
  // avoids, and what breathes here is one scalar, which globalAlpha carries for
  // free over a sprite whose shape never changes.
  if (strands) {
    // Frozen under reduced motion at what the pulse spends its time reaching,
    // the same way the ghost aura's telegraph is: the heat is INFORMATION —
    // this aim feeds the grinder — and asking for less movement is not asking
    // to be told less. A ~58px band of the field oscillating red is exactly
    // what that setting is for.
    const breath = prefersReducedMotion()
      ? 1
      : 0.62 + 0.38 * (0.5 + 0.5 * Math.cos((now / CHUTE_WARN_MS) * Math.PI * 2));
    // Put back before the lip: the bar below draws inside this same save block
    // and is not part of what breathes.
    ctx.globalAlpha = breath;
    ctx.drawImage(getWarnPlumeSprite(w), x0, y0 - CHUTE_WARN_RISE, w, CHUTE_WARN_RISE);
    ctx.globalAlpha = 1;
  }

  // The lip bar, with the same top highlight the plant panel wears, so the two
  // read as one machine rather than as chrome sitting on scenery.
  ctx.fillStyle = strands ? "#5c1225" : "#191926";
  ctx.fillRect(x0, y0, w, CHUTE_LIP_H);
  ctx.fillStyle = strands ? "rgba(255,45,85,0.9)" : "rgba(255,255,255,0.07)";
  ctx.fillRect(x0, y0, w, 2);

  ctx.restore();
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
/** World-x, preferred mount — tucked 8px under the plant panel's right edge, so
 *  the rig reads as bolted onto the machine. Slides left for wide bays (see
 *  drawPistons).
 *
 *  DERIVED from the chute's mouth rather than restating 616. The two are the
 *  same edge of the same machine: chute.ts owns where the panel ends because
 *  the physics has to agree with it, and a second copy here would be free to
 *  drift the moment either moved. */
const PISTON_BARREL_X = CHUTE.x1 - 8;
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
      // The source rect is in the sprite's BACKING-STORE pixels, and the bake
      // canvas holds its world box at the live sprite scale (makeSpriteCanvas)
      // — so the world-unit constants have to be scaled up before they are
      // used as a crop. Passing them raw was only correct at bake scale 1: at
      // 1.5 (a 1080p fullscreen) the crop caught half padding, drawing the
      // rod thin and low against the head it drives, and at the bake cap of 3
      // (a 4K TV) it landed entirely inside the transparent padding — the rod
      // vanished and the piston heads floated free of their barrels. Derived
      // from the canvas rather than from spritePxScale so the crop follows
      // the ceil-exact scale the bake actually used — and PER AXIS (found in
      // review), because makeSpriteCanvas ceils each dimension independently:
      // at scale 1.5 this 96x47-world sprite bakes 144x71, whose vertical
      // scale is 71/47, not 1.5, and a width-derived crop would still shave
      // the rod thin.
      const sx = rodSprite.width / (PISTON_ROD_BAKE_LEN + PISTON_PART_PAD * 2);
      const sy = rodSprite.height / (PISTON_ROD_H + PISTON_PART_PAD * 2);
      ctx.drawImage(
        rodSprite,
        PISTON_PART_PAD * sx,
        PISTON_PART_PAD * sy,
        PISTON_ROD_BAKE_LEN * sx,
        PISTON_ROD_H * sy,
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
  const blinking = cube.blinkStart !== null;
  const color = blinking ? "#ff6464" : cube.color;
  // A cube's material is NOT legible from its colour — that was the old claim
  // here and a CIEDE2000 audit of the field disproved it (theme.ts's
  // MATERIAL_GLYPH has the numbers). So every material that still asks the
  // player for a decision once it is lying in the bay carries a glyph, on top
  // of the shape-colour frame that separates "what is it made of" from "what
  // shape is it". All of it (and the glow) is baked into the sprite — see
  // getCubeSprite.
  //
  // A blinking cube opts out of both: its colour is overridden wholesale by the
  // clear animation, so a frame and a mark would be decorating a cube that is
  // about to stop existing.
  const slag = cube.material === "slag";
  const cold = cube.material === "cryo" && !cube.struck;
  const sprite = getCubeSprite(
    cube.type, color, cube.material, cube.framed !== false && !blinking, slag, cold,
  );

  const b = cube.body;
  // The sprite's own half-extent, not a shared constant: trimToInk gives each
  // face back only as much world as its glow reached, so stamping them all at
  // one size would scale most of them.
  const half = sprite.half;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  ctx.drawImage(sprite.canvas, -half, -half, half * 2, half * 2);
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

/** The arc's colour when the shot it previews ends somewhere the bay can never
 *  use (game.ts's trajectoryStrands). Same danger red the compactor and the
 *  low-launch readout wear — the HUD has one colour for "this costs you". */
const ARC_STRAND_COLOR = "#ff2d55";

function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  pts: Matter.Vector[],
  reload: number,
  now: number,
  strands: boolean,
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
  const sprite = getDotSprite(strands ? ARC_STRAND_COLOR : COLORS.trajectory);
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
    // 0..1..0 over one breath, sine-eased so neither end snaps — and held at
    // the peak instead for a player who asked for less movement. Same policy
    // as the belt tiles' `mat-aura` (app.css): reduced motion drops the PULSE
    // and keeps the TELEGRAPH, because the glow is information — which
    // shipment is not ordinary — and asking for less movement is not asking to
    // be told less. Frozen at what the pulse spends its time reaching, so the
    // two previews of the same shipment still agree.
    const t = (now % GHOST_AURA_MS) / GHOST_AURA_MS;
    const breath = prefersReducedMotion()
      ? 1
      : 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    ctx.globalAlpha = GHOST_AURA_ALPHA * breath;
    stamp(glow, GHOST_AURA_PAD);
  }

  // One glowing cell per color, baked (the ghost is on screen whenever the
  // cannon is loaded — this was up to five live glow fills every frame).
  // Baked opaque; GHOST_ALPHA fades the stamp, glow included.
  //
  // Two-tone on the same rule the bay cubes use (getCubeSprite): the shipment's
  // shape colour frames its material's. The muzzle is the third surface that has
  // to agree about what is loaded, so it agrees about this too.
  const shapeColor = PIECE_COLORS[cannon.currentType];
  const twoTone = color !== shapeColor;
  const sprite = getSprite(`ghost|${color}|${shapeColor}`, box, box, (c) => {
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.fillStyle = twoTone ? shapeColor : color;
    roundRect(c, GHOST_CELL_PAD, GHOST_CELL_PAD, cell, cell, 4);
    c.fill();
    if (twoTone) {
      c.shadowBlur = 0;
      const i = cell * 0.2;
      c.fillStyle = color;
      roundRect(c, GHOST_CELL_PAD + i, GHOST_CELL_PAD + i, cell - i * 2, cell - i * 2, 2.5);
      c.fill();
    }
  });
  ctx.globalAlpha = GHOST_ALPHA;
  stamp(sprite, GHOST_CELL_PAD);
  ctx.restore();

  // THE MUZZLE BADGE — the same mark the belt tile and the menus carry, beside
  // the ghost rather than on it.
  //
  // Deliberately NOT faded by GHOST_ALPHA. The ghost is a preview and reads
  // correctly as a translucent promise; what it is MADE of is not a promise, it
  // is the fact the player is aiming around, and at a glance the aura alone
  // could not carry it (theme.ts's MATERIAL_GLYPH: slag, tar and magnetic auras
  // land within dE00 13 of each other). Offset up and out from the tip so it
  // never covers the silhouette it is describing.
  if (material !== "standard") {
    drawMuzzleBadge(ctx, tip.x + cell * 0.95, tip.y - cell * 0.95, cell * 0.55,
      cannon.currentType, material);
  }
}

/** The material badge stamped beside the muzzle ghost. Baked and cached like
 *  every other repeated glow here — it is on screen for the whole aim. */
function drawMuzzleBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  type: PieceType,
  material: Material,
): void {
  const fill = shipmentAura(type, material);
  const pad = 6;
  const box = r * 2 + pad * 2;
  const sprite = getSprite(`muzzleBadge|${material}|${fill}|${r.toFixed(1)}`, box, box, (c) => {
    c.shadowColor = fill;
    c.shadowBlur = 8;
    c.fillStyle = fill;
    c.beginPath();
    c.arc(pad + r, pad + r, r, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.lineWidth = 2;
    c.strokeStyle = "#07070f";
    c.stroke();
    const g = r * 1.5;
    drawMaterialGlyph(c, material, pad + r - g / 2, g, glyphInk(fill), 1);
  });
  ctx.drawImage(sprite, x - r - pad, y - r - pad, box, box);
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

/**
 * A danger ring at the muzzle while the live aim would strand the shot.
 *
 * A SEPARATE ring rather than a tint on drawReloadRing, which was the obvious
 * home and is the wrong one: that ring returns early at `reload >= 1`, i.e. it
 * is gone for the whole of the window in which the player is actually aiming.
 * A warning that hides itself the moment the cannon is ready is no warning.
 *
 * Drawn only while `aiming`, unlike the arc and the maw, which stay lit off the
 * standing aim. The other two are answering "where does this go"; this one sits
 * on the cannon itself, where the eye is during a drag, and leaving it burning
 * between shots would make the launcher look permanently faulted.
 *
 * Just outside RELOAD_RING_R so the two never overlap on a shot fired the
 * instant the reload clears.
 */
function drawStrandRing(
  ctx: CanvasRenderingContext2D,
  cannon: Cannon,
  on: boolean,
  now: number,
): void {
  if (!on) return;
  // Same rule as the maw's heat: the ring says the shot strands, and that is
  // information. Held at full rather than pulsing on the muzzle the player is
  // dragging from.
  const breath = prefersReducedMotion()
    ? 1
    : 0.6 + 0.4 * (0.5 + 0.5 * Math.cos((now / CHUTE_WARN_MS) * Math.PI * 2));
  ctx.save();
  ctx.translate(cannon.x, cannon.y);
  ctx.strokeStyle = ARC_STRAND_COLOR;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, RELOAD_RING_R + 7, 0, Math.PI * 2);
  // Wide translucent under-stroke standing in for a glow, same trick and same
  // reason as drawReloadRing's: the value changes every frame, so it cannot be
  // baked, and shadowBlur here would be a live Gaussian pass at 60Hz.
  ctx.globalAlpha = 0.26 * breath;
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.globalAlpha = 0.9 * breath;
  ctx.lineWidth = 3;
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

/**
 * The shape of a burst of glowing debris flung out of one point.
 *
 * Three effects want this and differ only in numbers: a brick shattering on a
 * line clear, a bond letting go, and a cube blown apart. One spec table rather
 * than three near-identical drawers, because the numbers ARE the design — the
 * difference between "a seam popped" and "a cube exploded" is entirely how big
 * the pieces are and how far they go, and those want to be readable side by
 * side.
 */
interface ShardBurst {
  /** Sprite cache key prefix. Distinct per preset because the baked sprite is
   *  sized for that preset's shard, not just colored for it. */
  key: string;
  count: number;
  /** Shard edge (px) at t=0; shrinks to nothing across the burst. */
  size: number;
  /** How far a shard travels over the burst's life, eased out. */
  fling: number;
  /** shadowBlur baked into the sprite. */
  glow: number;
  /** Radians of tumble across the burst's life. */
  spin: number;
  /** White core flash duration (ms), or 0 for none. */
  coreMs: number;
  coreR: number;
  /** Downward sag (px) at t=1, applied as t² so the arc reads as a throw that
   *  is now falling rather than as a starburst diagram. 0 for pure radial. */
  sag: number;
}

/** Line clear (700ms): 7 shards off the cube's last position + a core flash. */
const BURST_SHATTER: ShardBurst = {
  key: "shard", count: 7, size: 5, fling: 34, glow: 10,
  spin: Math.PI / 2, coreMs: 120, coreR: 10, sag: 0,
};
/**
 * One joint letting go (500ms): a four-shard puff at the seam, with a brief
 * pinpoint core.
 *
 * Smaller than a shatter in every dimension — four shards to seven, two thirds
 * the reach, five sevenths the life — but not much smaller in the shard itself,
 * and that floor is forced. A seam sits BETWEEN two cubes, so this burst always
 * draws over the brightest part of the frame: 40px cubes carrying their own
 * glow. Tuned the obvious way (2.2px shards, no core) it was invisible against
 * a real pile, which fails the only thing it is for. Most of the "tinier" here
 * is carried by count and reach instead.
 *
 * The core is a pinpoint rather than the shatter's wide flash, so a Bond
 * Breaker tearing two dozen seams at once crackles instead of strobing.
 */
const BURST_SNAP: ShardBurst = {
  key: "snapshard", count: 4, size: 4.2, fling: 22, glow: 12,
  spin: Math.PI * 0.9, coreMs: 90, coreR: 4.5, sag: 0,
};
/** One destroyed cube's wreckage (800ms): three big tumbling chunks that fall
 *  as they fly. Fewer and larger than a shatter's shards, because a cube that
 *  came apart in pieces reads differently from one that vaporized. */
const BURST_CHUNK: ShardBurst = {
  key: "chunk", count: 3, size: 10, fling: 46, glow: 14,
  spin: Math.PI * 1.6, coreMs: 0, coreR: 0, sag: 26,
};

/**
 * Draw one burst at (x, y) in `color`, `t` its 0..1 progress.
 *
 * `elapsed` is passed alongside `t` only for the core flash, which runs on its
 * own fixed millisecond clock rather than on a fraction of a TTL — a flash is a
 * transient, so it must not stretch when a preset's TTL changes.
 */
function drawShardBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  t: number,
  elapsed: number,
  spec: ShardBurst,
): void {
  const base = seedAngle(x, y);
  const dist = easeOutCubic(t) * spec.fling;
  const size = spec.size * (1 - t);

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 1 - t;
  if (size > 0) {
    // One baked glowing shard per (preset, color), stamped scaled+rotated. A
    // multi-row clear spawns dozens of bursts at once — 7 live glow fills each
    // was a couple hundred Gaussian passes in the exact frame the payout
    // logic is also busiest, i.e. the frame most likely to tip a full bay
    // into catch-up (see main.ts's MAX_CATCHUP_STEPS note).
    // Margin baked around the shard so its glow isn't clipped at the sprite's
    // edge. 2.4x the shard covers it for a preset whose glow is proportional to
    // its shard; `snap` is not (its shard had to shrink but its glow could not
    // — see BURST_SNAP), so the glow itself is the floor.
    const pad = Math.max(spec.size * 2.4, spec.glow);
    const side = spec.size + pad * 2;
    const sprite = getSprite(`${spec.key}|${color}`, side, side, (c) => {
      c.shadowColor = color;
      c.shadowBlur = spec.glow;
      c.fillStyle = color;
      c.fillRect(pad, pad, spec.size, spec.size);
    });
    const drawSide = side * (size / spec.size);
    const sag = spec.sag * t * t;
    for (let i = 0; i < spec.count; i++) {
      const angle = base + i * ((Math.PI * 2) / spec.count);
      ctx.save();
      ctx.translate(Math.cos(angle) * dist, Math.sin(angle) * dist + sag);
      ctx.rotate(angle + t * spec.spin);
      ctx.drawImage(sprite, -drawSide / 2, -drawSide / 2, drawSide, drawSide);
      ctx.restore();
    }
  }

  if (spec.coreMs > 0 && elapsed >= 0 && elapsed < spec.coreMs) {
    const coreT = elapsed / spec.coreMs;
    ctx.save();
    ctx.globalAlpha = 1 - coreT;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, spec.coreR * (1 - coreT), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Every burst-shaped event: same drawer, different numbers and TTL. */
function drawBurstFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "shatter" | "snap" | "chunk" }>,
  now: number,
  spec: ShardBurst,
): void {
  const elapsed = now - e.t0;
  const t = clamp01(elapsed / FX_TTL[e.kind]);
  if (t >= 1) return;
  drawShardBurst(ctx, e.x, e.y, e.color, t, elapsed, spec);
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
 *  payout so the pair read as one family. The distance itself lives in fx.ts,
 *  because spawners need it to clear obstacles for the toast's whole travel. */

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
        drawBurstFx(ctx, e, now, BURST_SHATTER);
        break;
      case "snap":
        drawBurstFx(ctx, e, now, BURST_SNAP);
        break;
      case "chunk":
        drawBurstFx(ctx, e, now, BURST_CHUNK);
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
