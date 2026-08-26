import Matter from "matter-js";
import { WORLD } from "./engine";
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
    ang = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, ang));
    this.angle = ang;
    const t = powerRatioForDrag(len);
    this.power = this.speedMin + t * (this.speedMax - this.speedMin);
    return t;
  }

  // --- Keyboard fallback (web) ---
  aimUp() { this.angle = Math.min(Math.PI / 3, this.angle + 0.035); }
  aimDown() { this.angle = Math.max(-Math.PI / 3, this.angle - 0.035); }
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
