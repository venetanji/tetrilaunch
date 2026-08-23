import Matter from "matter-js";
import { WORLD } from "./engine";
import { removeConstraintsFor, type Cube } from "./pieces";
import { wakeNear } from "./lineClear";

/**
 * THE INTAKE CHUTE — the recycling plant's maw, bottom-left of the bay.
 *
 * The plant panel is the biggest thing the HUD puts over the field, and until
 * now it was scenery painted on top of live physics. Cargo that fell short flew
 * BEHIND it and kept playing the game from there: it settled invisibly, was
 * marked lost by lineClear's markLostPieces (which strands anything left of the
 * compactor's furthest reach, world x 780), blinked its 1.4s sentence out of
 * sight, and finally decayed — spawning its "-$" toast behind the panel too.
 * Throughout, it counted toward the congestion tier, because Game.pileTier
 * reads every cube on the field. The player was charged the launch, charged the
 * decay penalty, and taxed on congestion, and saw none of the three.
 *
 * So the panel becomes what it looks like: a machine with an open intake. Cargo
 * that enters is shredded on contact, loudly, in front of the panel rather than
 * behind it. The cost is deliberately UNCHANGED (game.ts's chargeLostCubes
 * serves this path and the blink path from one place) — this fixes the
 * feedback, not the economy.
 *
 * It also gives the deliberate discard a home. Dumping a slag shipment when
 * there's no demolition charge to spare was already possible by firing it
 * short; now it's a visible, aimable move instead of cargo quietly evaporating.
 */

/**
 * The maw, in WORLD coordinates.
 *
 * Derived from `.plant`'s own frame fractions in app.css — left 1.67%, width
 * 47.08%, bottom 2.97%, height 42.96% of the field — which put the panel at
 * world x 21..624, y 389..699. Two independent corroborations of that right
 * edge: render.ts mounts PISTON_BARREL_X at 616 under a comment placing the
 * panel edge at 624, and app.css's menu wordmark plate reuses the same
 * fractions.
 *
 * Widened to the left wall and down to the floor rather than tracing the panel
 * exactly. The panel leaves a 21px lip on the left and a 21px strip below, both
 * of which are unreachable dead space a cube could otherwise come to rest in —
 * which is the invisible-pile bug this exists to end, just 21px narrower.
 *
 * AUTHORED, never measured from the DOM, and that is load-bearing rather than
 * convenient. Physics that varied with HUD size would break seed determinism:
 * sim/bots.ts, shared seeds and lib/telemetry all assume one seed plays the
 * same everywhere, and the panel is NOT one size — a Contract's is shorter
 * (app.css's `.hud--contract .plant { min-height: 0 }`), the tutorial's is
 * taller (it carries the coach card), and the attract demo has no HUD at all.
 * Reading the panel would hand each of those different physics. The chute is
 * therefore drawn on the CANVAS as part of the room (render.ts's drawChute),
 * with the DOM panel mounted inside it.
 */
export const CHUTE = {
  x0: 0,
  x1: 624,
  y0: 389,
  y1: WORLD.height,
} as const;

/** The lip a "-$" toast is spawned on, so the penalty renders ABOVE the panel
 *  instead of behind it — the whole point of the exercise. */
export const CHUTE_LIP_Y = CHUTE.y0;

/**
 * WHERE THE GRINDER ACTUALLY IS, as opposed to where the mouth is.
 *
 * A hopper, not a wall — and this is the difference between a fix and a
 * regression. Taking the whole footprint from the mouth down would claim the
 * AIRSPACE over the machine as well as the floor of it, and shots cross that
 * airspace on their way somewhere useful: a full-power delivery at -10 degrees
 * passes (519, 398) and lands at x 941, deep in the bay and well past the
 * compactor's reach. Swallowing it would have deleted every downward shot in
 * the game to catch fumbles, which is a far bigger change than the one being
 * asked for.
 *
 * Measured on the live arc across the full aim cone at four power levels
 * (-60..+60 degrees, min/30%/60%/max):
 *
 *   deepest any USEFUL shot reaches inside the footprint   543   (-20 deg, max)
 *   shallowest cargo that COMES TO REST behind the panel   698   (on the floor)
 *
 * 620 sits between them with ~77px of clearance either way. The margin only
 * grows with the LAUNCHER track, which flattens arcs and lifts them further
 * clear; nothing narrows it, since bay gravity is a constant 1 everywhere.
 *
 * The MOUTH is still drawn at CHUTE.y0 and every cue still fires from there
 * (render.ts's drawChute, and the explosion and "-$" this file's caller
 * spawns). That is not a fudge — it is what the machine looks like. Cargo drops
 * in at the top, the grinder is deep inside, and the quarter second between the
 * two is the piece falling down the throat.
 */
export const CHUTE_THROAT_Y = 620;

/**
 * The maw's right edge for a bay whose press reaches `strandCutoffX`.
 *
 * Normally the panel's own edge: past it, cargo is on open canvas where the
 * player can watch it blink out, and lineClear's existing decay is the better
 * telling. But BAY EXTENSION T3 opens the compactor to 18 cells, which walks
 * its open stop back to x 547 — LEFT of the panel's edge. A fixed maw would
 * then be grinding cargo the press could still have reached, quietly charging
 * the player for two cells of the upgrade they just bought.
 *
 * Clamping makes the chute mean exactly one thing, which is the thing
 * markLostPieces already means: this is the floor the press can never reach.
 * Level-derived, not device-derived, so seed determinism is untouched.
 */
export function chuteRightEdge(strandCutoffX: number): number {
  return Math.min(CHUTE.x1, strandCutoffX);
}

/** Blast radius for one shredded cube. Deliberately small: this is a cube
 *  meeting a grinder, not a demolition charge going off, and the maw is wide
 *  enough that a piece feeding in produces a run of them. */
export const CHUTE_BLAST_R = 34;

/** Is this point in the grinder? Measured against the THROAT, not the mouth —
 *  see CHUTE_THROAT_Y for why the machine's airspace is not part of it.
 *
 *  Centre-point containment rather than a full AABB overlap: a cube grazing the
 *  edge and carrying on is not "in the shredder", and one that is genuinely
 *  going in crosses the plane within a step or two anyway. No tunnelling risk
 *  to guard against — the fastest thing in the game is a max-power launch at
 *  28 px/step, against a throat 100px deep. */
export function inChute(x: number, y: number, rightEdge: number = CHUTE.x1): boolean {
  return x >= CHUTE.x0 && x <= rightEdge && y >= CHUTE_THROAT_Y && y <= CHUTE.y1;
}

/**
 * Destroy every cube whose centre is inside the maw, returning where each one
 * went so the caller can throw debris and price the loss.
 *
 * Cubes go INDIVIDUALLY rather than the whole tetromino at once. No constraint
 * graph is walked: the joints are removed per cube, so the rest of a piece
 * clipping the lip stays airborne and keeps flying. That reads correctly —
 * cargo is being fed into a shredder a cube at a time, and pieces coming apart
 * into loose cubes is already this game's most common event.
 *
 * Reverse iteration so splicing is safe, same as lineClear's removal paths.
 */
export function shredInChute(
  world: Matter.World,
  cubes: Cube[],
  constraints: Matter.Constraint[],
  rightEdge: number,
): Cube[] {
  const shredded: Cube[] = [];
  for (let i = cubes.length - 1; i >= 0; i--) {
    const cube = cubes[i];
    const p = cube.body.position;
    if (!inChute(p.x, p.y, rightEdge)) continue;
    removeConstraintsFor(world, constraints, cube.body);
    Matter.Composite.remove(world, cube.body);
    cubes.splice(i, 1);
    shredded.push(cube);
  }
  // Same un-supported-survivor wake as every other deletion path (see
  // lineClear's wakeNear note): a cube resting ON one that just went down the
  // chute has had its support cease to exist, with no contact event to notice
  // it, and matter will not wake a sleeping body for an absence.
  for (const c of shredded) {
    wakeNear(cubes, c.body.position.x, c.body.position.y);
  }
  return shredded;
}

/**
 * Does this predicted flight path end somewhere the bay can never use?
 *
 * Two ways for a shot to be wasted, and the warning has to cover both or it
 * teaches half a rule: the arc feeds the chute, or it lands short of the
 * compactor's furthest reach and strands (lineClear's markLostPieces, whose
 * cutoff this takes as an argument so the warning and the punishment cannot
 * drift apart).
 *
 * ANGLE WAS THE OBVIOUS TEST AND IT IS THE WRONG ONE. A shallow -10 degree shot
 * at full power lands around x 830 — a perfectly good flat delivery — while a
 * level 0 degree shot at low power lands at x 350 and is a total loss. Aiming
 * down is not the failure; landing short is, and the trajectory already knows.
 *
 * `pts` is game.ts's live preview (cannon.ts's predictTrajectory), so this
 * warns against exactly the arc the player is looking at, wind included.
 */
export function pathStrands(pts: Matter.Vector[], strandCutoffX: number): boolean {
  if (pts.length < 2) return false;
  const rightEdge = chuteRightEdge(strandCutoffX);
  for (const p of pts) {
    if (inChute(p.x, p.y, rightEdge)) return true;
  }
  // The terminal point is only a LANDING if the arc actually ran out of field.
  // predictTrajectory stops at 140 steps whether or not the shot has come down,
  // and a still-climbing arc truncated mid-flight says nothing about where it
  // ends — treating that as a landing would flag every lofted shot in the game.
  const last = pts[pts.length - 1];
  if (last.y < WORLD.height - 1) return false;
  return last.x < strandCutoffX;
}
