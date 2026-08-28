import Matter from "matter-js";
import { CELL, WORLD, WALL_INNER } from "./engine";
import { removeConstraintsFor, type Cube } from "./pieces";
import { MATERIAL_SPEC } from "./theme";
import type { Compactor } from "./compactor";
import type { LevelConfig } from "./level";
import {
  awardedGrade, gradeForRow,
  type ClearClock, type ClearContext, type ClearGrade, type LandingStamp,
  type RowParticipation,
} from "./grades";

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

/**
 * THE RIGID SHIPMENT'S SHARE OF THE PRESS'S GRIND.
 *
 * A rigid material's card (hazards.ts's Rebar Contract) sells one cost and one
 * only: *"what lands is what you keep"* — theme.ts spells it out as **"a bad
 * landing cannot be squeezed, shoved or shattered into a better one, and the row
 * has to be built around it."** Two of those three verbs were already true.
 * `pieces.ts` gives the joints an Infinity break stretch so nothing SHATTERS
 * them, and `breakJointsInBand` exempts them so the press cannot shatter them
 * either — but `settleZoneCubes` went right on SQUEEZING and SHOVING them, at
 * full strength, because it reads cubes and never asked what was holding them
 * together.
 *
 * Worse than merely not costing anything: it made rigid cargo *better* than
 * ordinary cargo. A shipment whose joints will not break is a four-cube stamp
 * whose cubes sit at exact CELL spacing forever, so every cube in it carries the
 * same correction and the press grinds the whole piece onto the slot grid in one
 * coherent motion. An ordinary shipment shatters on landing and each loose cube
 * has to find its own slot. Measured at Tier 8 bay 10 on the material rig, a
 * belt one third rebar cleared MORE lines in FEWER shots than a clean belt (see
 * design/balance/winnability-sweep-findings.md §8). "A notch is pure cost" is
 * hazards.ts's founding rule, and rebar was breaking it exactly the way volatile
 * was before `VOLATILE_LOSS_SHARE`.
 *
 * So the press's assist reaches a still-bonded rigid shipment at this fraction
 * of its strength. Not zero, deliberately: a cube the press can never square is
 * a lose button rather than a difficulty knob (hazards.ts's floor argument), and
 * the honest reading of a hydraulic press against a welded cage is that it
 * *works* — slowly, over several strokes, buying its row in press time and
 * launches instead of getting it for free.
 *
 * The exit is the one theme.ts already promises: *"The answer is the Bond
 * Emitter: a Bond Breaker charge is the one thing that splits it."* A charge
 * removes the joints, and the moment they are gone these cubes are loose cubes
 * and grind at full rate. Before this the emitter's only job on a rebar belt was
 * slumping the pile; now it is the difference between a rebar row that squares
 * up and one that does not.
 *
 * Gated on the MATERIAL rather than on `breakStretch === Infinity`, which is the
 * same test `breakJointsInBand` uses. That test would also catch every joint on
 * an unbreakable-bonds bay (finals.ts's clause, level.ts's `breakStretch`), and
 * quietly re-pricing a Final Inspection clause while re-pricing a material is
 * the collateral this change is specifically avoiding.
 */
export const RIGID_SETTLE_ASSIST = 0.3;

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

/** A bay with no Impact Cushion aboard: no liner, no softening. Passed by every
 *  caller that does not have a rig, so the positional branch below is exercised
 *  identically whether or not the track exists. */
export const NO_CUSHION: CushionSpec = { cells: 0, mult: 1 };

/** The Impact Cushion as the collision side sees it: a liner `cells` deep
 *  measured from the wall, softening arrivals inside it by `mult`. */
export interface CushionSpec {
  /** Depth of the liner from WALL_INNER, in cells. 0 = no liner. */
  cells: number;
  /** Multiplier on the trigger speed for cargo landing inside it. 1 = none. */
  mult: number;
}

/**
 * Which body of a colliding pair ARRIVED — the one that carried the impact in,
 * rather than the one that stood there and took it. Null when neither did: two
 * cubes of a settling pile touching as it grinds flat.
 *
 * strikeCryo's rule read the other way round, and its one-line comment is the
 * whole idea: "Settled = it is the target, not the projectile." Cryo must be at
 * rest to count as struck, so the arriving body is the one that is NOT at rest
 * — and, where a churning pile has both of them moving, the faster of the two,
 * because a landing is asymmetric even when nothing in it is still.
 *
 * Speed rather than a flag on the cube, because the physics world is the only
 * thing that knows: a cube a blast threw across the bay is arriving at whatever
 * it lands on next exactly as much as a fresh shipment is, and nothing marked
 * it as launched.
 */
export function arrivingBody(a: Matter.Body, b: Matter.Body): Matter.Body | null {
  const aSq = a.velocity.x * a.velocity.x + a.velocity.y * a.velocity.y;
  const bSq = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y;
  if (Math.max(aSq, bSq) <= SETTLE_SQ) return null;
  return aSq >= bSq ? a : b;
}

/**
 * The x a cushion liner's near edge sits at — the boundary cargo is softened
 * ACROSS.
 *
 * Lives here rather than at each of its two readers for exactly the reason
 * Compactor.strandCutoffX does, and that note says it best: the readers "all
 * have to agree on it exactly", because "a warning drawn against one number and
 * a penalty charged against another is a game lying about its own rules". This
 * one has two readers and they are the two halves of that sentence —
 * volatileBlast decides whether an impact was softened, and render.ts's
 * drawCushion draws the line the player aims against.
 */
export function cushionEdgeX(cells: number): number {
  return WALL_INNER - cells * CELL;
}

/**
 * The trigger multiplier one arrival actually meets.
 *
 * Two independent things write it and they compose by multiplication, which is
 * the arithmetic softening a blow and raising a threshold already share: the
 * comparison is `rel < VOLATILE_TRIGGER_SPEED * mult`, so a liner that takes
 * 30% off an impact and a liner that lifts the threshold 30% are the same
 * statement. `clauseMult` is finals.ts's Hair Trigger, field-wide and below 1;
 * `cushionMult` is the rig's liner, positional and above 1.
 *
 * THE FLOOR IS THE WHOLE REASON THIS IS A FUNCTION. A clause is an exam: the
 * Tier-7 pair is what a Tier-7 rig is asked to answer, and Hair Trigger asks it
 * by priming volatile finer than stock. A cushion should be able to SIT that
 * exam — buy the bay back up to an ordinary one, which is a real purchase and
 * exactly the trade the clause is offering — but a maxed cushion multiplies
 * 0.85 by 1.40 and lands at 1.19, walking past the exam into a bay *safer than
 * one with no clause at all*. The proposal that specified this system found the
 * overshoot in its own prototype and called the arithmetic unavoidable, because
 * it is: any cushion that reaches its stated job (30.8/22 = 1.40, no arrival
 * detonates) clears 1/0.85 = 1.176 on the way there.
 *
 * So the fix goes on the clause side, as a FLOOR rather than a re-sizing:
 * where something has primed the bay finer than stock, a cushion may lift it
 * back to stock and no further. Under Hair Trigger a maxed cushion is worth
 * exactly the clause — 0.85 → 1.00 — and the bay is ordinary, never gentle.
 * Written as a rule about any sub-stock multiplier rather than about Hair
 * Trigger by name, so a second clause that primes volatile inherits it.
 */
export function cushionedTrigger(clauseMult: number, cushionMult: number): number {
  const clause = clauseMult > 0 ? clauseMult : 1;
  const combined = clause * (cushionMult > 0 ? cushionMult : 1);
  return clause < 1 ? Math.min(1, combined) : combined;
}

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
  /** The rig's liner (level.ts's cushionCells / cushionMult). Defaults to none,
   *  so every existing caller keeps the field-wide behaviour it had. */
  cushion: CushionSpec = NO_CUSHION,
): Cube[] {
  // WHICH CUBE, BEFORE HOW FAST — the order is load-bearing now and was not
  // before. The threshold this impact has to clear depends on WHERE the
  // volatile cube is, so the speed test cannot be made until the primed cube is
  // known. A pair with nothing volatile in it still costs one find() and
  // leaves, exactly as it did when the speed test came first.
  const primed = cubes.find(
    (c) => (c.body === a || c.body === b) && MATERIAL_SPEC[c.material].detonates,
  );
  if (!primed) return [];
  // Inside the liner or outside it, measured on the volatile cube that ARRIVED
  // — which is `primed` itself for every impact that has one moving body, and
  // is only a different cube when a volatile shipment comes down on a volatile
  // cube already lying there. A hard edge rather than a ramp: the player has to
  // be able to look at the bay and know whether a slot is lined, and a soft
  // falloff would make the same shot detonate or not for reasons nothing on
  // screen explains.
  //
  // AND IT IS A LANDING THAT IS INSURED, NOT A CUBE. The liner is bedding a
  // volatile shipment comes down ON — upgrades.ts sells exactly that ("the deep
  // slots it lines are where volatile lands without going off") and ECONOMY.md
  // spells out the other half ("a cube still goes off when something lands hard
  // on top of it"). Ask this of `primed` alone and the second sentence is false
  // in the code: a volatile cube AT REST in a lined slot reads its own position
  // and softens an impact it played no part in, so ordinary cargo could be
  // dropped on a bomb at full power and the bomb would sit there. A maxed liner
  // would then make the material inert everywhere it lies deep, which is the
  // one thing hazards.ts forbids outright — "a system does not DELETE a
  // hazard". A landing happens once; this is the insurance on it.
  const arriving = arrivingBody(a, b);
  const landing = primed.body === arriving
    ? primed
    : cubes.find((c) => c.body === arriving && MATERIAL_SPEC[c.material].detonates);
  const lined = cushion.cells > 0
    && landing !== undefined
    && landing.body.position.x >= cushionEdgeX(cushion.cells);
  const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
  if (rel < VOLATILE_TRIGGER_SPEED * cushionedTrigger(triggerMult, lined ? cushion.mult : 1)) {
    return [];
  }
  const r = VOLATILE_BLAST_CELLS * CELL;
  const p = primed.body.position;
  return cubes.filter((c) => {
    if (c === primed) return true;
    const d = Math.hypot(c.body.position.x - p.x, c.body.position.y - p.y);
    return d <= r;
  });
}

/**
 * What a volatile detonation earns for the DEAD CARGO it removed.
 *
 * The licence for this payout is narrow and worth restating, because
 * Game.resolveVolatile refuses the obvious version right next to where it calls
 * this: a detonation as such pays nothing, since paying for one would make
 * ratcheting the volatile axis an income strategy — the exact inversion of a
 * hazard. This is not that. It pays for cubes that could NEVER have completed a
 * row, and it only exists at all for a player who ratcheted a second axis to
 * put them on the belt. Live cargo a hazard obliterated is still a pure loss.
 *
 * The test is `countsForLines`, not `material === "slag"`, because that flag IS
 * the design argument: a cube worth $0 as line material for the whole of its
 * life is worth removing, and one that was merely inconvenient is not. Slag is
 * the only material that reads false today; a future one that does inherits the
 * bounty, which is the intended reading rather than an accident.
 *
 * Deliberately funds-only — no scrap. Funds are the bay's operating budget and
 * this is a bay-local relief valve; paying scrap would feed the SHIP, making a
 * slag ratchet a route to permanent progression. That is a far larger claim
 * than "dead weight is worth clearing".
 */
export function slagBountyFor(destroyed: Cube[], perCube: number): number {
  let n = 0;
  for (const cube of destroyed) {
    if (!MATERIAL_SPEC[cube.material].countsForLines) n += 1;
  }
  return n * perCube;
}

/**
 * What a VOLATILE detonation costs the bay for the LIVE cargo it obliterated.
 *
 * The exact mirror of slagBountyFor above, and the two are one rule read in
 * both directions: **pay for the dead, charge for the live.** Same test, same
 * unit, same funds-only stance — `countsForLines`, per cube, the bay's
 * operating budget and never scrap.
 *
 * WHY THIS EXISTS, measured. slagBountyFor's own note already states the
 * design's intent in one line — "Live cargo a hazard obliterated is still a
 * pure loss" — and until now that sentence was true of the fiction and false of
 * the economy. Nothing was billed. A detonation deleted cargo the player had
 * paid to launch and the ledger did not notice.
 *
 * That is not a rounding error, because deleting cargo is worth something: it
 * THINS THE PILE. Measured on the winnability harness at Tier 7 bay 10 over 16
 * paired seeds, a belt at the volatile cap ran a mean pile of 20.2 cubes
 * against a clean bay's 31.4, and won 16/16 where clean won 14/16 — a hazard
 * notch that made the bay easier. hazards.ts states the contract it broke in
 * the plainest words in that file: "It is mandatory and unrewarded. […] A notch
 * is pure cost."
 *
 * So the charge is deliberately PROPORTIONAL TO THE RELIEF. A detonation in an
 * empty bay catches nothing and costs nothing; one in a packed pile catches the
 * most cargo, gives the most relief, and is billed the most. That inversion is
 * the whole fix — it prices the benefit rather than suppressing the event, so
 * volatile keeps its character (a hazard that goes off when you land hard, and
 * whose cost lands on cubes that were already down) and stops being a bargain.
 *
 * NOT a second lever on how OFTEN it goes off. lineClear.ts's
 * VOLATILE_TRIGGER_SPEED note sizes 22 against a measured arrival range and
 * says why it sits "between the two halves of the dial"; moving it would make
 * detonations MORE frequent, which — given the measurement above — amplifies
 * the benefit while adding an unrelated cost, and would silently re-price both
 * finals.ts's Hair Trigger and anything else reading volatileTriggerMult. One
 * knob, aimed at the thing that was actually wrong.
 */
export function volatileLossFor(
  destroyed: Cube[],
  perCube: number,
  /** The share of THIS cube's charge the Incinerator remits, 0..1 — read from
   *  the cube's position at the moment the blast razed it (game.ts's
   *  resolveVolatile calls this with the bodies still holding their last
   *  position). Defaults to none, so every existing caller and every bay with
   *  no hood aboard prices a blast byte-identically to before the track
   *  existed.
   *
   *  PER CUBE, and that is a rule rather than a convenience. A blast can
   *  straddle the flue plane — one cube caught in the air over the machine,
   *  three down in the pile — and pricing the whole blast off its centroid
   *  would let a single high cube buy the discount for everything under it,
   *  which is the opposite of what a positional system is for. */
  relief: (cube: Cube) => number = () => 0,
): number {
  let owed = 0;
  for (const cube of destroyed) {
    if (!MATERIAL_SPEC[cube.material].countsForLines) continue;
    owed += chargeAfterRelief(perCube, relief(cube));
  }
  return owed;
}

/**
 * One cube's loss charge after the Incinerator has taken its share.
 *
 * The single place the relief arithmetic happens, shared by both bills the hood
 * discounts (this file's volatile charge and game.ts's spill fine), so the two
 * can never round a quarter differently. Rounded per CUBE rather than on a
 * batch total for the same reason the relief is applied per cube: a batch that
 * straddles the flue has to be priced a cube at a time, and once it is, the
 * batch total is just their sum.
 *
 * Clamped both ends. A relief above 1 would PAY the player for losing cargo,
 * which is the income-strategy inversion `slagBountyFor` refuses in the
 * neighbouring note; a negative one would surcharge it. Neither is a state the
 * ladder can produce today — INCINERATOR_TIERS stops at 0.75 — and the clamp is
 * here so that stays true of a saved loadout somebody hand-edited.
 */
export function chargeAfterRelief(perCube: number, relief: number): number {
  const r = Math.max(0, Math.min(1, relief));
  return Math.round(perCube * (1 - r));
}

/**
 * What a relief actually SAVED the bay — the difference between the two charges
 * after each has met the same clamp.
 *
 * THE DISTINCTION THIS EXISTS FOR, found in review (codex, PR #156). The
 * discount is applied BEFORE the clamp, and settleBlast's own note argues at
 * length why it must be: after the clamp it would remit money that never moved,
 * and would be worth nothing to the near-broke player the hood was asked for.
 * That is the right rule for what the bay is CHARGED, and the ledger then
 * quietly inherited it for what the bay SAVED — which is a different question
 * with a different answer.
 *
 * The case that separates them: a bay holding $10 meets a $40 gross fine, and a
 * maxed hood cuts it to $10. Both bays lose the same $10 — the clamp was going
 * to take everything either way — so the hood saved NOTHING, and the readout
 * was reporting $30. Scaling the nominal discount by the share of the bill that
 * landed (the old `saved * deducted / owed`) is exactly wrong here, because the
 * discounted bill landed in FULL while the gross one would not have.
 *
 * So: clamp both, independently, and subtract. `ceiling` is whatever the caller's
 * clamp is measured against — the bankroll for a spill fine, the bankroll plus
 * the blast's own bounty for a detonation — and passing it in is what keeps this
 * one rule usable by both bills without either re-deriving the other's clamp.
 *
 * Never negative by construction: min() is monotone and `discounted <= gross`
 * whenever the relief is in range (chargeAfterRelief clamps it there).
 */
export function reliefRealised(ceiling: number, gross: number, discounted: number): number {
  return Math.min(ceiling, gross) - Math.min(ceiling, discounted);
}

/**
 * The same rule for a DETONATION: what the hood saved is the difference between
 * what the same blast actually charged with and without it.
 *
 * A named function rather than a subtraction at the call site, because it is the
 * one place the blast path can be pinned. It takes two SETTLEMENTS rather than
 * two bills and a ceiling, and that is the whole reason it is not
 * `reliefRealised` with different arguments: a blast's clamp is measured against
 * `funds + bounty` (settleBlast's netting rule), so re-deriving the ceiling
 * anywhere outside settleBlast would be a second copy of the formula most likely
 * to move. Handed two settlements of the same blast at the same funds, the
 * ceiling is identical by construction and cancels — this IS `reliefRealised`,
 * evaluated by the function that owns the clamp.
 */
export function blastRelief(bare: BlastSettlement, hooded: BlastSettlement): number {
  return bare.charged - hooded.charged;
}

/** What one detonation actually moves on the bay's ledger. */
export interface BlastSettlement {
  /** Paid for the dead cargo — the gross figure, before anything is taken. */
  bounty: number;
  /** Taken for the live cargo, AFTER the balance clamp. May be under `owed`. */
  charged: number;
  /** What `owed` would have been with unlimited funds. `charged` ≤ this. */
  owed: number;
  /** The single number to add to the bay's funds: `bounty - charged`. */
  net: number;
}

/**
 * Settle ONE detonation against the bay's funds — the dead cargo's payout and
 * the live cargo's charge, netted, in a single statement.
 *
 * IT HAS TO BE ONE STATEMENT, and it is worth saying why, because the obvious
 * version reads correctly and is not. Charging first and crediting afterwards
 * clamps the charge against the balance *as it stood*, so a bay at $0 could
 * take a blast that killed one standard cube and one slag cube, pay nothing —
 * there was nothing to clamp against — and then collect the bounty in full. The
 * near-broke player, which is precisely the player the charge is aimed at, got
 * the relief for free and stepped around the broke path the clamp exists to
 * route them into. Netting first closes it: the charge comes out of the bounty
 * before either reaches the balance.
 *
 * The clamp itself stays, for the reason the spill fine has one (see
 * Game.loseCubes): the bay's funds are its operating budget, a hazard may empty
 * it, and a negative bankroll is not a state this economy has. Going broke is
 * already a loss condition with a grace window attached, and that is the route
 * a player who genuinely cannot pay should take.
 */
export function settleBlast(
  destroyed: Cube[],
  funds: number,
  perLiveCube: number,
  perDeadCube: number,
  /** The Incinerator's per-cube relief (see volatileLossFor). */
  relief: (cube: Cube) => number = () => 0,
): BlastSettlement {
  const bounty = slagBountyFor(destroyed, perDeadCube);
  // THE HOOD TOUCHES THE CHARGE AND ONLY THE CHARGE, and it does it HERE —
  // before the netting, before the clamp. Three rulings in one line, each of
  // which the obvious alternative gets wrong:
  //
  //  - Not the BOUNTY. That is payment for dead cargo, and a hood that raised
  //    it would make burning slag a way to earn — the exact income strategy
  //    slagBountyFor's note refuses ("paying for one would make ratcheting the
  //    volatile axis an income strategy").
  //  - Before the NETTING, because this function's whole argument is that the
  //    charge must meet the bounty before either reaches the balance. Relief
  //    applied to `net` afterwards would silently discount the bounty too, and
  //    on a mixed blast that is a different number.
  //  - Before the CLAMP, because the clamp forgives what the player cannot pay.
  //    Discounting after it would remit money that never moved — the same lie
  //    the "−$" toast refuses to print — and would make the hood worth nothing
  //    at all to the near-broke player, who is the one it was asked for.
  const owed = volatileLossFor(destroyed, perLiveCube, relief);
  const charged = Math.min(funds + bounty, owed);
  return { bounty, charged, owed, net: bounty - charged };
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

/**
 * Stamp every cube that has just come to rest for the first time with the
 * compactor's clock — the landing half of the timing grade (grades.ts).
 *
 * IT LIVES HERE, beside `updateLineClear`, because it has to use the SAME
 * definition of "at rest" the row scan does. That threshold is `SETTLE`, it is
 * private to this file, and a copy of it anywhere else is a copy free to drift:
 * a stamping pass that called a cube settled a frame before the row scan did
 * would hand out landings for cargo the clear check had already refused, and
 * one that lagged behind would grade a row against a landing that had not
 * happened yet. game.ts's own `isAtRest` (2.5 px/step) is a DIFFERENT question
 * asked for the broke-loss and topout checks, and using it here would have been
 * exactly that drift.
 *
 * FIRST REST ONLY — the `!== undefined` guard is the whole mechanic, not an
 * optimisation. See `Cube.landedStroke`: cargo knocked loose and re-settled
 * keeps its original landing, so a stale pile's clock cannot be reset by
 * disturbing it.
 *
 * Called once per step, BEFORE the clear check, so every cube the row scan can
 * accept is already stamped and `gradeForRow`'s null branch is unreachable in
 * play.
 */
export function stampLandings(cubes: Cube[], clock: ClearClock): void {
  for (const cube of cubes) {
    if (cube.landedStroke !== undefined) continue;
    const v = cube.body.velocity;
    if (v.x * v.x + v.y * v.y >= SETTLE_SQ) continue;
    cube.landedStroke = clock.stroke;
    cube.landedHalfCycle = clock.halfCycle;
    // ...and the fixed step, which is what the EXCELLENT window is measured in.
    // From the SAME sampled clock the other two come from, so the difference the
    // grade takes is exact by construction — there is no second reading of the
    // step counter anywhere in a step, and therefore no fencepost of the kind
    // §2c found in the bar's counters.
    cube.landedStep = clock.step;
  }
}

/** A cube's landing as the grade reads it, or null while it has never rested.
 *  Exported so the sim can assert against the stamp a cube actually carries
 *  rather than re-deriving the pair from two optional fields. */
export function landingOf(cube: Cube): LandingStamp | null {
  return cube.landedStroke === undefined || cube.landedHalfCycle === undefined
    || cube.landedStep === undefined
    ? null
    : {
      stroke: cube.landedStroke,
      halfCycle: cube.landedHalfCycle,
      step: cube.landedStep,
    };
}

/**
 * The NEWEST landing among the cubes that filled one row — the landing that
 * actually closed it, which is what the grade is a grade OF.
 *
 * "Newest" is measured on `halfCycle` alone, and it is the right key precisely
 * because it is the finer of the two: it advances at both stops where `stroke`
 * advances at one, so two cubes that landed in the same round trip but on
 * opposite sides of the turn are ordered correctly, where a stroke comparison
 * would call them equal and pick whichever the row scan happened to walk first.
 * Order-independence matters here — the slot array is filled by walking the
 * candidate list, and a grade that depended on that walk would depend on cube
 * spawn order.
 *
 * Null only when NO cube in the row has ever rested, which the row scan makes
 * unreachable; `gradeForRow` still handles it, conservatively.
 */
export function newestLanding(row: readonly Cube[]): LandingStamp | null {
  let best: LandingStamp | null = null;
  for (const cube of row) {
    const stamp = landingOf(cube);
    if (!stamp) continue;
    if (!best || stamp.halfCycle > best.halfCycle) best = stamp;
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * PARTICIPATION — was this row the player's shot, or one the press found?
 *
 * grades.ts's `RowParticipation` states the rule; this is what measures it, and
 * the two constants below are the whole of the IMPACT-ASSIST branch's honesty
 * budget, so they are named and derived rather than inlined.
 * ------------------------------------------------------------------------ */

/** How far off a row cube's column an assisting shipment cube may sit and still
 *  count as resting ON it. 0.6 of a cell: wider than X_TOL (the slot grid's own
 *  tolerance, 0.3) so a cube that is squarely on top of a slot still qualifies
 *  after the grind has nudged the row, and narrower than a full cell so a cube
 *  over the NEXT column along is never mistaken for weight on this one. */
export const IMPACT_ASSIST_X_TOL = 0.6 * CELL;

/** The vertical band a cube must sit in to be "directly on top of" a row cube:
 *  between half a cell and one and a half above it. One cell is contact; the
 *  half-cell either side is the same slop the row scan's own Y_TOL allows
 *  twice over, which is what a pile still settling under an impact looks like.
 *  Anything higher is a cube resting on something ELSE that happens to be above
 *  the row, and that is not weight this row felt. */
export const IMPACT_ASSIST_Y_MIN = 0.5 * CELL;
export const IMPACT_ASSIST_Y_MAX = 1.5 * CELL;

/**
 * How the LATEST shipment took part in one cleared row.
 *
 * `"in-row"` is the plain reading of the owner's rule and needs no defence: a
 * cube of the shipment fills one of the row's slots.
 *
 * `"impact"` is the case he asked for by name — the shipment landed ABOVE the
 * row and the row closed anyway — and it is the one branch here that claims
 * less than it looks like it does. **It is not a causal test and cannot be
 * one.** matter-js has no counterfactual: nothing in the engine can answer
 * "would this row have closed had the shipment not landed on it", because the
 * only way to ask is to run the step twice with different worlds, and a physics
 * step is not reversible. What IS decidable, and what this measures, is the
 * CONFIGURATION plus the TIMING:
 *
 *   - a cube of the current shipment is resting directly over one of the row's
 *     slot cubes (the two constants above), and
 *   - it has come to rest — an unstamped cube is still arriving and its weight
 *     is not yet on anything, and
 *   - the row's own clock band is whatever it is: this gate never PROMOTES a
 *     row, it only declines to cap one.
 *
 * The residual false positive is a shipment dropped onto a row that was going
 * to close on that exact tick anyway. That is a coincidence of precisely the
 * tightness the EXCELLENT band already demands of every other row it pays, so
 * admitting it costs the ladder nothing it was not already paying — and the
 * alternative (refusing the branch) throws away the play the owner singled out
 * as the best thing the mechanic does. design/balance/timed-clears.md §2g
 * carries the rejected detectors and why each one was worse.
 *
 * `shipment` of 0 — a bay that has not launched yet — matches no cube, so the
 * answer is `"none"` and the opening pile cannot sell a premium.
 */
export interface RowClaim {
  participation: RowParticipation;
  /** The IMPACT-ASSISTING shipment cube's landing — the newest one over the
   *  row — or null when nothing was resting on it.
   *
   *  This is the half the 100ms window needs. The row's own cubes are stale by
   *  construction in the assist case (they had already settled; the shipment is
   *  what came down on them), so measuring the window from their landings would
   *  make the owner's slam permanently ineligible for the band it was described
   *  as deserving. The landing that CLOSED the row is the one that arrived, and
   *  `updateLineClear` takes the newer of the two. */
  assist: LandingStamp | null;
}

export function rowClaim(
  row: readonly Cube[],
  all: readonly Cube[],
  shipment: number,
): RowClaim {
  if (!shipment) return { participation: "none", assist: null };
  for (const cube of row) {
    if (cube.shipment === shipment) return { participation: "in-row", assist: null };
  }
  // IMPACT ASSIST. Walked over the whole field rather than over the row,
  // obviously — the assisting cube is by definition NOT in the row. The NEWEST
  // qualifying landing wins, on `halfCycle` for `newestLanding`'s reason.
  let assist: LandingStamp | null = null;
  for (const cube of all) {
    if (cube.shipment !== shipment) continue;
    if (cube.blinkStart !== null) continue;
    // Still arriving: its weight is not on anything yet. `landedStroke` is the
    // grade's own definition of "has come to rest" (stampLandings), reused here
    // rather than re-tested against SETTLE_SQ so the two can never drift.
    const stamp = landingOf(cube);
    if (!stamp) continue;
    const p = cube.body.position;
    for (const under of row) {
      const q = under.body.position;
      const dy = q.y - p.y;
      if (dy < IMPACT_ASSIST_Y_MIN || dy > IMPACT_ASSIST_Y_MAX) continue;
      if (Math.abs(q.x - p.x) > IMPACT_ASSIST_X_TOL) continue;
      if (!assist || stamp.halfCycle > assist.halfCycle) assist = stamp;
      break;
    }
  }
  return assist ? { participation: "impact", assist } : { participation: "none", assist: null };
}

/** Just the verdict, for callers that do not need the landing. */
export function rowParticipation(
  row: readonly Cube[],
  all: readonly Cube[],
  shipment: number,
): RowParticipation {
  return rowClaim(row, all, shipment).participation;
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
export function settleZoneCubes(
  cubes: Cube[],
  compactor: Compactor,
  level: LevelConfig,
  /** The field's live joints, so the grind can tell a rigid shipment that is
   *  still a SHIPMENT from one a Bond Breaker has already taken apart. Optional
   *  because every caller that has no joints to offer (a field of loose cubes —
   *  a standing wall, a test) wants exactly today's behaviour, and a missing
   *  argument should not silently soften a hazard. */
  constraints?: Matter.Constraint[],
): void {
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

  // Body ids still held by a live joint. Built once per call rather than
  // searched per cube: the press already walks this array every step
  // (breakJointsInBand), and a per-cube scan would be O(cubes x constraints) on
  // the hottest loop in the file. Empty when the caller passed no joints, which
  // is the same thing as "every cube on this field is loose".
  const bonded = new Set<number>();
  if (constraints) {
    for (const c of constraints) {
      if (c.bodyA) bonded.add(c.bodyA.id);
      if (c.bodyB) bonded.add(c.bodyB.id);
    }
  }

  for (const cube of cubes) {
    if (cube.blinkStart !== null) continue;
    const b = cube.body;
    // A RIGID SHIPMENT RESISTS THE GRIND while its joints still hold — see
    // RIGID_SETTLE_ASSIST. Read off the material and the joint together: a
    // rebar cube a Bond Breaker has freed is a loose cube and grinds like one.
    const rigidMult = MATERIAL_SPEC[cube.material].rigid && bonded.has(b.id)
      ? RIGID_SETTLE_ASSIST
      : 1;
    if (rigidMult <= 0) continue;
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
      Matter.Body.setAngle(b, b.angle + clamp(angleDelta, angleRate * rigidMult));
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
          Matter.Body.setPosition(b, { x: b.position.x + clamp(dx, xRate * rigidMult), y: b.position.y });
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
  /** One entry per cleared row, in `rows` order — the row's TIMING GRADE and
   *  the landing it was measured from (grades.ts).
   *
   *  A parallel array rather than a field on a richer row object, because
   *  `rows` is consumed by the row-flash FX as a bare list of y coordinates and
   *  nothing about a visual effect should have to know the money exists. The
   *  two are index-aligned by construction — both are pushed in the same loop —
   *  and sim/systems.ts pins the lengths equal. */
  graded: GradedRow[];
}

/** One cleared row, priced. */
export interface GradedRow {
  /** Center Y — the same value at the matching index of `ClearResult.rows`. */
  y: number;
  /** The landing this row was PRICED from — the newest among the cubes that
   *  filled its slots, or, in the impact-assist case, the shipment that came to
   *  rest on top of it (`rowClaim`). Null only when nothing involved had ever
   *  rested, which the row scan makes unreachable in play. */
  landing: LandingStamp | null;
  /** What the CLOCK alone said (grades.ts's `gradeForRow`) — before the two
   *  gates. Carried so the derivation is inspectable and so `capped` is a fact
   *  rather than a second opinion; NOTHING pays this. The money, the tally, the
   *  callout and the end card all read `grade`. */
  raw: ClearGrade;
  /** The band the bay actually SELLS this row at — the raw band after
   *  grades.ts's `awardedGrade`. The only field any consumer should price. */
  grade: ClearGrade;
  /** Was the bay congested at the top of the step this row cleared? */
  congested: boolean;
  /** How the latest shipment took part in the row (grades.ts). */
  participation: RowParticipation;
  /** Did a gate actually lower this row's band? `grade !== raw`, precomputed
   *  because it is what the callout draws and a UI re-deriving it would be free
   *  to re-derive it wrongly. False for a row that was already at or under the
   *  cap — a LUCKY row in a congested bay is not "capped", it is just late. */
  capped: boolean;
}

/**
 * The grade one CLEAR is announced as — the grade of the row whose newest cargo
 * landed most recently.
 *
 * The money is per row and this is not; the callout is one toast over a crush
 * that may have taken four rows at four different grades, and it has to pick
 * one. Three rules were on the table and this is the one that says something
 * true about the PLAYER:
 *
 *  - THE BEST grade over-praises. One threaded row would brand a stack-and-
 *    collapse "EXCELLENT!", which is the exact play the grade exists to price
 *    down.
 *  - THE WORST under-praises, and worse, contradicts the number beside it: a
 *    player who threads a row perfectly and happens to also drop a stale one
 *    would be paid for the Excellent and told they got lucky.
 *  - THE ROW THE SHOT JUST CLOSED is what the toast is a verdict on. The rows
 *    that came with it are still paid at their own rate — the ledger is per row
 *    and stays per row — but the sentence over the pile is about the shipment
 *    the player just placed, which is the thing they are being taught to aim.
 *
 * Null for an empty list, so a caller with nothing to announce has nothing to
 * draw rather than a default grade.
 */
export function headlineRow(graded: readonly GradedRow[]): GradedRow | null {
  let best: GradedRow | null = null;
  for (const row of graded) {
    if (!best) { best = row; continue; }
    const a = row.landing?.halfCycle ?? -1;
    const b = best.landing?.halfCycle ?? -1;
    if (a > b) best = row;
  }
  return best;
}

/** The headline row's AWARDED band — never its raw one, so the toast can never
 *  shout a grade the ledger did not pay. */
export function headlineGrade(graded: readonly GradedRow[]): ClearGrade | null {
  return headlineRow(graded)?.grade ?? null;
}

export function updateLineClear(
  world: Matter.World,
  cubes: Cube[],
  compactor: Compactor,
  level: LevelConfig,
  constraints: Matter.Constraint[],
  /** Everything the timing grade needs about the STEP this clear is being
   *  evaluated on (grades.ts's `ClearContext`): the sampled clock, the bay's
   *  congestion at the top of the step, and which shipment is the latest.
   *
   *  REQUIRED, and the clock inside it used to be an optional argument that
   *  defaulted to the bar's own live reading. That default was the trap that
   *  produced PR #168's fencepost: `update()` advances the counters partway
   *  through the step, so the default read a DIFFERENT clock from the one the
   *  landing stamp had used moments earlier, and a row closed on the tick the
   *  press completed was charged a sweep it had not survived. A caller that has
   *  to name all three cannot make that mistake by omission, and there is no
   *  honest value to default any of them to — "the bar right now" is precisely
   *  the wrong answer inside a step that has already moved it, "not congested"
   *  is the answer that pays the premium the gate exists to withhold, and
   *  "shipment 0" would silently cap every row in the game. */
  ctx: ClearContext,
): ClearResult {
  const { clock } = ctx;
  // Zone narrower than the minimum-line stop shouldn't happen (the compactor's
  // own right stop is clamped there), but zoneGrid guards against it
  // defensively — the bar keeps ping-ponging between its stops, it never
  // teleports.
  const zone = zoneGrid(compactor, level);
  if (!zone) return { lines: 0, cubes: [], rows: [], graded: [] };
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
  const graded: GradedRow[] = [];
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

    // GRADED FROM THE SLOT CUBES, not from the removal set. `toRemove` is a
    // union across every row that cleared this step, so reading the newest
    // landing off it would let one row's fresh shipment grade a row three
    // levels down that the same crush happened to close. A row is priced on the
    // cargo that filled ITS slots.
    const filled = slots as Cube[];
    const landing = newestLanding(filled);
    // THE CLOCK, THEN THE GATES, in that order and never folded together. The
    // raw band is a fact about the press; the awarded band is what the bay is
    // allowed to sell it as. Keeping both on the row is what lets the callout
    // say "this WOULD have been a timed row" without any consumer being able to
    // pay the one that was withheld.
    //
    // PARTICIPATION IS MEASURED AGAINST `cubes`, THE WHOLE FIELD, and against
    // the row's own slot cubes — never against `toRemove`. Same rule the grade
    // itself follows two lines up and for the same reason: `toRemove` is a
    // union across every row this crush takes, so an impact-assist over the
    // FLOOR row would otherwise vouch for the stale row three levels above it.
    const claim = rowClaim(filled, cubes, ctx.shipment);
    const { participation } = claim;
    // THE LANDING THAT CLOSED THE ROW. Normally the row's own newest; in the
    // impact-assist case the shipment that came down ON the row, which is by
    // construction not in it. The NEWER of the two rather than the assist
    // outright, so a stale assist can never drag a fresh row down.
    const closing = claim.assist && (!landing || claim.assist.halfCycle >= landing.halfCycle)
      ? claim.assist
      : landing;
    const raw = gradeForRow(closing, clock);
    const grade = awardedGrade(raw, { congested: ctx.congested, participation });
    graded.push({
      y: rowY, landing: closing, raw, grade,
      congested: ctx.congested, participation, capped: grade !== raw,
    });
    for (const c of filled) toRemove.add(c);
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
  return { lines: rows.length, cubes: removedCubes, rows, graded };
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
 * The frozen cube the press will reach NEXT — the Thaw Lance's target
 * (game.ts's useThawLance), or null when the bay has nothing to thaw.
 *
 * WHY THE LANCE AIMS ITSELF. The charge sits on the ability row beside the Bond
 * Breaker, and the Bond Breaker takes no aim — a player learns one control and
 * has learned both. A button that then thawed an ARBITRARY frozen cube would be
 * unreadable, so the target is a rule the player can hold in their head and
 * predict: the bar is coming, and the lance melts what it is about to hit.
 *
 * That is also the only target worth a charge, which is why this is a rule and
 * not a convenience. shatterColdCryo is what happens to a frozen cube that
 * reaches the advancing face — it breaks, and it knocks its whole row off the
 * slot grid on the way out. The cube in front of the bar is therefore the one
 * cube whose cost is about to be paid; a cube three slots deeper is a problem
 * the player still has time to solve with a shipment, which is the counter-play
 * cryo is supposed to be about (strikeCryo's note). The lance buys back the
 * shot for the cube you ran out of time on, never the whole material.
 *
 * WHICH IS FIRST is the bar's own geometry: the face advances rightward
 * (shatterColdCryo reads `compactor.x + width/2`), so the smallest x is next.
 *
 * THREE EXCLUSIONS, each of which is a wasted charge rather than a nicety:
 *  - STRANDED cargo, left of compactor.strandCutoffX. The bar can never reach
 *    it, so it is never pressed and never shatters — markLostPieces is what
 *    happens to it instead. Without this line a stranded cube would have the
 *    smallest x on the field and would swallow every charge in the rack.
 *  - Cubes ABOVE the bar's reach (the same `position.y < compactor.top` test
 *    shatterColdCryo makes), which the press does not touch either.
 *  - Cubes still MOVING. strikeCryo refuses to thaw a cube that is not already
 *    at rest — "it is the target, not the projectile" — and a lance that
 *    thawed shipments in flight would delete the sequencing the material is,
 *    rather than pay for it.
 */
export function nextColdCryo(cubes: Cube[], compactor: Compactor): Cube | null {
  let best: Cube | null = null;
  for (const cube of cubes) {
    if (cube.blinkStart !== null || cube.struck) continue;
    if (!MATERIAL_SPEC[cube.material].needsStrike) continue;
    const b = cube.body;
    if (b.position.y < compactor.top) continue;
    if (b.position.x < compactor.strandCutoffX) continue;
    if (b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y >= SETTLE_SQ) continue;
    if (!best || b.position.x < best.body.position.x) best = cube;
  }
  return best;
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
  const cutoff = compactor.strandCutoffX;
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
