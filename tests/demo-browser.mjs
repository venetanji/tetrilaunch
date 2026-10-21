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
async function pointerAndKeyboardControls() {
  const context = await browser.newContext({viewport:{width:1000,height:900}});
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.locator('#continue').click();
    await page.waitForTimeout(550);
    const right = page.locator('#rotate-right');
    await right.click();
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Rotation 90°'));
    assert.match(await page.locator('#stats').textContent(), /Shots 0/, 'Mouse rotation must act once without launching');
    await right.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Rotation 180°'));
    await page.keyboard.press('e');
    await page.waitForTimeout(50);
    assert.match(await page.locator('#stats').textContent(), /Shots 0 · Rotation 180°/, 'Focused controls retain native keyboard activation and suppress gameplay shortcuts');
    await page.evaluate(() => {
      window.demoWheelEvents = [];
      document.querySelector('canvas').addEventListener('wheel', event => window.demoWheelEvents.push(event.defaultPrevented));
    });
    async function wheelControlsArc(label) {
      const box = await page.locator('canvas').boundingBox();
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .55);
      const before = await page.evaluate(() => ({count:window.demoWheelEvents.length, scroll:scrollY}));
      await page.mouse.wheel(0,100);
      await page.waitForFunction(count => window.demoWheelEvents.length > count, before.count);
      assert.equal(await page.evaluate(() => window.demoWheelEvents.at(-1)), true, `${label}: canvas wheel must adjust the arc`);
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => scrollY), before.scroll, `${label}: canvas wheel must not scroll the page`);
    }
    await wheelControlsArc('After focused rotation');
    await page.locator('#pause').click();
    await page.locator('#pause').click();
    assert.equal(await page.locator('#pause').evaluate(button => document.activeElement === button), true);
    await wheelControlsArc('After resume');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#pause').textContent === 'Resume');
    assert.match(await page.locator('#stats').textContent(), /Shots 0/, 'Space on Pause must activate the focused button without firing');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('#pause').textContent === 'Pause');
    await page.locator('header a').first().focus();
    await page.keyboard.press('e');
    await page.waitForTimeout(50);
    assert.match(await page.locator('#stats').textContent(), /Shots 0 · Rotation 180°/, 'Focused links suppress gameplay shortcuts');
    await page.locator('canvas').focus();
    await page.keyboard.press('e');
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Rotation 270°'));
  } finally { await context.close(); }
}
async function secondaryTouchRotation(viewport = {width:1000,height:1400}) {
  const context = await browser.newContext({viewport,hasTouch:true,isMobile:true});
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.locator('#continue').tap();
    await page.evaluate(() => {
      window.demoTouchReleases = [];
      window.addEventListener('pointerup', event => window.demoTouchReleases.push(event.target.id || event.target.tagName));
    });
    const canvas = await page.locator('canvas').boundingBox();
    const rotate = await page.locator('#rotate-right').boundingBox();
    const cdp = await context.newCDPSession(page);
    let first = {id:1,x:canvas.x+canvas.width*.65,y:canvas.y+canvas.height*.35};
    const second = {id:2,x:rotate.x+rotate.width/2,y:rotate.y+rotate.height/2};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]});
    first = {...first,x:first.x-Math.min(130,canvas.width*.35),y:first.y+80};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[first]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first,second]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[second]});
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.demoTouchReleases), ['rotate-right'], 'Releasing the rotate finger must leave the slingshot finger down');
    assert.match(await page.locator('#stats').textContent(), /Shots 0 · Rotation 90°/, 'Second finger must rotate the held slingshot without firing');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[first]});
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('Shots 1'));
    assert.deepEqual(await page.evaluate(() => window.demoTouchReleases), ['rotate-right','CANVAS']);
  } finally { await context.close(); }
}
async function compactLayouts() {
  const failures = [];
  for (const [name, width, height, insets] of [
    ['landscape', 844, 390, {top:0,right:0,bottom:0,left:0}],
    ['compact-phone', 320, 568, {top:0,right:0,bottom:0,left:0}],
    ['notched-landscape', 844, 390, {top:0,right:44,bottom:21,left:44}],
    ['notched-phone', 375, 812, {top:44,right:0,bottom:34,left:0}],
  ]) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:true});
    try {
      const page = await context.newPage();
      await page.goto(origin);
      // Like UI-fit, substitute the env-derived tokens: Chromium has no notch.
      await page.addStyleTag({content:`:root {
        --safe-top:${insets.top}px; --safe-right:${insets.right}px;
        --safe-bottom:${insets.bottom}px; --safe-left:${insets.left}px;
      }`});
      await page.locator('#continue').click();
      const layout = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        const padding = getComputedStyle(document.body);
        return {
          field:rect('.field'), controls:rect('.controls'), toolbar:rect('.toolbar'),
          buttons:[...document.querySelectorAll('.controls button')].map(button => button.getBoundingClientRect().toJSON()),
          padding:{top:parseFloat(padding.paddingTop),right:parseFloat(padding.paddingRight),bottom:parseFloat(padding.paddingBottom),left:parseFloat(padding.paddingLeft)},
          scrollWidth:document.documentElement.scrollWidth,
        };
      });
      assert.ok(layout.padding.top >= insets.top && layout.padding.right >= insets.right
        && layout.padding.bottom >= insets.bottom && layout.padding.left >= insets.left,
      `${name}: content respects safe areas: ${JSON.stringify(layout.padding)}`);
      assert.ok(layout.toolbar.top >= insets.top - 1 && layout.controls.bottom <= height - insets.bottom + 1,
        `${name}: field and controls fit together: ${JSON.stringify(layout)}`);
      assert.ok(layout.field.height >= 140, `${name}: field keeps useful aiming space`);
      assert.ok(layout.buttons.every(button => button.width >= 44 && button.height >= 44
        && button.left >= insets.left && button.right <= width - insets.right), `${name}: all aiming controls remain usable`);
      assert.ok(layout.scrollWidth <= width + 1, `${name}: no horizontal overflow`);
      await page.locator('#pause').click();
      await page.locator('#pause').click();
      const resumed = await page.locator('#play-area').boundingBox();
      assert.ok(resumed.y >= insets.top - 1 && resumed.y + resumed.height <= height - insets.bottom + 1,
        `${name}: Resume presents the whole play area without manual scrolling`);
      assert.equal(await page.locator('#pause').evaluate(button => document.activeElement === button), true,
        `${name}: Resume retains native button focus`);
      await mkdir('/tmp/tetrilaunch-demo-shots', {recursive:true});
      await page.screenshot({path:`/tmp/tetrilaunch-demo-shots/fit-${name}.png`});
      console.log(`Demo fit ${name}: field ${Math.round(layout.field.height)}px, controls bottom ${Math.round(layout.controls.bottom)}px / ${height - insets.bottom}px usable`);
    } catch (error) { failures.push(error); }
    finally { await context.close(); }
  }
  if (failures.length) throw new AggregateError(failures, 'Demo compact layout regressions');
}
async function accessibleReadouts() {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal(await page.locator('#stats').evaluate(stats => !!stats.closest('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]')),
      false, 'Per-frame telemetry must not be a live announcement');
    const result = page.getByRole('dialog');
    assert.equal(await result.getAttribute('aria-labelledby'), 'result-title', 'Result changes have an accessible title');
    assert.equal(await result.getAttribute('aria-describedby'), 'result-body', 'Result changes announce their meaningful explanation');
    assert.equal(await page.locator('#continue').evaluate(button => document.activeElement === button), true,
      'Result dialogs move focus inside for announcement');
    const safeSources = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
      .filter(rule => rule.selectorText === ':root').map(rule => rule.style.cssText).join(' '));
    for (const side of ['top','right','bottom','left']) {
      assert.match(safeSources, new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-${side}`),
        `Safe ${side} token reads the real browser inset`);
    }
  } finally { await context.close(); }
}
try {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || ['/usr/bin/chromium','/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
  browser = await chromium.launch({ ...(executablePath ? {executablePath} : {}), headless:true, chromiumSandbox:true });
  const controls = await Promise.allSettled([
    pointerAndKeyboardControls(), secondaryTouchRotation(), compactLayouts(), accessibleReadouts(),
    secondaryTouchRotation({width:844,height:390}), secondaryTouchRotation({width:320,height:568}),
  ]);
  const failures = controls.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Demo pointer/keyboard regressions');
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
  console.log('Demo browser: mouse/wheel controls, secondary-touch rotation, keyboard focus, launches, pause, retry, restart, query isolation, responsive rendering and no external requests passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
