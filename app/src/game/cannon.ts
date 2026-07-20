import Matter from "matter-js";
import { WORLD } from "./engine";
import { PIECE_TYPES, type PieceType } from "./theme";
import type { LevelConfig } from "./level";

// Launch speeds in px/step (matter velocity units). Drag distance maps here.
export const SPEED_MIN = 9;
// 28, not 26: reach analysis (sim/ tuning) showed max-power landings topped
// out at x≈1228, 1.3 cells short of the back wall (x=1280) — a skilled
// player couldn't reach the last strip of the bay at any angle. 28 closes it
// (see engine.ts's SKY doc comment for the resulting apex height check).
export const SPEED_MAX = 28;

// Drag distance (px, world space) that maps to full power. Kept short so a
// modest pull-back already reaches max power.
const DRAG_MIN = 28;
const DRAG_MAX = 220;

export const CANNON = { x: 150, y: Math.round(WORLD.height * 0.4), size: 60, barrel: 64 };

export class Cannon {
  x = CANNON.x;
  y = CANNON.y;
  /** Aim angle in radians. 0 = right, positive = upward (matches main.py). */
  angle = Math.PI / 9;
  /** Launch speed in px/step. */
  power = SPEED_MIN;
  pieceRotation = 0;
  lastShot = -99999;

  pieceIndex = 0;
  currentType: PieceType;
  nextType: PieceType;

  private seq: PieceType[];
  private cooldownMs: number;

  constructor(level: LevelConfig) {
    this.seq = level.pieceSequence ?? PIECE_TYPES;
    this.cooldownMs = level.cooldownMs;
    this.currentType = this.seq[0];
    this.nextType = this.seq[1 % this.seq.length];
  }

  get tip(): Matter.Vector {
    return {
      x: this.x + CANNON.barrel * Math.cos(this.angle),
      y: this.y - CANNON.barrel * Math.sin(this.angle),
    };
  }

  /** Velocity vector (px/step) for the current aim + power. */
  get velocity(): Matter.Vector {
    return {
      x: this.power * Math.cos(this.angle),
      y: -this.power * Math.sin(this.angle),
    };
  }

  get powerRatio(): number {
    return (this.power - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  }

  /** Set aim + power from a world-space drag vector originating at the cannon.
   *  Slingshot pull-back: the launch direction is OPPOSITE the drag (drag
   *  down-left to fire up-right), reversed 180° from the raw drag vector. */
  aimFromDrag(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (len < 4) return;
    // Reverse the drag vector, then constrain to the upper-right launch cone.
    let ang = Math.atan2(dy, -dx);
    ang = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, ang));
    this.angle = ang;
    const t = Math.max(0, Math.min(1, (len - DRAG_MIN) / (DRAG_MAX - DRAG_MIN)));
    this.power = SPEED_MIN + t * (SPEED_MAX - SPEED_MIN);
  }

  // --- Keyboard fallback (web) ---
  aimUp() { this.angle = Math.min(Math.PI / 3, this.angle + 0.035); }
  aimDown() { this.angle = Math.max(-Math.PI / 3, this.angle - 0.035); }
  powerUp() { this.power = Math.min(SPEED_MAX, this.power + 0.4); }
  powerDown() { this.power = Math.max(SPEED_MIN, this.power - 0.4); }
  // Canvas y-axis points DOWN, so a POSITIVE angle rotates the piece
  // clockwise on screen. rotateLeft (⟲) must look counter-clockwise, so it
  // subtracts; rotateRight (⟳) adds. 90° steps give the player predictable,
  // readable orientations instead of a blind ±15° nudge.
  rotateLeft() { this.pieceRotation -= Math.PI / 2; }
  rotateRight() { this.pieceRotation += Math.PI / 2; }

  /** Current orientation as a 0-3 quarter-turn index (clockwise), for UI previews. */
  get quarterTurns(): number {
    return ((Math.round(this.pieceRotation / (Math.PI / 2)) % 4) + 4) % 4;
  }

  canShoot(now: number): boolean {
    return now - this.lastShot >= this.cooldownMs;
  }
  cooldownRemaining(now: number): number {
    return Math.max(0, this.cooldownMs - (now - this.lastShot));
  }

  /** Reset the fire cooldown only, without advancing the piece queue — a
   *  bomb shot consumes the cooldown but leaves the loaded piece in place. */
  markCooldown(now: number): void {
    this.lastShot = now;
  }

  markShot(now: number): void {
    this.markCooldown(now);
    this.pieceIndex = (this.pieceIndex + 1) % this.seq.length;
    this.currentType = this.nextType;
    this.nextType = this.seq[(this.pieceIndex + 1) % this.seq.length];
    this.pieceRotation = 0;
  }
}

/**
 * Analytic parabola preview that mirrors matter's per-step integration
 * (constant gravity accel + air damping), so the dotted arc matches the
 * flight. `windAt(i)` returns the wind acceleration for step `i` (0-based,
 * relative to "now") — a FUNCTION rather than a single scalar because wind
 * is a sine of stepCount (see game.ts's windNow) with a period only ~9-15x
 * a typical flight's duration: holding it constant across the whole ~140
 * steps here materially mismatches the real per-step value the actual
 * flight will experience under game.ts's applyWind, especially for a bot
 * (like sim/bots.ts's `aim`) whose whole strategy is re-solving against
 * this exact preview. Defaults to a still-air `() => 0` so every other
 * caller (main.ts's live HUD arc, which only ever wants "wind as of right
 * now" smeared across the preview) is unaffected.
 */
export function predictTrajectory(
  start: Matter.Vector,
  vel: Matter.Vector,
  gAccel: number,
  frictionAir: number,
  steps = 140,
  windAt: (step: number) => number = () => 0,
): Matter.Vector[] {
  const pts: Matter.Vector[] = [];
  let x = start.x;
  let y = start.y;
  let vx = vel.x;
  let vy = vel.y;
  for (let i = 0; i < steps; i++) {
    pts.push({ x, y });
    vy += gAccel;
    vx += windAt(i);
    vx *= 1 - frictionAir;
    vy *= 1 - frictionAir;
    x += vx;
    y += vy;
    if (x < 0 || x > WORLD.width || y > WORLD.height) break;
  }
  return pts;
}
