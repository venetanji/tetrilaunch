#!/usr/bin/env node
/**
 * Re-applies the native Android edits that `cap add android` does not own.
 *
 * app/android/ is gitignored and regenerated (docs/NATIVE.md): CI runs
 * `cap add android` from a clean checkout on every build, which is a real test
 * that the native path still works. That property is worth keeping, so rather
 * than committing the generated project the way iOS is committed, the two edits
 * the CLI would throw away are re-applied from here.
 *
 * Both edits exist for one reason: the game is landscape-locked and letterboxed
 * at a fixed 1280x720, and the system bars overlap the play field. The web
 * fullscreen path can't help — lib/platform.ts bails under Capacitor because
 * the Fullscreen API is a no-op in a WebView.
 *
 *   1. MainActivity.java  <- native/android/MainActivity.java (sticky immersive)
 *   2. res/values/styles.xml — draw into the display cutout instead of
 *      letterboxing, and make the (hidden) bars transparent.
 *   3. app/signing.gradle <- native/android/signing.gradle, plus the
 *      `apply from:` line that pulls it in — release signing and the
 *      versionCode/versionName overrides Play uploads need.
 *
 * Idempotent: safe to run on every sync, and a no-op once applied. Exits 0 with
 * a notice if app/android/ doesn't exist yet, so `npm run build` on a checkout
 * that never ran `cap add android` isn't a hard failure.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(appDir, "android");

if (!fs.existsSync(androidDir)) {
  console.log("patch-android: app/android/ not present — skipping (run `npm run cap:add:android` first)");
  process.exit(0);
}

let changed = 0;

/* 1. MainActivity — whole-file copy, since we own it entirely. */
const activitySrc = path.join(appDir, "native", "android", "MainActivity.java");
const activityDst = path.join(
  androidDir, "app", "src", "main", "java", "com", "tetrilaunch", "app", "MainActivity.java",
);

const wanted = fs.readFileSync(activitySrc, "utf8");
if (!fs.existsSync(activityDst) || fs.readFileSync(activityDst, "utf8") !== wanted) {
  fs.mkdirSync(path.dirname(activityDst), { recursive: true });
  fs.writeFileSync(activityDst, wanted);
  console.log("patch-android: wrote MainActivity.java (sticky immersive)");
  changed++;
}

/* 2. styles.xml — inject items into the two themes Capacitor generates.
 *
 * shortEdges matters independently of the immersive flags: without a cutout
 * mode the platform default letterboxes, which in landscape blacks out the
 * entire notch column. (docs/NATIVE.md used to claim Capacitor sets shortEdges
 * itself — it does not; the generated manifest and themes set no cutout mode.)
 */
const stylesPath = path.join(androidDir, "app", "src", "main", "res", "values", "styles.xml");
let styles = fs.readFileSync(stylesPath, "utf8");

const additions = [
  {
    theme: "AppTheme.NoActionBar",
    items: [
      '<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>',
      '<item name="android:statusBarColor">@android:color/transparent</item>',
      '<item name="android:navigationBarColor">@android:color/transparent</item>',
    ],
  },
  {
    theme: "AppTheme.NoActionBarLaunch",
    items: ['<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>'],
  },
];

for (const { theme, items } of additions) {
  // Match this style block specifically, so items land in the right theme even
  // if Capacitor reorders or adds styles in a future release.
  const block = new RegExp(`(<style name="${theme.replace(/\./g, "\\.")}"[^>]*>)([\\s\\S]*?)(</style>)`);
  const m = styles.match(block);
  if (!m) {
    console.error(`patch-android: could not find <style name="${theme}"> in styles.xml`);
    process.exit(1);
  }
  const missing = items.filter((item) => !m[2].includes(item));
  if (!missing.length) continue;

  // The captured body already ends with the closing tag's own indentation, so
  // strip it before appending — otherwise the first added item inherits it on
  // top of its own and lands double-indented.
  const indented = missing.map((i) => `        ${i}`).join("\n");
  styles = styles.replace(block, (_all, open, body, close) =>
    `${open}${body.replace(/\s*$/, "")}\n${indented}\n    ${close}`);
  console.log(`patch-android: added ${missing.length} item(s) to ${theme}`);
  changed++;
}

if (changed) fs.writeFileSync(stylesPath, styles);

/* 3. signing.gradle — whole-file copy (we own it), plus one `apply from:` line
 * appended to the generated build.gradle.
 *
 * Appending rather than splicing into the `android { }` block: an applied
 * script reopens that block itself, which survives Capacitor reformatting its
 * template. Capacitor's own capacitor.build.gradle is wired in exactly this
 * way, so the pattern is the one the generated project already uses. */
const signingSrc = path.join(appDir, "native", "android", "signing.gradle");
const signingDst = path.join(androidDir, "app", "signing.gradle");

const signingWanted = fs.readFileSync(signingSrc, "utf8");
if (!fs.existsSync(signingDst) || fs.readFileSync(signingDst, "utf8") !== signingWanted) {
  fs.writeFileSync(signingDst, signingWanted);
  console.log("patch-android: wrote signing.gradle (release signing + version overrides)");
  changed++;
}

const buildGradlePath = path.join(androidDir, "app", "build.gradle");
let buildGradle = fs.readFileSync(buildGradlePath, "utf8");
const applyLine = "apply from: 'signing.gradle'";

if (!buildGradle.includes(applyLine)) {
  // Must land AFTER capacitor.build.gradle: that file is what sets up the
  // plugin dependencies, and applying ours first would reopen `android { }`
  // before Capacitor's own configuration has run.
  const anchor = "apply from: 'capacitor.build.gradle'";
  if (!buildGradle.includes(anchor)) {
    console.error(`patch-android: could not find "${anchor}" in app/build.gradle`);
    process.exit(1);
  }
  buildGradle = buildGradle.replace(anchor, `${anchor}\n\n${applyLine}`);
  fs.writeFileSync(buildGradlePath, buildGradle);
  console.log("patch-android: hooked signing.gradle into app/build.gradle");
  changed++;
}

console.log(changed ? "patch-android: done" : "patch-android: already applied");
