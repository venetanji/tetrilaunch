import { PIECE_SHAPES, PIECE_COLORS, type PieceType } from "../game/theme";

/**
 * One clockwise quarter-turn within the 4x4 preview grid (y down): (x, y) -> (3 - y, x).
 * This mirrors the world-space spawn rotation in pieces.ts, where a +PI/2
 * rotation maps offset (ox, oy) -> (-oy, ox) around the piece center — the
 * grid mapping is that same rotation re-expressed in 0..3 cell indices
 * (center at 1.5,1.5: x' = 1.5-(y-1.5) = 3-y, y' = 1.5+(x-1.5) = x). So the
 * HUD preview always matches the piece actually spawned at this rotation.
 */
function rotateCellCW([x, y]: [number, number]): [number, number] {
  return [3 - y, x];
}

/** 4x4 mini render of a tetromino (next-piece preview, piece tiles). */
export function pieceCellsHTML(type: PieceType, gap = 1, quarterTurns = 0): string {
  const shape = PIECE_SHAPES[type];
  const color = PIECE_COLORS[type];
  const turns = ((quarterTurns % 4) + 4) % 4;
  const rotated = shape.map((cell) => {
    let c = cell;
    for (let i = 0; i < turns; i++) c = rotateCellCW(c);
    return c;
  });
  const filled = new Set(rotated.map(([x, y]) => `${x},${y}`));
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

export function nextPreviewHTML(type: PieceType, quarterTurns = 0): string {
  return `<div class="next" aria-label="Next piece">
    ${pieceCellsHTML(type, 1, quarterTurns)}
    <div>
      <div class="chip__label">Next</div>
      <div class="chip__value" style="font-size:16px;color:${PIECE_COLORS[type]}">${type}</div>
    </div>
  </div>`;
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
