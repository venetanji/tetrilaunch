#!/usr/bin/env npx tsx
/**
 * UI-FIT HARNESS — does every screen fit every device, without scrolling?
 *
 *   npx tsx sim/uifit/run.ts                  # Chromium, assert against the baseline
 *   npx tsx sim/uifit/run.ts --shots          # …and write a PNG per device x screen
 *   npx tsx sim/uifit/run.ts --engine=webkit  # closest cheap proxy for iOS WKWebView
 *   npx tsx sim/uifit/run.ts --update-baseline
 *
 * WHY A BASELINE. The app has known fit failures today (that is why this
 * exists), so a harness that failed on any violation would be red from the
 * moment it landed and would gate nothing. `baseline.json` records the
 * violations that exist NOW, keyed by device|screen|assertion, and the run fails
 * only on violations that are NOT in it. That makes the harness useful on day
 * one: it cannot stop the known list from shrinking, and it catches anything new
 * immediately. Every layout task deletes entries from the baseline. The run also
 * FAILS when a baselined violation stops reproducing without being removed, so
 * the file cannot rot into a permanent blanket.
 *
 * Sibling harnesses: sim/systems.ts checks the layout solver's arithmetic with
 * no browser at all. This one checks what that arithmetic plus the stylesheet
 * actually produce in a real engine. Neither replaces the other.
 */
import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVICES } from "./devices";
import { CHUTE, CHUTE_MOUTH_X0 } from "../../src/game/chute";
import { WORLD } from "../../src/game/engine";
import type { Insets } from "../../src/game/layout";
// Type-only: pulls in harness.ts's `declare global` so window.__uifit is typed
// inside page.evaluate. Erased at runtime — the harness module itself only ever
// runs in the browser.
import type {} from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(HERE, "..", "results", "uifit");

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opt = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const ENGINE = opt("engine") ?? "chromium";
/** One baseline PER ENGINE. Every number in a baseline entry is a
 *  text-measurement result of one engine's rasteriser, so a WebKit run
 *  asserted against the Chromium-recorded file could never be green even
 *  with nothing wrong — the engine dimension has to be part of the key, and
 *  a separate file per engine is that key. */
const BASELINE = resolve(HERE, ENGINE === "chromium" ? "baseline.json" : `baseline.${ENGINE}.json`);
const SHOTS = flag("shots");
const UPDATE = flag("update-baseline");
const ONLY_SCREEN = opt("screen");
const ONLY_DEVICE = opt("device");

/**
 * Elements permitted to scroll vertically, as CSS selectors. THE list — the
 * product rule "no vertical scrolling except the leaderboard rows and the
 * workshop pane" lives here and nowhere else, and adding a third entry is a
 * deliberate, reviewable act.
 */
const ALLOWED_SCROLLERS = [
  "#lb-body",          // leaderboard rows — an unbounded list by definition
  ".workshop__shop",   // workshop stock
  // The refit yard's SHELF, added on arithmetic rather than preference. It
  // offers seven upgrade tracks, each with a BUY button, and a button is 44px
  // because that is the tap floor. Seven of them is 308px of button before a
  // single label, pip or price; the modal's shelf region on a 360px-tall phone
  // is under 200px. There is no layout that fits it — only shrinking the
  // buttons back under the floor (the regression this project once fixed) or
  // hiding purchases behind pagination. Same category as the workshop pane: a
  // shop with more stock than screen, and since the yard moved onto the
  // Workshop's card it is that pane in every other respect too — one column of
  // rows carrying whole sentences, scrolling rather than clamping them.
  //
  // NOT the projection beside it (#refit-preview). That panel has
  // `overflow-y: auto` as a safety valve, and needing it is the defect: its
  // job is to answer the tap the player just made, and an answer below a fold
  // is not one. Leaving it off this list is what makes the `scrollers`
  // assertion the alarm for a projection that outgrew its column.
  "#refit-grid",
  // NOT `.coach__body`. It was allowed here on the reasoning that when a
  // step's copy wants more than the panel's tutorial cap leaves, the card's
  // body giving up its tail beats the readout spilling off the panel — which
  // is true, and is why `overflow-y: auto` stays in the stylesheet as the
  // backstop. What it is not is a licence for the copy to need it: seven of
  // thirteen devices scrolled the last card, up to 58px on the budget phone,
  // with the sentence that says how to win sliced through the middle and no
  // affordance saying there was more. A tutorial card is read once, in one
  // glance, by someone who does not yet know the panel scrolls. So the copy
  // is now written to the cap (screens.ts's coachSteps) and this asserts it:
  // the valve is still there, and needing it is the defect.
  // The Controls screen's binding list (canvas D1): eleven rebindable rows at
  // the 44px tap floor is ~290px of rows in two columns — more than a 360px
  // landscape phone has under the header, tabs and Done. Same category as
  // the workshop pane: a list with more stock than screen.
  "#controls-grid",
  // Tier S's columns (ui/sandbox-screen.ts). Added on the same arithmetic as
  // #controls-grid and the workshop pane, not on preference.
  //
  // The mode's control surface is 25 chips in its densest column at the
  // capstone Mark — seven rig tracks, eight belt choices, ten difficulty axes
  // — and every one of them is 44px because that is the tap floor. Three
  // columns of a 640px phone give each pane about 180px of width, which packs
  // two named chips to a row, so that column is ~530px of content in the
  // ~250px a 360px-tall landscape phone has under the header. There is no
  // layout that fits it: only chips under the tap floor (the regression this
  // project has already fixed twice) or hiding half the settings behind a
  // disclosure, on the one screen whose entire purpose is comparing its own
  // settings against each other.
  //
  // What the layout DOES buy is that the scrolling is per-column rather than
  // per-page: folding this to one column on a landscape phone — the obvious
  // reading of "narrow" — produced a single 744px scroll instead of three
  // short ones, which is why the collapse is keyed on height (see app.css's
  // .sbx__cols media queries).
  ".sbx-col",
  // The briefing INSIDE that column, which scrolls separately so the launch
  // button stays pinned to the bottom of the pane. 62px on the smallest phone,
  // and the alternative is a launch button that scrolls out of reach on the
  // screen whose one forward action it is.
  ".sbx-brief",
  // The guide's INDEX column (ui/screens.ts's guideScreen). An unbounded list
  // by construction — 41 topics today, and one more every time a material,
  // an axis or a ship system ships — against a column that is at most five
  // 44px rows tall on a landscape phone. Same category as the workshop shelf:
  // more stock than screen, so it scrolls rather than clamping.
  //
  // NOT `.guide__body`, the pane beside it. That element carries
  // `overflow-y: auto` in the stylesheet as a BACKSTOP — a long topic degrades
  // to a scroll instead of the hard mid-sentence clip its predecessor shipped
  // with — and leaving it off this list is what makes needing that backstop a
  // CI failure. Exactly the stance `.coach__body` takes above, for exactly the
  // same reason: copy is written to the pane.
  "#guide-list",
];

/**
 * Chrome deliberately anchored OUTSIDE the field, allowed to bleed past the
 * viewport edge. The conveyor belt sits at `--field-x` minus 2.29% of the field
 * width and is rotated 20deg (app.css's .belt), so on a 16:9 viewport — where
 * the field starts at x=0 — its uphill end is off-screen by design. It is
 * decoration: pointer-events none, no information in it. Same for the bay-clear
 * ray burst and the loss confetti.
 *
 * Kept as a short explicit list rather than inferred from `pointer-events:
 * none`, because .hud carries that too and is full of real content.
 */
const DECORATIVE = [".belt", ".bayclear__rays", ".lose-fx"];

/**
 * Rows whose design contract is ONE line, so a second line is a defect rather
 * than a reflow.
 *
 * This exists because a wrap here is invisible to every other assertion. When
 * .pl-meta wrapped inside the plant's compact grid it did not overflow the
 * viewport, did not scroll, did not clip and did not go under the tap floor —
 * the grid row simply grew 8px -> 20px and swallowed it. What the player saw
 * was `Combo x1 · Launch $25` with a stranded "·" heading the next line, and
 * nothing in CI had an opinion.
 *
 * The deeper reason to assert it: these rows are sized by a hand-tuned column
 * split, and the comment justifying that split had measured the WRONG case (a
 * contract HUD, where screens.ts drops the "Launch $N" span). A number in a
 * comment cannot be trusted to stay true across a content change; this can.
 */
const SINGLE_LINE = [
  ".pl-meta", ".pl-load", ".bay-banner",
  // Launches, DURING THE TUTORIAL ONLY — scoped, because the same block is a
  // stacked label-over-value column in the full readout and a wrap is its
  // design there. With Funds and Time hidden it is a full-width row above
  // RELOAD instead, and the stack read as the number being pushed onto a line
  // of its own. `.pl-read`'s `flex-wrap` means nothing else would notice.
  ".hud[data-coach] .pl-launches",
];

/**
 * Pairs of boxes that are laid out to sit BESIDE each other and must therefore
 * never cover each other.
 *
 * One entry, because one place in the app stacks two independently-sized boxes
 * in a height-capped column: the tutorial. The coach card was deliberately made
 * a SIBLING of the plant readout rather than a layer over it (see app.css's
 * `.coach` placement note) so that "the two can never overlap, so no revealed
 * figure is ever half-clipped". Sibling is necessary but not sufficient — a
 * block child that outgrows its flex-shrunk parent spills straight through the
 * box below it, which is exactly what the card did over Launches and Reload.
 *
 * Nothing else in the harness could see it: the panel measured EXACTLY at its
 * cap (`plant` green), the card stayed inside the viewport (`offscreen` green),
 * and no text was cut by its own box (`textclip` green). The overlap is the
 * defect and only an overlap test names it.
 */
const NO_OVERLAP: [string, string][] = [
  // Scoped past `.coach--fail`: the tutorial-failure card is deliberately a
  // MODAL over a dead bay's HUD (screens.ts's coachFailHTML puts it in a
  // scrim), so covering the readout is what it is for. It is the teaching
  // steps, which sit in the panel's own column, that must not.
  [".coach:not(.coach--fail) .coach__card", ".plant__body"],
  // The key-hint strip against the plant panel. The `kbdhint` assertion below
  // measures the strip's ANCHOR — centred on the field, attached to an edge of
  // it, inside it, clear of the rail — and every one of those passed while the
  // strip was being painted underneath a z-index 6 panel, because none of them
  // is a question about stacking. This pair is: it fails the moment the strip's
  // box and the panel's box share pixels, whoever wins the paint.
  [".kbd-hint", ".plant"],
];

/**
 * The CANVAS half of the panel's own edge, as world fractions of the field.
 *
 * The harness draws nothing into its canvas — it never has — so this is not a
 * pixel check and cannot be one. It does not need to be: drawChute's mouth is
 * authored geometry, and the question the crest assertion is already asking of
 * every DOM strip ("does this edge sit on the panel's border box") is the same
 * question, with the same answer available from the constants the painter uses.
 * Read them here, hand them to the page as fractions of the world, and the
 * browser side maps them through the live --field-* rect exactly as the
 * viewport transform does.
 */
const MOUTH = { x0: CHUTE_MOUTH_X0 / WORLD.width, x1: CHUTE.x1 / WORLD.width };

/** `id` is what the baseline keys off, so these are stable API — renaming one
 *  silently invalidates its baseline entries. */
const ASSERTIONS = [
  { id: "fit", desc: "screen fits without page scrolling" },
  { id: "scrollers", desc: "only allowlisted regions scroll vertically" },
  { id: "offscreen", desc: "no text or control is clipped off-viewport" },
  { id: "tap", desc: "every control is at least 44x44" },
  { id: "textclip", desc: "no text is hard-clipped by its box" },
  { id: "clipped", desc: "no content is cut off by an ancestor's overflow edge" },
  { id: "overlap", desc: "boxes laid out side by side do not cover each other" },
  { id: "spill", desc: "a grid/flex item stays inside the box that lays it out" },
  { id: "draghint", desc: "the drag hint's gesture plays clear of the plant panel" },
  { id: "reveal", desc: "the tutorial's first step reveals only what it teaches" },
  { id: "plant", desc: "the HUD plant panel stays inside its design box" },
  { id: "crest", desc: "the crest ring registers with the panel's own edges" },
  { id: "rail", desc: "the control rail never overlaps the field" },
  { id: "twocol", desc: "the workshop body is two columns, aside fixed" },
  { id: "oneline", desc: "rows designed as one line render on one line" },
  { id: "rack", desc: "every build-rack system slot is visible without scrolling" },
  { id: "badge", desc: "a badge leaves air around the glyph it frames" },
  { id: "inkline", desc: "a label and the value beside it share one optical line" },
  { id: "kbdhint", desc: "the key-hint strip is centred on the field, clear of the chrome, and fades when dismissed" },
] as const;

type AssertionId = (typeof ASSERTIONS)[number]["id"];
type Findings = Record<AssertionId, string[]> & { warn: string[] };

/**
 * Runs INSIDE the page. Returns raw findings; all judgement happens back in
 * node so the rules read in one place and the browser side stays mechanical.
 */
function measure(cfg: {
  allowedScrollers: string[];
  decorative: string[];
  singleLine: string[];
  noOverlap: [string, string][];
  /** The fixture being measured — a couple of assertions are about one
   *  screen's own design contract rather than a rule that holds everywhere. */
  screen: string;
  /** The chute mouth's drawn span, as fractions of the world — see MOUTH. */
  mouth: { x0: number; x1: number };
}): Findings {
  const { allowedScrollers, decorative, singleLine, noOverlap, screen, mouth } = cfg;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Findings = {
    fit: [], scrollers: [], offscreen: [], tap: [], textclip: [],
    clipped: [], overlap: [], spill: [], draghint: [], reveal: [],
    plant: [], crest: [], rail: [], twocol: [], oneline: [], rack: [], badge: [],
    inkline: [], kbdhint: [], warn: [],
  };
  const label = (el: Element): string => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return el.id ? `#${el.id}` : cls ? `.${cls}` : el.tagName.toLowerCase();
  };

  // --- fit: nothing representing a whole screen may overflow its box ---------
  // Overflow only — flex COMPRESSION (a min-height:0 child shrinking instead
  // of overflowing) is invisible to scrollHeight by construction, and it is
  // deliberately covered elsewhere: a compressed control falls under the
  // 44px floor and the `tap` assertion catches it; compressed text clips and
  // `textclip` catches that. The division of labour is the answer, not a gap.
  document
    .querySelectorAll(".screen, .modal, .bayclear__card, .howto, .workshop, .rotate-guard")
    .forEach((el) => {
      const over = el.scrollHeight - el.clientHeight;
      if (over > 1) {
        out.fit.push(`${label(el)} overflows by ${Math.round(over)}px (${el.clientHeight} -> ${el.scrollHeight})`);
      }
    });

  // --- scrollers: which elements can actually scroll vertically -------------
  document.querySelectorAll("#overlay *").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflowY !== "auto" && cs.overflowY !== "scroll") return;
    if (el.scrollHeight - el.clientHeight <= 1) return; // able to scroll, no reason to
    if (allowedScrollers.some((sel) => el.matches(sel))) return;
    out.scrollers.push(`${label(el)} scrolls ${Math.round(el.scrollHeight - el.clientHeight)}px`);
  });

  // --- offscreen: content clipped out of the viewport -----------------------
  // Only CONTENT counts: leaf elements carrying text, plus controls. Decorative
  // chrome (.belt, .bayclear__rays, .lose-fx) bleeds past the edge by design,
  // and a rule that flagged it would need suppressing everywhere it appears.
  // A scrollable ancestor exempts ITS AXES ONLY: a card parked right of the
  // viewport inside the how-to's x-snap row is reachable content, but the same
  // row must not launder a card hanging off the BOTTOM — an either-axis
  // exemption did exactly that.
  const scrollableAxes = (el: Element): { x: boolean; y: boolean } => {
    const axes = { x: false, y: false };
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") axes.x = true;
      if (cs.overflowY === "auto" || cs.overflowY === "scroll") axes.y = true;
    }
    return axes;
  };
  document.querySelectorAll("#overlay *").forEach((el) => {
    const isControl = el.matches("button, .btn, .icon-btn, .toggle, input");
    const isTextLeaf = el.childElementCount === 0 && (el.textContent ?? "").trim().length > 0;
    if (!isControl && !isTextLeaf) return;
    if (el.closest(decorative.join(","))) return;   // bleeds past the edge by design
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;         // visually-hidden a11y text
    if (getComputedStyle(el).visibility === "hidden") return;
    const axes = scrollableAxes(el);
    const offY = r.bottom > vh + 1 || r.top < -1;
    const offX = r.right > vw + 1 || r.left < -1;
    if ((offY && !axes.y) || (offX && !axes.x)) {
      out.offscreen.push(
        `${label(el)} at [${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}] outside ${vw}x${vh}`,
      );
    }
  });

  // --- tap: WCAG 2.5.5 / iOS HIG minimum -----------------------------------
  // Scoped to things a finger is meant to hit: real <button>s, form controls,
  // links, and anything given an interactive ARIA role (the settings switch is
  // a div with role="switch" + tabindex). NOT class-based — the previous
  // selector listed .mod and .chip, which are mostly DIVS. The plant panel's
  // drafted-mod chips and the menu's Tier/Best/Salvage chips are readouts, and
  // flagging them as undersized tap targets was 42 findings about elements
  // nothing can tap. The interactive ones (.mod--bb, .mod--demo, .chip--cta)
  // are real <button>s and are still covered, by being buttons.
  // The data-attribute selectors are the app's own dispatch surface: main.ts
  // routes clicks off [data-action]/[data-game]/[data-toggle], not off tag
  // names. Today every carrier happens to be a <button> or a role-bearing div,
  // but that is coincidence, and the floor has to hold for whatever the
  // dispatcher can actually reach.
  //
  // ONE EXEMPTION, and it is stated as a rule rather than as a name: an element
  // that is BOTH aria-hidden and out of the tab order is not an exposed
  // control. WCAG 2.5.5 is about targets a user is directed to; something no
  // screen reader announces and no Tab reaches is not one of those, whatever
  // a pointer can do to it.
  //
  // Today the only such element is the tower's headhouse beacon — the nine-tap
  // gesture that opens Tier S (src/lib/devmode.ts) — and its size is a design
  // requirement rather than a shortfall. It sits in the 19px band above the
  // shaft, on a tower that fills its whole row on a phone; a 44px target there
  // would have to grow into the row above it or down over the Skydeck, where
  // it would swallow taps meant for the ladder's top rung. And an easter egg
  // with a large, discoverable hit area is not one. The mode is reachable
  // without the gesture — Settings carries the same toggle, with a real label,
  // at the full 44px — so nothing is gated behind a target anyone must hit.
  const seenTap = new Set<string>();
  document
    .querySelectorAll(
      'button, input, select, textarea, a[href], [role="button"], [role="switch"], [role="tab"], [role="checkbox"],' +
        " [data-action], [data-game], [data-toggle]",
    )
    .forEach((el) => {
      if (el.getAttribute("aria-hidden") === "true" && el.getAttribute("tabindex") === "-1") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.height >= 43.5 && r.width >= 43.5) return;
      const key = `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      if (seenTap.has(key)) return;
      seenTap.add(key);
      out.tap.push(key);
    });

  // --- textclip: text cut off by its own box --------------------------------
  // An ELLIPSIS is a deliberate design decision (the workshop cards clamp their
  // descriptions on purpose), so it warns rather than fails. A hard clip never
  // is.
  document.querySelectorAll("#overlay *").forEach((el) => {
    if (el.childElementCount !== 0) return;
    if (!(el.textContent ?? "").trim()) return;
    // The visually-hidden pattern (1x1 + clip-path, e.g. .menu__sub once the
    // attract demo takes over the brand column) is a11y text, not a clip.
    const box = el.getBoundingClientRect();
    if (box.width <= 2 || box.height <= 2) return;
    const cs = getComputedStyle(el);
    const clippedX = el.scrollWidth - el.clientWidth > 1;
    const clippedY = el.scrollHeight - el.clientHeight > 1;
    if (!clippedX && !clippedY) return;
    if (cs.overflowX === "auto" || cs.overflowX === "scroll") return; // .pl-mods, by design
    if (cs.overflow === "visible") return;                            // spills; `offscreen` owns it
    const where = `${label(el)} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
    // Two ways to say "truncate this on purpose, with an ellipsis": the
    // single-line `text-overflow` and the multi-line `-webkit-line-clamp`. Both
    // are design decisions and both render a visible "…", so both warn rather
    // than fail. Only a SILENT cut is a defect.
    const clamped = cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "";
    if (clamped) out.warn.push(`line-clamp: ${where}`);
    else if (cs.textOverflow === "ellipsis" && clippedX) out.warn.push(`ellipsis: ${where}`);
    else out.textclip.push(where);
  });

  // --- clipped: content cut off by an ANCESTOR's overflow edge --------------
  // `textclip` owns "text too big for its OWN box". This owns the other half: a
  // box that fits itself perfectly and is then sliced by something above it.
  //
  // The case it exists for is a SCROLL ROW. `overflow-x: auto` forces the block
  // axis to stop being `visible`, so anything a chip deliberately hangs outside
  // itself — the mods row's ×N badge at `top: -7px`, the ability chips' key tag
  // at `bottom: -8px` — is clipped by the row unless the row reserves padding
  // for it. Nothing else here can see that: the badge is inside the viewport
  // (`offscreen` green), inside its own box (`textclip` green), and the row
  // reports no vertical overflow at all, because block-START overflow never
  // contributes to scrollHeight.
  //
  // Only the axis the ancestor CANNOT scroll counts. Content parked outside a
  // scrollable axis is reachable by scrolling, which is the entire point of the
  // mods row's tail — flagging it would be flagging the design.
  document.querySelectorAll("#overlay *").forEach((el) => {
    const isControl = el.matches("button, .btn, .icon-btn, .toggle, input");
    const isTextLeaf = el.childElementCount === 0 && (el.textContent ?? "").trim().length > 0;
    if (!isControl && !isTextLeaf) return;
    if (el.closest(decorative.join(","))) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;
    const own = getComputedStyle(el);
    if (own.visibility === "hidden") return;
    // Where clipping STARTS. An out-of-flow box is only clipped by its
    // containing block and that block's ancestors — never by the boxes in
    // between, which do not lay it out. `offsetParent` is that containing
    // block for `position: absolute`; a fixed box has none in this app.
    let start: Element | null = el.parentElement;
    if (own.position === "fixed") return;
    if (own.position === "absolute") {
      start = (el as HTMLElement).offsetParent;
      if (!start) return;
    }
    // Once an ancestor CAN scroll an axis, everything further out is off the
    // hook for it: the content is reachable there, and the outer boxes only
    // ever clip what that scroller was already hiding. Without this the
    // leaderboard's off-screen rows read as 24 findings against `.panel` and
    // `.screen` — the list working exactly as designed.
    let reachableY = false;
    let reachableX = false;
    for (let p = start; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const scrollsY = p.scrollHeight - p.clientHeight > 1;
      const scrollsX = p.scrollWidth - p.clientWidth > 1;
      const clipsY = cs.overflowY !== "visible" && !reachableY && !scrollsY;
      const clipsX = cs.overflowX !== "visible" && !reachableX && !scrollsX;
      if (clipsY || clipsX) {
        // The overflow clip edge is the PADDING box, not the border box.
        const box = p.getBoundingClientRect();
        // Same units trap the `spill` assertion documents below, reached by
        // the other scaling mechanism: getBoundingClientRect is the SCALED
        // box while clientTop/Left/Width/Height are layout px in the
        // element's own coordinate space. The screen-anchored scaffolds carry
        // `zoom: var(--chrome-zoom)` (app.css), so on every viewport bigger
        // than the solver's authored box the two disagree by that factor —
        // mixing them put the clip edge a third of the way inside the panel
        // and reported 271 findings against boxes clipping nothing, on the
        // rows with the most room of any in the matrix.
        //
        // The zoom CHAIN, not `spill`'s rect-over-offsetWidth ratio. That
        // idiom is right where it is (it has to catch transforms too), but
        // offsetWidth is rounded to a whole px, and here the error lands on
        // a threshold rather than on a 20px overflow: at 272.31 real over an
        // offsetWidth of 272 it reads 1.0011 on a phone that is not zoomed at
        // all, which was enough to tip a column of hairline findings over the
        // 1px slack. Computed `zoom` is exact at every level, and clipping
        // ancestors in this app are not transformed.
        let pz = 1;
        for (let a: Element | null = p; a && a !== document.body; a = a.parentElement) {
          const z = parseFloat(getComputedStyle(a).zoom);
          if (Number.isFinite(z) && z > 0) pz *= z;
        }
        const top = box.top + p.clientTop * pz;
        const left = box.left + p.clientLeft * pz;
        const cutY = clipsY ? Math.max(top - r.top, r.bottom - (top + p.clientHeight * pz)) : 0;
        const cutX = clipsX ? Math.max(left - r.left, r.right - (left + p.clientWidth * pz)) : 0;
        // Back into the parent's OWN px before the 1px slack is applied. Both
        // rects are scaled, so a fixed slack in scaled px is a tighter test
        // the more a row is magnified — `.menu__demo-hit` is `inset: 0` and
        // therefore its parent's padding box exactly, and it still failed by
        // a rounding step on the one row whose zoom has a 0.366 fraction.
        // Dividing puts the threshold back in the units the stylesheet is
        // written in, which is also what makes the reported number greppable.
        const cut = Math.max(cutY, cutX) / pz;
        if (cut > 1) {
          out.clipped.push(
            `${label(el)} "${(el.textContent ?? "").trim().slice(0, 12)}" cut ${Math.round(cut)}px by ${label(p)}`,
          );
        }
      }
      if (scrollsY) reachableY = true;
      if (scrollsX) reachableX = true;
    }
  });

  // --- overlap: side-by-side boxes must not cover each other ----------------
  noOverlap.forEach(([aSel, bSel]) => {
    const a = document.querySelector(aSel);
    const b = document.querySelector(bSel);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (ra.width <= 0 || rb.width <= 0) return;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 1 && oy > 1) {
      out.overlap.push(`${aSel} covers ${bSel} by ${Math.round(ox)}x${Math.round(oy)}px`);
    }
  });

  // --- spill: a grid/flex item must stay inside the box that lays it out -----
  // The GENERAL form of `overlap`. NO_OVERLAP is a hand-curated pair list read
  // through querySelector, so it sees exactly the two boxes someone thought to
  // name, and only the first match of each — it can never say "row 4 of a grid
  // covers row 5". This says the same thing structurally instead: an item whose
  // parent lays it out cannot be wider than the space that parent gave it.
  //
  // Horizontal only. The failure mode this names is the missing `min-width: 0`
  // on a grid/flex child — an `auto` track sized by nowrap content refuses to
  // shrink, so the cell grows past its track and paints over whatever is beside
  // it. Vertical growth is how a row is SUPPOSED to react to its content, and
  // `fit`/`oneline` already own the cases where that is wrong.
  //
  // Nothing else could see the Controls bug this was written for: the span was
  // not clipped (scrollWidth === clientWidth, so `textclip` green), no ancestor
  // hid its overflow (`clipped` green), the row stayed on screen (`offscreen`
  // green) and its own children never wrapped (`oneline` green). It simply
  // painted over the next grid column.
  const seenSpill = new Set<string>();
  document.querySelectorAll("#overlay *").forEach((el) => {
    const parent = el.parentElement;
    if (!parent || parent === document.body) return;
    const pcs = getComputedStyle(parent);
    if (!/^(inline-)?(flex|grid)$/.test(pcs.display)) return;
    // A parent that clips or scrolls is CONTAINING its child, not spilling it:
    // the clip belongs to `clipped`, and a scroller's content is reachable.
    if (pcs.overflowX !== "visible") return;
    const cs = getComputedStyle(el);
    // Out-of-flow children are not laid out by the grid at all, and a transform
    // moves the painted box without moving the layout box `min-width` governs.
    if (cs.position === "absolute" || cs.position === "fixed") return;
    if (cs.transform !== "none" || cs.visibility === "hidden") return;
    if (el.closest(decorative.join(","))) return;   // bleeds by design
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;
    const pr = parent.getBoundingClientRect();
    const px = (v: string): number => parseFloat(v) || 0;
    // getBoundingClientRect returns the TRANSFORMED box while getComputedStyle
    // returns untransformed px, so mixing them measures a scaled box against
    // unscaled padding. `.settle-note` sits at scale(0.94) until it is shown,
    // and that mismatch alone reported its 8px dot spilling 1px on every HUD
    // fixture on every device. The parent's own rect over its offsetWidth
    // recovers the cumulative scale from ALL ancestors, not just this one.
    const scale = parent.offsetWidth > 0 ? pr.width / parent.offsetWidth : 1;
    // The CONTENT box, not the border box — a child sitting on its parent's
    // padding is already outside the track it was given.
    const innerL = pr.left + (px(pcs.borderLeftWidth) + px(pcs.paddingLeft)) * scale;
    const innerR = pr.right - (px(pcs.borderRightWidth) + px(pcs.paddingRight)) * scale;
    const over = Math.max(innerL - r.left, r.right - innerR);
    if (over <= 1) return;
    const key = `${label(el)} spills ${Math.round(over)}px out of ${label(parent)}`;
    if (seenSpill.has(key)) return;
    seenSpill.add(key);
    out.spill.push(`${key} (${Math.round(r.width)}px in a ${Math.round(innerR - innerL)}px cell)`);
  });

  const rootStyle = getComputedStyle(document.documentElement);
  const cssPx = (name: string): number => parseFloat(rootStyle.getPropertyValue(name));

  // --- plant: the HUD panel must stay inside its 42.96%-of-field box ---------
  // The TUTORIAL state has its own, deliberately larger budget: while the coach
  // card shares the panel's column, app.css caps .plant at 52% of the field
  // height — a cap derived from clearing the cannon sprite, see the
  // `.hud[data-coach] .plant` max-height rule — so THAT cap is the design box
  // the assertion holds the panel to on the coach screens. Same number, one
  // source of truth in the stylesheet, read here rather than re-derived.
  //
  // Both directions matter. The upper bound alone only ever catches a panel
  // that grew; a rule that SHRINKS it back — `.hud--contract .plant { min-
  // height: 0 }` reappearing, or any future rule with the same effect — passes
  // every device here and would only ever be caught by a human reading the
  // real app, which is not a repeatable gate. `.plant`'s own `min-height:
  // calc(0.4296 * var(--field-h))` is unconditional in app.css — there is no
  // `.hud--contract` override on it — so 0.4296 is the floor on every screen,
  // Contract or Deep Run, coached or not.
  const plant = document.querySelector(".plant");
  if (plant) {
    const fh = cssPx("--field-h");
    const coached = !!document.querySelector(".hud[data-coach]");
    const design = (coached ? 0.52 : 0.4296) * fh;
    const h = plant.getBoundingClientRect().height;
    if (h > design + 1) {
      out.plant.push(
        `${Math.round(h)}px vs design ${Math.round(design)}px (${((h / fh) * 100).toFixed(0)}% of field height)`,
      );
    }
    // NOT `design`: on a coached screen `design` is 0.52 * fh, the tutorial's
    // MAX layered on top of the same 0.4296 floor (app.css never replaces the
    // floor for that screen, only adds a ceiling above it) — reusing it here
    // would demand a coached panel 21% taller than the stylesheet asks for.
    if (h < 0.4296 * fh - 1) {
      out.plant.push(`${Math.round(h)}px — shrank below its ${Math.round(0.4296 * fh)}px footprint`);
    }
  }

  // --- crest: the intake ring must start on the edges it dresses -----------
  // `plant` above asks whether the PANEL is the right size. It has nothing to
  // say about the seven strips hung off the panel's outside, and that is the
  // gap this closes: the crest shipped with its left band beginning --bw
  // inside the panel's top-left corner (app.css's .plant__crest--port took
  // `top: 0`, the PADDING box, where every sibling strip spells out the
  // border correction), and the frame read as broken to a player while every
  // assertion here stayed green.
  //
  // The rule is one sentence: every strip's rooted edge sits on the panel's
  // BORDER box, the two bands reach the field's wall, and the canvas's own
  // half of that silhouette — the intake mouth drawn under the panel's top —
  // ends on the same two vertical edges (see the mouth clause at the bottom).
  // The crest's whole job is dressing that border, so anything that starts
  // anywhere else is painting a notch. Deliberately NOT a check on the crenellation — the
  // tooth runs are hand-authored irregular by design (see app.css's crest
  // section) and a test that pinned their silhouette would only ever fire on
  // someone redrawing the art on purpose.
  //
  // The tolerance is 0.6px: the offsets are calc() chains over fractional
  // field dimensions, so a rooted edge lands within a rounding step of the
  // panel's, and the defect this exists for was --bw = 2px, three times that.
  //
  // PRESENCE FIRST, then geometry. All seven strips are unconditional in
  // screens.ts's hudHTML — brow, flank, port and skirt hung off `.plant`,
  // cap, step and shoulder off the `.pl-pwr` cap nested inside it — and
  // hudHTML is the only thing that renders a `.plant` at all (the coach
  // fixtures inject into its markup rather than building their own). So a
  // panel that renders renders the WHOLE ring, and none of the seven is
  // optional. That matters because the natural way to write this — compare
  // an edge only if the strip is there — is an assertion that goes green by
  // deleting the thing it exists to hold: rename a class, drop an `<i>`, and
  // the ring loses an edge while the check reports nothing. Each missing
  // segment is its own violation, reported before any geometry is compared.
  //
  // The RIVETS are deliberately out of scope. They plug the corners where two
  // independent tooth runs meet, their offsets derive from the same --bw the
  // strips use, and there are six rather than eight for a reason app.css
  // documents (no R5 — the shoulder/flank join is not a turn). Their presence
  // is a statement about the art, which this assertion does not make.
  const strip = (name: string): DOMRect | null =>
    document.querySelector(`.plant__crest--${name}`)?.getBoundingClientRect() ?? null;
  if (plant) {
    const p = plant.getBoundingClientRect();
    const seg: Record<string, DOMRect | undefined> = {};
    for (const name of ["brow", "cap", "step", "shoulder", "flank", "port", "skirt"]) {
      const rect = strip(name);
      if (rect) seg[name] = rect;
      else out.crest.push(`the ${name} strip is missing — the ring has no such segment to seat`);
    }
    // Undefined reaches `seat` only for a segment already reported missing
    // above, and an edge that does not exist has no offset to report twice.
    const seat = (name: string, edge: number | undefined, want: number | undefined): void => {
      if (edge === undefined || want === undefined) return;
      const d = edge - want;
      if (Math.abs(d) > 0.6) out.crest.push(`${name} sits ${d > 0 ? "+" : ""}${d.toFixed(1)}px off`);
    };
    const { brow, cap, step, shoulder, flank, port, skirt } = seg;
    // The top edge is TWO strips at two heights — the brow along the panel's
    // own top, the cap up over the raised PWR meter, with the step rising
    // between them and the shoulder bringing the run back down the cap's far
    // side — so it is checked as a chain of handoffs rather than as one band.
    // That step is the design, not a break in the ring; what the ring must not
    // do is leave a gap at a join.
    seat("brow left vs panel left", brow?.left, p.left);
    seat("brow bottom vs panel top", brow?.bottom, p.top);
    seat("brow right vs cap left", brow?.right, cap?.left);
    seat("step right vs cap left", step?.right, cap?.left);
    seat("step top vs cap bottom", step?.top, cap?.bottom);
    seat("cap right vs panel right", cap?.right, p.right);
    seat("shoulder top vs cap bottom", shoulder?.top, cap?.bottom);
    seat("shoulder left vs panel right", shoulder?.left, p.right);
    seat("flank left vs panel right", flank?.left, p.right);
    seat("flank top vs panel top", flank?.top, p.top);
    seat("flank bottom vs panel bottom", flank?.bottom, p.bottom);
    seat("port right vs panel left", port?.right, p.left);
    seat("port top vs panel top", port?.top, p.top);
    seat("port bottom vs panel bottom", port?.bottom, p.bottom);
    seat("skirt left vs panel left", skirt?.left, p.left);
    seat("skirt right vs panel right", skirt?.right, p.right);
    seat("skirt top vs panel bottom", skirt?.top, p.bottom);
    // The two bands' FREE edges. Both are sized to the gap between the panel
    // and the field border less --crest-wall, so both should clear the glowing
    // wall by the SAME amount — that equality is the one statement about them
    // the rooted-edge checks above do not already imply, and it is what fails
    // if one band is ever given a different clearance from the other, or if
    // either is left reaching into the letterbox (a negative clearance).
    if (port && skirt) {
      const portClear = port.left - cssPx("--field-x");
      const skirtClear = cssPx("--field-y") + cssPx("--field-h") - skirt.bottom;
      seat("port tips vs skirt tips (wall clearance)", portClear, skirtClear);
      if (portClear < 0 || skirtClear < 0) {
        out.crest.push(
          `a band reaches past the field border (port ${portClear.toFixed(1)}px, skirt ${skirtClear.toFixed(1)}px)`,
        );
      }
    }
    // THE OTHER HALF OF THE SAME EDGE. The ring is not the only thing drawn on
    // the panel's silhouette: render.ts's drawChute paints the intake's lip bar
    // along the panel's top, in world space, on the canvas underneath — and
    // under a strand warning it paints it bright red. The seven strips above
    // can each be perfectly seated while that bar runs on past the corner they
    // turn, which is exactly what shipped: the mouth was drawn from the chute
    // RECT (world x 0, the field's left wall) rather than from the panel's own
    // left edge, laying a crimson bar across the field's glowing wall for the
    // 21 world px the ring does not cover. #115 read the same band in a
    // screenshot, correctly attributed it to the canvas, and left it there.
    //
    // Nothing draws in this harness, so this asserts the GEOMETRY the painter
    // is handed rather than pixels: the mouth's two ends, mapped through the
    // live field rect the same way the viewport transform maps them, land on
    // the panel's own left and right border-box edges. That is a statement no
    // DOM measurement can make and no unit test can either — the constant
    // lives in world px and the panel lives in CSS fractions, and this is the
    // one place both are on screen at once.
    const fieldX = cssPx("--field-x");
    const fieldW = cssPx("--field-w");
    seat("chute mouth left vs panel left", fieldX + mouth.x0 * fieldW, p.left);
    seat("chute mouth right vs panel right", fieldX + mouth.x1 * fieldW, p.right);
  }

  // --- rack: every system slot must be reachable at a glance ----------------
  // The build row scrolls horizontally, which is right for the HAZARD chips
  // after it — a deep run banks up to ten distinct axes and no panel holds
  // them — but wrong for the ship's systems. There is a fixed set of them, the
  // same set for the whole run, and they are the readout a player checks
  // mid-bay to know what their rig can do; one of them parked off the right
  // edge is not a readout, it is a thing you have to remember to go looking
  // for. So the slots are sized to the narrowest panel in the matrix rather
  // than to a comfortable one (app.css's .ship-plate), and this is what holds
  // that: every plate's right edge inside the row's CLIENT box, measured at
  // scrollLeft 0, which is where the row sits until a thumb moves it.
  //
  // Not derivable from `offscreen` or `clipped`: the row is a legitimate
  // horizontal scroller, so both of those exempt its overflow by design — a
  // plate hanging off it is reachable content by their rules, and silent.
  const modsRow = document.querySelector(".pl-mods");
  if (modsRow) {
    const rowBox = modsRow.getBoundingClientRect();
    // clientWidth excludes the scrollbar; borders are on the panel, not here.
    const visibleRight = rowBox.left + modsRow.clientWidth;
    document.querySelectorAll(".pl-mods .ship-plate").forEach((plate, i) => {
      const r = plate.getBoundingClientRect();
      const over = r.right - visibleRight;
      if (over > 1) {
        const g = plate.querySelector(".ship-plate__g")?.textContent ?? `#${i}`;
        out.rack.push(`slot ${g} sits ${Math.round(over)}px past the row's visible edge`);
      }
    });
  }

  // --- badge: a framed glyph must not be crowded by its own frame ----------
  // `rack` above holds the row: seven slots, all visible. This holds the SLOT:
  // that the box is wide enough for the glyph it exists to carry.
  //
  // Nothing else here can see it. The plate is `overflow: visible`, so
  // `textclip` hands it straight to `offscreen` ("spills; `offscreen` owns
  // it"), and `offscreen` only ever asks whether content left the VIEWPORT —
  // a glyph pressed against, or through, the border of a 25px box in the
  // middle of the panel is inside the viewport, inside its own box, and
  // overlaps nothing. The rack was shipping at 0.39em of side air on all ten
  // phones and every assertion was green.
  //
  // The floor is 0.4em of the glyph's OWN font size per side, which makes it
  // one number at every density instead of a px budget per device. It is read
  // off the shape the plate was drawn at: at regular and roomy density, where
  // the width has never been floored and nobody has reported anything, the
  // plates give their glyph 0.53-0.59em a side. 0.4em is where a three-letter
  // glyph starts to read as touching its frame rather than sitting in it.
  document.querySelectorAll(".ship-plate").forEach((plate, i) => {
    const g = plate.querySelector(".ship-plate__g") as HTMLElement | null;
    if (!g) return;
    const pr = plate.getBoundingClientRect();
    if (pr.width <= 2) return;
    const gr = g.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(g).fontSize);
    // clientWidth is the padding box: the border is frame, not air.
    const air = ((plate as HTMLElement).clientWidth - gr.width) / 2;
    if (air < 0.4 * em - 0.01) {
      out.badge.push(
        `${g.textContent ?? `#${i}`} has ${(air / em).toFixed(2)}em of side air ` +
          `(${air.toFixed(1)}px in a ${Math.round(pr.width)}px slot, floor 0.4em)`,
      );
    }
  });

  // --- inkline: a label and its value must share one OPTICAL line ----------
  // Two typefaces baseline-aligned are not thereby eye-aligned, and — the part
  // this assertion originally got wrong — neither are two typefaces whose caps
  // meet on a shared FOOT. Press Start 2P's capitals stop 0.125em above the
  // alphabetic baseline where JetBrains Mono's sit on it, AND they are 19%
  // taller (0.875em of cap against 0.734em). Correct only the foot and the
  // shorter run's mass still lands (0.875 - 0.734) / 2 = 0.0703em low. What has
  // to agree is the cap CENTRE; tokens.css's --pixel-optical-drop pays both
  // halves.
  //
  // Invisible to every other assertion by construction: the row does not
  // overflow, wrap, clip, scroll or overlap while it is wrong. It just looks
  // wrong, which is how it reached a player before it reached CI.
  //
  // Measured where the INK is, not where the box is. A box tells you nothing
  // here — both runs' boxes start at the same y and the defect is entirely
  // inside them. Baseline comes from an empty inline-block, whose bottom
  // margin edge sits on the line box's baseline by definition.
  //
  // The cap geometry comes from a 1000px PROBE of the same face, scaled down to
  // the element's real size — never from measuring at the element's own size.
  // Chrome quantizes actualBoundingBoxAscent/Descent to whole device pixels, so
  // at this row's 6px type floor every reading is rounded to +/-0.5px: the same
  // magnitude as the drift being policed. Measuring in situ, this assertion
  // reported 0.22px on a row that was really 0.43px out, and would have gone on
  // reporting something under tolerance whatever the row did. A per-em ratio
  // read once at 1000px has no such floor.
  //
  // A CAPITAL H, not the element's own text. The row's real content carries
  // descenders that are meant to descend — the notch line opens with "$L×2"
  // and JetBrains Mono's dollar sign drops 0.14em below the baseline — and
  // measuring those would report a 2px defect on a row that is correct.
  // What has to agree is where the two faces put a plain cap, which is a
  // property of the faces and not of the tally. H has no round overshoot in
  // either of them.
  //
  // The baseline probe is UNSAFE on a flex or grid container whose items are
  // not baseline-aligned, and this is not a corner case worth a silent wrong
  // answer. Appending an inline-block child to `el` only reads the true line
  // box's baseline if `el` lays that child out as an ordinary inline box — a
  // flex/grid container BLOCKIFIES it into an item instead (confirmed via
  // getComputedStyle: an inline-block probe's computed display reads "block"
  // the moment it is appended into one), and `vertical-align` has no effect
  // on a flex/grid item, so `align-items` decides where it lands instead of
  // the text underneath it.
  // Under `baseline` that item is a no-own-baseline participant, and the flex
  // baseline-alignment algorithm places its margin edge ON the line's real
  // shared baseline (the same edge the classic inline-block trick relies on)
  // — confirmed empirically against `.pl-notch b` (flex, baseline): the probe
  // lands somewhere between the box's top and bottom, tracking the real text.
  // Under any OTHER align-items the probe is simply centred (or start/end
  // aligned) on the box's own cross-axis, with no relationship to the ink at
  // all — confirmed against `.pl-tier b` (flex, center): the probe's position
  // was bit-identical to the box's geometric centre, regardless of content.
  // Silently returning that centre as "the baseline" is how `.pl-tier`
  // shipped a confidently-wrong -1.98px to -4.49px reading, and how a since-
  // reverted fix then shipped an equally confident wrong number in the other
  // direction.
  //
  // The fix is a FALLBACK, not a wider silence: isolate the value's own text
  // in a plain wrapper that re-establishes ordinary flow (capMid's own
  // comment below has the mechanics and the proof it does not disturb the
  // row), and only give up — loudly, by throwing — when even that cannot
  // find something to measure. A caller that genuinely cannot see a row's
  // real ink still has to know that, not be handed a plausible-looking lie;
  // it just needs a real fallback tried first, or the one row this branch
  // added and mis-aligned ships with no automated guard at all.
  const PROBE_PX = 1000;
  // The classic trick, isolated: append an empty inline-block probe and read
  // where its bottom margin edge lands. Correct whenever `container` lays its
  // children out in ORDINARY flow — whether that is `el` itself (the common
  // case) or, via the wrapper fallback below, a stand-in that re-establishes
  // ordinary flow for content a flex/grid container would otherwise blockify.
  const baselineOf = (container: Element): number => {
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    container.appendChild(probe);
    const y = probe.getBoundingClientRect().bottom;
    probe.remove();
    return y;
  };
  const capMid = (el: Element, cvs: CanvasRenderingContext2D): number | null => {
    if (!(el.textContent ?? "").trim()) return null;
    const cs0 = getComputedStyle(el);
    const unsafe = (cs0.display === "flex" || cs0.display === "inline-flex"
      || cs0.display === "grid" || cs0.display === "inline-grid")
      && cs0.alignItems !== "baseline";
    let baseline: number;
    if (!unsafe) {
      baseline = baselineOf(el);
    } else {
      // FALLBACK for the shape the plain probe cannot read (see the header
      // comment above): isolate `el`'s own direct text in a plain
      // `display:inline-block` wrapper. Blockification only touches a
      // flex/grid container's DIRECT children, so the probe — appended
      // inside THIS wrapper rather than inside `el` — sees an ordinary
      // inline formatting context again and reads the real ink.
      //
      // Wraps ONLY the text, never the whole element: wrapping the icon
      // too re-flows it through ordinary inline rules instead of the flex
      // ones that actually size it, which measurably MOVES the reading
      // (confirmed against `.pl-tier b`: -0.33px off this method, against
      // 0.02px wrapping the text alone — a different answer, not a noisier
      // one) and visibly narrows the box while wrapped, even though it is
      // restored correctly after. An element with no direct text node has
      // nothing this fallback can isolate, so it falls through to the throw
      // below rather than guessing.
      const textNode = [...el.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim(),
      );
      if (!textNode) {
        throw new Error(
          `capMid cannot measure ${label(el)}: ${cs0.display} with align-items:${cs0.alignItems}, `
            + `and no direct text node to isolate in a wrapper.`,
        );
      }
      const text = textNode.textContent ?? "";
      const row = el.parentElement;
      const beforeEl = el.getBoundingClientRect();
      const beforeRow = row?.getBoundingClientRect();
      const wrapper = document.createElement("span");
      wrapper.style.cssText = "display:inline-block";
      wrapper.textContent = text;
      el.replaceChild(wrapper, textNode);
      baseline = baselineOf(wrapper);
      // Sampled WHILE the wrapper is still in place, not just before/after:
      // a wrapper that perturbs the row's layout during measurement and
      // restores cleanly afterwards would pass a before/after-only check,
      // and that failure mode is not hypothetical — it is exactly what
      // wrapping the whole element instead of just its text does (see this
      // function's comment above: it visibly narrows the box while wrapped,
      // even though the DOM is restored correctly after). The reading taken
      // one line above, `baselineOf(wrapper)`, happens inside this same
      // window, so THIS is the check that can actually invalidate it.
      const duringEl = el.getBoundingClientRect();
      const duringRow = row?.getBoundingClientRect();
      wrapper.replaceWith(textNode);
      const afterEl = el.getBoundingClientRect();
      const afterRow = row?.getBoundingClientRect();
      const moved = (a: DOMRect, b: DOMRect): boolean =>
        Math.abs(a.top - b.top) > 0.01 || Math.abs(a.left - b.left) > 0.01
        || Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01;
      if (
        moved(beforeEl, duringEl)
        || (beforeRow && duringRow && moved(beforeRow, duringRow))
      ) {
        throw new Error(
          `capMid wrapper fallback perturbed ${label(el)}'s geometry WHILE measuring — the `
            + `reading is not trustworthy even though the DOM will be restored: `
            + `element ${JSON.stringify(beforeEl)} -> ${JSON.stringify(duringEl)}, `
            + `row ${JSON.stringify(beforeRow)} -> ${JSON.stringify(duringRow)}.`,
        );
      }
      // A second, separate check: proves the swap-and-restore itself left
      // `el` (and its row) exactly where they were, catching a broken
      // restoration even on a wrapper that measured cleanly.
      if (
        moved(beforeEl, afterEl)
        || (beforeRow && afterRow && moved(beforeRow, afterRow))
      ) {
        throw new Error(
          `capMid wrapper fallback left ${label(el)}'s geometry changed after restoring: `
            + `element ${JSON.stringify(beforeEl)} -> ${JSON.stringify(afterEl)}, `
            + `row ${JSON.stringify(beforeRow)} -> ${JSON.stringify(afterRow)}.`,
        );
      }
    }
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    if (!(size > 0)) return null;
    cvs.font = `${cs.fontStyle} ${cs.fontWeight} ${PROBE_PX}px ${cs.fontFamily}`;
    const m = cvs.measureText("H");
    // Both offsets are measured DOWN from the baseline, so a cap that stops
    // above it has a negative descent. Their mean is the cap box's centre.
    const midEm = (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2 / PROBE_PX;
    return baseline + midEm * size;
  };
  const cvs = document.createElement("canvas").getContext("2d");
  if (cvs) {
    // [row, label, value] — the panel's mixed-typeface rows. Listed rather
    // than discovered: a rule that hunted for font-family changes would also
    // find the deliberate ones (the funds figure UNDER its label, the PWR cap's
    // centre-aligned readout) and have to carry exceptions for them.
    //
    // `.pl-notch` is two different rows depending on the class alone: Deep
    // Run's Notches tally (value is a `.pl-notch__ax` chip run) and a
    // Contract's Bay-conditions line (value is a plain `<b>`, no chips at
    // all — screens.ts's hudHTML). One unscoped `.pl-notch` entry can only
    // ever match whichever the CURRENT fixture rendered, and on a Contract
    // fixture that used to mean matching the Bay row while still asking for
    // `.pl-notch__ax` — `row.querySelector(lblSel)` found the label,
    // `row.querySelector(valSel)` found nothing, and `if (!lbl || !val)
    // return;` below silently skipped the row rather than failing loud. Two
    // scoped entries instead, one per actual shape.
    ([
      [".hud:not(.hud--contract) .pl-notch", ".lbl", ".pl-notch__ax"],
      [".hud--contract .pl-notch", ".lbl", "b"],
      [".pl-queue", ".lbl", "b"],
      [".pl-tier", ".lbl", "b"],
    ] as [string, string, string][]).forEach(([rowSel, lblSel, valSel]) => {
      const row = document.querySelector(rowSel);
      if (!row) return;
      const lbl = row.querySelector(lblSel);
      const val = row.querySelector(valSel);
      if (!lbl || !val) return;
      // capMid THROWS rather than returning a number for a shape it cannot
      // trust (see its own comment) — caught here, once per row, so one
      // unmeasurable entry does not abort every other screen's run. Printed
      // as a warning rather than silently dropped: a row this assertion
      // cannot see is a coverage gap, not a pass, and the report says so on
      // every run rather than once.
      let a: number | null;
      let b: number | null;
      try {
        a = capMid(lbl, cvs);
        b = capMid(val, cvs);
      } catch (err) {
        out.warn.push(`inkline cannot verify ${rowSel}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (a === null || b === null) return;
      // Half a pixel: below that the difference is rasterisation, not layout.
      if (Math.abs(b - a) > 0.5) {
        out.inkline.push(
          `${rowSel} value sits ${(b - a).toFixed(2)}px ${b > a ? "below" : "above"} its label`,
        );
      }
    });
  }

  // --- reveal: the tutorial's progressive readout, at its first step --------
  // The plant reveals one block per step, and step 0 is the strictest state:
  // PWR only, because the drag is the whole lesson and a first-timer meeting
  // the whole readout at once was the playtest complaint that created it.
  // It is enforced by `display: none` rules of specificity (0,3,0), which is
  // low enough that ANY later rule naming the same block at the same weight
  // silently un-hides it — a styling change to Launches did exactly that, and
  // put it on the aim-and-fire card a full step before the shot that is meant
  // to introduce it. Nothing else here would notice: the block is inside the
  // viewport, inside its box, and does not overlap a thing.
  // Restated as a list rather than derived from the stylesheet on purpose:
  // read off the CSS it would agree with any bug the CSS has.
  if (screen === "coach") {
    [".pl-funds", ".pl-time", ".pl-notch", ".pl-meta", ".pl-mods", ".pl-load", ".pl-launches"]
      .forEach((sel) => {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().height > 0) {
          out.reveal.push(`${sel} is on screen at coach step 0`);
        }
      });
  }

  // --- draghint: the onboarding gesture must play clear of the panel --------
  // The hint is an ANIMATION, so its dot cannot simply be measured: the harness
  // drives every animation to its end state, where the dot is back at the start
  // with opacity 0. What it can measure is the invariant the CSS is written to
  // hold — the dot's furthest reach below the hint box, published by the
  // stylesheet as `--hint-reach` precisely so this does not have to restate it,
  // must land above the plant panel's top edge. The panel is z-index 6 and the
  // hint is not, so anything below that line is not "overlapping", it is gone.
  const hint = document.querySelector(".drag-hint");
  const plantEl = document.querySelector(".plant");
  if (hint && plantEl) {
    const reach = parseFloat(getComputedStyle(hint).getPropertyValue("--hint-reach"));
    const hb = hint.getBoundingClientRect();
    const pb = plantEl.getBoundingClientRect();
    const dips = hb.top + reach - pb.top;
    if (dips > 1) out.draghint.push(`gesture reaches ${Math.round(dips)}px under .plant`);
  }

  // --- kbdhint: the key-hint strip belongs to the FIELD ---------------------
  // The strip replaces the whole touch rail on a fine pointer, so on desktop it
  // is the only thing on screen that names a control. It is chrome of the
  // MACHINE, not of the window, and every number below is measured against the
  // solved field rather than the viewport — which is the entire point. It was
  // written as `left: 50%` + `bottom: 2px`, and those coincide with the field's
  // centre and foot only in "wide", where the letterbox gutters are symmetric
  // and the world reaches the bottom of the screen. In "snug" — every ordinary
  // 16:9/16:10 laptop window, because the solver reserves an 84px right band
  // there — the strip sat 42px right of the machine and floated up to 69px
  // below it, and no row in this matrix could see it because no row had a fine
  // pointer.
  //
  // Skipped unless the strip is actually rendered: it is display:none on a
  // coarse pointer without a gamepad, which is most of this matrix.
  const kb = document.querySelector(".kbd-hint");
  if (kb && getComputedStyle(kb).display !== "none") {
    const fx = cssPx("--field-x");
    const fy = cssPx("--field-y");
    const fw = cssPx("--field-w");
    const fh = cssPx("--field-h");
    const k = kb.getBoundingClientRect();
    // Centred on the field. 1px of tolerance for sub-pixel rounding; anything
    // beyond that is an anchor pointed at the wrong box, not a rounding error.
    const dx = (k.left + k.width / 2) - (fx + fw / 2);
    if (Math.abs(dx) > 1) {
      out.kbdhint.push(`strip is ${Math.round(dx)}px off the field's centre`);
    }
    // Attached to an edge of the field. Which edge depends on the mode — the
    // "tall" layout lifts the strip above the field because the rail owns the
    // bottom band there — so assert the DISTANCE to the nearer edge rather than
    // restating the stylesheet's choice, and let either be correct.
    const gapBelow = k.top - (fy + fh);
    const gapAbove = fy - k.bottom;
    const gap = Math.max(gapBelow, gapAbove);
    if (gap > 8) {
      out.kbdhint.push(`strip floats ${Math.round(gap)}px clear of the field`);
    }
    // Inside the field horizontally. The reserved band is rail, not strip, and
    // a strip wider than the window is silently clipped at both ends.
    if (k.left < fx - 1 || k.right > fx + fw + 1) {
      out.kbdhint.push(
        `strip spans ${Math.round(k.left)}..${Math.round(k.right)} outside the field ${Math.round(fx)}..${Math.round(fx + fw)}`,
      );
    }
    // …and not under the rail, which is the one piece of chrome it shares a
    // lane with once it is bottom-anchored.
    const railEl = document.querySelector(".side-rail");
    if (railEl) {
      const r = railEl.getBoundingClientRect();
      const ox = Math.min(r.right, k.right) - Math.max(r.left, k.left);
      const oy = Math.min(r.bottom, k.bottom) - Math.max(r.top, k.top);
      if (ox > 1 && oy > 1) {
        out.kbdhint.push(`strip overlaps the rail by ${Math.round(ox)}x${Math.round(oy)}px`);
      }
    }
    // The strip is TRANSIENT now (main.ts's armKeyHints/dismissKeyHints): a
    // bay's first shot retires it to the pause modal's reference block, via
    // the kbd-hint--hidden class. The geometry above is measured in the SHOWN
    // state the fixtures mount; this pins the other half of the contract —
    // that the dismissed class actually removes the strip from view. Opacity,
    // not display, is the mechanism (app.css keeps the box in layout so the
    // retirement is a visible fade), so opacity is what is asserted; the
    // harness zeroes transition durations, which is what makes the class flip
    // measurable in the same frame.
    const wasHidden = kb.classList.contains("kbd-hint--hidden");
    kb.classList.add("kbd-hint--hidden");
    const faded = parseFloat(getComputedStyle(kb).opacity);
    // Restore the fixture's own state — the screenshot pass reads the DOM
    // after this measure, and a check must not repaint what it measured.
    if (!wasHidden) kb.classList.remove("kbd-hint--hidden");
    if (faded > 0.01) {
      out.kbdhint.push(`kbd-hint--hidden leaves the strip at opacity ${faded}`);
    }
  }

  // --- rail: the control rail must never sit over the play field ------------
  const rail = document.querySelector(".side-rail");
  if (rail) {
    const fx = cssPx("--field-x");
    const fy = cssPx("--field-y");
    const fw = cssPx("--field-w");
    const fh = cssPx("--field-h");
    const r = rail.getBoundingClientRect();
    const overlapX = Math.min(r.right, fx + fw) - Math.max(r.left, fx);
    const overlapY = Math.min(r.bottom, fy + fh) - Math.max(r.top, fy);
    if (overlapX > 1 && overlapY > 1) {
      out.rail.push(`rail overlaps field by ${Math.round(overlapX)}x${Math.round(overlapY)}px`);
    }
  }

  // --- twocol: the workshop's two-column body -------------------------------
  // Asserts the LAYOUT, which moved: it used to check that the card grid ran
  // two-up. The shop is now one of two columns itself — a fixed aside carrying
  // budget and owned state, beside the scrolling shelf — so the card grid
  // reflowing to a single column inside a narrow shelf is correct, and the
  // thing worth holding is that the body kept its two tracks and that the
  // aside is NOT the part that scrolls.
  const body = document.querySelector(".workshop__body");
  if (body) {
    const tracks = getComputedStyle(body).gridTemplateColumns.trim().split(/\s+/).length;
    if (tracks < 2) out.twocol.push(`workshop body has ${tracks} column(s)`);
    const aside = document.querySelector(".workshop__aside");
    if (aside && aside.scrollHeight - aside.clientHeight > 1) {
      out.twocol.push(`workshop aside scrolls ${Math.round(aside.scrollHeight - aside.clientHeight)}px`);
    }
  }

  // --- oneline: rows contracted to a single line must not wrap --------------
  // Vertical SPAN, not box height: the row's own height is unreliable because a
  // grid/flex parent can stretch it well past its content (.pl-load measures
  // 20px tall around an 8px label whenever it shares a stretched row), which a
  // height test would read as a wrap. Comparing how far the children spread
  // vertically against the tallest single child is immune to that, and to the
  // baseline nudges that `align-items: center` introduces between a label and a
  // shorter bar sitting beside it.
  singleLine.forEach((sel) => {
    document.querySelectorAll(sel).forEach((row) => {
      const kids = [...row.children]
        .map((k) => k.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      if (kids.length < 2) return;
      const span = Math.max(...kids.map((r) => r.bottom)) - Math.min(...kids.map((r) => r.top));
      const tallest = Math.max(...kids.map((r) => r.height));
      if (span <= tallest + 1) return;
      // Report the gap-inclusive requirement, not the bare sum of the children.
      // A row that wraps at 189px "needing" 172px reads as a harness bug; the
      // 24px of column gaps between five items is the whole difference, and
      // whoever reads this line is about to pick a column width from it.
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const needs = kids.reduce((n, r) => n + r.width, 0) + gap * (kids.length - 1);
      out.oneline.push(
        `${label(row)} wrapped — children span ${Math.round(span)}px of a ` +
          `${Math.round(tallest)}px line (${Math.round(row.getBoundingClientRect().width)}px wide, ` +
          `needs ${Math.round(needs)}px incl. ${kids.length - 1} gaps)`,
      );
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function loadBaseline(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await readFile(BASELINE, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) {
  console.error("✗ the harness dev server reported no local URL");
  process.exit(1);
}

const playwright = await import("playwright");
const launcher = (playwright as unknown as Record<string, typeof playwright.chromium>)[ENGINE];
if (!launcher) {
  console.error(`✗ unknown engine "${ENGINE}" (chromium | webkit | firefox)`);
  await server.close();
  process.exit(1);
}

let browser: Awaited<ReturnType<typeof launcher.launch>>;
try {
  browser = await launcher.launch();
} catch (err) {
  // WebKit is opt-in and its binary is not in every environment. Skipping is
  // the honest outcome: silently passing would claim iOS coverage we do not
  // have, and failing would break CI over a tier that is deliberately optional.
  if (ENGINE === "chromium") throw err;
  console.error(`⚠ ${ENGINE} is unavailable (${String(err).split("\n")[0]})`);
  console.error(`  install it with: npx playwright install ${ENGINE}`);
  await server.close();
  process.exit(0);
}

const devices = ONLY_DEVICE ? DEVICES.filter((d) => d.name.includes(ONLY_DEVICE)) : DEVICES;
const baseline = await loadBaseline();
const found: Record<string, string[]> = {};
const warnings: string[] = [];
let combos = 0;

if (SHOTS) await mkdir(SHOTS_DIR, { recursive: true });

for (const device of devices) {
  // A "fine" row is a desktop browser, and both flags have to come off:
  // `hasTouch` is what Chromium answers `@media (pointer: coarse)` with, and
  // `isMobile` additionally forces the mobile viewport-meta path. Leave either
  // on and every `@media (pointer: fine)` rule in app.css stays dark, which
  // would make a desktop row a differently-sized phone rather than coverage.
  const fine = device.pointer === "fine";
  const ctx = await browser.newContext({
    viewport: { width: device.w, height: device.h },
    deviceScaleFactor: device.dpr,
    isMobile: !fine,
    hasTouch: !fine,
  });
  // tsx compiles this file with esbuild's keepNames on, which wraps every
  // function declaration in a `__name(fn, "fn")` helper call. page.evaluate
  // serialises `measure` by toString(), so the helper travels into the page
  // where it does not exist and the call dies with "__name is not defined".
  // Defining it as identity is the standard workaround and costs nothing.
  await ctx.addInitScript(() => {
    (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
  });
  const page = await ctx.newPage();
  await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__uifit);
  // Webfonts change every text measurement in here (the pixel face is ~2x the
  // fallback's advance width). `document.fonts.ready` alone is NOT the wait it
  // looks like: awaited while the overlay is still empty, it resolves before a
  // single face has been requested (font-display: swap fetches lazily), so the
  // first screen per device could be measured in fallback metrics. fonts.load
  // forces every face the screens measure with to actually fetch first, and
  // THEN ready means loaded.
  await page.evaluate(async () => {
    const faces = [
      '12px "Press Start 2P"',
      '500 12px "Rajdhani"', '700 12px "Rajdhani"',
      '700 12px "Orbitron"', '900 12px "Orbitron"',
      '400 12px "JetBrains Mono"', '700 12px "JetBrains Mono"', '800 12px "JetBrains Mono"',
    ];
    await Promise.all(faces.map((f) => document.fonts.load(f, "TETRILAUNCH 0123456789$♻")));
    await document.fonts.ready;
  });

  const screens = await page.evaluate(() => window.__uifit.screens);
  for (const screen of screens) {
    if (ONLY_SCREEN && screen !== ONLY_SCREEN) continue;
    combos++;
    // The rotate guard is the one PORTRAIT screen: it exists to cover every
    // portrait orientation, so measuring it landscape would measure a state
    // the app never shows. The device's own short-edge-up orientation is its
    // portrait: swap the axes for this screen, restore after.
    const portrait = screen === "guard";
    const vp = portrait
      ? { width: Math.min(device.w, device.h), height: Math.max(device.w, device.h) }
      : { width: device.w, height: device.h };
    if (page.viewportSize()?.width !== vp.width || page.viewportSize()?.height !== vp.height) {
      await page.setViewportSize(vp);
    }
    await page.evaluate(
      ([id, insets, fp]) => window.__uifit.render(id as string, insets as Insets, fp as boolean),
      [screen, device.insets, fine] as [string, Insets, boolean],
    );
    // Two frames: one for layout, one for the meter transitions to settle.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const res = await page.evaluate(measure, {
      allowedScrollers: ALLOWED_SCROLLERS,
      decorative: DECORATIVE,
      singleLine: SINGLE_LINE,
      noOverlap: NO_OVERLAP,
      screen,
      mouth: MOUTH,
    });
    for (const { id } of ASSERTIONS) {
      if (res[id]?.length) found[`${device.name}|${screen}|${id}`] = res[id];
    }
    for (const w of res.warn) warnings.push(`${device.name} · ${screen} · ${w}`);

    if (SHOTS) {
      const dir = resolve(SHOTS_DIR, device.name.replace(/[^\w]+/g, "-").toLowerCase());
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `${screen}.png`) });
    }
  }
  await ctx.close();
}
await browser.close();
await server.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const foundKeys = Object.keys(found).sort();
const regressions = foundKeys.filter((k) => !(k in baseline));
// A baseline entry is only THIS RUN's to judge when this run actually
// measured its combo. With --screen/--device filters active the old logic
// counted every out-of-filter entry as "no longer reproduces" — the
// narrowing workflow the README documents exited 1 spuriously, and with
// --update-baseline it silently deleted the rest of the baseline.
const deviceNames = new Set(devices.map((d) => d.name));
const inScope = (k: string): boolean => {
  const [dev, screen] = k.split("|");
  return deviceNames.has(dev) && (!ONLY_SCREEN || screen === ONLY_SCREEN);
};
const fixed = Object.keys(baseline).sort().filter((k) => inScope(k) && !(k in found));
const remaining = foundKeys.filter((k) => k in baseline);
const descOf = (key: string): string =>
  ASSERTIONS.find((a) => a.id === key.split("|")[2])?.desc ?? key;

// A baselined violation is allowed to KEEP REPRODUCING, not to grow: the
// baseline keys carry their measured magnitudes precisely so an 18px overflow
// cannot swell to 200px behind a green run. The tolerance absorbs sub-pixel
// and rounding drift, nothing more.
const magnitude = (lines: string[]): number =>
  Math.max(0, ...lines.map((l) => {
    const m = l.match(/(\d+(?:\.\d+)?)px/);
    return m ? parseFloat(m[1]) : 0;
  }));
const grown = remaining.filter((k) => {
  const before = magnitude(baseline[k]);
  const now = magnitude(found[k]);
  return before > 0 && now > before * 1.25 + 8;
});

if (UPDATE) {
  const next: Record<string, string[]> = {};
  // Everything this run did not measure survives verbatim — a filtered update
  // must never destroy the rest of the file.
  for (const k of Object.keys(baseline)) if (!inScope(k)) next[k] = baseline[k];
  for (const k of foundKeys) next[k] = found[k];
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  await writeFile(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(
    `baseline updated: ${Object.keys(sorted).length} known violation(s)` +
      ` (${foundKeys.length} measured across ${combos} combos${
        Object.keys(sorted).length - foundKeys.length
          ? `, ${Object.keys(sorted).length - foundKeys.length} out-of-filter entr(ies) preserved`
          : ""
      })`,
  );
  process.exit(0);
}

const perDevice = combos / devices.length;
console.log(`UI fit — ${ENGINE}, ${devices.length} devices x ${perDevice} screens = ${combos} combos\n`);

if (regressions.length) {
  console.log(`✗ ${regressions.length} NEW violation(s):\n`);
  for (const k of regressions) {
    const [dev, screen, id] = k.split("|");
    console.log(`  ${dev} · ${screen} · ${id} — ${descOf(k)}`);
    for (const d of found[k]) console.log(`      ${d}`);
  }
  console.log("");
}

if (fixed.length) {
  console.log(`✓ ${fixed.length} baselined violation(s) no longer reproduce — remove them:\n`);
  for (const k of fixed) console.log(`  ${k.split("|").join(" · ")}`);
  console.log("\n  npx tsx sim/uifit/run.ts --update-baseline\n");
}

if (grown.length) {
  console.log(`✗ ${grown.length} baselined violation(s) GREW well past their recorded magnitude:\n`);
  for (const k of grown) {
    console.log(`  ${k.split("|").join(" · ")} — ${magnitude(baseline[k])}px recorded, ${magnitude(found[k])}px now`);
    for (const d of found[k]) console.log(`      ${d}`);
  }
  console.log("");
}

if (warnings.length) {
  // Two unrelated kinds share this channel now: an ellipsis/line-clamp is a
  // deliberate design decision worth a skim, and an "inkline cannot verify"
  // entry is a coverage gap worth fixing or baselining — each message states
  // its own kind, so the header stays generic rather than naming just one.
  console.log(`⚠ ${warnings.length} warning(s) — see each line for its kind:`);
  for (const w of warnings.slice(0, 10)) console.log(`    ${w}`);
  if (warnings.length > 10) console.log(`    …and ${warnings.length - 10} more`);
  console.log("");
}

// The scoreboard. Each layout task should visibly shrink a row of this, so it
// prints on every run rather than only on failure.
console.log("violations by assertion:");
for (const { id, desc } of ASSERTIONS) {
  const n = foundKeys.filter((k) => k.endsWith(`|${id}`)).length;
  console.log(`  ${n === 0 ? "✓" : "·"} ${String(n).padStart(3)}  ${id.padEnd(10)} ${desc}`);
}
console.log(`\ntotal ${foundKeys.length} (baselined ${remaining.length}, new ${regressions.length})`);

if (regressions.length || fixed.length || grown.length) {
  console.log(
    `\n${regressions.length} new, ${fixed.length} stale, ${grown.length} grown baseline entries.`,
  );
  process.exit(1);
}
console.log("no new violations.");
