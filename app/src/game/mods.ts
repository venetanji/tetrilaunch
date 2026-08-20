import type { LevelConfig } from "./level";

/**
 * A drafted modifier: picked once between levels, then stacks for the rest of
 * the run (see run.ts's RunState.modIds). `apply` mutates the LevelConfig
 * copy applyMods hands it, one mod at a time in pick order — mods never see
 * or touch each other directly, but each sees the field values the previous
 * ones already changed, so order can matter ACROSS different mods too, not
 * just a mod compounding with itself (e.g. Premium then Micro Shipments rounds
 * -40% off a launchCost that already includes Premium's +$5, landing on a
 * different number than Micro Shipments first). This is accepted roguelite
 * behavior: drafts apply in the order picked.
 *
 * Mods run AFTER the run's ship upgrades (see run.ts's levelForRun and
 * upgrades.ts) — a contract's multipliers compound on top of whatever ship you
 * refitted, which is the intended reading. The two systems are deliberately
 * different in kind: a mod is a hand you were DEALT (three seeded offers, often
 * a trade-off), an upgrade is capital you CHOSE to spend from a fully-visible
 * menu.
 */
export interface ModDef {
  id: string;
  name: string;
  /** Short arcade card copy with the exact numbers this pick changes. */
  desc: string;
  kind: "boon" | "bane" | "tradeoff";
  /** Whether this mod can be drafted again after already being owned. */
  stackable: boolean;
  /** Meta-progression unlock id (see meta.ts's UNLOCKS) that must be PURCHASED
   *  for this mod to appear in the draft pool at all. Undefined = always
   *  available. This is the seam that makes salvage spent in the Workshop
   *  change what a run can BE, rather than just making it numerically stronger.
   *
   *  Most mods now carry one — the modifier list IS the unlock tree. Note what
   *  is bought: the right for a mod to be OFFERED, never the mod itself. The
   *  draft still deals a choice and you still make it, so salvage buys an
   *  option rather than power, which is the constraint meta.ts sets out.
   *
   *  Exactly four are left free — Overtime, Premium Contracts, Ballast Load,
   *  Rapid Loader. They are the plain tradeoffs, none of which defines a build,
   *  so a player who has bought nothing still gets a real draft on their first
   *  run instead of an empty one. Four matters against meta.ts's DRAFT_BASE_SLOTS
   *  of two: the free pool has to out-number the slots or run one deals the same
   *  hand every time. */
  unlock?: string;
  /** Mod ids that must already be owned THIS RUN for this one to be offered — a
   *  synergy prerequisite, not a cost. Used by the Autoloader, which only makes
   *  sense on top of the micro build it is the endgame of. */
  requiresMods?: string[];
  apply(cfg: LevelConfig): void;
}

export const MODS: ModDef[] = [
  {
    id: "overclock",
    name: "Overclock",
    desc: "Compactor moves 50% faster · −20s on the clock",
    kind: "tradeoff",
    unlock: "overclock",
    stackable: true,
    apply(cfg) {
      cfg.compactorSpeed *= 1.5;
      cfg.timeLimitSec = Math.max(60, cfg.timeLimitSec - 20);
    },
  },
  {
    id: "sturdy",
    name: "Sturdy Shipments",
    desc: "×1.35 joint break stretch, +0.05 joint stiffness. Pieces hold together — clean if you aim well, but they won't shatter into fillers.",
    kind: "tradeoff",
    unlock: "sturdy",
    stackable: true,
    apply(cfg) {
      cfg.jointBreakStretch *= 1.35;
      cfg.jointStiffness = Math.min(0.99, cfg.jointStiffness + 0.05);
    },
  },
  {
    id: "micro",
    name: "Micro Shipments",
    desc: "2-cube dominoes · −40% launch cost. Cheap, precise, brittle — and too light to square up the pile below them.",
    kind: "tradeoff",
    unlock: "micro",
    stackable: false,
    apply(cfg) {
      cfg.pieceSize = "tiny";
      cfg.launchCost = Math.round(cfg.launchCost * 0.6);
    },
  },
  {
    id: "bulk",
    name: "Bulk Shipments",
    desc: "5-cube pentominoes · +50% launch cost · +$40 per line. Rigid, and heavy enough that landing presses the layers below flat.",
    kind: "tradeoff",
    stackable: false,
    unlock: "bulk",
    apply(cfg) {
      cfg.pieceSize = "bulk";
      cfg.launchCost = Math.round(cfg.launchCost * 1.5);
      cfg.scorePerLine += 40;
    },
  },
  {
    id: "demo",
    name: "Demolition Charges",
    desc: "+2 charges per bay. Arm one (💥 / X) and the next launch is a FREE bomb, refunding $8 per cube it vaporizes. Sells a dead pile back for cash.",
    kind: "boon",
    stackable: true,
    unlock: "demo",
    apply(cfg) {
      cfg.bombCharges += 2;
    },
  },
  {
    id: "autoloader",
    name: "Autoloader",
    desc: "HOLD the ⚡F trigger to fire every 420ms in a loose spread AROUND YOUR AIM, half launch cost. Volume over precision — bring Bond Breakers.",
    kind: "tradeoff",
    stackable: false,
    unlock: "auto",
    requiresMods: ["micro"],
    apply(cfg) {
      cfg.autoLaunchMs = 420;
      cfg.launchCost = Math.max(4, Math.round(cfg.launchCost * 0.5));
      cfg.cooldownMs = Math.min(cfg.cooldownMs, 420);
    },
  },
  {
    id: "overtime",
    name: "Overtime",
    desc: "+30s on the clock, +$10 launch cost",
    kind: "boon",
    stackable: true,
    apply(cfg) {
      cfg.timeLimitSec += 30;
      cfg.launchCost += 10;
    },
  },
  {
    id: "premium",
    name: "Premium Contracts",
    desc: "+$50 per line, +$5 launch cost",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.scorePerLine += 50;
      cfg.launchCost += 5;
    },
  },
  {
    id: "short-lines",
    name: "Short Lines",
    desc: "−1 cell needed per line (floor 6), −$25 per line (floor $50)",
    kind: "tradeoff",
    unlock: "short-lines",
    stackable: true,
    apply(cfg) {
      cfg.compactorMinLineCells = Math.max(6, cfg.compactorMinLineCells - 1);
      cfg.scorePerLine = Math.max(50, cfg.scorePerLine - 25);
    },
  },
  {
    id: "heavy",
    name: "Ballast Load",
    desc: "×1.15 gravity, +$25 per line. Flatter arcs, harder landings, better pay.",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.gravity *= 1.15;
      cfg.scorePerLine += 25;
    },
  },
  {
    id: "bond-breaker",
    name: "Bond Breaker",
    desc: "ONE charge for the WHOLE RUN — not per bay. Press B (or ⚡) to shatter every joint into loose cubes: the pile slumps flat and packs into lines far more easily. Spend it on the bay that needs it most.",
    kind: "boon",
    unlock: "bond-breaker",
    stackable: true,
    apply(cfg) {
      cfg.bondBreakerCharges += 1;
    },
  },
  {
    id: "rapid",
    name: "Rapid Loader",
    desc: "−35% cooldown, +$5 launch cost",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.cooldownMs = Math.round(cfg.cooldownMs * 0.65);
      cfg.launchCost += 5;
    },
  },
];

export function modById(id: string): ModDef | undefined {
  return MODS.find((m) => m.id === id);
}

/**
 * Small local seeded PRNG (mulberry32) — deterministic drafts for a given run
 * seed, and lets tests reproduce a specific draft without pulling in a real
 * RNG dependency.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Apply a run's drafted modifiers (in pick order) on top of a base
 * LevelConfig, without mutating `base`. Unknown ids are ignored — lets a
 * future save format drop/rename a mod without corrupting old runs.
 */
export function applyMods(base: LevelConfig, ids: string[]): LevelConfig {
  const cfg: LevelConfig = {
    ...base,
    pieceSequence: base.pieceSequence ? [...base.pieceSequence] : null,
  };
  for (const id of ids) {
    modById(id)?.apply(cfg);
  }
  return cfg;
}

/**
 * Deterministic draft of `count` modifier offers for a given run seed and
 * level. The eligible pool excludes:
 *  - non-stackable mods the player already owns,
 *  - mods whose meta-progression `unlock` hasn't been purchased (see meta.ts),
 *  - mods whose `requiresMods` synergy prerequisite isn't owned yet.
 * Same seed + levelIndex + ownedIds + unlocks always yields the same offers.
 *
 * `unlocks` defaults to [] so headless callers (sim/) and any code that doesn't
 * care about meta-progression see exactly the always-available pool.
 */
export function draftOffers(
  seed: number,
  levelIndex: number,
  ownedIds: string[],
  count = 3,
  unlocks: string[] = [],
): ModDef[] {
  const rng = mulberry32((seed ^ ((levelIndex + 1) * 0x9e3779b9)) >>> 0);
  const eligible = MODS.filter((m) => {
    if (!m.stackable && ownedIds.includes(m.id)) return false;
    if (m.unlock && !unlocks.includes(m.unlock)) return false;
    if (m.requiresMods && !m.requiresMods.every((r) => ownedIds.includes(r))) return false;
    return true;
  });

  // Fisher-Yates shuffle, then take the first `count` — same pattern as any
  // seeded shuffle, just with the local rng instead of Math.random.
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
