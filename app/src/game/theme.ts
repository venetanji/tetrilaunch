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
