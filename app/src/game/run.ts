import type { LevelConfig } from "./level";
import { makeBaseLevel } from "./level";
import { applyMods } from "./mods";
import { applyUpgrades, newTiers, type UpgradeTiers } from "./upgrades";

/** Total levels in a roguelite run (see makeBaseLevel's 0..9 ladder). */
export const RUN_LEVELS = 10;

/** Refit stops land after every REFIT_EVERY-th bay — bays 3, 6 and 9 at the
 *  default of 3. Not after bay 10: the run ends there, so a refit would buy
 *  nothing. See isRefitBay. */
export const REFIT_EVERY = 3;

/**
 * Persistent state for one roguelite run — everything that carries across
 * levels. The current level's actual LevelConfig is always derived (see
 * levelForRun), never stored, so it can't drift out of sync with modIds/tiers.
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
  /** UNSPENT scrap — the in-run upgrade currency (level.ts's SCRAP_PER_LINE /
   *  SCRAP_PER_BAY earn it, refit stops spend it). Distinct from `carry`:
   *  carry is operating cash that funds the next bay's launches, scrap is
   *  capital that can ONLY become ship upgrades. Dies with the run. */
  scrap: number;
  /** Total scrap earned this run, spent or not — a stat for the end screen, so
   *  a run that banked and never refitted still reads as having earned it. */
  scrapEarned: number;
  /** Ship upgrade tier per system (see upgrades.ts). Seeded at run start from
   *  the player's permanent LOADOUT (meta.ts's safeLoadout, bought against the
   *  Mark's build budget), then raised further by in-run scrap at refit stops.
   *  All 0 only for a stock rig at Mark 1. */
  tiers: UpgradeTiers;
  /** Meta-progression unlock ids owned by the PLAYER (not the run) — copied in
   *  at run start so draftOffers and levelForRun can gate content without
   *  reaching into localStorage mid-run, and so a Workshop purchase made after
   *  a run began can't retroactively change that run's draft pool. */
  unlocks: string[];
  /** The Mark this run is being flown at (1-based). Fixed at run start: it
   *  scales every bay's difficulty (see level.ts's makeBaseLevel) and it is
   *  what the run's leaderboard entry is filed under, so a run can't change
   *  which board it's competing on halfway through. */
  mark: number;
}

export function newRun(
  seed: number,
  unlocks: string[] = [],
  startingScrap = 0,
  loadout: UpgradeTiers = newTiers(),
  mark = 1,
): RunState {
  return {
    seed,
    levelIndex: 0,
    carry: 0,
    modIds: [],
    linesTotal: 0,
    scrap: startingScrap,
    scrapEarned: startingScrap,
    // The permanent loadout is where the ship STARTS, not a bonus on top of a
    // stock one: in-run scrap refits from here at the usual stops. Copied, not
    // aliased — a run must never write back into saved meta state.
    tiers: { ...loadout },
    unlocks: [...unlocks],
    mark,
  };
}

/** True when clearing bay `levelIndex` (0-based) should open a refit stop:
 *  after every REFIT_EVERY-th bay, but never after the LAST bay (the run is
 *  over, there's nothing left to spend on). */
export function isRefitBay(levelIndex: number): boolean {
  if (levelIndex >= RUN_LEVELS - 1) return false;
  return (levelIndex + 1) % REFIT_EVERY === 0;
}

/**
 * How many more bays must be CLEARED — counting the one at `levelIndex`, i.e.
 * the one about to be played — before the next refit stop opens. 1 means
 * "clearing this bay docks you". Null when no refit stop remains in the run.
 *
 * Counted in bay-clears rather than as a modular remainder because that's the
 * unit the player is actually planning in ("do I bank scrap now or spend it?"),
 * and an off-by-one here is invisible in code review but glaring in the UI.
 */
export function baysUntilRefit(levelIndex: number): number | null {
  for (let i = levelIndex; i < RUN_LEVELS; i++) {
    if (isRefitBay(i)) return i - levelIndex + 1;
  }
  return null;
}

/** The LevelConfig the run's current levelIndex should actually be played
 *  with: the base ladder entry, then the ship's bought UPGRADE tiers, then all
 *  drafted MODS on top, and (for every level after the first) startingFunds
 *  bumped by the carried surplus.
 *
 *  Order is deliberate and load-bearing: upgrades are the ship, mods are the
 *  contract flown in it, so a mod's multipliers compound over a refitted ship
 *  (see upgrades.ts's header). The carry is added dead last so it's never
 *  scaled by either — it's cash in hand, not a rate. */
export function levelForRun(run: RunState): LevelConfig {
  const base = makeBaseLevel(run.levelIndex, run.mark);
  applyUpgrades(base, run.tiers);
  const cfg = applyMods(base, run.modIds);
  if (run.levelIndex > 0) cfg.startingFunds = cfg.startingFunds + run.carry;
  return cfg;
}

/** Advance to the next level after one ends: carry becomes the overshoot
 *  banked above the just-cleared bay's target (0 if the bay ended at or
 *  below target — no debt carries), lines and scrap accumulate, and the
 *  drafted pick (if any — the player may have nothing left to pick from) is
 *  appended. `clearedTarget` is the just-ended bay's targetScore (Game.target),
 *  needed to compute the overshoot; `scrapEarned` is what the bay paid out
 *  (Game.scrapEarned plus the per-bay clear bonus). Returns a new RunState;
 *  never mutates the one passed in. */
export function advanceRun(
  run: RunState,
  endedScore: number,
  clearedTarget: number,
  lines: number,
  scrapEarned: number,
  pickedModId: string | null,
): RunState {
  return {
    seed: run.seed,
    levelIndex: run.levelIndex + 1,
    carry: Math.max(0, endedScore - clearedTarget),
    modIds: pickedModId ? [...run.modIds, pickedModId] : [...run.modIds],
    linesTotal: run.linesTotal + lines,
    scrap: run.scrap + scrapEarned,
    scrapEarned: run.scrapEarned + scrapEarned,
    tiers: { ...run.tiers },
    unlocks: [...run.unlocks],
    mark: run.mark,
  };
}

/** Buy one tier of a system at a refit stop. Returns a NEW RunState with the
 *  tier raised and the scrap deducted, or null when it can't be bought (maxed,
 *  or not enough scrap) — the caller renders that as a disabled card rather
 *  than needing to duplicate the affordability rules. */
export function buyUpgrade(run: RunState, id: keyof UpgradeTiers, cost: number, maxTier: number): RunState | null {
  const tier = run.tiers[id] ?? 0;
  if (tier >= maxTier) return null;
  if (run.scrap < cost) return null;
  return {
    ...run,
    modIds: [...run.modIds],
    unlocks: [...run.unlocks],
    scrap: run.scrap - cost,
    tiers: { ...run.tiers, [id]: tier + 1 },
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
