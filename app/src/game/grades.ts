/**
 * TIMING GRADES — what a row was worth as a piece of PLAY, not just as cargo.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS EXISTS FOR
 *
 * The owner's verdict on the top of the ladder: *"currently the game is not
 * challenging at sky levels in the early part of the run, the maxed out systems
 * carry you over and it's boring."* level.ts's MARK SCALING note already
 * measured why no number on the bay could fix that — *"a fully-kitted rig
 * trivializes the existing ladder, so no multiplier on the ladder's own numbers
 * produces a graded response"* — and its conclusion was that difficulty has to
 * come from CONTENT, from what the rig must DO.
 *
 * A grade is that, applied to the one act the whole game is made of. Every row
 * paid `scorePerLine` regardless of whether the player CLOSED it or merely
 * outlasted it: a shipment threaded into a gap and a pile that collapsed into a
 * line after four strokes of grinding sold for exactly the same money. So the
 * dominant late-game play was to stop aiming, stack, and let the press resolve
 * it — the same shape congestion's `payMult` priced on the SIZE of the pile,
 * read here on the CLOCK instead.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK — three integers, and never the wall clock
 *
 * The grade is a pure function of integer counters, and it has to be: `sim/`
 * must reproduce a bay's money bit-for-bit at any frame rate, and the money is
 * downstream of the grade. `now` — the wall-clock millisecond stamp every FX
 * event carries — appears nowhere in this file and nowhere in the money.
 *
 *   `Compactor.strokes`     completed full advances — the "sweep" the player
 *                           watches, incremented at the right stop.
 *   `Compactor.halfCycles`  every stop flip, advance and retreat both. The
 *                           finer hand: two per round trip, so equal values
 *                           mean "the bar has not reversed since".
 *   `Game.stepCount`        the engine's FIXED step, which is the only clock in
 *                           the game that measures a duration.
 *
 * THE THIRD ONE IS NEW AND IT IS NOT A REGRESSION. An earlier draft of this
 * header said `stepCount` appears nowhere here, and the owner's 100ms window
 * changed that on purpose: a duration cannot be expressed in bar phases. It
 * costs the determinism claim nothing, because `stepCount` is not wall time —
 * engine.ts steps at a fixed STEP_MS whatever the display is doing, and the bar
 * counters above are themselves derived from it. A bay replayed at 30fps, at
 * 144fps or headless takes the same steps in the same order and grades the same
 * rows. What WOULD break the claim is differencing `now`, and nothing does.
 *
 * Every cube carries the three it was first seen AT REST at (`Cube.landedStroke`
 * / `landedHalfCycle` / `landedStep`, stamped by lineClear.ts's
 * `stampLandings`). A row's grade reads the landing that actually CLOSED it —
 * the newest over the cubes that filled its slots, or the shipment resting on
 * top of them in the impact-assist case (lineClear.ts's `rowClaim`) — against
 * the counters as they stand on the step it cleared.
 *
 * WHY FIRST REST AND NEVER AGAIN. A cube knocked back into the air by a blast,
 * a shatter kick or a neighbour re-settles with its ORIGINAL stamp, so it still
 * reads as the old cargo it is. The alternative — re-stamping on every
 * re-settle — would let a player refresh a stale pile's clock by disturbing it,
 * which is the one thing a timing grade must not be able to be told to forget.
 * The bias runs conservative in every case: disturbed cargo can only ever grade
 * a row DOWN.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR GRADES — the owner's own four sentences, in his own units
 *
 * The first shipped ladder split the top two bands on the BAR'S DIRECTION and
 * needed no tolerance constant to do it, which was elegant and which the owner
 * then measured against the thing that actually matters — how a clear FEELS:
 *
 *   *"shorten window for excellent, it should be within like 100ms from
 *   landing the line completes with that piece"*
 *   *"if the piece lands when the compactor is moving right and then clears,
 *   it's good"*
 *
 * Those two sentences are the ladder now, and the second of them is EXACTLY
 * the predicate the old top band used. So the change is not a rewrite: the old
 * EXCELLENT rule kept its meaning and moved down one rung to become GOOD, and a
 * genuinely tighter rule was put above it.
 *
 *  - EXCELLENT — the row completed within EXCELLENT_WINDOW_MS of the landing
 *    that closed it. Measured in the engine's own fixed steps (see STEP_MS), so
 *    it is a real duration and not a phase of the bar. This is the band for the
 *    shipment that DROPS INTO A READY ROW: the clear check runs on every
 *    pressing step, so a row that was one cube short sells on the step the cube
 *    arrives, and one that still needs grinding does not.
 *  - GOOD — the piece landed while the bar was moving right, and the row
 *    cleared on THAT SAME rightward stroke. The player timed the launch into
 *    the approaching sweep; the sweep still had to finish the job.
 *  - SWEPT — the press had to bring it in: a landing on the retreat that the
 *    next press sold, or one to two completed sweeps. Neutral, and deliberately
 *    so: the owner's own note on this band is *"lucky or planned?"*.
 *  - LUCKY — LUCKY_SWEEPS or more. *"Definitely lucky."* The pile resolved
 *    itself around cargo the player placed three strokes ago.
 *
 * WHY "ON THAT SAME STROKE" IS `landing.halfCycle === clock.halfCycle`, and why
 * GOOD therefore still needs no direction field. A row can only clear while the
 * bar is ADVANCING (game.ts gates `updateLineClear` on `pressing`). A cube that
 * landed during a RETREAT cannot be cleared without the bar first hitting its
 * open stop, and that stop ticks `halfCycles`. So equal half-cycles say both
 * halves of the owner's sentence at once — the landing was on a rightward
 * stroke, and no stop has happened since, i.e. it is still that same stroke.
 * One integer comparison, no new state, and it stays true at every Hydraulics
 * tier and every Bay Extension width: both change how LONG a stroke takes
 * without changing what one is.
 *
 * WHY EXCELLENT IS NOT REQUIRED TO BE A SUBSET OF GOOD. A slam can land on the
 * tail of a retreat, flip, and be crushed inside the window — leftward landing,
 * hundred-millisecond clear. The owner's EXCELLENT sentence says nothing about
 * direction and this one does not either: the window is the primary definition
 * and it is checked FIRST. That case is rare, it is unambiguously the play the
 * band is for, and refusing it would be preferring the old heuristic to the
 * measurement it was approximating.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE GRADE DELIBERATELY DOES NOT TOUCH
 *
 * LINE PAYOUTS ONLY. The volatile charge, the slag bounty, the spill fine and
 * the Incinerator's relief are all settlements about CARGO — what it cost to
 * lose it, what it was worth to remove it — and none of them is an act with a
 * moment. Grading them would be grading the pile's weather.
 *
 * ---------------------------------------------------------------------------
 * THE TWO GATES — a band is a verdict on a SHOT, so the clock is not enough
 *
 * The clock says WHEN a row closed. Two further facts decide whether the row is
 * the player's to be paid a premium for, and both of them cap at
 * CONGESTION_GRADE_CAP (SWEPT) rather than at the bottom of the ladder:
 *
 *  - CONGESTION. A bay over its first pile knee cannot sell a row as EXCELLENT
 *    or GOOD however it was closed — the owner's rule, and the one that removes
 *    an inversion the ladder had shipped with (see CONGESTION_GRADE_CAP).
 *  - PARTICIPATION. The shipment the player just launched has to be IN the row,
 *    or resting on it (see RowParticipation). A row the press found on its own
 *    is not a shot, and the clock cannot tell the two apart on its own.
 *
 * PARTICIPATION ALSO DECIDES WHICH LANDING THE CLOCK IS MEASURED FROM, which
 * is what makes the impact-assist case work at all under a 100ms window: the
 * row's own cubes are stale by construction there, and the landing that closed
 * the row is the shipment that came down ON it. lineClear.ts's `rowClaim`
 * returns that landing alongside the verdict for exactly this reason.
 *
 * SCRAP IS UNGRADED, and that is the design rather than an omission. The two
 * currencies are already split by horizon (run.ts: funds are the bay's
 * operating budget, scrap is capital that only ever becomes ship), and the
 * grade splits them by AXIS as well: **skill pays funds, volume pays scrap.**
 * A player who fires more shots to manufacture more rows earns more scrap at
 * exactly the flat `scrapPerLine` they always did, and pays for it out of the
 * bankroll the raised target is measured against. See design/balance/
 * timed-clears.md §4 for the funds→scrap exchange rate that falls out of it,
 * and for the modelled alternative (grade scaling scrap too) that was rejected
 * because it makes the strong run stronger on both axes at once.
 */

/** The four bands, best first. Ordered so `GRADES.indexOf` is a ranking and the
 *  tally prints in the order a player earns them. */
export type ClearGrade = "excellent" | "good" | "swept" | "lucky";

export const GRADES: readonly ClearGrade[] = ["excellent", "good", "swept", "lucky"];

/**
 * Completed sweeps at which a row stops being SWEPT and becomes LUCKY.
 *
 * Three, and it is the owner's number rather than a measured one: *"after 3
 * sweeps (definitely lucky)"*. It is named here because it is the one boundary
 * in this file a play pass can move without re-deriving anything — the
 * Excellent/Good split is structural (see the header) and the two ends of the
 * ladder are not boundaries at all.
 */
export const LUCKY_SWEEPS = 3;

/**
 * THE ENGINE'S FIXED STEP, in milliseconds.
 *
 * It lives in this file rather than in engine.ts, which is where it is actually
 * taken, because this is the only place in the game that has to convert a
 * REAL-WORLD DURATION into steps — the owner's hundred milliseconds — and a
 * conversion whose two halves live in different modules is a conversion free to
 * drift. engine.ts and game.ts import it from here so there is exactly one
 * 1000/60 in `src/`, and sim/systems.ts pins that the physics step and the
 * grade's step are the same number.
 */
export const STEP_MS = 1000 / 60;

/**
 * HOW LONG A ROW MAY TAKE TO CLOSE AND STILL BE EXCELLENT.
 *
 * The owner's number and his own hedge: *"it should be within like 100ms from
 * landing the line completes with that piece."* "Like 100ms" is a feel, so this
 * is a named tunable and the one boundary in this file a play pass is most
 * likely to move — the same status LUCKY_SWEEPS has.
 *
 * MEASURED BEFORE IT WAS BELIEVED, and the measurement said the band is not
 * sensitive to the exact number in the way a tolerance usually is. The clear
 * check runs on EVERY pressing step, so a row that is one cube short of
 * complete sells on the step that cube settles: the elapsed time between the
 * closing landing and the sale is not a smooth distribution to threshold, it is
 * a spike at nearly zero (the row was ready) and a long tail at whole strokes
 * (the row needed grinding). design/balance/timed-clears.md §2h carries the
 * census at 100ms and at 150ms. 100 stands.
 */
export const EXCELLENT_WINDOW_MS = 100;

/**
 * ...the same window in the integers the grade is actually computed on.
 *
 * Exactly 6 at STEP_MS = 1000/60 (6 x 16.667 = 100.0), which is a coincidence
 * worth naming: the owner's round number lands on a whole step, so the
 * threshold needs no argument about which side of a tick to round toward. The
 * comparison is INCLUSIVE (`elapsed <= this`), so a row closed exactly 100ms
 * after its landing is EXCELLENT — "within 100ms" reads as "no more than", and
 * the alternative would make the owner's own number the first value that fails.
 */
export const EXCELLENT_WINDOW_STEPS = Math.round(EXCELLENT_WINDOW_MS / STEP_MS);

/** Where a row's newest contributing cube came to rest, in the compactor's own
 *  two counters. `null` for a cube that has never been at rest — unreachable in
 *  a clear (the row scan only accepts settled cubes) and representable so the
 *  stamping pass has an honest "not yet" to write. */
export interface LandingStamp {
  stroke: number;
  halfCycle: number;
  /** `Game.stepCount` at the landing — the fixed-step clock the EXCELLENT
   *  window is measured in. */
  step: number;
}

/** The counters as they stand on the step a row cleared. Structurally the same
 *  three integers a `LandingStamp` carries, and deliberately a separate type:
 *  one is a fact about a cube and the other a fact about a step, and a function
 *  that took either would be a function that could be handed the wrong one. */
export interface ClearClock {
  stroke: number;
  halfCycle: number;
  step: number;
}

/**
 * EVERYTHING THE GRADE NEEDS ABOUT THE STEP — one named argument.
 *
 * `updateLineClear` takes this instead of a clock plus a boolean plus a number,
 * and the bundling is the point rather than tidiness. The three fields are
 * sampled at three different places in game.ts's step and every one of them has
 * a wrong neighbour a step away (§2c's fencepost was exactly that mistake made
 * with ONE of them). A caller that has to name all three cannot supply two and
 * inherit a default for the third, and no two of them can be transposed.
 */
export interface ClearContext {
  /** The step's sampled counters — game.ts's `stepClock`, read once before the
   *  bar moved. See `gradeForRow`. */
  clock: ClearClock;
  /** Was the bay congested at the top of this step? game.ts's `stepPileTier`
   *  — the same reading `payoutMult` is given. See CONGESTION_GRADE_CAP. */
  congested: boolean;
  /** The id of the most recently LAUNCHED shipment (game.ts's `shipmentSeq`),
   *  which is what `RowParticipation` is measured against. 0 before a bay's
   *  first launch, which no cube carries, so an opening pile the player never
   *  fired into cannot sell a timed row. */
  shipment: number;
}

/**
 * The grade of one row, from its newest contributing landing and the clock.
 *
 * A pure function of four integers, which is the whole determinism claim: the
 * same bay replayed at 30fps, 60fps or headless in `sim/` produces the same
 * four integers on the same step and therefore the same money.
 *
 * `landing` of null grades LUCKY rather than EXCELLENT. It cannot happen in a
 * real clear — `stampLandings` runs before the row scan and the row scan only
 * accepts cubes already at rest — and the direction of the fallback is the one
 * a total function should take: an unknown landing is not a good one.
 */
export function gradeForRow(landing: LandingStamp | null, clock: ClearClock): ClearGrade {
  if (!landing) return "lucky";
  // EXCELLENT — the owner's window, and it is checked FIRST because it is the
  // primary definition rather than a refinement of the one below it. A landing
  // on the tail of a retreat that gets crushed six steps later is inside the
  // window and outside GOOD's predicate, and the window wins.
  if (clock.step - landing.step <= EXCELLENT_WINDOW_STEPS) return "excellent";
  // GOOD — "lands when the compactor is moving right and then clears". Equal
  // half-cycles mean the bar has not hit a stop since the landing, so the
  // landing was on the advance AND the stroke that cleared the row is that same
  // advance. This implies zero completed sweeps by construction — `strokes`
  // only advances at the right stop, which also advances `halfCycles` — so the
  // sweep count below never has to special-case it.
  if (landing.halfCycle === clock.halfCycle) return "good";
  const sweeps = clock.stroke - landing.stroke;
  // Everything the press had to bring in. `sweeps === 0` here is the landing
  // that happened during a RETREAT and was sold by the very next press: it used
  // to be GOOD and is now SWEPT, because the owner's GOOD sentence asks for a
  // rightward landing and that is not one.
  return sweeps < LUCKY_SWEEPS ? "swept" : "lucky";
}

/**
 * THE BEST BAND A CONGESTED BAY CAN SELL — the skill premium's one hard gate.
 *
 * The owner's rule, verbatim: *"no excellent or good should be awarded while in
 * congestion. we need to punish congestion."*
 *
 * SWEPT rather than LUCKY, and the anchor is why. SWEPT pays exactly 1 (see
 * GRADE_PAY), so the cap does not INVENT a penalty — it withdraws a premium. A
 * congested bay still sells its rows for what a row has always been worth, and
 * congestion's own four pressures (level.ts's PILE_TIERS) do the charging on
 * top: the launch costs more, the reload is slower, the combo broke on the way
 * in, and `payMult` takes a quarter or a half off the sale. Capping at LUCKY
 * instead would have priced the mess twice in the same number, and it would
 * also have made the gate a LOSS BUTTON — a bay that congests at the wrong
 * moment would stop being able to pay for its own shots (grades.ts's table:
 * a LUCKY row nets −$17 at Tier 10). The floor rule the ratchet axes obey
 * (hazards.ts: an axis that can reach an unplayable bay is a lose button)
 * applies to a payout ceiling for exactly the same reason.
 *
 * THE LATE RUNG STAYS REACHABLE BELOW IT. A stale row cleared in a congested
 * bay still grades LUCKY and still costs money. The cap is a ceiling, not a
 * value: it can only ever move a grade DOWN, and it never touches a row that
 * was already at or under it.
 */
export const CONGESTION_GRADE_CAP: ClearGrade = "swept";

/**
 * HOW A ROW TOOK PART IN ITS OWN CLEAR — the second gate on the premium.
 *
 * The owner's rule: *"the piece that has just been launched need to be part of
 * the line."* A timing band is a verdict on a SHOT, and a row the current
 * shipment had nothing to do with is not a shot's row: the press found it. The
 * clock alone cannot tell those apart, because a cube that has been sliding
 * around the pile for four strokes is stamped the moment it finally settles,
 * and that stamp reads exactly like a shipment threaded into a moving press.
 *
 *  - `"in-row"` — a cube of the latest shipment fills one of this row's slots.
 *    The ordinary case, and the one the brief describes.
 *  - `"impact"` — no cube of the shipment is IN the row, but one is resting
 *    directly on top of it. The owner's second case, verbatim: *"the piece
 *    lands above a cube that couldn't form a line unless the weight of the
 *    impact actually pushed it down at the right time as the compactor
 *    triggered the line. I've had that a couple of times, it was amazing and
 *    should be rewarded."* See lineClear.ts's `rowParticipation` for what is
 *    and is not claimed by this branch — it is a CONFIGURATION plus a timing,
 *    not a proof of causation, and design/balance/timed-clears.md §2g says so
 *    at length.
 *  - `"none"` — nothing of the current shipment is in the row or over it. The
 *    press closed a row the player was not working on.
 */
export type RowParticipation = "in-row" | "impact" | "none";

/** The two gates a timed band has to pass on top of the clock. Named fields
 *  rather than two positional booleans: they are both booleans, they are both
 *  about the same row, and a transposition would silently swap two rules
 *  (run.ts's positional-tail note is the standing warning). */
export interface GradeGates {
  /** Congestion in force at the top of the step this row cleared — game.ts's
   *  `stepPileTier`, the same reading `payoutMult` is handed. */
  congested: boolean;
  /** How the launched shipment took part in the row (see RowParticipation). */
  participation: RowParticipation;
}

/**
 * `grade` as the bay is allowed to SELL it — the awarded band.
 *
 * TWO GATES, ONE CEILING. Congestion and non-participation are different
 * failures — one is a bay you lost control of, the other is a row you did not
 * close — and they cap at the SAME rung on purpose. Both are statements that
 * the row was not a shot's row, and CONGESTION_GRADE_CAP's argument (a cap is a
 * withdrawn premium, never an invented penalty) applies unchanged to the
 * second: an unparticipated row pays what a row has always paid, and a stale
 * unparticipated row still falls through to LUCKY on the clock alone.
 *
 * A pure function of the raw band and two booleans, deliberately: the whole
 * question of WHEN each gate is read is settled by the caller (lineClear.ts's
 * `updateLineClear`, from game.ts's `stepPileTier` and `shipmentSeq`). The
 * sampling moments are argued in design/balance/timed-clears.md §2e and §2f;
 * what matters here is that there is exactly ONE of each and this function does
 * not get a second opinion about either.
 *
 * Written as a rank comparison over GRADES rather than as equality tests
 * against "excellent" and "good". The ladder is ordered best first, so
 * `Math.max` on the index is "the worse of the two bands" — which stays correct
 * if a fifth band is ever inserted anywhere in it, where
 * `raw === "excellent" || raw === "good"` would silently start leaking the new
 * one through.
 */
export function awardedGrade(raw: ClearGrade, gates: GradeGates): ClearGrade {
  if (!gates.congested && gates.participation !== "none") return raw;
  return GRADES[Math.max(GRADES.indexOf(raw), GRADES.indexOf(CONGESTION_GRADE_CAP))];
}

/**
 * THE PAY LADDER — a SPREAD around today's economy, not an inflation of it.
 *
 * `swept` is exactly 1, and that anchor is the single most load-bearing number
 * in this file. Two readings of it, and they agree:
 *
 *  - IT IS THE NEUTRAL GRADE IN THE OWNER'S OWN WORDS ("lucky or planned?").
 *    The band nobody can tell apart from luck is the band that should pay what
 *    a row has always paid.
 *  - IT IS WHAT KEEPS THE MID-LADDER STILL. A rig at Tier 4 clearing mostly
 *    SWEPT rows meets byte-identical money to the one it met before this
 *    change, so "early and mid tiers stay approachable" is true BY
 *    CONSTRUCTION rather than by a sweep that happened to come back flat. The
 *    measured grade census (design/balance/timed-clears.md §2) is what says
 *    that band really is where mid-ladder bot play lives; the anchor is what
 *    makes the claim cheap to hold.
 *
 * The alternative shape — LUCKY at 1 and everything above it paying a premium
 * — was modelled and rejected in §3 of the findings. It is the same ladder plus
 * 43% inflation on every bay in the game, so it makes the bottom of the ladder
 * EASIER unless every tier's target rises with it, and the brief's constraint
 * is the opposite: the boredom is the endgame, not the ladder's middle.
 *
 * THE SPREAD ITSELF. 1.5 / 1.2 / 1.0 / 0.7 — symmetric about the anchor at the
 * ends (+0.5 / -0.3 is not symmetric in ratio, and deliberately: see below) and
 * sized against the one arithmetic fact that decides whether volume is a
 * strategy or an exploit. At Tier 10 a launch is $30 and a line takes a
 * measured ~2.9 launches (contracts.ts's PLANNING_EFFICIENCY), so a row costs
 * ~$87 to manufacture against a $100 base rate:
 *
 *   grade      pays (bay 1, T10)   nets per row   what the play is
 *   excellent  $150                +$63           precision funds the run
 *   good       $120                +$33           still clearly worth it
 *   swept      $100                +$13           the thin margin it always was
 *   lucky       $70                -$17           volume COSTS money
 *
 * The bottom row is the design. Spam-firing ungraded rows for their flat
 * `scrapPerLine` is not banned and not free: it is a REAL conversion of funds
 * into capital, priced at roughly $8.50 a scrap at the top of the ladder, and
 * it is paid out of exactly the bankroll the raised target is measured against.
 * That is what makes "burn money to make more lines" a strategy rather than an
 * exploit — and it is why LUCKY had to go BELOW 1 rather than merely stop
 * rising. At 1.0 the same play is free.
 *
 * WHY THE TOP IS NOT SYMMETRIC WITH THE BOTTOM. A ratio of 1.5/0.7 is 2.14,
 * which is the whole dynamic range of the mechanic; the alternative pair the
 * sweep tried (1.35 / 0.8, range 1.69) left maxed-rig sweep play clearing the
 * raised Tier-10 targets anyway — the premium was not enough to pay for the
 * raise, so the raise was just a difficulty tax on everybody. See §5.
 */
export const GRADE_PAY: Record<ClearGrade, number> = {
  excellent: 1.5,
  good: 1.2,
  swept: 1,
  lucky: 0.7,
};

/** What one row of `grade` pays, before the combo/congestion multiplier.
 *
 *  Rounded PER ROW rather than on a clear's total, and that is the same ruling
 *  `chargeAfterRelief` makes for the Incinerator one file over: a multi-row
 *  crush is several sales at several rates, and totalling before rounding would
 *  make a row's price depend on what it happened to clear alongside. */
export function gradedLinePay(scorePerLine: number, grade: ClearGrade): number {
  return Math.round(scorePerLine * GRADE_PAY[grade]);
}

/** Per-bay / per-run count of rows sold at each grade. */
export type GradeTally = Record<ClearGrade, number>;

/** A tally with nothing in it. A function rather than a shared constant: this
 *  is handed to run state and to Game, and one shared mutable object would let
 *  a bay's count leak into the run's. */
export function newGradeTally(): GradeTally {
  return { excellent: 0, good: 0, swept: 0, lucky: 0 };
}

/** `a + b`, field by field. Used where a bay's tally is banked into the run's
 *  (run.ts's advanceRun) — never mutates either argument. */
export function addGradeTally(a: GradeTally, b: GradeTally): GradeTally {
  const out = newGradeTally();
  for (const g of GRADES) out[g] = a[g] + b[g];
  return out;
}

/** Rows counted in a tally. */
export function gradeTallyTotal(t: GradeTally): number {
  let n = 0;
  for (const g of GRADES) n += t[g];
  return n;
}

/**
 * The share of a tally's rows that were TIMED — excellent or good.
 *
 * The single statistic the balance sweeps are steered by, so it is defined once
 * here rather than re-derived in each of them. 0 for an empty tally, which is
 * the honest answer for a bay that never cleared anything (a NaN would
 * propagate into a table and read as a measurement).
 */
export function timedShare(t: GradeTally): number {
  const n = gradeTallyTotal(t);
  return n > 0 ? (t.excellent + t.good) / n : 0;
}
