// Canvas-side palette. Mirrors src/styles/tokens.css (design-system single source).
import type { ClearGrade } from "./grades";

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
 *                 worse than an empty one. The answer is a soft landing — a
 *                 low-power lob, since launch power is what moves impact speed
 *                 (see lineClear.ts's VOLATILE_TRIGGER_SPEED) — or deliberately
 *                 chaining it into a pile you wanted gone anyway. Press
 *                 Hydraulics does NOT help here; settleAssist only grinds cubes
 *                 that have already stopped.
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
  // Hot structural red-orange. It was #ff8a1f until a CIEDE2000 audit of the
  // whole field caught it 2.0 from the L shipment's own #ff8a00 — under the
  // just-noticeable-difference threshold, i.e. the same colour. A rigid
  // shipment that looked exactly like an ordinary L is the worst failure this
  // table can have, and no colour-blindness was needed to hit it.
  //
  // #e54c00 was picked by searching HSV space for the hex with the largest
  // WORST-CASE distance from all twelve other swatches, scored under normal,
  // deuteranopia and protanopia at once. It takes rebar/standard-L from 2.0 to
  // 17.9 and — the reason this hue and not another — rebar/volatile from 17.0
  // to 33.3 under deuteranopia, which is the pair that reads as identical to a
  // red-green-deficient player.
  //
  // That search also proved the palette is FULL: the best hex available
  // anywhere reaches a worst case of only 21, and only by going dark enough to
  // impersonate tar. There is no thirteenth colour, which is why MATERIAL_GLYPH
  // below exists and why it is not optional.
  rebar: { name: "Rebar", color: "#e54c00", countsForLines: true, needsStrike: false, rigid: true },
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

/**
 * The colour a shipment is DRAWN in: its material's, or its shape's when the
 * material is standard. Every preview of a shipment has to agree on this —
 * the belt tile, the transport's own lighting, the muzzle ghost — because the
 * whole point of showing a material before it fires is that the player can
 * sequence around it. Pulled out of components.ts's pieceCellsHTML so a second
 * caller cannot quietly drift from the first.
 */
export function shipmentColor(type: PieceType, material: Material = "standard"): string {
  return MATERIAL_SPEC[material].color ?? PIECE_COLORS[type];
}

/**
 * MATERIAL GLYPHS — the material's identity as a SHAPE.
 *
 * Colour cannot carry this any more, and that is a measured claim rather than a
 * preference. Thirteen swatches share this field (seven shipment colours and six
 * material colours) on one near-black backdrop, and a CIEDE2000 sweep of all of
 * them found rebar sitting 2.0 from a standard L, and slag, tar and magnetic
 * clustered inside 13 of each other once shipmentAura lifts the dim two into
 * visibility. Searching the whole HSV space for a better thirteenth colour
 * returned a best worst-case of 21 — no better than pairs players already report
 * as indistinguishable. The palette is full. Shape is the channel that is left.
 *
 * So every non-standard material owns a glyph, and the glyph is what IDENTIFIES
 * it; colour drops to a first-glance hint that nothing depends on alone. That
 * is also why there is no "colour-blind mode" toggle guarding these: the
 * collisions above are present for ordinary vision too, so a build without the
 * glyphs is broken for everyone and gating them would ship the broken one by
 * default.
 *
 * The six are deliberately different SILHOUETTE CLASSES, not merely different
 * drawings — ringed-and-slashed, radial needles, orthogonal lattice, solid mass,
 * interlocked loops, closed arch. Two glyphs that differ only in detail collapse
 * at belt-tile size and in peripheral vision, which is exactly where they are
 * read. Volatile is the only FILLED one because mass reads as danger faster than
 * outline does, and volatile is the material whose cost lands on cubes that were
 * already safely down.
 *
 * Authored once, as SVG path data in a 24x24 box centred on (12, 12), because
 * both consumers can eat it directly: the canvas renderer builds a Path2D from
 * `d`, and the DOM previews drop it into a `<path>`. A glyph drawn twice is a
 * glyph that drifts.
 */
export interface MaterialGlyph {
  /** SVG path data, 24x24 box, centred on (12, 12). */
  d: string;
  /** Stroke width in that same 24-unit space, or 0 to fill the path instead. */
  stroke: number;
}

export const MATERIAL_GLYPH: Record<Exclude<Material, "standard">, MaterialGlyph> = {
  // Ringed and struck through — the international "not this one" mark, for the
  // one material that can never fill a slot.
  slag: {
    d: "M4.4 12A7.6 7.6 0 1 0 19.6 12A7.6 7.6 0 1 0 4.4 12M6.6 17.4L17.4 6.6",
    stroke: 2.6,
  },
  // Frost needles, the same six-spoke star the cube face has carried since cryo
  // shipped (render.ts's drawFrost) — this is that mark promoted to the belt.
  cryo: { d: "M12 3.6V20.4M4.7 7.8L19.3 16.2M4.7 16.2L19.3 7.8", stroke: 2.6 },
  // Reinforcing lattice. The only orthogonal glyph, so it separates from the two
  // radial ones (cryo, volatile) by silhouette rather than by line count.
  rebar: { d: "M9 3.8V20.2M15 3.8V20.2M3.8 9H20.2M3.8 15H20.2", stroke: 2.6 },
  // Detonation burst, and the only solid one. See the note above on mass.
  volatile: {
    d: "M12 1.5L14.6 8.2L20.6 4.4L17.2 10.6L23.5 12L17.2 13.4L20.6 19.6L14.6 15.8"
      + "L12 22.5L9.4 15.8L3.4 19.6L6.8 13.4L0.5 12L6.8 10.6L3.4 4.4L9.4 8.2Z",
    stroke: 0,
  },
  // Two links welded through each other — the joint a Bond Breaker will not
  // split, which is the whole of what tar is.
  tar: {
    d: "M7.4 7.2H9.4A4.8 4.8 0 0 1 9.4 16.8H7.4A4.8 4.8 0 0 1 7.4 7.2Z"
      + "M14.6 7.2H16.6A4.8 4.8 0 0 1 16.6 16.8H14.6A4.8 4.8 0 0 1 14.6 7.2Z",
    stroke: 2.6,
  },
  // A horseshoe magnet, drawn heavy so the closed arch reads as one mass rather
  // than as another set of radiating lines.
  magnetic: { d: "M5.4 19V12a6.6 6.6 0 0 1 13.2 0V19", stroke: 3.6 },
};

/**
 * Materials whose glyph is drawn on the CUBE, once it is lying in the bay.
 *
 * Not the same question as "does this material need a glyph in the preview" —
 * every one of them does, because every one of them changes how you aim. This
 * asks a narrower thing: after it has landed, do you still make decisions about
 * THIS cube? Slag yes, you have to find it again to aim a charge at it. Volatile
 * yes, you have to know which already-landed cubes will chain. Rebar yes, that
 * row cannot be squeezed and needs a Bond Breaker. Tar yes, so a Bond Breaker is
 * not wasted on a weld that will not break.
 *
 * Magnetic is the one that is genuinely done: its whole effect happens as it
 * settles, and afterwards it is an ordinary cube. Giving it a permanent mark
 * would be noise on a pile that is already carrying four other marks.
 *
 * Cryo is absent for the opposite reason — it already has a bay treatment that
 * says something this one cannot. render.ts's drawFrost vanishes the instant the
 * cube is struck, so the frost encodes the struck/unstruck STATE rather than the
 * material, and that state is the only thing worth knowing about a landed cryo
 * cube. A static glyph would say less, not more.
 */
export const BAY_GLYPH_MATERIALS: Material[] = ["slag", "rebar", "volatile", "tar"];

/**
 * Ink for a glyph drawn on top of `hex` — near-black on a light material, near-
 * white on a dark one.
 *
 * Arithmetic rather than a column in MATERIAL_GLYPH for the same reason
 * shipmentAura is: the glyph is drawn on the material colour in the bay but on
 * the AURA colour in a belt badge, so a hand-picked ink would need two values
 * per material and a rule for which applies. Relative luminance answers both
 * from whatever it is actually being drawn on.
 *
 * The 0.42 threshold sits between tar (0.13) and slag (0.42 lifted, 0.28 raw) on
 * one side and cryo, volatile and rebar on the other — the gap is wide, so this
 * is not a knife-edge.
 */
export function glyphInk(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.42 ? "#07070f" : "#eaeaff";
}

/** How bright the brightest channel of a telegraph colour has to be, as a
 *  fraction of full. Below this a glow on the near-black backdrop (COLORS.bg
 *  is #07070f) is a shape you can only find once you already know it is
 *  there. */
const AURA_FLOOR = 0.72;

/**
 * The colour a NON-STANDARD shipment's preview TELEGRAPH glows in.
 *
 * The telegraph exists because knowing a material's colour and noticing it are
 * different things. Two of the six materials are deliberately dim — slag is the
 * only unsaturated thing on the field and tar is near-black, both by design,
 * because that is what "inert" and "an absence" look like. Those are exactly
 * the two a player skims past on the belt, and an aura drawn in a colour that
 * cannot be seen against the backdrop telegraphs nothing.
 *
 * So the aura keeps the material's HUE and lifts its VALUE: scale every channel
 * until the brightest one reaches AURA_FLOOR. A colour already that bright
 * (cryo, rebar, volatile, magnetic, and every piece colour) comes back
 * untouched, so the common case is exactly `shipmentColor`. Tar's aura is a
 * visible violet and slag's a pale mauve — still theirs, and still nobody
 * else's.
 *
 * Deliberately arithmetic rather than a seventh column in MATERIAL_SPEC: a
 * hand-picked aura per material is one more pair of values that can drift
 * apart, and the rule "the glow is the cube's own colour, made visible" is one
 * a reader can check against any hex in the table.
 *
 * Not applied to standard shipments — nothing calls this for them. An aura on
 * every shipment distinguishes none of them.
 */
export function shipmentAura(type: PieceType, material: Material = "standard"): string {
  const hex = shipmentColor(type, material);
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const peak = Math.max(...rgb) / 255;
  if (peak >= AURA_FLOOR || peak === 0) return hex;
  const lift = AURA_FLOOR / peak;
  return `#${rgb
    .map((c) => Math.round(Math.min(255, c * lift)).toString(16).padStart(2, "0"))
    .join("")}`;
}

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

/**
 * THE TIMING CALLOUT — what the bay shouts over a row that just sold
 * (grades.ts, render.ts's drawPayoutFx).
 *
 * The word is the GRADE'S OWN NAME, uppercased, and only the best band takes
 * punctuation. The owner's brief wrote the ladder in four asides — *"clear
 * lines immediately after they land (excellent!), shortly after (Good), after a
 * compactor sweep (lucky or planned?), after 3 sweeps (definitely lucky)"* —
 * and the temptation was to make each callout the aside instead of the name
 * ("PLANNED?" for a swept row). It was refused for a reason the end card
 * settles: the same four words appear in the bay's tally and in the guide, and
 * a mechanic whose in-play voice and whose scoreboard use different vocabulary
 * takes twice as long to learn. So the aside survives as the TONE — one
 * exclamation mark at the top, nothing at all lower down, because a bay that
 * congratulates you for a lucky collapse is teaching the wrong thing.
 *
 * COLOURS: FOUR BANDS, FOUR COLOURS. The owner's note — *"we need to
 * differentiate the colors for each timing level"* — and the first version had
 * only three, with EXCELLENT and GOOD sharing the payout green. That reads as
 * "paid / neutral / lost", which is the ECONOMY's three-way split rather than
 * the ladder's four-way one, and the two bands a player is actually trying to
 * tell apart were the two that looked identical.
 *
 * Still no fifth hex: every one is an existing palette member, ordered so the
 * ladder is legible as brightness and saturation before it is legible as a
 * word.
 *
 *   EXCELLENT  payout green   the money verb — this row paid above the rate
 *   GOOD       aim cyan       the aiming verb — you placed it, one beat late
 *   SWEPT      readout white  the neutral readout — list price, no verdict
 *   LUCKY      dim text       the colour of a number that is not good news
 *
 * The two hot colours are the two that pay a premium and the two cool ones are
 * not; within each pair the brighter is the better band. Checked against the
 * bay's own backdrop (COLORS.bg, #07070f) rather than against a page: all four
 * are drawn with their own shadow glow at the same radius the money uses, and
 * the dim end is the same value LUCKY already shipped with.
 *
 * The CONGESTION TAG is deliberately NOT a fifth band. A capped row still shows
 * the band it was PAID at — the toast may never shout a grade the ledger did
 * not settle — and the tag underneath says why the band is lower than the play
 * was. It borrows the bar's own alarm red, which is the colour the congestion
 * floor rows and the plant crest already use for the same state.
 */
export const GRADE_CALLOUT: Record<ClearGrade, string> = {
  excellent: "EXCELLENT!",
  good: "GOOD",
  swept: "SWEPT",
  lucky: "LUCKY",
};

export const GRADE_COLOR: Record<ClearGrade, string> = {
  excellent: COLORS.trajectory,
  good: COLORS.aim,
  swept: COLORS.text,
  lucky: COLORS.textDim,
};

/** What a congestion-capped clear says under its money (render.ts's
 *  drawPayoutFx). One word, the same one the guide and the HUD use for the
 *  state, so the tag and the rule share a vocabulary. */
export const CONGESTION_TAG = "CONGESTED";

/** ...in the bay's alarm colour. Not a GRADE_COLOR entry: it is a note about
 *  the BAY, not a fifth rung of the ladder. */
export const CONGESTION_TAG_COLOR = COLORS.compactor;

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
