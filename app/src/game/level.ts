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
  /** Penalty charged for cargo that decays on the wrong side of the compactor.
   *
   *  PER CUBE, not per piece, whatever the name says: game.ts bills
   *  `lostCubes.length * penaltyPerLostPiece`, so a spilled tetromino costs
   *  four times this and a spilled pentomino five. The name is kept because it
   *  is threaded through saves, telemetry and the sim harness, but anything
   *  that QUOTES the number to a player has to say which unit it is in (see
   *  preview.ts's spill row). */
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
  /** A SALVAGE WALL the bay opens with: cells already occupied in slot column
   *  x, counted up from the floor, indexed from the wall outward — the same
   *  index lineClear.ts's nearest-slot `k` uses. Empty on every bay that opens
   *  clean, which is every Deep Run bay and every Contract but one variant.
   *
   *  A column PROFILE rather than an arbitrary cell set, and that is load
   *  bearing: bottom-anchored means nothing in the opening pile is floating, so
   *  the bay cannot start by dropping a slab the physics never settled. See
   *  contracts.ts's salvageProfile for the other invariant (no row of it may
   *  already be complete, or the bay clears a line on frame one). */
  standingWall: number[];
  /** What the standing wall is MADE of. "standard" — every Contract that opens
   *  with one — is scrap that was pressed flat long before the player arrived:
   *  it fills slots, counts for lines and is simply in the way.
   *
   *  A Final Inspection can open a bay on a wall of something worse
   *  (finals.ts's Slag Wall and Ice Wall), and that is the whole reason this is
   *  a field rather than a constant inside createStandingWall. The material
   *  changes what the pile IS, not how it looks: slag fills a slot and can
   *  never count, so a slag wall is rows that will not sell until a demolition
   *  charge cuts them out; cryo is stamped unstruck, so an ice wall is rows
   *  that count for nothing until something hits them hard enough — and that
   *  the press will shatter, kicking their neighbours loose, if nothing does.
   *
   *  Read once, at bay start (pieces.ts's createStandingWall). Meaningless when
   *  standingWall is empty, which is every ordinary bay. */
  standingWallMaterial: Material;
  /** Hide the NEXT-shipment preview. A pattern Contract variant knob: the whole
   *  SET is still on the card, so this removes lookahead without removing
   *  information the player was promised. Never true in a Deep Run — a random
   *  bag with no preview is a slot machine. */
  hideNextPreview: boolean;
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
  /** Multiplier on the impact speed that sets a VOLATILE cube off
   *  (lineClear.ts's VOLATILE_TRIGGER_SPEED). 1 = stock, and every ordinary bay
   *  is stock.
   *
   *  A multiplier rather than an absolute speed because the constant it scales
   *  says outright that it is "only meaningful relative to" the cannon's speed
   *  range and the world's gravity — an absolute number here would be a second
   *  copy of that relationship, free to drift out of it. Below 1 the material
   *  is primed finer: measured first-contact speeds run 17.3 to 30.8 across
   *  every angle and power the cannon can produce, so 0.85 (a threshold of
   *  18.7) leaves only the softest lob safe where stock leaves two thirds of
   *  launches safe. finals.ts's Hair Trigger is the only thing that writes it. */
  volatileTriggerMult: number;
  /** Funds paid per DEAD cube (one that can never count toward a line — slag)
   *  removed by a VOLATILE detonation, and only by one. See lineClear.ts's
   *  slagBountyFor for why this is not the payout resolveVolatile refuses, and
   *  SLAG_BOUNTY for how it is sized. Bombs are untouched: their problem is
   *  that they run out, not that they underpay, and bombResupplyLines answers
   *  that directly. */
  slagBounty: number;
  /** Lines per demolition charge returned mid-bay; 0 = no resupply. Written
   *  only by the MAXED Demolition Rack (upgrades.ts), which is what turns that
   *  capstone from another +2 into a change in kind. A bay can out-last six
   *  charges — the Tier 6 Slag Wall clause opens one on 11 cubes of slag — and
   *  seventh dead shipment currently has no answer at all. See level.ts's
   *  bombResupply and game.ts's line-clear payout. */
  bombResupplyLines: number;
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
   *  (~10.6% stationary std at the tuned WIND_GUST_FRACTION/WIND_TAU_SEC —
   *  see game.ts's WIND_REVERT comment for the exact formula) instead of a
   *  flat magnitude that would dwarf a low bay's windMax while reading as
   *  flat at a high one. The live wind nudges by up to ±windGust each
   *  physics step and is gently pulled back toward the bay's rolled average
   *  over a ~5s decorrelation time (game.ts's stepWind), so it gusts around
   *  a learnable baseline instead of oscillating extreme-to-extreme or
   *  re-rolling every fraction of a second. Ignored when windMax is 0. */
  windGust: number;
  /** PINNED prevailing wind, as a SIGNED FRACTION of windMax: -1 is a full
   *  headwind at the bay's cap, +1 a full tailwind at it, 0 dead calm however
   *  windy the bay is. null — every ordinary bay — rolls the average from the
   *  seed the way it always has (game.ts's windAvg).
   *
   *  The seam a Final Inspection's wind fork runs on (finals.ts): the bay's
   *  weather stops being a roll and becomes the thing the player CHOSE, which
   *  is the only way a card can promise a headwind and be telling the truth.
   *  A fraction rather than an absolute magnitude so the lock rides whatever
   *  cap the bay actually carries — ratcheted Crosswind included — instead of
   *  quietly capping a run that spent notches on the weather.
   *
   *  Ignored when windMax is 0 (the calm bays 1-3), same short-circuit the
   *  drunk walk itself takes. */
  windLock: number | null;
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
   *  Empty = the mechanic is OFF. makeBaseLevel ships PILE_TIERS on every bay,
   *  so the only empty ladders are the ones sim/pile.ts builds for its `off`
   *  control; the inert-by-default stance windMax 0 and autoLaunchMs 0 still
   *  take does not apply here any more. */
  pileTiers: PileTier[];
  /** Cubes added to EVERY tier's threshold before it triggers — the upgrade
   *  seam. 0 = stock. A player who invests here buys back the right to fire
   *  into a fuller bay, which is the whole point of gating spam behind a
   *  threshold rather than banning it outright. */
  pileAllowance: number;
  /** Piece TYPES whose bonds are stamped WEAKER at launch — the SEAM SPLITTER
   *  seam (pieces.ts's createTetrisPiece does the stamping; upgrades.ts's
   *  Bond Emitter track is its only writer today, tuned to S and Z). A
   *  generic per-type knob rather than an S/Z rule, deliberately: which
   *  shapes are weak is DATA, so a future rig or hazard can point the same
   *  seam at any type. Empty = every shipment gets the bay's stock
   *  fragility. */
  weakBondTypes: PieceType[];
  /** Multiplier on a listed type's break threshold (0.7 = 30% weaker;
   *  1 = inert). Only read for types in weakBondTypes, and a material
   *  property still outranks it — a rigid material (rebar) stays unbreakable
   *  whatever the shape. See createTetrisPiece for the full precedence. */
  weakBondMult: number;
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
 * - jointBreakStretch grows with i (and, tier over tier, with the Mark — see
 *   BOND_MARK_STEP): the core difficulty ramp, pieces get progressively
 *   harder to shatter apart from bad landings.
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
 *   then rolls in GENTLY from bay 4 (i === 3) at 0.03 and ramps +0.02/bay to
 *   0.15 at bay 10 (i === 9) — HALF the 0.06 +0.04/bay ramp this replaced,
 *   cut on a playtest verdict (2026-08-22) that wind at the old strength
 *   discouraged aiming: compensating for the weather dominated reading the
 *   bay, which is backwards. This knob has only ever moved down — the old
 *   ramp was itself a fraction of the flat-high ladder playtesters first
 *   flagged as unfair.
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
 *   as the whole prevailing wind at low bays (std ≈ ±0.055 vs. the 0.06
 *   windMax bay 4 carried then). With WIND_TAU_SEC=5 and
 *   WIND_GUST_FRACTION=0.015, gusts now sit at a steady ~10.6% of windMax
 *   stationary std and the character of the wind barely changes within one
 *   ~2s flight, only drifting over the course of a bay — matching the
 *   "learnable character, small gusts for texture" intent described above
 *   (see game.ts's WIND_REVERT comment for the full derivation and the std
 *   formula).
 */
/** Fraction of windMax used to size each bay's windGust (see the field's doc
 *  and the BALANCE KNOBS note above). Kept here, not as a flat windGust
 *  number, so the "texture vs. prevailing wind" ratio is the SAME at every
 *  windy bay instead of a flat magnitude that swamps a low windMax bay while
 *  reading as nothing at a high one. See game.ts's WIND_REVERT comment for
 *  the exact stationary-std formula this feeds (~10.6% of windMax at the
 *  tuned WIND_TAU_SEC=5s).
 *
 *  0.015, down from 0.025, cut in the same 2026-08-22 pass that halved the
 *  windMax ladder — and deliberately cut FURTHER than the ladder. Halving
 *  windMax alone would have kept the noise-to-signal ratio intact, and the
 *  noise is what the playtest actually indicted: a prevailing wind punishes a
 *  lazy shot, but a gust punishes a SOLVED one with a random miss, which
 *  teaches nothing. With both cuts the absolute jitter lands at ~30% of what
 *  it was (half the cap x 0.6 of the ratio). */
export const WIND_GUST_FRACTION = 0.015;

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
 * Only the two knobs that state the bay's DEMAND were ever scaled here — the
 * funding target and the press tempo. Deliberately not scaled: launchCost and
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
 * of the numbers that state a bay's DEMAND: it is a statement about WHICH
 * hazards and systems exist (hazards.ts's ladder, meta.ts's INSTALLS) — plus
 * ONE content number, the bond ramp (BOND_MARK_STEP below), which is the kind
 * of knob the measurement said Mark difficulty has to come from: stronger
 * bonds change what the rig must DO, not how much the bay asks for. Kept as a
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
 * CONGESTION — a tax on firing into, and now on cashing out of, a bay that is
 * already cluttered (see LevelConfig.pileTiers).
 *
 * The problem it exists for: a bay's launch budget is at its LOOSEST right
 * before the bay ends. Late in a bay the player is sitting on the surplus every
 * cleared line paid out, launchCost is flat, and nothing else prices a shot —
 * so the dominant endgame play is to stop aiming and empty the bankroll into
 * the bay, letting gravity and the press resolve whatever lands. That is a
 * strategy the economy currently REWARDS, and it skips the part of the game
 * that is actually the game.
 *
 * Three of the four pressures price the SHOT, which left a second version of
 * the same play standing: stack deliberately, let the weight break the bottom
 * bonds, and take the multi-row collapse. The shot tax is paid once and the
 * collapse pays per row, so the bay still came out ahead. payMult prices the
 * clear as well — three quarters over the first knee, half over the second.
 *
 * Thresholds are stated in cubes and sized in FULL LINES, so the number means
 * something the player can see: compactorMinLineCells is 8, so 32 cubes is
 * "four lines' worth of cargo is loose on the field" and 48 is six. Above the
 * first, a launch costs a quarter more and reloads half again as slow; above
 * the second, double and twice as slow.
 *
 * clockSec is 0 at both tiers — the CLOCK BURN IS OFF (device playtest,
 * 2026-08-22: a hidden bite out of the bay clock on top of the price and
 * the reload read as unfair rather than as pressure). The field and
 * game.ts's burnCongestionClock stay wired because the intended future for
 * the burn is a HAZARD AXIS — a later-tier ratchet the player chooses into
 * (hazards.ts), not a default every bay carries — and that return needs a
 * proper visualization first (the clock visibly losing the seconds at the
 * moment of launch; a tax the player only meets in the end screen teaches
 * nothing, the same rule the HUD's launchCostNow quote already follows).
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
  /** CEILING on the line-payout multiplier while this tier is active — the
   *  fourth pressure, and the one that closes the stack-and-collapse loop.
   *
   *  The other three all price the SHOT. None of them touch what a clear is
   *  WORTH, so the strongest play in a congested bay was still to keep
   *  stacking until the weight broke the bottom bonds: the collapse crushes
   *  several rows in one stroke and every one of them paid list price.
   *  Congestion charged you for getting into the mess and then paid full rate
   *  for the mess paying off.
   *
   *  A ceiling rather than a multiplier ON the combo bonus, because the two
   *  scale differently: the combo advances by one per CRUSH, while the payout
   *  scales with the LINES inside it. Scaling the bonus barely dents a
   *  four-row collapse; capping the multiplier below 1 prices the collapse
   *  itself, which is the thing being discouraged.
   *
   *  The combo bonus starts at 1 and only climbs, so any value below 1
   *  replaces it outright — that is the intent, not a side effect. A congested
   *  bay is not a place to be building a streak. Infinity turns it off. */
  payMult: number;
}

/** The ladder: 4 lines' worth of loose cargo, then 6 — the owner's numbers,
 *  confirmed on device (see the knee note above; the bot census that argued
 *  for 48/64 measured a pile no human cadence actually holds). Exported and
 *  tuned here rather than inlined in makeBaseLevel so sim/pile.ts can sweep
 *  variants against the same named default. */
export const PILE_TIERS: PileTier[] = [
  { cubes: 32, costMult: 1.25, clockSec: 0, reloadMult: 1.5, payMult: 0.75 },
  { cubes: 48, costMult: 2, clockSec: 0, reloadMult: 2, payMult: 0.5 },
];

/** Each step of the combo adds this much to the payout multiplier: the first
 *  clear of a streak pays 1x, the second 1.25x, and so on. */
export const COMBO_STEP = 0.25;

/**
 * What one line is worth as a multiple of scorePerLine — the combo streak,
 * capped by congestion.
 *
 * One function rather than an expression inside the clear handler because the
 * two halves are tuned against each other: COMBO_STEP decides how fast a clean
 * streak climbs, and PileTier.payMult decides how far a cluttered bay is
 * allowed to climb at all. Reading either number without the other tells you
 * very little, and sim/systems.ts checks the pair here rather than inferring
 * them from a bay's score.
 *
 * `tier` is the congestion in force when the CRUSH HAPPENED, not when it was
 * paid — see Game.stepPileTier for why those are different moments.
 */
export function payoutMult(combo: number, tier: PileTier | null): number {
  const streak = 1 + Math.max(0, combo - 1) * COMBO_STEP;
  return Math.min(streak, tier ? tier.payMult : Infinity);
}

/**
 * What one slag cube pays when a volatile detonation removes it.
 *
 * Reads as salvagePerCube ($8) of scrap metal plus a $12 DENIAL premium. The
 * bomb's refund is already justified as "a cube that will never complete a line
 * is worth $0 as line material and salvagePerCube as scrap metal" — a slag cube
 * is worth $0 as line material for its whole life AND occupies a slot in a row
 * nothing can now close, so removing it is worth strictly more than removing a
 * standard cube.
 *
 * Sized against the two things it must sit between. A volatile lobbed into a
 * three-slag cluster returns $60 against a $25 launch, so disposal is clearly
 * worth the shot; one line pays scorePerLine (100+) before combo, so disposal
 * never out-earns playing the game. That is the same hierarchy the bomb's
 * stingy quarter-rate scrap trickle already protects.
 */
export const SLAG_BOUNTY = 20;

/** Lines per returned charge at a MAXED Demolition Rack. A clean bay clears ~8
 *  lines, so the capstone runs ~8 charges instead of 6 and a long grinding bay
 *  keeps paying — which is the case this exists for, since a bay can out-last
 *  six charges long before it ends. */
export const DEMO_RESUPPLY_LINES = 4;

/**
 * How many charges a bay still owes the player, given the lines cleared so far.
 *
 * Metered on CUMULATIVE lines against a running grant count rather than on each
 * clear's delta, and that is the whole reason this is a function. A four-line
 * clear arrives as a single event: an equality test (`linesTotal % interval ===
 * 0`) would pay it once instead of the two it may have earned, and a delta test
 * would miss it entirely whenever a clear stepped over the interval rather than
 * landing on it. Expressed this way the grant is idempotent — replaying it can
 * never double-pay — so the caller may run it after every clear without
 * tracking which clears it has already seen.
 *
 * `interval` of 0 disables, which is every tier below the capstone and every
 * bay of a run that never bought the track.
 */
export function bombResupply(
  linesTotal: number,
  alreadyGranted: number,
  interval: number,
): number {
  if (interval <= 0) return 0;
  return Math.max(0, Math.floor(linesTotal / interval) - alreadyGranted);
}

/** Bay 1's joint stretch tolerance at Mark 1, and the unit the whole ramp is
 *  stated in: bay 10 is exactly twice this (the Mark then multiplies the whole
 *  ramp — see BOND_MARK_STEP). Exported because render.ts sizes its weld
 *  seams against the same range, and two copies of a range that moves is how a
 *  visualisation ends up describing a game that no longer exists. */
export const BASE_BREAK_STRETCH = 2.2;

/** How much stronger a Mark makes every bay's bonds: the ramp above is the
 *  Mark-1 unit, and a Mark-N bay multiplies it by (1 + BOND_MARK_STEP x
 *  (N - 1)), so Mark 10 flies the whole ladder at x1.9. This is the one
 *  ladder number a Mark still moves, and deliberately so — it is a CONTENT
 *  knob, not a demand knob (see the MARK SCALING note above): stronger bonds
 *  change what the rig must DO — fewer accidental shatters, more whole
 *  shipments to place and press — which is exactly the axis the sim/marks.ts
 *  measurement said Mark difficulty has to come from. */
export const BOND_MARK_STEP = 0.1;

/** The rung at which the capstone bay's bonds stop scaling and go UNBREAKABLE
 *  (Infinity — see makeBaseLevel's jointBreakStretch). The same rung as
 *  hazards.ts's CAPSTONE_MARK, and deliberately NOT imported from there:
 *  hazards.ts imports this file, so reading the constant back would be a
 *  level <-> hazards cycle. sim/systems.ts asserts the two stay equal
 *  instead. */
export const UNBREAKABLE_MARK = 10;

export function makeBaseLevel(i: number, mark = 1): LevelConfig {
  // Dead calm for the first three bays; weather rolls in gently from bay 4
  // (i === 3) at 0.03 and ramps +0.02/bay to 0.15 at bay 10 (i === 9) —
  // half the 0.06 +0.04/bay ramp it replaced (see the BALANCE KNOBS note).
  const windMax = i < 3 ? 0 : 0.03 + (i - 3) * 0.02;
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
    // 2.2 -> 4.4 across the ten bays at Mark 1, where it used to be 1.7 ->
    // 2.78. Bonds came apart too readily at the old numbers: bay 1 opened at a
    // stretch tolerance a bad landing beat routinely, so a shipment shattering
    // was the NORM rather than the price of a bad shot, and the ramp's top end
    // was barely past where the old bay 5 already sat. This opens where the
    // old bay 5/6 did and doubles from there, so a piece holding together is
    // the default and breaking one means something.
    //
    // Written as base x (1 + i/9) rather than base + i x step so the two
    // numbers that were actually decided — where it starts, and that bay 10 is
    // twice bay 1 — are both readable in the expression instead of being
    // recoverable only by arithmetic.
    //
    // The Mark then multiplies the whole ramp (BOND_MARK_STEP): bonds
    // strengthen every tier, so Mark 10 flies at x1.9. Mark 1's factor is
    // exactly 1, so the bottom of the ladder keeps the tuned numbers above
    // byte-identically.
    //
    // EXCEPT the capstone: at UNBREAKABLE_MARK, bay 10 stops scaling and goes
    // Infinity — the ultimate format. Nothing shatters on landing, and the
    // press cannot break a piece either (breakJointsInBand already exempts
    // Infinity — the rebar rule), so every row is built from whole shipments
    // and the Bond Breaker charge is the ONLY shatter in the bay. Winnable on
    // the same fact rebar bays rest on: lineClear has no loose-cube
    // requirement, so whole pieces landed flat still fill slot-aligned rows —
    // and the per-run Bond Breaker magazine (no free charges granted here)
    // makes the capstone exactly the "spend it where it counts most" moment
    // that stock was rationed for.
    jointBreakStretch: mark >= UNBREAKABLE_MARK && i === 9
      ? Infinity
      : BASE_BREAK_STRETCH * (1 + i / 9) * (1 + BOND_MARK_STEP * marksAbove),
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
    standingWall: [],
    // Meaningless while standingWall is empty, which is every Deep Run bay —
    // named anyway so the field has one honest default rather than a hole a
    // caller has to know to fill.
    standingWallMaterial: "standard",
    hideNextPreview: false,
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
    // Stock priming. Inert-by-default, the same stance windMax 0 and
    // autoLaunchMs 0 take.
    volatileTriggerMult: 1,
    slagBounty: SLAG_BOUNTY,
    bombResupplyLines: 0,
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
    // Rolled, not pinned — a Final Inspection is the only thing that locks a
    // bay's weather, and it writes this on top of a base level like every
    // other one-off does.
    windLock: null,
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
    // Inert until a system writes them — the Seam Splitter (upgrades.ts's
    // Bond Emitter, tiers 2-3) is the only writer today. An empty list and a
    // x1 multiplier stamp every shipment at exactly the bay's stock
    // jointBreakStretch, the same inert-by-default stance windMax 0 and
    // autoLaunchMs 0 take.
    weakBondTypes: [],
    weakBondMult: 1,
  };
}

/** The 10-level base ladder (before any drafted modifiers are applied — see
 *  mods.ts's applyMods / run.ts's levelForRun). */
export const LEVELS: LevelConfig[] = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i));

// UI references LEVEL_1 today (pre-run-mode howto/menu copy); keep it as an
// alias for the ladder's first entry rather than a second source of truth.
export const LEVEL_1: LevelConfig = LEVELS[0];

/* ---------------------------------------------------------------------------
 * BASE BAY SUMMARY — what flying a given Mark actually costs you.
 *
 * The home screen's tier tower (screens.ts's tierTowerHTML) lets the player
 * park the car on any Mark they have earned, and the panel beside it has to
 * answer "what am I signing up for" for the floor currently selected. Every
 * number here is READ OFF makeBaseLevel rather than restated, because a
 * summary that restates the ladder is a summary that silently goes stale the
 * first time the ladder is retuned — and this one quotes six of the numbers a
 * balance pass edits first.
 *
 * The bays are the STOCK ones: no upgrades, no ratchets, no carry. That is the
 * honest thing to quote from a menu, where none of those are decided yet.
 * ------------------------------------------------------------------------ */
export interface BaseBaySummary {
  /** Bay 1's funding target, and bay 10's — the run's arc in two numbers. */
  targetFrom: number;
  targetTo: number;
  /** Stock price of one launch, and the float every bay opens on. */
  launchCost: number;
  startingFunds: number;
  /** Bay 1's clock, in seconds, and how many bays the run is. */
  timeLimitSec: number;
  bays: number;
  /** Joint strength relative to Mark 1 (level.ts's BOND_MARK_STEP) — the one
   *  axis the Mark itself moves, since MARK_TARGET_STEP and MARK_SPEED_STEP
   *  are both 0 today. x1.0 at Mark 1. */
  bondMult: number;
  /** True at UNBREAKABLE_MARK, where bay 10's joints go Infinity and the Bond
   *  Breaker is the only shatter left in the capstone. */
  unbreakableCapstone: boolean;
}

export function baseBayFor(mark: number): BaseBaySummary {
  const m = Math.max(1, Math.floor(mark));
  const first = makeBaseLevel(0, m);
  const last = makeBaseLevel(LEVELS.length - 1, m);
  return {
    targetFrom: first.targetScore,
    targetTo: last.targetScore,
    launchCost: first.launchCost,
    startingFunds: first.startingFunds,
    timeLimitSec: first.timeLimitSec,
    bays: LEVELS.length,
    // Read off the ramp rather than recomputed: jointBreakStretch at bay 1 is
    // BASE_BREAK_STRETCH x 1 x the Mark's factor, so dividing the two gives
    // the factor back without this function knowing the formula. Bay 1 rather
    // than bay 10 deliberately — bay 10 is the one that goes Infinity.
    bondMult: first.jointBreakStretch / BASE_BREAK_STRETCH,
    unbreakableCapstone: last.jointBreakStretch === Infinity,
  };
}
