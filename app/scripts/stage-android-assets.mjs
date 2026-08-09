#!/usr/bin/env node
/**
 * Copies the launcher icons and splash screens that `capacitor-assets generate
 * --android` writes into android/app/src/main/res/ out to native/android/res/,
 * which IS committed.
 *
 * Without this they are generated into a directory that docs/NATIVE.md
 * deliberately treats as disposable — android/ is gitignored and rebuilt by
 * `cap add android` on every CI run — so the next regeneration silently
 * restores Capacitor's default blue-X-on-white launcher icon. That is not a
 * theoretical risk: it is the state the project was in until this script
 * existed, and a default icon is the sort of thing that ships.
 *
 * Runs as the last step of `npm run assets:generate`. The reverse direction —
 * putting the committed copies back into a freshly generated project — is
 * scripts/patch-android.mjs, alongside MainActivity and the theme items.
 *
 * Only icons and splashes are staged. Everything else under res/ (layout/,
 * values/, xml/, drawable-v24/) belongs to Capacitor and must keep coming from
 * the generator, or a future template change would be pinned to whatever was
 * committed here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = path.join(appDir, "android", "app", "src", "main", "res");
const staged = path.join(appDir, "native", "android", "res");

if (!fs.existsSync(generated)) {
  console.error("stage-android-assets: app/android/ not present — run `npm run cap:add:android` first");
  process.exit(1);
}

/** res/ subdirectories we own, and which files inside them we take. */
const isOurs = (dir, file) =>
  (dir.startsWith("mipmap-") && (file.startsWith("ic_launcher") || file.endsWith(".xml"))) ||
  (dir.startsWith("drawable") && file === "splash.png");

fs.rmSync(staged, { recursive: true, force: true });

let files = 0;
let bytes = 0;
for (const dir of fs.readdirSync(generated)) {
  const from = path.join(generated, dir);
  if (!fs.statSync(from).isDirectory()) continue;

  for (const file of fs.readdirSync(from)) {
    if (!isOurs(dir, file)) continue;
    const dst = path.join(staged, dir, file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(from, file), dst);
    files++;
    bytes += fs.statSync(dst).size;
  }
}

if (!files) {
  console.error("stage-android-assets: matched no icons or splashes — did capacitor-assets run?");
  process.exit(1);
}

console.log(
  `stage-android-assets: staged ${files} files (${(bytes / 1048576).toFixed(2)} MB) -> native/android/res/`,
);
