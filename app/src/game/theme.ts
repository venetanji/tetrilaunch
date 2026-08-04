// Canvas-side palette. Mirrors src/styles/tokens.css (design-system single source).

export type PieceType = "I" | "O" | "T" | "L" | "J" | "S" | "Z";

export const PIECE_TYPES: PieceType[] = ["I", "O", "T", "L", "J", "S", "Z"];

/** Relative cube coordinates per tetromino (identical to the original main.py). */
export const PIECE_SHAPES: Record<PieceType, [number, number][]> = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  L: [[0, 0], [0, 1], [0, 2], [1, 2]],
  J: [[1, 0], [1, 1], [1, 2], [0, 2]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

/**
 * Payload size class of a launched shipment — the "how big is one shot"
 * dimension of the build (see level.ts's LevelConfig.pieceSize and pieces.ts's
 * SIZE_SPEC for the physics that goes with each). Deliberately a named class
 * rather than a raw cube count: the count is only half of what changes, the
 * per-cube DENSITY and joint fragility change with it too, and those are what
 * make each size play differently.
 *
 *  - "tiny"  — 2-cube dominoes: cheap, precise, and LIGHT. They shatter on
 *              contact readily, but because each cube weighs less they don't
 *              press down hard enough to break up or square off the layers
 *              underneath, so a tiny build can't rely on weight to compact its
 *              own pile — it needs Bond Breakers for that (see the Autoloader
 *              mod in mods.ts, the endgame of this line).
 *  - "std"   — the real 4-cube tetrominoes. Baseline for every multiplier.
 *  - "bulk"  — 5-cube pentominoes (PENTA_SHAPES below): expensive, RIGID (they
 *              survive landings that shatter a tetromino) and dense enough that
 *              their weight settles the pile below them. Harder to place, but a
 *              landed one is worth 5 slots.
 */
export type PieceSize = "tiny" | "std" | "bulk";

/**
 * Pentomino cell sets for the "bulk" size class, one per PieceType so a bulk
 * run keeps the same 7-piece rotation (and per-type colors/patterns) rather
 * than needing a second piece table wired through the queue, previews and
 * theming. Each is a genuine 5-cell pentomino chosen to fit inside a 4x4 box —
 * that's the box the DOM previews render (components.ts's pieceCellsHTML), so
 * the straight 5-in-a-row I-pentomino is deliberately NOT used; its L/J-shaped
 * 4x2 cousins read correctly at preview size and still span four cells.
 */
export const PENTA_SHAPES: Record<PieceType, [number, number][]> = {
  // J-pentomino: a 4-long bar with one cube hooked down off the end.
  I: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
  // P-pentomino: the O-block plus one cube extending the left column.
  O: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  // T-pentomino: a 3-wide cap over a 2-long stem.
  T: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  // L-pentomino: a 4-tall column with one cube at the foot.
  L: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  // J-pentomino mirrored, matching J's own mirror of L.
  J: [[1, 0], [1, 1], [1, 2], [1, 3], [0, 3]],
  // W-pentomino: a staircase — the awkward one, same as S is for tetrominoes.
  S: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  // Z/S-pentomino: an S with a longer middle.
  Z: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
};

export const PIECE_COLORS: Record<PieceType, string> = {
  I: "#00f0ff",
  O: "#ffe500",
  T: "#b026ff",
  L: "#ff8a00",
  J: "#2979ff",
  S: "#00ff85",
  Z: "#ff2d55",
};

/**
 * MATERIAL — what a shipment is MADE of, orthogonal to its shape (PieceType)
 * and its size class (PieceSize).
 *
 * This is the content engine described in docs/DESIGN.md: match-3 games get
 * thousands of levels out of one verb by never adding mechanics and always
 * adding TILE TYPES. Every material here is a rule about how a cube interacts
 * with the line-clear check in lineClear.ts — none of them adds a system, a
 * screen, or a new player verb, and that is the point. A material is content on
 * the engine that already exists.
 *
 * A material belongs to a whole SHIPMENT, not to individual cubes within one.
 * Per-cube mixing was rejected: the next-shipment preview and the pattern
 * Contract tiler (tiling.ts) both reason about a piece as one object, and a
 * queue entry that meant "an O, but two of its cubes are dead" is not something
 * either could show or plan around.
 *
 *  - "standard" — an ordinary shipment. The baseline every other material is a
 *                 deviation from, and the only material a bay is guaranteed.
 *  - "slag"     — occupies a slot and can NEVER count toward a line. It is the
 *                 chocolate: it does not threaten you, it takes up room, and
 *                 the answer is a demolition charge or shoving it left out of
 *                 the zone and eating the lost-piece penalty. Pure denial, no
 *                 timer, no escalation.
 *  - "cryo"     — arrives frozen and will not compact until it has been STRUCK
 *                 (see pieces.ts's Cube.struck). Pressed while still cold it
 *                 shatters, and takes its row's alignment with it. The answer
 *                 is sequencing: land something on it, THEN build the row.
 *
 *  - "rebar"    — its joints NEVER break, at any stretch. Slag denies a slot;
 *                 rebar denies a SHAPE. What lands is what you keep, so a bad
 *                 landing cannot be squeezed, shoved or shattered into a better
 *                 one, and the row has to be built around it. The answer is the
 *                 Bond Emitter: a Bond Breaker charge is the one thing that
 *                 splits it, which is why rebar is the material that finally
 *                 gives that system a job beyond tidying a messy pile.
 *  - "volatile" — detonates when it lands HARD, taking its neighbours with it.
 *                 The only material whose cost is paid by the cubes already on
 *                 the field rather than by itself, so it punishes a full bay far
 *                 worse than an empty one. The answer is a soft landing —
 *                 settleAssist, which the Press Hydraulics track raises — or
 *                 deliberately chaining it into a pile you wanted gone anyway.
 *  - "tar"      — welds permanently to whatever it touches on contact, and a
 *                 Bond Breaker will NOT split the weld. The deliberate inverse
 *                 of rebar: rebar is rigid and breakable, tar is the joint you
 *                 cannot break. Avoidance is the real answer; Demolition is the
 *                 expensive one, since a vaporized cube takes its welds with it.
 *  - "magnetic" — snaps itself square against its neighbours as it settles. The
 *                 HELPFUL blocker, and the reason the vocabulary is not
 *                 uniformly hostile: it fills a slot you may not have wanted
 *                 filled, but it squares the row while doing it. Like cryo it
 *                 gets no counter system, and for the same reason — giving one
 *                 to a material that is already doing you a favour would delete
 *                 the only rung on the ladder that teaches a hazard can be
 *                 welcome.
 */
export type Material =
  | "standard" | "slag" | "cryo" | "rebar" | "volatile" | "tar" | "magnetic";

export const MATERIALS: Material[] = [
  "standard", "slag", "cryo", "rebar", "volatile", "tar", "magnetic",
];

/**
 * Per-material presentation and rule flags, read by both the renderer and
 * lineClear. One table so a material can never look like one thing and behave
 * like another.
 *
 * `color` of null means "keep the shipment's own PieceType color" — only
 * standard does that. Slag and cryo override it outright, because a material
 * the player cannot identify at a glance is a trap rather than a puzzle: both
 * of these change what a cube is WORTH, and that has to be readable from across
 * the bay while it is still in the air.
 */
export const MATERIAL_SPEC: Record<
  Material,
  {
    name: string;
    color: string | null;
    /** Can a cube of this material ever fill a line slot? False for slag. */
    countsForLines: boolean;
    /** Must this cube be struck before it counts? True for cryo. */
    needsStrike: boolean;
    /** Are this shipment's joints exempt from the level's break-stretch check
     *  entirely? True for rebar. A Bond Breaker still splits them — that is
     *  deliberately the only thing that does, and it is what gives the Bond
     *  Emitter track a job that isn't cosmetic. */
    rigid?: boolean;
    /** Does a hard landing detonate this cube, taking its neighbours? True for
     *  volatile. The impact threshold and blast radius live in game.ts beside
     *  the collision handler that measures them. */
    detonates?: boolean;
    /** Does this cube weld permanently to whatever it touches, surviving even a
     *  Bond Breaker? True for tar. */
    welds?: boolean;
    /** Does this cube snap itself onto the slot grid as it settles? True for
     *  magnetic — the one material that HELPS, and the reason the vocabulary
     *  isn't uniformly hostile. */
    aligns?: boolean;
  }
> = {
  standard: { name: "Standard", color: null, countsForLines: true, needsStrike: false },
  // Dead grey-brown. Deliberately the only unsaturated thing on the field —
  // every real shipment is neon, so slag reads as inert without needing a label.
  slag: { name: "Slag", color: "#6d6a7c", countsForLines: false, needsStrike: false },
  // Pale ice. Bright enough to stay legible in flight, cold enough to read as
  // a different substance rather than another piece color.
  cryo: { name: "Cryo", color: "#9fe8ff", countsForLines: true, needsStrike: true },
  // Structural orange — the colour of the thing itself, and the only warm
  // saturated tone on the field, so "this one will not bend" reads in flight.
  rebar: { name: "Rebar", color: "#ff8a1f", countsForLines: true, needsStrike: false, rigid: true },
  // Hazard yellow-green, the one colour the palette otherwise refuses. It is a
  // warning label, and it is the only material whose cost lands on cubes that
  // were already safely down.
  volatile: { name: "Volatile", color: "#d4ff3a", countsForLines: true, needsStrike: false, detonates: true },
  // Near-black with just enough value to separate from the backdrop. Tar reads
  // as an absence — the slot it took is not coming back.
  tar: { name: "Tar", color: "#241f2e", countsForLines: true, needsStrike: false, welds: true },
  // Cold steel-violet, deliberately close to the wall colour: magnetic is the
  // one material that behaves like part of the bay rather than against it.
  magnetic: { name: "Magnetic", color: "#8f9bd6", countsForLines: true, needsStrike: false, aligns: true },
};

export const COLORS = {
  bg: "#07070f",
  grid: "rgba(122,92,255,0.08)",
  wall: "#2e2e4a",
  wallGlow: "rgba(0,240,255,0.25)",
  compactor: "#ff2d55",
  compactorGlow: "rgba(255,45,85,0.5)",
  trajectory: "#00ff85",
  aim: "#00f0ff",
  text: "#eaeaff",
  textDim: "#8080ac",
};

/** Shade helpers (port of the original dark/light pattern shading). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}
