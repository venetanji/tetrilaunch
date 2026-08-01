#!/usr/bin/env npx tsx
// Mark calibration CLI.
//
//   npx tsx sim/marks.ts [--marks 1,5,10] [--bays 1,4,7,10] [--seeds 3]
//     [--bots aim] [--carry 150] [--target-step 0.12] [--speed-step 0.04]
//
// Answers the one question the Mark ladder can't be tuned without
// (docs/DESIGN.md): does a rig built with the FULL Mark-N budget, played at the
// sim bot's competence, fall JUST SHORT of the Mark N target?
//
//   - clears comfortably  -> the Mark is free, and every board above it is
//                            easier than the one below
//   - can't clear at all  -> the Mark is impossible, however well played
//   - falls just short    -> correct: the gap is what player skill fills
//
// The headline number is the implied RUN clear rate, not the per-bay win rate.
// A run must take all ten bays, so 90% per bay is only ~35% of runs — the
// per-bay figure reads far more forgiving than the ladder actually is.
//
// `aim` is the default bot because it is the strongest one here — on the stock
// Mark 1 ladder it takes ~80% of bays, where lob-flat manages ~33%. Calibrating
// against a weak bot would read every Mark as impossible and drag the whole
// ladder down to trivial.
//
// Two caveats inherited from sim/README.md, both of which bias this PESSIMISTIC:
// the bots never use Bond Breaker or Demolition (so the BONDS track measures as
// worthless and bomb-carrying builds are undersold), and they fire a fixed arc
// rather than reading the pile. A human clears bays these bots lose.
import { makeBaseLevel, MARK_SPEED_STEP, MARK_TARGET_STEP } from "../src/game/level";
import {
  applyUpgrades, budgetForMark, MARK_COUNT, newTiers, nextTierCost, tiersCost,
  UPGRADES, type UpgradeId, type UpgradeTiers,
} from "../src/game/upgrades";
import { RUN_LEVELS } from "../src/game/run";
import { BOTS } from "./bots";
import { runBay } from "./runner";

// ---------------------------------------------------------------------------
// Build archetypes — how a player might actually spend a budget.
//
// The calibration criterion says "a rig built with the full budget", but a
// budget can be spent many ways and a real player finds a good one. So we test
// several shapes and judge the Mark by the BEST of them: the question is
// whether the ladder is beatable by a competent build, not by an average one.
// ---------------------------------------------------------------------------

/** Max out each track in priority order until the budget won't stretch. */
function focused(order: UpgradeId[], budget: number): UpgradeTiers {
  const tiers = newTiers();
  for (const id of order) {
    for (;;) {
      const cost = nextTierCost(tiers[id]);
      if (cost === null) break;
      const next = { ...tiers, [id]: tiers[id] + 1 };
      if (tiersCost(next) > budget) break;
      tiers[id] = next[id];
    }
  }
  return tiers;
}

/** Buy tier 1 everywhere affordable, then tier 2 everywhere, and so on. */
function spread(order: UpgradeId[], budget: number): UpgradeTiers {
  const tiers = newTiers();
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of order) {
      const cost = nextTierCost(tiers[id]);
      if (cost === null) continue;
      const next = { ...tiers, [id]: tiers[id] + 1 };
      if (tiersCost(next) > budget) continue;
      tiers[id] = next[id];
      bought = true;
    }
  }
  return tiers;
}

/**
 * MAGAZINE is excluded from every build here, and that needs justifying.
 *
 * The bots fire whenever the cooldown allows, so a shorter cooldown just makes
 * them spend faster. Measured on bay 5 at Mark 1 over 4 seeds: a stock rig wins
 * 3/4, a full 660-point rig wins 0/4, and dropping ONLY magazine from that full
 * rig restores it to 3/4. The full rig even clears more lines (8.8 vs 6.5) — it
 * goes broke anyway, because spraying onto a pile that hasn't settled costs more
 * shots per line. A human spends tempo selectively and gains from it; the bot
 * cannot, so for this harness the track reads as a self-inflicted wound.
 *
 * Consequence for anything measured here: these builds top out at 550 of the
 * 660-point ladder, so a Mark's difficulty is being judged against a rig missing
 * one track. That biases the result toward "too hard" — a human who spends
 * tempo well will find a calibrated Mark easier than the number suggests.
 * MAGAZINE's real value needs human playtesting; the sim cannot see it.
 */
const CALIBRATION_TRACKS: UpgradeId[] = ["reactor", "hydraulics", "bay", "launcher", "bonds"];

const ARCHETYPES: Record<string, (budget: number) => UpgradeTiers> = {
  // The economy build: buy the rate, then the press that realises it.
  economy: (b) => focused(["reactor", "hydraulics", "bay", "launcher", "bonds"], b),
  // The spatial build: more room to land in, and a press that squares it up.
  spatial: (b) => focused(["bay", "hydraulics", "reactor", "launcher", "bonds"], b),
  // The power build: reach the back of the bay and fight the weather.
  power: (b) => focused(["launcher", "hydraulics", "reactor", "bay", "bonds"], b),
  // A little of everything — the instinctive first spend.
  spread: (b) => spread(CALIBRATION_TRACKS, b),
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

const marks = nums(get("--marks") ?? Array.from({ length: MARK_COUNT }, (_, i) => i + 1).join(","));
// A spread of the ladder rather than all ten bays: bay 1 is the floor, bay 10
// the ceiling, and the two in between catch a curve that sags in the middle.
const bays = nums(get("--bays") ?? "1,4,7,10");
const seeds = parseInt(get("--seeds") ?? "3", 10);
const botNames = (get("--bots") ?? "aim").split(",").map((s) => s.trim()).filter(Boolean);
// Mirrors run.ts's RunState.carry — a typical one-line overshoot into bay > 1.
const carry = parseInt(get("--carry") ?? "150", 10);
// Candidate values for level.ts's MARK_TARGET_STEP / MARK_SPEED_STEP. Overriding
// them here rather than editing the constants is what makes this a SEARCH: the
// shipped numbers are a guess until a sweep says otherwise, and the sweep has to
// be able to try values the source doesn't hold.
const targetStep = parseFloat(get("--target-step") ?? String(MARK_TARGET_STEP));
const speedStep = parseFloat(get("--speed-step") ?? String(MARK_SPEED_STEP));

for (const b of botNames) {
  if (!(b in BOTS)) {
    console.error(`Unknown bot "${b}" — available: ${Object.keys(BOTS).join(", ")}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------

/** Win rate for one (mark, build) across the tested bays, seeds and bots, plus
 *  the per-bay breakdown the run-clear estimate is built from. */
function evaluate(mark: number, tiers: UpgradeTiers): { perBay: Map<number, number>; overall: number } {
  const perBay = new Map<number, number>();
  let wins = 0;
  let total = 0;
  for (const bay of bays) {
    let bayWins = 0;
    let bayTotal = 0;
    for (const botName of botNames) {
      for (let s = 0; s < seeds; s++) {
        // Build the base at Mark 1 (stock) and apply the CANDIDATE mark scaling
        // by hand, so a sweep can try steps the shipped constants don't hold.
        // Order mirrors run.ts's levelForRun exactly — base, then upgrades —
        // because REACTOR raises scorePerLine and would otherwise be measured
        // against the wrong target.
        const cfg = makeBaseLevel(bay - 1, 1);
        const marksAbove = mark - 1;
        cfg.targetScore = Math.round(cfg.targetScore * (1 + targetStep * marksAbove));
        cfg.compactorSpeed *= 1 + speedStep * marksAbove;
        applyUpgrades(cfg, tiers);
        if (bay > 1) cfg.startingFunds += carry;
        const out = runBay(cfg, BOTS[botName](s + 1), s + 1);
        if (out.status === "won") bayWins += 1;
        bayTotal += 1;
      }
    }
    perBay.set(bay, bayWins / bayTotal);
    wins += bayWins;
    total += bayTotal;
  }
  return { perBay, overall: wins / total };
}

/**
 * Probability of clearing a whole run, estimated from the sampled bays.
 *
 * A run needs every one of RUN_LEVELS bays, so this is the product of the
 * per-bay rates — with each sampled bay standing in for the unsampled ones
 * around it (geometric mean of the samples, raised to the run length). Crude,
 * and it ignores the way carry makes a good bay ease the next one, but it is
 * the right ORDER of magnitude and it is the number the ladder should be tuned
 * against. Per-bay rates flatter the ladder badly: 90% a bay is a third of runs.
 */
function runClearRate(perBay: Map<number, number>): number {
  const rates = [...perBay.values()];
  if (rates.some((r) => r === 0)) return 0;
  const logMean = rates.reduce((a, r) => a + Math.log(r), 0) / rates.length;
  return Math.exp(logMean * RUN_LEVELS);
}

function verdict(runRate: number): string {
  if (runRate === 0) return "IMPOSSIBLE";
  if (runRate < 0.02) return "too hard";
  if (runRate > 0.6) return "FREE";
  if (runRate > 0.35) return "soft";
  return "just short";
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

console.log(
  `Mark calibration — bays ${bays.join("/")} · ${seeds} seeds · bots ${botNames.join("+")} · carry $${carry} · target-step ${targetStep} · speed-step ${speedStep}`,
);
console.log(
  `Criterion: the BEST build at a Mark should fall JUST SHORT (run clear 2-35%).\n`,
);

const header = ["Mark", "budget", ...Object.keys(ARCHETYPES).map((a) => a.slice(0, 7)), "best", "run", "verdict"];
console.log(header.map((h, i) => h.padStart(i === 0 ? 4 : 8)).join(" "));

const rows: { mark: number; best: string; runRate: number }[] = [];
for (const mark of marks) {
  const budget = budgetForMark(mark);
  const cells: string[] = [];
  let best = { name: "", overall: -1, perBay: new Map<number, number>() };
  for (const [name, build] of Object.entries(ARCHETYPES)) {
    const tiers = build(budget);
    const res = evaluate(mark, tiers);
    cells.push(pct(res.overall));
    if (res.overall > best.overall) best = { name, overall: res.overall, perBay: res.perBay };
  }
  const runRate = runClearRate(best.perBay);
  rows.push({ mark, best: best.name, runRate });
  console.log(
    [
      String(mark).padStart(4),
      String(budget).padStart(8),
      ...cells.map((c) => c.padStart(8)),
      best.name.padStart(8),
      pct(runRate).padStart(8),
      verdict(runRate).padStart(11),
    ].join(" "),
  );
}

// ---------------------------------------------------------------------------
console.log("\nPer-Mark detail for the winning build:");
for (const mark of marks) {
  const budget = budgetForMark(mark);
  const row = rows.find((r) => r.mark === mark)!;
  const tiers = ARCHETYPES[row.best](budget);
  const spent = tiersCost(tiers);
  const desc = UPGRADES.filter((u) => tiers[u.id] > 0).map((u) => `${u.glyph}${tiers[u.id]}`).join(" ") || "stock";
  console.log(`  Mark ${String(mark).padStart(2)}  ${row.best.padEnd(8)} ${String(spent).padStart(3)}/${budget}  ${desc}`);
}
