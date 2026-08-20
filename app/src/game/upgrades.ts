import type { LevelConfig } from "./level";

/**
 * SHIP UPGRADES — the FTL layer of the run.
 *
 * The compactor rig IS the ship: it starts at a fixed stock size and gets
 * refitted with scrap earned in-run. Six systems, three tiers each, bought at
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
    tiers: ["+2 open cells (14)", "+4 open cells (16)", "+6 open cells (18)"],
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
    tiers: [
      "+$60 float · +$15 per line",
      "+$120 float · +$30 per line",
      "+$180 float · +$45 per line",
    ],
    current: (t) => (t === 0 ? "stock reactor" : `+$${60 * t} float · +$${15 * t}/line`),
    step: () => ({ dir: "up", text: "+$60 float" }),
    apply(cfg, tier) {
      cfg.startingFunds += 60 * tier;
      cfg.scorePerLine += 15 * tier;
    },
  },
  {
    id: "bonds",
    name: "Bond Emitter",
    glyph: "BND",
    blurb: "Bond Breaker charges for the whole run — a consumable pool, not a per-bay refresh.",
    tiers: ["+2 run charges", "+4 run charges", "+6 run charges"],
    current: (t) => (t === 0 ? "no charges" : `${t * 2} run charges`),
    step: () => ({ dir: "up", text: "+2 charges" }),
    apply(_cfg, _tier) {
      // Charges are now granted once per run via RunState.bondBreakerCharges
      // (newRun initialises them from the loadout's bonds tier × 2), not
      // refilled every bay. The apply hook is intentionally a no-op so that
      // levelForRun's applyUpgrades call does not add per-bay charges on top;
      // levelForRun then writes cfg.bondBreakerCharges = run.bondBreakerCharges
      // to inject the remaining run pool into the level config.
    },
  },
  {
    id: "demolition",
    name: "Demolition Rack",
    glyph: "DEM",
    blurb: "Demolition charges every bay — sell a dead pile back for cash.",
    tiers: ["+1 charge per bay", "+2 charges per bay", "+3 charges per bay"],
    current: (t) => (t === 0 ? "no charges" : `+${t} charge${t === 1 ? "" : "s"}/bay`),
    step: () => ({ dir: "up", text: "+1 charge" }),
    apply(cfg, tier) {
      // The exact shape of the `bonds` track, and for the same reason: a
      // charge you can PLAN for beats a charge you might be dealt. Demolition
      // is slag's only clean answer (a slag cube is worth $0 as line material
      // and salvagePerCube as scrap, so bombing it is strictly positive
      // value), and leaving that answer to a draft shuffle meant a player who
      // had paid for it went whole runs without one.
      cfg.bombCharges += tier;
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

/** Ladder cost of every track maxed: 6 tracks x (20+35+55) = 660. Derived, not
 *  typed in, so re-pricing TIER_COSTS or adding a seventh system can't leave a
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
