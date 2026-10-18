// Rebuild the provisional Steamworks imports and native vector achievement art.
// sharp already ships through @capacitor/assets, as in rasterize-assets.mjs.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "store/steam/achievements");
const CHECK = process.argv.includes("--check");
assert(process.argv.slice(2).every((arg) => arg === "--check"), "Usage: node scripts/steam-achievements.mjs [--check]");

// Verbatim headers from the owner's Steamworks exports for App ID 5270760.
const DEFINITIONS = [
  "api_name (required, unique; the name your game passes to the API)",
  "setid (optional; the id of a set that already exists)",
  "permission (one of Client, GameServer, OfficialGameServer)",
  "spoiler (true or false)",
  "archived (true or false)",
  "progress_stat_name (optional; the name of a stat that already exists, blank for no progress bar)",
  "progress_stat_min (number, no lower than the stat's own min)",
  "progress_stat_max (number, above min and no higher than the stat's own max)",
];
const LOCALIZATION = [
  "api_name (required; must match an api_name from the definitions CSV)",
  "field (name or description)",
  "english",
];
const SETS = ["setid (required; the id of a set that already exists)", "english"];
const GLOBALS = ["CLEAN_RUN", "ALL_CLEAR", "TRIPLE_CLEAR", "QUAD_CLEAR", "FIRST_CONTRACT", "SYSTEMS_HALF", "SYSTEMS_ALL", "SKYDECK_OPEN", "SKYDECK_WIN", "SECRET_TIER_S", "FULL_CHAIN"];
const COLORS = {
  "tier-unlocked": "#00f0ff",
  "clean-run": "#00ff85", "all-clear": "#00f0ff", triple: "#ff8a00", quad: "#ffe500",
  contract: "#00f0ff", "systems-half": "#ff8a00", "systems-all": "#ffe500",
  skydeck: "#00f0ff", "skydeck-win": "#ffe500", secret: "#b026ff", "full-chain": "#00ff85",
};

const catalog = JSON.parse(await readFile(resolve(OUT, "catalog.json"), "utf8"));
assert(Array.isArray(catalog), "Catalog must be an array");
const expectedIds = Array.from({ length: 10 }, (_, tier) => `TIER_${tier + 1}_UNLOCKED`).concat(GLOBALS);
assert.deepEqual(catalog.map((a) => a.apiName), expectedIds, "The provisional catalog must contain all 21 IDs in import order");
for (const item of catalog) {
  assert(item.name?.trim() && item.description?.trim(), `${item.apiName}: name and description are required`);
  assert(item.name.length <= 128 && item.description.length <= 256, `${item.apiName}: Steam text limit exceeded`);
  assert(typeof item.hidden === "boolean" && item.hidden === (item.apiName === "SECRET_TIER_S"), `${item.apiName}: unexpected visibility`);
  assert(Object.hasOwn(COLORS, item.icon), `${item.apiName}: unknown icon family`);
  assert(!/[\r\n]/.test(item.name + item.description), `${item.apiName}: multiline copy is unsupported`);
  if (item.apiName.startsWith("TIER_")) {
    assert.equal(item.tier, Number(item.apiName.split("_")[1]), `${item.apiName}: tier mismatch`);
    assert.equal(item.icon, "tier-unlocked");
  } else assert.equal(item.tier, undefined, `${item.apiName}: globals cannot carry a tier`);
}

const csvCell = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
const csv = (rows) => Buffer.from("\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n");
const files = new Map([
  ["5270760-achievements-definitions.csv", csv([DEFINITIONS, ...catalog.map((a) => [a.apiName, "", "Client", a.hidden, false, "", 0, 0])])],
  ["5270760-achievements-localization.csv", csv([LOCALIZATION, ...catalog.flatMap((a) => [[a.apiName, "name", a.name], [a.apiName, "description", a.description]])])],
  ["5270760-achievement-sets-localization.csv", csv([SETS])],
]);

const rect = (x, y, w, h, fill, opacity = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" opacity="${opacity}"/>`;
const path = (d, stroke, width = 7, fill = "none", opacity = 1) => `<path d="${d}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" opacity="${opacity}"/>`;
const DIGITS = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "001", "001"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};
function number(value, centerX, y, unit, color) {
  const chars = String(value).split("");
  const start = centerX - (chars.length * 4 - 1) * unit / 2;
  return chars.map((digit, i) => DIGITS[digit].map((row, j) => [...row].map((on, k) => on === "1" ? rect(start + (i * 4 + k) * unit, y + j * unit, unit, unit, color) : "").join("")).join("")).join("");
}

function sweep(rows, color) {
  let bars = "";
  const h = rows === 3 ? 23 : 18;
  const pitch = rows === 3 ? 35 : 28;
  const top = rows === 3 ? 72 : 66;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 4; col++) bars += rect(57 + col * 29, top + row * pitch, 24, h, color);
  }
  return bars + path("M184 71h18v93h-18M194 59l8 12 8-12", "#eaeaff", 7);
}

function workshop(all, color) {
  const nut = path("M128 59l46 27v54l-46 27-46-27V86z", color, 11)
    + rect(115, 100, 26, 26, color);
  let pips = "";
  for (let i = 0; i < 10; i++) pips += rect(52 + i * 16, 184, 10, 13, i < (all ? 10 : 5) ? color : "#30304c");
  return nut + pips;
}

function roof(color, win) {
  let result = path("M60 157h136M79 157v-30h98v30M96 127V98h64v29M112 98V70h32v28", color, 9);
  if (win) result += path("M128 54l8 16 18 3-13 13 3 18-16-9-16 9 3-18-13-13 18-3z", "#eaeaff", 0, "#eaeaff");
  else result += path("M73 90l-16 16 16 16M57 106h38M183 90l16 16-16 16M199 106h-38", "#eaeaff", 6);
  return result + path("M48 179h160", color, 6, "none", 0.35);
}

function glyph(kind, color) {
  switch (kind) {
    case "tier-unlocked": return path("M66 180V64h78v116M66 93h78M66 122h78M66 151h78M56 180h98", color, 8)
      + path("M178 162V83M158 103l20-20 20 20", "#eaeaff", 10)
      + rect(86, 73, 10, 10, color) + rect(114, 73, 10, 10, color);
    case "clean-run": return path("M62 63h132v54l-19 32-47 29-47-29-19-32z", color, 7, "none", 0.42)
      + path("M82 116l32 32 61-70", color, 16);
    case "all-clear": return path("M94 67H63v31M162 67h31v31M63 146v31h31M193 146v31h-31", color, 11)
      + path("M128 80l11 31 31 11-31 11-11 31-11-31-31-11 31-11z", color, 0, color)
      + rect(184, 55, 8, 8, "#eaeaff") + rect(62, 181, 8, 8, "#eaeaff");
    case "triple": return sweep(3, color);
    case "quad": return sweep(4, color);
    case "contract": return path("M78 67h101v121H78zM106 67V52h45v15", color, 9)
      + path("M99 115l19 19 43-43", "#eaeaff", 10)
      + path("M103 162h51", color, 8);
    case "systems-half": return workshop(false, color);
    case "systems-all": return workshop(true, color);
    case "skydeck": return roof(color, false);
    case "skydeck-win": return roof(color, true);
    case "secret": return path("M103 177h50M113 176l15-66 15 66", color, 9)
      + rect(120, 89, 16, 16, "#eaeaff")
      + path("M101 76L87 94l14 18M155 76l14 18-14 18M82 58L55 94l27 36M174 58l27 36-27 36", color, 8);
    case "full-chain": return path("M96 87l22-22h30l22 22v30l-22 22h-30l-22-22z", color, 10)
      + path("M86 117H67l-22 22v23l22 22h25l22-22v-12M170 117h19l22 22v23l-22 22h-25l-22-22v-12", color, 10)
      + path("M116 102l11 11 17-21", "#eaeaff", 7);
    default: throw new Error(`Unknown icon ${kind}`);
  }
}

function art(item) {
  const color = COLORS[item.icon];
  const shape = glyph(item.icon, color);
  let footer;
  if (item.tier) {
    let pips = "";
    for (let i = 0; i < 10; i++) pips += rect(40 + i * 12, 211, 7, 8, i < item.tier ? color : "#30304c");
    footer = pips + number(item.tier, 194, 192, 6, "#eaeaff");
  } else footer = path("M95 213h24M137 213h24", color, 3, "none", 0.7) + rect(125, 210, 6, 6, color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop stop-color="#18182d"/><stop offset="1" stop-color="#07070f"/></radialGradient>
      <radialGradient id="wash"><stop stop-color="${color}" stop-opacity=".12"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
      <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0v16" fill="none" stroke="#2e2e4a" stroke-width=".7" opacity=".45"/></pattern>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    ${rect(0, 0, 256, 256, "url(#bg)")}${rect(0, 0, 256, 256, "url(#grid)")}
    <circle cx="128" cy="117" r="115" fill="url(#wash)"/>
    ${path("M38 18h180l20 20v180l-20 20H38l-20-20V38z", color, 2, "none", 0.3)}
    ${path("M19 64V38l19-19h26M192 19h26l19 19v26M19 192v26l19 19h26M192 237h26l19-19v-26", color, 4, "none", 0.8)}
    ${rect(28, 28, 5, 5, "#70708b")}${rect(223, 28, 5, 5, "#70708b")}
    <g stroke-linecap="square" stroke-linejoin="miter" opacity=".5" filter="url(#glow)">${shape}</g>
    <g stroke-linecap="square" stroke-linejoin="miter">${shape}</g>${footer}
  </svg>`;
}

// Stored ZIP entries keep the archive reproducible; PNG data is compressed already.
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [filename, bytes] of entries) {
    const name = Buffer.from(filename), checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, bytes); central.push(directory, name);
    offset += header.length + name.length + bytes.length;
  }
  const end = Buffer.alloc(22), directory = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const pngEntries = [];
for (const item of catalog) {
  const achieved = await sharp(Buffer.from(art(item)), { density: 192 }).resize(256, 256).flatten({ background: "#07070f" }).png().toBuffer();
  const unachieved = await sharp(achieved).grayscale().toColourspace("srgb").linear(0.7, 0).png().toBuffer();
  pngEntries.push([`${item.apiName}_ACHIEVED.png`, achieved], [`${item.apiName}_UNACHIEVED.png`, unachieved]);
}
for (const [name, bytes] of pngEntries) files.set(`icons/${name}`, bytes);
files.set("icons.zip", zip(pngEntries));

// Both upload states stay visible side by side on the review sheet.
// Geometry keeps even the review sheet independent of machine-installed fonts.
const FONT = {
  A: "01110/10001/10001/11111/10001/10001/10001", B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01111/10000/10000/10000/10000/10000/01111", D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111", F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01111/10000/10000/10111/10001/10001/01111", H: "10001/10001/10001/11111/10001/10001/10001",
  I: "11111/00100/00100/00100/00100/00100/11111", J: "00111/00010/00010/00010/10010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001", L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001", N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110", P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101", R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110", T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110", V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010", X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100", Z: "11111/00001/00010/00100/01000/10000/11111",
  0: "01110/10001/10011/10101/11001/10001/01110", 1: "00100/01100/00100/00100/00100/00100/01110",
  2: "01110/10001/00001/00010/00100/01000/11111", 3: "11110/00001/00001/01110/00001/00001/11110",
  4: "00010/00110/01010/10010/11111/00010/00010", 5: "11111/10000/10000/11110/00001/00001/11110",
  6: "01110/10000/10000/11110/10001/10001/01110", 7: "11111/00001/00010/00100/01000/01000/01000",
  8: "01110/10001/10001/01110/10001/10001/01110", 9: "01110/10001/10001/01111/00001/00001/01110",
  ":": "00000/00100/00100/00000/00100/00100/00000", "/": "00001/00001/00010/00100/01000/10000/10000",
  "-": "00000/00000/00000/11111/00000/00000/00000", _: "00000/00000/00000/00000/00000/00000/11111",
};
function text(value, x, y, size, color) {
  return [...String(value).toUpperCase()].map((char, i) => {
    if (char === " ") return "";
    assert(FONT[char], `Review sheet cannot draw ${char}`);
    return FONT[char].split("/").map((row, j) => [...row].map((on, k) => on === "1" ? rect(x + (i * 6 + k) * size, y + j * size, size, size, color) : "").join("")).join("");
  }).join("");
}
const COLUMNS = 4, CELL_WIDTH = 280, CELL_HEIGHT = 180, HEADER = 84;
const sheetWidth = COLUMNS * CELL_WIDTH, sheetHeight = HEADER + Math.ceil(catalog.length / COLUMNS) * CELL_HEIGHT + 20;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">
  ${rect(0, 0, sheetWidth, sheetHeight, "#07070f")}
  ${text("TETRILAUNCH / ACHIEVEMENTS", 22, 17, 2.8, "#eaeaff")}
  ${text(`${catalog.length} provisional achievements / color: achieved / gray: unachieved / 256 x 256 upload icons`, 22, 49, 1.5, "#9090b0")}`;
for (const [i, item] of catalog.entries()) {
  const x = (i % COLUMNS) * CELL_WIDTH + 20, y = HEADER + Math.floor(i / COLUMNS) * CELL_HEIGHT;
  sheet += `<image x="${x}" y="${y}" width="128" height="128" href="data:image/png;base64,${pngEntries[i * 2][1].toString("base64")}"/>`
    + `<image x="${x + 144}" y="${y + 32}" width="64" height="64" href="data:image/png;base64,${pngEntries[i * 2 + 1][1].toString("base64")}"/>`
    + text(item.name, x, y + 140, 1.25, "#eaeaff")
    + text(`${item.apiName}${item.hidden ? " / HIDDEN" : ""}`, x, y + 157, 1, "#8080ac");
}
sheet += "</svg>";
files.set("contact-sheet.png", await sharp(Buffer.from(sheet)).png().toBuffer());

if (CHECK) {
  assert.deepEqual((await readdir(resolve(OUT, "icons"))).sort(), pngEntries.map(([name]) => name).sort(), "Icon files must exactly match the catalog");
  for (const [name, expected] of files) {
    const actual = await readFile(resolve(OUT, name));
    assert(actual.equals(expected), `${name} is stale; regenerate with node scripts/steam-achievements.mjs`);
    if (!name.startsWith("icons/")) continue;
    const image = sharp(actual), metadata = await image.metadata();
    assert.equal(metadata.width, 256, `${name}: width`);
    assert.equal(metadata.height, 256, `${name}: height`);
    assert.equal(metadata.format, "png", `${name}: format`);
    assert.equal(metadata.space, "srgb", `${name}: color space`);
    assert.equal(metadata.channels, 3, `${name}: expected opaque RGB`);
    if (name.endsWith("_UNACHIEVED.png")) {
      const pixels = await image.raw().toBuffer();
      for (let i = 0; i < pixels.length; i += 3) assert(pixels[i] === pixels[i + 1] && pixels[i] === pixels[i + 2], `${name}: unachieved art must be grayscale`);
    }
  }
  console.log(`Steam achievement assets verified: ${catalog.length} definitions, ${catalog.length * 2} English localization rows, ${pngEntries.length} 256x256 RGB icons, 0 sets; catalog/CSV/art/archive parity matches.`);
} else {
  await mkdir(resolve(OUT, "icons"), { recursive: true });
  for (const [name, bytes] of files) await writeFile(resolve(OUT, name), bytes);
  console.log(`Generated ${catalog.length} Steam achievements, ${pngEntries.length} icons, 3 CSV files, icons.zip and contact-sheet.png in store/steam/achievements/.`);
}
