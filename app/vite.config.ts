import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
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

// WEB-ONLY files under public/: the /about landing page and its gallery. They
// are served by the Pages deploy and by nothing else — a phone that installed
// the app, a desktop that ran the installer and a Steam depot all already HAVE
// the game, and a promo page for it is dead weight there (~2 MB of PNG, or
// about 6% of the bundle, for a route no native shell can even navigate to).
//
// Two mechanisms, because there are two consumers of public/:
//   - the service worker's precache, which is told to skip them below
//     (workbox.globIgnores) so a web player who never opens /about never
//     downloads it either;
//   - the native bundle, from which they are DELETED after the build. Vite's
//     publicDir copy has no filter, and both Capacitor (`webDir: "dist"`) and
//     electron-builder (`from: ../dist`) take dist/ wholesale, so the one place
//     that can keep them out of every native/desktop package at once is the
//     end of the native build itself. desktop/electron-builder.yml excludes the
//     same paths again in its own filter, as a belt to this brace.
const WEB_ONLY = ["about", "about.html"];

function stripWebOnly(mode: string): Plugin {
  return {
    name: "tetrilaunch:strip-web-only",
    apply: "build",
    closeBundle() {
      if (!NATIVE_MODES.has(mode)) return;
      const dist = fileURLToPath(new URL("./dist/", import.meta.url));
      for (const rel of WEB_ONLY) {
        rmSync(resolve(dist, rel), { recursive: true, force: true });
      }
    },
  };
}

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
    stripWebOnly(mode),
    VitePWA({
      disable: NATIVE_MODES.has(mode),
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
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
        // PNG FIRST, SVG as a bonus. iOS Safari ignores SVG manifest icons
        // entirely, and some Android launchers rasterise them poorly and then
        // cache the miss — which is how an installed web app kept showing the
        // OLD icon after the art was updated. Raster PNGs at the install sizes
        // are the reliable path every platform honours; the scalable SVG stays
        // last for the browsers that prefer it. The apple-touch-icon in
        // index.html covers the iOS home screen, which reads neither list.
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        // The policy pages and the /about landing page are real documents, not
        // app routes. Without this, the SW's navigation fallback serves the game
        // shell for /privacy, /support and /about to anyone who has visited the
        // game once — while a fresh fetch (a store reviewer, or someone opening
        // the shared /about link for the first time) sees the real page. Both
        // must see the real page.
        navigateFallbackDenylist: [/^\/privacy/, /^\/support/, /^\/about/],
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
        // The /about landing page and its gallery are web-only marketing (see
        // WEB_ONLY above). The html and png globs would otherwise precache all
        // of it for every player of the game, whether or not they ever open
        // the page.
        globIgnores: ["about/**", "about.html"],
        // Default is 2 MB and the music tracks exceed it — without this they
        // are silently dropped from the precache manifest and only the effects
        // survive, which is exactly the kind of partial success that looks fine
        // in a build log.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
}));
