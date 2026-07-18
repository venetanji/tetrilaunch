import Matter from "matter-js";
import { CELL, WALL_INNER, createPhysics, stepPhysics, type PhysicsWorld } from "./engine";
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
  type ClearResult,
} from "./lineClear";
import type { LevelConfig } from "./level";
import { FX_TTL, type FxEvent } from "./fx";

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

/** Physics steps a bomb must survive before a collision can detonate it — a
 *  freshly-launched bomb clips the cannon/other in-flight cubes on its way
 *  out, and those aren't a "landed" trigger. */
const BOMB_ARM_STEPS = 5;
/** Fallback fuse (physics steps) so a bomb that never touches anything (e.g.
 *  sails off past the walls) still goes off instead of lingering forever. */
const BOMB_FUSE_STEPS = 300;
/** Blast radius: cubes centered within this are destroyed outright. */
const BOMB_BLAST_R = CELL * 2.4;
/** Cubes within 2x the blast radius get a radial shove instead of removal. */
const BOMB_SHOVE_MULT = 2;
const BOMB_SHOVE_SPEED = 10;

interface Bomb {
  body: Matter.Body;
  /** Game.stepCount at spawn — arming and the fuse are both measured from here. */
  bornStep: number;
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
  lossReason: "topout" | "broke" | "time" | null = null;
  aiming = false;
  paused = false;

  /** Countdown in ms; Infinity when level.timeLimitSec is 0 (no limit). */
  timeLeftMs: number;
  /** Pieces AND bombs fired so far this level — drives nextIsBomb. */
  shotsFired = 0;
  /** Render-facing FX events (shatter/payout/rowflash/explosion); spawned
   *  here, pruned here by FX_TTL, drawn by render.ts. */
  effects: FxEvent[] = [];

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

  /** Physics steps elapsed (one per update() call) — bombs use this instead
   *  of wall-clock time so arming/fuse timing is pause-safe by construction
   *  (update doesn't run while paused). */
  private stepCount = 0;
  private liveBombs: Bomb[] = [];
  private pendingDetonations = new Set<Matter.Body>();
  private readonly onCollisionStart: (e: Matter.IEventCollision<Matter.Engine>) => void;

  constructor(level: LevelConfig, events: GameEvents = {}) {
    this.level = level;
    this.events = events;
    this.score = level.startingFunds;
    this.timeLeftMs = level.timeLimitSec > 0 ? level.timeLimitSec * 1000 : Infinity;
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

    this.onCollisionStart = (e) => {
      for (const pair of e.pairs) {
        for (const bomb of this.liveBombs) {
          if (pair.bodyA === bomb.body || pair.bodyB === bomb.body) {
            if (this.stepCount - bomb.bornStep >= BOMB_ARM_STEPS) {
              this.pendingDetonations.add(bomb.body);
            }
          }
        }
      }
    };
    Matter.Events.on(this.phys.engine, "collisionStart", this.onCollisionStart);
  }

  get target(): number {
    return this.level.targetScore;
  }

  /** True if the NEXT shot fired (shotsFired + 1, 1-based) lands on the bomb
   *  cadence — lets the HUD/muzzle preview show a bomb before it's fired. */
  get nextIsBomb(): boolean {
    return this.level.bombEvery > 0 && (this.shotsFired + 1) % this.level.bombEvery === 0;
  }

  /** Live bomb bodies, for render.ts to draw. */
  get bombs(): Matter.Body[] {
    return this.liveBombs.map((b) => b.body);
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

    // Read before shotsFired advances: nextIsBomb describes the shot about to
    // be fired (shotsFired + 1), so it must be evaluated pre-increment.
    const firingBomb = this.nextIsBomb;
    this.score -= this.level.launchCost;
    this.shotsFired += 1;

    if (firingBomb) {
      this.spawnBomb();
      // Cooldown-only: the queued piece stays loaded for the next real shot.
      this.cannon.markCooldown(now);
    } else {
      const piece = createTetrisPiece(
        this.phys.world,
        this.cannon.tip.x,
        this.cannon.tip.y,
        this.cannon.pieceRotation,
        this.cannon.velocity,
        this.cannon.currentType,
        this.level.jointStiffness,
        this.level.pieceCubes,
      );
      this.cubes.push(...piece.cubes);
      this.constraints.push(...piece.constraints);
      this.cannon.markShot(now);
    }

    this.events.onShoot?.();
    this.updateTrajectory();
    return true;
  }

  private spawnBomb(): void {
    const tip = this.cannon.tip;
    const body = Matter.Bodies.circle(tip.x, tip.y, CELL * 0.45, {
      density: 0.002,
      friction: 0.5,
      frictionAir: 0.012,
      restitution: 0.1,
      label: "bomb",
    });
    Matter.Body.setVelocity(body, this.cannon.velocity);
    Matter.Composite.add(this.phys.world, body);
    this.liveBombs.push({ body, bornStep: this.stepCount });
  }

  update(now: number): void {
    if (this.status !== "playing") return;

    if (this.timeLeftMs !== Infinity) {
      this.timeLeftMs = Math.max(0, this.timeLeftMs - DT);
    }

    this.stepCount++;
    stepPhysics(this.phys);

    // Fuse: a bomb that never collides with anything still has to go off.
    for (const bomb of this.liveBombs) {
      if (this.stepCount - bomb.bornStep >= BOMB_FUSE_STEPS) {
        this.pendingDetonations.add(bomb.body);
      }
    }
    if (this.pendingDetonations.size) {
      for (const body of this.pendingDetonations) this.detonate(body, now);
      this.pendingDetonations.clear();
    }

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
    const clear: ClearResult = pressing
      ? updateLineClear(this.phys.world, this.cubes, this.compactor, this.level)
      : { lines: 0, cubes: [], rows: [] };
    if (clear.lines > 0) {
      this.combo += 1;
      const bonus = 1 + (this.combo - 1) * 0.25;
      const awarded = Math.round(clear.lines * this.level.scorePerLine * bonus);
      this.score += awarded;
      this.linesTotal += clear.lines;
      this.events.onLineClear?.(clear.lines);
      this.spawnClearFx(clear, awarded, now);
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
    } else if (this.timeLeftMs <= 0) {
      this.lossReason = "time";
      this.setStatus("lost");
    }

    if (this.effects.length) {
      this.effects = this.effects.filter((e) => now - e.t0 < FX_TTL[e.kind]);
    }
  }

  /** Push the FX events a clear implies: one shatter per removed cube, one
   *  rowflash per cleared row (spanning the compactor face to the wall), and
   *  a single payout at the cluster's rough centroid/top with the actual
   *  awarded amount (post-combo-bonus). */
  private spawnClearFx(clear: ClearResult, awarded: number, now: number): void {
    for (const c of clear.cubes) {
      this.effects.push({ kind: "shatter", x: c.x, y: c.y, color: c.color, t0: now });
    }
    const face = this.compactor.x + this.compactor.width / 2;
    for (const y of clear.rows) {
      this.effects.push({ kind: "rowflash", y, x0: face, x1: WALL_INNER, t0: now });
    }
    if (clear.cubes.length) {
      const meanX = clear.cubes.reduce((s, c) => s + c.x, 0) / clear.cubes.length;
      const minY = Math.min(...clear.cubes.map((c) => c.y));
      this.effects.push({ kind: "payout", x: meanX, y: minY - 30, amount: awarded, t0: now });
    }
  }

  /**
   * Blow up a bomb: every cube centered within BOMB_BLAST_R is destroyed
   * outright (its constraints too — a stray joint pointing at a removed body
   * would otherwise dangle); cubes out to BOMB_SHOVE_MULT * BOMB_BLAST_R get
   * a radial velocity kick instead. No score effect either way — bombs are a
   * cleanup tool, not a scoring one, so no lost-piece penalty and no payout,
   * and combo is left untouched.
   */
  private detonate(bombBody: Matter.Body, now: number): void {
    const idx = this.liveBombs.findIndex((b) => b.body === bombBody);
    if (idx === -1) return; // already handled this frame (multiple pairs, fuse+collision, ...)
    this.liveBombs.splice(idx, 1);

    const cx = bombBody.position.x;
    const cy = bombBody.position.y;
    const shoveR = BOMB_SHOVE_MULT * BOMB_BLAST_R;

    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const b = this.cubes[i].body;
      const dx = b.position.x - cx;
      const dy = b.position.y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= BOMB_BLAST_R) {
        for (let j = this.constraints.length - 1; j >= 0; j--) {
          const c = this.constraints[j];
          if (c.bodyA === b || c.bodyB === b) {
            Matter.Composite.remove(this.phys.world, c);
            this.constraints.splice(j, 1);
          }
        }
        Matter.Composite.remove(this.phys.world, b);
        this.cubes.splice(i, 1);
      } else if (d <= shoveR) {
        const mag = BOMB_SHOVE_SPEED * (1 - d / shoveR);
        Matter.Body.setVelocity(b, {
          x: b.velocity.x + (dx / d) * mag,
          y: b.velocity.y + (dy / d) * mag,
        });
      }
    }

    Matter.Composite.remove(this.phys.world, bombBody);
    this.effects.push({ kind: "explosion", x: cx, y: cy, r: BOMB_BLAST_R, t0: now });
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
    Matter.Events.off(this.phys.engine, "collisionStart", this.onCollisionStart);
    Matter.World.clear(this.phys.world, false);
    Matter.Engine.clear(this.phys.engine);
  }
}
