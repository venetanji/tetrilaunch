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
