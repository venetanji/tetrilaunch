import { PILE_TIERS } from "../game/level";
import { MATERIAL_SPEC, PIECE_COLORS } from "../game/theme";
import { pieceCells } from "../game/pieces";
import { iconGroup } from "./icons";
import type { Lesson } from "../game/school";

/**
 * THE LESSON PICTOGRAM — a Flight School card's exercise, drawn.
 *
 * WHY IT EXISTS. The ladder's cards were correct and unread. The owner's
 * verdict after playing was that people do not read text as much, and the
 * sentences that cost the most were the ones DESCRIBING GEOMETRY the player was
 * already looking at: "the notch is two wide and two deep, and the square fills
 * it exactly" is thirteen words spent redrawing a board in prose. A picture of
 * the board says it in one glance and leaves the sentence free to say the one
 * thing a picture cannot — what to DO.
 *
 * WHY IT IS GENERATED, NEVER DRAWN PER LESSON. Nine hand-drawn strips would be
 * nine drawings that agree with the bays on the day they were made and drift
 * from them on the first tune. Every mark below comes out of the SAME fields
 * levelForLesson builds the bay from — `wall`, `wallMaterial`, `sequence` — so
 * a reshaped profile reshapes its own picture, and sim/systems.ts pins exactly
 * that: change a lesson's wall and its pictogram must change with it.
 *
 * THE THREE PICTURES, and the field that selects each:
 *
 *   a gold wall   the SET PIECE. Columns at their authored heights, the gap
 *                 drawn as a dashed target in the aim cyan, the dealt shape in
 *                 the orientation that fits it, and an arc from the cannon.
 *                 `wallMaterial: "gold"` is the right predicate rather than
 *                 "has a wall": gold is what says "the answer goes here" (the
 *                 scaffolding note in school.ts), and it is also what turns
 *                 boardResets on, so the bays that HAVE a target are exactly
 *                 the bays this picture is true of.
 *   a plain wall  CONGESTION. Clutter's pile is standard, not gold — there is
 *                 no authored answer in it, only a bay that is already full —
 *                 so the picture is the crowded floor and the tax it is
 *                 charging (level.ts's PILE_TIERS[0]).
 *   no wall       THE MISS. Lost Cargo deals onto an empty floor, so there is
 *                 no gap to point at; what the card is about is a cube stopping
 *                 short of the bar, which is what gets drawn.
 *
 * ON SCREEN, SLOT ORDER IS REVERSED. `wall[0]` is the column nearest the wall
 * (drills.ts: "indexed from the wall outward") and the wall is at the far end
 * from the cannon, so the array reads right-to-left on a picture whose cannon
 * is on the left. Getting this backwards would mirror Lob or Skim — the one
 * lesson whose whole subject is which END a gap is at — and nothing else would
 * look wrong.
 *
 * CHEAP ON PURPOSE. No filters, no gradients, no per-frame anything: a handful
 * of <rect>s and one <path>. The single animation is a CSS opacity pulse on the
 * target outline (app.css's `.lart__target`), which reduced motion turns off —
 * the outline is dashed and cyan whether or not it breathes, so the teaching
 * survives losing the theatre.
 */

/* ---------------------------------------------------------------------------
 * THE BOX. Drawn on a 88x32 grid for the same reason icons.ts draws on 16x16 —
 * integer coordinates, straight runs, and a fixed viewBox so the strip's height
 * is ours rather than the type's. The card scales it with `--coach-px` like
 * everything else it holds.
 * ------------------------------------------------------------------------- */
const VB_W = 88;
const VB_H = 32;
/** The floor every picture stands on, and the far wall it is anchored to. */
const FLOOR_Y = 29;
const WALL_X = 86;
/** Column pitch. Eight of them reach from the bar to the wall, which is what
 *  compactorMinLineCells means on a real board: the press's full-advance stop
 *  is exactly the width of the standing pile a lesson may author. */
const COL = 7;
/** Left edge of the eight-column band — derived, so a profile that ever grows
 *  past eight columns moves the bar rather than overflowing the box. */
const bandX = (cols: number): number => WALL_X - cols * COL;
/** The press face, immediately left of the band: everything right of it is the
 *  zone (lineClear.ts's zoneGrid measures exactly this span). */
const BAR_W = 3;
/** Vertical room the pile and the shipment above it have to share. */
const BAND_H = 25;
/** Air between the top of the pile and the bottom of the shipment hanging over
 *  it. A shipment resting ON the pile is a picture of one that has already
 *  landed, which is the opposite of what every card is asking for. */
const SHIP_AIR = 3.5;
/** The band across the TOP of the congestion picture that its price tag owns.
 *  Reserved out of the pile's height rather than taken beside it, because a
 *  text run's width cannot be measured from here and a tag with the whole box
 *  to grow from cannot be clipped by a font substitution — see `taxed`. */
const TAG_BAND = 11;

/** One clockwise quarter-turn about the 4x4 grid centre, the same convention
 *  components.ts's preview and pieces.ts's world rotation both use. Duplicated
 *  rather than imported because the preview's copy is private to that module
 *  and this one needs the cells, not the markup. */
function rotateCW([x, y]: [number, number]): [number, number] {
  return [3 - y, x];
}

/** Cells normalised so the shape's bounding box starts at (0, 0) — which is
 *  what a drawing wants, as opposed to the preview's centre-in-a-4x4-box. */
function normalise(cells: [number, number][]): [number, number][] {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

/** The dealt shape in the FEWEST turns that fit `width` columns.
 *
 *  This is the whole rotation lesson stated as arithmetic: a flat I is four
 *  wide, so a one-column well admits it only on its end, and the picture says
 *  so without being told which lesson it is drawing. Falls back to unrotated
 *  when nothing fits, which is a picture of a shipment that does not go in —
 *  also true, and better than silently drawing a lie. */
function fittedShape(type: Parameters<typeof pieceCells>[0], width: number): {
  cells: [number, number][]; w: number; h: number;
} {
  let best: [number, number][] | null = null;
  let cells = pieceCells(type, "std").map((c) => [...c] as [number, number]);
  for (let turn = 0; turn < 4; turn++) {
    const norm = normalise(cells);
    const w = Math.max(...norm.map(([x]) => x)) + 1;
    if (w <= width) { best = norm; break; }
    if (turn === 0) best = norm;
    cells = cells.map(rotateCW);
  }
  const out = best ?? [[0, 0]] as [number, number][];
  return {
    cells: out,
    w: Math.max(...out.map(([x]) => x)) + 1,
    h: Math.max(...out.map(([, y]) => y)) + 1,
  };
}

/** Contiguous runs of empty columns in SCREEN order (left to right), which is
 *  the reverse of slot order. Each run is a hole a shipment can be put in. */
function gapRuns(screen: number[]): Array<{ start: number; len: number }> {
  const runs: Array<{ start: number; len: number }> = [];
  let i = 0;
  while (i < screen.length) {
    if (screen[i] > 0) { i++; continue; }
    let j = i;
    while (j < screen.length && screen[j] === 0) j++;
    runs.push({ start: i, len: j - i });
    i = j;
  }
  return runs;
}

/**
 * Which gap this CARD is about.
 *
 * Ordered FAR FIRST — descending screen x, i.e. ascending slot index — and
 * indexed by the card. On every set piece but one there is a single gap and
 * both cards point at it. On Lob or Skim there are two, and its deck is written
 * in that order on purpose: card 1 is "The lob" (the far gap, behind the pile)
 * and card 2 is "The skim" (the near one, open to the cannon). So the picture
 * follows the deck rather than the deck following a hard-coded picture.
 */
function targetRun(
  runs: Array<{ start: number; len: number }>,
  card: number,
): { start: number; len: number } | null {
  if (runs.length === 0) return null;
  const far = [...runs].sort((a, b) => b.start - a.start);
  return far[Math.min(Math.max(0, card), far.length - 1)];
}

/** THE WALL'S OWN COLOUR, out of theme.ts — the same table render.ts tints a
 *  real cube from. A hex typed here would be a second opinion about what gold
 *  looks like, and the first re-tune would make it the wrong one.
 *
 *  `standard` has a null colour in MATERIAL_SPEC on purpose: an ordinary cube
 *  is tinted by its SHAPE, not its material. A standing pile has no one shape,
 *  so the muted ink is the right answer rather than a fallback — anonymous
 *  cargo, which is exactly what a congested bay's floor is. */
function wallInk(lesson: Lesson): string {
  return MATERIAL_SPEC[lesson.wallMaterial ?? "standard"].color ?? "var(--text-muted)";
}

/** A cube, drawn the way the bay draws one: a filled block with a lighter
 *  inset, so a pile of them reads as cargo rather than as a bar chart.
 *
 *  WIDTH AND HEIGHT SEPARATELY, because a lesson's rows and its columns are
 *  budgeted separately. The column pitch is fixed at COL — eight of them span
 *  the press's stop, and that is not negotiable — while the row pitch shrinks
 *  to fit however tall the pile plus the shipment above it turns out to be. A
 *  single square `size` had to take the smaller of the two, which drew Four in
 *  the Well (a 4-tall shipment, so a 4-unit row) as 3.5-wide chips floating in
 *  7-wide columns: a board with gaps between every cube, i.e. a picture of a
 *  bay that is not the one being flown. */
function cube(x: number, y: number, w: number, h: number, fill: string, opacity = 1): string {
  const i = Math.min(w, h) * 0.24;
  const o = opacity < 1 ? ` opacity="${opacity}"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.6" fill="${fill}"${o}/>`
    + `<rect x="${x + i}" y="${y + i}" width="${w - i * 2}" height="${h - i * 2}"`
    + ` rx="0.4" fill="rgba(255,255,255,0.18)"${o}/>`;
}

/** The floor, the far wall and the press face — the three marks every picture
 *  shares, because they are the three fixtures every bay shares. */
function stage(cols: number, barTop: number): string {
  const bx = bandX(cols);
  return `<path d="M2 ${FLOOR_Y + 0.5}H${WALL_X}" stroke="var(--line)" stroke-width="1"/>`
    + `<path d="M${WALL_X + 0.5} ${FLOOR_Y}V6" stroke="var(--line)" stroke-width="1"/>`
    + `<rect x="${bx - BAR_W - 1}" y="${barTop}" width="${BAR_W}" height="${FLOOR_Y - barTop}"`
    + ` rx="0.5" fill="var(--danger)"/>`;
}

/* ---------------------------------------------------------------------------
 * THE CANNON, and it is icons.ts's own `launcher` rather than a second drawing
 * of one. That glyph is already on the plant panel's launch readout meaning
 * "the thing that fires"; a picture of the cannon that was not the cannon glyph
 * would be the icon set's first two-drawings-of-one-object.
 *
 * SCALED TO 13 UNITS and parked at the left edge, which leaves it clear of the
 * press face at bandX - 4. At 16 it overlapped the bar and the first two
 * columns on every board — measured off the generated strips.
 * ------------------------------------------------------------------------- */
const CANNON_SIZE = 13;
const CANNON_X = 1;
const CANNON_Y = FLOOR_Y - CANNON_SIZE - 1;

function cannon(): string {
  return `<g color="var(--text-muted)">`
    + `${iconGroup("launcher", CANNON_X, CANNON_Y, CANNON_SIZE / 16)}</g>`;
}

/** Where an arc leaves. The launcher glyph's muzzle is the filled triangle at
 *  (11..14, 2..5) of its 16x16 grid, so this is that corner mapped onto the
 *  board — derived rather than eyeballed, so a re-scaled cannon takes its own
 *  arc with it. */
const MUZZLE = {
  x: CANNON_X + 12.5 * (CANNON_SIZE / 16),
  y: CANNON_Y + 3.5 * (CANNON_SIZE / 16),
};

/**
 * THE SET-PIECE PICTURE: board, target, shipment, arc.
 */
function setPiece(lesson: Lesson, card: number): string {
  const wall = lesson.wall ?? [];
  // Slot order reversed — see the header. wall[0] is the column at the far
  // wall, which is the RIGHTMOST column on a cannon-left picture.
  const screen = [...wall].reverse();
  const cols = screen.length;
  const bx = bandX(cols);
  const maxWall = Math.max(1, ...screen);
  const run = targetRun(gapRuns(screen), card);
  const type = lesson.sequence?.[0] ?? "O";
  const shape = fittedShape(type, run?.len ?? 4);

  // ONE ROW PITCH FOR THE PILE AND THE SHIPMENT, sized so both fit the band
  // stacked WITH THE AIR BETWEEN THEM. A shipment drawn at a different scale
  // from the board it is about to enter would be a picture of a piece that does
  // not fit; a shipment resting ON the pile would be a picture of one that has
  // already landed. Four in the Well is the case that sets this — a 2-deep pile
  // under a 4-tall shipment is six rows plus the gap in a 25-unit band.
  const rowH = Math.max(2.5, Math.min(6, (BAND_H - SHIP_AIR) / (maxWall + shape.h)));
  const cubeW = COL - 1;
  const cubeH = rowH - 0.6;

  const fill = wallInk(lesson);
  let pile = "";
  for (let s = 0; s < cols; s++) {
    for (let r = 0; r < screen[s]; r++) {
      pile += cube(bx + s * COL + 0.5, FLOOR_Y - (r + 1) * rowH, cubeW, cubeH, fill);
    }
  }

  // THE TARGET. The hole's real footprint — the run's width by the height of
  // the pile beside it — as a dashed outline in the aim cyan. Dashed rather
  // than filled because it is the one thing on the strip that is NOT there yet.
  let target = "";
  let aimX = bx + cols * COL * 0.5;
  if (run) {
    const tx = bx + run.start * COL;
    const th = maxWall * rowH;
    aimX = tx + (run.len * COL) / 2;
    target = `<rect class="lart__target" x="${tx + 0.5}" y="${FLOOR_Y - th}"`
      + ` width="${run.len * COL - 1}" height="${th}" rx="1"`
      + ` fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="2 2"/>`;
  }

  // The shipment, hanging over its target in the orientation that fits. Clamped
  // into the band so a tall one (the upended I) cannot climb out of the box.
  const shipTop = Math.max(
    3, FLOOR_Y - maxWall * rowH - SHIP_AIR - shape.h * rowH,
  );
  const shipLeft = aimX - (shape.w * COL) / 2;
  let ship = "";
  for (const [x, y] of shape.cells) {
    ship += cube(
      shipLeft + x * COL + 0.5, shipTop + y * rowH, cubeW, cubeH, PIECE_COLORS[type],
    );
  }

  // THE ARC, and its height is derived rather than chosen: a lob is what you
  // need when something stands between the cannon and the landing, a skim is
  // what you use when nothing does. That is exactly the difference Lob or Skim
  // is named for, and it falls out of the profile without the lesson saying so.
  const blocked = screen.slice(0, run?.start ?? 0).some((h) => h > 0);
  const endX = shipLeft + (shape.w * COL) / 2;
  const endY = Math.max(2.5, shipTop - 3.5);
  const apexY = Math.max(1.5, blocked ? endY - 5 : endY - 0.5);
  const arc = `<path class="lart__arc" d="M${MUZZLE.x.toFixed(1)} ${MUZZLE.y.toFixed(1)}`
    + ` Q${((MUZZLE.x + endX) / 2).toFixed(1)} ${apexY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}"`
    + ` fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="2 2.5" opacity="0.75"/>`
    // The head points DOWN into the target, which is the direction the shipment
    // travels once the arc has delivered it.
    + `<path d="M${(endX - 2.2).toFixed(1)} ${(endY - 1).toFixed(1)}`
    + `L${endX.toFixed(1)} ${(endY + 1.6).toFixed(1)}`
    + `L${(endX + 2.2).toFixed(1)} ${(endY - 1).toFixed(1)}"`
    + ` fill="none" stroke="var(--accent)" stroke-width="1.4"/>`;

  return stage(cols, FLOOR_Y - Math.max(2, maxWall) * rowH)
    + pile + target + ship + arc + cannon();
}

/**
 * THE MISS: a shipment that stops short of the bar, and the fine on it.
 *
 * Drawn for the bay with no wall at all. There is no gap to aim into on Lost
 * Cargo — it deals an ordinary 7-bag onto an empty floor — so the picture is
 * the event the card is about rather than the board it happens on: cargo on the
 * WRONG side of the press face, blinking away under a red minus.
 *
 * NO FIGURE ON THE MINUS. The card states the price and derives it from
 * penaltyPerLostPieceFor; a second copy of it here would be a second place for
 * that number to go stale, which is the whole reason this module computes
 * nothing it can read.
 */
function theMiss(): string {
  const cols = 8;
  const bx = bandX(cols);
  const rowH = 6;
  const cubeW = COL - 1;
  // Two cubes safely in the zone, so the picture has a right answer in it as
  // well as a wrong one.
  let safe = "";
  for (const s of [5, 6]) {
    safe += cube(bx + s * COL + 0.5, FLOOR_Y - rowH, cubeW, rowH - 0.6, "var(--text-muted)");
  }
  // ...and one that did not get there. Ghosted and ringed, because a lost cube
  // blinks out rather than settling (game.ts's chargeLostCubes).
  // FLUSH AGAINST THE WRONG SIDE OF THE BAR, which is the whole picture: a
  // cube one column further right would have been in the zone and paid. Parked
  // any further left it reads as cargo in mid-air rather than as a near miss.
  const lostX = bx - BAR_W - 2 - cubeW;
  const lostY = FLOOR_Y - rowH;
  const lost = cube(lostX, lostY, cubeW, rowH - 0.6, "var(--danger)", 0.4)
    + `<rect x="${lostX - 1}" y="${lostY - 1}" width="${cubeW + 2}" height="${rowH + 1.4}"`
    + ` rx="1" fill="none" stroke="var(--danger)" stroke-width="1" stroke-dasharray="2 2"/>`;
  const minus = `<text class="lart__tag" x="${lostX + cubeW / 2}" y="${lostY - 3.5}"`
    + ` text-anchor="middle" fill="var(--danger)">−$</text>`;
  // A SHORT, FLAT ARC — the shot that did not carry. An apex up at the top of
  // the box would draw a lob, which is the arc that almost never spills and so
  // the wrong picture for the card that is about spilling.
  const arc = `<path class="lart__arc" d="M${MUZZLE.x.toFixed(1)} ${MUZZLE.y.toFixed(1)}`
    + ` Q${((MUZZLE.x + lostX) / 2).toFixed(1)} ${lostY - 13} ${(lostX + cubeW / 2).toFixed(1)} ${lostY - 8}"`
    + ` fill="none" stroke="var(--danger)" stroke-width="1.2" stroke-dasharray="2 2.5" opacity="0.7"/>`;
  return stage(cols, FLOOR_Y - 2 * rowH) + safe + lost + minus + arc + cannon();
}

/**
 * THE TAXED BAY: the congestion profile as it actually stands, plus the price.
 *
 * Drawn for a lesson with a wall that is NOT gold — a pile with no answer in
 * it. The columns are the live ones (drills.ts's CONGESTED, itself sized
 * against PILE_TIERS[0].cubes), so a re-sized congestion profile re-draws this
 * strip; the badge quotes the launch multiplier out of the same constant the
 * card interpolates, so the two can never disagree.
 *
 * The badge sits ABOVE the cannon rather than beside it: the tax is charged on
 * the SHOT (which is the whole of the second card), so the price belongs on the
 * thing that fires, not on the pile that caused it.
 */
function taxed(lesson: Lesson): string {
  const screen = [...(lesson.wall ?? [])].reverse();
  const cols = screen.length;
  const bx = bandX(cols);
  const maxWall = Math.max(1, ...screen);
  // THE PILE GIVES THE TAG A BAND, rather than the tag squeezing in beside the
  // pile. A congested profile is seven cubes tall and would otherwise reach
  // y=4 in its very first screen column, which leaves the price nowhere to go
  // but into the narrow strip left of the press face — see the note on the tag
  // below for what that cost. Squat bricks are also the honest drawing: this is
  // a bay that is FULL, not a bay with structure in it.
  const rowH = Math.max(1.8, Math.min(5, (BAND_H - TAG_BAND) / maxWall));
  const cubeW = COL - 1;
  const cubeH = Math.max(1.2, rowH - 0.5);
  let pile = "";
  for (let s = 0; s < cols; s++) {
    for (let r = 0; r < screen[s]; r++) {
      pile += cube(bx + s * COL + 0.5, FLOOR_Y - (r + 1) * rowH, cubeW, cubeH, wallInk(lesson));
    }
  }
  // THE PRICE, CENTRED IN ITS OWN BAND, and the centring is the whole fix.
  //
  // Three arrangements failed before this one, all for the same reason: the
  // width of a text run is not knowable from here. A box drawn to a guessed
  // width could not hold "×1.25" in the pixel face; a `levy` glyph in front of
  // the figure pushed it into the pile; and right-aligning it into the strip
  // left of the press face passed on Chromium and clipped 20px off the left of
  // the drawing on WebKit, where the pixel font falls back to something wider.
  //
  // So the tag gets the full width of the box and grows from the middle of it.
  // At 7 units of type in an 88-unit viewBox it would have to be five times its
  // Chromium width to reach an edge, which is not a thing a font substitution
  // does. The amber and the crowded floor under it say "tax"; the figure says
  // how much, out of the same PILE_TIERS[0] the card interpolates.
  const badge = `<text class="lart__tag" x="${VB_W / 2}" y="${TAG_BAND - 2}"`
    + ` text-anchor="middle" fill="var(--warn)">×${PILE_TIERS[0].costMult}</text>`;
  return stage(cols, FLOOR_Y - Math.min(maxWall, 3) * rowH) + pile + badge + cannon();
}
/**
 * The strip for one card of one lesson.
 *
 * `card` selects the target gap on a board that has more than one (see
 * targetRun); everything else is a function of the lesson alone, which is what
 * makes the picture a restatement of the bay rather than a second opinion
 * about it.
 */
export function lessonPictogramHTML(lesson: Lesson, card = 0): string {
  const art = lesson.wall === undefined
    ? theMiss()
    : lesson.wallMaterial === "gold"
      ? setPiece(lesson, card)
      : taxed(lesson);
  // `aria-hidden`, on icons.ts's own terms: every caller pairs the drawing with
  // the sentence it illustrates, and this one sits inside a `aria-live="polite"`
  // card that re-announces itself on every advance — so a labelled image here
  // would read the lesson's name aloud in front of the instruction, every card,
  // for no information a listener does not already have.
  return `<svg class="lart" viewBox="0 0 ${VB_W} ${VB_H}"`
    + ` aria-hidden="true" focusable="false">${art}</svg>`;
}
