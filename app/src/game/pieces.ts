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

// Break a joint once it is stretched well past its rest length — a hard impact
// momentarily yanks the stiff constraint, mimicking pymunk's max_force joints.
const BREAK_STRETCH = 1.7;

function dist(a: Matter.Vector, b: Matter.Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  const shape = PIECE_SHAPES[type];
  const color = PIECE_COLORS[type];
  const cubes: Cube[] = [];

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (const [px, py] of shape) {
    const ox = (px - 1.5) * CELL;
    const oy = (py - 1.5) * CELL;
    const rx = ox * cos - oy * sin;
    const ry = ox * sin + oy * cos;

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

/** Remove over-stretched joints so pieces break apart on hard impacts. */
export function updateBreakableJoints(
  world: Matter.World,
  constraints: Matter.Constraint[],
): void {
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i];
    if (!c.bodyA || !c.bodyB) continue;
    const rest = (c as unknown as { restLength: number }).restLength || c.length;
    const cur = dist(c.bodyA.position, c.bodyB.position);
    if (cur > rest * BREAK_STRETCH) {
      Matter.Composite.remove(world, c);
      constraints.splice(i, 1);
    }
  }
}
