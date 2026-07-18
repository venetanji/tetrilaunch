import Matter from "matter-js";
import { CELL, createPhysics, stepPhysics, type PhysicsWorld } from "./engine";
import { Cannon, predictTrajectory } from "./cannon";
import { Compactor } from "./compactor";
import {
  createTetrisPiece,
  updateBreakableJoints,
  breakJointsInBand,
  type Cube,
} from "./pieces";
import {
  updateLineClear,
  markLostPieces,
  updateBlinking,
  resetLineClear,
  settleZoneCubes,
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

// The field tops out (you lose) when a settled cube reaches near the ceiling.
const TOPOUT_Y = 96;
const AT_REST = 2.5;
const AT_REST_SQ = AT_REST * AT_REST;

/** True if a body's speed is below the at-rest threshold (squared compare, no sqrt). */
function isAtRest(body: Matter.Body): boolean {
  const v = body.velocity;
  return v.x * v.x + v.y * v.y < AT_REST_SQ;
}

export class Game {
  phys: PhysicsWorld;
  cannon: Cannon;
  compactor: Compactor;
  cubes: Cube[] = [];
  constraints: Matter.Constraint[] = [];
  trajectory: Matter.Vector[] = [];

  score: number;
  combo = 0;
  linesTotal = 0;
  lostTotal = 0;
  status: GameStatus = "playing";
  /** Which condition triggered a "lost" status, for end-of-run copy. */
  lossReason: "topout" | "broke" | null = null;
  aiming = false;
  paused = false;

  readonly level: LevelConfig;
  private gAccel: number;
  private events: GameEvents;
  /** Timestamp (ms) the player first went "stuck broke" (see update()), or null. */
  private brokeSince: number | null = null;
  /** Grace window (ms) before stuck-broke becomes a loss: one full compactor
   *  round trip (Compactor.cycleSteps, retreat to open + press back to full
   *  advance) converted to ms via DT, plus a small buffer, capped at 30s so a
   *  degenerate compactorSpeed mutator can't make the grace effectively
   *  infinite. A full line already sitting in the zone must get its pressing
   *  stroke — which pays out and un-brokes the player — before the game calls
   *  it; a line clear raises score by >= scorePerLine > launchCost, so a
   *  rescue auto-cancels the countdown (see update()). */
  private readonly brokeGraceMs: number;

  constructor(level: LevelConfig, events: GameEvents = {}) {
    this.level = level;
    this.events = events;
    this.score = level.startingFunds;
    this.phys = createPhysics(level);
    this.cannon = new Cannon(level);
    this.compactor = new Compactor(this.phys.world, level);
    this.gAccel = this.phys.engine.gravity.y * this.phys.engine.gravity.scale * DT * DT;
    // Cap guards degenerate level configs (e.g. a near-zero compactorSpeed
    // mutator) from making the grace window — and so the broke-loss — effectively
    // unreachable.
    this.brokeGraceMs = Math.min(this.compactor.cycleSteps * DT + 2000, 30_000);
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
    if (this.score < this.level.launchCost) return false;
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
    this.score -= this.level.launchCost;
    this.events.onShoot?.();
    this.updateTrajectory();
    return true;
  }

  update(now: number): void {
    if (this.status !== "playing") return;

    stepPhysics(this.phys);
    // Capture BEFORE update(): the tick the bar exactly reaches its full-advance
    // stop is also the tick update() flips dir to -1 (pressing -> false) — read
    // after update(), that tick's settle/clear gate would be skipped entirely.
    const pressing = this.compactor.pressing;
    this.compactor.update();
    updateBreakableJoints(this.phys.world, this.constraints, this.level.jointBreakStretch);

    // The compactor shatters pieces it crushes into loose cubes (no deletion).
    breakJointsInBand(
      this.phys.world,
      this.constraints,
      this.compactor.x,
      this.compactor.top - CELL * 0.3,
      this.compactor.width / 2 + CELL,
    );

    // While pressing, physically settle near-resting cubes onto the slot grid
    // (vibro-compaction) so the strict clear rule below stays reachable even
    // when a cube wedges tilted against the wall.
    if (pressing) {
      settleZoneCubes(this.cubes, this.compactor, this.level);
    }

    // Cubes are ONLY removed when a full row is crushed against the wall on the
    // compactor's forward (pressure) stroke — a broken joint never deletes one.
    const cleared = pressing
      ? updateLineClear(this.phys.world, this.cubes, this.compactor, this.level)
      : 0;
    if (cleared > 0) {
      this.combo += 1;
      const bonus = 1 + (this.combo - 1) * 0.25;
      this.score += Math.round(cleared * this.level.scorePerLine * bonus);
      this.linesTotal += cleared;
      this.events.onLineClear?.(cleared);
    }

    // ...or when they bounce OUT before the compactor (blink away, lose points).
    markLostPieces(this.cubes, this.compactor, now);
    const lost = updateBlinking(this.phys.world, this.cubes, now);
    if (lost > 0) {
      this.combo = 0;
      this.lostTotal += lost;
      this.score = Math.max(0, this.score - lost * this.level.penaltyPerLostPiece);
      this.events.onPieceLost?.(lost);
    }

    // Broke-lose: the countdown STARTS only once we can't afford another shot
    // AND nothing is still moving (a shot in flight, or a pile still settling,
    // might yet clear a line and rescue the run) — but once started, only
    // funds recovery (a clear paying out, score >= launchCost again) cancels
    // it. Cube motion no longer resets it: a bar-agitated pile that never
    // fully rests (contact jitter on every press) would otherwise postpone the
    // broke-loss forever. allAtRest is only computed when it's actually needed
    // (score below cost AND the countdown hasn't started yet) to skip the
    // per-cube scan during normal play.
    if (this.score >= this.level.launchCost) {
      this.brokeSince = null;
    } else if (this.brokeSince === null) {
      const allAtRest = this.cubes.every((c) => isAtRest(c.body));
      if (allAtRest) this.brokeSince = now;
    }

    if (this.score >= this.target) this.setStatus("won");
    else if (this.isToppedOut()) {
      this.lossReason = "topout";
      this.setStatus("lost");
    } else if (this.brokeSince !== null && now - this.brokeSince > this.brokeGraceMs) {
      this.lossReason = "broke";
      this.setStatus("lost");
    }
  }

  /** Lose when a settled cube stacks up to the ceiling. */
  private isToppedOut(): boolean {
    for (const c of this.cubes) {
      const b = c.body;
      if (b.position.y < TOPOUT_Y && isAtRest(b)) {
        return true;
      }
    }
    return false;
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
