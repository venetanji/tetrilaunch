#!/usr/bin/env npx tsx
/**
 * WINNABILITY — which notch combos can a Deep Run at Tier N actually survive,
 * and what is the CHEAPEST rig that survives them?
 *
 *   npm run sim:winnability -- --marks 5,10 --seeds 2
 *   npm run sim:winnability -- --marks 10 --seeds 3 --mode cheapest
 *   npm run sim:winnability -- --marks 7 --policies max:cryo,max:volatile --counters cushion2
 *   npm run sim:winnability -- --marks 1,5,10 --build spatial,economy,material
 *   npm run sim:winnability -- --mode counter --marks 7 --bay 10 \
 *     --ratchets volatile:3 --counters cushion1,cushion2,cushion3 --seeds 10
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION, AND WHY IT NEEDED A NEW TOOL
 *
 * `sweep.ts` prices a bay, `marks.ts` prices a Mark, `pile.ts` prices the
 * congestion tax. None of them can answer "is THIS build of the run winnable",
 * because a build of the run is a sequence of eight ratchet picks whose whole
 * cost is that they compound — and both existing sweeps deliberately replace
 * that compounding with a model (`ratchet-model.ts`'s round-robin, which
 * excludes content axes outright and says so).
 *
 * This tool flies the real thing. `deeprun.ts` drives ten bays through
 * `run.ts`'s own `advanceRun`/`buyUpgrades`, `draft-space.ts` enumerates the
 * hands `hazards.ts` actually deals and takes only picks `togglePick` would
 * accept, and the pilot holds every counter the game already sells.
 *
 * ---------------------------------------------------------------------------
 * COVERED VERSUS SAMPLED — stated in every run, never implied
 *
 * The combo space is EXHAUSTIVELY ENUMERATED and only PARTLY PLAYED, and the
 * header banner prints both numbers because the gap is the result's main
 * caveat. Enumerating is free (`draft-space.ts`: 2^8 = 256 paths below the
 * capstone, 3^8 = 6561 at it, milliseconds either way); playing one combo costs
 * seconds, so the sweep plays a chosen few.
 *
 * WHAT IS COVERED EXHAUSTIVELY: the CORNERS. One `max:<axis>` policy per axis
 * the Mark deals — the run that pours every notch it is offered into one thing.
 * That set is complete (Mark 10 deals ten axes after the retirement of Quota
 * Raise, so ten corner policies), and it is where unwinnability lives: a cliff
 * is found by walking to the edge, not by sampling the middle.
 *
 * WHAT IS SAMPLED: the interior, by `spread` (take the shallowest axis on the
 * table), `dodge` (refuse materials wherever the hand allows) and `--random N`
 * seeded walks. Every printed row carries its policy name, and the policy name
 * says which half it came from.
 *
 * WHAT IS NOT COVERED AT ALL, and must not be read into a number here:
 *  - Draft policies that change their mind mid-run. A real player does; every
 *    policy here is stationary.
 *  - Seeds beyond `--seeds`. A combo is a function of the seed only through
 *    which hands were DEALT, so a corner policy reaches a similar corner on
 *    every seed — but "similar" is not "identical", and the reported combo is
 *    always the one actually achieved, never the one intended.
 *  - The Final Inspection's second clause, unless `--finals both` is passed.
 *
 * ---------------------------------------------------------------------------
 * THE PESSIMISM LEDGER
 *
 * Every bias in this harness runs one way, and a tool whose headline word is
 * "unwinnable" has to keep the list where the reader can see it:
 *
 *  + CLOSED since the older sweeps: the pilot fires demolition charges
 *    (`bots.ts`'s `demo`) and Bond Breakers (`counters.ts`'s `bondHands`).
 *    Both were open caveats in `sim/README.md` and both made materials read as
 *    unanswerable when what was unanswerable was the bot.
 *  - STILL OPEN: no lookahead, a fixed landing target per shot, no reading of
 *    the pile's shape, and no re-planning of the draft. A human clears bays
 *    these bots lose.
 *
 * So a combo this tool calls WINNABLE is winnable. A combo it calls UNWINNABLE
 * is a combo that beat a competent pair of hands holding every existing
 * counter — which is the strongest claim the instrument can make, and still not
 * a proof.
 */
import {
  applyRatchets, HAZARDS, hazardsForMark, picksPerBay,
  type HazardId, type Ratchets,
} from "../src/game/hazards";
import { makeBaseLevel } from "../src/game/level";
import {
  applyUpgrades, budgetForMark, MARK_COUNT, tiersCost, type UpgradeId,
} from "../src/game/upgrades";
import { CARRY_CAP, RUN_LEVELS } from "../src/game/run";
import { runBay } from "./runner";
import { ADAPTIVE_BOTS, BOTS, type Bot } from "./bots";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";
import { bondHands, combineKits, COUNTER_KITS, type CounterKit } from "./counters";
import {
  comboKey, dodgeSpec, enumerateSpace, preferSpec, randomSpec, spreadSpec,
  type DraftPolicySpec,
} from "./draft-space";
import { greedyRefit, noRefit, runDeepRun, type DeepRunOutcome } from "./deeprun";
import {
  naiveStrategy, strategyPilot, STRATEGIES, type AimStrategySpec,
} from "./aim-strategies";

/* ---------------------------------------------------------------------------
 * CLASSIFICATION — read the WALL, not the clear rate
 *
 * The obvious statistic is the share of seeds that cleared all ten bays, and it
 * is the wrong one at every sample size this tool can afford. `marks.ts` states
 * the arithmetic that makes it wrong: a run needs every bay, so 90% a bay is
 * only ~35% of runs and 80% a bay is 11%. At three seeds, 0/3 clears is exactly
 * what an 11%-per-run ladder looks like — the estimator cannot tell a Tier that
 * is correctly tuned from one that is impossible, which is the whole question.
 *
 * The statistic that CAN tell them apart is where the run stops. A combo that
 * dies on bay 2 every seed and a combo that dies on bay 9 every seed both score
 * zero clears and are nothing alike: one is a wall, the other is the "falls
 * just short" band the ladder is supposed to live in.
 *
 * So the verdict reads the WALL — the median bay a run died in — and the clear
 * count only promotes. The thresholds are the one place this tool makes a
 * judgement rather than a measurement, so they are named and the banner prints
 * them.
 * ------------------------------------------------------------------------- */

/** The run typically reached at least this bay before dying: close enough that
 *  the gap is plausibly the pilot's rather than the combo's.
 *
 *  Six, because dying IN bay 6 means the run cleared five bays and has a refit
 *  stop behind it (run.ts's REFIT_EVERY = 3 puts the first after bay 3) — it
 *  has been handed the scrap lever and used it, so what beat it is the ladder
 *  getting steeper rather than the ladder being a wall. Below six the run never
 *  got to spend anything, and a combo that ends a run before its first refit is
 *  not a difficulty curve. */
export const MARGINAL_WALL = 6;

/** Seeds that must go the distance before the cheapest-strategy search calls a
 *  rung a win. One, because the search is bracketing where a clear becomes
 *  POSSIBLE; where it becomes RELIABLE is a different and much dearer number,
 *  and conflating them would report the second while claiming the first. */
export const CHEAPEST_CLEARS_REQUIRED = 1;

export type Verdict = "winnable" | "marginal" | "unwinnable";

/** `clears` — seeds that took all ten bays. `wall` — median bay the rest died
 *  in (RUN_LEVELS when nothing died). */
export function classify(clears: number, wall: number): Verdict {
  if (clears > 0) return "winnable";
  return wall >= MARGINAL_WALL ? "marginal" : "unwinnable";
}

/* ---------------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

const marks = nums(get("--marks") ?? "5,10").map((m) => Math.max(1, Math.min(MARK_COUNT, m)));
const seedCount = Math.max(1, parseInt(get("--seeds") ?? "2", 10));
const randomWalks = Math.max(0, parseInt(get("--random") ?? "2", 10));
const mode = (get("--mode") ?? "combos") as "combos" | "cheapest" | "both" | "counter";
/**
 * `spatial` by default, MEASURED rather than picked. At Mark 5 over 6 seeds
 * under the `dodge` policy the four priority orders wall at bay 5 (spatial),
 * 4 (material), 4 (economy) and 3 (full); at Mark 7 spatial walls at 6 where
 * material walls at 5. `full` is last because it is the only order that reaches
 * MAGAZINE, and `marks.ts`'s CALIBRATION_TRACKS note already records why that
 * is a self-inflicted wound to a bot that fires on every cooldown.
 *
 * The exception the findings doc has to respect: `spatial` carries no
 * DEMOLITION, which is slag's only exit. A slag combo measured on this build is
 * measuring a rig with no answer, so slag rows are re-run on `--build material`
 * and both numbers are reported.
 *
 * A COMMA LIST runs every named order and reports the BEST result per policy,
 * naming which order produced it. That is `marks.ts`'s own doctrine — "a budget
 * can be spent many ways and a real player finds a good one, so we test several
 * shapes and judge the Mark by the BEST of them" — and it is what stops a
 * priority order's own weakness (spatial starves the Reactor at Mark 2, where
 * the budget runs out one rung short of RCT2) reading as the ladder's.
 */
const buildNames = (get("--build") ?? "spatial").split(",").map((s) => s.trim()).filter(Boolean);
const buildName = buildNames[0];
const botName = get("--bot") ?? "demo";
const finalsMode = (get("--finals") ?? "first") as "first" | "both";
const explicitPolicies = get("--policies");
const counterIds = (get("--counters") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/**
 * AIMING STRATEGIES to fly (sim/aim-strategies.ts).
 *
 * Defaults to `naive` alone, which is the pilot every table in
 * `design/balance/winnability-sweep-findings.md` was measured on — a default
 * that changed the pilot would silently re-base every comparison in that
 * document against a run nobody had flown.
 *
 * In `--mode cheapest` this is a DIMENSION of the answer rather than a setting:
 * the cheapest rig that clears is a property of (loadout, refit, draft,
 * strategy), and the tool searched three of those four while holding the fourth
 * at whatever `bots.ts` happened to do. A system that is only worth its price to
 * a player who plays it is exactly the case that fourth axis was hiding.
 */
const strategyNames = (get("--strategies") ?? "naive")
  .split(",").map((s) => s.trim()).filter(Boolean);
const jsonOut = argv.includes("--json");
const trace = argv.includes("--trace");

for (const b of buildNames) {
  if (!(b in PRIORITY_ORDERS)) {
    console.error(`Unknown --build "${b}" — available: ${Object.keys(PRIORITY_ORDERS).join(", ")}`);
    process.exit(1);
  }
}
if (!(botName in BOTS)) {
  console.error(`Unknown --bot "${botName}" — available: ${Object.keys(BOTS).join(", ")}`);
  process.exit(1);
}
for (const id of counterIds) {
  if (!(id in COUNTER_KITS)) {
    console.error(`Unknown --counters id "${id}" — available: ${Object.keys(COUNTER_KITS).join(", ")}`);
    process.exit(1);
  }
}
for (const s of strategyNames) {
  if (!(s in STRATEGIES)) {
    console.error(
      `Unknown --strategies id "${s}" — available: ${Object.keys(STRATEGIES).join(", ")}`,
    );
    process.exit(1);
  }
}
if (strategyNames.some((s) => s !== "naive") && !(botName in ADAPTIVE_BOTS)) {
  // A strategy is two hooks INSIDE the adaptive aim search plus an ability
  // wrapper around it. A fixed-arc preset has no search to hook, so pairing the
  // two would print a strategy's name over a run that never consulted it.
  // Asked of `ADAPTIVE_BOTS` rather than a hand-written list, so a fifth
  // adaptive preset is usable here the day it is added rather than the day
  // somebody remembers this line.
  console.error(
    `--strategies needs an adaptive --bot (${Object.keys(ADAPTIVE_BOTS).join("/")}),`
    + ` got "${botName}"`,
  );
  process.exit(1);
}
if (!["combos", "cheapest", "both", "counter"].includes(mode)) {
  console.error(`Unknown --mode "${mode}" — available: combos, cheapest, both, counter`);
  process.exit(1);
}

const kit: CounterKit | undefined = counterIds.length
  ? combineKits(counterIds.map((id) => COUNTER_KITS[id]))
  : undefined;

/** The pilot: the named bot plus Bond Breaker hands. Wrapped here rather than
 *  added to `BOTS` so `bots.ts` — which another branch is also editing — takes
 *  no diff, and so the wrapping is visible at the place the claim is made. */
const pilot = (seed: number) => bondHands(BOTS[botName](seed));

/**
 * The same pilot, flying a named aiming strategy.
 *
 * `naive` returns the ORIGINAL closure above rather than an equivalent built a
 * different way, and that is not tidiness: every table in the findings doc was
 * flown by that exact expression, so the default path has to be it and not a
 * reconstruction that happens to agree today.
 */
const pilotFor = (spec: AimStrategySpec): ((seed: number) => Bot) =>
  (spec === naiveStrategy || spec.name === "naive")
    ? pilot
    // THE WHOLE PRESET, not one flag of it. Review found this passing only
    // `demolish`, so `--bot patient --strategies cushion` flew plain `aim`
    // under rows labelled `patient` — the congestion rule that IS the preset
    // was dropped on the way through. `ADAPTIVE_BOTS` is the one table both
    // `BOTS` and this read, so a preset cannot mean two things.
    : strategyPilot(spec, { bot: ADAPTIVE_BOTS[botName] });

const strategies: AimStrategySpec[] = strategyNames.map((s) => STRATEGIES[s]);

const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

/* ---------------------------------------------------------------------------
 * MODE 1 — the combo sweep
 * ------------------------------------------------------------------------- */

interface ComboRow {
  mark: number;
  policy: string;
  /** "corner" (exhaustive over axes) or "interior" (sampled). */
  cover: "corner" | "interior";
  /** Which `--build` priority order produced this row (the best of those
   *  named). Printed, because "unwinnable" is a claim about the game only if
   *  the rig it was measured on is named. */
  build: string;
  clears: number;
  runs: number;
  /** Median bays cleared across the seeds. */
  medianBays: number;
  /** The deepest any seed got. Printed beside the median because at a Tier
   *  where nothing clears, "1 and never more" and "1 typically, 7 once" are
   *  completely different findings and a median cannot tell them apart. */
  deepest: number;
  /** Median bay the run DIED in — the wall. RUN_LEVELS when every seed cleared. */
  wall: number;
  /** The stack actually reached by the DEEPEST run of the set.
   *
   *  Deepest rather than first-seed, and the difference matters at a Tier where
   *  the wall is early: a run that died on bay 2 banked ONE draft, so its combo
   *  is two notches and says nothing about the policy that chose them. The run
   *  that got furthest is the one that actually built the combo the row is
   *  named for — at Tier 7 the `max:volatile` row reads `volatile:3` off its
   *  deepest seed and `wind:1` off its first. */
  combo: string;
  /** Where the runs died, counted. */
  deaths: Record<string, number>;
  outcomes: DeepRunOutcome[];
}

/** SPECS, not built policies — see draft-space.ts's POLICY SPECS note. The
 *  driver calls `spec.build(seed)` once per run, so a sampler cannot carry its
 *  stream from one run into the next. */
function policiesFor(mark: number): { spec: DraftPolicySpec; cover: "corner" | "interior" }[] {
  if (explicitPolicies) {
    return explicitPolicies.split(",").map((s) => s.trim()).filter(Boolean).map((name) => {
      if (name === "spread") return { spec: spreadSpec, cover: "interior" as const };
      if (name === "dodge") return { spec: dodgeSpec, cover: "interior" as const };
      if (name.startsWith("max:")) {
        const id = name.slice(4) as HazardId;
        if (!HAZARDS.some((h) => h.id === id)) {
          console.error(`Unknown axis in --policies "${name}"`);
          process.exit(1);
        }
        return { spec: preferSpec(id), cover: "corner" as const };
      }
      if (name.startsWith("random:")) {
        return { spec: randomSpec(parseInt(name.slice(7), 10) || 1), cover: "interior" as const };
      }
      console.error(`Unknown policy "${name}" — use spread, dodge, max:<axis>, random:<n>`);
      return process.exit(1) as never;
    });
  }
  const out: { spec: DraftPolicySpec; cover: "corner" | "interior" }[] = [];
  // EXHAUSTIVE over the corners: one policy per axis the Mark can deal.
  for (const h of hazardsForMark(mark)) out.push({ spec: preferSpec(h.id), cover: "corner" });
  // SAMPLED interior.
  out.push({ spec: spreadSpec, cover: "interior" });
  out.push({ spec: dodgeSpec, cover: "interior" });
  for (let i = 0; i < randomWalks; i++) {
    out.push({ spec: randomSpec(0x51ed + i * 7919), cover: "interior" });
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function sweepCombos(mark: number): ComboRow[] {
  const clauseIdx = finalsMode === "both" ? [0, 1] : [0];
  const rows: ComboRow[] = [];
  for (const { spec, cover } of policiesFor(mark)) {
    // Every named build order, best row wins — see the `--build` note.
    let best: ComboRow | null = null;
    for (const build of buildNames) {
      const loadout = loadoutFor(PRIORITY_ORDERS[build], mark);
      const refit = greedyRefit(PRIORITY_ORDERS[build], true);
      const outcomes: DeepRunOutcome[] = [];
      for (const seed of seeds) {
        for (const ci of clauseIdx) {
          outcomes.push(runDeepRun({
            mark,
            seed,
            bot: pilot,
            loadout,
            // BUILT PER RUN, from this run's own seed. Hoisting this out of the
            // loop is the bug draft-space.ts's POLICY SPECS note records.
            draft: spec.build(seed),
            refit,
            final: (offers) => offers[Math.min(ci, offers.length - 1)].id,
            counters: kit,
          }));
        }
      }
      const row = summarise(mark, spec.name, cover, build, outcomes);
      if (!best || row.clears > best.clears
        || (row.clears === best.clears && row.wall > best.wall)) best = row;
    }
    rows.push(best!);
  }
  return rows;
}

function summarise(
  mark: number, policy: string, cover: "corner" | "interior",
  build: string, outcomes: DeepRunOutcome[],
): ComboRow {
  const deaths: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.cleared) continue;
    const key = `${o.lossReason ?? "?"}@${o.diedAt}`;
    deaths[key] = (deaths[key] ?? 0) + 1;
  }
  return {
    mark,
    policy,
    build,
    cover,
    clears: outcomes.filter((o) => o.cleared).length,
    runs: outcomes.length,
    medianBays: median(outcomes.map((o) => o.baysCleared)),
    deepest: Math.max(...outcomes.map((o) => o.baysCleared)),
    wall: median(outcomes.map((o) => o.diedAt ?? RUN_LEVELS)),
    combo: comboKey(
      outcomes.reduce((a, b) => (b.baysCleared > a.baysCleared ? b : a)).ratchets,
    ),
    deaths,
    outcomes,
  };
}

/* ---------------------------------------------------------------------------
 * MODE 2 — the cheapest winning strategy
 *
 * The levers a player actually holds, in the order the game hands them over:
 *
 *  1. THE LOADOUT — permanent, bought with salvage against the Mark's build
 *     budget (upgrades.ts's `budgetForMark`). Priced in LADDER POINTS, which is
 *     the currency the budget is denominated in.
 *  2. THE REFIT — in-run scrap, spendable only at the three stops, and only on
 *     tracks the loadout already installed (run.ts's `buyUpgrade` refuses a
 *     tier-0 track — which is why a cheap loadout can be a hard CEILING rather
 *     than merely a slow start, and the search says so when it happens).
 *  3. THE DRAFT — free, and the largest lever of the three.
 *
 * The search walks the loadout ladder UPWARD in `TIER_COSTS` steps and reports
 * the first rung that clears, for each of two refit stances (`none` and
 * `greedy`). That is not a full optimisation — the space of loadouts at Mark 10
 * is large — and the ordering it walks is one priority order (`--build`). What
 * it produces is a CEILING on the cheapest strategy: a real optimum is at most
 * this expensive. Stated on the table.
 * ------------------------------------------------------------------------- */

interface CheapRow {
  mark: number;
  budget: number;
  refit: string;
  policy: string;
  /** The AIMING strategy this rung was flown with — the fourth lever, and the
   *  one this search used to hold fixed without saying so. A rung that clears
   *  under `cushion` and not under `naive` is not a cheaper rig; it is the same
   *  rig played differently, and the table has to be able to say which. */
  strategy: string;
  cleared: boolean;
  clears: number;
  runs: number;
  loadoutCost: number;
  scrapSpent: number;
  tiers: string;
}

/** Ladder points to try, ascending — every distinct `tiersCost` a loadout on
 *  this priority order can reach, so the search steps through real rigs rather
 *  than through arbitrary numbers. */
function budgetLadder(order: UpgradeId[], mark: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let b = 0; b <= budgetForMark(mark); b += 5) {
    const cost = tiersCost(loadoutFor(order, mark, b));
    if (seen.has(cost)) continue;
    seen.add(cost);
    out.push(cost);
  }
  return out.sort((a, b) => a - b);
}

function showTiers(tiers: Record<string, number>): string {
  return Object.entries(tiers).filter(([, t]) => t > 0)
    .map(([id, t]) => `${id.slice(0, 3)}${t}`).join(" ") || "stock";
}

function cheapest(mark: number): CheapRow[] {
  const order = PRIORITY_ORDERS[buildName];
  const rows: CheapRow[] = [];
  // The DRAFT policy the search is run under. `dodge` is the honest default: it
  // is the strategy a player with no material answer plays, so a clear under it
  // is a clear that did not depend on the draft being kind.
  const spec = explicitPolicies ? policiesFor(mark)[0].spec : dodgeSpec;
  // Every (refit stance x aiming strategy) pair is searched, and the SEEDS are
  // shared across all of them — so two strategies' rungs are a paired
  // comparison rather than two independent searches that happen to be printed
  // together. With the default `--strategies naive` this is exactly the loop
  // that was here before.
  for (const strat of strategies) {
  const flier = pilotFor(strat);
  for (const refit of [noRefit, greedyRefit(order, true)]) {
    let found = false;
    for (const budget of budgetLadder(order, mark)) {
      const loadout = loadoutFor(order, mark, budget);
      const outcomes = seeds.map((seed) => runDeepRun({
        mark, seed, bot: flier, loadout, draft: spec.build(seed), refit, counters: kit,
      }));
      const clears = outcomes.filter((o) => o.cleared).length;
      const row: CheapRow = {
        mark,
        budget,
        refit: refit.name,
        policy: spec.name,
        strategy: strat.name,
        // "Winnable" here is the same word the combo table uses: at least one
        // seed went the distance. Deliberately not a majority — the search is
        // looking for the rung where clearing becomes POSSIBLE, and a rung
        // where it becomes RELIABLE is a different (and much dearer) answer.
        cleared: clears >= CHEAPEST_CLEARS_REQUIRED,
        clears,
        runs: outcomes.length,
        loadoutCost: tiersCost(loadout),
        scrapSpent: Math.round(outcomes.reduce((a, o) => a + o.scrapSpent, 0) / outcomes.length),
        tiers: showTiers(loadout),
      };
      rows.push(row);
      if (row.cleared) { found = true; break; }
    }
    if (!found) {
      rows.push({
        mark, budget: -1, refit: refit.name, policy: spec.name, strategy: strat.name,
        cleared: false,
        clears: 0, runs: seeds.length, loadoutCost: -1, scrapSpent: 0, tiers: "NONE FOUND",
      });
    }
  }
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * MODE 3 — price ONE counter against ONE bay
 *
 * The combo sweep cannot price a counter, and finding that out was the point of
 * running it. A counter changes the physics, the physics changes where every
 * subsequent shipment lands, and ten bays of that is a different run — so the
 * wall moves by more than the counter is worth and the measurement is swamped
 * by its own leverage. Measured at Tier 7 on `max:volatile` over 6 seeds, the
 * three cushion tiers came back IDENTICAL to each other and 2 bays apart from
 * the baseline, in the wrong direction: run-level noise, not an effect.
 *
 * This mode is the paired comparison that has the resolution instead. ONE bay,
 * ONE explicit ratchet stack, the same seeds with and without the kit — the
 * same shape `pile.ts` uses for the congestion tax ("every variant runs against
 * an `off` baseline on the same seeds, so each row is a paired comparison
 * rather than an absolute number") and the same recipe `ratchet-model.ts`
 * prescribes for pricing a material ("ratchet it explicitly and fly `aim`
 * against `demo`").
 *
 *   npm run sim:winnability -- --mode counter --marks 7 --bay 10 \
 *     --ratchets volatile:3 --counters cushion1,cushion2,cushion3 --seeds 10
 * ------------------------------------------------------------------------- */

/** Parse `--ratchets slag:2,cryo:1` into a stack. Explicit rather than drafted:
 *  this mode is asking what a KNOWN combo costs, so the combo is an input. */
function parseRatchets(spec: string): Ratchets {
  const out: Ratchets = {};
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, n] = part.split(":");
    if (!HAZARDS.some((h) => h.id === id)) {
      console.error(`Unknown axis "${id}" in --ratchets`);
      process.exit(1);
    }
    out[id as HazardId] = Math.max(1, parseInt(n ?? "1", 10) || 1);
  }
  return out;
}

function priceCounters(mark: number): void {
  const bay = Math.max(1, Math.min(RUN_LEVELS, parseInt(get("--bay") ?? String(RUN_LEVELS), 10)));
  const stack = parseRatchets(get("--ratchets") ?? "");
  const loadout = loadoutFor(PRIORITY_ORDERS[buildName], mark);
  // Each `--counters` id priced SEPARATELY here, where the combo sweep folds
  // them into one kit: the question is what each tier buys, and a folded kit
  // answers a different one.
  const variants: (CounterKit | null)[] = [null, ...counterIds.map((id) => COUNTER_KITS[id])];
  console.log(
    `  counter pricing — Tier ${mark} bay ${bay} · ratchets ${comboKey(stack)}`
    + ` · rig ${showTiers(loadout)} · ${seedCount} paired seeds`,
  );
  console.log(
    "  " + [padE("counter", 14), pad("cost", 5), pad("win", 6), pad("lines", 6),
      pad("shots", 6), pad("end$", 7), pad("saved$", 7), padE("losses", 24)].join(" "),
  );
  for (const v of variants) {
    let wins = 0;
    let lines = 0;
    let shots = 0;
    let end = 0;
    // What the INCINERATOR took off this row's loss bills (runner.ts's
    // incineratedFunds). The one column here that measures a SYSTEM rather than
    // an outcome, and it is here because the hood is the only track on the shelf
    // whose whole effect is the ABSENCE of a charge — in every other column that
    // is indistinguishable from never having been charged. A row with wins and a
    // zero here is a row the hood did not touch, which is a finding rather than
    // a null result.
    let saved = 0;
    const losses: Record<string, number> = {};
    for (const seed of seeds) {
      // The same layering `run.ts`'s levelForRun uses: base ladder, then the
      // ship, then the conditions it is flown in, then the hypothetical.
      const cfg = makeBaseLevel(bay - 1, mark);
      applyUpgrades(cfg, loadout);
      const flown = applyRatchets(cfg, stack);
      // The carry a bay this deep would realistically open on. Flat, and it is
      // the one approximation this mode makes — a single bay has no previous
      // bay to have banked it.
      if (bay > 1) flown.startingFunds += CARRY_CAP;
      v?.level?.(flown);
      const base = bondHands(BOTS[botName](seed));
      const out = runBay(flown, v?.hands ? v.hands(base) : base, seed);
      if (out.status === "won") wins += 1;
      else losses[out.lossReason ?? "cap"] = (losses[out.lossReason ?? "cap"] ?? 0) + 1;
      lines += out.lines;
      shots += out.shots;
      end += out.endScore;
      saved += out.incineratedFunds;
    }
    const n = seeds.length;
    console.log("  " + [
      padE(v?.id ?? "none", 14), pad(String(v?.cost ?? 0), 5),
      pad(`${wins}/${n}`, 6), pad((lines / n).toFixed(1), 6),
      pad((shots / n).toFixed(1), 6), pad(`$${Math.round(end / n)}`, 7),
      pad(`$${Math.round(saved / n)}`, 7),
      padE(Object.entries(losses).map(([k, c]) => `${k}x${c}`).join(" "), 24),
    ].join(" "));
  }
  console.log("");
}

/* ---------------------------------------------------------------------------
 * OUTPUT
 * ------------------------------------------------------------------------- */

const pad = (s: string, n: number): string => s.padStart(n);
const padE = (s: string, n: number): string => s.padEnd(n);

console.log(
  `Winnability sweep — marks ${marks.join("/")} · ${seedCount} seeds`
  + ` · bot ${botName}+bond · builds ${buildNames.join("/")} · finals ${finalsMode}`
  + ` · aim ${strategyNames.join("/")}`
  + (kit ? ` · counters ${kit.id}` : ""),
);
console.log(
  `Verdicts read the WALL (median bay a run died in), not the clear rate — at these`
  + ` sample sizes a clear rate cannot tell a correctly-tuned Tier from an impossible one.`,
);
console.log(
  `  winnable: a seed took all ${RUN_LEVELS} bays · marginal: wall >= bay ${MARGINAL_WALL}`
  + ` · unwinnable: wall < bay ${MARGINAL_WALL}.`,
);
console.log(
  "Pessimism ledger: the pilot fires demolition AND Bond Breakers, and still has no"
  + " lookahead, no pile reading and a fixed landing target. A human clears bays it loses.\n",
);

const report: Record<string, unknown> = { marks: [], mode, seeds: seedCount };

for (const mark of marks) {
  // COVERAGE, printed before anything is played.
  const spaces = seeds.map((s) => enumerateSpace(s, mark));
  const paths = spaces[0].paths;
  const vectors = spaces[0].vectors.size;
  const axes = hazardsForMark(mark);
  const played = policiesFor(mark);
  console.log(
    `=== TIER ${mark} ===  budget ${budgetForMark(mark)} pts · ${picksPerBay(mark)} pick/bay`
    + ` · ${axes.length} axes · rigs `
    + buildNames.map((b) => {
      const l = loadoutFor(PRIORITY_ORDERS[b], mark);
      return `${b} ${showTiers(l)} (${tiersCost(l)})`;
    }).join(" | "),
  );
  console.log(
    `  space: ${RUN_LEVELS - 2} ratchet drafts · ${paths} reachable paths`
    + ` · ${vectors} distinct terminal combos (seed ${spaces[0].seed}, ENUMERATED EXHAUSTIVELY)`,
  );
  const corners = played.filter((p) => p.cover === "corner").length;
  if (mode === "combos" || mode === "both") console.log(
    // "EXHAUSTIVE" is only claimed when the corner set is actually complete —
    // an explicit --policies list is a hand-picked sample, and a banner that
    // called it exhaustive would be the one lie this tool must not tell.
    `  played: ${corners} corner policies`
    + (corners >= axes.length
      ? ` (EXHAUSTIVE over the ${axes.length} axes)`
      : ` of the ${axes.length} axes (SAMPLED — explicit --policies)`)
    + ` + ${played.filter((p) => p.cover === "interior").length} interior policies (SAMPLED)`
    + ` x ${seedCount} seeds x ${buildNames.length} build(s)`
    + ` = ${played.length * seedCount * buildNames.length * (finalsMode === "both" ? 2 : 1)} runs\n`,
  );

  const markReport: Record<string, unknown> = {
    mark, paths, vectors, axes: axes.map((a) => a.id),
    builds: Object.fromEntries(buildNames.map((b) => [b, loadoutFor(PRIORITY_ORDERS[b], mark)])),
  };

  if (mode === "combos" || mode === "both") {
    const rows = sweepCombos(mark);
    console.log(
      [padE("policy", 16), padE("cover", 9), padE("build", 9), pad("clear", 6), pad("wall", 5),
        pad("best", 5), padE("verdict", 11), padE("died", 22), "combo reached"].join(" "),
    );
    for (const r of [...rows].sort(
      (a, b) => (a.clears / a.runs - b.clears / b.runs) || (a.wall - b.wall),
    )) {
      const died = Object.entries(r.deaths)
        .sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([k, n]) => `${k}x${n}`).join(" ");
      console.log([
        padE(r.policy, 16), padE(r.cover, 9), padE(r.build, 9), pad(`${r.clears}/${r.runs}`, 6),
        pad(String(r.wall), 5), pad(String(r.deepest), 5),
        padE(classify(r.clears, r.wall), 11), padE(died, 22), r.combo,
      ].join(" "));
      if (trace) {
        // The bay-by-bay ledger for the FIRST seed. What a policy's row cannot
        // show is WHERE the pressure landed — a run that died broke on bay 6
        // may have been losing money since bay 3 — and that is the reading the
        // findings doc is written from.
        const o = r.outcomes[0];
        for (const b of o.bays) {
          console.log(
            `      bay ${pad(String(b.bay), 2)}  $${pad(String(b.target), 5)}/${pad(String(b.timeLimitSec), 3)}s`
            + ` @$${pad(String(b.launchCost), 3)}  ${padE(b.outcome.status, 4)}`
            + ` ${padE(b.outcome.lossReason ?? "", 7)} lines ${pad(String(b.outcome.lines), 2)}`
            + ` shots ${pad(String(b.outcome.shots), 3)} end $${pad(String(Math.round(b.outcome.endScore)), 5)}`
            + `  +[${b.picks.join(",")}]${b.refitSpend ? ` refit ${b.refitSpend}` : ""}`,
          );
        }
      }
    }
    console.log("");
    markReport.combos = rows.map((r) => ({
      policy: r.policy, cover: r.cover, build: r.build, clears: r.clears, runs: r.runs,
      medianBays: r.medianBays, deepest: r.deepest, wall: r.wall,
      verdict: classify(r.clears, r.wall),
      combo: r.combo, deaths: r.deaths,
      perSeed: r.outcomes.map((o) => ({
        seed: o.seed, cleared: o.cleared, diedAt: o.diedAt, lossReason: o.lossReason,
        combo: comboKey(o.ratchets), final: o.final, lines: o.linesTotal,
        scrapEarned: o.scrapEarned, scrapSpent: o.scrapSpent,
      })),
    }));
  }

  if (mode === "counter") priceCounters(mark);

  if (mode === "cheapest" || mode === "both") {
    const rows = cheapest(mark);
    console.log(
      `  cheapest strategy that clears — a CEILING, not an optimum: one priority order`
      + ` (${buildName}), one draft policy (${rows[0]?.policy ?? "-"}), ${seedCount} seeds,`
      + ` and a clear means ${CHEAPEST_CLEARS_REQUIRED} seed went the distance.`,
    );
    console.log(
      `  A strategy is a DIMENSION of the answer, not a setting: ${strategies.length} flown`
      + ` (${strategyNames.join("/")}), paired on the same seeds.`,
    );
    console.log(
      "  " + [padE("refit", 14), padE("aim", 9), pad("pts", 5), pad("scrap", 6), pad("clear", 6),
        padE("verdict", 11), "rig"].join(" "),
    );
    // Only the terminal row of each (refit, strategy) pair is the ANSWER; the
    // rungs below it are the evidence, and are printed as such by the JSON
    // rather than here.
    const byArm = new Map<string, CheapRow>();
    for (const r of rows) byArm.set(`${r.refit}|${r.strategy}`, r);
    for (const r of byArm.values()) {
      console.log("  " + [
        padE(r.refit, 14), padE(r.strategy, 9),
        pad(r.loadoutCost < 0 ? "-" : String(r.loadoutCost), 5),
        pad(String(r.scrapSpent), 6), pad(`${r.clears}/${r.runs}`, 6),
        padE(r.cleared ? "CLEARS" : "no clear", 11), r.tiers,
      ].join(" "));
    }
    // THE HEADLINE, once the search has a fourth axis: the cheapest rig across
    // every arm, and which arm found it. Printed rather than left to the reader,
    // because "the cheapest winning strategy at Tier N" is now a triple and a
    // table of four rows is an invitation to quote whichever one is smallest.
    const winners = [...byArm.values()].filter((r) => r.cleared);
    if (winners.length) {
      const best = winners.reduce((a, b) => (b.loadoutCost < a.loadoutCost ? b : a));
      console.log(
        `  => cheapest clear: ${best.loadoutCost} pts, refit ${best.refit},`
        + ` aim ${best.strategy} — ${best.tiers}`,
      );
    } else {
      console.log("  => no arm cleared at any rung of the ladder.");
    }
    console.log("");
    markReport.cheapest = rows;
  }

  (report.marks as unknown[]).push(markReport);
}

if (jsonOut) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(import.meta.dirname ?? ".", "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `winnability-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`wrote ${file}`);
}
