import type { LevelConfig } from "./level";
import { makeBaseLevel } from "./level";
import { applyMods } from "./mods";

/** Total levels in a roguelite run (see makeBaseLevel's 0..9 ladder). */
export const RUN_LEVELS = 10;

/**
 * Persistent state for one roguelite run — everything that carries across
 * levels. The current level's actual LevelConfig is always derived (see
 * levelForRun), never stored, so it can't drift out of sync with modIds.
 */
export interface RunState {
  seed: number;
  /** 0..RUN_LEVELS-1; the level currently playing (or about to start). */
  levelIndex: number;
  /** Carried surplus — the overshoot banked above the just-cleared bay's
   *  target (see advanceRun), NOT the full ending score. Each bay is its own
   *  economy (see level.ts's economy balance note): level 1 starts from the
   *  base level's startingFunds with carry at 0; every later level starts
   *  from its own base startingFunds plus whatever surplus carried over. */
  carry: number;
  /** Modifiers drafted so far, in pick order (order matters for stacking). */
  modIds: string[];
  /** Cumulative cleared lines across all completed levels. */
  linesTotal: number;
}

export function newRun(seed: number): RunState {
  return {
    seed,
    levelIndex: 0,
    carry: 0,
    modIds: [],
    linesTotal: 0,
  };
}

/** The LevelConfig the run's current levelIndex should actually be played
 *  with: the base ladder entry with all drafted mods layered on, and (for
 *  every level after the first) startingFunds bumped by the carried surplus
 *  on top of whatever startingFunds the mods left it at — each bay still
 *  funds its own flat float, the carry just stacks on top. */
export function levelForRun(run: RunState): LevelConfig {
  const cfg = applyMods(makeBaseLevel(run.levelIndex), run.modIds);
  if (run.levelIndex > 0) cfg.startingFunds = cfg.startingFunds + run.carry;
  return cfg;
}

/** Advance to the next level after one ends: carry becomes the overshoot
 *  banked above the just-cleared bay's target (0 if the bay ended at or
 *  below target — no debt carries), lines accumulate, and the drafted pick
 *  (if any — the player may have nothing left to pick from) is appended.
 *  `clearedTarget` is the just-ended bay's targetScore (Game.target), needed
 *  to compute the overshoot. Returns a new RunState; never mutates the one
 *  passed in. */
export function advanceRun(
  run: RunState,
  endedScore: number,
  clearedTarget: number,
  lines: number,
  pickedModId: string | null,
): RunState {
  return {
    seed: run.seed,
    levelIndex: run.levelIndex + 1,
    carry: Math.max(0, endedScore - clearedTarget),
    modIds: pickedModId ? [...run.modIds, pickedModId] : [...run.modIds],
    linesTotal: run.linesTotal + lines,
  };
}

/** Final-score weights (see finalRunScore). Exported so the end modal can
 *  show the same numbers in its breakdown line. */
export const SCORE_PER_BAY = 500;
export const SCORE_PER_LINE = 100;

/**
 * Composite score for a FINISHED run — what goes to the leaderboard and the
 * saved best. Bays cleared and total lines dominate; the funds in hand when
 * the run ended count only 1:1, as a tie-breaker. That ordering is
 * deliberate: each bay is its own economy (only the overshoot above target
 * carries — see levelForRun/advanceRun), so ending funds are mostly the
 * final bay's float, not a measure of the whole run. Ranking by funds alone
 * let a bay-1 flameout with a fat wallet outrank a deep run that died broke.
 */
export function finalRunScore(baysCleared: number, totalLines: number, fundsLeft: number): number {
  return baysCleared * SCORE_PER_BAY + totalLines * SCORE_PER_LINE + Math.max(0, fundsLeft);
}
