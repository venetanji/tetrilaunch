import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dev-server config for the RENDER-COST harness. Never produces a build —
 * run.ts boots it in-process and Playwright drives the page.
 *
 * Deliberately a near-copy of ../uifit/vite.config.ts, for the same reasons:
 * `root` is this directory so nothing here can leak into the app bundle, and
 * `publicDir` points back at the app's public/ so the harness serves the same
 * self-hosted fonts the app does — render.ts sets ctx.font to those families,
 * and a missing face changes both the glyph raster cost and the fallback
 * metrics every timed frame pays.
 */
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..", "..");

export default defineConfig({
  root: here,
  publicDir: resolve(appRoot, "public"),
  // The harness imports ../../src/**; without this Vite's fs guard refuses to
  // serve them, since they sit outside `root`.
  server: { fs: { allow: [appRoot] }, host: "127.0.0.1" },
  // vite-plugin-pwa is deliberately absent: a service worker would cache the
  // very module under test.
});
