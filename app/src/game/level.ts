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
  /** Bankroll at level start — the single currency doubling as score. Tunable
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

// Economy balance note (Launch Bay, i.e. makeBaseLevel(0)): a perfect 8-cube
// line costs 2 shots ($50) for a $100 payout, so clean play nets $50/line.
// Reaching the $800 target from a $250 start needs ~11 clean lines with combo
// bonuses helping close the gap — but the existing $25 lost-piece penalty and
// any wasted shots (cooldown-gated misses still cost nothing, only fired
// shots do) eat into the bankroll, so sloppy play can go broke before hitting
// the target.
const LEVEL_NAMES = [
  "Launch Bay", "Cargo Dock", "Freight Yard", "Assembly Line", "Foundry",
  "Cryo Bay", "Reactor Deck", "Orbital Ramp", "Gravity Well", "Compactor Core",
] as const;

/** Cumulative bankroll target for level i (0-based): target(0) = 800,
 *  target(i) = target(i-1) + 450 + 100*i. Cumulative (not per-level) because
 *  bankroll itself carries across levels in the run — each level's target is
 *  really "how much more the player needs to bank by the end of this level." */
function targetScoreFor(i: number): number {
  let score = 800;
  for (let k = 1; k <= i; k++) score += 450 + 100 * k;
  return score;
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
 * - compactorSpeed, launchCost, and penaltyPerLostPiece all creep up so later
 *   levels punish sloppy play faster and harder.
 * - timeLimitSec grows slower than targetScore (10s/level vs. a target that
 *   accelerates by +100/level), so time pressure keeps rising relative to how
 *   much bankroll is actually needed.
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
    scorePerLine: 100,
    penaltyPerLostPiece: 25 + i * 2,
    targetScore: targetScoreFor(i),
    startingFunds: 250,
    launchCost: 25 + i * 3,
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
