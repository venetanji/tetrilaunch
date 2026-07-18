import { PIECE_COLORS, type PieceType } from "../game/theme";
import { pieceCells } from "../game/pieces";

/**
 * One clockwise quarter-turn about the 4x4 preview grid's own center (y down):
 * (x, y) -> (3 - y, x) — a genuine +PI/2 rotation (offset (ox, oy) -> (-oy, ox)
 * about (1.5, 1.5), the same convention pieces.ts's world-space rotation uses).
 * A piece's own centroid rarely sits at the grid center though, so this alone
 * would rotate the *orientation* correctly but drift the shape's bounding box
 * around the box turn to turn; pieceCellsHTML re-centers afterward to fix that
 * (see recenterInBox below) — the preview shows orientation, exact sub-cell
 * placement is centroid-anchored in world space (pieces.ts's pieceOffsets).
 */
function rotateCellCW([x, y]: [number, number]): [number, number] {
  return [3 - y, x];
}

/**
 * Shift a rotated cell set so its bounding box is centered in the 4x4 box
 * (min = floor((4-w)/2), floor((4-h)/2)) instead of wherever the grid-center
 * rotation happened to leave it. Recentering is a pure translation, so it
 * can't change the shape's relative layout — only where it sits in the box.
 * This keeps the preview stable turn to turn (e.g. O always renders as a
 * centered 2x2 block; I alternates between a centered row and column).
 */
function recenterInBox(cells: [number, number][]): [number, number][] {
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;
  const dx = Math.floor((4 - w) / 2) - minX;
  const dy = Math.floor((4 - h) / 2) - minY;
  return cells.map(([x, y]) => [x + dx, y + dy]);
}

/** 4x4 mini render of a tetromino (next-piece preview, piece tiles).
 *  `pieceCubes` selects the base cell set via game/pieces's pieceCells — 2
 *  renders the "Half Shipments" domino, 4 the real tetromino shape. The
 *  rotate/recenter pipeline below is shape-agnostic, so either cell count
 *  flows through it unchanged. */
export function pieceCellsHTML(type: PieceType, gap = 1, quarterTurns = 0, pieceCubes: 2 | 4 = 4): string {
  const shape = pieceCells(type, pieceCubes);
  const color = PIECE_COLORS[type];
  const turns = ((quarterTurns % 4) + 4) % 4;
  const rotated = shape.map((cell) => {
    let c = cell;
    for (let i = 0; i < turns; i++) c = rotateCellCW(c);
    return c;
  });
  const centered = recenterInBox(rotated);
  const filled = new Set(centered.map(([x, y]) => `${x},${y}`));
  let cells = "";
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const on = filled.has(`${x},${y}`);
      cells += `<div class="next__cell" style="${
        on
          ? `background:${color};box-shadow:0 0 6px ${color};`
          : "background:rgba(255,255,255,0.03);"
      }"></div>`;
    }
  }
  return `<div class="next__grid" style="gap:${gap}px">${cells}</div>`;
}

export function nextPreviewHTML(type: PieceType, quarterTurns = 0, pieceCubes: 2 | 4 = 4): string {
  return `<div class="next" aria-label="Next piece">
    ${pieceCellsHTML(type, 1, quarterTurns, pieceCubes)}
    <div>
      <div class="chip__label">Next</div>
      <div class="chip__value" style="font-size:16px;color:${PIECE_COLORS[type]}">${type}</div>
    </div>
  </div>`;
}

/** HUD preview card for a telegraphed bomb shot (see game.ts's nextIsBomb) —
 *  same `.next` card shell as nextPreviewHTML, but a static glyph tile
 *  instead of a rotated piece grid (a bomb has no orientation to show). */
export function bombNextHTML(): string {
  return `<div class="next next--bomb" aria-label="Next: bomb">
    <div class="next__bomb-tile">💣</div>
    <div>
      <div class="chip__label">Next</div>
      <div class="chip__value" style="font-size:16px;color:var(--danger)">BOMB</div>
    </div>
  </div>`;
}

/** Format a countdown in ms as "m:ss", ceiling-rounded so the displayed
 *  number only reaches 0 once time is actually up. Shared by screens.ts
 *  (initial HUD render) and main.ts (per-tick sync) so the two never drift
 *  out of formatting sync. */
export function formatMMSS(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function toggleHTML(id: string, label: string, desc: string, on: boolean): string {
  return `<div class="setting">
    <div class="setting__label"><b>${label}</b><span>${desc}</span></div>
    <div class="toggle" role="switch" data-toggle="${id}" aria-checked="${on}" tabindex="0"></div>
  </div>`;
}

export function btn(action: string, label: string, variant = "secondary", extra = ""): string {
  return `<button class="btn btn--${variant}" data-action="${action}" ${extra}>${label}</button>`;
}
