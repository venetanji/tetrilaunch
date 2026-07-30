/**
 * CONTRACTS — the short, repeatable, generated half of the game.
 *
 * Deep Run is the exam: ten bays, permadeath, a clock and a bankroll. A Contract
 * is the opposite by design (docs/DESIGN.md): one bay, no clock, no launch cost,
 * failure costs nothing, and you can retry it forever. It is meant to be the
 * easy, positive, replayable half — a puzzle you return to, not a thing that can
 * beat you.
 *
 * What replaces time and money pressure is the STROKE BUDGET. With launches free
 * and nothing counting down, a Contract would otherwise be brute-forceable by
 * firing until the pile happens to resolve — so the compactor's own press count
 * becomes the constraint, which is both the readable unit ("clear this in 6
 * strokes") and a reason for the player to think about the compactor at all.
 *
 * Generated rather than authored. A hand-built map is a content treadmill nobody
 * on this project has time to feed, so a Contract is seed + template + a
 * DIFFICULTY BUDGET: every element carries a weighted cost and the generator
 * spends a scalar derived from the tier. That is what separates this from
 * randomness — difficulty is a number we spend, not an accident of the roll.
 */
import { makeBaseLevel, type LevelConfig } from "./level";
import type { PieceSize } from "./theme";

/** Objectives a Contract can ask for. Deliberately small to start: every one of
 *  these has to be legible in a single line of HUD copy, and a Contract the
 *  player can't restate in their own words is a bad Contract. */
export type ObjectiveKind = "lines";

export interface Contract {
  /** Stable id — the daily seed plus its slot, so a Contract can be recorded,
   *  compared across players and re-generated identically. */
  id: string;
  seed: number;
  tier: number;
  name: string;
  kind: ObjectiveKind;
  /** Lines required. */
  goal: number;
  strokes: number;
  pieceSize: PieceSize;
  /** Lateral wind cap, 0 for a calm bay. */
  windMax: number;
  /** One-line brief shown on the card. */
  brief: string;
}

/* -------------------------------------------------------------------------
 * Seeded RNG. Contracts must regenerate identically from an id alone —
 * the daily set is the same for every player, and a per-Contract board is
 * meaningless if the bay differs between them.
 * ---------------------------------------------------------------------- */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. `sort(() => rng() - 0.5)` is not a shuffle — it's biased, and
 *  its bias depends on the engine's sort implementation, which would make a
 *  "daily" Contract differ between browsers. */
function shuffleSeeded<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Difficulty budget for a tier. Tier 1 buys a plain calm bay; higher tiers can
 * afford complications. Linear and small on purpose — the budget's job is to
 * keep a tier's Contracts comparable to each other, not to be a second
 * progression curve.
 */
export function budgetForTier(tier: number): number {
  return 2 + Math.max(0, Math.floor(tier) - 1) * 2;
}

/** Cost of each complication, in difficulty-budget points. */
const COST = { wind: 2, micro: 2, bulk: 1, tightStrokes: 2 } as const;

const NAMES = [
  "Backlog Clearance", "Night Shift", "Overflow Dock", "Salvage Lot",
  "Quota Run", "Short Haul", "Scrap Line", "Holding Bay",
] as const;

/**
 * Generate one Contract from a seed and tier.
 *
 * The stroke budget is derived from the goal rather than rolled independently:
 * a Contract that asks for 5 lines in 3 strokes is not hard, it's impossible,
 * and an impossible Contract is the single worst thing a generator can emit.
 * STROKES_PER_LINE is the slack a competent player is expected to need; the
 * `tightStrokes` complication is the only thing that cuts it, and only when the
 * budget can pay for it.
 */
const STROKES_PER_LINE = 2.2;

export function generateContract(seed: number, tier: number, slot = 0): Contract {
  const rng = mulberry32(seed + slot * 7919);
  let budget = budgetForTier(tier);

  const goal = 3 + Math.floor(rng() * 3) + Math.min(3, Math.floor(tier / 2));

  let pieceSize: PieceSize = "std";
  let windMax = 0;
  let strokeSlack = STROKES_PER_LINE;
  const notes: string[] = [];

  // Wind scales with tier rather than rolling free. A first-tier Contract
  // drawing the same crosswind as bay 8 of a Deep Run is exactly the "unfair,
  // and you could see it coming" failure the weather rework existed to remove.
  const windCap = Math.min(0.3, 0.05 + Math.max(0, tier - 1) * 0.03);

  const options: { id: keyof typeof COST; apply: () => void; note: string }[] = [
    { id: "bulk", apply: () => { pieceSize = "bulk"; }, note: "bulk pentominoes" },
    { id: "wind", apply: () => { windMax = windCap * (0.6 + rng() * 0.4); }, note: "crosswind" },
    { id: "tightStrokes", apply: () => { strokeSlack = STROKES_PER_LINE - 0.5; }, note: "tight press budget" },
    // Micro is generated but rare: playtesting found the 2-cube payload tedious
    // rather than merely weak (see docs/DESIGN.md), so it stays in the pool as a
    // known-rough option instead of being a third of every draw.
    { id: "micro", apply: () => { pieceSize = "tiny"; }, note: "micro dominoes" },
  ];

  // The budget gates WHICH complications are affordable; this caps HOW MANY.
  // Without it the generator spends the budget exhaustively, so every Contract
  // above a threshold carries every complication and the whole tier collapses
  // into one bay wearing different names. Variety is the point of generating.
  const maxComplications = Math.min(3, 1 + Math.floor(tier / 3));

  // Each slot in a day leads with a DIFFERENT axis, so the three Contracts on
  // offer are three different problems rather than three rolls of one die. With
  // only four complications in the pool, independent rolls converge hard at
  // higher tiers — every Contract ends up carrying nearly the same set. Leading
  // with a rotated axis makes the daily set read as curated, which is also just
  // a better offer: pick the challenge you feel like, not the least-bad roll.
  const LEAD: (keyof typeof COST)[][] = [["wind"], ["bulk", "micro"], ["tightStrokes"]];
  const lead = LEAD[slot % LEAD.length];
  const ordered = [
    ...options.filter((o) => lead.includes(o.id)),
    ...shuffleSeeded(options.filter((o) => !lead.includes(o.id)), rng),
  ];

  for (const opt of ordered) {
    if (notes.length >= maxComplications) break;
    if (COST[opt.id] > budget) continue;
    // Piece size is one slot: bulk and micro can't both apply.
    if ((opt.id === "micro" || opt.id === "bulk") && pieceSize !== "std") continue;
    // Micro stays rare even when it leads — see the note on the option itself.
    if (opt.id === "micro" && !lead.includes("micro")) continue;
    if (opt.id === "micro" && rng() > 0.4) continue;
    budget -= COST[opt.id];
    opt.apply();
    notes.push(opt.note);
  }

  const strokes = Math.max(3, Math.ceil(goal * strokeSlack));

  return {
    id: `${seed}-${tier}-${slot}`,
    seed: seed + slot * 7919,
    tier,
    name: NAMES[(seed + slot * 3) % NAMES.length],
    kind: "lines",
    goal,
    strokes,
    pieceSize,
    windMax,
    brief: notes.length ? notes.join(" · ") : "clean bay",
  };
}

/**
 * The day's Contracts. Every player gets the same set from the same date, which
 * is what makes a per-Contract leaderboard mean anything and what makes the
 * daily a shared thing to talk about rather than a private shuffle.
 */
export function dailySeed(d = new Date()): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export const DAILY_COUNT = 3;

export function dailyContracts(tier: number, seed = dailySeed()): Contract[] {
  return Array.from({ length: DAILY_COUNT }, (_, i) => generateContract(seed, tier, i));
}

/**
 * The playable level for a Contract. Built off the standard ladder so a bay
 * still looks and feels like Tetrilaunch, then stripped of the two pressures
 * Contracts deliberately don't have:
 *
 *   launchCost 0   — no bankroll, so firing is never a spending decision, and
 *                    the broke-loss can't trigger (score >= 0 always holds).
 *   timeLimitSec 0 — no clock. A puzzle you can be rushed out of isn't one.
 *
 * targetScore is set unreachably high rather than to 0: the funds path must
 * never be what ends a Contract, and a 0 target would win the bay on the first
 * frame. objectiveLines is the real win condition (see game.ts's objectiveMet).
 */
export function levelForContract(c: Contract): LevelConfig {
  const cfg = makeBaseLevel(Math.min(9, c.tier));
  cfg.id = 1;
  cfg.name = c.name;
  cfg.launchCost = 0;
  cfg.timeLimitSec = 0;
  cfg.targetScore = Number.MAX_SAFE_INTEGER;
  cfg.objectiveLines = c.goal;
  cfg.strokeBudget = c.strokes;
  cfg.pieceSize = c.pieceSize;
  cfg.windMax = c.windMax;
  cfg.windGust = c.windMax * 0.025;
  // Nothing is spent, so nothing needs to be earned back.
  cfg.startingFunds = 0;
  cfg.penaltyPerLostPiece = 0;
  return cfg;
}
