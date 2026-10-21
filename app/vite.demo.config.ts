import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

// An independently deployable artifact. Never copy app/public or reuse the
// native/PWA config: that would ship the soundtrack and the entire app shell.
function enforceDemoBoundary(): Plugin {
  return {
    name: 'demo-module-boundary',
    generateBundle() {
      const forbidden = /\/src\/(main\.ts|lib\/|ui\/|game\/(run|meta|contracts|achievements|sandbox|attract)\.ts$)/;
      for (const id of this.getModuleIds()) {
        if (forbidden.test(id) || /@capacitor|@revenuecat|@capgo/.test(id)) {
          this.error(`Full-game module is not allowed in the demo: ${id}`);
        }
      }
    },
  };
}
export default defineConfig({
  root: fileURLToPath(new URL('../demo', import.meta.url)),
  publicDir: false,
  base: './',
  resolve: { alias: { 'matter-js': fileURLToPath(new URL('./node_modules/matter-js/build/matter.js', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2020' },
  plugins: [enforceDemoBoundary()],
});
