import type { LevelConfig } from "./level";
import { makeBaseLevel } from "./level";
import { applyRatchets, picksPerBay, type Ratchets, type HazardId } from "./hazards";
import { applyFinal, applyFinals, type FinalId } from "./finals";
// TYPE ONLY, and load-bearing: skydeck.ts imports newRun and this file's
// spacing constants at RUNTIME, so a value import here would close a cycle.
// `import type` is erased, which keeps the dependency one-directional — the
// mode knows about the run, the run knows only the SHAPE of the mode's rules.
import type { SkydeckRules } from "./skydeck";
import {
  applyUpgrades, newTiers, nextTierCost, orderRungs, THAW_CHARGES_PER_TIER, UPGRADES,
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
  /** Bay retries taken this run. Written by main.ts's resetBay — the pause
   *  modal's "Restart Bay", the held pause button, the tutorial failure card's
   *  retry AND the game-over card's "Retry Bay", which all route through that
   *  one call — and read once at the end (meta.ts's recordRunEnd) to decide the
   *  seal.
   *
   *  It lives on the run rather than being derived, because a restart leaves
   *  no other trace: resetBay rebuilds the bay from the same un-advanced
   *  levelIndex and the carry, scrap, ratchets and Bond magazine all survive
   *  untouched — which is exactly what makes "cleared it without one" worth
   *  marking. Tier S never increments it; the sandbox files to its own board
   *  and climbs no ladder.
   *
   *  Carried by advanceRun for the same reason salvagedFunds is: it is a
   *  RUN-long total, and that function rebuilds the run field by field, so a
   *  rebuild that forgot it would silently zero the count at every bay
   *  boundary and seal every run that only ever restarted a bay it went on to
   *  clear — i.e. very nearly all of them. */
  restarts: number;
  /** This run's end has already been FILED against the ladder (meta.ts's
   *  recordRunEnd), and the next filing must not count it as a second run.
   *
   *  It exists because a Deep Run can now end twice. The game-over card's
   *  "Retry Bay" hands the same RunState back at the same un-advanced
   *  levelIndex (main.ts's retryBay), so a run that dies at bay 7 and goes on
   *  to win at bay 10 reaches recordRunEnd once as a loss and once as a win.
   *  Every consequence there is already idempotent under that — bestBay is a
   *  max, the salvage share and the tier tick are false→true edges, and the
   *  seal is gated on `restarts` — except the lifetime run COUNT, which is a
   *  count of runs and not of endings.
   *
   *  A field on the run rather than a set in main.ts, because it has to survive
   *  advanceRun's field-by-field rebuild for the same reason `restarts` does:
   *  a rebuild that dropped it would re-count the run at the next bay boundary.
   *  Never true on a run the ladder does not track — those are never filed at
   *  all (run.ts's tracksLadder, main.ts's finishRun). */
  filed: boolean;
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
  /** Funds volatile detonations took for the LIVE cargo they obliterated
   *  (Game.volatileLosses per bay, summed here) — the exact mirror of
   *  salvagedFunds above, and a READOUT for the same reason: the money already
   *  left the bay's score the moment the blast settled, so this must never
   *  touch `carry` or the player would be charged twice.
   *
   *  It exists for the reason salvagedFunds does, read the other way round. A
   *  bomb's refund is the whole reason its price is worth reasoning about, and
   *  a volatile ratchet's charge is the whole reason that notch is a cost and
   *  not a bargain (lineClear.ts's volatileLossFor carries the measurement).
   *  Priced and never printed, the notch reads to the player exactly the way it
   *  read to the sim before it was billed: as free pile relief. */
  volatileLosses: number;
  /** Funds the Incinerator saved across the run (Game.incineratedFunds per bay,
   *  summed here) — the third of these READOUTS and the only one that totals
   *  money that never moved.
   *
   *  It is here for the reason its two neighbours are, stated by salvagedFunds
   *  and inverted: a bomb's refund is why its price is worth reasoning about,
   *  and a hood's relief is why ITS price is. Every other ship system shows its
   *  work while the bay is being played — the liner is drawn on the floor, the
   *  lance counts down in the rail, the reactor is in the float. A passive
   *  discount shows nothing at all: the bill simply arrives smaller than a bill
   *  the player never saw. Without this line the tenth system is the only one on
   *  the shelf a player cannot tell they own. */
  incineratedFunds: number;
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
  /** Thaw Lance charges the run has IN HAND — cryo's bought counter
   *  (upgrades.ts's `thaw` track, game.ts's useThawLance).
   *
   *  It lives here rather than being derived per bay for one reason, and the
   *  reason is a mode: a LADDER run's lance is resupplied between bays, so this
   *  is refilled to the tier's allowance at every bay boundary and the field is
   *  little more than "what is left in this bay's rack"; a SKYDECK run's is
   *  not, so the same field is a run-long magazine that only ever falls. Both
   *  rules are in advanceRun, one line apart, and sim/systems.ts pins each.
   *
   *  Derived-per-bay was the shape this ALMOST shipped as — the Demolition
   *  Rack's, where applyUpgrades writes `bombCharges` onto a fresh base every
   *  level and the refill is a side effect of the config being rebuilt. That
   *  cannot express "and not on the Skydeck", which is exactly what the mode's
   *  no-yard rule asks for (skydeck.ts). A run-scoped field can express both.
   *
   *  Seeded in newRun from the loadout's tier, topped up by the DIFFERENCE when
   *  that tier is refitted mid-run (buyUpgrade), and written back by advanceRun
   *  from what the just-played bay actually had left. */
  thawCharges: number;
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
  /** The day's Skydeck rules (skydeck.ts), or null for every ladder run.
   *
   *  ONE FIELD, not a `skydeck: boolean` beside a list of clauses, and the
   *  reason is the same one RunState.sandbox states for being required rather
   *  than optional: the two states nothing should be able to construct are "a
   *  Skydeck run with no clauses" and "a ladder run carrying them", and a
   *  single nullable object cannot express either.
   *
   *  Set at construction (skydeck.ts's skydeckRunFor) and never changed, again
   *  exactly like `mark` and `sandbox`: it decides which board the run files
   *  to, whether the yard opens, and how many notches a bay costs — a run that
   *  could switch modes halfway through is a run whose score means nothing.
   *
   *  Everything downstream reads it through the four predicates below rather
   *  than testing it directly, so "the Skydeck has no yard" is stated once. */
  skydeck: SkydeckRules | null;
}

/* ---------------------------------------------------------------------------
 * THE RUN'S SCHEDULE, asked of the RUN.
 *
 * isRefitBay, baysUntilRefit, isFinalDraft and hazards.ts's picksPerBay each
 * state a rule of the LADDER, as a function of a bay index or a Mark. The
 * Skydeck answers three of the four differently (skydeck.ts) — no yard, no
 * drafted inspection, one notch a bay at a Mark whose ladder rule is two — and
 * every one of those differences is a place where a caller that forgot to ask
 * would silently fly the wrong mode: a refit screen with no scrap to spend, a
 * Final Inspection dealt on top of three standing clauses, a capstone draft
 * demanding two notches the mode does not charge for.
 *
 * So the four run-aware readings live here, together, next to the ladder rules
 * they defer to. Callers hold a RunState; these are what they ask. sim/systems.ts
 * pins each one against its ladder twin.
 * ------------------------------------------------------------------------- */

/** True when clearing bay `levelIndex` in THIS run opens a refit stop. Never in
 *  a Skydeck run: the yard is shut, and the rig that undocks is the rig that
 *  lands. */
export function refitAfterBay(run: RunState, levelIndex: number): boolean {
  return run.skydeck === null && isRefitBay(levelIndex);
}

/** Bay-clears until this run's next refit stop, or null when it has none left —
 *  which a Skydeck run never has, having had none to begin with. */
export function baysUntilRefitFor(run: RunState): number | null {
  return run.skydeck === null ? baysUntilRefit(run.levelIndex) : null;
}

/** True when the draft dealt after clearing this run's current bay is the Final
 *  Inspection. Never in a Skydeck run: its clauses are the DAY's, dealt at
 *  three stops and standing from each (skydeck.ts's header says why they are
 *  dealt rather than drafted), so the last draft there is an ordinary notch. */
export function finalDraftFor(run: RunState): boolean {
  return run.skydeck === null && isFinalDraft(run.levelIndex);
}

/** Notches this run charges after a cleared bay. hazards.ts's picksPerBay asks
 *  two at the capstone Mark; the Skydeck asks one at that same Mark, because
 *  the pressure the second notch exists to carry is carried by the standing
 *  clauses instead and charging both would charge twice for one rung. */
export function picksForRun(run: RunState): number {
  return run.skydeck ? SKYDECK_PICKS_PER_BAY : picksPerBay(run.mark);
}

/** Notches the Skydeck charges a bay. Stated here rather than imported from
 *  skydeck.ts for the cycle reason at the top of this file; sim/systems.ts pins
 *  the two together so they cannot drift. */
export const SKYDECK_PICKS_PER_BAY = 1;

/**
 * Does this run's ENDING move the ladder — the tier's Deep Run milestone, its
 * salvage share, the Mark's seal, the lifetime counters (meta.ts's
 * recordRunEnd)?
 *
 * Two modes say no, for two different reasons, and they are stated together
 * because the question a caller has is one question.
 *
 *  - **Tier S** flies a Mark it never earned, on a rig nobody paid for, from a
 *    bay it never reached. It has said no since it shipped.
 *  - **The Skydeck** is the one that needed finding (PR #124 review).
 *    recordRunEnd ticks the tier at markUnlocked(meta), and markUnlocked
 *    SATURATES at MARK_COUNT — while the Skydeck opens only once the whole
 *    ladder is beaten. So every player who can reach the roof is parked on that
 *    saturated tier, and an unguarded daily win set tierRunDone, banked a tier
 *    milestone's salvage and printed Tier 10 completion copy EVERY DAY. A daily
 *    that pays a once-per-tier reward on repeat is a salvage faucet, and the
 *    seal is worse: recordRunEnd's `sealed` is deliberately not gated on the
 *    Mark being current, so a daily clean run would have claimed the Mark-10
 *    badge for a run flown under rules Mark 10 does not have.
 *
 * A predicate rather than two tests at the call site, because it is the rule
 * and sim/systems.ts has to be able to reach it: the gate lives in main.ts's
 * finishRun, which no harness can call, so what gets pinned is this.
 */
export function tracksLadder(run: RunState): boolean {
  return !run.sandbox && run.skydeck === null;
}

/**
 * What the seal is DOING on this run, or null when the run has no seal question
 * at all (Tier S, the Skydeck — recordRunEnd never seals either).
 *
 * Three states, because there are three truths and the button that reports them
 * had only two. The third was found in review (codex, PR #135): a re-fly of a
 * Mark the player has ALREADY sealed answered "at stake" on a fresh run, so the
 * confirmation claimed a price that cannot be charged and the end card drew an
 * intact seal about to be spent. It cannot be spent. meta.ts's recordRunEnd
 * only ever APPENDS to sealedMarks — a Mark's stamp, once pressed, survives
 * every later run however messy — so on that re-fly a bay retry is free.
 *
 *  - **held** — this Mark's stamp is already on the tower. Nothing this run
 *    does can take it, so a retry costs nothing. Checked FIRST, because it
 *    outranks whatever this run has done: a retried re-fly of a sealed Mark is
 *    still a sealed Mark.
 *  - **at-stake** — the Mark is unsealed and this run has retried no bay, so
 *    the run is still able to seal it and a retry would end that. The only
 *    state that charges anything, and the one the confirmation exists for.
 *  - **spent** — the Mark is unsealed and this run has already retried, so the
 *    chance is gone until the next run. Free from here on.
 *
 * THE RUN'S SEAL AND THE MARK'S STAMP ARE DIFFERENT THINGS, which is the
 * distinction this function exists to keep straight and the one the copy has to
 * respect: "held" is a fact about the MARK and says nothing about this run,
 * while "at-stake" and "spent" are facts about this RUN and say nothing about
 * whether the Mark has ever been sealed. A surface that blurred them would tell
 * a player their re-fly had sealed something.
 *
 * `sealedMarks` is passed rather than reached for — a plain number list, so
 * this module still imports nothing from meta.ts and sim/systems.ts can call it
 * with a literal.
 */
export type SealState = "held" | "at-stake" | "spent";

export function sealStateFor(
  run: RunState, sealedMarks: readonly number[],
): SealState | null {
  if (!tracksLadder(run)) return null;
  if (sealedMarks.includes(run.mark)) return "held";
  return run.restarts === 0 ? "at-stake" : "spent";
}

/**
 * Would retrying a bay of THIS run spend its seal?
 *
 * The question every door into a bay retry asks (main.ts's requestBayRetry —
 * the pause modal's Restart Bay, the held ⏸, the game-over card's Retry Bay).
 * Defined on sealStateFor rather than beside it so the gate and the button
 * cannot disagree about whether a cost is being charged.
 *
 * TRUE AT MOST ONCE PER RUN, which is the property that makes confirming EVERY
 * seal-breaking retry cheap rather than nagging: after the first retry
 * `restarts` is no longer 0, so every later one answers false and goes straight
 * through. The panel therefore appears at most once in a run, exactly at the
 * moment the irreversible thing happens.
 *
 * …and NEVER on a Mark already sealed, which is the half review caught. A
 * confirmation for a free action is worse than none: it teaches the player to
 * click past the panel, and the press it exists to stop is the one that spends
 * something.
 */
export function retryBreaksSeal(run: RunState, sealedMarks: readonly number[]): boolean {
  return sealStateFor(run, sealedMarks) === "at-stake";
}

/** Every standing clause in force on this run's current bay, in arm order.
 *  Empty for a ladder run, which carries its single clause in `final` instead.
 *
 *  A question about a RUN, so it lives here rather than in skydeck.ts — which
 *  is also what lets that module import this one at runtime instead of the
 *  other way round. */
export function standingClauses(run: RunState): FinalId[] {
  if (!run.skydeck) return [];
  return run.skydeck.clauses.filter((c) => c.from <= run.levelIndex).map((c) => c.id);
}

/** Bond Breaker charges a Bond Emitter of `tier` ships for the WHOLE run —
 *  one per tier, so a maxed emitter is three shatters across ten bays. One
 *  function rather than an inline `* 1` in two places: newRun grants it at run
 *  start and buyUpgrade tops it up at a refit, and those two had to agree. */
export function bondChargesFor(tier: number): number {
  return Math.max(0, Math.floor(tier));
}

/** Thaw Lance charges a rack of `tier` issues in ONE grant —
 *  THAW_CHARGES_PER_TIER a tier (upgrades.ts sizes it against the belt).
 *
 *  WHAT A GRANT IS depends on the mode, and that is the whole of the Skydeck
 *  difference: on the ladder a grant is a BAY's rack, re-issued at every bay
 *  boundary; on the Skydeck it is the RUN's, issued once at undock and never
 *  again. One number, two horizons — see advanceRun, where the fork is written,
 *  and skydeck.ts's yard bullet for why the mode has no resupply to offer.
 *
 *  A function rather than an inline multiply for bondChargesFor's exact reason:
 *  three callers had to agree — newRun's grant, buyUpgrade's mid-run top-up and
 *  advanceRun's ladder refill. */
export function thawChargesFor(tier: number): number {
  return Math.max(0, Math.floor(tier)) * THAW_CHARGES_PER_TIER;
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
    restarts: 0,
    // Nothing has ended yet, so nothing has been filed.
    filed: false,
    scrap: startingScrap,
    scrapEarned: startingScrap,
    // No starting-scrap equivalent: nothing has been blown up yet, and
    // nothing has been blown up ON the player either.
    salvagedFunds: 0,
    volatileLosses: 0,
    // ...and nothing has been burned in the hood either.
    incineratedFunds: 0,
    // The whole run's Bond Breaker magazine, granted once. bondChargesFor is
    // the single place the tier-to-charges rule lives, so the refit top-up in
    // buyUpgrade cannot drift from the run-start grant.
    bondCharges: bondChargesFor(loadout.bonds ?? 0),
    // The first grant. On a ladder run advanceRun re-issues this at every bay
    // boundary; on a Skydeck run it is the only one the run will ever get.
    thawCharges: thawChargesFor(loadout.thaw ?? 0),
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
    // A ladder run unless the caller says otherwise, the same shape and the
    // same reason as `sandbox` above: skydeck.ts's skydeckRunFor is the one
    // caller that overrides it.
    skydeck: null,
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
  // …and the Skydeck's STANDING clauses, on every bay from the one each armed
  // on (skydeck.ts). Same seam as the line above and deliberately after it —
  // both are the last layer of conditions, and the two are mutually exclusive
  // by construction (a Skydeck run's `final` is never written, a ladder run's
  // `skydeck` is null), so neither guard has to know about the other.
  applyFinals(cfg, standingClauses(run));
  if (run.levelIndex > 0) cfg.startingFunds = cfg.startingFunds + run.carry;
  cfg.bondBreakerCharges = Math.max(0, run.bondCharges);
  // The Thaw Lance's rack, same seam and the same reason: applyUpgrades already
  // wrote the tier's grant onto this fresh config, and what the RUN has in hand
  // is the number that counts. On the ladder the two agree at every bay start
  // (advanceRun refilled it); on the Skydeck they diverge from the first charge
  // spent, which is the mode's rule and the whole reason this is overwritten
  // rather than left to the config.
  cfg.thawCharges = Math.max(0, run.thawCharges);
  return cfg;
}

/** Cap on the carry-over banked into the next bay's float (see advanceRun).
 *
 *  An UNCAPPED carry was the deep-run exploit: one blowout bay (or one well-
 *  timed Bond Breaker flattening the whole field into multi-lines) banked
 *  enough overshoot to clear the next bay — sometimes the next TWO — on
 *  autopilot, which removed the puzzle entirely. Capped at roughly one clean
 *  line's gross payout, so a bay opened on a full carry starts on the tier's
 *  float plus the cap — $310 at Tier 1, $390 at Tier 10 — against a bay-2
 *  target of $700 to $898: a real head start, and still four-fifths of a bay
 *  left to actually play — the $150 cap is a fifth of Tier 1's bay-2 target and
 *  a sixth of Tier 10's. A strong bay buys tempo — never the next bay. */
export const CARRY_CAP = 150;

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
 *  `volatileLosses` is what volatile detonations charged the just-played bay
 *  for its live cargo (Game.volatileLosses), and defaults to 0 for exactly the
 *  reason salvagedFunds does — same kind of number, same failure mode.
 *
 *  `thawLeft` is the Thaw Lance stock the just-played bay ENDED with
 *  (Game.thawCharges), and it matters on exactly one mode — see the field
 *  below. It takes `bondsLeft`'s defensive default for `bondsLeft`'s reason: a
 *  caller that forgets to thread it leaves a Skydeck pilot's charges alone
 *  rather than silently confiscating them.
 *
 *  `incineratedFunds` is what the Incinerator saved the just-played bay
 *  (Game.incineratedFunds) — a STAT, defaulting to 0 like the other two.
 *
 *  The five trailing arguments are STOCKS and STATS mixed, which is worth
 *  naming because it is the one way this signature can bite: a STOCK
 *  (`bondsLeft`, `thawLeft`) defaults to what the run already holds, and a STAT
 *  (`salvagedFunds`, `volatileLosses`, `incineratedFunds`) defaults to 0. They
 *  are in arrival order rather than grouped by kind on purpose — regrouping
 *  would move `salvagedFunds` and silently re-point every positional caller,
 *  which for a bare number is a bug no type checker can see. The newest one
 *  goes on the END for the same reason, even though it would read better
 *  beside the two stats it belongs with.
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
  volatileLosses = 0,
  thawLeft: number = run.thawCharges,
  incineratedFunds = 0,
): RunState {
  const ratchets: Ratchets = { ...run.ratchets };
  for (const id of pickedAxes) ratchets[id] = (ratchets[id] ?? 0) + 1;
  return {
    seed: run.seed,
    levelIndex: run.levelIndex + 1,
    carry: Math.min(CARRY_CAP, Math.max(0, endedScore - clearedTarget)),
    ratchets,
    linesTotal: run.linesTotal + lines,
    // Accumulated across the whole run, never reset. The seal turns entirely on
    // this surviving a bay boundary: main.ts banks every cleared bay through
    // here (afterBayClear), so a rebuild that dropped the field would hand the
    // badge to a run that restarted bay 1 three times and then went the
    // distance. Spelled out rather than left to a spread for the same reason
    // `sandbox` below is — this function names every field, so anything it
    // omits is zeroed rather than carried.
    restarts: run.restarts,
    // Carried for the same reason, and it is the field a resumed run depends
    // on: a run that lost bay 7, retried it and cleared it has already been
    // filed once, and every bay it clears after that rebuilds it through here.
    // Dropping the flag would re-count the run in the lifetime total the moment
    // it cleared the bay it came back from.
    filed: run.filed,
    scrap: run.scrap + scrapEarned,
    scrapEarned: run.scrapEarned + scrapEarned,
    salvagedFunds: run.salvagedFunds + salvagedFunds,
    volatileLosses: run.volatileLosses + volatileLosses,
    incineratedFunds: run.incineratedFunds + incineratedFunds,
    // Clamped to the stock the run actually held: a bay cannot hand back more
    // charges than it was issued, however it reports its ending count.
    bondCharges: Math.max(0, Math.min(run.bondCharges, Math.floor(bondsLeft))),
    /* THE THAW LANCE'S ONE FORK, and the only place in the file where the two
     * modes are handed different arithmetic on the same field.
     *
     * A LADDER run docks. Its rack is resupplied between bays, so crossing a
     * bay boundary re-issues the tier's whole grant — the per-bay unit the
     * charges were SIZED in (upgrades.ts's THAW_CHARGES_PER_TIER measures each
     * tier against one bay's worth of frozen shipments), and the same shape the
     * Demolition Rack already has by construction.
     *
     * A SKYDECK run does not. skydeck.ts's yard bullet is the rule verbatim —
     * "the rig that undocks is the rig that lands" — and a lance that quietly
     * refilled itself ten times would be a resupply line the mode does not
     * have. So there the grant is the RUN's: it falls as it is spent and it
     * never comes back, exactly like the Bond Breaker magazine above.
     *
     * The clamp is that magazine's, for the same defensive reason: a bay cannot
     * hand back more charges than it was issued, however it reports its ending
     * count. */
    thawCharges: run.skydeck === null
      ? thawChargesFor(run.tiers.thaw ?? 0)
      : Math.max(0, Math.min(run.thawCharges, Math.floor(thawLeft))),
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
    // Carried for exactly the reason `sandbox` above is spelled out: this
    // function rebuilds the run field by field, so a rebuild that dropped this
    // one would turn a Skydeck run into a ladder run at the first bay boundary
    // — the yard would open, the notch quota would double, and the clauses the
    // day wrote would stop applying. The field is required on RunState (not
    // optional) so this line cannot be forgotten here or in any future
    // rebuilder.
    skydeck: run.skydeck,
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
    // The Thaw Lance's top-up, the emitter's rule verbatim: the DIFFERENCE
    // between the two tiers' grants, on top of what is left.
    //
    // It is not redundant on the ladder, which is where it is easy to talk
    // oneself out of it: advanceRun refilled the rack to the OLD tier before
    // this screen opened, so without the delta a player who bought a rung at
    // the yard would undock and fly the next bay on the rack they walked in
    // with. And it must be a delta rather than the new total, so a refit at bay
    // 9 buys the charges the rung ADDS instead of resetting the ones the
    // Skydeck's magazine already spent — a mode this path never runs in today
    // (there is no yard there), and the rule is written so it stays true if one
    // ever opens.
    thawCharges: id === "thaw"
      ? run.thawCharges + (thawChargesFor(tier + 1) - thawChargesFor(tier))
      : run.thawCharges,
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
