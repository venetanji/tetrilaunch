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
  /** Compactor sweep speed in px/step. */
  compactorSpeed: number;
  /** Right-side margin the compactor stops at before resetting to center. */
  compactorMargin: number;
  /** Points awarded per cleared line. */
  scorePerLine: number;
  /** Penalty per piece that decays on the wrong side of the compactor. */
  penaltyPerLostPiece: number;
  /** Points needed to clear the level. */
  targetScore: number;
  /** Fixed piece order (sequential, like the original). null => 7-bag shuffle later. */
  pieceSequence: PieceType[] | null;
  /** Fire cooldown in ms. */
  cooldownMs: number;
}

export const LEVEL_1: LevelConfig = {
  id: 1,
  name: "Launch Bay",
  gravity: 1,
  compactorSpeed: 2.2,
  compactorMargin: 90,
  scorePerLine: 100,
  penaltyPerLostPiece: 25,
  targetScore: 800,
  pieceSequence: ["I", "O", "T", "L", "J", "S", "Z"],
  cooldownMs: 900,
};

// Roadmap: LEVELS[] grows here. Only level 1 ships this pass.
export const LEVELS: LevelConfig[] = [LEVEL_1];
