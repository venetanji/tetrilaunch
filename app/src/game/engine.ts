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
  // Resting cubes sleep. Profiled on device (OnePlus 12, 2026-08-09, ~265
  // cubes / ~700 pairs): narrowphase + solver over the RESTING pile was ~73%
  // of the frame loop at 7.6ms/step — the sweep-telemetry spec's "measure
  // first" bar for this switch. Matter skips detection and solving for
  // sleeping pairs, but it also never wakes a sleeping body that a
  // kinematically-moved static (the compactor) is about to plow through, or
  // whose support was deleted outright — every mutation path that can do
  // either owes an explicit wake. Those live in game.ts (compactor band,
  // detonations, bond breaker) and lineClear.ts (wakeNear at every removal).
  engine.enableSleeping = true;

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

/**
 * WHERE A DRAWN BODY WAS AT THE END OF THE PREVIOUS STEP.
 *
 * The bay is a fixed-step simulation — stepPhysics advances it in 1/60s
 * chunks, and every constant in the game is authored in px/step against that.
 * The DISPLAY refreshes whenever the panel does, which on a 120Hz screen is
 * twice per step. With nothing between the two, both frames of a pair read the
 * same `body.position` and the world moves at 60Hz however fast the panel is:
 * 120 painted frames, 60 distinct world states, and the second frame of every
 * pair is pure cost.
 *
 * So every body that gets DRAWN records where it was one step ago, and
 * render.ts reads it back through lerpX/lerpY/lerpAngle at an `alpha` of "how
 * far into the step now in progress is this frame" — main.ts's leftover
 * accumulator over one STEP.
 *
 * THE SIMULATION IS UNTOUCHED, and that is the whole appeal: the step stays at
 * 60Hz, so SPEED_MAX is still 28 px/step, gravity.scale is still 0.0022, the
 * compactor still travels compactorSpeed px/step, and the Mark ladder is still
 * calibrated against the bays sim/sweep.ts measured. Nothing here is a physics
 * change; it is a statement about which of two known positions to paint.
 *
 * THE PRICE is that the drawn world lags the simulated one by up to one step
 * (16.7ms), because interpolating between two known states can only ever run
 * between them. Nothing the player steers pays it: the cannon, the aim cone,
 * the dotted arc and the reload ring are not physics bodies and are drawn live
 * off the cannon's own state, so aiming is exactly as immediate as it was. The
 * lag lands only on cargo already in the air and on a pile that is mostly
 * asleep, where 16.7ms is not a quantity anyone can see.
 *
 * STAMPED ON THE BODY rather than kept in a side table for two reasons: the
 * readers are per-cube-per-frame in the hottest loop the renderer has
 * (sim/renderperf puts the cube layer at 15.8ms of a 20ms frame at 300 cubes,
 * so nothing in that loop should allocate or hash), and a weld seam is drawn
 * from bodyA/bodyB with no Cube wrapper anywhere in reach (render.ts's
 * drawJointSeams). pieces.ts already stamps constraints on exactly these terms
 * — see JointMeta.
 */
export interface PrevStep {
  prevX?: number;
  prevY?: number;
  prevAngle?: number;
}

/**
 * Record a body's CURRENT transform as its previous one.
 *
 * Called on every drawn body immediately BEFORE the step that moves it (see
 * Game.update), which is what makes the pair "where it was" and "where it is".
 *
 * It is also how a deliberate TELEPORT opts out of being interpolated: call it
 * AFTER the jump and the body is drawn at its new home from the very next
 * frame instead of sliding there over a step it never travelled.
 * Compactor.reset is the one caller that needs that — a bar snapping back to
 * its open stop between bays has not swept across the bay, and with acc reset
 * to 0 on the same beat (main.ts) an un-marked reset would draw the bar at its
 * OLD position for a frame.
 */
export function markPrevStep(b: Matter.Body): void {
  const p = b as PrevStep;
  p.prevX = b.position.x;
  p.prevY = b.position.y;
  p.prevAngle = b.angle;
}

/**
 * A body's drawn x/y/angle at `alpha` (0..1) through the step in progress.
 *
 * A body that has never been marked answers with its live transform, so the
 * failure mode of a missed mark is "draws exactly like it did before
 * interpolation existed" rather than a NaN. That is not only a safety net: a
 * cube spawned partway through a step is genuinely in that state for the rest
 * of the frame, and drawing it at the muzzle it just left is correct.
 *
 * Angle needs no wrap handling. Matter accumulates `body.angle` continuously
 * (Body.update adds angularVelocity to it, and every setAngle in the codebase
 * targets the nearest quarter turn to the CURRENT value — see lineClear's
 * grind and alignMagnetic), so consecutive steps are never a turn apart and a
 * plain lerp can never take the short way round the wrong side.
 */
export function lerpX(b: Matter.Body, alpha: number): number {
  const p = (b as PrevStep).prevX;
  return p === undefined ? b.position.x : p + (b.position.x - p) * alpha;
}

export function lerpY(b: Matter.Body, alpha: number): number {
  const p = (b as PrevStep).prevY;
  return p === undefined ? b.position.y : p + (b.position.y - p) * alpha;
}

export function lerpAngle(b: Matter.Body, alpha: number): number {
  const p = (b as PrevStep).prevAngle;
  return p === undefined ? b.angle : p + (b.angle - p) * alpha;
}
