import Matter from "matter-js";
import { CELL, SKY, WALL_INNER, WORLD, lerpAngle, lerpX, lerpY } from "./engine";
import { CHUTE, chuteMouth, chuteRightEdge, INCINERATOR_Y } from "./chute";
import { BASE_BREAK_STRETCH } from "./level";
import { cushionEdgeX } from "./lineClear";
import { computeLayout, skyTop } from "./layout";
import {
  BAY_GLYPH_MATERIALS, COLORS, CONGESTION_TAG, CONGESTION_TAG_COLOR,
  glyphInk, GRADE_CALLOUT, GRADE_COLOR,
  MATERIAL_GLYPH, PIECE_COLORS,
  shade, shipmentAura, shipmentColor,
  type Material, type PieceSize, type PieceType,
} from "./theme";
import { pieceOffsets, type Cube } from "./pieces";
import type { Compactor } from "./compactor";
import { Cannon, CANNON } from "./cannon";
import { blinkVisible } from "./lineClear";
import type { LevelConfig } from "./level";
import { BLAST_AMBER, FX_TTL, type FxEvent, PENALTY_SINK_PX } from "./fx";

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

/**
 * HOW MANY DEVICE PIXELS THE CANVAS BACKING STORE GETS PER CSS PIXEL — the one
 * number that decides how much rasterising a frame costs, and the only knob in
 * this renderer whose effect is linear in the whole frame rather than in one
 * layer of it.
 *
 * THE MEASUREMENT THIS IS BUILT ON. sim/renderperf at an iPhone X's landscape
 * viewport (css 812x375, N=300 mixed, busy, headless Chromium, p50 of 180
 * timed frames):
 *
 *     dpr 1   -> 4.8 ms      dpr 2  -> 12.2 ms
 *     dpr 1.5 -> 8.0 ms      dpr 3  -> 23.9 ms
 *
 * That is a straight line through the origin in DEVICE PIXELS — the frame is
 * fill-bound, not call-bound, which the draw-call census corroborates: the same
 * scene issues the same ~1460 calls per frame at every one of those four
 * resolutions. --breakdown puts 9.4 of those 11.8 ms (80%) in the cube layer,
 * which is 150 sprite stamps covering 0.66 MP; the rest is the background blit
 * (1.0 ms), the aim arc (1.4 ms) and the chrome (1.3 ms). Nothing in that list
 * gets cheaper by drawing fewer things. All of it gets cheaper, proportionally,
 * by drawing the same things onto fewer pixels.
 *
 * WHY A CAP AT ALL, AND WHY THIS ONE. Uncapped, an iPhone X asks for
 * devicePixelRatio 3 and a 2436x1125 backing store. The 2 that was already here
 * removed the worst of that (23.9 ms -> 12.2 ms). What it did not do is notice
 * that a phone and a desktop are asking the same question with very different
 * hardware behind them: at css 1280x720 a desktop rasterises a 1196x673 FIELD,
 * and a retina laptop at 1440x900 rasterises 2712x1526 — four times the iPhone
 * X's field at dpr 2 — on a GPU that does not care. A single global ceiling
 * cannot be right for both, so the ceiling is now two ceilings and the viewport
 * chooses between them.
 *
 * COMPACT_SHORT_EDGE_CSS IS THE TEST, and it is deliberately a measurement of
 * the VIEWPORT rather than a guess about the device. No user-agent string, no
 * hardwareConcurrency (an iPhone X reports 6, the same as a workstation),
 * no deviceMemory (Safari does not implement it). A short edge of 480 CSS px or
 * less is every phone in either orientation and nothing else: an iPad's short
 * edge is 768, a desktop window that narrow is a sliver nobody plays in. The
 * one thing it does not catch is a phone-shaped window on a fast machine, which
 * loses sharpness it could have afforded — a fair price for never mistaking a
 * slow phone for a fast one.
 *
 * WHAT IT COSTS, STATED PLAINLY, BECAUSE IT IS A REAL REGRESSION. On the iPhone
 * X the canvas goes from 1624x750 to 1218x562: 44% fewer device pixels, and the
 * measured frame goes from 12.2 ms to 8.0 ms (-34% — the gap between 44 and 34
 * is the per-call work that does not scale with area). In physical terms the
 * field is rasterised at ~239 ppi instead of ~318 ppi across a 5.1-inch-wide
 * display area, which is below the ~300 ppi that a phone at arm's length can
 * resolve. It IS softer. Two things make it the right trade anyway:
 *
 *   - Every glyph the player reads is DOM, and the DOM keeps the device's full
 *     ratio — the HUD, the plant crest, the rail, every modal. This changes the
 *     resolution of neon glow art whose edges are Gaussian by construction, and
 *     of nothing with a letterform in it.
 *   - The alternative is worse than soft. main.ts's accumulator caps catch-up at
 *     MAX_CATCHUP_STEPS, so a frame that misses 30fps does not drop frames, it
 *     runs the SIMULATION slow. Over-budget frames are not a smoothness problem
 *     on this codebase, they are the game visibly playing in slow motion —
 *     which is exactly what the first iPhone X run reported.
 *
 * FREE ON THE SPRITE CACHES, which is worth stating because it is not obvious.
 * syncSpriteScale clamps the bake scale to [1, 3], and at css 812x375 the world
 * scale is 0.426, so the bake target is 0.85 at dpr 2 and 0.64 at dpr 1.5 —
 * both clamp to 1. The two resolutions bake the SAME sprites at the SAME scale
 * and differ only in how large each one is stamped. No extra bakes, no extra
 * sprite memory, and no cache flush when a device crosses the threshold by
 * rotating.
 *
 * THIS IS THE STATIC HALF OF THE RIGHT ANSWER. The honest version measures the
 * frame it is actually achieving and steps the scale down a rung when it cannot
 * hold the budget — no viewport heuristic at all, and a fast phone keeps its
 * pixels. That needs a governor with a feedback path back into the canvas
 * backing size, which is a bigger seam than this pass owns; see the PR for the
 * shape of it. A fixed rung that is right for the slow case is a better place to
 * start than a ratio that is wrong for it.
 */
export const MAX_RENDER_DPR = 2;
/** @see renderScale — the ceiling for a phone-sized viewport. */
export const COMPACT_MAX_RENDER_DPR = 1.5;
/** @see renderScale — short edge, in CSS px, at or under which a viewport is
 *  treated as a phone's. */
export const COMPACT_SHORT_EDGE_CSS = 480;

export function renderScale(deviceRatio: number, cssW: number, cssH: number): number {
  // A ratio of 0, NaN or undefined is a browser that has not laid out yet, not
  // a request for a zero-pixel canvas.
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const shortEdge = Math.min(cssW, cssH);
  const compact = shortEdge > 0 && shortEdge <= COMPACT_SHORT_EDGE_CSS;
  return Math.min(ratio, compact ? COMPACT_MAX_RENDER_DPR : MAX_RENDER_DPR);
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
  /**
   * HOW FAR INTO THE STEP NOW IN PROGRESS this frame sits, 0..1 — main.ts's
   * leftover accumulator over one STEP. Every physics body is drawn between
   * where it stood at the end of the last step and where it stands now, so a
   * panel refreshing faster than the 60Hz simulation gets a fresh position per
   * frame instead of the same one twice. See engine.ts's markPrevStep for the
   * whole argument, including what it costs.
   *
   * OPTIONAL, DEFAULTING TO 1 — "draw the world exactly as it is right now",
   * which is what the renderer did before interpolation existed and what every
   * caller that does not run an accumulator wants. sim/renderperf and
   * sim/uifit both step and draw in lockstep, so 1 is the honest answer there
   * and their pixels are unchanged by any of this.
   */
  alpha?: number;
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

/**
 * Graphite -> amber -> red by strain, packed 0xRRGGBB.
 *
 * Packed rather than formatted because the seam loop needs to ASK whether this
 * seam's colour is the one already set before it pays to build a string and
 * hand it to the CSS colour parser — see drawJointSeams. An integer compare
 * answers that; a string compare would first have to build the string, which is
 * the allocation the question exists to avoid.
 */
function seamRgb(strain: number): number {
  const seg = strain < 0.5 ? 0 : 1;
  const k = strain < 0.5 ? strain / 0.5 : (strain - 0.5) / 0.5;
  const a = seg === 0 ? SEAM_REST : SEAM_WARM;
  const b = seg === 0 ? SEAM_WARM : SEAM_HOT;
  const ch = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * k);
  return (ch(0) << 16) | (ch(1) << 8) | ch(2);
}

/** The strokeStyle a packed seam colour and an opacity spell — character for
 *  character what this function has always produced. */
function seamColor(rgb: number, opacity: number): string {
  return `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${opacity.toFixed(3)})`;
}

/**
 * WHY THIS LOOP KEEPS A COPY OF THE STYLE IT LAST WROTE.
 *
 * A bay's seams are overwhelmingly the SAME seam. `lineWidth` and the opacity
 * both come from `seamStrength(breakStretch)`, which is a per-BAY constant, and
 * the colour only moves when a joint is actually under strain — which, in a
 * settled pile, is none of them. sim/renderperf --probe counted the consequence
 * at 146 cubes: 114 `lineWidth` assignments per frame of which **108 wrote the
 * value canvas already held**, and 112 `strokeStyle` assignments, each of which
 * built a fresh string for the CSS colour parser to re-parse into the colour it
 * was already using.
 *
 * So the loop remembers the two numbers that determine the style and writes
 * nothing when they have not moved. A strained joint still gets its own colour
 * and width the moment it earns them; a hundred identical seams cost one write.
 * Nothing about the drawing changes, so the digests cannot move and do not.
 *
 * WHAT WAS TRIED AND ROLLED BACK, so nobody spends the afternoon twice.
 * Accumulating same-styled seams as subpaths of ONE path and stroking once
 * removes ~330 further calls a frame, and it is only equivalent if no two seams
 * OVERLAP: these strokes are translucent, so a shared pixel blends twice as
 * separate strokes and once as a batch. The construction argues they cannot
 * overlap — each bar spans the shared edge of an ADJACENT pair, shorter than
 * the edge, and `rest > CELL * 1.35` drops every diagonal. The pixels disagree.
 * Batched, `cliques` at 300 moved 0.15% of channel samples by up to 20/255
 * (`loose`, which carries no joints at all, was untouched, which is what
 * identifies the cause as the seams themselves). A compressed pile evidently
 * squeezes some jointed pair close enough for its diagonal to clear the 1.35
 * test and cross its neighbours. 20/255 on a visible line is not a rounding
 * artefact, and the layer it would buy is 0.8ms of an 18.2ms frame, so the
 * batch is not taken and the identity is kept.
 */
function drawJointSeams(
  ctx: CanvasRenderingContext2D,
  cs: Matter.Constraint[] | undefined,
  alpha: number,
): void {
  if (!cs?.length) return;
  ctx.save();
  ctx.lineCap = "butt";
  // The style the context is currently carrying, as the two numbers that
  // determine it. -1 is "nothing written yet", which no real colour or strength
  // can collide with.
  let setRgb = -1;
  let setT = -1;
  for (const c of cs) {
    const a = c.bodyA;
    const b = c.bodyB;
    if (!a || !b) continue;
    // Both ends read at the frame's own point in the step, like the cubes they
    // join (drawCube). Reading them live while the cubes interpolate would peel
    // every seam off its own weld for the frames between steps — the one place
    // in the scene where a mismatch is unmissable, because a seam is drawn
    // exactly on the join it describes.
    const ax = lerpX(a, alpha);
    const ay = lerpY(a, alpha);
    const bx = lerpX(b, alpha);
    const by = lerpY(b, alpha);
    const meta = c as unknown as { restLength?: number; breakStretch?: number };
    const rest = meta.restLength ?? Math.hypot(ax - bx, ay - by);
    // CELL, not a measurement off the body's vertices: pieces.ts builds cubes
    // with `chamfer: { radius: 3 }`, so a cube has EIGHT vertices and v[0]->v[1]
    // is a 3px chamfer chord rather than its side. Reading it that way makes
    // every rest length look like a diagonal and draws no seams at all.
    if (rest > CELL * 1.35) continue;
    const t = seamStrength(meta.breakStretch);
    const dx = bx - ax;
    const dy = by - ay;
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
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    // `t` alone decides both the width and the opacity, so comparing it is
    // exactly as strict as comparing the two values it produces — and strict is
    // the requirement, since a run that batches two seams whose style differs
    // would draw one of them wrong.
    const rgb = seamRgb(strain);
    if (rgb !== setRgb || t !== setT) {
      // Width is the one that can survive a colour change untouched — a joint
      // reddening under strain keeps its bay's strength. The colour string is
      // rebuilt whenever EITHER moves, because `t` carries the opacity inside it.
      if (t !== setT) ctx.lineWidth = 1.4 + 3.6 * t;
      ctx.strokeStyle = seamColor(rgb, 0.55 + 0.35 * t);
      setRgb = rgb;
      setT = t;
    }
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
  const alpha = scene.alpha ?? 1;
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
  // Under the cargo and under the bar, because it is floor: a liner the pile
  // sits ON has to be behind whatever is sitting on it. Its EDGE is drawn with
  // the trajectory instead — see drawCushionEdge.
  drawCushionBed(ctx, scene.level);
  drawWindIndicator(ctx, scene.level, scene.windNow, scene.windAverage);
  drawCompactor(ctx, scene.compactor, alpha);
  drawPistons(ctx, scene.compactor, alpha);
  // The world transform's three numbers, handed to the cube loop so each stamp
  // can REPLACE the transform outright instead of saving, translating and
  // restoring around it — see drawCube. Nothing else in the frame wants them,
  // which is why they are not on Scene.
  const wsc = vp.scale * dpr;
  const wtx = vp.ox * dpr;
  const wty = vp.oy * dpr;
  for (const cube of scene.cubes) drawCube(ctx, cube, scene.now, alpha, wsc, wtx, wty);
  // Put the world transform back for everything after the pile. The cube loop
  // leaves the CTM wherever the last cube stood; the clip is untouched by any
  // of this (a clip is fixed in device space the moment it is set), so this one
  // call is the whole restoration.
  ctx.setTransform(wsc, 0, 0, wsc, wtx, wty);
  // Over the cubes, not under: a seam between adjacent cubes is covered by the
  // very cubes it joins, so drawing it underneath draws nothing.
  drawJointSeams(ctx, scene.constraints, alpha);
  for (const bomb of scene.bombs) drawBomb(ctx, bomb, alpha);
  // THE BLAST SPRAY GOES HERE AND NOWHERE LATER. Over the cargo it came out of
  // — debris behind the pile is debris nobody sees — and UNDER everything the
  // player aims with: the cushion edge, the incinerator plane, the arc and the
  // cannon all draw after it. At the frame cap this layer puts 240 lit squares
  // on the field, and the one thing they must never cover is the dotted line
  // the next shot is being lined up against.
  drawExplosionDebris(ctx, scene.effects, scene.now);
  // Over the cargo, with the trajectory: this is the line the player aims
  // against, and the bedding it belongs to is already buried under the pile.
  drawCushionEdge(ctx, scene.level);
  // The Incinerator's flue plane, for the same reason and in the same layer as
  // the liner's edge: it is a boundary the player aims relative to, and a
  // boundary buried under the pile has stopped being one. Unlike the liner it
  // never has cargo resting ON it, so it needs no bedding half — this one draw
  // is the whole system's picture.
  drawIncineratorLine(ctx, scene.level);
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
 *  carrying more information gets the larger region and the glyph.
 *
 *  Exported because it is the width every interior mark is actually drawn on —
 *  CELL - FRAME_PX * 2 — and sim/systems.ts pins the frost's weight against
 *  that face rather than against the cube. */
export const FRAME_PX = 5;

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
  } else if (!bayGlyph && !cold) {
    // Per-type interior pattern (ported from main.py draw_square_piece).
    // Skipped where a glyph is about to take the same space: pattern AND mark
    // is busier than either alone, and the mark is the one carrying something
    // the player cannot read anywhere else on a landed cube.
    //
    // A FROZEN face is that same case and was not treated as one until the
    // frost was thickened: hatching under a heavy six-spoke star is the exact
    // "pattern AND mark" this line refuses everywhere else, and the type it
    // spells is already in the silhouette and in the shape-colour frame, while
    // the star is the only thing on the field saying this cube will not sell
    // its row. The pattern comes back the instant the cube thaws.
    drawPattern(ctx, type, io, io, isize, dark, light);
  }
  // Frost over whatever the interior holds, so a cryo O still reads as an O.
  // It vanishes the instant the cube thaws — that transition IS the feedback
  // that the strike landed, and the row is now completable.
  if (cold) drawFrost(ctx, io, isize, color);
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
  // RESIZE ONLY WHEN THE SIZE ACTUALLY CHANGED. Assigning canvas.width throws
  // the backing store away and allocates a fresh one — on a phone that is a new
  // GPU surface for a 1218x562 layer — and it used to happen on every re-bake.
  // Most re-bakes are not resizes: the cache key also carries the congestion
  // rows, whose `lit` count steps once per compactorMinLineCells cubes, so a
  // busy bay re-bakes several times a second at a size that never moved. The
  // opaque fill below covers every device pixel of the layer, so there is
  // nothing a realloc would clear that the repaint does not.
  //
  // What the assignment ALSO did was reset the context transform, and the fill
  // that follows is in device space. Now that it may not run, the reset is
  // explicit — without it the second re-bake at a given size would fill (0,0,w,h)
  // through the previous bake's world transform and paint the backdrop over a
  // fraction of the layer.
  if (bgLayer.width !== w || bgLayer.height !== h) {
    bgLayer.width = w;
    bgLayer.height = h;
  }
  const bctx = bgLayer.getContext("2d")!;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
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

/**
 * THE IMPACT CUSHION'S LINER, drawn on the floor it lines.
 *
 * The system has a hard edge — a volatile cube that lands one cell short of
 * `cushionCells` gets no softening at all (lineClear.ts's volatileBlast) — and
 * a hard edge the player cannot see is not a rule they can play against, it is
 * a rule that happens to them. That is the whole reason this function exists;
 * the liner is the one ship system whose effect is a PLACE, and every other
 * one reads off a number in the HUD.
 *
 * So the drawing's job is to answer exactly one question at a glance — "is that
 * slot lined?" — which is why the near edge is the loudest thing in it. The
 * bedding itself is deliberately quiet: it sits under the pile for the whole
 * bay and a floor treatment that competes with cargo would cost more than it
 * teaches. Same stance as the congestion rows, which are floor light rather
 * than a HUD overlay.
 *
 * Tier-independent styling. Depth is the readout — a deeper tier draws a wider
 * band, which is the thing that changed — and a second visual channel for the
 * softening would be a number nobody can read off a colour.
 */
function drawCushionBed(ctx: CanvasRenderingContext2D, level: LevelConfig): void {
  if (level.cushionCells <= 0) return;
  // THE SAME x the collision side tests against, from the same function —
  // see lineClear.ts's cushionEdgeX for why that is not a tidiness point.
  const x = cushionEdgeX(level.cushionCells);
  const w = WALL_INNER - x;
  // A third of a cell: thick enough to read as bedding the pile rests on, thin
  // enough that a cube sitting on it still reads as sitting on the floor.
  const h = CELL / 3;
  const y = WORLD.height - h;

  ctx.save();
  const grad = ctx.createLinearGradient(0, y, 0, WORLD.height);
  grad.addColorStop(0, "rgba(0,240,255,0.06)");
  grad.addColorStop(1, "rgba(0,240,255,0.22)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // The chevrons the shop card's icon uses, so the mark on the plate and the
  // thing on the floor are recognisably the same object.
  ctx.strokeStyle = "rgba(0,240,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let cx = x + CELL / 2; cx < WALL_INNER; cx += CELL) {
    ctx.moveTo(cx - CELL / 3, WORLD.height - 2);
    ctx.lineTo(cx, y + 2);
    ctx.lineTo(cx + CELL / 3, WORLD.height - 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The liner's near edge — the boundary, drawn OVER the cargo.
 *
 * Split from the bedding above because the two are different kinds of thing and
 * want opposite layering. The bed is floor: cargo lands on it and covers it,
 * exactly as it should. The edge is a REFERENCE — the line the player aims
 * against — and a reference buried under the first row that lands on it has
 * stopped being one. Measured on a real Tier-7 bay at 1100 steps: the bed is
 * gone behind cargo and the post was invisible with it.
 *
 * So this draws with the trajectory and the aim ring rather than with the
 * floor, and it is deliberately the only part of the system that does. Two
 * cells of post, faded upward so it reads as a marker standing on the floor
 * rather than as a wall cargo ought to stack against.
 */
function drawCushionEdge(ctx: CanvasRenderingContext2D, level: LevelConfig): void {
  if (level.cushionCells <= 0) return;
  const x = cushionEdgeX(level.cushionCells);
  ctx.save();
  const post = ctx.createLinearGradient(0, WORLD.height, 0, WORLD.height - 2 * CELL);
  post.addColorStop(0, "rgba(0,240,255,0.85)");
  post.addColorStop(1, "rgba(0,240,255,0)");
  ctx.strokeStyle = post;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, WORLD.height);
  ctx.lineTo(x, WORLD.height - 2 * CELL);
  ctx.stroke();
  // A solid foot, so the boundary has a definite position even where the post
  // has faded into whatever is stacked in front of it.
  ctx.fillStyle = COLORS.aim;
  ctx.fillRect(x - 2, WORLD.height - 6, 4, 6);
  ctx.restore();
}

/**
 * THE FLUE, drawn as the one line the system is.
 *
 * Same argument drawCushionEdge makes and the same failure it exists to avoid:
 * the Incinerator has a hard edge (chute.ts's inIncinerator — a cube destroyed
 * a pixel below the plane pays full price), and a hard edge the player cannot
 * see is not a rule they can play against, it is a rule that happens to them.
 *
 * AND IT HAS TO STAY QUIET, which is the constraint the liner did not have. The
 * plane runs the full width of the bay across open air, and the airspace above
 * it is the sky PR #128 opened — a band that reads as a lid is precisely the
 * defect that change was made to remove. So this is a hairline with a short
 * gradient fading UPWARD off it, not a filled band and not a ruled line across
 * the shaft: enough to answer "is that above the hood" at a glance, not enough
 * to put a ceiling back over a field whose whole point is that it has none.
 *
 * Amber rather than the liner's cyan, because the two are the only positional
 * systems on the shelf and a player who owns both has to tell their marks apart
 * without reading either — and amber is already what this game means by heat
 * (the crest's ramp, the congestion rows).
 */
function drawIncineratorLine(ctx: CanvasRenderingContext2D, level: LevelConfig): void {
  if (level.incineratorRelief <= 0) return;
  const y = INCINERATOR_Y;
  ctx.save();
  // The glow first, fading upward INTO the flue — the side the discount is on,
  // so the shading says which half of the line is the burner rather than just
  // where the line is.
  const glow = ctx.createLinearGradient(0, y - CELL, 0, y);
  glow.addColorStop(0, "rgba(255,150,40,0)");
  glow.addColorStop(1, "rgba(255,150,40,0.10)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, y - CELL, WORLD.width, CELL);
  // The plane itself: a hairline, dashed so it reads as a threshold rather than
  // as a surface cargo could rest on — nothing in this game rests on a dashed
  // line, and the walls and floor are the only solid rules drawn in the field.
  ctx.strokeStyle = "rgba(255,150,40,0.38)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([CELL / 2, CELL / 2]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(WORLD.width, y);
  ctx.stroke();
  ctx.restore();
}

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

function drawCompactor(ctx: CanvasRenderingContext2D, c: Compactor, alpha: number): void {
  const sprite = getBarSprite(c.width, c.height);
  ctx.drawImage(
    sprite,
    lerpX(c.body, alpha) - c.width / 2 - BAR_PAD,
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

function drawPistons(ctx: CanvasRenderingContext2D, c: Compactor, alpha: number): void {
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
    // The bar's left face — where the piston pushes it. Interpolated on the
    // same terms as the bar itself (drawCompactor), because a rod that tracked
    // the live position while the bar it drives tracked the drawn one would
    // visibly detach from its own head at every step boundary.
    const headX = lerpX(c.body, alpha) - c.width / 2;
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

/**
 * ONE CUBE, STAMPED — and the cheapest sequence of canvas calls that does it.
 *
 * The pile is the frame. sim/renderperf --breakdown puts the cube layer at
 * 13.5ms of an 18.2ms frame at 146 cubes (844x390 dpr 3, headless), and the
 * refuted background-split spec's device work named the shape of that cost
 * exactly: "many small draws, not one big one". So the count of calls per cube
 * is a number worth spending care on — 146 cubes times one avoidable call is
 * 146 avoidable calls every frame, and unlike a millisecond measured on a
 * desktop rasteriser, a call not issued here is a call not issued on the phone.
 *
 * WHAT CHANGED AND WHY IT IS THE SAME PIXELS. This used to be
 * `save / translate / rotate / drawImage / restore`. The save/restore pair
 * existed only to undo the translate and rotate, and re-stating the world
 * transform undoes both by overwriting them — so the sequence is now
 * `setTransform / translate / rotate / drawImage`, and render() puts the world
 * transform back once after the whole loop rather than the loop putting it back
 * 146 times. The trade is one cheap matrix write for canvas's two most
 * expensive state calls: `save` copies the whole 2D state (styles, shadow,
 * filter, line dash, the clip stack) and `restore` pops it, where
 * `setTransform` writes six numbers.
 *
 * The translate and the rotate are left to canvas ON PURPOSE, and the first
 * attempt at this proves why. Folding the translate into setTransform's own
 * arguments — `setTransform(s, 0, 0, s, tx + s*x, ty + s*y)`, algebraically the
 * same matrix — moved the digest at every pile size in
 * sim/renderperf --snapshot, with cargo coverage unchanged to within one pixel:
 * the offset composed in JS doubles and then narrowed once rounds differently
 * in the last place than the same offset accumulated inside the rasteriser's
 * own float matrix, and every cube in the frame landed a fraction of a
 * subpixel off. One call per cube is not worth paying for that, so the
 * arithmetic stays where it always was and only the save/restore goes.
 *
 * The clip is not affected. A canvas clip is resolved into device space when it
 * is set, so replacing the CTM afterwards moves what is drawn and not what is
 * allowed to be drawn — the sky-opened world rect render() clips to still holds
 * over every cube.
 */
function drawCube(
  ctx: CanvasRenderingContext2D,
  cube: Cube,
  now: number,
  alpha: number,
  /** The world transform: uniform scale `wsc`, offset (`wtx`, `wty`), all in
   *  device px, exactly as render() set it before the loop. */
  wsc: number,
  wtx: number,
  wty: number,
): void {
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
  ctx.setTransform(wsc, 0, 0, wsc, wtx, wty);
  ctx.translate(lerpX(b, alpha), lerpY(b, alpha));
  ctx.rotate(lerpAngle(b, alpha));
  ctx.drawImage(sprite.canvas, -half, -half, half * 2, half * 2);
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

/**
 * THE FROST MARK — what a frozen cube's face is drawn with.
 *
 * WHY IT IS A TABLE AND NOT THREE LITERALS IN THE DRAWER. The bake happens on
 * an offscreen canvas, which is the one surface sim/systems.ts's recording
 * context deliberately cannot see (canvasrec.ts gives every createElement its
 * own throwaway recorder). Handing the drawer a computed description instead
 * puts the whole of the mark's arithmetic somewhere a node pin can read it,
 * which is what the weight below needs: it is a claim about a RATIO, and a
 * ratio nobody checks is a ratio that drifts back.
 *
 * WEIGHT. The owner's report was that a frozen cube "is not very visible", and
 * the old mark measures out as exactly that: six hand-rolled needles at a FLAT
 * lineWidth of 2 world px — 6.7% of the 30px interior a two-tone cryo cube
 * actually has — in white, on cryo's #9fe8ff ice, which is a contrast ratio of
 * 1.31:1. It was a white line on a white-blue square.
 *
 * So the mark is rebuilt on the two channels that were being wasted:
 *
 *   THICKNESS. Both strokes are a FRACTION of the face they are drawn on, so
 *   the mark holds its weight on a two-tone interior (30px), on a standing
 *   wall's full face (40px) and at any bake scale. The core lands at 4.05
 *   world px on a two-tone cube against the old 2 — the "thicker" the report
 *   asked for, stated as a proportion so it stays true at any size.
 *
 *   CONTRAST. The ink is glyphInk(face) — the same near-black/near-white rule
 *   every other bay glyph is drawn with (theme.ts derives it from relative
 *   luminance), which on ice is #07070f at 14.5:1 against the 1.31:1 the white
 *   needles had.
 *
 * WHY THE RIME IS NOT WHITE. The obvious version of this keeps the old white
 * as a wide under-stroke and puts the dark core inside it, so the mark still
 * reads as frost rather than as a crack. It was built that way first and
 * photographed as nothing at all: the rime is drawn ON the ice, and white on
 * #9fe8ff is the same 1.31:1 that made the original needles invisible — a
 * layer whose entire justification was a contrast it does not have. The rime
 * is therefore the SAME ink at RIME_ALPHA, a soft shoulder that widens the
 * mark's apparent weight and keeps a hard 4px stroke from reading as type set
 * on a cube. It is also the half that survives a face this rule inverts on: a
 * blinking cube's #ff6464 takes light ink, and the shoulder goes with it.
 *
 * SHAPE. The path is MATERIAL_GLYPH.cryo itself, not a second copy of it.
 * theme.ts calls that glyph "the same six-spoke star the cube face has carried
 * since cryo shipped — this is that mark promoted to the belt", and the two
 * were nonetheless drawn by different code from different numbers: the belt's
 * spokes run on the vertical and two 30° diagonals, the cube's ran at 0/60/120°
 * off the horizontal. One authored path is what theme.ts asks for in the line
 * above MATERIAL_GLYPH ("a glyph drawn twice is a glyph that drifts"), and it
 * means the tile the player reads on the belt and the face they read in the bay
 * are now literally the same mark.
 */
export interface FrostMark {
  /** World px of the soft under-stroke. */
  rime: number;
  /** World px of the high-contrast core stroke. */
  core: number;
  /** Both strokes' ink, by theme.ts's luminance rule for this face. */
  ink: string;
}

/** Core stroke as a fraction of the frosted face's edge. 0.135 against the
 *  belt glyph's authored 2.6/24 = 0.108: a bay cube is read in peripheral
 *  vision against sixty neighbours, where a belt tile is read alone in a lit
 *  slot, so the bay wears the heavier version of the same mark. */
const FROST_CORE_FRAC = 0.135;
/** Rime stroke, as the same fraction. 1.85x the core — wide enough to read as
 *  a shoulder around the needles at 40px and still inside the face at 24px,
 *  which is the smallest a cube is ever drawn (the menu's attract panel). */
const FROST_RIME_FRAC = FROST_CORE_FRAC * 1.85;
/** How opaque the rime is. A quarter: it is a shoulder on the core, not a
 *  second mark, and anything heavier closes the gap between the spokes on a
 *  30px face and turns the star into a blot. */
const FROST_RIME_ALPHA = 0.26;

/** The frost mark for a `size`-wide face of colour `face`. Pure, and exported
 *  for sim/systems.ts — see FrostMark above for why the drawer does not just
 *  hold these numbers itself. */
export function frostMark(size: number, face: string): FrostMark {
  return {
    rime: size * FROST_RIME_FRAC,
    core: size * FROST_CORE_FRAC,
    ink: glyphInk(face),
  };
}

/** Cold cryo's frost: the material's own six-spoke star, rimed in white and
 *  cored in high-contrast ink. Drawn only while frozen (see drawCube) so
 *  thawing is a visible event. */
function drawFrost(
  ctx: CanvasRenderingContext2D,
  o: number,
  size: number,
  face: string,
): void {
  const mark = frostMark(size, face);
  const s = size / 24;
  ctx.save();
  ctx.translate(o, o);
  ctx.scale(s, s);
  // Both strokes are specified in world px and then drawn under the glyph's
  // own 24-unit scale, so the numbers above mean what they say on the face
  // rather than in the authoring box.
  const path = new Path2D(MATERIAL_GLYPH.cryo.d);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = mark.ink;
  ctx.globalAlpha = FROST_RIME_ALPHA;
  ctx.lineWidth = mark.rime / s;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
  ctx.lineWidth = mark.core / s;
  ctx.stroke(path);
  ctx.restore();
}

/** A live flying/rolling bomb — dark sphere with a subtle red glow and a
 *  small fuse-spark highlight, so it reads as distinct from a cube in flight. */
function drawBomb(ctx: CanvasRenderingContext2D, body: Matter.Body, alpha: number): void {
  const r = CELL * 0.45;
  ctx.save();
  ctx.translate(lerpX(body, alpha), lerpY(body, alpha));
  ctx.rotate(lerpAngle(body, alpha));
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

/** The TIMING CALLOUT rides the same toast as the money it explains: same
 *  motion, same fade, one line above the "+$" (theme.ts's GRADE_CALLOUT owns
 *  the words and the colours).
 *
 *  A rider rather than its own FxEvent, which is the whole of the UI budget
 *  this feature spends. Two floaters spawned on the same step at the same spot
 *  would race each other up the field and the eye would read them as two
 *  clears; one toast that says what was earned and how it was earned is the
 *  idiom the payout/penalty pair already established. Smaller than the number
 *  and set above it because the money is the headline — the callout is the
 *  reason, and a bay full of shouted adjectives stops being readable. */
const CALLOUT_FONT = "700 18px system-ui, sans-serif";
/** Baseline-to-baseline, so the 18px word clears the 30px number's cap height
 *  with air left over. 22 was drawn first and the shot showed the two rows
 *  touching (sim/uifit/grade-shots.ts) — legible, but reading as one block
 *  rather than as a label over a figure. */
const CALLOUT_GAP_PX = 26;

/** The congestion tag rides UNDER the money, where the callout rides over it —
 *  so the toast reads verdict / price / reason, top to bottom, and the tag can
 *  never be mistaken for the band. Smaller again than the callout for the same
 *  reason the callout is smaller than the number: the further from the money,
 *  the quieter. */
const TAG_FONT = "700 14px system-ui, sans-serif";
/** Baseline-to-baseline below the 30px number: enough to clear its descenders
 *  with the same air CALLOUT_GAP_PX leaves above. */
const TAG_GAP_PX = 20;

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
  if (e.grade) {
    ctx.fillStyle = GRADE_COLOR[e.grade];
    ctx.shadowColor = GRADE_COLOR[e.grade];
    ctx.font = CALLOUT_FONT;
    ctx.fillText(GRADE_CALLOUT[e.grade], x, y - CALLOUT_GAP_PX);
  }
  if (e.congested) {
    ctx.fillStyle = CONGESTION_TAG_COLOR;
    ctx.shadowColor = CONGESTION_TAG_COLOR;
    ctx.font = TAG_FONT;
    ctx.fillText(CONGESTION_TAG, x, y + TAG_GAP_PX);
  }
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
const EXPLOSION_RING_COLOR = BLAST_AMBER;
/**
 * The SHOCKWAVE's own clock, in ms.
 *
 * FX_TTL.explosion is 900 and this is 600, and the gap is deliberate: the
 * event now outlives its bang so drawExplosionDebris can keep throwing
 * wreckage after the ring has finished. Reading the ring's progress off the
 * TTL instead would have stretched a 600ms shockwave to 900 as a side effect
 * of a change that is about debris — the same reason drawShardBurst runs its
 * core flash on a fixed millisecond clock rather than a fraction of a TTL.
 */
const EXPLOSION_RING_MS = 600;
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
  const t = clamp01((now - e.t0) / EXPLOSION_RING_MS);
  if (t >= 1) return;

  // The ring burns in what went off, where the event says so. A volatile pop's
  // shockwave in hazard yellow-green and a demolition charge's in fire amber
  // is the same read the debris carries, and the two halves of one blast
  // disagreeing about its colour would be worse than either choice alone.
  const ringColor = e.color ? blastHue(e.color) : EXPLOSION_RING_COLOR;
  const radius = e.r * (EXPLOSION_RADIUS_BASE_FRAC + EXPLOSION_RADIUS_GROWTH_FRAC * easeOutCubic(t));

  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = ringColor;
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
  const spark = getSprite(`spark|${ringColor}`, sparkSide, sparkSide, (c) => {
    c.shadowColor = ringColor;
    c.shadowBlur = EXPLOSION_SPARK_GLOW;
    c.fillStyle = ringColor;
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

// ---------------------------------------------------------------------------
// PIXEL DEBRIS — the wreckage a detonation throws.
//
// WHAT IT IS. Every blast that names a colour (fx.ts's explosion.color: a
// volatile pop, a demolition charge, cargo the intake ate) sprays chunky
// axis-aligned squares out of its centre in three bands — sparks, shrapnel,
// embers — each with its own speed, size, gravity and life. Squares on a fixed
// world-pixel lattice rather than sprites, because the game's language is
// pixel/CRT neon and a square that is honestly two world px wide, drawn on the
// same lattice as its neighbours, is the only thing that reads as a PIXEL
// rather than as a small picture of one.
//
// WHY THERE IS NO PARTICLE POOL. The obvious build is an array of particle
// objects integrated once per frame and recycled through a free list. This
// file does not do that, and the reason is the sentence at the top of
// drawEffects: the FX layer is a pure function of (effects, now). Every
// particle's position here is a CLOSED FORM of (event seed, index, elapsed) —
// p = p0 + v·ease(t) + g·t² — so:
//
//   • there is nothing to allocate, not even a pool. A pool has zero churn
//     once warm; this has zero churn including the first frame, and no live
//     array to keep in sync with an event list that Game prunes underneath it.
//   • frame-rate independence is not a property that had to be arranged. A
//     particle at elapsed=300ms is in the same place whether the renderer got
//     there in 18 frames at 60Hz, 36 at 120Hz, or one frame after a stall.
//     An integrator would have had to be fed a dt and would have drifted
//     between the two.
//   • it settles by construction. The event dies at FX_TTL.explosion and the
//     debris dies with it — there is no state left holding anything alive.
//   • idle cost is one array-length test. No live blasts, no work at all.
//
// WHAT IT COSTS, AND THE TWO THINGS THAT BOUND IT. Per band the drawer issues
// ONE beginPath, N rect()s and ONE fill — so a 60-particle blast is 3 fills,
// not 60 fillRects, and the rasteriser gets three batches instead of sixty
// draws. Above that sits DEBRIS_FRAME_CAP, a ceiling on particles across ALL
// live blasts in a frame; over it, every blast in the frame is scaled by one
// shared factor rather than the late ones being dropped, so a chain detonation
// thins evenly instead of some pops spraying and others not.
// ---------------------------------------------------------------------------

/** World px the debris lattice snaps to. Every particle's centre is rounded to
 *  a multiple of this before it is drawn, so a spray reads as one grid of lit
 *  cells rather than as N independently-positioned squares — which is the
 *  difference between "pixels" and "small rectangles". 2 rather than 1 because
 *  at the viewport scales the layout solver produces (~0.6-1.6 world px per CSS
 *  px) a 1px lattice is finer than the display can resolve and the effect
 *  degrades into the smooth motion it is trying not to be. */
const DEBRIS_PIXEL = 2;

/**
 * Particles per world px of blast radius.
 *
 * Radius is the right dial because it is already the honest picture of what a
 * blast destroyed (game.ts's detonate sizes it off the kill radius, and the
 * shove ring rides on the same number). At 2.0 the two blasts the player meets
 * most often spend a full allowance — a demolition charge (r = CELL * 2.4 =
 * 96) wants 192 and takes the 180 the per-blast cap allows, a volatile pop
 * (r = 89.6) throws 179 — while the intake's much smaller per-cube blast
 * (r = 34) throws 68, so a four-cube shipment clipping the plant's roof spends
 * 272 rather than four full sprays' worth.
 *
 * 2.0 rather than the 1.05 this was first drawn at, and the first cut is worth
 * recording because the brief was "lots": at ~94 particles a volatile pop was a
 * scatter of squares you could count, which reads as a glitch rather than as a
 * detonation. Doubling it is what turned the same geometry into a spray, and it
 * cost 0.8ms on the worst frame the game can build (sim/renderperf --boom).
 */
const DEBRIS_PER_RADIUS_PX = 2.0;
/** Floor, so the smallest blast still reads as a burst and not as a handful of
 *  stray dots. */
const DEBRIS_MIN = 26;
/** Ceiling per blast. */
const DEBRIS_MAX = 180;
/**
 * Ceiling on particles across every live blast in ONE frame.
 *
 * The stress case is a chain detonation on a volatile-heavy belt: one pop razes
 * its neighbours, they land hard, and four or five blasts are live in the same
 * frame with a full pile under them. Four volatile pops and a charge want 896,
 * which is well over this, and that is the point — 560 is a hard number rather
 * than a hopeful one. Over it, `squeeze` scales every blast in the frame down
 * TOGETHER (see drawExplosionDebris) so a chain thins evenly instead of the
 * first pops spraying and the last ones arriving empty.
 *
 * MEASURED, not guessed. sim/renderperf --probe --boom counts the frame that
 * chain actually issues: 392 rect()s in 11 fills (a band that has expired
 * issues neither), on top of the 82 drawImages a 150-cube bay was already
 * paying. --breakdown puts the whole effects layer at 1.700ms with the debris
 * and 0.900ms with it removed by prefers-reduced-motion, so the ceiling above
 * is worth ~0.8ms of a 16.67ms frame at its most expensive.
 */
export const DEBRIS_FRAME_CAP = 560;

/** One band of a spray: a population of particles that behave alike, and are
 *  therefore drawable in one path. The three of them ARE the design — a blast
 *  reads as an explosion rather than as a starburst because the fast bright
 *  bit, the thrown bit and the falling bit have different physics. */
interface DebrisBand {
  /** Share of the blast's particle count. The last band takes the remainder,
   *  so the shares never have to sum to exactly 1 in floating point. */
  share: number;
  /** How long the band lives, in ms. Never more than FX_TTL.explosion, which
   *  is when Game prunes the event out from under it. */
  ms: number;
  /**
   * How long the OUTWARD throw takes, in ms — and the single most important
   * number in this table.
   *
   * It is much shorter than `ms` on purpose. Debris leaves a blast fast and
   * then hangs and falls; spreading the travel across the band's whole life
   * instead (which the first cut of this did, by easing on the band's own
   * progress) drew shrapnel that was still crawling outward past the shockwave
   * ring at 110ms, so the ring overtook its own wreckage and the blast read as
   * a ring with a smudge in the middle. Throwing in ~240ms and then coasting
   * is what puts the material OUTSIDE the ring, which is the picture.
   */
  flingMs: number;
  /** Reach at the end of the throw, as a multiple of the blast radius. */
  speed: number;
  /** How much of `speed` the per-particle hash may take away. Without it the
   *  even angular fan draws a perfect expanding ring — a diagram, not a burst. */
  spread: number;
  /** World px of sag at the band's own end, applied as t² so the arc reads as
   *  a throw that is now falling. */
  gravity: number;
  /** Square edge in world px. Even, so a centred square lands on the lattice. */
  px: number;
  /** Index into the blast's colour ramp. */
  stop: 0 | 1 | 2;
  /** Drawn with "lighter", for the band that is meant to bloom. */
  additive: boolean;
  /** Flickers on its own millisecond clock — the cooling read. */
  flicker: boolean;
}

/**
 * The three bands, fastest first.
 *
 * SPARKS are the muzzle-flash instant: smallest, thrown furthest, gone inside
 * a quarter second, additive so they bloom white-hot over whatever they cross,
 * and weightless — nothing that dies this fast has time to fall. They carry
 * the BANG, and they are the band that reaches past the shockwave ring.
 *
 * SHRAPNEL is the body of the spray and the only band drawn large: 6px squares
 * are 15% of a cube's edge, chunky enough to read as thrown material at the
 * scale a 40px cube establishes. Thrown just inside the sparks, then coasting
 * and sagging for another third of a second.
 *
 * EMBERS are what is left: thrown least, bent hardest by gravity, alive for the
 * whole event, guttering as they fall. They are the reason FX_TTL.explosion is
 * 900 and not 600 — the ring is long gone while these are still coming down.
 */
const DEBRIS_BANDS: readonly DebrisBand[] = [
  { share: 0.36, ms: 260, flingMs: 240, speed: 2.30, spread: 0.50, gravity: 0, px: 3, stop: 0, additive: true, flicker: false },
  { share: 0.40, ms: 620, flingMs: 250, speed: 1.70, spread: 0.55, gravity: 46, px: 6, stop: 1, additive: false, flicker: false },
  { share: 0.24, ms: 900, flingMs: 320, speed: 1.05, spread: 0.60, gravity: 150, px: 4, stop: 2, additive: false, flicker: true },
];

/** Ember flicker, in radians of phase per ms — about 5.7 cycles a second, fast
 *  enough to read as guttering and slow enough not to strobe. A function of
 *  `elapsed`, so like everything else here it is identical at 60 and 120Hz. */
const EMBER_FLICKER_RAD_PER_MS = 0.036;
const EMBER_FLICKER_DEPTH = 0.28;

/** Blend two #rrggbb values, `k` of the way from `hex` toward `to`. */
function mixHex(hex: string, to: number, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  let out = "#";
  for (let sh = 16; sh >= 0; sh -= 8) {
    const a = (n >> sh) & 255;
    const b = (to >> sh) & 255;
    out += Math.round(a + (b - a) * k).toString(16).padStart(2, "0");
  }
  return out;
}

/** Peak channel a blast colour is lifted to before anything is drawn in it.
 *  Tar's authored hue is #241f2e — "an absence", which is exactly right for a
 *  cube sitting in the pile and exactly wrong for wreckage in flight, where it
 *  is a black square on a near-black field. Same argument and the same floor as
 *  theme.ts's shipmentAura, applied to a raw hex because a blast knows its
 *  colour and not the (type, material) pair it came from. */
const BLAST_HUE_FLOOR = 0.55;

/** Per-colour caches. Keyed by the event's own colour string, which comes from
 *  a fixed palette (seven shipment hues, six materials, the demolition amber),
 *  so these are bounded by the palette and not by play. Resolution-independent
 *  — unlike the sprite caches they survive a re-bake, because a colour is not
 *  a rasterisation. */
const blastHues = new Map<string, string>();
const debrisRamps = new Map<string, readonly [string, string, string]>();

function blastHue(color: string): string {
  const hit = blastHues.get(color);
  if (hit !== undefined) return hit;
  let out = color;
  if (color.length === 7 && color.charCodeAt(0) === 35) {
    const n = parseInt(color.slice(1), 16);
    const peak = Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255) / 255;
    if (peak > 0 && peak < BLAST_HUE_FLOOR) out = mixHex(color, 0xffffff, 1 - peak / BLAST_HUE_FLOOR);
  }
  blastHues.set(color, out);
  return out;
}

/**
 * The three fills one blast's spray is drawn in: hot, body, cooling.
 *
 * Built once per colour and held, because a `#rrggbb` string built inside the
 * draw loop is exactly the per-frame allocation this layer is otherwise
 * careful not to make — three strings × every live blast × 60Hz.
 */
function debrisRamp(color: string): readonly [string, string, string] {
  const hit = debrisRamps.get(color);
  if (hit) return hit;
  const hue = blastHue(color);
  const ramp = [
    // Nearly white but still tinted, so a volatile spark and a demolition
    // spark are told apart at the instant they are brightest.
    mixHex(hue, 0xffffff, 0.72),
    // The material itself, lifted just enough to survive being drawn over a
    // glowing pile.
    mixHex(hue, 0xffffff, 0.16),
    // Cooled toward a warm coal rather than toward black: an ember is a dying
    // fire, and mixing to #000 turns the last third of every spray into
    // silhouettes.
    mixHex(hue, 0x2a1206, 0.40),
  ] as const;
  debrisRamps.set(color, ramp);
  return ramp;
}

/** 32-bit integer mix (Math.imul keeps every step exact at 32 bits, which a
 *  plain `*` does not). The per-particle source of variation — no Math.random,
 *  because a frame drawn twice with the same `now` must be the same frame:
 *  sim/renderperf --snapshot diffs exactly that, and drawEffects' purity
 *  contract promises it. */
function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Particles one blast of radius `r` wants, before the frame cap has its say.
 *  Exported for sim/systems.ts, which pins the cap arithmetic in node. */
export function debrisCount(r: number): number {
  return Math.max(DEBRIS_MIN, Math.min(DEBRIS_MAX, Math.round(r * DEBRIS_PER_RADIUS_PX)));
}

const TAU = Math.PI * 2;

/** One blast's spray. `n` is what the frame cap ALLOWED, which may be less
 *  than debrisCount(r) asked for. */
function drawDebrisBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  elapsed: number,
  n: number,
): void {
  if (n <= 0) return;
  const ramp = debrisRamp(color);
  // Seeded off the blast's own position, exactly as seedAngle is, so two pops
  // in the same frame throw differently and one pop looks the same every time
  // it is drawn.
  const seed = hash2(Math.round(x), Math.round(y));

  let from = 0;
  for (let b = 0; b < DEBRIS_BANDS.length; b++) {
    const band = DEBRIS_BANDS[b];
    const count = b === DEBRIS_BANDS.length - 1
      ? n - from
      : Math.round(n * band.share);
    const start = from;
    from += count;
    if (count <= 0) continue;
    const bt = elapsed / band.ms;
    // A dead band is skipped, not drawn at zero alpha: the sparks are gone for
    // three quarters of every blast, and that is three quarters of a
    // beginPath/fill pair and `count` rect calls not issued.
    if (bt >= 1) continue;

    let alpha = 1 - bt * bt;
    if (band.flicker) {
      alpha *= 1 - EMBER_FLICKER_DEPTH
        + EMBER_FLICKER_DEPTH * Math.sin(elapsed * EMBER_FLICKER_RAD_PER_MS);
    }
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = band.additive ? "lighter" : "source-over";
    ctx.fillStyle = ramp[band.stop];

    // Two clocks, and the split is the whole reason this reads as a throw: the
    // travel runs out on `flingMs` and then stops, while the sag keeps
    // accumulating on the band's full life. Debris that is done flying is not
    // done falling.
    const reach = r * band.speed * easeOutCubic(clamp01(elapsed / band.flingMs));
    const sag = band.gravity * bt * bt;
    // An EVEN fan plus a bounded jitter, rather than free random angles: a
    // uniform draw clumps at these counts and leaves holes the eye reads as a
    // direction the blast did not have. The jitter is half a slot either way,
    // which is as much scatter as an even fan can take without re-clumping.
    const slot = TAU / count;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const h = hash2(seed, start + i);
      const angle = i * slot + (((h & 1023) / 1024) - 0.5) * slot;
      const speed = 1 - band.spread * (((h >>> 10) & 255) / 255);
      // Per-particle fall rate, so the band's embers do not descend as a sheet.
      const fall = 0.55 + (((h >>> 18) & 127) / 127) * 0.9;
      // Two sizes inside one band, one lattice step apart. Free — a path can
      // hold rects of different sizes, and only the FILL is per-band — and it
      // is what stops a spray reading as one stencil stamped N times.
      const side = band.px + ((h >>> 25) & 1) * DEBRIS_PIXEL;
      const px = x + Math.cos(angle) * reach * speed;
      const py = y + Math.sin(angle) * reach * speed + sag * fall;
      // The CORNER is snapped, not the centre: that keeps odd-sided squares on
      // the same lattice as even-sided ones, so the two sizes in a band read as
      // pixels of one grid rather than as two grids half a step apart.
      ctx.rect(
        Math.round((px - side / 2) / DEBRIS_PIXEL) * DEBRIS_PIXEL,
        Math.round((py - side / 2) / DEBRIS_PIXEL) * DEBRIS_PIXEL,
        side, side,
      );
    }
    ctx.fill();
  }
}

/**
 * Every live blast's debris, in one pass.
 *
 * Called from render() BETWEEN the pile and the aim furniture — over the cargo
 * (debris in front of what it came out of) and under the cushion edge, the
 * incinerator plane, the trajectory dots and the cannon. That position is the
 * readability constraint made structural: the player is aiming THROUGH this,
 * and a spray of 240 squares drawn last would put pixels over the one line on
 * the field that the next shot depends on.
 *
 * REDUCED MOTION removes the layer outright rather than thinning it. Everything
 * this function adds is motion — flung squares, falling embers, a flicker — so
 * "fewer of them" is a smaller dose of the exact thing the preference asks not
 * to be shown. What remains is the shockwave (ring, flash, orbiting sparks),
 * which is what a blast looked like before this layer existed and still says
 * everything the player needs to know about it.
 */
function drawExplosionDebris(
  ctx: CanvasRenderingContext2D,
  effects: FxEvent[],
  now: number,
): void {
  if (effects.length === 0) return;
  if (prefersReducedMotion()) return;

  // Pass one: what the frame WANTS. Cheap — a walk of an array that holds a
  // handful of events at its busiest — and it is what lets the cap scale every
  // blast by one shared factor instead of starving whichever ones happen to
  // sort last.
  let want = 0;
  for (const e of effects) {
    if (e.kind !== "explosion" || !e.color) continue;
    const elapsed = now - e.t0;
    if (elapsed < 0 || elapsed >= FX_TTL.explosion) continue;
    want += debrisCount(e.r);
  }
  if (want === 0) return;
  const squeeze = want > DEBRIS_FRAME_CAP ? DEBRIS_FRAME_CAP / want : 1;

  ctx.save();
  for (const e of effects) {
    if (e.kind !== "explosion" || !e.color) continue;
    const elapsed = now - e.t0;
    if (elapsed < 0 || elapsed >= FX_TTL.explosion) continue;
    drawDebrisBurst(
      ctx, e.x, e.y, e.r, e.color, elapsed,
      Math.floor(debrisCount(e.r) * squeeze),
    );
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// THE THAW LANCE'S CUE (fx.ts's `thaw`, spawned by game.ts's useThawLance).
//
// WHAT IT HAS TO DO, and why it is the hardest cue in the game to draw. One
// charge takes one cube from "will not sell this row" to "will", and NOTHING
// ELSE ON THE FIELD MOVES when it does: no cube is destroyed, no row lights, no
// piece falls, no money floats. The only lasting evidence is a face that is now
// drawn differently, on a cube the player was not necessarily looking at. Every
// other effect in this file gets to point at something that happened; this one
// has to be the thing that happened.
//
// The old cue did not try. It was an uncoloured `explosion` at CELL * 0.9 — a
// ring reaching 43 world px inside a pile of 40px cubes, over in 600ms, drawn
// in BLAST_AMBER because that is what an uncoloured explosion is drawn in. The
// owner's report ("need a bigger visual queue for the thawing action") is what
// a filmstrip of it shows exactly: sim/uifit/thaw-shots.ts, desk-120ms.
//
// SO IT IS BUILT AROUND FINDING THE CUBE. Three layers, each answering a
// different distance, and the split is the design:
//
//   THE RING says OVER HERE, from across the bay. It reaches THAW_REACH, and
//     it is a HEXAGON: ice grows in facets and pressure expands as a circle, so
//     the six-fold ring is what stops the cue reading as a small shockwave at
//     the exact distance where its colour has stopped being legible. Its
//     corners sit on the star's own axes, so the two layers are one crystal.
//   THE STAR says THIS CUBE. Six spokes thrown out along the cryo glyph's own
//     axes — the mark on the face, briefly drawn at bay scale, which is the
//     frost leaving. It is the layer that survives being seen out of the corner
//     of an eye, because a six-fold star is a shape and a ring is a size.
//   THE BLOOM says NOW. A short ice-white core over the cube itself: the frame
//     the eye lands on once the ring has pulled it here.
//
// COLD, NOT FIERY — a constraint, not a preference. The explosions pass left
// the lance shockwave-only on purpose (fx.ts's note on explosion.color), because
// a phase change that threw burning wreckage would be teaching the wrong verb.
// Everything here burns in cryo's own ice, the plume is frost rather than
// embers, and the single additive layer blooms white the way ice glare does.
// ---------------------------------------------------------------------------

/** The ice the whole cue burns in: cryo's OWN material colour, read out of the
 *  table rather than restated here, so the cue and the cargo it melts cannot
 *  drift apart. The piece type is arbitrary — cryo overrides the shape colour
 *  outright (theme.ts's MATERIAL_SPEC), which is exactly why this is the honest
 *  way to ask for it without a second literal of the hex. */
const THAW_ICE = shipmentColor("O", "cryo");

/**
 * How far the cue reaches, in world px.
 *
 * CELL * 2.6 = 104, against the old ring's 43 (CELL * 0.9 grown by the
 * explosion's own 0.25 + 0.95 easing): 2.4x the radius and 5.8x the area.
 *
 * The ceiling is the Bond Breaker's CELL * 3.2, which is the widest ring the
 * game draws and means "the whole pile just changed". A lance changes one cube,
 * so it must not claim that — but it fires INTO a pile, and anything much under
 * two cells is a ring the pile itself hides. 2.6 is the largest reach that
 * still reads as smaller than a discharge when the two are seen a minute apart.
 */
export const THAW_REACH = CELL * 2.6;

/** The ring, star and bloom's own clock, in ms — FX_TTL.thaw is 900 and the
 *  gap is the frost plume outliving them, exactly as EXPLOSION_RING_MS is the
 *  shockwave's clock inside a 900ms blast. 700 against the shockwave's 600
 *  because this cue has no debris field to hold the eye afterwards and a
 *  quarter-second event on a static field reads as a glitch. */
export const THAW_REACH_MS = 700;

/** Ring radius at t=0, as a fraction of THAW_REACH: it starts a cube wide
 *  rather than at a point, so the first frame already sits ON the cube. */
const THAW_RING_BASE_FRAC = 0.22;
const THAW_RING_W_MAX = 9;
const THAW_RING_W_MIN = 2;
/** Width of the ring's translucent halo under-stroke, world px. Same trick and
 *  the same reason as the shockwave's: the radius changes every frame, so this
 *  cannot bake, and shadowBlur on a growing arc is the widest live blur there
 *  is. */
const THAW_RING_HALO_W = 14;
const THAW_RING_HALO_ALPHA = 0.3;

/** Six, on the vertical and the two ~30° diagonals — MATERIAL_GLYPH.cryo's own
 *  axes, so the star thrown across the pile is the mark that was on the face.
 *  The half-slot offset is what puts a spoke on the vertical. */
const THAW_SPOKES = 6;
/** How far past the ring the spoke tips run. Just outside: a star whose points
 *  sit exactly on the ring reads as a wheel, and one far outside stops being
 *  attached to it. */
const THAW_SPOKE_LEAD = 1.16;
/** Where the spokes start, in world px from the cube's centre — its own corner,
 *  so they read as leaving the cube rather than crossing it. */
const THAW_SPOKE_ROOT = CELL * 0.55;
const THAW_SPOKE_W_MAX = 7;
const THAW_SPOKE_W_MIN = 1.5;

/** Axis `i` of the cue's crystal, in radians. The half-slot offset is what puts
 *  an axis on the vertical, which is the orientation MATERIAL_GLYPH.cryo is
 *  authored in — so the ring's corners, the star's spokes and the mark on the
 *  cube's own face are all one set of directions. */
function spokeAngle(i: number): number {
  return Math.PI / THAW_SPOKES + i * (TAU / THAW_SPOKES);
}

/** How long the ice-white core burns, as a fraction of THAW_REACH_MS. */
const THAW_BLOOM_T = 0.22;
const THAW_BLOOM_HALO_R = CELL * 0.95;
const THAW_BLOOM_HALO_ALPHA = 0.55;
const THAW_BLOOM_CORE_R = CELL * 0.45;

/**
 * THE FROST PLUME — the cue's one motion layer, and the cold answer to the
 * blast debris.
 *
 * ONE BAND, where a detonation has three, and the asymmetry is the point.
 * DEBRIS_BANDS is three populations because a blast IS three things at once (a
 * flash, a throw and a fall) and reads as an explosion only when they behave
 * differently. A thaw is one thing: ice coming off a face. So it gets one
 * population — thrown gently, sagging, guttering out — and adding a second
 * would be inventing structure the event does not have.
 *
 * Small enough to draw with the rest of the effects layer rather than in
 * drawExplosionDebris' own pass: that pass exists because 240 lit squares must
 * not cover the trajectory line, and THAW_MOTES is 18 of them.
 */
const THAW_MOTES = 18;
const THAW_MOTE_FLING_MS = 300;
const THAW_MOTE_REACH_FRAC = 0.78;
const THAW_MOTE_SPREAD = 0.55;
/** World px of sag by the plume's end. Half the embers' 150: frost falls off a
 *  cube, it is not thrown off one. */
const THAW_MOTE_GRAVITY = 74;
const THAW_MOTE_PX = 4;

/** The plume's squares, on the same lattice and from the same hash as the
 *  blast debris — see DEBRIS_PIXEL and hash2 for why both. */
function drawThawMotes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsed: number,
): void {
  const bt = elapsed / FX_TTL.thaw;
  if (bt >= 1) return;
  const seed = hash2(Math.round(x), Math.round(y));
  const reach = THAW_REACH * THAW_MOTE_REACH_FRAC
    * easeOutCubic(clamp01(elapsed / THAW_MOTE_FLING_MS));
  const sag = THAW_MOTE_GRAVITY * bt * bt;
  const slot = TAU / THAW_MOTES;
  ctx.save();
  ctx.globalAlpha = 1 - bt * bt;
  ctx.fillStyle = THAW_ICE;
  ctx.beginPath();
  for (let i = 0; i < THAW_MOTES; i++) {
    const h = hash2(seed, i);
    const angle = i * slot + (((h & 1023) / 1024) - 0.5) * slot;
    const speed = 1 - THAW_MOTE_SPREAD * (((h >>> 10) & 255) / 255);
    const fall = 0.55 + (((h >>> 18) & 127) / 127) * 0.9;
    const side = THAW_MOTE_PX + ((h >>> 25) & 1) * DEBRIS_PIXEL;
    const px = x + Math.cos(angle) * reach * speed;
    const py = y + Math.sin(angle) * reach * speed + sag * fall;
    ctx.rect(
      Math.round((px - side / 2) / DEBRIS_PIXEL) * DEBRIS_PIXEL,
      Math.round((py - side / 2) / DEBRIS_PIXEL) * DEBRIS_PIXEL,
      side, side,
    );
  }
  ctx.fill();
  ctx.restore();
}

/**
 * REDUCED MOTION keeps the whole cue and takes only the travel out of it.
 *
 * The blast debris is removed outright under the preference because everything
 * in it is motion and "fewer flung squares" is a smaller dose of exactly what
 * was asked not to be shown. This cue cannot take that ruling: strip its motion
 * and there is no cue at all, because the state it announces has no other
 * herald — the cube's face simply differs between two frames nobody was
 * watching. A player who asked for less motion asked for less motion, not to be
 * told less about their own bay.
 *
 * So under the preference the plume goes — thrown, falling squares are the one
 * layer that is nothing but travel — and the crystal is drawn AT FULL REACH
 * from its first frame and fades in place. What is left is a static six-spoke
 * mark over the cube, going out over the same 700ms: the same picture the cue
 * ends on, arrived at without a sweep. Opacity is the substitute the preference
 * asks for, and it is the whole of what is left here.
 */
function drawThawFx(
  ctx: CanvasRenderingContext2D,
  e: Extract<FxEvent, { kind: "thaw" }>,
  now: number,
): void {
  const elapsed = now - e.t0;
  if (elapsed < 0) return;
  const calm = prefersReducedMotion();
  const t = clamp01(elapsed / THAW_REACH_MS);

  if (t < 1) {
    // HOLDS, THEN GOES. A shockwave fades linearly because a blast's story is
    // told in its first hundred milliseconds and the ring is the receipt. This
    // cue's story IS the reach — the ring is the layer that says "over here" —
    // so a linear fade spends its brightest frames on the smallest circle and
    // draws the widest one at almost nothing. 1 - t² keeps it at 75% while it
    // grows through the first half and gives the whole fall back at the end.
    const fade = 1 - t * t;
    const grown = THAW_RING_BASE_FRAC + (1 - THAW_RING_BASE_FRAC) * easeOutCubic(t);
    const radius = calm ? THAW_REACH : THAW_REACH * grown;

    ctx.save();
    ctx.strokeStyle = THAW_ICE;
    ctx.lineCap = "round";

    // THE RING — six-sided, with a corner on each of the star's axes.
    const ringW = THAW_RING_W_MAX * fade + THAW_RING_W_MIN;
    ctx.beginPath();
    for (let i = 0; i < THAW_SPOKES; i++) {
      const a = spokeAngle(i);
      const px = e.x + Math.cos(a) * radius;
      const py = e.y + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = fade * THAW_RING_HALO_ALPHA;
    ctx.lineWidth = ringW + THAW_RING_HALO_W;
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.lineWidth = ringW;
    ctx.stroke();

    // THE STAR. One path, six spokes, stroked once — the tips lead the ring
    // slightly so the mark is read before the circle it sits in.
    const tip = radius * THAW_SPOKE_LEAD;
    ctx.lineWidth = THAW_SPOKE_W_MAX * fade + THAW_SPOKE_W_MIN;
    ctx.beginPath();
    for (let i = 0; i < THAW_SPOKES; i++) {
      const a = spokeAngle(i);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.moveTo(e.x + cos * THAW_SPOKE_ROOT, e.y + sin * THAW_SPOKE_ROOT);
      ctx.lineTo(e.x + cos * tip, e.y + sin * tip);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (!calm) drawThawMotes(ctx, e.x, e.y, elapsed);

  // THE BLOOM, last so the cube itself is the brightest thing in the cue: an
  // ice halo growing as it fades, with a white core inside it. Additive, which
  // is what makes it read as glare on ice rather than as a white disc pasted
  // over the cargo it is supposed to be lighting.
  if (t < THAW_BLOOM_T) {
    const b = 1 - t / THAW_BLOOM_T;
    // Under the preference the two discs hold their size and only fade, for
    // the same reason the crystal above does not sweep: a radius that changes
    // per frame is motion however short it is, and opacity says the same thing.
    const halo = calm ? 1 : 1.25 - b * 0.45;
    const core = calm ? 1 : b;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = b * THAW_BLOOM_HALO_ALPHA;
    ctx.fillStyle = THAW_ICE;
    ctx.beginPath();
    ctx.arc(e.x, e.y, THAW_BLOOM_HALO_R * halo, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = b;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(e.x, e.y, THAW_BLOOM_CORE_R * core, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
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
      case "thaw":
        drawThawFx(ctx, e, now);
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
