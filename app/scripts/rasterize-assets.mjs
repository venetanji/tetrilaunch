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
