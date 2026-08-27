/**
 * THE DEEP RUN, END TO END — ten bays, one RunState, no model.
 *
 * Every other sweep in this directory plays ONE bay. That is the right unit for
 * pricing a notch or a Mark's opening terms, and it is the wrong unit for the
 * question this file exists for, because a Deep Run is not ten independent
 * bays: the carry links them (`run.ts`'s `advanceRun`, capped at `CARRY_CAP`),
 * the scrap links them (earned per bay, spendable only at the three refit
 * stops), the Bond magazine links them (a consumable that never refills), and
 * the ratchet links them hardest of all — a notch taken after bay 2 is a notch
 * bay 10 is still carrying.
 *
 * So `sweep.ts` and `marks.ts` both have to APPROXIMATE those couplings:
 * `--carry 100` is a flat stand-in for a surplus nobody computed, and
 * `marks.ts`'s `tiersForBay` hands the rig a scrap schedule from the design's
 * own sizing estimate rather than from bays it played. Both notes say so.
 * This driver removes the approximations by simply not needing them — it calls
 * `newRun`, `levelForRun`, `advanceRun`, `buyUpgrades` and `hazardOffers`, the
 * same functions `main.ts` calls, in the same order, and the couplings happen
 * because they are the real ones.
 *
 * WHAT IT STILL CANNOT SEE is what every harness here cannot: the bots. Their
 * biases are documented in `sim/README.md` and every one of them is
 * PESSIMISTIC — no lookahead, a fixed landing target, no reading of the pile.
 * Two of the three that mattered most are now closable at the call site
 * (`bots.ts`'s `demo` fires demolition, `counters.ts`'s `bondHands` fires Bond
 * Breakers), which is why `winnability.ts` defaults to a bot holding both: a
 * run this driver calls unwinnable should be one where every existing answer
 * was in the pilot's hands.
 */
import {
  MAX_TIER, TIER_COSTS, tiersCost, type RefitOrder, type UpgradeTiers,
} from "../src/game/upgrades";
import { finalsForTier, type FinalDef, type FinalId } from "../src/game/finals";
import { type HazardId, type Ratchets } from "../src/game/hazards";
import {
  advanceRun, buyUpgrades, finalDraftFor, levelForRun, newRun, picksForRun,
  refitAfterBay, RUN_LEVELS, type RunState,
} from "../src/game/run";
import type { LevelConfig } from "../src/game/level";
import type { SkydeckRules } from "../src/game/skydeck";
import type { Bot } from "./bots";
import type { CounterKit } from "./counters";
import { rungFor, type DraftPolicy } from "./draft-space";
import { runBay, type BayOutcome } from "./runner";

/* ---------------------------------------------------------------------------
 * POLICIES — the two player decisions that are not the draft.
 * ------------------------------------------------------------------------- */

/**
 * What the yard is asked to install at a refit stop.
 *
 * Stated as a policy rather than a fixed order because it is a real lever and
 * the cheapest-strategy search spends it: scrap is the one currency a run earns
 * and can decline to spend, so "how much of it did the clear actually need" is
 * a question with an answer.
 */
export interface RefitPolicy {
  name: string;
  /** Returns a `RefitOrder` for the run as it stands at the stop. Must be
   *  affordable and legal — `run.ts`'s `buyUpgrades` refuses the whole order
   *  otherwise, and the driver treats a refusal as "bought nothing" rather than
   *  silently part-filling, exactly as the yard does. */
  order(run: RunState): RefitOrder;
}

/** Buy nothing, ever. The floor of the cheapest-strategy ladder, and the
 *  control every "the refit did it" claim needs. */
export const noRefit: RefitPolicy = { name: "none", order: () => ({}) };

/**
 * Spend everything, in a fixed priority order, one rung at a time until the
 * scrap runs out.
 *
 * `breadthFirst` re-reads the whole order after each rung (spreading tiers
 * across tracks); otherwise it maxes the first affordable track before touching
 * the second. The same two shapes `marks.ts`'s `spendScrap` models — modelled
 * there, actually spent here.
 */
export function greedyRefit(order: (keyof UpgradeTiers)[], breadthFirst: boolean): RefitPolicy {
  return {
    name: `greedy:${breadthFirst ? "wide" : "deep"}`,
    order(run) {
      const want: RefitOrder = {};
      // Simulated purse: `buyUpgrades` prices the WHOLE order against the run's
      // scrap in one pass, so the order has to be assembled against a running
      // total or it would be refused wholesale at the commit.
      let purse = run.scrap;
      const tierNow = (id: keyof UpgradeTiers): number =>
        Math.min(MAX_TIER, (run.tiers[id] ?? 0) + (want[id] ?? 0));
      // The shared ladder, read from `upgrades.ts` rather than restated: this
      // has to agree with what `buyUpgrades` will actually deduct, or the order
      // is refused wholesale at the commit and the stop silently buys nothing.
      const cost = (from: number): number | null =>
        from >= MAX_TIER ? null : TIER_COSTS[from];
      let bought = true;
      while (bought) {
        bought = false;
        for (const id of order) {
          // A refit RAISES; it never installs (run.ts's `buyUpgrade` refuses a
          // tier-0 track). Skipping here rather than letting the commit refuse
          // keeps the order legal by construction.
          if ((run.tiers[id] ?? 0) < 1) continue;
          const c = cost(tierNow(id));
          if (c === null || c > purse) continue;
          want[id] = (want[id] ?? 0) + 1;
          purse -= c;
          bought = true;
          if (!breadthFirst) break;
        }
      }
      return want;
    },
  };
}

/** How the run answers the Final Inspection. Defaults to the FIRST clause of
 *  the tier's pair, which is not a judgement — `finals.ts` states outright that
 *  each pair's two clauses "cost ~the same in extra-lines-to-sell but land on
 *  different halves of the build", so a driver that had to guess would be
 *  inventing a preference the design deliberately refuses to state. The CLI can
 *  sweep both. */
export type FinalPolicy = (offers: FinalDef[], run: RunState) => FinalId;
export const firstClause: FinalPolicy = (offers) => offers[0].id;

/* ---------------------------------------------------------------------------
 * THE RUN
 * ------------------------------------------------------------------------- */

export interface DeepRunOpts {
  mark: number;
  seed: number;
  /** Bot FACTORY, rebuilt per bay — a fresh jitter stream per bay, seeded from
   *  the run seed and the bay index, so the whole run is reproducible and two
   *  bays do not share a sequence of misses. */
  bot(seed: number): Bot;
  loadout: UpgradeTiers;
  draft: DraftPolicy;
  refit?: RefitPolicy;
  final?: FinalPolicy;
  /** Hypothetical systems (`counters.ts`). Applied on top of `levelForRun` and
   *  around the bot — see the module header there for why the two halves are
   *  kept apart. */
  counters?: CounterKit;
  /** Scrap the run OPENS with. `meta.ts`'s Scrap Cache unlock is the in-game
   *  version; the search uses it as a lever with a price. */
  startingScrap?: number;
  /**
   * Fly the day's run instead of a ladder run — `skydeck.ts`'s rules, hung on
   * the `RunState` exactly as `skydeckRunFor` hangs them.
   *
   * ONE FIELD, and the driver needs no other branch, which is the whole reason
   * it can be added here at all: every difference the mode makes is already
   * asked of the RUN by the functions this loop calls (`levelForRun` builds the
   * roof's bays, `picksForRun` charges one notch, `finalDraftFor` refuses the
   * drafted inspection, `refitAfterBay` opens the stops). A harness that had to
   * re-state any of them would be measuring its own copy of the mode.
   */
  skydeck?: SkydeckRules;
}

export interface DeepBayRecord {
  /** 1-based. */
  bay: number;
  outcome: BayOutcome;
  /** The stack the bay was PLAYED with, before that bay's own draft. */
  ratchets: Ratchets;
  /** What the config actually asked for, after ship + ratchets + clause. */
  target: number;
  timeLimitSec: number;
  launchCost: number;
  /** The surplus this bay OPENED on (`RunState.carry`). Recorded because it is
   *  the coupling a per-bay sweep has to invent — `sweep.ts` passes a flat
   *  `--carry 100` and says so — and a driver that computes it for real should
   *  be able to prove it did. */
  carryIn: number;
  /** Unspent scrap the run held entering this bay. */
  scrapIn: number;
  /** What this bay PAID OUT in scrap: what the bay itself earned, plus the
   *  per-bay clear bonus if it was cleared.
   *
   *  Recorded because the LAST bay a run plays never reaches `advanceRun` —
   *  the run either won at bay 10 or died — so its payout has to be added at
   *  the reporting site instead. `main.ts` does exactly this and says so where
   *  it banks a lost bay's telemetry: the bay "has not been through advanceRun
   *  — and on a loss never will be — so it has to be added here". */
  scrapPaid: number;
  /** Picks taken at the draft that FOLLOWED this bay ([] on bay 10 and on the
   *  Final Inspection rung). */
  picks: HazardId[];
  /** Scrap spent at the refit stop that followed this bay, if any. */
  refitSpend: number;
}

export interface DeepRunOutcome {
  mark: number;
  seed: number;
  bot: string;
  /** Bays actually cleared, 0..RUN_LEVELS. */
  baysCleared: number;
  cleared: boolean;
  /** 1-based bay the run died in, or null on a clear. */
  diedAt: number | null;
  lossReason: string | null;
  /** The stack the run ENDED carrying. */
  ratchets: Ratchets;
  final: FinalId | null;
  linesTotal: number;
  scrapEarned: number;
  scrapSpent: number;
  /** Ladder points sunk into the Workshop loadout (upgrades.ts's `tiersCost`
   *  of the starting rig) — the out-of-run half of what the strategy cost. */
  loadoutCost: number;
  tiersEnd: UpgradeTiers;
  bays: DeepBayRecord[];
}

/**
 * Fly one Deep Run.
 *
 * The loop mirrors `main.ts` exactly, including the one ordering that is easy
 * to get wrong: the draft is built from the JUST-CLEARED bay's index, before
 * `advanceRun` steps it (`main.ts`'s bay-clear branch), and the picks are then
 * folded in by `advanceRun` itself. Building the offer after the step would
 * deal bay N+1's hand at bay N, which is a whole rung of the ladder's shape.
 */
export function runDeepRun(opts: DeepRunOpts): DeepRunOutcome {
  const refit = opts.refit ?? noRefit;
  const pickFinal = opts.final ?? firstClause;
  let run: RunState = newRun(
    opts.seed, [], opts.startingScrap ?? 0, opts.loadout, opts.mark,
  );
  // The mode, hung on the run the way `skydeckRunFor` hangs it — after
  // construction, never as a sixth argument to `newRun`. The seed stays the
  // CALLER's so a paired comparison can fly the same hazard hands under both
  // economies; a real Skydeck run takes its seed from the day, which is a
  // property of the mode's door rather than of its rules.
  if (opts.skydeck) run = { ...run, skydeck: opts.skydeck };
  const loadoutCost = tiersCost(opts.loadout);
  const bays: DeepBayRecord[] = [];
  let scrapSpent = 0;
  let botName = "";

  for (let i = 0; i < RUN_LEVELS; i++) {
    const cfg: LevelConfig = levelForRun(run);
    opts.counters?.level?.(cfg);
    // The bay's own jitter stream. `* 101` rather than `+ i` so two runs one
    // seed apart do not share nine of their ten bays' bot streams.
    const baseBot = opts.bot(opts.seed * 101 + i);
    const bot = opts.counters?.hands ? opts.counters.hands(baseBot) : baseBot;
    botName = bot.name;
    // `Game`'s own seed is the RUN seed at every bay, exactly as `main.ts`
    // passes it: the constructor already mixes in `level.id`, so consecutive
    // bays roll different weather without the caller varying anything.
    const outcome = runBay(cfg, bot, opts.seed);

    const rec: DeepBayRecord = {
      bay: i + 1,
      outcome,
      ratchets: { ...run.ratchets },
      target: cfg.targetScore,
      timeLimitSec: cfg.timeLimitSec,
      launchCost: cfg.launchCost,
      carryIn: run.carry,
      scrapIn: run.scrap,
      // Set below, once the bay's status is known: the clear bonus is only
      // paid by a bay that cleared.
      scrapPaid: 0,
      picks: [],
      refitSpend: 0,
    };
    bays.push(rec);
    rec.scrapPaid = outcome.scrapEarned
      + (outcome.status === "won" ? cfg.scrapPerBay : 0);

    if (outcome.status !== "won") {
      return finish(run, bays, false, i + 1, outcome.lossReason, opts, botName, loadoutCost, scrapSpent);
    }
    if (i === RUN_LEVELS - 1) {
      return finish(run, bays, true, null, null, opts, botName, loadoutCost, scrapSpent);
    }

    // --- the draft dealt after clearing bay i -----------------------------
    //
    // Asked of the RUN, not of the bay index — `run.ts`'s run-aware readings
    // (finalDraftFor / picksForRun / refitAfterBay) rather than their ladder
    // twins (isFinalDraft / picksPerBay / isRefitBay). For a ladder run the two
    // agree exactly; for a Skydeck run they do not, and #124's note on those
    // functions names each difference as "a place where a caller that forgot to
    // ask would silently fly the wrong mode". A harness that asked the ladder
    // would be one of those callers the day it was pointed at a daily.
    let picks: HazardId[] = [];
    let chosenFinal: FinalId | null = null;
    if (finalDraftFor(run)) {
      chosenFinal = pickFinal(finalsForTier(run.mark), run);
    } else {
      // finalDraftFor is passed through as well as consulted above: on the
      // Skydeck the branch is not taken AND the rung at RUN_LEVELS - 2 is a
      // real one, which the ladder's own predicate inside rungFor would refuse.
      const rung = rungFor(
        run.seed, run.mark, i, run.ratchets, picksForRun(run), finalDraftFor(run),
      );
      // `rungFor` returns null only past the last ratchet draft, which
      // `isFinalDraft` has already claimed — so a null here is a ladder that
      // moved under this driver, and a silent empty pick would hide it.
      if (!rung) throw new Error(`no draft rung at levelIndex ${i} (mark ${run.mark})`);
      picks = opts.draft.choose(rung, run.ratchets);
      const legal = rung.hands.some(
        (h) => h.length === picks.length && [...h].sort().join() === [...picks].sort().join(),
      );
      if (!legal) {
        throw new Error(
          `draft policy ${opts.draft.name} returned an illegal hand `
          + `[${picks.join(",")}] at bay ${i + 1} (mark ${run.mark})`,
        );
      }
    }
    rec.picks = picks;

    run = advanceRun(
      run,
      outcome.endScore,
      outcome.target,
      outcome.lines,
      outcome.scrapEarned + cfg.scrapPerBay,
      picks,
      outcome.bondsLeft,
      outcome.salvagedFunds,
      outcome.volatileLosses,
    );
    if (chosenFinal) run = { ...run, final: chosenFinal };

    // --- the refit stop, if this clear opened one -------------------------
    if (refitAfterBay(run, i)) {
      const order = refit.order(run);
      const before = run.scrap;
      const next = buyUpgrades(run, order, MAX_TIER);
      // A refused order buys nothing, which is what the yard does too — an
      // all-or-nothing commit, never a part-fill (run.ts's `buyUpgrades`).
      if (next) {
        rec.refitSpend = before - next.scrap;
        scrapSpent += rec.refitSpend;
        run = next;
      }
    }
  }
  // Unreachable: the bay-10 branch above returns. Kept so the function has one
  // shape rather than an implicit undefined on a ladder length change.
  return finish(run, bays, true, null, null, opts, botName, loadoutCost, scrapSpent);
}

function finish(
  run: RunState,
  bays: DeepBayRecord[],
  cleared: boolean,
  diedAt: number | null,
  lossReason: string | null,
  opts: DeepRunOpts,
  bot: string,
  loadoutCost: number,
  scrapSpent: number,
): DeepRunOutcome {
  return {
    mark: opts.mark,
    seed: opts.seed,
    bot,
    baysCleared: cleared ? RUN_LEVELS : bays.length - 1,
    cleared,
    diedAt,
    lossReason,
    ratchets: { ...run.ratchets },
    final: run.final,
    linesTotal: bays.reduce((a, b) => a + b.outcome.lines, 0),
    // `run.scrapEarned` holds every bay that went through `advanceRun` — which
    // is every bay EXCEPT the last one played, because the run ends on it. A
    // bay-10 win returns before the advance the nine clears before it made, so
    // reading the run's own total here under-reported every successful run by
    // exactly the final bay's payout; a loss had the same hole. Adding the last
    // bay's recorded payout closes both with one line, and it is the same thing
    // `main.ts` does at its own reporting sites for the same reason.
    scrapEarned: run.scrapEarned + (bays.length ? bays[bays.length - 1].scrapPaid : 0),
    scrapSpent,
    loadoutCost,
    tiersEnd: { ...run.tiers },
    bays,
  };
}

