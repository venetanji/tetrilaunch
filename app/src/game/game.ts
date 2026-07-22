import Matter from "matter-js";
import { CELL, WALL_INNER, WORLD, createPhysics, stepPhysics, type PhysicsWorld } from "./engine";
import { Cannon, predictTrajectory } from "./cannon";
import { Compactor } from "./compactor";
import {
  createTetrisPiece,
  updateBreakableJoints,
  breakJointsInBand,
  removeConstraintsFor,
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
import { mulberry32 } from "./mods";
import { FX_TTL, type FxEvent } from "./fx";

const DT = 1000 / 60;

export type GameStatus = "playing" | "won" | "lost";

export interface GameEvents {
  onLineClear?: (lines: number) => void;
  onShoot?: () => void;
  onPieceLost?: (count: number) => void;
  onStatus?: (status: GameStatus) => void;
  /** Fired when the Bond Breaker ability successfully discharges (see
   *  useBondBreaker) — lets the UI play a haptic/SFX cue. */
  onBondBreak?: () => void;
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

/** Wind only nudges bodies that are actually flying — above AT_REST (2.5) with
 *  a small buffer so it can never tug at the settled pile (see windNow /
 *  update()'s wind-application loop below). */
const WIND_AIRBORNE_SPEED = 3;
const WIND_AIRBORNE_SPEED_SQ = WIND_AIRBORNE_SPEED * WIND_AIRBORNE_SPEED;

/** Physics steps per second — the inverse of DT (1000/60 ms/step, engine.ts's
 *  fixed 60Hz stepPhysics). Exists so the wind tuning below can be specified
 *  as real-world SECONDS and converted to a per-step rate explicitly, rather
 *  than hand-tuned as a bare per-step magic number with the timescale left
 *  implicit — see WIND_TAU_SEC's comment for why that implicitness is
 *  exactly what caused this mechanic's timescale bug. */
const STEPS_PER_SEC = 1000 / DT;

/** Decorrelation time constant (in SECONDS) of the drunk-walking wind: how
 *  long it takes (1 - 1/e ≈ 63%) of a step's displacement from windAvg to
 *  revert. Tuned to ~5s so the wind is close to constant across one shot's
 *  ~1.5-2.5s flight (see updateTrajectory's doc — the preview literally
 *  assumes this) while still drifting noticeably over a whole bay (bays run
 *  150s+).
 *
 *  PREVIOUSLY this constant didn't exist: WIND_REVERT was hand-set to a bare
 *  per-step 0.05 with no stated unit. Applied once per physics step at the
 *  engine's fixed 60 steps/sec, that gave tau = 1/(0.05*60) ≈ 0.33s — the
 *  wind was completely re-rolling its character ~3x per second (~6x within
 *  a single ~2s flight), which read to players as flicker/noise instead of
 *  a legible breeze. That was an implicit-units bug: 0.05 looks like a
 *  reasonable "5% per tick" rate, but nothing tied "tick" to a real-time
 *  rate, so it was ~15x too fast for a human to read. WIND_TAU_SEC forces
 *  the timescale to be named explicitly instead. */
const WIND_TAU_SEC = 5;

/** Per-step pull-back-to-average fraction used by stepWind, derived from
 *  WIND_TAU_SEC via the standard discrete-time relation for an AR(1)/OU
 *  process: holding (1 - WIND_REVERT) = exp(-1 / (WIND_TAU_SEC *
 *  STEPS_PER_SEC)) keeps the real-world decorrelation time fixed at
 *  WIND_TAU_SEC seconds regardless of the physics step rate, instead of the
 *  old bare-per-step constant that silently meant something different at
 *  every step rate. At WIND_TAU_SEC=5 (60 steps/sec) this works out to
 *  ≈0.00333 — about 1/15th of the old flat 0.05, which is the
 *  order-of-magnitude correction this bug needed.
 *
 *  Together with each bay's windGust (level.ts — sized as a fraction of
 *  windMax, see WIND_GUST_FRACTION there), this sets the stationary spread
 *  of the drunk walk around windAvg. For a uniform per-step nudge of
 *  ±windGust and per-step revert WIND_REVERT, the standard deviation of
 *  (windCur − windAvg) at steady state is (small-WIND_REVERT approximation
 *  of the exact discrete-OU variance):
 *    std ≈ (windGust / √3) / √(2 · WIND_REVERT · (1 − WIND_REVERT / 2))
 *  With WIND_GUST_FRACTION=0.025 and WIND_TAU_SEC=5 that comes out to std ≈
 *  17.7% of windMax at every windy bay (e.g. bay 4's windMax 0.06 → std ≈
 *  ±0.0106) — gusts read as texture around a legible prevailing average,
 *  not noise the size of the average itself (the old flat windGust=0.03 was
 *  std ≈ ±0.055, i.e. almost the ENTIRE windMax cap at bay 4). */
const WIND_REVERT = 1 - Math.exp(-1 / (WIND_TAU_SEC * STEPS_PER_SEC));

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
  /** Bond Breaker charges left this bay (see useBondBreaker). Seeded from
   *  level.bondBreakerCharges — 0 unless the player drafted the mod. */
  bondCharges: number;
  /** Render-facing FX events (shatter/payout/rowflash/explosion); spawned
   *  here, pruned here by FX_TTL, drawn by render.ts. */
  effects: FxEvent[] = [];

  readonly level: LevelConfig;
  private gAccel: number;
  private events: GameEvents;
  /** Game.stepCount at which the player first went "stuck broke" (see
   *  update()), or null. Step-based rather than wall-clock: see
   *  brokeGraceSteps below for why. */
  private brokeSinceStep: number | null = null;
  /** Grace window (physics steps) before stuck-broke becomes a loss: one full
   *  compactor round trip (Compactor.cycleSteps, retreat to open + press back
   *  to full advance), plus a small buffer (2000ms worth of steps), capped at
   *  30s worth of steps so a degenerate compactorSpeed mutator can't make the
   *  grace effectively infinite. A full line already sitting in the zone must
   *  get its pressing stroke — which pays out and un-brokes the player —
   *  before the game calls it; a line clear raises score by >= scorePerLine >
   *  launchCost, so a rescue auto-cancels the countdown (see update()).
   *  Steps, not wall-clock ms: update() doesn't run while paused, so a
   *  wall-clock deadline armed just before a long pause would already be
   *  expired the instant play resumes — the same pause-safety reasoning as
   *  the bomb arm/fuse timers below (BOMB_ARM_STEPS/BOMB_FUSE_STEPS). */
  private readonly brokeGraceSteps: number;

  /** Physics steps elapsed (one per update() call) — bombs use this instead
   *  of wall-clock time so arming/fuse timing is pause-safe by construction
   *  (update doesn't run while paused). */
  private stepCount = 0;
  private liveBombs: Bomb[] = [];
  private pendingDetonations = new Set<Matter.Body>();
  private readonly onCollisionStart: (e: Matter.IEventCollision<Matter.Engine>) => void;

  /** Seeded RNG driving the wind drunk-walk (see stepWind) — kept private so
   *  the whole weather stream is reproducible for a given run seed + bay. */
  private readonly windRng: () => number;
  /** This bay's steady prevailing wind (px/step^2), rolled once from the seed
   *  in [-windMax, +windMax]. The live wind hovers around this. */
  private readonly windAvg: number;
  /** Live wind (px/step^2), drunk-walking around windAvg each step. */
  private windCur: number;

  /**
   * `seed` seeds the wind drunk-walk. main.ts passes the run seed so every
   * bay of a run has its own reproducible weather (and a Restart Bay replays
   * it exactly); it defaults to the bay id so headless callers (sim/perf.ts)
   * that don't thread a seed still get deterministic, per-bay-distinct wind.
   */
  constructor(level: LevelConfig, events: GameEvents = {}, seed: number = level.id) {
    this.level = level;
    this.events = events;
    // Combine seed with the bay id so consecutive bays of one run roll
    // different prevailing winds instead of all sharing the run seed's roll.
    this.windRng = mulberry32((seed ^ (level.id * 0x9e3779b9)) >>> 0);
    // Roll the bay's steady average in [-windMax, +windMax]; 0 stays 0 (calm).
    this.windAvg = level.windMax === 0 ? 0 : (this.windRng() * 2 - 1) * level.windMax;
    this.windCur = this.windAvg;
    this.bondCharges = level.bondBreakerCharges;
    this.score = level.startingFunds;
    this.timeLeftMs = level.timeLimitSec > 0 ? level.timeLimitSec * 1000 : Infinity;
    this.phys = createPhysics(level);
    this.cannon = new Cannon(level);
    this.compactor = new Compactor(this.phys.world, level);
    this.gAccel = this.phys.engine.gravity.y * this.phys.engine.gravity.scale * DT * DT;
    // Cap guards degenerate level configs (e.g. a near-zero compactorSpeed
    // mutator) from making the grace window — and so the broke-loss — effectively
    // unreachable. Same min(...) as the old ms-based formula, just divided
    // through by DT once here so update() can compare step counts directly.
    this.brokeGraceSteps = Math.min(
      this.compactor.cycleSteps + 2000 / DT,
      30_000 / DT,
    );
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

  /** Advance the wind drunk-walk by one physics step: a small seeded random
   *  nudge (±windGust) plus a gentle pull back toward the bay's rolled
   *  average (WIND_REVERT), so the wind gusts around a steady, learnable
   *  prevailing direction instead of oscillating extreme-to-extreme. Both
   *  constants are seconds-scale by design (see WIND_TAU_SEC's comment
   *  above) — decorrelation time constant τ ≈ WIND_TAU_SEC (5s), so the
   *  character of the wind barely changes within one flight but visibly
   *  drifts over a bay. Inert (pinned to 0) when windMax is 0. Called once
   *  per update() step, so it's pause-safe by construction (update doesn't
   *  run while paused). */
  private stepWind(): void {
    const { windMax, windGust } = this.level;
    if (windMax === 0) {
      this.windCur = 0;
      return;
    }
    this.windCur += (this.windRng() * 2 - 1) * windGust;
    this.windCur += (this.windAvg - this.windCur) * WIND_REVERT;
    // Safety clamp so a run of same-signed nudges can't push a gust far past
    // the bay's magnitude cap. windGust * 16 is ~2.26 stationary standard
    // deviations of headroom above windMax (see the std formula in
    // WIND_REVERT's comment) — at WIND_GUST_FRACTION=0.025 that's exactly
    // windMax * 1.4, tight enough that a bay never reads as far windier than
    // its advertised windMax.
    const cap = windMax + windGust * 16;
    this.windCur = Math.max(-cap, Math.min(cap, this.windCur));
  }

  /**
   * Bond Breaker special ability (drafted via mods.ts): shatter EVERY joint on
   * the field at once, turning all pieces into loose cubes. With nothing
   * holding awkward stacks rigid, the pile slumps flatter and the compactor
   * packs the loose cubes into full lines far more easily. Consumes one charge;
   * a no-op (returns false, no charge spent) when there are no charges left, no
   * joints left to break, or the game isn't actively playing. `now` is the
   * caller's wall-clock time, used only as the FX timestamp.
   */
  useBondBreaker(now: number): boolean {
    if (this.status !== "playing" || this.paused) return false;
    if (this.bondCharges <= 0 || this.constraints.length === 0) return false;

    // Remember which cubes were still joined so the shatter FX only sparks on
    // pieces that actually came apart, then tear down every joint (world +
    // array) in one sweep — same removal both places as removeConstraintsFor.
    const joined = new Set<Matter.Body>();
    for (const c of this.constraints) {
      if (c.bodyA) joined.add(c.bodyA);
      if (c.bodyB) joined.add(c.bodyB);
    }
    for (const c of this.constraints) Matter.Composite.remove(this.phys.world, c);
    this.constraints.length = 0;

    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const cube of this.cubes) {
      if (!joined.has(cube.body)) continue;
      const p = cube.body.position;
      this.effects.push({ kind: "shatter", x: p.x, y: p.y, color: cube.color, t0: now });
      sx += p.x;
      sy += p.y;
      n += 1;
    }
    // A central shockwave ring so the field-wide break reads as one deliberate
    // action, not just scattered sparks.
    this.effects.push({
      kind: "explosion",
      x: n ? sx / n : WORLD.width / 2,
      y: n ? sy / n : WORLD.height / 2,
      r: CELL * 3.2,
      t0: now,
    });

    this.bondCharges -= 1;
    this.events.onBondBreak?.();
    return true;
  }

  /** Signed lateral wind acceleration (px/step^2) at THIS instant. Pause-safe
   *  by construction (windCur only advances inside update(), which doesn't
   *  run while paused). Public so render.ts's HUD wind indicator can read
   *  the live value. */
  get windNow(): number {
    return this.windCur;
  }

  /**
   * Recomputes the dotted preview arc against the CURRENT wind held constant
   * across the whole predicted flight. Unlike the old deterministic sine, a
   * drunk walk's future is genuinely unknowable, so the current reading is
   * the best available estimate — and because the wind's decorrelation time
   * constant is tuned to WIND_TAU_SEC (5s — see that constant's comment),
   * holding it constant across a ~1.5-2.5s flight is a close match to what
   * applyWind() actually does: the wind has barely drifted by the time the
   * shot lands. sim/bots.ts's `aim` preset re-solves its shot by reading
   * THIS trajectory back out, so it aims against the same current-wind
   * estimate a human would read off the HUD indicator.
   */
  updateTrajectory(): void {
    const wind = this.windCur;
    this.trajectory = predictTrajectory(
      this.cannon.tip,
      this.cannon.velocity,
      this.gAccel,
      0.012,
      140,
      () => wind,
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
    this.stepWind();
    stepPhysics(this.phys);
    this.applyWind();

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
      ? updateLineClear(this.phys.world, this.cubes, this.compactor, this.level, this.constraints)
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
    const lost = updateBlinking(this.phys.world, this.cubes, now, this.constraints);
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
      this.brokeSinceStep = null;
    } else if (this.brokeSinceStep === null) {
      const allAtRest = this.cubes.every((c) => isAtRest(c.body));
      if (allAtRest) this.brokeSinceStep = this.stepCount;
    }

    if (this.score >= this.target) this.setStatus("won");
    else if (this.isToppedOut()) {
      this.lossReason = "topout";
      this.setStatus("lost");
    } else if (
      this.brokeSinceStep !== null &&
      this.stepCount - this.brokeSinceStep > this.brokeGraceSteps
    ) {
      this.lossReason = "broke";
      this.setStatus("lost");
    } else if (this.timeLeftMs <= 0) {
      this.lossReason = "time";
      this.setStatus("lost");
    }

    if (this.effects.length) {
      this.effects = this.effects.filter((e) => now - e.t0 < FX_TTL[e.kind]);
    }

    // Keep the dotted arc live against the current wind reading (~140 cheap
    // analytic-parabola iterations, fine headless too — see cannon.ts's
    // predictTrajectory). Aim/power haven't necessarily changed this frame,
    // but windCur just drunk-walked (stepWind above), so the preview would
    // otherwise silently go stale between shots.
    this.updateTrajectory();
  }

  /** Nudge every AIRBORNE cube and live bomb's x-velocity by the current wind
   *  reading (windNow) — a velocity nudge, i.e. an acceleration applied over
   *  one physics step, matching how predictTrajectory integrates gravity/wind.
   *  Gated on speed >= WIND_AIRBORNE_SPEED so the settled pile (below
   *  AT_REST) is never touched. */
  private applyWind(): void {
    const wind = this.windNow;
    if (wind === 0) return;
    for (const c of this.cubes) {
      const b = c.body;
      const v = b.velocity;
      if (v.x * v.x + v.y * v.y >= WIND_AIRBORNE_SPEED_SQ) {
        Matter.Body.setVelocity(b, { x: v.x + wind, y: v.y });
      }
    }
    for (const bomb of this.liveBombs) {
      const b = bomb.body;
      const v = b.velocity;
      if (v.x * v.x + v.y * v.y >= WIND_AIRBORNE_SPEED_SQ) {
        Matter.Body.setVelocity(b, { x: v.x + wind, y: v.y });
      }
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
        removeConstraintsFor(this.phys.world, this.constraints, b);
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
