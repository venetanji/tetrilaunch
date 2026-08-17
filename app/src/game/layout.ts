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

/** Number of buttons the rail can hold at once (fullscreen, pause, rotate CCW,
 *  rotate CW, bond breaker, demolition, cancel-aim). Used to check a vertical
 *  rail actually FITS its column on short viewports before choosing it. */
export const RAIL_SLOTS = 7;

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

/** Viewport the chrome is authored against. At or above this, --ui-scale is 1
 *  and nothing is shrunk. 720 is the world's own height, which is also roughly
 *  where the old hand-tuned `max-height` breakpoint stack used to start firing. */
const UI_REF_H = 720;
const UI_REF_W = 1000;

/** The floor. Below this, shrinking type and padding stops buying fit and
 *  starts costing legibility and tap targets — measured against the 44px
 *  minimum, a button cannot get its label inside 44px of height much under
 *  0.72 of the authored scale. Under the floor the answer is `density:
 *  "compact"` and a structural change, never a smaller font. */
export const UI_SCALE_MIN = 0.72;

/** Above this, nothing is scaled at all. */
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
  /** Multiplier the DOM chrome's type and spacing scale by (published as
   *  --ui-scale). 1 on a comfortable viewport, never below UI_SCALE_MIN. */
  uiScale: number;
  /** Coarse tier for rules that must SWITCH rather than scale (published as
   *  <html data-density>). */
  density: Density;
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
 * first.
 */
export function uiScaleFor(uw: number, uh: number): { uiScale: number; density: Density } {
  const raw = Math.min(uh / UI_REF_H, uw / UI_REF_W);
  const uiScale = Math.max(UI_SCALE_MIN, Math.min(1, raw));
  const density: Density =
    uiScale >= DENSITY_ROOMY ? "roomy" : uiScale <= UI_SCALE_MIN ? "compact" : "regular";
  return { uiScale, density };
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
  const columnFits = uh >= RAIL_SLOTS * RAIL_MIN + (RAIL_SLOTS - 1) * 6 + 16;

  if (gutterX >= usable && columnFits) {
    return {
      mode: "wide",
      reserve: NO_INSETS,
      safe,
      ...natural,
      railSize: Math.max(RAIL_MIN, Math.min(RAIL_MAX, gutterX - RAIL_PAD)),
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
    const reserve: Insets = { left: 0, right: band, top: 0, bottom: 0 };
    return {
      mode: "snug",
      reserve,
      safe,
      ...fit(ux, uy, uw - band, uh),
      railSize: RAIL_MAX,
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
