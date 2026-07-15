import { PIECE_SHAPES, PIECE_COLORS, type PieceType } from "../game/theme";

/** 4x4 mini render of a tetromino (next-piece preview, piece tiles). */
export function pieceCellsHTML(type: PieceType, gap = 1): string {
  const shape = PIECE_SHAPES[type];
  const color = PIECE_COLORS[type];
  const filled = new Set(shape.map(([x, y]) => `${x},${y}`));
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

export function nextPreviewHTML(type: PieceType): string {
  return `<div class="next" aria-label="Next piece">
    ${pieceCellsHTML(type)}
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
