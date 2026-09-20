#!/usr/bin/env npx tsx
/**
 * DETERMINISM CHECK — two capture runs, pixel for pixel.
 *
 *   npx tsx sim/promo/verify.ts --a=sim/results/promo-A --b=sim/results/promo-B
 *   npm run promo:verify -- --a=… --b=… [--diff=<dir>] [--tolerance=0]
 *
 * The harness's whole claim is that the same command on the same tree
 * produces the same PNG. That claim is worth exactly as much as the check
 * behind it, so this is the check: every PNG under <a> is decoded next to its
 * twin under <b> and compared channel by channel. A file missing on either
 * side, a size mismatch, or one differing pixel is a failure, and the exit
 * code says so — which is what makes it usable from a script.
 *
 * A byte compare (`cmp`) would answer the same question for identical PNG
 * encoders, but it cannot say HOW MUCH differs when the answer is no, and
 * "eleven pixels in the clock chip" and "the whole canvas" are different
 * bugs. So the report carries, per file, the differing pixel count, the
 * largest single-channel delta and the bounding box the differences fall in:
 * a bbox around the HUD's timer is a clock that moved, a bbox over the whole
 * field is a bay that was dealt differently, a bbox over one panel is a
 * screen that had not finished painting.
 *
 * --diff=<dir> writes a red-over-grey difference image per differing file,
 * for looking at. --tolerance=N passes files whose largest channel delta is
 * at most N (a GPU's last bit, if the owner's machine ever needs it); the
 * default is 0, because on one machine the answer should be exactly zero.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const opt = (n: string): string | null => {
  const hit = argv.filter((a: string) => a.startsWith(`--${n}=`)).at(-1);
  return hit ? hit.slice(n.length + 3) : null;
};

const A = resolve(APP, opt("a") ?? "sim/results/promo-A");
const B = resolve(APP, opt("b") ?? "sim/results/promo-B");
const DIFF = opt("diff") ? resolve(APP, opt("diff")!) : null;
const TOLERANCE = Number(opt("tolerance") ?? 0);

/** Every .png under `root`, as paths relative to it. */
function pngs(root: string, rel = ""): string[] {
  const dir = resolve(root, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const r = rel ? `${rel}/${f}` : f;
    if (statSync(resolve(root, r)).isDirectory()) return pngs(root, r);
    return f.endsWith(".png") ? [r] : [];
  }).sort();
}

interface Report {
  file: string;
  status: "same" | "differs" | "missing" | "size";
  pixels?: number;
  total?: number;
  maxDelta?: number;
  bbox?: [number, number, number, number];
}

async function compare(file: string): Promise<Report> {
  const pa = resolve(A, file);
  const pb = resolve(B, file);
  if (!existsSync(pb)) return { file, status: "missing" };
  const [a, b] = await Promise.all([pa, pb].map((p) => sharp(p).raw().toBuffer({ resolveWithObject: true })));
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    return { file, status: "size" };
  }
  const { width, height, channels } = a.info;
  let pixels = 0, maxDelta = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const mask = DIFF ? Buffer.alloc(width * height * 3) : null;
  for (let i = 0, px = 0; i < a.data.length; i += channels, px += 1) {
    let d = 0;
    for (let c = 0; c < channels; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    if (mask) {
      // Grey where the two agree, red where they do not — the shape of the
      // disagreement is the diagnosis.
      const g = Math.round(a.data[i] * 0.2);
      mask[px * 3] = d > TOLERANCE ? 255 : g;
      mask[px * 3 + 1] = d > TOLERANCE ? 0 : g;
      mask[px * 3 + 2] = d > TOLERANCE ? 0 : g;
    }
    if (d <= TOLERANCE) continue;
    pixels += 1;
    maxDelta = Math.max(maxDelta, d);
    const x = px % width, y = (px / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (mask && pixels > 0) {
    const out = resolve(DIFF!, file);
    await mkdir(dirname(out), { recursive: true });
    await sharp(mask, { raw: { width, height, channels: 3 } }).png().toFile(out);
  }
  return {
    file, status: pixels === 0 ? "same" : "differs",
    pixels, total: width * height, maxDelta,
    bbox: pixels > 0 ? [minX, minY, maxX, maxY] : undefined,
  };
}

const files = pngs(A);
if (files.length === 0) {
  console.error(`✗ no PNGs under ${A} — capture a run first (npm run promo:shots -- --out=…)`);
  process.exit(1);
}
console.log(`comparing ${files.length} PNGs\n  a: ${A}\n  b: ${B}`);
const reports: Report[] = [];
for (const f of files) {
  const r = await compare(f);
  reports.push(r);
  if (r.status === "same") continue;
  if (r.status === "missing") { console.log(`  ✗ ${f}: missing in b`); continue; }
  if (r.status === "size") { console.log(`  ✗ ${f}: different dimensions`); continue; }
  const pct = ((100 * r.pixels!) / r.total!).toFixed(3);
  const [x0, y0, x1, y1] = r.bbox!;
  console.log(`  ✗ ${f}: ${r.pixels} px (${pct}%) maxΔ=${r.maxDelta} bbox ${x0},${y0}–${x1},${y1}`);
}
const bad = reports.filter((r) => r.status !== "same");
await writeFile(
  resolve(DIFF ?? APP, DIFF ? "report.json" : "sim/results/promo-verify.json"),
  JSON.stringify({ a: A, b: B, tolerance: TOLERANCE, reports }, null, 2),
);
console.log(bad.length === 0
  ? `✓ all ${files.length} identical${TOLERANCE ? ` within ±${TOLERANCE}` : ""}`
  : `✗ ${bad.length} of ${files.length} differ`);
process.exit(bad.length === 0 ? 0 : 1);
