import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// A local debug APK always reports versionCode=1/versionName=1.0 — Capacitor's
// generated build.gradle never bumps it, and signing.gradle only overrides it
// for a release build (see android/signing.gradle). That leaves no way to tell
// which commit is actually installed on a test device, so the short SHA gets
// baked in as a compile-time constant instead and shown on the menu screen.
function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    // Otherwise two builds with different uncommitted edits show the same
    // tag as HEAD's clean commit — exactly the "which build is this"
    // confusion this feature exists to kill, just one step removed.
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "dev";
  }
}

// Landscape, fullscreen, installable PWA. Capacitor consumes the same dist/ —
// but WITHOUT the service worker, which is what `--mode native` selects.
//
// A service worker earns its keep on the web by making the app work offline. In
// the Capacitor shell every asset is already on the device, so it caches local
// files against local files and buys nothing. What it does buy is a stale-code
// hazard: `adb install -r` preserves app data, so the old worker survives the
// update and keeps serving the previous bundle from its precache. Capacitor
// serves from https://localhost with no cache headers for the WebView to
// revalidate sw.js against, so the update check never wins. In testing this
// shipped the previous build twice in a row; in release it would mean an update
// silently runs old code until something evicts the cache.
// Modes that produce a bundle for the Capacitor shell rather than the web. All
// must skip the service worker for the reason above.
//
//   native    the shippable one.
//   teststore native plus RevenueCat's Test Store key (src/lib/purchases.ts).
//   sandbox   native plus the developer sandbox (src/lib/sandbox.ts) — a build
//             for putting an arbitrary tier, variant or bay on a real phone
//             without playing the ladder up to it.
//
// Neither of the last two is ever used by a release path, and
// scripts/verify-store-bundle.mjs fails the build if either one's fingerprint
// reaches a bundle that did not ask for it.
const NATIVE_MODES = new Set(["native", "teststore", "sandbox"]);

export default defineConfig(({ mode }) => ({
  base: "./",
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId()),
  },
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    VitePWA({
      disable: NATIVE_MODES.has(mode),
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Tetrilaunch",
        short_name: "Tetrilaunch",
        description: "A neon-arcade physics cannon puzzle. Launch tetrominoes, clear lines.",
        theme_color: "#07070f",
        background_color: "#07070f",
        display: "fullscreen",
        orientation: "landscape",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // The policy pages are real documents, not app routes. Without this,
        // the SW's navigation fallback serves the game shell for /privacy and
        // /support to anyone who has visited the game once — while the store
        // reviewers, fetching fresh, see the policy. Both must see the policy.
        navigateFallbackDenylist: [/^\/privacy/, /^\/support/],
        // mp3 included so the PWA still has sound offline. It is by a wide
        // margin the biggest thing in the precache — ~30.3 MB of a ~30.7 MB
        // total, and 29 of that is music, because the Deep Run gives each of
        // its ten bays a full-length bed of its own (game/run.ts's bayMusic)
        // rather than looping one, and Contracts add a rare special on top
        // (contracts.ts's contractBed).
        // That is the price of the listing claiming the game plays offline:
        // dropping audio/music/ from this glob would cut the web install by
        // ~95% and break the claim, so it is a product decision, not a build
        // tweak. m4a and ogg sit beside mp3 because they are the other two
        // extensions scripts/prepare-audio.mjs's --codec can ship the beds
        // as — a codec swap must not silently un-cache the soundtrack and
        // break offline play for exactly the installs the claim is about.
        // Only one of the three exists in dist at a time (prepare-audio
        // rebuilds public/audio from scratch), so the extra patterns match
        // nothing until they match everything.
        //
        // Pinned, not merely correct: sim/systems.ts's bed census asserts this
        // glob admits audio.ts's LONG_EXT, because Workbox does not error on a
        // pattern that matches nothing. Without that check a later edit here
        // could re-narrow the list and the failure would be invisible — clean
        // build, green census, perfect online playback, and an installed PWA
        // that precaches zero beds.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,mp3,m4a,ogg}"],
        // Default is 2 MB and the music tracks exceed it — without this they
        // are silently dropped from the precache manifest and only the effects
        // survive, which is exactly the kind of partial success that looks fine
        // in a build log.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
}));
