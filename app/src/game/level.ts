import type { PieceSize, PieceType } from "./theme";

/**
 * A single level's tunables. This is the primary ROADMAP SEAM: future levels and
 * roguelite modifiers (gravity flips, faster compactors, custom bags, mutators)
 * slot in by adding more LevelConfig entries — no gameplay code changes required.
 */
export interface LevelConfig {
  id: number;
  name: string;
  /** Downward gravity (matter units, per-step scaled internally). */
  gravity: number;
  /** Compactor sweep speed in px/step (same pace advancing and retreating). */
  compactorSpeed: number;
  /** Compaction-zone width (in cells, face-to-wall) at the open/left stop —
   *  how wide the gap is when the compactor is fully retreated. Tunable roadmap
   *  seam: a "wider bay" modifier just raises this. */
  compactorOpenCells: number;
  /** Compaction-zone width (in cells) at full advance (right stop) — this is
   *  also the minimum cube count for a full line, since a line must span the
   *  whole zone. Tunable roadmap seam: a "harder line" modifier lowers this. */
  compactorMinLineCells: number;
  /** Compactor bar thickness (px). */
  compactorWidth: number;
  /** Compactor bar height, as a fraction of world height (bottom-anchored;
   *  pieces are lofted over its top). */
  compactorHeightFrac: number;
  /** Joint breaking point: a piece's distance joint snaps once stretched
   *  beyond restLength * this factor. Tunable roadmap seam: "fragile pieces"
   *  modifiers lower this, "sturdy pieces" raise it. */
  jointBreakStretch: number;
  /** Points awarded per cleared line. */
  scorePerLine: number;
  /** Penalty per piece that decays on the wrong side of the compactor. */
  penaltyPerLostPiece: number;
  /** Points needed to clear the level. */
  targetScore: number;
  /** Bankroll at level start — the single currency doubling as score. A flat
   *  per-bay float; only the prior bay's overshoot carries on top for
   *  levelIndex > 0 (see run.ts's levelForRun/RunState.carry). Tunable
   *  roadmap seam: a "hard mode" modifier just lowers this. */
  startingFunds: number;
  /** Cost deducted per shot fired; you cannot fire once your funds drop below
   *  this. Tunable roadmap seam: an "expensive ammo" modifier raises this. */
  launchCost: number;
  /** Fixed piece order (sequential, like the original). null => 7-bag shuffle later. */
  pieceSequence: PieceType[] | null;
  /** Fire cooldown in ms. */
  cooldownMs: number;
  /** Countdown for the level, in seconds; 0 = no limit. A roguelite-run knob:
   *  later levels (and "overclock"-style modifiers) tighten this to raise
   *  pressure independent of the bankroll target. */
  timeLimitSec: number;
  /** Matter constraint stiffness for a piece's inter-cube joints (0-1). Higher
   *  holds a piece together more rigidly under impact; a "sturdy" modifier
   *  raises this alongside jointBreakStretch. */
  jointStiffness: number;
  /** Payload size class of every launched shipment — see theme.ts's PieceSize
   *  and pieces.ts's SIZE_SPEC. Drives cube count, per-cube DENSITY and joint
   *  fragility together, so "tiny" isn't just "smaller" (it's also lighter and
   *  more brittle) and "bulk" isn't just "bigger" (it's also heavier and more
   *  rigid). The Micro/Bulk Shipments modifiers set this. */
  pieceSize: PieceSize;
  /** Demolition charges granted at the START of this bay — armed with the 💥
   *  control, then fired by the next launch INSTEAD of the loaded piece (see
   *  game.ts's armBomb/shoot). Charges are free to fire (they do NOT cost
   *  launchCost) and each cube they vaporize refunds salvagePerCube, which is
   *  what makes a bomb an economically legible SALVAGE tool rather than the
   *  old pay-full-price-for-nothing cadence shot: you trade line material you
   *  were never going to complete for funds back. 0 = the player never drafted
   *  them. */
  bombCharges: number;
  /** Funds refunded per cube a demolition charge vaporizes (see game.ts's
   *  detonate). The economic core of the bomb: a junk pile that can never
   *  complete a line is still worth something. */
  salvagePerCube: number;
  /** Magnitude cap (px/step^2) on this bay's lateral wind. Each bay rolls a
   *  steady AVERAGE wind in [-windMax, +windMax] once from the run seed (see
   *  game.ts's windAvg), then the live wind drunk-walks gently around that
   *  average (windGust per step, mean-reverting on a ~5s timescale — see
   *  game.ts's WIND_TAU_SEC/WIND_REVERT) rather than sweeping a full sine.
   *  0 disables the mechanic entirely (inert: windNow is always 0). Tunable
   *  roadmap seam: the core counter to "fire the same direction forever" —
   *  see the BALANCE KNOBS note below. */
  windMax: number;
  /** Per-step size of the wind's random drunk-walk (px/step^2) — see
   *  makeBaseLevel, which sizes this as windMax * WIND_GUST_FRACTION so the
   *  gust "texture" stays a fixed fraction of the bay's prevailing-wind cap
   *  (~17.7% stationary std at the tuned WIND_GUST_FRACTION/WIND_TAU_SEC —
   *  see game.ts's WIND_REVERT comment for the exact formula) instead of a
   *  flat magnitude that would dwarf a low bay's windMax while reading as
   *  flat at a high one. The live wind nudges by up to ±windGust each
   *  physics step and is gently pulled back toward the bay's rolled average
   *  over a ~5s decorrelation time (game.ts's stepWind), so it gusts around
   *  a learnable baseline instead of oscillating extreme-to-extreme or
   *  re-rolling every fraction of a second. Ignored when windMax is 0. */
  windGust: number;
  /** Muzzle-speed multiplier from the LAUNCHER upgrade track (see
   *  upgrades.ts). 1 = stock. Scales both ends of the cannon's speed range
   *  (cannon.ts's speedMin/speedMax), so a powered launcher reaches deeper
   *  into the bay at the SAME drag distance rather than just raising the cap.
   *  Together with windAssist this is the sanctioned counter to a bay whose
   *  rolled headwind would otherwise put the back of the field out of reach. */
  launchPower: number;
  /** Fraction of this bay's wind cancelled by the launcher's stabilizer
   *  (0 = none, 0.6 = 60% cancelled), from the LAUNCHER upgrade track. Applied
   *  to the LIVE wind before it touches anything — airborne pieces, the dotted
   *  preview and the HUD gauge all read the same post-assist number (see
   *  game.ts's windEffective), so the arc the player is shown is the arc they
   *  get. This is the fix for "a hard against-wind bay is unwinnable": the
   *  weather still has a character, the ship can be upgraded to fight it. */
  windAssist: number;
  /** Multiplier on the compaction settle assist's grind/pull rates (see
   *  lineClear.ts's settleZoneCubes), from the HYDRAULICS upgrade track.
   *  1 = stock. A stronger press squares up a messy pile faster, which is what
   *  turns "nearly a line" into a payout before the stroke ends. */
  settleAssist: number;
  /** Scrap earned per cleared line, and per bay cleared — the IN-RUN currency
   *  spent on ship upgrades at refit stops (see run.ts / upgrades.ts). Kept on
   *  the level (not hardcoded in Game) so a future mod can trade funds for
   *  scrap or vice versa. */
  scrapPerLine: number;
  scrapPerBay: number;
  /** Autoloader interval in ms; 0 = off (the default — the player fires every
   *  shot by hand). When set, the cannon fires ITSELF this often at a
   *  randomized aim within a band around the player's current one (see
   *  game.ts's stepAutoLaunch) — fast, cheap and probabilistic instead of
   *  aimed. The endgame of the tiny/micro build: volume over precision, which
   *  only pays off if you can flatten the resulting mess (Bond Breakers). */
  autoLaunchMs: number;
  /** Compactor PRESS strokes this bay allows; 0 = unlimited, which is every
   *  Deep Run bay. This is the constraint CONTRACTS run on instead of a clock
   *  and a bankroll (see docs/DESIGN.md): with launches free and no countdown,
   *  a Contract would otherwise be brute-forceable by firing until the pile
   *  happens to resolve. Strokes are also the readable unit — "clear this in 6
   *  strokes" is a thing you can plan against in a way a countdown isn't, and
   *  it is a constraint on the compactor, which is the system that most needed
   *  to become something the player thinks about. */
  strokeBudget: number;
  /** Lines needed to clear a CONTRACT; 0 = this bay is won on funds
   *  (targetScore), which is the Deep Run condition. Contracts carry no
   *  bankroll, so funds can't be their objective. */
  objectiveLines: number;
  /** Bond Breaker charges granted at the START of this bay — the "shatter
   *  every joint on the field into loose cubes" special ability (see game.ts's
   *  useBondBreaker). 0 = the player never drafted it. Each charge is a
   *  one-shot use; the count refreshes every bay because run.ts's levelForRun
   *  re-applies the drafted mods onto a fresh base each bay (the Bond Breaker
   *  mod just increments this — see mods.ts). Tunable roadmap seam: a future
   *  "efficient charges" boon could grant more per bay. */
  bondBreakerCharges: number;
}

// Economy balance note: each bay is its OWN economy now — targetScore,
// launchCost, and scorePerLine are all PER-BAY (not cumulative), and only
// the surplus banked above a cleared bay's target carries into the next one
// (see run.ts's RunState.carry / advanceRun). At Launch Bay (i=0) a perfect
// 8-cube line costs 2 shots ($50) for a $100 payout, so clean play nets
// $50/line toward the $800 target from a $250 float. Late bays cost more per
// shot but pay out faster: scorePerLine ramps +10/bay against launchCost's
// +2/bay, so a bay-10 (i=9) line costs 2 x $43 = $86 for a $190 payout — net
// +$104/line, comfortably ahead of bay 1's +$50. The existing $25+2i
// lost-piece penalty and wasted shots (cooldown-gated misses cost nothing,
// only fired shots do) are what can still put a bay out of reach.
const LEVEL_NAMES = [
  "Launch Bay", "Cargo Dock", "Freight Yard", "Assembly Line", "Foundry",
  "Cryo Bay", "Reactor Deck", "Orbital Ramp", "Gravity Well", "Compactor Core",
] as const;

/** Per-bay funding target for level i (0-based): 800 + 150*i. Per-bay (not
 *  cumulative) because each bay is its own economy — only the overshoot
 *  above this target carries into the next bay's float (see run.ts's
 *  RunState.carry), not the whole ending score. */
function targetScoreFor(i: number): number {
  return 800 + 150 * i;
}

/**
 * BALANCE KNOBS — first-pass numbers meant to be tuned from playtesting, not
 * hand-edited per level. The 10-level ladder (LEVELS below) is just
 * `makeBaseLevel(0..9)`; a modifier draft (mods.ts) then layers on top of
 * whichever base level is current.
 *
 * - jointBreakStretch grows with i: the core difficulty ramp, pieces get
 *   progressively harder to shatter apart from bad landings.
 * - jointStiffness edges up too (capped at 0.98) so joints stay crisp instead
 *   of rubbery as break-resistance rises.
 * - compactorSpeed and penaltyPerLostPiece creep up so later levels punish
 *   sloppy play faster and harder.
 * - targetScore (800 + 150i), launchCost (25 + 2i), and scorePerLine
 *   (100 + 10i) are all PER-BAY floats, not cumulative — startingFunds stays
 *   a flat $250 float every bay (see run.ts's levelForRun), with only the
 *   prior bay's overshoot (RunState.carry) stacked on top. scorePerLine
 *   ramping (+10/bay) faster than launchCost (+2/bay) keeps a clean line's
 *   net payout growing bay-over-bay instead of bleeding out late (bay 10: a
 *   2-shot line costs $86, pays $190).
 * - timeLimitSec grows slower than targetScore (10s/level vs. +150/level),
 *   so time pressure keeps rising relative to how much a bay actually needs
 *   to bank.
 * - windMax is the core counter to "fire the same direction forever", now
 *   introduced only AFTER the player has the fundamentals down. The first
 *   three bays (i < 3) are dead calm (windMax 0) so new players learn the
 *   slingshot, economy, and compactor with no lateral force at all. Weather
 *   then rolls in GENTLY from bay 4 (i === 3) at 0.06 and ramps +0.04/bay to
 *   0.30 at bay 10 (i === 9) — a fraction of the old flat-high ladder that
 *   playtesters flagged as unfair.
 * - The mechanic itself changed shape (see game.ts's stepWind): instead of a
 *   deterministic sine sweeping the full ±windMax every windPeriodSec, each
 *   bay rolls ONE steady average wind in [-windMax, +windMax] from the run
 *   seed, and the live wind drunk-walks around it by ±windGust per step with
 *   a gentle pull back toward that average. So a bay has a *character* ("a
 *   light breeze from the left") the player can read once and compensate for
 *   shot-to-shot, with small gusts for texture — rather than a sine that
 *   forces every shot to re-solve against a constantly reversing force. This
 *   is deliberately fairer to a human: the wind is learnable, not a coin
 *   flip on each launch. The drunk walk is seeded (Game's seed ^ bay id) so a
 *   given run/bay always plays the exact same weather, and a Restart Bay
 *   replays it identically — determinism the sim harness still relies on.
 * - windGust is sized here as windMax * WIND_GUST_FRACTION rather than a flat
 *   number, and the per-step revert (game.ts's WIND_REVERT) is derived from
 *   a named seconds-scale time constant (WIND_TAU_SEC ≈ 5s) instead of a
 *   bare per-step fraction. This fixes a real bug: the wind used to decorrelate
 *   with tau ≈ 0.33s (re-rolling ~3x/sec, ~6x within one flight) because
 *   WIND_REVERT=0.05 was tuned as if it were a per-second rate but was
 *   actually applied per PHYSICS STEP at 60/sec — an order-of-magnitude
 *   timescale error with the units left implicit. It also made gusts as big
 *   as the whole prevailing wind at low bays (std ≈ ±0.055 vs. bay 4's
 *   windMax of 0.06). With WIND_TAU_SEC=5 and WIND_GUST_FRACTION=0.025, gusts
 *   now sit at a steady ~17.7% of windMax stationary std and the character of
 *   the wind barely changes within one ~2s flight, only drifting over the
 *   course of a bay — matching the "learnable character, small gusts for
 *   texture" intent described above (see game.ts's WIND_REVERT comment for
 *   the full derivation and the std formula).
 */
/** Fraction of windMax used to size each bay's windGust (see the field's doc
 *  and the BALANCE KNOBS note above). Kept here, not as a flat windGust
 *  number, so the "texture vs. prevailing wind" ratio is the SAME at every
 *  windy bay instead of a flat magnitude that swamps a low windMax bay while
 *  reading as nothing at a high one. See game.ts's WIND_REVERT comment for
 *  the exact stationary-std formula this feeds (~17.7% of windMax at the
 *  tuned WIND_TAU_SEC=5s). */
export const WIND_GUST_FRACTION = 0.025;

/**
 * SCRAP — the in-run upgrade currency (see run.ts's RunState.scrap and
 * upgrades.ts). Deliberately separate from funds: funds are the bay's
 * OPERATING budget (spent on launches, and the bay's own objective is a funds
 * threshold), while scrap is CAPITAL, only ever spendable on the ship at a
 * refit stop. That separation is what makes the two decisions distinct — a
 * tight-funds bay still earns scrap, so a rough bay you barely survive still
 * moves the build forward, and banking a fat surplus never buys upgrades
 * directly.
 *
 * First-pass sizing: a clean bay clears ~8 lines, so a bay is worth ~10 + 8×2
 * = 26 scrap. The three refit stops sit after bays 3, 6 and 9, so the player
 * arrives at them with roughly 78 / 156 / 234 cumulative scrap. Against
 * upgrades.ts's 20/35/55 per-tier ladder (110 for a full track) that's "one
 * track nearly maxed, or two tracks opened" by the first stop — an FTL-shaped
 * choice rather than a shopping spree. Tune here, not per-bay.
 */
export const SCRAP_PER_LINE = 2;
export const SCRAP_PER_BAY = 10;

/**
 * MARK SCALING — how much harder bay `i` gets per Mark above the first.
 *
 * The Mark ladder raises the floor and the bar TOGETHER: a Mark hands the
 * player a bigger build budget (upgrades.ts's budgetForMark) and this is the
 * matching rise in what a bay demands. Without it a Mark would just be free
 * power and every board above Mark 1 would be easier than the one below it.
 *
 * Only the two knobs that state the bay's DEMAND are scaled — the funding
 * target and the press tempo. Deliberately not scaled: launchCost and
 * penaltyPerLostPiece (which would compound with the target into a difficulty
 * cliff), and windMax (weather is the bay's character, and the launcher track
 * is the sanctioned answer to it — see the BALANCE KNOBS note).
 *
 * CALIBRATED — and the result was that these knobs do not calibrate anything.
 * Measured with sim/marks.ts (aim bot, 550-point rig, 3 seeds):
 *
 *  - TARGET is a DURATION knob, not a difficulty one. Raising bay 1's Mark 10
 *    target from 2096 to 3536 produced zero extra losses: the bot simply played
 *    longer and scored 5852 instead of 2487. Once income per line exceeds spend
 *    per line, a competent player reaches ANY target given time. Three separate
 *    sweeps over 0.06-0.38 returned byte-identical win rates.
 *  - The CLOCK doesn't bind either. Cutting bay 10's limit to 35% of stock (84s)
 *    still gave 3/3 wins — runs finish in 41-67s against limits of 150-240s.
 *  - SPEED was actively harmful and is now 0. A faster sweep pushes pieces out
 *    before they settle, so the lost-piece penalty drains the bankroll: at bay 5
 *    the same rig went from 3/3 wins to 1/3 (both losses "broke") with speed
 *    scaling on and a LOWER target. That is an erratic bankruptcy tax, not a
 *    difficulty ramp, and it swamped the other knobs — it is why two of those
 *    sweeps looked flat before the target was even suspect.
 *
 * The finding underneath all three: a fully-kitted rig trivializes the existing
 * ladder, so no multiplier on the ladder's own numbers produces a graded
 * response. Mark difficulty has to come from CONTENT — materials and hazards
 * that change what the rig must DO — not from scaling what a bay demands. See
 * docs/DESIGN.md; this is now measured rather than asserted.
 *
 * TARGET_STEP is kept at a modest 0.18 because lengthening a bay is still mild
 * pressure and it keeps a Mark from being visibly identical to the one below.
 * It is NOT the difficulty lever and must not be tuned as if it were.
 */
export const MARK_TARGET_STEP = 0.18;
/** 0 by design — see above. Kept as a named seam rather than deleted so the
 *  measurement that zeroed it stays attached to the knob it describes. */
export const MARK_SPEED_STEP = 0;

export function makeBaseLevel(i: number, mark = 1): LevelConfig {
  // Dead calm for the first three bays; weather rolls in gently from bay 4
  // (i === 3) at 0.06 and ramps +0.04/bay to 0.30 at bay 10 (i === 9).
  const windMax = i < 3 ? 0 : 0.06 + (i - 3) * 0.04;
  // Mark 1 is stock, so every existing number and every tuned constant below
  // is preserved exactly at the bottom of the ladder.
  const marksAbove = Math.max(0, Math.floor(mark) - 1);
  const targetMult = 1 + MARK_TARGET_STEP * marksAbove;
  const speedMult = 1 + MARK_SPEED_STEP * marksAbove;
  return {
    id: i + 1,
    name: LEVEL_NAMES[i],
    gravity: 1,
    compactorSpeed: (1.2 + i * 0.05) * speedMult,
    compactorOpenCells: 12,
    compactorMinLineCells: 8,
    compactorWidth: 26,
    compactorHeightFrac: 0.5,
    jointBreakStretch: 1.7 + i * 0.12,
    jointStiffness: Math.min(0.98, 0.9 + i * 0.01),
    scorePerLine: 100 + i * 10,
    penaltyPerLostPiece: 25 + i * 2,
    targetScore: Math.round(targetScoreFor(i) * targetMult),
    startingFunds: 250,
    launchCost: 25 + i * 2,
    pieceSequence: ["I", "O", "T", "L", "J", "S", "Z"],
    cooldownMs: 900,
    timeLimitSec: 150 + i * 10,
    pieceSize: "std",
    bombCharges: 0,
    salvagePerCube: 8,
    launchPower: 1,
    windAssist: 0,
    settleAssist: 1,
    scrapPerLine: SCRAP_PER_LINE,
    scrapPerBay: SCRAP_PER_BAY,
    autoLaunchMs: 0,
    windMax,
    // Sized as a fraction of windMax, not a flat number — see
    // WIND_GUST_FRACTION's doc above. windMax 0 (bays 1-3) makes this 0 too,
    // consistent with stepWind's own windMax===0 inert-wind short-circuit.
    windGust: windMax * WIND_GUST_FRACTION,
    bondBreakerCharges: 0,
    strokeBudget: 0,
    objectiveLines: 0,
  };
}

/** The 10-level base ladder (before any drafted modifiers are applied — see
 *  mods.ts's applyMods / run.ts's levelForRun). */
export const LEVELS: LevelConfig[] = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i));

// UI references LEVEL_1 today (pre-run-mode howto/menu copy); keep it as an
// alias for the ladder's first entry rather than a second source of truth.
export const LEVEL_1: LevelConfig = LEVELS[0];
