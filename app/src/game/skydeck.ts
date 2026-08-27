import { dailySeed } from "./contracts";
import { finalById, finalsForTier, type FinalDef, type FinalId } from "./finals";
import { makeBaseLevel } from "./level";
import { MATERIAL_SPEC, type Material } from "./theme";
import { MARK_COUNT, type UpgradeTiers } from "./upgrades";
import { newRun, REFIT_EVERY, RUN_LEVELS, type RunState } from "./run";

/**
 * THE SKYDECK — the floor above the ladder, and the one run nobody tunes to
 * their own taste.
 *
 * Every other mode in the game asks the player to author the difficulty. A Deep
 * Run hands them the ratchet (hazards.ts: "by bay 10 they have authored their
 * own curve"), and a Contract hands them free retries against a budget proven
 * winnable. The Skydeck takes the authoring away and replaces it with a DATE:
 *
 *  - **The run is the day's.** Its seed is the Contract board's own day key
 *    (contracts.ts's dailySeed) put through a salt, so every player who opens
 *    the Skydeck on the same UTC day gets the same hazard hands, the same
 *    weather, the same belt and the same standing clauses. The reason is the
 *    reason the Contract board is seeded that way and stated there: a board
 *    means nothing unless everyone on it flew the same thing.
 *  - **The bays are a step past the ladder.** Mark 10's bays with the target
 *    and launch curves read one rung further along — $800 -> $1880 against $31
 *    a shot, where the capstone asks $780 -> $1842 against $30 (level.ts's
 *    SKYDECK_RUNG). An owner's playtest is what put it there: the roof was
 *    flying the exact bay the ladder's last rung flies, so the only thing above
 *    Mark 10 was the clauses.
 *  - **The yard opens, at the roof's prices.** Refit stops land after bays 3, 6
 *    and 9 exactly as they do on the ladder (run.ts's refitAfterBay), and the
 *    bays pay HALF the ladder's scrap for them (level.ts's
 *    SKYDECK_SCRAP_SHARE). This is a REVERSAL and the history is worth keeping:
 *    the mode shipped with no yard at all, on the argument that "the rig that
 *    undocks is the rig that lands" was its identity, and the owner ruled that
 *    in. Playtesting ruled it out — a ten-bay run whose only decision is the
 *    notch is a long run with one lever, and the scrap line every screen had to
 *    carry could only ever read 0. What the tightened rate keeps is the part of
 *    the old rule that was actually load-bearing: the player who can open this
 *    floor has a maxed Workshop, so every rung the yard can still sell is a
 *    tier-3 rung at one flat price, and at the ladder's payout the roof would
 *    hand over half a ship across three stops. design/balance/skydeck-yard.md
 *    has the measurement that set the share.
 *
 *    CONSUMABLES ARE STILL NOT RESUPPLIED, which is the same old rule read one
 *    step further and the reason the Thaw Lance has a branch in run.ts's
 *    advanceRun. A ladder run flies a lance rack that renews at every bay
 *    boundary (upgrades.ts sizes the charges per BAY); a Skydeck run gets ONE
 *    rack at undock and spends it down across ten bays. The reopened yard sells
 *    a BIGGER rack — buyUpgrade issues the difference a rung adds, on top of
 *    what is left — and never a refill, so a charge spent in bay 2 is still
 *    spent in bay 10. A consumable that could be topped up three times a run
 *    would be a supply line; a rung that adds three charges once is a build.
 *
 *    Bond Breakers already worked this way everywhere (a run magazine by
 *    design), and DEMOLITION charges still do not — they are re-granted onto a
 *    fresh config every bay by applyUpgrades, on the Skydeck as on the ladder.
 *    That asymmetry is left alone deliberately rather than tidied up here:
 *    changing it is an unmeasured nerf to a mode whose per-bay rate was swept
 *    (sim/skydeck.ts) with the rack refilling, and it belongs to whoever
 *    re-measures it.
 *  - **One notch a bay, not the capstone's two.** hazards.ts's picksPerBay asks
 *    for two at Mark 10 because Mark 10 opens no new axis and needs somewhere
 *    to put the pressure. Here that pressure has a home already — the clauses
 *    below — and asking for both would be charging twice for the same rung.
 *    run.ts's picksForRun is where the two rules meet.
 *
 * ---------------------------------------------------------------------------
 * THE STANDING CLAUSES — why the Final Inspection is dealt three times, and
 * why the player does not choose them.
 *
 * finals.ts deals two clauses before the last bay because a notch taken there
 * is "a permanent commitment one bay before permanence expires". The Skydeck
 * has the opposite problem: it wants the ladder's whole catalogue of exams in
 * one run, and a run has only one last bay. So the inspection is dealt three
 * times, and each clause STANDS — it rides every bay from the one it arms on to
 * the end of the run.
 *
 * WHERE THEY ARM is the yard's own schedule, read forwards. Refits land after
 * bays 3, 6 and 9 (run.ts's REFIT_EVERY), so bays 4, 7 and 10 are exactly the
 * bays a run opens on a fresh rig. Those are the three bays the Skydeck opens
 * on a fresh CLAUSE as well, which is why CLAUSE_STOPS is derived from
 * REFIT_EVERY rather than typed out as 4/7/10: a ladder that re-spaces its yard
 * re-spaces its inspections with it.
 *
 * The pairing was a substitution when the roof had no yard — one line of the
 * loop deleted, the other written in its place — and it reads BETTER now that
 * the stop is back, which is the happiest thing about the reversal: the run
 * walks out of the yard having bought what it could and is handed the clause it
 * will be carrying, in the same breath. The bays that ask the most are the bays
 * you have just been given the chance to prepare for.
 *
 * THEY ARE DEALT, NOT DRAFTED, and that is the design decision most worth
 * arguing. The obvious shape is the shipped one — deal the Tier's pair at each
 * stop and let the player sign one — and it was rejected twice over:
 *
 *  - It costs the run its "one notch a bay". Three of the nine drafts would ask
 *    for a clause INSTEAD of a notch (a draft that asks for both is two
 *    decisions wearing one screen), so six bays would ratchet and three would
 *    not. The mode's whole promise is that the ratchet never stops and never
 *    doubles.
 *  - It costs the day its board. Two players who signed different clauses did
 *    not fly the same run, so a shared daily leaderboard would be ranking their
 *    choices rather than their play — which is precisely what dailySeed exists
 *    to prevent on the Contract board.
 *
 * So the day writes the contract and the player flies it. What is still theirs
 * is every notch and every shot, which is the half a leaderboard can read.
 *
 * ---------------------------------------------------------------------------
 * THE BANDS — why a clause's tier depends on how long it will stand.
 *
 * A Final clause is priced against ONE bay (finals.ts sizes each pair on that
 * Tier's own bay 10). A standing clause is that cost multiplied by the bays it
 * rides, so the bands are ordered by exposure: the earliest stop stands for
 * seven bays and draws from the gentlest tiers, the last stands for one bay and
 * draws from the heaviest.
 *
 *  - **Stop 1 (arms bay 4, stands 7 bays) — Tiers 2-3.** The CONDITIONS tiers:
 *    Head Gale, Tail Gale, Double Shift, Tight Gauge. None of them touch the
 *    bay's books, which is the property that makes them safe to repeat — they
 *    change how a bay is flown, not what it is worth, so seven of them is seven
 *    bays of the same weather rather than a compounding debt.
 *
 *    TIER 1 IS DELIBERATELY EXCLUDED, and the arithmetic says why. Rush Order
 *    adds a flat $750 to the target; Mark 10's bay 4 asks $1134, so as a
 *    standing rule it is a 66% quota raise on the first bay it touches and
 *    still a 41% one on bay 10. Rate Cut is the same story as a share. Both are
 *    honest as one bay's exam and absurd as seven bays' weather. The money
 *    axes belong to the ratchet here (Fuel Levy is on every hand), where the
 *    player prices them a notch at a time.
 *
 *  - **Stop 2 (arms bay 7, stands 4 bays) — Tiers 4-9, minus dead cargo.** The
 *    tiers the ladder opens one material at a time, plus Tier 9's press pair
 *    (finals.ts explains why magnetic's exam is the press and not the
 *    material). Repeating a material clause is structurally bounded in a way
 *    repeating a quota raise is not: belt.ts holds the belt to one shipment in
 *    three however many rates stack, so four bays of Cold Chain is four bays of
 *    the SAME belt rather than a belt that thickens.
 *
 *    Tier 6's pair — the slag one — is refused by schedulesDeadCargo below, on
 *    a rule rather than by name. The note there has the measurement and the
 *    principle it is standing on; the short version is that hazards.ts already
 *    refuses to FORCE slag, and a dealt clause is a forced pick with no seat to
 *    dodge into.
 *
 *  - **Stop 3 (arms bay 10, stands 1 bay) — Tier 10.** The capstone pair,
 *    unchanged, on exactly the bay finals.ts reserves it for: "taking the
 *    standard shipment away entirely is the one cost that must never be dealt
 *    before the ladder's last exam."
 *
 * WHICH of a tier's two clauses the day deals is a coin from the same stream.
 * Both halves of a pair cost about the same in extra lines (finals.ts), so the
 * roll picks a flavour rather than a difficulty — and a day that deals Ice Wall
 * where yesterday dealt Cold Chain is a genuinely different run to plan.
 *
 * ---------------------------------------------------------------------------
 * MEASURED — see sim/skydeck.ts and the PR that added this file. The short
 * version, with the usual pessimism caveat (sim/README.md: no bot fires a Bond
 * Breaker, only `demo` fires a charge, and fixed arcs never read the pile):
 * the harness flies every stop combination the bands can produce, at Mark 10,
 * on a full Mark-10 loadout with no refits and one notch a bay, and reports the
 * per-bay rate and the implied run clear. The bands above are what that sweep
 * settled on; the numbers are in the commit message, where a balance claim has
 * to be able to be checked.
 *
 * The YARD's own numbers are a later and separate measurement — sim/skyyard.ts
 * flies the whole ten-bay run through run.ts's real advanceRun/buyUpgrades on a
 * maxed Workshop rig, at the step above, and prices the three economies (no
 * yard / the ladder's payout / the roof's half share) against each other on
 * paired seeds. The table is in design/balance/skydeck-yard.md.
 */

/** The Mark a Skydeck run is flown at — the top of the ladder, because the
 *  Skydeck is not a rung of its own and the base bays have to come from
 *  somewhere. What the roof does to those bays afterwards — one more step of
 *  the ladder's own target and launch curves, and half its scrap rate — is
 *  level.ts's applySkydeckEconomy, which lives there because it is that
 *  module's curves being read one rung further along and because run.ts (which
 *  applies it) cannot import this file at runtime. Every other difference
 *  between this mode and a Mark-10 Deep Run is stated here. */
export const SKYDECK_MARK = MARK_COUNT;

/** Notches the Skydeck asks for after every cleared bay. ONE, at a Mark whose
 *  ordinary rule is two (hazards.ts's picksPerBay) — see the header. Named
 *  rather than inlined because it is the number a play pass edits first, the
 *  same reason hazards.ts names its notch sizes. */
export const SKYDECK_PICKS_PER_BAY = 1;

/** Mixed into the day key so the Skydeck's roll shares a DATE with the Contract
 *  board and not a stream. Without it a day whose Contract board rolled a rare
 *  bed would be correlated with the clause it dealt on the Skydeck, which is a
 *  coupling nobody asked for and nobody could reason about. */
const SKYDECK_SALT = 0x5b7d_ec00;

/**
 * The day's Skydeck seed. Everyone who opens the Skydeck on the same UTC day
 * gets the same run — same hazard hands, same clauses.
 *
 * Built on contracts.ts's dailySeed rather than on a second date function, so
 * the two dailies roll over at the same instant. A Skydeck that turned over at
 * a different midnight from the Contract board would be two "todays" in one
 * game.
 */
export function skydeckSeed(d = new Date()): number {
  return (dailySeed(d) ^ SKYDECK_SALT) >>> 0;
}

/** One clause and the bay it arms on. */
export interface StandingClause {
  /** 0-based levelIndex from which the clause applies, and every bay after it.
   *  0-based to match RunState.levelIndex, which is what levelForRun compares
   *  it against — the one place an off-by-one here would be invisible. */
  from: number;
  id: FinalId;
}

/** The whole of what makes a run a Skydeck run. One object rather than a
 *  boolean beside a list, because "a Skydeck run with no clauses" and "a ladder
 *  run carrying clauses" are both states nothing should be able to construct. */
export interface SkydeckRules {
  /** The day key the rules were dealt from (contracts.ts's dailySeed — a plain
   *  YYYYMMDD integer, so it prints). Carried so the end card and the board can
   *  say WHICH day's run this was; a best score with no day attached is a
   *  number nobody can go back and beat. */
  day: number;
  clauses: readonly StandingClause[];
}

/**
 * The stops, derived from the yard's spacing rather than typed out.
 *
 * `REFIT_EVERY * k + 1` for k = 1, 2, 3 is the bay after each refit — 4, 7 and
 * 10 at the shipped spacing of 3. The last one lands exactly on RUN_LEVELS,
 * which is not a coincidence to lean on: a ladder whose length and yard spacing
 * stop dividing evenly would give the last stop a bay or two of standing, which
 * is a milder version of the same mode rather than a broken one. sim/systems.ts
 * pins that every stop is a real bay and that they arrive in order.
 */
export const CLAUSE_STOPS: readonly { fromBay: number; tiers: readonly number[] }[] = [
  { fromBay: REFIT_EVERY * 1 + 1, tiers: [2, 3] },
  { fromBay: REFIT_EVERY * 2 + 1, tiers: [4, 5, 6, 7, 8, 9] },
  { fromBay: REFIT_EVERY * 3 + 1, tiers: [MARK_COUNT] },
].filter((s) => s.fromBay <= RUN_LEVELS);

/**
 * DEAD CARGO IS NEVER DEALT AS A STANDING RULE, and this is the one rule in
 * this file that was written by a measurement rather than by an argument.
 *
 * Slag is the material with no passive counter: a dead cube fills a slot,
 * counts for nothing, and leaves the field by Demolition or not at all
 * (theme.ts's countsForLines is false for it alone). hazards.ts already refuses
 * to force it — "one content card per hand, never two", and on the forced
 * material bays "slag may fill a seat but never the last one, so a forced pick
 * is never forced to be the material with no passive counter". A clause the DAY
 * deals is a pick with no seat to dodge into at all, so the same rule has to
 * hold here or the Skydeck would be the one place in the game that forces the
 * one material a player might have no answer to.
 *
 * The harness agreed, loudly. At Mark 6 on the economy rig (aim bot, 4 seeds,
 * bays 1/4/7/10) a bare Skydeck run read 24% implied run-clear; adding Slag Run
 * or Slag Wall at the second stop took bays 7 and 10 to 0% and stayed there.
 * Every other band-2 clause left a flyable run. That reading carries the
 * harness's own bias — no bot fires a demolition charge, which is slag's only
 * exit — so it is not evidence that slag is unfair for a human. It is evidence
 * that slag is the clause whose cost depends entirely on one purchase, and a
 * DEALT rule cannot ask about a purchase the player may not have made.
 *
 * ONLY FOR A CLAUSE THAT STANDS FOR MORE THAN ONE BAY. The capstone's Odd Lots
 * raises every material including slag, and it is dealt at the last stop, where
 * it rides exactly one bay — the same exposure a Deep Run's Final Inspection
 * gives it (finals.ts). The rule is about repetition, so it is written against
 * repetition.
 *
 * DERIVED BY APPLYING THE CLAUSE, not by listing ids. A clause's material is a
 * closure, not a field, so the honest question is what the belt looks like
 * afterwards — which also means a clause added later is covered by this rule
 * without anyone remembering it exists. sim/systems.ts pins the property.
 */
const DEAD_MATERIALS = (Object.keys(MATERIAL_SPEC) as Material[])
  .filter((m) => !MATERIAL_SPEC[m].countsForLines);

export function schedulesDeadCargo(def: FinalDef): boolean {
  const cfg = makeBaseLevel(0, SKYDECK_MARK);
  const before = { ...cfg.materialMix };
  def.apply(cfg);
  return DEAD_MATERIALS.some(
    (m) =>
      (cfg.materialMix[m as keyof typeof cfg.materialMix] ?? 0) > (before[m as keyof typeof before] ?? 0) + 1e-9
      || cfg.standingWallMaterial === m,
  );
}

/** The clauses a stop may actually deal: its bands' pairs, minus anything the
 *  rule above refuses. Flat rather than tier-then-clause, so a tier that loses
 *  half its pair does not keep a whole tier's share of the roll. */
export function dealableAt(stopIndex: number): FinalDef[] {
  const stop = CLAUSE_STOPS[stopIndex];
  const standsOneBayOnly = stop.fromBay >= RUN_LEVELS;
  return stop.tiers
    .flatMap((t) => finalsForTier(t))
    .filter((def) => standsOneBayOnly || !schedulesDeadCargo(def));
}

/** How many clauses a Skydeck run ends up carrying. Derived, so the count on
 *  the menu can never disagree with the schedule that produces it. */
export const CLAUSE_COUNT = CLAUSE_STOPS.length;

/**
 * The day's standing clauses, in the order they arm.
 *
 * Deterministic in `seed` alone — not in the rig, not in the player's unlocks,
 * and not in anything the run does. A daily whose rules answered the player
 * would not be a daily.
 */
export function skydeckClauses(seed: number): StandingClause[] {
  const rng = mulberry32(seed >>> 0);
  return CLAUSE_STOPS.map((stop, i) => {
    const pool = dealableAt(i);
    const pick = pool[Math.floor(rng() * pool.length) % pool.length];
    return { from: stop.fromBay - 1, id: pick.id };
  });
}

/** The day's rules, ready to hang on a run. */
export function skydeckRulesFor(d = new Date()): SkydeckRules {
  return { day: dailySeed(d), clauses: skydeckClauses(skydeckSeed(d)) };
}

/** The clause that arms ON `levelIndex`, if any — what the bay-clear card
 *  announces before the bay it applies to is flown.
 *
 *  Note that "every clause in force at a bay" is deliberately NOT here: it is a
 *  question about a RUN, so it lives in run.ts as standingClauses, which is
 *  also what keeps this module's dependency on run.ts one-directional. */
export function clauseArmingAt(rules: SkydeckRules, levelIndex: number): StandingClause | null {
  return rules.clauses.find((c) => c.from === levelIndex) ?? null;
}

/** The definitions behind a run's clauses, for anything that has to print them
 *  (the menu's schedule, the bay-clear card). Unknown ids are dropped rather
 *  than thrown on, the same forward-compatibility rule applyFinal keeps: a save
 *  written before a clause was renamed still opens a menu. */
export function clauseDefs(rules: SkydeckRules): { bay: number; def: FinalDef }[] {
  const out: { bay: number; def: FinalDef }[] = [];
  for (const c of rules.clauses) {
    const def = finalById(c.id);
    if (def) out.push({ bay: c.from + 1, def });
  }
  return out;
}

/**
 * A fresh Skydeck run for `d`'s rules.
 *
 * Shaped like sandbox.ts's sandboxRunFor and for the same reason: newRun states
 * what a run IS, and a mode is a small set of overrides on top of it rather
 * than a sixth positional argument nobody else would ever pass.
 *
 * NO STARTING SCRAP — an EMPTY HOLD, still, now that there is a yard to spend
 * it in. The Scrap Cache unlock (meta.ts) opens a ladder run's first stop with
 * 30 scrap already banked, and main.ts passes it to newRun for exactly that;
 * the roof declines it on the rule that writes every other line in this file.
 * Everyone who opens the Skydeck flies the same day, and a stop that opened
 * further along for the pilot who happened to have bought one option would be
 * the board ranking a purchase. It also happens to be the tighter reading, and
 * the roof's stops are tight on purpose (level.ts's SKYDECK_SCRAP_SHARE).
 *
 * The scrap the bays PAY is a different question and it is answered on the
 * config, not here: applySkydeckEconomy writes the roof's rate onto every bay
 * (half the ladder's), so a run's income is a property of the bays it flew.
 */
export function skydeckRunFor(
  loadout: UpgradeTiers,
  unlocks: string[] = [],
  d = new Date(),
): RunState {
  const rules = skydeckRulesFor(d);
  return {
    ...newRun(skydeckSeed(d), unlocks, 0, loadout, SKYDECK_MARK),
    skydeck: rules,
  };
}

/** Seeded PRNG. Duplicated from hazards.ts/mods.ts for the reason stated
 *  there — a shared stream would correlate two draws that have no business
 *  agreeing, and here the two draws are a day's clauses and a day's hazard
 *  hands. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
