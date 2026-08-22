import type { Material, PieceSize, PieceType } from "./theme";

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
  /** Fixed piece order (cycled sequentially, like the original) — a debug and
   *  special-mode seam. null => the cannon deals a SEEDED 7-BAG SHUFFLE
   *  (cannon.ts's deal), which is what every Deep Run bay ships: fair variety
   *  (each type exactly once per seven shipments) without the identical
   *  opening a fixed rotation forced on every run. */
  pieceSequence: PieceType[] | null;
  /** A FINITE inventory of shipments, consumed in order and never repeated —
   *  the whole supply this bay will ever get. null (every Deep Run bay, and
   *  every launch-budget Contract) means pieceSequence cycles forever instead.
   *
   *  This is what a PATTERN Contract runs on (see contracts.ts): the queue is
   *  chosen to tile the goal EXACTLY, so the puzzle is planning where each
   *  known shipment goes rather than firing until the pile happens to resolve.
   *  It replaces launchBudget rather than stacking with it — the queue IS the
   *  budget, and a bay carrying both would be counting the same limit twice. */
  pieceQueue: PieceType[] | null;
  /** The Mark this bay is being flown at (1-based). Stored rather than derived
   *  because the ratchet ladders read it: notchTotal starts a Mark-N run
   *  ladderStart(N) rungs up (hazards.ts — one rung per two Marks), so the
   *  same choice costs more the further you have got. */
  mark: number;
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
  /** Probability that a given shipment arrives as each non-standard MATERIAL
   *  (theme.ts's Material). Everything not claimed here is standard, so an
   *  all-zero mix — every bay before materials are introduced, and every
   *  pattern Contract — behaves exactly as it did before materials existed.
   *
   *  A per-shipment ROLL rather than a fixed count per bay: the player should
   *  not be able to count slag off and know the rest of the bay is clean, and
   *  the next-shipment preview already tells them what is actually coming, which
   *  is the information that matters for planning. See hazards.ts's content axes. */
  materialMix: MaterialMix;
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
  /** Launches this bay allows; 0 = unlimited, which is every Deep Run bay.
   *  This is the constraint CONTRACTS run on instead of a clock and a bankroll
   *  (see docs/DESIGN.md): firing costs nothing, but you get a finite number of
   *  shipments, so a Contract can't be brute-forced by launching until the pile
   *  happens to resolve.
   *
   *  Deep Run plays the same game on its own axis: the bankroll is its launch
   *  budget (see the economy note below makeBaseLevel). The float covers a
   *  handful of launches and the carry-over is capped (run.ts's CARRY_CAP), so
   *  a bay is won by placing a few shots exactly rather than by launching
   *  until the pile happens to resolve.
   *
   *  It is deliberately NOT a budget of compactor press strokes, which is what
   *  this was first built as. Strokes advance on a wall clock whether or not
   *  the player acts, which made the budget a disguised timer in the one mode
   *  that is supposed to have none — and made the same Contract harder for a
   *  slower player, since fewer of their shots fit inside it. A launch budget
   *  is spent only by acting and is worth the same to everyone. */
  launchBudget: number;
  /** Lines needed to clear a CONTRACT; 0 = this bay is won on funds
   *  (targetScore), which is the Deep Run condition. Contracts carry no
   *  bankroll, so funds can't be their objective. */
  objectiveLines: number;
  /** Bond Breaker charges granted at the START of this RUN — the "shatter
   *  every joint on the field into loose cubes" special ability (see game.ts's
   *  useBondBreaker). Consumable and rare by design: the run's total stock is
   *  written onto bay 1's config (run.ts's levelForRun does the seeding) and
   *  the Game threads the remaining stock bay-to-bay, so a charge fired in
   *  bay 3 is gone in bay 4. It never refreshes per bay — a shatter that came
   *  back every level erased the pile's history AND let a single big carry
   *  bankroll two clears in a row, which is the exact spray-and-pray loop this
   *  field used to feed. 0 = the player never bought one. */
  bondBreakerCharges: number;
  /** CONGESTION TIERS — the anti-spam rule (see PILE_TIERS below).
   *
   *  Ascending by `cubes`. Once the field holds MORE than a tier's `cubes`
   *  live cubes, every launch costs `costMult` x this bay's launchCost and
   *  burns `clockSec` seconds off the bay clock. The highest tier whose
   *  threshold is exceeded wins; they do not stack.
   *
   *  Empty = the mechanic is OFF, which is what makeBaseLevel ships today.
   *  Same inert-by-default stance as windMax 0 and autoLaunchMs 0. */
  pileTiers: PileTier[];
  /** Cubes added to EVERY tier's threshold before it triggers — the upgrade
   *  seam. 0 = stock. A player who invests here buys back the right to fire
   *  into a fuller bay, which is the whole point of gating spam behind a
   *  threshold rather than banning it outright. */
  pileAllowance: number;
}

// Economy balance note: each bay is its OWN economy — targetScore, launchCost,
// and scorePerLine are all PER-BAY (not cumulative), and only a CAPPED share
// of the surplus banked above a cleared bay's target carries into the next one
// (run.ts's RunState.carry / advanceRun / CARRY_CAP). The budget is deliberately
// TIGHT: a $200 float buys eight stock launches ($25 each), down from the ten
// it used to buy. Eight is the number the whole change turns on — it is the
// mistake budget. At Launch Bay (i=0) a perfect 8-cube line costs 2 shots
// ($50) for a $100 payout, so a precise player nets $50/line and grows; at the
// measured ~2.9 launches/line (contracts.ts's PLANNING_EFFICIENCY note) the
// same line nets $27, and a single piece bounced out of the bay (-$25) erases
// it. So volume does not pay for itself and precision does, which is the
// puzzle the mode is supposed to be.
//
// The float was cut rather than the launch priced up, deliberately: a dearer
// shot taxes the precise player exactly as hard as the careless one, where a
// shorter runway only bites once you have already missed. The sweep agrees —
// at $250 the volume bot won 38% of bay 1 and at $200 it wins 17%, while the
// deep bays barely move (sim/sweep.ts, 24 seeds).
//
// Later bays keep the same $25 launch price but pay out faster (scorePerLine
// ramps +10/bay) against a rising target (+TARGET_PER_BAY/bay), so the purse
// tightens as the ladder climbs and the Reactor float install (upgrades.ts)
// becomes the deep-run economy answer. The $25+2i lost-piece penalty and
// wasted shots are what put a sloppy bay out of reach.
const LEVEL_NAMES = [
  "Launch Bay", "Cargo Dock", "Freight Yard", "Assembly Line", "Foundry",
  "Cryo Bay", "Reactor Deck", "Orbital Ramp", "Gravity Well", "Compactor Core",
] as const;

/** Per-bay funding target — RISES every bay, automatically, by
 *  TARGET_PER_BAY. Per-bay (not cumulative) because each bay is its own
 *  economy: only the capped overshoot above this target carries into the next
 *  bay's float (see run.ts's RunState.carry / CARRY_CAP).
 *
 *  The ramp is back, and the reason the old one was removed no longer applies.
 *  The old ramp (800 + 150i against a flat $250 float and uncapped carry) was
 *  measured to be a DURATION knob: with a bottomless purse, income per line
 *  always beat spend per line, so any target was only a matter of time. The
 *  budget is the lever that now bites (tight float, capped carry), and once
 *  money is scarce a rising target lengthens the bay's demand against a purse
 *  that does NOT rise with it — which is a difficulty curve. It also takes the
 *  ramp out of the player's draft: the ladder's own climb is no longer
 *  something a hazard card can be spent opting into (hazards.ts RETIRED Quota
 *  Raise from the offer for exactly this reason — the ladder's own ramp is
 *  that pressure's home now; see RETIRED_AXES). */
export const TARGET_PER_BAY = 100;

function targetScoreFor(i: number): number {
  return 800 + TARGET_PER_BAY * i;
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
 * - targetScore (800 + TARGET_PER_BAY·i) climbs every bay on its own; the
 *   clock (150s), launch cost ($25) and startingFunds ($200) are flat
 *   PER-BAY floats — only the prior bay's CAPPED overshoot (RunState.carry)
 *   stacks on top. The purse is deliberately tight: a flat float against a
 *   rising quota means later bays demand more lines from the same money,
 *   which is what makes precise launches the strategy (scorePerLine still
 *   ramps +10/bay, so a clean line stays net-positive all the way down).
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
 * TARGET_STEP is now 0, which is where the measurement above always pointed and
 * where the hazard draft finally allowed it to go. A Mark no longer moves any
 * of the ladder's numbers: it is a statement about WHICH hazards and systems
 * exist (hazards.ts's ladder, meta.ts's INSTALLS) and nothing else. Kept as a
 * named seam rather than deleted so the measurement that zeroed it stays
 * attached to the knob it describes — same reason MARK_SPEED_STEP survives.
 */
export const MARK_TARGET_STEP = 0;
/** 0 by design — see above. Kept as a named seam rather than deleted so the
 *  measurement that zeroed it stays attached to the knob it describes. */
export const MARK_SPEED_STEP = 0;

/** Per-shipment probability of each non-standard material. See
 *  LevelConfig.materialMix. */
export type MaterialMix = Record<Exclude<Material, "standard">, number>;

/** A bay with no materials at all — the pre-materials behaviour, and the
 *  explicit default for every caller that builds a LevelConfig by hand. */
export const NO_MATERIALS: MaterialMix = {
  slag: 0, cryo: 0, rebar: 0, volatile: 0, tar: 0, magnetic: 0,
};

/**
 * RETIRED — materials are no longer scheduled by the ladder at all.
 *
 * This used to be a per-Mark, per-bay probability ramp (slag from Mark 2, cryo
 * from Mark 3), and `materialMixFor(i, mark)` read it into every bay. Both are
 * gone, and their replacement is hazards.ts: a material appears only when the
 * player ratchets its content axis, at hazards.ts's materialRate.
 *
 * The change is the design's, not a refactor. Under the schedule a material was
 * something the ladder inflicted on a player who might own no answer to it —
 * which is exactly the bug the hazard draft was built to fix, in its other half:
 * owning the demo unlock and never being dealt the card. Now the material and
 * the decision to face it are the same act, and the Workshop system that
 * answers it is the reason a player would take that notch at all.
 *
 * Mark gating did not disappear with it. It moved to hazards.ts's ladder, which
 * is where "which hazards exist at this Mark" now lives in one place alongside
 * "which systems can be installed" — see HAZARDS and meta.ts's INSTALLS.
 */


/**
 * CONGESTION — a launch-cost and clock tax that scales with how cluttered the
 * bay already is (see LevelConfig.pileTiers).
 *
 * The problem it exists for: a bay's launch budget is at its LOOSEST right
 * before the bay ends. Late in a bay the player is sitting on the surplus every
 * cleared line paid out, launchCost is flat, and nothing else prices a shot —
 * so the dominant endgame play is to stop aiming and empty the bankroll into
 * the bay, letting gravity and the press resolve whatever lands. That is a
 * strategy the economy currently REWARDS, and it skips the part of the game
 * that is actually the game.
 *
 * Thresholds are stated in cubes and sized in FULL LINES, so the number means
 * something the player can see: compactorMinLineCells is 8, so 32 cubes is
 * "four lines' worth of cargo is loose on the field" and 48 is six. Above the
 * first, a launch costs a quarter more and 2s of clock; above the second,
 * double and 5s.
 *
 * THE KNEE IS SIZED TO THE HUMAN PILE, NOT THE BOT'S — learned the hard way.
 * A 2026-08-22 balance pass measured the aim bot's census (median bay-1
 * field exactly 32 cubes, 42% of shots over the knee) and moved the
 * thresholds to 48/64 on that evidence. The owner's device playtest
 * immediately falsified it: a human tossing casually NEVER reached 48 — the
 * fee simply stopped existing — because the census bot fires every reload,
 * nonstop, and holds roughly twice the standing pile a human's slower,
 * aimed cadence does. Deterrence questions are the sim's documented blind
 * spot (sim/pile.ts's header); the thresholds stay at 32/48, the owner's
 * numbers, and any future retune of them needs DEVICE telemetry
 * (sim/playtest.ts), not a bot census.
 *
 * What the same pass measured about the COMPONENTS still holds and one
 * change stays: tier 1 charges 1.25x rather than the original 1.5x. The
 * cost axis is the BANKRUPTCY vector in the thin-margin bays (bay 1 nets
 * ~$27.5/line, so a fee that compounds into broke ends the bay
 * unrecoverably where clock/reload/combo pressure does not — measured:
 * money-only variants turned careful play's losses into bankruptcies at
 * every threshold tried). At 1.25x the fee still fires often at 32/48 —
 * which is the point: visible, frequent, survivable — and tier 2 keeps the
 * doubled price as the true spam wall.
 *
 * Two deliberate non-choices:
 *
 *  - The tax is charged on the SHOT, not held against the pile. A player who
 *    stops firing and lets the compactor work pays nothing at all — the
 *    counter-play is free, which is what makes this a disincentive rather than
 *    a punishment. A drain-per-second version would tax the patience it is
 *    trying to buy.
 *  - The broke check (game.ts) reads the CONGESTED price, not the base one.
 *    The instinct is the opposite — congestion should not be a second
 *    bankruptcy — but pricing it at the base rate produces something worse
 *    than a loss: a bay where funds sit between the two prices, every launch
 *    is refused, and the game says nothing while the clock drains. Reading the
 *    real price starts the normal grace countdown instead, and that countdown
 *    is cancelled by a line clear, which pays out AND drops the cube count
 *    below the tier. One rescue, both halves.
 */
export interface PileTier {
  /** Live cubes on the field ABOVE which this tier applies (exclusive). */
  cubes: number;
  /** Multiplier on launchCost while this tier is the active one. */
  costMult: number;
  /** Seconds burned off the bay clock per launch fired at this tier. */
  clockSec: number;
  /** Multiplier on the fire cooldown while this tier is active. The third
   *  pressure and the one that cannot be paid off: money and clock both come
   *  out of stores the player can rebuild by clearing lines, but a slower
   *  reload is taken in the only currency a bay never refunds — the shots you
   *  would have had. It is also the one a spam volley feels IMMEDIATELY,
   *  rather than at the next price check. */
  reloadMult: number;
}

/** The ladder: 4 lines' worth of loose cargo, then 6 — the owner's numbers,
 *  confirmed on device (see the knee note above; the bot census that argued
 *  for 48/64 measured a pile no human cadence actually holds). Exported and
 *  tuned here rather than inlined in makeBaseLevel so sim/pile.ts can sweep
 *  variants against the same named default. */
export const PILE_TIERS: PileTier[] = [
  { cubes: 32, costMult: 1.25, clockSec: 2, reloadMult: 1.5 },
  { cubes: 48, costMult: 2, clockSec: 5, reloadMult: 2 },
];

/** Bay 1's joint stretch tolerance, and the unit the whole ramp is stated in:
 *  bay 10 is exactly twice this. Exported because render.ts sizes its weld
 *  seams against the same range, and two copies of a range that moves is how a
 *  visualisation ends up describing a game that no longer exists. */
export const BASE_BREAK_STRETCH = 2.2;

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
    // 2.2 -> 4.4 across the ten bays, where it used to be 1.7 -> 2.78. Bonds
    // came apart too readily at the old numbers: bay 1 opened at a stretch
    // tolerance a bad landing beat routinely, so a shipment shattering was the
    // NORM rather than the price of a bad shot, and the ramp's top end was
    // barely past where the old bay 5 already sat. This opens where the old
    // bay 5/6 did and doubles from there, so a piece holding together is the
    // default and breaking one means something.
    //
    // Written as base x (1 + i/9) rather than base + i x step so the two
    // numbers that were actually decided — where it starts, and that bay 10 is
    // twice bay 1 — are both readable in the expression instead of being
    // recoverable only by arithmetic.
    jointBreakStretch: BASE_BREAK_STRETCH * (1 + i / 9),
    jointStiffness: Math.min(0.98, 0.9 + i * 0.01),
    scorePerLine: 100 + i * 10,
    penaltyPerLostPiece: 25 + i * 2,
    // The TARGET climbs every bay on its own (see targetScoreFor) — that is
    // the ladder's own difficulty curve, and it is deliberately NOT one of the
    // axes the hazard draft can spend a notch on. Float and launch price stay
    // flat: the purse is the pressure. A flat $200 float buys eight stock
    // launches, so bays are won by placing shots, not by volume.
    targetScore: Math.round(targetScoreFor(i) * targetMult),
    startingFunds: 200,
    launchCost: 25,
    // null = the seeded 7-bag (see the field's doc). This was a fixed
    // I,O,T,L,J,S,Z rotation, which made every bay open with the same pieces
    // in the same order — the first minute of every run played out identically
    // (playtest, 2026-08-09). The bag keeps the fairness a fixed rotation had
    // (every type exactly once per seven) and is still seeded per run + bay,
    // so a restarted bay replays its exact deal.
    pieceSequence: null,
    pieceQueue: null,
    mark: Math.max(1, Math.floor(mark)),
    // 1350, up from 900. The old cooldown was short enough that the reload bar
    // was almost never the thing you were waiting on — you fired, and by the
    // time you had read the bay and picked a target it had already refilled,
    // so "when can I shoot" was never a question the player had to hold. A
    // launch you have to wait for is a launch worth aiming, and it is also
    // what gives congestion's reload penalty something to bite on.
    cooldownMs: 1350,
    timeLimitSec: 150,
    pieceSize: "std",
    // Clean. Materials are no longer scheduled by bay and Mark at all — they
    // arrive only when the player ratchets a content axis, which is what turns
    // slag from something the ladder inflicts into something accepted in place
    // of a harder number.
    materialMix: { ...NO_MATERIALS },
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
    // ON. sim/pile.ts measured it, the bay now SHOWS it (render.ts's
    // congestion rows light the bay floor-up and the plant's Launch price
    // glows with them), and Bay Extension buys relief from it — the three
    // things a rule needs before it stops being an experiment. Copied rather
    // than shared: mods.ts and hazards.ts both clone pileTiers per level, and
    // handing every bay the same array would let one bay's tuning leak into
    // the next.
    pileTiers: [...PILE_TIERS],
    pileAllowance: 0,
    launchBudget: 0,
    objectiveLines: 0,
  };
}

/** The 10-level base ladder (before any drafted modifiers are applied — see
 *  mods.ts's applyMods / run.ts's levelForRun). */
export const LEVELS: LevelConfig[] = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i));

// UI references LEVEL_1 today (pre-run-mode howto/menu copy); keep it as an
// alias for the ladder's first entry rather than a second source of truth.
export const LEVEL_1: LevelConfig = LEVELS[0];
