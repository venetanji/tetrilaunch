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
  const walls = [
    Matter.Bodies.rectangle(W / 2, -WALL_T / 2, W, WALL_T, wallOpts), // top
    Matter.Bodies.rectangle(W / 2, H + WALL_T / 2, W, WALL_T, wallOpts), // bottom
    Matter.Bodies.rectangle(-WALL_T / 2, H / 2, WALL_T, H, wallOpts), // left
    Matter.Bodies.rectangle(W + WALL_T / 2, H / 2, WALL_T, H, wallOpts), // right
  ];
  Matter.Composite.add(world, walls);

  return { engine, world, walls };
}

/** Advance the simulation by one fixed step (1/60 s). */
export function stepPhysics(phys: PhysicsWorld): void {
  Matter.Engine.update(phys.engine, 1000 / 60);
}
