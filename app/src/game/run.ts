import type { LevelConfig } from "./level";
import { makeBaseLevel } from "./level";
import { applyRatchets, type Ratchets, type HazardId } from "./hazards";
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
 * levelForRun), never stored, so it can't drift out of sync with ratchets/tiers.
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
  /** How far each difficulty axis has been ratcheted this run (hazards.ts).
   *  This replaced `modIds`: the between-bay draft no longer deals modifier
   *  cards, it asks which axis hardens next, and the answer sticks for the rest
   *  of the run. A count rather than a list because the same axis can be taken
   *  again — three notches on the clock is a legitimate (and grim) build. */
  ratchets: Ratchets;
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
  /** Bond Breaker charges remaining for this run — a consumable pool granted
   *  at run start (loadout bonds tier × 2) that is NOT refreshed between bays.
   *  levelForRun injects this into cfg.bondBreakerCharges; advanceRun carries
   *  the remainder forward so a charge used in bay 3 is permanently gone. */
  bondBreakerCharges: number;
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
    ratchets: {},
    linesTotal: 0,
    scrap: startingScrap,
    scrapEarned: startingScrap,
    // The permanent loadout is where the ship STARTS, not a bonus on top of a
    // stock one: in-run scrap refits from here at the usual stops. Copied, not
    // aliased — a run must never write back into saved meta state.
    tiers: { ...loadout },
    unlocks: [...unlocks],
    mark,
    // Bond Breaker charges are a per-run consumable pool: 2 per tier of the
    // bonds upgrade in the loadout. They are not refreshed between bays.
    bondBreakerCharges: (loadout.bonds ?? 0) * 2,
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
 *  Order is deliberate and load-bearing: upgrades are the SHIP, ratchets are the
 *  conditions it is flown in, so a notch lands on top of whatever was refitted
 *  (see upgrades.ts's header). That ordering is what makes the design's central
 *  claim true — a system does not delete a hazard, it makes one specific hazard
 *  cheap for you — because the ship's numbers are already in the config when the
 *  notch is added to them. The carry is added dead last so it's never scaled by
 *  either: it's cash in hand, not a rate. */
export function levelForRun(run: RunState): LevelConfig {
  const base = makeBaseLevel(run.levelIndex, run.mark);
  applyUpgrades(base, run.tiers);
  const cfg = applyRatchets(base, run.ratchets);
  if (run.levelIndex > 0) cfg.startingFunds = cfg.startingFunds + run.carry;
  // Bond Breaker charges are a consumable run pool, not a per-bay refresh.
  // Override whatever applyUpgrades wrote (bonds.apply is now a no-op) with
  // the remaining run charges so game.ts sees the correct count.
  cfg.bondBreakerCharges = run.bondBreakerCharges;
  return cfg;
}

/** Advance to the next level after one ends: carry becomes the overshoot
 *  banked above the just-cleared bay's target (0 if the bay ended at or
 *  below target — no debt carries), capped at 50% of the cleared target so
 *  a single excellent bay cannot trivialise two or more subsequent ones.
 *  Lines and scrap accumulate, and the drafted pick (if any — the player may
 *  have nothing left to pick from) is appended. `clearedTarget` is the
 *  just-ended bay's targetScore (Game.target), needed to compute the
 *  overshoot; `scrapEarned` is what the bay paid out (Game.scrapEarned plus
 *  the per-bay clear bonus); `bondsRemaining` is g.bondCharges after the
 *  bay (remaining run-pool charges, NOT a per-bay refresh). Returns a new
 *  RunState; never mutates the one passed in. */
export function advanceRun(
  run: RunState,
  endedScore: number,
  clearedTarget: number,
  lines: number,
  scrapEarned: number,
  pickedAxes: HazardId[] = [],
  bondsRemaining = 0,
): RunState {
  const ratchets: Ratchets = { ...run.ratchets };
  for (const id of pickedAxes) ratchets[id] = (ratchets[id] ?? 0) + 1;
  // Cap carry-over at 50% of the just-cleared target. This keeps a strong
  // performance rewarding without letting it cascade across 2+ levels.
  const rawCarry = Math.max(0, endedScore - clearedTarget);
  const carryCap = Math.floor(clearedTarget * 0.5);
  return {
    seed: run.seed,
    levelIndex: run.levelIndex + 1,
    carry: Math.min(carryCap, rawCarry),
    ratchets,
    linesTotal: run.linesTotal + lines,
    scrap: run.scrap + scrapEarned,
    scrapEarned: run.scrapEarned + scrapEarned,
    tiers: { ...run.tiers },
    unlocks: [...run.unlocks],
    mark: run.mark,
    bondBreakerCharges: Math.max(0, bondsRemaining),
  };
}

/** Buy one tier of a system at a refit stop. Returns a NEW RunState with the
 *  tier raised and the scrap deducted, or null when it can't be bought (not
 *  installed, maxed, or not enough scrap) — the caller renders that as a
 *  disabled card rather than needing to duplicate the affordability rules. */
export function buyUpgrade(run: RunState, id: keyof UpgradeTiers, cost: number, maxTier: number): RunState | null {
  const tier = run.tiers[id] ?? 0;
  // Tier 0 means the ship doesn't carry the system at all. A refit raises one
  // it already has, 1 -> 3; putting one aboard is a loadout purchase made
  // against the Mark's build budget (upgrades.ts's buyLoadoutTier). In-run
  // scrap has no such budget, so letting it install would route around the cap
  // that makes two rigs at the same Mark equal in power — see upgrades.ts's
  // BUILD BUDGET note for why that equality is the load-bearing one.
  if (tier <= 0) return null;
  if (tier >= maxTier) return null;
  if (run.scrap < cost) return null;
  return {
    ...run,
    ratchets: { ...run.ratchets },
    unlocks: [...run.unlocks],
    scrap: run.scrap - cost,
    tiers: { ...run.tiers, [id]: tier + 1 },
    // If the player refits the bonds system, add the newly unlocked charges to
    // the run pool immediately (the tier they just bought × 2, minus what the
    // old tier already granted, = +2 charges net per tier step).
    bondBreakerCharges: id === "bonds"
      ? run.bondBreakerCharges + 2
      : run.bondBreakerCharges,
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
