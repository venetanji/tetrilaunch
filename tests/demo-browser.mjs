import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../app/node_modules/playwright/index.mjs';
const dist = fileURLToPath(new URL('../demo/dist/', import.meta.url));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(dist)) { res.statusCode = 400; res.end(); return; }
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || ['/usr/bin/chromium','/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? {executablePath} : {}), headless:true, chromiumSandbox:true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], outside = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (!req.url().startsWith(origin)) outside.push(req.url()); });
  await page.goto(origin + '/?tier=10&bay=10', {waitUntil:'networkidle'});
  assert.match(await page.locator('#progress').textContent(), /1 \/ 9/, 'URL cannot choose campaign content');
  await page.getByRole('button', {name:'Start demo',exact:true}).dblclick({delay:60});
  await page.waitForTimeout(100);
  assert.match(await page.locator('#stats').textContent(), /Shots 0/, 'Double-click tail must not launch');
  await page.waitForTimeout(550);
  await page.locator('canvas').focus();
  await page.keyboard.press('e');
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Rotation 90°'));
  await page.getByRole('button', {name:'Rotate left',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Rotation 0°'));
  await page.locator('canvas').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Shots 1'));
  await page.getByRole('button', {name:'Pause',exact:true}).click();
  await page.locator('canvas').focus();
  const paused = await page.locator('#stats').textContent();
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.match(await page.locator('#stats').textContent(), /Shots 1/);
  assert.match(paused, /Rows/);
  await page.getByRole('button', {name:'Resume',exact:true}).click();
  await page.getByRole('button', {name:'Retry lesson',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Shots 0'));
  await page.waitForTimeout(550);
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + box.width * .75, box.y + box.height * .55);
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Shots 1'));
  await page.getByRole('button', {name:'Restart demo',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Shots 0'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => document.querySelector('#pause').textContent === 'Resume');
  await page.getByRole('button', {name:'Resume',exact:true}).click();
  await mkdir('/tmp/tetrilaunch-demo-shots', {recursive:true});
  for (const [name,width,height] of [['phone',375,812],['landscape',844,390],['desktop',1440,1000]]) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow`);
    const pixel = await page.locator('canvas').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      return data.some((v,i) => i%4 !== 3 && v > 100);
    });
    assert.ok(pixel, 'Real renderer paints nonempty game field');
    await page.screenshot({path:`/tmp/tetrilaunch-demo-shots/${name}.png`,fullPage:true});
  }
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),0);
  assert.equal(await page.locator('a[href="https://tetrilaunch.com/#stores"]').count(),2);
  assert.deepEqual(outside,[]);
  assert.deepEqual(errors,[]);
  console.log('Demo browser: actual keyboard/pointer launches, pause, retry, restart, query isolation, responsive rendering and no external requests passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
