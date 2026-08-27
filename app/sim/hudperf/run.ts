#!/usr/bin/env npx tsx
/**
 * HUD-WRITE HARNESS (node half) — "how many DOM writes does a frame of play
 * cost, and which node is asking for them?"
 *
 *   npx tsx sim/hudperf/run.ts                  # census + the three pins
 *   npx tsx sim/hudperf/run.ts --frames 900
 *   npx tsx sim/hudperf/run.ts --no-assert      # census only, never fails
 *
 * WHY THIS EXISTS. The device measurement in
 * docs/superpowers/specs/2026-08-27-background-layer-split-design.md put about
 * 33fps of a CPH2573 frame in ONE thing: the HUD's per-frame repaint. Gating
 * `syncHud` to every eighth frame bought +21.3fps of that, which proved the
 * mechanism and is not a shippable design — an eight-frame gate also throttles
 * the reload bar and the clock, which genuinely move. The shippable shape the
 * doc names is a split: smooth things per frame through transform/opacity,
 * everything else written only when it changes. This harness is how that split
 * is checked without a phone in the room.
 *
 * WHAT IT MEASURES, AND WHY NOT MILLISECONDS. Headless Chromium rasterises in
 * software on a desktop CPU, so its frame times are not a phone's — the same
 * caveat sim/renderperf carries. What transfers is the COUNT of DOM mutations
 * per frame, in the same way sim/renderperf's draw counts transfer while its
 * milliseconds do not: a mutation is the input to the style/layout/paint bill
 * rather than a measurement of it, and a frame that mutates nothing cannot
 * repaint. Chromium's own RecalcStyle/Layout counters are pulled over CDP
 * alongside, as corroboration rather than as the claim.
 *
 * Sibling harnesses: sim/renderperf times the CANVAS half of the same frame,
 * sim/uifit asserts the HUD's geometry, sim/systems.ts pins the arithmetic and
 * the markup with no browser at all. This one is the only place the LIVE loop's
 * DOM traffic is visible.
 */
import { createServer } from "vite";
import * as playwright from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CensusResult, FreshnessResult } from "./probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const FRAMES = parseInt(opt("frames") ?? "600", 10);
const ASSERT = !argv.includes("--no-assert");

/**
 * The nodes allowed to mutate on an IDLE bay — a bay sitting with the cannon
 * loaded, nothing in flight and nobody touching the glass.
 *
 * There is exactly one, and its arithmetic is the reason: `#hud-time` displays
 * whole seconds, so it owes the DOM one write per second and nothing in
 * between. Every other readout on the panel is answering a number that did not
 * move. A second entry here is a regression, not a configuration.
 */
const IDLE_MUTATORS = ["#hud-time"];

/**
 * Inline-style properties syncHud may never write, because writing one costs
 * the layout engine a re-solve of the panel that contains it.
 *
 * This is the doctrine of the split stated as a rule rather than as a habit:
 * the readouts that move every frame move through `transform` (and `opacity`),
 * which the compositor can apply to an already-rastered layer. `width` is the
 * one that was here — three bar fills driven by `style.width`, one of them
 * rewritten on 94% of frames — and Chromium's Layout counter over a live
 * ten-second bay fell from 110.6ms to nothing when they stopped.
 */
const LAYOUT_PROPS = [
  "width", "height", "top", "right", "bottom", "left", "inset",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font-size", "flex", "flex-basis", "gap",
];

/** Ratio of reloading frames on which the reload fill must still visibly move.
 *  Not 1.0: the fill is quantised below half a pixel of its own widest box (see
 *  main.ts's BAR_STEPS), so a couple of adjacent frames can land in one bin at
 *  the top of a long reload. */
const RELOAD_SMOOTH_MIN = 0.9;

interface Fail { pin: string; detail: string }
const fails: Fail[] = [];
const check = (ok: boolean, pin: string, detail: string): void => {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${pin}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fails.push({ pin, detail });
};

const server = await createServer({
  configFile: resolve(APP_ROOT, "vite.config.ts"),
  root: APP_ROOT,
  server: { host: "127.0.0.1" },
  logLevel: "warn",
});
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) {
  console.error("✗ the app dev server reported no local URL");
  await server.close();
  process.exit(1);
}

const browser = await playwright.chromium.launch();
// A landscape phone box, which is the only orientation the game runs in and the
// one every device row in sim/uifit is shaped like.
const page = await browser.newPage({
  viewport: { width: 900, height: 420 },
  deviceScaleFactor: 2,
});
page.on("pageerror", (err) => console.error("✗ page error:", err.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate("document.fonts.ready");
// `__tl` is main.ts's DEV-only handle on the live App (stripped from production
// builds). Reaching through it is what makes this the real loop rather than a
// re-staged one.
await page.waitForFunction("window.__tl !== undefined", null, { timeout: 20_000 });
// Vite serves any .ts under the app root on request, so the browser half needs
// no bundle step and no second dev server.
await page.addScriptTag({ url: "/sim/hudperf/probe.ts", type: "module" });
await page.waitForFunction("window.__hudperf !== undefined", null, { timeout: 20_000 });

const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async (): Promise<Record<string, number>> => {
  const m = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
};

await page.evaluate("window.__hudperf.start()");

const run = async (
  fire: boolean,
  still = false,
): Promise<CensusResult & { style: number; layout: number }> => {
  const before = await metrics();
  const r = (await page.evaluate(
    `window.__hudperf.census(${JSON.stringify({ frames: FRAMES, fire, still })})`,
  )) as CensusResult;
  const after = await metrics();
  return {
    ...r,
    style: (after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0),
    layout: (after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0),
  };
};

console.log("# Tetrilaunch HUD-write census\n");
console.log(`frames=${FRAMES} per condition, engine=chromium(headless), 900x420 @2x\n`);

const table = (name: string, r: CensusResult & { style: number; layout: number }): void => {
  console.log(`## ${name}\n`);
  console.log(
    `${r.mutations} mutations over ${r.frames} frames ` +
      `(${(r.mutations / r.frames).toFixed(2)}/frame), ` +
      `${r.dirtyFrames} frames dirty (${((r.dirtyFrames / r.frames) * 100).toFixed(1)}%), ` +
      `${r.seconds.toFixed(1)}s, ${r.shots} shots fired.`,
  );
  console.log(
    `Chromium counters over the window: RecalcStyle ${(r.style * 1000).toFixed(1)}ms, ` +
      `Layout ${(r.layout * 1000).toFixed(1)}ms.\n`,
  );
  if (r.perNode.length) {
    console.log("| node | write | frames |");
    console.log("|---|---|---|");
    for (const [key, n] of r.perNode) {
      const at = key.lastIndexOf(" ");
      console.log(`| \`${key.slice(0, at)}\` | ${key.slice(at + 1)} | ${n} |`);
    }
  } else {
    console.log("_No DOM mutation at all._");
  }
  console.log();
};

const idle = await run(false);
table("An IDLE bay — loaded cannon, nothing in flight, nobody touching it", idle);

const live = await run(true);
table("A LIVE bay — firing whenever the cannon is loaded", live);
console.log(
  `Reload fill moved on ${live.loadMoved} frames; the cannon was mid-reload on ` +
    `${live.loadReloading}.`,
);
console.log(`Inline-style properties written: ${live.styleProps.join(", ") || "(none)"}\n`);

// THE ATTRIBUTION ARM. Same idle bay, every CSS animation and transition on
// the page stilled, so the style recalculation left over after syncHud has
// stopped writing can be told apart from syncHud's own. Never a proposal — the
// game's motion is deliberate and its reduced-motion story is separate — only
// a pointer at what the next measurement should be aimed at.
const stilled = await run(false, true);
console.log(
  `## The same idle bay with every CSS animation stilled\n\n` +
    `RecalcStyle ${(stilled.style * 1000).toFixed(1)}ms against the live idle bay's ` +
    `${(idle.style * 1000).toFixed(1)}ms; Layout ${(stilled.layout * 1000).toFixed(1)}ms ` +
    `against ${(idle.layout * 1000).toFixed(1)}ms. Whatever the gap is, it is ` +
    `running keyframes rather than DOM writes.\n`,
);

const fresh = (await page.evaluate("window.__hudperf.freshness()")) as FreshnessResult;
console.log(`A funds payout reached the readout in ${fresh.framesToShow} frame(s).\n`);

if (ASSERT) {
  console.log("## Pins\n");
  // PIN 1. The whole point of the split: a frame on which no readout's value
  // changed must cost the DOM nothing at all, so the browser has nothing to
  // repaint. The clock is the one legitimate exception and it is bounded by
  // the wall clock, not by the frame rate.
  const strays = idle.perNode.filter(
    ([key]) => !IDLE_MUTATORS.some((allowed) => key.startsWith(allowed + " ")),
  );
  check(
    strays.length === 0,
    "an idle bay writes nothing but the clock",
    strays.map(([k, n]) => `${k} x${n}`).join(", "),
  );
  const clock = idle.perNode.find(([k]) => k.startsWith("#hud-time "))?.[1] ?? 0;
  const clockCap = Math.ceil(idle.seconds) + 1;
  check(
    clock <= clockCap,
    "the clock writes once a second, not once a frame",
    `${clock} writes over ${idle.seconds.toFixed(1)}s (cap ${clockCap})`,
  );
  // PIN 2. The half of the split that must NOT be throttled. A reload bar that
  // stopped moving every frame would be the eight-frame gate's visible cost,
  // which is exactly what this branch exists to avoid paying.
  const smooth = live.loadReloading ? live.loadMoved / live.loadReloading : 0;
  check(
    smooth >= RELOAD_SMOOTH_MIN,
    "the reload fill still moves on essentially every reloading frame",
    `moved on ${live.loadMoved} of ${live.loadReloading} (${(smooth * 100).toFixed(0)}%)`,
  );
  // PIN 3. Whatever still writes per frame must write something the
  // compositor can apply on its own. This is the rule that keeps the fix from
  // decaying back into "the same work, spelled differently".
  const layouty = live.styleProps.filter((p) => LAYOUT_PROPS.includes(p));
  check(
    layouty.length === 0,
    "no HUD write names a layout property",
    `wrote ${layouty.join(", ")} (saw: ${live.styleProps.join(", ")})`,
  );
  // PIN 4. Change-driven, not time-driven: a payout has to be on screen the
  // next frame. A time gate would show it up to eight frames late and this is
  // the pin that refuses one.
  check(
    fresh.framesToShow === 1,
    "a funds change reaches the DOM on the very next frame",
    `took ${fresh.framesToShow} frames, showing ${fresh.shown}`,
  );
  console.log();
}

await browser.close();
await server.close();

if (fails.length) {
  console.error(`✗ ${fails.length} HUD-write pin(s) failed.`);
  process.exit(1);
}
console.log("HUD-write pins passed.");
process.exit(0);
