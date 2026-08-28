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
 * THE CLOCK — press strokes, never wall time
 *
 * The grade is a pure function of two integer counters the compactor already
 * keeps, and it has to be: `sim/` must reproduce a bay's money bit-for-bit at
 * any frame rate, and the money is now downstream of the grade. Neither `now`
 * (ms) nor `Game.stepCount` appears anywhere in this file.
 *
 *   `Compactor.strokes`     completed full advances — the "sweep" the player
 *                           watches, incremented at the right stop.
 *   `Compactor.halfCycles`  every stop flip, advance and retreat both. The
 *                           finer hand: two per round trip, so equal values
 *                           mean "the bar has not reversed since".
 *
 * Every cube carries the pair it was first seen AT REST at (`Cube.landedStroke`
 * / `Cube.landedHalfCycle`, stamped by lineClear.ts's `stampLandings`). A row's
 * grade reads the MOST RECENT of those over the cubes that filled its slots —
 * the landing that actually closed the row — against the counters as they stand
 * on the step it cleared.
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
 * THE FOUR GRADES, and why the ladder needs no "shortly" constant
 *
 * The brief asked for four bands: immediate, shortly after, after a sweep,
 * after three. The obvious way to split the first two is a step window — "a
 * clear within N physics steps of the landing" — and it would have been a
 * tunable magic number sitting in the middle of the money. The two counters
 * split them for free, because a line can only ever clear while the bar is
 * ADVANCING (game.ts gates `updateLineClear` on `pressing`):
 *
 *  - EXCELLENT — the bar has not reversed since the landing. The row closed
 *    inside the stroke that was ALREADY RUNNING when the shipment came to rest:
 *    the player threaded a moving press. Nothing swept in between, which is
 *    exactly "in the landing's own settlement".
 *  - GOOD — no full sweep has completed since the landing, but the bar has
 *    reversed. The shipment landed on the retreat and the very next press sold
 *    it. Timed to the window rather than into the stroke.
 *  - SWEPT — one or two sweeps have completed since. The row needed the press
 *    to grind it flat. Neutral, and deliberately so: the owner's own note on
 *    this band is *"lucky or planned?"*.
 *  - LUCKY — LUCKY_SWEEPS or more. *"Definitely lucky."* The pile resolved
 *    itself around cargo the player placed three strokes ago.
 *
 * The Excellent/Good split is therefore a fact about the bar's direction, not a
 * tuned tolerance, and it stays true at every Hydraulics tier and every Bay
 * Extension width — both of which change how LONG a stroke takes without
 * changing what one is.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE GRADE DELIBERATELY DOES NOT TOUCH
 *
 * LINE PAYOUTS ONLY. The volatile charge, the slag bounty, the spill fine and
 * the Incinerator's relief are all settlements about CARGO — what it cost to
 * lose it, what it was worth to remove it — and none of them is an act with a
 * moment. Grading them would be grading the pile's weather.
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

/** Where a row's newest contributing cube came to rest, in the compactor's own
 *  two counters. `null` for a cube that has never been at rest — unreachable in
 *  a clear (the row scan only accepts settled cubes) and representable so the
 *  stamping pass has an honest "not yet" to write. */
export interface LandingStamp {
  stroke: number;
  halfCycle: number;
}

/** The compactor's counters as they stand on the step a row cleared. */
export interface ClearClock {
  stroke: number;
  halfCycle: number;
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
  // Equal half-cycles mean the bar has not hit a stop since the landing, so the
  // stroke that cleared the row is the stroke that was already running when the
  // cargo settled. This implies zero completed sweeps by construction —
  // `strokes` only advances at the right stop, which also advances
  // `halfCycles` — so the test is checked first and the sweep count below never
  // has to special-case it.
  if (landing.halfCycle === clock.halfCycle) return "excellent";
  const sweeps = clock.stroke - landing.stroke;
  if (sweeps <= 0) return "good";
  return sweeps < LUCKY_SWEEPS ? "swept" : "lucky";
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
