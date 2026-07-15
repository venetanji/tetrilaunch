import Matter from "matter-js";
import { CELL, WORLD } from "./engine";
import type { Cube } from "./pieces";
import type { Compactor } from "./compactor";

const SLOW = 3; // px/step considered "at rest / being compressed"
const BLINK_MS = 1400;

// Module-level crossing tracker (mirrors main.py's check_and_clear_lines.last_box_idx)
let lastBoxIdx = -1;

export function resetLineClear(): void {
  lastBoxIdx = -1;
}

/**
 * Compactor-driven line clear. Rows to the right of the compactor that are
 * "full" (enough cubes) and pressed slowly against it get cleared.
 * Returns the number of lines cleared and removes their cubes.
 */
export function updateLineClear(
  world: Matter.World,
  cubes: Cube[],
  compactor: Compactor,
): number {
  const yThresh = 24;

  // Group cubes into rows.
  const rows = new Map<number, Cube[]>();
  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    const y = cube.body.position.y;
    const rowY = Math.round(y / CELL) * CELL;
    if (Math.abs(y - rowY) < yThresh) {
      (rows.get(rowY) ?? rows.set(rowY, []).get(rowY)!).push(cube);
    }
  }

  const compactorX = compactor.x;
  const availableWidth = WORLD.width - compactorX - 60;
  const minPieces = Math.max(2, Math.floor(availableWidth / CELL) - 1);

  // Only evaluate when the compactor crosses a new cell boundary.
  const compactorRight = compactor.x + compactor.width / 2;
  const boxIdx = Math.floor((WORLD.width - compactorRight) / CELL);
  if (boxIdx === lastBoxIdx) return 0;
  lastBoxIdx = boxIdx;

  const toRemove = new Set<Cube>();
  let cleared = 0;

  for (const [, items] of rows) {
    if (items.length < minPieces) continue;
    let nearCompactor = 0;
    let totalVel = 0;
    for (const c of items) {
      if (Math.abs(c.body.position.x - compactorX) < CELL * 2) nearCompactor++;
      totalVel += Math.abs(c.body.velocity.x);
    }
    if (nearCompactor >= 2 && totalVel / items.length < SLOW) {
      for (const c of items) toRemove.add(c);
      cleared++;
    }
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

/** Mark cubes stuck on the wrong (left) side of the compactor to blink out. */
export function markLostPieces(cubes: Cube[], compactor: Compactor, now: number): void {
  const left = compactor.x - compactor.width / 2;
  for (const c of cubes) {
    if (c.blinkStart !== null) continue;
    if (
      c.body.position.x < left &&
      Math.abs(c.body.velocity.x) < SLOW &&
      Math.abs(c.body.velocity.y) < SLOW
    ) {
      c.blinkStart = now;
    }
  }
}

/** Remove blinking cubes after their blink duration. Returns count despawned. */
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
