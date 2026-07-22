import { PIECE_COLORS, type PieceType } from "../game/theme";
import { pieceCells } from "../game/pieces";
import { modById, type ModDef } from "../game/mods";

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

/** Belt-mounted next-piece preview (1d recycling-plant layout — see
 *  screens.ts's hudHTML) — just the colored 4x4 grid, no label/type text,
 *  since the conveyor belt's own "◂ NEXT" tag already carries that meaning
 *  and there's no room for a full chip on the angled belt. */
export function beltPieceHTML(type: PieceType, quarterTurns = 0, pieceCubes: 2 | 4 = 4): string {
  return pieceCellsHTML(type, 1, quarterTurns, pieceCubes);
}

/** Belt equivalent of the bomb telegraph (see game.ts's nextIsBomb) — a
 *  static glyph tile sized to match beltPieceHTML's grid. */
export function beltBombHTML(): string {
  return `<div class="next__bomb-tile" aria-label="Next: bomb">💣</div>`;
}

/** Stable 2-letter glyph + tiny pixel-font name per drafted-mod id, shown as
 *  a chip in the recycling-plant HUD panel (see screens.ts's hudHTML / the
 *  1d layout, and game/mods.ts's MODS). Kept as an explicit table rather
 *  than derived from `name` each render, so a chip's glyph/label never
 *  shifts if a mod's display copy changes — "stable per mod id" per the 1d
 *  design brief. Anything not listed here (a future mod) falls back to an
 *  auto-derived id-slice glyph in modChipHTML below instead of crashing. */
const MOD_GLYPHS: Record<string, { g: string; nm: string }> = {
  overclock: { g: "OC", nm: "O.CLOCK" },
  "wide-bay": { g: "WB", nm: "WIDE BAY" },
  sturdy: { g: "SD", nm: "STURDY" },
  half: { g: "HS", nm: "HALF" },
  bombs: { g: "BM", nm: "BOMBS" },
  overtime: { g: "OT", nm: "O.TIME" },
  premium: { g: "PR", nm: "PREMIUM" },
  "short-lines": { g: "SL", nm: "SH.LINE" },
  heavy: { g: "HC", nm: "HEAVY" },
  rapid: { g: "RL", nm: "RAPID" },
  // Bond Breaker never renders through modChipHTML (see runModsHTML below —
  // it gets its own tappable glowing chip in screens.ts), but keep an entry
  // for completeness/consistency with the id table.
  "bond-breaker": { g: "BB", nm: "BOND BRK" },
};

/** One run-mod chip: 2-letter glyph, tiny name, kind-colored top border
 *  (`.k-tradeoff`/`.k-boon`/`.k-bane`, matching ModDef.kind), and a ×N stack
 *  badge when `count` > 1 (only stackable mods can repeat — see
 *  mods.ts's ModDef.stackable). */
function modChipHTML(mod: ModDef, count: number): string {
  const glyph = MOD_GLYPHS[mod.id] ?? { g: mod.id.slice(0, 2).toUpperCase(), nm: mod.name.slice(0, 8).toUpperCase() };
  const stack = count > 1 ? `<span class="stk">×${count}</span>` : "";
  return `<div class="mod k-${mod.kind}" title="${mod.name}"><span class="g">${glyph.g}</span><span class="nm">${glyph.nm}</span>${stack}</div>`;
}

/** Run-mods chip row for the recycling-plant HUD panel — every drafted mod
 *  EXCEPT Bond Breaker (that one gets its own tappable glowing chip merged
 *  from the old standalone HUD button, see screens.ts's hudHTML), collapsed
 *  to one chip per id with a ×N stack badge for repeats, in first-drafted
 *  order. `modIds` is a run's full pick history (run.ts's RunState.modIds),
 *  which can list a stackable id more than once. */
export function runModsHTML(modIds: string[]): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const id of modIds) {
    if (id === "bond-breaker") continue;
    if (!counts.has(id)) order.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return order
    .map((id) => modById(id))
    .filter((m): m is ModDef => m != null)
    .map((m) => modChipHTML(m, counts.get(m.id) ?? 1))
    .join("");
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
