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
export type UpgradeId = "bay" | "launcher" | "hydraulics" | "magazine" | "reactor" | "bonds";

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
  /** Per-tier effect copy, index 0 = tier 1. Shown on the refit card so the
   *  player can see the whole ladder before committing to tier 1. */
  tiers: [string, string, string];
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
    apply(cfg, tier) {
      cfg.startingFunds += 60 * tier;
      cfg.scorePerLine += 15 * tier;
    },
  },
  {
    id: "bonds",
    name: "Bond Emitter",
    glyph: "BND",
    blurb: "Bond Breaker charges every bay — shatter the field flat on demand.",
    tiers: ["+1 charge per bay", "+2 charges per bay", "+3 charges per bay"],
    apply(cfg, tier) {
      // Bond Breakers are the compaction answer for any build whose pieces
      // don't flatten their own pile — most of all the light tiny build, whose
      // cubes are too light for weight alone to square off the layers below
      // (see pieces.ts's SIZE_SPEC). Buying them as a SYSTEM (rather than
      // hoping the Bond Breaker mod shows up in a draft) is what makes the
      // Autoloader endgame something you can plan for.
      cfg.bondBreakerCharges += tier;
    },
  },
];

export type UpgradeTiers = Record<UpgradeId, number>;

export function newTiers(): UpgradeTiers {
  return { bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0, bonds: 0 };
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

/** Total scrap sunk into a set of tiers — shown on the refit/end screens so a
 *  run's build reads as an investment, not just a list of chips. */
export function scrapInvested(tiers: UpgradeTiers): number {
  let total = 0;
  for (const def of UPGRADES) {
    const tier = Math.min(MAX_TIER, tiers[def.id] ?? 0);
    for (let t = 0; t < tier; t++) total += TIER_COSTS[t];
  }
  return total;
}
