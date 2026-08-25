import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Dev-server config for the UI-fit harness. Never produces a build — run.mjs
 * boots this in-process and Playwright drives the page.
 *
 * `root` is this directory, so harness.html is the only entry and nothing here
 * can leak into the app bundle (vite.config.ts at the app root builds
 * index.html and index.html alone).
 *
 * `publicDir` points back at the app's public/ so the harness serves the same
 * self-hosted fonts the app does. That is not cosmetic: the pixel face (Press
 * Start 2P) is roughly twice as wide per glyph as the fallback stack, and every
 * overflow number this harness reports is a text-measurement result. Measuring
 * against the fallback would report fits that the real app does not have.
 */
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..", "..");

export default defineConfig({
  root: here,
  publicDir: resolve(appRoot, "public"),
  // The app's own config defines this (see ../../vite.config.ts) and the real
  // bundle prints the build's short SHA in the menu's corner. Without the
  // define here `import.meta.env.VITE_BUILD_ID` resolves to undefined, so
  // every screenshot this harness writes carried a literal "undefined" in its
  // bottom-right corner — a defect that does not exist in any shipped build,
  // printed onto the artefact the team reviews builds by.
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify("uifit") },
  // The harness imports ../../src/**; without this Vite's fs guard refuses to
  // serve them, since they sit outside `root`.
  server: { fs: { allow: [appRoot] }, host: "127.0.0.1" },
  // vite-plugin-pwa is deliberately absent: a service worker in the harness
  // would cache the very stylesheet under test.
});
