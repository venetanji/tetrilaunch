import Matter from "matter-js";
import { CELL, WORLD } from "./engine";
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
 * Where the machine's FACE starts — `.plant`'s own left frame fraction (1.67%
 * of the field), the same fraction CHUTE.x1 is the far end of.
 *
 * This is deliberately NOT CHUTE.x0, and the 21px between them is the whole
 * point of the rect's "widened to the left wall" note: the physics claims the
 * dead sliver beside the panel so a cube can never come to rest in it, while
 * there is no machine out there to DRAW. Nothing is mounted in that sliver but
 * the crest's port band (app.css's .plant__crest--port), which hangs off the
 * panel's corner and reaches for the wall.
 */
export const CHUTE_MOUTH_X0 = 0.0167 * WORLD.width;

/**
 * The mouth AS DRAWN, for a bay whose press leaves the maw ending at
 * `rightEdge` (chuteRightEdge above).
 *
 * Lives here rather than in render.ts because it is the same authored panel
 * geometry the rect is, measured off the same fractions, and because that seam
 * — world px here against CSS fractions in app.css — is the one this file
 * exists to keep honest. sim/systems.ts pins both ends of this span against
 * the stylesheet, which is a check no browser is needed for.
 *
 * Clamped rather than allowed to go negative: chuteRightEdge tracks the press,
 * and a bay whose press somehow reached inside the panel's own left edge would
 * otherwise ask the renderer to draw a mouth inside out.
 */
export function chuteMouth(rightEdge: number): { x0: number; w: number } {
  return { x0: CHUTE_MOUTH_X0, w: Math.max(0, rightEdge - CHUTE_MOUTH_X0) };
}

/**
 * A WALL, NOT A HOPPER. The machine's surface IS its mouth.
 *
 * This used to be a plane 231px down inside the machine (CHUTE_THROAT_Y, 620),
 * so the footprint claimed only the FLOOR of the maw and not its airspace.
 * That was deliberate: it let a shallow full-power delivery cross the machine
 * low — the arc passes ~(519, 398), inside the panel's box — and carry on out
 * to x 941, well past the compactor's reach.
 *
 * The trouble is that nothing about the machine says it can be flown through.
 * Traced frame by frame, cargo aimed into the maw entered the mouth at
 * (223, 390) and then travelled DOWN AND ACROSS the whole body of the machine
 * for a quarter of a second — (318, 417), (369, 500), (416, 599) — before two
 * of its four cubes hit the grinder, with the survivors continuing right and
 * out the far side. Behind an opaque panel that is merely invisible; through
 * the aim-through state, which is exactly when the player is watching, it is
 * cargo tunnelling through solid machinery.
 *
 * So the surface is the surface. Anything that touches it is taken there, and
 * the skim corridor goes with it — a fly-through was never a move the machine
 * was offering, and keeping it would have made scraping the roof a cheap way
 * to shear the bonds off a shipment.
 *
 * NO TUNNELLING TO GUARD AGAINST: the fastest thing in the game is a max-power
 * launch at 28 px/step, and the region below this plane is 331px deep.
 */
export const CHUTE_SURFACE_Y = CHUTE.y0;

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

/**
 * THE FLUE PLANE — the Incinerator's boundary, and the one number the whole
 * system turns on (upgrades.ts's `incinerator` track).
 *
 * The owner's request names the region in the HUD's own terms: *the space
 * above the power bar*. The power bar is `.pl-pwr`, the cap mounted on the top
 * edge of the plant panel (ui/screens.ts), and this file already owns the world
 * geometry that edge sits on — `CHUTE_SURFACE_Y`, the plant's roof plane. So
 * the flue is everything at or above the plant's roof: the whole open bay over
 * the machine, continuing up through the open shaft render.ts draws above y=0.
 *
 * IT IS NOT `layout.ts`'s `skyTop`, and refusing that is the point rather than
 * an implementation detail. `skyTop` is a function of the VIEWPORT — it is
 * however much letterbox band the player's aspect ratio happens to leave — so
 * a rule written against it would charge two players different money for the
 * same seed, and would move a bay's economics when a phone is rotated. This
 * file's own rect carries the argument in full ("AUTHORED, never measured from
 * the DOM […] Physics that varied with HUD size would break seed determinism"),
 * and the Incinerator is a bay's ledger, which is a stronger version of the
 * same claim. The sky is *inside* the flue — every open-shaft y is above this
 * plane — so nothing about PR #128's airspace is lost by anchoring here.
 *
 * WHY HALF A CELL BELOW THE ROOF, rather than on it. `shredInChute` takes cargo
 * by its BOTTOM EDGE ("a piece dies exactly as it touches down"), so a cube the
 * intake destroys has its CENTRE at roughly `CHUTE_SURFACE_Y - CELL/2` and, on
 * the step the test first passes, anywhere up to a step of fall below that. The
 * charge side reads a cube's centre — that is the position every other rule in
 * the game reads, and the position a blast victim has. Putting the plane half a
 * cell UNDER the roof is what makes those two agree: "burned in the hood" and
 * "taken by the intake" then cannot disagree by a rounding of geometry, at any
 * arrival speed the cannon can produce (SPEED_MAX 28 px/step against 20px of
 * margin below the deepest centre the bottom-edge test admits). sim/systems.ts
 * pins that margin.
 */
export const INCINERATOR_Y = CHUTE_SURFACE_Y + CELL / 2;

/**
 * Is a cube at this centre-y inside the flue — i.e. above the power bar?
 *
 * Takes the y ALONE, deliberately. The hood spans the bay: cargo destroyed high
 * over the deep slots is as burned as cargo destroyed over the machine, because
 * what the system prices is height, not which half of the bay you were over. A
 * two-axis region would also be unreadable — the player can see one horizontal
 * line, and a rule they cannot see is a rule that happens to them (render.ts's
 * drawCushionEdge makes the same argument for the liner's near edge).
 */
export function inIncinerator(y: number): boolean {
  return y <= INCINERATOR_Y;
}

/** Is this point inside the machine? Measured against the SURFACE — see
 *  CHUTE_SURFACE_Y for why the airspace over the maw is part of it now.
 *
 *  Takes a POINT, so callers decide what they are asking about: pathStrands
 *  passes trajectory samples (does this aim hit the machine), while
 *  shredInChute passes each cube's bottom edge rather than its centre, so a
 *  piece dies as it lands ON the surface instead of half-sunk into it. */
export function inChute(x: number, y: number, rightEdge: number = CHUTE.x1): boolean {
  return x >= CHUTE.x0 && x <= rightEdge && y >= CHUTE_SURFACE_Y && y <= CHUTE.y1;
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
    // The cube's BOTTOM edge against the surface, not its centre: a centre
    // test kills the cube once it is already half-buried in the roof, and the
    // blast then blooms out of a piece that visibly sank into solid machinery.
    // Half a cell higher and the piece dies exactly as it touches down.
    if (!inChute(p.x, p.y + CELL / 2, rightEdge)) continue;
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
  // WHERE THE ARC ENDS IS NOT THE LAST SAMPLE. predictTrajectory pushes each
  // point at the TOP of its loop and breaks AFTER integrating, so the step that
  // leaves the field is never stored — the final sample is always the last one
  // still inside it, and at 15-25px of descent per step that sits well above
  // the floor. The old test asked `last.y >= WORLD.height - 1`, which is true
  // only when the final sample happens to land within a pixel of the ground:
  // about one aim in twenty. The "lands short" half of this warning — the half
  // the doc above argues for — was therefore inert for almost every shot it was
  // written to catch.
  //
  // The last two samples carry the step that was ABOUT to be taken, which is
  // the one that ended the arc, so read the ending off that instead.
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  // Still climbing (or dead level) says nothing about where the shot comes
  // down: this is the truncated-lob case the step cap produces.
  if (dy <= 0) return false;
  // Out through the side wall is not short of the press — it is past it.
  if (last.x + dx > WORLD.width) return false;
  // Descending but not yet at the floor: the arc was cut by the 140-step cap
  // rather than by the ground, so its landing is still unknown.
  if (last.y + dy <= WORLD.height) return false;
  // Linear across that final step. The test above bounds t to one step, so the
  // extrapolation never reaches further than the two samples it is drawn from.
  const t = (WORLD.height - last.y) / dy;
  return last.x + dx * t < strandCutoffX;
}
