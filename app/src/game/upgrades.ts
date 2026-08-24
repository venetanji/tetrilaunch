import { DEMO_RESUPPLY_LINES, type LevelConfig } from "./level";

/**
 * SHIP UPGRADES — the FTL layer of the run.
 *
 * The compactor rig IS the ship: it starts at a fixed stock size and gets
 * refitted with scrap earned in-run. Seven systems, three tiers each, bought at
 * REFIT STOPS (after bays 3, 6 and 9 — see run.ts's isRefitBay). Upgrades are
 * PERMANENT for the run and are re-applied onto a fresh base level every bay,
 * exactly like drafted mods.
 *
 * How this differs from mods.ts, and why both exist:
 *  - A MOD is a contract you're OFFERED (one of three, every bay, seeded). It
 *    is usually a trade-off, it can be a bane, and you don't choose which three
 *    you see. Mods are the run's texture — what hand you were dealt.
 *  - An UPGRADE is capital you CHOSE to spend, from a menu that's always fully
 *    visible, with a known price. Upgrades are the build — what you decided to
 *    become. Nothing here is a downside; the cost is the opportunity cost of
 *    the scrap.
 *
 * Order of application matters and is fixed in run.ts's levelForRun: upgrades
 * first, then mods. So a mod's multiplier compounds ON TOP of the ship's
 * refit (e.g. Overclock's ×1.5 compactor speed multiplies the hydraulics-
 * boosted speed), which is the intended reading — the contract applies to
 * whatever ship you're flying.
 */
export type UpgradeId =
  | "bay" | "launcher" | "hydraulics" | "magazine" | "reactor" | "bonds" | "demolition";

export const MAX_TIER = 3;

/** Scrap cost to go from tier t-1 to tier t, for every track. One shared
 *  ladder rather than per-track pricing: the tracks are meant to be balanced
 *  against each other by EFFECT, and a shared price keeps "which system do I
 *  want" the whole decision instead of "which is cheapest". See level.ts's
 *  SCRAP_PER_LINE note for how this ladder is sized against a run's income. */
export const TIER_COSTS = [20, 35, 55] as const;

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** 2-3 char plate glyph for the compact HUD/refit chip. */
  glyph: string;
  /** One-line "what system is this" for the refit card header. */
  blurb: string;
  /** Per-tier effect copy, index 0 = tier 1. The refit card no longer prints
   *  the whole ladder (three lines x six cards overflowed a landscape phone by
   *  145px), so this now feeds the card's `title` for hover and stays the one
   *  place the ladder is written down. */
  tiers: [string, string, string];
  /** What the ship HAS on this track at `tier`, in absolute terms (tier 0 =
   *  stock). The card used to show only deltas, which meant a player could see
   *  "+2 open cells" without ever being told the bay was 12 to begin with. */
  current(tier: number): string;
  /** The step from `tier` to `tier + 1`, for the buy button: which way the
   *  number moves and by how much. `dir` is the direction of the NUMBER, not a
   *  judgement — a shorter cooldown is an improvement that reads "down". Never
   *  called at MAX_TIER, where there is no next step to describe. */
  step(tier: number): { dir: "up" | "down"; text: string };
  /** Mutate `cfg` for a track sitting at `tier` (1..MAX_TIER). Never called
   *  with tier 0 — applyUpgrades skips unbought tracks entirely, so each
   *  implementation can assume it has work to do. */
  apply(cfg: LevelConfig, tier: number): void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "bay",
    name: "Bay Extension",
    glyph: "BAY",
    blurb: "Widens the compaction zone at the open stop — more room to land in, longer lines to sell.",
    tiers: [
      "+2 open cells (14) · +4 cubes before congestion",
      "+4 open cells (16) · +8 cubes before congestion",
      "+6 open cells (18) · +12 cubes before congestion",
    ],
    // 12 is makeBaseLevel's stock width and, now that Wide Bay is gone, the
    // only thing that moves it is this track — so the reading is exact rather
    // than an estimate that a draft could silently invalidate.
    current: (t) => `${12 + 2 * t} open cells`,
    step: () => ({ dir: "up", text: "+2 cells" }),
    apply(cfg, tier) {
      // 12 stock -> 14/16/18. This is the "extend to 18" lever, now EARNED
      // capital instead of a random Wide Bay offer: a wide bay is the standard
      // answer to a bay whose stack keeps topping out, so it should be
      // something you can decide to build toward.
      cfg.compactorOpenCells = Math.min(18, cfg.compactorOpenCells + 2 * tier);
      // The congestion tax's counter, and the reason it is a SYSTEM rather
      // than a difficulty setting. level.ts ships pileAllowance as an
      // explicit upgrade seam — "a player who invests here buys back the right
      // to fire into a fuller bay" — and nothing set it: the field was read by
      // game.ts's pileTier and swept by sim/pile.ts, but every real level got 0
      // and no purchase could move it, so the tax had no answer you could buy.
      //
      // It belongs on THIS track and not its own. A wider compaction zone
      // literally is more room for loose cargo to sit in without being in the
      // way, so the allowance is the same purchase read a second way rather
      // than a second purchase; and pricing congestion relief separately would
      // sell the player a way to opt out of the mechanic instead of a way to
      // play further into it. +4 a tier against thresholds of 32 and 48 moves
      // the first tax from four lines' worth of clutter to just under six at
      // tier 3 — later, never absent.
      cfg.pileAllowance += 4 * tier;
    },
  },
  {
    id: "launcher",
    name: "Launcher Coils",
    glyph: "LCH",
    blurb: "More muzzle energy and a lateral stabilizer — reach the back of the bay, and fight the weather.",
    tiers: [
      "+6% muzzle speed · 20% wind cancelled",
      "+12% muzzle speed · 40% wind cancelled",
      "+18% muzzle speed · 60% wind cancelled",
    ],
    current: (t) => (t === 0 ? "stock coils" : `+${6 * t}% speed · ${20 * t}% wind`),
    step: () => ({ dir: "up", text: "+6% power" }),
    apply(cfg, tier) {
      // The wind counter. A stock launcher at max power lands at x~1228 (see
      // cannon.ts's SPEED_MAX note); a strong steady headwind can pull that
      // back far enough that the deep slots are simply unreachable, which is
      // the "sometimes impossible unless you extend to 18" complaint. Coils
      // attack it from both sides: more speed to throw through the wind, and
      // a stabilizer that cancels part of the wind outright.
      cfg.launchPower *= 1 + 0.06 * tier;
      cfg.windAssist = Math.min(0.85, cfg.windAssist + 0.2 * tier);
    },
  },
  {
    id: "hydraulics",
    name: "Press Hydraulics",
    glyph: "HYD",
    blurb: "A harder, faster press — squares up a messy pile into sellable rows instead of leaving it wedged.",
    tiers: [
      "×1.6 settle assist · +8% stroke speed",
      "×2.2 settle assist · +16% stroke speed",
      "×2.8 settle assist · +24% stroke speed",
    ],
    current: (t) => (t === 0 ? "stock press" : `×${(1 + 0.6 * t).toFixed(1)} assist · +${8 * t}% stroke`),
    step: () => ({ dir: "up", text: "+0.6 assist" }),
    apply(cfg, tier) {
      // Settle assist is what converts "nearly a line" into a payout (see
      // lineClear.ts's settleZoneCubes) — the direct upgrade for a build that
      // lands a lot of loose cubes, i.e. the tiny/Autoloader line. Stroke
      // speed rides along so a refitted press also gets MORE chances per bay,
      // not just better ones.
      cfg.settleAssist *= 1 + 0.6 * tier;
      cfg.compactorSpeed *= 1 + 0.08 * tier;
    },
  },
  {
    id: "magazine",
    name: "Loader Magazine",
    glyph: "MAG",
    blurb: "Faster reload — more shots inside the same clock.",
    tiers: ["−15% cooldown", "−30% cooldown", "−45% cooldown"],
    current: (t) => (t === 0 ? "stock reload" : `−${15 * t}% cooldown`),
    // The one track whose number falls. The arrow reports the number, so this
    // reads "down" even though a shorter cooldown is the improvement.
    step: () => ({ dir: "down", text: "−15% reload" }),
    apply(cfg, tier) {
      cfg.cooldownMs = Math.max(120, Math.round(cfg.cooldownMs * (1 - 0.15 * tier)));
    },
  },
  {
    id: "reactor",
    name: "Reactor Output",
    glyph: "RCT",
    blurb: "A bigger float every bay and a better rate per line — the economy track.",
    // The FLOAT half is +$30/60/90, halved from +$60/120/180; the RATE half is
    // untouched. This is still the economy track and a maxed reactor is still
    // the strongest thing scrap can buy — what it no longer does is PRE-PAY the
    // bay. At +$180 the bonus was larger than a Tier 1 bay's entire float
    // ($160, see level.ts's LAUNCH_BUDGET_SHOTS), so a maxed rig opened bay 1
    // already most of the way to the quota and cleared it in three lines
    // against a stock rig's ten. Halved, the same bay asks ~7.5 lines: the
    // track buys a better RATE and a real cushion, and the bay still has to be
    // earned. Raised the quota to meet it too — see level.ts's TARGET_BASE.
    tiers: [
      "+$30 float · +$15 per line",
      "+$60 float · +$30 per line",
      "+$90 float · +$45 per line",
    ],
    current: (t) => (t === 0 ? "stock reactor" : `+$${30 * t} float · +$${15 * t}/line`),
    step: () => ({ dir: "up", text: "+$30 float" }),
    apply(cfg, tier) {
      cfg.startingFunds += 30 * tier;
      cfg.scorePerLine += 15 * tier;
    },
  },
  {
    id: "bonds",
    name: "Bond Emitter",
    glyph: "BND",
    blurb: "Ships ONE Bond Breaker charge for the whole run — shatter the field flat, once, where it counts most.",
    tiers: [
      "+1 charge per run",
      "+2 charges per run · S/Z bonds 30% weaker",
      "+3 charges per run · S/Z bonds 50% weaker",
    ],
    current: (t) => {
      if (t === 0) return "no charges";
      const charges = `${t} charge${t === 1 ? "" : "s"} for the run`;
      return t >= 2 ? `${charges} · S/Z ${t >= 3 ? 50 : 30}% weaker` : charges;
    },
    step: () => ({ dir: "up", text: "+1 charge" }),
    apply(cfg, tier) {
      // Bond Breakers are the compaction answer for any build whose pieces
      // don't flatten their own pile — most of all the light tiny build, whose
      // cubes are too light for weight alone to square off the layers below
      // (see pieces.ts's SIZE_SPEC).
      //
      // This is the emitter's grant onto a SINGLE config, and it is the whole
      // story only outside a Deep Run. In a run the charges are consumable and
      // the magazine belongs to the run rather than the bay, so run.ts's
      // levelForRun overwrites this with RunState.bondCharges — what is
      // actually left — right after applyUpgrades returns. The rule that turns
      // a tier into charges lives once, in run.ts's bondChargesFor, and this
      // line is the same rule at the config layer: one charge per tier.
      cfg.bondBreakerCharges += tier;
      // SEAM SPLITTER — tiers 2 and 3 also stamp WEAKER bonds onto S and Z at
      // launch (level.ts's weakBondTypes/weakBondMult; pieces.ts's
      // createTetrisPiece does the stamping). S and Z are the shapes that tip,
      // wedge and strand cubes, so weakening exactly their seams turns the
      // worst deliveries into loose, compactable cargo without touching the
      // shapes that already land well. Hosted HERE, at tiers 2-3, so it is a
      // refit decision on the track whose whole identity is bond control —
      // with the charges now a rare per-run magazine, this passive is what
      // the higher tiers newly pay for. 0.7 then 0.5: tier 2 makes a bad S/Z
      // landing shed its worst seam, tier 3 makes shattering their norm.
      if (tier >= 2) {
        cfg.weakBondTypes = ["S", "Z"];
        cfg.weakBondMult = tier >= 3 ? 0.5 : 0.7;
      }
    },
  },
  {
    id: "demolition",
    name: "Demolition Rack",
    glyph: "DEM",
    blurb: "Demolition charges every bay — sell a dead pile back for cash.",
    tiers: [
      "+2 charges per bay",
      "+4 charges per bay",
      `+6 per bay · +1 every ${DEMO_RESUPPLY_LINES} lines`,
    ],
    current: (t) => (t === 0
      ? "no charges"
      : t >= MAX_TIER
        ? `+${2 * t}/bay · +1 per ${DEMO_RESUPPLY_LINES} lines`
        : `+${2 * t} charges/bay`),
    step: (t) => (t + 1 >= MAX_TIER
      ? { dir: "up", text: "+2 charges, and a resupply line" }
      : { dir: "up", text: "+2 charges" }),
    apply(cfg, tier) {
      // Twice the old size, and deliberately more generous than the bond
      // track: a bomb is a SALVAGE tool (it refunds what it vaporizes) rather
      // than a field-flattening reset, so it can afford to be the abundant
      // consumable now that Bond Breakers are the rare one. A charge you can
      // PLAN for beats a charge you might be dealt — demolition is slag's
      // only clean answer, and leaving that answer to a draft shuffle meant a
      // player who had paid for it went whole runs without one.
      cfg.bombCharges += 2 * tier;
      // The capstone is a RESUPPLY LINE, not another +2. Six charges is a
      // budget for a bay, and a bay can out-last it: at two or three notches of
      // slag, or under the Tier 6 Slag Wall clause, a seventh dead shipment
      // arrives with nothing left to answer it. Metering the return on LINES
      // makes the loop circular on purpose — bomb the slag, close the row, get
      // the charge back — so the tier pays out for charges spent unblocking
      // rather than hoarded.
      // It will not rescue a bay that is already buried, and should not.
      if (tier >= MAX_TIER) cfg.bombResupplyLines = DEMO_RESUPPLY_LINES;
    },
  },
];

export type UpgradeTiers = Record<UpgradeId, number>;

export function newTiers(): UpgradeTiers {
  return { bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0, bonds: 0, demolition: 0 };
}

/**
 * Which tracks a REFIT stop offers at `mark`.
 *
 * Mark 1 offers ONLY Reactor Output. Tier 1 is the tier the game teaches its
 * economy on, and the reactor IS the economy track — the tuning assumes its
 * three tiers get built across the run's three stops (playtest call,
 * 2026-08-09: a stock rig can't reliably finish the Mark-1 run without
 * them). A first-run player shown six systems spreads thin scrap across all
 * of them and builds none; one card makes the stop a purchase instead of a
 * dilemma, and pairs with the Workshop on-ramp (meta.ts's INSTALLS — the
 * 15-salvage Reactor install is what makes the card raisable at all, since
 * refits refuse tier-0 tracks; see run.ts's buyUpgrade). The full menu opens
 * at Mark 2, where the player has both the scrap income and the context to
 * spend it.
 */
export function refitTracks(mark: number): UpgradeDef[] {
  return mark <= 1 ? UPGRADES.filter((u) => u.id === "reactor") : UPGRADES;
}

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/** Scrap cost of the NEXT tier of `id` given the tier already owned, or null
 *  when the track is already maxed (the refit UI renders that as "MAX"). */
export function nextTierCost(tier: number): number | null {
  return tier >= MAX_TIER ? null : TIER_COSTS[tier];
}

/**
 * Apply every bought upgrade tier onto `cfg`, in place. Tracks at tier 0 are
 * skipped entirely. Unknown keys in a `tiers` object are ignored (same
 * forward-compatibility stance as mods.ts's applyMods — a future build can
 * rename a track without corrupting an in-flight run's saved state).
 */
export function applyUpgrades(cfg: LevelConfig, tiers: UpgradeTiers): void {
  for (const def of UPGRADES) {
    const tier = tiers[def.id] ?? 0;
    if (tier > 0) def.apply(cfg, Math.min(MAX_TIER, tier));
  }
}

/**
 * Ladder cost of a set of tiers. Serves two masters, which is why it isn't
 * named for either: in-run it's the scrap sunk into the ship (shown on the
 * refit/end screens so a build reads as an investment rather than a list of
 * chips), and out of run it's the BUILD BUDGET a permanent loadout spends
 * (see budgetForMark).
 */
export function tiersCost(tiers: UpgradeTiers): number {
  let total = 0;
  for (const def of UPGRADES) {
    const tier = Math.min(MAX_TIER, tiers[def.id] ?? 0);
    for (let t = 0; t < tier; t++) total += TIER_COSTS[t];
  }
  return total;
}

/* ---------------------------------------------------------------------------
 * THE REFIT ORDER — what the yard has been asked to install, before a single
 * point of scrap has changed hands.
 *
 * A refit stop used to spend on the tap: every button was a purchase, and a
 * player who wanted to compare two builds had to buy one of them to see it.
 * That is the opposite of what this stop is for. The whole reason the yard
 * shows every track at once with its ladder spelled out — see refitScreen's
 * note, and the draft it contrasts itself with — is that a refit is a PLAN,
 * and a plan you cannot revise before committing is just a run of irreversible
 * taps.
 *
 * So the yard now STAGES tiers into an order and Undock is the one commit (see
 * run.ts's buyUpgrades). This type is that order: extra tiers per track, on top
 * of whatever the ship already carries. Absent or 0 means nothing is queued
 * there, so an empty object is an empty yard ticket and `{}` is always legal.
 * ------------------------------------------------------------------------- */
export type RefitOrder = Partial<Record<UpgradeId, number>>;

/** The tier a track would sit at with the order installed. Clamped, so an
 *  order hand-edited past the ladder's top reads as MAX rather than as a
 *  fourth tier nothing implements. */
export function orderedTier(tiers: UpgradeTiers, order: RefitOrder, id: UpgradeId): number {
  return Math.min(MAX_TIER, (tiers[id] ?? 0) + Math.max(0, Math.floor(order[id] ?? 0)));
}

/** Every track's tier with the order installed — the loadout the yard's
 *  projection is drawn against (see main.ts's refitHTML). */
export function orderedTiers(tiers: UpgradeTiers, order: RefitOrder): UpgradeTiers {
  const out = { ...tiers };
  for (const def of UPGRADES) out[def.id] = orderedTier(tiers, order, def.id);
  return out;
}

/** Rungs queued across every track — what the Undock button counts. Derived
 *  from the clamped tiers rather than from the order's own numbers, so a
 *  stale entry on a maxed track cannot inflate the count. */
export function orderSize(tiers: UpgradeTiers, order: RefitOrder): number {
  let n = 0;
  for (const def of UPGRADES) {
    n += orderedTier(tiers, order, def.id) - Math.min(MAX_TIER, tiers[def.id] ?? 0);
  }
  return n;
}

/** Scrap the whole order costs. Priced as the DIFFERENCE between two ladder
 *  costs rather than by re-walking TIER_COSTS here: one ladder, priced in one
 *  place, so the yard's running total can never disagree with what the commit
 *  actually deducts. */
export function orderCost(tiers: UpgradeTiers, order: RefitOrder): number {
  return tiersCost(orderedTiers(tiers, order)) - tiersCost(tiers);
}

/**
 * The RUNGS an order installs, in the order run.ts's buyUpgrades installs
 * them: which track, the tier each rung climbs FROM, and what that rung costs.
 *
 * Exists so the commit and anything that has to narrate the commit read the
 * same sequence off one function. main.ts's onRefitDone is the caller that
 * makes it worth having: telemetry records a `scrapBefore` per rung, and
 * reconstructing "the balance before each of six purchases" from a batch
 * needs the rungs in installation order with their individual prices — which
 * is exactly what buyUpgrades walks, and exactly the thing that would rot if
 * it were walked twice.
 *
 * Clamped and price-terminated, so it enumerates only rungs that exist. It
 * does NOT validate the order (buyUpgrades does that, strictly, before
 * spending anything) — an order that climbs past the ladder simply has fewer
 * rungs here than its numbers claim.
 */
export function orderRungs(
  tiers: UpgradeTiers,
  order: RefitOrder,
): { id: UpgradeId; from: number; cost: number }[] {
  const rungs: { id: UpgradeId; from: number; cost: number }[] = [];
  for (const def of UPGRADES) {
    const start = Math.min(MAX_TIER, tiers[def.id] ?? 0);
    const want = Math.max(0, Math.floor(order[def.id] ?? 0));
    for (let i = 0; i < want; i++) {
      const cost = nextTierCost(start + i);
      if (cost === null) break;
      rungs.push({ id: def.id, from: start + i, cost });
    }
  }
  return rungs;
}

/**
 * Queue one more tier of `id`, or null when the yard cannot take it: the system
 * is not aboard (tier 0 — a refit RAISES, it never installs; see run.ts's
 * buyUpgrade), the track is already ordered to MAX, or the extra rung does not
 * fit what is left of `scrap`.
 *
 * Affordability is checked against the WHOLE order, not against this rung
 * alone. That is the difference a staged yard makes: with one purchase per tap
 * the scrap was already gone by the time the next button rendered, and here it
 * is not — so the button's disabled state has to price the queue behind it.
 */
export function stageTier(
  tiers: UpgradeTiers,
  order: RefitOrder,
  id: UpgradeId,
  scrap: number,
): RefitOrder | null {
  if ((tiers[id] ?? 0) <= 0) return null;
  if (nextTierCost(orderedTier(tiers, order, id)) === null) return null;
  const next: RefitOrder = { ...order, [id]: Math.max(0, Math.floor(order[id] ?? 0)) + 1 };
  if (orderCost(tiers, next) > scrap) return null;
  return next;
}

/**
 * Take a track's queued rungs back off the order — ALL of them, not the last
 * one, and that is the trap it avoids rather than a shortcut.
 *
 * The yard sells one control per card (the tap floor leaves room for one, and
 * the draft's cards already settled that a single cycling button beats two).
 * So the card's button stages while there is room and undoes once the track is
 * ordered to MAX — and a one-rung undo there would leave a track oscillating
 * between its top two tiers with no way back down to what the ship carries.
 * Taking the whole track back is the escape, in one tap, from any staged state.
 */
export function clearTrack(order: RefitOrder, id: UpgradeId): RefitOrder {
  if (Math.max(0, Math.floor(order[id] ?? 0)) === 0) return order;
  const next = { ...order };
  delete next[id];
  return next;
}

/* ---------------------------------------------------------------------------
 * BUILD BUDGET — the permanent, out-of-run layer (see docs/DESIGN.md).
 *
 * A Mark grants a fixed number of ladder points, spent freely across the six
 * tracks. This is deliberately a budget on the TOTAL rather than a cap on each
 * track's tier, and the difference is the whole point: a per-track cap
 * normalizes the MAXIMUM rig, not the actual one, so two players at the same
 * Mark can sit far apart on power with the gap being nothing but grind time —
 * which is exactly what a subscription that sells throughput would then be
 * selling. Budgeting the total makes every rig at a Mark equal in power and
 * different in shape, which is the FTL reading and the honest one for a
 * leaderboard.
 * ------------------------------------------------------------------------- */

/** Ladder cost of every track maxed: 7 tracks x (20+35+55) = 770. Derived, not
 *  typed in, so re-pricing TIER_COSTS or adding an eighth system can't leave a
 *  stale constant behind. */
export const FULL_BUILD_COST = UPGRADES.length * TIER_COSTS.reduce((a, b) => a + b, 0);

/** Marks in the ladder. Placeholder that rhymes with RUN_LEVELS; the real
 *  number depends on how long a Mark takes to beat (see docs/DESIGN.md's open
 *  questions). */
export const MARK_COUNT = 10;

/**
 * Ladder points available at `mark` (1-based). Linear from one-system money at
 * Mark 1 to a fully-kitted rig at MARK_COUNT — the arc from "you can afford one
 * system" to "you can afford everything" IS the progression.
 *
 * FIRST PASS, uncalibrated. The criterion this has to satisfy (docs/DESIGN.md):
 * a rig built with the full Mark-N budget, played at the sim bot's competence,
 * should fall JUST SHORT of the Mark N target — if it can't clear at any skill
 * the Mark is impossible, and if it clears while played badly the Mark is free.
 * Tune against sim/sweep.ts, not by feel.
 */
export function budgetForMark(mark: number): number {
  const m = Math.max(1, Math.min(MARK_COUNT, Math.floor(mark)));
  return Math.round((FULL_BUILD_COST * m) / MARK_COUNT);
}

/** True when `tiers` is a legal loadout at `mark` — i.e. it fits the budget and
 *  no track exceeds MAX_TIER. Validated rather than trusted because the loadout
 *  round-trips through localStorage, where anyone can edit it. */
export function loadoutLegal(tiers: UpgradeTiers, mark: number): boolean {
  for (const def of UPGRADES) {
    const tier = tiers[def.id] ?? 0;
    if (tier < 0 || tier > MAX_TIER || !Number.isInteger(tier)) return false;
  }
  return tiersCost(tiers) <= budgetForMark(mark);
}

/** Buy one tier of `id` against the budget, or null when it can't be bought —
 *  maxed, or the next tier doesn't fit what's left. Mirrors run.ts's
 *  buyUpgrade so the loadout screen and the refit screen can render a disabled
 *  card from the same rule instead of each re-deriving affordability. */
export function buyLoadoutTier(
  tiers: UpgradeTiers,
  id: UpgradeId,
  mark: number,
): UpgradeTiers | null {
  const tier = tiers[id] ?? 0;
  const cost = nextTierCost(tier);
  if (cost === null) return null;
  const next = { ...tiers, [id]: tier + 1 };
  if (tiersCost(next) > budgetForMark(mark)) return null;
  return next;
}
