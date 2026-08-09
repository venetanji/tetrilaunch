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

// Android adaptive-icon layers. Without these @capacitor/assets falls back to
// using icon.png full-bleed as the adaptive FOREGROUND, and the launcher's
// circle/squircle mask only guarantees the central ~66% "safe zone" — so the
// two squares at the art's edges got cropped to a dark blob on device
// (OnePlus 12 launcher, 2026-08-09). The foreground here is the same art
// scaled into the safe zone on an opaque canvas of the art's own backdrop
// color, and the background layer is that flat color — identical color on
// both layers, so mask shape and parallax can never expose a seam.
const ICON = 1024;
// Art's share of the foreground canvas. capacitor-assets wraps the source in
// a further 16.7% inset (108dp box → 72dp visible), so the art ends up at
// ~0.62 of the masked area — inside every OEM mask, including circles.
const FG_SCALE = 0.62;

const iconPng = await readFile(resolve(RES, "icon.png"));
// The art's own flat backdrop, sampled from a corner of the rendered icon —
// resilient to the SVG's backdrop shade drifting from the flatten color above.
const corner = await sharp(iconPng).extract({ left: 2, top: 2, width: 1, height: 1 })
  .raw().toBuffer();
const backdrop = { r: corner[0], g: corner[1], b: corner[2] };

const inner = Math.round(ICON * FG_SCALE);
const art = await sharp(iconPng).resize(inner, inner).png().toBuffer();
const foreground = await sharp({
  create: { width: ICON, height: ICON, channels: 4, background: { ...backdrop, alpha: 1 } },
})
  .composite([{ input: art, gravity: "center" }])
  .png()
  .toBuffer();
await writeFile(resolve(RES, "icon-foreground.png"), foreground);
console.log(`resources/icon-foreground.png  ${ICON}x${ICON}  art at ${Math.round(FG_SCALE * 100)}%`);

const background = await sharp({
  create: { width: ICON, height: ICON, channels: 4, background: { ...backdrop, alpha: 1 } },
})
  .png()
  .toBuffer();
await writeFile(resolve(RES, "icon-background.png"), background);
console.log(`resources/icon-background.png  ${ICON}x${ICON}  flat backdrop`);
