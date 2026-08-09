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
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
}));
