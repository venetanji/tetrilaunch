import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const server = await createServer({ configFile: 'sim/uifit/vite.config.ts' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
try {
  for (const [width, height] of [[1280, 720], [1280, 800], [1100, 680], [1400, 850], [800, 600], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${server.resolvedUrls.local[0]}harness.html`);
    await page.waitForFunction(() => window.__uifit);
    for (const screen of ['menu', 'hub']) {
      const result = await page.evaluate((screen) => {
        window.__uifit.render(screen, {left: 0, right: 0, top: 0, bottom: 0});
        const menu = document.querySelector('.menu');
        const first = menu.children[0].getBoundingClientRect();
        const last = menu.children[1].getBoundingClientRect();
        const controls = window.__uifit.padTargets();
        controls[0]?.focus();
        const moved = window.__uifit.padMove('down');
        return {width: last.right - first.left, controls: controls.length, moved};
      }, screen);
      console.log(`${screen} ${width}x${height}: ${JSON.stringify(result)}`);
      if (width === 1280) assert.ok(result.width >= (screen === 'hub' ? 700 : 1000), 'menu content should use more of the handheld screen');
      assert.ok(result.controls > 1 && result.moved, 'controller navigation can move between controls');
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
