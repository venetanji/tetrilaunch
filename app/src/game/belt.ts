import type { MaterialMix } from "./level";
import type { Material } from "./theme";

/**
 * THE BELT SCHEDULE — how often a material arrives, and which one.
 *
 * This replaces the independent per-shipment roll the cannon used to do (a
 * cumulative walk over materialMix, one draw, everything not claimed is
 * standard). That roll was correct in the average and wrong in the moment, and
 * the difference is what a player actually meets.
 *
 * WHAT WENT WRONG. The mix is a SUM of ratcheted axes, and a Tier-10 run takes
 * two notches a bay — so by bay 6 a player has banked ten notches, seven of
 * them materials (the forced hands at bays 2, 5 and 8 each dealt a
 * materials-only table). Six axes at a notch or two apiece summed to ~0.47, and
 * an independent roll at 0.47 does not deliver "roughly half specials, evenly
 * spread". It delivers CLUSTERS: three-in-a-row lands once every ten shipments,
 * four-in-a-row once every twenty-three. A run of four is a bay you cannot
 * build a row in — slag fills slots nothing can close and tar welds the mess
 * shut behind it — and the bay is lost to a streak rather than to a decision.
 * The owner's report of it (Tier 10, bay 6, replenishing bombs aboard) is the
 * measurement this file exists for: "I still couldn't clear all the slag and
 * couldn't make new lines because tar everywhere."
 *
 * A cap on the sum alone cannot fix that, and hazards.ts already had one. At
 * ANY rate an independent roll floods and droughts; lowering it only makes the
 * floods rarer, never shorter. The fix has to be about SPACING, not rate.
 *
 * THREE RULES, and they are deliberately separable:
 *
 *  1. **A CEILING.** MATERIAL_GAP standard shipments are guaranteed after every
 *     material, so the belt can never carry more than one material in
 *     (MATERIAL_GAP + 1) — BELT_CEILING, one in three. This is the rule the
 *     player asked for in the words "max 2 normal pieces and a material is
 *     fair", and it is a hard structural bound rather than a probability: there
 *     is no seed, no ratchet and no Final clause that produces two materials
 *     back to back on a ratcheted bay.
 *
 *  2. **A RATE THAT ESCALATES WHILE THE BELT IS CLEAN.** Past the gap, every
 *     standard shipment makes the next one likelier (`credit` below), and firing
 *     a material spends that pressure back down. So a drought closes itself and
 *     a flood cannot start. This is stochastic rounding, and the reason it is
 *     that rather than a hand-tuned pity curve is that it is EXACT: credit gains
 *     the bay's density every shipment and loses exactly 1 per material, so the
 *     long-run share is the density and nothing else. materialMix therefore
 *     still means precisely what LevelConfig says it means — a per-shipment
 *     probability — and preview.ts can keep printing it to the player unchanged.
 *
 *  3. **WHICH MATERIAL IS A SEPARATE DRAW,** weighted by the mix. Splitting
 *     "how often" from "which" is what makes the ceiling affordable: notches
 *     past the ceiling stop adding specials and start deciding WHICH special you
 *     get, so a run that poured four notches into slag against one of cryo faces
 *     a belt that is 1-in-3 material and four fifths of it slag. The pressure
 *     still climbs; what stops climbing is the share of the bay you are allowed
 *     to build rows out of.
 *
 * AN AUTHORED BAY IS EXEMPT — see `authored` in the constructor. A drill that
 * ships rebar on every shipment, a Contract built around one material, a Final
 * Inspection's Full Rebar clause: those state a density ABOVE the ceiling on
 * purpose, and the honest answer to "every shipment is rebar" is every shipment.
 * The ceiling governs the ratchet ladder, which is the thing that stacks behind
 * the player's back; a bay that names its own number gets its own number.
 */

/** Fixed key order for the material draw. Every non-standard material, in
 *  ladder order, so adding one is a single edit here. */
export const MATERIAL_ROLL_ORDER = [
  "slag", "cryo", "rebar", "volatile", "tar", "magnetic",
] as const;

/** Standard shipments guaranteed to follow every material. 2 — the number the
 *  ceiling is stated in ("two normal pieces and a material"), and the smallest
 *  one that makes a row buildable between arrivals: compactorMinLineCells is 8
 *  cells, so two standard tetrominoes is one full line's worth of cargo that
 *  the player is guaranteed to be able to place cleanly before the next
 *  material lands on it. */
export const MATERIAL_GAP = 2;

/**
 * The most of the belt materials may ever occupy: one shipment in
 * (MATERIAL_GAP + 1).
 *
 * Derived rather than typed in, because it is not a second tunable — it is what
 * the gap arithmetically permits, and a constant that could disagree with the
 * gap is a constant that eventually will. hazards.ts's MIX_TOTAL_CAP is held
 * equal to it (sim/systems.ts pins that), which is what keeps materialMix a
 * literal per-shipment probability rather than a weight needing a second
 * conversion before anything can print it.
 */
export const BELT_CEILING = 1 / (MATERIAL_GAP + 1);

/** Total non-standard share of a mix — the belt's density before the piece-size
 *  normalization and before the ceiling. */
export function mixTotal(mix: MaterialMix | undefined): number {
  if (!mix) return 0;
  let total = 0;
  for (const key of MATERIAL_ROLL_ORDER) total += mix[key] ?? 0;
  return total;
}

/**
 * One bay's belt, as a stateful stream of materials.
 *
 * Stateful is the whole point and the reason this is a class rather than a
 * function of (mix, rng): the ceiling and the escalation are both MEMORY — how
 * long since the last material, and how much pressure has built since. The old
 * roll was memoryless, which is exactly the property that let it cluster.
 *
 * Owned by the Cannon, built once per bay, and seeded through the rng the
 * caller passes to `next` so a bay replays identically from the same run seed.
 */
export class BeltSchedule {
  /** Non-zero materials and their mix weights, in MATERIAL_ROLL_ORDER, already
   *  multiplied by the piece-size scale. Scaled at construction because a
   *  UNIFORM scale is invisible to `weighted` (which normalizes by the total)
   *  and is exactly what the authored walk needs — so one scaled list serves
   *  both paths and there is no second place for the scale to be forgotten. */
  private readonly weights: { material: Material; weight: number }[];
  /** Share of shipments that carry a material, after piece-size normalization
   *  and after the ceiling. */
  private readonly density: number;
  /** False when the bay ASKED for more than the ceiling — a drill, a Contract
   *  or a Final clause. Those get the old memoryless roll at their own stated
   *  rate; see the module note. */
  private readonly spaced: boolean;
  /** Material owed but not yet delivered, in shipments. Gains `density` every
   *  shipment and loses exactly 1 per material — see rule 2. */
  private credit = 0;
  /** Standard shipments still owed to the gap after the last material. */
  private cooling = 0;

  /**
   * @param mix       the bay's per-shipment material probabilities.
   * @param sizeScale std cubes / this bay's cubes per shipment. The old roll
   *                  scaled the whole mix by this so that dead cubes per LAUNCH
   *                  were equal across size classes (a Bulk shipment carries
   *                  more cargo, so it should be slag less often). Kept, because
   *                  the argument is still right — but it now scales the DENSITY
   *                  under the ceiling rather than the raw probabilities, so a
   *                  Micro build cannot scale its way past the spacing rule. The
   *                  ceiling counts shipments, and it binds at every size.
   */
  constructor(mix: MaterialMix | undefined, sizeScale = 1) {
    const scale = sizeScale > 0 ? sizeScale : 1;
    this.weights = MATERIAL_ROLL_ORDER
      .map((material) => ({
        material: material as Material,
        weight: (mix?.[material] ?? 0) * scale,
      }))
      .filter((e) => e.weight > 0);
    const stated = mixTotal(mix);
    // The bay's OWN statement decides whether it is authored, and it is read
    // BEFORE size normalization: whether a belt is deliberately dense is a
    // property of the config, not of what size the shipments happen to be.
    // Otherwise a Micro modifier could double a perfectly ordinary ratcheted mix
    // past the ceiling and silently opt that bay out of the spacing rule — the
    // one bay that needs it most, since Micro fires more shipments per bay than
    // any build.
    this.spaced = stated <= BELT_CEILING + 1e-9;
    const scaled = this.weights.reduce((a, e) => a + e.weight, 0);
    this.density = this.spaced ? Math.min(BELT_CEILING, scaled) : scaled;
  }

  /** The share of shipments this belt will carry a material on. Exposed for the
   *  HUD and for sim/systems.ts, which pins it against the ceiling. */
  get materialShare(): number {
    return this.density;
  }

  /**
   * The next shipment's material.
   *
   * Draws EXACTLY TWO random numbers, whatever it returns — one for the gate,
   * one for the pick. That is a promise the caller depends on rather than an
   * implementation detail: the cannon shares its seeded stream across a whole
   * bay, so a draw count that varied with the outcome would make every later
   * shipment a function of which materials came up earlier, and a mix edited
   * between bays would re-phase the stream instead of leaving it aligned. The
   * old roll made the same promise at one draw; this one costs a second.
   */
  next(rng: () => number): Material {
    const gate = rng();
    const pick = rng();
    if (this.weights.length === 0) return "standard";

    if (!this.spaced) {
      // The old memoryless walk, for a bay that stated its own density above
      // the ceiling. Cumulative over MATERIAL_ROLL_ORDER, so a mix summing to 1
      // really does put a material on every shipment.
      let acc = 0;
      for (const e of this.weights) {
        acc += e.weight;
        if (gate < acc) return e.material;
      }
      return "standard";
    }

    // Rule 2, first half: pressure builds on every shipment, including the ones
    // the gap is holding back. Holding the gap's shipments out of the credit
    // would make the ceiling cost density rather than just spacing it, and the
    // belt would quietly under-deliver the rate the mix promises.
    //
    // Capped at one shipment's worth of debt: the belt may be owed a material,
    // never a burst of them. Without this a bay that spent a long stretch at the
    // ceiling would bank credit it could only pay back by firing materials
    // every third shipment for the rest of the bay — the flood this file exists
    // to prevent, arriving late instead of early.
    this.credit = Math.min(1, this.credit + this.density);

    // Rule 1: the ceiling. Unconditional, and checked before the gate so no
    // seed can talk its way past it.
    if (this.cooling > 0) {
      this.cooling -= 1;
      return "standard";
    }

    if (gate >= this.credit) return "standard";

    // Rule 2, second half: a material spends exactly one shipment of credit,
    // which is what makes the long-run share equal the density exactly. Credit
    // goes NEGATIVE on an early fire (a 5% chance that hits leaves -0.95), and
    // that is the pity resetting rather than a bug — it is the same accounting
    // read from the other side.
    this.credit -= 1;
    this.cooling = MATERIAL_GAP;
    return this.weighted(pick);
  }

  /** Rule 3: which material, proportional to the mix. `pick` is a uniform in
   *  [0, 1); scaling it by the weight total rather than normalizing the weights
   *  keeps this a single multiply and cannot divide by zero (the caller has
   *  already returned when there are no weights). */
  private weighted(pick: number): Material {
    let total = 0;
    for (const e of this.weights) total += e.weight;
    let acc = 0;
    const target = pick * total;
    for (const e of this.weights) {
      acc += e.weight;
      if (target < acc) return e.material;
    }
    // Unreachable except on float drift at the very top of the range, where the
    // last material is the right answer anyway.
    return this.weights[this.weights.length - 1].material;
  }
}
