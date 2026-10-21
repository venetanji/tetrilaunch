import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const scope = 'https://tetrilaunch.com/';
const source = readFileSync(new URL('../marketing/sw.js', import.meta.url), 'utf8');
const listeners = new Map();
const caches = new Set([
  `workbox-precache-v2-${scope}`,
  `${'workbox-precache-v2-'}${scope}other/`,
  'unrelated-app-cache',
  'tetrilaunch-user-save',
]);
const calls = [];
const windows = [
  { url: scope + '?old-game=1', navigate: async path => calls.push(['navigate', 'game', path]) },
  { url: scope + 'privacy', navigate: async path => calls.push(['navigate', 'privacy', path]) },
  { url: scope + 'terms.html', navigate: async path => calls.push(['navigate', 'terms', path]) },
  { url: scope + 'support/', navigate: async path => calls.push(['navigate', 'support', path]) },
];
vm.runInNewContext(source, {
  URL,
  caches: { delete: async name => caches.delete(name) },
  self: {
    location: { origin: new URL(scope).origin },
    registration: { scope, unregister: async () => calls.push(['unregister']) },
    skipWaiting: async () => calls.push(['skipWaiting']),
    addEventListener: (event, listener) => listeners.set(event, listener),
    clients: {
      claim: async () => calls.push(['claim']),
      matchAll: async options => { assert.equal(options.type, 'window'); return windows; },
    },
  },
});
assert.deepEqual([...listeners.keys()].sort(), ['activate', 'install'], 'Retirement worker cannot intercept requests');
listeners.get('install')({ waitUntil: () => {} });
let activation;
listeners.get('activate')({ waitUntil: promise => { activation = promise; } });
await activation;
assert.deepEqual([...caches], [`workbox-precache-v2-${scope}other/`, 'unrelated-app-cache', 'tetrilaunch-user-save'], 'Only the known root Workbox cache is deleted');
assert.deepEqual(calls, [
  ['skipWaiting'], ['claim'], ['unregister'],
  ['navigate', 'game', '/'], ['navigate', 'privacy', '/privacy'],
  ['navigate', 'terms', '/terms.html'], ['navigate', 'support', '/support/'],
]);
console.log('Marketing retirement: exact cache boundary, policy navigation and no fetch handler pass.');
