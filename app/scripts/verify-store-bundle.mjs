// Guard for a silent, expensive failure mode.
//
// Vite inlines import.meta.env at build time. If a store code path is gated on
// an env-derived constant, a build with that var unset lets Rollup prove the
// branch dead and drop the RevenueCat SDK out of the bundle entirely — the app
// still builds, still runs, and simply has no in-app purchases in it. That is
// exactly the kind of thing you discover after shipping.
//
// src/lib/purchases.ts is written to avoid it (see the sdk() comment); this
// asserts the property actually holds in the emitted output. Runs as part of
// `npm run ios:sync`.
//
// It also guards the opposite mistake: a RevenueCat **Test Store** key reaching
// a shippable bundle. RevenueCat's docs are blunt — "Never submit an app to the
// App Store or Google Play that is configured with a Test Store API key" —
// and the usual protection does not exist here, because the debug and release
// APKs are built from the same `--mode native` bundle. Nothing about the build
// output distinguishes them, so a test key that lands in dist/ ships.
//
//   node scripts/verify-store-bundle.mjs --allow-test-key
//
// is the deliberate opt-out, used only by the teststore scripts.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");

// Strings the RevenueCat plugin bridges emit; absent iff the SDK was stripped.
const MARKERS = ["presentPaywall", "restorePurchases", "addCustomerInfoUpdateListener"];

let files;
try {
  files = (await readdir(DIST)).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`✗ store bundle check: no build output at ${DIST} — run the build first`);
  process.exit(1);
}

const bundle = (await Promise.all(files.map((f) => readFile(join(DIST, f), "utf8")))).join("\n");
const missing = MARKERS.filter((m) => !bundle.includes(m));

if (missing.length) {
  console.error(
    `✗ store bundle check: RevenueCat SDK missing from dist/ (no ${missing.join(", ")}).\n` +
      `  The native build would ship with no in-app purchases. Something now gates an\n` +
      `  import in src/lib/purchases.ts behind a build-time constant — load the SDK\n` +
      `  before testing any state (see the sdk() comment).`,
  );
  process.exit(1);
}

// RevenueCat Test Store keys are `test_` + a long alphanumeric run. The length
// floor is what keeps this off incidental minified identifiers like `test_a`.
const TEST_KEY = /\btest_[A-Za-z0-9]{20,}\b/;
const allowTestKey = process.argv.includes("--allow-test-key");
const leaked = bundle.match(TEST_KEY);

if (leaked && !allowTestKey) {
  console.error(
    `✗ store bundle check: a RevenueCat TEST STORE key is in dist/ (${leaked[0].slice(0, 9)}…).\n` +
      `  RevenueCat: "Never submit an app to the App Store or Google Play that is\n` +
      `  configured with a Test Store API key." Purchases would be simulated and no\n` +
      `  real product would ever unlock.\n` +
      `  Build with \`npm run build:native\` for anything shippable. If this IS a\n` +
      `  deliberate Test Store build, run the check with --allow-test-key.`,
  );
  process.exit(1);
}

if (leaked) {
  console.log(`✓ store bundle check: Test Store key present, allowed explicitly — NOT SHIPPABLE`);
} else if (allowTestKey) {
  console.error(
    `✗ store bundle check: --allow-test-key was passed but dist/ has no test key.\n` +
      `  A teststore build that silently fell back to the platform key would test\n` +
      `  nothing. Check VITE_REVENUECAT_TEST_KEY is set in app/.env.`,
  );
  process.exit(1);
}

// The DEVELOPER SANDBOX (src/lib/sandbox.ts) is gated on an inlined build mode,
// so in any other mode its constant folds to false and the minifier drops the
// screen. That is the mechanism, and a mechanism is not a promise: a refactor
// that reads the flag through a function, or a bundler setting that stops
// folding, would ship a cheat menu that can rewrite the player's save. So the
// sandbox carries a marker that exists only on its own code path, and a bundle
// carrying it is not shippable — whatever the tree-shake was supposed to do.
//
//   node scripts/verify-store-bundle.mjs --allow-sandbox
//
// is the deliberate opt-out, used only by the sandbox scripts.
const SANDBOX_MARKER = "TETRILAUNCH_SANDBOX_BUILD";
const allowSandbox = process.argv.includes("--allow-sandbox");
const hasSandbox = bundle.includes(SANDBOX_MARKER);

if (hasSandbox && !allowSandbox) {
  console.error(
    `✗ store bundle check: the DEVELOPER SANDBOX is in dist/.\n` +
      `  It can set any Mark, grant salvage, max the rig and wipe the save, and it\n` +
      `  puts a Sandbox button on the main menu. This bundle must not ship.\n` +
      `  Build with \`npm run build:native\` for anything shippable. If this IS a\n` +
      `  deliberate sandbox build, run the check with --allow-sandbox.`,
  );
  process.exit(1);
}

if (hasSandbox) {
  console.log(`✓ store bundle check: sandbox present, allowed explicitly — NOT SHIPPABLE`);
} else if (allowSandbox) {
  console.error(
    `✗ store bundle check: --allow-sandbox was passed but dist/ has no sandbox.\n` +
      `  A sandbox build with no sandbox in it is a normal build wearing the wrong\n` +
      `  name — the menu's Sandbox button would never appear on the device. Check\n` +
      `  the build ran with \`--mode sandbox\`.`,
  );
  process.exit(1);
}

console.log(`✓ store bundle check: RevenueCat SDK present across ${files.length} chunks`);
