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
const BASELINE = resolve(HERE, "baseline.json");
const SHOTS_DIR = resolve(HERE, "..", "results", "uifit");

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opt = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const ENGINE = opt("engine") ?? "chromium";
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
const ALLOWED_SCROLLERS = ["#lb-body", ".workshop__shop"];

/** `id` is what the baseline keys off, so these are stable API — renaming one
 *  silently invalidates its baseline entries. */
const ASSERTIONS = [
  { id: "fit", desc: "screen fits without page scrolling" },
  { id: "scrollers", desc: "only allowlisted regions scroll vertically" },
  { id: "offscreen", desc: "no text or control is clipped off-viewport" },
  { id: "tap", desc: "every control is at least 44x44" },
  { id: "textclip", desc: "no text is hard-clipped by its box" },
  { id: "plant", desc: "the HUD plant panel stays inside its design box" },
  { id: "rail", desc: "the control rail never overlaps the field" },
  { id: "twocol", desc: "the workshop shop pane is two columns" },
] as const;

type AssertionId = (typeof ASSERTIONS)[number]["id"];
type Findings = Record<AssertionId, string[]> & { warn: string[] };

/**
 * Runs INSIDE the page. Returns raw findings; all judgement happens back in
 * node so the rules read in one place and the browser side stays mechanical.
 */
function measure(allowedScrollers: string[]): Findings {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Findings = {
    fit: [], scrollers: [], offscreen: [], tap: [], textclip: [],
    plant: [], rail: [], twocol: [], warn: [],
  };
  const label = (el: Element): string => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return el.id ? `#${el.id}` : cls ? `.${cls}` : el.tagName.toLowerCase();
  };

  // --- fit: nothing representing a whole screen may overflow its box ---------
  document.querySelectorAll(".screen, .modal, .bayclear__card, .howto, .workshop").forEach((el) => {
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
  const scrollableAncestor = (el: Element): boolean => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if (o === "auto" || o === "scroll") return true;
    }
    return false;
  };
  document.querySelectorAll("#overlay *").forEach((el) => {
    const isControl = el.matches("button, .btn, .icon-btn, .toggle, input");
    const isTextLeaf = el.childElementCount === 0 && (el.textContent ?? "").trim().length > 0;
    if (!isControl && !isTextLeaf) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return;         // visually-hidden a11y text
    if (getComputedStyle(el).visibility === "hidden") return;
    if (scrollableAncestor(el)) return;                // inside a legitimate scroller
    if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) {
      out.offscreen.push(
        `${label(el)} at [${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}] outside ${vw}x${vh}`,
      );
    }
  });

  // --- tap: WCAG 2.5.5 / iOS HIG minimum -----------------------------------
  const seenTap = new Set<string>();
  document
    .querySelectorAll(
      "button, .btn, .icon-btn, .toggle, .mod, .chip--cta, .workshop__tab, .contract-card, .mod-card, .shop-card",
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
  // An ELLIPSIS is a deliberate design decision (.plant__title truncates the bay
  // name on purpose), so it warns rather than fails. A hard clip never is.
  document.querySelectorAll("#overlay *").forEach((el) => {
    if (el.childElementCount !== 0) return;
    if (!(el.textContent ?? "").trim()) return;
    const cs = getComputedStyle(el);
    const clippedX = el.scrollWidth - el.clientWidth > 1;
    const clippedY = el.scrollHeight - el.clientHeight > 1;
    if (!clippedX && !clippedY) return;
    if (cs.overflowX === "auto" || cs.overflowX === "scroll") return; // .pl-mods, by design
    if (cs.overflow === "visible") return;                            // spills; `offscreen` owns it
    const where = `${label(el)} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
    if (cs.textOverflow === "ellipsis" && clippedX) out.warn.push(`ellipsis: ${where}`);
    else out.textclip.push(where);
  });

  const rootStyle = getComputedStyle(document.documentElement);
  const cssPx = (name: string): number => parseFloat(rootStyle.getPropertyValue(name));

  // --- plant: the HUD panel must stay inside its 42.96%-of-field box ---------
  const plant = document.querySelector(".plant");
  if (plant) {
    const fh = cssPx("--field-h");
    const design = 0.4296 * fh;
    const h = plant.getBoundingClientRect().height;
    if (h > design + 1) {
      out.plant.push(
        `${Math.round(h)}px vs design ${Math.round(design)}px (${((h / fh) * 100).toFixed(0)}% of field height)`,
      );
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

  // --- twocol: the workshop pane's grid ------------------------------------
  const grid = document.querySelector(".workshop__grid");
  if (grid) {
    const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
    if (tracks < 2) out.twocol.push(`workshop grid has ${tracks} column(s)`);
  }

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
  // fallback's advance width); measuring before they land reports fits the
  // device does not have.
  await page.evaluate(() => document.fonts.ready);

  const screens = await page.evaluate(() => window.__uifit.screens);
  for (const screen of screens) {
    if (ONLY_SCREEN && screen !== ONLY_SCREEN) continue;
    combos++;
    await page.evaluate(
      ([id, insets]) => window.__uifit.render(id as string, insets as Insets),
      [screen, device.insets] as [string, Insets],
    );
    // Two frames: one for layout, one for the meter transitions to settle.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const res = await page.evaluate(measure, ALLOWED_SCROLLERS);
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
const fixed = Object.keys(baseline).sort().filter((k) => !(k in found));
const remaining = foundKeys.filter((k) => k in baseline);
const descOf = (key: string): string =>
  ASSERTIONS.find((a) => a.id === key.split("|")[2])?.desc ?? key;

if (UPDATE) {
  const next: Record<string, string[]> = {};
  for (const k of foundKeys) next[k] = found[k];
  await writeFile(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`baseline updated: ${foundKeys.length} known violation(s) across ${combos} combos`);
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

if (regressions.length || fixed.length) {
  console.log(`\n${regressions.length} new, ${fixed.length} stale baseline entries.`);
  process.exit(1);
}
console.log("no new violations.");
