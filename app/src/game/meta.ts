/**
 * META-PROGRESSION — the layer that makes a LOST run worth something.
 *
 * Three currencies, three time horizons, deliberately non-interchangeable:
 *
 *   FUNDS ($)   one bay.  Operating budget. Spent on launches; the bay's own
 *                         objective is a funds threshold. Resets every bay
 *                         (only the surplus carries — see run.ts).
 *   SCRAP       one run.  Capital. Spent at refit stops on the ship
 *                         (upgrades.ts). Dies with the run.
 *   SALVAGE     forever.  Spent in the Workshop on UNLOCKS — things that
 *                         change what a future run can even attempt.
 *
 * Salvage is awarded at EVERY run end, win or lose (see salvageForRun), which
 * is the point: a run that dies in bay 4 still ships its wreckage back to the
 * yard and buys you a strategy you didn't have before. Nothing here makes a
 * future run numerically stronger for free — every unlock either adds an
 * OPTION (a new modifier enters the draft pool, a new consumable exists) or
 * front-loads a choice you'd otherwise make later. That keeps the skill
 * ceiling honest while still paying out for failure.
 */

import {
  budgetForMark, loadoutLegal, MARK_COUNT, newTiers, type UpgradeTiers,
} from "./upgrades";

export interface UnlockDef {
  id: string;
  name: string;
  /** Salvage price. One-time; unlocks never stack. */
  cost: number;
  desc: string;
  /** Other unlock ids that must be owned first — the Workshop renders these
   *  as locked with the prerequisite named, rather than hiding them, so the
   *  player can see what they're working toward. */
  requires?: string[];
}

/**
 * The unlock tree. Kept small and legible: two cheap "new toy" unlocks that
 * open the piece-size axis in the draft pool, one consumable, one economic
 * head start, and one genuine endgame capstone gated behind the build it
 * belongs to.
 */
export const UNLOCKS: UnlockDef[] = [
  {
    id: "demo",
    name: "Demolition Licence",
    cost: 45,
    desc: "Adds Demolition Charges to the draft pool: armed bombs that cost nothing to fire and refund funds for every cube they vaporize. Turns a dead junk pile into cash.",
  },
  {
    id: "bulk",
    name: "Bulk Freight Permit",
    cost: 55,
    desc: "Adds Bulk Shipments to the draft pool: 5-cube pentominoes. Dense and rigid — they survive landings that shatter a tetromino, and their weight squares up the layers underneath.",
  },
  {
    id: "auto",
    name: "Autoloader Rig",
    cost: 130,
    desc: "Adds the Autoloader to the draft pool — the endgame of the micro build. The cannon fires itself, fast and roughly aimed, at half cost. You will need Bond Breakers to flatten what it makes.",
    requires: ["demo"],
  },
  {
    id: "scrap-cache",
    name: "Scrap Cache",
    cost: 70,
    desc: "Every run starts with 30 scrap banked, so the first refit stop is a real decision instead of a window-shop.",
  },
  {
    id: "survey",
    name: "Weather Survey",
    cost: 60,
    desc: "The bay's prevailing wind is surveyed before you launch: the HUD gauge shows the bay's steady average alongside the live gust, so a headwind bay can be planned for instead of discovered.",
  },
];

export function unlockById(id: string): UnlockDef | undefined {
  return UNLOCKS.find((u) => u.id === id);
}

/** True when every prerequisite of `def` is already owned. */
export function unlockAvailable(def: UnlockDef, owned: string[]): boolean {
  return (def.requires ?? []).every((r) => owned.includes(r));
}

export interface MetaState {
  salvage: number;
  /** Purchased unlock ids. */
  unlocks: string[];
  /** Lifetime counters, shown in the Workshop header. */
  runs: number;
  /** Deepest bay ever REACHED (1-based), win or lose. */
  bestBay: number;
  /** Highest Deep Run MARK beaten. 0 = never completed a run, so the Mark
   *  currently attemptable is `markUnlocked(meta)` = this + 1.
   *
   *  A Mark is a gate, not a treadmill: it is raised by BEATING the previous
   *  one, never by grinding Contracts. That's what makes a given Mark clear
   *  mean the same thing for every player who holds one, and it's why nothing
   *  purchasable may touch this field (see docs/DESIGN.md). */
  mark: number;
  /** The permanent loadout — the upgrade tiers a Deep Run STARTS from, bought
   *  against the current Mark's build budget (upgrades.ts's budgetForMark).
   *  In-run scrap still refits on top of this at the usual stops. */
  loadout: UpgradeTiers;
  /** Contract ids already paid out. A Contract pays ONCE, ever.
   *
   *  This is a monetization invariant, not a balance preference. Unlimited buys
   *  "the daily Contract cap lifted" (docs/DESIGN.md), so if every completion
   *  paid, the subscription would buy salvage -> unlocks -> stronger Deep Runs,
   *  which is the one thing it must never do. Paying each Contract once keeps
   *  the subscription buying throughput rather than power, and leaves replaying
   *  a cleared Contract as free practice. */
  claimedContracts: string[];
}

export function newMeta(): MetaState {
  return {
    salvage: 0, unlocks: [], runs: 0, bestBay: 0, mark: 0,
    loadout: newTiers(), claimedContracts: [],
  };
}

/** The Mark the player may currently attempt: one above their best clear, held
 *  at MARK_COUNT once the ladder is finished. */
export function markUnlocked(meta: MetaState): number {
  return Math.min(MARK_COUNT, meta.mark + 1);
}

/** Ladder points the player has to spend on a loadout right now. */
export function markBudget(meta: MetaState): number {
  return budgetForMark(markUnlocked(meta));
}

/** The loadout to actually fly, with an illegal one (a stale save from before a
 *  re-price, or a hand-edited localStorage entry) falling back to stock rather
 *  than being flown as-is. Cheating the budget is the one thing that would make
 *  a Mark clear mean nothing, so it's checked at the point of use. */
export function safeLoadout(meta: MetaState): UpgradeTiers {
  return loadoutLegal(meta.loadout, markUnlocked(meta)) ? { ...meta.loadout } : newTiers();
}

/** Salvage award weights. Exported so the end-of-run modal can show the same
 *  breakdown it pays out, rather than a second copy of the formula. */
export const SALVAGE_PER_BAY = 5;
export const SALVAGE_PER_2_LINES = 1;
export const SALVAGE_RUN_COMPLETE_BONUS = 25;
/** Floor paid for finishing a run at all, however badly. Non-zero on purpose:
 *  "dying gives you resources" has to be true even for a bay-1 flameout, or the
 *  worst runs — the ones where the player most needs a new option to try —
 *  are the ones that pay nothing. */
export const SALVAGE_FLOOR = 3;

/**
 * Salvage paid out for a finished run. Weighted toward DEPTH (bays cleared)
 * rather than lines or funds, because depth is the thing unlocks are supposed
 * to help you push — and because funds are mostly the last bay's float (see
 * run.ts's finalRunScore for the same reasoning applied to the leaderboard).
 */
export function salvageForRun(baysCleared: number, totalLines: number, runComplete: boolean): number {
  return (
    SALVAGE_FLOOR +
    baysCleared * SALVAGE_PER_BAY +
    Math.floor(totalLines / 2) * SALVAGE_PER_2_LINES +
    (runComplete ? SALVAGE_RUN_COMPLETE_BONUS : 0)
  );
}

/* -------------------------------------------------------------------------
 * CONTRACT PAYOUT
 *
 * PROVISIONAL — these two numbers want playtesting, and the docs say so
 * (docs/superpowers/specs/2026-07-31-contract-progression-persistence-design.md).
 *
 * Calibration they were picked against: a decent Deep Run pays ~43 salvage
 * (5 bays, 31 lines, measured) over ~10 minutes, and the unlock tree runs
 * 45-130 per entry. Three tier-1 dailies pay 18; three tier-5 dailies pay 42,
 * about one Deep Run.
 *
 * Per MINUTE a Contract pays better than a Deep Run, which is intended: the
 * daily cap is the throughput control, not the rate. What must stay true is
 * that Contracts never become the fastest route to a full unlock tree, because
 * the exam is meant to be where the tree gets paid for.
 * ---------------------------------------------------------------------- */
export const CONTRACT_SALVAGE_BASE = 6;
export const CONTRACT_SALVAGE_PER_TIER = 2;

/** Salvage for completing a Contract of `tier`. Scales with tier so the ladder
 *  is worth climbing; independent of launches used, because a Contract is the
 *  forgiving half and shaving the budget is its own reward. */
export function salvageForContract(tier: number): number {
  const t = Math.max(1, Math.floor(tier));
  return CONTRACT_SALVAGE_BASE + (t - 1) * CONTRACT_SALVAGE_PER_TIER;
}

/** True once this Contract has paid out — replaying it is free practice. */
export function contractClaimed(meta: MetaState, contractId: string): boolean {
  return meta.claimedContracts.includes(contractId);
}
