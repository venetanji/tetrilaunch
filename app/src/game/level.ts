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
}

// Economy balance note (Launch Bay): a perfect 8-cube line costs 2 shots
// ($50) for a $100 payout, so clean play nets $50/line. Reaching the $800
// target from a $250 start needs ~11 clean lines with combo bonuses helping
// close the gap — but the existing $25 lost-piece penalty and any wasted
// shots (cooldown-gated misses still cost nothing, only fired shots do) eat
// into the bankroll, so sloppy play can go broke before hitting the target.
export const LEVEL_1: LevelConfig = {
  id: 1,
  name: "Launch Bay",
  gravity: 1,
  compactorSpeed: 1.2,
  compactorOpenCells: 12,
  compactorMinLineCells: 8,
  compactorWidth: 26,
  compactorHeightFrac: 0.5,
  jointBreakStretch: 1.7,
  scorePerLine: 100,
  penaltyPerLostPiece: 25,
  targetScore: 800,
  startingFunds: 250,
  launchCost: 25,
  pieceSequence: ["I", "O", "T", "L", "J", "S", "Z"],
  cooldownMs: 900,
};

// Roadmap: LEVELS[] grows here. Only level 1 ships this pass.
export const LEVELS: LevelConfig[] = [LEVEL_1];
