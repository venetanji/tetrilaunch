#!/usr/bin/env npx tsx
/**
 * RENDER-COST HARNESS (node half) — "how much of the 16.67ms frame does
 * DRAWING cost, and at what pile size?"
 *
 *   npx tsx sim/renderperf/run.ts
 *   npx tsx sim/renderperf/run.ts --counts 100,200,300 --frames 240
 *   npx tsx sim/renderperf/run.ts --dpr 3 --css 844x390     # a phone's numbers
 *   npx tsx sim/renderperf/run.ts --dprs 1,1.5,2,3          # what resolution costs
 *   npx tsx sim/renderperf/run.ts --engine webkit           # WebKit, where installed
 *   npx tsx sim/renderperf/run.ts --breakdown               # cost per scene layer
 *   npx tsx sim/renderperf/run.ts --breakdown --boom        # …on a chain detonation
 *   npx tsx sim/renderperf/run.ts --breakdown --boom --reduced   # …the same, motion off
 *   npx tsx sim/renderperf/run.ts --probe                   # draw calls, not ms
 *   npx tsx sim/renderperf/run.ts --blit-ab                 # what the bg blit costs
 *   npx tsx sim/renderperf/run.ts --snapshot                # pixel digest only
 *   npx tsx sim/renderperf/run.ts --snapshot --shots        # …and write PNGs
 *   npx tsx sim/renderperf/run.ts --json out.json           # machine-readable
 *
 * The sibling of sim/perf.ts, which times the same frame's PHYSICS half in
 * node. Neither replaces the other, and neither is a frame on its own: a frame
 * is one Game.update() plus one render(), so a budget claim needs both numbers.
 *
 * WHY A REAL BROWSER. Every expensive thing render.ts does — shadowBlur,
 * gradients, glyph rasterisation, drawImage of a cached sprite — is work a 2D
 * rasteriser does, and node has no rasteriser. A pure-JS canvas shim would
 * report the cost of the JavaScript around the draw calls and nothing about the
 * draw calls themselves, which is the opposite of what this measures.
 *
 * CAVEAT worth stating up front: a headless desktop Chromium is not a phone.
 * These numbers are for comparing a BEFORE against an AFTER on one machine, and
 * for ranking which draw path costs the most. They are not a device budget.
 *
 * WHICH ENGINE, AND WHY IT IS NOW A FLAG. The app ships inside WKWebView on iOS,
 * which is WebKit, and WebKit's 2D canvas makes different choices from Blink's
 * about nearly everything this renderer leans on — when a canvas is GPU-backed
 * at all, how a source canvas is uploaded, what a getImageData does to a
 * surface's acceleration. Chromium remains the DEFAULT because every number in
 * sim/results was taken on it and a comparison across engines is not a
 * comparison. `--engine webkit` (or `firefox`) runs the identical harness on
 * another rasteriser, for the question "does this draw path behave differently
 * over there", which is the only question a second engine can answer honestly.
 * It requires that Playwright browser to be present already; where the
 * environment ships Chromium alone, this flag reports what is missing and stops.
 */
import { createServer } from "vite";
import * as playwright from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Type-only: pulls in harness.ts's `declare global` so window.__renderperf is
// typed inside page.evaluate. Erased at runtime — the harness module itself
// only ever runs in the browser.
import type { Variant } from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, "..", "results");
const FRAME_BUDGET_MS = 1000 / 60;

/**
 * The scenes a full sweep walks. Re-declared here rather than imported as a
 * value from harness.ts on purpose: that module assigns `window.__renderperf`
 * at load, so it exists only inside the page, and this file may import nothing
 * from it that survives type erasure.
 */
const VARIANTS: readonly Variant[] = ["loose", "cliques", "mixed"];

/**
 * The scene the attribution modes measure. "mixed" — a bay whose cargo varies
 * by type and material, as a played one does — because --probe and --breakdown
 * are asking which draw path costs what, and a monochrome pile answers that
 * question about a game nobody plays: every cube stamps the same baked face, so
 * the rasteriser never has to bind a second texture.
 */
const PROBE_VARIANT: Variant = "mixed";

const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

const COUNTS = (opt("counts") ?? "0,100,200,300")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n >= 0);
const FRAMES = parseInt(opt("frames") ?? "240", 10);
const DPR = parseFloat(opt("dpr") ?? "2");
/**
 * THE RESOLUTION LADDER. Every other mode here holds the canvas size fixed and
 * varies the scene; this one holds the scene fixed and varies the only number
 * that multiplies the whole frame at once.
 *
 * It earns a mode of its own because the answer is not obvious in advance and
 * the shell loop that used to produce it re-launched the browser per rung, which
 * is four different JIT warmups and four different machine states pretending to
 * be one measurement. One browser, one page per rung held open for the whole
 * run, and the rungs interleaved round-robin so the rows are comparable — see
 * the block that implements it for why the interleave is not optional.
 *
 * Read the ratios, not the milliseconds: if cost is linear in device pixels the
 * frame is fill-bound and a resolution cap is the biggest lever available; if it
 * is flat, the frame is call-bound and the cap would buy nothing. render.ts's
 * renderScale is built on the answer this mode gives.
 */
const DPRS = (opt("dprs") ?? "")
  .split(",")
  .map((s) => parseFloat(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
/** chromium (default) | webkit | firefox — see the note at the top of the file. */
const ENGINE = (opt("engine") ?? "chromium") as "chromium" | "webkit" | "firefox";
const [CSS_W, CSS_H] = (opt("css") ?? "1280x720").split("x").map((s) => parseInt(s, 10));
const JSON_OUT = opt("json");
const BREAKDOWN = argv.includes("--breakdown");
const SNAPSHOT = argv.includes("--snapshot");
const SHOTS = argv.includes("--shots");
const PROBE = argv.includes("--probe");
/**
 * Swap the busy FX set for a sustained chain detonation (harness.ts's
 * boomEffects). Additive with every other mode — the sweep, the breakdown and
 * the probe all understand it — because the question the debris layer raises
 * is "what does the WORST frame cost", and that is a different scene, not a
 * different measurement.
 */
const BOOM = argv.includes("--boom");
/**
 * Tell the page it is running under prefers-reduced-motion.
 *
 * This is how the debris layer gets an honest A/B on ONE build. render.ts
 * removes the whole layer under the preference and changes nothing else about
 * a blast, so `--boom` against `--boom --reduced` is the same code drawing the
 * same scene with and without the particles — no stashing, no second checkout,
 * and no chance of a stray unrelated edit landing in the difference.
 */
const REDUCED = argv.includes("--reduced");
const BLIT_AB = argv.includes("--blit-ab");

interface Row {
  variant: Variant;
  busy: boolean;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  worstMs: number;
  overBudgetPct: number;
}

/** Subdirectory PNGs land in, so a before-run and an after-run can sit side by
 *  side for diffing rather than overwriting each other. */
const SHOTS_TAG = opt("tag") ?? "shots";

const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) {
  console.error("✗ the harness dev server reported no local URL");
  await server.close();
  process.exit(1);
}

const launcher = playwright[ENGINE];
if (!launcher) {
  console.error(`✗ unknown --engine "${ENGINE}" (chromium | webkit | firefox)`);
  await server.close();
  process.exit(1);
}
// A missing browser build throws out of launch() with Playwright's own
// "Executable doesn't exist" text. Catching it here turns that into one line
// that says which engine is absent, rather than a stack trace that reads like
// the harness is broken.
let browser: playwright.Browser;
try {
  browser = await launcher.launch();
} catch (err) {
  console.error(
    `✗ could not launch ${ENGINE}: ${(err as Error).message.split("\n")[0]}\n` +
    `  This environment may ship only some Playwright browsers. Run with ` +
    `--engine chromium, or use an environment where ${ENGINE} is installed.`,
  );
  await server.close();
  process.exit(1);
}
const page = await browser.newPage({
  viewport: { width: CSS_W, height: CSS_H },
  deviceScaleFactor: DPR,
});
page.on("pageerror", (err) => console.error("✗ page error:", err.message));
if (REDUCED) await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
// The faces are @font-face'd, so the first ctx.font that names one can still
// resolve to a fallback if the file has not landed. Timed frames must all
// rasterise the same glyphs.
await page.evaluate(() => document.fonts.ready);

/** A fresh page at a given device scale factor, warmed the same way the main
 *  one is. The DPR sweep needs one per rung: deviceScaleFactor is fixed at page
 *  creation, and reusing a page across rungs would leave every rung but the
 *  first drawing at a backing size its page does not believe in. */
async function harnessPage(dpr: number): Promise<playwright.Page> {
  const p = await browser.newPage({
    viewport: { width: CSS_W, height: CSS_H },
    deviceScaleFactor: dpr,
  });
  p.on("pageerror", (err) => console.error("✗ page error:", err.message));
  if (REDUCED) await p.emulateMedia({ reducedMotion: "reduce" });
  await p.goto(`${base}harness.html`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  return p;
}

const rows: Row[] = [];
const layerRows: { label: string; p50Ms: number; deltaMs: number }[] = [];
interface ProbeRow {
  count: number; cubesDrawn: number;
  callsPerFrame: number; drawImage: number; switches: number;
  sources: number; sets: number; redundantSets: number;
  /** Every sprite in a busy frame, background blit excluded. */
  spriteMp: number;
  /** The CUBE LAYER alone, isolated by delta — the honest pile number. */
  cubeMp: number;
  cargoPx: number; bakes: number;
  calls: Record<string, number>; propSets: Record<string, number>;
  redundantByProp: Record<string, number>;
}
const probeRows: ProbeRow[] = [];

if (DPRS.length) {
  /**
   * INTERLEAVED, AND ROUND-ROBIN RATHER THAN RUNG-BY-RUNG, for the same reason
   * --blit-ab alternates every frame: the rungs are only comparable if they met
   * the same machine. Walking the ladder once from the bottom measures the first
   * rung on whatever the box was doing two minutes before the last one, and on a
   * shared CI runner that difference is larger than the effect under test —
   * measured here, a rung-by-rung ladder put dpr 1 at 5.4 ms on a quiet box and
   * 9.5 ms while a sibling checkout ran its test suite, which is most of the
   * span the whole ladder is trying to resolve.
   *
   * Each rung keeps its own page (deviceScaleFactor is fixed at creation) and
   * every round gives every rung an equal, adjacent slice of wall clock. The
   * reported number is the BEST round per rung, not the mean of them: contention
   * only ever adds time, so the minimum is the closest each rung got to the
   * machine's own cost, and it is the statistic that survives a noisy neighbour
   * without pretending the noise was signal.
   */
  const count = COUNTS[COUNTS.length - 1] ?? 300;
  const ROUNDS = 5;
  const perRound = Math.max(30, Math.round(FRAMES / ROUNDS));
  const pages = new Map<number, playwright.Page>();
  for (const dpr of DPRS) pages.set(dpr, await harnessPage(dpr));
  const best = new Map<number, Awaited<ReturnType<typeof window.__renderperf.run>>>();
  for (let round = 0; round < ROUNDS; round++) {
    for (const dpr of DPRS) {
      const r = await pages.get(dpr)!.evaluate(
        (o) => window.__renderperf.run(o),
        {
          count, variant: PROBE_VARIANT, frames: perRound,
          cssW: CSS_W, cssH: CSS_H, dpr, busy: true, boom: BOOM,
        },
      );
      const prev = best.get(dpr);
      if (!prev || r.p50Ms < prev.p50Ms) best.set(dpr, r);
    }
  }
  for (const p of pages.values()) await p.close();

  console.log("# Tetrilaunch render cost vs resolution\n");
  console.log(
    `css=${CSS_W}x${CSS_H} N=${count} variant=${PROBE_VARIANT} busy=yes ` +
    `engine=${ENGINE}(headless) ${ROUNDS} interleaved rounds of ${perRound} frames, ` +
    `best round per rung${BOOM ? " fx=chain-detonation" : ""}\n`,
  );
  console.log("| dpr | canvas | MP | p50 ms | avg ms | p95 ms | ms/MP | vs dpr 1 |");
  console.log("|---|---|---|---|---|---|---|---|");
  let firstP50 = 0;
  for (const dpr of DPRS) {
    const r = best.get(dpr)!;
    const w = Math.round(CSS_W * dpr);
    const h = Math.round(CSS_H * dpr);
    const mp = (w * h) / 1e6;
    if (!firstP50) firstP50 = r.p50Ms;
    console.log(
      `| ${dpr} | ${w}x${h} | ${mp.toFixed(2)} | ${r.p50Ms.toFixed(3)} | ${r.avgMs.toFixed(3)} | ` +
      `${r.p95Ms.toFixed(3)} | ${(r.p50Ms / mp).toFixed(2)} | ${(r.p50Ms / firstP50).toFixed(2)}x |`,
    );
    rows.push({ variant: PROBE_VARIANT, busy: true, count, ...r });
  }
  console.log(
    `\nA flat ms/MP column is a FILL-BOUND frame: the cost is the pixels, the draw ` +
    `calls are the same at every rung, and capping the backing store is the largest ` +
    `single lever there is. A ms/MP that climbs as the canvas shrinks is the fixed ` +
    `per-call cost becoming visible — that part no resolution cap can reach.`,
  );
  await browser.close();
  await server.close();
  process.exit(0);
}

if (SNAPSHOT) {
  // The digest is the whole point: run it on the branch point, run it again on
  // the change, and a render optimisation that was supposed to be invisible
  // has to print the same string. Several counts and both variants, because a
  // padding or culling bug can be invisible at one pile size and obvious at
  // another.
  console.log("# Tetrilaunch render pixel digest\n");
  console.log(`css=${CSS_W}x${CSS_H} dpr=${DPR}\n`);
  console.log("| Variant | N | Digest | Cargo px |");
  console.log("|---|---|---|---|");
  for (const variant of VARIANTS) {
    for (const count of COUNTS) {
      const s = await page.evaluate(
        (o) => window.__renderperf.snapshot(o),
        { count, variant, frames: 1, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true, png: SHOTS },
      );
      console.log(`| ${variant} | ${count} | \`${s.digest}\` | ${s.cargoPx} |`);
      if (s.png) {
        const dir = resolve(RESULTS_DIR, "renderperf", SHOTS_TAG);
        await mkdir(dir, { recursive: true });
        await writeFile(
          resolve(dir, `${variant}-${count}.png`),
          Buffer.from(s.png.slice("data:image/png;base64,".length), "base64"),
        );
      }
    }
  }
  console.log();
  if (SHOTS) console.log(`Wrote PNGs to ${resolve(RESULTS_DIR, "renderperf", SHOTS_TAG)}\n`);
  await browser.close();
  await server.close();
  process.exit(0);
}

if (BLIT_AB) {
  /**
   * The background blit's own share of the frame, priced the way the CPH2573
   * priced it — by skipping it and seeing what the frame costs without it —
   * but interleaved every FRAME rather than every 400ms, which this harness can
   * do because its scene is frozen and its clock is fixed.
   *
   * This is not an attempt to re-litigate the split on a desktop. It is the one
   * number a sprite-pass effort needs in order to know whether it is aimed at
   * the frame's biggest piece or its second-biggest, and the two machines
   * disagreeing about it is itself a result worth printing.
   */
  console.log("# Tetrilaunch background-blit A/B (interleaved per frame)\n");
  console.log(`css=${CSS_W}x${CSS_H} dpr=${DPR} frames=${FRAMES} variant=${PROBE_VARIANT} busy=yes\n`);
  console.log("| N | blit drawn p50 | blit skipped p50 | saving | drawn avg | skipped avg | saving |");
  console.log("|---|---|---|---|---|---|---|");
  for (const count of COUNTS) {
    const r = await page.evaluate(
      (o) => window.__renderperf.blitAb(o),
      { count, variant: PROBE_VARIANT, frames: FRAMES, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true },
    );
    console.log(
      `| ${count} | ${r.drawnP50Ms.toFixed(3)} | ${r.skippedP50Ms.toFixed(3)} | ` +
      `${(r.drawnP50Ms - r.skippedP50Ms).toFixed(3)} ms | ${r.drawnAvgMs.toFixed(3)} | ` +
      `${r.skippedAvgMs.toFixed(3)} | ${(r.drawnAvgMs - r.skippedAvgMs).toFixed(3)} ms |`,
    );
  }
  console.log(
    `\nSkipping the blit draws the WRONG PIXELS on purpose — the frame lands over the ` +
    `previous one instead of over the backdrop. It is a price, not a proposal.`,
  );
  await browser.close();
  await server.close();
  process.exit(0);
}

if (PROBE) {
  /**
   * THE DRAW-CALL CENSUS. Milliseconds on this machine rank draw paths; these
   * numbers ARE the phone's numbers, because a draw call issued here is a draw
   * call issued there.
   *
   * Read as a ladder like --breakdown, for the same reason: the delta between
   * two rungs is what that layer adds to a frame that already carries
   * everything below it. Plus one absolute row per pile size, which is the one
   * to quote when talking about a real bay.
   */
  console.log("# Tetrilaunch draw-call census\n");
  console.log(`css=${CSS_W}x${CSS_H} dpr=${DPR} frames=${FRAMES} variant=${PROBE_VARIANT} busy=yes\n`);
  const canvasPx = Math.round(CSS_W * DPR) * Math.round(CSS_H * DPR);

  console.log("| N asked | cubes drawn | calls/frame | drawImage | src switches | distinct srcs | " +
    "state sets | redundant | save/restore | cube fill MP | per cube | vs cube face | bakes/frame |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const count of COUNTS) {
    const c = await page.evaluate(
      (o) => window.__renderperf.probe(o),
      { count, variant: PROBE_VARIANT, frames: FRAMES, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true, boom: BOOM },
    );
    // THE CUBE LAYER, ISOLATED BY DELTA — the same ladder --breakdown walks.
    //
    // Every probe frame is a BUSY frame, so its drawImage area carries the
    // chute plume, the piston rig, the cannon, ~47 trajectory dots and a full
    // set of effects alongside the cargo. Subtracting only the background blit
    // and calling the remainder "the sprite pass" was wrong in the direction
    // that flatters the pile: it charged the cubes for every other sprite in
    // the frame. So the numerator is the difference between two otherwise
    // identical censuses, one carrying cubes and one carrying none, which
    // leaves exactly the cube stamps.
    const bare = await page.evaluate(
      (o) => window.__renderperf.probe(o),
      {
        count, variant: PROBE_VARIANT, frames: FRAMES, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true, boom: BOOM,
        layers: { cubes: false, seams: false, trajectory: true, effects: true },
      },
    );
    const cubesOnly = await page.evaluate(
      (o) => window.__renderperf.probe(o),
      {
        count, variant: PROBE_VARIANT, frames: FRAMES, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true, boom: BOOM,
        layers: { cubes: true, seams: false, trajectory: true, effects: true },
      },
    );
    const s = await page.evaluate(
      (o) => window.__renderperf.snapshot(o),
      { count, variant: PROBE_VARIANT, frames: 1, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true },
    );
    const f = c.frames;
    const per = (n: number): string => (n / f).toFixed(1);
    const calls = Object.values(c.calls).reduce((a: number, b: number) => a + b, 0);
    const sets = Object.values(c.sets).reduce((a: number, b: number) => a + b, 0);
    const redundant = Object.values(c.redundantSets).reduce((a: number, b: number) => a + b, 0);
    const cubeArea = (cubesOnly.drawImageDeviceArea - bare.drawImageDeviceArea) / cubesOnly.frames;
    const cubeMp = cubeArea / 1e6;
    const n = Math.max(1, cubesOnly.cubesDrawn);
    // What one cube's own FACE covers on this canvas: CELL world px squared,
    // through the world-to-device scale. The ratio of stamped area to that is
    // the honest "how much does a cube blend beyond itself" — glow margin and
    // pile overlap together, bounded above, and computed rather than read back
    // so no congestion-floor light can creep into the denominator.
    const worldToDevice = Math.min((CSS_W * DPR) / 1280, (CSS_H * DPR) / 720);
    const faceArea = 40 * 40 * worldToDevice * worldToDevice;
    console.log(
      `| ${count} | ${c.cubesDrawn} | ${per(calls)} | ${per(c.calls.drawImage ?? 0)} | ${per(c.drawImageSwitches)} | ` +
      `${c.drawImageSources} | ${per(sets)} | ${per(redundant)} | ` +
      `${per(c.calls.save ?? 0)}/${per(c.calls.restore ?? 0)} | ${cubeMp.toFixed(3)} | ` +
      `${(cubeArea / n).toFixed(0)} px | ${(cubeArea / n / faceArea).toFixed(2)}x | ` +
      `${per(c.canvasesCreated)} |`,
    );
    probeRows.push({
      count, cubesDrawn: c.cubesDrawn,
      callsPerFrame: calls / f, drawImage: (c.calls.drawImage ?? 0) / f,
      switches: c.drawImageSwitches / f, sources: c.drawImageSources,
      sets: sets / f, redundantSets: redundant / f,
      spriteMp: (c.drawImageDeviceArea - c.fullCanvasBlitArea) / f / 1e6,
      cubeMp, cargoPx: s.cargoPx, bakes: c.canvasesCreated / f,
      calls: c.calls, propSets: c.sets, redundantByProp: c.redundantSets,
    });
  }
  console.log(
    `\nCanvas is ${(canvasPx / 1e6).toFixed(2)} MP. "cube fill" is the CUBE LAYER alone, isolated ` +
    `as the difference between two otherwise identical censuses (a busy frame's drawImage area ` +
    `also carries the chute, pistons, cannon, arc and effects, and charging those to the pile ` +
    `overstates it). "vs cube face" is what one stamp blends over what one cube's face covers — ` +
    `glow margin and pile overlap together. "bakes/frame" counts canvases created inside the ` +
    `frame loop; a hot sprite cache creates none.`,
  );

  // The full per-method table for the largest pile — the one that says WHICH
  // calls a diet would have to remove.
  const worst = probeRows[probeRows.length - 1];
  if (worst) {
    console.log(`\n## Every counted call, N=${worst.count} (${worst.cubesDrawn} cubes), per frame\n`);
    console.log("| Call | per frame |");
    console.log("|---|---|");
    for (const [k, v] of Object.entries(worst.calls).sort((a, b) => b[1] - a[1])) {
      console.log(`| ${k} | ${(v / FRAMES).toFixed(1)} |`);
    }
    console.log(`\n## Every counted state assignment, N=${worst.count}, per frame\n`);
    console.log("| Property | per frame | redundant |");
    console.log("|---|---|---|");
    for (const [k, v] of Object.entries(worst.propSets).sort((a, b) => b[1] - a[1])) {
      console.log(`| ${k} | ${(v / FRAMES).toFixed(1)} | ${((worst.redundantByProp[k] ?? 0) / FRAMES).toFixed(1)} |`);
    }
  }
  console.log();
  await browser.close();
  await server.close();
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    JSON_OUT ? resolve(process.cwd(), JSON_OUT) : resolve(RESULTS_DIR, `renderprobe-${Date.now()}.json`),
    JSON.stringify({ cssW: CSS_W, cssH: CSS_H, dpr: DPR, frames: FRAMES, probeRows }, null, 2),
  );
  process.exit(0);
}

if (BREAKDOWN) {
  // A LADDER, not a set of isolated runs: each rung adds one layer to the one
  // below it, so the delta between two rungs is that layer's cost in a frame
  // that already carries everything under it. Isolated runs would each re-pay
  // the fixed background blit and the deltas would not sum to the whole.
  const count = COUNTS[COUNTS.length - 1] ?? 300;
  const ladder: { label: string; layers: Record<string, boolean> }[] = [
    { label: "chrome only (backdrop + press + cannon)", layers: { cubes: false, seams: false, trajectory: false, effects: false } },
    { label: "+ cubes", layers: { cubes: true, seams: false, trajectory: false, effects: false } },
    { label: "+ weld seams", layers: { cubes: true, seams: true, trajectory: false, effects: false } },
    { label: "+ aim arc", layers: { cubes: true, seams: true, trajectory: true, effects: false } },
    { label: "+ effects", layers: { cubes: true, seams: true, trajectory: true, effects: true } },
  ];
  let prev = 0;
  for (const rung of ladder) {
    const r = await page.evaluate(
      (o) => window.__renderperf.run(o),
      {
        count, variant: PROBE_VARIANT, frames: FRAMES,
        cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true, boom: BOOM,
        layers: rung.layers as unknown as { cubes: boolean; seams: boolean; trajectory: boolean; effects: boolean },
      },
    );
    layerRows.push({ label: rung.label, p50Ms: r.p50Ms, deltaMs: r.p50Ms - prev });
    prev = r.p50Ms;
  }
  console.log("# Tetrilaunch render-cost breakdown\n");
  console.log(
    `css=${CSS_W}x${CSS_H} dpr=${DPR} frames=${FRAMES} N=${count} variant=cliques busy=yes` +
    `${BOOM ? " fx=chain-detonation" : ""}${REDUCED ? " prefers-reduced-motion=reduce" : ""}\n`,
  );
  console.log("| Scene, cumulative | p50 ms | this layer costs |");
  console.log("|---|---|---|");
  for (const r of layerRows) {
    console.log(`| ${r.label} | ${r.p50Ms.toFixed(3)} | ${r.deltaMs >= 0 ? "+" : ""}${r.deltaMs.toFixed(3)} ms |`);
  }
  console.log();
} else {
  for (const variant of VARIANTS) {
    for (const busy of [false, true]) {
      for (const count of COUNTS) {
        const r = await page.evaluate(
          (o) => window.__renderperf.run(o),
          { count, variant, frames: FRAMES, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy, boom: BOOM && busy },
        );
        rows.push({ variant, busy, count, ...r });
      }
    }
  }
}

await browser.close();
await server.close();

if (!BREAKDOWN) {
console.log("# Tetrilaunch render-cost sweep\n");
console.log(
  `css=${CSS_W}x${CSS_H} dpr=${DPR} frames=${FRAMES} (60-frame warmup, not timed) ` +
    `engine=chromium(headless)${BOOM ? " fx=chain-detonation" : ""}` +
    `${REDUCED ? " prefers-reduced-motion=reduce" : ""}\n`,
);
console.log("| Variant | Busy | N | Avg ms | p50 ms | p95 ms | Worst ms | % over 16.67ms |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.variant} | ${r.busy ? "yes" : "no"} | ${r.count} | ${r.avgMs.toFixed(3)} | ` +
      `${r.p50Ms.toFixed(3)} | ${r.p95Ms.toFixed(3)} | ${r.worstMs.toFixed(3)} | ` +
      `${r.overBudgetPct.toFixed(1)}% |`,
  );
}
console.log();
const worstBusy = rows.filter((r) => r.busy).sort((a, b) => b.p95Ms - a.p95Ms)[0];
if (worstBusy) {
  console.log(
    `Busiest measured frame: ${worstBusy.variant} N=${worstBusy.count} ` +
      `p95 ${worstBusy.p95Ms.toFixed(2)}ms = ` +
      `${((worstBusy.p95Ms / FRAME_BUDGET_MS) * 100).toFixed(0)}% of the 16.67ms budget ` +
      `(drawing only — add sim/perf.ts's physics number for the whole frame).`,
  );
}
}

await mkdir(RESULTS_DIR, { recursive: true });
const outPath = JSON_OUT
  ? resolve(process.cwd(), JSON_OUT)
  : resolve(RESULTS_DIR, `renderperf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(
  outPath,
  JSON.stringify({ cssW: CSS_W, cssH: CSS_H, dpr: DPR, frames: FRAMES, rows, layerRows }, null, 2),
);
console.log(`\nWrote ${(BREAKDOWN ? layerRows : rows).length} rows to ${outPath}`);
