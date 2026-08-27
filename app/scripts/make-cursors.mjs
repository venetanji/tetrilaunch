// Bakes the game's two pixel-art cursors into src/styles/cursors.css.
//
//   node scripts/make-cursors.mjs
//
// WHY A GENERATOR AND NOT TWO COMMITTED PNGs. The art here is 16x16 and 12x17
// pixels of flat colour taken straight from the design tokens, and a binary
// blob is the one form in which that is neither readable nor reviewable: a
// palette change (tokens.css moving --accent) would mean re-drawing in an
// image editor and trusting the diff of a base64 wall. The grids below ARE the
// art, in the same repository as the token they are coloured from, and the
// outline is derived rather than drawn so the two cursors cannot disagree
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
// Scale 2: one art pixel is two CSS pixels, so the reticle is 32x32 CSS and
// the arrow 22x32 — chunky on purpose, and inside every engine's cursor size
// cap (Blink refuses anything over 128 device px, which the 2x assets reach at
// 64 and 44 respectively).
const SCALE = 2;
// The reticle's hotspot is the centre of the hole its four arms point at:
// dead centre of a 16x16 grid at 2x is CSS 16,16. The arrow's is its tip —
// art (1,1) after the margin, so CSS 2,2.
const css = `/* GENERATED by scripts/make-cursors.mjs — do not edit by hand.
   Re-run that script after changing the art or the palette it reads from
   tokens.css. See its header for why these are baked data URIs, why there are
   two of each size, and why each cursor is declared twice. */

/* THE BAY GETS A RETICLE, THE CHROME GETS AN ARROW, and the buttons keep the
   system hand. That last one is the deliberate part: \`cursor: pointer\` is the
   only cursor in the app that carries INFORMATION ("this is clickable"), it is
   the one users configure at the OS level for size and contrast, and replacing
   it with a second piece of neon art would cost a real affordance to buy a
   consistent look on a surface nobody looks at. Decoration gets restyled;
   signals do not.

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
}

/* ACCESSIBILITY OVERRIDE. A player who has asked their OS for a high-contrast
   or enlarged pointer has asked for it everywhere, and a custom bitmap ignores
   both settings — forced-colors and prefers-contrast are the two signals that
   say so. They get the system cursors back, with \`crosshair\` over the bay so
   the surface still says what it is. */
@media (forced-colors: active), (prefers-contrast: more) {
  body { cursor: auto; }
  #game { cursor: crosshair; }
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
console.log(`\nwrote ${OUT} (${(css.length / 1024).toFixed(1)} kB)`);
