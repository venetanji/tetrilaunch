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
 *  2. **HYPOTHETICAL counters that do not exist.** `cushionKit` is a prototype
 *     of a proposed system, run headlessly so a design proposal can quote a
 *     measurement instead of an intuition. It ships NO player-facing gameplay:
 *     it is a multiplier on a `LevelConfig` seam the game already has.
 *
 * **THE THAW LANCE HAS MOVED FROM (2) TO (1).** It was the prototype this file
 * was written to price; it is now a ship system (`upgrades.ts`'s `thaw` track),
 * and `thawKit` below drives the SHIPPED implementation — it grants the real
 * `LevelConfig.thawCharges` and its hands pull the real `Game.useThawLance`.
 * The kit ids and the CLI flags are unchanged on purpose, so the before/after
 * in the findings doc is one command run twice rather than two commands. What
 * the numbers mean changed with it: they are no longer an upper bound on what a
 * lance COULD be worth, they are what the lance IS worth to this pilot.
 *
 * The distinction matters to the finding, not just to the tidiness. A combo the
 * sweep calls unwinnable while the bot is holding a charge it never fires is a
 * statement about the bot. A combo still unwinnable once every EXISTING counter
 * is in the bot's hands is a statement about the game — and only that second
 * kind licenses proposing a new system.
 */
import type { LevelConfig } from "../src/game/level";
import { VOLATILE_TRIGGER_SPEED } from "../src/game/lineClear";
import { thawChargesFor } from "../src/game/run";
import { MAX_TIER, TIER_COSTS } from "../src/game/upgrades";
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
 * proposal can be compared against the systems that already exist.
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

/* --- 1b. EXISTING — the THAW LANCE, which used to live in section 2 ------- */

/** Ladder price per lance tier — CUMULATIVE `TIER_COSTS` (20 / 55 / 110), the
 *  shared ladder every track pays. Derived from `upgrades.ts` rather than typed
 *  out, now that the track is real: a re-priced ladder must not leave this
 *  table quoting the old one into a findings doc. */
export const THAW_TIER_COST = TIER_COSTS.map(
  (_, i) => TIER_COSTS.slice(0, i + 1).reduce((a, b) => a + b, 0),
);

/**
 * Wrap a bot with a pair of hands for the Thaw Lance.
 *
 * The same shape as `bondHands` above, and now the same KIND of thing: it pulls
 * the shipped trigger (`Game.useThawLance`) rather than reaching into the cube
 * list. Everything about which cube is taken, whether a charge is spent, and
 * what an empty bay costs is therefore the game's rule and not the harness's —
 * which is the whole reason the prototype had to be retired the moment the
 * system landed. A wrapper that still marked cubes struck by hand would keep
 * measuring the proposal after the implementation had diverged from it.
 *
 * THE RULE, deliberately the simplest honest one, held to `bondHands`'s bar:
 * pull the trigger whenever it will do something. `useThawLance` already
 * refuses an empty rack and a bay with nothing frozen the press can reach
 * (returning false and spending nothing), so "whenever" costs nothing and needs
 * no threshold of its own — the game is a better judge of a wasted charge than
 * a wrapper is.
 *
 * WHAT IS STILL OPTIMISTIC, and it is the same item the findings' ledger has
 * carried since the prototype: the lance costs this pilot no attention. A human
 * decides between firing it and lining up the next shot; this fires it on the
 * tick it becomes useful, every time. The launch is not consumed either way —
 * that is the system's design, not the harness's licence — so the gap is one of
 * timing rather than of resources.
 *
 * WHAT IS NO LONGER OPTIMISTIC, and this is what changed with the
 * implementation: the prototype "never missed" and took the FIRST eligible cube
 * in the field list. The shipped lance never misses either — it aims itself —
 * but it takes the cube the PRESS is about to reach (lineClear.ts's
 * nextColdCryo), which is a strictly better target than the prototype's. So the
 * re-measurement is not a like-for-like replay of an upper bound; it is the
 * real system, and it is entitled to come out slightly ahead of the rig that
 * stood in for it.
 */
export function thawHands(base: Bot, name?: string): Bot {
  return {
    name: name ?? `${base.name}+thaw`,
    act(g, now) {
      // Returns false and spends nothing when there is no charge or no
      // reachable frozen cube, so this falls through to the base bot's shot on
      // the same tick — exactly as bondHands does on an all-welded field.
      g.useThawLance(now);
      base.act(g, now);
    },
  };
}

/** The lance at `tier`, as a kit: the real charge grant onto the bay's config,
 *  and the hands that fire it.
 *
 *  Charges come from `run.ts`'s `thawChargesFor`, so a re-tuned
 *  THAW_CHARGES_PER_TIER moves the harness and the game together. `--mode
 *  counter` flies ONE bay, which is the unit the ladder is sized in and the
 *  unit a ladder run's rack renews on — so a single grant here is exactly a
 *  ladder bay's rack, and no bay-boundary rule is being modelled or skipped. */
export function thawKit(tier: number): CounterKit {
  const t = Math.max(1, Math.min(MAX_TIER, Math.floor(tier)));
  return {
    id: `thaw${t}`,
    name: `Thaw Lance ${t}`,
    cost: THAW_TIER_COST[t - 1],
    level(cfg) {
      // Assigned, not added: the kit IS the rig's lance for this bay, and a
      // config that already carried one would otherwise be measured at two
      // tiers stacked. (No `--build` order installs the track today, so this is
      // a guard rather than a live case — see sim/builds.ts.)
      cfg.thawCharges = thawChargesFor(t);
    },
    hands: (bot) => thawHands(bot, `${bot.name}+thaw${t}`),
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
