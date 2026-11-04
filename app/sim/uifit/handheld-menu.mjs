import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const server = await createServer({ configFile: 'sim/uifit/vite.config.ts' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
try {
  for (const [width, height] of [[1280, 720], [1280, 800], [1100, 680], [1400, 850], [800, 600], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${server.resolvedUrls.local[0]}harness.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__uifit);
    // Match run.ts: load the actual faces before measuring, then settle two frames.
    await page.evaluate(async () => {
      const faces = [
        '12px "Press Start 2P"', '500 12px "Rajdhani"', '700 12px "Rajdhani"',
        '700 12px "Orbitron"', '900 12px "Orbitron"',
        '400 12px "JetBrains Mono"', '700 12px "JetBrains Mono"', '800 12px "JetBrains Mono"',
      ];
      await Promise.all(faces.map((face) => document.fonts.load(face, 'TETRILAUNCH 0123456789$♻')));
      await document.fonts.ready;
    });
    for (const screen of ['menu', 'hub']) {
      await page.evaluate((id) => window.__uifit.render(id, {left: 0, right: 0, top: 0, bottom: 0}), screen);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const result = await page.evaluate((id) => {
        document.documentElement.dataset.profile = 'gamepad';
        const menu = document.querySelector('.menu');
        const first = menu.children[0].getBoundingClientRect();
        const last = menu.children[1].getBoundingClientRect();
        const start = document.querySelector(id === 'menu' ? '[data-action="tiers"]' : '[data-action="leaderboard"]');
        const expected = document.querySelector(id === 'menu' ? '[data-action="howto"]' : '#menu-play');
        start.focus();
        const started = document.activeElement === start;
        window.__uifit.padMove('down');
        const active = document.activeElement;
        const rect = active.getBoundingClientRect();
        const boxes = window.__uifit.padBoxes(active);
        const paneCut = boxes ? Math.max(boxes.unit.bottom - boxes.pane.bottom, boxes.pane.top - boxes.unit.top) : 0;
        return {
          width: last.right - first.left,
          previewWidth: document.querySelector(".tierhub__preview .ico")?.getBoundingClientRect().width ?? null,
          started,
          reached: active === expected && active !== start,
          visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
            rect.right <= innerWidth && rect.bottom <= innerHeight && paneCut <= 1 &&
            getComputedStyle(active).visibility === 'visible',
        };
      }, screen);
      console.log(`${screen} ${width}x${height}: ${JSON.stringify(result)}`);
      if (width === 1280) assert.ok(result.width >= (screen === 'hub' ? 700 : 1000), 'menu content should use more of the handheld screen');
      if (width === 1280 && screen === 'hub') assert.ok(result.previewWidth >= 36, 'hub previews grow at handheld sizes');
      assert.ok(result.started && result.reached && result.visible, 'controller moves to the expected visible control');
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
