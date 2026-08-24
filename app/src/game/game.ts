import Matter from "matter-js";
import { CELL, WALL_INNER, WORLD, createPhysics, stepPhysics, type PhysicsWorld } from "./engine";
import { Cannon, predictTrajectory } from "./cannon";
import {
  CHUTE_BLAST_R, CHUTE_LIP_Y, chuteRightEdge, inChute, pathStrands, shredInChute,
} from "./chute";
import { Compactor } from "./compactor";
import {
  createStandingWall,
  createTetrisPiece,
  updateBreakableJoints,
  breakJointsInBand,
  jointBreakAt,
  removeConstraintsFor,
  SIZE_SPEC,
  type Cube,
  type JointBreak,
  type JointMeta,
} from "./pieces";
import {
  updateLineClear,
  strikeCryo,
  volatileBlast,
  tarWelds,
  alignMagnetic,
  VOLATILE_BLAST_CELLS,
  shatterColdCryo,
  type CryoShatter,
  markLostPieces,
  updateBlinking,
  resetLineClear,
  settleZoneCubes,
  wakeNear,
  type ClearResult,
  slagBountyFor,
} from "./lineClear";
import { payoutMult, bombResupply } from "./level";
import type { LevelConfig, PileTier } from "./level";
import { mulberry32 } from "./mods";
import { FX_TTL, PENALTY_SINK_PX, type FxEvent } from "./fx";
import type { Material, PieceSize, PieceType } from "./theme";

const DT = 1000 / 60;

export type GameStatus = "playing" | "won" | "lost";

/** Why a bay ended badly. "launches" and "pieces" are both Contract-only — the
 *  launch budget ran out (level.ts's launchBudget), or the finite shipment
 *  queue did (level.ts's pieceQueue). The other three are Deep Run's. */
export type LossReason = "topout" | "broke" | "time" | "launches" | "pieces";

/** Everything worth knowing about one launch, for playtest telemetry
 *  (lib/telemetry.ts). `wait` is the load-bearing field: ms spent between the
 *  cannon becoming ready and the player actually firing, i.e. aim time. The sim
 *  bots fire the instant the cooldown clears, so theirs is always 0 — this is
 *  the measurement that tells us whether a human is cooldown-bound at all. */
export interface ShotInfo {
  /** ms since this bay began, on the pause-safe physics clock. */
  t: number;
  /** Aim time in ms, or null for a bay's first shot (nothing to measure from). */
  wait: number | null;
  angle: number;
  power: number;
  type: PieceType;
  size: PieceSize;
  rot: number;
  /** Funds BEFORE the launch cost is deducted. */
  funds: number;
  bomb: boolean;
  /** Compactor phase at the instant of the launch: 0 = open stop, 1 = full
   *  advance, with `cdir` saying which way it was travelling. Recorded because
   *  `wait` alone cannot tell aiming apart from WAITING: the bar's round trip
   *  is 4.4s at bay 1 and the median gap between shots is ~4.5s, so a long
   *  `wait` is equally consistent with a slow aim and with a player holding
   *  fire for a usable window. Phase separates them — a player aiming freely
   *  fires at a uniform phase, one waiting for a window fires at a clustered
   *  one. */
  cphase: number;
  cdir: 1 | -1;
  /** Compactor.strokes at the launch — completed press strokes so far. Gives
   *  shots-per-stroke directly, which is the quantity MAGAZINE would actually
   *  raise if the window (not aim time) is what bounds throughput. */
  cstroke: number;
  /** True when the Autoloader trigger fired this shot rather than the player.
   *  Both share a bay, so without this the rig's scatter and the player's aim
   *  pool into one meaningless average. */
  auto: boolean;
}

export interface GameEvents {
  onLineClear?: (lines: number) => void;
  onShoot?: (info: ShotInfo) => void;
  onPieceLost?: (count: number) => void;
  onStatus?: (status: GameStatus) => void;
  /** Fired when the Bond Breaker ability successfully discharges (see
   *  useBondBreaker) — lets the UI play a haptic/SFX cue. */
  onBondBreak?: () => void;
  /** Fired the step the bay's funding target is met and the SETTLE window
   *  opens (see update()'s win handling) — the UI stops accepting launches and
   *  shows the settling readout, well before onStatus("won") lands. */
  onSettleStart?: () => void;
  /** Fired when cryo reaches the press still frozen and breaks (lineClear.ts's
   *  shatterColdCryo). Distinct from onLineClear because it is the OPPOSITE
   *  outcome — the row was lost, not paid — and wants its own cue. */
  onCryoShatter?: (shatter: CryoShatter) => void;
  /** A collision hard enough to be worth hearing. `strength` is 0..1, scaled
   *  from the relative speed between the two bodies, so a glancing nudge and a
   *  full-power landing sound different.
   *
   *  Fires at most ONCE per physics event with the hardest pair in it, not per
   *  pair: a piece settling touches several cubes in the same step, and one
   *  landing should be one sound. The consumer throttles again on top (see
   *  lib/audio.ts's playImpact) because consecutive steps also collide. */
  onImpact?: (strength: number) => void;
  /** Fired when the bay CROSSES a congestion tier boundary (level.ts's
   *  PILE_TIERS) — on the crossing, never per step. `tier` is 0 for a clean bay
   *  and 1..`tiers` for each rung of the staircase; `tiers` is how many rungs
   *  this bay has, so a consumer can scale a cue without hardcoding the ladder.
   *
   *  Congestion is already something the player SEES — the bay floor lights row
   *  by row (render.ts's drawCongestionRows) — and this is the same state
   *  offered to the ear. On the crossing rather than continuously because the
   *  state is a staircase and not a rate: what a cue needs to know is that it
   *  MOVED, and everything between crossings is the same bay. */
  onCongestion?: (tier: number, tiers: number) => void;
  /** Fired when a blast destroys cubes: a demolition charge detonating
   *  (detonate) or a volatile shipment going off (resolveVolatile). The
   *  visuals already ride the FxEvent queue; this is the same moment offered
   *  to the ear. One call per blast, not per cube — a volatile chain in one
   *  step aggregates into a single event exactly like its explosion visual. */
  onExplosion?: (kind: "bomb" | "volatile" | "chute") => void;
  /** Fired when armBomb actually changes the armed state — never on a refused
   *  call — with the new state. Every input path converges on armBomb (HUD
   *  button, keyboard, gamepad), so a cue wired here covers all three without
   *  each call site remembering to play it. */
  onBombArmed?: (armed: boolean) => void;
}

/** What the belt "NEXT" preview shows (see Game.beltPreview). `type` and
 *  `quarterTurns` are meaningless when `bomb` is set (an armed demolition
 *  charge — see Game.bombArmed). */
export interface BeltPreview {
  bomb: boolean;
  type: PieceType;
  quarterTurns: number;
  /** True when nothing follows the loaded shot — the last shipment of a finite
   *  queue is at the muzzle. The belt draws an empty track rather than a piece
   *  that is never coming. Always false on a cycling bag. */
  empty: boolean;
  /** True when the shipment exists but the bay refuses to show it — the
   *  "Blackout" pattern variant (level.ts's hideNextPreview). Distinct from
   *  `empty` on purpose: "nothing is coming" and "something is coming and you
   *  may not see it" are different facts, and a belt that drew them the same
   *  way would read as a bug rather than a rule. */
  hidden: boolean;
  /** What the previewed shipment is made of (theme.ts's Material) — the belt
   *  colors the tile by it, so slag and cryo are visible one shot before they
   *  reach the muzzle. That lead time is what makes them planning problems
   *  rather than surprises. */
  material: Material;
}

// The field tops out (you lose) when a settled cube reaches near the ceiling.
const TOPOUT_Y = 96;

/* Impact audio thresholds, in relative px/step between the colliding bodies.
 * Calibrated against the two speeds the physics already names: lineClear's
 * SETTLE is 3.2 (a cube counts as at rest below it) and CRYO_STRIKE_SPEED is 6
 * (hard enough to thaw ice).
 *
 * IMPACT_MIN sits just above the rest threshold so the permanent low-level
 * contact chatter of a settled pile is silent, and IMPACT_FULL above the speed
 * a launched piece arrives at, so an ordinary landing has headroom left rather
 * than pinning at full volume. Audio only — nothing here affects simulation. */
const IMPACT_MIN = 4;
const IMPACT_FULL = 14;

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
 *  With WIND_GUST_FRACTION=0.015 and WIND_TAU_SEC=5 that comes out to std ≈
 *  10.6% of windMax at every windy bay (e.g. bay 4's windMax 0.03 → std ≈
 *  ±0.0032) — gusts read as texture around a legible prevailing average,
 *  not noise the size of the average itself (the old flat windGust=0.03 was
 *  std ≈ ±0.055, i.e. almost the ENTIRE 0.06 windMax cap bay 4 carried at
 *  the time). */
const WIND_REVERT = 1 - Math.exp(-1 / (WIND_TAU_SEC * STEPS_PER_SEC));

/** How long (physics steps) the SETTLE window may run before the bay is called
 *  won regardless of whether everything has stopped moving. Sized as a real
 *  seconds value: 4s is long enough for a max-power lob fired the instant
 *  before the target was met to land and be pressed, and short enough that a
 *  pile in permanent contact-jitter can't hold the celebration hostage. The
 *  window's NORMAL exit is "field at rest AND a pressing stroke completed" —
 *  see resolveWin; this is only the backstop. */
const WIN_SETTLE_MAX_STEPS = Math.round(4 * (1000 / DT));

/** How long (physics steps) a provably-dead exact-inventory bay keeps running
 *  before it is called (see the pieces branch in update()). ~1s: long enough
 *  that the cube that killed the attempt is visibly blinking out when the modal
 *  arrives — "you lost by one cube" is the feedback that makes the retry
 *  interesting — and short enough that nobody is made to play out a bay whose
 *  outcome is already decided. */
const UNREACHABLE_GRACE_STEPS = Math.round(1 * (1000 / DT));

/** Autoloader aim spread (radians, +/-) around the player's current angle —
 *  ~5.7 degrees. Wide enough that consecutive shots genuinely scatter (that's
 *  the mechanic), tight enough that where the player points the cannon still
 *  decides where the burst lands, not merely which half of the bay it ruins. */
export const AUTO_SPREAD_RAD = 0.1;

/** Autoloader power spread, as a +/- fraction of the ship's speed band, around
 *  whatever power the player is holding.
 *
 *  This used to re-roll uniformly across the WHOLE upper 55% of the band on
 *  every shot, which meant the drag's power axis did nothing at all: measured
 *  on device, a held burst threw between 17.7 and 33.0 px/step. Range goes as
 *  v^2, so that is a ~3.5x spread in landing distance — the single biggest
 *  reason a burst scattered across the entire bay no matter how it was aimed. */
export const AUTO_POWER_JITTER = 0.08;

/** Floor for autoloader power, as a fraction of the speed band. Purely a guard
 *  against the one strictly-wasted outcome — holding the trigger at a bay's
 *  untouched default power (speedMin) dribbles shipments onto the cannon's own
 *  feet. Above it the player's drag is obeyed exactly, including deliberately
 *  short shots. */
const AUTO_POWER_FLOOR = 0.25;

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
  /**
   * True when the arc above ends somewhere the bay can never use — down the
   * intake chute, or short of the compactor's furthest reach. Drives the
   * canvas strand warning (render.ts): red arc, red muzzle ring, and the maw
   * lighting up.
   *
   * A FIELD written by updateTrajectory rather than a getter, because it is a
   * property of the arc and the arc only changes when the aim does — a getter
   * would re-walk 140 points on every read, and render reads it every frame.
   */
  trajectoryStrands = false;

  score: number;
  combo = 0;
  /** Index into level.pileTiers of the congestion tier in force as of the top
   *  of the current step, or -1 for a clean bay. Set once per update() before
   *  the physics runs, and read twice after: to detect crossing UP (which ends
   *  the combo) and to price the step's line clear (payMult).
   *
   *  That second read is why this is a FIELD and not a local. By the time a
   *  clear is paid out, updateLineClear has already pulled the crushed cubes
   *  out of this.cubes — so `pileTier` at that moment describes the bay AFTER
   *  the mess was cleaned up, and a four-row collapse off a 60-cube stack would
   *  price itself as a clean bay. This is the reading from before the crush,
   *  which is the bay the player actually built. */
  private lastCongestionIdx = -1;
  linesTotal = 0;
  /** CUBES lost off the wrong side, not pieces: it sums lostCubes.length, and
   *  the penalty is charged per cube too. Telemetry ships it as the badly named
   *  `lostPieces`; dividing it by a shot count gives cubes per shot, never a
   *  fraction of shots. */
  lostTotal = 0;
  status: GameStatus = "playing";
  /** Which condition triggered a "lost" status, for end-of-run copy. */
  lossReason: LossReason | null = null;
  aiming = false;
  paused = false;

  /** Countdown in ms; Infinity when level.timeLimitSec is 0 (no limit). */
  timeLeftMs: number;
  /** Pieces AND bombs fired so far this level — drives nextIsBomb. */
  shotsFired = 0;
  /** Bond Breaker charges left in the RUN's stock (see useBondBreaker).
   *  Seeded from level.bondBreakerCharges — which main.ts threads bay-to-bay,
   *  so this is the run's remaining magazine, not a per-bay refill. */
  bondCharges: number;
  /** Demolition charges left this bay (see armBomb/shoot). Seeded from
   *  level.bombCharges — 0 unless the player drafted them. */
  bombCharges: number;
  /** How many charges the resupply line has already returned this bay. Counts
   *  GRANTS, not charges held, so spending one never re-opens a grant already
   *  paid — see level.ts's bombResupply, which is idempotent against this. */
  bombsResupplied = 0;
  /** True when a demolition charge is ARMED: the next launch fires a bomb
   *  instead of the loaded piece, free of launch cost (see shoot()). Armed
   *  rather than fire-on-tap so the shot still goes where the player aimed —
   *  the muzzle ghost and belt preview both swap to a bomb while this is set,
   *  so what's promised is what fires. */
  bombArmed = false;
  /** SCRAP earned this bay so far (level.scrapPerLine per cleared line). The
   *  run adds the per-bay clear bonus on top when the bay is banked — see
   *  run.ts's advanceRun. Accrues even in a bay that is ultimately lost, which
   *  is deliberate: the run keeps whatever the bay actually produced. */
  scrapEarned = 0;
  /** Funds recovered from demolition-charge blasts this bay — a stat for the
   *  end/HUD readouts so bomb income is visibly separate from line income. */
  salvagedFunds = 0;
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

  /** Game.stepCount when the clock first hit zero, or null while time
   *  remains. Time-up is overtime, not an instant loss — see the time-up
   *  block in update(). */
  private timeUpStep: number | null = null;
  /** Game.stepCount when the launch budget was first exhausted, or null.
   *  Same overtime treatment as the clock, and for a sharper reason: the shot
   *  that spends the last launch is still IN THE AIR, and it is exactly the
   *  shot most likely to complete the objective. Judging the bay the instant
   *  shotsFired hits the budget would lose on the winning move. */
  private launchesUpStep: number | null = null;
  /** Game.stepCount when the shipment queue ran out — or when the objective
   *  first became arithmetically unreachable, whichever came first. Null on
   *  every bay whose bag cycles forever. */
  private piecesUpStep: number | null = null;
  /** Game.stepCount when the funding target was met and the SETTLE window
   *  opened, or null while the bay is still being played. The bay is NOT won
   *  the instant funds cross the target: shots already in the air have been
   *  paid for and deserve to land, a line the last shot completed deserves its
   *  pressing stroke, and freezing the field mid-flight to slam a modal up
   *  reads as the game snatching the moment away. See resolveWin. */
  private winPendingStep: number | null = null;
  /** Autoloader: Game.stepCount of its last auto-fired shot (see
   *  stepAutoLaunch). Steps, not wall-clock, for the same pause-safety reason
   *  as the bomb timers. */
  private lastAutoStep = -99999;
  /**
   * Autoloader trigger: true while the player is holding it down.
   *
   * The rig used to fire on a free-running 420ms timer, which made it a
   * metronome that ignored the compactor. Measured on device, one autoloader
   * bay threw 34 lost CUBES from 32 shots (1.06 per shot, against a 0.11
   * baseline; lostTotal counts cubes, and this was long mis-reported as a
   * "106%" of shots) at 16 shots per line, and its shots were spread evenly
   * across the compactor cycle (z=0.71 retreat-vs-press) while the same
   * player's manual shots were strongly biased toward the open window
   * (z=4.27). It was firing into a shut bay roughly half the time and paying
   * the lost-piece penalty for it.
   *
   * Holding a trigger puts the WHEN back in the player's hands while leaving
   * the WHERE scattered, which is the upgrade's whole identity: a fast, sloppy
   * stream you point and time, never a better cannon.
   */
  autoHeld = false;
  /** Seeded RNG for the Autoloader's aim spread — separate stream from the
   *  wind's so adding/removing the mod can't shift the weather for a seed. */
  private readonly autoRng: () => number;
  /** Game.stepCount of the compactor's most recent arrival at full advance
   *  (rightX) — "a pressing stroke has completed since step S" is then just
   *  `lastFullAdvanceStep > S`. */
  private lastFullAdvanceStep = -1;

  /** Physics steps elapsed (one per update() call) — bombs use this instead
   *  of wall-clock time so arming/fuse timing is pause-safe by construction
   *  (update doesn't run while paused). */
  private stepCount = 0;

  /** Launches still available, or Infinity when this bay isn't budgeted (every
   *  Deep Run bay — see level.ts's launchBudget). Counts shotsFired, which
   *  includes bombs: a bomb is a shipment you chose to spend. */
  get launchesLeft(): number {
    if (this.level.launchBudget <= 0) return Infinity;
    return Math.max(0, this.level.launchBudget - this.shotsFired);
  }

  /** Shipments left in this bay's finite queue, or Infinity when the piece bag
   *  cycles forever (every Deep Run bay — see level.ts's pieceQueue). */
  get piecesLeft(): number {
    return this.cannon.piecesLeft;
  }

  /** The shipments still to come, in order — what a pattern Contract's HUD
   *  shows in full, since planning against the whole remaining set is the
   *  point of the mode. Empty on a cycling bag. */
  get piecesRemaining(): PieceType[] {
    return this.cannon.remaining;
  }

  /** Cubes that could still reach a completed line: everything on the field
   *  that isn't already blinking out, plus everything still in the queue.
   *
   *  A deliberate UPPER bound — a cube wedged somewhere hopeless is counted,
   *  because "hopeless" isn't provable and a false loss is far worse than a
   *  late one. What IS provable is the other direction, which is all
   *  objectiveUnreachable needs. */
  get cubesAvailable(): number {
    let live = 0;
    for (const c of this.cubes) if (c.blinkStart === null) live += 1;
    if (this.piecesLeft === Infinity) return Infinity;
    return live + this.piecesLeft * SIZE_SPEC[this.level.pieceSize].cubes;
  }

  /** Cubes the unmet part of a line objective still demands. Reads the
   *  compactor's own minimum-line width rather than a copy of it, so the two
   *  can't drift (contracts.ts's CUBES_PER_LINE is pinned to it by a test). */
  get cubesRequired(): number {
    const linesLeft = Math.max(0, this.level.objectiveLines - this.linesTotal);
    return linesLeft * this.level.compactorMinLineCells;
  }

  /**
   * True once the objective is arithmetically out of reach: not enough cubes
   * exist, anywhere, to finish the lines still owed.
   *
   * This only ever fires on an EXACT-INVENTORY bay (a pattern Contract, whose
   * queue is sized to tile the goal with zero waste), and it exists because
   * such a bay dies silently. Lose one cube off the deck on the second shot
   * and the attempt is already over — but nothing says so, and the player
   * keeps firing a bay that cannot be won. Since a retry is free and instant,
   * calling it immediately is strictly kinder than letting it run out.
   *
   * Monotone by construction, so it can never flicker: clearing a line drops
   * available and required by the same CUBES_PER_LINE, and every other event
   * (a cube lost, a shipment spent) can only lower the margin.
   */
  get objectiveUnreachable(): boolean {
    if (this.level.objectiveLines <= 0) return false;
    return this.cubesAvailable < this.cubesRequired;
  }

  /** This bay's win condition, met. A CONTRACT is won on lines cleared; a Deep
   *  Run bay on funds banked. Kept as one accessor so update() has a single
   *  win test rather than a mode branch buried in the resolution ladder. */
  get objectiveMet(): boolean {
    if (this.level.objectiveLines > 0) return this.linesTotal >= this.level.objectiveLines;
    return this.score >= this.target;
  }

  /** 0..1 progress toward whichever objective this bay is running, for the HUD. */
  get objectiveProgress(): number {
    if (this.level.objectiveLines > 0) {
      return Math.min(1, this.linesTotal / this.level.objectiveLines);
    }
    return this.target > 0 ? Math.min(1, this.score / this.target) : 0;
  }

  /** ms elapsed in this bay, counted in physics steps rather than wall clock so
   *  it is pause-safe by construction (update() doesn't run while paused). The
   *  timeline every telemetry record is stamped against. */
  get elapsedMs(): number {
    return this.stepCount * DT;
  }
  private liveBombs: Bomb[] = [];
  private pendingDetonations = new Set<Matter.Body>();
  /** Cubes caught in a volatile blast this step, removed once matter is out of
   *  its solver (see resolveVolatile). A Set because one impact can be reported
   *  as several pairs and a cube must only be destroyed once. */
  private pendingBlast = new Set<Matter.Body>();
  /** Tar welds discovered this step, created once the solver is done. */
  private pendingWelds: Array<[Matter.Body, Matter.Body]> = [];
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
    //
    // The roll is DRAWN even when the bay's wind is locked (level.windLock —
    // a Final Inspection's wind fork, see finals.ts) and then thrown away, so
    // that the gust stream that follows sits at the same position either way.
    // A locked bay is then the same weather TEXTURE as the one the seed would
    // have dealt, with only its prevailing average moved — which is exactly
    // what the card promises: the sign is the choice, not the whole climate.
    const rolled = level.windMax === 0 ? 0 : (this.windRng() * 2 - 1) * level.windMax;
    this.windAvg = level.windMax === 0 || level.windLock === null
      ? rolled
      : Math.max(-1, Math.min(1, level.windLock)) * level.windMax;
    this.windCur = this.windAvg;
    this.autoRng = mulberry32((seed ^ 0x5f356495 ^ (level.id * 0x85ebca6b)) >>> 0);
    this.bondCharges = level.bondBreakerCharges;
    this.bombCharges = level.bombCharges;
    this.score = level.startingFunds;
    this.timeLeftMs = level.timeLimitSec > 0 ? level.timeLimitSec * 1000 : Infinity;
    this.phys = createPhysics(level);
    this.cannon = new Cannon(level, seed);
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
    // The salvage wall, if this bay opens on one. Before updateTrajectory so
    // the aim line is drawn against the pile that is actually there, and before
    // the collision handler is registered because these cubes are placed rather
    // than launched — nothing about them is an impact.
    this.cubes.push(...createStandingWall(this.phys.world, level.standingWall, level.standingWallMaterial));
    this.updateTrajectory();

    this.onCollisionStart = (e) => {
      // Hardest pair in this event, for onImpact. Tracked alongside the loop
      // rather than in a second pass — the relative speed only exists at the
      // moment matter reports the pair, the same reason strikeCryo runs here.
      let hardest = 0;
      for (const pair of e.pairs) {
        const rel = Math.hypot(
          pair.bodyA.velocity.x - pair.bodyB.velocity.x,
          pair.bodyA.velocity.y - pair.bodyB.velocity.y,
        );
        if (rel > hardest) hardest = rel;
        for (const bomb of this.liveBombs) {
          if (pair.bodyA === bomb.body || pair.bodyB === bomb.body) {
            if (this.stepCount - bomb.bornStep >= BOMB_ARM_STEPS) {
              this.pendingDetonations.add(bomb.body);
            }
          }
        }
        // Cryo thaws on a hard enough impact. Done here rather than in the
        // per-step loop because the relative speed of a collision only exists
        // at the moment matter reports it — a step later both bodies have
        // already exchanged momentum and read as slow.
        strikeCryo(this.cubes, pair.bodyA, pair.bodyB);
        // VOLATILE: a hard landing takes the cube and its neighbours. Queued
        // rather than removed inline for the same reason bombs are — matter is
        // mid-solve here, and deleting bodies out from under the pair loop
        // corrupts the very iteration that found them.
        const blast = volatileBlast(this.cubes, pair.bodyA, pair.bodyB, this.level.volatileTriggerMult);
        for (const c of blast) this.pendingBlast.add(c.body);
        // TAR: welds to whatever it settled against. Also deferred — adding a
        // constraint during collisionStart is the same mid-solve mutation.
        for (const [a, b] of tarWelds(this.cubes, pair.bodyA, pair.bodyB)) {
          this.pendingWelds.push([a.body, b.body]);
        }
      }
      // IMPACT_MIN filters the low-level contact chatter of the AWAKE part of
      // the pile. Sleeping (engine.ts) quiets fully-settled cubes, but the
      // zone near the moving bar is deliberately kept awake (see
      // wakeCompactorBand), and those cubes report soft contacts every step.
      if (hardest >= IMPACT_MIN) {
        this.events.onImpact?.(Math.min(1, (hardest - IMPACT_MIN) / (IMPACT_FULL - IMPACT_MIN)));
      }
    };
    Matter.Events.on(this.phys.engine, "collisionStart", this.onCollisionStart);
  }

  get target(): number {
    return this.level.targetScore;
  }

  /** True if the NEXT launch will fire a demolition charge — i.e. one is
   *  armed. Drives the muzzle ghost and the belt telegraph, which must promise
   *  exactly what the next trigger pull produces. */
  get nextIsBomb(): boolean {
    return this.bombArmed;
  }

  /** True while the bay's funding target has been met but the field hasn't
   *  finished settling yet (see resolveWin). Public so the HUD can switch to a
   *  "SETTLING" readout and disable its launch affordances without having to
   *  infer the state from score >= target. */
  get settling(): boolean {
    return this.winPendingStep !== null && this.status === "playing";
  }

  /** What rides the conveyor-belt "NEXT" preview: the shot that fires AFTER
   *  the one the muzzle ghost is promising (render.ts's drawLoadedPiece
   *  already shows the current shot at the cannon). While a bomb is armed the
   *  loaded piece hasn't been consumed, so it keeps riding the belt at its
   *  live rotation; otherwise the belt carries the queue's next piece,
   *  unrotated — markShot resets pieceRotation when it loads. */
  get beltPreview(): BeltPreview {
    if (this.bombArmed) {
      return {
        bomb: false,
        type: this.cannon.currentType,
        quarterTurns: this.cannon.quarterTurns,
        empty: false,
        hidden: false,
        material: this.cannon.currentMaterial,
      };
    }
    return {
      bomb: false,
      type: this.cannon.nextType,
      quarterTurns: 0,
      empty: !this.cannon.hasNext,
      // Blacked out, not emptied: the belt still shows a crate coming (see
      // components.ts's beltSealedHTML). What is hidden is only the ORDER —
      // the whole set is on the Contract card, and the LOADED shipment stays
      // visible, because a bay that hides what is in the muzzle is not asking
      // the player to manage risk, it is asking them to guess.
      hidden: this.level.hideNextPreview && this.cannon.hasNext,
      material: this.cannon.nextMaterial,
    };
  }

  /**
   * Toggle a demolition charge on/off the launch rail. A no-op (returns false)
   * with no charges left, or when the game isn't actively playable — so the
   * HUD can call this blind and just re-read `bombArmed`. Disarming is always
   * allowed and never costs anything; the charge is only consumed when the
   * armed shot actually FIRES (see shoot()), so arming to look at the ghost
   * and thinking better of it is free.
   */
  armBomb(): boolean {
    if (this.status !== "playing" || this.paused || this.settling) return false;
    if (this.bombArmed) {
      this.bombArmed = false;
      this.events.onBombArmed?.(false);
      return true;
    }
    if (this.bombCharges <= 0) return false;
    this.bombArmed = true;
    this.events.onBombArmed?.(true);
    return true;
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
    // deviations of headroom above windMax BY CONSTRUCTION — clamp and std
    // both scale with windGust, so retuning WIND_GUST_FRACTION never changes
    // the headroom in stds (see the std formula in WIND_REVERT's comment).
    // At WIND_GUST_FRACTION=0.015 that's exactly windMax * 1.24, tight
    // enough that a bay never reads as far windier than its advertised
    // windMax.
    const cap = windMax + windGust * 16;
    this.windCur = Math.max(-cap, Math.min(cap, this.windCur));
  }

  /**
   * Put a spark on every seam that just came apart.
   *
   * All three break paths funnel through here — the stress snap and the
   * compactor's crush (both in update), and the Bond Breaker's discharge — so
   * a bond letting go looks the same whatever tore it. That sameness is the
   * point: the player is learning ONE rule (joints are what keep a shipment a
   * shape, and they can fail), and three different-looking cues for it would
   * teach three rules.
   */
  private sparkJoints(broken: JointBreak[], now: number): void {
    for (const b of broken) {
      this.effects.push({ kind: "snap", x: b.x, y: b.y, color: b.color, t0: now });
    }
  }

  /**
   * Blow one cube apart into coloured wreckage, at the position it occupied.
   *
   * Call this immediately BEFORE removing the cube, from anywhere a blast
   * deletes cargo (detonate, resolveVolatile) — the blast ring already says
   * something went off, and this is what says WHAT it took. That distinction
   * carries most of its weight on a volatile pop, where the answer is cargo the
   * player had already landed and banked on: cubes that simply ceased read as
   * the field tidying itself, which is the opposite of a hazard firing.
   *
   * Per cube rather than one burst at the blast centre, because debris that
   * starts where its cube stood is the whole read — you watch the shape of what
   * you destroyed come apart.
   */
  private throwChunks(cube: Cube, now: number): void {
    const p = cube.body.position;
    this.effects.push({ kind: "chunk", x: p.x, y: p.y, color: cube.color, t0: now });
  }

  /**
   * Price cargo the bay lost, whichever way it went — blinked out short of the
   * compactor, or fed into the intake chute.
   *
   * Extracted so those two paths cannot drift. They are the same event
   * economically (cargo the player paid to launch and will never get a line
   * out of) and they were only ever going to be told apart by their FX, so the
   * accounting lives in one place and each caller spawns its own.
   *
   * Returns what ACTUALLY left the bankroll, which is not always the nominal
   * charge: the balance floors at 0, and a "−$100" toast over a $30 bankroll
   * would be the HUD contradicting itself. Callers skip their toast on 0 — a
   * Contract prices a lost piece at nothing, and a $0 penalty would teach a
   * rule that isn't there.
   */
  private chargeLostCubes(n: number, _now: number): number {
    this.combo = 0;
    this.lostTotal += n;
    const deducted = Math.min(this.score, n * this.level.penaltyPerLostPiece);
    this.score -= deducted;
    this.events.onPieceLost?.(n);
    return deducted;
  }

  /**
   * Feed whatever has entered the recycling plant's intake through it (see
   * chute.ts for why the maw exists and why its rect is authored rather than
   * measured).
   *
   * The FX split follows detonate's: debris PER CUBE, where each cube stood, so
   * you can read the shape of what you lost — but ONE explosion and one sound
   * for the batch, because a shipment going in is one event and four of them in
   * a step would be a wall.
   *
   * The "−$" is the exception, and it is the entire point of the mechanic: it
   * spawns on the chute's LIP rather than at the cubes, because the cubes are
   * behind the plant panel and a penalty toast rendered behind an opaque panel
   * is how this was invisible in the first place.
   */
  private shredChute(now: number): void {
    // Bombs first: one that flies in goes off rather than being quietly eaten.
    // Routed through the normal detonation queue, so it gets the bomb's own
    // blast and sound — a demolition charge exploding is a demolition charge
    // exploding, wherever it happened to land. It vaporizes nothing (the maw is
    // kept empty by this very method), so the cost is the charge and no more.
    const rightEdge = chuteRightEdge(this.strandCutoffX);
    for (const bomb of this.liveBombs) {
      const p = bomb.body.position;
      if (inChute(p.x, p.y, rightEdge)) this.pendingDetonations.add(bomb.body);
    }

    const shredded = shredInChute(this.phys.world, this.cubes, this.constraints, rightEdge);
    if (shredded.length === 0) return;

    let cx = 0;
    for (const cube of shredded) {
      cx += cube.body.position.x;
      this.throwChunks(cube, now);
    }
    cx /= shredded.length;
    this.effects.push({
      kind: "explosion", x: cx, y: CHUTE_LIP_Y + CHUTE_BLAST_R * 0.5, r: CHUTE_BLAST_R, t0: now,
    });
    this.events.onExplosion?.("chute");

    const deducted = this.chargeLostCubes(shredded.length, now);
    if (deducted > 0) {
      // Spawned a full SINK above the lip, not 20px above it. The toast
      // travels PENALTY_SINK_PX down over its life, and the plant panel's top
      // edge is CHUTE_LIP_Y — so the old anchor put the number in clear air
      // for its first third and behind an opaque panel for the rest, which is
      // the exact failure the lip constant was introduced to avoid.
      this.effects.push({
        kind: "penalty", x: cx, y: CHUTE_LIP_Y - 20 - PENALTY_SINK_PX, amount: deducted, t0: now,
      });
    }
  }

  /**
   * Bond Breaker special ability (charged by the Bond Emitter track — see
   * run.ts's bondChargesFor for the run-scoped magazine): shatter EVERY joint on
   * the field at once, turning all pieces into loose cubes. With nothing
   * holding awkward stacks rigid, the pile slumps flatter and the compactor
   * packs the loose cubes into full lines far more easily. Consumes one charge;
   * a no-op (returns false, no charge spent) when there are no charges left, no
   * joints left to break, or the game isn't actively playing. `now` is the
   * caller's wall-clock time, used only as the FX timestamp.
   */
  useBondBreaker(now: number): boolean {
    if (this.status !== "playing" || this.paused || this.settling) return false;
    // Count only what a Bond Breaker could actually break: a field held
    // together entirely by tar welds must not silently eat a charge.
    const breakable = this.constraints.filter(
      (c) => !(c as unknown as JointMeta).welded,
    ).length;
    if (this.bondCharges <= 0 || breakable === 0) return false;

    // Tear down every joint (world + array) in one sweep — same removal both
    // places as removeConstraintsFor — reporting each seam as it goes, exactly
    // like the other two break paths.
    //
    // Welds survive. Tar is the one joint a Bond Breaker cannot split, and
    // that exemption is the whole reason tar is a different problem from rebar
    // rather than a re-skin of it.
    const survivors: Matter.Constraint[] = [];
    const broken: JointBreak[] = [];
    let sx = 0;
    let sy = 0;
    for (const c of this.constraints) {
      if ((c as unknown as JointMeta).welded) { survivors.push(c); continue; }
      if (c.bodyA && c.bodyB) {
        const seam = jointBreakAt(c);
        broken.push(seam);
        sx += seam.x;
        sy += seam.y;
      }
      Matter.Composite.remove(this.phys.world, c);
    }
    this.constraints.length = 0;
    this.constraints.push(...survivors);

    // Every joint on the field just vanished, so any cube could now be
    // unsupported — a sleeping overhang that was hanging off its joints would
    // otherwise stay frozen in the air. Field-wide action, field-wide wake.
    for (const cube of this.cubes) Matter.Sleeping.set(cube.body, false);

    // One spark per SEAM, not a full brick-shatter per cube. The old cue said
    // "every cube exploded" when what actually happened is "every seam let go",
    // and at field scale a hundred-odd full-size shatters buried the field
    // under its own debris. The same puff a single stress snap makes, many
    // times over, is both the honest read and the cheaper one.
    this.sparkJoints(broken, now);
    // A central shockwave ring so the field-wide break still reads as one
    // deliberate action, not just scattered sparks. Centred on the seams that
    // broke — the discharge's own footprint — rather than on the whole pile.
    const n = broken.length;
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

  /** Signed lateral wind acceleration (px/step^2) at THIS instant, AFTER the
   *  launcher's stabilizer (level.windAssist, from the LAUNCHER upgrade track)
   *  has cancelled its share. This — not the raw drunk walk — is the single
   *  number that drives everything the player can observe or feel: the force
   *  applied to airborne bodies (applyWind), the dotted preview arc
   *  (updateTrajectory) and the HUD gauge (render.ts). Keeping them on one
   *  value is what makes a stabilizer legible: buy a tier, watch the gauge
   *  shrink, watch your arcs stop drifting, all consistently.
   *
   *  Pause-safe by construction (windCur only advances inside update(), which
   *  doesn't run while paused). */
  get windNow(): number {
    return this.windCur * (1 - Math.max(0, Math.min(0.95, this.level.windAssist)));
  }

  /** The bay's RAW prevailing wind (px/step^2) before any stabilizer — what
   *  the Weather Survey meta unlock reveals (see meta.ts), so the HUD can show
   *  "this bay blows left at 60%" as a fixed, learnable fact next to the live
   *  reading. Always available on Game; whether it's SHOWN is the UI's call. */
  get windAverage(): number {
    return this.windAvg;
  }

  /**
   * The active congestion tier, or null when the bay is clean enough (or the
   * mechanic is off — level.pileTiers empty; see level.ts's PILE_TIERS).
   *
   * Reads `cubes.length`, i.e. every live cube ANYWHERE on the field, not just
   * the ones inside the compaction zone. Deliberate: cargo strewn on the
   * launcher side of the bar is exactly what a spam volley produces, and it is
   * still the player's mess — pricing only the zone would make "fire wildly and
   * miss" the cheap option and "land it where the press can reach" the
   * expensive one, which is backwards. Cubes leave this array when a line
   * clears, a bomb vaporizes them or they decay out of the bay, so the reading
   * falls the moment the bay is actually tidied.
   *
   * Highest matching tier wins rather than summing: the tiers are a staircase
   * describing one state, not stacking debuffs.
   */
  get pileTier(): PileTier | null {
    const tiers = this.level.pileTiers;
    if (!tiers.length) return null;
    const n = this.cubes.length;
    let active: PileTier | null = null;
    for (const t of tiers) {
      if (n > t.cubes + this.level.pileAllowance) active = t;
    }
    return active;
  }

  /**
   * The congestion tier in force as of the TOP OF THE CURRENT STEP, or null.
   *
   * Distinct from `pileTier`, which reads the field as it stands right now, and
   * the two differ in exactly the moment that matters. By the time a clear is
   * paid out, updateLineClear has already pulled the crushed cubes out of
   * `cubes` — so `pileTier` describes the bay AFTER it was tidied, while this
   * still describes the bay the player actually built and fired into. Price a
   * four-row collapse off a 60-cube stack with the live reading and it looks
   * like a clean bay: the payout tax would miss precisely the play it exists
   * for. Payouts read this one; prices, which are quoted before a shot rather
   * than after a crush, read the live one.
   */
  get stepPileTier(): PileTier | null {
    return this.lastCongestionIdx >= 0
      ? this.level.pileTiers[this.lastCongestionIdx] ?? null
      : null;
  }

  /** What the NEXT launch actually costs, congestion included. The HUD reads
   *  this rather than level.launchCost so the price the player is quoted is the
   *  price they pay — a tax you only discover after firing teaches nothing. */
  get launchCostNow(): number {
    const tier = this.pileTier;
    return tier ? Math.round(this.level.launchCost * tier.costMult) : this.level.launchCost;
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
    this.trajectoryStrands = pathStrands(this.trajectory, this.strandCutoffX);
  }

  /**
   * The leftmost x a cube can settle at and still be reachable, i.e. the
   * boundary lineClear's markLostPieces strands cargo across. Taken from the
   * compactor's own open stop, so the warning drawn on the arc and the penalty
   * charged on landing are one number and cannot drift apart.
   */
  get strandCutoffX(): number {
    return this.compactor.strandCutoffX;
  }

  /** `auto` marks a shot the Autoloader trigger fired rather than the player's
   *  own launch, so telemetry can tell the rig's output from the player's — the
   *  first autoloader bay could only be identified by its mod list and its
   *  434ms metronome, which will not work now that its cadence is the player's. */
  shoot(now: number, auto = false): boolean {
    if (this.status !== "playing" || this.paused) return false;
    // Target already met: the SETTLE window only lets what's ALREADY flying
    // land (see resolveWin) — spending more on a bay you've won is never what
    // the player meant.
    if (this.settling) return false;
    // Clock's out: overtime only settles what's already flying (see the
    // time-up block in update()) — no new launches.
    if (this.timeLeftMs <= 0) return false;
    // Budget spent (Contracts). Same rule as the clock: what's airborne still
    // lands, but nothing new leaves the cannon.
    if (this.launchesLeft <= 0) return false;
    // Queue's dry (pattern Contracts). A bomb is exempt: it's a consumable
    // drafted separately, not a shipment off the manifest — but nothing can
    // draft one into a Contract today, so this is a guard, not a feature.
    if (this.piecesLeft <= 0 && !this.bombArmed) return false;
    if (!this.cannon.canShoot(now)) return false;

    // An armed demolition charge fires FREE — it's a consumable, already paid
    // for when it was drafted, so the funds check is skipped entirely for it.
    // That's the whole economic fix: the old bomb burned a full-price launch
    // and returned nothing, so it was never the right call at any funds level.
    const firingBomb = this.bombArmed && this.bombCharges > 0;
    // Congestion is priced HERE, on the shot (see level.ts's PILE_TIERS): the
    // quote the HUD showed and the amount deducted below are the same number.
    const cost = this.launchCostNow;
    if (!firingBomb && this.score < cost) return false;

    // Captured BEFORE markShot/markCooldown move the cannon's clock forward.
    // lastShot starts at a large negative sentinel, so a bay's first shot has
    // no meaningful ready time and reports null rather than a nonsense wait.
    const readyAt = this.cannon.readyAt();
    const shot: ShotInfo = {
      t: this.elapsedMs,
      wait: readyAt > 0 ? Math.max(0, now - readyAt) : null,
      angle: this.cannon.angle,
      power: this.cannon.power,
      type: this.cannon.currentType,
      size: this.level.pieceSize,
      rot: this.cannon.pieceRotation,
      funds: this.score,
      bomb: firingBomb,
      cphase: this.compactor.phase,
      cdir: this.compactor.dir,
      cstroke: this.compactor.strokes,
      auto,
    };

    this.shotsFired += 1;

    if (firingBomb) {
      this.bombCharges -= 1;
      this.bombArmed = false;
      this.spawnBomb();
      // Cooldown-only: the queued piece stays loaded for the next real shot.
      this.cannon.markCooldown(now);
    } else {
      this.score -= cost;
      this.burnCongestionClock();
      const piece = createTetrisPiece(
        this.phys.world,
        this.cannon.tip.x,
        this.cannon.tip.y,
        this.cannon.pieceRotation,
        this.cannon.velocity,
        this.cannon.currentType,
        this.level.jointStiffness,
        this.level.pieceSize,
        this.level.jointBreakStretch,
        this.cannon.currentMaterial,
        // The Seam Splitter's per-type weakening (upgrades.ts's Bond Emitter
        // writes it onto the level). Passed unconditionally rather than only
        // when a type is listed: an empty weakBondTypes stamps exactly the
        // stock thresholds, and one shape of call is one shape to read.
        { types: this.level.weakBondTypes, mult: this.level.weakBondMult },
      );
      this.cubes.push(...piece.cubes);
      this.constraints.push(...piece.constraints);
      this.cannon.markShot(now);
    }

    this.events.onShoot?.(shot);
    this.updateTrajectory();
    return true;
  }

  /**
   * Charge the congestion tier's clock tax for the shot just fired.
   *
   * Floored at 1ms rather than 0, and that is the whole subtlety: the clock is
   * the bay's other loss condition, and letting a tax drive timeLeftMs to
   * exactly 0 would hand the player a time-loss authored by the tax rather
   * than by the clock. Leaving a millisecond means the bay still ends on its
   * own terms — the overtime block in update() takes it from there, settling
   * what is already in the air, which is the same ending a player who simply
   * ran long would get.
   *
   * No-ops on an untimed bay (timeLeftMs Infinity — Contracts, the attract
   * demo), where there is no clock to tax and the funds multiplier carries the
   * whole mechanic on its own.
   */
  private burnCongestionClock(): void {
    const tier = this.pileTier;
    if (!tier || tier.clockSec <= 0) return;
    if (this.timeLeftMs === Infinity) return;
    this.timeLeftMs = Math.max(1, this.timeLeftMs - tier.clockSec * 1000);
  }

  /**
   * Autoloader (level.autoLaunchMs — the retired modifier draft was its only
   * live source, so nothing sets it in a current run): while the
   * trigger is HELD, the cannon fires every level.autoLaunchMs, re-rolling its
   * aim inside a band around wherever the player is pointing rather than
   * shooting the exact same arc forever. Fast, cheap and PROBABILISTIC — it is
   * not trying to be a good player, it's trading precision for volume, which is
   * why it only works on top of a build that can flatten the resulting mess
   * (Bond Breakers) and cheap enough payloads (micro shipments) to survive the
   * waste.
   *
   * Deliberately NOT skipped while aiming. The old timer version bailed out on
   * `this.aiming`, so "grab the slingshot to take back control" was the only
   * control the player had — and holding the trigger while dragging is now the
   * whole point: the burst follows the live aim, so you can sweep a stream
   * across the zone as the compactor opens it.
   */
  private stepAutoLaunch(now: number): void {
    const interval = this.level.autoLaunchMs;
    if (interval <= 0 || !this.autoHeld || this.settling) return;
    const stepsPerMs = 1 / DT;
    if (this.stepCount - this.lastAutoStep < interval * stepsPerMs) return;
    if (!this.cannon.canShoot(now)) return;
    if (this.score < this.launchCostNow) return;

    // The player's aim is the ANCHOR of the burst and survives it: the jitter
    // below is applied for this one shot and restored immediately after.
    //
    // The jittered angle used to be written straight back into cannon.angle,
    // which made the aim a random WALK rather than a spread — every shot's
    // jitter compounded on the last, so a held trigger drifted away from
    // wherever the player was pointing and, at the far end, pinned against the
    // +/-60deg cone limit and fired the same wasted shot repeatedly. Together
    // with a power axis that ignored the drag entirely (see AUTO_POWER_JITTER),
    // that is what made the mod read as erratic. Measured on device before this
    // fix: 6.72 shots per line in autoloader bays against 2.94 in hand-fired
    // ones, and 0.234 cubes lost to the wrong side per shot against 0.103.
    const aimAngle = this.cannon.angle;
    const aimPower = this.cannon.power;
    const cone = Math.PI / 3;
    const band = this.cannon.speedMax - this.cannon.speedMin;
    const floor = this.cannon.speedMin + band * AUTO_POWER_FLOOR;

    const angle = aimAngle + (this.autoRng() * 2 - 1) * AUTO_SPREAD_RAD;
    this.cannon.angle = Math.max(-cone, Math.min(cone, angle));
    const power = aimPower + (this.autoRng() * 2 - 1) * AUTO_POWER_JITTER * band;
    this.cannon.power = Math.max(floor, Math.min(this.cannon.speedMax, power));
    // A random quarter-turn too: the rig doesn't care how the piece lands.
    // Not restored, because markShot already resets pieceRotation to 0.
    const turns = Math.floor(this.autoRng() * 4);
    for (let i = 0; i < turns; i++) this.cannon.rotateRight();

    this.lastAutoStep = this.stepCount;
    this.shoot(now, true);

    this.cannon.angle = aimAngle;
    this.cannon.power = aimPower;
    // shoot() drew the trajectory from the jittered aim; redraw it from the
    // player's, so the dotted arc keeps showing where THEY are pointing.
    this.updateTrajectory();
  }

  /**
   * Press or release the Autoloader trigger (rail button, or a held key on
   * desktop). Pressing resets the cadence clock so the FIRST shot leaves
   * immediately rather than up to 420ms later — the player is pressing because
   * the window is open now, and a trigger that fires on its own schedule
   * instead of theirs would reintroduce exactly the problem this replaced.
   */
  setAutoHeld(held: boolean): void {
    if (held && !this.autoHeld) this.lastAutoStep = -99999;
    this.autoHeld = held;
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
    // Congestion's third pressure, re-read every step because the bay floor
    // changes every step. Pushed onto the cannon rather than consulted at fire
    // time so the RELOAD BAR is honest while it fills: a penalty the player
    // only discovers when the shot refuses to leave teaches nothing, where a
    // bar visibly crawling is the rule explaining itself in the moment the
    // player is already looking at it.
    const congestion = this.pileTier;
    // Crossing UP into a congestion tier kills the combo.
    //
    // The other three taxes are all rates — money, clock, reload — and a rate
    // is something a player can decide to keep paying. The combo is a STREAK,
    // and the only way to charge a streak is to end it, which makes this the
    // one part of congestion that cannot be absorbed by simply firing anyway.
    // It also aims the rule at precisely the play it exists to discourage:
    // spamming into a full bay is exactly how a careful run's multiplier gets
    // thrown away, and now it says so. (The multiplier is capped while
    // congested too — see the clear payout below — so the streak is charged on
    // the way in AND held down for as long as the mess lasts.)
    //
    // On the transition, not while congested. A tax levied every step for
    // sitting above the line would mean the combo could never be rebuilt
    // without first tidying the bay, which punishes the recovery it should be
    // rewarding — the player who keeps clearing while congested is doing the
    // right thing. Comparing INDEX rather than identity so a slide from amber
    // to red charges again, while dropping back down and re-crossing later is
    // a new offence rather than a free pass.
    const tierIdx = congestion ? this.level.pileTiers.indexOf(congestion) : -1;
    if (tierIdx > this.lastCongestionIdx) this.combo = 0;
    // Either direction, unlike the combo break above: a cue has to be taken
    // BACK when the bay is tidied, or the first mess a player cleans up would
    // leave the bay sounding congested for the rest of the level.
    if (tierIdx !== this.lastCongestionIdx) {
      this.events.onCongestion?.(tierIdx + 1, this.level.pileTiers.length);
    }
    this.lastCongestionIdx = tierIdx;
    this.cannon.setCooldownScale(congestion ? congestion.reloadMult : 1);
    this.stepWind();
    this.stepAutoLaunch(now);
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
    // The bar's x clamps exactly to rightX on the tick it arrives (then flips
    // to retreat), so this records precisely the full-advance ticks.
    if (this.compactor.x >= this.compactor.rightX) this.lastFullAdvanceStep = this.stepCount;
    // The bar is a STATIC body moved by setPosition, so matter's sleeping
    // machinery never sees it coming: static-vs-sleeping pairs are skipped by
    // collision detection outright, and a sleeping cube in its path would be
    // plowed through, not pushed. Wake everything in the band the bar
    // occupies (plus a cell of warning in x, and a cell above its top so
    // cubes RIDING the bar fall off the moment it slides out from under
    // them). Contact propagation does the rest — matter wakes a sleeping
    // body when an awake one presses on it.
    this.wakeCompactorBand();
    this.resolveVolatile();
    this.resolveTarWelds();
    this.sparkJoints(
      updateBreakableJoints(this.phys.world, this.constraints, this.level.jointBreakStretch),
      now,
    );
    // MAGNETIC settles itself square. Run after the joints update so a cube
    // that just came loose is snapped on the same step it stopped moving,
    // rather than sitting crooked for one frame.
    // WORLD.height - CELL/2 is updateLineClear's row anchor (see its rowY).
    // WALL_INNER is an X coordinate, so subtracting it here put the snap grid
    // half a cell off the row grid and no magnetic cube could ever fill a slot.
    alignMagnetic(this.cubes, WORLD.height - CELL / 2);

    // The compactor shatters pieces it crushes into loose cubes (no deletion).
    this.sparkJoints(
      breakJointsInBand(
        this.phys.world,
        this.constraints,
        this.compactor.x,
        this.compactor.top - CELL * 0.3,
        this.compactor.width / 2 + CELL,
      ),
      now,
    );

    // While pressing, physically settle near-resting cubes onto the slot grid
    // (vibro-compaction) so the strict clear rule below stays reachable even
    // when a cube wedges tilted against the wall.
    if (pressing) {
      settleZoneCubes(this.cubes, this.compactor, this.level);
    }

    // Cryo that reached the press still frozen breaks, and takes its row's
    // alignment with it. Runs BEFORE the clear check so a row containing cold
    // cryo can never be evaluated as complete on the same step it shatters.
    const shattered = shatterColdCryo(
      this.phys.world,
      this.cubes,
      this.compactor,
      this.constraints,
    );
    if (shattered.cubes.length) {
      this.events.onCryoShatter?.(shattered);
    }

    // Cubes are ONLY removed when a full row is crushed against the wall on the
    // compactor's forward (pressure) stroke — a broken joint never deletes one.
    const clear: ClearResult = pressing
      ? updateLineClear(this.phys.world, this.cubes, this.compactor, this.level, this.constraints)
      : { lines: 0, cubes: [], rows: [] };
    if (clear.lines > 0) {
      this.combo += 1;
      // Congestion's fourth pressure (level.ts's PileTier.payMult): a clear
      // taken out of a cluttered bay pays less. The other three price the shot,
      // which left stack-until-it-collapses paying full rate for every row the
      // collapse crushed.
      //
      // The tier comes from lastCongestionIdx — the bay as it stood at the top
      // of this step — not from this.pileTier, which by now reads the field
      // with the crushed cubes already removed. See the field's note.
      //
      // A ceiling, not a scale: the combo advances once per crush while the
      // payout scales with the lines in it, so scaling the bonus would barely
      // touch a four-row collapse. Below 1 it replaces the bonus outright,
      // which is the intent — a congested bay is not a place to build a streak.
      const bonus = payoutMult(this.combo, this.stepPileTier);
      const awarded = Math.round(clear.lines * this.level.scorePerLine * bonus);
      this.score += awarded;
      this.linesTotal += clear.lines;
      // Scrap is earned per LINE, flat and combo-free (unlike funds): capital
      // shouldn't spike on a lucky multi-clear, or one good stroke would buy a
      // whole upgrade track. See level.ts's SCRAP_PER_LINE note.
      this.scrapEarned += clear.lines * this.level.scrapPerLine;
      this.events.onLineClear?.(clear.lines);
      this.spawnClearFx(clear, awarded, now);
      // A MAXED Demolition Rack returns charges as rows close. Run against the
      // cumulative line count rather than this clear's delta so a four-line
      // crush pays everything it earned — see level.ts's bombResupply for why
      // the naive modulo drops grants. Idempotent, so calling it on every clear
      // can never double-pay.
      const owed = bombResupply(
        this.linesTotal, this.bombsResupplied, this.level.bombResupplyLines,
      );
      if (owed > 0) {
        this.bombsResupplied += owed;
        this.bombCharges += owed;
      }
    }

    // Cargo fed into the recycling plant's intake goes IMMEDIATELY (chute.ts).
    // Before the blink path below, deliberately: everything inside the maw is
    // already left of the strand cutoff, so running markLostPieces first would
    // sentence the same cubes to a 1.4s blink they are not going to serve.
    this.shredChute(now);

    // ...or when they bounce OUT before the compactor (blink away, lose points).
    markLostPieces(this.cubes, this.compactor, now);
    const lostCubes = updateBlinking(this.phys.world, this.cubes, now, this.constraints);
    if (lostCubes.length > 0) {
      const deducted = this.chargeLostCubes(lostCubes.length, now);
      // The expense twin of spawnClearFx's payout: one "−$" at the cluster's
      // centroid, where the cubes just blinked away. A penalty the player only
      // ever met in the end screen's tally read as a hidden rule (playtest,
      // 2026-08-09) — money OUT gets the same moment money IN always had.
      // Skipped when nothing was deducted (Contracts price a lost piece at 0,
      // and a $0 penalty toast would teach a rule that isn't there).
      if (deducted > 0) {
        const meanX = lostCubes.reduce((s, c) => s + c.x, 0) / lostCubes.length;
        const minY = Math.min(...lostCubes.map((c) => c.y));
        this.effects.push({ kind: "penalty", x: meanX, y: minY - 20, amount: deducted, t0: now });
      }
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
    // launchCostNow, not level.launchCost: the question this asks is "can the
    // player fire the shot they would actually fire", and under a congestion
    // tier that shot is priced above the bay's base rate (see level.ts's
    // PILE_TIERS). Reading the base cost here leaves a silent dead zone —
    // funds between the base and congested price mean shoot() refuses every
    // launch while this branch reports the player as solvent, so the bay
    // stalls with no verdict at all until the clock runs out or a lost-cargo
    // fine happens to drop them under the base rate. The rescue path is not
    // weakened by pricing it correctly; it is strengthened, because the line
    // clear that cancels the countdown ALSO removes the cubes that raised the
    // price, so a rescue fixes both halves at once.
    if (this.score >= this.launchCostNow) {
      this.brokeSinceStep = null;
    } else if (this.brokeSinceStep === null) {
      const allAtRest = this.cubes.every((c) => isAtRest(c.body));
      if (allAtRest) this.brokeSinceStep = this.stepCount;
    }

    // Funding target met: open the SETTLE window rather than winning on the
    // spot, then let resolveWin decide when the bay is actually done. Note the
    // ordering below is unchanged — a bay whose target is met still beats a
    // topout/broke/time verdict in the same step — but a bay in its settle
    // window can no longer be LOST either (resolveWin's early return), because
    // the money is already banked; the only thing left to determine is when the
    // dust stops.
    if (this.objectiveMet || this.winPendingStep !== null) {
      if (this.winPendingStep === null) {
        this.winPendingStep = this.stepCount;
        this.events.onSettleStart?.();
      }
      this.resolveWin(now);
    } else if (this.isToppedOut()) {
      this.lossReason = "topout";
      this.setStatus("lost");
    } else if (
      this.brokeSinceStep !== null &&
      this.stepCount - this.brokeSinceStep > this.brokeGraceSteps
    ) {
      this.lossReason = "broke";
      this.setStatus("lost");
    } else if (this.piecesLeft <= 0 || this.objectiveUnreachable) {
      // EXACT-INVENTORY bay (pattern Contract). Two different endings share one
      // verdict because they are the same fact arriving at different times:
      // the shipments that could finish this bay no longer exist.
      //
      //   queue empty      — overtime, exactly like the launch budget below:
      //                      the last shipment is still airborne and is the one
      //                      most likely to close the goal, so wait for a
      //                      completed press and a field at rest.
      //   unreachable      — the arithmetic already settled it (see
      //                      objectiveUnreachable). Nothing that happens next
      //                      can change the answer, so the only reason to wait
      //                      at all is to let the player SEE the cube they just
      //                      lost blink out. A second is enough for that;
      //                      making them play out a dead bay is not kindness.
      if (this.piecesUpStep === null) this.piecesUpStep = this.stepCount;
      const waited = this.stepCount - this.piecesUpStep;
      const strokeDone = this.lastFullAdvanceStep > this.piecesUpStep;
      const done = this.objectiveUnreachable
        ? waited > UNREACHABLE_GRACE_STEPS
        : (strokeDone && this.cubes.every((c) => isAtRest(c.body))) ||
          waited > this.brokeGraceSteps;
      if (done) {
        this.lossReason = "pieces";
        this.setStatus("lost");
      }
    } else if (this.launchesLeft <= 0) {
      // Budget spent — but the last launch is still airborne, so this is
      // overtime, not a verdict. Identical settle gate to the clock below:
      // wait for a completed pressing stroke AND a field at rest, so a line
      // the final shipment completed gets crushed and counted, with the same
      // capped grace so a never-resting pile can't stall forever. The win test
      // above runs first, so finishing on the last launch is a clear.
      if (this.launchesUpStep === null) this.launchesUpStep = this.stepCount;
      const strokeDone = this.lastFullAdvanceStep > this.launchesUpStep;
      if (
        (strokeDone && this.cubes.every((c) => isAtRest(c.body))) ||
        this.stepCount - this.launchesUpStep > this.brokeGraceSteps
      ) {
        this.lossReason = "launches";
        this.setStatus("lost");
      }
    } else if (this.timeLeftMs <= 0) {
      // Overtime — not an instant loss: launches already paid for get to
      // land and their lines to be pressed and paid before the run is
      // judged (shoot() blocks new launches once the clock is out). The
      // run ends once the compactor has completed a pressing stroke since
      // expiry AND the field is at rest — any line the final launch
      // completed has had its crush-and-pay stroke by then — or after the
      // same capped grace window the broke-loss uses, so a never-resting
      // pile can't stall the verdict forever. A payout during overtime can
      // still win the bay: the score >= target check above runs first.
      if (this.timeUpStep === null) this.timeUpStep = this.stepCount;
      const strokeDone = this.lastFullAdvanceStep > this.timeUpStep;
      if (
        (strokeDone && this.cubes.every((c) => isAtRest(c.body))) ||
        this.stepCount - this.timeUpStep > this.brokeGraceSteps
      ) {
        this.lossReason = "time";
        this.setStatus("lost");
      }
    }

    if (this.effects.length) {
      this.effects = this.effects.filter((e) => now - e.t0 < FX_TTL[e.kind]);
    }

    // The dotted preview arc is deliberately NOT recomputed here. It does
    // depend on the wind reading this step advanced (stepWind above), but
    // recomputing per physics step made every catch-up step on a slow device
    // pay for ~140 trajectory samples nobody sees. Consumers refresh it at
    // the rate they actually read it: the render loop (main.ts) once per
    // drawn frame, input.ts on aim changes, shoot()/stepAutoLaunch on fire,
    // and the sim bots (sim/bots.ts) call updateTrajectory() themselves
    // before reading g.trajectory.
  }

  /** Wake every sleeping body inside (or one cell ahead of / above) the
   *  compactor's swept band — see the call site in update() for why the bar
   *  cannot do this itself. Runs every step; Sleeping.set on an awake body is
   *  a no-op, and the scan is two comparisons per cube. Bombs are included:
   *  a sleeping bomb in the bar's path would be tunneled through the same
   *  way, and its collision fuse would never trip. */
  private wakeCompactorBand(): void {
    const c = this.compactor;
    const halfX = c.width / 2 + CELL;
    const topY = c.top - CELL;
    for (const cube of this.cubes) {
      const b = cube.body;
      if (!b.isSleeping) continue;
      if (b.position.y < topY) continue;
      if (Math.abs(b.position.x - c.x) < halfX) Matter.Sleeping.set(b, false);
    }
    for (const bomb of this.liveBombs) {
      const b = bomb.body;
      if (!b.isSleeping) continue;
      if (b.position.y >= topY && Math.abs(b.position.x - c.x) < halfX) {
        Matter.Sleeping.set(b, false);
      }
    }
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
   * The SETTLE window's exit condition. The bay is called won once EITHER
   *   - the field is at rest AND a full pressing stroke has completed since the
   *     window opened (so a line the final shot completed has had its
   *     crush-and-pay stroke — the same reasoning the overtime block uses), or
   *   - WIN_SETTLE_MAX_STEPS have elapsed (backstop for a pile that never
   *     fully rests; contact jitter under the press is common enough that "wait
   *     for perfect stillness" alone would sometimes never fire).
   *
   * Nothing is frozen during the window: physics, the compactor and line clears
   * all keep running, so shots already paid for still land, still shatter, and
   * still pay out — the score shown on the celebration is the real final one.
   * shoot() is what's blocked (see there), not the world.
   */
  private resolveWin(now: number): void {
    if (this.winPendingStep === null) return;
    const elapsed = this.stepCount - this.winPendingStep;
    const strokeDone = this.lastFullAdvanceStep > this.winPendingStep;
    const atRest = this.cubes.every((c) => isAtRest(c.body));
    if ((strokeDone && atRest) || elapsed > WIN_SETTLE_MAX_STEPS) {
      this.effects.push({ kind: "bayclear", x: WORLD.width / 2, y: WORLD.height * 0.42, t0: now });
      this.setStatus("won");
    }
  }

  /**
   * Blow up a demolition charge: every cube centered within BOMB_BLAST_R is
   * destroyed outright (its constraints too — a stray joint pointing at a
   * removed body would otherwise dangle); cubes out to BOMB_SHOVE_MULT *
   * BOMB_BLAST_R get a radial velocity kick instead.
   *
   * Every vaporized cube REFUNDS level.salvagePerCube into funds (and the same
   * per-line scrap rate per 4 cubes, so a big salvage haul also feeds the
   * ship). That refund is the point: it gives the bomb a price the player can
   * actually reason about. A cube sitting in a pile that will never complete a
   * line is worth $0 as line material and salvagePerCube as scrap metal, so
   * blowing up junk is a POSITIVE-value play, while blowing up a row you were
   * two cubes from closing is a clear, self-inflicted loss. The old
   * every-Nth-launch bomb had neither side of that trade — it cost a full-price
   * launch and paid literally nothing, so it was dominated at every funds
   * level, which is exactly the complaint this rework answers.
   *
   * No lost-piece penalty (a deliberate demolition isn't a fumble) and combo is
   * left untouched.
   */
  /**
   * Destroy everything a volatile impact caught.
   *
   * Pays NO salvage for LIVE cargo, which is the whole difference between this
   * and a demolition charge. A bomb is a tool the player aimed: it turns a dead
   * pile into funds. A volatile detonation is a hazard that went off: it turns
   * cargo the player already landed into nothing. Paying for that would make
   * ratcheting the volatile axis an income strategy, which is the exact
   * inversion of a hazard.
   *
   * DEAD cargo is the one exception, and it does not weaken that rule. Slag can
   * never complete a row however the bay is played, so removing it is not a
   * loss being reimbursed — and the bounty only exists for a player who
   * ratcheted a SECOND axis to put slag on the belt in the first place. Volatile
   * alone still earns nothing at all. See lineClear.ts's slagBountyFor.
   */
  private resolveVolatile(): void {
    if (!this.pendingBlast.size) return;
    const now = performance.now();
    let cx = 0;
    let cy = 0;
    let n = 0;
    const gone: { x: number; y: number }[] = [];
    const razed: Cube[] = [];
    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const cube = this.cubes[i];
      const b = cube.body;
      if (!this.pendingBlast.has(b)) continue;
      cx += b.position.x;
      cy += b.position.y;
      n += 1;
      razed.push(cube);
      gone.push({ x: b.position.x, y: b.position.y });
      this.throwChunks(cube, now);
      removeConstraintsFor(this.phys.world, this.constraints, b);
      Matter.Composite.remove(this.phys.world, b);
      this.cubes.splice(i, 1);
    }
    this.pendingBlast.clear();
    // Same un-supported-survivor wake as detonate — a volatile pop deletes
    // cubes out from under whatever was stacked on them.
    for (const g of gone) wakeNear(this.cubes, g.x, g.y);
    if (n) {
      this.effects.push({
        kind: "explosion", x: cx / n, y: cy / n,
        r: VOLATILE_BLAST_CELLS * CELL * 1.4, t0: now,
      });
      this.events.onExplosion?.("volatile");
      // Reuses the bomb's salvage toast rather than inventing a second one: it
      // is the same statement ("that wreckage was worth something") and the
      // player has already learned to read it. A payout they only meet in the
      // end screen teaches nothing — the rule PILE_TIERS follows for its clock.
      const bounty = slagBountyFor(razed, this.level.slagBounty);
      if (bounty > 0) {
        this.score += bounty;
        // NOT salvagedFunds. That field is the demolition charge's trade and
        // nothing else — its doc here, RunState's, and the end screen's all
        // say so, and screens.ts prints it as "$N recovered by demolition".
        // A volatile detonation is not a charge, and a run that never drafted
        // one would otherwise settle up crediting money to a rack the player
        // does not own. The payout still lands (score, above) and still reads
        // at the moment it happens (the toast below); what it must not do is
        // claim to be something else on the way out.
        this.effects.push({
          kind: "salvage", x: cx / n, y: cy / n - 24, amount: bounty, t0: now,
        });
      }
    }
  }

  /**
   * Turn this step's tar contacts into permanent joints.
   *
   * A weld goes into `this.constraints` like any other joint, carrying a
   * `welded` flag that updateBreakableJoints and useBondBreaker both refuse to
   * touch — it is the joint that cannot be broken, which is exactly what
   * separates tar from rebar (rigid, but a Bond Breaker splits it).
   *
   * Flagged-in-the-list rather than held in a separate one on purpose. Every
   * path that destroys a cube — a line clearing, a demolition charge, a cryo
   * shatter — already calls removeConstraintsFor against `constraints`, and a
   * weld kept outside it would survive its own cube's removal and leave matter
   * solving against a body no longer in the world.
   */
  private resolveTarWelds(): void {
    if (!this.pendingWelds.length) return;
    for (const [a, b] of this.pendingWelds) {
      const exists = this.constraints.some(
        (w) => (w.bodyA === a && w.bodyB === b) || (w.bodyA === b && w.bodyB === a),
      );
      if (exists) continue;
      if (!this.cubes.some((c) => c.body === a) || !this.cubes.some((c) => c.body === b)) continue;
      const c = Matter.Constraint.create({
        bodyA: a, bodyB: b,
        length: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y),
        stiffness: 0.95,
        damping: 0.1,
        render: { visible: false },
      });
      (c as unknown as { welded: boolean }).welded = true;
      this.constraints.push(c);
      Matter.Composite.add(this.phys.world, c);
    }
    this.pendingWelds.length = 0;
  }

  private detonate(bombBody: Matter.Body, now: number): void {
    const idx = this.liveBombs.findIndex((b) => b.body === bombBody);
    if (idx === -1) return; // already handled this frame (multiple pairs, fuse+collision, ...)
    this.liveBombs.splice(idx, 1);

    const cx = bombBody.position.x;
    const cy = bombBody.position.y;
    const shoveR = BOMB_SHOVE_MULT * BOMB_BLAST_R;

    let vaporized = 0;
    const gone: { x: number; y: number }[] = [];
    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const cube = this.cubes[i];
      const b = cube.body;
      const dx = b.position.x - cx;
      const dy = b.position.y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= BOMB_BLAST_R) {
        gone.push({ x: b.position.x, y: b.position.y });
        this.throwChunks(cube, now);
        removeConstraintsFor(this.phys.world, this.constraints, b);
        Matter.Composite.remove(this.phys.world, b);
        this.cubes.splice(i, 1);
        vaporized += 1;
      } else if (d <= shoveR) {
        const mag = BOMB_SHOVE_SPEED * (1 - d / shoveR);
        // A sleeping body ignores setVelocity (sleeping skips integration) —
        // wake it or the shove is silently lost on exactly the settled pile
        // the bomb was aimed at.
        Matter.Sleeping.set(b, false);
        Matter.Body.setVelocity(b, {
          x: b.velocity.x + (dx / d) * mag,
          y: b.velocity.y + (dy / d) * mag,
        });
      }
    }
    // Survivors above a vaporized cube got no shove (outside shoveR) and no
    // contact cue (their support just ceased to exist) — wake them so they
    // fall. See lineClear.ts's wakeNear note.
    for (const g of gone) wakeNear(this.cubes, g.x, g.y);

    Matter.Composite.remove(this.phys.world, bombBody);
    this.effects.push({ kind: "explosion", x: cx, y: cy, r: BOMB_BLAST_R, t0: now });
    this.events.onExplosion?.("bomb");

    if (vaporized > 0) {
      const refund = vaporized * this.level.salvagePerCube;
      this.score += refund;
      this.salvagedFunds += refund;
      // Scrap from salvage is deliberately stingy (a quarter of a line's rate
      // per cube) so demolition can't out-earn actually clearing lines as an
      // upgrade engine — it's a rescue valve, not an income strategy.
      this.scrapEarned += Math.floor((vaporized * this.level.scrapPerLine) / 4);
      this.effects.push({ kind: "salvage", x: cx, y: cy - 24, amount: refund, t0: now });
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
    Matter.Events.off(this.phys.engine, "collisionStart", this.onCollisionStart);
    Matter.World.clear(this.phys.world, false);
    Matter.Engine.clear(this.phys.engine);
  }
}
