// Rasterises the SVG sources in resources/ to the PNGs @capacitor/assets wants
// (icon.png 1024², splash.png / splash-dark.png 2732²). Run via
// `npm run assets:generate`, which then fans those PNGs out into the native
// asset catalogs. sharp comes along with @capacitor/assets.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const RES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources");

const JOBS = [
  { from: "icon.svg", to: "icon.png", size: 1024 },
  { from: "splash.svg", to: "splash.png", size: 2732 },
  // The design is dark to begin with, so light/dark launch screens are the same
  // image — kept as a separate file because @capacitor/assets expects both.
  { from: "splash.svg", to: "splash-dark.png", size: 2732 },
];

for (const { from, to, size } of JOBS) {
  const svg = await readFile(resolve(RES, from));
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "cover" })
    .flatten({ background: "#07070f" }) // iOS icons must be fully opaque
    .png()
    .toBuffer();
  await writeFile(resolve(RES, to), png);
  console.log(`resources/${to}  ${size}x${size}  ${(png.length / 1024).toFixed(0)} kB`);
}

// Android adaptive-icon layers, split out of the same SVG.
//
// Android draws a launcher icon from two 108dp layers and lets the OEM mask
// (circle, squircle, rounded square…) reveal only the central 72dp of them;
// only a 66dp circle in the middle is guaranteed visible on every device.
// Without explicit layers @capacitor/assets uses icon.png full-bleed as the
// foreground, so its edges are lost — the two outer tiles cropped to a dark
// blob on a OnePlus 12 launcher (2026-08-09). The first fix shrank the WHOLE
// icon to 62% of the foreground, which did keep it inside every mask, but it
// was protecting the art's own empty backdrop corners, at the price of a mark
// drawn at about half the size of every other icon on the shelf.
//
// So the SVG is split where its backdrop ends. The two full-canvas <rect>s
// (radial gradient + grid) become the background layer, which a mask may crop
// as it likes, and everything drawn after them — tiles, glows, arc — is the
// mark, re-centred and scaled onto a transparent foreground so it sits inside
// the safe zone with dark field around it.
const ICON = 1024;
// The mark's share of the safe-zone diameter: at 1.0 its farthest solid pixel
// would touch the 66dp circle. 0.8 leaves a margin of field around it — a look
// chosen against the shelf, not a platform number.
const MARK_SAFE_SHARE = 0.8;
// capacitor-assets wraps both layers in a 16.7% inset (108dp layer → 72dp
// visible), so this 1024 canvas IS the visible 72dp and the safe zone is a
// centred circle of 66/72 of it.
const SAFE_DIAMETER = (ICON * 66) / 72;

const svgText = await readFile(resolve(RES, "icon.svg"), "utf8");
const BACKDROP = /<rect\b[^>]*fill="url\(#bg\)"[^>]*\/>\s*<rect\b[^>]*fill="url\(#grid\)"[^>]*\/>/;
const backdrop = svgText.match(BACKDROP);
if (!backdrop) {
  throw new Error(
    "resources/icon.svg: the two adjacent full-canvas backdrop <rect>s (fill=url(#bg), url(#grid)) " +
      "are where the adaptive layers split — keep them",
  );
}
const backdropSvg = `${svgText.slice(0, backdrop.index + backdrop[0].length)}</svg>`;
const markSvg = svgText.replace(BACKDROP, "");

const render = (svg) => sharp(Buffer.from(svg), { density: 384 }).resize(ICON, ICON);

// Where the mark is: the bounding box of its solid, saturated shapes (the
// tiles and the brighter dots) and how far the farthest of them sits from
// that box's centre. Measured on a render with the glow filters stripped, so
// a halo can neither widen the box nor lift a faint shape over the opacity
// bar: anything under ~42% opacity — the arc's faintest dot is 35%, the next
// 50% — is an accent that may sit near the safe-zone edge, not framing.
const geometry = markSvg.replace(/\sfilter="url\(#[^"]+\)"/g, "");
const probe = await render(geometry).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const solid = (x, y) => {
  const i = (y * ICON + x) * 4;
  const d = probe.data;
  const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
  return d[i + 3] > 108 && sat > 100;
};
let minX = ICON, minY = ICON, maxX = -1, maxY = -1;
for (let y = 0; y < ICON; y++) {
  for (let x = 0; x < ICON; x++) {
    if (!solid(x, y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
if (maxX < 0) {
  throw new Error("resources/icon.svg: nothing solid and saturated outside the backdrop — no mark for the foreground");
}
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
let reach = 0;
for (let y = minY; y <= maxY; y++) {
  for (let x = minX; x <= maxX; x++) {
    if (solid(x, y)) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
  }
}
const scale = (MARK_SAFE_SHARE * SAFE_DIAMETER) / 2 / reach;

// The framing is applied in vector space rather than by resampling a raster:
// everything after <defs> goes in a group that scales the mark and moves its
// centre to the canvas centre. The glows (filter stdDeviation) and the hatch
// pattern are in user units, so they scale along with it.
const tx = ICON / 2 - cx * scale;
const ty = ICON / 2 - cy * scale;
const defsEnd = markSvg.indexOf("</defs>") + "</defs>".length;
const framedSvg =
  markSvg.slice(0, defsEnd) +
  `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">` +
  markSvg.slice(defsEnd).replace(/<\/svg>\s*$/, "</g></svg>");

const foreground = await render(framedSvg).png().toBuffer();
await writeFile(resolve(RES, "icon-foreground.png"), foreground);
const share = Math.round((((maxX - minX + 1) * scale) / ICON) * 100);
console.log(
  `resources/icon-foreground.png  ${ICON}x${ICON}  mark spans ${share}% of the visible icon ` +
    `(scale ${scale.toFixed(3)}, centre moved from ${Math.round(cx)},${Math.round(cy)})`,
);

const background = await render(backdropSvg).flatten({ background: "#07070f" }).png().toBuffer();
await writeFile(resolve(RES, "icon-background.png"), background);
console.log(`resources/icon-background.png  ${ICON}x${ICON}  backdrop (gradient + grid), full bleed`);
