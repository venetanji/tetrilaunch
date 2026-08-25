import type { LevelConfig } from "./level";
import { makeBaseLevel } from "./level";
import { applyRatchets, type Ratchets, type HazardId } from "./hazards";
import { applyFinal, type FinalId } from "./finals";
import {
  applyUpgrades, newTiers, nextTierCost, orderRungs, UPGRADES,
  type RefitOrder, type UpgradeTiers,
} from "./upgrades";

/** Total levels in a roguelite run (see makeBaseLevel's 0..9 ladder). */
export const RUN_LEVELS = 10;

/** Refit stops land after every REFIT_EVERY-th bay — bays 3, 6 and 9 at the
 *  default of 3. Not after bay 10: the run ends there, so a refit would buy
 *  nothing. See isRefitBay. */
export const REFIT_EVERY = 3;

/**
 * Persistent state for one roguelite run — everything that carries across
 * levels. The current level's actual LevelConfig is always derived (see
 * levelForRun), never stored, so it can't drift out of sync with ratchets/tiers.
 */
export interface RunState {
  seed: number;
  /** 0..RUN_LEVELS-1; the level currently playing (or about to start). */
  levelIndex: number;
  /** Carried surplus — the overshoot banked above the just-cleared bay's
   *  target, CAPPED at CARRY_CAP (see advanceRun), NOT the full ending score.
   *  Each bay is its own economy (see level.ts's economy balance note): level 1
   *  starts from the base level's startingFunds with carry at 0; every later
   *  level starts from its own base startingFunds plus whatever surplus
   *  carried over. */
  carry: number;
  /** How far each difficulty axis has been ratcheted this run (hazards.ts).
   *  This replaced `modIds`: the between-bay draft no longer deals modifier
   *  cards, it asks which axis hardens next, and the answer sticks for the rest
   *  of the run. A count rather than a list because the same axis can be taken
   *  again — three notches on the clock is a legitimate (and grim) build. */
  ratchets: Ratchets;
  /** Cumulative cleared lines across all completed levels. */
  linesTotal: number;
  /** UNSPENT scrap — the in-run upgrade currency (level.ts's SCRAP_PER_LINE /
   *  SCRAP_PER_BAY earn it, refit stops spend it). Distinct from `carry`:
   *  carry is operating cash that funds the next bay's launches, scrap is
   *  capital that can ONLY become ship upgrades. Dies with the run. */
  scrap: number;
  /** Total scrap earned this run, spent or not — a stat for the end screen, so
   *  a run that banked and never refitted still reads as having earned it. */
  scrapEarned: number;
  /** Funds demolition charges refunded across the run (Game.salvagedFunds per
   *  bay, summed here). Purely a READOUT: the money already landed in the bay's
   *  score the moment the charge blew, so this must never feed `carry` or the
   *  player would be paid for the same blast twice. It exists because
   *  detonate()'s refund is the entire reason a bomb has a price worth
   *  reasoning about, and a total nobody ever prints is a trade the player
   *  never gets to settle. */
  salvagedFunds: number;
  /** Bond Breaker charges left in the run's magazine — the rare CONSUMABLE.
   *
   *  It lives here, beside carry and scrap, because it is exactly that kind of
   *  thing: a resource the run spends down and never gets back. It used to be
   *  derived per bay (upgrades.ts wrote `cfg.bondBreakerCharges += tier` onto a
   *  fresh base every level), which quietly refilled the magazine at every bay
   *  boundary — and a free "flatten the whole field" every level is what let one
   *  fat carry-over clear two bays back to back.
   *
   *  Seeded once in newRun from the loadout's Bond Emitter tier, topped up when
   *  that tier is refitted mid-run (see buyUpgrade), and decremented by
   *  advanceRun from what the just-played bay actually had left. */
  bondCharges: number;
  /** Ship upgrade tier per system (see upgrades.ts). Seeded at run start from
   *  the player's permanent LOADOUT (meta.ts's safeLoadout, bought against the
   *  Mark's build budget), then raised further by in-run scrap at refit stops.
   *  All 0 only for a stock rig at Mark 1. */
  tiers: UpgradeTiers;
  /** Meta-progression unlock ids owned by the PLAYER (not the run) — copied in
   *  at run start so draftOffers and levelForRun can gate content without
   *  reaching into localStorage mid-run, and so a Workshop purchase made after
   *  a run began can't retroactively change that run's draft pool. */
  unlocks: string[];
  /** The Mark this run is being flown at (1-based). Fixed at run start: it
   *  scales every bay's difficulty (see level.ts's makeBaseLevel) and it is
   *  what the run's leaderboard entry is filed under, so a run can't change
   *  which board it's competing on halfway through. */
  mark: number;
  /** Flown from Tier S (lib/devmode.ts), not from the ladder.
   *
   *  Set at construction and never changed, exactly like `mark` above and for
   *  the same reason: it decides which board the run is competing on, and a
   *  run that could switch boards halfway through is a run whose score means
   *  nothing. It is also what makes the mode safe to ship — main.ts's
   *  finishRun reads it and skips recordRunEnd entirely, so no sandbox run
   *  banks salvage or ticks a tier however it was configured.
   *
   *  A Contract is not covered by this and does not need to be: contracts.ts
   *  strips the run economy outright, and main.ts clears `run` before starting
   *  one. */
  sandbox: boolean;
  /** The Final Inspection clause accepted before the LAST bay (finals.ts), or
   *  null for every bay before it.
   *
   *  Deliberately NOT a Ratchets entry, and the distinction is the whole point
   *  of the feature: a ratchet is a permanent commitment priced by how often it
   *  will be repeated, and at the last draft it will never be repeated. This is
   *  a one-off clause on one bay, so it is stored as one — a single id, written
   *  once, read only by levelForRun and only on the final bay. */
  final: FinalId | null;
}

/** Bond Breaker charges a Bond Emitter of `tier` ships for the WHOLE run —
 *  one per tier, so a maxed emitter is three shatters across ten bays. One
 *  function rather than an inline `* 1` in two places: newRun grants it at run
 *  start and buyUpgrade tops it up at a refit, and those two had to agree. */
export function bondChargesFor(tier: number): number {
  return Math.max(0, Math.floor(tier));
}

export function newRun(
  seed: number,
  unlocks: string[] = [],
  startingScrap = 0,
  loadout: UpgradeTiers = newTiers(),
  mark = 1,
): RunState {
  return {
    seed,
    levelIndex: 0,
    carry: 0,
    ratchets: {},
    linesTotal: 0,
    scrap: startingScrap,
    scrapEarned: startingScrap,
    // No starting-scrap equivalent: nothing has been blown up yet.
    salvagedFunds: 0,
    // The whole run's Bond Breaker magazine, granted once. bondChargesFor is
    // the single place the tier-to-charges rule lives, so the refit top-up in
    // buyUpgrade cannot drift from the run-start grant.
    bondCharges: bondChargesFor(loadout.bonds ?? 0),
    // The permanent loadout is where the ship STARTS, not a bonus on top of a
    // stock one: in-run scrap refits from here at the usual stops. Copied, not
    // aliased — a run must never write back into saved meta state.
    tiers: { ...loadout },
    unlocks: [...unlocks],
    mark,
    // A ladder run unless the caller says otherwise. Tier S is the ONE caller
    // that overrides it (main.ts's launchSandbox), which is why this is a
    // field on the run rather than a sixth positional argument nobody else
    // would ever pass.
    sandbox: false,
    // Nothing is inspected until the run reaches its last draft.
    final: null,
  };
}

/** True when clearing bay `levelIndex` (0-based) should open a refit stop:
 *  after every REFIT_EVERY-th bay, but never after the LAST bay (the run is
 *  over, there's nothing left to spend on). */
export function isRefitBay(levelIndex: number): boolean {
  if (levelIndex >= RUN_LEVELS - 1) return false;
  return (levelIndex + 1) % REFIT_EVERY === 0;
}

/**
 * True when the draft dealt after clearing bay `levelIndex` (0-based) is the
 * run's LAST one — the Final Inspection (finals.ts) rather than the axis
 * ratchet.
 *
 * `RUN_LEVELS - 2` because the offer is built at the moment the bay is won,
 * before the run advances (main.ts), so `levelIndex` is still the bay just
 * cleared: clearing bay 9 (index 8) is what opens the inspection on bay 10.
 * Stated as a predicate rather than an inline comparison for the same reason
 * hazards.ts states isMaterialDraft as one — the off-by-one here is invisible
 * in review and glaring in play, and the sim can reach a named function.
 */
export function isFinalDraft(levelIndex: number): boolean {
  return levelIndex === RUN_LEVELS - 2;
}

/**
 * How many more bays must be CLEARED — counting the one at `levelIndex`, i.e.
 * the one about to be played — before the next refit stop opens. 1 means
 * "clearing this bay docks you". Null when no refit stop remains in the run.
 *
 * Counted in bay-clears rather than as a modular remainder because that's the
 * unit the player is actually planning in ("do I bank scrap now or spend it?"),
 * and an off-by-one here is invisible in code review but glaring in the UI.
 */
export function baysUntilRefit(levelIndex: number): number | null {
  for (let i = levelIndex; i < RUN_LEVELS; i++) {
    if (isRefitBay(i)) return i - levelIndex + 1;
  }
  return null;
}

/**
 * The run's musical arc — which bed plays over which bay.
 *
 * These are ROLE names, not song titles, exactly like the effects: which
 * generated master becomes each one lives in `scripts/prepare-audio.mjs`, so
 * re-scoring a bay is a line there and nothing here moves. (See
 * audio/README.md.) `lib/audio.ts` unions this with `menu` — the only bed that
 * plays outside a bay — to make MusicName.
 *
 * The arc lives HERE rather than beside the player because it is run design,
 * not playback. It is one bed per bay, and the roles are named for the bay
 * rather than for the mood precisely because of that: `bay-7` is a promise
 * about WHERE it plays, and the song that fills it is free to change without a
 * file rename.
 *
 * The table stays even though it currently maps each index to its own bay — the
 * identity is a FACT about today's ten songs, not a rule, and a bay borrowing
 * an earlier bay's bed is a legitimate state to be in while one is being
 * written (bays 2-4 were, until they weren't). Deriving the name from the index
 * instead would delete the only place that distinction can be expressed.
 */
export type BayTrack =
  | "bay-1" | "bay-2" | "bay-3" | "bay-4" | "bay-5"
  | "bay-6" | "bay-7" | "bay-8" | "bay-9" | "bay-10";

/** Bay 1 -> bay 10, by index. Written out a bay at a time rather than as ranges
 *  because the arc is a thing you read, and a wrong assignment should be
 *  noticeable here instead of twenty minutes into a run. */
const BAY_TRACKS: readonly BayTrack[] = [
  "bay-1",  // 1   chill beginning (Remastered)
  "bay-2",  // 2   2 chill
  "bay-3",  // 3   Threes
  "bay-4",  // 4   Level Four on the floor
  "bay-5",  // 5   written in 5/4, which is why it is pinned to this bay NUMBER
  "bay-6",  // 6   raggae circuit
  "bay-7",  // 7   chipdisco
  "bay-8",  // 8   neon circuit
  "bay-9",  // 9   neon static
  "bay-10", // 10  neon pixel pulse — the closer
];

/**
 * The bed for the bay at `levelIndex` (0-based).
 *
 * Total rather than partial — it clamps at both ends and never returns
 * undefined. It is called from the state-change choke point that every screen
 * transition passes through, and a music lookup is not allowed to be the thing
 * that throws on the way into a bay. sim/systems.ts ties the table's length
 * back to RUN_LEVELS, so a lengthened ladder cannot quietly leave the closer
 * playing over the last three bays.
 */
export function bayMusic(levelIndex: number): BayTrack {
  const i = Math.min(Math.max(0, levelIndex | 0), BAY_TRACKS.length - 1);
  return BAY_TRACKS[i];
}

/** The LevelConfig the run's current levelIndex should actually be played
 *  with: the base ladder entry, then the ship's bought UPGRADE tiers, then all
 *  drafted MODS on top, and (for every level after the first) startingFunds
 *  bumped by the carried surplus.
 *
 *  Order is deliberate and load-bearing: upgrades are the SHIP, ratchets are the
 *  conditions it is flown in, so a notch lands on top of whatever was refitted
 *  (see upgrades.ts's header). That ordering is what makes the design's central
 *  claim true — a system does not delete a hazard, it makes one specific hazard
 *  cheap for you — because the ship's numbers are already in the config when the
 *  notch is added to them. The carry is added dead last so it's never scaled by
 *  either: it's cash in hand, not a rate.
 *
 *  Bond Breaker charges are the one field NOT derived from the ship: they are
 *  a consumable the run spends down (RunState.bondCharges), so whatever
 *  applyUpgrades wrote is overwritten with what the run actually has left. A
 *  charge fired in bay 3 is still gone in bay 4 — which is what stops the
 *  per-bay refill that let one bond bankroll a double clear. Written last, for
 *  the same reason the carry is: it is stock in hand, not a rate. */
export function levelForRun(run: RunState): LevelConfig {
  const base = makeBaseLevel(run.levelIndex, run.mark);
  applyUpgrades(base, run.tiers);
  const cfg = applyRatchets(base, run.ratchets);
  // The Final Inspection's clause, on the LAST bay only (finals.ts). After the
  // ratchets for the same reason the ratchets come after the upgrades: each
  // layer is the conditions the one below it is flown in, so a clause that
  // scales a number scales the number the run actually arrived with — a rate
  // cut takes a quarter of the REFITTED rate, not of the stock one. Guarded on
  // the bay rather than on `final` being set, so a clause can never leak
  // backwards into a replayed earlier bay.
  if (run.levelIndex === RUN_LEVELS - 1) applyFinal(cfg, run.final);
  if (run.levelIndex > 0) cfg.startingFunds = cfg.startingFunds + run.carry;
  cfg.bondBreakerCharges = Math.max(0, run.bondCharges);
  return cfg;
}

/** Cap on the carry-over banked into the next bay's float (see advanceRun).
 *
 *  An UNCAPPED carry was the deep-run exploit: one blowout bay (or one well-
 *  timed Bond Breaker flattening the whole field into multi-lines) banked
 *  enough overshoot to clear the next bay — sometimes the next TWO — on
 *  autopilot, which removed the puzzle entirely. Capped at roughly one clean
 *  line's gross payout, so a bay opened on a full carry starts at $350 against
 *  a target of $800 or more: a real head start, and still four-fifths of a bay
 *  left to actually play. A strong bay buys tempo — never the next bay. */
export const CARRY_CAP = 150;

/** The carry a bay ending on `endedScore` against `clearedTarget` banks into
 *  the next bay's float. Only the OVERSHOOT above target follows you on, and
 *  only up to CARRY_CAP; a bay that ended at or below target carries nothing
 *  (no debt travels either).
 *
 *  Extracted from advanceRun so the bay-clear card can state the figure
 *  BEFORE the bay is banked (main.ts draws that card first, and afterBayClear
 *  runs advanceRun only once it is dismissed). A second copy of the
 *  expression at the call site would be a second place for the cap to go
 *  stale — the same one-home rule the guide's copy is held to. */
export function carryFrom(endedScore: number, clearedTarget: number): number {
  return Math.min(CARRY_CAP, Math.max(0, endedScore - clearedTarget));
}

/** Advance to the next level after one ends: carry becomes the overshoot
 *  banked above the just-cleared bay's target, CAPPED at CARRY_CAP (0 if the
 *  bay ended at or below target — no debt carries), lines and scrap
 *  accumulate, and the drafted pick (if any — the player may have nothing
 *  left to pick from) is appended. `clearedTarget` is the just-ended bay's
 *  targetScore (Game.target), needed to compute the overshoot; `scrapEarned`
 *  is what the bay paid out (Game.scrapEarned plus the per-bay clear bonus).
 *
 *  `bondsLeft` is the Bond Breaker stock the just-played bay ENDED with
 *  (Game.bondCharges), which becomes the run's magazine for the next bay. It
 *  defaults to the run's current stock — "nothing was spent" — rather than to
 *  0, deliberately: a caller that forgets to thread it through leaves the
 *  player's charges alone instead of silently confiscating them, and a bug
 *  that hands out too much is one a tester reports, where one that quietly
 *  eats a rare consumable is one they never even notice.
 *
 *  `salvagedFunds` is what demolition charges refunded in the just-played bay
 *  (Game.salvagedFunds). It defaults to 0, the exact opposite of `bondsLeft`'s
 *  defensive default, and deliberately so: this one is a stat rather than a
 *  stock, so a caller that forgets it under-reports a single bay, where
 *  defaulting to the running total would re-count every bay before it.
 *
 *  Returns a new RunState; never mutates the one passed in. */
export function advanceRun(
  run: RunState,
  endedScore: number,
  clearedTarget: number,
  lines: number,
  scrapEarned: number,
  pickedAxes: HazardId[] = [],
  bondsLeft: number = run.bondCharges,
  salvagedFunds = 0,
): RunState {
  const ratchets: Ratchets = { ...run.ratchets };
  for (const id of pickedAxes) ratchets[id] = (ratchets[id] ?? 0) + 1;
  return {
    seed: run.seed,
    levelIndex: run.levelIndex + 1,
    carry: carryFrom(endedScore, clearedTarget),
    ratchets,
    linesTotal: run.linesTotal + lines,
    scrap: run.scrap + scrapEarned,
    scrapEarned: run.scrapEarned + scrapEarned,
    salvagedFunds: run.salvagedFunds + salvagedFunds,
    // Clamped to the stock the run actually held: a bay cannot hand back more
    // charges than it was issued, however it reports its ending count.
    bondCharges: Math.max(0, Math.min(run.bondCharges, Math.floor(bondsLeft))),
    // Carried, obviously — but worth stating why it is spelled out in a
    // function that rebuilds the run field by field: a run that stopped being
    // a sandbox run at bay 2 would spend the other nine bays quietly earning
    // salvage and filing its score on the ladder's board. The field is
    // required on RunState (not optional) precisely so this line cannot be
    // forgotten here or in any future rebuilder.
    sandbox: run.sandbox,
    tiers: { ...run.tiers },
    unlocks: [...run.unlocks],
    mark: run.mark,
    final: run.final,
  };
}

/** Buy one tier of a system at a refit stop. Returns a NEW RunState with the
 *  tier raised and the scrap deducted, or null when it can't be bought (not
 *  installed, maxed, or not enough scrap) — the caller renders that as a
 *  disabled card rather than needing to duplicate the affordability rules. */
export function buyUpgrade(run: RunState, id: keyof UpgradeTiers, cost: number, maxTier: number): RunState | null {
  const tier = run.tiers[id] ?? 0;
  // Tier 0 means the ship doesn't carry the system at all. A refit raises one
  // it already has, 1 -> 3; putting one aboard is a loadout purchase made
  // against the Mark's build budget (upgrades.ts's buyLoadoutTier). In-run
  // scrap has no such budget, so letting it install would route around the cap
  // that makes two rigs at the same Mark equal in power — see upgrades.ts's
  // BUILD BUDGET note for why that equality is the load-bearing one.
  if (tier <= 0) return null;
  if (tier >= maxTier) return null;
  if (run.scrap < cost) return null;
  return {
    ...run,
    ratchets: { ...run.ratchets },
    unlocks: [...run.unlocks],
    scrap: run.scrap - cost,
    tiers: { ...run.tiers, [id]: tier + 1 },
    // Refitting the Bond Emitter issues the DIFFERENCE between the two tiers'
    // grants into the magazine, on top of whatever is left in it. The delta
    // rather than the new total, so a refit at bay 9 cannot refill charges the
    // player already spent — buying a bigger emitter buys the extra charge it
    // adds, not a reset of the consumable.
    bondCharges: id === "bonds"
      ? run.bondCharges + (bondChargesFor(tier + 1) - bondChargesFor(tier))
      : run.bondCharges,
  };
}

/**
 * Install a whole REFIT ORDER at once — the yard's single commit, run when the
 * player undocks (upgrades.ts's RefitOrder).
 *
 * ALL OR NOTHING. An order that outruns the scrap, names a system the ship is
 * not carrying, or climbs past `maxTier` is refused outright rather than
 * part-filled: a half-installed order would spend real scrap on a build the
 * player never saw projected, which is exactly the surprise staging exists to
 * remove. upgrades.ts's stageTier already forbids all three, so this is not
 * belt-and-braces — the order round-trips through the DOM as `data-upgrade`
 * attributes, and the gate has to hold where the state actually changes.
 *
 * The rungs themselves go on through buyUpgrade, one at a time, so the Bond
 * Emitter's magazine delta is issued by exactly the rule that issued it when
 * every tier was its own purchase. The sequence comes from upgrades.ts's
 * orderRungs — UPGRADES order, not the object's key order, so the commit is
 * deterministic however the order was assembled, and so anything that has to
 * narrate the commit afterwards (main.ts's per-rung telemetry) reads the same
 * sequence off the same function instead of re-deriving it.
 */
export function buyUpgrades(
  run: RunState,
  order: RefitOrder,
  maxTier: number,
): RunState | null {
  let spend = 0;
  for (const def of UPGRADES) {
    const want = Math.max(0, Math.floor(order[def.id] ?? 0));
    if (want === 0) continue;
    const tier = run.tiers[def.id] ?? 0;
    // Tier 0 is not a cheaper first rung, it is a system that is not aboard —
    // see buyUpgrade for why in-run scrap must never install one.
    if (tier <= 0 || tier + want > maxTier) return null;
    for (let t = tier; t < tier + want; t++) spend += nextTierCost(t) ?? 0;
  }
  if (spend > run.scrap) return null;

  let next = run;
  for (const rung of orderRungs(run.tiers, order)) {
    const step = buyUpgrade(next, rung.id, rung.cost, maxTier);
    // Unreachable after the pass above, and still checked: returning a
    // half-installed run here would be the one way this function could spend
    // scrap on a build the yard never showed.
    if (!step) return null;
    next = step;
  }
  return next;
}

/** Final-score weights (see finalRunScore). Exported so the end modal can
 *  show the same numbers in its breakdown line. */
export const SCORE_PER_BAY = 500;
export const SCORE_PER_LINE = 100;

/**
 * Composite score for a FINISHED run — what goes to the leaderboard and the
 * saved best. Bays cleared and total lines dominate; the funds in hand when
 * the run ended count only 1:1, as a tie-breaker. That ordering is
 * deliberate: each bay is its own economy (only the overshoot above target
 * carries — see levelForRun/advanceRun), so ending funds are mostly the
 * final bay's float, not a measure of the whole run. Ranking by funds alone
 * let a bay-1 flameout with a fat wallet outrank a deep run that died broke.
 */
export function finalRunScore(baysCleared: number, totalLines: number, fundsLeft: number): number {
  return baysCleared * SCORE_PER_BAY + totalLines * SCORE_PER_LINE + Math.max(0, fundsLeft);
}
