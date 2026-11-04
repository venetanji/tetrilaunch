import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
try {
  const startup = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await startup.addInitScript(() => { window.desktopSave = { open: async () => { throw new Error('Steam unavailable'); }, write: async () => {} }; });
  await startup.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const startupRetry = startup.locator('#desktop-save-error button');
  await startupRetry.waitFor();
  assert.equal(await startupRetry.textContent(), 'Retry save', 'startup failure must not advertise a controller handler that has not started');
  await startup.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    window.failSave = false;
    window.testPad = { id: 'Xbox test controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad] });
    window.desktopSave = {
      open: async () => ({}),
      write: async () => { if (window.failSave) throw new Error('test disk failure'); },
    };
  });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__tl);
  await page.locator('[data-action="tiers"]').click();
  await page.locator('[data-action="offer-skip"]').click();
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(() => window.__tl.state === 'playing');
  await page.keyboard.down('ArrowUp');
  assert.equal(await page.evaluate(() => window.__tl.input.keys.has('arrowup')), true, 'held gameplay input is registered');
  await page.evaluate(async () => {
    window.failSave = true;
    const { progressStorage } = await import('/src/lib/desktop-save.ts');
    progressStorage.setItem('tetrilaunch.best', '123');
  });
  await page.locator('#desktop-save-error').waitFor();
  assert.equal(await page.locator('#desktop-save-error button').textContent(), 'Retry save (controller confirm)', 'running app advertises the available controller retry');
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused');
  assert.equal(await page.evaluate(() => window.__tl.input.keys.size), 0, 'quiescing clears held gameplay keys');
  await page.keyboard.press('p');
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'keyboard cannot resume behind save error');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'Escape cannot resume behind save error');
  assert.equal(await page.evaluate(() => window.__tl.pad.hooks.onCapture(1)), true, 'gamepad capture consumes input during save error');
  await page.evaluate(() => window.__tl.pad.hooks.onPause());
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'gamepad pause cannot resume behind save error');
  for (const [button, name] of [[0, 'confirm'], [1, 'B'], [8, 'Select']]) {
    await page.evaluate((value) => window.__tl.onPadUiButton(value), button);
    assert.equal(await page.evaluate(() => window.__tl.state), 'paused', `gamepad ${name} cannot activate the covered pause menu`);
  }
  await page.evaluate(() => document.querySelector('[data-action=resume]').click());
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'synthetic UI activation cannot bypass inertness');
  await page.evaluate(() => window.__tl.resume());
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'direct resume cannot bypass the guard');
  await page.evaluate(() => window.flushDesktopSave(true).catch(() => {}));
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), true, 'failed close cannot unlock an active save error');
  await page.evaluate(() => window.__tl.resume());
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'failed close cannot clear the resume guard');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = true; window.testPad.buttons[9].value = 1; });
  await page.waitForFunction(() => window.__tl.pad.prev[9] === true);
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'a real polled Start edge is consumed while locked');
  const failedRetry = await page.locator('#desktop-save-error button').elementHandle();
  await failedRetry.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((button) => !button.isConnected, failedRetry);
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), true, 'failed retry keeps the lock');
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'failed retry keeps gameplay paused');
  await page.keyboard.up('ArrowUp');
  await page.evaluate(() => { window.failSave = false; });
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; window.testPad.buttons[0].value = 1; });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#desktop-save-error').count(), 0, 'controller confirm can retry a recovered save');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; window.testPad.buttons[0].value = 0; });
  await page.waitForFunction(() => window.__tl.pad.prev[0] === false);
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), false, 'successful retry unlocks the app');
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'retry leaves gameplay paused');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'held Start does not replay after recovery');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = false; window.testPad.buttons[9].value = 0; });
  await page.waitForFunction(() => window.__tl.pad.prev[9] === false);
  await page.evaluate(() => { window.testPad.buttons[9].pressed = true; window.testPad.buttons[9].value = 1; });
  await page.waitForFunction(() => window.__tl.state === 'playing');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = false; window.testPad.buttons[9].value = 0; });
  await page.waitForFunction(() => window.__tl.pad.prev[9] === false);
  await page.evaluate(() => { window.dispatchEvent(new Event('desktop-save-quiesce')); window.dispatchEvent(new Event('desktop-save-resume')); });
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), false, 'clean close cancellation can unlock without a notice');
  assert.equal(await page.evaluate(() => window.__tl.state), 'paused', 'unlock does not silently resume gameplay');
  await page.keyboard.press('p');
  assert.equal(await page.evaluate(() => window.__tl.state), 'playing', 'pause controls still work after clean unlock');
  await page.evaluate(() => { window.__tl.setState('menu'); window.dispatchEvent(new Event('desktop-save-quiesce')); });
  for (const button of [0, 1, 8]) await page.evaluate((value) => window.__tl.onPadUiButton(value), button);
  await page.keyboard.press('Escape');
  await page.keyboard.down('ArrowUp');
  assert.equal(await page.evaluate(() => window.__tl.input.keys.size), 0, 'global gameplay input stays blocked behind a quiesced menu');
  await page.keyboard.up('ArrowUp');
  assert.equal(await page.evaluate(() => window.__tl.state), 'menu', 'shortcuts cannot change menus while quiesced');
  await page.evaluate(() => { window.__tl.setState('controls'); window.__tl.controlsTab = 'keyboard'; window.__tl.rebinding = 'fire'; });
  await page.keyboard.press('q');
  assert.equal(await page.evaluate(() => window.__tl.rebinding), 'fire', 'quiescing blocks keyboard rebind capture');
  await page.evaluate(() => { window.__tl.controlsTab = 'gamepad'; window.__tl.pad.hooks.onCapture(2); });
  assert.equal(await page.evaluate(() => window.__tl.rebinding), 'fire', 'quiescing blocks gamepad rebind capture');
  await page.evaluate(() => { window.__tl.rebinding = null; window.dispatchEvent(new Event('desktop-save-resume')); });
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), false, 'menu unlocks on a clean resume');
  console.log('Save error: keyboard, gamepad and direct resume blocked; failed close remains locked; retry restores controls.');
} finally {
  await browser.close();
  await server.close();
}
