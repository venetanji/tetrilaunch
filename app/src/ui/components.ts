import {
  MATERIAL_SPEC, PIECE_COLORS, type Material, type PieceSize, type PieceType,
} from "../game/theme";
import { pieceCells } from "../game/pieces";
import { HAZARDS, type HazardDef, type HazardId, type Ratchets } from "../game/hazards";
import { MAX_TIER, UPGRADES, type UpgradeTiers } from "../game/upgrades";

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

/** 4x4 mini render of a shipment (next-piece preview, piece tiles). `size`
 *  selects the base cell set via game/pieces's pieceCells — "tiny" renders the
 *  Micro Shipments domino, "std" the real tetromino, "bulk" the pentomino. The
 *  rotate/recenter pipeline below is shape-agnostic (every PENTA_SHAPES entry
 *  is chosen to fit this same 4x4 box — see theme.ts), so any cell count flows
 *  through it unchanged. */
export function pieceCellsHTML(
  type: PieceType,
  gap = 1,
  quarterTurns = 0,
  size: PieceSize = "std",
  /** What the shipment is made of. The preview MUST carry this: cryo is only a
   *  fair puzzle if you can sequence around it before firing, and slag is only
   *  a decision if you know it's coming rather than discovering it on landing.
   *  Defaults to standard so tiles that preview a shape rather than a specific
   *  shipment (the how-to screen, piece chips) are unaffected. */
  material: Material = "standard",
): string {
  const shape = pieceCells(type, size);
  const color = MATERIAL_SPEC[material].color ?? PIECE_COLORS[type];
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
export function beltPieceHTML(
  type: PieceType,
  quarterTurns = 0,
  size: PieceSize = "std",
  material: Material = "standard",
): string {
  return pieceCellsHTML(type, 1, quarterTurns, size, material);
}

/** Belt equivalent of the bomb telegraph (see game.ts's nextIsBomb) — a
 *  static glyph tile sized to match beltPieceHTML's grid. */
export function beltBombHTML(): string {
  return `<div class="next__bomb-tile" aria-label="Next: bomb">💣</div>`;
}

/** Stable 2-letter glyph + tiny pixel-font name per ratcheted AXIS, shown as a
 *  chip in the recycling-plant HUD panel (see screens.ts's hudHTML and
 *  game/hazards.ts's HAZARDS). Kept as an explicit table rather than derived
 *  from `name` each render, so a chip's glyph never shifts if an axis's display
 *  copy changes — "stable per id" per the 1d design brief. Anything not listed
 *  falls back to an auto-derived id slice rather than crashing.
 *
 *  This row used to list drafted MODS. It lists the player's own difficulty
 *  choices now, and that is a bigger change than the swap looks: the chips are
 *  no longer a trophy shelf of what you were given, they are the running bill
 *  for what you took on. Which is exactly what a player needs on screen while
 *  deciding whether the next notch is affordable. */
const AXIS_GLYPHS: Record<HazardId, { g: string; nm: string }> = {
  target: { g: "QT", nm: "QUOTA" },
  cost: { g: "$L", nm: "FUEL" },
  time: { g: "CL", nm: "SHIFT" },
  wind: { g: "WD", nm: "X.WIND" },
  sweeper: { g: "SW", nm: "SWEEP" },
  slag: { g: "SL", nm: "SLAG" },
  cryo: { g: "CR", nm: "CRYO" },
  rebar: { g: "RB", nm: "REBAR" },
  volatile: { g: "VL", nm: "VOLATL" },
  tar: { g: "TR", nm: "TAR" },
  magnetic: { g: "MG", nm: "MAGNET" },
};

/** One ratchet chip: glyph, tiny name, and a ×N badge once an axis has been
 *  taken more than once. Content axes get the `k-bane` treatment and number
 *  axes `k-tradeoff`, so a glance separates "the belt is dirtier" from "the
 *  numbers are worse" — they are answered by completely different systems. */
function axisChipHTML(h: HazardDef, count: number): string {
  const glyph = AXIS_GLYPHS[h.id] ?? {
    g: h.id.slice(0, 2).toUpperCase(),
    nm: h.name.slice(0, 8).toUpperCase(),
  };
  const stack = count > 1 ? `<span class="stk">×${count}</span>` : "";
  const kind = h.kind === "content" ? "bane" : "tradeoff";
  return `<div class="mod k-${kind}" title="${h.name} ×${count}"><span class="g">${glyph.g}</span><span class="nm">${glyph.nm}</span>${stack}</div>`;
}

/** Ratchet chip row for the recycling-plant HUD panel — one chip per axis the
 *  run has ratcheted, in ladder order (HAZARDS), with a ×N badge for repeats. */
export function runRatchetsHTML(ratchets: Ratchets): string {
  return HAZARDS
    .filter((h) => (ratchets[h.id] ?? 0) > 0)
    .map((h) => axisChipHTML(h, ratchets[h.id] ?? 0))
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
  // The ROW carries the switch semantics, not the 56x30 pill inside it. The
  // pill is under the 44px tap floor and cannot grow without becoming a
  // different-looking control, whereas the row is already ~50px tall and is
  // what a thumb aims at anyway — main.ts's onClick resolves the handler with
  // closest("[data-toggle]"), so moving the attributes up makes the label,
  // the description and the pill one target instead of three inert areas
  // around one small one.
  return `<div class="setting" role="switch" data-toggle="${id}" aria-checked="${on}" tabindex="0">
    <div class="setting__label"><b>${label}</b><span>${desc}</span></div>
    <div class="toggle"></div>
  </div>`;
}

export function btn(action: string, label: string, variant = "secondary", extra = ""): string {
  return `<button class="btn btn--${variant}" data-action="${action}" ${extra}>${label}</button>`;
}

/**
 * Compact ship-refit readout for the HUD: one small plate per UPGRADED system
 * with its tier as pips. Only bought tracks render — a stock ship shows nothing
 * rather than six empty plates, so the row grows as the run's build takes shape.
 * See game/upgrades.ts for the tracks, and screens.ts's hudHTML for placement.
 */
export function shipPlatesHTML(tiers: UpgradeTiers): string {
  const plates = UPGRADES.filter((u) => (tiers[u.id] ?? 0) > 0)
    .map((u) => {
      const tier = Math.min(MAX_TIER, tiers[u.id]);
      const pips = Array.from({ length: MAX_TIER }, (_, i) =>
        `<i class="${i < tier ? "on" : ""}"></i>`,
      ).join("");
      return `<div class="ship-plate" title="${u.name} — tier ${tier}">
        <span class="ship-plate__g">${u.glyph}</span>
        <span class="ship-plate__pips">${pips}</span>
      </div>`;
    })
    .join("");
  return plates;
}
