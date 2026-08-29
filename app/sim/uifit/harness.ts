/**
 * The page under test. Exposes `window.__uifit` for run.mjs to drive.
 *
 * Two things make this a real test rather than a mock-up:
 *
 *  1. It imports the SHIPPING stylesheet (src/styles/app.css) and the SHIPPING
 *     screen functions. Nothing is reimplemented here.
 *  2. Safe-area insets are applied by overriding the `env(safe-area-inset-*)`
 *     values in a STYLESHEET RULE and then calling the app's own
 *     applySafeAreaInsets(), which measures them back off a mounted .safe-probe
 *     element. Stubbing setSafeAreaInsets() directly would be simpler and would
 *     also skip the exact plumbing that has broken before on iOS WKWebView
 *     (see lib/platform's comment on why the probe's styles cannot be inline).
 *     The harness exercises the path the device uses.
 */
import "../../src/styles/app.css";
import { computeLayout, railSlotsFor, setRailSlots, type Insets } from "../../src/game/layout";
import { setPadFamily, type PadFamily } from "../../src/game/bindings";
import { applySafeAreaInsets } from "../../src/lib/platform";
import { railLoadoutFor, rootHooksFor, SCREENS, SCREEN_IDS } from "./fixtures";

const overlay = document.getElementById("overlay") as HTMLElement;

/**
 * Animations off, permanently, for everything.
 *
 * getBoundingClientRect returns the TRANSFORMED box, and several screens enter
 * on a scale animation (.pop, the modal entrance). Measuring two frames in
 * caught them mid-flight: a button with a hard `min-height: 44px` measured
 * 43.12px, which is 44 x 0.98 — the animation's scale, not the layout. That is
 * a whole class of phantom findings, and worse, a class of REAL findings it
 * could hide by scaling something below the viewport edge back inside it.
 *
 * Zero duration rather than `animation: none`: it drives every animation
 * straight to its end state, which is the settled layout the player sees.
 */
const settleSheet = document.createElement("style");
settleSheet.textContent = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}`;
document.head.appendChild(settleSheet);

/** The stylesheet that fakes the device's insets. One element, rewritten per
 *  render, so no rule ever stacks on a previous device's values. */
const insetSheet = document.createElement("style");
document.head.appendChild(insetSheet);

function applyInsets(insets: Insets): void {
  const { top, right, bottom, left } = insets;
  insetSheet.textContent = `
    .safe-probe {
      padding-top: ${top}px;
      padding-right: ${right}px;
      padding-bottom: ${bottom}px;
      padding-left: ${left}px;
    }
    /* tokens.css derives every inset-consuming token from env(); Chromium
       reports no insets, so without these overrides the corner-anchored
       clusters and the side rail would sit at raw env()=0 positions on an
       iPhone row and the harness would measure a layout no device produces. */
    :root {
      --inset-t: ${top}px;
      --inset-r: ${right}px;
      --inset-b: ${bottom}px;
      --inset-l: ${left}px;
      --safe-l: calc(${left}px + var(--ctrl-inset-x));
      --safe-r: calc(${right}px + var(--ctrl-inset-x));
      --safe-b: calc(${bottom}px + var(--ctrl-inset-b));
    }`;
  // Read them back through the app's own measurement path, which is what hands
  // them to the layout solver.
  applySafeAreaInsets();
}

/** main.ts's onResize, minus the canvas work — the same solver, the same
 *  custom properties, so in-field chrome (.plant, .belt, .side-rail) lands
 *  exactly where it lands in the app. */
function publishLayout(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const l = computeLayout(w, h);
  const rs = document.documentElement.style;
  rs.setProperty("--field-x", `${l.ox}px`);
  rs.setProperty("--field-y", `${l.oy}px`);
  rs.setProperty("--field-w", `${l.fw}px`);
  rs.setProperty("--field-h", `${l.fh}px`);
  // Unitless twin of --fpx, for the rules that need the field scale as a
  // multiplier (app.css's drag-hint pull). Published here as well as in main.ts
  // because a fixture that falls back to the default measures one fixed scale
  // on all 19 devices — which is exactly the per-device drift this harness is
  // supposed to be looking for.
  rs.setProperty("--fscale", String(l.scale));
  rs.setProperty("--gutter-r", `${Math.max(0, w - l.ox - l.fw)}px`);
  rs.setProperty("--gutter-b", `${Math.max(0, h - l.oy - l.fh)}px`);
  rs.setProperty("--rail-btn", `${l.railSize}px`);
  // The chrome magnification the screen-anchored scaffolds put into `zoom`.
  // Load-bearing here for the same reason --fscale is: a harness that left it
  // at its stylesheet default would measure all 19 device rows at 1:1, which
  // is precisely the desktop layout this property exists to stop shipping.
  rs.setProperty("--chrome-zoom", String(l.chromeZoom));
  // Load-bearing, not bookkeeping: app.css's rail rules key the horizontal
  // "tall" strip off :root[data-layout="tall"]. Omitting it left the rail in
  // its vertical form on the two iPad rows and the harness reported an overlap
  // the app does not have.
  document.documentElement.dataset.layout = l.mode;
  document.documentElement.dataset.density = l.density;
}

export interface UiFitApi {
  screens: string[];
  /** NO POINTER ARGUMENT ANY MORE. It used to mirror main.ts's hudOpts, where a
   *  fine pointer shed every game button off the rail and the budget came out
   *  at fullscreen + pause. The rail is the same column on every pointer now
   *  (it wears a keycap and a pad mark per button instead of handing its job to
   *  a text strip), so the slot budget is a property of the LOADOUT alone and
   *  the harness has nothing left to tell the solver about the device. */
  render(id: string, insets: Insets): void;
  layout(): ReturnType<typeof computeLayout>;
}

declare global {
  interface Window {
    __uifit: UiFitApi;
  }
}

const api: UiFitApi = {
  screens: SCREEN_IDS,
  render(id, insets) {
    const make = SCREENS[id];
    if (!make) throw new Error(`unknown screen "${id}"`);
    applyInsets(insets);
    // The same loadout -> slot budget hand-off main.ts's hudOpts performs, so
    // the solver prices the rail this screen actually renders.
    setRailSlots(railSlotsFor(railLoadoutFor(id)));
    // ...and the same ROOT HOOKS main.ts publishes for the input family and the
    // connected pad (setProfile / syncPadFamily). Written before the layout
    // solve and the render because app.css keys structural rules off both, and
    // a rule that only lights up after the measurement is a rule the harness
    // cannot see. Cleared, never left over: these are per-fixture state on a
    // document that renders every fixture in turn.
    const hooks = rootHooksFor(id);
    const root = document.documentElement;
    if (hooks.profile) root.dataset.profile = hooks.profile;
    else delete root.dataset.profile;
    if (hooks.pad) root.dataset.pad = hooks.pad;
    else delete root.dataset.pad;
    // BOTH HALVES of the pad hand-off, not just the CSS one. main.ts's
    // syncPadFamily writes the root attribute AND tells bindings.ts which
    // vocabulary to speak, and the second half is what puts the pad's real
    // words into every string the screens render — "Cross fire" rather than
    // "A fire" on the hint strip, which is six characters wider and therefore
    // the measurement that matters. Reset (to the standard mapping's Xbox
    // lettering) for every other fixture, since this is module state on a
    // document that renders all 79 in turn.
    setPadFamily((hooks.pad as PadFamily | null) ?? null);
    publishLayout();
    overlay.innerHTML = make();
  },
  layout: () => computeLayout(window.innerWidth, window.innerHeight),
};

window.__uifit = api;
