#!/usr/bin/env npx tsx
// Balance sweep CLI.
//
//   npx tsx sim/sweep.ts [--bays 1,2,3] [--seeds 5] [--bots middle,lob,flat,lob-rot] [--mods all|none|comma,list]
//
// Two questions this answers:
//   1. Baseline: for each (bay, bot) pair, across N seeds, what fraction of
//      runs win, how long do winners take, and why do losers lose?
//   2. Mods: for each modifier (drafted alone, on bay 1 and bay 2), how does
//      that shift look relative to the same (bay, bot) baseline — a crude
//      "ease score" ranks mods from most-helps-the-bot to most-hurts-it.
//
// See sim/README.md for column definitions and the ease-score caveat.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { makeBaseLevel, type LevelConfig } from "../src/game/level";
import { MODS, applyMods } from "../src/game/mods";
import { BOTS } from "./bots";
import { runBay, type BayOutcome } from "./runner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface Args {
  bays: number[];
  seeds: number;
  bots: string[];
  modIds: string[]; // resolved list; [] means "none"
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };

  const bays = (get("--bays") ?? "1,2,3")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));

  const seeds = parseInt(get("--seeds") ?? "5", 10);

  const bots = (get("--bots") ?? Object.keys(BOTS).join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const b of bots) {
    if (!(b in BOTS)) {
      console.error(`Unknown bot "${b}" — available: ${Object.keys(BOTS).join(", ")}`);
      process.exit(1);
    }
  }

  // No single literal default value makes sense for --mods (it's a
  // three-way grammar: all|none|list), so we pick a default here: "all",
  // since modifier balance is this tool's primary purpose (see README).
  const modsRaw = get("--mods") ?? "all";
  let modIds: string[];
  if (modsRaw === "all") modIds = MODS.map((m) => m.id);
  else if (modsRaw === "none") modIds = [];
  else {
    modIds = modsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of modIds) {
      if (!MODS.some((m) => m.id === id)) {
        console.error(`Unknown mod id "${id}" — available: ${MODS.map((m) => m.id).join(", ")}`);
        process.exit(1);
      }
    }
  }

  return { bays, seeds, bots, modIds };
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

/** Bay `bay` (1-based) with startingFunds left alone for bay 1, or set to
 *  the previous bay's targetScore for bay > 1 — emulating a bankroll carried
 *  over from clearing the prior bay in a real run (see run.ts's
 *  advanceRun/levelForRun, which carries endedScore the same way). */
function baseLevelForBay(bay: number): LevelConfig {
  const cfg = makeBaseLevel(bay - 1);
  if (bay > 1) cfg.startingFunds = makeBaseLevel(bay - 2).targetScore;
  return cfg;
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function median(xsSorted: number[]): number {
  const n = xsSorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? xsSorted[mid] : (xsSorted[mid - 1] + xsSorted[mid]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function pct(x: number): string {
  return (x * 100).toFixed(0) + "%";
}

function fmt(x: number | null, digits = 1): string {
  return x === null || Number.isNaN(x) ? "n/a" : x.toFixed(digits);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Agg {
  bay: number;
  bot: string;
  mod: string | null; // null = baseline
  n: number;
  winRate: number;
  medianSecsWin: number | null;
  meanShots: number;
  meanLines: number;
  lossBreakdown: Record<"topout" | "broke" | "time" | "cap" | "unknown", number>;
}

function aggregate(rows: BayOutcome[], bay: number, bot: string, mod: string | null): Agg {
  const n = rows.length;
  const wins = rows.filter((r) => r.status === "won");
  const winRate = n ? wins.length / n : 0;
  const winSecsSorted = wins.map((r) => r.secs).sort((a, b) => a - b);
  const medianSecsWin = winSecsSorted.length ? median(winSecsSorted) : null;

  const lossBreakdown: Agg["lossBreakdown"] = { topout: 0, broke: 0, time: 0, cap: 0, unknown: 0 };
  for (const r of rows) {
    if (r.status === "won") continue;
    const key = r.status === "cap" ? "cap" : (r.lossReason ?? "unknown");
    lossBreakdown[key as keyof Agg["lossBreakdown"]] += 1;
  }

  return {
    bay,
    bot,
    mod,
    n,
    winRate,
    medianSecsWin,
    meanShots: mean(rows.map((r) => r.shots)),
    meanLines: mean(rows.map((r) => r.lines)),
    lossBreakdown,
  };
}

function lossBreakdownStr(b: Agg["lossBreakdown"]): string {
  const parts = (["topout", "broke", "time", "cap", "unknown"] as const)
    .filter((k) => b[k] > 0)
    .map((k) => `${k}:${b[k]}`);
  return parts.length ? parts.join(" ") : "-";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const wallStart = Date.now();
  const args = parseArgs(process.argv.slice(2));

  console.log("# Tetrilaunch balance sweep\n");
  console.log(
    `bays=${args.bays.join(",")} seeds=${args.seeds} bots=${args.bots.join(",")} ` +
      `mods=${args.modIds.length ? args.modIds.join(",") : "none"}\n`,
  );

  // --- Reproducibility self-check -----------------------------------------
  // Runs one config TWICE and diffs the outcomes byte-for-byte. Proves the
  // "same seed -> same result" contract the rest of the sweep depends on
  // (median/winRate aggregation is meaningless if a run isn't reproducible).
  {
    const bay = args.bays[0] ?? 1;
    const botName = args.bots[0] ?? Object.keys(BOTS)[0];
    const cfg = baseLevelForBay(bay);
    const run1 = runBay(cfg, BOTS[botName](1), 1);
    const run2 = runBay(baseLevelForBay(bay), BOTS[botName](1), 1);
    const same = JSON.stringify(run1) === JSON.stringify(run2);
    console.log(
      `Reproducibility check (bay ${bay}, bot ${botName}, seed 1): ` +
        `${same ? "PASS — identical outcomes" : "FAIL — outcomes differ"}`,
    );
    if (!same) {
      console.log("  run1:", JSON.stringify(run1));
      console.log("  run2:", JSON.stringify(run2));
    }
    console.log();
  }

  const allResults: BayOutcome[] = [];

  // Baseline needs to cover every bay the caller asked for, PLUS bay 1 and 2
  // whenever mods are in play (mods are only ever tested on bays 1-2, but
  // their delta is computed against that same bay's baseline).
  const baselineBays = new Set(args.bays);
  if (args.modIds.length) {
    baselineBays.add(1);
    baselineBays.add(2);
  }

  const baselineAggs: Agg[] = [];
  const baselineByKey = new Map<string, Agg>();

  for (const bay of [...baselineBays].sort((a, b) => a - b)) {
    for (const botName of args.bots) {
      const rows: BayOutcome[] = [];
      for (let seed = 1; seed <= args.seeds; seed++) {
        const cfg = baseLevelForBay(bay);
        const outcome = runBay(cfg, BOTS[botName](seed), seed);
        rows.push(outcome);
        allResults.push(outcome);
      }
      const agg = aggregate(rows, bay, botName, null);
      baselineAggs.push(agg);
      baselineByKey.set(`${bay}|${botName}`, agg);
    }
  }

  // --- Baseline table ------------------------------------------------------
  console.log("## Baseline (no mods)\n");
  console.log("| Bay | Bot | N | WinRate | MedianSecs(win) | MeanShots | MeanLines | Losses |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const a of baselineAggs) {
    if (!args.bays.includes(a.bay)) continue; // only print bays the caller asked to see
    console.log(
      `| ${a.bay} | ${a.bot} | ${a.n} | ${pct(a.winRate)} | ${fmt(a.medianSecsWin)} | ` +
        `${fmt(a.meanShots)} | ${fmt(a.meanLines)} | ${lossBreakdownStr(a.lossBreakdown)} |`,
    );
  }
  console.log();

  // --- Mods sweep ----------------------------------------------------------
  interface ModRow {
    modId: string;
    bay: number;
    bot: string;
    agg: Agg;
    baseline: Agg;
    dWinRate: number;
    dSecsSaved: number | null;
    easeContribution: number;
  }
  const modRows: ModRow[] = [];

  if (args.modIds.length) {
    for (const bay of [1, 2]) {
      for (const modId of args.modIds) {
        for (const botName of args.bots) {
          const rows: BayOutcome[] = [];
          for (let seed = 1; seed <= args.seeds; seed++) {
            const cfg = applyMods(baseLevelForBay(bay), [modId]);
            const outcome = runBay(cfg, BOTS[botName](seed), seed);
            outcome.mods = [modId];
            rows.push(outcome);
            allResults.push(outcome);
          }
          const agg = aggregate(rows, bay, botName, modId);
          const baseline = baselineByKey.get(`${bay}|${botName}`)!;
          const dWinRate = agg.winRate - baseline.winRate;
          const dSecsSaved =
            agg.medianSecsWin !== null && baseline.medianSecsWin !== null
              ? baseline.medianSecsWin - agg.medianSecsWin
              : null;
          const easeContribution = dWinRate * 100 + clamp(dSecsSaved ?? 0, -60, 60) / 2;
          modRows.push({ modId, bay, bot: botName, agg, baseline, dWinRate, dSecsSaved, easeContribution });
        }
      }
    }

    // Ease score per (bay, mod): mean over bots. Overall ease score per mod:
    // mean over the two bays' ease scores.
    interface ModSummary {
      modId: string;
      easeBay1: number | null;
      easeBay2: number | null;
      easeOverall: number;
    }
    const summaries: ModSummary[] = args.modIds.map((modId) => {
      const forBay = (bay: number) => {
        const rows = modRows.filter((r) => r.modId === modId && r.bay === bay);
        return rows.length ? mean(rows.map((r) => r.easeContribution)) : null;
      };
      const easeBay1 = forBay(1);
      const easeBay2 = forBay(2);
      const both = [easeBay1, easeBay2].filter((x): x is number => x !== null);
      return { modId, easeBay1, easeBay2, easeOverall: mean(both) };
    });
    summaries.sort((a, b) => b.easeOverall - a.easeOverall);

    console.log("## Mods — CRUDE ease score (higher = easier for the bot; see README caveat)\n");
    console.log(
      "| Mod | Bay1 ΔWin | Bay1 ΔSecs-saved | Bay2 ΔWin | Bay2 ΔSecs-saved | Ease(bay1) | Ease(bay2) | Ease(avg) |",
    );
    console.log("|---|---|---|---|---|---|---|---|");
    for (const s of summaries) {
      const r1 = modRows.filter((r) => r.modId === s.modId && r.bay === 1);
      const r2 = modRows.filter((r) => r.modId === s.modId && r.bay === 2);
      const dWin1 = r1.length ? mean(r1.map((r) => r.dWinRate)) : null;
      const dSecs1 = r1.length ? mean(r1.map((r) => r.dSecsSaved ?? 0)) : null;
      const dWin2 = r2.length ? mean(r2.map((r) => r.dWinRate)) : null;
      const dSecs2 = r2.length ? mean(r2.map((r) => r.dSecsSaved ?? 0)) : null;
      console.log(
        `| ${s.modId} | ${dWin1 === null ? "n/a" : pct(dWin1)} | ${fmt(dSecs1)} | ` +
          `${dWin2 === null ? "n/a" : pct(dWin2)} | ${fmt(dSecs2)} | ` +
          `${fmt(s.easeBay1)} | ${fmt(s.easeBay2)} | ${fmt(s.easeOverall)} |`,
      );
    }
    console.log();
  } else {
    console.log("## Mods\n\n(skipped: --mods none)\n");
  }

  // --- JSON output -----------------------------------------------------------
  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `sweep-${timestamp}.json`);
  const wallMs = Date.now() - wallStart;

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: { args, timestamp, totalRuns: allResults.length, wallClockMs: wallMs },
        baseline: baselineAggs,
        mods: modRows,
        raw: allResults,
      },
      null,
      2,
    ),
  );

  console.log(`Wrote ${allResults.length} runs to ${outPath}`);
  console.log(`Wall clock: ${(wallMs / 1000).toFixed(1)}s`);
}

main();
