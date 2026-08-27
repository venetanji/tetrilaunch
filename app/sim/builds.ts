/**
 * THE BUILD VOCABULARY — how a player might actually spend a Mark's budget.
 *
 * Not a CLI. Two sweeps need "the Workshop loadout a Mark-M pilot could
 * plausibly be flying" (`marks.ts` prices the tier ladder with it, `winnability.ts`
 * prices notch combos against it), and a loadout builder copied into two places
 * is how a harness ends up describing a Workshop that no longer exists — the
 * same reasoning `ratchet-model.ts` gives for living in its own file.
 *
 * It moved here out of `marks.ts`, which cannot be imported: that file is a CLI
 * with top-level `console.log`s, so importing it for one function would run a
 * whole Mark sweep as a side effect.
 *
 * What is deliberately NOT here: `marks.ts`'s `tiersForBay`, which MODELS the
 * refit stops by handing the rig a scrap schedule taken from the design's own
 * sizing estimate. `deeprun.ts` does not need a model — it flies the ten bays in
 * order and spends the scrap the bays actually paid, through `run.ts`'s real
 * `buyUpgrades`. A model and a measurement of the same thing should not share a
 * function.
 */
import { installById, UPRATE_MAX_TIER } from "../src/game/meta";
import {
  budgetForMark, newTiers, tiersCost, type UpgradeId, type UpgradeTiers,
} from "../src/game/upgrades";

/**
 * The tracks a Mark-M pilot can actually OWN.
 *
 * An install's `requiresMark` counts Marks BEATEN (meta.ts), and a player
 * flying Mark M has beaten M - 1. Without this gate the Mark-1 row is judged
 * against a rig no first-run player can build — measured in `marks.ts`: its
 * "best" build put 75 of 77 points into BAY2+HYD1, both `requiresMark` 1, i.e.
 * locked until the Mark it was supposed to be measuring is already beaten.
 * In-run refits cannot reach them either (run.ts's `buyUpgrade` refuses
 * tier-0 tracks).
 */
export function ownableTracks(order: UpgradeId[], mark: number): UpgradeId[] {
  return order.filter((id) => (installById(id)?.requiresMark ?? 0) <= mark - 1);
}

/**
 * Workshop phase: breadth first, then depth — tier 1 across the priority order,
 * then tier 2 across it, each rung `requiresMark`-gated and budget-capped.
 *
 * Breadth before depth because that is the purchase a player can actually make
 * first: an install opens a system, an uprate deepens one they already own, so
 * no amount of salvage reaches tier 2 of a track before tier 1 of it. Buying
 * depth-first here would model a rig with a Mark-1 budget spent on one maxed
 * track, which the Workshop will not sell.
 *
 * `budget` overrides the Mark's own allowance, and it is the whole reason this
 * function grew a fourth argument: the cheapest-strategy search in
 * `winnability.ts` walks the ladder UPWARD from a stock rig, asking what the
 * SMALLEST spend that clears a run is. Capping it at the Mark's budget by
 * construction would only ever answer "the biggest one".
 */
export function loadoutFor(
  order: UpgradeId[],
  mark: number,
  budget = budgetForMark(mark),
): UpgradeTiers {
  const tiers = newTiers();
  const cap = Math.min(budget, budgetForMark(mark));
  for (let tier = 1; tier <= UPRATE_MAX_TIER; tier++) {
    for (const id of ownableTracks(order, mark)) {
      if ((tiers[id] ?? 0) !== tier - 1) continue;
      const next = { ...tiers, [id]: tier };
      if (tiersCost(next) > cap) continue;
      tiers[id] = tier;
    }
  }
  return tiers;
}

/**
 * Named priority orders — the shapes a budget gets spent in.
 *
 * The first four are `marks.ts`'s ARCHETYPES, stated once here so the two
 * harnesses argue about the same builds. The last two are the ones `marks.ts`
 * deliberately refuses (its CALIBRATION_TRACKS note: MAGAZINE reads as a
 * self-inflicted wound to a bot that fires on every cooldown, and DEMOLITION
 * buys a `--ratchets spread` bay nothing to blow up).
 *
 * Both refusals are correct THERE and wrong HERE, and the difference is the
 * whole reason this sweep exists: `winnability.ts` puts materials on the belt on
 * purpose, so a rack has dead cargo to answer and an emitter has joints to
 * break. A sweep that asks "is this notch combo winnable" while withholding the
 * two systems the combo is a question about would be measuring the withholding.
 */
export const PRIORITY_ORDERS: Record<string, UpgradeId[]> = {
  // The economy build: buy the rate, then the press that realises it.
  economy: ["reactor", "hydraulics", "bay", "launcher", "bonds"],
  // The spatial build: more room to land in, and a press that squares it up.
  spatial: ["bay", "hydraulics", "reactor", "launcher", "bonds"],
  // The power build: reach the back of the bay and fight the weather.
  power: ["launcher", "hydraulics", "reactor", "bay", "bonds"],
  // A little of everything — the instinctive first spend.
  spread: ["reactor", "hydraulics", "bay", "launcher", "bonds"],
  // The build a MATERIAL run should want: the rack that is slag's only exit and
  // the emitter that is rebar's, bought before the numbers.
  material: ["demolition", "bonds", "reactor", "hydraulics", "bay", "launcher"],
  // Everything, in the order salvage would realistically reach it.
  full: ["reactor", "launcher", "demolition", "bonds", "hydraulics", "bay", "magazine"],
  /* -------------------------------------------------------------------------
   * THE TWO ORDERS THAT ACTUALLY BUY THE DECISION-SHAPED SYSTEMS.
   *
   * Neither the Thaw Lance nor the Impact Cushion appears in any order above,
   * and `counters.ts` says so in as many words ("No `--build` order installs
   * the track today, so this is a guard rather than a live case"). That was
   * harmless while a kit was the only way to fly one — `--mode counter` grants
   * the track onto the config and prices it in its own ladder points.
   *
   * It stopped being harmless the moment the cheapest-strategy search gained an
   * AIMING dimension (`sim/aim-strategies.ts`): a search asking "what is the
   * cheapest rig that clears, and which pilot flies it" cannot answer with a
   * cushion-aware pilot if no rung of the ladder it walks ever installs a
   * cushion. The strategy would read as worthless, for the third time in this
   * harness's history, because the rig had no hands.
   *
   * Ordered counter-first, like `material` and for the same reason: the point
   * of the order is to reach the system EARLY enough that the run is actually
   * flown with it, not to model a plausible shopping list.
   * ----------------------------------------------------------------------- */
  // The cryo build: the lance first, then the press that sells what it thaws.
  chill: ["thaw", "hydraulics", "bonds", "reactor", "bay", "launcher"],
  // The volatile build: the liner first, then the room to use it.
  liner: ["cushion", "bay", "hydraulics", "reactor", "bonds", "launcher"],
};
