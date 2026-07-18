import Matter from "matter-js";
import { CELL, WORLD, WALL_INNER } from "./engine";
import type { Cube } from "./pieces";
import type { Compactor } from "./compactor";
import type { LevelConfig } from "./level";

const SETTLE = 3.2; // px/step below which a cube counts as compacted/at rest
const BLINK_MS = 1400;

export function resetLineClear(): void {
  /* no persistent state */
}

/**
 * Clear only genuinely COMPACTED solid rows: a contiguous run of settled cubes
 * that fills the gap from the compactor's right face to the right wall. Cubes
 * are removed ONLY here (a broken joint never deletes a cube). Returns the
 * number of rows cleared.
 */
export function updateLineClear(
  world: Matter.World,
  cubes: Cube[],
  compactor: Compactor,
  level: LevelConfig,
): number {
  const face = compactor.x + compactor.width / 2;
  const zoneW = WALL_INNER - face;
  // Zone narrower than the minimum-line stop shouldn't happen (the compactor's
  // own right stop is clamped there), but guard against it defensively — the
  // bar keeps ping-ponging between its stops, it never teleports.
  if (zoneW < (level.compactorMinLineCells - 0.5) * CELL) return 0;
  // Dynamic threshold: 8 cubes at full advance, growing toward 12 as the
  // compactor opens back up and the zone widens.
  const needed = Math.max(level.compactorMinLineCells, Math.round(zoneW / CELL));

  // Group settled cubes that live in the compaction zone by grid row.
  const yThresh = CELL * 0.6;
  const rows = new Map<number, Cube[]>();
  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    const b = cube.body;
    if (b.position.x < face - CELL * 0.5) continue; // left of the compactor face
    if (Math.hypot(b.velocity.x, b.velocity.y) >= SETTLE) continue; // still moving
    const y = b.position.y;
    const rowY = Math.round(y / CELL) * CELL;
    if (Math.abs(y - rowY) < yThresh) {
      (rows.get(rowY) ?? rows.set(rowY, []).get(rowY)!).push(cube);
    }
  }

  const toRemove = new Set<Cube>();
  let cleared = 0;

  for (const [, items] of rows) {
    if (items.length < needed) continue;
    items.sort((a, b) => a.body.position.x - b.body.position.x);
    const left = items[0].body.position.x;
    const right = items[items.length - 1].body.position.x;
    // Must span the whole gap: packed against the wall AND back to the face.
    if (right < WALL_INNER - CELL * 1.3) continue;
    if (left > face + CELL * 1.3) continue;
    // Contiguous — no hole wider than a cube.
    let solid = true;
    for (let i = 1; i < items.length; i++) {
      if (items[i].body.position.x - items[i - 1].body.position.x > CELL * 1.4) {
        solid = false;
        break;
      }
    }
    if (!solid) continue;
    for (const c of items) toRemove.add(c);
    cleared++;
  }

  if (toRemove.size) {
    for (let i = cubes.length - 1; i >= 0; i--) {
      if (toRemove.has(cubes[i])) {
        Matter.Composite.remove(world, cubes[i].body);
        cubes.splice(i, 1);
      }
    }
  }
  return cleared;
}

// Everything left of here is "bounced out" — back in the launch corridor,
// well behind the compactor's leftmost reach. A cube that merely scattered next
// to the bar (still in the compaction half) is NOT penalized.
const OUT_X = WORLD.width * 0.3;

/**
 * Penalty path (ports main.py's check_pieces_on_left_side): pieces that bounce
 * back OUT — settling in the launch corridor, well before the compactor — start
 * blinking and are removed for a point penalty. Cubes shattered at the bar or
 * compacted against the wall are never touched here.
 */
export function markLostPieces(cubes: Cube[], _compactor: Compactor, now: number): void {
  const cutoff = OUT_X;
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
export function updateBlinking(world: Matter.World, cubes: Cube[], now: number): number {
  let lost = 0;
  for (let i = cubes.length - 1; i >= 0; i--) {
    const c = cubes[i];
    if (c.blinkStart !== null && now - c.blinkStart > BLINK_MS) {
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
