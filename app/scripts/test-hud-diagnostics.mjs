import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"isolated_test"}' }));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__tl);
  const result = await page.evaluate(() => {
    const app = window.__tl;
    app.startGame(); app.finishTutorial();
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () { reads++; return original.call(this); };
    const sample = () => {
      reads = 0; app.hudSampleAt = performance.now() - 1001; app.sampleHudGeometry();
      return { reads, text: app.hudSample };
    };
    try {
      const ordinary = sample();
      app.showAudioDiagnostics();
      const enabled = sample();
      const saved = app.hudSample, before = reads;
      app.sampleHudGeometry();
      const throttled = reads === before;
      document.getElementById('audio-diag')?.remove();
      app.showAudioDiagnostics();
      const disabled = sample();
      return { ordinary, enabled, disabled, throttled, retained: app.hudSample === saved };
    } finally { Element.prototype.getBoundingClientRect = original; }
  });
  assert.equal(result.ordinary.reads, 0, 'ordinary gameplay must not scan HUD geometry');
  assert.equal(result.ordinary.text, null);
  assert(result.enabled.reads > 0 && result.enabled.text.includes('plant'), 'explicit diagnostics still capture real HUD geometry');
  assert(result.throttled, 'enabled diagnostics sample at most once per second');
  assert.equal(result.disabled.reads, 0, 'disabling the ruler stops geometry sampling');
  assert(result.retained, 'last in-run sample remains available after sampling stops');
  console.log('PASS: HUD geometry is opt-in, throttled, reversible, and retains its last diagnostic sample.');
} finally { await browser.close(); await server.close(); }
