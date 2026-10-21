import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'marketing/dist');
assert.ok(existsSync(resolve(dist, 'sw.js')), 'Build the marketing-only artifact before browser tests');
let legacy = false;
const oldShell = '<!doctype html><title>Legacy game</title><h1>Legacy cached game</h1>';
// A real browser-controlled legacy installation with the former Workbox cache
// namespace and navigation fallback, not a mock of the service-worker API.
const oldWorker = `
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open('workbox-precache-v2-' + self.registration.scope);
  await cache.put('/index.html', new Response(${JSON.stringify(oldShell)}, {headers:{'Content-Type':'text/html'}}));
  await cache.put('/assets/old-game.js', new Response('window.legacyGame=true'));
  self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(caches.match('/index.html'));
});`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/sw.js' && legacy) {
    res.setHeader('Content-Type', 'text/javascript'); return res.end(oldWorker);
  }
  if (pathname === '/fixture') {
    res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>Migration fixture</title>');
  }
  if (pathname === '/other/sw.js') {
    res.setHeader('Content-Type', 'text/javascript'); return res.end("self.addEventListener('install',()=>self.skipWaiting());");
  }
  const safe = resolve(dist, '.' + pathname);
  if (!safe.startsWith(dist + '/') && safe !== dist) { res.statusCode = 400; return res.end(); }
  const candidates = pathname === '/' ? [resolve(dist, 'index.html')] : [safe, safe + '.html', resolve(safe, 'index.html')];
  for (const file of candidates) {
    try { const content = await readFile(file); res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); return res.end(content); } catch {}
  }
  res.statusCode = 404; res.end('Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, chromiumSandbox: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const external = []; const errors = [];
  page.on('request', req => { if (!req.url().startsWith(origin) && !req.url().startsWith('data:')) external.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const shotDir = process.env.MARKETING_SCREENSHOT_DIR || '/tmp/tetrilaunch-marketing-shots';
  await mkdir(shotDir, { recursive: true });
  for (const [name, width, height] of [['phone', 375, 812], ['small-phone', 320, 568], ['tablet', 768, 1024], ['desktop', 1440, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').count(), 1, `${name}: one descriptive H1`);
    assert.equal(await page.locator('canvas, iframe, link[rel="manifest"]').count(), 0, `${name}: marketing only`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow`);
    for (const image of await page.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(image => image.decode());
    }
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => { if (el.scrollWidth > el.clientWidth) el.scrollLeft = 0; });
      scrollTo(0, 0);
    });
    const brokenImages = await page.locator('img').evaluateAll(images => images.filter(image => !image.complete || !image.naturalWidth).map(image => image.src));
    assert.deepEqual(brokenImages, [], `${name}: images load`);
    await page.screenshot({ path: resolve(shotDir, `${name}.png`), fullPage: true });
  }
  const hrefs = await page.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')));
  for (const href of hrefs.filter(href => href.startsWith('#') && href.length > 1)) {
    assert.equal(await page.locator(`[id="${href.slice(1)}"]`).count(), 1, `Working anchor ${href}`);
  }
  assert.ok(hrefs.some(href => /privacy/.test(href)), 'Privacy link');
  assert.ok(hrefs.some(href => /support/.test(href)), 'Support link');
  assert.ok(!hrefs.some(href => /store\.steampowered\.com|apps\.apple\.com|play\.google\.com/.test(href)), 'Unverified stores must not be live links');
  assert.equal(await page.locator('#stores [aria-disabled="true"]').count(), 2, 'Steam and mobile pending cards are explicitly disabled');
  assert.equal(await page.locator('#stores [aria-disabled="true"] a[href], #stores a[aria-disabled="true"][href]').count(), 0, 'Disabled store cards cannot navigate');
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement instanceof HTMLAnchorElement || document.activeElement instanceof HTMLButtonElement), 'Keyboard can reach an interactive control');
  for (const route of ['/about', '/privacy', '/terms', '/support']) {
    const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, `Route ${route} exists`);
    assert.equal(await page.locator('canvas, link[rel="manifest"]').count(), 0, `Route ${route} is not the game`);
  }
  assert.deepEqual(external, [], 'Page load makes no external runtime requests');
  assert.deepEqual(errors, [], 'Page has no JavaScript errors');
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0, 'New visitors receive no service worker');
  await context.close();

  legacy = true;
  const migration = await browser.newContext();
  const oldPage = await migration.newPage();
  await oldPage.goto(origin + '/fixture');
  const save = JSON.stringify({ best: 98765, unlocked: ['bay-2'], settings: { sound: false } });
  await oldPage.evaluate(async save => {
    localStorage.setItem('tetrilaunch.meta', save);
    localStorage.setItem('tetrilaunch.settings', '{"sound":false}');
    localStorage.setItem('unrelated-user-data', 'preserve');
    await caches.open('unrelated-app-cache');
    await caches.open('workbox-precache-v2-' + location.origin + '/other/');
    await navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' });
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  }, save);
  await oldPage.waitForFunction(() => !!navigator.serviceWorker.controller);
  await oldPage.goto(origin);
  assert.match(await oldPage.textContent('h1'), /Legacy cached game/, 'Legacy SW really controls navigation');
  legacy = false;
  await oldPage.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration('/'); await registration.update(); });
  await oldPage.waitForFunction(() => !document.querySelector('h1')?.textContent.includes('Legacy cached game'), null, { timeout: 15000 });
  await oldPage.waitForFunction(async () => !(await navigator.serviceWorker.getRegistrations()).some(reg => reg.scope === location.origin + '/'));
  assert.match(await oldPage.title(), /Tetrilaunch/i, 'Previously cached navigation now reaches marketing');
  const state = await oldPage.evaluate(async () => ({ save: localStorage.getItem('tetrilaunch.meta'), settings: localStorage.getItem('tetrilaunch.settings'), unrelated: localStorage.getItem('unrelated-user-data'), caches: await caches.keys(), scopes: (await navigator.serviceWorker.getRegistrations()).map(reg => reg.scope) }));
  assert.equal(state.save, save, 'Saved progress/settings preserved');
  assert.equal(state.settings, '{"sound":false}', 'Settings preserved');
  assert.equal(state.unrelated, 'preserve', 'Unrelated local storage preserved');
  assert.ok(!state.caches.includes('workbox-precache-v2-' + origin + '/'), 'Legacy root game cache removed');
  assert.ok(state.caches.includes('unrelated-app-cache'), 'Unrelated cache preserved');
  assert.ok(state.caches.includes('workbox-precache-v2-' + origin + '/other/'), 'Other-scope Workbox cache preserved');
  assert.ok(state.scopes.includes(origin + '/other/'), 'Other service-worker registration preserved');
  await oldPage.reload({ waitUntil: 'networkidle' });
  assert.match(await oldPage.title(), /Tetrilaunch/i, 'Marketing remains reachable after another reload');
  await migration.close();
  console.log(`Marketing browser: routes, local runtime, 4 responsive screenshots, keyboard and real legacy SW migration pass. Screenshots: ${shotDir}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
