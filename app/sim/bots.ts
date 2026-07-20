// Naive "player" stand-ins for the sim harness. Each bot is a pure function
// of the Game's public state (cannon/score/level) — no lookahead, no
// trajectory-aware targeting. The point is to answer "does just aiming at
// roughly the field middle and holding the trigger clear the early bays?",
// not to build a strong AI.
import type Matter from "matter-js";
import type { Game } from "../src/game/game";
import { mulberry32 } from "../src/game/mods";
import { SPEED_MIN, SPEED_MAX } from "../src/game/cannon";
import { CELL, WALL_INNER } from "../src/game/engine";
import type { PieceType } from "../src/game/theme";

export interface Bot {
  name: string;
  act(g: Game, now: number): void;
}

/** ±60° — matches the cannon's own drag-aim clamp (see cannon.ts's
 *  aimFromDrag: Math.PI / 3 either side of straight ahead). */
const MAX_ANGLE_RAD = Math.PI / 3;

/**
 * Quarter-turn count (0-3) that lays each piece FLAT — minimizes its
 * rotated bounding-box HEIGHT. Derivation: pieceOffsets (pieces.ts) rotates
 * each cube's centroid-relative (x, y) offset by a plain rotation matrix; a
 * 90° turn maps (x, y) -> (-y, x). Bounding-box extents only look at
 * min/max per axis, so a 90° turn just SWAPS a piece's bounding-box width
 * and height — signs don't matter. That means every piece has exactly two
 * distinct bounding boxes across its 4 orientations (turns 0/2 share one,
 * turns 1/3 share its transpose), so only "0 or 1" ever needs choosing here.
 * Per type, extents at turn 0 read straight off PIECE_SHAPES (theme.ts),
 * counting grid cells (col, row):
 *   I: cols 0-3, rows 0-0  -> 4 wide x 1 tall at turn 0. Already flattest.
 *   O: cols 0-1, rows 0-1  -> 2x2 square; rotation never changes height.
 *   T: cols 0-2, rows 0-1  -> 3 wide x 2 tall at 0, vs. 2 wide x 3 tall at 1.
 *      0 is flatter.
 *   L: cols 0-1, rows 0-2  -> 2 wide x 3 tall at 0, vs. 3 wide x 2 tall at 1.
 *      1 is flatter.
 *   J: cols 0-1, rows 0-2  -> same footprint as L (mirrored) -> 1 is flatter.
 *   S: cols 0-2, rows 0-1  -> 3 wide x 2 tall at 0, vs. 2 wide x 3 tall at 1.
 *      0 is flatter.
 *   Z: cols 0-2, rows 0-1  -> same as S -> 0 is flatter.
 */
const MIN_HEIGHT_TURNS: Record<PieceType, number> = {
  I: 0,
  O: 0,
  T: 0,
  L: 1,
  J: 1,
  S: 0,
  Z: 0,
};

/**
 * The deliberately-bad "stand it on end" rotation — maximizes bounding-box
 * height instead. Since every piece only has two distinct heights (see
 * MIN_HEIGHT_TURNS above), this is just "the other one": 1 wherever
 * MIN_HEIGHT_TURNS is 0, and 0 wherever it's 1. O has no "other one" (a
 * square's height is rotation-invariant), so it stays 0 for both tables.
 */
const MAX_HEIGHT_TURNS: Record<PieceType, number> = {
  I: 1,
  O: 0,
  T: 1,
  L: 0,
  J: 0,
  S: 1,
  Z: 1,
};

export interface FixedAimOpts {
  /** Uniform jitter half-width applied to the aim angle, in degrees. */
  jitterDeg?: number;
  /** Uniform jitter half-width applied to power, in px/step. */
  jitterPower?: number;
  /** If true, roll a random 0-3 quarter-turn spin on the loaded piece before
   *  every shot (approximates a player who bothers to rotate). */
  rotate?: boolean;
  /** If set, instead of a random spin, rotate the loaded piece to the
   *  quarter-turn orientation that minimizes ("min-height") or maximizes
   *  ("max-height") its bounding-box height — see MIN_HEIGHT_TURNS /
   *  MAX_HEIGHT_TURNS above. Mutually exclusive with `rotate` in practice
   *  (this takes priority if both are set, since it fully determines the
   *  rotation deterministically). */
  rotationStrategy?: "min-height" | "max-height";
  /** Seed for the bot's own jitter/rotation RNG stream — pass a fresh seed
   *  per run to get an independent, reproducible sequence of "misses". */
  seed?: number;
}

/**
 * A bot that always aims at the same base angle/power, with optional bounded
 * jitter (a rough model of a human's imprecise re-aim between shots) and an
 * optional random quarter-turn spin. Fires whenever the cannon is off
 * cooldown and funds cover the shot.
 */
export function fixedAimBot(
  name: string,
  angleDeg: number,
  power: number,
  opts: FixedAimOpts = {},
): Bot {
  const { jitterDeg = 0, jitterPower = 0, rotate = false, rotationStrategy, seed = 1 } = opts;
  const rng = mulberry32(seed);
  const baseAngleRad = (angleDeg * Math.PI) / 180;

  return {
    name,
    act(g, now) {
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      // Symmetric jitter: rng() is [0,1) -> remap to [-1, 1) before scaling.
      const jAngleRad = (rng() * 2 - 1) * ((jitterDeg * Math.PI) / 180);
      const jPower = (rng() * 2 - 1) * jitterPower;

      const angle = Math.max(
        -MAX_ANGLE_RAD,
        Math.min(MAX_ANGLE_RAD, baseAngleRad + jAngleRad),
      );
      const pw = Math.max(SPEED_MIN, Math.min(SPEED_MAX, power + jPower));

      g.cannon.angle = angle;
      g.cannon.power = pw;

      if (rotationStrategy) {
        // Deterministic target orientation for whatever piece is currently
        // loaded (cannon.currentType) — no RNG consumed, so this doesn't
        // perturb the jitter stream's reproducibility.
        const table = rotationStrategy === "min-height" ? MIN_HEIGHT_TURNS : MAX_HEIGHT_TURNS;
        const target = table[g.cannon.currentType];
        // markShot resets pieceRotation to 0 after every real shot, but a
        // bomb shot (markCooldown only) leaves it untouched — so rather than
        // assume we're starting from 0, read the cannon's actual current
        // orientation and turn forward just far enough to reach the target.
        const current = g.cannon.quarterTurns;
        const turns = (target - current + 4) % 4;
        for (let i = 0; i < turns; i++) g.cannon.rotateRight();
      } else if (rotate) {
        // 0-3 quarter turns covers every reachable orientation; direction
        // doesn't matter (rotateRight x0..3 reaches all 4 states), so we
        // always turn the same way for simplicity.
        const turns = Math.floor(rng() * 4);
        for (let i = 0; i < turns; i++) g.cannon.rotateRight();
      }

      g.shoot(now);
    },
  };
}

/**
 * A fully random "button masher": every time the cannon is off cooldown and
 * funds cover the shot, pick a uniformly random angle within [angleMinDeg,
 * angleMaxDeg], a uniformly random power within [SPEED_MIN, SPEED_MAX], spin
 * a random 0-3 quarter-turn rotation, and fire. No aim model at all — the
 * point is a robustness floor ("does anything beat pure noise") rather than
 * a plausible player.
 */
function randomAimBot(name: string, angleMinDeg: number, angleMaxDeg: number, seed = 1): Bot {
  const rng = mulberry32(seed);
  const minRad = (angleMinDeg * Math.PI) / 180;
  const maxRad = (angleMaxDeg * Math.PI) / 180;

  return {
    name,
    act(g, now) {
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      g.cannon.angle = minRad + rng() * (maxRad - minRad);
      g.cannon.power = SPEED_MIN + rng() * (SPEED_MAX - SPEED_MIN);

      const turns = Math.floor(rng() * 4);
      for (let i = 0; i < turns; i++) g.cannon.rotateRight();

      g.shoot(now);
    },
  };
}

/** Discrete power candidates the adaptive bot searches at, alongside angle —
 *  SPEED_MAX is 28 (see cannon.ts), so this spans most of the useful range
 *  without exploding the search to a continuous 2D scan. See aimBot. */
const AIM_POWER_CANDIDATES = [19, 22, 25, 28];

/** Half the rotated bounding-box WIDTH (px) of each piece type in its
 *  min-height orientation (see MIN_HEIGHT_TURNS — this is the orientation
 *  every shot actually fires in) — I is 4 cells wide, O is 2, everything
 *  else is 3. The single-point ballistic trajectory the search scores
 *  against only tracks a piece's CENTER of mass; a candidate that lands
 *  that center too close to the wall, or too close to the compactor bar,
 *  can still have the piece's own FAR EDGE clip it — this table is what lets
 *  readGapTarget/candidateHitsBar reason about the piece's actual footprint
 *  instead of treating it as a single cube. Found necessary by tracing
 *  actual losses: a point-mass-only model reliably clipped the wall and the
 *  sweeping compactor bar for anything wider than a single cell. */
const PIECE_HALF_WIDTH_PX: Record<PieceType, number> = {
  I: 2 * CELL,
  O: 1 * CELL,
  T: 1.5 * CELL,
  L: 1.5 * CELL,
  J: 1.5 * CELL,
  S: 1.5 * CELL,
  Z: 1.5 * CELL,
};
/** Extra clearance (px) added on top of a piece's half-width for both the
 *  wall-margin and bar-collision checks below — physics contact isn't a
 *  mathematical point, so a little slack keeps "just barely clear" from
 *  becoming "just barely clips." */
const AIM_CLEARANCE_PX = 10;

/** Among candidates within this many px of the best score, the STEEPEST
 *  (gentlest-landing) one wins — see the ANGLE-VS-LANDING-X note on aimBot's
 *  doc comment. Reused from the original single-target version: it mattered
 *  just as much here (a flat, high-residual-velocity impact scatters the
 *  pile it lands on, which is exactly what turns an ordinary miss into a
 *  multi-cube loss cascade). */
const AIM_TIE_TOL_PX = 20;

/** How long (ms) a just-fired shot's target slot is treated as "occupied"
 *  even though the piece hasn't visibly landed there yet — see
 *  GapTargeter.markFired. Roughly a typical flight's hang time; shorter than
 *  that and two consecutive shots both read the slot as empty and pile onto
 *  each other before either has registered. */
const AIM_PENDING_MS = 2200;

/** A candidate's landing error (px, |landing − gap target|) has to beat this
 *  to be worth firing at all — a skilled player holds their shot rather than
 *  dump a piece somewhere they can already see is a bad landing. 1 cell
 *  (40px) rather than the naively-tighter 0.75 cell: measured head-to-head
 *  (sim/ tuning sweeps, bay 1, windMax 0, 20 seeds) 40px cleared 19/20 runs
 *  vs. 15/20 at 30px — tight enough to sit out a real gust, loose enough
 *  that it doesn't starve itself into a single desperate endgame volley (see
 *  AIM_PATIENCE_DEADLINE_MS) over ordinary, easily-correctable miss margins.
 *  See aimBot's patience gate. */
const AIM_PATIENCE_TOL = CELL;
/** Once the clock has under this much time left, patience stops being
 *  affordable — firing the best (even if mediocre) candidate beats banking a
 *  guaranteed zero by waiting out a wind cycle that outlasts the level. */
const AIM_PATIENCE_DEADLINE_MS = 30_000;

/**
 * Adaptive bot: the existence proof that a SKILLED player — one who reads the
 * gaps, re-aims every shot against the live wind, and knows when to hold
 * fire — beats the wind (see game.ts's windNow / cannon.ts's
 * predictTrajectory windAccel param) where every fixed-aim preset above must
 * not. Four skills, each modeling a real thing a good player does that the
 * fixed-aim bots don't:
 *
 * 1. GAP TARGETING (GapTargeter/makeGapTargeter below): instead of always
 *    aiming at a fixed spot, it builds a per-slot height map and targets the
 *    CENTER of the lowest-stacked run of slots wide enough for the CURRENTLY
 *    LOADED piece's own footprint (see PIECE_HALF_WIDTH_PX — a naive
 *    single-cell-wide read let a wide piece straddle a shallow slot and a
 *    tall neighbor, landing off-balance and toppling), ties broken toward
 *    the wall. Falls back to the zone's middle when nothing has landed yet.
 *    Slots are wall-anchored (slot k's center is WALL_INNER − CELL/2 − k·CELL,
 *    the same grid line-clear itself uses — see lineClear.ts) but the slot
 *    COUNT is fixed at level.compactorMinLineCells — the bar's own
 *    full-advance stop, i.e. the part of the zone that is NEVER swept by the
 *    compactor at any point in its cycle — rather than the live, wider
 *    "however far the bar happens to be retreated right now" zone. Found
 *    necessary the hard way: reading the live (compactor-position-dependent)
 *    zone let the bot chase gaps out in the bar's own sweep range, where the
 *    single deterministic bar-avoidance check below can reject a landing but
 *    can't un-choose a target that's fundamentally in harm's way; anchoring
 *    to the permanently-safe sub-zone instead measured dramatically fewer
 *    lost pieces across seeds with everything else held constant. A shot's
 *    target slot is also remembered as PENDING for AIM_PENDING_MS after
 *    firing (GapTargeter.markFired) — the piece won't have visibly landed
 *    there yet on the very next decision (900ms cooldown vs. ~1.5-2.5s
 *    flight), and without this the next shot reads that slot as still empty
 *    and piles a second piece on top of the first while both are still
 *    airborne on different arcs.
 * 2. ANGLE *AND* POWER SEARCH: sweeps 21 angles (15°-55°, 2° steps) x 4
 *    powers (19/22/25/28) = 84 candidates. For each, sets
 *    g.cannon.angle/power and calls g.updateTrajectory() (which folds in the
 *    live wind reading via g.windNow — see game.ts), then reads g.trajectory
 *    back to estimate the landing x: the arc's last plotted point (near
 *    floor, after integrating wind for the whole remaining flight) if it
 *    already reached compactor-top depth, else the point where the arc
 *    crosses compactor.top on its way down (a still-high arc the 140-step
 *    preview window hasn't resolved down to floor level yet) — see
 *    estimateLandingX. Scores each candidate by |landing − gapTarget|; among
 *    candidates within AIM_TIE_TOL_PX of the best score, the STEEPEST wins
 *    (a flat, high-residual-velocity impact scatters whatever it lands on —
 *    exactly why the fixed `flat` preset never wins either).
 * 3. BAR AVOIDANCE: the compactor bar sweeps continuously between its open
 *    and full-advance stops (see compactor.ts) — a real hazard, not a static
 *    one, and even the permanently-safe gap-targeting sub-zone above can
 *    still border the bar's position at some point in its cycle. A
 *    candidate whose arc would carry it through the bar's swept column
 *    while still above compactor.top is disqualified UNLESS every candidate
 *    is equally exposed. Since the bar's future motion is just as
 *    deterministic as wind, predictCompactorX walks its ping-pong forward
 *    the same number of steps as each trajectory sample and flags an
 *    overlap widened by the loaded piece's own half-width.
 * 4. PATIENCE: the key skill the old angle-only version lacked. If even the
 *    BEST candidate's error exceeds AIM_PATIENCE_TOL, a skilled player
 *    doesn't force a bad shot into a bad gust — they wait for the wind to
 *    ease and re-solve next opportunity (the bot simply doesn't call
 *    g.shoot() this act(), leaving funds/cooldown untouched for the next
 *    tick). The one exception is the endgame: once g.timeLeftMs drops under
 *    AIM_PATIENCE_DEADLINE_MS (30s), clock pressure beats perfectionism, so
 *    it fires the best candidate it found regardless of error.
 *
 * After picking the best candidate, applies the same small seeded jitter
 * (±1° angle, ±0.5 power) the original version had — different seeds still
 * sample slightly different "misses" — then the min-height rotation
 * strategy (see MIN_HEIGHT_TURNS), leaves the cannon set to that exact final
 * candidate (so the live trajectory preview and the fired shot always
 * agree), and fires. Only PUBLIC Game/Cannon/Compactor APIs are used
 * (g.cubes, g.compactor.x/width/top/leftX/rightX/speed/dir,
 * g.level.compactorMinLineCells, g.trajectory, g.updateTrajectory()) — no
 * reaching into engine internals, and no RNG beyond the one seeded stream
 * (the search itself is pure/deterministic; jitter is the only randomness).
 */
interface GapTarget {
  /** World-space x to aim the landing at. */
  x: number;
  /** Start index (in the fixed compactorMinLineCells slot grid) of the
   *  chosen landing window, or -1 when there was nothing to read yet
   *  (zone-middle fallback) — passed to markFired so the NEXT decision
   *  treats it as pending. */
  slot: number;
}

/** Stateful gap-reader factory (one per bot instance/seed) — the pending-slot
 *  memory is per-bot state, not a pure function of Game, so it's built once
 *  in aimBot's closure rather than recomputed from scratch every act(). */
function makeGapTargeter() {
  const pendingUntil = new Map<number, number>();

  return {
    read(g: Game, now: number): GapTarget {
      const face = g.compactor.x + g.compactor.width / 2;
      const zoneMid = (face + WALL_INNER) / 2;
      if (g.cubes.length === 0) return { x: zoneMid, slot: -1 };

      // Fixed-size grid anchored to the PERMANENTLY safe sub-zone (see the
      // doc comment above) — never the live, compactor-position-dependent
      // full zone.
      const numSlots = g.level.compactorMinLineCells;
      const halfWidthPx = PIECE_HALF_WIDTH_PX[g.cannon.currentType];
      const widthCells = Math.max(1, Math.round((2 * halfWidthPx) / CELL));
      // Slots too close to the wall for this piece's own footprint to fit
      // without its far edge clipping the wall (see PIECE_HALF_WIDTH_PX).
      const marginPx = halfWidthPx + AIM_CLEARANCE_PX;
      const minSlot = Math.max(0, Math.ceil((marginPx - CELL / 2) / CELL));

      // Per-slot "top of stack" y (smaller y = taller stack); a slot nobody
      // has landed in yet stays at +Infinity, which — since we're looking
      // for the window with the GREATEST average top-y (the shortest/
      // emptiest run of slots) — always outranks slots that actually have a
      // cube. That's "lowest stacked wins," with empty slots winning
      // outright, for free.
      const slotTopY = new Array<number>(numSlots).fill(Number.POSITIVE_INFINITY);
      let anyInZone = false;
      for (const c of g.cubes) {
        const x = c.body.position.x;
        const slot = Math.round((WALL_INNER - CELL / 2 - x) / CELL);
        if (slot < 0 || slot >= numSlots) continue;
        anyInZone = true;
        const y = c.body.position.y;
        if (y < slotTopY[slot]) slotTopY[slot] = y;
      }
      // Pending shots still (probably) in flight: treat their slot as
      // occupied (a very "tall" reading) so the next decision doesn't pile a
      // second piece onto a spot the first hasn't visibly reached yet.
      for (const [slot, until] of pendingUntil) {
        if (until <= now) {
          pendingUntil.delete(slot);
          continue;
        }
        if (slot < numSlots) {
          anyInZone = true;
          slotTopY[slot] = Number.NEGATIVE_INFINITY;
        }
      }
      if (!anyInZone) return { x: zoneMid, slot: -1 };

      // Windowed average over the piece's OWN width: a real player aims
      // their piece's whole footprint at the flattest/lowest region, not a
      // single 1-cell sliver — targeting a narrow low column while a wide
      // piece straddles taller neighbors makes it lean/topple on landing.
      // Ties (including the all-empty case) favor the window closest to the
      // wall: iterating from minSlot up and only replacing on a STRICT
      // improvement means the first (lowest-index, wall-closest) window in
      // any tie is the one that sticks.
      const lastStart = Math.max(minSlot, numSlots - widthCells);
      let bestStart = Math.min(minSlot, lastStart);
      let bestAvg = Number.NEGATIVE_INFINITY;
      for (let s = minSlot; s <= lastStart; s++) {
        let sum = 0;
        for (let k = 0; k < widthCells; k++) sum += slotTopY[s + k];
        const avg = sum / widthCells;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestStart = s;
        }
      }
      const centerSlot = bestStart + (widthCells - 1) / 2;
      return { x: WALL_INNER - CELL / 2 - centerSlot * CELL, slot: bestStart };
    },

    markFired(slot: number, now: number): void {
      if (slot >= 0) pendingUntil.set(slot, now + AIM_PENDING_MS);
    },
  };
}

/** Landing-x estimate for a candidate trajectory: the last plotted point once
 *  the arc has already dropped to/below the compactor's top (floor-level,
 *  full wind integration — the most accurate read of true rest x), or the
 *  interpolated crossing of compactor.top on the way down otherwise (a still
 *  -high arc the fixed 140-step preview window hasn't resolved that far
 *  yet). `neutralX` is returned only for the degenerate empty-trajectory
 *  case. */
function estimateLandingX(
  traj: Matter.Vector[],
  compactorTopY: number,
  neutralX: number,
): number {
  if (traj.length === 0) return neutralX;
  const last = traj[traj.length - 1];
  if (last.y >= compactorTopY) return last.x;
  for (let i = traj.length - 1; i > 0; i--) {
    const a = traj[i - 1];
    const b = traj[i];
    if (a.y < compactorTopY && b.y >= compactorTopY) {
      const t = (compactorTopY - a.y) / (b.y - a.y);
      return a.x + t * (b.x - a.x);
    }
  }
  return last.x;
}

/** Minimal public shape of Game's compactor this file needs — narrowed
 *  rather than importing the Compactor class just for a type annotation. */
interface CompactorLike {
  x: number;
  dir: 1 | -1;
  speed: number;
  leftX: number;
  rightX: number;
}

/** The bar's own x, `steps` physics-steps from now — the exact same
 *  ping-pong clamp/bounce compactor.ts's update() applies each real step, so
 *  this is a deterministic forward simulation, not a guess (mirrors
 *  game.ts's windAtStep / cannon.ts's predictTrajectory reasoning: the
 *  bar's future motion is just as knowable in advance as the wind's). */
function predictCompactorX(c: CompactorLike, steps: number): number {
  let x = c.x;
  let dir = c.dir;
  for (let i = 0; i < steps; i++) {
    x += c.speed * dir;
    if (x >= c.rightX) {
      x = c.rightX;
      dir = -1;
    } else if (x <= c.leftX) {
      x = c.leftX;
      dir = 1;
    }
  }
  return x;
}

/** True if this candidate trajectory would carry the piece through the
 *  compactor bar's swept column while still above compactor.top — see
 *  predictCompactorX and the BAR AVOIDANCE writeup on aimBot above. */
function candidateHitsBar(
  traj: Matter.Vector[],
  compactor: CompactorLike & { width: number; top: number },
  halfWidthPx: number,
): boolean {
  const collisionR = compactor.width / 2 + halfWidthPx + AIM_CLEARANCE_PX;
  for (let i = 0; i < traj.length; i++) {
    const p = traj[i];
    if (p.y < compactor.top) continue; // above the bar's vertical band entirely
    const barX = predictCompactorX(compactor, i);
    if (Math.abs(p.x - barX) < collisionR) return true;
  }
  return false;
}

interface AimCandidate {
  deg: number;
  power: number;
  err: number;
}

function aimBot(seed = 1): Bot {
  const rng = mulberry32(seed);
  const gapTargeter = makeGapTargeter();

  return {
    name: "aim",
    act(g, now) {
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      const { x: target, slot } = gapTargeter.read(g, now);
      const halfWidthPx = PIECE_HALF_WIDTH_PX[g.cannon.currentType];

      const safeCands: AimCandidate[] = [];
      const allCands: AimCandidate[] = [];
      for (let deg = 15; deg <= 55; deg += 2) {
        const rad = (deg * Math.PI) / 180;
        for (const pw of AIM_POWER_CANDIDATES) {
          g.cannon.angle = rad;
          g.cannon.power = pw;
          g.updateTrajectory();
          const traj = g.trajectory;
          const landX = estimateLandingX(traj, g.compactor.top, target);
          const err = Math.abs(landX - target);
          const cand: AimCandidate = { deg, power: pw, err };
          allCands.push(cand);
          if (!candidateHitsBar(traj, g.compactor, halfWidthPx)) safeCands.push(cand);
        }
      }

      // Prefer a bar-clear candidate even if its raw error is a bit worse —
      // only fall back to the unconstrained pool when EVERY candidate this
      // shot happens to graze the bar's swept range (rare; patience below
      // will usually catch a genuinely bad remaining option anyway).
      const pool = safeCands.length ? safeCands : allCands;
      const bestErr = Math.min(...pool.map((c) => c.err));
      // Among candidates within AIM_TIE_TOL_PX of the best score, the
      // STEEPEST wins (see the ANGLE-VS-LANDING-X note in aimBot's doc
      // comment) — pool is scanned in ascending deg order (the outer loop
      // above), so sorting descending and taking [0] picks the steepest.
      const near = pool.filter((c) => c.err <= bestErr + AIM_TIE_TOL_PX);
      near.sort((a, b) => b.deg - a.deg);
      const chosen = near[0];

      // Patience: sit out a shot whose best-found landing still misses badly
      // — UNLESS the clock is running out, in which case firing something
      // beats a guaranteed zero from waiting out a gust that never ends.
      if (chosen.err > AIM_PATIENCE_TOL && g.timeLeftMs >= AIM_PATIENCE_DEADLINE_MS) {
        // Still leave the cannon parked on the best candidate found, so the
        // live preview reflects the closest option even while holding fire.
        g.cannon.angle = (chosen.deg * Math.PI) / 180;
        g.cannon.power = chosen.power;
        g.updateTrajectory();
        return;
      }

      const jAngleRad = (rng() * 2 - 1) * ((1 * Math.PI) / 180);
      const jPower = (rng() * 2 - 1) * 0.5;
      const angle = Math.max(
        -MAX_ANGLE_RAD,
        Math.min(MAX_ANGLE_RAD, (chosen.deg * Math.PI) / 180 + jAngleRad),
      );
      const pw = Math.max(SPEED_MIN, Math.min(SPEED_MAX, chosen.power + jPower));
      g.cannon.angle = angle;
      g.cannon.power = pw;
      g.updateTrajectory();

      // Deterministic min-height rotation (see fixedAimBot's rotationStrategy
      // handling above for the same logic/rationale).
      const rotTarget = MIN_HEIGHT_TURNS[g.cannon.currentType];
      const current = g.cannon.quarterTurns;
      const turns = (rotTarget - current + 4) % 4;
      for (let i = 0; i < turns; i++) g.cannon.rotateRight();

      g.shoot(now);
      gapTargeter.markFired(slot, now);
    },
  };
}

/**
 * Named presets, each a FACTORY of (seed) -> Bot rather than a built Bot —
 * the runner needs to rebuild a fresh bot (fresh jitter RNG stream) per run
 * so that two runs given the same seed reproduce identically, and two runs
 * with different seeds sample independent "miss" sequences. The literal
 * fixedAimBot(...) call for each preset is exactly what running that preset
 * at a given seed means; `seed` is threaded in at build time.
 */
export const BOTS: Record<string, (seed: number) => Bot> = {
  // Approximates a player dragging back and firing toward the field middle.
  middle: (seed) => fixedAimBot("middle", 20, 19, { jitterDeg: 3, jitterPower: 1.5, seed }),
  // High, soft arc toward the back of the bay.
  lob: (seed) => fixedAimBot("lob", 35, 25, { jitterDeg: 2, jitterPower: 1, seed }),
  // Low, flat, fast shot.
  flat: (seed) => fixedAimBot("flat", 8, 22, { jitterDeg: 3, jitterPower: 1.5, seed }),
  // Same arc as `lob`, but also spins the piece before firing.
  "lob-rot": (seed) =>
    fixedAimBot("lob-rot", 35, 25, { jitterDeg: 2, jitterPower: 1, rotate: true, seed }),
  // Same arc as `lob`, but always rotates the loaded piece to its
  // minimal-height (flattest) orientation before firing — the deliberately
  // GOOD rotation strategy, for measuring the best case.
  "lob-flat": (seed) =>
    fixedAimBot("lob-flat", 35, 25, {
      jitterDeg: 2,
      jitterPower: 1,
      rotationStrategy: "min-height",
      seed,
    }),
  // Same arc as `lob`, but always rotates the loaded piece to its
  // maximal-height (standing on end) orientation before firing — the
  // deliberately BAD rotation strategy, for measuring the worst case.
  "lob-tall": (seed) =>
    fixedAimBot("lob-tall", 35, 25, {
      jitterDeg: 2,
      jitterPower: 1,
      rotationStrategy: "max-height",
      seed,
    }),
  // Fully random button-masher: uniform angle across the whole cannon cone
  // [-60°, +60°], uniform power, random rotation. A robustness floor — real
  // presets should always beat this.
  random: (seed) => randomAimBot("random", -60, 60, seed),
  // Same as `random`, but restricted to the upward half of the cone
  // [0°, +60°] — a random player who at least remembers to aim up. The
  // harder "random should never win" case.
  "random-up": (seed) => randomAimBot("random-up", 0, 60, seed),
  // Adaptive: re-solves its angle against the live wind reading every shot
  // (see aimBot above) — the existence proof that changing aim beats wind.
  aim: (seed) => aimBot(seed),
};
