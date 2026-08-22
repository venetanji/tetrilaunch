#!/usr/bin/env npx tsx
// Congestion-tax sweep CLI.
//
//   npx tsx sim/pile.ts [--bays 1,3,5,8,10] [--seeds 6] [--carry 100]
//     [--bots aim,patient] [--variants off,stock,...] [--census]
//
// Answers the three questions level.ts's PILE_TIERS cannot be tuned without.
//
// 1. CENSUS (--census, and printed first in every run). How many cubes does a
//    bay actually hold, moment to moment, with NO tax applied at all? The
//    proposed thresholds are 32 and 48 cubes, and whether those are "a bay you
//    let get away from you" or "every bay after the first minute" is a
//    measurement, not a judgement call. If a clean bot is over 32 for most of
//    its shots, the tax is not an anti-spam rule — it is a flat rate rise with
//    extra steps.
//
// 2. BITE. With the tax on, what fraction of shots pay it, how much money and
//    clock does it actually take, and does the bay still resolve?
//
// 3. COUNTER-PLAY — the one the other sweeps in this directory structurally
//    cannot answer (see sim/README.md's caveats and marks.ts's MAGAZINE note:
//    every bot here fires the moment cooldown and funds allow, so any cost on
//    firing reads as pure loss). `patient` is `aim` plus a single rule — do not
//    fire while the bay is over the threshold — and the gap between the two
//    IS the design's claim. If patient beats aim under the tax, the tax teaches
//    something. If both just lose, it is a difficulty knob wearing a lesson's
//    clothes.
//
// Every variant runs against an `off` baseline on the same seeds, so each row
// is a paired comparison rather than an absolute number.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Game } from "../src/game/game";
import { makeBaseLevel, PILE_TIERS, type LevelConfig, type PileTier } from "../src/game/level";
import { BOTS } from "./bots";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1000 / 60;

// ---------------------------------------------------------------------------
// Variants — the tax shapes worth putting side by side.
//
// `off` is the control and is always run. The rest are named so a table row
// says what it tested without a legend.
// ---------------------------------------------------------------------------

interface Variant {
  name: string;
  tiers: PileTier[];
  /** Cubes added to every threshold — models an upgrade track's tier. */
  allowance: number;
}

const VARIANTS: Variant[] = [
  { name: "off", tiers: [], allowance: 0 },
  // The proposal exactly as specced: 4 lines' worth, then 6.
  { name: "stock", tiers: PILE_TIERS, allowance: 0 },
  // Money only — isolates how much of any effect is the funds multiplier
  // rather than the clock. Against a $25 launch this is +$13/+$25 a shot.
  { name: "cash-only", tiers: PILE_TIERS.map((t) => ({ ...t, clockSec: 0, payMult: Infinity })), allowance: 0 },
  // Clock only — the other half. Spam stops costing money and starts costing
  // the one resource a fat bankroll cannot buy back.
  { name: "clock-only", tiers: PILE_TIERS.map((t) => ({ ...t, costMult: 1, payMult: Infinity })), allowance: 0 },
  // Looser thresholds, same penalties: 6 and 8 lines' worth. If `stock` taxes
  // clean play, this is where the knee should be instead.
  {
    name: "loose",
    tiers: [
      { cubes: 48, costMult: 1.5, clockSec: 2, reloadMult: 1, payMult: Infinity },
      { cubes: 64, costMult: 2, clockSec: 5, reloadMult: 1, payMult: Infinity },
    ],
    allowance: 0,
  },
  // Harsher: the multipliers the opening pitch topped out at, doubled again at
  // the second tier. Included to bracket the design rather than to ship it.
  {
    name: "harsh",
    tiers: [
      { cubes: 32, costMult: 2, clockSec: 3, reloadMult: 1, payMult: Infinity },
      { cubes: 48, costMult: 4, clockSec: 8, reloadMult: 1, payMult: Infinity },
    ],
    allowance: 0,
  },
  // CANDIDATES — the shape the first two sweeps pointed at. Measured at N=80
  // per cell: against an untaxed baseline of 73% (aim) / 48% (impatient), the
  // money multiplier hurt careful play as much as spam (49% / 35%) because a
  // funds tax turns into BANKRUPTCY, which ends a bay early and unrecoverably.
  // The clock tax did not: it converts into time losses, which still let the
  // bay settle what is in the air. So these keep the clock and drop or soften
  // the multiplier, at the looser thresholds the census argued for.
  { name: "cand-clock", tiers: [
    { cubes: 48, costMult: 1, clockSec: 2, reloadMult: 1, payMult: Infinity },
    { cubes: 64, costMult: 1, clockSec: 5, reloadMult: 1, payMult: Infinity },
  ], allowance: 0 },
  { name: "cand-mild", tiers: [
    { cubes: 48, costMult: 1.25, clockSec: 2, reloadMult: 1, payMult: Infinity },
    { cubes: 64, costMult: 1.5, clockSec: 5, reloadMult: 1, payMult: Infinity },
  ], allowance: 0 },
  // Same thresholds, a harder clock. Brackets the clock axis on its own.
  // ISOLATORS for the congestion taxes no variant above separates.
  // game.ts kills the combo on ANY upward tier crossing whenever pileTiers is
  // non-empty, so `combo-only` (all other taxes zeroed) measures the streak
  // break alone, and `reload-only` measures reload + combo — subtract the two
  // to get the reload multiplier's own cost. The combo break is the one
  // congestion tax the sim CAN judge (bots build and lose real streaks), and
  // it is multiplicative on income where the rest are additive on cost.
  { name: "combo-only", tiers: PILE_TIERS.map((t) => ({ ...t, costMult: 1, clockSec: 0, reloadMult: 1, payMult: Infinity })), allowance: 0 },
  { name: "reload-only", tiers: PILE_TIERS.map((t) => ({ ...t, costMult: 1, clockSec: 0, payMult: Infinity })), allowance: 0 },
  // The PAYOUT tax on its own (level.ts's PileTier.payMult) — every other axis
  // zeroed, so this is the combo break plus the multiplier cap and nothing
  // else. Unlike the cost and clock axes it is not a drain the bot can go broke
  // against: it lowers income without ever refusing a shot, so a drop here is a
  // score drop rather than a bay ending early. Read it next to `combo-only`;
  // the difference between them is what the cap alone is worth.
  { name: "pay-only", tiers: PILE_TIERS.map((t) => ({ ...t, costMult: 1, clockSec: 0, reloadMult: 1 })), allowance: 0 },
  { name: "cand-bite", tiers: [
    { cubes: 48, costMult: 1, clockSec: 3, reloadMult: 1, payMult: Infinity },
    { cubes: 64, costMult: 1, clockSec: 8, reloadMult: 1, payMult: Infinity },
  ], allowance: 0 },
  // The upgrade track, at what tier 1/2/3 might each be worth. Same tax, more
  // room before it triggers — this is the "buy back the spam strategy" lever.
  { name: "stock+8", tiers: PILE_TIERS, allowance: 8 },
  { name: "stock+16", tiers: PILE_TIERS, allowance: 16 },
  { name: "stock+24", tiers: PILE_TIERS, allowance: 24 },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const has = (flag: string): boolean => argv.includes(flag);
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

// A spread of the ladder rather than all ten bays: bay 1 is the floor, bay 10
// the ceiling, and the three between catch a curve that sags in the middle.
const bays = nums(get("--bays") ?? "1,3,5,8,10");
const seeds = parseInt(get("--seeds") ?? "6", 10);
// Mirrors run.ts's RunState.carry — a typical one-line overshoot into bay > 1.
// The census is especially sensitive to this: a fat carry buys more shots, and
// more shots in flight is more cubes on the field.
const carry = parseInt(get("--carry") ?? "100", 10);
const botNames = (get("--bots") ?? "aim,patient").split(",").map((s) => s.trim()).filter(Boolean);
const variantNames = (get("--variants") ?? VARIANTS.map((v) => v.name).join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);
const censusOnly = has("--census");

for (const b of botNames) {
  if (!(b in BOTS)) {
    console.error(`Unknown bot "${b}" — available: ${Object.keys(BOTS).join(", ")}`);
    process.exit(1);
  }
}
const variants = variantNames.map((n) => {
  const v = VARIANTS.find((x) => x.name === n);
  if (!v) {
    console.error(`Unknown variant "${n}" — available: ${VARIANTS.map((x) => x.name).join(", ")}`);
    process.exit(1);
  }
  return v!;
});

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function levelFor(bay: number, variant: Variant): LevelConfig {
  const cfg = makeBaseLevel(bay - 1);
  if (bay > 1) cfg.startingFunds = cfg.startingFunds + carry;
  cfg.pileTiers = variant.tiers.map((t) => ({ ...t }));
  cfg.pileAllowance = variant.allowance;
  return cfg;
}

// ---------------------------------------------------------------------------
// Runner
//
// A local copy of runner.ts's loop rather than a call into it, because the
// questions here need per-shot and per-step instrumentation runner.ts has no
// reason to carry — and because runner.ts's BayOutcome is diffed byte-for-byte
// by sweep.ts's determinism tripwire, which adding fields to would break.
// ---------------------------------------------------------------------------

interface PileOutcome {
  bot: string;
  variant: string;
  bay: number;
  seed: number;
  status: "won" | "lost" | "cap";
  lossReason: string | null;
  secs: number;
  shots: number;
  lines: number;
  lost: number;
  endScore: number;
  /** Cube count sampled at every shot — the census's raw material. */
  cubesAtShot: number[];
  /** Cube count sampled every SAMPLE_STEPS steps, whether or not anyone fired.
   *  Shot-time samples alone are biased: they can only be taken at moments the
   *  bot chose to fire, which for `patient` is by construction the uncongested
   *  ones. */
  cubesSampled: number[];
  /** Shots that paid tier 1 / tier 2, and what the tax actually took. */
  taxedShots: number;
  taxedCash: number;
  taxedSecs: number;
  /** Steps the bot was ready to fire (cooldown up, funds fine) but held because
   *  of congestion. Only ever non-zero for `patient`. */
  heldSteps: number;
}

/** Every 30 steps = twice a second of game time. Fine enough to see a pile
 *  build and drain, coarse enough not to make the JSON enormous. */
const SAMPLE_STEPS = 30;

function runPileBay(bay: number, variant: Variant, botName: string, seed: number): PileOutcome {
  const cfg = levelFor(bay, variant);
  let shots = 0;
  let taxedShots = 0;
  let taxedCash = 0;
  let taxedSecs = 0;
  const cubesAtShot: number[] = [];

  // Read BEFORE Game applies the shot: onShoot fires after the deduction, so
  // the tier that priced it has to be captured here, from the pre-shot field.
  // `g` is assigned below and the callback cannot run before the constructor
  // returns, so the non-null assertion is sound.
  let g: Game;
  const game = new Game(cfg, {
    onShoot: (shot) => {
      shots += 1;
      const n = g.cubes.length;
      cubesAtShot.push(n);
      // A bomb is free and untaxed (game.ts's shoot skips the funds path
      // entirely), so it must not be counted as a taxed launch.
      if (shot.bomb) return;
      const tier = tierForCount(variant, n);
      if (!tier) return;
      taxedShots += 1;
      taxedCash += Math.round(cfg.launchCost * tier.costMult) - cfg.launchCost;
      taxedSecs += tier.clockSec;
    },
  }, seed);
  g = game;

  const bot = BOTS[botName](seed);
  const stepCap = cfg.timeLimitSec > 0 ? cfg.timeLimitSec * 60 + 3600 : 36_000;

  let now = 0;
  let steps = 0;
  let heldSteps = 0;
  const cubesSampled: number[] = [];

  while (game.status === "playing" && steps < stepCap) {
    now += DT;
    const before = shots;
    const congested = tierForCount(variant, game.cubes.length) !== null;
    const couldFire = game.cannon.canShoot(now) && game.score >= game.launchCostNow;
    bot.act(game, now);
    // "Ready, congested, chose not to fire" — the counter-play, counted.
    if (couldFire && congested && shots === before) heldSteps += 1;
    game.update(now);
    steps += 1;
    if (steps % SAMPLE_STEPS === 0) cubesSampled.push(game.cubes.length);
  }

  const status: "won" | "lost" | "cap" = game.status === "playing" ? "cap" : game.status;
  const out: PileOutcome = {
    bot: botName,
    variant: variant.name,
    bay,
    seed,
    status,
    lossReason: game.lossReason,
    secs: steps / 60,
    shots,
    lines: game.linesTotal,
    lost: game.lostTotal,
    endScore: game.score,
    cubesAtShot,
    cubesSampled,
    taxedShots,
    taxedCash,
    taxedSecs,
    heldSteps,
  };
  game.destroy();
  return out;
}

/** Which tier a cube count lands in for a variant, mirroring game.ts's
 *  pileTier getter. Duplicated here rather than read off the Game because the
 *  census has to ask the question of the `off` variant too — "what WOULD have
 *  been taxed" is the whole point of the baseline. */
function tierForCount(variant: Variant, n: number): PileTier | null {
  let active: PileTier | null = null;
  for (const t of variant.tiers) {
    if (n > t.cubes + variant.allowance) active = t;
  }
  return active;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const fmt = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "n/a");

function lossBreakdown(rows: PileOutcome[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "won") continue;
    const key = r.status === "cap" ? "cap" : (r.lossReason ?? "?");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return "—";
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const wallStart = Date.now();
const all: PileOutcome[] = [];

console.log(`# Congestion sweep\n`);
console.log(
  `bays ${bays.join(",")} · seeds ${seeds} · carry $${carry} · ` +
  `bots ${botNames.join(",")} · variants ${variantNames.join(",")}\n`,
);

// --- 1. Census: what does an UNTAXED bay actually hold? ---------------------
//
// Run with `aim` on the `off` variant. Reported before anything else because
// every threshold below is only meaningful against these numbers.
{
  const census: PileOutcome[] = [];
  for (const bay of bays) {
    for (let seed = 1; seed <= seeds; seed++) {
      census.push(runPileBay(bay, VARIANTS[0], "aim", seed));
    }
  }
  all.push(...census);

  console.log(`## Census — cube counts with NO tax (bot: aim, variant: off)\n`);
  console.log(
    "| Bay | Cubes p50 | p90 | max | Shots | fired >32 | fired >48 | field-time >32 | >48 |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const bay of bays) {
    const rows = census.filter((r) => r.bay === bay);
    const shotCubes = rows.flatMap((r) => r.cubesAtShot);
    const sampled = rows.flatMap((r) => r.cubesSampled);
    const over = (xs: number[], n: number) => xs.filter((x) => x > n).length / (xs.length || 1);
    console.log(
      `| ${bay} | ${fmt(quantile(sampled, 0.5), 0)} | ${fmt(quantile(sampled, 0.9), 0)} | ` +
      `${Math.max(0, ...sampled)} | ${fmt(mean(rows.map((r) => r.shots)))} | ` +
      `${pct(over(shotCubes, 32))} | ${pct(over(shotCubes, 48))} | ` +
      `${pct(over(sampled, 32))} | ${pct(over(sampled, 48))} |`,
    );
  }
  console.log();
  const allShot = census.flatMap((r) => r.cubesAtShot);
  const allSampled = census.flatMap((r) => r.cubesSampled);
  console.log(
    `Overall: median field ${fmt(quantile(allSampled, 0.5), 0)} cubes, ` +
    `p90 ${fmt(quantile(allSampled, 0.9), 0)}; ` +
    `${pct(allShot.filter((x) => x > 32).length / (allShot.length || 1))} of clean shots ` +
    `would pay tier 1, ` +
    `${pct(allShot.filter((x) => x > 48).length / (allShot.length || 1))} tier 2.\n`,
  );
}

if (censusOnly) {
  writeJson();
  process.exit(0);
}

// --- 2 & 3. Bite and counter-play ------------------------------------------
console.log(`## Variants\n`);
console.log(
  "| Variant | Bot | N | Win | Secs(win) | Shots | Lines | Shots/line | " +
  "Taxed | $tax | s burned | Held | Losses |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");

for (const variant of variants) {
  for (const botName of botNames) {
    const rows: PileOutcome[] = [];
    for (const bay of bays) {
      for (let seed = 1; seed <= seeds; seed++) {
        // The census already ran (off, aim) on exactly these seeds — reuse it
        // rather than paying for the same physics twice.
        const cached = variant.name === "off" && botName === "aim"
          ? all.find((r) => r.variant === "off" && r.bot === "aim" && r.bay === bay && r.seed === seed)
          : undefined;
        const r = cached ?? runPileBay(bay, variant, botName, seed);
        if (!cached) all.push(r);
        rows.push(r);
      }
    }
    const wins = rows.filter((r) => r.status === "won");
    const winSecs = wins.map((r) => r.secs).sort((a, b) => a - b);
    const lines = mean(rows.map((r) => r.lines));
    const shots = mean(rows.map((r) => r.shots));
    const totalShots = rows.reduce((s, r) => s + r.shots, 0);
    const totalTaxed = rows.reduce((s, r) => s + r.taxedShots, 0);
    console.log(
      `| ${variant.name} | ${botName} | ${rows.length} | ${pct(wins.length / rows.length)} | ` +
      `${wins.length ? fmt(quantile(winSecs, 0.5)) : "n/a"} | ${fmt(shots)} | ${fmt(lines)} | ` +
      `${lines > 0 ? fmt(shots / lines, 2) : "n/a"} | ` +
      `${pct(totalTaxed / (totalShots || 1))} | ` +
      `${fmt(mean(rows.map((r) => r.taxedCash)), 0)} | ` +
      `${fmt(mean(rows.map((r) => r.taxedSecs)), 0)} | ` +
      `${fmt(mean(rows.map((r) => r.heldSteps / 60)), 0)}s | ` +
      `${lossBreakdown(rows)} |`,
    );
  }
}
console.log();

writeJson();

function writeJson(): void {
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `pile-${timestamp}.json`);
  const wallMs = Date.now() - wallStart;
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: { bays, seeds, carry, botNames, variantNames, timestamp, wallClockMs: wallMs },
        // cubesSampled/cubesAtShot are the bulk of this file and the reason it
        // is worth writing at all: every table above is a summary of them, and
        // a threshold argument that cannot be re-derived from the raw counts is
        // not an argument.
        raw: all,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${all.length} runs to ${outPath}`);
  console.log(`Wall clock: ${((Date.now() - wallStart) / 1000).toFixed(1)}s`);
}
