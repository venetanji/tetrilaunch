import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright';

// Chromium's automation defaults disable the very cache this regression needs.
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  // Exercise the full browser's navigation lifecycle, matching local Chromium.
  // Playwright otherwise selects its separate headless shell in CI.
  channel: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? undefined : 'chromium',
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.evaluate(() => window.__playtest.on('cached-navigation regression'));
  await page.locator('[data-action="tiers"]').click();
  await page.locator('[data-action="offer-skip"]').click();
  await page.locator('[data-action="play"]').click();
  await page.locator('#hud-launches').waitFor();
  await page.waitForTimeout(500); // Input's intentional modal wake guard.
  await page.evaluate(() => {
    window.navigationRecorder = window.__playtest;
    window.cachedReturns = 0;
    addEventListener('pageshow', event => { if (event.persisted) window.cachedReturns++; });
  });
  const shots = () => page.evaluate(() => window.__playtest.status().shots);
  async function fireOnce(action) {
    const before = await shots();
    await action();
    await page.waitForFunction(count => window.__playtest.status().shots === count, before + 1);
    await page.waitForTimeout(1800); // The starting cannon reloads in 1350ms.
    assert.equal(await shots(), before + 1, 'one input must fire exactly once');
  }
  await fireOnce(() => page.keyboard.press('Space'));
  await fireOnce(() => page.mouse.click(1100, 500));
  for (let visit = 1; visit <= 3; visit++) {
    // Leave while aiming, with a key held: neither release is guaranteed on departure.
    await page.mouse.move(1100, 500);
    await page.mouse.down();
    await page.keyboard.down('ArrowUp');
    const before = await shots();
    await page.goto(new URL('about.html', origin).href);
    await page.goBack({ waitUntil: 'commit' });
    await page.waitForFunction(count => window.cachedReturns === count, visit);
    assert.equal(await page.evaluate(() => window.__playtest === window.navigationRecorder), true,
      'Back must restore the original game, not reload it');
    await page.mouse.up();
    await page.keyboard.up('ArrowUp');
    assert.equal(await shots(), before, 'interrupted aim must not fire on return');
    await fireOnce(() => page.keyboard.press('Space'));
    await fireOnce(() => page.mouse.click(1100, 500));
  }
  console.log('PASS: 3 real BFcache returns preserve the game; keyboard and mouse fire once; interrupted holds do not fire.');
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
