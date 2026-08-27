import {
  glyphInk, MATERIAL_GLYPH, MATERIAL_SPEC, PIECE_COLORS,
  shipmentAura, shipmentColor, type Material, type PieceSize, type PieceType,
} from "../game/theme";
import { pieceCells } from "../game/pieces";
import { HAZARDS, type HazardDef, type HazardId, type Ratchets } from "../game/hazards";
import { icon, type IconName } from "./icons";
import { finalById, type FinalId } from "../game/finals";
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
  const color = shipmentColor(type, material);
  const shapeColor = PIECE_COLORS[type];
  const turns = ((quarterTurns % 4) + 4) % 4;
  const rotated = shape.map((cell) => {
    let c = cell;
    for (let i = 0; i < turns; i++) c = rotateCellCW(c);
    return c;
  });
  const centered = recenterInBox(rotated);
  const filled = new Set(centered.map(([x, y]) => `${x},${y}`));
  // The tile is ONE <svg> rather than seventeen divs. Three reasons, in order of
  // how much they cost to get wrong:
  //
  //  1. The material badge below has to sit ON the tile without adding a BOX.
  //     app.css's mat-aura note already worked this out for the glow — a
  //     ::before/::after would be a new box inside the belt tile, which
  //     sim/uifit's `clipped` and `offscreen` assertions measure and correctly
  //     object to. An SVG child is painted, not laid out, so the tile keeps the
  //     exact one-box footprint uifit has a baseline for.
  //  2. A two-tone cell is a rect inside a rect. In divs that is 32 elements and
  //     a nested flexbox; here it is two <rect>s.
  //  3. It scales. The belt renders this at up to 58px and the how-to gallery at
  //     28px, and a vector tile is sharp at both without a second stylesheet.
  //
  // The viewBox is deliberately 28 units wide — the tile's own CSS px size — so
  // `gap` keeps meaning exactly what it meant when these were grid cells, and no
  // caller has to be re-tuned.
  const cw = (28 - gap * 3) / 4;
  let cells = "";
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const X = x * (cw + gap);
      const Y = y * (cw + gap);
      if (!filled.has(`${x},${y}`)) {
        cells += `<rect x="${X}" y="${Y}" width="${cw}" height="${cw}" rx="1"`
          + ` fill="rgba(255,255,255,0.03)"/>`;
        continue;
      }
      // TWO-TONE, the same split the bay cubes use (render.ts's getCubeSprite):
      // the shipment's own colour frames the material's. On a standard shipment
      // the two are the same colour and this collapses to the plain cell it has
      // always drawn — which is the signal, not a shortcut: solid means
      // ordinary, framed means there is something to think about.
      cells += `<rect x="${X}" y="${Y}" width="${cw}" height="${cw}" rx="1"`
        + ` fill="${shapeColor}"/>`;
      if (color !== shapeColor) {
        const i = cw * 0.22;
        cells += `<rect x="${X + i}" y="${Y + i}" width="${cw - i * 2}"`
          + ` height="${cw - i * 2}" rx="0.6" fill="${color}"/>`;
      }
    }
  }
  // MATERIAL BADGE. At tile size the two-tone inner square is under 2 units
  // across, so it is a hint and nothing more — the badge is what actually
  // identifies the material here, and it is the same glyph the bay cube and the
  // menus draw (theme.ts's MATERIAL_GLYPH). Drawn last so it sits over the
  // cells, and filled with the material's AURA rather than its colour so tar and
  // slag are legible against the near-black backdrop instead of being two dark
  // smudges.
  const badge = material === "standard" ? "" : materialBadgeSVG(type, material);
  // MATERIAL TELEGRAPH. The tile already carries the material as a colour, and
  // a colour is enough to IDENTIFY a shipment and not enough to make anyone
  // look at one: slag is dead grey and cryo is a pale wash, and both read as
  // "a piece" to an eye that is watching the field. The whole value of
  // previewing a material is that it can be sequenced around BEFORE it fires,
  // which only pays if the preview is noticed.
  //
  // So a non-standard shipment pulses (app.css's mat-aura). Motion is the cue,
  // not hue — it works for tar's near-black as well as for volatile's hazard
  // yellow — and the glow itself is drawn in shipmentAura, the cube's own
  // colour lifted to something visible against the backdrop.
  //
  // Standard shipments get nothing, here and on the how-to gallery's tiles,
  // which pass no material at all: a tile that always pulses says nothing.
  const attrs = material === "standard"
    ? ""
    : ` data-material="${material}" style="--mat-c:${shipmentAura(type, material)}"`;
  return `<svg class="next__grid" viewBox="0 0 28 28"${attrs}>${cells}${badge}</svg>`;
}

/** Badge geometry, in the 28-unit tile viewBox. Bottom-right because that is the
 *  corner the L, J and S shapes least often reach, and because the belt's
 *  chevrons march in from the left — a badge on that side would be read as part
 *  of the transport rather than as part of the cargo. */
const BADGE_R = 7.2;
const BADGE_C = 28 - BADGE_R - 0.4;
/** The glyph box inside the badge. Fits inside a 7.2 radius with room for the
 *  keyline, and stays above the ~1px stroke floor at the 28px how-to size. */
const BADGE_GLYPH = 12.6;

/** The material badge on its own, in tile coordinates. Split out because the
 *  muzzle ghost and the menus want the same mark from the same source — a glyph
 *  drawn twice is a glyph that drifts. */
function materialBadgeSVG(type: PieceType, material: Material): string {
  const fill = shipmentAura(type, material);
  const o = BADGE_C - BADGE_GLYPH / 2;
  return `<circle cx="${BADGE_C}" cy="${BADGE_C}" r="${BADGE_R}" fill="${fill}"/>`
    + `<circle cx="${BADGE_C}" cy="${BADGE_C}" r="${BADGE_R}" fill="none"`
    + ` stroke="#07070f" stroke-width="1.4"/>`
    + glyphSVG(material, o, BADGE_GLYPH, glyphInk(fill));
}

/** One material glyph as SVG, scaled from theme.ts's 24-unit authoring box into
 *  a `size`-wide square at (o, o). Mirrors render.ts's drawMaterialGlyph — same
 *  path data, same 24x24 origin, so the canvas and the DOM cannot disagree. */
function glyphSVG(material: Material, o: number, size: number, ink: string): string {
  const g = MATERIAL_GLYPH[material as Exclude<Material, "standard">];
  if (!g) return "";
  const s = size / 24;
  const paint = g.stroke === 0
    ? `fill="${ink}"`
    : `fill="none" stroke="${ink}" stroke-width="${g.stroke}"`
      + ` stroke-linecap="round" stroke-linejoin="round"`;
  return `<g transform="translate(${o} ${o}) scale(${s})"><path d="${g.d}" ${paint}/></g>`;
}

/**
 * A material's icon, standalone and at any size — for menus, Workshop rows,
 * hazard cards and anywhere else a material is named rather than previewed.
 *
 * This is the reason the glyphs are authored as path data in theme.ts rather
 * than drawn inline at each surface: the mark a player learns on the belt is the
 * same mark that identifies the counter they are buying in the shop, byte for
 * byte. `standard` has no icon and returns empty — the absence IS its identity.
 */
export function materialIconHTML(material: Material, px = 20): string {
  if (material === "standard") return "";
  const color = shipmentAura("O", material);
  return `<svg class="mat-icon" width="${px}" height="${px}" viewBox="0 0 24 24"`
    + ` role="img" aria-label="${MATERIAL_SPEC[material].name}">`
    + glyphSVG(material, 0, 24, color)
    + `</svg>`;
}

/** Belt-mounted next-piece preview (1d recycling-plant layout — see
 *  screens.ts's hudHTML) — just the colored 4x4 grid, no label/type text.
 *  There's no room for a full chip on the angled belt, and the transport
 *  itself says "this is what's coming" without words: the marching chevrons
 *  light up in the shipment's colour (the "◂ NEXT" caption this used to lean
 *  on is gone — see hudHTML's belt note for why the phones ate it). */
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

/** A SEALED shipment — the belt on a "Blackout" pattern Contract
 *  (level.ts's hideNextPreview). Deliberately a crate rather than an empty
 *  belt: empty is already the honest render for a finite queue that has run
 *  out (see hudHTML), and a player who could not tell "nothing is coming" from
 *  "something is coming and you may not see it" would read the variant as a
 *  bug. The whole SET is still on the card; only the order is hidden. */
export function beltSealedHTML(): string {
  return `<div class="next__bomb-tile next__bomb-tile--sealed" aria-label="Next: sealed">?</div>`;
}

/** Stable 2-letter glyph per ratcheted AXIS, for the notch tally line in the
 *  recycling-plant HUD panel (see runNotchTallyHTML below and game/hazards.ts's
 *  HAZARDS). Kept as an explicit table rather than derived from `name` each
 *  render, so a glyph never shifts if an axis's display copy changes — "stable
 *  per id" per the 1d design brief. Anything not listed falls back to an
 *  auto-derived id slice rather than crashing.
 *
 *  (These used to be 30px CHIPS carrying a glyph plus a tiny pixel-font name;
 *  the tally keeps only the glyph — see runNotchTallyHTML's width story.)
 *
 *  This line used to list drafted MODS. It lists the player's own difficulty
 *  choices now, and that is a bigger change than the swap looks: the glyphs are
 *  no longer a trophy shelf of what you were given, they are the running bill
 *  for what you took on. Which is exactly what a player needs on screen while
 *  deciding whether the next notch is affordable. */
/** The bare glyph for one axis, with the same fallback the tally uses.
 *  Exported for the draft's cards and pick slots (screens.ts): the mark a
 *  player learns on the plant panel's notch line is the mark they pick the
 *  notch by, byte for byte — the same one-vocabulary rule materialIconHTML
 *  states for the material glyphs. */
/** Real icons for the NUMBER axes — the materials already have theirs
 *  (materialIconHTML), and a two-letter text code sitting beside real glyphs
 *  on the draft's cards read as a placeholder. "time" and "wind" reuse
 *  glyphs the set already draws for the same facts (the bay clock, the
 *  Weather Survey's streaks); the two axes nothing else depicts got their
 *  own (icons.ts's levy and sweep). `target` is deliberately absent — the
 *  axis is retired from the offer (hazards.ts's RETIRED_AXES), so only the
 *  glyph-text fallback below can ever render it. */
const AXIS_ICONS: Partial<Record<HazardId, IconName>> = {
  cost: "levy", time: "clock", wind: "survey", sweeper: "sweep",
};

/** One axis as a GLYPH — the material's belt icon, the number axis's icon,
 *  or (for an axis neither table carries) the two-letter tally code. The
 *  draft's cards and pick slots read this, so every axis a hand can deal
 *  shows a real mark and the text code is strictly a fallback. */
export function axisIconHTML(h: HazardDef, px = 14): string {
  if (h.material) return materialIconHTML(h.material, px);
  const name = AXIS_ICONS[h.id];
  return name ? icon(name, px) : axisGlyph(h.id);
}

export function axisGlyph(id: HazardId): string {
  return AXIS_GLYPHS[id] ?? id.slice(0, 2).toUpperCase();
}

const AXIS_GLYPHS: Record<HazardId, string> = {
  target: "QT",
  cost: "$L",
  time: "CL",
  wind: "WD",
  sweeper: "SW",
  slag: "SL",
  cryo: "CR",
  rebar: "RB",
  volatile: "VL",
  tar: "TR",
  magnetic: "MG",
};

/**
 * The mark's box on the notch line, in CSS px.
 *
 * 18, and it was 9. A 9px box is what the line inherited from the two-letter
 * TEXT code it replaced — the icons were sized to be NARROWER than the code
 * (that is the width argument runNotchTallyHTML's header below makes), and
 * narrower is the one thing a glyph must not optimise for once it is the only
 * thing carrying the meaning. A code can be read at 9px because it is two
 * capitals of a pixel face designed for that size; a 16x16 stroked drawing at
 * 9px is four and a half device-independent pixels of line work, and on the
 * owner's phone the eight-axis line read as a row of coloured specks. Doubling
 * is the ask and doubling is what this is: every axis mark and the Final
 * Inspection's clause glyph render at 2x their previous box.
 *
 * Fixed px rather than an em off the row's own type, deliberately. The row's
 * font-size is `max(6px, 10.7 * --fpx)` and it BOTTOMS OUT at 6px on exactly
 * the devices this fix is for (iPhone 13 mini: --fpx 0.376, so the calc asks
 * for 4px and the floor answers) — an em-sized mark would therefore shrink
 * fastest precisely where it is already illegible. The floor is the point.
 *
 * NOT a size shared with the draft (screens.ts asks axisIconHTML for 15px on a
 * card and 11px in a quota slot, both their own literals against their own
 * boxes — there is no one token to move, which is why doubling here could not
 * silently shrink or grow either of them). It does make the HUD's mark the
 * biggest in the app, and that is the right way round for once: a card is read
 * still, once, at arm's length while the game is paused, and this line is read
 * mid-bay out of the corner of an eye that is watching a falling shipment. The
 * vocabulary is what has to match between the two surfaces — the same glyph
 * for the same axis, which is the rule axisIconHTML exists to keep — not the
 * point size.
 *
 * The height this costs is paid out of the panel's own air; app.css's "one
 * rhythm" note under `.pl-notch b` has the per-device arithmetic.
 */
const NOTCH_MARK_PX = 18;

/**
 * The run's ratchets as ONE DENSE LINE for the plant panel — "WD×2 · SW · CR",
 * axes in ladder order (HAZARDS), a ×N on any axis taken more than once.
 *
 * This used to be a row of 30px chips sharing the build row with the ship
 * plates, and the two could not both fit. The build rack is seven fixed slots
 * that take 205px of the narrowest panel's 209px (see shipPlatesHTML), and a
 * deep run banks up to ten distinct axes — no arrangement of chips fits beside
 * that, so every notch a player had taken lived behind a horizontal scroll
 * they had no reason to know was there.
 *
 * A tally is the same information at a fraction of the width: the chip's
 * 30x25px box carried a 2-letter glyph, a 6-letter name and a badge, and the
 * glyph plus the count is the part that answers "what is this bay doing to
 * me". Seven axes fit the line on the tightest phone at the mark's current
 * size (measured: 180px of tally in the 161px value box of an iPhone 13
 * mini's eight-axis worst case, so the eighth is the first to go), which
 * covers a real run; a deeper one scrolls its own tail, which is the same
 * give-way the pattern manifest beside it uses.
 *
 * The kind colouring survives the shrink, because it is the fastest thing in
 * the row to read: content axes bane-red, number axes tradeoff-amber, so a
 * glance separates "the belt is dirtier" from "the numbers are worse" — they
 * are answered by completely different systems.
 */
export function runNotchTallyHTML(ratchets: Ratchets, final: FinalId | null = null): string {
  const taken = HAZARDS.filter((h) => (ratchets[h.id] ?? 0) > 0);
  const parts = taken.map((h) => {
    const n = ratchets[h.id] ?? 0;
    // The axis's real mark, not its two-letter code — the same glyph the
    // draft's cards deal it by (axisIconHTML), so the bill on the HUD is
    // written in the vocabulary the player signed it in. At NOTCH_MARK_PX it
    // is now WIDER than the code it replaced (18px against ~13px of two
    // pixel-font capitals) rather than narrower; see that constant for why
    // that trade is the right way round. The kind colour still rides the k-
    // class: number-axis icons stroke currentColor, and the material icons
    // keep their own belt colours, which outrank a tint here for the same
    // one-vocabulary reason everywhere else.
    const kind = h.kind === "content" ? "bane" : "tradeoff";
    const stack = n > 1 ? `<span class="pl-notch__n">×${n}</span>` : "";
    return `<span class="pl-notch__ax k-${kind}" title="${h.name} ×${n}">${
      axisIconHTML(h, NOTCH_MARK_PX)
    }${stack}</span>`;
  });
  // The Final Inspection's clause (game/finals.ts) rides the same line, in its
  // own colour, on the one bay it applies to. It belongs here rather than on a
  // row of its own for the reason the tally exists at all: this line answers
  // "what is this bay doing to me", and on the last bay the clause is the
  // loudest thing on that list. Named in full on the title; the glyph is the
  // SHIP SYSTEM the clause examines — the same icon its card wore at the
  // inspection (FinalDef.system doubles as an IconName, as the refit shelf
  // already relies on).
  const def = final ? finalById(final) : undefined;
  if (def) {
    parts.push(
      `<span class="pl-notch__ax k-final" title="Final Inspection — ${def.name}: ${def.desc}">${
        icon(def.system as IconName, NOTCH_MARK_PX)
      }</span>`,
    );
  }
  // An em-dash rather than an empty row: the line is rendered on every Deep
  // Run bay including the first, where no notch has been taken yet, and a row
  // that appears halfway through a run shifts every row above it. Same idiom
  // the pattern manifest uses for an empty queue.
  //
  // No · separators between entries any more — they earned their keep between
  // two-letter TEXT codes, where "WDSL" needed cutting, but an icon chip is
  // its own boundary and the row's flex gap already spaces them; between
  // glyphs the dots read as noise (the owner's pass).
  if (!parts.length) return `<span class="pl-notch__none">—</span>`;
  return parts.join("");
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
 * Compact ship-refit readout for the HUD: one small plate per SLOT, tier as
 * pips, mounted systems in UPGRADES order followed by the open slots.
 *
 * THE RACK IS THE RIG NOW, NOT THE CATALOGUE, and that is the change PR #156
 * asked for in as many words. Every track used to render, installed or not, on
 * the reasoning that an unbought plate is information ("nothing in the magazine
 * yet"). That reasoning was right while the roster and the rack were the same
 * object; it stopped being right when the roster reached ten and the stylesheet
 * had to record that proportional shaving was finished — "the eleventh system
 * needs a different rack".
 *
 * A slot-limited rack IS that different rack. The row's width is now the RIG's
 * slot count (game/meta.ts's SLOT_BASE..SLOT_CAP) instead of `UPGRADES.length`,
 * so the roster is free to grow past ten without the row growing at all — the
 * eleventh system competes for a slot rather than for 19 more pixels on an
 * iPhone 13 mini. And at every width below the cap the row gets AIR back: a
 * four-slot rack is four plates where the same panel was drawing ten.
 *
 * WHAT SURVIVES from the fixed-slot argument, because it is the half that was
 * never about the count. The rack must not RE-FLOW mid-run — "a readout whose
 * items move is one the eye has to re-find rather than glance at" — and it
 * cannot: the mounted set is fixed at undock (meta.ts's safeLoadout masks the
 * loadout once, and run.ts's buyUpgrade refuses to install at a refit stop), so
 * a purchase at the yard lights a pip on a plate that was already there.
 *
 * AN OPEN SLOT IS STILL INFORMATION, and better information than the old empty
 * plate was. That one named a system the player had not bought; this one says
 * the rig has room, which is a thing they can act on before the next undock.
 *
 * `slots` is a FLOOR on the width, never a cap: the row draws every mounted
 * system whatever it says, and only the trailing open slots come from it. So
 * the worst this argument can be wrong about is a missing empty box — the rack
 * can never hide a system the rig is carrying. sim/systems.ts pins that.
 *
 * WHY THE PLATE WEARS THE TRACK'S ICON AND NOT ITS THREE-LETTER CODE. Seven
 * codes fit; eight did not, by 17px on the tightest phone and 29px on a tablet
 * (sim/uifit's `rack` assertion, measured when the Thaw Lance's THW arrived).
 * A code is 3.06 glyph-ems wide inside a 4.44-em box (app.css's SLOT WIDTH AT
 * COMPACT has the arithmetic) and every phone in the matrix already sat on both
 * of its floors, so there was nothing left to shave off the type.
 *
 * The answer was already in the tree. icons.ts says why the refit cards stopped
 * using these codes: they "were text pretending to be glyphs — they needed
 * reading rather than recognising". The rack was the last surface still asking
 * a player to read BAY / LCH / HYD mid-bay out of the corner of an eye, and one
 * icon on a square box is both narrower than three capitals and the SAME mark
 * the refit card, the Workshop shelf and the Final Inspection's clause chip
 * already use for that system. So the eighth slot is paid for by the plate
 * becoming more legible rather than less — and the app now has one vocabulary
 * per system everywhere instead of one everywhere but here.
 *
 * UpgradeDef.glyph survives: sim/marks.ts prints rigs as `bay2 lau2 hyd2` in a
 * terminal, where a code is exactly the right thing and an SVG is not.
 *
 * See game/upgrades.ts for the tracks, and screens.ts's hudHTML for placement.
 */
/** The rack mark's box, in px.
 *
 *  Smaller than the notch line's NOTCH_MARK_PX (18) and deliberately so: that
 *  line answers "what is this bay doing to me" and is read mid-shot, while the
 *  rack answers "what have I built" and is read at a refit stop or a glance
 *  between shots. It is also what the eighth slot is paid out of — see the
 *  header.
 *
 *  13 -> 11 for the TENTH slot, with app.css's .ship-plate__g and .ship-plate,
 *  all three in the same proportion so the mark keeps the air it has always had
 *  (the arithmetic is in the stylesheet, beside the assertion that holds it).
 *  The stylesheet is what actually sizes the drawn mark — the SVG takes its box
 *  in ems — so this number is the AUTHORED size rather than the rendered one,
 *  and it is kept in step so the two never disagree about what a rack mark is.
 *  The refit card draws its own at 13 still: that surface has six cards and all
 *  the room in the world, and matching it here would put a phone-sized
 *  constraint on a screen that does not have one. */
const PLATE_MARK_PX = 11;

export function shipPlatesHTML(tiers: UpgradeTiers, slots = 0): string {
  // ONE BLOCK, not N siblings of the ability chips, and that is how the NINTH
  // slot is paid for. The rack is a single readout — "what I have built" — and
  // the chips beside it are controls; at seven slots the row could afford to
  // space the two identically, and at nine it cannot. Grouping lets the gaps
  // BETWEEN plates fall to a hairline, because they now separate cells of one
  // object, while the row's own gap still holds that object clear of the
  // controls at full width.
  //
  // Measured on the two windows that overflowed: the narrowest phone panel in
  // the matrix (209px) was 21px short, and 800x600 — the one window that shows
  // three ability chips beside a full rack — was 18px short. Eight gaps at
  // 4.03px became eight at 2px, which is 16px, and the compact clamp below it
  // pays the rest.
  // ABOARD is "tier > 0", which is the same test the rest of the run already
  // uses for "the ship carries this" (run.ts's buyUpgrade refuses to raise a
  // tier-0 track). Nothing here has to know what a slot is — meta.ts's
  // safeLoadout has already masked the stowed systems to 0 on the way into the
  // run, so a rack drawn from the tiers is the rack the rig undocked with.
  const aboard = UPGRADES.filter((u) => (tiers[u.id] ?? 0) > 0);
  const plates = aboard.map((u) => {
    const tier = Math.min(MAX_TIER, tiers[u.id] ?? 0);
    const pips = Array.from({ length: MAX_TIER }, (_, i) =>
      `<i class="${i < tier ? "on" : ""}"></i>`,
    ).join("");
    // The id IS the icon name, the convention every other track surface uses
    // (icons.ts's note on the upgrade block, and refitScreen's card header,
    // which casts at the call site exactly like this).
    return `<div class="ship-plate" title="${u.name} — tier ${tier}">
        <span class="ship-plate__g">${icon(u.id as IconName, PLATE_MARK_PX)}</span>
        <span class="ship-plate__pips">${pips}</span>
      </div>`;
  }).join("");
  // The trailing OPEN slots. Clamped to the cap at the top and to what is
  // already aboard at the bottom, so the width is a floor rather than a
  // truncation (see the header) and no arithmetic here can draw a negative
  // number of boxes.
  const width = Math.min(UPGRADES.length, Math.max(aboard.length, Math.floor(slots)));
  // The same box, drained, and carrying NO mark — which is the one way this
  // differs from the old unbought plate. That one wore the glyph of the system
  // the player had not bought yet, because the slot WAS that system's slot. An
  // open slot belongs to no system, so a mark on it would be naming one
  // arbitrarily; the box itself is the whole message.
  const open = `<div class="ship-plate ship-plate--open" title="Open slot — nothing mounted"></div>`
    .repeat(Math.max(0, width - aboard.length));
  return `<div class="ship-rack">${plates}${open}</div>`;
}
