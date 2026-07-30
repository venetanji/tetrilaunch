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

console.log(`✓ store bundle check: RevenueCat SDK present across ${files.length} chunks`);
