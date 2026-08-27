/**
 * COUNTERS — the hands the harness was still missing, and the hands the game
 * does not have yet.
 *
 * Two very different kinds of thing live here, and keeping them apart is the
 * only reason this file is safe to quote in a design argument:
 *
 *  1. **EXISTING counters the bots do not use.** `sim/README.md` has carried the
 *     caveat since the harness shipped — "the bots never use Bond Breaker or
 *     Demolition, so those tracks measure as worthless" — and `bots.ts`'s
 *     `demo` closed half of it. `bondHands` closes the other half. This is not
 *     a proposal; it is an instrument fix, and every number it moves was a
 *     number the harness was getting wrong.
 *
 *  2. **HYPOTHETICAL counters that do not exist.** `cushionKit` and `thawHands`
 *     are prototypes of proposed systems, run headlessly so a design proposal
 *     can quote a measurement instead of an intuition. They ship NO
 *     player-facing gameplay: the cushion is a multiplier on a `LevelConfig`
 *     seam the game already has, and the thaw rig acts through `Game`'s public
 *     cube list, exactly as a bot's hands do.
 *
 * The distinction matters to the finding, not just to the tidiness. A combo the
 * sweep calls unwinnable while the bot is holding a charge it never fires is a
 * statement about the bot. A combo still unwinnable once every EXISTING counter
 * is in the bot's hands is a statement about the game — and only that second
 * kind licenses proposing a new system.
 */
import type { Game } from "../src/game/game";
import type { LevelConfig } from "../src/game/level";
import { MATERIAL_SPEC } from "../src/game/theme";
import { VOLATILE_TRIGGER_SPEED } from "../src/game/lineClear";
import type { Bot } from "./bots";

/* ---------------------------------------------------------------------------
 * 1. EXISTING — the Bond Breaker
 * ------------------------------------------------------------------------- */

/**
 * Cubes on the field before the wrapper will spend a Bond Breaker.
 *
 * The charge's whole value is that "with nothing holding awkward stacks rigid,
 * the pile slumps flatter and the compactor packs the loose cubes into full
 * lines far more easily" (game.ts's `useBondBreaker`), so firing it into an
 * empty bay wastes the run's rarest consumable — a maxed emitter ships three
 * for TEN BAYS (run.ts's `bondChargesFor`). 24 is two cells shy of the first
 * congestion tier (level.ts's `PILE_TIERS` reads 32), i.e. "the pile is
 * genuinely deep but the bay is not yet being taxed for it".
 */
export const BOND_MIN_CUBES = 24;

/**
 * Seconds of clock that must remain. A field-wide slump has to be PRESSED to
 * pay, and the press takes a stroke; spending the last charge with nothing left
 * to sell it into is the one way this wrapper could make a bay worse.
 */
export const BOND_MIN_SECS_LEFT = 25;

/**
 * Wrap any bot with a pair of hands for the Bond Emitter.
 *
 * Deliberately the SIMPLEST honest rule, held to the same bar `bots.ts` holds
 * `demo` to: fire when the pile is deep, the clock still has room to sell the
 * slump, and a charge is left. It does not hunt for the single best moment —
 * a player does not either — and it does not model tar, because which joints
 * are welds is private to `Game` and `useBondBreaker` already refuses a field
 * held together entirely by welds (returning false, spending nothing).
 *
 * A wrapper rather than an `AimOpts` flag so this composes with EVERY preset in
 * `BOTS` without touching that file: `bondHands(BOTS.demo(seed))` is a bot with
 * both existing answers in its hands, which is the rig every "unwinnable" claim
 * in `winnability.ts` is measured against.
 */
export function bondHands(base: Bot, name = `${base.name}+bond`): Bot {
  return {
    name,
    act(g, now) {
      if (g.bondCharges > 0
        && g.cubes.length >= BOND_MIN_CUBES
        && (g.level.timeLimitSec === 0 || g.timeLeftMs > BOND_MIN_SECS_LEFT * 1000)) {
        // Returns false — spending nothing — when there is nothing breakable,
        // so an all-welded field costs no charge and this falls through to the
        // base bot's shot on the same tick.
        if (g.useBondBreaker(now)) return;
      }
      base.act(g, now);
    },
  };
}

/* ---------------------------------------------------------------------------
 * 2. HYPOTHETICAL — the proposals
 *
 * A kit is (a name, a price, and at most one of: a config mutation, a hands
 * wrapper). The price is in UPGRADE LADDER POINTS (upgrades.ts's TIER_COSTS,
 * 20/35/55 a rung) rather than in salvage or scrap, because that is the
 * currency the build budget is denominated in and the only one in which a
 * proposal can be compared against the seven systems that already exist.
 * ------------------------------------------------------------------------- */

export interface CounterKit {
  id: string;
  name: string;
  /** Ladder points the hypothetical system would cost at this tier. */
  cost: number;
  /** In-place mutation of the bay config, applied AFTER `levelForRun` — i.e.
   *  on top of the ship, the ratchets and the final clause, which is where a
   *  new ship system's `apply` would land relative to a notch. */
  level?(cfg: LevelConfig): void;
  /** Hands the system gives the pilot. */
  hands?(bot: Bot): Bot;
}

/* --- 2a. THE REAR-BAY CUSHION ------------------------------------------- */

/**
 * What a cushion tier multiplies the volatile trigger threshold by.
 *
 * SIZED FROM THE MEASUREMENT ALREADY IN THE TREE, not guessed.
 * `lineClear.ts`'s `VOLATILE_TRIGGER_SPEED` note records the whole distribution
 * it was set against: "measured over every angle/power the cannon can produce,
 * first-contact relative speed runs 17.3 to 30.8", with the median running
 * 19.5 at power 0 and 25.5 at full, and the threshold placed at 22 so that
 * "lob it and it survives (67% of launches), fire it hard and it goes off".
 *
 * A cushion softens the landing. Softening the blow by a factor and raising the
 * threshold by that same factor are the same arithmetic on the same comparison
 * (`rel < VOLATILE_TRIGGER_SPEED * mult`), which is why this is modelled on the
 * seam `level.ts` already ships — `volatileTriggerMult`, today written only by
 * finals.ts's Hair Trigger, and only downward. Nothing new is invented.
 *
 * The three tiers are placed against that measured range rather than round
 * numbers:
 *
 *   tier 1  x1.15 -> threshold 25.3, above the full-power MEDIAN (25.5 is a
 *           hair over it): a hard shot is a coin flip instead of a detonation.
 *   tier 2  x1.30 -> threshold 28.6, inside the top decile of the range.
 *   tier 3  x1.40 -> threshold 30.8, the measured MAXIMUM first-contact speed:
 *           no launch the cannon can produce sets a cube off on arrival.
 *
 * Tier 3 is deliberately the exact top of the range and not past it. A cushion
 * that makes volatile inert is not a counter, it is a delete button, and the
 * design's own rule is that "a system does not DELETE a hazard, it makes one
 * specific hazard cheap for you" (hazards.ts). At x1.40 a volatile cube still
 * detonates when something else lands ON it hard — the neighbour case that is
 * the material's whole identity ("the one material whose cost lands on cubes
 * that were already safely down") — it just cannot be set off by its own
 * arrival.
 */
export const CUSHION_TRIGGER_MULT = [1.15, 1.30, 1.40] as const;

/** Ladder price per cushion tier — the shared 20/35/55 every other track pays
 *  (upgrades.ts's TIER_COSTS). Priced the same on purpose: `upgrades.ts` says
 *  the tracks "are meant to be balanced against each other by EFFECT, and a
 *  shared price keeps 'which system do I want' the whole decision". A proposal
 *  that arrives with its own price table is a proposal asking not to be
 *  compared. */
export const CUSHION_TIER_COST = [20, 55, 110] as const;

/**
 * THE MODEL IS AN UPPER BOUND, AND THE PROPOSAL IS NOT.
 *
 * The proposed system is a cushion at the BACK of the bay: it softens landings
 * in the deep slots, where a lob has furthest to fall, and does nothing at the
 * near end. `volatileTriggerMult` is field-wide, so this kit measures a cushion
 * that covers the whole floor.
 *
 * That gap is stated rather than closed because closing it here would be worse:
 * a positional cushion needs a real collision-side rule (which contact points
 * count as "cushioned"), and inventing a proxy for it in the harness would
 * measure the proxy — the same refusal `bots.ts`'s `demo` makes about tar. So
 * every cushion number this harness prints reads: *this is the most a cushion
 * could possibly be worth.* If the upper bound does not rescue a combo, no
 * cushion will.
 */
export function cushionKit(tier: number): CounterKit {
  const t = Math.max(1, Math.min(CUSHION_TRIGGER_MULT.length, Math.floor(tier)));
  const mult = CUSHION_TRIGGER_MULT[t - 1];
  return {
    id: `cushion${t}`,
    name: `Impact Cushion ${t}`,
    cost: CUSHION_TIER_COST[t - 1],
    level(cfg) {
      // Multiplied onto whatever is there rather than assigned, so a cushion
      // and finals.ts's Hair Trigger compose the way two multipliers should —
      // a cushioned run that accepts Hair Trigger has bought back part of it,
      // which is exactly the trade the clause should be offering.
      cfg.volatileTriggerMult = (cfg.volatileTriggerMult > 0 ? cfg.volatileTriggerMult : 1) * mult;
    },
  };
}

/** The effective trigger speed a cushion tier produces on a stock bay — quoted
 *  by the findings doc and pinned in `sim/systems.ts`, so the doc's numbers are
 *  derived from the constants rather than typed beside them. */
export function cushionThreshold(tier: number): number {
  const t = Math.max(1, Math.min(CUSHION_TRIGGER_MULT.length, Math.floor(tier)));
  return VOLATILE_TRIGGER_SPEED * CUSHION_TRIGGER_MULT[t - 1];
}

/* --- 2b. THE THAW RIG ---------------------------------------------------- */

/**
 * Thaw charges a rig of `tier` carries PER BAY.
 *
 * Per bay, not per run, and that is the proposal's one real disagreement with
 * the Bond Emitter it would sit beside. A Bond Breaker is a once-a-run reset
 * ("shatter the field flat, once, where it counts most"), so a run-long
 * magazine of three is the right shape for it. Cryo is not an emergency, it is
 * a TAX: `hazards.ts` puts the material's rate at 0.07 for a first notch and
 * `belt.ts` caps the belt at one special in three, so a two-notch cryo run
 * meets several frozen shipments EVERY bay and needs an answer that renews.
 * The user's framing — "replenishable charges" — is the same reading.
 *
 * Sized against the belt rather than against a feel: at `MATERIAL_BASE` 0.07
 * and a bay that lands 40-60 shipments, one notch of cryo puts 3-4 frozen
 * cubes' worth of shipment on the floor per bay. Two charges answers a first
 * notch and leaves the second notch genuinely unanswered, which is the shape
 * `upgrades.ts` gives every other track.
 */
export const THAW_CHARGES_PER_TIER = 2;

/** Ladder price per thaw tier — the shared ladder again, as for the cushion. */
export const THAW_TIER_COST = [20, 55, 110] as const;

/**
 * Cubes the rig will not thaw below. A charge spent on a single cube sitting
 * alone in an empty bay is a charge wasted; the material's cost is a row it
 * cannot sell, so the rig waits until the frozen cube has settled with company.
 * 1 means "as soon as it is down", which is the generous reading — see the
 * upper-bound note on `thawHands`.
 */
export const THAW_MIN_TARGETS = 1;

/**
 * Wrap a bot with a hypothetical thaw rig.
 *
 * WHAT IT ACTUALLY DOES: on any tick where a cryo cube is settled and still
 * unstruck, spend a charge and mark it struck — precisely what
 * `lineClear.ts`'s `strikeCryo` does when a fast shipment hits a resting frozen
 * cube, minus the shipment. That is the proposal: a Bond-Breaker-shaped button
 * that pays the SEQUENCING cost of cryo (`strikeCryo`'s note: "cryo costs a
 * shipment: land it, then spend a second shot hitting it") out of a charge
 * instead of out of a launch.
 *
 * WHY IT IS ALSO AN UPPER BOUND, twice over:
 *
 *  - It never misses. A player striking cryo with a shipment has to land that
 *    shipment on the cube; a charge that always connects is the best case.
 *  - It costs no cooldown and no launch. The charge is a button, like the Bond
 *    Breaker, so the shot the player would have spent striking is still
 *    available for cargo.
 *
 * Both are deliberate. The question a prototype has to answer first is whether
 * the system helps AT ALL — if the most generous possible version does not
 * rescue the combo, a real one cannot, and the proposal dies cheaply. Where it
 * does rescue the combo, the gap between this and a real implementation is the
 * design work the proposal then owes.
 *
 * ONE WAY IT IS PESSIMISTIC, and it is worth naming beside the two above so the
 * bound is not read as tight in both directions: it thaws the FIRST eligible
 * cube in the field list, not the most urgent one. A player aims at the cube
 * the press is about to reach (the one `shatterColdCryo` is about to punish
 * them for); this rig may spend a charge on a cube in no danger at all. That is
 * a naive rule rather than a generous one, and the reason it stays naive is the
 * same reason `bots.ts`'s `demo` refuses to model tar: "the most urgent cryo
 * cube" is a judgement about the press band, and a proxy for it here would
 * measure the proxy.
 */
export function thawHands(base: Bot, chargesPerBay: number, name?: string): Bot {
  let left = chargesPerBay;
  let lastGame: Game | null = null;
  return {
    name: name ?? `${base.name}+thaw`,
    act(g, now) {
      // Charges renew per BAY, and a wrapper is reused across the ten bays of a
      // deep run, so the magazine has to notice a new Game. Identity, not a
      // counter: the driver builds one Game per bay.
      if (g !== lastGame) { lastGame = g; left = chargesPerBay; }
      if (left > 0) {
        const targets = g.cubes.filter(
          (c) => MATERIAL_SPEC[c.material].needsStrike && !c.struck
            && c.body.velocity.x * c.body.velocity.x
              + c.body.velocity.y * c.body.velocity.y < 1,
        );
        if (targets.length >= THAW_MIN_TARGETS) {
          // One charge thaws ONE cube — the same unit a strike buys, so the
          // charge count is comparable to the shipment count it replaces. A
          // field-wide thaw would be a Bond Breaker for cryo, which is a
          // different (and much larger) proposal.
          targets[0].struck = true;
          left -= 1;
        }
      }
      base.act(g, now);
    },
  };
}

export function thawKit(tier: number): CounterKit {
  const t = Math.max(1, Math.min(THAW_TIER_COST.length, Math.floor(tier)));
  const charges = THAW_CHARGES_PER_TIER * t;
  return {
    id: `thaw${t}`,
    name: `Thaw Lance ${t}`,
    cost: THAW_TIER_COST[t - 1],
    hands: (bot) => thawHands(bot, charges, `${bot.name}+thaw${t}`),
  };
}

/** Every kit the CLI can name, by id. */
export const COUNTER_KITS: Record<string, CounterKit> = {
  cushion1: cushionKit(1),
  cushion2: cushionKit(2),
  cushion3: cushionKit(3),
  thaw1: thawKit(1),
  thaw2: thawKit(2),
  thaw3: thawKit(3),
};

/** Fold a set of kits into one — the config mutations compose in order, the
 *  hands nest in order. Returned as a kit so a caller never has to special-case
 *  "no counters". */
export function combineKits(kits: CounterKit[]): CounterKit {
  return {
    id: kits.map((k) => k.id).join("+") || "none",
    name: kits.map((k) => k.name).join(" + ") || "none",
    cost: kits.reduce((a, k) => a + k.cost, 0),
    level: (cfg) => { for (const k of kits) k.level?.(cfg); },
    hands: (bot) => kits.reduce((b, k) => (k.hands ? k.hands(b) : b), bot),
  };
}
