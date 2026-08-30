/**
 * GAMEPAD FOCUS NAVIGATION — the layer that makes every modal and screen
 * operable from a pad (canvas D1's second half). The Gamepad API gives the
 * poller buttons; this gives those buttons somewhere to land when the game is
 * not the thing being controlled: D-pad (or stick) moves keyboard focus
 * between the actionable controls of whatever the overlay is showing, A
 * activates the focused one, B backs out where a back exists (main.ts's
 * onPadUiButton owns that per-state map).
 *
 * Built on FOCUS, not on a parallel cursor, for two reasons. First, the
 * overlay's screens already speak focus: the draft and the refit restore
 * document.activeElement across their in-place re-renders (main.ts's
 * refreshDraft/refreshRefit, D4), so a pad selection survives a card toggle
 * for free — a bespoke highlight would need its own copy of that plumbing in
 * every screen that patches itself. Second, activation is el.click(), which
 * rides the exact keyboard-activation path onClick already handles (detail 0,
 * no pointerType), feedback sound included; the pad adds no third input
 * semantics to a codebase that just finished unifying two.
 *
 * The picker is SPATIAL rather than DOM-ordered: the screens this has to
 * serve range from a card grid beside a projection column (the draft) to a
 * vertical tower of floors (the menu) to one row of buttons (the pause
 * modal), and document order agrees with none of them in both axes at once.
 * Geometry does. The scoring is the usual directional-navigation shape —
 * displacement along the pressed axis, off-axis drift penalised harder — kept
 * as a pure function over rects so sim/systems can hold it to a layout
 * without a browser.
 */

export type NavDir = "up" | "down" | "left" | "right";

export interface NavRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Standard-mapping button indices the UI layer answers to. Raw indices, not
 *  bindings.ts's rebindable table, on purpose: in menus the D-pad is
 *  navigation and A/B are confirm/back on every console shelf a player has
 *  ever owned, and letting a gameplay rebind (D-pad nudges aim, A fires)
 *  drag the menu conventions along with it would strand the player in the
 *  first modal they opened. */
export const PAD_CONFIRM = 0; // A / Cross
export const PAD_BACK = 1;    // B / Circle
/** Select/Back/View — "Back" in Xbox lettering, "Create" on a DualSense, the
 *  "…" key on a Deck. Opens the Controls screen from any menu that has a door
 *  back to it (main.ts's PAD_CONTROLS_DOORS).
 *
 *  This one is fixed for a sharper reason than A and B are. Every gameplay
 *  binding on this pad is rebindable, and the screen that undoes a bad rebind
 *  is reached by driving a menu — so if a rebind ever made a menu awkward to
 *  drive, the remedy would be behind the problem. A button that opens Controls
 *  and that no rebind can move is the way out that cannot be rebound away.
 *  Standard mapping guarantees the index across every pad the browser reports
 *  as `mapping: "standard"`, Deck included; button 16 (Guide/PS) is claimed by
 *  the platform overlay and 17 (the DualSense touchpad click) is outside
 *  standard mapping entirely, so neither is a button the UI may spend. */
export const PAD_CONTROLS = 8;
export const PAD_NAV: Record<number, NavDir> = {
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};

/** Off-axis drift costs this much per px against on-axis progress. 2 keeps a
 *  column of buttons winning over a nearer diagonal neighbour (the draft's
 *  confirm bar under its cards) while still letting a lone diagonal target be
 *  reachable when nothing straighter exists. */
const CROSS_AXIS_PENALTY = 2;

/**
 * The next rect focus should land on from `from` when `dir` is pressed, or
 * `from` itself when nothing lies that way (the edge of a screen is a wall,
 * not a wrap — wrapping turns "which way is the confirm button" into a
 * memory question).
 *
 * Measured CENTRE to centre. Candidates must make real progress along the
 * pressed axis (> 1px, so two buttons sharing a row never count as "above"
 * each other through sub-pixel jitter).
 */
export function pickNext(rects: NavRect[], from: number, dir: NavDir): number {
  const f = rects[from];
  if (!f) return from;
  const fx = f.x + f.w / 2;
  const fy = f.y + f.h / 2;
  let best = from;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    if (i === from) continue;
    const r = rects[i];
    const dx = r.x + r.w / 2 - fx;
    const dy = r.y + r.h / 2 - fy;
    const ahead =
      dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    if (ahead <= 1) continue;
    const cross = Math.abs(dir === "up" || dir === "down" ? dx : dy);
    const score = ahead + CROSS_AXIS_PENALTY * cross;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Where a pad selection should land when the control it was holding did not
 * survive a re-render, and the pane it lived in is showing a different part of
 * itself than the landing did: the target sharing the most of its own height
 * with the scrollport. -1 when nothing in `rects` is on screen at all.
 *
 * THE HAZARD THIS ANSWERS is a selection the player cannot see. main.ts's
 * renderKeepingScroll puts a shelf back where the player left it after a
 * purchase; focusInitial, running inside the same render, lands on the
 * screen's first primary action, which on the Workshop is a BUY button near
 * the TOP of that shelf. Both are individually right and together they leave
 * the ring 605px above the fold (measured on a 740x360 phone) — where the next
 * Confirm spends salvage on an item nobody looked at.
 *
 * MOST OF ITS OWN HEIGHT rather than nearest-to-centre: a control the player
 * can see all of beats one clipped to a sliver at the edge, which is the same
 * judgement `reveal` makes when it brings a selection in. Ties go to the
 * earliest in document order (`>` rather than `>=`), so a pane of equally
 * visible rows selects the top one — where a reader's eye already is.
 *
 * Vertical only. Every scroller the overlay has scrolls in Y (the two
 * horizontal ones, `.pl-mods` and `.guide__tabs`, are strips of one row that
 * cannot strand anything above or below a fold), so a second axis here would
 * be arithmetic nothing can exercise.
 */
export function pickInView(rects: NavRect[], port: NavRect): number {
  let best = -1;
  let bestSeen = 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const seen = Math.min(r.y + r.h, port.y + port.h) - Math.max(r.y, port.y);
    if (seen > bestSeen) {
      bestSeen = seen;
      best = i;
    }
  }
  return best;
}

/** Everything a pad may land focus on. Native controls plus the two ARIA
 *  shapes the overlay actually uses (the settings switch is a div with
 *  role="switch" + tabindex). [tabindex] alone would also catch them, but
 *  naming the roles keeps the intent readable. */
const FOCUSABLE =
  'button, input, select, textarea, [role="switch"], [role="button"], [tabindex]';

/** The controls a pad can usefully land on right now: focusable, visible,
 *  enabled, and big enough to be a real control rather than visually-hidden
 *  a11y text. */
export function focusTargets(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    if ((el as HTMLButtonElement).disabled) return;
    if (el.tabIndex < 0) return;
    if (el.closest('[aria-hidden="true"]')) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    out.push(el);
  });
  return out;
}

/** Land focus somewhere sensible on a fresh screen: the primary action if it
 *  is live, else the first target. Returns false on a screen with nothing to
 *  land on (the splash, the bay-clear tap-through). */
export function focusInitial(root: HTMLElement): boolean {
  const targets = focusTargets(root);
  if (!targets.length) return false;
  const primary = targets.find((el) => el.classList.contains("btn--primary"));
  focusOn(primary ?? targets[0]);
  return true;
}

/** One D-pad step. Returns whether the press was USED — a first press with
 *  nothing focused spends itself landing focus rather than moving it, so the
 *  player sees where they are before anything moves. */
export function moveFocus(root: HTMLElement, dir: NavDir): boolean {
  const targets = focusTargets(root);
  if (!targets.length) return false;
  const active = document.activeElement;
  const from = targets.findIndex((el) => el === active);
  if (from === -1) return focusInitial(root);
  const rects: NavRect[] = targets.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const next = pickNext(rects, from, dir);
  if (next !== from) focusOn(targets[next]);
  return true;
}

/** Land pad focus on one control. Exported so sim/uifit drives the REAL
 *  landing (harness.ts's padFocus) rather than a hand-written stand-in of it —
 *  the two lines below are the whole difference between a pad selection and a
 *  mouse hover, and they are exactly what the harness has to measure. */
export function focusOn(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  // The overlay has real scrollers (the refit shelf, the workshop pane, the
  // guide index); a focused control below their fold has to come to the pad
  // player, since the pad has no wheel.
  reveal(el);
}

/* ---------------------------------------------------------------------------
 * REVEAL — bringing a focused control into a scroller without cropping it.
 *
 * This was `el.scrollIntoView({ block: "nearest" })`, and that call reveals
 * exactly one box: the control's BORDER box, flush against the scrollport
 * edge. Everything the design paints outside that box is therefore scrolled
 * out of the pane and clipped away, and this screen paints two such things:
 *
 *   THE RING. The pad's cursor is `outline: 2px` at `outline-offset: 2px`
 *   (app.css's "D4: ONE focus token"), i.e. a line whose outer edge is 4px
 *   OUTSIDE the border box the scroll aligned. Measured on every allowlisted
 *   scroller in sim/uifit's matrix, the ring's leading edge was cropped by
 *   ~4px on the row a D-pad step scrolled to — the pad's own cursor, cut by
 *   the act of moving it.
 *
 *   THE CARD. The refit shelf and the workshop shelf focus a BUY button that
 *   sits inside a .shop-card, vertically centred in a row whose height is set
 *   by the copy beside it. Below the button are the card's remaining height,
 *   its 10px padding and its 2px border — 13px on a Pixel 7, 33px on a 720p
 *   laptop, 50px at 1080p, all of it scrolled under the shelf's edge. That is
 *   the bug as it was reported: "the bottom border disappears when the
 *   selection is highlighted". The border is not being restyled; the card is
 *   being scrolled half out of the pane by the focus that selected it.
 *
 * WHY THE MOUSE LOOKED FINE. Hover neither focuses nor scrolls — the pointer
 * goes to the card, the card stays where it is, and both the border and the
 * hover treatment are whole. A pad move is a focus() AND a scroll on every
 * single step, so the pad is the only input that could ever see this. (A
 * keyboard Tab is the same shape and had the same defect; nobody tabs a shop.)
 *
 * THE FIX IS TWO TERMS, and neither can be a stylesheet constant.
 *
 *   The ring's clearance is a constant, FOCUS_RING_GAP, and it is the token's
 *   own arithmetic rather than a taste number.
 *
 *   The card's is NOT a constant — it is however much card hangs below the
 *   button, which varies with the copy on the card and with chromeZoom. No
 *   `scroll-margin` value could cover it. So the scroll reveals the UNIT the
 *   control belongs to instead: the outermost ancestor that still fits inside
 *   the scrollport. On the refit shelf that walk stops at .refit-card; on the
 *   workshop pane .workshop__grid is the whole 1260px list and does not fit,
 *   so it stops at .shop-card; on the guide index the topic button is its own
 *   parent's whole content and the unit is the button. No screen names itself
 *   anywhere in here, which is the point: a new card menu is covered the day
 *   it is written.
 *
 * Written as arithmetic over scrollTop rather than as scrollIntoView because
 * the gap has to apply to the unit, and scrollIntoView takes its clearance
 * from the scrolled element's own `scroll-margin` — which would mean a
 * stylesheet rule per card shape, i.e. exactly the per-screen list this
 * avoids. The document itself never scrolls (app.css's `.screen` is
 * `position: absolute; inset: 0; overflow: hidden`), so walking the element's
 * scrollable ancestors covers every scroller the overlay has.
 * ------------------------------------------------------------------------ */

/** The focus ring's outer edge, relative to the control's border box: app.css
 *  D4's `outline-offset: 2px` plus its `outline: 2px`. A scroll that leaves
 *  less than this at the edge crops the pad's cursor. */
export const FOCUS_RING_GAP = 4;

/**
 * How far a scrollport must move along one axis to show `lo..hi` with `gap` of
 * clearance at each end — 0 when it is already shown, and the smaller of the
 * two directions when it is not (the "nearest" of scrollIntoView, kept: a step
 * down a shelf should advance the shelf by a row, not re-centre it).
 *
 * When the padded span is TALLER than the port the clearance is unaffordable,
 * and the port is spent on the span itself rather than on the gap: an item
 * that only just fits is better shown flush than shown short.
 */
export function revealShift(
  lo: number,
  hi: number,
  portLo: number,
  portHi: number,
  gap: number = FOCUS_RING_GAP,
): number {
  const a = lo - gap;
  const b = hi + gap;
  if (b - a > portHi - portLo) {
    if (lo < portLo) return lo - portLo;
    if (hi > portHi) return hi - portHi;
    return 0;
  }
  if (a < portLo) return a - portLo;
  if (b > portHi) return b - portHi;
  return 0;
}

const scrolls = (o: string): boolean => o === "auto" || o === "scroll";

/** The nearest ancestor of `el` that can actually scroll in either axis, or
 *  null. REAL scrollability, not `closest("[data-scroll]")`, for main.ts's
 *  inScroller reason: app.css hands drags to scrollers that never opted into
 *  the attribute (`.modal`, `.draft__body`, `.sbx-col`, the coach's body). */
function scrollPort(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (scrolls(cs.overflowY) && n.scrollHeight > n.clientHeight) return n;
    if (scrolls(cs.overflowX) && n.scrollWidth > n.clientWidth) return n;
  }
  return null;
}

/**
 * The port's scrollport as getBoundingClientRect sees it, plus the factor
 * between the two coordinate systems this arithmetic has to straddle.
 *
 * TWO SYSTEMS, because of `zoom`. app.css's chrome magnification puts `zoom`
 * on the screen-anchored scaffolds (the note at "Chrome magnification"), and
 * `zoom` scales the RENDERED box while leaving the element's own scroll
 * coordinates in its unzoomed CSS px: getBoundingClientRect returns visual
 * pixels, `clientHeight`, `scrollTop` and `scrollHeight` return local ones.
 * Measured on the refit shelf at 1920x1080 (zoom 1.5), the pane's rect was
 * 714.6px tall and its clientHeight 476 — so arithmetic that mixed the two
 * believed the shelf ended 238px above where it is drawn and scrolled the
 * focused card straight past the fold. Every number below is therefore VISUAL,
 * and the one conversion back to local px happens where scrollTop is written.
 *
 * The factor is read off the port itself rather than from a chromeZoom import:
 * what matters is the cumulative zoom on this element, which is a fact about
 * where it sits in the tree, and offsetHeight/rect.height states it without
 * the solver and the stylesheet having to agree about who applied what.
 */
function scrollportOf(port: HTMLElement): {
  top: number; bottom: number; left: number; right: number; z: number;
} {
  const p = port.getBoundingClientRect();
  const z = port.offsetHeight > 0 ? p.height / port.offsetHeight : 1;
  const cs = getComputedStyle(port);
  // The scrollport is the PADDING box: a bordered scroller measured off the
  // border box is a border-width too generous at each edge.
  const top = p.top + parseFloat(cs.borderTopWidth) * z;
  const left = p.left + parseFloat(cs.borderLeftWidth) * z;
  return {
    top,
    bottom: top + port.clientHeight * z,
    left,
    right: left + port.clientWidth * z,
    z,
  };
}

/** The visual unit `el` belongs to inside `port`: the outermost ancestor that
 *  still fits the scrollport, so revealing it cannot push a neighbour's edge
 *  out of the pane. Only the axes the port actually scrolls are asked to fit —
 *  a shop card is as wide as the shelf by design, and testing its width would
 *  reject every card and leave the unit at the button. */
function revealUnit(el: HTMLElement, port: HTMLElement, box: { bottom: number; top: number; right: number; left: number }): HTMLElement {
  const cs = getComputedStyle(port);
  const capY = scrolls(cs.overflowY) ? box.bottom - box.top : Infinity;
  const capX = scrolls(cs.overflowX) ? box.right - box.left : Infinity;
  let unit = el;
  for (let p = el.parentElement; p && p !== port; p = p.parentElement) {
    const r = p.getBoundingClientRect();
    if (r.height > capY || r.width > capX) break;
    unit = p;
  }
  return unit;
}

/**
 * The two boxes a pad selection has to satisfy, for the harness that checks it
 * did: the visual unit `el` belongs to, and the scrollport that unit must lie
 * inside. Null when nothing around `el` scrolls, i.e. when there is no way for
 * a selection to be cut in the first place.
 *
 * Exported so sim/uifit's `padfocus` assertion asks padnav what the selection
 * IS rather than keeping a second opinion about it — the fix is precisely that
 * the selection is the card and not the button, and a harness that re-decided
 * that for itself would pass a regression that changed its mind.
 */
export function focusBoxes(el: HTMLElement): {
  unit: DOMRect;
  pane: { top: number; bottom: number; left: number; right: number };
} | null {
  const port = scrollPort(el);
  if (!port) return null;
  const pane = scrollportOf(port);
  return { unit: revealUnit(el, port, pane).getBoundingClientRect(), pane };
}

/** Scroll every scrollable ancestor just enough to show the focused control's
 *  unit, ring included. Inner ports first: each one's arithmetic is read after
 *  the one below it has already moved, so the rects are never stale. */
function reveal(el: HTMLElement): void {
  for (let port = scrollPort(el); port; port = scrollPort(port)) {
    const box = scrollportOf(port);
    const u = revealUnit(el, port, box).getBoundingClientRect();
    // The ring is drawn in the zoomed subtree, so its 4px are 4 VISUAL px
    // times the same factor everything else here is measured in.
    const gap = FOCUS_RING_GAP * box.z;
    port.scrollTop += revealShift(u.top, u.bottom, box.top, box.bottom, gap) / box.z;
    port.scrollLeft += revealShift(u.left, u.right, box.left, box.right, gap) / box.z;
  }
}

/* ---------------------------------------------------------------------------
 * ARM-THEN-CONFIRM — two presses, and the second one has to be a second PRESS.
 *
 * The pause card's Quit takes two activations before it ends a run (main.ts's
 * requestQuitRun). "Two activations" is not the same promise as "two presses",
 * and the gap between them is where the pattern was broken: with the button
 * keyboard-focused, HOLDING Enter makes Chromium dispatch a native click per
 * keydown REPEAT — the first repeat arms, the next confirms, and one physical
 * press ends the run without the player ever making the second one. Measured
 * on a real run, Enter and Space both (codex review, PR #167). The warning is
 * on screen for a few milliseconds under the player's own finger, which is
 * worse than no warning: it is the pattern appearing to work.
 *
 * So the machine tracks a second bit. `armed` says the first activation has
 * landed; `held` says the activation that armed it has not been released, and
 * while it is set every further activation is REFUSED. A release is the only
 * thing that turns an armed control into one that can confirm.
 *
 * WHY A RELEASE, AND NOT A TIMER OR A REPEAT FLAG. A minimum delay would be a
 * guess about how fast a deliberate second press can be, and it would punish
 * the fast double-tap this control is meant to accept. Reading
 * KeyboardEvent.repeat off the keydown behind the click works in Chromium
 * today and depends on the click being dispatched as that keydown's default
 * action — an ordering no platform owes us. A release is a fact about the
 * physical control, and every input path has one.
 *
 * WHAT EACH PATH RELEASES WITH — the three are not symmetrical, and pretending
 * they were is how this gate would deadlock a pad:
 *
 *  - KEYBOARD: keyup. Repeats arrive with no keyup between them, which is
 *    exactly the case being refused.
 *  - POINTER: pointerup. A click is dispatched on RELEASE, so the arming press
 *    is already over by the time it runs — but the listener is armed during
 *    that click and the NEXT tap's pointerup clears it before the next click,
 *    so two distinct taps pass untouched however fast they are. A held pointer
 *    produces no repeated clicks either way.
 *  - GAMEPAD: every press EDGE. The pad delivers no release event at all (the
 *    API is a state snapshot, and game/gamepad.ts arms autorepeat for
 *    DIRECTIONS only — a confirm that repeated would fire its screen twice),
 *    so waiting for one would leave a pad player armed forever. Its edges are
 *    already what a fresh press means there, so main.ts releases on each.
 *
 * A pure machine rather than three flags on the App, because "a held key is
 * one press" is a rule and sim/systems.ts has to be able to reach it: the
 * event plumbing lives in main.ts, which no harness can drive.
 * ------------------------------------------------------------------------ */

export interface ArmState {
  /** The first activation has landed and the control is showing its warning. */
  armed: boolean;
  /** The activation that armed it has not been released yet. */
  held: boolean;
}

export const DISARMED: ArmState = { armed: false, held: false };

export interface ArmResult {
  state: ArmState;
  /** The caller should now do the destructive thing. Never true on the
   *  activation that armed, and never true while that activation is held. */
  confirmed: boolean;
}

/** One activation of an arming control. */
export function armActivate(s: ArmState): ArmResult {
  // The first press arms, and counts as held until its own release: the
  // repeats of a held key are this same press arriving again.
  if (!s.armed) return { state: { armed: true, held: true }, confirmed: false };
  // …so they change nothing. The control stays armed and stays warning.
  if (s.held) return { state: s, confirmed: false };
  // A second, distinct press. The arm is spent either way.
  return { state: DISARMED, confirmed: true };
}

/** The arming activation has ended — a keyup, a pointerup, or the pad's next
 *  press edge. Idempotent, so a path that delivers more than one of those
 *  cannot clear anything twice. */
export function armRelease(s: ArmState): ArmState {
  return s.held ? { armed: s.armed, held: false } : s;
}
