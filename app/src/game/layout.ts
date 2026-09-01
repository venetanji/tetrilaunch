import { WORLD } from "./engine";

/**
 * VIEWPORT LAYOUT — where the 1280x720 world sits, and where the chrome goes.
 *
 * The field is authored at a fixed 16:9 and letterboxed, and the HUD chrome was
 * built on the assumption that letterboxing LEAVES A GUTTER to put controls in.
 * That assumption only holds on ultrawide displays. Worked through:
 *
 *   21:9 phone (2.33)   -> ~150px side gutters. Rail fits. Fine.
 *   19.5:9 phone (2.17) -> ~120px side gutters. Rail fits. Fine.
 *   16:9 (1.778)        -> ZERO gutter on all four sides. The old CSS clamped
 *                          the rail to its 44px floor and pinned it 8px from
 *                          the viewport edge, i.e. directly ON TOP of the
 *                          field's right wall and the pile behind it.
 *   16:10 laptop (1.6)  -> 50px top/bottom gutter, no side gutter. Same
 *                          overlap, and a vertical rail can't use a horizontal
 *                          band anyway.
 *   4:3 tablet (1.333)  -> ~96px top/bottom gutter, no side gutter. A tall
 *                          unused band above and below the field while the
 *                          buttons crowd the play area.
 *
 * So: solve the layout instead of assuming it. computeLayout picks one of three
 * modes and, crucially, RESERVES the band it needs BEFORE fitting the world —
 * so in the tight cases the field scales down a few percent and the controls
 * get real space, instead of the field keeping every pixel and the controls
 * being drawn over it.
 *
 *   "wide" — a side gutter already fits the rail. Vertical rail, right gutter,
 *            nothing reserved. (Ultrawide phones, most landscape handsets.)
 *   "tall" — a top/bottom gutter already fits a horizontal bar. The rail
 *            becomes a horizontal strip centered in the bottom band, which is
 *            also a better thumb reach on a tablet than a far-right column.
 *   "snug" — neither gutter fits anything (near-16:9). Reserve a right band and
 *            refit the world into what's left; vertical rail in the reserved
 *            band. Costs ~6% of field scale at 16:9 and buys back the entire
 *            play area.
 *
 * Safe-area insets (iOS notch/home indicator, which in LANDSCAPE eat the left
 * or right edge, not the top) are subtracted from the usable box first, in every
 * mode — so the field never sits under the notch and the rail never sits under
 * the home indicator.
 *
 * Everything downstream reads this one solver: the canvas transform and
 * screenToWorld (render.ts's computeViewport delegates here, so input mapping
 * can never disagree with what was drawn) and the DOM chrome (main.ts publishes
 * the result as --field-* / --rail-* custom properties).
 */
export type LayoutMode = "wide" | "snug" | "tall";

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/** Rail button edge length bounds (CSS px). The floor is WCAG 2.5.5 / iOS HIG's
 *  44px minimum tap target — the rail is allowed to shrink to it and no
 *  further, which is precisely why "snug" has to reserve space rather than
 *  squeeze. */
export const RAIL_MIN = 44;
export const RAIL_MAX = 60;
/** Breathing room between the rail and both the field edge and the viewport
 *  edge. A gutter must fit RAIL_MIN + this to count as usable. */
const RAIL_PAD = 12;

/** Buttons the rail carries on every loadout: fullscreen, pause, rotate CCW,
 *  rotate CW. Fullscreen is the one conditional member — where the toggle
 *  can't do anything (the native shells, iPhone Safari — see platform.ts's
 *  fullscreenSupported) it isn't rendered at all, and RailLoadout.fullscreen
 *  subtracts its slot so the budget matches the buttons actually on screen.
 *  The aim-state cancel ✕ does not add a slot: it swaps into the pause
 *  button's slot while a drag is live (see app.css's .hud--aiming rules), so
 *  the column's geometry never changes mid-gesture. */
export const RAIL_SLOTS_BASE = 4;
/** ...plus up to three drafted abilities (Bond Breaker, Demolition, the
 *  Autoloader trigger) — the most the solver can ever be asked to budget.
 *
 *  History: this was a fixed worst-case constant (7, then 8 when the
 *  Autoloader and the cancel ✕ were counted). Budgeting the worst case
 *  permanently priced the vertical rail off every 360dp-tall landscape phone
 *  — an 8-slot column at the 44px floor needs 410px — so the most common
 *  Android class got the bottom-strip fallback and a ~19% smaller field for
 *  buttons that mostly weren't on screen. The budget is now the loadout the
 *  run actually has (railSlotsFor + setRailSlots below).
 *
 *  EIGHT since the Thaw Lance (upgrades.ts) added a fourth ability trigger, and
 *  the number above is exactly why that is safe now and was not before. The
 *  worst case is back at 8 and the 410px arithmetic has not changed — what
 *  changed is that only a run ACTUALLY carrying all four abilities pays it, and
 *  such a run takes the bottom-strip fallback on a 360dp phone rather than
 *  every run taking it for buttons it does not have. A run with three or fewer
 *  is budgeted at three or fewer, which is the whole point of the reform. */
export const RAIL_SLOTS_MAX = 8;

/** What the rail is being asked to hold right now. */
export interface RailLoadout {
  bond: boolean;
  demo: boolean;
  thaw: boolean;
  auto: boolean;
  /* NO `finePointer` HERE ANY MORE. It used to shed every game button on a
   * mouse/trackpad — the budget came out at fullscreen + pause — because
   * app.css hid them there and the desktop build taught its controls in a text
   * strip instead. That is gone: the rail is the action surface on every
   * pointer now, wearing a keycap and a pad mark per button, so the column a
   * desktop window has to stack is the same column a phone stacks and the
   * budget is a property of the LOADOUT alone.
   *
   * It cost nothing at any desktop size that has ever been measured, which is
   * the part worth writing down. "snug" reserves RAIL_MAX + 2*RAIL_PAD (84px)
   * for the band whatever the slot count, and railColumnCap only bites when
   * the column is taller than the window: at eight slots that needs 410px of
   * height, and the shortest browser row in the matrix is 600. Every web row
   * solves to the same mode, the same band and the same 60px button before and
   * after. A browser window dragged under ~410px tall does now take the
   * bottom-strip fallback — the same answer, for the same reason, that a
   * 360dp phone already gets. */
  /** Whether a fullscreen toggle is mounted at all. Defaults to true (the
   *  browser case); main.ts passes platform.ts's fullscreenSupported(), which
   *  is false in the native shells and on iPhone Safari — there screens.ts
   *  renders no fullscreen button, so the budget must not reserve its slot. */
  fullscreen?: boolean;
}

export function railSlotsFor(l: RailLoadout): number {
  const fs = l.fullscreen === false ? 0 : 1;
  return RAIL_SLOTS_BASE - 1 + fs
    + (l.bond ? 1 : 0) + (l.demo ? 1 : 0) + (l.thaw ? 1 : 0) + (l.auto ? 1 : 0);
}

/** Gap between rail buttons and the slack at both ends. The CSS reads the gap
 *  back as --rail-gap (published by main.ts's onResize), so the solver's fit
 *  prediction and the rendered stack cannot disagree. */
export const RAIL_GAP = 6;
/** Total slack the column budget keeps outside the buttons. The rail is
 *  TOP-ANCHORED in CSS (app.css's .side-rail), so 8px of this is the stack's
 *  distance from the top edge and the remainder falls below the last button —
 *  which is exactly where a run's undrafted ability slots sit. */
const RAIL_EDGE = 16;

/** Module-level slot budget, same pattern as the safe-area cache below:
 *  main.ts (and the uifit harness) set it whenever the HUD's loadout changes,
 *  and computeLayout — called per-frame from render.ts — reads it without
 *  re-deriving game state. Defaults to the worst case so callers that never
 *  set it (headless checks, first paint) stay conservative. */
let railSlots = RAIL_SLOTS_MAX;

/** Floor of ONE, not two. The smallest budget railSlotsFor can now return is
 *  three (pause + the rotate pair, on a shell that mounts no fullscreen
 *  toggle), so nothing in the app asks for one — but the floor's job is to keep
 *  the column arithmetic above zero for ANY caller, and a floor set to the
 *  smallest number the current call sites happen to produce is a floor that
 *  breaks the next time a call site changes. It was one when a fine pointer
 *  budgeted the pause button alone; it stays one now that nothing does. */
export function setRailSlots(n: number): void {
  railSlots = Math.max(1, Math.min(RAIL_SLOTS_MAX, Math.round(n)));
}

export function getRailSlots(): number {
  return railSlots;
}

/** Which edge the vertical rail lives on — the left-handed mirror (Controls
 *  screen). Solver state rather than a pure CSS flip because "snug" RESERVES
 *  a band for the rail: mirroring only the CSS would park the buttons on top
 *  of a field that had been shifted the other way. */
export type RailSide = "left" | "right";
let railSide: RailSide = "right";

export function setRailSide(s: RailSide): void {
  railSide = s;
}
/* No getRailSide: the solver reads the module-local `railSide` directly and
 * no caller outside this file ever needed it back — main.ts owns the setting
 * and already knows what it set. */

/** The largest button edge whose full column still fits `uh`. */
function railColumnCap(uh: number): number {
  return (uh - RAIL_EDGE - (railSlots - 1) * RAIL_GAP) / railSlots;
}

/**
 * How much room the CHROME has, as opposed to the field.
 *
 * "roomy"   — desktop and tablets. Everything renders at its authored size.
 * "regular" — the band where scaling alone is enough.
 * "compact" — every landscape phone. Scaling has bottomed out at UI_SCALE_MIN
 *             and anything that still doesn't fit has to RESTRUCTURE (two
 *             columns instead of one, a row instead of a card) rather than
 *             shrink further.
 */
export type Density = "compact" | "regular" | "roomy";

/** The box the chrome is authored against — every fixed px in app.css means
 *  what it says at exactly this size. 720 is the world's own height, which is
 *  also roughly where the old hand-tuned `max-height` breakpoint stack used to
 *  start firing.
 *
 *  It is a REFERENCE, not a ceiling. Below it the chrome shrinks (uiScale);
 *  above it the chrome is magnified (chromeZoom) so a desktop window renders
 *  the same layout the reference box does, just bigger. */
const UI_REF_H = 720;
const UI_REF_W = 1000;

/** The floor. Below this, shrinking type and padding stops buying fit and
 *  starts costing legibility and tap targets — measured against the 44px
 *  minimum, a button cannot get its label inside 44px of height much under
 *  0.72 of the authored scale. Under the floor the answer is `density:
 *  "compact"` and a structural change, never a smaller font. */
export const UI_SCALE_MIN = 0.72;

/** The ceiling on the OTHER direction — see chromeZoom below.
 *
 *  2 is one doubling, which a 2560x1440 browser window reaches exactly and
 *  nothing short of it does. The cap is not about taste at 1440p (2x is
 *  right there); it is about the displays past it. A 4K panel with OS
 *  scaling off reports 3840x2160 CSS px and would otherwise ask for 3x, which
 *  renders a menu button at its 132px cap 396 device px tall — and the honest
 *  reading of a window that big is that the player is sitting further away
 *  from a display with more room, not that they want the chrome to keep pace
 *  forever. */
const UI_ZOOM_MAX = 2;

/** Above this, nothing is SHRUNK — the tier is `roomy` whether the box is the
 *  authored one or a magnified one, because both render the same layout and
 *  neither needs the compact tier's restructuring. */
const DENSITY_ROOMY = 0.995;

export interface Layout {
  mode: LayoutMode;
  /** Chrome bands deliberately reserved out of the viewport before fitting the
   *  world. Zero in "wide"/"tall" (a natural gutter is already doing the job). */
  reserve: Insets;
  /** Safe-area insets folded into the usable box. */
  safe: Insets;
  /** World->CSS px scale. */
  scale: number;
  /** World origin in CSS px (top-left of the drawn field). */
  ox: number;
  oy: number;
  /** Field size in CSS px. */
  fw: number;
  fh: number;
  /** Rail button edge length for this layout. */
  railSize: number;
  /** How far the chrome had to SHRINK to fit a viewport smaller than the
   *  authored box. 1 on anything at or above it, never below UI_SCALE_MIN.
   *  Not published to CSS: no rule reads a shrink factor — below the
   *  reference the answer is a structural change, and `density` is the
   *  channel that triggers one. */
  uiScale: number;
  /** ...and how far it is MAGNIFIED on a viewport bigger than the authored
   *  box. 1 at or below it, never above UI_ZOOM_MAX. Published as
   *  `--chrome-zoom` and consumed by app.css's `zoom` on the screen-anchored
   *  scaffolds, which is what stops a 1080p browser from rendering a layout
   *  measured for a 360px-tall phone at 1:1 and calling the result desktop
   *  support.
   *
   *  The two are complementary, never simultaneous: a viewport is either
   *  under the reference box or over it, so `uiScale < 1` implies
   *  `chromeZoom === 1` and vice versa. sim/systems asserts it. */
  chromeZoom: number;
  /** Coarse tier for rules that must SWITCH rather than scale (published as
   *  <html data-density>). */
  density: Density;
}

/**
 * One world px of overdraw above the canvas's first row.
 *
 * The sky's top edge is derived by dividing a CSS-px offset by a scale and
 * multiplying it back at draw time through a slightly different transform (the
 * device-pixel one, `scale * dpr`), so the round trip is not bit-exact. A
 * sub-pixel shortfall is not a harmless rounding error here: it is a one-device-
 * pixel line of raw backdrop across the top of the screen, which is a hairline
 * version of the exact defect this exists to remove. Overdrawing by a world px
 * costs nothing — everything above the canvas top is discarded by the
 * rasteriser — and removes the class of failure outright.
 */
const SKY_OVERDRAW = 1;

/**
 * How far ABOVE the world's own top edge the canvas reaches, in WORLD px.
 * Always <= 0; more negative means more open sky.
 *
 * The world is authored 1280x720 and letterboxed, and until now every layer was
 * clipped to that rect — so on any viewport whose fitted field did not fill the
 * height, the leftover was painted backdrop colour and nothing else. That reads
 * as a lid, and a lid is the one thing this field must not have: engine.ts
 * leaves the top boundary OPEN on purpose (a max-power lofted shot apexes ~250
 * world px above y=0 and falls back in, with the side walls extended to y=-SKY
 * so it cannot drift out sideways). The band was capping a shaft the physics
 * treats as unbounded, and the player noticed before the renderer did.
 *
 * It is a pure function of the transform the frame is drawn with — `oy` CSS px
 * down from the canvas top at `scale` CSS px per world px — so it cannot
 * disagree with computeLayout, and callers that already hold a Viewport
 * (render.ts, including the attract demo's fitViewport) need nothing new. Note
 * that it deliberately says nothing about the horizontal: the sky is the same
 * 1280-wide shaft the walls bound, not a full-canvas wash, because sideways is
 * exactly where the physics does NOT let a lofted piece go.
 */
export function skyTop(scale: number, oy: number): number {
  // No band, no sky, and NOT "no band, one px of sky": a viewport whose field
  // already fills the height (every landscape phone, layout.ts's "wide" mode)
  // must come out of this change pixel-identical, and returning the overdraw
  // there would lift the wall glow a world px for no reason at all. The
  // overdraw answers a rounding error that only exists when there is an `oy`
  // to divide and multiply back.
  if (!(oy > 0)) return 0;
  return -oy / Math.max(0.0001, scale) - SKY_OVERDRAW;
}

/** Module-level safe-area cache. Read from real CSS env() values once per
 *  resize by main.ts (see lib/platform's readSafeAreaInsets) and stashed here,
 *  because computeViewport is called on every frame and from input mapping —
 *  both of which need the same numbers without re-measuring the DOM. Defaults
 *  to zero so headless/test callers and the very first paint behave. */
let safeInsets: Insets = NO_INSETS;

export function setSafeAreaInsets(insets: Insets): void {
  safeInsets = insets;
}

export function getSafeAreaInsets(): Insets {
  return safeInsets;
}

/**
 * EVERYTHING computeLayout's answer is a function of.
 *
 * The solver is pure: hand it the same width, height and insets and it returns
 * the same Layout, every time. So "is the published layout still the right
 * one?" is not a question about events, timers or platform quirks — it is
 * whether a fresh reading of these six numbers still matches the reading the
 * published layout was made from. That framing is the whole point: it lets the
 * app re-solve on DISAGREEMENT rather than on notification, which is what makes
 * the recovery independent of which event a given WebView remembers to fire.
 */
export interface ViewportReading {
  /** window.innerWidth at the moment of the reading. */
  w: number;
  /** window.innerHeight likewise. */
  h: number;
  /** The safe-area insets measured alongside them (lib/platform's
   *  applySafeAreaInsets). Copied by value — the module cache above is
   *  overwritten in place on every measurement, so holding the same object
   *  would make every reading agree with every other one. */
  safe: Insets;
}

/** Half a CSS pixel. Below this nothing in the stylesheet or the solver can
 *  express a difference — `fit` divides by WORLD.width, the rail floors at a
 *  whole 44 — so a sub-pixel wobble in a WebView's reported innerHeight is
 *  noise, and re-solving on it would throw the canvas backing store away for a
 *  layout that came out identical. */
const READING_EPSILON = 0.5;

/** Copy a reading's insets by value. See ViewportReading.safe. */
export function readingOf(w: number, h: number, safe: Insets): ViewportReading {
  return { w, h, safe: { ...safe } };
}

const off = (a: number, b: number): boolean => Math.abs(a - b) >= READING_EPSILON;

/**
 * The SIZE half of viewportChanged, taking bare numbers.
 *
 * Not a convenience wrapper — it is the version main.ts's frame loop can call.
 * That caller runs sixty times a second and already holds the two numbers (it
 * is about to hand them to render()); building a ViewportReading for it would
 * mean an object per frame, and measuring the insets to fill one would mean a
 * forced style recalc per frame. So the hot path asks only what it can answer
 * for free, and the watchdog's interval — which can afford the probe — owns the
 * insets. viewportChanged is defined in terms of THIS rather than the other way
 * round, so the two can never drift apart on the size axes or on the epsilon.
 */
export function sizeChanged(prev: ViewportReading | null, w: number, h: number): boolean {
  if (!prev) return true;
  return off(prev.w, w) || off(prev.h, h);
}

/**
 * Does a fresh reading disagree with the one the published layout was solved
 * from? A null `prev` means nothing has been solved yet, which disagrees with
 * everything.
 *
 * This is the predicate behind main.ts's dimension watchdog. It exists as a
 * pure function here, next to the solver whose inputs it describes, so that it
 * can be pinned without a browser (sim/systems.ts) — the bug it answers is one
 * nobody on this side of the device can reproduce, and a predicate that only
 * ever runs inside a WKWebView is a predicate nobody can check.
 */
export function viewportChanged(prev: ViewportReading | null, next: ViewportReading): boolean {
  if (!prev) return true;
  return sizeChanged(prev, next.w, next.h)
    || off(prev.safe.left, next.safe.left) || off(prev.safe.right, next.safe.right)
    || off(prev.safe.top, next.safe.top) || off(prev.safe.bottom, next.safe.bottom);
}

/**
 * Chrome scale for a usable box, and the tier it falls in.
 *
 * Deliberately solved in JS next to the field rather than expressed as CSS
 * `clamp()` on `vh`: the box that matters is the one left AFTER safe-area
 * insets, and `env(safe-area-inset-*)` cannot be read from a media query or
 * used in a container query condition. An iPhone in landscape gives up ~120px
 * of width and 21px of height to the notch and home indicator, and a scale that
 * ignored that would be measuring a viewport the player never sees.
 *
 * Both axes are considered and the smaller wins — a 640x400 window is as
 * cramped as a 1000x360 one, and the chrome has to answer to whichever ran out
 * first. That is as true magnifying as it is shrinking: an 1100x2000 window
 * has no more room for a WIDE menu than an 1100x720 one does, so taking the
 * smaller ratio is what stops the grow direction from pushing a three-column
 * row off the side of a tall narrow window.
 */
export function uiScaleFor(
  uw: number,
  uh: number,
): { uiScale: number; chromeZoom: number; density: Density } {
  const raw = Math.min(uh / UI_REF_H, uw / UI_REF_W);
  const uiScale = Math.max(UI_SCALE_MIN, Math.min(1, raw));
  // The same ratio read the other way. Splitting one continuum into two
  // one-directional channels is not redundancy: the two have different
  // consumers and different failure modes. Shrinking is a fit problem and
  // bottoms out in a RESTRUCTURE (`density`); magnifying is a legibility
  // problem and is a pure multiply, which is why only this half reaches the
  // stylesheet.
  const chromeZoom = Math.min(UI_ZOOM_MAX, Math.max(1, raw));
  // Compact is a HEIGHT verdict. The scale takes the tighter of the two axes
  // (a 640x400 window is as cramped as a 1000x360 one), but the compact
  // tier's rules RESTRUCTURE — they drop rows, chips and context tiles, all
  // measured against 360px-tall phones — and a narrow-but-tall desktop window
  // still has the height those rules exist to buy back. So width may bottom
  // the scale out, but only height may force the restructure.
  const density: Density =
    uiScale >= DENSITY_ROOMY
      ? "roomy"
      : uh / UI_REF_H <= UI_SCALE_MIN
        ? "compact"
        : "regular";
  return { uiScale, chromeZoom, density };
}

/** Fit the world into a box, centered. */
function fit(bx: number, by: number, bw: number, bh: number) {
  const scale = Math.max(0.0001, Math.min(bw / WORLD.width, bh / WORLD.height));
  const fw = WORLD.width * scale;
  const fh = WORLD.height * scale;
  return { scale, fw, fh, ox: bx + (bw - fw) / 2, oy: by + (bh - fh) / 2 };
}

export function computeLayout(cw: number, ch: number): Layout {
  const safe = safeInsets;
  // Usable box after safe areas — every mode starts from this, so the notch is
  // never something an individual branch has to remember.
  const ux = safe.left;
  const uy = safe.top;
  const uw = Math.max(1, cw - safe.left - safe.right);
  const uh = Math.max(1, ch - safe.top - safe.bottom);

  // Chrome scale is a property of the usable box, not of which branch below
  // wins — every mode gets the same answer.
  const ui = uiScaleFor(uw, uh);

  const natural = fit(ux, uy, uw, uh);
  const gutterX = (uw - natural.fw) / 2;
  const gutterY = (uh - natural.fh) / 2;

  const usable = RAIL_MIN + RAIL_PAD;

  // A vertical rail also has to fit its whole COLUMN, not just its width — on a
  // short landscape phone seven buttons at RAIL_MIN plus gaps can exceed the
  // viewport height, in which case a horizontal bar is the honest answer even
  // though the side gutter is wide enough.
  const columnFits = railColumnCap(uh) >= RAIL_MIN;

  if (gutterX >= usable && columnFits) {
    return {
      mode: "wide",
      reserve: NO_INSETS,
      safe,
      ...natural,
      // Capped by the COLUMN as well as the gutter. Without the height term the
      // solver handed back a size the column could not stack, the CSS flex
      // column shrank the buttons to fit, and the primary touch controls came
      // out at 46px on a Pixel 7 — under the 44px floor this file exists to
      // defend, silently.
      railSize: Math.max(RAIL_MIN, Math.min(RAIL_MAX, gutterX - RAIL_PAD, railColumnCap(uh))),
      ...ui,
    };
  }

  if (gutterY >= usable) {
    return {
      mode: "tall",
      reserve: NO_INSETS,
      safe,
      ...natural,
      railSize: Math.max(RAIL_MIN, Math.min(RAIL_MAX, gutterY - RAIL_PAD)),
      ...ui,
    };
  }

  // Neither natural gutter is usable: reserve one. Prefer a right band (a
  // vertical rail keeps the bottom clear for the plant panel and the compactor
  // sweep) unless the column genuinely doesn't fit, in which case reserve the
  // bottom for a horizontal bar instead.
  if (columnFits) {
    const band = RAIL_MAX + RAIL_PAD * 2;
    // The band goes on the rail's edge (setRailSide): a left-handed rail
    // needs its reserve on the left, or the mirror would sit on the field.
    const left = railSide === "left";
    const reserve: Insets = {
      left: left ? band : 0, right: left ? 0 : band, top: 0, bottom: 0,
    };
    return {
      mode: "snug",
      reserve,
      safe,
      ...fit(ux + reserve.left, uy, uw - band, uh),
      railSize: Math.max(RAIL_MIN, Math.min(RAIL_MAX, railColumnCap(uh))),
      ...ui,
    };
  }

  const band = RAIL_MIN + RAIL_PAD * 2;
  const reserve: Insets = { left: 0, right: 0, top: 0, bottom: band };
  return {
    mode: "tall",
    reserve,
    safe,
    ...fit(ux, uy, uw, uh - band),
    railSize: RAIL_MIN,
    ...ui,
  };
}
