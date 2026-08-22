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
  // The refit yard, added on arithmetic rather than preference. It offers seven
  // upgrade tracks, each with a BUY button, and a button is 44px because that
  // is the tap floor. Seven of them is 308px of button before a single label,
  // pip or price; the modal's grid region on a 360px-tall phone is 198px. There
  // is no layout that fits it — only shrinking the buttons back under the floor
  // (the regression this project just fixed) or hiding purchases behind
  // pagination. Same category as the workshop pane: a shop with more stock than
  // screen. Packed to three columns at compact density so it scrolls as little
  // as possible.
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
];

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
  { id: "draghint", desc: "the drag hint's gesture plays clear of the plant panel" },
  { id: "reveal", desc: "the tutorial's first step reveals only what it teaches" },
  { id: "plant", desc: "the HUD plant panel stays inside its design box" },
  { id: "rail", desc: "the control rail never overlaps the field" },
  { id: "twocol", desc: "the workshop body is two columns, aside fixed" },
  { id: "oneline", desc: "rows designed as one line render on one line" },
  { id: "rack", desc: "every build-rack system slot is visible without scrolling" },
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
}): Findings {
  const { allowedScrollers, decorative, singleLine, noOverlap, screen } = cfg;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Findings = {
    fit: [], scrollers: [], offscreen: [], tap: [], textclip: [],
    clipped: [], overlap: [], draghint: [], reveal: [],
    plant: [], rail: [], twocol: [], oneline: [], rack: [], warn: [],
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
  const seenTap = new Set<string>();
  document
    .querySelectorAll(
      'button, input, select, textarea, a[href], [role="button"], [role="switch"], [role="tab"], [role="checkbox"],' +
        " [data-action], [data-game], [data-toggle]",
    )
    .forEach((el) => {
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
        const top = box.top + p.clientTop;
        const left = box.left + p.clientLeft;
        const cutY = clipsY ? Math.max(top - r.top, r.bottom - (top + p.clientHeight)) : 0;
        const cutX = clipsX ? Math.max(left - r.left, r.right - (left + p.clientWidth)) : 0;
        const cut = Math.max(cutY, cutX);
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

  const rootStyle = getComputedStyle(document.documentElement);
  const cssPx = (name: string): number => parseFloat(rootStyle.getPropertyValue(name));

  // --- plant: the HUD panel must stay inside its 42.96%-of-field box ---------
  // The TUTORIAL state has its own, deliberately larger budget: while the coach
  // card shares the panel's column, app.css caps .plant at 52% of the field
  // height — a cap derived from clearing the cannon sprite, see the
  // `.hud[data-coach] .plant` max-height rule — so THAT cap is the design box
  // the assertion holds the panel to on the coach screens. Same number, one
  // source of truth in the stylesheet, read here rather than re-derived.
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
  }

  // --- rack: the seven system slots must all be reachable at a glance -------
  // The build row scrolls horizontally, which is right for the HAZARD chips
  // after it — a deep run banks up to ten distinct axes and no panel holds
  // them — but wrong for the ship's systems. There are exactly seven, they are
  // the same seven for the whole run, and they are the readout a player checks
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
    [".pl-funds", ".pl-time", ".pl-meta", ".pl-mods", ".pl-load", ".pl-launches"]
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
  const ctx = await browser.newContext({
    viewport: { width: device.w, height: device.h },
    deviceScaleFactor: device.dpr,
    isMobile: true,
    hasTouch: true,
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
      ([id, insets]) => window.__uifit.render(id as string, insets as Insets),
      [screen, device.insets] as [string, Insets],
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
  console.log(`⚠ ${warnings.length} ellipsis truncation(s) — deliberate unless they aren't:`);
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
