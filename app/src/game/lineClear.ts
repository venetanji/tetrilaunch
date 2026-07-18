import Matter from "matter-js";
import { CELL, WORLD, WALL_INNER } from "./engine";
import { removeConstraintsFor, type Cube } from "./pieces";
import type { Compactor } from "./compactor";
import type { LevelConfig } from "./level";

const SETTLE = 3.2; // px/step below which a cube counts as compacted/at rest
const SETTLE_SQ = SETTLE * SETTLE; // squared-speed compare avoids a sqrt per cube
const BLINK_MS = 1400;

/**
 * Alignment tolerances for the slot-based line-clear check below. These define
 * what "perfectly aligned" means — flush against the wall/floor/each other —
 * with a small allowance for physics-solver slop (contact jitter while under
 * compaction pressure), not for sloppy or overlapping piles. See updateLineClear.
 */
const X_TOL = 0.3 * CELL; // slot-center x tolerance (wall-anchored grid)
const Y_TOL = 0.3 * CELL; // row-center y tolerance (floor-anchored grid)
const ANGLE_TOL = 0.2; // radians (~11°) off the nearest axis-aligned angle

/**
 * "Compaction settling" tunables (see settleZoneCubes below). A real static
 * bar can wedge a tilted cube against the wall/neighbors and never square it
 * up on its own — the strict slot grid above would then never be reachable.
 * These let the press "vibro-compact" near-settled cubes onto the grid: a
 * slow angle grind squares up cubes already close to axis-aligned, and a slow
 * positional pull nudges cubes already close to a slot onto its center. Rates
 * are deliberately small per step so it reads as the press physically
 * grinding/nudging the pile flat, not a teleporting snap.
 */
const SETTLE_ROW_TOL = 0.45 * CELL; // vertical reach: how far from a row center the assist still applies
const SETTLE_X_MARGIN = CELL / 2; // assist only applies from (compactor face - this) rightward
const SETTLE_ANGLE_CAP = 0.65; // rad; only grind cubes already this close to axis-aligned
const ANGLE_RATE = 0.02; // rad/step (~0.6 rad/sec @ 60fps) — grinds, doesn't snap
const SETTLE_SLOT_TOL = 0.5 * CELL; // only pull cubes already this close to a slot center
const X_RATE = 0.5; // px/step positional pull toward the nearest slot center

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

export function resetLineClear(): void {
  /* no persistent state */
}

/** Normalize an angle (possibly negative, possibly many turns around) into [0, 2*PI). */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/** True if `angle` is within ANGLE_TOL of a multiple of PI/2 — the cube's
 *  edges are (near enough) parallel to the world axes, so it can sit flush. */
function isAxisAligned(angle: number): boolean {
  const a = normalizeAngle(angle);
  const d = Math.abs(a % (Math.PI / 2));
  return d < ANGLE_TOL || d > Math.PI / 2 - ANGLE_TOL;
}

/**
 * Shared face/zone-width/slot-count computation for both settleZoneCubes and
 * updateLineClear, so the settle assist always targets exactly the slots a
 * row would need to fill to clear. Returns null when the zone is narrower
 * than the minimum-line stop — shouldn't happen (the compactor's own right
 * stop is clamped there), but guarded defensively.
 */
function zoneGrid(
  compactor: Compactor,
  level: LevelConfig,
): { face: number; zoneW: number; needed: number } | null {
  const face = compactor.x + compactor.width / 2;
  const zoneW = WALL_INNER - face;
  if (zoneW < (level.compactorMinLineCells - 0.5) * CELL) return null;
  const needed = Math.max(level.compactorMinLineCells, Math.round(zoneW / CELL));
  return { face, zoneW, needed };
}

/**
 * Physically nudge near-settled cubes onto the wall/row slot grid while the
 * compactor is pressing. The strict clear rule in updateLineClear requires
 * cubes to be axis-aligned and sitting exactly at wall-anchored slot centers
 * — real physics alone can wedge a tilted cube (a 40px square can occupy up
 * to ~56px horizontally when tipped) against the wall or its neighbors,
 * propping the whole row out of grid alignment forever; a static bar can't
 * "un-tip" a jammed cube by pressing into it. This is the physical companion
 * to that strictness: for cubes that are already slow, near a floor-anchored
 * row, and within reach of the compactor face, it (a) grinds the angle slowly
 * toward the nearest axis-aligned orientation, and (b) pulls the position
 * slowly toward the nearest wall-anchored slot center — but only when the
 * cube is already close (within SETTLE_ANGLE_CAP / SETTLE_SLOT_TOL), so it
 * reads as the press grinding/compacting the pile flat rather than snapping
 * distant cubes into place. Velocity and Y are never touched; gravity still
 * owns Y. Safe to call every step while pressing — matter-js tolerates small
 * per-step kinematic corrections on near-resting bodies.
 */
export function settleZoneCubes(cubes: Cube[], compactor: Compactor, level: LevelConfig): void {
  const zone = zoneGrid(compactor, level);
  const face = zone ? zone.face : compactor.x + compactor.width / 2;
  const minX = face - SETTLE_X_MARGIN;

  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    const b = cube.body;
    if (b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y >= SETTLE_SQ) continue;
    if (b.position.x <= minX) continue; // left of the compactor's reach — untouched

    // Nearest floor-anchored row center; skip cubes not near one, and skip
    // rows above the bar's physical reach (same bound updateLineClear uses) —
    // otherwise this would apply a phantom force to stacks the bar can never
    // actually touch.
    const r = Math.round((WORLD.height - CELL / 2 - b.position.y) / CELL);
    if (r < 0) continue;
    const rowY = WORLD.height - CELL / 2 - r * CELL;
    if (rowY < compactor.top) continue;
    if (Math.abs(b.position.y - rowY) > SETTLE_ROW_TOL) continue;

    // Angle grind: rotate slowly toward the nearest axis-aligned orientation.
    // Works on the raw (possibly multi-turn) angle so spins aren't lost.
    const target = Math.round(b.angle / (Math.PI / 2)) * (Math.PI / 2);
    const angleDelta = target - b.angle;
    if (Math.abs(angleDelta) <= SETTLE_ANGLE_CAP) {
      Matter.Body.setAngle(b, b.angle + clamp(angleDelta, ANGLE_RATE));
    }

    // Slot pull: nudge slowly toward the nearest wall-anchored slot center,
    // found directly by index (nearest slot k) rather than scanning every slot.
    if (zone) {
      const k = Math.round((WALL_INNER - CELL / 2 - b.position.x) / CELL);
      if (k >= 0 && k < zone.needed) {
        const slotXk = WALL_INNER - CELL / 2 - k * CELL;
        const dx = slotXk - b.position.x;
        if (Math.abs(dx) <= SETTLE_SLOT_TOL) {
          Matter.Body.setPosition(b, { x: b.position.x + clamp(dx, X_RATE), y: b.position.y });
        }
      }
    }
  }
}

/**
 * Clear only genuinely COMPACTED solid rows, using a strict SLOT-BASED grid
 * instead of counting/span/contiguity heuristics (those let sloppy, merely
 * overlapping piles double-count and clear "lines" that were never really
 * aligned, while genuinely overlapping stacks could stall forever).
 *
 * The compaction zone is divided into `needed` slots anchored at the wall
 * (slot k's center sits k cubes out from WALL_INNER) and rows anchored at the
 * floor (row r's center sits r cubes up from the floor) — real resting-position
 * grids, not derived by rounding a cube's own (possibly sloppy) position.
 *
 * A cube is a candidate to fill a slot only if it is settled (speed < SETTLE),
 * not blinking, and axis-aligned (a tipped cube can't sit flush). It fills row
 * r's slot k only if it's within Y_TOL of row r's center AND within X_TOL of
 * slot k's center. A row clears only when EVERY one of its `needed` slots has
 * exactly one cube in it — if two candidates land in the same slot (an
 * overlapping stack), that row is rejected for this frame; it isn't a clean
 * line yet, and continued compaction pressure will eventually square it up.
 *
 * Cubes are removed ONLY here (a broken joint never deletes a cube), and only
 * the exact slot-filling cubes of rows that actually clear — never hangers-on.
 */
export interface ClearResult {
  lines: number;
  /** Position + color snapshots of every removed cube, taken just before
   *  removal — render-side FX (shatter bursts, payout text) need where a
   *  cube WAS, and the body/cube are both gone by the time the caller sees this. */
  cubes: { x: number; y: number; color: string }[];
  /** Center Y of each cleared row, for a row-flash effect. */
  rows: number[];
}

export function updateLineClear(
  world: Matter.World,
  cubes: Cube[],
  compactor: Compactor,
  level: LevelConfig,
  constraints: Matter.Constraint[],
): ClearResult {
  // Zone narrower than the minimum-line stop shouldn't happen (the compactor's
  // own right stop is clamped there), but zoneGrid guards against it
  // defensively — the bar keeps ping-ponging between its stops, it never
  // teleports.
  const zone = zoneGrid(compactor, level);
  if (!zone) return { lines: 0, cubes: [], rows: [] };
  // Dynamic threshold: compactorMinLineCells cubes at full advance, growing
  // toward compactorOpenCells as the compactor opens back up and the zone widens.
  const { needed } = zone;

  // Candidate cubes: settled, not blinking, axis-aligned squares. (Being left
  // of the compactor face or outside every slot/row simply means a cube never
  // matches below — no separate zone filter needed.)
  const candidates: Cube[] = [];
  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    const b = cube.body;
    if (b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y >= SETTLE_SQ) continue;
    if (!isAxisAligned(b.angle)) continue;
    candidates.push(cube);
  }

  const toRemove = new Set<Cube>();
  const rows: number[] = [];
  const maxRow = Math.ceil(WORLD.height / CELL);

  for (let r = 0; r < maxRow; r++) {
    const rowY = WORLD.height - CELL / 2 - r * CELL;
    if (rowY < compactor.top) break; // above the bar's reach — stop scanning up

    const slots: (Cube | null)[] = new Array(needed).fill(null);
    let duplicate = false;

    for (const cube of candidates) {
      const b = cube.body;
      if (Math.abs(b.position.y - rowY) > Y_TOL) continue;
      // Direct index instead of a linear scan over every slot: slot spacing
      // (CELL) vs X_TOL guarantees at most one slot can ever match a cube.
      const k = Math.round((WALL_INNER - CELL / 2 - b.position.x) / CELL);
      if (k < 0 || k >= needed) continue;
      const slotXk = WALL_INNER - CELL / 2 - k * CELL;
      if (Math.abs(b.position.x - slotXk) > X_TOL) continue;
      if (slots[k] !== null) duplicate = true;
      else slots[k] = cube;
    }

    if (duplicate) continue; // overlapping stack contending for a slot — not clean
    if (slots.some((s) => s === null)) continue; // hole in the row

    for (const c of slots) toRemove.add(c!);
    rows.push(rowY);
  }

  const removedCubes: { x: number; y: number; color: string }[] = [];
  if (toRemove.size) {
    for (let i = cubes.length - 1; i >= 0; i--) {
      const cube = cubes[i];
      if (toRemove.has(cube)) {
        removedCubes.push({ x: cube.body.position.x, y: cube.body.position.y, color: cube.color });
        // A cleared cube may still be joined to a surviving piece-mate (e.g. a
        // domino straddling the row) — prune its constraints first, or the
        // joint dangles: pointing at a body no longer in the world.
        removeConstraintsFor(world, constraints, cube.body);
        Matter.Composite.remove(world, cube.body);
        cubes.splice(i, 1);
      }
    }
  }
  return { lines: rows.length, cubes: removedCubes, rows };
}

/**
 * Penalty path (ports main.py's check_pieces_on_left_side): settled cubes the
 * compactor bar can NEVER reach decay for a point penalty, instead of sitting
 * as unreachable dead weight forever. The cutoff is derived from the bar
 * itself: compactor.leftX is its body-center at the fully-retreated (open)
 * stop, so even a cube flush against the bar's face there (center = leftX +
 * width/2 - CELL/2) sits at the closest-to-the-launcher position the zone
 * will ever reach — the bar's face never gets any further left than that.
 * Anything left of this cutoff can never be compacted or counted for a line;
 * cubes shattered at the bar or compacted against the wall are never touched
 * here.
 */
export function markLostPieces(cubes: Cube[], compactor: Compactor, now: number): void {
  const cutoff = compactor.leftX + compactor.width / 2 - CELL / 2;
  for (const c of cubes) {
    if (c.blinkStart !== null) continue;
    const b = c.body;
    if (
      b.position.x < cutoff &&
      Math.abs(b.velocity.x) < SETTLE &&
      Math.abs(b.velocity.y) < SETTLE
    ) {
      c.blinkStart = now;
    }
  }
}

/** Remove blinking (bounced-out) cubes after the blink duration. Returns count. */
export function updateBlinking(
  world: Matter.World,
  cubes: Cube[],
  now: number,
  constraints: Matter.Constraint[],
): number {
  let lost = 0;
  for (let i = cubes.length - 1; i >= 0; i--) {
    const c = cubes[i];
    if (c.blinkStart !== null && now - c.blinkStart > BLINK_MS) {
      // Same dangling-joint hazard as updateLineClear: a joined cube may
      // blink out alone while its piece-mate stays behind.
      removeConstraintsFor(world, constraints, c.body);
      Matter.Composite.remove(world, c.body);
      cubes.splice(i, 1);
      lost++;
    }
  }
  return lost;
}

export function blinkVisible(cube: Cube, now: number): boolean {
  if (cube.blinkStart === null) return true;
  return Math.floor((now - cube.blinkStart) / 160) % 2 === 0;
}
