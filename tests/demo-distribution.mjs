import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const root = new URL('../demo/dist/', import.meta.url);
const files = readdirSync(root, {recursive:true}).filter(path => !['assets'].includes(path));
assert.equal(files.filter(path => /^assets\/index-[\w-]+\.js$/.test(path)).length, 1);
assert.equal(files.filter(path => /^assets\/index-[\w-]+\.css$/.test(path)).length, 1);
for (const path of files) {
  assert.match(path, /^(index\.html|assets\/index-[\w-]+\.(js|css))$/, `Unexpected demo asset: ${path}`);
  const body = readFileSync(new URL(path, root), 'utf8');
  assert.doesNotMatch(body, /@capacitor|RevenueCat|revenuecat|registerSW|serviceWorker|localStorage\.setItem|fetchLeaderboard|submitScore|\/api\//);
}
assert.match(readFileSync(new URL('index.html',root), 'utf8'), /https:\/\/tetrilaunch\.com\/#stores/);
console.log('Demo artifact: only HTML, bounded JS and CSS; no app payload, saved progress, API or PWA.');
