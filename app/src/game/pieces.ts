import Matter from "matter-js";
import { CELL } from "./engine";
import { PIECE_SHAPES, PIECE_COLORS, type PieceType } from "./theme";

export interface Cube {
  body: Matter.Body;
  type: PieceType;
  color: string;
  /** Timestamp (ms) when this cube began blinking before despawn, or null. */
  blinkStart: number | null;
}

export interface Piece {
  cubes: Cube[];
  constraints: Matter.Constraint[];
}

function dist(a: Matter.Vector, b: Matter.Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * World-space offsets (px) of a piece's 4 cubes from its OWN centroid, rotated
 * by `angle` (radians). Centroid-anchored (not the enclosing 4x4 grid's center
 * at (1.5, 1.5)) so rotating a piece spins it in place — several shapes (I, L,
 * J, S, Z, T) have a centroid that differs from grid-center, so pivoting on
 * grid-center would visibly translate/teleport them on every turn instead of
 * spinning. Shared by createTetrisPiece (world spawn) and render.ts's muzzle
 * ghost preview, so both draw the exact same rotated shape.
 */
export function pieceOffsets(type: PieceType, angle: number): { x: number; y: number }[] {
  const shape = PIECE_SHAPES[type];
  const cx = shape.reduce((s, [px]) => s + px, 0) / shape.length;
  const cy = shape.reduce((s, [, py]) => s + py, 0) / shape.length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return shape.map(([px, py]) => {
    const ox = (px - cx) * CELL;
    const oy = (py - cy) * CELL;
    return { x: ox * cos - oy * sin, y: ox * sin + oy * cos };
  });
}

/** Build a tetromino from 4 cubes rigidly joined by breakable distance joints. */
export function createTetrisPiece(
  world: Matter.World,
  x: number,
  y: number,
  angle: number,
  velocity: Matter.Vector,
  type: PieceType,
): Piece {
  const color = PIECE_COLORS[type];
  const cubes: Cube[] = [];

  for (const { x: rx, y: ry } of pieceOffsets(type, angle)) {
    const body = Matter.Bodies.rectangle(x + rx, y + ry, CELL, CELL, {
      friction: 0.5,
      frictionAir: 0.012,
      restitution: 0.05,
      density: 0.001,
      label: "cube",
      chamfer: { radius: 3 },
    });
    Matter.Body.setAngle(body, angle);
    Matter.Body.setVelocity(body, velocity);
    Matter.Composite.add(world, body);
    cubes.push({ body, type, color, blinkStart: null });
  }

  // Connect every pair → a rigid-but-shatterable cluster.
  const constraints: Matter.Constraint[] = [];
  for (let i = 0; i < cubes.length; i++) {
    for (let j = i + 1; j < cubes.length; j++) {
      const a = cubes[i].body;
      const b = cubes[j].body;
      const rest = dist(a.position, b.position);
      const c = Matter.Constraint.create({
        bodyA: a,
        bodyB: b,
        length: rest,
        stiffness: 0.9,
        damping: 0.1,
        render: { visible: false },
      });
      (c as unknown as { restLength: number }).restLength = rest;
      constraints.push(c);
      Matter.Composite.add(world, c);
    }
  }

  return { cubes, constraints };
}

/**
 * Break the joints of any piece the compactor bar is crushing, so tetrominoes
 * shatter into loose cubes as the compactor sweeps into them — without deleting
 * the cubes (only full lines get cleared). Only affects cubes down at the bar's
 * level (y past `topY`), so pieces flying over the bar aren't broken mid-air.
 */
export function breakJointsInBand(
  world: Matter.World,
  constraints: Matter.Constraint[],
  x: number,
  topY: number,
  halfBand: number,
): void {
  const inBand = (b: Matter.Body) =>
    Math.abs(b.position.x - x) < halfBand && b.position.y > topY;
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i];
    if (!c.bodyA || !c.bodyB) continue;
    if (inBand(c.bodyA) || inBand(c.bodyB)) {
      Matter.Composite.remove(world, c);
      constraints.splice(i, 1);
    }
  }
}

/**
 * Remove over-stretched joints so pieces break apart on hard impacts. A joint
 * breaks once stretched past its rest length by `breakStretch` — a hard impact
 * momentarily yanks the stiff constraint, mimicking pymunk's max_force joints.
 */
export function updateBreakableJoints(
  world: Matter.World,
  constraints: Matter.Constraint[],
  breakStretch: number,
): void {
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i];
    if (!c.bodyA || !c.bodyB) continue;
    const rest = (c as unknown as { restLength: number }).restLength || c.length;
    const cur = dist(c.bodyA.position, c.bodyB.position);
    if (cur > rest * breakStretch) {
      Matter.Composite.remove(world, c);
      constraints.splice(i, 1);
    }
  }
}
