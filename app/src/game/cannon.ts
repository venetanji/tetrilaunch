import Matter from "matter-js";
import { CELL, WORLD } from "./engine";
import { PIECE_TYPES, type Material, type PieceType } from "./theme";
import { mulberry32 } from "./mods";
import { SIZE_SPEC } from "./pieces";
import { BeltSchedule } from "./belt";
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

/**
 * Power ratio a drag has to reach before a release counts as a SHOT rather than
 * an accidental touch. Below it, input.ts cancels instead of firing.
 *
 * The problem it solves: a bare tap on the canvas used to fire. onUp fired
 * unconditionally, and a touch that never travels 4px never reaches
 * aimFromDrag at all — so the cannon kept its PREVIOUS aim and power and
 * launched on that. Reaching for the rail and missing cost a full launch, at an
 * angle the player had not chosen, and on a phone that is the single most
 * common way to waste a shot.
 *
 * 0.30 rather than a raw pixel distance because the whole point is intent, and
 * intent is what the pull-back MEANS, not how far a finger moved on a
 * particular screen. It works out to 85.6 world px (DRAG_MIN + 0.3 * the span),
 * which scales with the field — about 43 CSS px on an 800x360 phone viewport.
 * Comfortably past touch jitter, comfortably short of a deliberate slingshot
 * pull, and normalized against the ship: the LAUNCHER track scales speedMin and
 * speedMax together, so 30% is 30% of whatever this hull can do.
 *
 * Deliberately NOT enforced in Game.shoot. Keyboard and gamepad players sit at
 * speedMin (ratio 0) and press Fire on purpose; gating the shared path would
 * break the desktop control scheme to fix a touch problem.
 */
export const MIN_FIRE_RATIO = 0.3;

/** Power ratio (0..1) a pull-back of `len` world px produces. Pure, and shared
 *  with aimFromDrag below rather than re-derived, so the gate that decides
 *  whether to fire and the mapping that decides how hard cannot disagree. */
export function powerRatioForDrag(len: number): number {
  return Math.max(0, Math.min(1, (len - DRAG_MIN) / (DRAG_MAX - DRAG_MIN)));
}

/**
 * The aim cone: ±60° either side of straight ahead — the arc the barrel can
 * swing through, and the only angles anything is allowed to put on the cannon.
 *
 * Named rather than left as a bare `Math.PI / 3` in each place that clamps,
 * because there are now four of them: the slingshot drag (aimFromDrag), the
 * two keyboard nudges, the autoloader's jitter clamp (game.ts's
 * stepAutoLaunch) and — new — the mouse aim solver below, which SEARCHES this
 * cone rather than clamping to it. A search whose bounds disagreed with the
 * clamp by even a degree would hand back an angle the clamp then quietly
 * rewrote, and the arc the player was looking at would not be the arc that
 * fired. (autopilot.ts keeps its own mirror of this with its own note: it is a
 * separate module that models the cone rather than enforcing it.)
 */
export const AIM_CONE = Math.PI / 3;

export const CANNON = { x: 150, y: Math.round(WORLD.height * 0.4), size: 60, barrel: 64 };

export class Cannon {
  x = CANNON.x;
  y = CANNON.y;
  /** Aim angle in radians. 0 = right, positive = upward (matches main.py). */
  angle = Math.PI / 9;
  /** Launch speed in px/step. */
  power: number;
  pieceRotation = 0;
  lastShot = -99999;

  pieceIndex = 0;
  currentType: PieceType;
  nextType: PieceType;
  /** What the loaded shipment and the one behind it are MADE of (theme.ts's
   *  Material). Rolled one ahead of the muzzle for the same reason the type is:
   *  the next-shipment preview has to promise exactly what the next trigger
   *  pull produces. A material the player only discovers after firing would be
   *  a slot machine, not a puzzle — cryo in particular is only fair if you can
   *  see it coming and sequence around it. */
  currentMaterial: Material;
  nextMaterial: Material;

  /** This bay's usable speed range — SPEED_MIN/SPEED_MAX scaled by the
   *  LAUNCHER upgrade track's launchPower (see upgrades.ts / level.ts). BOTH
   *  ends scale, not just the cap: a powered launcher should throw further at
   *  the same drag distance, so the whole mapping shifts rather than only
   *  extending the top of it. powerRatio stays normalized to this range, so
   *  the PWR meter still reads 0-100% of whatever the current ship can do. */
  readonly speedMin: number;
  readonly speedMax: number;

  private seq: PieceType[];
  private cooldownMs: number;
  /** True when `seq` is a FINITE inventory (level.pieceQueue — a pattern
   *  Contract's exact shipment list) rather than a bag that cycles forever.
   *  Everything downstream keys off this: the cannon runs dry, and Game.shoot
   *  stops firing (see Game.piecesLeft). */
  readonly finite: boolean;
  /** Shipments taken off a finite queue so far. Unused when !finite. */
  private consumed = 0;

  /** SEEDED 7-BAG randomizer, for bays whose pieceSequence is null (every
   *  Deep Run bay). Non-null only in that case — a finite queue and an
   *  explicit sequence both bypass it entirely.
   *
   *  A bag rather than independent rolls, deliberately: pure random streams
   *  produce the droughts and floods (five S in a row, no I for twenty shots)
   *  that read as the game cheating, while dealing a shuffled set of all seven
   *  and reshuffling when it empties bounds every type's wait at 12. Seeded
   *  from the run seed like the wind and material streams, so a restarted bay
   *  replays the identical deal and a shared seed means the same shipments for
   *  two players.
   *
   *  This replaces the fixed I,O,T,L,J,S,Z rotation the ladder shipped with —
   *  which made every bay OPEN with the same pieces in the same order, so the
   *  first minute of every run played out identically (playtest, 2026-08-09). */
  private bagRng: (() => number) | null = null;
  private bag: PieceType[] = [];

  /** Seeded so a bay's material stream is reproducible — same run seed and bay
   *  gives the same shipments, which is what lets a daily Contract or a shared
   *  seed mean the same thing for two players. */
  private matRng: () => number;
  /** This bay's belt: the ceiling, the escalating rate and the weighted pick
   *  that decide what each shipment is made of. See belt.ts — the cannon owns
   *  it because the cannon is what advances the shipment queue, and the
   *  schedule is stateful (it remembers how long the belt has been clean). */
  private belt: BeltSchedule;

  constructor(level: LevelConfig, seed: number = level.id) {
    const queue = level.pieceQueue;
    this.finite = !!queue && queue.length > 0;
    this.seq = this.finite ? queue! : (level.pieceSequence ?? PIECE_TYPES);
    this.cooldownMs = level.cooldownMs;
    const mult = level.launchPower > 0 ? level.launchPower : 1;
    this.speedMin = SPEED_MIN * mult;
    this.speedMax = SPEED_MAX * mult;
    this.power = this.speedMin;
    if (!this.finite && level.pieceSequence === null) {
      // Distinct salt from the material/wind/autoloader streams, same reason
      // as theirs: the shipment ORDER must not shift the bay's weather or its
      // material rolls for the same seed, and vice versa.
      this.bagRng = mulberry32((seed ^ 0x1c69b3f5 ^ (level.id * 0x9e3779b9)) >>> 0);
      this.currentType = this.deal();
      this.nextType = this.deal();
    } else {
      this.currentType = this.seq[0];
      this.nextType = this.seq[1 % this.seq.length];
    }
    // SIZE-NORMALIZED, and this was a bug fix rather than a refinement. The
    // draw is per SHIPMENT while the cost is per CUBE, and cube count is 2/4/5
    // by size class — so at an identical 11% rate a Bulk shipment ate 0.55 dead
    // cubes against Micro's 0.22. Bulk is also the size that most resists
    // coming apart (SIZE_SPEC.breakMult 1.6), so the blob was simultaneously
    // the hardest to disperse, and it already pays +50% launch cost for its
    // upside. That was an unpriced second tax on exactly the build least able
    // to absorb it. The scale now moves the belt's DENSITY under the ceiling
    // rather than the raw probabilities — see BeltSchedule's constructor.
    this.belt = new BeltSchedule(
      level.materialMix,
      SIZE_SPEC.std.cubes / SIZE_SPEC[level.pieceSize].cubes,
    );
    // Distinct salt from the wind and autoloader streams (game.ts) so adding a
    // material to a bay can't shift its weather for the same seed.
    this.matRng = mulberry32((seed ^ 0x2f9a1b3d ^ (level.id * 0xc2b2ae35)) >>> 0);
    this.currentMaterial = this.rollMaterial();
    this.nextMaterial = this.rollMaterial();
  }

  /**
   * What the next shipment is made of, off this bay's belt (belt.ts).
   *
   * Not an independent roll any more, and that is the point: a memoryless draw
   * at the mix rates a Tier-10 run banks delivers three- and four-material
   * streaks often enough to lose a bay to one, which is the complaint belt.ts's
   * header records. The schedule keeps the same long-run rate — materialMix is
   * still literally the share of shipments each material takes — while
   * guaranteeing MATERIAL_GAP standard shipments after every material and
   * escalating the odds across a clean stretch so a drought closes itself.
   *
   * The player still cannot count slag off and conclude the rest of the bay is
   * clean: what they gain is the guarantee that they will get room to build in
   * between, which is the thing a puzzle needs and a slot machine does not.
   */
  private rollMaterial(): Material {
    return this.belt.next(this.matRng);
  }

  /** The share of this bay's shipments that will carry a material — the belt's
   *  delivered density, ceiling included. */
  get materialShare(): number {
    return this.belt.materialShare;
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
    return (this.power - this.speedMin) / (this.speedMax - this.speedMin);
  }

  /**
   * Set aim + power from a world-space drag vector originating at the cannon.
   * Slingshot pull-back: the launch direction is OPPOSITE the drag (drag
   * down-left to fire up-right), reversed 180° from the raw drag vector.
   *
   * RETURNS the power ratio it applied, which input.ts's misfire gate reads.
   * That return is why the gate is honest: on the sub-4px path below, `power`
   * is deliberately left alone (a jittering finger must not stomp a pull the
   * player already made), so a caller reading `powerRatio` back off the cannon
   * afterwards would get the PREVIOUS drag's value — which is exactly the stale
   * number that made a bare tap fire a full-power shot. This says what THIS
   * gesture asked for, and 0 means "nothing".
   */
  aimFromDrag(dx: number, dy: number): number {
    const len = Math.hypot(dx, dy);
    if (len < 4) return 0;
    // Reverse the drag vector, then constrain to the upper-right launch cone.
    let ang = Math.atan2(dy, -dx);
    ang = Math.max(-AIM_CONE, Math.min(AIM_CONE, ang));
    this.angle = ang;
    const t = powerRatioForDrag(len);
    this.power = this.speedMin + t * (this.speedMax - this.speedMin);
    return t;
  }

  // --- Keyboard fallback (web) ---
  aimUp() { this.angle = Math.min(AIM_CONE, this.angle + 0.035); }
  aimDown() { this.angle = Math.max(-AIM_CONE, this.angle - 0.035); }
  powerUp() { this.power = Math.min(this.speedMax, this.power + 0.4); }
  powerDown() { this.power = Math.max(this.speedMin, this.power - 0.4); }
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

  /** Shipments still in a finite queue, or Infinity when the bag cycles. */
  get piecesLeft(): number {
    return this.finite ? Math.max(0, this.seq.length - this.consumed) : Infinity;
  }

  /** What is still coming, in order — the remaining multiset a pattern
   *  Contract's HUD shows in full. Empty when the bag cycles (there is no
   *  "remaining" to speak of). */
  get remaining(): PieceType[] {
    return this.finite ? this.seq.slice(this.consumed) : [];
  }

  /** True when a shipment follows the loaded one. False on the last piece of a
   *  finite queue, so the belt can show an empty track rather than promising a
   *  NEXT that will never arrive. */
  get hasNext(): boolean {
    return this.piecesLeft > 1;
  }

  /**
   * Live multiplier on the reload, 1 = the level's own cooldown.
   *
   * Separate from cooldownMs rather than folded into it because the two have
   * different lifetimes: cooldownMs is the bay's, set once from the level and
   * raised permanently by the Magazine track, while this is the CURRENT state
   * of the bay floor and moves both ways as cargo piles up and clears. Folding
   * congestion into cooldownMs would make the tax permanent the moment it first
   * fired, which is the opposite of a rule you can play your way out of.
   */
  private cooldownScale = 1;

  setCooldownScale(mult: number): void {
    this.cooldownScale = Math.max(0.1, mult);
  }

  /** The reload actually in force right now. */
  private get effectiveCooldown(): number {
    return this.cooldownMs * this.cooldownScale;
  }

  canShoot(now: number): boolean {
    return now - this.lastShot >= this.effectiveCooldown;
  }

  /** The moment this cannon became (or becomes) able to fire again. Exposed for
   *  telemetry: firing time minus this is how long the player spent AIMING
   *  rather than reloading, which is the one number separating a human from the
   *  sim bots — the bots fire the instant the cooldown clears, so for them it is
   *  always 0 and MAGAZINE reads as pure throughput. If a human's aim time
   *  routinely exceeds the cooldown, the cooldown never binds and the track is
   *  worth nothing to them either. See lib/telemetry.ts. */
  readyAt(): number {
    return this.lastShot + this.effectiveCooldown;
  }
  cooldownRemaining(now: number): number {
    return Math.max(0, this.effectiveCooldown - (now - this.lastShot));
  }
  /** 0 = just fired, 1 = fully reloaded — what the HUD reload bar and the
   *  canvas muzzle ring both animate from (see render.ts's drawReloadRing and
   *  main.ts's syncHud). Guards a zero/negative cooldown (a degenerate
   *  Magazine + Rapid Loader stack) as always-ready rather than dividing by 0. */
  reloadRatio(now: number): number {
    const cd = this.effectiveCooldown;
    if (cd <= 0) return 1;
    return Math.max(0, Math.min(1, (now - this.lastShot) / cd));
  }

  /** Reset the fire cooldown only, without advancing the piece queue — a
   *  bomb shot consumes the cooldown but leaves the loaded piece in place. */
  markCooldown(now: number): void {
    this.lastShot = now;
  }

  markShot(now: number): void {
    this.markCooldown(now);
    this.consumed += 1;
    this.pieceIndex = (this.pieceIndex + 1) % this.seq.length;
    this.currentType = this.nextType;
    this.nextType = this.bagRng
      ? this.deal()
      : this.seq[(this.pieceIndex + 1) % this.seq.length];
    this.currentMaterial = this.nextMaterial;
    this.nextMaterial = this.rollMaterial();
    this.pieceRotation = 0;
  }

  /** Next shipment off the 7-bag: deal from the current shuffled bag, and
   *  reshuffle a fresh one the moment it empties. Only called when bagRng is
   *  set (see the field's doc). Fisher-Yates, not sort(() => rng() - 0.5) —
   *  same reasoning as contracts.ts's shuffleSeeded: a biased shuffle would
   *  make the "same seed, same shipments" promise engine-dependent. */
  private deal(): PieceType {
    if (this.bag.length === 0) {
      const b = [...PIECE_TYPES];
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(this.bagRng!() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
      }
      this.bag = b;
    }
    return this.bag.shift()!;
  }
}

/**
 * Analytic parabola preview that mirrors matter's per-step integration
 * (constant gravity accel + air damping), so the dotted arc matches the
 * flight. `windAt(i)` returns the wind acceleration for step `i` (0-based,
 * relative to "now") — a FUNCTION rather than a single scalar because wind
 * is a seeded drunk walk (see game.ts's windNow/stepWind), not a fixed
 * value; game.ts's updateTrajectory passes a constant closure over the
 * current reading, which is a close match because the walk's decorrelation
 * time constant (game.ts's WIND_TAU_SEC, ~5s) is long relative to a ~140
 * step (~2.3s) preview. A caller that instead wanted to simulate the wind
 * continuing to drunk-walk forward would pass a step-varying function here
 * — the signature supports it even though no current caller does. Defaults
 * to a still-air `() => 0` so every other caller (main.ts's live HUD arc,
 * which only ever wants "wind as of right now" smeared across the preview)
 * is unaffected.
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
  const s: FlightState = { x: start.x, y: start.y, vx: vel.x, vy: vel.y };
  for (let i = 0; i < steps; i++) {
    pts.push({ x: s.x, y: s.y });
    stepFlight(s, gAccel, frictionAir, windAt(i));
    if (s.x < 0 || s.x > WORLD.width || s.y > WORLD.height) break;
  }
  return pts;
}

/* ---------------------------------------------------------------------------
 * MOUSE AIM SOLVER — inverting the forward model above.
 *
 * The drag scheme sets angle and power directly and the arc is whatever falls
 * out. Mouse aiming (input.ts) asks the opposite question: given a point in
 * the bay, what angle and power put the ARC THROUGH IT? There is no closed
 * form to invert — the model carries per-step air damping and a wind term that
 * is a function of the step index — so this searches the forward model
 * instead, which is the only way the answer can be guaranteed to agree with
 * the dots the player is looking at. sim/bots.ts's aimBot reaches the same
 * conclusion for the same reason and searches a fixed 21x4 grid; this needs to
 * be exact rather than good enough (the player is pointing at a specific
 * pixel, not at a slot), so it searches properly instead of sampling.
 * ------------------------------------------------------------------------ */

/** One flying body's state, mutated in place. The stepper below is the ONE
 *  copy of the recurrence — predictTrajectory draws it, the solver searches
 *  it, and neither can drift from the other, which is the entire reason this
 *  exists as a shared function rather than as two hand-matched loops. The
 *  solver runs it hundreds of times per pointer move, so it mutates a state
 *  object rather than returning a fresh vector: predictTrajectory's 140
 *  allocations are free once a frame and ruinous 1,600 times a frame. */
export interface FlightState { x: number; y: number; vx: number; vy: number; }

export function stepFlight(
  s: FlightState, gAccel: number, frictionAir: number, wind: number,
): void {
  s.vy += gAccel;
  s.vx += wind;
  s.vx *= 1 - frictionAir;
  s.vy *= 1 - frictionAir;
  s.x += s.vx;
  s.y += s.vy;
}

/**
 * Miss (world px) at or under which an aim counts as landing ON the cursor.
 *
 * Half a cube. The thing being aimed is 40px across at minimum (engine.ts's
 * CELL) and lands as a cluster of them, so demanding better than half a cube
 * would be claiming a precision the payload does not have — and this is the
 * threshold that decides whether the solver reports "reachable", which is a
 * claim about the SHOT, not about the arithmetic.
 */
export const AIM_HIT_TOL = CELL / 2;

/** Angle samples across the cone before the refinement pass: 2.5° apiece.
 *  Sized against what it has to find rather than by feel — the band of angles
 *  a given point is reachable from narrows to nothing as that point
 *  approaches the cannon's maximum range, and a sweep coarser than the band
 *  walks straight past it and reports the target unreachable while a real
 *  solution sits between two samples. 2.5° holds a solution for everything
 *  short of the last few px of reach, where the fallback (closest approach at
 *  full power) is the same aim to within a pixel anyway. */
const SOLVE_ANGLE_SAMPLES = 49;
/** Bisection steps for the power at a fixed angle. The bracket is the ship's
 *  whole speed band (~19 px/step stock), halved each iteration: 22 takes it to
 *  ~4.5e-6 px/step, i.e. far below anything the arc can show. */
const SOLVE_POWER_ITERS = 22;
/** Golden-ratio (ternary) narrowing of the winning angle, 2 solves apiece.
 *  12 iterations shrink the ±2.5° bracket by (2/3)^12 to ~0.02°. */
const SOLVE_ANGLE_ITERS = 12;

/** How far in front of the pivot a target has to sit before the solver will
 *  take it seriously. The cone opens forward, so nothing behind the cannon is
 *  reachable at any angle or power; rather than return a nonsense aim for a
 *  click on the launcher itself, the target is pulled forward to here and the
 *  arc the player sees is the honest "this is the closest I can throw". One
 *  barrel length past the muzzle at level trim. */
const SOLVE_MIN_FORWARD_DX = CANNON.barrel * 2;

export interface AimSolution {
  angle: number;
  power: number;
  /** Closest approach (world px) between the target and the arc this aim
   *  actually produces — 0 means the dots pass through the cursor. Non-zero
   *  means the point is outside what this cannon can reach and the caller is
   *  being handed the nearest thing to it; see solveAimForTarget's doc. */
  miss: number;
  /** miss <= AIM_HIT_TOL. */
  hit: boolean;
}

/** Squared distance from `p` to the segment (ax,ay)-(bx,by).
 *
 *  Against the SEGMENT rather than against the sampled points, and that is not
 *  a nicety: the arc travels 15-25px between samples at launch speed, so a
 *  point-sampled miss would report a 12px error for an aim that passes exactly
 *  through the cursor between two dots — and the search would then spend its
 *  refinement passes chasing that phantom error into a worse angle. */
function segDistSq(p: Matter.Vector, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - ax) * dx + (p.y - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - p.x;
  const qy = ay + t * dy - p.y;
  return qx * qx + qy * qy;
}

interface FlightProbe {
  /** Signed vertical error where the arc first crosses the target's x, in
   *  canvas coordinates (y grows downward): POSITIVE means the arc passed
   *  BELOW the target — too little power. Infinity when the arc never gets
   *  that far forward at all, which reads as "needs more power" and is exactly
   *  what the bisection below should do with it.
   *
   *  Signed and taken at a fixed x on purpose. At a fixed angle the family of
   *  arcs is nested in power — every extra px/step of speed puts the arc
   *  higher at every x it reaches — so this is monotone decreasing in power
   *  and can be bisected. Closest approach, the number the player actually
   *  cares about, is not monotone in anything and would need a slower
   *  derivative-free search. */
  drop: number;
  /** Closest approach of the whole arc to the target, world px. */
  miss: number;
}

function probeFlight(
  origin: { x: number; y: number },
  barrel: number,
  angle: number,
  power: number,
  target: Matter.Vector,
  gAccel: number,
  frictionAir: number,
  steps: number,
  windAt: (step: number) => number,
): FlightProbe {
  // THE MUZZLE MOVES WITH THE AIM. The barrel is 64px long, so swinging from
  // -60° to +60° walks the launch point ~111px vertically and 64px
  // horizontally — a bigger displacement than the miss tolerance by a factor
  // of five. A solver that searched angles from one fixed start would be
  // solving a cannon this game does not have. This mirrors Cannon.tip rather
  // than reading it because the search evaluates angles the cannon is not
  // currently pointing at.
  const s: FlightState = {
    x: origin.x + barrel * Math.cos(angle),
    y: origin.y - barrel * Math.sin(angle),
    vx: power * Math.cos(angle),
    vy: -power * Math.sin(angle),
  };
  let bestSq = Infinity;
  let drop = Infinity;
  let crossed = false;
  for (let i = 0; i < steps; i++) {
    const px = s.x;
    const py = s.y;
    stepFlight(s, gAccel, frictionAir, windAt(i));
    const d = segDistSq(target, px, py, s.x, s.y);
    if (d < bestSq) bestSq = d;
    // FIRST forward crossing only. A long flight in a hard cross-wind can have
    // its horizontal velocity pushed negative near the end (the wind term is
    // an acceleration and the damping is pulling vx toward zero), so an arc can
    // cross a given x more than once. The first crossing is the one the shot is
    // actually making; the later ones are the tail of a shot that already
    // missed.
    if (!crossed && px <= target.x && s.x >= target.x) {
      crossed = true;
      const span = s.x - px;
      const t = span > 0 ? (target.x - px) / span : 0;
      drop = py + (s.y - py) * t - target.y;
    }
    // The same bounds predictTrajectory stops at, so the search can never
    // propose an aim whose arc the preview truncates before it reaches the
    // cursor. An answer the dots cannot show is not an answer.
    if (s.x < 0 || s.x > WORLD.width || s.y > WORLD.height) break;
  }
  return { drop, miss: Math.sqrt(bestSq) };
}

interface AngleSolution { power: number; miss: number; hit: boolean }

/**
 * The launch speed that puts THIS angle's arc through the target, or the
 * closest the angle can get inside the ship's speed band.
 *
 * Three outcomes, and the caller has to be able to tell them apart:
 *  - the target sits inside the band → bisect to it, `hit` true;
 *  - even speedMax falls short → clamp to speedMax, `hit` false;
 *  - even speedMin sails over it → clamp to speedMin, `hit` false.
 * The last one is not hypothetical: the cannon cannot throw gently. At stock
 * trim a flat minimum-power shot still carries ~360px, so a click on the near
 * floor is genuinely unreachable rather than merely awkward, and the honest
 * answer is the weakest shot on that heading rather than a fabricated one.
 */
function powerForAngle(
  origin: { x: number; y: number },
  barrel: number,
  angle: number,
  target: Matter.Vector,
  speedMin: number,
  speedMax: number,
  gAccel: number,
  frictionAir: number,
  steps: number,
  windAt: (step: number) => number,
): AngleSolution {
  const probe = (p: number) =>
    probeFlight(origin, barrel, angle, p, target, gAccel, frictionAir, steps, windAt);
  const weakest = probe(speedMin);
  if (weakest.drop <= 0) {
    return { power: speedMin, miss: weakest.miss, hit: weakest.miss <= AIM_HIT_TOL };
  }
  const strongest = probe(speedMax);
  if (strongest.drop > 0) {
    return { power: speedMax, miss: strongest.miss, hit: strongest.miss <= AIM_HIT_TOL };
  }
  let lo = speedMin;
  let hi = speedMax;
  for (let i = 0; i < SOLVE_POWER_ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid).drop > 0) lo = mid;
    else hi = mid;
  }
  const final = probe(hi);
  return { power: hi, miss: final.miss, hit: final.miss <= AIM_HIT_TOL };
}

/**
 * Aim + power whose predicted arc passes through `target`.
 *
 * WHICH SOLUTION, of the two. Almost every reachable point has both a flat
 * drive and a high lob, and this returns neither by name: it returns the one
 * that needs the LEAST POWER. That is a unique answer rather than a coin toss
 * — required power as a function of angle is a smooth U, and its minimum is a
 * single angle — and it earns the default three ways.
 *
 * It ARRIVES SLOWEST. Least launch energy is least impact energy, and a
 * high-residual-velocity landing scatters whatever it lands on; sim/bots.ts's
 * aimBot reaches the same conclusion from the other end and breaks its own
 * ties toward the steeper, softer arrival for exactly this reason.
 *
 * It SITS IN THE MIDDLE OF THE PREVIEW WINDOW. The lob branch of a far target
 * runs past 140 steps, so the dots stop in mid-air and the arc stops answering
 * the question it was drawn to answer (chute.ts's pathStrands has a whole
 * clause for that truncation). The minimum-power arc is nowhere near it —
 * swept across the bay at stock trim, every point resolves inside the window.
 *
 * And it MAKES THE PWR METER MEAN SOMETHING. Under drag aiming the meter
 * reported how hard you pulled, which you already knew. Under this it reports
 * how close to the cannon's limit the point you chose is, which you cannot
 * otherwise see: a target that pins it at 100% is one you are on the edge of
 * reaching, and the readout says so before you spend the launch.
 *
 * The player is not stuck with that arc, and this is the part worth
 * understanding: the solver matches the arc to the POINT, not to the column
 * the point stands in. Pointing at the top of a stack gives a drive into its
 * face; pointing at a spot in the air above and short of the same stack gives
 * an arc that passes through THAT spot and drops in behind it. Lob and drive
 * are both still available — they are chosen by moving the cursor, which is
 * the control the player already has, rather than by a modifier key nothing
 * would ever teach them.
 *
 * OUT OF REACH. The cannon's speed band is finite in both directions, and
 * plenty of the bay is outside it — everything past maximum range near the
 * back wall, and everything nearer than a minimum-power shot can be made to
 * land. This never refuses. It hands back the aim whose arc comes CLOSEST to
 * the target and reports the miss, because the preview is already the feedback
 * channel: an arc that stops visibly short of the cursor, with the meter
 * pinned, says "not from here" more clearly than a vanished arc or a cannon
 * that ignored the click. Callers that want to say something about it have
 * `hit`.
 *
 * OBSTACLES ARE NOT CONSIDERED, deliberately. predictTrajectory models an
 * empty bay: it knows the walls and the floor and nothing about the pile, the
 * compactor bar or the chute. Teaching the solver to dodge them would not help
 * — the arc it returned would still be drawn straight through the stack,
 * because the DOTS do not model the pile either, so the player would be shown
 * one thing and given another. The dotted arc has always meant "where this
 * flies in clear air", and the existing strand warning (chute.ts's pathStrands)
 * is the channel for "this arc ends badly". Reading the pile off the arc stays
 * the player's job, which is also most of the skill in the game.
 */
export function solveAimForTarget(
  origin: { x: number; y: number },
  barrel: number,
  target: Matter.Vector,
  speedMin: number,
  speedMax: number,
  gAccel: number,
  frictionAir: number,
  steps: number,
  windAt: (step: number) => number,
): AimSolution {
  // Nothing behind the muzzle is reachable at any angle in the cone, and a
  // click there is almost always a click on the launcher chrome rather than a
  // request. Pull it forward instead of returning garbage.
  const aim: Matter.Vector = {
    x: Math.max(target.x, origin.x + SOLVE_MIN_FORWARD_DX),
    y: target.y,
  };
  const solve = (angle: number) =>
    powerForAngle(
      origin, barrel, angle, aim, speedMin, speedMax, gAccel, frictionAir, steps, windAt,
    );
  /** Finish an answer by measuring it against the point the player ACTUALLY
   *  clicked, not against the pulled-forward `aim` the search worked with.
   *  Without this a click behind the muzzle came back reporting miss 0 — true
   *  of the substitute target and a straight lie about the cursor, which is
   *  the one thing `miss` is for. Costs one extra flight per solve. */
  const report = (angle: number, power: number): AimSolution => {
    const p = probeFlight(
      origin, barrel, angle, power, target, gAccel, frictionAir, steps, windAt,
    );
    return { angle, power, miss: p.miss, hit: p.miss <= AIM_HIT_TOL };
  };

  // PASS 1 — sweep the cone. Two winners are tracked, not one: the cheapest
  // angle that actually reaches the target, and (for a target nothing reaches)
  // the angle that gets nearest. Ranking a miss against a power in one score
  // would let a wildly wrong arc win on being cheap.
  let bestAngle = 0;
  let bestPower = Infinity;
  let anyAngle = 0;
  let anyMiss = Infinity;
  let anyPower = speedMin;
  let hitFound = false;
  const step = (2 * AIM_CONE) / (SOLVE_ANGLE_SAMPLES - 1);
  for (let i = 0; i < SOLVE_ANGLE_SAMPLES; i++) {
    const angle = -AIM_CONE + i * step;
    const s = solve(angle);
    if (s.hit && s.power < bestPower) {
      hitFound = true;
      bestAngle = angle;
      bestPower = s.power;
    }
    if (s.miss < anyMiss) {
      anyMiss = s.miss;
      anyAngle = angle;
      anyPower = s.power;
    }
  }
  if (!hitFound) return report(anyAngle, anyPower);

  // PASS 2 — narrow the winning angle. Ternary search on required power, which
  // is quasi-convex across the cone: a smooth U inside the reachable band with
  // +Infinity shoulders where the target cannot be reached at all. The bracket
  // is one sweep step either side, which is where pass 1 has already bounded
  // the minimum. Refining on POWER rather than on miss is the point — every
  // angle in the band already reaches the target to within the bisection's
  // precision, so miss has nothing left to say, and minimizing it instead
  // would let the answer slide along the ridge onto whichever branch rounding
  // happened to favour.
  const cost = (angle: number): { power: number; miss: number } => {
    if (angle < -AIM_CONE || angle > AIM_CONE) return { power: Infinity, miss: Infinity };
    const s = solve(angle);
    return s.hit ? s : { power: Infinity, miss: s.miss };
  };
  let lo = bestAngle - step;
  let hi = bestAngle + step;
  for (let i = 0; i < SOLVE_ANGLE_ITERS; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (cost(a).power <= cost(b).power) hi = b;
    else lo = a;
  }
  const mid = (lo + hi) / 2;
  const refined = cost(mid);
  // The sweep's own winner is kept as the floor: 12 ternary iterations on a
  // function with infinite shoulders can converge onto a shoulder if the
  // minimum sits hard against the edge of the reachable band, and coming back
  // with Infinity would be a regression against a working answer.
  if (refined.power <= bestPower) return report(mid, refined.power);
  return report(bestAngle, bestPower);
}
