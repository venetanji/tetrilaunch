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
 *   4. the mipmap and drawable splash resources <- native/android/res/ — the
 *      launcher icons and splash screens. Without this, regeneration restores
 *      Capacitor's default blue-X-on-white icon.
 *   5. res/xml/{backup_rules,data_extraction_rules}.xml <- native/android/,
 *      plus the two <application> attributes pointing at them — Auto Backup
 *      exclusions so a reinstall's restore can't resurrect a stale service
 *      worker, while localStorage (the save) keeps being backed up.
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

/* 4. Launcher icons + splash screens.
 *
 * `cap add android` lays down Capacitor's default blue-X-on-white launcher
 * icon. These are the real ones, generated from resources/icon.svg by
 * `npm run assets:generate` and staged into native/android/res/ by
 * scripts/stage-android-assets.mjs.
 *
 * Copied file-by-file rather than replacing the directory: res/ also holds
 * layout/, values/ and xml/ that Capacitor owns and must keep regenerating. */
const resSrc = path.join(appDir, "native", "android", "res");
const resDst = path.join(androidDir, "app", "src", "main", "res");

if (!fs.existsSync(resSrc)) {
  console.error(
    "patch-android: native/android/res/ is missing — the app would ship Capacitor's\n" +
      "  default launcher icon. Regenerate it with `npm run assets:generate`.",
  );
  process.exit(1);
}

let assets = 0;
for (const dir of fs.readdirSync(resSrc)) {
  for (const file of fs.readdirSync(path.join(resSrc, dir))) {
    const from = path.join(resSrc, dir, file);
    const to = path.join(resDst, dir, file);
    // Byte-compare rather than blind-copy, so the script stays idempotent and
    // Gradle's up-to-date checks don't see 52 touched files on every sync.
    if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    assets++;
  }
}
if (assets) {
  console.log(`patch-android: restored ${assets} icon/splash file(s)`);
  changed++;
}

/* 5. Auto Backup rules — keep the save, drop the stale-code vector.
 *
 * allowBackup="true" (the generated default) is load-bearing: the entire
 * meta-progression save is WebView localStorage under
 * app_webview/Default/Local Storage, and docs/NATIVE.md measures a reinstall
 * restoring it. But the default backup set also carries
 * app_webview/Default/Service Worker, and restoring THAT pins a fresh install
 * to the previous install's build: the restored worker serves its precached
 * bundle before the APK's dist/ ever executes, so no code shipped in the new
 * APK can defend itself — lib/platform.ts's purgeNativeServiceWorker() never
 * gets to run from current code, because the worker decides which bundle
 * boots and it picks its own. Reproduced on device 2026-08-09: a fresh
 * `adb install` came up as a months-old build until app_webview/Default/
 * "Service Worker" was deleted by hand via run-as.
 *
 * So the worker store (and Code Cache) is excluded from backup and
 * device-to-device transfer, and everything else stays in. Two rule files
 * because the platform reads a different resource by OS version:
 * data_extraction_rules.xml on API 31+, backup_rules.xml on API <= 30.
 *
 * The anchor on allowBackup="true" is deliberate: if a future Capacitor
 * template flips or drops it, the save's reinstall story just changed, and
 * that deserves a loud stop here rather than a quietly different APK.
 */
const backupFiles = ["backup_rules.xml", "data_extraction_rules.xml"];
const xmlDstDir = path.join(resDst, "xml");

for (const file of backupFiles) {
  const rules = fs.readFileSync(path.join(appDir, "native", "android", file), "utf8");
  const to = path.join(xmlDstDir, file);
  if (fs.existsSync(to) && fs.readFileSync(to, "utf8") === rules) continue;
  fs.mkdirSync(xmlDstDir, { recursive: true });
  fs.writeFileSync(to, rules);
  console.log(`patch-android: wrote res/xml/${file} (Auto Backup exclusions)`);
  changed++;
}

const manifestPath = path.join(androidDir, "app", "src", "main", "AndroidManifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
let manifestDirty = false;

/* No OAuth intent filter any more: Google sign-in goes through Credential
 * Manager (@capgo/capacitor-social-login), which never leaves the app, so the
 * custom-scheme callback the Supabase flow needed has nothing to catch. A
 * local app/android/ synced before this change still carries the old filter,
 * dead but harmless, until the project is regenerated. */

const backupAttrs = [
  { name: "android:fullBackupContent", value: "@xml/backup_rules" }, // API <= 30
  { name: "android:dataExtractionRules", value: "@xml/data_extraction_rules" }, // API 31+
];
const missingAttrs = [];
for (const { name, value } of backupAttrs) {
  if (manifest.includes(`${name}="${value}"`)) continue;
  if (manifest.includes(`${name}=`)) {
    // Inserting a second copy of the attribute would fail the build; a value
    // we didn't choose means the template grew backup rules of its own.
    console.error(
      `patch-android: AndroidManifest.xml sets ${name} to something other than "${value}" — ` +
        "reconcile the template's backup rules with native/android/ before shipping.",
    );
    process.exit(1);
  }
  missingAttrs.push(`${name}="${value}"`);
}

if (missingAttrs.length) {
  const appTag = manifest.match(/<application\b[^>]*>/);
  const anchor = 'android:allowBackup="true"';
  if (!appTag || !appTag[0].includes(anchor)) {
    console.error(
      'patch-android: could not find android:allowBackup="true" on <application> in AndroidManifest.xml.\n' +
        "  If the generated template changed its backup defaults, the reinstall-restores-progress\n" +
        '  behavior changed with it — re-read docs/NATIVE.md ("Progress survives reinstall") first.',
    );
    process.exit(1);
  }
  const indent = appTag[0].match(/\n([ \t]+)android:allowBackup/)?.[1] ?? "        ";
  const patchedTag = appTag[0].replace(
    anchor,
    anchor + missingAttrs.map((a) => `\n${indent}${a}`).join(""),
  );
  manifest = manifest.replace(appTag[0], patchedTag);
  manifestDirty = true;
  console.log(`patch-android: wired ${missingAttrs.length} backup attribute(s) into AndroidManifest.xml`);
  changed++;
}

if (manifestDirty) fs.writeFileSync(manifestPath, manifest);

console.log(changed ? "patch-android: done" : "patch-android: already applied");
