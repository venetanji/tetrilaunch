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
import {
  makeBaseLevel, MARK_SPEED_STEP, MARK_TARGET_STEP, SCRAP_PER_BAY, SCRAP_PER_LINE,
} from "../src/game/level";
import {
  applyRatchets,
} from "../src/game/hazards";
import {
  applyUpgrades, budgetForMark, MARK_COUNT, newTiers, nextTierCost, tiersCost,
  UPGRADES, type UpgradeId, type UpgradeTiers,
} from "../src/game/upgrades";
import { installById } from "../src/game/meta";
import { REFIT_EVERY, RUN_LEVELS } from "../src/game/run";
import { BOTS } from "./bots";
import { spreadRatchets } from "./ratchet-model";
import { runBay } from "./runner";

// ---------------------------------------------------------------------------
// Build archetypes — how a player might actually spend a budget.
//
// The calibration criterion says "a rig built with the full budget", but a
// budget can be spent many ways and a real player finds a good one. So we test
// several shapes and judge the Mark by the BEST of them: the question is
// whether the ladder is beatable by a competent build, not by an average one.
// ---------------------------------------------------------------------------

/**
 * The tiers a run can actually HOLD at `bay` are two purchases, not one:
 *
 *  1. The Workshop loadout — tier 1 only, per track. buyInstall refuses a
 *     track already at tier 1 ("an install never stacks" — meta.ts), gated
 *     by requiresMark and capped by the Mark's build budget. This is the
 *     whole rig for bays 1-3.
 *  2. Scrap refits at the stops after bays 3, 6 and 9 (run.ts's
 *     REFIT_EVERY/isRefitBay), which deepen INSTALLED tracks only
 *     (run.ts's buyUpgrade refuses tier 0) out of scrap earned in-run.
 *
 * The old model here spent the whole budget as deep tiers from bay 1 —
 * configurations no real run can reach (a "Mark-1 RCT2" opened bay 1 with
 * a second reactor tier that is only purchasable at the stop after bay 3).
 * Every bay was being measured against a rig from later in the run.
 *
 * Scrap income is modeled at the design's own sizing estimate (level.ts's
 * SCRAP note: a clean bay is worth ~8 lines) rather than re-measured per
 * config — the harness needs ONE schedule, not a feedback loop.
 */
const SCRAP_PER_CLEARED_BAY = 8 * SCRAP_PER_LINE + SCRAP_PER_BAY;

/** Workshop phase: tier 1 in priority order, requiresMark-gated and
 *  budget-capped. */
function loadoutFor(order: UpgradeId[], mark: number): UpgradeTiers {
  const tiers = newTiers();
  for (const id of ownableTracks(order, mark)) {
    const next = { ...tiers, [id]: 1 };
    if (tiersCost(next) > budgetForMark(mark)) continue;
    tiers[id] = 1;
  }
  return tiers;
}

/** Spend `bank` scrap deepening installed tracks, in priority order.
 *  focused (breadthFirst=false) re-scans from the top after each buy, so it
 *  maxes the first track before touching the second; spread buys one tier
 *  per track per pass. Returns the unspent remainder. */
function spendScrap(
  tiers: UpgradeTiers, order: UpgradeId[], bank: number, breadthFirst: boolean,
): number {
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of order) {
      if ((tiers[id] ?? 0) < 1) continue;
      const cost = nextTierCost(tiers[id]);
      if (cost === null || cost > bank) continue;
      tiers[id] += 1;
      bank -= cost;
      bought = true;
      if (!breadthFirst) break;
    }
  }
  return bank;
}

/** The rig as it stands ENTERING `bay` (1-based): the tier-1 loadout plus
 *  every refit stop the run has already passed, each spending the scrap
 *  banked since the last one. */
function tiersForBay(
  order: UpgradeId[], mark: number, bay: number, breadthFirst: boolean,
): UpgradeTiers {
  const tiers = loadoutFor(order, mark);
  let earnedSpent = 0;
  for (let stopBay = REFIT_EVERY; stopBay < RUN_LEVELS; stopBay += REFIT_EVERY) {
    if (bay <= stopBay) break;
    const bank = SCRAP_PER_CLEARED_BAY * stopBay - earnedSpent;
    const left = spendScrap(tiers, order, bank, breadthFirst);
    earnedSpent += bank - left;
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

/** The tracks a Mark-M pilot can actually OWN: an install's requiresMark
 *  counts Marks BEATEN (meta.ts), and a player flying Mark M has beaten
 *  M - 1. Without this gate the Mark-1 row is judged against a rig no
 *  first-run player can build — measured: its "best" build put 75 of 77
 *  points into BAY2+HYD1, both requiresMark 1, i.e. locked until the Mark
 *  it was supposed to be measuring is already beaten. In-run refits cannot
 *  reach them either (run.ts's buyUpgrade refuses tier-0 tracks). */
function ownableTracks(order: UpgradeId[], mark: number): UpgradeId[] {
  return order.filter((id) => (installById(id)?.requiresMark ?? 0) <= mark - 1);
}

const ARCHETYPES: Record<string, (mark: number, bay: number) => UpgradeTiers> = {
  // The economy build: buy the rate, then the press that realises it.
  economy: (m, b) => tiersForBay(["reactor", "hydraulics", "bay", "launcher", "bonds"], m, b, false),
  // The spatial build: more room to land in, and a press that squares it up.
  spatial: (m, b) => tiersForBay(["bay", "hydraulics", "reactor", "launcher", "bonds"], m, b, false),
  // The power build: reach the back of the bay and fight the weather.
  power: (m, b) => tiersForBay(["launcher", "hydraulics", "reactor", "bay", "bonds"], m, b, false),
  // A little of everything — the instinctive first spend.
  spread: (m, b) => tiersForBay(CALIBRATION_TRACKS, m, b, true),
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
// --ratchets none|spread. `none` is the harness's original meaning: the rig
// against STOCK bays, no hazard notches — which measures the SHIP, not the
// run. `spread` models what a Deep Run actually forces: one ratchet pick per
// cleared bay (two at the capstone Mark), spread round-robin across the
// NUMBER axes the Mark offers. Content axes are excluded because every hand
// holds at least two number axes (hazards.ts) so content is always dodgeable
// — and because these bots own no answer to a material, which would measure
// "bots can't play slag", not the ladder. The slid Fibonacci ladders
// (notchTotal's startAt = mark - 1) are exactly what this mode exists to
// price: at Mark M the first cost/time notch lands M-1 rungs up.
const ratchetMode = (get("--ratchets") ?? "none") as "none" | "spread";
if (ratchetMode !== "none" && ratchetMode !== "spread") {
  console.error(`Unknown --ratchets "${ratchetMode}" — available: none, spread`);
  process.exit(1);
}

for (const b of botNames) {
  if (!(b in BOTS)) {
    console.error(`Unknown bot "${b}" — available: ${Object.keys(BOTS).join(", ")}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------

/** Win rate for one (mark, build) across the tested bays, seeds and bots, plus
 *  the per-bay breakdown the run-clear estimate is built from. */
function evaluate(
  mark: number,
  build: (mark: number, bay: number) => UpgradeTiers,
): { perBay: Map<number, number>; overall: number } {
  const perBay = new Map<number, number>();
  let wins = 0;
  let total = 0;
  for (const bay of bays) {
    // The rig as the run actually holds it AT this bay — tier-1 loadout for
    // bays 1-3, plus every refit stop already passed (see tiersForBay).
    const tiers = build(mark, bay);
    let bayWins = 0;
    let bayTotal = 0;
    for (const botName of botNames) {
      for (let s = 0; s < seeds; s++) {
        // Build the base at Mark 1 (stock) and apply the CANDIDATE mark scaling
        // by hand, so a sweep can try steps the shipped constants don't hold.
        // Order mirrors run.ts's levelForRun exactly — base, then upgrades —
        // because REACTOR raises scorePerLine and would otherwise be measured
        // against the wrong target.
        // mark (not 1) so cfg.mark is honest: the ratchet ladders read it
        // (notchTotal starts at mark - 1). With MARK_TARGET_STEP and
        // MARK_SPEED_STEP both 0 nothing else in the base config moves.
        let cfg = makeBaseLevel(bay - 1, mark);
        const marksAbove = mark - 1;
        cfg.targetScore = Math.round(cfg.targetScore * (1 + targetStep * marksAbove));
        cfg.compactorSpeed *= 1 + speedStep * marksAbove;
        applyUpgrades(cfg, tiers);
        // Same order as run.ts's levelForRun: the ship first, then the
        // conditions it is flown in, then cash in hand.
        if (ratchetMode === "spread") cfg = applyRatchets(cfg, spreadRatchets(mark, bay));
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
  `Mark calibration — bays ${bays.join("/")} · ${seeds} seeds · bots ${botNames.join("+")} · carry $${carry} · target-step ${targetStep} · speed-step ${speedStep} · ratchets ${ratchetMode}`,
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
    const res = evaluate(mark, build);
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
console.log("\nPer-Mark detail for the winning build (rig at bay 1 -> rig at bay 10):");
for (const mark of marks) {
  const budget = budgetForMark(mark);
  const row = rows.find((r) => r.mark === mark)!;
  const show = (tiers: UpgradeTiers): string =>
    UPGRADES.filter((u) => tiers[u.id] > 0).map((u) => `${u.glyph}${tiers[u.id]}`).join(" ") || "stock";
  const first = ARCHETYPES[row.best](mark, 1);
  const last = ARCHETYPES[row.best](mark, RUN_LEVELS);
  console.log(
    `  Mark ${String(mark).padStart(2)}  ${row.best.padEnd(8)} loadout ${String(tiersCost(first)).padStart(3)}/${budget}  ${show(first)}  ->  ${show(last)}`,
  );
}
