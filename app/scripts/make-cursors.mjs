// Bakes the game's four pixel-art cursors into src/styles/cursors.css.
//
//   node scripts/make-cursors.mjs
//
// WHY A GENERATOR AND NOT FOUR COMMITTED PNGs. The art here is a few hundred
// pixels of flat colour taken straight from the design tokens, and a binary
// blob is the one form in which that is neither readable nor reviewable: a
// palette change (tokens.css moving --accent) would mean re-drawing in an
// image editor and trusting the diff of a base64 wall. The grids below ARE the
// art, in the same repository as the tokens they are coloured from, and the
// outline is derived rather than drawn so the four cursors cannot disagree
// about how thick their border is.
//
// WHY DATA URIs AND NOT FILES IN public/. A cursor that arrives late is a
// cursor that flickers: the browser paints the fallback keyword until the
// image loads, and the one moment it is guaranteed to be needed is the first
// frame the pointer enters the bay. Inline bytes have no load. It also keeps
// the Capacitor and Electron shells honest — nothing to copy, nothing to
// resolve against a file:// base.
//
// WHY TWO SIZES OF EACH. A cursor PNG is measured in CSS pixels by its
// intrinsic size, so a 32x32 image on a dpr-2 display is upscaled by the
// compositor with a smooth filter and every hard edge in it turns to mush —
// a blurry "pixel-art" cursor is worse than no custom cursor at all. The 2x
// asset is the same grid at twice the pixels, handed over through
// image-set(); at dpr 1 and dpr 2 alike, one art pixel lands on a whole number
// of device pixels and nothing is ever resampled.

import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "cursors.css");

// --- Palette (mirrors src/styles/tokens.css) --------------------------------
const C = {
  ".": null,                    // transparent
  "#": [0x04, 0x04, 0x0a, 255], // --bg-deep, the outline
  "C": [0x00, 0xf0, 0xff, 255], // --accent
  "Y": [0xff, 0xe5, 0x00, 255], // --piece-o, the reticle arms' inner tips
  "R": [0xff, 0x2d, 0x55, 255], // --danger, the barred disc and nothing else
};

/** A grid of characters -> {w, h, at(x,y)}. */
const grid = (rows) => ({ w: rows[0].length, h: rows.length, rows });

/** Everything that is not transparent, dilated by one pixel in all eight
 *  directions and painted in the outline colour. The outline is what makes
 *  either cursor legible over a light HUD panel AND over the near-black bay,
 *  which is the whole reason a game cursor gets one.
 *
 *  IT IS ALSO WHY THE RETICLE'S HOLE IS SIX PIXELS ACROSS. Dilation adds a
 *  pixel to every side, so two shapes four pixels apart end up sharing an
 *  outline: the first cut of this art had 2px-thick arms with a 4px gap, and
 *  the result was a solid dark bar straight across the middle of the cursor
 *  where the four separate outlines had merged. Six is the first gap that
 *  leaves daylight in the middle. */
function outlined(g) {
  const out = [];
  for (let y = 0; y < g.h; y++) {
    let row = "";
    for (let x = 0; x < g.w; x++) {
      const c = g.rows[y][x];
      if (c !== ".") { row += c; continue; }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || nx < 0 || ny >= g.h || nx >= g.w) continue;
          if (g.rows[ny][nx] !== "." && g.rows[ny][nx] !== "#") { near = true; break; }
        }
      }
      row += near ? "#" : ".";
    }
    out.push(row);
  }
  return grid(out);
}

// --- The art ----------------------------------------------------------------
// THE RETICLE, for the bay. Four arms with a HOLE in the middle, and the hole
// is the whole design: it is the point being aimed at, and a cursor that
// covered its own target would be hiding the one pixel the entire
// click-to-target scheme is about. The innermost pixel of each arm is yellow,
// so the four things closest to the aim point are the four that say where it
// is — and, unlike a pip drawn in the hole, they can carry the outline without
// filling the gap back in.
//
// Built from the symmetry rather than typed out as sixteen rows: four arms
// that have to match each other exactly is precisely the kind of art an edit
// puts one pixel out of true, and the ASCII proof this script prints at the
// end is the readable form anyway.
const RETICLE_ART = (() => {
  const N = 16;
  const rows = Array.from({ length: N }, () => Array(N).fill("."));
  const ARM = 5;       // arm length in px, from the image edge inward
  const CORE = [7, 8]; // the two centre rows/columns (16 is even; the centre is a 2x2)
  for (const c of CORE) {
    for (let i = 0; i < ARM; i++) {
      const ink = i === ARM - 1 ? "Y" : "C"; // the tip that faces the target
      rows[c][i] = ink;                 // left arm
      rows[c][N - 1 - i] = ink;         // right arm
      rows[i][c] = ink;                 // top arm
      rows[N - 1 - i][c] = ink;         // bottom arm
    }
  }
  return grid(rows.map((r) => r.join("")));
})();

// THE ARROW, for the chrome. Same palette, same outline, ordinary arrow
// silhouette — the shape a pointer has to keep, because "which pixel am I
// pointing at" is answered by its tip and by nothing else.
//
// THE ONE-PIXEL MARGIN on the top and left is load-bearing, not padding: the
// outline is a dilation, and a shape sitting flush against the edge of its
// grid has nowhere to put one. The first cut ran the tip into the corner and
// the arrow's leading edges — the two that overlap whatever is underneath —
// came out bare cyan on cyan-ish chrome.
const ARROW = grid([
  "............",
  ".C..........",
  ".CC.........",
  ".CCC........",
  ".CCCC.......",
  ".CCCCC......",
  ".CCCCCC.....",
  ".CCCCCCC....",
  ".CCCCCCCC...",
  ".CCCCCCCCC..",
  ".CCCCCCCCCC.",
  ".CCCCCC.....",
  ".CCC.CCC....",
  ".CC..CCC....",
  ".C....CCC...",
  "......CCC...",
  ".......CC...",
]);

// THE HAND, for anything clickable. Same 12x17-ish footprint as the arrow (13
// wide, because a hand needs a thumb) so the two chrome cursors are the same
// weight on screen and swapping between them at a button's edge is a change of
// SHAPE, not a change of size.
//
// THE SEAMS ARE TRANSPARENT PIXELS, NOT DRAWN LINES. The three 1px gaps at
// columns 3, 6 and 9 are '.' in the art and come back as '#' from `outlined()`
// — a gap one pixel wide is claimed by the dilation from both sides, which is
// the failure mode the reticle's six-pixel hole exists to avoid and is exactly
// what is wanted here: four fingers separated by a dark seam. One grid, one
// border thickness, no second set of numbers to keep in step.
//
// The one-pixel margin on every side is the arrow's rule, for the arrow's
// reason: the fingertip is the hotspot, it is the part that overlaps whatever
// it is pointing at, and a shape flush against the grid edge has nowhere to put
// its outline.
const HAND = grid([
  ".............",
  "....CC.......",
  "....CC.......",
  "....CC.......",
  "....CC.......",
  "....CC.......",
  "....CC.......",
  "....CC.CC....",
  "....CC.CC.CC.",
  ".CC.CC.CC.CC.",
  ".CCCCCCCCCCC.",
  ".CCCCCCCCCCC.",
  ".CCCCCCCCCCC.",
  ".CCCCCCCCCCC.",
  "..CCCCCCCCCC.",
  "..CCCCCCCCC..",
  ".............",
]);
/** The index fingertip: the art column the finger's right half sits in, so the
 *  hotspot lands on the seam between its two pixels rather than inside one of
 *  them. Times SCALE, that is a whole CSS pixel on the finger's centre line. */
const HAND_TIP_COL = 5;

// THE BARRED DISC, for anything refusing the click. Road-sign "no entry",
// because that is the one refusal glyph that survives being 22 CSS pixels
// across and needs no reading: a filled disc in --danger with a bar straight
// through it. Two inks, like every other cursor here — the disc and the
// outline colour, which does double duty as the bar.
//
// GENERATED FROM THE CIRCLE, NOT TYPED. Sixteen hand-typed rows of a disc is
// the kind of art an edit puts one pixel out of true — the same argument the
// reticle's symmetry makes — and the radius and bar proportions below are the
// reviewable form. r = 5.2 is the radius that fills an 11px disc without the
// stair-stepped "rounded square" a flat 5.5 produces; the bar is 3 rows of 7,
// i.e. 27% of the diameter tall and 64% wide, which is the real sign's.
//
// THE BAR IS DRAWN AS '#' RATHER THAN LEFT TRANSPARENT. `outlined()` only
// converts a '.' that has an ink NEIGHBOUR, so a three-pixel-tall hole would
// come back with a transparent core and a dark fringe — a slot you can see the
// HUD through, not a bar. Writing the outline colour into the art states the
// intent and does not depend on the dilation's reach.
//
// IT IS THE ONE CURSOR IN THE SET THAT IS NOT CYAN, and that is the point:
// refusal is red everywhere else in this app (.tower__floor.is-denied, the
// tower's owed-seal flare), so the cursor that says "no" says it in the colour
// the rest of the refusal vocabulary already uses.
const BLOCKED_ART = (() => {
  const N = 13;              // 11px of disc plus the 1px outline margin
  const MID = (N - 1) / 2;   // 6 — the disc's centre, and the hotspot
  const R = 5.2;             // disc radius, art px
  const BAR_HALF_H = 1;      // -> a 3px-tall bar
  const BAR_HALF_W = 3;      // -> a 7px-wide bar, red left on both ends
  const rows = [];
  for (let y = 0; y < N; y++) {
    let row = "";
    for (let x = 0; x < N; x++) {
      const dx = x - MID;
      const dy = y - MID;
      if (dx * dx + dy * dy > R * R) { row += "."; continue; }
      row += Math.abs(dy) <= BAR_HALF_H && Math.abs(dx) <= BAR_HALF_W ? "#" : "R";
    }
    rows.push(row);
  }
  return grid(rows);
})();

// --- The selectors ----------------------------------------------------------
// WHAT COUNTS AS CLICKABLE, in the vocabulary the rest of the app already uses:
// padnav.ts's FOCUSABLE (what a gamepad may land on) and main.ts's click
// delegation (which resolves a handler by closest("[data-action]") /
// closest("[data-toggle]")). Stated by BEHAVIOUR rather than by looks on
// purpose — .menu__entitlement is a <div class="btn" role="status"> that is not
// a control, and a rule keyed on .btn would have handed it a hand.
//
// No `input`/`textarea`: this app has none, and a text field's I-beam is a
// signal about where the caret will land, not decoration to restyle. If one
// ever appears it should keep its caret.
//
// #app, AND THE ID IS LOAD-BEARING. app.css sets `cursor: pointer` on some
// thirty individual classes and `cursor: default` / `not-allowed` on the
// disabled variants of them, and it is @imported AFTER this file — so a rule
// here at class specificity would lose every one of those ties on source order.
// One id (the app's own root, index.html) outranks any stack of classes, which
// is what lets those thirty declarations stay exactly where they are, doing
// what they have always done: being the keyword the browser falls back to.
const CONTROL =
  ':is(button, a[href], [role="button"], [role="switch"], [tabindex="0"], [data-action], [data-toggle])';
const INTERACTIVE_SEL = `#app ${CONTROL}`;
// …and what refuses it: a control, AND refusing. `:disabled` covers the native
// ones; the two ARIA spellings cover the ones that stay clickable on purpose —
// a locked .tower__floor is aria-disabled and still takes the click, because
// tapping it is how the tower shakes its head (screens.ts's floorHTML).
//
// IT REPEATS THE CONTROL LIST, and the repetition is the point. The first cut
// of this leaned on source order — "the two match at the same specificity, so
// emit blocked second and let the tie break" — and it was simply not true.
// `:is()` takes the weight of its MOST specific argument: the clickable side
// contains the compound `a[href]` (0,1,1), the blocked side was all lone
// attributes (0,1,0), so clickable outranked blocked by a single element name
// and every locked floor in the tower wore a pointing hand. A browser reading
// getComputedStyle on the real screens caught it; no amount of staring at the
// selectors did. Chaining makes blocked (0,2,1) against clickable's (0,1,1):
// it wins on merit rather than on where it sits in the file, and it can never
// again be one selector edit away from losing.
//
// It also narrows the rule to the truth. "Blocked" is a thing a CONTROL does;
// an inert div that merely looks disabled (.guide__drill--locked) is not
// refusing a click, it is a card, and it keeps the chrome arrow.
const BLOCKED_SEL = `#app ${CONTROL}:is(:disabled, [disabled], [aria-disabled="true"])`;

// --- PNG encoding -----------------------------------------------------------
// Hand-rolled rather than pulled from sharp: the images are a few hundred
// bytes of flat colour, the encoder is thirty lines, and a build asset that
// depends on nothing is one that still regenerates in five years.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** The grid, scaled `s`x with nearest-neighbour (i.e. by repeating whole
 *  pixels — the only scaling that keeps pixel art pixel art), as a PNG. */
function png(g, s) {
  const w = g.w * s;
  const h = g.h * s;
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none. The images are tiny; a filter would only
                  // trade clarity for a handful of bytes.
    for (let x = 0; x < w; x++) {
      const px = C[g.rows[(y / s) | 0][(x / s) | 0]];
      if (px) { raw[o++] = px[0]; raw[o++] = px[1]; raw[o++] = px[2]; raw[o++] = px[3]; }
      else { raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; raw[o++] = 0; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 6;  // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const uri = (g, s) => `url("data:image/png;base64,${png(g, s).toString("base64")}")`;

/** One cursor's pair of declarations. The plain url() comes FIRST and the
 *  image-set() second, on purpose and not as a nicety: a browser that cannot
 *  parse image-set() inside cursor drops that declaration at parse time and
 *  keeps the one above it, which is a working 1x cursor. (The same trick
 *  written through a custom property would NOT degrade — an invalid var()
 *  substitution poisons the property rather than falling back to the previous
 *  declaration — which is why these are literals.) */
function decls(g, scale, hotX, hotY, fallback) {
  const one = uri(g, scale);
  const two = uri(g, scale * 2);
  return [
    `    cursor: ${one} ${hotX} ${hotY}, ${fallback};`,
    `    cursor: image-set(${one} 1x, ${two} 2x) ${hotX} ${hotY}, ${fallback};`,
  ].join("\n");
}

const reticle = outlined(RETICLE_ART);
const arrow = outlined(ARROW);
const hand = outlined(HAND);
const blocked = outlined(BLOCKED_ART);
// Scale 2: one art pixel is two CSS pixels, so the reticle is 32x32 CSS, the
// arrow 24x34, the hand 26x34 and the barred disc 26x26 — chunky on purpose,
// and inside every engine's cursor size cap (Blink refuses anything over 128
// device px, which the largest 2x asset reaches at 68).
const SCALE = 2;
// The reticle's hotspot is the centre of the hole its four arms point at:
// dead centre of a 16x16 grid at 2x is CSS 16,16. The barred disc's is its own
// centre for the same reason — it is a symbol, not a pointer, and the thing it
// is refusing is under the middle of it. The arrow's is its tip (art (1,1)
// after the margin, so CSS 2,2) and the hand's is its fingertip.
const css = `/* GENERATED by scripts/make-cursors.mjs — do not edit by hand.
   Re-run that script after changing the art or the palette it reads from
   tokens.css. See its header for why these are baked data URIs, why there are
   two of each size, and why each cursor is declared twice. */

/* FOUR CURSORS, ONE IDENTITY. The bay gets a reticle, the chrome gets an
   arrow, anything clickable gets a hand, and anything refusing the click gets
   a barred disc in --danger.

   THE LAST TWO ARE A REVERSAL, and the argument they overturned is worth
   keeping written down. This file used to hand buttons and disabled controls
   straight back to the OS, on the grounds that \`pointer\` and \`not-allowed\`
   are the only cursors in the app that carry INFORMATION rather than
   decoration, and that a player who has sized or recoloured their system
   pointer has done it precisely on those. It was wrong twice over. It was
   wrong about the cost: the pointer spends most of its life ON the chrome, so
   the swap happened at every button edge — the owner's report is "the custom
   cursor does not show up on buttons", which is what a split identity looks
   like from outside. And it was wrong about the benefit, because the
   affordance is in the SHAPE: a pointing hand says "clickable" and a barred
   disc says "no" whoever drew them, and the accessibility block at the bottom
   of this file already gives the system cursors back to exactly the players
   whose settings the custom bitmaps would ignore. The signal is kept; only the
   pixels changed hands.

   BLOCKED OUTRANKS CLICKABLE BY SPECIFICITY, not by source order — see the
   generator's note on why the two selectors chain. A disabled button matches
   both, and which one it wears is not allowed to depend on where in this file
   they landed.

   EVERY DECLARATION KEEPS ITS KEYWORD. \`, pointer\` / \`, not-allowed\` /
   \`, crosshair\` after the image is not punctuation: a data URI that fails to
   decode, an engine that rejects the size, a printing context — any of them
   drop the image and land on the keyword, and the keyword is chosen so what
   is left is still the RIGHT cursor for that element rather than an arrow
   everywhere.

   ONLY ON A REAL POINTER. Under \`pointer: coarse\` there is no cursor to draw
   and the rules would be dead weight on the device that can least afford it —
   the same line input.ts and the drag hint already draw. */
@media (pointer: fine) {
  body {
${decls(arrow, SCALE, 2, 2, "default")}
  }

  #game {
${decls(reticle, SCALE, (reticle.w * SCALE) / 2, (reticle.h * SCALE) / 2, "crosshair")}
  }

  ${INTERACTIVE_SEL} {
${decls(hand, SCALE, HAND_TIP_COL * SCALE, SCALE, "pointer")}
  }

  ${BLOCKED_SEL} {
${decls(blocked, SCALE, (blocked.w * SCALE) / 2, (blocked.h * SCALE) / 2, "not-allowed")}
  }
}

/* ACCESSIBILITY OVERRIDE. A player who has asked their OS for a high-contrast
   or enlarged pointer has asked for it everywhere, and a custom bitmap ignores
   both settings — forced-colors and prefers-contrast are the two signals that
   say so. They get the system cursors back, with \`crosshair\` over the bay so
   the surface still says what it is.

   THE INTERACTIVE AND BLOCKED RULES ARE RESTATED HERE, in keywords, and they
   have to be: this block outranks nothing by specificity, it wins on source
   order, and \`body { cursor: auto }\` alone would leave the two id-scoped
   rules above still holding their bitmaps on every button in the app — the
   one audience that must never see them would be the only one that always
   did. */
@media (forced-colors: active), (prefers-contrast: more) {
  body { cursor: auto; }
  #game { cursor: crosshair; }
  ${INTERACTIVE_SEL} { cursor: pointer; }
  ${BLOCKED_SEL} { cursor: not-allowed; }
}
`;

await writeFile(OUT, css, "utf8");

// An ASCII proof of what was baked, so a change to the grids can be reviewed
// on the terminal instead of by squinting at base64.
const show = (name, g) => {
  console.log(`\n${name} — ${g.w}x${g.h} art px, ${g.w * SCALE}x${g.h * SCALE} CSS px`);
  for (const r of g.rows) console.log("  " + r.replace(/\./g, " "));
};
show("reticle", reticle);
show("arrow", arrow);
show("hand", hand);
show("blocked", blocked);
console.log(`\nwrote ${OUT} (${(css.length / 1024).toFixed(1)} kB)`);
