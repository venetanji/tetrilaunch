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
 * The same loadout with one track TAKEN OUT OF THE ORDER — the rig a controlled
 * experiment on that track needs.
 *
 * `sim/strategy-arms.ts` is the caller and the reason. It crosses "system off"
 * against "system on" by granting the track through a kit, which only controls
 * anything if the rig underneath carries none of it. Point that tool at
 * `--build liner` (Impact Cushion first) and the loadout installs a liner
 * before the arm's own tier is applied, so BOTH "off" arms fly with a cushion
 * and every main effect and interaction in the table is measured against a
 * contaminated control. Review found it; the arms tool now builds every arm on
 * this instead.
 *
 * REMOVED FROM THE ORDER, not zeroed after the fact. Zeroing a tier leaves the
 * budget it consumed unspent, which is a rig no Workshop would sell and a
 * different one from either arm; dropping the track from the priority order and
 * re-spending gives the rig a player who was not buying that system would
 * actually build.
 */
/**
 * The rig a player with room for exactly `slots` systems would fly, given a
 * mount order: the first `slots` tracks the Mark lets them own, spent on the
 * usual breadth-then-depth Workshop walk.
 *
 * TRUNCATED AFTER THE MARK FILTER, not before, and the difference is a whole
 * rung of the answer: `ownableTracks` drops the tracks whose `requiresMark`
 * has not fallen yet, so slicing the raw order first would spend a slot on a
 * system the Workshop refuses to sell and hand a Mark-3 rig three systems while
 * calling it four. A slot is a place to PUT a system, so it is only spent on
 * one that exists.
 *
 * WHAT THIS IS NOT MODELLING, stated because it looks like an omission: the
 * salvage the player sank into systems they did not mount. It does not need to
 * be modelled, because it cannot change this rig — `meta.ts`'s UPRATE_MAX_TIER
 * caps the Workshop at tier 2 whatever else is owned, so the deepest a mounted
 * track ever gets before a refit stop is tier 2 either way. A player who knows
 * they will mount four buys four; a player who owns ten and mounts four flies
 * the same four. Both are this function.
 */
export function mountedLoadout(
  order: UpgradeId[],
  mark: number,
  slots: number,
  budget = budgetForMark(mark),
): UpgradeTiers {
  const mounted = ownableTracks(order, mark).slice(0, Math.max(0, Math.floor(slots)));
  return loadoutFor(mounted, mark, budget);
}

/** The tracks `mountedLoadout` would actually put in the rack — the same
 *  truncation, exposed so a harness can print the rig it flew and a refit
 *  policy can be handed the mounted order rather than the whole roster. */
export function mountedTracks(
  order: UpgradeId[], mark: number, slots: number,
): UpgradeId[] {
  return ownableTracks(order, mark).slice(0, Math.max(0, Math.floor(slots)));
}

export function loadoutWithoutTrack(
  order: UpgradeId[],
  mark: number,
  track: UpgradeId,
  budget = budgetForMark(mark),
): UpgradeTiers {
  return loadoutFor(order.filter((id) => id !== track), mark, budget);
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
  /* -------------------------------------------------------------------------
   * THE FULL-ROSTER MOUNT ORDERS — every track, in the order a rig would give
   * up its scarce SLOTS to them (`sim/slots.ts`).
   *
   * Every order above stops at five to seven tracks, and each one is right to:
   * it names a shopping list, and a shopping list ends where the budget does.
   * A slot sweep asks the opposite question — "with room for exactly K systems,
   * which K" — and an order shorter than the roster cannot answer it, because
   * `mountedLoadout` takes the first K of the order and any K past its length
   * is silently the whole thing. Measured on a truncated order, slots 7, 8, 9
   * and 10 would all fly the same rig and the slot ladder would read as free.
   *
   * So these four span all ten, and they differ ONLY in which track takes the
   * first seat or two. That is what makes the identity claim testable: at K =
   * 10 all four are the same rig BY CONSTRUCTION, so any gap between them at
   * K = 4 is the mount decision and nothing else.
   * ----------------------------------------------------------------------- */
  // No content knowledge: the numbers first, the answers after.
  "mount-generic": [
    "reactor", "hydraulics", "bay", "launcher", "bonds",
    "demolition", "thaw", "cushion", "incinerator", "magazine",
  ],
  // A frozen belt: the lance takes the first seat off the numbers.
  "mount-cryo": [
    "thaw", "reactor", "hydraulics", "bay", "launcher",
    "bonds", "demolition", "cushion", "incinerator", "magazine",
  ],
  // A volatile belt: the liner does.
  "mount-volatile": [
    "cushion", "reactor", "hydraulics", "bay", "launcher",
    "bonds", "demolition", "thaw", "incinerator", "magazine",
  ],
  // A slagged belt: the rack — slag's only exit — and the emitter behind it.
  "mount-slag": [
    "demolition", "bonds", "reactor", "hydraulics", "bay",
    "launcher", "thaw", "cushion", "incinerator", "magazine",
  ],
};
