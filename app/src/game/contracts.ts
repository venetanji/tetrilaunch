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
import { makeBaseLevel, NO_MATERIALS, type LevelConfig } from "./level";
import { SIZE_SPEC } from "./pieces";
import { tilingQueue } from "./tiling";
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
 * This used to claim the game needed no tiling proof, on the grounds that
 * pieces don't keep their shape — the compactor shatters whatever it presses
 * (pieces.ts's breakJointsInBand) and lineClear.ts fills rows slot by slot from
 * LOOSE cubes, so geometry could never make an exact set impossible.
 *
 * That was wrong, and it shipped Contracts nobody could win. Shattering lets a
 * piece's cubes separate; it does not move a cube sideways under an overhang,
 * and it certainly doesn't conjure one to fill a hole. Zero waste means every
 * launched cube has to land inside a completed row, which makes the goal a
 * `goal` x `lineCells` rectangle — and a set that tiles no such rectangle is
 * unwinnable however it shatters. The generator emitted [I, O, J, J] for two
 * lines and [I, I, I, T, S, Z] for three; neither tiles.
 *
 * So the inventory is now built FROM a tiling (tiling.ts) rather than rolled
 * and hoped over, and sim/systems.ts re-checks every generated queue with an
 * independent solver.
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
 * Which piece types a tier is ALLOWED to draw from. I and O settle flat and
 * pack cleanly; L and J need a rotation thought through; S, Z and T tip, wedge
 * and strand cubes.
 *
 * This is now the softer half of the ladder — it bounds which shapes can turn
 * up, while `patternVariety` decides how many different ones a single Contract
 * mixes. Pool alone was a poor difficulty axis: it scaled per-shipment delivery
 * risk, which a pattern Contract already punishes hardest, rather than the
 * planning the mode is actually about.
 */
function patternPool(tier: number): PieceType[] {
  if (tier <= 2) return ["I", "O"];
  if (tier <= 5) return ["I", "O", "L", "J"];
  return [...PIECE_TYPES];
}

/**
 * How many DIFFERENT shipment types one Contract mixes — the real difficulty
 * ladder here. Four O shipments making two rows is a puzzle you can see whole;
 * the same two rows out of four different shapes has to be planned, because
 * each shape constrains where the next can go. That scales the thinking rather
 * than the delivery risk, which is the right axis for a planning mode.
 *
 * A ceiling, not a quota: tiling.ts prefers a queue that spends it but will
 * settle for one shape fewer rather than fail (see EXACT_ATTEMPTS there).
 */
/** How often a pattern Contract ships dominoes instead of tetrominoes, and the
 *  tier from which they can appear at all. Roughly one board slot in three, so
 *  a day's board mixes the two rather than committing to either — and never at
 *  tier 1, where the player is still learning what "no waste" costs. */
export const TINY_PATTERN_CHANCE = 0.34;
export const TINY_PATTERN_MIN_TIER = 2;

function patternVariety(tier: number): number {
  return 1 + Math.min(3, Math.floor((Math.max(1, tier) - 1) / 2));
}

/**
 * Lines a pattern Contract asks for. Lower than a "lines" Contract's goal and
 * it climbs far more slowly, because zero waste makes every additional line a
 * multiplicative risk rather than an additive one: a 4-line pattern needs 32
 * consecutive cubes placed perfectly, not 4 independent tries at 8.
 *
 * Nudged up when the region's area doesn't divide by 4. A queue is exact only
 * if `goal * lineCells` is a whole number of std tetrominoes, and it is also a
 * precondition for tiling at all — no set of 4-cube pieces fills an area that
 * isn't a multiple of 4. At today's 8-cell line every goal qualifies; this
 * exists so a narrower line (mods.ts's Short Lines takes it to 6, and level.ts
 * calls it a tunable seam) can't silently produce a Contract that is short a
 * cube by arithmetic.
 */
function patternGoal(tier: number, lineCells: number, size: PieceSize): number {
  let goal = 2 + Math.min(2, Math.floor((Math.max(1, tier) - 1) / 3));
  // Tiny scales on the SHARED goal ladder and gets no bonus on top of it.
  // pieceCells returns one fixed domino whatever the type, so a domino
  // Contract has exactly one distinct shape and patternVariety has nothing to
  // grade — but the doubling is already inherent, because half-size shipments
  // means twice as many of them for the same goal (a goal of 4 is 8 tetrominoes
  // or 16 dominoes). Stacking an extra goal bonus on that compounded it to 24
  // perfect placements at tier 9, which against a measured 23% Contract clear
  // rate is a lottery rather than a puzzle.
  while ((goal * lineCells) % SIZE_SPEC[size].cubes !== 0) goal++;
  return goal;
}

/**
 * The payload size a pattern Contract ships.
 *
 * Tiny appears as a MIXED VARIANT at any tier rather than as a difficulty step,
 * because a domino Contract is not harder than a tetromino one — it is a
 * different test. Std is planning plus delivery; tiny is delivery alone, and
 * the telemetry says delivery is where Contracts actually fail (26 of 35 losses
 * were "ran out of pieces", not a queue nobody could arrange).
 *
 * Bulk is deliberately absent. Pentominoes tile a 10-wide line at every goal
 * from 2 to 6, but at the 8-wide line every tier actually ships, `goal * 8`
 * divides by 5 only at goal 5 — a 40-cube, 8-shipment monster or nothing. It
 * becomes available the day a wider line does.
 */
function patternSize(tier: number, rng: () => number): PieceSize {
  return rng() < TINY_PATTERN_CHANCE && tier >= TINY_PATTERN_MIN_TIER ? "tiny" : "std";
}

/**
 * Build the exact inventory for `goal` lines, as a tiling of the goal region.
 *
 * The all-I fallback can only fire if `tilingQueue` fails outright, which it
 * cannot for these sizes — every std pool contains I and a stack of horizontal
 * I pieces tiles any region whose width divides by 4, and a domino tiles any
 * even area at all. It is here because the alternative to a dull Contract is an
 * impossible one.
 */
function patternQueue(
  goal: number,
  tier: number,
  lineCells: number,
  rng: () => number,
  size: PieceSize,
): PieceType[] {
  const cubes = SIZE_SPEC[size].cubes;
  const tiled = tilingQueue(goal, lineCells, patternPool(tier), rng, patternVariety(tier), size);
  const queue = tiled ?? Array.from({ length: (goal * lineCells) / cubes }, () => "I" as PieceType);

  for (let i = 0; i < SPARE_SHIPMENTS; i++) queue.push(queue[Math.floor(rng() * queue.length)]);

  // Canonical order, so the card, the id and any leaderboard all describe the
  // same set the same way. What the player actually receives is shuffled per
  // attempt (levelForContract) — see the note there.
  return queue.sort((a, b) => PIECE_TYPES.indexOf(a) - PIECE_TYPES.indexOf(b));
}

/**
 * Cells a line spans in the bay this Contract will actually be played in.
 *
 * Read from the level rather than assumed to be CUBES_PER_LINE, because the
 * inventory is sized to it exactly and a wrong value is an unwinnable Contract
 * rather than a slightly-off one. Mirrors levelForContract's own tier clamp so
 * the two can never disagree.
 *
 * A row can CLEAR wider than this — the zone grows to compactorOpenCells as the
 * bar retreats, and lineClear.ts requires whatever the zone is at that moment.
 * The inventory can't be planned around that: a wider row eats more cubes than
 * a zero-waste budget has, so building one costs the player a later line. The
 * minimum is the only width guaranteed to be on offer every single sweep, which
 * makes it the only width an exact inventory can be sized to.
 */
function lineCellsForTier(tier: number): number {
  return makeBaseLevel(Math.min(9, tier)).compactorMinLineCells;
}

function generatePatternContract(seed: number, tier: number, slot: number): Contract {
  const rng = mulberry32(seed + slot * 7919);
  const lineCells = lineCellsForTier(tier);
  const size = patternSize(tier, rng);
  const goal = patternGoal(tier, lineCells, size);
  const queue = patternQueue(goal, tier, lineCells, rng, size);
  const shapes = new Set(queue).size;
  return {
    id: `${seed}-${tier}-${slot}`,
    seed: seed + slot * 7919,
    tier,
    name: NAMES[(seed + slot * 3) % NAMES.length],
    kind: "pattern",
    goal,
    launches: 0,
    queue,
    pieceSize: size,
    // Never any wind, at any tier. A zero-waste objective plus a lateral force
    // the player can't fully cancel is not a puzzle, it's a dice roll — so the
    // difficulty budget has nothing to spend here either.
    windMax: 0,
    // Std calls out the SHAPE count, because that (not the shipment count) is
    // what makes one tetromino pattern harder than another. Tiny has exactly
    // one shape by construction, so "1 shape" there would read as a bug rather
    // than a difficulty — it names the payload instead.
    brief: size === "tiny"
      ? `${queue.length} shipments · dominoes, no waste`
      : `${queue.length} shipments · ${shapes} shape${shapes === 1 ? "" : "s"}, no waste`,
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
  // NO MATERIALS in Contracts — set explicitly rather than left to inherit,
  // because inheriting it is only true by accident (makeBaseLevel defaults to
  // Mark 1, which is below every material's firstMark) and would silently stop
  // being true the day a Contract is generated at a Mark.
  //
  // This is a feasibility guarantee, not a taste call. Both Contract kinds
  // derive their limit from a model that assumes every launched cube CAN reach
  // a completed row: a pattern queue tiles the goal exactly, and `launchesFor`
  // prices a lines budget off cubes-needed ÷ efficiency. Slag satisfies neither
  // — it is a shipment that can never count — so dropping it into either would
  // reintroduce exactly the defect class that once made 35% of generated
  // Contracts unwinnable. Materials reach Contracts when the budget model
  // accounts for them, and not before. See docs/DESIGN.md's "both pools".
  cfg.materialMix = { ...NO_MATERIALS };
  return cfg;
}
