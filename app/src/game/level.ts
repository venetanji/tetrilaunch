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
   *  preview.ts's spill row).
   *
   *  Set from penaltyPerLostPieceFor(i, mark): it is on the TIER LADDER as
   *  well as the bay index, $1 a cube at Tier 1 up to the full 25 + 2i at
   *  Tier 10. Contracts and drills overwrite it with 0 (nothing is spent, so
   *  nothing needs to be earned back) and a Final Inspection clause can treble
   *  whatever the tier set. */
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
   *  game.ts's armBomb/shoot). Charges cost launchCostNow like any shot —
   *  free ones made the rack a third income channel, measured at $480-670 a
   *  bay (see the note in shoot) — and each cube they vaporize refunds
   *  salvagePerCube, which is what keeps a bomb an economically legible
   *  SALVAGE tool: it pays for itself from three cubes up, trading line
   *  material you were never going to complete for funds back. 0 = the
   *  player never drafted them. */
  bombCharges: number;
  /** Funds refunded per cube a demolition charge vaporizes (see game.ts's
   *  detonate). The economic core of the bomb: a junk pile that can never
   *  complete a line is still worth something. */
  salvagePerCube: number;
  /** Multiplier on a demolition charge's kill radius (game.ts's BOMB_BLAST_R,
   *  and the shove ring that rides on it). 1 = stock, and every bay is stock
   *  until the Demolition Rack's capstone writes it.
   *
   *  A multiplier rather than an absolute radius for the same reason
   *  volatileTriggerMult is one: the stock number is tuned against CELL and the
   *  bay's geometry, and a second absolute figure here would be a copy of that
   *  relationship free to drift out of it. Radius, not count, because the thing
   *  a buried bay needs is a charge that reaches THROUGH a welded crust rather
   *  than more charges that each bite the same cube-and-a-half — and because
   *  area goes as the square, so a modest number on the radius is a large one on
   *  the hole, which is the shape of a capstone. */
  bombBlastMult: number;
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
  /** How deep the Impact Cushion's liner runs from the wall, in cells. 0 = no
   *  liner, which is every bay until the track is aboard.
   *
   *  CELLS FROM THE WALL rather than an absolute x, for the reason every other
   *  geometry field here is in cells: the bay's landmarks are all derived from
   *  CELL and WALL_INNER (compactorOpenCells, compactorMinLineCells,
   *  bayWidthCells), and a pixel here would be a second copy of a relationship
   *  free to drift out of it. lineClear.ts's volatileBlast resolves it against
   *  the cube that would detonate. */
  cushionCells: number;
  /** What the liner multiplies the volatile trigger speed by for cargo landing
   *  INSIDE it — the same seam volatileTriggerMult drives, pushed the other
   *  way. 1 = no softening.
   *
   *  Two fields rather than one because the system ladders on both and they
   *  answer different halves of the hazard: depth decides how much of the bay
   *  is protected, softening decides how hard a shot the protected part will
   *  take. upgrades.ts's CUSHION_TIERS carries the measurement that sized each.
   *
   *  Kept separate from volatileTriggerMult rather than multiplied into it at
   *  config time, and this is not tidiness: that field is FIELD-WIDE and this
   *  one is positional, so folding them together at build time would silently
   *  make the rig's liner cover the whole bay — which is precisely the gap the
   *  prototype that priced this system declared it could not close. */
  cushionMult: number;
  /** The share of a loss the INCINERATOR remits for cargo destroyed inside the
   *  flue — chute.ts's `inIncinerator`, i.e. at or above the plant's roofline.
   *  0 = no hood, which is every bay until the track is aboard; 0.75 is the
   *  capstone. upgrades.ts's INCINERATOR_TIERS carries the ladder.
   *
   *  ONE RATE FOR BOTH BILLS, and that is the design rather than a saving. The
   *  bay charges for wasted cargo in two places — `penaltyPerLostPiece` for a
   *  shipment that never reached the press, `volatileLoss` for live cargo a
   *  detonation took — and they are the same economic event told twice (cargo
   *  the player paid to launch and will get no line out of). A hood that
   *  discounted one and not the other would be teaching the player that where a
   *  cube died matters sometimes.
   *
   *  A SHARE, not a per-cube price, because it has to compose with two ladders
   *  it does not own: both bills already ride the tier (penaltyPerLostPieceFor,
   *  VOLATILE_LOSS_SHARE), so a flat discount would be worth a quarter as much
   *  at Tier 10 as at Tier 1 — the exact inversion of the case it was asked
   *  for. */
  incineratorRelief: number;
  /** Funds paid per DEAD cube (one that can never count toward a line — slag)
   *  removed by a VOLATILE detonation, and only by one. See lineClear.ts's
   *  slagBountyFor for why this is not the payout resolveVolatile refuses, and
   *  SLAG_BOUNTY for how it is sized. Bombs are untouched: their problem is
   *  that they run out, not that they underpay, and bombResupplyLines answers
   *  that directly. */
  slagBounty: number;
  /** Funds charged per LIVE cube a VOLATILE detonation destroys (lineClear.ts's
   *  volatileLossFor). The mirror of `slagBounty` directly above: that pays for
   *  the dead cargo a blast clears, this charges for the live cargo it wastes,
   *  and the two share a test, a unit and a currency.
   *
   *  A FIELD rather than a constant read at the call site because it is the
   *  seam the same things move that move slagBounty — a Final clause, a future
   *  ship system — and because it rides the tier ladder: it is derived from the
   *  bay's own penaltyPerLostPiece (see VOLATILE_LOSS_SHARE), so one number
   *  scales across ten tiers instead of being right at one of them. */
  volatileLoss: number;
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
  /** Thaw Lance charges available in THIS BAY — the "thaw one settled frozen
   *  cube" ability (see game.ts's useThawLance). Cryo's bought counter: it pays
   *  strikeCryo's sequencing cost ("land it, then spend a second shot hitting
   *  it") out of a charge instead of out of a launch.
   *
   *  Written by run.ts's levelForRun from RunState.thawCharges, exactly as
   *  bondBreakerCharges is, and for a reason the two modes disagree about: a
   *  LADDER run's rack is resupplied between bays, so the field is refilled to
   *  the tier's allowance at every bay boundary; a SKYDECK run never docks, so
   *  what it launched with is what it has (run.ts's advanceRun, skydeck.ts's
   *  yard bullet). upgrades.ts's `apply` writes the same rule at the config
   *  layer for a single bay outside a run.
   *
   *  0 = the ship carries no lance, which is every bay until the track is
   *  installed and every Contract (contracts.ts never calls applyUpgrades). */
  thawCharges: number;
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
// TIGHT: the float buys EIGHT launches at every tier (LAUNCH_BUDGET_SHOTS),
// which is the mistake budget; what the tier moves is what those eight cost —
// $160 at Tier 1's $20 a shot, $240 at Tier 10's $30. At Tier 1's
// Launch Bay (i=0) a perfect 8-cube line costs 2 shots ($40) for a $100 payout,
// so a precise player nets $60/line and grows; at the measured ~2.9
// launches/line (contracts.ts's PLANNING_EFFICIENCY note) the same line nets
// $42. So volume does not pay for itself and precision does, which is the
// puzzle the mode is supposed to be — and that is true on the LAUNCH PRICE
// alone, before the spill fine says anything.
//
// The fine is what makes a sloppy bay unrecoverable rather than merely slow,
// and it now rides the tier (penaltyPerLostPieceFor): billed PER CUBE (game.ts
// bills lostCubes.length * penaltyPerLostPiece, and see the field's own doc
// above), one spilled tetromino is -$4 at Tier 1 bay 1 and -$100 at Tier 10's
// — the same shot erasing a rounding error at the bottom of the ladder and
// more than two clean lines at the top. The flat $25 charged the beginner the
// veteran's price on the run where they are still learning to reach the zone.
//
// The float was cut rather than the launch priced up, deliberately: a dearer
// shot taxes the precise player exactly as hard as the careless one, where a
// shorter runway only bites once you have already missed. The sweep agrees —
// at $250 the volume bot won 38% of bay 1 and at $200 it wins 17%, while the
// deep bays barely move (sim/sweep.ts, 24 seeds). The tier ladder does price
// the shot up, but only ACROSS the ladder and never inside a run: Tier 1 is
// cheaper than that sweep's $25, Tier 10 dearer, and a run's price is fixed
// before it starts.
//
// Later bays keep the tier's launch price but pay out faster (scorePerLine
// ramps +10/bay) against a rising target (+TARGET_PER_BAY/bay), so the purse
// tightens as the ladder climbs and the Reactor float install (upgrades.ts)
// becomes the deep-run economy answer. The lost-piece penalty (Tier 10's
// $25+2i, scaled down the ladder to $1 a cube at Tier 1) and wasted shots are
// what put a sloppy bay out of reach.
const LEVEL_NAMES = [
  "Launch Bay", "Cargo Dock", "Freight Yard", "Assembly Line", "Foundry",
  "Cryo Bay", "Reactor Deck", "Orbital Ramp", "Gravity Well", "Compactor Core",
] as const;

/* ---------------------------------------------------------------------------
 * THE TIER LADDER — what a Mark actually DEMANDS.
 *
 * Four knobs state the bay's terms, and all four are a function of the TIER
 * being flown (RunState.mark) rather than constants every tier shares:
 *
 *   targetScore   $1080 on Tier 1's first bay, +$36 a tier -> $1404 at Tier 10
 *                 before the precision premium, $1544 after it.
 *   timeLimitSec  180s at Tier 1, -4s a tier               -> 144s at Tier 10.
 *   launchCost    $20 at Tier 1, straight line to          -> $30 at Tier 10.
 *   spill fine    $1 a cube at Tier 1, straight line to    -> $25+2i at Tier 10.
 *
 * The first three are the bay's OPENING terms and are flat inside a run; the
 * fourth is the price of a mistake and keeps the per-bay climb it has always
 * had (penaltyPerLostPieceFor). It is the newest of the four and the only one
 * that reads BOTH the tier and the bay index — see its own note for why it
 * joined the ladder and why the tier ramp is linear.
 *
 * Why this exists: the ladder had collapsed to a single set of numbers. Tier 1
 * and Tier 10 demanded exactly the same bay, so the only thing a Mark changed
 * was which hazards existed and how big a build budget you brought — and a tier
 * that asks a new player for the same $800 as a veteran is a bad first bay and
 * a weightless tenth one. The curve extends the ladder in BOTH directions from
 * those flat numbers: the bottom is genuinely gentler (more clock, a smaller
 * bar, cheaper shots) and the top genuinely heavier.
 *
 * The measurement in the MARK SCALING note below still stands — raising the bar
 * ALONE buys duration, not difficulty — and nothing here claims otherwise. Two
 * things carry the difficulty instead, and the tier only sets where they start
 * from: the tight purse (see the economy note above) and the hazard ratchet
 * (hazards.ts), which a run is forced to take a notch of after every bay.
 *
 * Every number is a named constant because a play pass will edit them first,
 * and sim/marks.ts sweeps them (--ratchets spread models the ratchet a run
 * actually carries; without it the ladder alone reads FREE at mid Marks, which
 * is the finding, not a bug).
 * ------------------------------------------------------------------------ */

/** Tiers on the ladder. Mirrors upgrades.ts's MARK_COUNT, duplicated rather
 *  than imported to keep this module import-free of the upgrade layer (which
 *  imports LevelConfig from here); sim/systems.ts asserts the two agree. */
export const TIER_COUNT = 10;

/* ---------------------------------------------------------------------------
 * THE TARGET CURVE, RECALIBRATED FOR THE GRADED ECONOMY (2026-08-28)
 *
 * The owner, on the game as it plays with graded payouts: *"given this extra
 * boost of points, levels are feeling very short, I think we need to raise the
 * base target by like a lot."*
 *
 * MEASURED FIRST, because "very short" is a duration and the ladder had never
 * been calibrated against one. `sim/_scratch-target.ts` multiplies each bay's
 * own target and nothing else, on that Mark's full build, and reports win rate
 * AND seconds-to-win against a clock that is 180s at Tier 1 and 144s at Tier 10
 * (4 seeds, `demo` pilot):
 *
 *   Mark Bay Arm     x1.00      x1.40      x1.80      x2.20
 *   2    1   sweep   75%/26s    75%/30s    75%/38s    75%/40s
 *   2    1   timed  100%/40s   100%/56s   100%/61s   100%/68s
 *   5    1   sweep   50%/14s    50%/32s    50%/64s    50%/92s
 *   5    1   timed  100%/38s   100%/45s   100%/51s   100%/62s
 *   5    5   sweep  100%/39s    75%/89s   50%/112s   50%/125s
 *   5    5   timed  100%/50s   100%/56s   100%/61s   100%/79s
 *   10   1   sweep   50%/56s   50%/108s   25%/148s      0%/—
 *   10   1   timed  100%/43s   100%/61s   100%/71s   100%/76s
 *   10   5   sweep  50%/117s    25%/85s   25%/102s   25%/131s
 *   10   5   timed  100%/55s   100%/61s    75%/68s    75%/73s
 *
 * THE x1.00 COLUMN IS THE COMPLAINT, stated as a number: a timed pilot cleared
 * every bay on the ladder in 38-55 SECONDS of a 144-180 second shift — a bay
 * ended at barely a quarter of its own clock, and the clock was therefore not a
 * pressure at all.
 *
 * x1.80 IS WHAT THE TABLE CHOOSES, and it is chosen on two conditions at once
 * rather than on one:
 *
 *  - the timed arm still clears comfortably (100% everywhere but Tier 10 bay 5,
 *    where it is 75%), at 51-71s — under half the shift, so the raise buys
 *    pressure without turning the bay into a race;
 *  - the untimed arm stops being carried: 75% at Tier 2, 50% at Tier 5, 25-50%
 *    at Tier 10. That is the owner's *"push the players in the right
 *    direction"* showing up as a win rate rather than as an intention.
 *
 * x2.20 was refused: it takes the timed arm off 100% at two rows and the
 * untimed arm to 0% at Tier 10 bay 1, which is a difficulty tax on the ladder's
 * middle — the one thing the grade brief rules out.
 *
 * THE OTHER SUSPECT, MEASURED AND ACQUITTED AS THE MAIN CAUSE. The owner's own
 * second thought was the Reactor: *"it also may be because my reactor is
 * upgraded to tier 2 at tier 2."* `sim/_scratch-pacing.ts` isolates it — one
 * track, three tiers, everything else stock:
 *
 *   Mark Bay Reactor  sweep win/secs/End÷Tgt
 *   2    1   T0       100% / 61s / 1.09
 *   2    1   T2       100% / 57s / 1.28
 *   5    1   T0        75% / 59s / 0.84
 *   5    1   T2       100% / 42s / 1.26
 *
 * The Reactor's second tier is worth roughly +20-50% of a bay's end money and
 * takes about a quarter off the time to clear — real, and NOT the cause: the
 * bay already ended at 59-61 seconds with the Reactor at STOCK. A gate on the
 * refit would take back a quarter of one track's contribution while leaving the
 * bay ending in a third of its clock, so it cannot restore the pacing on its
 * own and stacking it on top of a raise the table already says is right would
 * be two punishments for one problem. The target raise carries the load and no
 * upgrade is gated in this pass; design/balance/timed-clears.md §9 records the
 * decomposition and flags the general shape (a tier-2 refit reachable at the
 * Mark where it trivialises pacing is not unique to the Reactor) for a pass
 * that can measure the whole refit ladder rather than one track.
 *
 * EXPRESSED IN THE FOUR CONSTANTS THEMSELVES rather than as a scale factor over
 * them, because a scale factor is a second curve: every reader of this ladder —
 * the pins that walk it, the Skydeck's step off the end of it, the draft
 * projection — would then have to know about two numbers where there is one
 * decision. Each constant is its old value times 1.8, rounded to the same kind
 * of round number it already was.
 * ------------------------------------------------------------------------ */

/** Funding target on the FIRST bay of a Tier 1 run, and what each further tier
 *  adds to it. 600/20 before the recalibration above. */
export const TARGET_BASE = 1080;
export const TARGET_PER_TIER = 36;

/** What each further BAY inside a run adds to the target, and how much that
 *  per-bay step itself grows per tier (Tier 1 climbs $100 a bay, Tier 10 $118).
 *
 *  The ramp is the ladder's own difficulty curve and the reason the old one was
 *  removed no longer applies. The old ramp (800 + 150i against a flat $250
 *  float and uncapped carry) was measured to be a DURATION knob: with a
 *  bottomless purse, income per line always beat spend per line, so any target
 *  was only a matter of time. The budget is the lever that now bites (tight
 *  float, capped carry), and once money is scarce a rising target lengthens the
 *  bay's demand against a purse that does NOT rise with it — which is a
 *  difficulty curve. It also takes the ramp out of the player's draft: the
 *  ladder's own climb is no longer something a hazard card can be spent opting
 *  into (hazards.ts RETIRED Quota Raise from the offer for exactly this reason;
 *  see RETIRED_AXES).
 *
 *  The tier steepens it rather than replacing it: what a tier moves outright is
 *  where the run STARTS (TARGET_BASE + TARGET_PER_TIER), so Tier 1 climbs
 *  $1080 -> $2700 across its ten bays and Tier 10 climbs $1404 -> $3348 before
 *  the precision premium (100/2 before the recalibration above). */
export const TARGET_PER_BAY = 180;
export const TARGET_PER_BAY_PER_TIER = 4;

/** Bay clock at Tier 1, and the seconds each further tier takes off it. */
export const TIME_BASE = 180;
export const TIME_PER_TIER = 4;

/** Launch cost at Tier 1 and at the top of the ladder; the tiers between are a
 *  straight line, rounded to whole dollars (20, 21, 22, 23, 24, 26, 27, 28, 29,
 *  30). Held flat WITHIN a run on purpose — a cost that climbs per bay while
 *  the target climbs too compounds into a bankruptcy cliff, and the economy
 *  note above records the sweep that chose a shorter runway over a dearer shot
 *  as the way to tighten a bay. */
export const LAUNCH_COST_BASE = 20;
export const LAUNCH_COST_TOP = 30;

/** Opening launches the bay's float buys — the MISTAKE BUDGET, and the number
 *  the purse is actually tuned to (see the economy note above: at $250 the
 *  volume bot won 38% of bay 1, at eight launches 17%). It is a SHOT count
 *  rather than a dollar figure because the tier now prices a shot: holding the
 *  float at a flat $200 while the launch cost climbed $20 -> $30 would have
 *  quietly handed Tier 1 ten launches and Tier 10 six, moving the one number
 *  the sweep pinned. startingFunds is therefore derived from it, which keeps
 *  every tier's opening runway the same LENGTH while the tier decides what that
 *  runway costs (sim/systems.ts asserts the 7-9 band at every Mark). */
export const LAUNCH_BUDGET_SHOTS = 8;

/** THE SPILL FINE at the TOP of the ladder: Tier 10's bay 1, and what each
 *  further bay inside that run adds to it. These two numbers WERE the whole
 *  fine, at every tier, from the first build until the ramp below — the ladder
 *  is unchanged at Tier 10 and every quoted figure in the calibration notes
 *  still reads true there. */
export const SPILL_FINE_TOP_BASE = 25;
export const SPILL_FINE_TOP_PER_BAY = 2;

/** THE SPILL FINE at the BOTTOM of the ladder: $1 a cube on a Tier 1 bay.
 *
 *  Why it moved. The fine is billed PER CUBE (game.ts's chargeLostCubes bills
 *  lostCubes.length x this), so the flat $25 made one bounced tetromino cost
 *  $100 against Tier 1's $160 float: 62% of the opening runway on a single bad
 *  shot, and two of them put the bay out of reach before the player has
 *  finished learning the slingshot. That is the beginner report this ramp
 *  answers — the fine was not teaching precision, it was ending the lesson. At
 *  $1 the same spill is -$4: still a red -$ over the spot, still a debit, but
 *  an acknowledgment rather than a sentence.
 *
 *  Not zero, deliberately. A free spill would delete the rule at the exact tier
 *  the guide teaches it on (guide.ts's "Lost cargo" reads the FLOWN tier's bay
 *  1), and a player who meets the fine for the first time at Tier 5 meets it as
 *  a surprise. $1 keeps the mechanic visible and priced at nothing. */
export const SPILL_FINE_TIER1 = 1;


/** Clamp a Mark to the ladder. Callers pass RunState.mark, which is 1-based and
 *  already bounded — but makeBaseLevel is reachable from the sim, the attract
 *  loop and a restored save, so the curves refuse to extrapolate off either
 *  end rather than emitting a bay nobody can play. */
function tierOf(mark: number): number {
  return Math.max(1, Math.min(TIER_COUNT, Math.floor(mark)));
}

/** The funding target of bay `i` (0-based) at `mark`. Per-bay (not cumulative)
 *  because each bay is its own economy: only the capped overshoot above this
 *  target carries into the next bay's float (run.ts's RunState.carry /
 *  CARRY_CAP), never the whole ending score. */
export function targetScoreFor(i: number, mark = 1): number {
  return targetAtRung(tierOf(mark), i);
}

/* ---------------------------------------------------------------------------
 * THE PRECISION PREMIUM — what the top of the ladder asks that the middle
 * does not.
 *
 * The owner's report is about one place and says which: *"currently the game is
 * not challenging at sky levels in the early part of the run, the maxed out
 * systems carry you over and it's boring […] I'm thinking we can increase the
 * payout of lines and the targets so we can enforce good/excellent shots by
 * simply raising the target in later tiers and skybridge."*
 *
 * The payout half is grades.ts. This is the target half, and it only exists
 * because the payout half came first: raising a target against a FLAT line
 * price is the thing the MARK SCALING note above already measured and rejected
 * — *"TARGET is a DURATION knob, not a difficulty one […] once income per line
 * exceeds spend per line, a competent player reaches ANY target given time."*
 * That finding is untouched and is still the reason nothing here moves the
 * ladder's own ramp. What has changed is that income per line is no longer one
 * number: a row closed on the press is worth 1.5x one the press found for you,
 * so a target the swept player cannot reach in the time available is a target
 * the timed player still can. The raise has a lever to bite on for the first
 * time.
 *
 * MEASURED, sim/timing.ts --mode target, full build, 6 seeds, win rate per arm
 * as the bay's own target is multiplied and NOTHING else moves:
 *
 *   tier bay  arm     x1.00  x1.05  x1.10  x1.15  x1.20  x1.25
 *   4    5    sweep    100%   100%   100%   100%    83%    83%
 *   4    5    timed    100%   100%   100%   100%   100%   100%
 *   8    5    sweep    100%   100%    83%    83%    67%    67%
 *   8    5    timed    100%   100%   100%   100%   100%   100%
 *   10   5    sweep    100%    83%    67%    67%    67%    67%
 *   10   5    timed    100%   100%   100%   100%   100%   100%
 *   11   5    sweep     83%    83%    83%    83%    83%    83%   (Skydeck)
 *   11   5    timed    100%   100%   100%   100%   100%   100%
 *
 * Three things that table decides.
 *
 *  - WHERE THE PREMIUM STARTS. Tier 4 does not separate until x1.20, and it
 *    separates by breaking the swept arm rather than by rewarding the timed one
 *    — which is a difficulty tax on the ladder's middle, i.e. the one thing the
 *    brief rules out. Tier 8 separates at x1.10 and Tier 10 at x1.05. So the
 *    premium is ZERO at and below rung 8 and every tier from 1 to 8 is
 *    byte-identical (sim/systems.ts pins that, tier by tier and bay by bay).
 *  - HOW STEEP. +5% a rung: Tier 9 x1.05, Tier 10 x1.10, the roof x1.15. Each
 *    of those is at or one step past the multiplier at which the swept arm
 *    first drops on that floor, and the timed arm is at 100% through x1.25 at
 *    every one of them. That is the "meaningful but not brutal" margin the
 *    brief asks for, measured rather than asserted.
 *  - WHAT IT DOES NOT FIX. Bay 10 at Tier 10 does not move AT ALL across the
 *    whole multiplier range (sweep 67%, timed 83%, flat). The capstone is not
 *    lost on the target — it is lost on the pile and the purse — so the premium
 *    is honestly a bay-1-to-9 change and the deep-bay difficulty still belongs
 *    to the ratchet. Stated here rather than left for someone to rediscover.
 *
 * A SHARE OF THE RUNG'S OWN TARGET rather than a fourth additive constant, for
 * the reason every other curve here is written the way it is: the ladder
 * already states what a rung demands, and a premium in dollars would be a
 * second statement of that free to drift out of the first. As a share it rides
 * the target ramp along the bays for free — Tier 10 bay 1 gains $78 and bay 10
 * gains $184 — which is the right shape, because a later bay is where the swept
 * player's grades are worst (measured: 30% LUCKY at Tier 10 bay 10 against 0%
 * at bay 1).
 * ------------------------------------------------------------------------ */

/** The last rung that pays NO premium — the whole ladder up to and including
 *  it is byte-identical to the pre-grade game. Eight, because Tier 4 does not
 *  separate the arms at any multiplier that leaves it approachable and Tier 8
 *  is the first that separates them at a raise the timed arm shrugs off. */
export const PRECISION_PREMIUM_FROM_RUNG = 8;

/** What each rung ABOVE that adds, as a share of that rung's own target. */
export const PRECISION_PREMIUM_PER_RUNG = 0.05;

/** The multiplier the premium puts on `rung`'s targets. Exactly 1 at and below
 *  PRECISION_PREMIUM_FROM_RUNG, which is what makes "the mid ladder does not
 *  move" a fact about this function rather than about a sweep. */
export function precisionPremium(rung: number): number {
  return 1 + PRECISION_PREMIUM_PER_RUNG * Math.max(0, rung - PRECISION_PREMIUM_FROM_RUNG);
}

/** The target curve itself, asked of a RUNG instead of a Mark — i.e. with no
 *  clamp on either end.
 *
 *  Split out of targetScoreFor rather than copied into the Skydeck's step
 *  below, which is the whole discipline of that step: the roof does not get a
 *  curve of its own, it gets THIS curve evaluated one rung further along. Every
 *  caller that holds a Mark still goes through the clamped function above, so
 *  nothing but the roof can reach off the end of the ladder.
 *
 *  The premium multiplies the FINISHED number, so the roof inherits it from the
 *  same place it inherits everything else — rung 11 is one more step of one
 *  curve, not a second decision written next to it. Rounded to whole dollars:
 *  the HUD, the guide and the draft projection all quote the target as money. */
function targetAtRung(rung: number, i: number): number {
  const first = TARGET_BASE + TARGET_PER_TIER * (rung - 1);
  const perBay = TARGET_PER_BAY + TARGET_PER_BAY_PER_TIER * (rung - 1);
  return Math.round((first + perBay * Math.max(0, i)) * precisionPremium(rung));
}

/** The bay clock at `mark`, in seconds. Flat across a run — the tier sets the
 *  shift length, and the Shift Cut notch (hazards.ts) is how it gets shorter
 *  mid-run. */
export function timeLimitFor(mark = 1): number {
  return TIME_BASE - TIME_PER_TIER * (tierOf(mark) - 1);
}

/** The per-shot launch cost at `mark`. Flat across a run — see LAUNCH_COST_BASE. */
export function launchCostFor(mark = 1): number {
  return launchCostAtRung(tierOf(mark));
}

/** The launch-price line, asked of a RUNG — targetAtRung's twin, split out for
 *  the same reason and used by the same one caller past the ladder's top. The
 *  SLOPE is the ladder's own (its two endpoints over its nine gaps), so a rung
 *  past the top is the tenth gap and not a new decision. */
function launchCostAtRung(rung: number): number {
  const span = (LAUNCH_COST_TOP - LAUNCH_COST_BASE) / (TIER_COUNT - 1);
  return Math.round(LAUNCH_COST_BASE + span * (rung - 1));
}

/** The bay's opening float at `mark`: LAUNCH_BUDGET_SHOTS shots' worth, so the
 *  runway is the same length at every tier ($160 at Tier 1, $240 at Tier 10)
 *  and only its price moves. */
export function startingFundsFor(mark = 1): number {
  return LAUNCH_BUDGET_SHOTS * launchCostFor(mark);
}

/**
 * The per-CUBE fine for cargo the bay loses, at bay `i` (0-based) and `mark`.
 *
 * DERIVATION. Two endpoints were decided and everything else is the straight
 * line between them:
 *
 *   fine(i, tier) = SPILL_FINE_TIER1 + (top(i) - SPILL_FINE_TIER1) * t
 *   top(i)        = SPILL_FINE_TOP_BASE + SPILL_FINE_TOP_PER_BAY * i
 *   t             = (tier - 1) / (TIER_COUNT - 1)        // 0 at T1, 1 at T10
 *
 * so Tier 1 bay 1 is $1 and Tier 10 bay 10 is the historical $43, with e.g.
 * Tier 5 bay 1 at $12 and Tier 5 bay 10 at $20.
 *
 * Interpolating the FINISHED number rather than the base and the per-bay step
 * separately is not a shortcut — it is the same curve. Expand it:
 * 1 + t(24 + 2i) = (1 + 24t) + (2t)i, i.e. lerping the endpoint value is
 * identical to lerping the base from $1 to $25 and the per-bay step from $0 to
 * $2. Written as one lerp because then the two numbers a play pass actually
 * argues about — what Tier 1 charges and what Tier 10 charges — are the two
 * constants above, rather than being recoverable only by doing this algebra.
 *
 * WHY LINEAR. The default, and the calibration data does not argue against it:
 *
 *  - The other three tier curves (target, clock, launch cost) are all straight
 *    lines. A fourth on a different curve makes the ladder four stories instead
 *    of one, and nothing here needs its own story.
 *  - The MARK SCALING note below records the one measurement that touches this
 *    knob, and it argues for a GENTLE bottom rather than a fancy shape: press
 *    speed scaled per Mark was cut because a faster sweep shoves pieces out
 *    before they settle "so the lost-piece penalty drains the bankroll" — 3/3
 *    wins became 1/3 at bay 5. That is this fine acting as an erratic
 *    bankruptcy tax, and it says the knob is SHARP, i.e. the shape that would
 *    hurt is a convex one that stays near-free through the mid tiers and then
 *    spikes into exactly that cliff. Linear spends the whole ladder climbing.
 *  - The mirror shape (concave, most of the rise in the first tiers) front-loads
 *    the punishment onto precisely the players this change is for.
 *
 * Rounded to whole dollars — the HUD, the toast and the projection tile all
 * quote it as money — and monotone in both arguments after rounding, which
 * sim/systems.ts pins along with the two endpoints.
 */
export function penaltyPerLostPieceFor(i: number, mark = 1): number {
  const top = SPILL_FINE_TOP_BASE + SPILL_FINE_TOP_PER_BAY * Math.max(0, i);
  const t = (tierOf(mark) - 1) / (TIER_COUNT - 1);
  return Math.round(SPILL_FINE_TIER1 + (top - SPILL_FINE_TIER1) * t);
}

/** What a tier asks of you, as the three numbers a menu has to quote before
 *  you accept it: the FIRST bay's funding target, the shift length and the
 *  price of a shot. A tier the player can't read before pressing Play is just a
 *  number next to the word "Tier", so this exists to be printed rather than to
 *  be played — the bay itself is always makeBaseLevel's whole config. Nothing
 *  in ui/ prints it today, though: the menu's recap panel reads the same three
 *  knobs straight off the bay (screens.ts's baseBayPanelHTML over baseBayFor),
 *  and this function's only caller is sim/systems.ts's ladder assertions. Two
 *  statements of one ladder is one too many, and the screens' copy is the one
 *  that has to be right. */
export function tierDemands(mark = 1): {
  tier: number;
  targetScore: number;
  targetPerBay: number;
  timeLimitSec: number;
  launchCost: number;
} {
  const tier = tierOf(mark);
  return {
    tier,
    targetScore: targetScoreFor(0, tier),
    targetPerBay: targetScoreFor(1, tier) - targetScoreFor(0, tier),
    timeLimitSec: timeLimitFor(tier),
    launchCost: launchCostFor(tier),
  };
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
 * - compactorSpeed creeps up with i so later bays punish sloppy play faster.
 * - penaltyPerLostPiece creeps up with i too, but the size of that creep is
 *   the TIER's (penaltyPerLostPieceFor): Tier 1 charges a flat $1 a cube for
 *   all ten bays, Tier 10 the full 25 + 2i ladder. It is the only knob here
 *   that reads both i and the mark.
 * - targetScore climbs every bay on its own (TARGET_PER_BAY·i, steepened a
 *   little by the tier); the clock, the launch cost and the opening target are
 *   the TIER's three knobs (see the tier-ladder note above) and are flat inside
 *   a run, as is startingFunds (eight launches' worth) — only the prior bay's
 *   CAPPED overshoot
 *   (RunState.carry) stacks on top. The purse is deliberately tight: a flat
 *   float against a rising quota means later bays demand more lines from the
 *   same money, which is what makes precise launches the strategy (scorePerLine
 *   still ramps +10/bay, so a clean line stays net-positive all the way down).
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

/* ---------------------------------------------------------------------------
 * THE SKYDECK'S STEP — the eleventh rung of a ten-rung ladder.
 *
 * The roof (game/skydeck.ts) flies Mark 10's bays, and the owner's playtest
 * verdict on those bays was that the day's run reads like a Deep Run rather
 * than like the exam above one: "the numbers for target and launch cost should
 * bump up one more step in skydeck". So it gets ONE more step, and the step is
 * the ladder's own — the curves above evaluated at SKYDECK_RUNG rather than a
 * second set of numbers written next to them:
 *
 *   target  $1404 -> $3348 becomes $1505 -> $3576  (targetAtRung, before
 *           the precision premium; $1544 -> $3683 and $1656 -> $3933 with it)
 *   launch  $30, float $240 becomes $31, float $248 (launchCostAtRung)
 *
 * WHY ONLY THOSE TWO. They are the two the owner named, and they are also the
 * two whose curve says something at a rung nobody has to survive being new at:
 * the CLOCK would extrapolate to 140s and the SPILL FINE past $43 a cube, and
 * neither was measured or asked for. The roof is a money exam; a shorter shift
 * is a different exam and belongs to whoever measures it.
 *
 * WHY THE FLOAT MOVES WITH THE SHOT. LAUNCH_BUDGET_SHOTS is the ladder's rule
 * that every tier opens on the same RUNWAY and only the price of it changes
 * (see its note). Holding the float at Mark 10's $240 while the shot went to
 * $31 would have quietly handed the roof seven launches where every rung below
 * it gets eight — moving the one number the sweeps pinned, as a side effect of
 * a target change. So the float is derived here exactly as it is there.
 * ------------------------------------------------------------------------ */

/** The rung the Skydeck prices its bays at: ONE PAST the Mark it is flown at.
 *
 *  Stated against the mark rather than as the bare number 11, because "one
 *  step above the floor below it" is the rule and 11 is only what the rule
 *  evaluates to at the shipped SKYDECK_MARK (= MARK_COUNT). Two things depend
 *  on that generality: a ladder that grows an eleventh Mark takes the roof up
 *  with it, and sim/skyyard.ts can fly the mode's whole shape at a Mark where
 *  the bots still have resolution (sim/skydeck.ts's `--mark 6` argument) rather
 *  than measuring a control already on the floor.
 *
 *  At MARK_COUNT it is ui/screens.ts's SKYDECK_TIER, the TOWER's sentinel for
 *  the floor above the Marks — not imported from there (this module is
 *  import-free of the UI); sim/systems.ts pins the two equal, because the floor
 *  the car parks on and the rung its bays are priced at have to be one place. */
export function skydeckRungFor(mark: number): number {
  return tierOf(mark) + 1;
}

/** The shipped rung: what skydeckRungFor answers for the Mark the roof is
 *  actually flown at. Named so screens and pins can quote it without repeating
 *  the "+1". */
export const SKYDECK_RUNG = TIER_COUNT + 1;

/** Bay `i`'s funding target on the Skydeck, at the Mark it is flown at. */
export function skydeckTargetScoreFor(i: number, mark = TIER_COUNT): number {
  return targetAtRung(skydeckRungFor(mark), i);
}

/** The Skydeck's launch price, and the float that buys the ladder's eight
 *  launches of it. */
export function skydeckLaunchCost(mark = TIER_COUNT): number {
  return launchCostAtRung(skydeckRungFor(mark));
}
export function skydeckStartingFunds(mark = TIER_COUNT): number {
  return LAUNCH_BUDGET_SHOTS * skydeckLaunchCost(mark);
}

/**
 * THE ROOF'S SCRAP RATE — half the ladder's, on both halves of it.
 *
 * The Skydeck earned no scrap at all while it had no yard (the currency had
 * nowhere to go). The yard is back — run.ts's refitAfterBay carries the design
 * history — and the rate it comes back at is not the ladder's, for a reason
 * that is entirely about WHO is flying. The roof opens only to a player holding
 * every Mark's seal (meta.ts's skydeckOpen), and that player's Workshop is
 * FINISHED: every rung the yard can still sell them is a tier-3 rung — the
 * Workshop sells to UPRATE_MAX_TIER and stops, so the yard is the only place
 * tier 3 exists — and every one of them costs the same TIER_COSTS[2]. That flat
 * price is what collapses the owner's two levers ("more expensive or less scrap
 * given") into one: with every purchasable rung at a single price, charging more
 * for a rung and paying less for a bay are the same arithmetic, and the honest
 * place to spend the one lever is the number this mode already owns rather than
 * a second price table that would give one rung two prices.
 *
 * SO THE ROOF PAYS HALF, ON BOTH RATES — and the size of that cut is the one
 * number here that was argued from a table rather than from a principle,
 * because purchasing power is not a matter of opinion: income and price are both
 * deterministic, so what a run can buy is arithmetic once you fix how many lines
 * a bay clears. design/balance/skydeck-yard.md carries it in full. The short
 * version, for the endgame player this floor is for (~12 lines a bay):
 *
 *   ladder payout   34/bay   stop 1 at 102   FIVE of the eight rungs, a run
 *   HALF (shipped)  17/bay   stop 1 at  51   TWO, and the first stop is
 *                                            reachable only by an opening that
 *                                            really dismantled its three bays
 *   lines only      24/bay   stop 1 at  72   THREE for an expert and ONE for a
 *                                            weak run — the same tightening
 *                                            aimed at the wrong player
 *
 * The last row is the one worth recording as REJECTED, because it was the
 * design-nicer idea. Withholding SCRAP_PER_BAY alone ("the roof pays for lines,
 * not for arriving") reads beautifully and taxes exactly the wrong pilot: a
 * player who clears twelve lines a bay barely notices it, while a rough run
 * loses most of its income — and the owner's brief is that the EXPECTED
 * Skydeck player, the one with the finished Workshop, is the one arriving with
 * too much. Halving both rates cuts the strong run and the weak one by the same
 * fraction, which is what "tighten the endgame" actually asks for.
 *
 * A SHARE rather than a second pair of typed numbers, so re-pricing a line on
 * the ladder moves the roof with it — the same discipline the step above keeps
 * with the target and launch curves. Both halves come out whole at the shipped
 * rates (2 -> 1, 10 -> 5); sim/systems.ts pins that they are EXACTLY half, so a
 * future rate that halves untidily fails a check and asks for a decision rather
 * than rounding one silently.
 */
export const SKYDECK_SCRAP_SHARE = 0.5;
export const SKYDECK_SCRAP_PER_LINE = Math.round(SCRAP_PER_LINE * SKYDECK_SCRAP_SHARE);
export const SKYDECK_SCRAP_PER_BAY = Math.round(SCRAP_PER_BAY * SKYDECK_SCRAP_SHARE);

/**
 * LINES A BAY CLEARS FOR THE PLAYER THIS FLOOR IS FOR — the rate every scrap
 * claim on the roof is denominated in.
 *
 * Twelve. It is not a new number: the SKYDECK_SCRAP_SHARE note directly above
 * argues its whole table "for the endgame player this floor is for (~12 lines a
 * bay)", and design/balance/skydeck-yard.md carries the working. It is named
 * here because the ROOF'S FIRST REFIT STOP now turns on it, and a load-bearing
 * figure that exists only inside a prose parenthesis is a figure no check can
 * reach.
 *
 * IT IS A MODEL OF A HUMAN, and that is the caveat the pins carry with it. The
 * harness's pilots clear five to seven rows a bay on the roof
 * (sim/timing.ts --mode scrap --skydeck), which is the standing pessimism of
 * every bot in sim/ — no lookahead, one landing target a shot — and not a
 * refutation of the rate. Anything derived from this is a claim about the
 * player the note describes; the bots put a FLOOR under it and cannot confirm
 * it.
 */
export const SKYDECK_ENDGAME_LINES_PER_BAY = 12;

/**
 * WHAT THE ROOF'S FIRST STOP CAN BUY — the arithmetic behind "refit of some
 * systems's third tier should be possible".
 *
 * The state before this change, from the SKYDECK_SCRAP_SHARE note's own table:
 * a roof run arrives at stop 1 with 51 scrap against a tier-3 rung priced at
 * TIER_COSTS[2] = 55. The note reads that as "reachable only by an opening that
 * really dismantled its three bays" — but 51 < 55 is not "reachable", it is a
 * DEAD STOP: the player docks at the first yard the mode has, is shown a shelf
 * on which every item costs more than they hold, and undocks. The design missed
 * its own stated intent by four scrap.
 *
 * THE PRECISION PREMIUM IS WHAT CLOSES IT, and closes it without a second dial.
 * The roof's targets rise 15% (precisionPremium at SKYDECK_RUNG), so a roof bay
 * has to SELL 15% more rows to open its door; scrap is paid per row and is
 * deliberately ungraded (grades.ts: skill pays funds, volume pays scrap), so the
 * income rises with the demand:
 *
 *   before   3 x (12.0 lines x 1 + 5) = 51   <  55   nothing on the shelf
 *   after    3 x (13.8 lines x 1 + 5) = 56   >= 55   exactly ONE rung
 *
 * EXACTLY ONE IS THE DESIGN, not a happy accident of the rounding. Every rung
 * the roof's yard can still sell costs the same TIER_COSTS[2] (the Workshop
 * stops at UPRATE_MAX_TIER, so tier 3 is all that is left), so "how many rungs
 * does stop 1 afford" IS "how many systems get chosen". One is a decision the
 * player has to make and can get wrong; two would be a shopping trip, and the
 * whole argument of the note above is that this floor exists to tighten an
 * endgame where the player arrives with too much. sim/systems.ts pins BOTH
 * halves of the inequality — that stop 1 reaches one rung, and that it does not
 * reach two.
 *
 * The later stops were never the problem and are unchanged in kind: stop 2 and
 * stop 3 each add another rung's worth, so a roof run that plays well spends
 * three separate decisions across the ten bays instead of two and a locked door.
 */
export function skydeckScrapAtFirstStop(
  linesPerBay = SKYDECK_ENDGAME_LINES_PER_BAY,
  /** Bays cleared before the first stop opens — run.ts's REFIT_EVERY, which
   *  this module cannot import (run.ts imports level.ts, and closing that cycle
   *  to read one integer would be the worst possible trade). Defaulted to the
   *  shipped 3 and pinned equal to the real constant in sim/systems.ts, which
   *  is the same treatment UNBREAKABLE_MARK gets against hazards.ts's
   *  CAPSTONE_MARK. */
  baysPerStop = 3,
  mark = TIER_COUNT,
): number {
  const lines = linesPerBay * precisionPremium(skydeckRungFor(mark));
  return Math.floor(baysPerStop * (lines * SKYDECK_SCRAP_PER_LINE + SKYDECK_SCRAP_PER_BAY));
}

/**
 * Write the Skydeck's economy onto a bay — the roof's opening terms, in the
 * slot the ladder's own terms occupy.
 *
 * Called by run.ts's levelForRun on the BASE config, before the ship, the
 * ratchets and the clauses land on it, because that is what the step IS. A
 * notch on the cost axis then scales $31 rather than $30, and a Rate Cut clause
 * takes its quarter out of the roof's rate — the ordering every other layer
 * already relies on (see levelForRun's note).
 *
 * `mark` is the Mark the bay was built at, so the step is always one rung above
 * the floor below it (skydeckRungFor). It defaults to the top of the ladder,
 * which is the only value the shipped mode ever passes.
 *
 * Mutates rather than returning a copy, matching applyUpgrades' shape at the
 * same seam; the config it is handed is always a fresh makeBaseLevel.
 */
export function applySkydeckEconomy(cfg: LevelConfig, i: number, mark = TIER_COUNT): void {
  cfg.targetScore = skydeckTargetScoreFor(i, mark);
  cfg.launchCost = skydeckLaunchCost(mark);
  cfg.startingFunds = skydeckStartingFunds(mark);
  cfg.scrapPerLine = SKYDECK_SCRAP_PER_LINE;
  cfg.scrapPerBay = SKYDECK_SCRAP_PER_BAY;
}


/**
 * MARK SCALING — how much harder bay `i` gets per Mark above the first.
 *
 * The Mark ladder raises the floor and the bar TOGETHER: a Mark hands the
 * player a bigger build budget (upgrades.ts's budgetForMark) and this is the
 * matching rise in what a bay demands. Without it a Mark would just be free
 * power and every board above Mark 1 would be easier than the one below it.
 *
 * Only the two knobs that state the bay's DEMAND were ever scaled here — the
 * funding target and the press tempo. Deliberately not scaled: windMax
 * (weather is the bay's character, and the launcher track is the sanctioned
 * answer to it — see the BALANCE KNOBS note).
 *
 * launchCost and penaltyPerLostPiece are not scaled HERE either, and the old
 * reason ("they would compound with the target into a difficulty cliff") is
 * still the reason there is no multiplier on them. Both now ride the TIER
 * LADDER instead, which is the opposite move: the ladder states each tier's
 * number outright on an explicit curve, and both of them read LOWER at the
 * bottom than the flat number they replaced ($20 and $1 against $25 and $25).
 * A cliff was never what a gentler Tier 1 needed guarding against.
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
 *    still gave 3/3 wins — runs finished in 41-67s against limits of 150-240s.
 *    Those limits are the PRE-LADDER ones, measured before #88 on the old
 *    150s + 10s/bay clock, which no longer exists: the clock is TIME_BASE 180s
 *    at Tier 1 down to 144s at Tier 10 and FLAT inside a run. The finding
 *    survives the change — 144s is still more than twice the longest run
 *    measured — but the numbers are history, not the shipped bay.
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
 * TARGET_STEP — the per-Mark MULTIPLIER this note zeroed — is gone, and the
 * tier ladder that replaced it is not a re-run of it. That knob piled a
 * percentage onto one shared bar; the ladder above states each tier's opening
 * target, clock and launch cost as absolute numbers on an explicit curve
 * (targetScoreFor / timeLimitFor / launchCostFor), and its bottom half moves
 * DOWN from the flat numbers rather than up.
 *
 * What a Mark moves is therefore three OPENING TERMS plus one content number,
 * the bond ramp (BOND_MARK_STEP below) — which is the kind of knob the
 * measurement said Mark difficulty has to come from: stronger bonds change what
 * the rig must DO, not how much the bay asks for. Everything the measurement
 * ruled out stays ruled out: no multiplier, no press-tempo scaling
 * (MARK_SPEED_STEP, kept as a named seam at 0 so the measurement that zeroed it
 * stays attached to the knob it describes), and no claim that a bigger bar is
 * what makes a high Mark hard. A Mark is still mostly a statement about WHICH
 * hazards and systems exist (hazards.ts's ladder, meta.ts's INSTALLS).
 */
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
 * $42/line at Tier 1 and $13 at Tier 10, since the tier prices the shot and
 * not the row — 100 - 2.9 * launchCostFor(mark) at the measured ~2.9
 * launches/line — so a fee that compounds into broke ends the bay
 * unrecoverably where clock/reload/combo pressure does not; measured:
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
 * three-slag cluster returns $60 against a launch that costs $20 at Tier 1 and
 * $30 at Tier 10, so disposal is clearly worth the shot; one line pays
 * scorePerLine (100+) before combo, so disposal never out-earns playing the
 * game. That is the same hierarchy the bomb's
 * stingy quarter-rate scrap trickle already protects.
 */
export const SLAG_BOUNTY = 20;

/**
 * What share of the bay's own SPILL FINE a volatile detonation is billed, per
 * live cube it destroys (lineClear.ts's volatileLossFor).
 *
 * A SHARE OF AN EXISTING PRICE, not a new ladder. The bay already knows what
 * losing a cube of cargo is worth — penaltyPerLostPieceFor, billed per cube
 * (game.ts bills `lostCubes.length * penaltyPerLostPiece`) and already ramped
 * across the tiers and along the bays. A second price for the same event would
 * be a number free to drift out of the first and would have to be re-derived at
 * every tier; riding the fine means volatile costs what losing cargo costs,
 * wherever the player is standing. Across the axis's whole life — it opens at
 * Mark 7 — that is $22 a cube at Tier 7 bay 5 and $43 at Tier 10 bay 10.
 *
 * WHY A SHARE AND NOT THE WHOLE FINE. The two losses are not the same loss. A
 * spilled shipment leaves the bay entirely and takes its slot with it; a
 * detonation destroys cargo that was already ON the pile and hands back the
 * space it occupied — space the measurement below showed is worth having. The
 * player is billed for the cargo and credited, implicitly, with the room.
 *
 * 0.25, AND THE SWEEP THAT PICKED IT. Measured at Tier 7 bay 10, 16 paired
 * seeds, on the material rig, against an 88% clean control — the `demo` pilot
 * (adaptive, re-aims every shot) and `lob-flat` (a fixed high arc), because the
 * two detonate at very different rates and a price that only works for one is
 * not a price:
 *
 *            volatile:1        volatile:3        volatile:6 (belt cap)
 *   share    demo / lob-flat   demo / lob-flat   demo / lob-flat
 *   0.00      94% /  88%       100% /  94%       100% /  94%   <- the defect
 *   0.25      94% /  88%       100% /  94%        63% /  63%
 *   0.30      94% /  88%       100% /  94%        56% /  69%
 *   0.35      94% /  88%       100% /  94%        38% /  56%
 *   0.40      94% /  81%        94% /  94%        25% /  50%
 *   0.50        -               88% /  88%        19% /  50%
 *
 * Two things that table settles. First, 0.25 is the SMALLEST share that removes
 * the defect, and it removes it for both pilots by the same amount — 63% each,
 * against 88% clean. Anything above it buys no extra symmetry and spends the
 * cap: by 0.4 the adaptive pilot is at 25% while the fixed-arc one is still at
 * 50%, which is a price that depends on how you fly rather than on what you
 * took. Second, the shallow notches barely move at any share, and that is a
 * property of the mechanic rather than a gap in the pricing: one notch fires
 * ~2.5 detonations a bay against the cap's ~19.4, so there is very little to
 * bill. 94% against an 88% control is one seed in sixteen — inside this
 * instrument's noise, which is why sim/systems.ts pins the CAP and says so.
 *
 * WHY THE COST GROWS FASTER THAN THE BENEFIT, deliberately. Live cubes caught
 * per detonation is flat (~5, whatever the notch), so the bill scales with the
 * detonation COUNT and therefore with the notch; the relief saturates instead
 * (mean pile 31.4 clean -> 27.4 at one notch -> 20.2 at the cap). A hazard that
 * hurts more the deeper it is taken is the right shape, and it is the shape
 * hazards.ts's Fibonacci ladders already give the number axes.
 */
export const VOLATILE_LOSS_SHARE = 0.25;

/** Lines per returned charge at a MAXED Demolition Rack. A clean bay clears ~8
 *  lines, so the capstone runs ~8 charges instead of 6 and a long grinding bay
 *  keeps paying — which is the case this exists for, since a bay can out-last
 *  six charges long before it ends. */
export const DEMO_RESUPPLY_LINES = 4;

/**
 * THE CAPSTONE'S OTHER TWO HALVES — what a MAXED Demolition Rack buys besides
 * charges, and why charges alone were not enough.
 *
 * The resupply line answered the question "what happens when a bay out-lasts six
 * charges", and it answered it correctly. It did not answer the one a Tier-10
 * bay actually asks, which the owner's playtest states exactly: with replenishing
 * bombs aboard, "I still couldn't clear all the slag and couldn't make new lines
 * because tar everywhere." That is not a bay short of charges. It is a bay where
 * each charge does not do enough, and where the money each one returns no longer
 * keeps up with what a Tier-10 launch costs.
 *
 * So the capstone now moves all three numbers that make demolition a STRATEGY
 * rather than a rescue valve, and the two here are the ones that answer a
 * high-material bay specifically:
 *
 *  - DEMO_BLAST_MULT — the charge reaches further. A welded tar crust is the
 *    case the stock radius handles worst: tar's joints cannot be broken by the
 *    press or by a Bond Breaker (game.ts's resolveTarWelds), so the ONLY thing
 *    that opens one is vaporizing the cubes themselves, and a stock blast takes
 *    a bite roughly a piece wide out of a crust that spans the bay. x1.35 on the
 *    radius is x1.8 on the AREA — the difference between chipping at the crust
 *    and cutting a hole through it — while still landing well short of the
 *    Bond Breaker's field-wide reset, which stays the rare consumable.
 *
 *  - DEMO_SALVAGE_MULT — the charge pays enough to fire. salvagePerCube is $8,
 *    tuned against a Tier-1 launch at $20; at Tier 10 a launch is $30 and the
 *    bay's target has climbed with it, so clearing a dead pile the size of a
 *    line — 8 cubes, $64 — no longer even covers the shots spent placing the
 *    row it unblocks. x1.5 puts a cube back at $12 and a line-sized clear at
 *    $96, which is under scorePerLine at every bay (100 + 10i, before combo) —
 *    so the hierarchy level.ts's SLAG_BOUNTY note sets out survives intact:
 *    disposal is clearly worth the shot, and never out-earns playing the game.
 *
 * Both are the CAPSTONE only, deliberately. Tiers 1 and 2 stay "+2 charges", so
 * the track keeps its shape — quantity, quantity, then a change in kind — and
 * the rung that changes kind is the one a player reaches by choosing to commit
 * to demolition rather than by dabbling in it.
 */
export const DEMO_BLAST_MULT = 1.35;
export const DEMO_SALVAGE_MULT = 1.5;

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
    // The one MISTAKE price on the tier ladder: $1 a cube flat at Tier 1,
    // climbing to the historical 25 + 2i at Tier 10 (penaltyPerLostPieceFor).
    // It is billed per CUBE, so what the tier really moves is what one bounced
    // shipment costs — $4 at the bottom of the ladder, $100 at the top.
    penaltyPerLostPiece: penaltyPerLostPieceFor(i, mark),
    // The TARGET climbs every bay on its own (see targetScoreFor) — that is
    // the ladder's own difficulty curve, and it is deliberately NOT one of the
    // axes the hazard draft can spend a notch on. What the TIER sets is where
    // that climb starts, how steeply it climbs, and the price of a shot; the
    // float buys the same EIGHT launches at every tier, because that count is
    // the pressure — bays are won by placing shots, not by volume — while the
    // tier decides what those eight cost ($160 at Tier 1, $240 at Tier 10).
    targetScore: targetScoreFor(i, mark),
    startingFunds: startingFundsFor(mark),
    launchCost: launchCostFor(mark),
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
    timeLimitSec: timeLimitFor(mark),
    pieceSize: "std",
    // Clean. Materials are no longer scheduled by bay and Mark at all — they
    // arrive only when the player ratchets a content axis, which is what turns
    // slag from something the ladder inflicts into something accepted in place
    // of a harder number.
    materialMix: { ...NO_MATERIALS },
    bombCharges: 0,
    salvagePerCube: 8,
    // Stock blast. Inert-by-default, the same stance windMax 0 and
    // volatileTriggerMult 1 take — the Demolition Rack's capstone is the only
    // thing that moves it.
    bombBlastMult: 1,
    // Stock priming. Inert-by-default, the same stance windMax 0 and
    // autoLaunchMs 0 take.
    volatileTriggerMult: 1,
    // No liner. Inert-by-default like the two above, and stated as two fields
    // so a rig that buys depth without softening (or the reverse) is a
    // representable state rather than an accident of one packed number.
    cushionCells: 0,
    cushionMult: 1,
    // No hood. Inert-by-default like the liner above: a bay with no Incinerator
    // remits nothing, so every bay played before the track existed prices its
    // losses byte-identically.
    incineratorRelief: 0,
    slagBounty: SLAG_BOUNTY,
    volatileLoss: Math.round(penaltyPerLostPieceFor(i, mark) * VOLATILE_LOSS_SHARE),
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
    thawCharges: 0,
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

/** The 10-bay base ladder AT TIER 1 (before any ship upgrades or ratchets — see
 *  run.ts's levelForRun).
 *
 *  The `LEVEL_1` alias below is what the howto and menu copy used to quote
 *  their numbers from, and nothing quotes it any more: with the tier ladder, a
 *  bare "level 1" config silently means TIER 1's level 1, so copy built from it
 *  is true for a new player and wrong for everyone above them. The screens that
 *  quote numbers build the bay for the tier they are describing instead —
 *  ui/screens.ts's baseBayPanelHTML reads it off baseBayFor, and guide.ts
 *  rebuilds its whole catalogue per Mark from makeBaseLevel(0, mark). */
export const LEVELS: LevelConfig[] = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i));

// Nothing in app/src or app/sim imports LEVEL_1 any more; it is kept as an
// alias for the ladder's first entry rather than a second source of truth, and
// anything reaching for it is really asking for the bay at a MARK.
export const LEVEL_1: LevelConfig = LEVELS[0];

/* ---------------------------------------------------------------------------
 * BASE BAY SUMMARY — what flying a given Mark actually costs you.
 *
 * The home tower (screens.ts's tierTowerHTML) parks the car on any Mark the
 * player has earned, and the panel beside it answers "what am I signing up
 * for" for the floor currently selected. Every number is READ OFF
 * makeBaseLevel rather than restated, because a summary that restates the
 * ladder goes stale the first time the ladder is retuned.
 *
 * MERGE NOTE (#86 + #88). This arrived with the tower, written when a Mark
 * moved exactly one axis — its comment said so out loud: "the one axis the
 * Mark itself moves, since MARK_TARGET_STEP and MARK_SPEED_STEP are both 0
 * today". #88's tier ladder is precisely the change that makes that false.
 * The summary needed no structural change BECAUSE it never restated the
 * ladder: makeBaseLevel now varies target, clock and launch cost by Mark, and
 * reading bay 1 and bay 10 back off it picks that up for free. Only the
 * comment had to go — which is the whole argument for deriving over restating.
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
  /** Joint strength relative to Mark 1 (BOND_MARK_STEP). x1.0 at Mark 1. */
  bondMult: number;
  /** True at UNBREAKABLE_MARK, where bay 10's joints go Infinity and the Bond
   *  Breaker is the only shatter left in the capstone. */
  unbreakableCapstone: boolean;
}

/** `skydeck` quotes the ROOF's bays instead of the Mark's: the same ten bays
 *  with the economy step applied (applySkydeckEconomy), which is exactly what
 *  levelForRun will build when the run starts. The menu panel passes it when
 *  the tower's car is parked on the roof — a floor whose whole pitch is "the
 *  numbers are a step past the ladder" cannot quote the ladder's. */
export function baseBayFor(mark: number, skydeck = false): BaseBaySummary {
  const m = Math.max(1, Math.floor(mark));
  const first = makeBaseLevel(0, m);
  const last = makeBaseLevel(LEVELS.length - 1, m);
  if (skydeck) {
    applySkydeckEconomy(first, 0);
    applySkydeckEconomy(last, LEVELS.length - 1);
  }
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
