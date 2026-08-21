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
  budgetForMark, buyLoadoutTier, loadoutLegal, MARK_COUNT, newTiers, tiersCost,
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
  /** Salvage price. One-time; an install never stacks — tiers 2-3 cost scrap. */
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
  // win. The shelf now totals 460 (with the two former Options folded in
  // below) against 600 of income — slack enough to make a wrong purchase
  // survivable, tight enough that the choice is a choice.
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
];

export function installById(id: string): InstallDef | undefined {
  return INSTALLS.find((i) => i.id === id);
}

/** True when `def` can be bought right now: its Mark is beaten, it isn't
 *  already installed, and tier 1 of it still fits the Mark's build budget.
 *  Deliberately does NOT check salvage — the Workshop renders a card the player
 *  simply can't afford yet as a disabled price button, which reads differently
 *  from a gated one. */
export function installAvailable(meta: MetaState, def: InstallDef): boolean {
  if (def.requiresMark !== undefined && meta.mark < def.requiresMark) return false;
  if ((meta.loadout[def.id] ?? 0) > 0) return false;
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
  if ((meta.loadout[def.id] ?? 0) === 0 &&
      buyLoadoutTier(meta.loadout, def.id, markUnlocked(meta)) === null) {
    out.push(`build budget ${tiersCost(meta.loadout)}/${markBudget(meta)}`);
  }
  return out;
}

/**
 * Buy an install: charge salvage and set the track to tier 1. Returns null when
 * gated, already owned, unaffordable, or over budget. Never mutates.
 *
 * The budget charge goes through `buyLoadoutTier` rather than being re-derived
 * here, so the Workshop cannot be a second, laxer door into the same loadout
 * that `safeLoadout` validates on the way out.
 */
export function buyInstall(meta: MetaState, id: UpgradeId): MetaState | null {
  const def = installById(id);
  if (!def) return null;
  if (!installAvailable(meta, def)) return null;
  if (meta.salvage < def.cost) return null;
  const loadout = buyLoadoutTier(meta.loadout, id, markUnlocked(meta));
  if (!loadout) return null;
  return { ...meta, salvage: meta.salvage - def.cost, loadout };
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
}

export function newMeta(): MetaState {
  return {
    salvage: 0, unlocks: [], runs: 0, bestBay: 0, mark: 0,
    tierRunDone: false, tierContracts: 0,
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
 * Sizing: awards sum to 1,500 across the ten-tier ladder against a ~1,600
 * salvage tree (unlocks 1,400 + installs 195), so finishing the tree means
 * finishing the ladder — the tree can no longer outrun the exam.
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
 * and total income falls 1,500 -> 600 against a ~460 shelf.
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
 */
export function recordRunEnd(meta: MetaState, runMark: number, won: boolean, bayReached: number): TierResult {
  const tier = markUnlocked(meta);
  const newlyDone = !meta.tierRunDone && won && runMark === tier;
  const share = newlyDone ? tierMilestoneSalvage(tier) : 0;
  const next: MetaState = {
    ...meta,
    runs: meta.runs + 1,
    bestBay: Math.max(meta.bestBay, bayReached),
    salvage: meta.salvage + share,
    tierRunDone: meta.tierRunDone || newlyDone,
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
 * NEXT STEP (canvas A3) — the ONE thing the loop asks for right now.
 * Exactly one surface ever carries the badge, and this is the rule that
 * picks it, stated once so the menu, the Workshop and the fail card can
 * never point at different doors:
 *   salvage covers an installable system  -> Workshop (spend it)
 *   contracts still owed this tier        -> Contracts (earn it)
 *   otherwise                             -> Deep Run (the exam)
 * ---------------------------------------------------------------------- */
export type NextStepId = "workshop" | "contracts" | "run";

/** The cheapest system the player could install right now, or null. */
export function cheapestInstall(meta: MetaState): InstallDef | null {
  return (
    INSTALLS.filter((i) => installAvailable(meta, i)).sort((a, b) => a.cost - b.cost)[0] ?? null
  );
}

export function nextStep(meta: MetaState): NextStepId {
  const next = cheapestInstall(meta);
  if (next && meta.salvage >= next.cost) return "workshop";
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
