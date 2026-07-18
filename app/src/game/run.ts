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
  /** Carried bankroll — level 1 starts from the base level's startingFunds;
   *  every later level starts from wherever the previous one ended. */
  bankroll: number;
  /** Modifiers drafted so far, in pick order (order matters for stacking). */
  modIds: string[];
  /** Cumulative cleared lines across all completed levels. */
  linesTotal: number;
}

export function newRun(seed: number): RunState {
  return {
    seed,
    levelIndex: 0,
    bankroll: makeBaseLevel(0).startingFunds,
    modIds: [],
    linesTotal: 0,
  };
}

/** The LevelConfig the run's current levelIndex should actually be played
 *  with: the base ladder entry with all drafted mods layered on, and (for
 *  every level after the first) startingFunds overridden to the carried
 *  bankroll so score really does persist across levels. */
export function levelForRun(run: RunState): LevelConfig {
  const cfg = applyMods(makeBaseLevel(run.levelIndex), run.modIds);
  if (run.levelIndex > 0) cfg.startingFunds = run.bankroll;
  return cfg;
}

/** Advance to the next level after one ends: bankroll becomes the score the
 *  level ended with, lines accumulate, and the drafted pick (if any — the
 *  player may have nothing left to pick from) is appended. Returns a new
 *  RunState; never mutates the one passed in. */
export function advanceRun(
  run: RunState,
  endedScore: number,
  lines: number,
  pickedModId: string | null,
): RunState {
  return {
    seed: run.seed,
    levelIndex: run.levelIndex + 1,
    bankroll: endedScore,
    modIds: pickedModId ? [...run.modIds, pickedModId] : [...run.modIds],
    linesTotal: run.linesTotal + lines,
  };
}
