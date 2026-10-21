import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'marketing/dist');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.equal(pkg.scripts.build, 'node scripts/build-marketing.mjs', 'Default public build must not invoke the game build');
const config = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
assert.equal(config.build.command, 'npm run build', 'Wrangler uses the marketing build');
for (const [environment, settings] of [['production', config], ['staging', config.env.staging]]) {
  assert.equal(settings.assets.directory, 'marketing/dist', `${environment}: deploy only marketing output`);
  assert.equal(settings.assets.not_found_handling, 'none', `${environment}: no SPA fallback to game`);
  assert.deepEqual(settings.assets.run_worker_first, ['/api/*'], `${environment}: keep API routing intact`);
}
const appPackage = JSON.parse(readFileSync(resolve(root, 'app/package.json'), 'utf8'));
assert.match(appPackage.scripts['build:native'], /vite build --mode native/, 'Native packaging still builds the full native game');

assert.ok(existsSync(resolve(dist, 'index.html')), 'Marketing-only build must produce marketing/dist/index.html');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(resolve(dir, entry.name)) : [relative(dist, resolve(dir, entry.name))]);
}
const artifact = files(dist);
assert.ok(artifact.length > 4, 'Marketing artifact must include policy pages and its retirement worker');
for (const path of artifact) {
  assert.doesNotMatch(path, /(^|\/)(audio|node_modules|android|ios|desktop|src)(\/|$)|\.(mp3|m4a|ogg|wav|apk|aab|ipa|exe|dmg|AppImage|webmanifest)$/i, `Forbidden game/native/PWA payload: ${path}`);
  assert.doesNotMatch(path, /(^|\/)(workbox-[^/]+|registerSW\.js|manifest\.json)$/, `Forbidden PWA payload: ${path}`);
  if (/\.(m?js)$/.test(path)) {
    assert.ok(['sw.js', 'retire-pwa.js'].includes(path), `Only retirement scripts may ship: ${path}`);
    const source = readFileSync(resolve(dist, path), 'utf8');
    assert.doesNotMatch(source, /matter-js|@capacitor|RevenueCat|createGame|requestAnimationFrame/, `Game runtime leaked into ${path}`);
  }
}
const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
assert.doesNotMatch(index, /<canvas|rel=["']manifest|<iframe|src=["']https?:\/\//i, 'Landing must not embed the full game, install prompt, or remote runtime');
assert.match(index, /Tetrilaunch/i);
assert.ok(existsSync(resolve(dist, 'sw.js')), 'Retirement worker must remain at the old /sw.js URL');
for (const route of ['privacy', 'terms', 'support']) {
  assert.ok(existsSync(resolve(dist, `${route}.html`)) || existsSync(resolve(dist, route, 'index.html')), `${route} policy route must ship`);
}
console.log(`Marketing distribution: ${artifact.length} files; no game, audio, native package or PWA payload.`);
