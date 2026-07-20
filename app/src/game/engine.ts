import Matter from "matter-js";
import type { LevelConfig } from "./level";

/** Fixed virtual play-field resolution (16:9 landscape). Everything is authored
 *  in these coordinates; render.ts scales to the actual canvas (letterboxed). */
export const WORLD = { width: 1280, height: 720 };

export const CELL = 40; // cube size (px)

/** Inner face of the right wall — the surface the compactor presses the pile
 *  against, and the anchor of the line-clear slot grid. The wall body is
 *  WALL_T=40 thick centered at WORLD.width + WALL_T/2, so its inner face sits
 *  exactly at WORLD.width; anchoring anywhere else desyncs the slot grid from
 *  where wall-flush cubes physically rest. */
export const WALL_INNER = WORLD.width;

export interface PhysicsWorld {
  engine: Matter.Engine;
  world: Matter.World;
  walls: Matter.Body[];
}

const WALL_T = 40;

/** How far above y=0 the left/right walls extend, so lofted pieces can't
 *  drift sideways out of the open-top shaft and land outside the field.
 *  Max power (28 px/step, see cannon.ts's SPEED_MAX) at up to 60° gives vy
 *  ~= 24.2 px/step against a per-step gravity accel of ~0.611 px/step^2, for
 *  an apex ~250px above y=0 (cannon at y=288, barrel tip up to ~55px
 *  higher). 600px comfortably exceeds that ~250px max overshoot. */
const SKY = 600;

export function createPhysics(level: LevelConfig): PhysicsWorld {
  const engine = Matter.Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = level.gravity;
  engine.gravity.scale = 0.0022; // tuned so launch arcs span the field
  // A couple of extra solver iterations keep stacked cubes from sinking.
  engine.positionIterations = 8;
  engine.velocityIterations = 8;

  const world = engine.world;

  const wallOpts: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    restitution: 0.2,
    friction: 0.8,
    label: "wall",
  };
  const { width: W, height: H } = WORLD;
  // World boundaries: bottom is closed (pieces settle on it), left/right are
  // closed but extend well above y=0 into the "sky" so a high launch arc
  // can't drift sideways past them while off-screen. The top is intentionally
  // open — high-power lofted shots are allowed to fly above y=0 and fall back
  // into the field under gravity rather than bouncing off a ceiling.
  const sideH = H + SKY; // spans y = -SKY .. H
  const sideCy = (H - SKY) / 2; // vertical center of that span
  const walls = [
    Matter.Bodies.rectangle(W / 2, H + WALL_T / 2, W, WALL_T, wallOpts), // bottom
    Matter.Bodies.rectangle(-WALL_T / 2, sideCy, WALL_T, sideH, wallOpts), // left
    Matter.Bodies.rectangle(W + WALL_T / 2, sideCy, WALL_T, sideH, wallOpts), // right
  ];
  Matter.Composite.add(world, walls);

  return { engine, world, walls };
}

/** Advance the simulation by one fixed step (1/60 s). */
export function stepPhysics(phys: PhysicsWorld): void {
  Matter.Engine.update(phys.engine, 1000 / 60);
}
