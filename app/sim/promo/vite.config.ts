import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dev-server config for the PROMO CAPTURE harness. Never produces a build —
 * run.ts boots it in-process and Playwright drives the page.
 *
 * The same shape as ../uifit/vite.config.ts and for the same reasons: `root`
 * is this directory so harness.html is the only entry and nothing here can
 * leak into the app bundle; `publicDir` points at the app's public/ so the
 * page gets the shipped fonts and audio.
 *
 * What differs from the two sibling harnesses is what the page IMPORTS: the
 * whole app (src/main.ts), not a screen list or a bare render(). The promo
 * needs the HUD, the coach cards, the DOM screens and the real bay under one
 * roof, and main.ts under `vite dev` hands its App instance to the page as
 * window.__tl (import.meta.env.DEV) — which is the hook the harness drives.
 */
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..", "..");

export default defineConfig({
  root: here,
  publicDir: resolve(appRoot, "public"),
  server: { fs: { allow: [appRoot] }, host: "127.0.0.1" },
  // vite-plugin-pwa is deliberately absent: a service worker would cache the
  // bundle between beats.
});
