#!/usr/bin/env npx tsx
/**
 * RENDER-COST HARNESS (node half) — "how much of the 16.67ms frame does
 * DRAWING cost, and at what pile size?"
 *
 *   npx tsx sim/renderperf/run.ts
 *   npx tsx sim/renderperf/run.ts --counts 100,200,300 --frames 240
 *   npx tsx sim/renderperf/run.ts --dpr 3 --css 844x390     # a phone's numbers
 *   npx tsx sim/renderperf/run.ts --breakdown               # cost per scene layer
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
 */
import { createServer } from "vite";
import * as playwright from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Type-only: pulls in harness.ts's `declare global` so window.__renderperf is
// typed inside page.evaluate. Erased at runtime — the harness module itself
// only ever runs in the browser.
import type {} from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, "..", "results");
const FRAME_BUDGET_MS = 1000 / 60;

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
const [CSS_W, CSS_H] = (opt("css") ?? "1280x720").split("x").map((s) => parseInt(s, 10));
const JSON_OUT = opt("json");
const BREAKDOWN = argv.includes("--breakdown");
const SNAPSHOT = argv.includes("--snapshot");
const SHOTS = argv.includes("--shots");

interface Row {
  variant: "loose" | "cliques";
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

const browser = await playwright.chromium.launch();
const page = await browser.newPage({
  viewport: { width: CSS_W, height: CSS_H },
  deviceScaleFactor: DPR,
});
page.on("pageerror", (err) => console.error("✗ page error:", err.message));
await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
// The faces are @font-face'd, so the first ctx.font that names one can still
// resolve to a fallback if the file has not landed. Timed frames must all
// rasterise the same glyphs.
await page.evaluate(() => document.fonts.ready);

const rows: Row[] = [];
const layerRows: { label: string; p50Ms: number; deltaMs: number }[] = [];

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
  for (const variant of ["loose", "cliques"] as const) {
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
        count, variant: "cliques" as const, frames: FRAMES,
        cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy: true,
        layers: rung.layers as unknown as { cubes: boolean; seams: boolean; trajectory: boolean; effects: boolean },
      },
    );
    layerRows.push({ label: rung.label, p50Ms: r.p50Ms, deltaMs: r.p50Ms - prev });
    prev = r.p50Ms;
  }
  console.log("# Tetrilaunch render-cost breakdown\n");
  console.log(`css=${CSS_W}x${CSS_H} dpr=${DPR} frames=${FRAMES} N=${count} variant=cliques busy=yes\n`);
  console.log("| Scene, cumulative | p50 ms | this layer costs |");
  console.log("|---|---|---|");
  for (const r of layerRows) {
    console.log(`| ${r.label} | ${r.p50Ms.toFixed(3)} | ${r.deltaMs >= 0 ? "+" : ""}${r.deltaMs.toFixed(3)} ms |`);
  }
  console.log();
} else {
  for (const variant of ["loose", "cliques"] as const) {
    for (const busy of [false, true]) {
      for (const count of COUNTS) {
        const r = await page.evaluate(
          (o) => window.__renderperf.run(o),
          { count, variant, frames: FRAMES, cssW: CSS_W, cssH: CSS_H, dpr: DPR, busy },
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
    `engine=chromium(headless)\n`,
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
