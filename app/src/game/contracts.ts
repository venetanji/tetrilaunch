/**
 * CONTRACTS — the short, repeatable, generated half of the game.
 *
 * Deep Run is the exam: ten bays, permadeath, a clock and a bankroll. A Contract
 * is the opposite by design (docs/DESIGN.md): one bay, no clock, no launch cost,
 * failure costs nothing, and you can retry it forever. It is meant to be the
 * easy, positive, replayable half — a puzzle you return to, not a thing that can
 * beat you.
 *
 * What replaces time and money pressure is the LAUNCH BUDGET: a Contract gives
 * you N launches to hit the goal. Firing is still free — you just have a finite
 * number of shipments to do it with.
 *
 * This used to be a budget of compactor PRESS STROKES, which was wrong twice
 * over. Strokes elapse on a wall clock whether or not you fire, so the budget
 * was a hidden timer — you could lose a Contract by thinking, in the one mode
 * whose whole premise is that it can't rush you. And because strokes pass at a
 * fixed rate, a slower player got fewer shots inside the same budget, so the
 * identical Contract was harder for them. Measured aim time on device is 1446ms
 * against a 900ms cooldown, so that penalty landed on real players.
 *
 * Launches have neither problem: the budget is spent only by acting, and it is
 * worth exactly the same to a fast player and a slow one. It is also checkable
 * in closed form, which is what makes the feasibility guarantee below possible.
 *
 * Generated rather than authored. A hand-built map is a content treadmill nobody
 * on this project has time to feed, so a Contract is seed + template + a
 * DIFFICULTY BUDGET: every element carries a weighted cost and the generator
 * spends a scalar derived from the tier. That is what separates this from
 * randomness — difficulty is a number we spend, not an accident of the roll.
 */
import { makeBaseLevel, type LevelConfig } from "./level";
import { SIZE_SPEC } from "./pieces";
import { PIECE_TYPES, type PieceSize, type PieceType } from "./theme";

/**
 * Objectives a Contract can ask for. Deliberately small: every one of these has
 * to be legible in a single line of HUD copy, and a Contract the player can't
 * restate in their own words is a bad Contract.
 *
 *  - "lines"   — clear N lines, you have M launches. A budgeted version of what
 *                Deep Run asks for.
 *  - "pattern" — here is the EXACT set of shipments that tiles the goal, land
 *                them. No launch budget, because the queue is the budget; the
 *                piece queue stops being a random stream and becomes a designed
 *                object, which turns the bay into a planning problem instead of
 *                a physics grind. Deep Run can't copy this — its queue has to
 *                stay random for its own reasons.
 */
export type ObjectiveKind = "lines" | "pattern";

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
  /** Launches allowed, for a "lines" Contract. Derived from the goal via the
   *  feasibility model in `launchesFor`, never rolled — see the note there.
   *  0 on a "pattern" Contract, which is limited by its queue instead. */
  launches: number;
  /** The exact shipment inventory of a "pattern" Contract, in canonical order
   *  (the SET, which is what the card advertises and what the id reproduces).
   *  The ORDER it is played in is re-rolled per attempt — see levelForContract.
   *  Empty on a "lines" Contract. */
  queue: PieceType[];
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
const COST = { wind: 2, micro: 2, bulk: 1, tightLaunches: 2 } as const;

const NAMES = [
  "Backlog Clearance", "Night Shift", "Overflow Dock", "Salvage Lot",
  "Quota Run", "Short Haul", "Scrap Line", "Holding Bay",
] as const;

/* -------------------------------------------------------------------------
 * FEASIBILITY
 *
 * An impossible Contract is the single worst thing this generator can emit, so
 * the budget is derived from the goal rather than rolled beside it.
 *
 * A clearable line spans the compaction zone at full advance —
 * `compactorMinLineCells` = 8 cubes. So the cubes a goal requires is
 * `goal * 8`, and the cubes a launch delivers is `SIZE_SPEC[size].cubes`. What
 * separates those two numbers is how much of what you fire actually ends up in
 * a completed line: cubes are lost off the wrong side, and whatever is left in
 * a part-built row when the bay ends is waste.
 *
 * The measured value, from the OnePlus 12 playtest session (67 shots, 23 lines,
 * std pieces): 23*8 / 67*4 = 0.687.
 *
 * PLANNING_EFFICIENCY is deliberately set BELOW that. The measurement is one
 * session, on one device, at one piece size, by one player — and the cost of
 * being wrong is asymmetric. Too generous a budget makes a Contract slightly
 * dull; too tight makes it unwinnable, which for "the easy, positive,
 * replayable half" is fatal. It should be revisited per piece size once the
 * sweep telemetry lands (docs/superpowers/specs/2026-07-30-sweep-telemetry-design.md),
 * since bulk pentominoes almost certainly pack worse than std tetrominoes.
 * ---------------------------------------------------------------------- */

/** Cubes needed to span the compaction zone at full advance — one line. Kept
 *  in sync with level.ts's compactorMinLineCells by a test in sim/systems.ts. */
export const CUBES_PER_LINE = 8;

/** Share of launched cubes that reach a completed line. Conservative; see above. */
export const PLANNING_EFFICIENCY = 0.6;

/** Headroom over the bare feasibility floor. A Contract is meant to be
 *  winnable on a decent attempt, not a perfect one. */
const SLACK = 1.25;
const SLACK_TIGHT = 1.05;

/**
 * Launches required for `goal` lines of `size` pieces, at `slack` headroom.
 * Exported so sim/systems.ts asserts against the same function the generator
 * uses — a feasibility guarantee that re-derives the number independently would
 * only prove the two copies agree.
 */
export function launchesFor(goal: number, cubesPerPiece: number, slack: number): number {
  const cubesNeeded = goal * CUBES_PER_LINE;
  const cubesPerLaunch = cubesPerPiece * PLANNING_EFFICIENCY;
  return Math.max(3, Math.ceil((cubesNeeded / cubesPerLaunch) * slack));
}

/* -------------------------------------------------------------------------
 * PATTERN CONTRACTS — exact-inventory puzzles.
 *
 * The queue is precisely the cubes the goal needs and not one more. One
 * shipment off the side, or one shatter that strands a cube, and the attempt
 * is over (game.ts's objectiveUnreachable calls it the moment it becomes true,
 * rather than letting a dead bay run on).
 *
 * That is a demanding ask and the number says so: measured efficiency — the
 * share of launched cubes reaching a completed line — is 0.62 in the browser
 * and 0.69 on device, so about a third of fired cubes currently go nowhere.
 * Zero waste asks for roughly 1.5x better than anyone has yet played. It is
 * taken with that on the table because retrying costs nothing and takes
 * seconds; if it turns out merely tedious rather than satisfying, the fix is
 * SPARE_SHIPMENTS below, not a nudge to the physics tolerances.
 *
 * One thing this game does NOT need, which a tetromino puzzle normally would:
 * a tiling proof. Pieces do not keep their shape here — the compactor shatters
 * whatever it presses (pieces.ts's breakJointsInBand) and lineClear.ts fills
 * rows slot by slot from LOOSE cubes. So geometry never makes an exact set
 * impossible; only delivery does. Piece TYPE still matters for how hard that
 * delivery is, which is what the tier pool below scales.
 * ---------------------------------------------------------------------- */

/**
 * Spare shipments granted above the exact requirement. 0 is the design: the
 * inventory is exactly the cubes needed. This is the single constant the spec
 * names as the fix if playtesting says zero waste is unfun — one spare piece
 * is a change of tolerance the player can feel, where loosening the physics
 * would quietly change every other mode too.
 */
export const SPARE_SHIPMENTS = 0;

/**
 * Which piece types a tier draws from. I and O settle flat and pack cleanly;
 * L and J need a rotation thought through; S, Z and T tip, wedge and strand
 * cubes. With no tiling constraint to worry about, this IS the difficulty
 * ladder for a pattern Contract.
 */
function patternPool(tier: number): PieceType[] {
  if (tier <= 2) return ["I", "O"];
  if (tier <= 5) return ["I", "O", "L", "J"];
  return [...PIECE_TYPES];
}

/**
 * Lines a pattern Contract asks for. Lower than a "lines" Contract's goal and
 * it climbs far more slowly, because zero waste makes every additional line a
 * multiplicative risk rather than an additive one: a 4-line pattern needs 32
 * consecutive cubes placed perfectly, not 4 independent tries at 8.
 */
function patternGoal(tier: number): number {
  return 2 + Math.min(2, Math.floor((Math.max(1, tier) - 1) / 3));
}

/**
 * Build the exact inventory for `goal` lines. Std tetrominoes only, and that is
 * an arithmetic constraint rather than a preference: a queue is exact only if
 * `goal * CUBES_PER_LINE` divides by the piece's cube count. 4 always divides
 * 8*goal; 5 (bulk) only does when goal is a multiple of 5, which would put the
 * smallest legal bulk pattern at 40 cubes. Micro (2) divides fine but is the
 * size playtesting found tedious (docs/DESIGN.md), and tedium is the exact
 * failure mode a zero-waste objective is already closest to.
 */
function patternQueue(goal: number, tier: number, rng: () => number): PieceType[] {
  const pool = patternPool(tier);
  const count = (goal * CUBES_PER_LINE) / SIZE_SPEC.std.cubes + SPARE_SHIPMENTS;
  const picked = Array.from({ length: count }, () => pool[Math.floor(rng() * pool.length)]);
  // Canonical order, so the card, the id and any leaderboard all describe the
  // same set the same way. What the player actually receives is shuffled per
  // attempt (levelForContract) — see the note there.
  return picked.sort((a, b) => PIECE_TYPES.indexOf(a) - PIECE_TYPES.indexOf(b));
}

function generatePatternContract(seed: number, tier: number, slot: number): Contract {
  const rng = mulberry32(seed + slot * 7919);
  const goal = patternGoal(tier);
  const queue = patternQueue(goal, tier, rng);
  return {
    id: `${seed}-${tier}-${slot}`,
    seed: seed + slot * 7919,
    tier,
    name: NAMES[(seed + slot * 3) % NAMES.length],
    kind: "pattern",
    goal,
    launches: 0,
    queue,
    pieceSize: "std",
    // Never any wind, at any tier. A zero-waste objective plus a lateral force
    // the player can't fully cancel is not a puzzle, it's a dice roll — so the
    // difficulty budget has nothing to spend here either.
    windMax: 0,
    brief: `${queue.length} shipments, no waste`,
  };
}

export function generateContract(seed: number, tier: number, slot = 0): Contract {
  if (slot % DAILY_COUNT === PATTERN_SLOT) return generatePatternContract(seed, tier, slot);
  const rng = mulberry32(seed + slot * 7919);
  let budget = budgetForTier(tier);

  const goal = 3 + Math.floor(rng() * 3) + Math.min(3, Math.floor(tier / 2));

  let pieceSize: PieceSize = "std";
  let windMax = 0;
  let slack = SLACK;
  const notes: string[] = [];

  // Wind scales with tier rather than rolling free. A first-tier Contract
  // drawing the same crosswind as bay 8 of a Deep Run is exactly the "unfair,
  // and you could see it coming" failure the weather rework existed to remove.
  const windCap = Math.min(0.3, 0.05 + Math.max(0, tier - 1) * 0.03);

  const options: { id: keyof typeof COST; apply: () => void; note: string }[] = [
    { id: "bulk", apply: () => { pieceSize = "bulk"; }, note: "bulk pentominoes" },
    { id: "wind", apply: () => { windMax = windCap * (0.6 + rng() * 0.4); }, note: "crosswind" },
    { id: "tightLaunches", apply: () => { slack = SLACK_TIGHT; }, note: "tight launch budget" },
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
  const LEAD: (keyof typeof COST)[][] = [["wind"], ["bulk", "micro", "tightLaunches"]];
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

  // Computed AFTER the complication loop: piece size decides how many cubes a
  // launch delivers, so a budget fixed before it would be wrong for every
  // Contract that drew bulk or micro.
  const launches = launchesFor(goal, SIZE_SPEC[pieceSize].cubes, slack);

  return {
    id: `${seed}-${tier}-${slot}`,
    seed: seed + slot * 7919,
    tier,
    name: NAMES[(seed + slot * 3) % NAMES.length],
    kind: "lines",
    goal,
    launches,
    queue: [],
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

/**
 * Which daily slot is the pattern Contract. Fixed rather than rolled so the
 * board always offers one of each flavour — a player who wants the planning
 * puzzle can find it every day, and one who doesn't still has two launch-budget
 * Contracts. It CONVERTS a slot rather than adding a fourth: the daily count is
 * what Unlimited sells (docs/DESIGN.md), so quietly raising it would be a
 * monetization change wearing a content change's clothes.
 */
export const PATTERN_SLOT = 2;

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
 *
 * `rng` orders a pattern Contract's queue and defaults to Math.random — i.e.
 * UNSEEDED, deliberately, which is the one place a Contract is not reproducible
 * from its id. The set is seeded and shared; the order is re-rolled on every
 * attempt. The alternative is worse than it looks: if the order were seeded
 * too, then one unlucky permutation would make that Contract permanently
 * unwinnable for every player who drew it, and free retries would hand back the
 * identical bad order forever. That is the same defect class as the launch
 * budgets that turned out 35% infeasible, and it is undetectable without
 * solving the physics. Re-rolling costs a determinism the leaderboard doesn't
 * need — the SET is the challenge, and everyone gets the same one.
 */
export function levelForContract(c: Contract, rng: () => number = Math.random): LevelConfig {
  const cfg = makeBaseLevel(Math.min(9, c.tier));
  cfg.id = 1;
  cfg.name = c.name;
  cfg.launchCost = 0;
  cfg.timeLimitSec = 0;
  cfg.targetScore = Number.MAX_SAFE_INTEGER;
  cfg.objectiveLines = c.goal;
  cfg.pieceSize = c.pieceSize;
  cfg.windMax = c.windMax;
  cfg.windGust = c.windMax * 0.025;
  // The two limits are alternatives, never both: a pattern bay is bounded by
  // its queue and a lines bay by its launch budget, and a bay carrying both
  // would be counting the same limit twice under two names.
  if (c.kind === "pattern") {
    cfg.launchBudget = 0;
    cfg.pieceQueue = shuffleSeeded(c.queue, rng);
  } else {
    cfg.launchBudget = c.launches;
    cfg.pieceQueue = null;
  }
  // Nothing is spent, so nothing needs to be earned back.
  cfg.startingFunds = 0;
  cfg.penaltyPerLostPiece = 0;
  return cfg;
}
