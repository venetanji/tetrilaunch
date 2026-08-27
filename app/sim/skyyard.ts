#!/usr/bin/env npx tsx
/**
 * THE ROOF'S YARD — what a refit stop is worth on the Skydeck, and at what
 * payout it stops being a gift.
 *
 *   npx tsx sim/skyyard.ts --mark 3 --seeds 20 --days 2
 *   npx tsx sim/skyyard.ts --seeds 8 --pays 2/10,1/5,2/0
 *   npx tsx sim/skyyard.ts --seeds 6 --bot demo --days 3
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION
 *
 * The Skydeck shipped with no yard: the rig that undocked was the rig that
 * landed. Playtesting reversed that (run.ts's schedule note carries the
 * history), and the reversal comes with an economy question the mode has never
 * had to answer, because of WHO flies it. The roof opens only to a player
 * holding every Mark's seal (meta.ts's skydeckOpen), and that player's Workshop
 * is finished — every track at UPRATE_MAX_TIER, which Mark 10's build budget
 * covers outright, with nothing left the Workshop will sell them. So the stop is
 * not the ladder's stop at all:
 *
 *  - on the LADDER, a stop sells the rungs a mid-budget rig has not reached,
 *    at 20 / 35 / 55 depending which rung it is;
 *  - on the ROOF, every rung it can sell is a TIER-3 rung — the tier only the
 *    yard sells — and they all cost the same TIER_COSTS[2].
 *
 * One flat price is what turns "more expensive or less scrap given" (the
 * owner's two levers) into ONE lever: with every purchasable rung at one price,
 * scaling the price and scaling the income are the same arithmetic. So this
 * harness sweeps the INCOME and reports what each setting BUYS, and the shipped
 * answer moves the number the mode already owns rather than giving one rung two
 * prices (level.ts's SKYDECK_SCRAP_PER_LINE / SKYDECK_SCRAP_PER_BAY).
 *
 * ---------------------------------------------------------------------------
 * HOW IT MEASURES
 *
 * `deeprun.ts` flies the real ten bays — `levelForRun`, `advanceRun`,
 * `buyUpgrades`, the actual draft — so the couplings that make this question
 * hard (carry, scrap, the ratchet, a magazine that never refills) are the
 * shipped ones rather than a model. Every economy is flown on the SAME SEEDS
 * with the SAME rig and the SAME day's clauses, so a row-to-row difference is
 * the economy and nothing else.
 *
 * THE STATISTIC IS THE WALL, not the clear rate, for `winnability.ts`'s reason:
 * at the top of the ladder a competent bot clears few enough runs that 0/8 is
 * indistinguishable between "correctly brutal" and "impossible", while WHERE a
 * run stops separates them cleanly. Bays cleared (mean) and the median death
 * bay are the two numbers to read; RUNGS is what the yard actually sold.
 *
 * PESSIMISM LEDGER, inherited whole from sim/README.md: the pilot fires
 * demolition charges and Bond Breakers, and still has no lookahead, a fixed
 * landing target and no read of the pile. A human clears bays this bot loses,
 * so every row is a floor — and the COMPARISON between rows is what this tool
 * is for, since the bias is identical on both sides of it.
 */
import {
  SCRAP_PER_BAY, SCRAP_PER_LINE, SKYDECK_SCRAP_PER_BAY, SKYDECK_SCRAP_PER_LINE,
  skydeckLaunchCost, skydeckRungFor, skydeckTargetScoreFor, type LevelConfig,
} from "../src/game/level";
import {
  MARK_COUNT, TIER_COSTS, UPGRADES, budgetForMark, newTiers, tiersCost, type UpgradeTiers,
} from "../src/game/upgrades";
import { UPRATE_MAX_TIER } from "../src/game/meta";
import { REFIT_EVERY, RUN_LEVELS } from "../src/game/run";
import { skydeckClauses, skydeckSeed, SKYDECK_MARK, type SkydeckRules } from "../src/game/skydeck";
import { dailySeed } from "../src/game/contracts";
import { BOTS } from "./bots";
import { bondHands, type CounterKit } from "./counters";
import { greedyRefit, noRefit, runDeepRun, type DeepRunOutcome, type RefitPolicy } from "./deeprun";
import { spreadSpec } from "./draft-space";

/* ---------------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

const seedCount = Math.max(1, parseInt(get("--seeds") ?? "6", 10));
/**
 * The Mark the whole comparison is flown at, and the one flag that has to be
 * argued for rather than defaulted.
 *
 * It defaults to 6, NOT to the Mark the roof is actually flown at, and
 * sim/skydeck.ts already wrote the argument this borrows: at Mark 10 this
 * instrument has no resolution left — docs/DESIGN.md publishes that Mark at 0%
 * implied run-clear for a competent bot, and a control already sitting on the
 * floor cannot say whether a change pushed it further down. Flown at 10 with a
 * maxed rig, every economy below dies in bay 2 and every row reads 0.0 rungs,
 * which measures the bot rather than the yard.
 *
 * The MODE is unchanged by the flag — the roof's step is defined as one rung
 * above the Mark below it (level.ts's skydeckRungFor), the yard opens on the
 * ladder's schedule, one notch a bay, three standing clauses — so a Mark-6 row
 * is the same STRUCTURE with headroom above and below it. Read the gap between
 * rows here, and read sim/skydeck.ts's Mark-10 rows for the sign.
 */
const mark = Math.max(1, Math.min(MARK_COUNT, parseInt(get("--mark") ?? "6", 10)));
const botName = get("--bot") ?? "demo";
const dayCount = Math.max(1, parseInt(get("--days") ?? "2", 10));
/**
 * The payouts to fly, as `perLine/perBay` pairs.
 *
 * A PAIR rather than a single multiplier, which the first pass of this harness
 * got wrong and the numbers corrected: both rates are whole dollars of scrap
 * (every screen counts them in pieces), so a share applied to the ladder's
 * 2/line rounds to 1 for everything from x0.5 to x0.99 and the "share" stops
 * being a dial at all. The two halves are also different KINDS of income — a
 * per-line rate is paid for work, a per-bay bonus is paid for arriving — and
 * the choice this file exists to make turned out to be between those two
 * halves rather than between two scalings of their sum.
 */
const pays = (get("--pays") ?? `${SCRAP_PER_LINE}/${SCRAP_PER_BAY},${SCRAP_PER_LINE}/0,1/5,1/0`)
  .split(",")
  .map((s) => s.split("/").map((x) => parseInt(x.trim(), 10)))
  .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  .map(([perLine, perBay]) => ({ perLine, perBay }));

if (!(botName in BOTS)) {
  console.error(`Unknown --bot "${botName}" — available: ${Object.keys(BOTS).join(", ")}`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * THE RIG — a finished Workshop, which is the only rig this floor ever sees.
 *
 * Built from UPGRADES rather than from a priority order (builds.ts's
 * PRIORITY_ORDERS), because there is no order to argue about: the Workshop
 * sells every track to UPRATE_MAX_TIER and Mark 10's budget covers all of them
 * at once. That is exactly the state the mode's door implies, and it is why the
 * yard's problem here is not the ladder's.
 * ------------------------------------------------------------------------- */

/**
 * EXCEPT the Loader Magazine, which is left at 0 — the one deviation from
 * "everything", and marks.ts's CALIBRATION_TRACKS refusal borrowed verbatim.
 *
 * The track cuts the reload cooldown, and every bot here fires on every
 * cooldown: a shorter reload buys it more shots at the same fixed arc, so the
 * rig spends its float faster without aiming better. Measured, because it is
 * exactly the kind of thing to assume rather than check — with MAG2 aboard, a
 * Mark-6 run on this rig died in bay 2 broke on 3 of 3 seeds under every
 * economy in the table, which is the bot being modelled and not the yard.
 *
 * It also costs the measurement nothing: a track at tier 0 is a track the yard
 * cannot sell at all (run.ts's buyUpgrade refuses to INSTALL), so the shelf is
 * eight tier-3 rungs at one flat price instead of nine, and the flat price is
 * the only property this file's argument rests on.
 */
const NOT_FOR_THE_BOT: readonly string[] = ["magazine"];

function maxedWorkshopRig(): UpgradeTiers {
  const tiers = newTiers();
  for (const def of UPGRADES) {
    if (NOT_FOR_THE_BOT.includes(def.id)) continue;
    tiers[def.id] = UPRATE_MAX_TIER;
  }
  return tiers;
}

/** Rungs still on the shelf when the run undocks — all of them tier 3, all at
 *  one price, which is the fact this whole file turns on. Counted off the rig
 *  rather than off UPGRADES, because a track the pilot does not own is a track
 *  the yard cannot sell (run.ts's buyUpgrade refuses to install). */
const RUNG_PRICE = TIER_COSTS[UPRATE_MAX_TIER];
const rungsForSale = (rig: UpgradeTiers): number =>
  UPGRADES.filter((u) => (rig[u.id] ?? 0) > 0).length;

/* ---------------------------------------------------------------------------
 * THE ECONOMIES
 * ------------------------------------------------------------------------- */

/** An economy is (what a bay pays, whether the yard opens). The payout is
 *  applied as a counter kit — a `level` hook runs after `levelForRun`, so it
 *  overwrites whatever the shipped rate wrote, which is what lets one binary
 *  fly a rate it does not ship. */
interface Economy {
  label: string;
  refit: RefitPolicy;
  kit?: CounterKit;
  /** Fly a LADDER run instead of the day's — the control the roof sits above:
   *  the same rig and seeds under two notches a bay, one drafted clause on the
   *  last bay, and the ladder's own bays and payout. Without it a Skydeck row
   *  has nothing to be dear RELATIVE TO, which is the only way "the roof is a
   *  step above the ladder" is a claim rather than a slogan. */
  ladderRun?: boolean;
}

function payout(perLine: number, perBay: number): CounterKit {
  return {
    id: `pay${perLine}-${perBay}`,
    name: `${perLine}/line + ${perBay}/bay`,
    cost: 0,
    level(cfg: LevelConfig) {
      cfg.scrapPerLine = perLine;
      cfg.scrapPerBay = perBay;
    },
  };
}

/** Spend it as it arrives, breadth-first across the whole shelf — the shape a
 *  player with a finished rig actually buys in, since every rung costs the same
 *  and no track is cheaper to deepen than another. */
const SPEND_ALL = greedyRefit(UPGRADES.map((u) => u.id), true);

function economies(): Economy[] {
  const out: Economy[] = [
    // (0) THE LADDER at this Mark, on the same rig: the mode the roof sits
    // above, with its yard open at its own payout.
    { label: "0 · LADDER run (control)", refit: SPEND_ALL, ladderRun: true },
    // (a) THE SKYDECK AS IT SHIPPED: no stop, and no scrap either — the run
    // declined the payout because there was nowhere to spend it.
    { label: "a · no yard (was shipped)", refit: noRefit, kit: payout(0, 0) },
  ];
  for (const { perLine, perBay } of pays) {
    const ladder = perLine === SCRAP_PER_LINE && perBay === SCRAP_PER_BAY;
    out.push({
      label: `${ladder ? "b" : "c"} · yard, ${perLine}/line + ${perBay}/bay`,
      refit: SPEND_ALL,
      kit: payout(perLine, perBay),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * THE RUNS
 * ------------------------------------------------------------------------- */

/** The days to fly. Real day keys, so the clause stacks are ones a player will
 *  actually meet rather than a set this file invented. */
function days(): { day: number; rules: SkydeckRules }[] {
  const out: { day: number; rules: SkydeckRules }[] = [];
  for (let k = 0; k < dayCount; k++) {
    const d = new Date(Date.now() + k * 86_400_000);
    out.push({ day: dailySeed(d), rules: { day: dailySeed(d), clauses: skydeckClauses(skydeckSeed(d)) } });
  }
  return out;
}

interface Row {
  label: string;
  runs: DeepRunOutcome[];
}

function fly(econ: Economy, rig: UpgradeTiers): Row {
  const runs: DeepRunOutcome[] = [];
  for (const { rules } of days()) {
    for (let s = 1; s <= seedCount; s++) {
      runs.push(runDeepRun({
        mark,
        seed: s * 7919,
        bot: (seed) => bondHands(BOTS[botName](seed)),
        loadout: { ...rig },
        // The interior policy: take the shallowest axis on the table. A corner
        // policy would be measuring the axis, and the question here is the
        // yard.
        draft: spreadSpec.build(s * 7919),
        refit: econ.refit,
        counters: econ.kit,
        skydeck: econ.ladderRun ? undefined : rules,
      }));
    }
  }
  return { label: econ.label, runs };
}

/* ---------------------------------------------------------------------------
 * REPORT
 * ------------------------------------------------------------------------- */

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Rungs the yard actually sold: the tiers the run ENDED with, minus the ones
 *  it undocked with. Counted rather than divided out of the spend, so a future
 *  price change cannot make this line lie. */
function rungsBought(o: DeepRunOutcome, rig: UpgradeTiers): number {
  return UPGRADES.reduce(
    (a, u) => a + Math.max(0, (o.tiersEnd[u.id] ?? 0) - (rig[u.id] ?? 0)), 0,
  );
}

const rig = maxedWorkshopRig();
console.log(
  `The roof's yard — Mark ${mark} + one step (rung ${skydeckRungFor(mark)}), `
  + `${seedCount} seeds x ${dayCount} day(s), bot ${botName}+bond`
  + (mark === MARK_COUNT ? "" : `   [shipped mode flies Mark ${SKYDECK_MARK}; see --mark]`),
);
console.log(
  `Rig: ${rungsForSale(rig)} tracks at the Workshop's ceiling (tier ${UPRATE_MAX_TIER}, ${tiersCost(rig)} pts of Mark ${MARK_COUNT}'s ${budgetForMark(MARK_COUNT)}), `
  + `${NOT_FOR_THE_BOT.join("+")} left off (see NOT_FOR_THE_BOT).`,
);
console.log(
  `Yard: stops after bays ${REFIT_EVERY}/${REFIT_EVERY * 2}/${REFIT_EVERY * 3}; every rung it can sell is tier ${UPRATE_MAX_TIER + 1} at ${RUNG_PRICE} scrap, ${rungsForSale(rig)} of them.`,
);
console.log(
  `Bays: $${skydeckTargetScoreFor(0, mark)} -> $${skydeckTargetScoreFor(RUN_LEVELS - 1, mark)} at $${skydeckLaunchCost(mark)} a shot.`,
);
console.log(
  `Ladder payout: ${SCRAP_PER_LINE}/line + ${SCRAP_PER_BAY}/bay. Shipped roof payout: ${SKYDECK_SCRAP_PER_LINE}/line + ${SKYDECK_SCRAP_PER_BAY}/bay.\n`,
);

/* ---------------------------------------------------------------------------
 * PURCHASING POWER — the half of this question that is arithmetic.
 *
 * Printed before a single bay is flown, and it is the DECISIVE table rather
 * than a preamble to the flights. Income here is a function of exactly one
 * thing the pilot controls — lines cleared — and every rung the yard can sell a
 * finished rig is the same price, so "what can this economy buy" has an exact
 * answer at any given lines-a-bay. Nothing about it is bot-dependent, which
 * matters because the bots' weakest statistic IS lines: a table that only
 * existed inside the flights would be reporting the pilot.
 *
 * The flights below then answer the question this table cannot — whether the
 * tightened yard still leaves a run that can be flown at all.
 *
 * Read the ~10-12 lines-a-bay rows for the endgame pilot this floor is for; the
 * 6-line row is roughly what the harness's own bot manages, and is here so the
 * gap between the two is visible rather than argued about.
 * ------------------------------------------------------------------------- */

function rungsByStop(perLine: number, perBay: number, lines: number): number[] {
  const out: number[] = [];
  let purse = 0;
  for (let stop = 1; stop * REFIT_EVERY < RUN_LEVELS; stop++) {
    purse += REFIT_EVERY * (lines * perLine + perBay);
    const bought = Math.floor(purse / RUNG_PRICE);
    purse -= bought * RUNG_PRICE;
    out.push(bought);
  }
  return out;
}

console.log("Purchasing power (deterministic — rungs bought at stops 1/2/3, and the run's total):");
console.log(
  `  ${"payout".padEnd(20)}${[6, 8, 10, 12, 14].map((l) => `${l} lines/bay`.padStart(14)).join("")}`,
);
const tableRows = [{ perLine: SCRAP_PER_LINE, perBay: SCRAP_PER_BAY }, ...pays]
  .filter((p, i, all) => all.findIndex((q) => q.perLine === p.perLine && q.perBay === p.perBay) === i);
for (const { perLine, perBay } of tableRows) {
  const cells = [6, 8, 10, 12, 14].map((lines) => {
    const stops = rungsByStop(perLine, perBay, lines);
    return `${stops.join("/")} =${stops.reduce((a, b) => a + b, 0)}`.padStart(14);
  });
  console.log(`  ${`${perLine}/line + ${perBay}/bay`.padEnd(20)}${cells.join("")}`);
}
console.log();

const rows = economies().map((e) => fly(e, rig));
const width = Math.max(24, ...rows.map((r) => r.label.length));
console.log([
  "economy".padEnd(width), "bays".padStart(6), "wall".padStart(6), "clears".padStart(7),
  "earned".padStart(7), "spent".padStart(6), "rungs".padStart(6),
].join(" "));
for (const r of rows) {
  const died = r.runs.filter((o) => !o.cleared).map((o) => o.diedAt ?? RUN_LEVELS);
  console.log([
    r.label.padEnd(width),
    mean(r.runs.map((o) => o.baysCleared)).toFixed(1).padStart(6),
    String(median(died)).padStart(6),
    `${r.runs.filter((o) => o.cleared).length}/${r.runs.length}`.padStart(7),
    mean(r.runs.map((o) => o.scrapEarned)).toFixed(0).padStart(7),
    mean(r.runs.map((o) => o.scrapSpent)).toFixed(0).padStart(6),
    mean(r.runs.map((o) => rungsBought(o, rig))).toFixed(1).padStart(6),
  ].join(" "));
}

// WHAT EACH STOP COULD AFFORD, which is the half a run total hides: a share
// that buys two rungs at the last stop and nothing at the first is a different
// mode from one that buys one at each.
console.log("\nRungs bought at each stop (mean):");
for (const r of rows) {
  const perStop: number[] = [];
  for (let k = 1; k * REFIT_EVERY < RUN_LEVELS; k++) {
    const bay = k * REFIT_EVERY;
    perStop.push(mean(r.runs.map((o) => {
      const rec = o.bays.find((b) => b.bay === bay);
      return rec ? rec.refitSpend / RUNG_PRICE : 0;
    })));
  }
  console.log(`  ${r.label.padEnd(width)} ${perStop.map((x) => x.toFixed(2).padStart(6)).join(" ")}`);
}

console.log(
  "\nPESSIMISTIC and comparative: the pilot fires charges and Bond Breakers but has no"
  + "\nlookahead and never reads the pile (sim/README.md). Read the GAP between rows.",
);
