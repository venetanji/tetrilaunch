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

function focusOn(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  // The overlay has real scrollers (the refit shelf, the workshop pane, the
  // guide index); a focused control below their fold has to come to the pad
  // player, since the pad has no wheel.
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}
