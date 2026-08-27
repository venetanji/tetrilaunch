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
 * Salvage is awarded in TIER MILESTONES (see tierMilestoneSalvage): each of
 * the tier's TIER_CONTRACTS_REQUIRED first-clear Contracts and its Deep Run
 * win banks an equal share of the tier's award the moment it lands, and
 * completion pays only the rounding remainder while raising the Mark. The
 * PER-TIER TOTAL is unchanged from the 2026-08-08 completion-only reform —
 * milestones re-time the award, they don't grow it — so the tree still
 * cannot outrun the ladder. What the re-timing fixes is a deadlock that
 * reform shipped (found on device, 2026-08-09, sitting on 8 salvage against
 * a 15-salvage Reactor install): completion-only pay meant no salvage
 * without winning a run, but a stock Mark-1 rig has no installs, refit
 * stops refuse tier-0 tracks (run.ts's buyUpgrade), and the run is tuned to
 * need the economy track — the loop had no entry point. Now the natural
 * on-ramp works: clear a Contract, bank a share, install Reactor Output,
 * and fly a rig the refit stops can actually raise. A tier completes when
 * BOTH halves are done at that tier, exactly as before, and completion is
 * still the only thing that raises the Mark. Nothing here makes a future
 * run numerically stronger for free — every unlock either adds an OPTION (a
 * new modifier enters the draft pool, a new consumable exists) or
 * front-loads a choice you'd otherwise make later.
 */

import {
  budgetForMark, buyLoadoutTier, loadoutLegal, MARK_COUNT, newTiers, tiersCost, UPGRADES,
  type UpgradeId, type UpgradeTiers,
} from "./upgrades";

export { MARK_COUNT };

export interface UnlockDef {
  id: string;
  name: string;
  /** Salvage price. One-time; unlocks never stack. */
  cost: number;
  desc: string;
  /** Presentation/ordering band, and a rough promise about price and gating:
   *  1 is the on-ramp, 2 the build-shaping middle, 3 the Mark-gated capstones.
   *  Explicit rather than derived from cost or gates — the Workshop groups by
   *  it, and a derived band would silently re-group on any re-price. */
  rank: 1 | 2 | 3;
  /** Other unlock ids that must be owned first — the Workshop renders these
   *  as locked with the prerequisite named, rather than hiding them, so the
   *  player can see what they're working toward. */
  requires?: string[];
  /** Marks that must already have been BEATEN (meta.mark) to buy this.
   *
   *  This is the monetization invariant made structural, not a difficulty
   *  preference. Unlimited sells uncapped dailies, so every salvage source can
   *  in principle be ground; a Mark cannot — it is raised only by beating the
   *  previous one, and nothing purchasable may touch it (see MetaState.mark).
   *  Gating the top of the tree behind a Mark is therefore the one thing that
   *  guarantees no amount of Contract income finishes it, which is what keeps
   *  the subscription selling throughput instead of power. */
  requiresMark?: number;
  /** RETIRED: this unlock existed to put a card in the MODIFIER draft pool
   *  (mods.ts's draftOffers) — a system the hazard ratchet replaced, and one
   *  nothing in the app consumes any more. A retired unlock is never sold and
   *  never listed; a save that already owns one is refunded in full on load
   *  (refundRetiredUnlocks), because salvage spent on a card that changes
   *  nothing is a broken promise, not a purchase. The def itself stays so the
   *  refund can resolve its cost and old ids keep meaning something. */
  retired?: boolean;
}

/**
 * The unlock tree — two live options, and the retired mod-pool shelf.
 *
 * This list was mostly the MODIFIER list: eight of its ten entries sold the
 * right for a card to enter mods.ts's draft pool. The hazard ratchet replaced
 * that draft, nothing in the app imports mods.ts any more, and the Workshop
 * was still selling those eight as if they did something — a player could
 * spend real salvage on cards that changed nothing. They are `retired` now:
 * off the shelf, refunded on load if owned (refundRetiredUnlocks below).
 *
 * What survives is what the app actually consumes: Weather Survey (main.ts
 * reads it into the HUD's wind gauge) and Scrap Cache (startGame seeds the
 * run's scrap from it). Both are information/head-start OPTIONS rather than
 * stat bumps, which keeps the header's rule intact. The abilities the
 * retired cards used to gate live on as ship systems — INSTALLS below is
 * where Demolition and the Bond Emitter are actually bought.
 */
export const UNLOCKS: UnlockDef[] = [
  {
    id: "demo",
    name: "Demolition Licence",
    cost: 45,
    rank: 1,
    retired: true,
    desc: "Adds Demolition Charges to the draft pool: armed bombs that cost nothing to fire and refund funds for every cube they vaporize. Turns a dead junk pile into cash.",
  },
  {
    id: "bulk",
    name: "Bulk Freight Permit",
    cost: 55,
    rank: 1,
    retired: true,
    desc: "Adds Bulk Shipments to the draft pool: 5-cube pentominoes. Dense and rigid — they survive landings that shatter a tetromino, and their weight squares up the layers underneath.",
  },
  {
    id: "survey",
    name: "Weather Survey",
    cost: 60,
    rank: 1,
    desc: "The bay's prevailing wind is surveyed before you launch: the HUD gauge shows the bay's steady average alongside the live gust, so a headwind bay can be planned for instead of discovered.",
  },
  {
    id: "scrap-cache",
    name: "Scrap Cache",
    cost: 85,
    rank: 1,
    desc: "Every run starts with 30 scrap banked, so the first refit stop is a real decision instead of a window-shop.",
  },
  {
    id: "micro",
    name: "Micro Freight Licence",
    cost: 90,
    rank: 2,
    retired: true,
    desc: "Adds Micro Shipments to the draft pool: 2-cube dominoes at a heavy launch discount. Cheap volume and pinpoint placement — but too light for their own weight to square up the pile beneath them.",
  },
  {
    id: "sturdy",
    name: "Reinforced Bonds",
    cost: 110,
    rank: 2,
    retired: true,
    desc: "Adds Sturdy Shipments to the draft pool: pieces that survive landings which would shatter a tetromino. Clean if you aim well — and a liability when you needed them to break into fillers.",
  },
  {
    id: "overclock",
    name: "Press Overclock",
    cost: 140,
    rank: 2,
    retired: true,
    desc: "Adds Overclock to the draft pool: the compactor sweeps half again as fast, for twenty seconds off the clock. More presses per bay, and less time to think between them.",
  },
  {
    id: "short-lines",
    name: "Line Recalibration",
    cost: 150,
    rank: 2,
    retired: true,
    desc: "Adds Short Lines to the draft pool: one cell fewer per line, at lower pay per line. Turns a target you cannot reach into one you can, and a good bay into a cheaper one.",
  },
  {
    id: "bond-breaker",
    name: "Bond Breaker Rig",
    cost: 320,
    rank: 3,
    retired: true,
    requiresMark: 2,
    desc: "Bond Breakers shatter every joint on the field into loose cubes, which settle flatter and pack into lines far more easily — the answer to a pile that has stopped cooperating. Charges are a RUN-LONG consumable, not a per-bay refill: fit the Bond Emitter to carry them, and spend them on the bay that needs one most.",
  },
  {
    id: "auto",
    name: "Autoloader Rig",
    cost: 360,
    rank: 3,
    retired: true,
    requires: ["demo", "micro"],
    requiresMark: 3,
    desc: "Adds the Autoloader to the draft pool — the endgame of the micro build. The cannon fires itself, fast and roughly aimed, at half cost. You will need Bond Breakers to flatten what it makes.",
  },
];

export function unlockById(id: string): UnlockDef | undefined {
  return UNLOCKS.find((u) => u.id === id);
}

/**
 * True when `def` can be bought right now, ignoring price: every prerequisite
 * owned, and the required Mark already beaten.
 *
 * `mark` defaults to a value above the ladder so callers that predate Mark
 * gating (and headless ones that don't model meta at all) keep their old
 * meaning — prerequisite-only — rather than silently reporting everything as
 * locked.
 */
export function unlockAvailable(
  def: UnlockDef,
  owned: string[],
  mark = MARK_COUNT,
): boolean {
  if (def.requiresMark !== undefined && mark < def.requiresMark) return false;
  return (def.requires ?? []).every((r) => owned.includes(r));
}

/** Why `def` can't be bought yet, as display-ready fragments ("Mark 3",
 *  "Demolition Licence"), or empty when it is available. One function so the
 *  Workshop's locked copy can never describe a different gate than
 *  `unlockAvailable` actually enforces. */
export function unlockGates(def: UnlockDef, owned: string[], mark: number): string[] {
  const gates: string[] = [];
  if (def.requiresMark !== undefined && mark < def.requiresMark) {
    // Rendered in TIER numbering (B8: "Mark" is internal vocabulary, never
    // shown). requiresMark counts Marks BEATEN; the tier being flown is
    // mark + 1, so "reach Tier N+1" is satisfied exactly when Mark N falls.
    gates.push(`Tier ${def.requiresMark + 1}`);
  }
  for (const r of def.requires ?? []) {
    if (!owned.includes(r)) gates.push(unlockById(r)?.name ?? r);
  }
  return gates;
}

/**
 * Refund every RETIRED unlock a save still owns — full price back, id removed.
 * Pure and idempotent: once the refunded meta is saved no retired id remains,
 * and a save that owns none passes through untouched (same object, no churn).
 * Called on load (lib/store's loadMeta), which is the one door every save
 * walks through.
 */
export function refundRetiredUnlocks(meta: MetaState): MetaState {
  const owned = UNLOCKS.filter((u) => u.retired && meta.unlocks.includes(u.id));
  if (!owned.length) return meta;
  return {
    ...meta,
    salvage: meta.salvage + owned.reduce((sum, u) => sum + u.cost, 0),
    unlocks: meta.unlocks.filter((id) => !owned.some((u) => u.id === id)),
  };
}

/**
 * INSTALLS — what salvage actually buys.
 *
 * An install grants tier 1 of a ship system, permanently, in every run. It does
 * NOT grant unbounded power: the purchase is charged against the Mark's build
 * budget (see buyInstall), so salvage buys WHICH systems exist to spend budget
 * on while the Mark caps HOW MUCH can be spent at all. That is DESIGN.md's
 * load-bearing rule — "Contracts unlock what you may spend it on. Only beating
 * Mark N raises the budget" — and it is what keeps uncapped Contract income
 * from buying a permanently stronger rig.
 *
 * This is the answer to the thing an unlock could never do. An unlock puts a
 * modifier in the DRAFT POOL; owning it and being offered it are different
 * events, and simulated at two draft slots the demolition card reaches the
 * table by bay 2 in only 39% of runs — while slag, the material it answers,
 * lands from bay 4. An install is held, not dealt.
 *
 * Name and description are read from the track itself (upgradeById), so a
 * system's copy lives in exactly one place.
 */
export interface InstallDef {
  id: UpgradeId;
  /** Salvage price, charged per rung. The Workshop sells tier 1 (the install)
   *  and tier 2 (the uprate) at this same number — see uprateCost — while
   *  tier 3 stays the refit stop's scrap. */
  cost: number;
  /** Marks that must already have been BEATEN — the spec ladder's Mark minus
   *  one, since `meta.mark` counts clears rather than the Mark being flown.
   *  Same invariant as UnlockDef's field: a Mark is the one thing no amount of
   *  salvage can buy. */
  requiresMark?: number;
}

export const INSTALLS: InstallDef[] = [
  // PRICES, re-derived. The old comment here justified them against "three
  // tier-1 Contracts pay 18" — which has not been true for some time: a tier's
  // three contracts pay 45 (three 15-salvage milestones), so every price below
  // was set against an income two and a half times smaller than the one that
  // actually arrives. That, plus the retired-unlock hole above, is the surplus.
  //
  // The two ENTRY systems stay at 15 and are not negotiable: 15 is one
  // milestone, so a player's first cleared Contract buys their first system.
  // That is the on-ramp, and it is the thing the 2026-08-09 deadlock proved
  // the economy cannot do without.
  //
  // Everything past the on-ramp is priced against the day it takes to earn:
  // 30 is most of a tier's contracts, 50 is a tier, 70 is a tier plus its run
  // win. The shelf now totals 495 — these eight installs at 350, plus the two
  // live unlocks below (Weather Survey 60, Scrap Cache 85) — against 600 of
  // income: slack enough to make a wrong purchase survivable, tight enough
  // that the choice is a choice.
  //
  // THE EIGHTH IS THE ONE THAT HAD TO ARGUE FOR ITS PRICE, and the counter
  // proposal put the question this way: two more installs at 70 each is 585
  // against 600, which closes the slack to nothing. One shipped, not two, and
  // it is priced a band BELOW the two systems it sits beside rather than with
  // them. The band is what the system is: Bond Emitter and Demolition Rack are
  // 70 because they answer every build — an emitter flattens any pile, a rack
  // is the only exit for dead cargo of any kind. The Thaw Lance answers ONE
  // axis, and the measurement says so at both ends: it lands exactly on a
  // clean bay's win rate for one notch of cryo, and it buys back two wins in
  // twenty-four at three (upgrades.ts's THAW_CHARGES_PER_TIER has the tables).
  // A counter with a measured ceiling is worth a tier of Contracts, not a tier
  // plus its run win — so 50, beside Bay Extension and Press Hydraulics, and
  // the shelf keeps 105 salvage of slack instead of 15.
  { id: "reactor", cost: 15 },
  { id: "launcher", cost: 15 },
  { id: "magazine", cost: 30 },
  { id: "bay", cost: 50, requiresMark: 1 },
  { id: "hydraulics", cost: 50, requiresMark: 1 },
  { id: "bonds", cost: 70, requiresMark: 2 },
  // The spec's ladder puts Demolition at Mark 4 — but that pairing only works
  // once materials MOVE to the hazard draft in phase 3. Phase 1 leaves
  // MATERIAL_SCHEDULE alone, where slag already appears from Mark 2 (i.e. one
  // Mark beaten). Gating its only clean answer at 3 would ship a counter two
  // Marks behind its hazard, which is strictly worse than today. Raise this to
  // 3 in the same change that moves materials off the schedule.
  { id: "demolition", cost: 70, requiresMark: 1 },
  // GATED AT THE MARK CRYO ARRIVES, not one behind it. hazards.ts opens the
  // cryo axis at Mark 4, and `requiresMark` counts Marks BEATEN — so 3 means
  // the lance is on the shelf for exactly the player who is flying the first
  // Mark that can deal them a frozen belt. The Demolition entry above records
  // what the other choice costs: a counter shipped two Marks behind its hazard
  // is "strictly worse than today", and the winnability sweep localised the
  // damage cryo does to the rung where MATERIAL_DRAFT_BAYS stops being
  // dodgeable (Mark 5). Buyable at 4, forced at 5 — the shop opens one Mark
  // before the bay that makes it mandatory, which is the pattern
  // MATERIAL_DRAFT_BAYS itself is built on ("meet the problem, play a bay
  // against it, walk into the shop that answers it").
  { id: "thaw", cost: 50, requiresMark: 3 },
  // THE NINTH, and it is priced a band ABOVE the eighth for a measured reason
  // rather than because it arrived later. The band is what the system is: 70 is
  // "answers every build" (Bond Emitter, Demolition Rack) and 50 is "answers
  // one axis with a measured ceiling" (the Thaw Lance above). The cushion
  // answers TWO — it is volatile's counter, and because its subject is the
  // speed cargo arrives at, it is also the only thing on the shelf that helps
  // a bay full of crosswind, where a blown shipment lands hard and sets off
  // whatever it hits. upgrades.ts's CUSHION_TIERS carries both tables. Two
  // axes for one purchase is the 70 band's own definition read honestly, and
  // the alternative — pricing it at 50 beside a strictly narrower system —
  // would make the shelf's bands mean nothing.
  //
  // The shelf now totals 565 against 600 of tier income, i.e. 35 of slack
  // where the lance left 105. That is the tightest this shelf has been and it
  // is the reason this is the LAST install the roster can absorb at these
  // prices: a tenth system needs either a re-priced shelf or a second income,
  // and the note above ("slack enough to make a wrong purchase survivable")
  // is the line it would cross.
  //
  // TWO CORRECTIONS, made when the tenth arrived and had to argue against this
  // paragraph. The 565 was arithmetic on a price that changed: the nine installs
  // come to 400 and the two live unlocks (Weather Survey 60, Scrap Cache 85) to
  // 145, so the shelf was 545 and the slack 55, not 35. Everything the sentence
  // concludes still stands at the true number — 55 of slack on 600 is tight —
  // and it is left in place rather than quietly restated, because the paragraph
  // below is the answer it demanded.
  { id: "cushion", cost: 50, requiresMark: 6 },
  // THE TENTH, and the note directly above is the bar it had to clear: a tenth
  // system needs "either a re-priced shelf or a second income". It gets
  // neither. What it gets is the BAND BELOW the ones every argument on this
  // shelf has been about, and the band is — as always here — what the system
  // is:
  //
  //   70  answers every build (Bond Emitter, Demolition Rack)
  //   50  answers one axis, with a measured ceiling (Thaw Lance, Impact Cushion)
  //   30  answers no axis at all (Loader Magazine, and now this)
  //
  // The Incinerator does not remove a hazard, soften one, or open a slot. It
  // discounts a BILL — the spill fine and the detonation charge, for cargo
  // destroyed above the plant's roofline (chute.ts's INCINERATOR_Y) — and a
  // bill is only ever met by a player who is already losing cargo. That makes
  // its ceiling the weakest guarantee on the shelf, and the harness put a
  // number on exactly how weak: with a pilot that never aims into the hood,
  // NOTHING in a Tier-10 bay dies above the roofline, so the hood is worth
  // literally zero (design/balance/winnability-sweep-findings.md). A system
  // whose floor is nothing and whose value is entirely the player's to earn is
  // a 30, and pricing it beside the two 50s — both of which do something the
  // moment they are bolted on — would make the shelf's bands mean nothing.
  //
  // That puts the shelf at 575 against 600. 25 of slack is less than the 55 the
  // cushion left and it is the honest floor of the note above: this is the last
  // system that fits, at any band, and the eleventh needs the re-price or the
  // second income that note asked for.
  //
  // GATED AT THE TIER THE WRITE-OFF BECOMES COMPULSORY, on the same rule the
  // lance's gate states: hazards.ts's MATERIAL_DRAFT_BAYS is merely OFFERED at
  // Mark 4 and FORCED from Mark 5, so `requiresMark: 4` puts the hood on the
  // shelf for exactly the player flying the first tier that can hand them cargo
  // they have no choice but to write off. Buyable at 5, and the axis that makes
  // it necessary is unavoidable at 5.
  { id: "incinerator", cost: 30, requiresMark: 4 },
];

export function installById(id: string): InstallDef | undefined {
  return INSTALLS.find((i) => i.id === id);
}

/**
 * How far the WORKSHOP can raise a track. Tier 3 stays exclusive to in-run
 * scrap at a refit stop.
 *
 * The cap is what keeps two systems from collapsing into one. Salvage buys the
 * rig you START with; scrap buys the rig you BUILD during a run; and if the
 * Workshop could sell tier 3 there would be nothing left for the refit stop to
 * offer a maxed player, which is a screen the run visits three times.
 */
export const UPRATE_MAX_TIER = 2;

/** What raising `id` from its current tier costs in salvage.
 *
 *  The same number as the install, at every rung. Not a discount and not an
 *  escalator: an install and an uprate are the same purchase — a permanent
 *  tier of a permanent system — and the thing that makes one harder to afford
 *  than the other is the build budget, not a second price table nobody can see.
 *  It also keeps the arithmetic checkable by hand: the shelf is exactly twice
 *  the installs (350 -> 700) plus the two live unlocks. */
export function uprateCost(def: InstallDef): number {
  return def.cost;
}

/** True when `def` can be bought right now: its Mark is beaten, the Workshop
 *  can still raise it, and the next tier fits the Mark's build budget.
 *  Deliberately does NOT check salvage — the Workshop renders a card the player
 *  simply can't afford yet as a disabled price button, which reads differently
 *  from a gated one.
 *
 *  This used to reject any track already owned, and that one line is what made
 *  the build budget inert. `budgetForMark` runs 88 -> 880, but a loadout capped
 *  at tier 1 of eight tracks tops out at 160 points — under budgetForMark(2) —
 *  so the budget bound at Mark 1 and never again, and the rest of Mark 10's
 *  allowance could not be spent by any sequence of purchases. DESIGN.md's arc
 *  "from you can afford one system to you can afford everything" ended at Mark
 *  2. Selling tier 2 restores it: eight tracks at tier 2 is 8 x 55 = 440 points
 *  = exactly budgetForMark(5), so the gate is real for Marks 1 through 5.
 *
 *  THAT EQUALITY IS NOT A COINCIDENCE AND DOES NOT NEED RE-DERIVING when a
 *  track is added — which is worth stating, because adding the eighth (the Thaw
 *  Lance) moved every number in the paragraph above and not the conclusion. The
 *  Workshop ceiling is TRACKS x (20+35) and the budget is TRACKS x 110 x M/10,
 *  so the two meet at M = 10 x 55/110 = 5 for ANY roster size. Grow the shelf
 *  and the gate still binds through Mark 5, exactly. */
export function installAvailable(meta: MetaState, def: InstallDef): boolean {
  if (def.requiresMark !== undefined && meta.mark < def.requiresMark) return false;
  if ((meta.loadout[def.id] ?? 0) >= UPRATE_MAX_TIER) return false;
  return buyLoadoutTier(meta.loadout, def.id, markUnlocked(meta)) !== null;
}

/** Why `def` is unavailable, as display strings. Derived from the same
 *  conditions installAvailable enforces, so the Workshop's locked copy can
 *  never describe a gate the purchase path does not actually apply.
 *
 *  Both reasons can be true at once and both are shown, with the budget one
 *  carrying its numbers: at a low Mark the two are usually the same wall seen
 *  from different sides, and "Mark 2 · build budget 60/77" is the sentence that
 *  actually explains why a player holding 400 salvage is being refused. */
export function installGates(meta: MetaState, def: InstallDef): string[] {
  const out: string[] = [];
  if (def.requiresMark !== undefined && meta.mark < def.requiresMark) {
    // Tier numbering, same off-by-one as unlockGates: the gate names the tier
    // the player has to REACH, which is the Mark to beat plus one.
    out.push(`Tier ${def.requiresMark + 1}`);
  }
  // The budget gate applies to an UPRATE as much as to a first install — it is
  // the rung that does not fit, whichever rung it is — so this asks the same
  // question installAvailable does rather than only asking it of tier 0.
  if ((meta.loadout[def.id] ?? 0) < UPRATE_MAX_TIER &&
      buyLoadoutTier(meta.loadout, def.id, markUnlocked(meta)) === null) {
    out.push(`build budget ${tiersCost(meta.loadout)}/${markBudget(meta)}`);
  }
  return out;
}

/**
 * Buy an install, or uprate one already owned: charge salvage and raise the
 * track one tier, up to UPRATE_MAX_TIER. Returns null when gated, already at
 * the Workshop's cap, unaffordable, or over budget. Never mutates.
 *
 * The budget charge goes through `buyLoadoutTier` rather than being re-derived
 * here, so the Workshop cannot be a second, laxer door into the same loadout
 * that `safeLoadout` validates on the way out.
 */
export function buyInstall(meta: MetaState, id: UpgradeId): MetaState | null {
  const def = installById(id);
  if (!def) return null;
  if (!installAvailable(meta, def)) return null;
  const cost = uprateCost(def);
  if (meta.salvage < cost) return null;
  // buyLoadoutTier is still the only thing that decides whether the purchase
  // FITS: it re-runs tiersCost against budgetForMark and returns null over
  // budget, so no salvage path can put a rig on the field that the Mark does
  // not pay for. That is the whole of "a Mark is won, never bought" — nothing
  // here touches meta.mark, and safeLoadout re-validates at run start.
  const loadout = buyLoadoutTier(meta.loadout, id, markUnlocked(meta));
  if (!loadout) return null;
  // A NEW system lands in the SHED when the rack is already full, and the
  // purchase still goes through. Both halves matter.
  //
  // Going through matters because a slot is not an ownership gate (see the
  // SYSTEM SLOTS header): refusing the sale would make the fifth install
  // unbuyable rather than unmounted, which is the trap that model was rejected
  // for. Landing in the shed matters because the alternative is
  // `mountedIds`'s slice quietly deciding which four of five fly — a rack that
  // silently drops the thing you just paid for. Stowed, the player is told
  // where it went and swaps it in themselves.
  //
  // Only a track going 0 -> 1 can be stowed by this: an UPRATE of something
  // already aboard leaves the shed exactly as it was.
  const isNewInstall = (meta.loadout[id] ?? 0) === 0;
  const rackFull = mountedIds(meta).length >= slotsFor(meta);
  const stowed = isNewInstall && rackFull && !(meta.stowed ?? []).includes(id)
    ? [...(meta.stowed ?? []), id]
    : (meta.stowed ?? []);
  return { ...meta, salvage: meta.salvage - cost, loadout, stowed };
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
   *  In-run scrap still refits on top of this at the usual stops.
   *
   *  What is OWNED. What is FLOWN is this masked to the rack — see safeLoadout
   *  and the SYSTEM SLOTS block above. */
  loadout: UpgradeTiers;
  /** Slots in the rack: how many owned systems a run may carry (SLOT_BASE up to
   *  SLOT_CAP, bought with salvage — see buySlot).
   *
   *  Read through `slotsFor` rather than directly, which is also what makes the
   *  field's ABSENCE meaningful: a save written before slots existed has no
   *  value here, and lib/store.ts's loadMeta grandfathers it to the number of
   *  systems that save already owns rather than to SLOT_BASE. Nobody's rig
   *  shrinks on the first launch after an update. */
  slots: number;
  /** Systems owned but left in the SHED — not aboard for the next run.
   *
   *  THE EXCLUSION, not the inclusion, and that choice is the whole migration:
   *  an empty shed means "fly everything you own", which is what every save
   *  written before this field existed did. A `mounted` list would have had to
   *  be back-filled for every save in the world, and any save it missed would
   *  have undocked with an empty rack. */
  stowed: UpgradeId[];
  /** Whether the CURRENT tier's Deep Run has been beaten (reset to false each
   *  time the Mark advances). One half of tier completion — see recordRunEnd. */
  tierRunDone: boolean;
  /** First-clear Contracts logged at the CURRENT tier (reset on advance). The
   *  other half of tier completion — see recordContractClear. */
  tierContracts: number;
  /** Contract ids already logged. A Contract counts ONCE, ever.
   *
   *  This is a monetization invariant, not a balance preference. Unlimited buys
   *  "the daily Contract cap lifted" (docs/DESIGN.md), so if every completion
   *  counted, the subscription would buy tier progress -> salvage -> stronger
   *  Deep Runs, which is the one thing it must never do. Counting each
   *  Contract once keeps the subscription buying throughput rather than power,
   *  and leaves replaying a cleared Contract as free practice. */
  claimedContracts: string[];
  /** Marks beaten in a single run with ZERO bay retries — the seal, drawn on
   *  that floor of the tower.
   *
   *  A list rather than a flag because `mark` is a high-water number and the
   *  tower draws every floor: each one needs its own answer, and a player who
   *  sealed Mark 3 keeps that after Mark 4 falls messily.
   *
   *  IT PAYS NOTHING, and that has not changed. The seal must never feed
   *  salvage, a loadout budget or `mark` — docs/DESIGN.md's mode table prints
   *  "Purchasable power: none" for both modes, and a seal that paid out would
   *  be a second progression axis wearing a badge. What it now decides is
   *  ACCESS to one mode and nothing else (skydeckOpen below): the Skydeck is
   *  the game's only permanent, unrefittable, un-retryable run, so the thing
   *  that opens it is the record that says you can fly one. The sim guards the
   *  payout rule with an explicit check rather than trusting anyone to read
   *  this paragraph. */
  sealedMarks: number[];
  /** The highest Mark whose UNLOCK has already been celebrated on the home
   *  screen — the tower's ceremonial ride to the newly opened floor (main.ts's
   *  armUnlockCelebration, screens.ts's TowerState.celebrate).
   *
   *  A HIGH-WATER NUMBER rather than a flag, and it is deliberately the SAME
   *  shape as `mark`, because the question the menu asks is a comparison
   *  between the two: the ladder has moved somewhere the ceremony has not
   *  followed yet exactly when `mark > celebratedMark`. That derivation is what
   *  makes the celebration fire once per unlock without either of the two
   *  events that can cause one — a Contract clear, a won Deep Run — having to
   *  know the home screen exists. Both already persist `mark`; the menu reads
   *  the difference on its way in, whenever that happens to be.
   *
   *  Equal to `mark` on a fresh save (both 0), which is what keeps a new
   *  player's Tier 1 quiet: Tier 1 is where everyone starts, it was never
   *  unlocked, and a ceremony for it would celebrate opening the front door.
   *  A save written before this field existed migrates to `mark` rather than to
   *  0 (lib/store.ts's loadMeta) — those tiers were unlocked and lived through
   *  long ago, and replaying nine ceremonies at once on the first launch after
   *  an update would be a bug wearing a party hat. */
  celebratedMark: number;
  /** The player has been told, once, that retrying a bay breaks the run's seal
   *  — and that the tier still opens anyway.
   *
   *  A WATERMARK, the same shape and for the same reason as celebratedMark
   *  above: the thing being remembered is "this has been said", and the surface
   *  that says it (main.ts's seal-break notice) must be able to answer "is it
   *  owed" from the save alone, without the three doors into a bay retry — the
   *  pause modal, the held pause button, the game-over card — each keeping
   *  their own copy of the answer.
   *
   *  FALSE on a fresh save, and false on a save written before the field
   *  existed, which is the opposite of celebratedMark's migration and is
   *  deliberate. A returning player has never seen this message; showing it
   *  once on their next bay retry is the whole point, and it costs them one
   *  panel. celebratedMark migrates the other way because replaying a ceremony
   *  per tier is nine panels for something that already happened. */
  sealBreakSeen: boolean;
  /** The Skydeck's own opening has been celebrated (main.ts's tower ride).
   *
   *  A SECOND watermark rather than a value folded into celebratedMark,
   *  because the roof no longer opens on the same event the ladder does. It
   *  used to: beating Mark 10 was the last unlock, so `mark > celebratedMark`
   *  covered the roof as well, and armUnlockCelebration simply redirected that
   *  one ride upward. Now the roof opens on the last SEAL (skydeckOpen), which
   *  can land many runs after the Mark did — or, for a save that already holds
   *  every seal, on the first launch after this build. Those are two different
   *  events on two different axes, and one number cannot remember both. */
  skydeckCelebrated: boolean;
}

export function newMeta(): MetaState {
  return {
    salvage: 0, unlocks: [], runs: 0, bestBay: 0, mark: 0,
    tierRunDone: false, tierContracts: 0,
    loadout: newTiers(), slots: SLOT_BASE, stowed: [],
    claimedContracts: [], sealedMarks: [],
    celebratedMark: 0, sealBreakSeen: false, skydeckCelebrated: false,
  };
}

/* -------------------------------------------------------------------------
 * THE SEAL, AND WHAT IT NOW OPENS.
 *
 * A Mark is SEALED by a run that was won, tracked the ladder (run.ts's
 * tracksLadder — never Tier S, never the Skydeck) and retried no bay. That
 * rule is recordRunEnd's and is unchanged; what changed is that the seals are
 * now the Skydeck's key rather than a stamp on a plate.
 *
 * WHY THE ROOF ASKS FOR THEM. The Skydeck is the one run in the game with no
 * yard, no chosen difficulty and no second chance (skydeck.ts) — everyone flies
 * the same day's rules and the board ranks the flying. "You beat the ladder"
 * was the wrong ticket for that door, because the ladder can be beaten with a
 * retry on every bay: a player could hold the roof's key without ever having
 * flown a bay they could not restart. A full set of seals is the same ten bays
 * again with the retry taken away, which is exactly the thing the roof is going
 * to ask for on the day.
 *
 * IT PAYS NOTHING STILL. Access is not power: the Skydeck banks no salvage,
 * ticks no tier and raises no Mark (run.ts's tracksLadder), so a seal remains
 * unable to make any future run numerically stronger. sim/systems.ts pins that.
 * ---------------------------------------------------------------------- */

/** Marks the player has NOT sealed, low to high — what the roof is still
 *  waiting for, and what the tower draws an empty socket on.
 *
 *  Derived from the ladder's length rather than from the save, so a build that
 *  lengthens the ladder asks for the new floors' seals without anyone
 *  remembering this function exists. */
export function unsealedMarks(meta: MetaState): number[] {
  return Array.from({ length: MARK_COUNT }, (_, i) => i + 1)
    .filter((m) => !meta.sealedMarks.includes(m));
}

/**
 * Is the Skydeck open?
 *
 * TWO CONDITIONS, and the second is not redundant. Every seal implies a win at
 * that Mark, so a full set very nearly implies a beaten ladder — but not
 * quite: a Mark-10 win seals Mark 10 the moment it lands, while `mark` only
 * reaches MARK_COUNT once that tier's Contracts land too (advanceTier). A
 * player sitting on ten seals and two owed Contracts has not finished the
 * ladder, and the mode's whole premise ("the floor above the ladder") says the
 * ladder comes first. The ladder half is also what markUnlocked's saturation
 * depends on — finishRun's Skydeck gate is argued on the roof only being
 * reachable from the top of the ladder — so keeping it stated here keeps that
 * argument true by construction rather than by coincidence.
 */
export function skydeckOpen(meta: MetaState): boolean {
  return meta.mark >= MARK_COUNT && unsealedMarks(meta).length === 0;
}

/** True while the seal-break notice is still owed — the one-time panel that
 *  says a retry costs the seal and not the tier. Asked at every door into a
 *  bay retry, answered from the save, so no screen keeps its own copy. */
export function sealBreakOwed(meta: MetaState): boolean {
  return !meta.sealBreakSeen;
}

/**
 * The tier a run at `runMark` can still OPEN, or null when it can open none.
 *
 * The seal-break notice's second sentence is a promise — "Tier N still opens" —
 * and a promise has to be true of the run in front of the player, not of their
 * high-water mark. It first read `tierProgressFor(meta).tier`, which is
 * markUnlocked: on a re-fly of Mark 3 by a player who has reached Mark 10 that
 * printed "Tier 10 still opens" about a run that cannot move Tier 10 or
 * anything else. (Found in review, codex PR #134.)
 *
 * TWO CONDITIONS, because there are two ways for a run to have no tier to open.
 *
 *  - **It is not the frontier.** recordRunEnd's tier bookkeeping is gated on
 *    `runMark === markUnlocked(meta)`, so a re-fly of an already-beaten Mark
 *    ticks nothing by construction. The predicate is written against that same
 *    comparison rather than beside it, so the copy cannot promise something the
 *    recorder refuses.
 *  - **The ladder is finished.** At `mark === MARK_COUNT` markUnlocked
 *    saturates, so a Mark-10 run passes the frontier test — but there is no
 *    Tier 11 for it to open, and naming Tier 10 would name a floor that is
 *    already open. Such a run still banks salvage, which is what the notice's
 *    fallback sentence says instead.
 *
 * Returning the TIER rather than a boolean so the caller has nothing left to
 * derive: null is "say the fallback", a number is "name this one".
 */
export function tierOpenableBy(meta: MetaState, runMark: number): number | null {
  if (meta.mark >= MARK_COUNT) return null;
  const tier = markUnlocked(meta);
  return runMark === tier ? tier : null;
}

/**
 * The floor that COMPLETING `tier` opens, or null when it opens none.
 *
 * A tier completion has always been reported by naming the floor it opened,
 * and every screen derived that name the same way: read `markUnlocked` after
 * the update and print it. Nine times out of ten that is right, because
 * completing tier N leaves markUnlocked at N+1. On the tenth it is a lie —
 * markUnlocked SATURATES at MARK_COUNT, so completing the last tier printed
 * "Tier 10 is open" about the floor the player had just spent the tier flying,
 * while nothing on the menu changed. An owner reported exactly that shape
 * ("all completed but not unlocked") from a save sitting at mark 10.
 *
 * This is the THIRD site of one question. #134 answered it for the seal-break
 * notice (tierOpenableBy) and for the ceremony (pendingLadderRide); the two
 * end cards were still asking it in arithmetic of their own. So it is a
 * function now, of the completed tier alone — no meta, no snapshot that has
 * already moved — and a fourth site can only get the answer by asking here.
 *
 * Null is a real answer, not an error: the last rung has no successor, and the
 * card's job at that point is to say the ladder is finished rather than to
 * invent a floor to name.
 */
export function tierOpenedByCompleting(tier: number): number | null {
  return tier < MARK_COUNT ? tier + 1 : null;
}

/**
 * Does the ladder owe the tower a RIDE — a floor that was not flyable before?
 *
 * `pendingUnlockMark` answers a different question: whether the Mark has moved
 * somewhere the ceremony has not followed. Below saturation the two agree,
 * because every Mark that moves opens `mark + 1`. At the top they come apart,
 * and that gap was a bug: completing Tier 10 leaves `mark > celebratedMark`
 * with markUnlocked already sitting at MARK_COUNT, so the ceremony armed a
 * ~4.5s ride to the floor the car was already parked on and the player was
 * already allowed to fly. (Found in review, codex PR #134.)
 *
 * The roof is deliberately NOT part of this. It opens on the seals now
 * (pendingSkydeck), which is a different axis and a different watermark;
 * main.ts asks both and either one arms the same ride.
 */
export function pendingLadderRide(meta: MetaState): boolean {
  return pendingUnlockMark(meta) !== null && meta.mark < MARK_COUNT;
}

/** Burn the seal-break watermark. Idempotent, so the three doors can each call
 *  it without checking first. */
export function sealBreakShown(meta: MetaState): MetaState {
  return meta.sealBreakSeen ? meta : { ...meta, sealBreakSeen: true };
}

/** True when the roof has opened and the car has not yet ridden to it —
 *  pendingUnlockMark's twin, on the seal axis. */
export function pendingSkydeck(meta: MetaState): boolean {
  return skydeckOpen(meta) && !meta.skydeckCelebrated;
}

/** Burn the roof's ceremony watermark. Idempotent, same as the Mark's. */
export function skydeckCelebrated(meta: MetaState): MetaState {
  return meta.skydeckCelebrated ? meta : { ...meta, skydeckCelebrated: true };
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

/* -------------------------------------------------------------------------
 * SYSTEM SLOTS — how many of the systems you own can be ABOARD at once.
 *
 * The roster is ten systems and the Workshop will eventually sell all of them.
 * Owning ten and flying ten are now different things: the rack has a fixed
 * number of slots, salvage buys more, and which systems occupy the ones you
 * have is a decision made before every run.
 *
 * WHY THE SLOT GATES THE LOADOUT AND NOT THE PURCHASE. The owner's ask —
 * "limit the amounts of systems a rig can have and pay salvage to get more
 * system slots" — reads two ways, and only one of them is a decision.
 *
 *  - GATING OWNERSHIP (the Workshop refuses an eleventh purchase) makes every
 *    install irreversible and unbuyable-back. A player who bought the Thaw
 *    Lance before meeting a volatile tier would be locked out of the Impact
 *    Cushion by a purchase made three tiers earlier with no way to know. That
 *    is not an identity, it is a trap; and it duplicates the build budget's
 *    job — capping how strong a rig may be — at the one layer DESIGN.md says
 *    salvage must never touch ("Contracts unlock what you may spend it on.
 *    Only beating Mark N raises the budget").
 *  - GATING THE LOADOUT costs nothing already paid for. Everything you own
 *    stays owned; what a slot rations is how many answers you can carry INTO
 *    one run. Choosing four of ten before a cryo-heavy tier is a real decision
 *    with a real cost and no permanent loser, and it is where "rigs that can
 *    have certain systems and not others" starts.
 *
 * SLOTS CANNOT OUTRUN THE MARK, which is the invariant that makes them safe to
 * sell for a grindable currency. A mounted rig is a SUBSET of the owned one, so
 * `tiersCost(mounted) <= tiersCost(owned) <= budgetForMark(mark)` by
 * construction: a slot can only ever move a rig back UP toward the ceiling the
 * Mark already granted, never past it. Salvage still buys which systems exist
 * to spend budget on; the Mark still caps how much can be spent at all.
 *
 * WHAT A SLOT IS WORTH, and why the ladder is priced the way it is, is
 * `SLOT_PRICES`. What a slot COSTS in bays is measured, not asserted — see
 * design/balance/system-slots.md.
 * ---------------------------------------------------------------------- */

/**
 * Slots a rig starts with.
 *
 * MEASURED, at the width where the ladder is still survivable and the choice is
 * already real (design/balance/system-slots.md §2). The short version: four is
 * the narrowest rack that reaches bay 10 at every Tier measured, and it is one
 * narrower than the rig every existing balance table in design/balance/ was
 * flown on — `builds.ts`'s priority orders run five to seven tracks, so the
 * record this design has to not break is itself a five-slot record.
 *
 * It is also the width at which the mount decision first BITES rather than
 * being free: the Workshop's ceiling is `slots x 55` ladder points against a
 * budget of `110 x mark`, so a four-slot rack spends its whole allowance
 * through Mark 2 and starts leaving points on the table at Mark 3 — which is
 * exactly the tier where the shelf first has more systems on it than a new
 * player has salvage for.
 */
export const SLOT_BASE = 4;

/**
 * The widest rack there is.
 *
 * Ten because the roster is ten and the owner's standing ruling is that "for
 * now we leave the endgame to max out all the systems" — the last slot has to
 * be able to hold the last system. It is ALSO the widest rack the device matrix
 * fits: app.css's compact clamp records that ten plates at 19px against an
 * iPhone 13 mini's 209px "ends the clamp… there is no growth left in it".
 *
 * Those two facts are equal today and are not the same fact, which is the whole
 * point of stating both. When an eleventh system lands, the roster grows and
 * this does not: the rack stays ten slots wide, the eleventh system competes
 * for one of them, and that is the "different rack" PR #156 asked for — the
 * rack is sized by the RIG, not by the catalogue. Nothing here needs to change
 * for that to happen, which is why nothing pins the two together.
 */
export const SLOT_CAP = 10;

/**
 * What the 5th, 6th … SLOT_CAP-th slot costs in salvage.
 *
 * PRICED IN THE SHELF'S OWN CURRENCY, which INSTALLS states as days: "30 is
 * most of a tier's contracts, 50 is a tier, 70 is a tier plus its run win". A
 * tier pays 60 (TIER_SALVAGE_BASE), so the ladder below reads
 *
 *   50   a tier                 the fifth slot
 *   70   a tier and its win     the sixth
 *   100  most of two tiers      the seventh
 *   140  more than two          the eighth
 *   180  three                  the ninth
 *   240  four                   the tenth
 *
 * ESCALATING, because each slot is worth less than the one before it and a flat
 * price would be a worse deal every rung. The measurement says so in bays:
 * widening a rack from 4 to 6 is worth about as much as widening it from 6 to
 * 10 (design/balance/system-slots.md §3), so the back half of the ladder has to
 * charge more for less or the last slots would be the obvious buy.
 *
 * 780 IN TOTAL, AGAINST 600 OF LADDER INCOME, and that inequality is the
 * feature rather than an oversight. The ten-tier ladder pays 600 once; the
 * shelf it has to cover is already 575 (INSTALLS' own arithmetic), which left
 * "25 of slack… the eleventh needs the re-price or the second income that note
 * asked for". This is the second income's other half: a full rack is NOT
 * affordable inside one climb of the ladder, and it is not meant to be. It is
 * what the endgame faucet — a finished ladder still paying 60 a cycle for three
 * Contracts and a run win (advanceTier at MARK_COUNT) — finally has to buy.
 * Thirteen cycles for the whole thing, and the first two slots inside the climb.
 */
export const SLOT_PRICES: readonly number[] = [50, 70, 100, 140, 180, 240];

/** Slots the save actually has, clamped. Read through this rather than off the
 *  field: `meta.slots` round-trips through localStorage like everything else
 *  here, and a rack of -3 or of 40 must read as a rack. */
export function slotsFor(meta: MetaState): number {
  const n = Number.isFinite(meta.slots) ? Math.floor(meta.slots) : SLOT_BASE;
  return Math.max(SLOT_BASE, Math.min(SLOT_CAP, n));
}

/** Salvage price of the NEXT slot for a rig that has `slots`, or null at the
 *  cap. Indexed off SLOT_BASE so the ladder is stated once and a re-based rack
 *  cannot silently re-price it. */
export function slotPrice(slots: number): number | null {
  const i = Math.max(SLOT_BASE, Math.min(SLOT_CAP, Math.floor(slots))) - SLOT_BASE;
  return i < SLOT_PRICES.length ? SLOT_PRICES[i] : null;
}

/** Buy one more slot. Null when the rack is already at the cap or the salvage
 *  is short. Never mutates.
 *
 *  Deliberately UNGATED by Mark, unlike every install past the on-ramp. A slot
 *  grants no power on its own — it is room for a system the player has already
 *  bought against the Mark's own budget — so gating it would be gating the
 *  same purchase twice. The monetization invariant survives because of the
 *  subset argument in the header: a wider rack cannot fly a rig the Mark has
 *  not already paid for. */
export function buySlot(meta: MetaState): MetaState | null {
  const price = slotPrice(slotsFor(meta));
  if (price === null || meta.salvage < price) return null;
  return { ...meta, salvage: meta.salvage - price, slots: slotsFor(meta) + 1 };
}

/** Every system the player OWNS, in rack order (UPGRADES). */
export function ownedTracks(meta: MetaState): UpgradeId[] {
  return UPGRADES.filter((u) => (meta.loadout[u.id] ?? 0) > 0).map((u) => u.id);
}

/**
 * The systems actually ABOARD — what a run flies and what the rack draws.
 *
 * Owned, minus whatever is in the shed, capped at the slot count. The cap is a
 * `slice` rather than a validation error on purpose: `stowed` round-trips
 * through localStorage, so "owned six, stowed none, four slots" is a state a
 * hand-edited save can reach and a state an OLD BUILD's save reaches honestly.
 * Both have to fly something sensible, and rack order is the one answer that is
 * the same on every device and every load.
 *
 * Kept ordered by UPGRADES rather than by when the player mounted them, for the
 * reason shipPlatesHTML gives for fixed slots: "a readout whose items move is
 * one the eye has to re-find rather than glance at".
 */
export function mountedIds(meta: MetaState): UpgradeId[] {
  const shed = new Set(meta.stowed ?? []);
  return ownedTracks(meta).filter((id) => !shed.has(id)).slice(0, slotsFor(meta));
}

/** Owned but not aboard — the shed. Derived from mountedIds rather than from
 *  `stowed` directly, so a system the slice dropped reads as stowed on every
 *  surface instead of appearing owned-and-flying on one and missing on another. */
export function stowedIds(meta: MetaState): UpgradeId[] {
  const aboard = new Set(mountedIds(meta));
  return ownedTracks(meta).filter((id) => !aboard.has(id));
}

/** True when `id` is aboard. */
export function isMounted(meta: MetaState, id: UpgradeId): boolean {
  return mountedIds(meta).includes(id);
}

/**
 * Move one owned system between the rack and the shed.
 *
 * Returns null when the move is impossible: the system is not owned, or the
 * rack is full and this would be an eleventh thing in ten slots. A FULL RACK
 * REFUSES rather than evicting something to make room — the evicted system
 * would be chosen by this function and not by the player, which is the one
 * thing a loadout screen must never do.
 *
 * `stowed` is written as the EXCLUSION rather than the inclusion, and that is
 * what makes this feature free to ship over every existing save: a save with no
 * shed flies everything it owns, which is exactly what it flew yesterday.
 */
export function toggleMount(meta: MetaState, id: UpgradeId): MetaState | null {
  if ((meta.loadout[id] ?? 0) <= 0) return null;
  const shed = (meta.stowed ?? []).filter((s) => s !== id);
  if (isMounted(meta, id)) return { ...meta, stowed: [...shed, id] };
  if (mountedIds(meta).length >= slotsFor(meta)) return null;
  return { ...meta, stowed: shed };
}

/** `tiers` with everything not in `aboard` set to 0 — the rig a run actually
 *  gets.
 *
 *  A MASK RATHER THAN A DELETE, and the difference is what keeps the rest of
 *  the game from having to learn that slots exist. A stowed system reads as
 *  tier 0 everywhere downstream, which is already the vocabulary for "the ship
 *  does not carry this": run.ts's buyUpgrade refuses to raise a tier-0 track,
 *  so a refit stop cannot sell scrap rungs on a system that is not aboard;
 *  applyUpgrades skips it, so it grants nothing; and the rack draws it dark.
 *  Not one of those three had to be taught the rule. */
export function maskLoadout(tiers: UpgradeTiers, aboard: readonly UpgradeId[]): UpgradeTiers {
  const set = new Set(aboard);
  const out = newTiers();
  for (const u of UPGRADES) out[u.id] = set.has(u.id) ? Math.max(0, tiers[u.id] ?? 0) : 0;
  return out;
}

/** The loadout to actually fly: the owned tiers MASKED to what is aboard, with
 *  an illegal one (a stale save from before a re-price, or a hand-edited
 *  localStorage entry) falling back to stock rather than being flown as-is.
 *  Cheating the budget is the one thing that would make a Mark clear mean
 *  nothing, so it's checked at the point of use.
 *
 *  Legality is asked of the OWNED loadout, not of the masked one, and that
 *  ordering is deliberate: masking only ever removes tiers, so a masked rig is
 *  never more expensive than the rig it came from. Asking the mask would let a
 *  hand-edited over-budget save fly, simply by stowing enough of itself to duck
 *  under the cap. */
export function safeLoadout(meta: MetaState): UpgradeTiers {
  if (!loadoutLegal(meta.loadout, markUnlocked(meta))) return newTiers();
  return maskLoadout(meta.loadout, mountedIds(meta));
}

/* -------------------------------------------------------------------------
 * TIER MILESTONES — how salvage arrives.
 *
 * A tier is the Mark currently flown (markUnlocked). It has
 * TIER_CONTRACTS_REQUIRED + 1 milestones — the tier's first-clear Contracts
 * and its Deep Run win — and each banks an equal share of tierSalvage(tier)
 * the moment it lands (tierMilestoneSalvage). Completing the tier (both
 * halves done AT THAT TIER) pays only the rounding remainder, raises the
 * Mark, and resets the counters. The per-tier total is exactly
 * tierSalvage(tier) however the milestones are ordered.
 *
 * Why shares rather than one award at completion (the 2026-08-08 shape):
 * completion-only pay had no entry point. The intended first purchase is a
 * 15-salvage entry install (Reactor Output — INSTALLS below), but a stock
 * rig earns no salvage until it WINS a run, and refit stops refuse tracks
 * the ship doesn't carry (run.ts's buyUpgrade) — so the player the on-ramp
 * exists for was locked out of it. The intended loop is Contracts FIRST:
 * tier 1's share is 60/4 = 15, exactly the entry install, so one Contract
 * clear funds the Reactor and the Deep Run is attempted with an economy
 * the refit stops can build on.
 *
 * The grind-proofing survives re-timing intact: a Contract still pays only
 * on its once-ever first clear (claimedContracts), only at the current
 * tier, and only for the first TIER_CONTRACTS_REQUIRED of them — so a tier
 * still yields tierSalvage(tier) total no matter how many Contracts are
 * played, and Unlimited keeps selling throughput, not salvage.
 *
 * Sizing: awards sum to 600 across the ten-tier ladder (a flat 60 per tier —
 * see TIER_SALVAGE_PER_TIER below for why the slope went) against a ~445
 * salvage shelf (installs 300 + the two live unlocks 145), so finishing the
 * shelf still means climbing most of the ladder — the tree cannot outrun
 * the exam.
 * ---------------------------------------------------------------------- */
export const TIER_CONTRACTS_REQUIRED = 3;
export const TIER_SALVAGE_BASE = 60;
/**
 * FLAT, deliberately — this was 20, and the slope is where the salvage economy
 * came apart.
 *
 * The ladder was sized honestly once: awards summed to 1,500 across ten tiers
 * against ~1,600 of things to buy, so the tree could not outrun it. Then eight
 * of the ten UNLOCKS were retired — their abilities moved into INSTALLS, which
 * was right — and 1,270 of SINK left the game while the income was never
 * re-derived. Measured: 1,500 earned against 325 spendable, a 4.6x oversupply,
 * and salvage stopped being a decision anywhere past the first tier.
 *
 * The base stays 60 because it is load-bearing: 60/4 milestones is 15, exactly
 * an entry install, which is the on-ramp a device session found the hard way
 * (2026-08-09, stuck on 8 salvage against a 15-salvage Reactor). Cutting the
 * base would re-break that. The SLOPE is what compounded — +20/tier reaches
 * 240 a tier by tier 10, against a shelf that does not grow — so the slope is
 * what goes. Every tier now pays 60, one contract still buys the entry system,
 * and total income falls 1,500 -> 600 against a ~445 shelf.
 */
export const TIER_SALVAGE_PER_TIER = 0;

/** TOTAL salvage a tier yields across its milestones + completion. */
export function tierSalvage(tier: number): number {
  const t = Math.max(1, Math.floor(tier));
  return TIER_SALVAGE_BASE + (t - 1) * TIER_SALVAGE_PER_TIER;
}

/** Salvage banked by ONE milestone of `tier` — an at-tier first-clear
 *  Contract, or the tier's Deep Run win. The floor's remainder is paid at
 *  completion so the tier total stays exactly tierSalvage(tier). */
export function tierMilestoneSalvage(tier: number): number {
  return Math.floor(tierSalvage(tier) / (TIER_CONTRACTS_REQUIRED + 1));
}

/** What a tier-affecting event did, alongside the updated meta. `completedTier`
 *  is the tier that just finished (null when progress merely ticked), and
 *  `salvage` is what THIS EVENT banked — a milestone share, the completion
 *  remainder, or both when one event is also the tier's last milestone. */
export interface TierResult {
  meta: MetaState;
  completedTier: number | null;
  salvage: number;
}

/** Advance the Mark if the current tier's two halves are both done, paying the
 *  award's rounding remainder (the shares themselves were paid as their
 *  milestones landed — see the recorders below). Shared exit for
 *  recordRunEnd/recordContractClear so the completion rule exists once. */
function advanceTier(meta: MetaState): TierResult {
  if (!meta.tierRunDone || meta.tierContracts < TIER_CONTRACTS_REQUIRED) {
    return { meta, completedTier: null, salvage: 0 };
  }
  const tier = markUnlocked(meta);
  const remainder =
    tierSalvage(tier) - tierMilestoneSalvage(tier) * (TIER_CONTRACTS_REQUIRED + 1);
  return {
    meta: {
      ...meta,
      mark: Math.min(MARK_COUNT, meta.mark + 1),
      salvage: meta.salvage + remainder,
      tierRunDone: false,
      tierContracts: 0,
    },
    completedTier: tier,
    salvage: remainder,
  };
}

/**
 * Record a finished Deep Run. Every run bumps the lifetime counters; a WON run
 * at the current tier marks the run half of the tier done and banks that
 * milestone's salvage share — once per tier, on the false→true edge, so
 * re-winning an already-ticked half pays nothing. `runMark` must be the Mark
 * the run was flown at (RunState.mark) — a stale save replaying an
 * already-beaten Mark cannot tick the current tier.
 *
 * A run flown with zero retries also SEALS its Mark (`sealedMarks`) — a badge
 * on the tower floor, and the Skydeck's key (skydeckOpen). `restarts` defaults
 * to 0 so a caller that predates the field reads as a clean run rather than
 * throwing; the only caller that can actually seal anything is main.ts's
 * finishRun, which threads RunState.restarts through.
 *
 * `refiled` IS THE GAME-OVER RETRY, and it exists because a run can now end
 * twice. Retrying a bay from the loss card resumes the very same RunState
 * (main.ts's retryBay), so the run that dies at bay 7, retries, and dies again
 * at bay 9 reaches this function twice — and every field here is already
 * idempotent under that except `runs`, which is a count of RUNS and not of
 * endings. So the second filing says so, and the counter stays honest. Nothing
 * else is skipped: bestBay is a max, the salvage share and the tier tick are
 * false→true edges, and the seal is gated on `restarts` being 0, which a
 * retried run's never is again.
 */
export function recordRunEnd(
  meta: MetaState, runMark: number, won: boolean, bayReached: number, restarts = 0,
  refiled = false,
): TierResult {
  const tier = markUnlocked(meta);
  const newlyDone = !meta.tierRunDone && won && runMark === tier;
  const share = newlyDone ? tierMilestoneSalvage(tier) : 0;
  // Deliberately NOT gated on runMark === tier the way the tier bookkeeping
  // above is: flying an already-beaten Mark clean is still flying it clean, and
  // the badge belongs on THAT floor. It pays nothing either way, so nothing can
  // be farmed by re-flying a low floor.
  const sealed = won && restarts === 0 && !meta.sealedMarks.includes(runMark)
    ? [...meta.sealedMarks, runMark]
    : meta.sealedMarks;
  const next: MetaState = {
    ...meta,
    runs: meta.runs + (refiled ? 0 : 1),
    bestBay: Math.max(meta.bestBay, bayReached),
    salvage: meta.salvage + share,
    tierRunDone: meta.tierRunDone || newlyDone,
    sealedMarks: sealed,
  };
  const result = advanceTier(next);
  return { ...result, salvage: result.salvage + share };
}

/**
 * Record a Contract clear. First clears are logged forever (claimedContracts —
 * the once-ever rule the monetization note above depends on); a first clear AT
 * THE CURRENT TIER also ticks the Contract half of tier completion and banks
 * that milestone's salvage share — but only for the first
 * TIER_CONTRACTS_REQUIRED of them, so extra at-tier clears (an Unlimited
 * player's deep daily board) tick nothing and pay nothing. Replays and
 * off-tier clears change nothing.
 */
export function recordContractClear(
  meta: MetaState,
  contract: { id: string; tier: number },
): TierResult & { firstClear: boolean } {
  if (meta.claimedContracts.includes(contract.id)) {
    return { meta, completedTier: null, salvage: 0, firstClear: false };
  }
  const tier = markUnlocked(meta);
  const countsForTier =
    contract.tier === tier && meta.tierContracts < TIER_CONTRACTS_REQUIRED;
  const share = countsForTier ? tierMilestoneSalvage(tier) : 0;
  const next: MetaState = {
    ...meta,
    claimedContracts: [...meta.claimedContracts, contract.id],
    salvage: meta.salvage + share,
    tierContracts: countsForTier ? meta.tierContracts + 1 : meta.tierContracts,
  };
  const result = advanceTier(next);
  return { ...result, salvage: result.salvage + share, firstClear: true };
}

/** Snapshot of the current tier's completion state — one shape for the menu
 *  chip, the end-of-run modal and the Contract modal, so no screen re-derives
 *  the rule. */
export interface TierProgress {
  tier: number;
  runDone: boolean;
  contracts: number;
  needed: number;
  /** TOTAL salvage this tier yields across all its milestones. */
  award: number;
  /** Salvage ONE milestone banks (tierMilestoneSalvage) — what the Contract
   *  board quotes per clear, so the screens can't re-derive the split. */
  milestone: number;
}

export function tierProgressFor(meta: MetaState): TierProgress {
  const tier = markUnlocked(meta);
  return {
    tier,
    runDone: meta.tierRunDone,
    contracts: Math.min(meta.tierContracts, TIER_CONTRACTS_REQUIRED),
    needed: TIER_CONTRACTS_REQUIRED,
    award: tierSalvage(tier),
    milestone: tierMilestoneSalvage(tier),
  };
}

/* -------------------------------------------------------------------------
 * THE UNLOCK CEREMONY — detection, and only detection.
 *
 * Completing a tier is the biggest thing that happens outside a run, and until
 * now it was reported by a line of text on whichever modal the player happened
 * to be looking at when it landed. The home screen's tower already draws the
 * whole ladder; the ride to the new floor is that number becoming an event
 * (main.ts's armUnlockCelebration, app.css's .tower--rising).
 *
 * WHAT LIVES HERE is the question "is a ceremony owed", and it is answered
 * from persisted state rather than raised as a signal at the two places a tier
 * can complete (recordContractClear from the Contract board, recordRunEnd from
 * the end of a Deep Run). Derivation beats a signal on three counts, and each
 * one is a bug the signal version would have shipped:
 *
 *  - The ceremony happens on a DIFFERENT SCREEN from the event. A signal has
 *    to survive the walk from a Contract's end card back to the menu, and any
 *    route that skips a step — quit to the menu, close the app on the end
 *    card, a crash — drops it. The comparison cannot be dropped; it is still
 *    true on the next launch, next week.
 *  - It fires ONCE by construction rather than by discipline. Consuming it
 *    writes `celebratedMark`, so re-entering the menu asks the same question
 *    and gets "no".
 *  - Neither recorder learns about the home screen, so the completion rule
 *    stays one function (advanceTier) with one caller-visible result.
 * ---------------------------------------------------------------------- */

/**
 * The floor whose unlock is owed a ceremony, or null when none is.
 *
 * The answer is `markUnlocked` — the tier that just OPENED — and not the tier
 * that was completed: a lift rides to where you can now go, not to where you
 * have been. On a finished ladder (`mark` at MARK_COUNT) markUnlocked
 * saturates at the top rung, and the floor that actually opened is the Skydeck
 * above it; the caller with the tower in hand does that last mapping, because
 * SKYDECK_TIER is a drawing of the ladder rather than a Mark and this file has
 * no business knowing it exists.
 */
export function pendingUnlockMark(meta: MetaState): number | null {
  return meta.mark > meta.celebratedMark ? markUnlocked(meta) : null;
}

/** Burn the pending ceremony. Called when the ride STARTS, not when it ends —
 *  a player who closes the app mid-ride has seen the tier open, and the
 *  alternative is a ceremony that replays every launch until it is watched all
 *  the way through. Idempotent, so a second call (a re-render, a state change
 *  that re-enters the menu) is free. */
export function markUnlockCelebrated(meta: MetaState): MetaState {
  return meta.celebratedMark === meta.mark ? meta : { ...meta, celebratedMark: meta.mark };
}

/* -------------------------------------------------------------------------
 * NEXT STEP (canvas A3) — the ONE thing the loop asks for right now.
 * Exactly one surface ever carries the badge, and this is the rule that
 * picks it, stated once so the menu, the Workshop and the fail card can
 * never point at different doors:
 *   salvage covers an installable system  -> Workshop (spend it)
 *   ladder finished, Marks still unsealed -> seal one (a Deep Run, clean)
 *   contracts still owed this tier        -> Contracts (earn it)
 *   otherwise                             -> Deep Run (the exam)
 *
 * THE SEAL STEP IS WHAT THE ENDGAME WAS MISSING. The Contracts branch reads
 * "this tier still owes clears", which is a live objective for nine tiers
 * because completing a tier MOVES the tier. At MARK_COUNT it moves nothing:
 * markUnlocked saturates onto the tier just finished and advanceTier has
 * cleared its counters, so the rule answered "Contracts" forever and sent a
 * player who had beaten the entire ladder back to a board that could no longer
 * open anything. Meanwhile the thing that IS still owed — the seals the
 * Skydeck asks for — was stated on no surface at all outside the tower's
 * sockets. So the finished ladder gets its own answer, and it names the only
 * objective left: fly a Mark clean.
 * ---------------------------------------------------------------------- */
export type NextStepId = "workshop" | "contracts" | "run" | "seal";

/** The cheapest system the player could install right now, or null. */
export function cheapestInstall(meta: MetaState): InstallDef | null {
  return (
    INSTALLS.filter((i) => installAvailable(meta, i)).sort((a, b) => a.cost - b.cost)[0] ?? null
  );
}

export function nextStep(meta: MetaState): NextStepId {
  const next = cheapestInstall(meta);
  if (next && meta.salvage >= next.cost) return "workshop";
  // Asked BEFORE the Contracts branch, because at MARK_COUNT that branch is
  // answering a question the ladder has stopped asking — see the header. A
  // finished ladder with every Mark sealed falls through to the run, which is
  // the Skydeck by then: the roof is open (skydeckOpen), the tower draws it,
  // and the primary flies whatever floor the car is parked on.
  if (meta.mark >= MARK_COUNT) return unsealedMarks(meta).length > 0 ? "seal" : "run";
  if (meta.tierContracts < TIER_CONTRACTS_REQUIRED) return "contracts";
  return "run";
}

/** Draft cards offered before the third slot is earned, and the number of
 *  cleared Contracts that earns it. */
export const DRAFT_BASE_SLOTS = 2;
export const DRAFT_FULL_SLOTS = 3;
export const DRAFT_THIRD_SLOT_CONTRACTS = 5;

/**
 * How many modifier cards a draft offers.
 *
 * Three was the whole pool for a new player: only four modifiers are free, and
 * three of them appeared every single draft, so run one's "choice" was really a
 * fixed list in a shuffled order. Two of four is a genuine pick (six possible
 * pairs) and leaves the third card as something to earn.
 *
 * It is earned by clearing daily Contracts rather than by spending salvage,
 * deliberately: salvage is grindable and buys OPTIONS, whereas a wider draft
 * changes every future run, so it should cost play rather than currency.
 */
export function draftSlots(claimedContracts: string[]): number {
  return claimedContracts.length >= DRAFT_THIRD_SLOT_CONTRACTS ? DRAFT_FULL_SLOTS : DRAFT_BASE_SLOTS;
}

/** True once this Contract has paid out — replaying it is free practice. */
export function contractClaimed(meta: MetaState, contractId: string): boolean {
  return meta.claimedContracts.includes(contractId);
}
