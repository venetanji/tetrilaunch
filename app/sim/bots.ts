// Naive "player" stand-ins for the sim harness. Each bot is a pure function
// of the Game's public state (cannon/score/level) — no lookahead, no
// trajectory-aware targeting. The point is to answer "does just aiming at
// roughly the field middle and holding the trigger clear the early bays?",
// not to build a strong AI.
import type Matter from "matter-js";
import type { Game } from "../src/game/game";
import { mulberry32 } from "../src/game/mods";
import { SPEED_MAX } from "../src/game/cannon";
import { BOMB_BLAST_R } from "../src/game/game";
import { CELL, WALL_INNER, WORLD } from "../src/game/engine";
import { pieceCells, type Cube } from "../src/game/pieces";
import { MATERIAL_SPEC, type PieceSize, type PieceType } from "../src/game/theme";
// TYPE-ONLY, and it has to stay that way: `aim-strategies.ts` imports `aimBot`
// from here at runtime, so a value import in this direction would close the
// cycle. The aim search is the thing being shared; a strategy is a rule about
// how to read its output, and rules live over there.
import type { AimStrategy, ShotTarget } from "./aim-strategies";

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
      const pw = Math.max(g.cannon.speedMin, Math.min(g.cannon.speedMax, power + jPower));

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
 * angleMaxDeg], a uniformly random power within the ship's own speed range, spin
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
      g.cannon.power = g.cannon.speedMin + rng() * (g.cannon.speedMax - g.cannon.speedMin);

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

/** Half the rotated bounding-box WIDTH (px) of the loaded shipment in its
 *  min-height orientation (see MIN_HEIGHT_TURNS — this is the orientation every
 *  shot actually fires in). The single-point ballistic trajectory the search
 *  scores against only tracks a piece's CENTER of mass; a candidate that lands
 *  that center too close to the wall, or too close to the compactor bar, can
 *  still have the piece's own FAR EDGE clip it — this is what lets
 *  readGapTarget/candidateHitsBar reason about the real footprint instead of
 *  treating it as a single cube. Found necessary by tracing actual losses: a
 *  point-mass-only model reliably clipped the wall and the sweeping compactor
 *  bar for anything wider than a single cell.
 *
 *  Derived from pieceCells rather than a hardcoded per-TYPE table, because the
 *  footprint now depends on the run's payload SIZE class too (theme.ts's
 *  PieceSize): a micro domino is 2 cells wide, a bulk pentomino up to 4. A
 *  tetromino-shaped constant would have quietly mis-modelled both, making the
 *  sweep's Micro/Bulk numbers measure the bot's broken assumptions instead of
 *  the mods.
 *
 *  min-height orientation means the flattest one, and a 90-degree turn just
 *  SWAPS the bounding box's width and height (see MIN_HEIGHT_TURNS' derivation),
 *  so the flattest orientation's WIDTH is simply the larger of the two extents.
 */
export function pieceHalfWidthPx(type: PieceType, size: PieceSize): number {
  const cells = pieceCells(type, size);
  const w = Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1;
  const h = Math.max(...cells.map(([, y]) => y)) - Math.min(...cells.map(([, y]) => y)) + 1;
  return (Math.max(w, h) * CELL) / 2;
}

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
export const AIM_PATIENCE_TOL = CELL;
/** Once the clock has under this much time left, patience stops being
 *  affordable — firing the best (even if mediocre) candidate beats banking a
 *  guaranteed zero by waiting out gusts the clock will outlast. */
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
 *    LOADED piece's own footprint (see pieceHalfWidthPx — a naive
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
      const halfWidthPx = pieceHalfWidthPx(g.cannon.currentType, g.level.pieceSize);
      const widthCells = Math.max(1, Math.round((2 * halfWidthPx) / CELL));
      // Slots too close to the wall for this piece's own footprint to fit
      // without its far edge clipping the wall (see pieceHalfWidthPx).
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

/**
 * Estimated RELATIVE SPEED (px/step) the shipment arrives at, for the candidate
 * whose arc this is.
 *
 * The unit is the one the collision side compares against: matter reports
 * `body.velocity` as a per-step delta, `volatileBlast` reads
 * `hypot(a.velocity - b.velocity)`, and `VOLATILE_TRIGGER_SPEED` (22) was
 * measured in it. A trajectory point is one physics step apart from the next
 * (predictTrajectory pushes one point per `stepFlight`), so the length of the
 * segment the arc is on IS its speed in that unit — no conversion, and no
 * second copy of the integrator.
 *
 * TAKEN AT THE FLOOR, and the first version of this was taken at
 * `compactor.top` (where `estimateLandingX` reads its landing) and was wrong
 * enough to matter. The arc is still accelerating through the bar's upper band:
 * over the search's own 21x4 grid, the same arcs read 16.4-21.5 px/step at
 * `compactor.top` and 21.8-25.3 at the floor. Only the second range is the one
 * `lineClear.ts` calibrated volatile against — its note records "median impact
 * runs 19.5 at power 0 to 25.5 at full" — so a cushion-aware strategy comparing
 * the first against `VOLATILE_TRIGGER_SPEED` would have read every arc it could
 * fly as already safe, and its threshold gate would have been dead code
 * wearing a rule's name.
 *
 * WHICH WAY IT ERRS: a shipment that lands on a PILE meets it above the floor
 * and therefore slower than this, so the estimate over-reads a real landing —
 * which makes a strategy that gates on it stand down more often than it needs
 * to, and under-claim what a liner bought. That is the direction every bias in
 * this harness runs.
 */
function estimateImpactSpeed(traj: Matter.Vector[]): number {
  if (traj.length < 2) return 0;
  const floorY = WORLD.height - CELL / 2;
  for (let i = 1; i < traj.length; i++) {
    const a = traj[i - 1];
    const b = traj[i];
    if (a.y < floorY && b.y >= floorY) return Math.hypot(b.x - a.x, b.y - a.y);
  }
  // An arc the 140-step preview window has not resolved down to the floor yet:
  // its last plotted segment is the fastest reading available, and it is an
  // UNDER-read of the landing that arc would eventually make — the same
  // truncation `estimateLandingX` handles at its own end of the flight.
  const a = traj[traj.length - 2];
  const b = traj[traj.length - 1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * One shot the aim search considered.
 *
 * `landX`/`impact` are READOUTS of the arc the search already flew, added when
 * strategies arrived (sim/aim-strategies.ts) and computed inside the same loop
 * for the same reason `solveAim` is shared rather than copied: a strategy that
 * re-derived where a candidate lands, or how hard, would be ranking arcs the
 * cannon is not going to fly. Nothing in the baseline ranking reads them, so
 * adding them cannot move a number — `sim/systems.ts` pins that.
 */
export interface AimCandidate {
  deg: number;
  power: number;
  /** |landX − target|, the baseline's whole score. */
  err: number;
  /** Estimated landing x (see estimateLandingX). */
  landX: number;
  /** Estimated arrival speed, px/step (see estimateImpactSpeed). */
  impact: number;
}

/**
 * How long the `patient` variant will sit on its hands waiting for a congested
 * bay to drain, as a multiple of one compactor round trip.
 *
 * A backstop, not the mechanic. Refusing to fire while congested is only a
 * strategy if the congestion actually clears; a pile stuck above the threshold
 * (slag it cannot sell, cubes stranded outside the zone) would otherwise stall
 * the bot until the clock ran out, and the sweep would report the congestion
 * tax as unsurvivable when what it actually measured was a bot with no give-up
 * rule. Two cycles is long enough for a press stroke to pay out a line and the
 * count to fall, short enough that a permanently-clogged bay still gets played.
 */
const PATIENT_MAX_WAIT_CYCLES = 2;

/**
 * `congestionAware` is the COUNTER-PLAY switch, and the whole reason the
 * congestion sweep can say anything useful.
 *
 * Every other bot here fires the instant cooldown and funds allow — which is
 * exactly the spam the tax exists to price, so measuring the tax against them
 * alone can only ever report "it costs money". The interesting question is
 * whether a player who ANSWERS it (stop firing, let the press work, resume once
 * the bay has drained) comes out ahead of one who does not. This flag is that
 * player: identical search, identical aim, one extra rule.
 */
export interface AimOpts {
  congestionAware?: boolean;
  /**
   * Drop the aim search's own patience rule, so the bot takes EVERY cooldown
   * with the best shot available rather than waiting out a bad gust.
   *
   * This is the harness's model of the strategy the congestion tax exists to
   * price. `random-up` is not that model and measuring against it is
   * misleading: a button-masher throws its cargo out of the bay, eats the
   * lost-piece fine and goes broke inside 80 shots, so its pile stays SMALL —
   * it fails to spam. The player in the complaint is competent and rich,
   * banking a surplus off cleared lines and then emptying it into the bay
   * because nothing prices the shot. Same aim, same landing zone, no restraint:
   * that is this flag.
   */
  impatient?: boolean;
  /**
   * Fire demolition charges at dead cargo — see the DEMOLITION block above.
   *
   * The counter-play switch for MATERIALS, exactly as congestionAware is for the
   * congestion tax, and it exists for the same reason: measuring slag against a
   * bot that cannot answer it reports "bots cannot play slag", not "slag is
   * mispriced". Only interesting AGAINST plain `aim` on the same seeds; the gap
   * between the two is what a charge is actually worth.
   */
  demolish?: boolean;
  /**
   * The AIMING POLICY this bot flies — `sim/aim-strategies.ts`.
   *
   * The counter-play switch for the systems whose value is a DECISION rather
   * than a passive effect, and it exists for the third time for the same reason
   * `congestionAware` and `demolish` do: a system priced against a pilot that
   * cannot make the play the system is for is priced against the pilot. The
   * Impact Cushion is the case that forced it — #145's honest arrival gate left
   * the three liner rungs at 56/63/59 of 96 and `winnability.ts`'s own ledger
   * says why: *"no bot lobs a volatile shipment on purpose"*.
   *
   * ONLY THE TWO AIM HOOKS ARE READ HERE (`target`, `select`). A strategy's
   * ABILITY hook is fired by `strategyHands` over in that file, outside this
   * function, because this act() is behind a cooldown-and-funds gate and an
   * ability is not — `counters.ts`'s `thawHands` pulls its trigger on every
   * tick, and a lance measured behind a cooldown would be a different lance.
   *
   * Absent (or a strategy with neither hook) leaves every line below on the
   * exact path it took before strategies existed. That identity is the pin
   * `sim/systems.ts` checks, and it checks it by ALSO proving the comparison
   * can see a strategy that does something.
   */
  strategy?: AimStrategy;
}

/**
 * Search the cannon's angle/power grid for the shot that lands nearest `target`.
 *
 * Lifted out of aimBot's act() unchanged when the demolition bot arrived: a
 * charge has to be aimed by exactly the same search a shipment is, or the
 * measurement would be comparing a bot that can aim cargo against one that
 * throws bombs at random. Two copies of an aim search is also how a harness ends
 * up describing a cannon that no longer exists.
 *
 * Leaves the cannon parked on the winning candidate's angle/power as a side
 * effect of the search itself; every caller sets them again explicitly, which is
 * deliberate — reading the return value is the contract, not the cannon.
 */
function solveAim(g: Game, target: number, halfWidthPx: number): AimCandidate {
  return aimCandidates(g, target, halfWidthPx).best;
}

/**
 * The same search, with the POOL it chose from handed back.
 *
 * Lifted out of `solveAim` (which is now a one-line wrapper) when strategies
 * arrived: a strategy that ranks arcs by something other than landing error —
 * the cushion-aware one ranks by arrival speed — has to see the candidates the
 * search flew, not re-fly its own. Two aim searches in one harness is the thing
 * `solveAim`'s own note warns about, and a second one that quietly sampled a
 * different angle grid would make an arm's result a fact about the grid.
 *
 * `pool` is the BAR-CLEAR pool wherever one exists (the unconstrained list only
 * when every candidate grazes the compactor's swept column), so a strategy
 * cannot select its way into the bar — bar avoidance is the search's rule, not
 * a preference a strategy is allowed to overrule.
 *
 * `best` is byte-for-byte what `solveAim` returned before this split: nearest
 * landing, steepest among ties.
 */
export function aimCandidates(
  g: Game, target: number, halfWidthPx: number,
): { pool: AimCandidate[]; best: AimCandidate } {
  const safeCands: AimCandidate[] = [];
  const allCands: AimCandidate[] = [];
  for (let deg = 15; deg <= 55; deg += 2) {
    const rad = (deg * Math.PI) / 180;
    // Scale the fixed candidate list by whatever the ship's launcher can
    // actually do (cannon.speedMax vs. the stock SPEED_MAX), so a
    // LAUNCHER-upgraded run's extra reach is searched instead of clamped away.
    const powerScale = g.cannon.speedMax / SPEED_MAX;
    for (const pwBase of AIM_POWER_CANDIDATES) {
      const pw = pwBase * powerScale;
      g.cannon.angle = rad;
      g.cannon.power = pw;
      g.updateTrajectory();
      const traj = g.trajectory;
      const landX = estimateLandingX(traj, g.compactor.top, target);
      const err = Math.abs(landX - target);
      const cand: AimCandidate = {
        deg, power: pw, err, landX, impact: estimateImpactSpeed(traj),
      };
      allCands.push(cand);
      if (!candidateHitsBar(traj, g.compactor, halfWidthPx)) safeCands.push(cand);
    }
  }

  // Prefer a bar-clear candidate even if its raw error is a bit worse —
  // only fall back to the unconstrained pool when EVERY candidate this
  // shot happens to graze the bar's swept range (rare; patience at the call
  // site will usually catch a genuinely bad remaining option anyway).
  const pool = safeCands.length ? safeCands : allCands;
  const bestErr = Math.min(...pool.map((c) => c.err));
  // Among candidates within AIM_TIE_TOL_PX of the best score, the STEEPEST
  // wins (see the ANGLE-VS-LANDING-X note in aimBot's doc comment) — pool is
  // scanned in ascending deg order, so sorting descending and taking [0] picks
  // the steepest.
  const near = pool.filter((c) => c.err <= bestErr + AIM_TIE_TOL_PX);
  near.sort((a, b) => b.deg - a.deg);
  return { pool, best: near[0] };
}

/* ---------------------------------------------------------------------------
 * DEMOLITION — the instrument the harness was missing.
 *
 * Every bot here fires shipments and nothing else, which `sim/README.md` has
 * long recorded as a caveat ("the bots never use Bond Breaker or Demolition, so
 * those tracks measure as worthless"). It stopped being a caveat and became the
 * blocking problem the moment the question was slag: a demolition charge is
 * slag's ONLY exit — a dead cube leaves the field that way or not at all — so a
 * bot without one cannot distinguish "slag is mispriced" from "this bot has no
 * hands". Measured with the piece-only bots, one notch of slag takes a Tier-10
 * bay from 88% to 0% with every seed going bankrupt, and that number is not
 * about slag.
 *
 * The rule below is deliberately the SIMPLEST one that is economically honest,
 * and it is the trade game.ts's own detonate() note describes: "a cube sitting
 * in a pile that will never complete a line is worth $0 as line material and
 * salvagePerCube as scrap metal, so blowing up junk is a POSITIVE-value play,
 * while blowing up a row you were two cubes from closing is a clear,
 * self-inflicted loss". So a site is scored dead-cubes-caught MINUS
 * live-cubes-caught, and the bot fires when that net clears a floor.
 *
 * WHAT IT DELIBERATELY IS NOT. It does not dig — it aims at a cluster and takes
 * whatever the charge reaches where it lands, exactly as a player does, rather
 * than solving for buried cargo. It does not model tar: a welded crust is the
 * other thing a charge is for, but which joints are welds is private to Game,
 * and inventing a proxy for it here would measure the proxy. It is a competent
 * pair of hands, not an optimizer, which is the same bar every other bot in this
 * file is held to.
 * ------------------------------------------------------------------------- */

/** Net dead cubes a blast must catch before it is worth a charge. Three, which
 *  is game.ts's own break-even ("$8n against a $20-$30 launch breaks even at
 *  three cubes, and nobody fires a charge at fewer than three") read back as a
 *  firing rule. */
const DEMO_MIN_NET = 3;

/** How far off the chosen site the search may land and still fire. Looser than
 *  AIM_PATIENCE_TOL because a blast has a RADIUS — a charge that lands a cell
 *  wide of a slag cluster still takes most of it, where a shipment a cell wide
 *  of its slot is in the wrong column. */
const DEMO_AIM_TOL = CELL * 1.5;

/** The bomb body's half-width, for the bar-clearance test — game.ts's spawnBomb
 *  makes a circle of radius CELL * 0.45. */
const BOMB_HALF_PX = CELL * 0.45;

/** Can this cube EVER fill a line slot, however the bay is played? False only
 *  for slag. Deliberately not lineClear.ts's fillsSlots, which also returns
 *  false for an unstruck cryo cube — that one is live cargo waiting for a hit,
 *  and bombing it is a loss, not a salvage. */
function isDead(cube: Cube): boolean {
  return !MATERIAL_SPEC[cube.material].countsForLines;
}

/** Floor-anchored row index of a world y, the same bucketing settleZoneCubes
 *  uses (lineClear.ts). Rows are what slag actually denies, so they are the
 *  unit a charge has to be valued in. */
function rowOf(y: number): number {
  return Math.round((WORLD.height - CELL / 2 - y) / CELL);
}

/**
 * The best place on the field to put a charge, or null when nothing is worth
 * one.
 *
 * Candidate centres are the dead cubes themselves rather than a grid sweep: a
 * blast is only ever worth firing because of the dead cargo it catches, so the
 * dead cubes are where the maxima are, and scanning them is O(dead x cubes)
 * instead of O(field).
 *
 * SCORED BY ROW, not by cube, and the first version of this was wrong in a way
 * worth recording. Counting every live cube caught as a loss (dead minus live)
 * reads a packed pile as a terrible place to bomb: the blast is ~2.4 cells
 * across, so it catches a dozen-odd cubes, and four slag against fourteen live
 * scores -10 however jammed the bay is. The bot fired ONE charge across six
 * bays holding six apiece — which would have measured "a rack is worth nothing"
 * when what it measured was a valuation that ignores what slag DOES.
 *
 * A row containing slag can never clear (lineClear.ts's fillsSlots), so the
 * live cargo sharing that row is not cargo — it is already spent, and it stays
 * spent until the slag goes. Destroying it costs nothing. Only a live cube in a
 * CLEAN row is a real loss, and that is the cube the design means by "blowing up
 * a row you were two cubes from closing". Scoring it that way needs no invented
 * weight: dead cubes caught, minus live cubes caught in rows nothing is
 * blocking.
 */
function bestBlastSite(g: Game): { x: number; y: number; net: number } | null {
  const blastR = BOMB_BLAST_R * (g.level.bombBlastMult > 0 ? g.level.bombBlastMult : 1);
  // Rows already denied by slag. Computed once per call rather than per
  // candidate — every candidate asks the same question of the same field.
  const blocked = new Set<number>();
  for (const c of g.cubes) if (isDead(c)) blocked.add(rowOf(c.body.position.y));

  let best: { x: number; y: number; net: number } | null = null;
  for (const centre of g.cubes) {
    if (!isDead(centre)) continue;
    let net = 0;
    for (const c of g.cubes) {
      const dx = c.body.position.x - centre.body.position.x;
      const dy = c.body.position.y - centre.body.position.y;
      if (Math.hypot(dx, dy) > blastR) continue;
      if (isDead(c)) net += 1;
      else if (!blocked.has(rowOf(c.body.position.y))) net -= 1;
    }
    if (!best || net > best.net) {
      best = { x: centre.body.position.x, y: centre.body.position.y, net };
    }
  }
  return best && best.net >= DEMO_MIN_NET ? best : null;
}

/**
 * Arm and fire a charge at the best site, if there is one worth firing at.
 * Returns true when a charge actually left the muzzle — the caller then skips
 * its shipment for this cooldown, which is the real cost of a charge and the
 * reason this is not free.
 *
 * Disarms on every path that does not fire. armBomb() only toggles a flag and
 * the charge is spent in shoot(), so an armed bomb left behind by a refused
 * shot would silently turn the NEXT shipment into a bomb — a bug that would
 * read in the results as the bot throwing away cargo.
 */
function fireCharge(g: Game, now: number): boolean {
  if (g.bombCharges <= 0) return false;
  const site = bestBlastSite(g);
  if (!site) return false;
  if (!g.armBomb()) return false;
  const chosen = solveAim(g, site.x, BOMB_HALF_PX);
  if (chosen.err <= DEMO_AIM_TOL) {
    g.cannon.angle = (chosen.deg * Math.PI) / 180;
    g.cannon.power = chosen.power;
    g.updateTrajectory();
    if (g.shoot(now)) return true;
  }
  g.armBomb();
  return false;
}

/**
 * WHAT EACH ADAPTIVE PRESET ACTUALLY IS, as options rather than as a closure.
 *
 * `BOTS` below builds its four adaptive entries from this table, and nothing
 * else may restate them. It exists because a caller that wants one of these
 * pilots PLUS something else — `sim/aim-strategies.ts` wants one plus an aiming
 * strategy — has to rebuild the bot, and rebuilding it from memory is how
 * `winnability.ts` came to fly plain `aim` under rows labelled `patient`:
 * review found `--bot patient --strategies cushion` reconstructing the pilot
 * with only `demolish` set, silently dropping the one rule the preset IS.
 *
 * A row's label has to be a fact about the bot that flew it. Reading the
 * options off one table is what makes that true by construction.
 */
export const ADAPTIVE_BOTS: Record<string, AimOpts> = {
  aim: {},
  patient: { congestionAware: true },
  demo: { demolish: true },
  impatient: { impatient: true },
};

export function aimBot(seed = 1, opts: AimOpts = {}): Bot {
  const rng = mulberry32(seed);
  const gapTargeter = makeGapTargeter();
  /** `now` at which the current congestion hold began, or null when not
   *  holding. Wall-clock ms rather than Game.stepCount, which is private —
   *  act() is handed `now` on every tick, so it is the clock available here. */
  let holdingSince: number | null = null;

  return {
    name: (opts.demolish
      ? "demo"
      : opts.congestionAware ? "patient" : opts.impatient ? "impatient" : "aim")
      // The strategy is part of the pilot's identity, not a footnote: two rows
      // of an arms table differ ONLY by it, so a table that printed the same
      // bot name on both would be unreadable.
      + (opts.strategy ? `:${opts.strategy.name}` : ""),
    act(g, now) {
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      if (opts.congestionAware) {
        if (g.pileTier === null) {
          holdingSince = null;
        } else {
          // Endgame override, mirroring the aim search's own patience rule
          // below: with the clock this short, a tax is cheaper than a bay
          // left unfinished.
          const deadline = g.timeLeftMs < AIM_PATIENCE_DEADLINE_MS;
          if (holdingSince === null) holdingSince = now;
          // cycleSteps is in physics steps; the harness drives one step per
          // 1000/60 ms of `now`, so convert rather than comparing units.
          const capMs = (g.compactor.cycleSteps / 60) * 1000 * PATIENT_MAX_WAIT_CYCLES;
          if (!deadline && now - holdingSince <= capMs) return;
        }
      }

      // DEMOLITION comes first, because a charge and a shipment compete for the
      // same cooldown — see fireCharge.
      if (opts.demolish && fireCharge(g, now)) return;

      // WHERE TO LAND IT. The gap read is the baseline's whole answer; a
      // strategy may replace it (and only replace it — returning null is how a
      // strategy says "this shot is not one of mine", which is most shots).
      const read = gapTargeter.read(g, now);
      const shot: ShotTarget = opts.strategy?.target?.(g, now, read) ?? read;
      const { x: target, slot } = shot;
      const halfWidthPx = pieceHalfWidthPx(g.cannon.currentType, g.level.pieceSize);
      // WHICH ARC GETS IT THERE. Same search, same pool; a strategy re-ranks it
      // or declines to. `best` is the nearest-landing/steepest pick this bot has
      // always made, so a strategy with no `select` is on the old path exactly.
      const { pool, best } = aimCandidates(g, target, halfWidthPx);
      const chosen = opts.strategy?.select?.(g, now, pool, shot) ?? best;

      // Patience: sit out a shot whose best-found landing still misses badly
      // — UNLESS the clock is running out, in which case firing something
      // beats a guaranteed zero from waiting out a gust that never ends. A
      // strategy that deliberately aims somewhere awkward (into a liner, at a
      // frozen cube) may widen the tolerance for its OWN shot rather than
      // starve behind a rule written for the middle of an empty bay.
      const tol = shot.tol ?? AIM_PATIENCE_TOL;
      if (!opts.impatient && chosen.err > tol && g.timeLeftMs >= AIM_PATIENCE_DEADLINE_MS) {
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
      const pw = Math.max(g.cannon.speedMin, Math.min(g.cannon.speedMax, chosen.power + jPower));
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
  aim: (seed) => aimBot(seed, ADAPTIVE_BOTS.aim),
  // Same search as `aim`, plus the one rule the congestion tax is meant to
  // teach: don't fire into a bay that's already too full. See AimOpts.
  patient: (seed) => aimBot(seed, ADAPTIVE_BOTS.patient),
  // `aim` plus a pair of hands for the demolition rack — the only bot here that
  // can answer a material. Pair it with `aim` on the same seeds and the same
  // rig: the gap between them is what a charge is worth, and it is the only way
  // this harness can tell a mispriced material from a bot that cannot play one.
  // Worthless on a rig that carries no charges (bombCharges 0), where it is
  // `aim` exactly. See the DEMOLITION block above.
  demo: (seed) => aimBot(seed, ADAPTIVE_BOTS.demo),
  // Same search as `aim`, minus its restraint — fires on every cooldown. The
  // harness's model of "spam pieces and let gravity do the rest". See AimOpts.
  impatient: (seed) => aimBot(seed, ADAPTIVE_BOTS.impatient),
};
