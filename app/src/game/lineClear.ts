import Matter from "matter-js";
import { CELL, WORLD, WALL_INNER } from "./engine";
import { removeConstraintsFor, type Cube } from "./pieces";
import { MATERIAL_SPEC } from "./theme";
import type { Compactor } from "./compactor";
import type { LevelConfig } from "./level";

const SETTLE = 3.2; // px/step below which a cube counts as compacted/at rest
const SETTLE_SQ = SETTLE * SETTLE; // squared-speed compare avoids a sqrt per cube
const BLINK_MS = 1400;

/**
 * Alignment tolerances for the slot-based line-clear check below. These define
 * what "perfectly aligned" means — flush against the wall/floor/each other —
 * with a small allowance for physics-solver slop (contact jitter while under
 * compaction pressure), not for sloppy or overlapping piles. See updateLineClear.
 */
const X_TOL = 0.3 * CELL; // slot-center x tolerance (wall-anchored grid)
const Y_TOL = 0.3 * CELL; // row-center y tolerance (floor-anchored grid)
const ANGLE_TOL = 0.2; // radians (~11°) off the nearest axis-aligned angle

/**
 * "Compaction settling" tunables (see settleZoneCubes below). A real static
 * bar can wedge a tilted cube against the wall/neighbors and never square it
 * up on its own — the strict slot grid above would then never be reachable.
 * These let the press "vibro-compact" near-settled cubes onto the grid: a
 * slow angle grind squares up cubes already close to axis-aligned, and a slow
 * positional pull nudges cubes already close to a slot onto its center. Rates
 * are deliberately small per step so it reads as the press physically
 * grinding/nudging the pile flat, not a teleporting snap.
 */
const SETTLE_ROW_TOL = 0.45 * CELL; // vertical reach: how far from a row center the assist still applies
const SETTLE_X_MARGIN = CELL / 2; // assist only applies from (compactor face - this) rightward
const SETTLE_ANGLE_CAP = 0.65; // rad; only grind cubes already this close to axis-aligned
const ANGLE_RATE = 0.02; // rad/step (~0.6 rad/sec @ 60fps) — grinds, doesn't snap
const SETTLE_SLOT_TOL = 0.5 * CELL; // only pull cubes already this close to a slot center
const X_RATE = 0.5; // px/step positional pull toward the nearest slot center

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

/** How far around a removed cube neighbours get woken: far enough to catch
 *  everything that could have been RESTING on it (a diagonal touch is
 *  ~1.41 cells center-to-center), close enough that one clear doesn't rouse
 *  the whole pile. Anything further out reacts through normal contact
 *  propagation — matter wakes a sleeping body when an awake one moves
 *  against it; what it can never see is support vanishing without contact,
 *  which is exactly the case this radius exists for. */
export const WAKE_RADIUS = 1.75 * CELL;

/**
 * Wake every sleeping cube within `r` of (x, y). Sleeping bodies are skipped
 * by collision detection entirely (engine.ts's enableSleeping note), so any
 * code that deletes or teleports part of the pile must call this around the
 * disturbance — a sleeping cube whose support was removed otherwise hangs in
 * the air forever, asleep on top of nothing.
 */
export function wakeNear(cubes: Cube[], x: number, y: number, r = WAKE_RADIUS): void {
  const r2 = r * r;
  for (const c of cubes) {
    const b = c.body;
    if (!b.isSleeping) continue;
    const dx = b.position.x - x;
    const dy = b.position.y - y;
    if (dx * dx + dy * dy <= r2) Matter.Sleeping.set(b, false);
  }
}

/**
 * Can this cube ever fill a line slot RIGHT NOW? (theme.ts's Material.)
 *
 * The two reasons it can't are deliberately different in kind:
 *
 *  - Slag is permanently dead. No amount of play makes it count, so a row
 *    holding one is a row that must be demolished or shoved out. Nothing here
 *    is a timer — the player is never racing slag, only working around it.
 *  - Cold cryo is TEMPORARILY dead. Striking it makes it count. So the same
 *    rejection means "not yet" rather than "never", and the row it sits in is
 *    still winnable by acting on it.
 *
 * Exported because it is the single definition of "this cube is worth a slot",
 * and the tests assert against it directly rather than re-deriving the rule.
 */
export function fillsSlots(cube: Cube): boolean {
  const spec = MATERIAL_SPEC[cube.material];
  if (!spec.countsForLines) return false;
  return cube.struck;
}

/** Relative impact speed above which a strike thaws a cryo cube. Below the
 *  speed a launched shipment carries on arrival, and well above the jostling of
 *  a pile settling — thawing must be something the player DID, never something
 *  that happened to drift into place while they were aiming elsewhere. */
export const CRYO_STRIKE_SPEED = 6;

/**
 * Thaw a cryo cube that something hit hard enough. Called from the engine's
 * collisionStart handler (game.ts), which is the only place the relative speed
 * of an impact is actually known — a step later both bodies have exchanged
 * momentum and read as slow.
 *
 * Striking is deliberately NOT symmetric, and that asymmetry is the mechanic.
 * The cryo cube must already be AT REST and be hit by something fast; its own
 * arrival never counts. Without that condition cryo thaws itself on the landing
 * impact of the shot that delivered it, which was the first thing measured when
 * this shipped — every cryo cube arrived pre-thawed and the material did
 * nothing at all.
 *
 * With it, cryo costs a shipment: land it, then spend a second shot hitting it.
 * That is the sequencing the design asks for, and it is also what makes the
 * cold-press failure (shatterColdCryo) reachable — a player who ignores the
 * cube is the one who gets punished by it.
 */
export function strikeCryo(cubes: Cube[], a: Matter.Body, b: Matter.Body): void {
  const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
  if (rel < CRYO_STRIKE_SPEED) return;
  for (const cube of cubes) {
    if (cube.struck) continue;
    if (cube.body !== a && cube.body !== b) continue;
    // Settled = it is the target, not the projectile.
    const v = cube.body.velocity;
    if (v.x * v.x + v.y * v.y >= SETTLE_SQ) continue;
    cube.struck = true;
  }
}

/** Relative impact speed at which a VOLATILE cube goes off. Above cryo's strike
 *  threshold on purpose: the same landing that thaws ice must not be enough to
 *  set off a bomb, or volatile would detonate on essentially every touch and
 *  stop being a landing the player can control.
 *
 *  This was 9.5, which is BELOW the speed any launch can actually arrive at:
 *  measured over every angle/power the cannon can produce, first-contact
 *  relative speed runs 17.3 to 30.8, so every volatile shipment detonated on
 *  arrival and countsForLines was dead code. The lever is launch POWER, whose
 *  median impact runs 19.5 at power 0 to 25.5 at full — so 22 sits between the
 *  two halves of the dial: lob it and it survives (67% of launches), fire it
 *  hard and it goes off. Re-measure with sim/_volprobe.ts's method if the
 *  cannon's speedMax or gravity ever move, because this number is only
 *  meaningful relative to them. */
export const VOLATILE_TRIGGER_SPEED = 22;

/** How far a detonation reaches, in cells. One cell of clearance around the
 *  cube itself — volatile takes its NEIGHBOURS, not a crater. */
export const VOLATILE_BLAST_CELLS = 1.6;

/**
 * Which cubes a volatile impact destroys, if any.
 *
 * Returns the volatile cube plus everything inside its blast, or an empty array
 * when the impact was too soft to set it off. Pure — the caller removes the
 * bodies and spawns the FX, because the physics world and the effects list both
 * live on Game and this file deliberately touches neither.
 *
 * Volatile is the only material whose cost is paid by cubes that were ALREADY
 * safely down, which is what makes it scale with how full the bay is rather
 * than with the shipment itself. A soft landing is the answer — a low-power
 * lob, which lands around 19.5 against a hard shot's 25.5 — or deliberately
 * chaining it into a pile that was never going to complete a row anyway.
 *
 * NOT settleAssist, which this comment used to name: that only scales
 * settleZoneCubes' grind on cubes already at rest and does nothing to the speed
 * a shipment arrives at. Measured across Press Hydraulics tiers 0-3, minimum
 * impact speed moved 17.34 -> 17.56, i.e. not at all.
 */
export function volatileBlast(
  cubes: Cube[],
  a: Matter.Body,
  b: Matter.Body,
  /** Per-bay multiplier on the trigger speed (level.ts's volatileTriggerMult).
   *  1 = stock, and a bay that never writes it behaves byte-identically to
   *  before the knob existed. Below 1 the material is primed finer — see the
   *  field's doc for why this is a multiplier rather than an absolute speed. */
  triggerMult = 1,
): Cube[] {
  const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
  if (rel < VOLATILE_TRIGGER_SPEED * (triggerMult > 0 ? triggerMult : 1)) return [];
  const primed = cubes.find(
    (c) => (c.body === a || c.body === b) && MATERIAL_SPEC[c.material].detonates,
  );
  if (!primed) return [];
  const r = VOLATILE_BLAST_CELLS * CELL;
  const p = primed.body.position;
  return cubes.filter((c) => {
    if (c === primed) return true;
    const d = Math.hypot(c.body.position.x - p.x, c.body.position.y - p.y);
    return d <= r;
  });
}

/**
 * Weld a TAR cube to whatever it just touched.
 *
 * Returns the pairs that should become permanent joints. Tar is the deliberate
 * inverse of rebar: rebar is rigid and breakable, tar is the joint that cannot
 * be broken at all — not by stretch, and not by a Bond Breaker. Avoidance is
 * the real answer; Demolition is the expensive one, since vaporizing a cube
 * takes its welds with it.
 *
 * Only welds to a cube that has effectively stopped, so tar sticks to the PILE
 * rather than fusing mid-air with the shipment it was launched alongside.
 */
export function tarWelds(
  cubes: Cube[],
  a: Matter.Body,
  b: Matter.Body,
): Array<[Cube, Cube]> {
  const ca = cubes.find((c) => c.body === a);
  const cb = cubes.find((c) => c.body === b);
  if (!ca || !cb || ca === cb) return [];
  const sticky = MATERIAL_SPEC[ca.material].welds || MATERIAL_SPEC[cb.material].welds;
  if (!sticky) return [];
  const settled = (c: Cube): boolean => {
    const v = c.body.velocity;
    return v.x * v.x + v.y * v.y < SETTLE_SQ;
  };
  if (!settled(ca) && !settled(cb)) return [];
  return [[ca, cb]];
}

/**
 * Snap a MAGNETIC cube square once it has come to rest.
 *
 * The one material that HELPS, and the reason the vocabulary is not uniformly
 * hostile: it fills a slot you may not have wanted filled, but it squares the
 * row while doing it. Rotation is pulled to the nearest quarter turn and the
 * position onto the slot grid, which is exactly what lineClear's own candidate
 * test asks for (isAxisAligned + the slot walk) — so a magnetic cube is one
 * that has already done for itself what the press would otherwise have to
 * beat out of it.
 *
 * Mutates the bodies, because that is what Matter.Body.setAngle/setPosition do
 * and there is nothing to return.
 */
export function alignMagnetic(cubes: Cube[], floorY: number): void {
  for (const cube of cubes) {
    if (!MATERIAL_SPEC[cube.material].aligns) continue;
    const v = cube.body.velocity;
    if (v.x * v.x + v.y * v.y >= SETTLE_SQ) continue;
    if (Math.abs(cube.body.angularVelocity) >= 0.02) continue;
    const quarter = Math.PI / 2;
    const snappedAngle = Math.round(cube.body.angle / quarter) * quarter;
    if (Math.abs(snappedAngle - cube.body.angle) > 1e-4) {
      // Wake for the same reason settleZoneCubes does: a snap moves the body
      // without collision detection seeing it, so its neighbours must get the
      // chance to react. No-op on a cube that is already square (the usual
      // case after its one-time snap), so it can sleep like everything else.
      Matter.Sleeping.set(cube.body, false);
      Matter.Body.setAngle(cube.body, snappedAngle);
      Matter.Body.setAngularVelocity(cube.body, 0);
    }
    // Rows are indexed off the floor, so the vertical snap has to use the same
    // origin the line check does or a "squared" cube lands between two rows.
    const rel = floorY - cube.body.position.y;
    const row = Math.round(rel / CELL);
    const targetY = floorY - row * CELL;
    if (Math.abs(targetY - cube.body.position.y) > 0.5) {
      Matter.Sleeping.set(cube.body, false);
      Matter.Body.setPosition(cube.body, { x: cube.body.position.x, y: targetY });
      Matter.Body.setVelocity(cube.body, { x: 0, y: 0 });
    }
  }
}

export function resetLineClear(): void {
  /* no persistent state */
}

/** Normalize an angle (possibly negative, possibly many turns around) into [0, 2*PI). */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/** True if `angle` is within ANGLE_TOL of a multiple of PI/2 — the cube's
 *  edges are (near enough) parallel to the world axes, so it can sit flush. */
function isAxisAligned(angle: number): boolean {
  const a = normalizeAngle(angle);
  const d = Math.abs(a % (Math.PI / 2));
  return d < ANGLE_TOL || d > Math.PI / 2 - ANGLE_TOL;
}

/**
 * Shared face/zone-width/slot-count computation for both settleZoneCubes and
 * updateLineClear, so the settle assist always targets exactly the slots a
 * row would need to fill to clear. Returns null when the zone is narrower
 * than the minimum-line stop — shouldn't happen (the compactor's own right
 * stop is clamped there), but guarded defensively.
 */
function zoneGrid(
  compactor: Compactor,
  level: LevelConfig,
): { face: number; zoneW: number; needed: number } | null {
  const face = compactor.x + compactor.width / 2;
  const zoneW = WALL_INNER - face;
  if (zoneW < (level.compactorMinLineCells - 0.5) * CELL) return null;
  const needed = Math.max(level.compactorMinLineCells, Math.round(zoneW / CELL));
  return { face, zoneW, needed };
}

/**
 * Physically nudge near-settled cubes onto the wall/row slot grid while the
 * compactor is pressing. The strict clear rule in updateLineClear requires
 * cubes to be axis-aligned and sitting exactly at wall-anchored slot centers
 * — real physics alone can wedge a tilted cube (a 40px square can occupy up
 * to ~56px horizontally when tipped) against the wall or its neighbors,
 * propping the whole row out of grid alignment forever; a static bar can't
 * "un-tip" a jammed cube by pressing into it. This is the physical companion
 * to that strictness: for cubes that are already slow, near a floor-anchored
 * row, and within reach of the compactor face, it (a) grinds the angle slowly
 * toward the nearest axis-aligned orientation, and (b) pulls the position
 * slowly toward the nearest wall-anchored slot center — but only when the
 * cube is already close (within SETTLE_ANGLE_CAP / SETTLE_SLOT_TOL), so it
 * reads as the press grinding/compacting the pile flat rather than snapping
 * distant cubes into place. Velocity and Y are never touched; gravity still
 * owns Y. Safe to call every step while pressing — matter-js tolerates small
 * per-step kinematic corrections on near-resting bodies.
 */
export function settleZoneCubes(cubes: Cube[], compactor: Compactor, level: LevelConfig): void {
  const zone = zoneGrid(compactor, level);
  const face = zone ? zone.face : compactor.x + compactor.width / 2;
  const minX = face - SETTLE_X_MARGIN;
  // Press strength from the HYDRAULICS upgrade track (level.settleAssist, 1 =
  // stock — see upgrades.ts). It scales the RATES only, never the tolerances:
  // a refitted press grinds a near-aligned cube into its slot faster, but it
  // still can't reach out and snap a cube that was never close, so the
  // "grinds, doesn't teleport" feel survives every tier.
  const assist = level.settleAssist > 0 ? level.settleAssist : 1;
  const angleRate = ANGLE_RATE * assist;
  const xRate = X_RATE * assist;

  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    const b = cube.body;
    if (b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y >= SETTLE_SQ) continue;
    if (b.position.x <= minX) continue; // left of the compactor's reach — untouched

    // Nearest floor-anchored row center; skip cubes not near one, and skip
    // rows above the bar's physical reach (same bound updateLineClear uses) —
    // otherwise this would apply a phantom force to stacks the bar can never
    // actually touch.
    const r = Math.round((WORLD.height - CELL / 2 - b.position.y) / CELL);
    if (r < 0) continue;
    const rowY = WORLD.height - CELL / 2 - r * CELL;
    if (rowY < compactor.top) continue;
    if (Math.abs(b.position.y - rowY) > SETTLE_ROW_TOL) continue;

    // Angle grind: rotate slowly toward the nearest axis-aligned orientation.
    // Works on the raw (possibly multi-turn) angle so spins aren't lost.
    // A cube the grind is still CORRECTING is woken first: setAngle/setPosition
    // move a sleeping body without collision detection ever seeing it, so a
    // sleeping crooked cube would grind through its neighbours instead of
    // against them. A cube already on its slot takes no correction and is
    // left asleep — that is the steady state the whole sleeping change buys.
    const target = Math.round(b.angle / (Math.PI / 2)) * (Math.PI / 2);
    const angleDelta = target - b.angle;
    if (Math.abs(angleDelta) <= SETTLE_ANGLE_CAP && Math.abs(angleDelta) > 1e-4) {
      Matter.Sleeping.set(b, false);
      Matter.Body.setAngle(b, b.angle + clamp(angleDelta, angleRate));
    }

    // Slot pull: nudge slowly toward the nearest wall-anchored slot center,
    // found directly by index (nearest slot k) rather than scanning every slot.
    if (zone) {
      const k = Math.round((WALL_INNER - CELL / 2 - b.position.x) / CELL);
      if (k >= 0 && k < zone.needed) {
        const slotXk = WALL_INNER - CELL / 2 - k * CELL;
        const dx = slotXk - b.position.x;
        if (Math.abs(dx) <= SETTLE_SLOT_TOL && Math.abs(dx) > 0.5) {
          Matter.Sleeping.set(b, false);
          Matter.Body.setPosition(b, { x: b.position.x + clamp(dx, xRate), y: b.position.y });
        }
      }
    }
  }
}

/**
 * Clear only genuinely COMPACTED solid rows, using a strict SLOT-BASED grid
 * instead of counting/span/contiguity heuristics (those let sloppy, merely
 * overlapping piles double-count and clear "lines" that were never really
 * aligned, while genuinely overlapping stacks could stall forever).
 *
 * The compaction zone is divided into `needed` slots anchored at the wall
 * (slot k's center sits k cubes out from WALL_INNER) and rows anchored at the
 * floor (row r's center sits r cubes up from the floor) — real resting-position
 * grids, not derived by rounding a cube's own (possibly sloppy) position.
 *
 * A cube is a candidate to fill a slot only if it is settled (speed < SETTLE),
 * not blinking, and axis-aligned (a tipped cube can't sit flush). It fills row
 * r's slot k only if it's within Y_TOL of row r's center AND within X_TOL of
 * slot k's center. A row clears only when EVERY one of its `needed` slots has
 * exactly one cube in it — if two candidates land in the same slot (an
 * overlapping stack), that row is rejected for this frame; it isn't a clean
 * line yet, and continued compaction pressure will eventually square it up.
 *
 * Cubes are removed ONLY here (a broken joint never deletes a cube), and only
 * the exact slot-filling cubes of rows that actually clear — never hangers-on.
 */
export interface ClearResult {
  lines: number;
  /** Position + color snapshots of every removed cube, taken just before
   *  removal — render-side FX (shatter bursts, payout text) need where a
   *  cube WAS, and the body/cube are both gone by the time the caller sees this. */
  cubes: { x: number; y: number; color: string }[];
  /** Center Y of each cleared row, for a row-flash effect. */
  rows: number[];
}

export function updateLineClear(
  world: Matter.World,
  cubes: Cube[],
  compactor: Compactor,
  level: LevelConfig,
  constraints: Matter.Constraint[],
): ClearResult {
  // Zone narrower than the minimum-line stop shouldn't happen (the compactor's
  // own right stop is clamped there), but zoneGrid guards against it
  // defensively — the bar keeps ping-ponging between its stops, it never
  // teleports.
  const zone = zoneGrid(compactor, level);
  if (!zone) return { lines: 0, cubes: [], rows: [] };
  // Dynamic threshold: compactorMinLineCells cubes at full advance, growing
  // toward compactorOpenCells as the compactor opens back up and the zone widens.
  const { needed } = zone;

  // Candidate cubes: settled, not blinking, axis-aligned squares. (Being left
  // of the compactor face or outside every slot/row simply means a cube never
  // matches below — no separate zone filter needed.)
  const candidates: Cube[] = [];
  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    // Material gate. A rejected cube still physically OCCUPIES its space — it
    // just never fills the slot — so its row reads as holed below and cannot
    // clear until the cube is demolished, shoved out, or (for cryo) struck.
    // That is the whole mechanic: denial by occupancy, not by a new rule the
    // row-scan has to understand.
    if (!fillsSlots(cube)) continue;
    const b = cube.body;
    if (b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y >= SETTLE_SQ) continue;
    if (!isAxisAligned(b.angle)) continue;
    candidates.push(cube);
  }

  const toRemove = new Set<Cube>();
  const rows: number[] = [];
  const maxRow = Math.ceil(WORLD.height / CELL);

  for (let r = 0; r < maxRow; r++) {
    const rowY = WORLD.height - CELL / 2 - r * CELL;
    if (rowY < compactor.top) break; // above the bar's reach — stop scanning up

    const slots: (Cube | null)[] = new Array(needed).fill(null);
    let duplicate = false;

    for (const cube of candidates) {
      const b = cube.body;
      if (Math.abs(b.position.y - rowY) > Y_TOL) continue;
      // Direct index instead of a linear scan over every slot: slot spacing
      // (CELL) vs X_TOL guarantees at most one slot can ever match a cube.
      const k = Math.round((WALL_INNER - CELL / 2 - b.position.x) / CELL);
      if (k < 0 || k >= needed) continue;
      const slotXk = WALL_INNER - CELL / 2 - k * CELL;
      if (Math.abs(b.position.x - slotXk) > X_TOL) continue;
      if (slots[k] !== null) duplicate = true;
      else slots[k] = cube;
    }

    if (duplicate) continue; // overlapping stack contending for a slot — not clean
    if (slots.some((s) => s === null)) continue; // hole in the row

    for (const c of slots) toRemove.add(c!);
    rows.push(rowY);
  }

  const removedCubes: { x: number; y: number; color: string }[] = [];
  if (toRemove.size) {
    for (let i = cubes.length - 1; i >= 0; i--) {
      const cube = cubes[i];
      if (toRemove.has(cube)) {
        removedCubes.push({ x: cube.body.position.x, y: cube.body.position.y, color: cube.color });
        // A cleared cube may still be joined to a surviving piece-mate (e.g. a
        // domino straddling the row) — prune its constraints first, or the
        // joint dangles: pointing at a body no longer in the world.
        removeConstraintsFor(world, constraints, cube.body);
        Matter.Composite.remove(world, cube.body);
        cubes.splice(i, 1);
      }
    }
    // The rows above the cleared ones were resting on them — wake the
    // survivors around every removal so they fall, instead of sleeping on air.
    for (const r of removedCubes) wakeNear(cubes, r.x, r.y);
  }
  return { lines: rows.length, cubes: removedCubes, rows };
}

/** How close the bar's face must come to a cube's left edge to count as
 *  pressing it. Half a cell — the bar advances 1.2px/step at stock speed, so
 *  this cannot be missed between frames, and it is tight enough that a cube one
 *  slot further in is not "pressed" while its neighbour takes the hit. */
const PRESS_BAND = 0.5 * CELL;

/** Impulse (px/step) dealt to a shattered cryo cube's row-mates. Enough to lift
 *  them off their slot centers and force a re-settle, not enough to fling them
 *  clear of the zone — the punishment for pressing cold cryo is losing the
 *  ROW's alignment, not losing the cubes. */
const SHATTER_KICK = 4.5;

export interface CryoShatter {
  /** Where each shattered cube was, for the render-side burst. */
  cubes: { x: number; y: number; color: string }[];
  /** Center Y of each row that lost its alignment. */
  rows: number[];
}

/**
 * "Pressed cold it shatters the line" (docs/DESIGN.md's material table).
 *
 * A cryo cube that reaches the press still frozen does not compact — it breaks,
 * and the row it was part of is knocked off the slot grid with it. This is the
 * consequence half of cryo, and it is what makes the material about SEQUENCING
 * rather than about waiting: the cube is not merely inert until struck, it is
 * actively destructive if you build a row around it and let the bar arrive
 * first.
 *
 * The row-mates are given an impulse rather than being teleported off their
 * slots. Both would break the alignment the clear-check needs, but a kick lets
 * the physics resettle them into a genuinely new arrangement — which is
 * recoverable with more pressing — where a teleport would be the game moving
 * the player's pile for them, and could drop two cubes into one slot.
 *
 * Returns what shattered so the caller can play FX; it is a no-op returning
 * empty arrays on every bay that has no cryo in it, which is most of them.
 */
export function shatterColdCryo(
  world: Matter.World,
  cubes: Cube[],
  compactor: Compactor,
  constraints: Matter.Constraint[],
): CryoShatter {
  // Only the ADVANCING stroke shatters. On the retreat the bar is moving away
  // from the pile and touching nothing, so a cold cube resting against its face
  // would otherwise be "pressed" every step of the way back out.
  if (compactor.dir !== 1) return { cubes: [], rows: [] };

  const face = compactor.x + compactor.width / 2;
  const doomed: Cube[] = [];
  for (const cube of cubes) {
    if (cube.blinkStart !== null || cube.struck) continue;
    const b = cube.body;
    if (b.position.y < compactor.top) continue; // above the bar's reach
    if (Math.abs(b.position.x - CELL / 2 - face) > PRESS_BAND) continue;
    doomed.push(cube);
  }
  if (!doomed.length) return { cubes: [], rows: [] };

  const rows: number[] = [];
  const removed: { x: number; y: number; color: string }[] = [];
  for (const cube of doomed) {
    const rowY = cube.body.position.y;
    if (!rows.some((y) => Math.abs(y - rowY) <= Y_TOL)) rows.push(rowY);

    // Kick the row's settled neighbours off their slots. Only cubes to the
    // RIGHT are hit: those are the ones the shattering cube was bracing, and
    // hitting the whole row would also disturb cubes the bar has not reached.
    for (const other of cubes) {
      if (other === cube || other.blinkStart !== null) continue;
      const ob = other.body;
      if (Math.abs(ob.position.y - rowY) > Y_TOL) continue;
      if (ob.position.x <= cube.body.position.x) continue;
      // setVelocity alone leaves a sleeping body asleep (sleeping skips
      // integration entirely), so the kick must wake it or it does nothing.
      Matter.Sleeping.set(ob, false);
      Matter.Body.setVelocity(ob, {
        x: ob.velocity.x + SHATTER_KICK * 0.4,
        y: ob.velocity.y - SHATTER_KICK,
      });
    }
  }

  // Remove the shattered cubes themselves, with the same dangling-joint care
  // updateLineClear takes: a cryo cube can still be joined to a piece-mate.
  for (let i = cubes.length - 1; i >= 0; i--) {
    const cube = cubes[i];
    if (!doomed.includes(cube)) continue;
    removed.push({ x: cube.body.position.x, y: cube.body.position.y, color: cube.color });
    removeConstraintsFor(world, constraints, cube.body);
    Matter.Composite.remove(world, cube.body);
    cubes.splice(i, 1);
  }
  // Same reasoning as updateLineClear's post-removal wake: whatever sat on a
  // shattered cube must fall, and the kick above only reached its row-mates.
  for (const r of removed) wakeNear(cubes, r.x, r.y);

  return { cubes: removed, rows };
}

/**
 * Penalty path (ports main.py's check_pieces_on_left_side): settled cubes the
 * compactor bar can NEVER reach decay for a point penalty, instead of sitting
 * as unreachable dead weight forever. The cutoff is derived from the bar
 * itself: compactor.leftX is its body-center at the fully-retreated (open)
 * stop, so even a cube flush against the bar's face there (center = leftX +
 * width/2 - CELL/2) sits at the closest-to-the-launcher position the zone
 * will ever reach — the bar's face never gets any further left than that.
 * Anything left of this cutoff can never be compacted or counted for a line;
 * cubes shattered at the bar or compacted against the wall are never touched
 * here.
 */
export function markLostPieces(cubes: Cube[], compactor: Compactor, now: number): void {
  const cutoff = compactor.leftX + compactor.width / 2 - CELL / 2;
  for (const c of cubes) {
    const b = c.body;
    if (c.blinkStart !== null) {
      // RESCUED: the mark used to be a one-way latch, but a blinking cube
      // keeps full physics for its whole 1.4s blink — a breaking piece, a
      // neighbour's shove or the bar dragging a rider can carry it back into
      // the compactor's reach, and decaying it THERE fined the player for
      // cargo that was visibly back in play (seen on device, 2026-08-09: a
      // shattered tetromino tumbled into the bay and one cube blinked out
      // mid-pile, "−$" toast and all). The rule is "cubes the bar can NEVER
      // reach decay", so it has to keep reading the cube's position for as
      // long as the sentence is pending, not just at the moment of marking.
      // Re-stranded cubes get re-marked with a fresh blink — more grace, in
      // the player's favor, and the un-mark is what snaps the cube back to
      // its true color so a rescue is visible the moment it happens.
      if (b.position.x >= cutoff) c.blinkStart = null;
      continue;
    }
    if (
      b.position.x < cutoff &&
      Math.abs(b.velocity.x) < SETTLE &&
      Math.abs(b.velocity.y) < SETTLE
    ) {
      c.blinkStart = now;
    }
  }
}

/** Remove blinking (bounced-out) cubes after the blink duration. Returns the
 *  removed cubes' last positions — the count for the penalty arithmetic, the
 *  coordinates for the penalty FX, which has to spawn where the cubes actually
 *  vanished or the "−$" reads as noise rather than a consequence. */
export function updateBlinking(
  world: Matter.World,
  cubes: Cube[],
  now: number,
  constraints: Matter.Constraint[],
): { x: number; y: number }[] {
  const lost: { x: number; y: number }[] = [];
  for (let i = cubes.length - 1; i >= 0; i--) {
    const c = cubes[i];
    if (c.blinkStart !== null && now - c.blinkStart > BLINK_MS) {
      // Same dangling-joint hazard as updateLineClear: a joined cube may
      // blink out alone while its piece-mate stays behind.
      removeConstraintsFor(world, constraints, c.body);
      Matter.Composite.remove(world, c.body);
      cubes.splice(i, 1);
      lost.push({ x: c.body.position.x, y: c.body.position.y });
    }
  }
  // Lost cubes decay in stacks (markLostPieces marks whole settled clumps) —
  // wake what each removal un-supported so the rest of the clump keeps
  // settling toward the floor rather than freezing mid-air.
  for (const p of lost) wakeNear(cubes, p.x, p.y);
  return lost;
}

export function blinkVisible(cube: Cube, now: number): boolean {
  if (cube.blinkStart === null) return true;
  return Math.floor((now - cube.blinkStart) / 160) % 2 === 0;
}
