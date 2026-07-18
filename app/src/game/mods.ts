import type { LevelConfig } from "./level";

/**
 * A drafted modifier: picked once between levels, then stacks for the rest of
 * the run (see run.ts's RunState.modIds). `apply` mutates the LevelConfig
 * copy applyMods hands it, one mod at a time in pick order — mods never see
 * or touch each other directly, but each sees the field values the previous
 * ones already changed, so order can matter ACROSS different mods too, not
 * just a mod compounding with itself (e.g. Premium then Half Shipments rounds
 * -40% off a launchCost that already includes Premium's +$5, landing on a
 * different number than Half Shipments first). This is accepted roguelite
 * behavior: drafts apply in the order picked.
 */
export interface ModDef {
  id: string;
  name: string;
  /** Short arcade card copy with the exact numbers this pick changes. */
  desc: string;
  kind: "boon" | "bane" | "tradeoff";
  /** Whether this mod can be drafted again after already being owned. */
  stackable: boolean;
  apply(cfg: LevelConfig): void;
}

export const MODS: ModDef[] = [
  {
    id: "overclock",
    name: "Overclock",
    desc: "Compactor moves 50% faster · −20s on the clock",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.compactorSpeed *= 1.5;
      cfg.timeLimitSec = Math.max(60, cfg.timeLimitSec - 20);
    },
  },
  {
    id: "wide-bay",
    name: "Wide Bay",
    desc: "+2 open-bay cells (cap 18)",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.compactorOpenCells = Math.min(18, cfg.compactorOpenCells + 2);
    },
  },
  {
    id: "sturdy",
    name: "Sturdy Shipments",
    desc: "×1.35 joint break stretch, +0.05 joint stiffness. Pieces hold together — clean if you aim well, but they won't shatter into fillers.",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.jointBreakStretch *= 1.35;
      cfg.jointStiffness = Math.min(0.99, cfg.jointStiffness + 0.05);
    },
  },
  {
    id: "half",
    name: "Half Shipments",
    desc: "Dominoes (2 cubes/piece), −40% launch cost. Precise little dominoes, cheaper launches, less material per shot.",
    kind: "tradeoff",
    stackable: false,
    apply(cfg) {
      cfg.pieceCubes = 2;
      cfg.launchCost = Math.round(cfg.launchCost * 0.6);
    },
  },
  {
    id: "bombs",
    name: "Bomb Shipments",
    desc: "Every Nth launch is a bomb (starts at 5, tightens by 1 per stack, floor 3) — great for clearing junk, pays nothing.",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.bombEvery = cfg.bombEvery === 0 ? 5 : Math.max(3, cfg.bombEvery - 1);
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
    stackable: true,
    apply(cfg) {
      cfg.compactorMinLineCells = Math.max(6, cfg.compactorMinLineCells - 1);
      cfg.scorePerLine = Math.max(50, cfg.scorePerLine - 25);
    },
  },
  {
    id: "heavy",
    name: "Heavy Cargo",
    desc: "×1.15 gravity, +$25 per line. Flatter arcs, better pay.",
    kind: "tradeoff",
    stackable: true,
    apply(cfg) {
      cfg.gravity *= 1.15;
      cfg.scorePerLine += 25;
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
 * level. Non-stackable mods the player already owns are excluded from the
 * pool; everything else (stackable mods, and not-yet-owned non-stackables) is
 * eligible. Same seed + levelIndex + ownedIds always yields the same offers.
 */
export function draftOffers(
  seed: number,
  levelIndex: number,
  ownedIds: string[],
  count = 3,
): ModDef[] {
  const rng = mulberry32((seed ^ ((levelIndex + 1) * 0x9e3779b9)) >>> 0);
  const eligible = MODS.filter((m) => m.stackable || !ownedIds.includes(m.id));

  // Fisher-Yates shuffle, then take the first `count` — same pattern as any
  // seeded shuffle, just with the local rng instead of Math.random.
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
