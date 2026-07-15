import Matter from "matter-js";
import { createPhysics, stepPhysics, type PhysicsWorld } from "./engine";
import { Cannon, predictTrajectory } from "./cannon";
import { Compactor } from "./compactor";
import {
  createTetrisPiece,
  updateBreakableJoints,
  type Cube,
} from "./pieces";
import {
  updateLineClear,
  markLostPieces,
  updateBlinking,
  resetLineClear,
} from "./lineClear";
import type { LevelConfig } from "./level";

const DT = 1000 / 60;

export type GameStatus = "playing" | "won" | "lost";

export interface GameEvents {
  onLineClear?: (lines: number) => void;
  onShoot?: () => void;
  onPieceLost?: (count: number) => void;
  onStatus?: (status: GameStatus) => void;
}

const LOSE_LIMIT = 40;

export class Game {
  phys: PhysicsWorld;
  cannon: Cannon;
  compactor: Compactor;
  cubes: Cube[] = [];
  constraints: Matter.Constraint[] = [];
  trajectory: Matter.Vector[] = [];

  score = 0;
  combo = 0;
  linesTotal = 0;
  lostTotal = 0;
  status: GameStatus = "playing";
  aiming = false;
  paused = false;

  readonly level: LevelConfig;
  private gAccel: number;
  private events: GameEvents;

  constructor(level: LevelConfig, events: GameEvents = {}) {
    this.level = level;
    this.events = events;
    this.phys = createPhysics(level);
    this.cannon = new Cannon(level);
    this.compactor = new Compactor(this.phys.world, level);
    this.gAccel = this.phys.engine.gravity.y * this.phys.engine.gravity.scale * DT * DT;
    resetLineClear();
    this.updateTrajectory();
  }

  get target(): number {
    return this.level.targetScore;
  }

  updateTrajectory(): void {
    this.trajectory = predictTrajectory(
      this.cannon.tip,
      this.cannon.velocity,
      this.gAccel,
      0.012,
    );
  }

  shoot(now: number): boolean {
    if (this.status !== "playing" || this.paused) return false;
    if (!this.cannon.canShoot(now)) return false;
    const piece = createTetrisPiece(
      this.phys.world,
      this.cannon.tip.x,
      this.cannon.tip.y,
      this.cannon.pieceRotation,
      this.cannon.velocity,
      this.cannon.currentType,
    );
    this.cubes.push(...piece.cubes);
    this.constraints.push(...piece.constraints);
    this.cannon.markShot(now);
    this.events.onShoot?.();
    this.updateTrajectory();
    return true;
  }

  update(now: number): void {
    if (this.status !== "playing") return;

    stepPhysics(this.phys);
    this.compactor.update();
    updateBreakableJoints(this.phys.world, this.constraints);

    markLostPieces(this.cubes, this.compactor, now);

    const cleared = updateLineClear(this.phys.world, this.cubes, this.compactor);
    if (cleared > 0) {
      this.combo += 1;
      const bonus = 1 + (this.combo - 1) * 0.25;
      this.score += Math.round(cleared * this.level.scorePerLine * bonus);
      this.linesTotal += cleared;
      this.events.onLineClear?.(cleared);
    }

    const lost = updateBlinking(this.phys.world, this.cubes, now);
    if (lost > 0) {
      this.combo = 0;
      this.lostTotal += lost;
      this.score = Math.max(0, this.score - lost * this.level.penaltyPerLostPiece);
      this.events.onPieceLost?.(lost);
    }

    this.updateTrajectory();

    if (this.score >= this.target) this.setStatus("won");
    else if (this.lostTotal >= LOSE_LIMIT) this.setStatus("lost");
  }

  private setStatus(s: GameStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.events.onStatus?.(s);
  }

  destroy(): void {
    Matter.World.clear(this.phys.world, false);
    Matter.Engine.clear(this.phys.engine);
  }
}
