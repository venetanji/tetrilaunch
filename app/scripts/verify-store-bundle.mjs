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
//
// And a fourth question, asked only of the tree that goes into a Steam depot:
//
//   node scripts/verify-store-bundle.mjs --desktop
//
// which inverts the first one — there, a purchase surface reaching the bundle
// is the failure. See the block at the bottom.
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

// The DEVELOPER CHEATS (src/lib/sandbox-cheats.ts) are gated on an inlined
// build mode, so in any other mode its constant folds to false and the
// minifier drops the module. That is the mechanism, and a mechanism is not a
// promise: a refactor that reads the flag through a function, or a bundler
// setting that stops folding, would ship a menu that can rewrite the player's
// save. So the cheats carry a marker that exists only on their own code path,
// and a bundle carrying it is not shippable — whatever the tree-shake was
// supposed to do.
//
// NOT the sandbox MODE. Tier S — the level-select screen, the practice runs
// and their separate leaderboard — ships in every build on purpose (see
// src/lib/devmode.ts). It cannot pay salvage, advance a tier or touch the Deep
// Run board, which is what makes it a game mode rather than a cheat. What this
// check guards is the four buttons that edit the save directly.
//
//   node scripts/verify-store-bundle.mjs --allow-sandbox
//
// is the deliberate opt-out, used only by the sandbox scripts.
const SANDBOX_MARKER = "TETRILAUNCH_SANDBOX_BUILD";
const allowSandbox = process.argv.includes("--allow-sandbox");
const hasSandbox = bundle.includes(SANDBOX_MARKER);

if (hasSandbox && !allowSandbox) {
  console.error(
    `✗ store bundle check: the DEVELOPER CHEATS are in dist/.\n` +
      `  They can set any Mark, grant salvage, max the rig and wipe the save, from a\n` +
      `  row on the Tier S screen. This bundle must not ship.\n` +
      `  Build with \`npm run build:native\` for anything shippable. If this IS a\n` +
      `  deliberate sandbox build, run the check with --allow-sandbox.`,
  );
  process.exit(1);
}

if (hasSandbox) {
  console.log(`✓ store bundle check: sandbox present, allowed explicitly — NOT SHIPPABLE`);
} else if (allowSandbox) {
  console.error(
    `✗ store bundle check: --allow-sandbox was passed but dist/ has no cheats.\n` +
      `  A sandbox build with no cheats in it is a normal build wearing the wrong\n` +
      `  name — Tier S would open on the device, but its save-editing row would\n` +
      `  never appear. Check the build ran with \`--mode sandbox\`.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// THE DESKTOP BUNDLE (--desktop), which is a different question from all three
// checks above and the only one where "the store is missing" is the PASS.
//
//   node scripts/verify-store-bundle.mjs --desktop
//
// is run by `npm run desktop:dist:steam`, whose output goes into a Steam depot.
//
// Why it exists: the Electron shell loads this same `--mode native` bundle, and
// inside it `Capacitor.getPlatform()` answers "web" — so every `!isNative`
// branch in src/lib/purchases.ts is the branch the desktop build takes, and
// that branch is RevenueCat's WEB BILLING checkout. A Steam-distributed game
// offering its own web checkout for in-game content is what Valve's
// distribution agreement exists to prevent. purchases.ts now gates both doors
// on `isDesktop`; this asserts the gate reached the emitted output, and that
// nothing armed it in the first place.
//
// TWO ASSERTIONS, AND NEITHER IS AN ABSENCE CHECK ON THE SDK.
//
// 1. NO KEY OF ANY SHAPE. Without a key nothing can configure, so this is the
//    outer wall and the one that has actually been holding — desktop.yml
//    deliberately passes no VITE_REVENUECAT_* at all. Strict about all four
//    prefixes, not just the web one: an `appl_`/`goog_` key is inert on
//    desktop only because Capacitor's native bridge is not there, which is the
//    same species of accident this check exists to stop relying on. A depot
//    bundle carries no billing credential, full stop.
//
// 2. THE GATE'S MARKERS ARE PRESENT. It would be nice to assert the paywall is
//    simply absent, and it cannot be done: "presentPaywall" is also a string
//    the RevenueCat Capacitor bridge emits, and that bridge legitimately ships
//    in this bundle because iOS and Android build from it too. So the positive
//    evidence is the gate itself. `isDesktop` is a runtime test
//    (`location.protocol === "app:"`), not an inlined build constant, so
//    nothing folds those branches away — their warning strings survive
//    minification, and their absence means someone removed the gate.
//
// Deliberately NOT wired into `desktop:dist`, `:win`, `:mac` or `:linux`. Those
// are the direct-download installers, they are unchanged, and a developer with
// a populated app/.env building one locally is not doing anything wrong. The
// Steam path is the one with a distribution agreement attached.
const DESKTOP_MARKERS = [
  "[purchases] desktop shell — no store, purchases disabled",
  "[purchases] desktop shell — paywall refused",
];
// RevenueCat's public key prefixes: appl_ (App Store), goog_ (Play), rcb_ (Web
// Billing) and test_ (Test Store). The length floor is the same one TEST_KEY
// uses, and for the same reason: it keeps the check off minified identifiers.
const ANY_KEY = /\b(?:appl|goog|rcb|test)_[A-Za-z0-9]{20,}\b/;

if (process.argv.includes("--desktop")) {
  const key = bundle.match(ANY_KEY);
  if (key) {
    console.error(
      `✗ desktop bundle check: a RevenueCat key is in dist/ (${key[0].slice(0, 9)}…).\n` +
        `  This bundle is headed for a Steam depot. Inside the Electron shell\n` +
        `  Capacitor reports platform "web", so a RevenueCat key here is one\n` +
        `  configuration change away from a web checkout running inside a game\n` +
        `  Valve sold. Build the Steam tree with no VITE_REVENUECAT_* set —\n` +
        `  .github/workflows/desktop.yml already passes none.`,
    );
    process.exit(1);
  }

  const ungated = DESKTOP_MARKERS.filter((m) => !bundle.includes(m));
  if (ungated.length) {
    console.error(
      `✗ desktop bundle check: the isDesktop purchase gate is not in dist/.\n` +
        `  Missing marker(s): ${ungated.join(" | ")}\n` +
        `  src/lib/purchases.ts must short-circuit initPurchases and refuse\n` +
        `  presentPaywall on isDesktop. Without it the shell takes the web\n` +
        `  billing path, because Capacitor calls Electron "web".`,
    );
    process.exit(1);
  }

  console.log(
    `✓ desktop bundle check: no RevenueCat key, isDesktop gate present in ${files.length} chunks`,
  );
}

console.log(`✓ store bundle check: RevenueCat SDK present across ${files.length} chunks`);
