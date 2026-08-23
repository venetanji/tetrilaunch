import Matter from "matter-js";
import { CELL, WALL_INNER, WORLD } from "./engine";
import { BASE_BREAK_STRETCH } from "./level";
import {
  PIECE_SHAPES,
  PENTA_SHAPES,
  PIECE_COLORS,
  MATERIAL_SPEC,
  type Material,
  type PieceSize,
  type PieceType,
} from "./theme";

export interface Cube {
  body: Matter.Body;
  type: PieceType;
  color: string;
  /** Timestamp (ms) when this cube began blinking before despawn, or null. */
  blinkStart: number | null;
  /** What this cube is made of — see theme.ts's Material. Stamped at spawn and
   *  never changed: materials of different kinds coexist on the field for the
   *  whole bay, so this has to travel with the cube rather than be read off the
   *  level. */
  material: Material;
  /** Cryo only: has this cube taken a hard enough impact to thaw?
   *
   *  Stored per-CUBE rather than per-piece because a cryo shipment shatters into
   *  loose cubes like any other, and striking one corner of a pile must not
   *  thaw a cube on the far side of it that nothing has touched. Always true for
   *  materials that don't need striking, so the line-clear check can read this
   *  one field without also re-deriving the material's rules. */
  struck: boolean;
}

export interface Piece {
  cubes: Cube[];
  constraints: Matter.Constraint[];
}

/**
 * What this module stamps onto a Matter constraint beyond what Matter itself
 * models. Matter's Constraint type has no room for any of it, hence the cast at
 * every site — collected here so the shape is written down once instead of
 * being re-declared inline at each reader.
 *
 * `restLength` and `breakStretch` are the fragility pair (see
 * updateBreakableJoints); `welded` marks a tar joint that nothing may break
 * (see game.ts's resolveTarWelds); `color` is carried purely so a broken joint
 * can say what color it was without a lookup.
 */
export interface JointMeta {
  restLength: number;
  breakStretch?: number;
  welded?: boolean;
  color?: string;
}

/** A joint that just came apart, reported back to the caller so it can put an
 *  FX event on the seam. Midpoint of the two bodies at the moment of the break
 *  — the seam's own position, not either cube's. */
export interface JointBreak {
  x: number;
  y: number;
  color: string;
}

/** The color a break reports when the joint never got a stamp — the standing
 *  wall's cubes and any future constraint built outside createTetrisPiece. Only
 *  ever reached by joints that predate or bypass the stamp, so it is a fallback
 *  rather than a palette choice. */
const JOINT_FALLBACK_COLOR = "#9fb4c7";

/** Where a joint sits: the midpoint of the two bodies it holds together.
 *  Exported so game.ts's useBondBreaker — which tears every joint at once
 *  rather than going through either break function — reports its seams on
 *  exactly the same terms as the other two paths. Callers must have checked
 *  that both bodies are present. */
export function jointBreakAt(c: Matter.Constraint): JointBreak {
  const a = c.bodyA!.position;
  const b = c.bodyB!.position;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    color: (c as unknown as JointMeta).color ?? JOINT_FALLBACK_COLOR,
  };
}

function dist(a: Matter.Vector, b: Matter.Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Baseline cube density (matter units) — the "std" tetromino's per-cube mass,
 *  and the reference SIZE_SPEC's densityMult scales. Exported so sim/perf.ts's
 *  synthetic cubes stay physics-identical to real ones. */
export const CUBE_DENSITY = 0.001;

/**
 * Physics character of each payload size class (see theme.ts's PieceSize for
 * the design intent). Three multipliers, all relative to "std":
 *
 *  - densityMult scales each CUBE's mass. This is the lever that decides
 *    whether a build's own weight helps it: a heavy shipment lands hard enough
 *    to press the layers below it flat and square (helping the compactor reach
 *    the strict slot grid in lineClear.ts), while a light one settles ON TOP of
 *    a messy pile without ever fixing it. That asymmetry is deliberate — a tiny
 *    build has to buy its compaction some other way (Bond Breakers).
 *  - breakMult scales the level's jointBreakStretch for THIS piece's joints
 *    only (stored per-constraint — see createTetrisPiece / updateBreakableJoints),
 *    so tiny pieces come apart on landings a bulk piece shrugs off.
 *  - stiffnessDelta nudges the joint spring stiffness so a rigid size reads
 *    rigid in flight too, not just at the breaking point.
 *
 * Cube COUNT is here as well so pieceCells and the cost/economy side (mods.ts)
 * both read one table.
 */
export const SIZE_SPEC: Record<
  PieceSize,
  { cubes: number; densityMult: number; breakMult: number; stiffnessDelta: number }
> = {
  tiny: { cubes: 2, densityMult: 0.7, breakMult: 0.6, stiffnessDelta: -0.05 },
  std: { cubes: 4, densityMult: 1, breakMult: 1, stiffnessDelta: 0 },
  bulk: { cubes: 5, densityMult: 1.35, breakMult: 1.6, stiffnessDelta: 0.02 },
};

/**
 * Grid cells (relative coords) making up a piece at a given size class.
 * "std" is the real tetromino shape (PIECE_SHAPES); "bulk" the matching
 * pentomino (PENTA_SHAPES); "tiny" a fixed horizontal domino — rotation (in
 * pieceOffsets) turns it vertical like any other orientation. The domino
 * ignores `type` for its cells but keeps the type for color/theming, so the
 * Micro Shipments modifier doesn't need a whole second piece-color table.
 */
export function pieceCells(type: PieceType, size: PieceSize): [number, number][] {
  if (size === "tiny") return [[0, 0], [1, 0]];
  if (size === "bulk") return PENTA_SHAPES[type];
  return PIECE_SHAPES[type];
}

/**
 * World-space offsets (px) of a piece's cubes from its OWN centroid, rotated
 * by `angle` (radians). Centroid-anchored (not the enclosing 4x4 grid's center
 * at (1.5, 1.5)) so rotating a piece spins it in place — several shapes (I, L,
 * J, S, Z, T) have a centroid that differs from grid-center, so pivoting on
 * grid-center would visibly translate/teleport them on every turn instead of
 * spinning. Shared by createTetrisPiece (world spawn) and render.ts's muzzle
 * ghost preview, so both draw the exact same rotated shape.
 */
export function pieceOffsets(
  type: PieceType,
  angle: number,
  size: PieceSize = "std",
): { x: number; y: number }[] {
  const shape = pieceCells(type, size);
  const cx = shape.reduce((s, [px]) => s + px, 0) / shape.length;
  const cy = shape.reduce((s, [, py]) => s + py, 0) / shape.length;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return shape.map(([px, py]) => {
    const ox = (px - cx) * CELL;
    const oy = (py - cy) * CELL;
    return { x: ox * cos - oy * sin, y: ox * sin + oy * cos };
  });
}

/** What a Seam-Splitter-weakened type's threshold is computed FROM when the
 *  bay's own break stretch is not finite (an unbreakable-bonds config — the
 *  same Infinity rebar's joints carry). A multiplier on Infinity is still
 *  Infinity, so on such a bay the weakening has to restate a finite base, and
 *  bay 1's fragility (level.ts's BASE_BREAK_STRETCH) is the honest one: the
 *  weakened shape handles like it did at the bottom of the ladder, before the
 *  ramp hardened anything. Aliased rather than re-typed so the ladder's first
 *  rung and this fallback can never drift apart. */
export const WEAK_BOND_UNBREAKABLE_BASE = BASE_BREAK_STRETCH;

/** Joint damping — resistance to the cubes' relative velocity along each
 *  joint. jointStiffness stays < 1 (0.9-0.98, see level.ts), so the joints
 *  are real springs and CAN ring; at 0.1 a hard landing kept a piece
 *  visibly jiggling for a while. 0.3 settles that ringing within a few
 *  frames without making the piece read as gooey in flight. Exported so
 *  sim/perf.ts's clique builder stays physics-identical to real pieces. */
export const JOINT_DAMPING = 0.3;

/**
 * Cubes for a bay's SALVAGE WALL — the pile a Contract variant opens with
 * (level.ts's standingWall), already settled on the slot grid.
 *
 * Loose cubes, deliberately: no joints, no piece type, no material. A standing
 * wall is scrap that was pressed flat long before the player arrived, so
 * shattering it means nothing and no shipment ever "delivered" it. That also
 * makes it exactly what lineClear.ts wants — one settled, aligned, countable
 * cube per slot — with no press stroke needed to square it first.
 *
 * `standing[k]` is how many cells of slot column k are filled, counted up from
 * the floor, with k measured from the wall outward: the same index
 * lineClear.ts's nearest-slot arithmetic uses, so a wall built here lands on
 * the grid the line check reads rather than near it.
 */
export function createStandingWall(
  world: Matter.World,
  standing: readonly number[],
): Cube[] {
  const cubes: Cube[] = [];
  standing.forEach((height, k) => {
    for (let row = 0; row < Math.max(0, Math.floor(height)); row++) {
      const body = Matter.Bodies.rectangle(
        WALL_INNER - CELL / 2 - k * CELL,
        WORLD.height - CELL / 2 - row * CELL,
        CELL,
        CELL,
        {
          friction: 0.5,
          frictionAir: 0.012,
          restitution: 0.05,
          density: CUBE_DENSITY,
          label: "cube",
          chamfer: { radius: 3 },
        },
      );
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Composite.add(world, body);
      cubes.push({
        body,
        // "O" is arbitrary but not meaningless: it is the one type whose own
        // shape is a square, so a wall cube rendered from its type reads as the
        // single block it is rather than a fragment of something larger.
        type: "O",
        color: PIECE_COLORS.O,
        blinkStart: null,
        material: "standard",
        struck: true,
      });
    }
  });
  return cubes;
}

/** Build a shipment (domino / tetromino / pentomino — see pieceCells) from
 *  cubes rigidly joined by breakable distance joints. `jointStiffness`,
 *  `size` and `breakStretch` come from the level/run config; passed as scalars
 *  rather than the whole LevelConfig since game.ts is the only caller and
 *  already has all three at hand.
 *
 *  `breakStretch` is the LEVEL's threshold; the size class's own breakMult
 *  (SIZE_SPEC) is folded in here and stamped onto each constraint, so
 *  updateBreakableJoints can enforce a per-piece fragility without needing to
 *  know which size spawned it. That matters because pieces of different sizes
 *  coexist on the field: a Micro-Shipments run that later drafts Bulk still
 *  has the old dominoes lying around, and they must keep their own fragility.
 *  The Seam Splitter's per-type weakening (`weakBond`) folds in the same way
 *  and for the same reason — the stamp is the whole record. */
export function createTetrisPiece(
  world: Matter.World,
  x: number,
  y: number,
  angle: number,
  velocity: Matter.Vector,
  type: PieceType,
  jointStiffness: number,
  size: PieceSize = "std",
  breakStretch = 1.7,
  /** What the shipment is made of (theme.ts's Material). Last and defaulted so
   *  every existing caller — the sim harnesses especially — keeps launching
   *  ordinary shipments without being touched. */
  material: Material = "standard",
  /** SEAM SPLITTER (upgrades.ts's Bond Emitter, tiers 2-3): piece types whose
   *  stamped break threshold is weakened, and by how much (level.ts's
   *  weakBondTypes / weakBondMult, handed through by game.ts). Optional and
   *  trailing for the same reason material is — a caller that doesn't pass it
   *  launches shipments at exactly the stock thresholds. */
  weakBond?: { types: PieceType[]; mult: number },
): Piece {
  const mat = MATERIAL_SPEC[material];
  // A material that changes what a cube is WORTH overrides the shipment's type
  // color; standard keeps it. See MATERIAL_SPEC's note on why this is not
  // optional decoration.
  const color = mat.color ?? PIECE_COLORS[type];
  const cubes: Cube[] = [];
  const spec = SIZE_SPEC[size];

  for (const { x: rx, y: ry } of pieceOffsets(type, angle, size)) {
    const body = Matter.Bodies.rectangle(x + rx, y + ry, CELL, CELL, {
      friction: 0.5,
      frictionAir: 0.012,
      restitution: 0.05,
      density: CUBE_DENSITY * spec.densityMult,
      label: "cube",
      chamfer: { radius: 3 },
    });
    Matter.Body.setAngle(body, angle);
    Matter.Body.setVelocity(body, velocity);
    Matter.Composite.add(world, body);
    cubes.push({
      body,
      type,
      color,
      blinkStart: null,
      material,
      // Materials that never need striking spawn already "struck", so
      // lineClear's candidate test is one boolean rather than a per-material
      // branch it would have to keep in sync with MATERIAL_SPEC.
      struck: !mat.needsStrike,
    });
  }

  // Connect every pair → a rigid-but-shatterable cluster.
  const stiffness = Math.max(0.5, Math.min(0.995, jointStiffness + spec.stiffnessDelta));
  // SEAM SPLITTER: a type listed in weakBond gets the same composed threshold
  // (level ramp x size class) x weakBond.mult — except on a bay whose own
  // stretch is not finite, where a multiplier alone is a no-op (Infinity x 0.7
  // is still Infinity). There the weakened type restates bay-1 fragility
  // (WEAK_BOND_UNBREAKABLE_BASE) before the multiplier, so the one thing the
  // subsystem is FOR — keeping the misdelivering shapes breakable — survives
  // the very format that makes everything else unbreakable.
  const base = breakStretch * spec.breakMult;
  const splitMult = weakBond && weakBond.types.includes(type) ? weakBond.mult : null;
  // REBAR never comes apart on impact, at any stretch. Slag denies a slot;
  // rebar denies a SHAPE — what lands is what you keep, so a bad landing cannot
  // be squeezed or shoved into a better one and the row is built around it.
  // Infinity rather than a very large number so the intent survives a future
  // reader: updateBreakableJoints compares `cur > rest * limit`, and no finite
  // stretch beats it. A Bond Breaker still splits these (see game.ts's
  // useBondBreaker), which is deliberately the only thing that does. Checked
  // BEFORE the Seam Splitter, deliberately: rigidity is a property of the
  // material and outranks a piece-shape one, so a rebar S stays Infinity
  // whatever weakBond lists. (Tar welds are stamped elsewhere — the `welded`
  // flag — and are untouched by all of this.)
  const pieceBreakStretch = mat.rigid
    ? Infinity
    : splitMult === null
      ? Math.max(1.05, base)
      : Math.max(1.05, (Number.isFinite(base) ? base : WEAK_BOND_UNBREAKABLE_BASE) * splitMult);
  const constraints: Matter.Constraint[] = [];
  for (let i = 0; i < cubes.length; i++) {
    for (let j = i + 1; j < cubes.length; j++) {
      const a = cubes[i].body;
      const b = cubes[j].body;
      const rest = dist(a.position, b.position);
      const c = Matter.Constraint.create({
        bodyA: a,
        bodyB: b,
        length: rest,
        stiffness,
        damping: JOINT_DAMPING,
        render: { visible: false },
      });
      const meta = c as unknown as JointMeta;
      meta.restLength = rest;
      meta.breakStretch = pieceBreakStretch;
      // Stamped here rather than looked up when the joint breaks, because the
      // alternative is a linear scan of the field's cubes per break and the
      // compactor tears many seams in a single step (see breakJointsInBand).
      meta.color = color;
      constraints.push(c);
      Matter.Composite.add(world, c);
    }
  }

  return { cubes, constraints };
}

/**
 * Break the joints of any piece the compactor bar is crushing, so tetrominoes
 * shatter into loose cubes as the compactor sweeps into them — without deleting
 * the cubes (only full lines get cleared). Only affects cubes down at the bar's
 * level (y past `topY`), so pieces flying over the bar aren't broken mid-air.
 *
 * Returns the seams it tore so the caller can spark them (see game.ts). A
 * return value rather than a callback keeps this module render-agnostic, and
 * every caller that does not want them can simply ignore it.
 */
export function breakJointsInBand(
  world: Matter.World,
  constraints: Matter.Constraint[],
  x: number,
  topY: number,
  halfBand: number,
): JointBreak[] {
  const broken: JointBreak[] = [];
  const inBand = (b: Matter.Body) =>
    Math.abs(b.position.x - x) < halfBand && b.position.y > topY;
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i];
    if (!c.bodyA || !c.bodyB) continue;
    // Same two exemptions updateBreakableJoints honours. Without them the press
    // was the one thing that broke both — geometry alone, no metadata read — so
    // a rebar piece it swept came apart and a tar weld it swept dissolved, which
    // is exactly the property each material is sold on. A Bond Breaker is meant
    // to be the only answer to either.
    const meta = c as unknown as JointMeta;
    if (meta.welded) continue;
    if (meta.breakStretch === Infinity) continue;
    if (inBand(c.bodyA) || inBand(c.bodyB)) {
      broken.push(jointBreakAt(c));
      Matter.Composite.remove(world, c);
      constraints.splice(i, 1);
    }
  }
  return broken;
}

/**
 * Remove every constraint (world + array, reverse iteration so splicing is
 * safe) whose bodyA or bodyB is `body`. Call this right before removing a
 * cube's body wherever a cube can be deleted outright (line-clear, blink-out,
 * bomb blast) — otherwise a joined cube's constraint keeps pointing at a body
 * no longer in the world: a dangling joint that either throws or gets solved
 * against a frozen ghost every tick.
 */
export function removeConstraintsFor(
  world: Matter.World,
  constraints: Matter.Constraint[],
  body: Matter.Body,
): void {
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i];
    if (c.bodyA === body || c.bodyB === body) {
      Matter.Composite.remove(world, c);
      constraints.splice(i, 1);
    }
  }
}

/**
 * Remove over-stretched joints so pieces break apart on hard impacts. A joint
 * breaks once stretched past its rest length by its OWN break factor — a hard
 * impact momentarily yanks the stiff constraint, mimicking pymunk's max_force
 * joints.
 *
 * The threshold is read per-constraint (stamped at spawn by createTetrisPiece,
 * level threshold × the size class's breakMult) with `breakStretch` as the
 * fallback for joints created without one. Per-constraint rather than one
 * global number because pieces of different size classes coexist on the field
 * and must keep the fragility they were launched with.
 *
 * Returns the seams it tore, on the same terms as breakJointsInBand: the
 * caller decides whether a break is worth showing, this only reports it.
 */
export function updateBreakableJoints(
  world: Matter.World,
  constraints: Matter.Constraint[],
  breakStretch: number,
): JointBreak[] {
  const broken: JointBreak[] = [];
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i];
    if (!c.bodyA || !c.bodyB) continue;
    const meta = c as unknown as JointMeta;
    // A tar weld is permanent (game.ts's resolveTarWelds) — no stretch breaks it.
    if (meta.welded) continue;
    const rest = meta.restLength || c.length;
    const limit = meta.breakStretch ?? breakStretch;
    const cur = dist(c.bodyA.position, c.bodyB.position);
    if (cur > rest * limit) {
      broken.push(jointBreakAt(c));
      Matter.Composite.remove(world, c);
      constraints.splice(i, 1);
    }
  }
  return broken;
}
