import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
// Modes that produce a bundle for the Capacitor shell rather than the web. Both
// must skip the service worker for the reason above; `teststore` is `native`
// plus RevenueCat's Test Store key (see src/lib/purchases.ts) and is never used
// by a release path.
const NATIVE_MODES = new Set(["native", "teststore"]);

export default defineConfig(({ mode }) => ({
  base: "./",
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
        // mp3 included so the PWA still has sound offline. It is the single
        // biggest thing in the precache (~8.6 MB of the total), which is the
        // cost of the listing claiming the game plays offline.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,mp3}"],
        // Default is 2 MB and the music tracks exceed it — without this they
        // are silently dropped from the precache manifest and only the effects
        // survive, which is exactly the kind of partial success that looks fine
        // in a build log.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
}));
