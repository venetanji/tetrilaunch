// Derives the desktop app icons in build/ from the app-store icon art.
//
// Run rarely — only when resources/icon.svg changes — and commit the output,
// because CI packages on three runners and none of them should have to
// rasterise anything. `node scripts/make-icons.mjs` from app/desktop/.
//
// It imports sharp, which is a dependency of app/, NOT of this package: Node
// resolution walks up from here into app/node_modules and finds it. That is
// deliberate. sharp ships prebuilt native binaries per platform and this is a
// once-a-year authoring tool, so adding it to the package that CI installs on
// three operating systems would cost every desktop build a native download to
// produce files that are already in git. Run `npm ci` in app/ first if the
// import fails.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "..", "..", "resources", "icon.png");
const OUT = resolve(HERE, "..", "build");

// The mark is the same one the Play/App Store listings use, at the same
// full-bleed 1024² it is authored at. No rounded corners and no transparent
// margin: macOS convention would want both, but inventing new art is a design
// decision and this is a packaging change. The art's own dark backdrop reads
// fine as a square tile on all three platforms.
await mkdir(OUT, { recursive: true });
const source = await readFile(SOURCE);
const meta = await sharp(source).metadata();
if ((meta.width ?? 0) < 512 || (meta.height ?? 0) < 512) {
  throw new Error(`${SOURCE} is ${meta.width}x${meta.height}; icons need at least 512x512`);
}

// The macOS source. electron-builder derives the .icns from it, which is why
// there is no hand-made .icns here. It would derive the .ico too, but see the
// Windows note below.
const png1024 = await sharp(source).resize(1024, 1024, { kernel: "lanczos3" }).png().toBuffer();
await writeFile(resolve(OUT, "icon.png"), png1024);
console.log(`build/icon.png  1024x1024  ${(png1024.length / 1024).toFixed(0)} kB`);

/**
 * The Linux set, as a directory of size-named PNGs.
 *
 * Pointing linux.icon at a single 1024² png is the obvious thing and it
 * installs exactly one file, hicolor/1024x1024/apps/tetrilaunch.png —
 * electron-builder only fans a source out into sizes when it is converting an
 * .icns. 1024 is not one of the sizes the icon theme spec lists, so a desktop
 * environment that walks the standard directories rather than globbing finds
 * nothing and falls back to a generic placeholder in the applications menu.
 * A directory of real sizes costs ~120 kB in git and removes the question.
 */
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];
await mkdir(resolve(OUT, "icons"), { recursive: true });
let total = 0;
for (const size of LINUX_SIZES) {
  const png = await sharp(source).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
  await writeFile(resolve(OUT, "icons", `${size}x${size}.png`), png);
  total += png.length;
}
console.log(`build/icons/    ${LINUX_SIZES.map((s) => `${s}x${s}`).join(" ")}  ${(total / 1024).toFixed(0)} kB`);

/**
 * The Windows .ico, written by hand rather than left to electron-builder's
 * automatic png→ico conversion.
 *
 * Two reasons. The conversion emits a single 256² frame, so Explorer's list
 * and tree views downscale it themselves at draw time and the neon strokes
 * turn to grey mush at 16px — the size the installer's title bar and the
 * taskbar's small-icon mode actually use. And the conversion runs inside
 * app-builder-bin, which means the icon in a shipped installer would depend on
 * a transitive tool version rather than on a file anyone can open and look at.
 *
 * Sizes 16..128 are stored as uncompressed 32-bit DIBs and only 256 as PNG.
 * Windows has read PNG frames at every size since Vista, but plenty of
 * third-party ICO readers (installer tooling, archive browsers, Steam's own
 * uploader) still expect DIBs below 256, and a DIB frame costs 4 kB at 32².
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** A 32bpp bottom-up DIB with a zero AND mask — the alpha channel is the mask. */
function dib(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  // biHeight counts the XOR and AND bitmaps together, so it is twice the real
  // height. Getting this wrong is the classic way to produce an icon that
  // renders as its own bottom half.
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Rows run bottom-up.
    const src = (size - 1 - y) * size * 4;
    const dst = y * size * 4;
    for (let x = 0; x < size; x++) {
      xor[dst + x * 4 + 0] = rgba[src + x * 4 + 2]; // B
      xor[dst + x * 4 + 1] = rgba[src + x * 4 + 1]; // G
      xor[dst + x * 4 + 2] = rgba[src + x * 4 + 0]; // R
      xor[dst + x * 4 + 3] = rgba[src + x * 4 + 3]; // A
    }
  }

  // 1bpp, rows padded to 4 bytes. All zero: nothing is masked out.
  const and = Buffer.alloc((((size + 31) >> 5) << 2) * size);
  header.writeUInt32LE(xor.length + and.length, 20); // biSizeImage
  return Buffer.concat([header, xor, and]);
}

const frames = [];
for (const size of ICO_SIZES) {
  const pipeline = sharp(source).resize(size, size, { kernel: "lanczos3" });
  if (size === 256) {
    frames.push({ size, data: await pipeline.png().toBuffer() });
  } else {
    const rgba = await pipeline.ensureAlpha().raw().toBuffer();
    frames.push({ size, data: dib(rgba, size) });
  }
}

const dir = Buffer.alloc(6 + frames.length * 16);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(frames.length, 4);
let offset = dir.length;
frames.forEach((frame, i) => {
  const at = 6 + i * 16;
  // 256 is written as 0 — the field is one byte and 256 does not fit.
  dir.writeUInt8(frame.size === 256 ? 0 : frame.size, at + 0);
  dir.writeUInt8(frame.size === 256 ? 0 : frame.size, at + 1);
  dir.writeUInt8(0, at + 2); // palette entries
  dir.writeUInt8(0, at + 3); // reserved
  dir.writeUInt16LE(1, at + 4); // planes
  dir.writeUInt16LE(32, at + 6); // bit depth
  dir.writeUInt32LE(frame.data.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += frame.data.length;
});

const ico = Buffer.concat([dir, ...frames.map((f) => f.data)]);
await writeFile(resolve(OUT, "icon.ico"), ico);
console.log(
  `build/icon.ico   ${ICO_SIZES.join("/")}  ${(ico.length / 1024).toFixed(0)} kB`,
);
