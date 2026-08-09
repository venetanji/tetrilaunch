// Rasterises the Google Play listing graphics into store/play/.
//
// Separate from assets:generate on purpose: those feed the *app* (launcher
// icons, splash screens) and land in the native projects. These never touch a
// build — they are uploaded by hand to the Play Console listing, and Play is
// strict about exact pixel dimensions and rejects alpha on both.
//
//   npm run store:graphics
//
// Screenshots are NOT generated here. Play wants real frames of the running
// game, so those are captured off a device with `adb exec-out screencap`; see
// docs/PLAY.md.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import sharp from "sharp";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(appDir, "resources");
const OUT = resolve(appDir, "..", "store", "play");

const JOBS = [
  {
    // Play: 512x512, 32-bit PNG. It applies its own rounding/masking, so the
    // source stays a full-bleed square — same art as the launcher icon.
    from: "icon.svg",
    to: "icon-512.png",
    width: 512,
    height: 512,
  },
  {
    // Play: exactly 1024x500, PNG or JPEG, no alpha.
    from: "feature-graphic.svg",
    to: "feature-graphic-1024x500.png",
    width: 1024,
    height: 500,
  },
];

await mkdir(OUT, { recursive: true });

for (const { from, to, width, height } of JOBS) {
  const svg = await readFile(join(RES, from));
  const png = await sharp(svg, { density: 384 })
    .resize(width, height, { fit: "cover" })
    // Play rejects transparency on both assets; the art is already opaque, but
    // flattening onto the brand background makes that a property rather than a
    // coincidence of the current SVG.
    .flatten({ background: "#07070f" })
    .png()
    .toBuffer();

  const meta = await sharp(png).metadata();
  if (meta.width !== width || meta.height !== height) {
    throw new Error(`${to}: got ${meta.width}x${meta.height}, Play requires exactly ${width}x${height}`);
  }
  if (meta.hasAlpha) throw new Error(`${to}: still has an alpha channel, which Play rejects`);

  await writeFile(join(OUT, to), png);
  console.log(`store/play/${to}  ${width}x${height}  ${(png.length / 1024).toFixed(0)} kB`);
}
