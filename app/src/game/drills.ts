import { makeBaseLevel, NO_MATERIALS, WIND_GUST_FRACTION, type LevelConfig } from "./level";
import { applyUpgrades, newTiers, type UpgradeId, type UpgradeTiers } from "./upgrades";
import type { PieceSize, PieceType, Material } from "./theme";

/**
 * DRILLS — a mock bay per lesson.
 *
 * WHAT THIS IS FOR
 *
 * Reading that cryo "needs a strike before it counts" is not the same as
 * having stood in a bay watching a row refuse to sell. The guide's copy can
 * only ever describe a mechanic; a drill is where the player meets it, and
 * meets it ALONE — one material on the belt, nothing else going on, no clock
 * and no bankroll, in a bay small enough to finish in a minute.
 *
 * The ladder cannot do this. A material reaches a real bay only if the player
 * ratcheted its axis, at 7-32% a shipment, from tier 4 up — so learning tar by
 * playing is a matter of drafting the right card and then waiting on a die
 * roll, in the one mode where a mistake ends a 30-minute run. That is the
 * gap: the game teaches its second half by ambush, at the worst possible
 * moment, or not at all.
 *
 * WHAT A DRILL IS, MECHANICALLY
 *
 * A Contract bay with the generator taken out. Same stripping — `launchCost`
 * 0, `timeLimitSec` 0, `targetScore` unreachable, the objective a small line
 * count, the limit a launch budget — because that stripping is exactly what
 * "free to fail, retry forever" means and contracts.ts already proved it works.
 * What a drill adds is that every dial is AUTHORED rather than rolled: this
 * bay exists to show one thing, so it ships one material, at a rate high
 * enough that the lesson lands inside the budget.
 *
 * WHAT A DRILL IS NOT
 *
 * It is not progress. Nothing here pays salvage, ticks a tier, records a run
 * or reaches the leaderboard — see main.ts's onGameStatus, which routes a
 * drill out before any of that bookkeeping. A drill that could be farmed would
 * make the guide a grind, and a guide that is a grind stops being read.
 *
 * WHY RATES ARE HIGH
 *
 * A real material notch ships 7% of the belt. At a 14-shipment budget that is
 * one cube in the whole drill, which teaches nothing — the player would finish
 * the bay having never seen the thing it was named for. Drill rates are set so
 * the material is the bay's TEXTURE, not its garnish. This is the same call
 * game/sandbox.ts's `applySandboxMaterials` makes and for the same reason,
 * stated there: the caps exist to keep a real run's difficulty honest, and
 * honouring them on a screen built to show one material would defeat the screen.
 */
export interface DrillSpec {
  /** Card title — what the bay is called while you are in it. */
  name: string;
  /** The one sentence stating the PASS CONDITION in the lesson's own terms.
   *  Shown on the launch button's card and again on the result. Not a
   *  restatement of the topic: the topic says what tar does, this says what
   *  you have to do about it in the next sixty seconds. */
  brief: string;
  /** The same thing at HUD length — three or four words for the plant panel's
   *  complications row, which is one line and does not wrap.
   *
   *  Split from `brief` for exactly the reason contracts.ts splits its own
   *  `brief` and `conditions`: the card has a paragraph's room and the panel
   *  has a line's, and feeding the card's sentence to the panel truncates it
   *  mid-word. (Measured on device: the row rendered "THE BAY OPENS ONE COLUMN
   *  SHORT OF SELLING. CLOSE THE" and stopped.) */
  conditions: string;
  /** Rows to clear to pass. */
  goal: number;
  /** Shipments the bay will hand you. The only limit — there is no clock and
   *  nothing costs anything. */
  launches: number;
  /** The material the belt carries, and how much of it. Rate 1 means every
   *  shipment (see the header on why these are not ladder rates). */
  material?: Exclude<Material, "standard">;
  materialRate?: number;
  /** Size class of every shipment in the bay. */
  pieceSize?: PieceSize;
  /** Fixed shipment rotation, when the lesson needs specific shapes — the
   *  rotate drill deals nothing but the shapes that must be turned. null (the
   *  default) keeps the seeded 7-bag every real bay ships. */
  sequence?: PieceType[];
  /** Lateral wind cap for the bay. */
  windMax?: number;
  /** Multiplier on the press's stroke speed. */
  sweepMult?: number;
  /** Open cells at the press's open stop, overriding the stock 12. */
  openCells?: number;
  /** Multiplier on the bay's joint break tolerance. Below 1, landings shatter
   *  where they would normally hold — which is the whole lesson of the joints
   *  drill and unteachable at bay-1 stiffness. */
  bondMult?: number;
  /** Demolition charges the bay opens with. */
  bombs?: number;
  /** Bond Breaker charges the bay opens with. */
  bondCharges?: number;
  /** A pile already standing when the bay opens — cells occupied per slot
   *  column, indexed from the wall outward, the same shape
   *  LevelConfig.standingWall takes. Every profile below keeps at least one
   *  empty column, which is what guarantees no row of it is already complete
   *  (contracts.ts's salvageProfile makes the same promise the same way). */
  wall?: number[];
  /** What that opening pile is MADE of. */
  wallMaterial?: Material;
  /** The rig the drill flies with. A lesson about a system has to be flown
   *  with the system fitted — otherwise the Bond Breaker drill is a bay with
   *  no Bond Breaker in it — so this is granted by the drill rather than read
   *  off the player's save. It is not a gift: a drill banks nothing, so a rig
   *  handed out here cannot reach a run. */
  tiers?: Partial<Record<UpgradeId, number>>;
}

/**
 * OPENING PILES — cells already standing per slot column, indexed from the wall
 * outward (LevelConfig.standingWall). Eight columns, because eight is
 * compactorMinLineCells: the width a row spans.
 *
 * All three are the same SHAPE at three depths, and the shape is doing real
 * work. Two rules decide it:
 *
 *  - **The lowest column is 0.** A row is complete when every column reaches
 *    past it, so any pile whose shortest column is 1 or more opens with rows
 *    already sold — the bay would clear a line on frame one. Same invariant
 *    contracts.ts's salvageProfile keeps, kept the same way.
 *  - **The SECOND lowest is exactly 1, and adjacent to the first.** This is the
 *    part that took a measurement to find. The first draft was a flat
 *    `[2,2,2,0,2,2,2,2]`, and a flat pile with one channel means a single
 *    vertical I dropped down the channel completes EVERY row at once: headless
 *    runs cleared five separate drills in two shots, goal met, lesson unseen.
 *    Staggering the two lowest columns makes exactly one row a gift and every
 *    row above it a real fill — and putting them side by side means that fill
 *    is one ordinary shipment, not three cubes threaded into three separate
 *    slots.
 */
/** One row from selling. The state every lesson about rows, presses and
 *  materials wants to start from — and the state a player otherwise spends
 *  fifteen shots reaching before the drill can begin. */
const NEARLY: number[] = [3, 3, 1, 0, 1, 3, 3, 3];

/** The same pile, deep enough to be in the way — the top-out and demolition
 *  lessons, where the point is that the bay is already in trouble. */
const CLUTTER: number[] = [5, 5, 1, 0, 1, 5, 5, 5];

/** Deep enough to open PAST THE FIRST CONGESTION RUNG. Sized against
 *  level.ts's PILE_TIERS[0].cubes (32), because the congestion drill's whole
 *  lesson is the tax, and a bay that has to be filled up before the tax
 *  arrives spends its budget getting to the lesson. 37 cubes, so the bay is
 *  taxed from the first shot and the readouts say so. */
const CONGESTED: number[] = [7, 7, 1, 0, 1, 7, 7, 7];

/** A shallow pile of DEAD cargo, for the demolition lesson: enough slag to
 *  block the bottom rows outright, few enough cubes that a charge visibly
 *  fixes it. Every row it touches is unsellable until the slag leaves. */
const DEAD: number[] = [2, 2, 1, 0, 1, 2, 2, 2];

/**
 * THE DRILLS, by the guide topic each one teaches (game/guide.ts's topic ids).
 *
 * Keyed by topic id rather than carrying an id of their own so the two tables
 * cannot drift into a drill nothing links to, or a topic pointing at a drill
 * that was renamed. A topic with no entry here simply has no drill, which is
 * the honest state for the reference rows — there is no bay that teaches
 * "salvage is permanent".
 *
 * Budgets are sized off the same arithmetic contracts.ts uses: a row is 8
 * cells, a standard shipment is 4 cubes, so a goal of N rows needs 2N perfect
 * shipments. Every budget below is roughly double that — generous, because a
 * drill that can be failed by being slightly wasteful is teaching frugality
 * instead of the thing it is named for.
 */
export const DRILLS: Record<string, DrillSpec> = {
  /* ---- BASICS ---------------------------------------------------------- */
  aim: {
    name: "Range Practice",
    brief: "Clear 2 rows. No clock, no cost, and nothing on the belt but standard cargo.",
    conditions: "Clean bay · no pressure",
    goal: 2, launches: 16,
  },
  rotate: {
    name: "Turning Circle",
    brief: "Nothing but S, Z, L and J — the four that have to be turned. Clear 2 rows.",
    conditions: "S, Z, L and J only",
    goal: 2, launches: 18,
    // The shapes that punish landing un-rotated. I and O are deliberately
    // absent: they are the two that fit however they arrive, so a bag holding
    // them lets the drill be finished without the lesson.
    sequence: ["S", "Z", "L", "J", "T", "S", "Z", "J", "L", "T"],
  },
  bonds: {
    name: "Hard Landing",
    brief: "Joints at a third of normal — hit hard and shipments come apart. Clear 2 rows.",
    conditions: "Joints at a third",
    goal: 2, launches: 18, bondMult: 0.33,
  },
  row: {
    name: "One Row Short",
    brief: "The bay opens one column short of selling. Close the channel.",
    conditions: "One column short",
    goal: 2, launches: 12, wall: NEARLY,
  },
  compactor: {
    name: "Press Timing",
    brief: "Clear 3 rows and watch the stroke: it shatters, grinds cubes square, then pays.",
    conditions: "Watch the stroke",
    goal: 3, launches: 20, wall: NEARLY,
  },
  topout: {
    name: "Dig Out",
    brief: "A pile that is already in the way, and 4 charges to cut it back. Clear 2 rows.",
    conditions: "Pile in the way · 4 charges",
    goal: 2, launches: 16, wall: CLUTTER, bombs: 4, tiers: { demolition: 2 },
  },

  /* ---- MONEY ----------------------------------------------------------- */
  funds: {
    name: "Bankroll",
    brief: "A Deep Run bay's money, without its clock. Reach the target before the funds run out.",
    conditions: "Bay 1's money, no clock",
    goal: 0, launches: 0,
  },
  clock: {
    name: "Against the Clock",
    brief: "60 seconds, 3 rows. The readout goes red at 20.",
    conditions: "60 seconds",
    goal: 3, launches: 0,
  },
  congestion: {
    name: "Clutter Tax",
    brief: "Open past the first congestion rung: dearer shots, slower reloads, rows at 75%.",
    conditions: "Opens past the first rung",
    goal: 2, launches: 22, wall: CONGESTED,
  },

  /* ---- CARGO ----------------------------------------------------------- */
  sizes: {
    name: "Bulk Freight",
    brief: "Every shipment a 5-cube pentomino — heavy enough to press the layers below flat.",
    // 18 rather than 14: a pentomino is wider than the channel it has to go
    // into, so a bulk bay wastes more cubes per row than a standard one, and
    // the headless runs missed the goal by a row at the tighter budget.
    conditions: "Bulk pentominoes",
    goal: 2, launches: 18, pieceSize: "bulk",
  },
  "mat-cryo": {
    name: "Cold Chain",
    brief: "Half the belt arrives frozen. Land it, then strike it — an unstruck row will not sell.",
    conditions: "Half the belt frozen",
    goal: 2, launches: 20, material: "cryo", materialRate: 0.5, wall: NEARLY,
  },
  "mat-rebar": {
    name: "Full Rebar",
    brief: "Nothing shatters. What lands is what you keep — and one Bond Breaker if it wedges.",
    conditions: "Nothing shatters",
    goal: 2, launches: 16, material: "rebar", materialRate: 1,
    bondCharges: 1, tiers: { bonds: 1 },
  },
  "mat-slag": {
    name: "Dead Weight",
    brief: "A third of the belt is dead cargo, and 5 charges to sell it back. Clear 2 rows.",
    conditions: "A third dead · 5 charges",
    goal: 2, launches: 20, material: "slag", materialRate: 0.34,
    bombs: 5, tiers: { demolition: 2 },
  },
  "mat-volatile": {
    name: "Powder Run",
    brief: "Half the belt detonates on a hard landing. Lob it soft — or aim it at the junk.",
    conditions: "Half the belt primed",
    goal: 2, launches: 20, material: "volatile", materialRate: 0.5, wall: NEARLY,
  },
  "mat-tar": {
    name: "Fouled Bay",
    brief: "Tar welds to whatever it touches and no charge splits it. Place it where you mean it.",
    conditions: "Half the belt welds",
    goal: 2, launches: 20, material: "tar", materialRate: 0.5,
    bondCharges: 1, tiers: { bonds: 1 },
  },
  "mat-magnetic": {
    name: "Guided Freight",
    brief: "Every shipment snaps itself square as it settles. The one material that helps.",
    conditions: "Every shipment self-squares",
    goal: 3, launches: 18, material: "magnetic", materialRate: 1,
  },

  /* ---- HAZARDS --------------------------------------------------------- */
  "axis-wind": {
    name: "Crosswind",
    brief: "A bay with real weather and no stabilizer. Read the gauge, then lead the shot.",
    // 0.15 is the windiest bay the ladder itself builds (level.ts's ramp tops
    // out there at bay 10), which is the right ceiling for the bay that
    // INTRODUCES wind — 0.22 was past anything an un-ratcheted run ever ships,
    // and a first lesson pitched above the game is not a lesson.
    conditions: "Live crosswind · no stabilizer",
    goal: 2, launches: 24, windMax: 0.15,
  },
  "axis-sweeper": {
    name: "Sweeper Detail",
    brief: "The press runs half again as fast, in a bay two cells narrower. Clear 2 rows.",
    conditions: "Fast press · 10 open cells",
    goal: 2, launches: 20, sweepMult: 1.5, openCells: 10,
  },

  /* ---- THE RIG --------------------------------------------------------- */
  bondbreaker: {
    name: "Bond Breaker",
    brief: "A wedged pile of rebar, and 2 charges. Shatter it flat, then sell the rows.",
    conditions: "Rebar pile · 2 charges",
    goal: 2, launches: 16, material: "rebar", materialRate: 1,
    bondCharges: 2, tiers: { bonds: 2 }, wall: NEARLY,
  },
  "demolition-charge": {
    name: "Demolition",
    brief: "Dead cargo blocking the bottom rows, and 6 charges. Every cube you vaporize pays.",
    conditions: "Slag floor · 6 charges",
    goal: 2, launches: 20, wall: DEAD, wallMaterial: "slag",
    bombs: 6, tiers: { demolition: 3 },
  },

  /* ---- SHIP SYSTEMS ---------------------------------------------------- */
  // One per track, flown at MAX so the lesson is the difference the system
  // makes rather than a tier-1 nudge nobody could feel in one bay.
  "sys-bay": {
    name: "Bay Extension",
    brief: "The same bay at 18 open cells instead of 12. Longer rows, later congestion.",
    conditions: "18 open cells",
    goal: 3, launches: 20, tiers: { bay: 3 },
  },
  "sys-launcher": {
    name: "Launcher Coils",
    brief: "Maxed coils against a stiff crosswind — more muzzle speed, 60% of the wind cancelled.",
    conditions: "Maxed coils vs crosswind",
    goal: 2, launches: 18, windMax: 0.22, tiers: { launcher: 3 },
  },
  "sys-hydraulics": {
    name: "Press Hydraulics",
    brief: "A maxed press against a deliberately messy pile. Watch what the stroke rescues.",
    conditions: "Maxed press · messy pile",
    goal: 3, launches: 20, wall: CLUTTER, tiers: { hydraulics: 3 },
  },
  "sys-magazine": {
    name: "Loader Magazine",
    brief: "Reload cut by 45%, on a 60-second clock. Feel what the extra shots buy.",
    conditions: "45% reload · 60 seconds",
    goal: 3, launches: 0, tiers: { magazine: 3 },
  },
  "sys-reactor": {
    name: "Reactor Output",
    brief: "A Deep Run bay's money with a maxed reactor: a bigger float and a better rate.",
    conditions: "Maxed reactor · bay 1 money",
    goal: 0, launches: 0, tiers: { reactor: 3 },
  },
  "sys-bonds": {
    name: "Bond Emitter",
    brief: "Nothing but S and Z, at seams the emitter has already halved. Clear 2 rows.",
    // S and Z only, because tiers 2-3 of this track weaken exactly those two
    // (upgrades.ts's SEAM SPLITTER) and the passive is invisible in a bay that
    // ships the other five. The three charges ride along so both halves of the
    // maxed track are on the table at once.
    conditions: "S/Z only · 3 charges",
    goal: 2, launches: 18, sequence: ["S", "Z", "S", "Z"],
    bondCharges: 3, tiers: { bonds: 3 },
  },
  "sys-demolition": {
    name: "Demolition Rack",
    brief: "6 charges and a resupply every 4 rows, in a bay a third full of slag.",
    conditions: "A third slag · 6 charges",
    goal: 2, launches: 22, material: "slag", materialRate: 0.34,
    bombs: 6, tiers: { demolition: 3 },
  },
};

/** Seconds a TIMED drill runs for. Only the two lessons that are ABOUT the
 *  clock set one; every other drill has none, which is the Contract stance and
 *  the reason a drill can be taken slowly. */
export const DRILL_CLOCK_SEC = 60;

/** Drills whose lesson is the Deep Run economy, so they keep the bankroll, the
 *  launch price and the funding target a stripped bay throws away. The two of
 *  them are the ONLY drills that can be lost on money. */
const ECONOMY_DRILLS = new Set(["funds", "sys-reactor"]);
/** Drills whose lesson is the clock, so they keep one. */
const TIMED_DRILLS = new Set(["clock", "sys-magazine"]);

/**
 * Build the bay for one drill.
 *
 * Starts from `makeBaseLevel(0)` — bay 1 of the ladder, the calmest bay the
 * game knows how to make — and then writes exactly the dials the lesson needs.
 * Deliberately NOT built from scratch: a drill has to be the same physics, the
 * same press and the same joints a real bay ships, or it teaches a game the
 * player does not own. Every field a drill does not name is the ladder's.
 *
 * `id` is the guide topic id, which is how the two economy exceptions above
 * are recognised.
 */
export function levelForDrill(id: string, spec: DrillSpec): LevelConfig {
  const cfg = makeBaseLevel(0);
  cfg.name = spec.name;

  const economy = ECONOMY_DRILLS.has(id);
  const timed = TIMED_DRILLS.has(id);

  if (economy) {
    // The bankroll bay, kept whole: the launch price, the float and the target
    // are the lesson, so stripping them would leave a drill for the economy
    // with no economy in it. The clock still goes — one pressure at a time is
    // the whole premise of a drill.
    //
    // The spill fine is kept too, at whatever makeBaseLevel(0) hands over —
    // which is Tier 1's $1 a cube now that the fine rides the tier ladder
    // (level.ts's penaltyPerLostPieceFor). Not re-derived at the flown tier on
    // purpose: a drill is a Tier 1 bay by construction, and a lesson that
    // charges veteran prices is a lesson that ends early.
    cfg.timeLimitSec = 0;
    cfg.objectiveLines = 0;
    cfg.launchBudget = 0;
  } else {
    // The Contract stripping (contracts.ts's levelForContract), for the same
    // stated reason: nothing is spent, so nothing needs to be earned back, and
    // a bay you can be rushed out of is not a bay you can be taught in.
    cfg.launchCost = 0;
    cfg.startingFunds = 0;
    cfg.penaltyPerLostPiece = 0;
    cfg.targetScore = Number.MAX_SAFE_INTEGER;
    cfg.timeLimitSec = timed ? DRILL_CLOCK_SEC : 0;
    cfg.objectiveLines = spec.goal;
    cfg.launchBudget = spec.launches;
  }

  if (spec.pieceSize) cfg.pieceSize = spec.pieceSize;
  if (spec.sequence) cfg.pieceSequence = [...spec.sequence];

  // The belt. Zeroed first rather than inherited — makeBaseLevel is clean
  // today, and a drill that quietly picked up a future default would be
  // teaching two materials at once on the one screen built to isolate them.
  cfg.materialMix = { ...NO_MATERIALS };
  if (spec.material) cfg.materialMix[spec.material] = spec.materialRate ?? 1;

  if (spec.windMax !== undefined) {
    cfg.windMax = spec.windMax;
    // The same fraction every other bay sizes its gust by, imported rather
    // than guessed — a drill whose weather had a different texture from the
    // ladder's would be practice for a game nobody plays.
    cfg.windGust = spec.windMax * WIND_GUST_FRACTION;
  }
  if (spec.sweepMult !== undefined) cfg.compactorSpeed *= spec.sweepMult;
  if (spec.openCells !== undefined) {
    // The same floor hazards.ts's sweeper axis respects: below minLineCells+1
    // the press's two stops coincide and it stops travelling altogether.
    cfg.compactorOpenCells = Math.max(cfg.compactorMinLineCells + 1, spec.openCells);
  }
  if (spec.bondMult !== undefined) cfg.jointBreakStretch *= spec.bondMult;
  if (spec.wall) {
    cfg.standingWall = [...spec.wall];
    cfg.standingWallMaterial = spec.wallMaterial ?? "standard";
  }

  // The rig, applied through the SHIPPING path so a drill can never fly a
  // system that behaves differently here than it does in a run.
  if (spec.tiers) {
    const tiers: UpgradeTiers = { ...newTiers() };
    for (const [id2, tier] of Object.entries(spec.tiers)) {
      tiers[id2 as UpgradeId] = tier ?? 0;
    }
    applyUpgrades(cfg, tiers);
  }

  // Charges LAST, and as absolutes rather than additions: applyUpgrades has
  // just written the rack's and the emitter's grants, and a drill that stated
  // a charge count means that count — "6 charges" on the card has to be 6 in
  // the bay whatever tier the lesson happened to fit.
  if (spec.bombs !== undefined) cfg.bombCharges = spec.bombs;
  if (spec.bondCharges !== undefined) cfg.bondBreakerCharges = spec.bondCharges;

  return cfg;
}
