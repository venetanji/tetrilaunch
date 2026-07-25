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
}

export function newMeta(): MetaState {
  return { salvage: 0, unlocks: [], runs: 0, bestBay: 0 };
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
