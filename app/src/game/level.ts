import type { PieceType } from "./theme";

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
  /** Cubes per launched piece: 4 = a real tetromino, 2 = a "half shipment"
   *  domino (see pieces.ts's pieceCells). Tunable roadmap seam for a
   *  cheaper-but-smaller-payload modifier. */
  pieceCubes: 2 | 4;
  /** Every Nth launch fires a bomb instead of a piece; 0 = never. Bombs cost
   *  the same launchCost but clear cubes around their blast instead of
   *  scoring — a cleanup tool, not a scoring one (see game.ts's detonate). */
  bombEvery: number;
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
 */
export function makeBaseLevel(i: number): LevelConfig {
  return {
    id: i + 1,
    name: LEVEL_NAMES[i],
    gravity: 1,
    compactorSpeed: 1.2 + i * 0.05,
    compactorOpenCells: 12,
    compactorMinLineCells: 8,
    compactorWidth: 26,
    compactorHeightFrac: 0.5,
    jointBreakStretch: 1.7 + i * 0.12,
    jointStiffness: Math.min(0.98, 0.9 + i * 0.01),
    scorePerLine: 100 + i * 10,
    penaltyPerLostPiece: 25 + i * 2,
    targetScore: targetScoreFor(i),
    startingFunds: 250,
    launchCost: 25 + i * 2,
    pieceSequence: ["I", "O", "T", "L", "J", "S", "Z"],
    cooldownMs: 900,
    timeLimitSec: 150 + i * 10,
    pieceCubes: 4,
    bombEvery: 0,
  };
}

/** The 10-level base ladder (before any drafted modifiers are applied — see
 *  mods.ts's applyMods / run.ts's levelForRun). */
export const LEVELS: LevelConfig[] = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i));

// UI references LEVEL_1 today (pre-run-mode howto/menu copy); keep it as an
// alias for the ladder's first entry rather than a second source of truth.
export const LEVEL_1: LevelConfig = LEVELS[0];
