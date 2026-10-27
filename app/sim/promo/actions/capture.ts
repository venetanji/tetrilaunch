/** Native, normal-speed pilot. Only the capture harness and its public controls are used. */
import { installCaptureCssClock } from './css-clock';
import { verifyCaptureCssClock } from './css-clock-regression';
import { createServer } from 'vite';
import { _electron, type Browser, type ElectronApplication, type CDPSession } from 'playwright';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { SCENES, STORE_META, SETUPS, type BotSpec, type PromoEvent } from '../beats';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const args = process.argv.slice(2);
const arg = (key: string, fallback: string): string => args.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const fps = Number(arg('fps', '60'));
const seconds = Number(arg('seconds', '4'));
const warmup = Number(arg('warmup', '6'));
const shotGap = Number(arg('shot-gap', '0.9'));
const sceneId = arg('scene', 'congestion');
const out = resolve(arg('out', 'sim/results/steam-trailer'));
if (![60, 120].includes(fps)) throw new Error('Pilot fps must be 60 or 120');
if (!(seconds >= 2 && seconds <= 12 && Number.isInteger(seconds * fps))) throw new Error('Pilot duration must be 2–12 seconds and an integral frame count');
if (!(warmup >= 0 && warmup <= 15)) throw new Error('Warmup must be 0–15 seconds');
if (!(shotGap >= 0.7 && shotGap <= 2)) throw new Error('Shot gap must be 0.7–2 seconds');
const scene = SCENES.find(v => v.id === sceneId);
if (!scene || scene.show.kind !== 'bay') throw new Error(`Not a gameplay scene: ${sceneId}`);
// This pilot measures cadence, not the special-event cue for a full trailer segment.
if (!['congestion', 'mid-bay-launch', 'materials-bay', 'hazard-run'].includes(sceneId)) {
  throw new Error('Pilot supports only non-scripted-hand scenes; full effect choreography is a later stage');
}
const show = scene.show;
const frameCount = Math.round(seconds * fps);
await mkdir(out, { recursive: true });
await mkdir(resolve(out, 'samples'), { recursive: true });

// Import the original driver without invoking its command-line capture main.
// Its dynamic CLOCK_DT remains 1000/fps; the product still steps at exactly 60Hz.
process.env.PROMO_DRIVER_ONLY = '1';
const { openDriver } = await import('../run');
const server = await createServer({ configFile: resolve(here, '../vite.config.ts') });
const sessions = new Set<ElectronApplication>();
const profiles: string[] = [];
let electronVersion = '';
let chromiumVersion = '';
const nativeBase = 'app://tetrilaunch/';
const rasterArgs = [
  '--disable-accelerated-2d-canvas', '--num-raster-threads=1', '--disable-partial-raster',
  '--disable-checker-imaging', '--disable-threaded-animation', '--disable-lcd-text',
  '--disable-font-subpixel-positioning', '--force-device-scale-factor=1',
];
try {
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('Local capture server has no URL');
  const browser = {
    async newContext(view: { viewport: { width: number; height: number } }) {
      const profile = await mkdtemp(resolve(tmpdir(), 'tetrilaunch-pilot-'));
      profiles.push(profile);
      const electron = await _electron.launch({
        executablePath: process.env.TL_ELECTRON_PATH ?? resolve(appRoot, 'desktop/node_modules/electron/dist/electron'),
        args: [resolve(here, 'desktop-shell.cjs'), ...rasterArgs],
        env: { ...process.env, TL_CAPTURE_PROFILE: profile, TL_CAPTURE_VITE: base },
        timeout: 30_000,
      });
      sessions.add(electron);
      const versions = await electron.evaluate(() => ({ electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '' }));
      electronVersion = versions.electron;
      chromiumVersion = versions.chrome;
      const ctx = electron.context();
      const originalCDP = ctx.newCDPSession.bind(ctx);
      ctx.newCDPSession = async page => {
        const cdp = await originalCDP(page);
        const originalSend = cdp.send.bind(cdp);
        cdp.send = (async (method: string, params?: Record<string, unknown>) => {
          if (method === 'Page.captureScreenshot' && params?.format === 'png') {
            return electron.evaluate(async ({ BrowserWindow }: any) => {
              const win = BrowserWindow.getAllWindows()[0];
              const shot = await win.webContents.capturePage();
              const size = shot.getSize();
              if (size.width !== 1920 || size.height !== 1080) throw new Error(`Unexpected capture size ${size.width}x${size.height}`);
              return { data: shot.toPNG().toString('base64') };
            });
          }
          return originalSend(method as Parameters<CDPSession['send']>[0], params as never);
        }) as CDPSession['send'];
        return cdp;
      };
      ctx.newPage = async () => {
        const ready = electron.waitForEvent('window', { timeout: 15_000 });
        await electron.evaluate(({ BrowserWindow }: any, dims: { width: number; height: number }) => {
          const win = new BrowserWindow({
            ...dims, useContentSize: true, x: 0, y: 0, frame: false, show: true, backgroundColor: '#07070f',
            webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
          });
          win.setContentSize(dims.width, dims.height);
          void win.loadURL('about:blank');
        }, view.viewport);
        const page = await ready;
        await page.setViewportSize(view.viewport);
        return page;
      };
      const originalClose = ctx.close.bind(ctx);
      ctx.close = async () => { ctx.close = originalClose; sessions.delete(electron); await electron.close(); };
      return ctx;
    },
    async close() { for (const electron of sessions) await electron.close(); sessions.clear(); },
  } as unknown as Browser;
  const driver = await openDriver(browser, nativeBase, { w: 1920, h: 1080, dpr: 1, touch: false }, { ...STORE_META, ...SETUPS.ladder }, { nativeCompositor: true });
  try {
    const viewport = await driver.page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, origin: location.origin, coarsePointer: matchMedia('(pointer: coarse)').matches }));
    if (viewport.width !== 1920 || viewport.height !== 1080 || viewport.dpr !== 1 || viewport.coarsePointer) throw new Error(`Wrong desktop layout: ${JSON.stringify(viewport)}`);
    await driver.page.evaluate(([config, bot]) => window.__promo.launchBay(config, bot), [show.config, show.bot] as const);
    await driver.page.evaluate(() => window.__promo.dismissCoach());
    if (arg('css-regression', 'false') === 'true') {
      await verifyCaptureCssClock(driver, out);
      await driver.page.evaluate(([config, bot]) => window.__promo.launchBay(config, bot), [show.config, show.bot] as const);
    } else await driver.page.evaluate(installCaptureCssClock);
    await driver.tick(Math.round(warmup * fps));
    await driver.page.evaluate(() => { window.__promo.attachBot(null); window.__promo.dismissCoach(); window.__captureCssClock!.sync(0); });
    const start = (await driver.snapshot()).status;
    if (start.status !== 'playing') throw new Error(`Scene finished during warmup: ${JSON.stringify(start)}`);
    const mp4 = resolve(out, `pilot-${sceneId}-${fps}fps.mp4`);
    const encoder = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderError = '';
    encoder.stderr.on('data', chunk => { encoderError += String(chunk); });
    encoder.stdin.on('error', error => { encoderError += String(error); });
    const encoded = new Promise<number>(res => { encoder.once('error', error => { encoderError += String(error); res(-1); }); encoder.once('close', code => res(code ?? -1)); });
    const frames: Array<Record<string, unknown>> = [];
    const shoots: number[] = [];
    const hashes = new Set<string>();
    const events: Array<PromoEvent & { frame: number }> = [];
    let lastShot = -Infinity;
    let pilotAttached = false;
    let previousHash = '';
    let duplicateAdjacent = 0;
    let end = start;
    try {
      for (let frame = 0; frame < frameCount; frame++) {
        const timelineMs = frame * 1000 / fps;
        if (!pilotAttached && timelineMs - lastShot >= shotGap * 1000) {
          await driver.page.evaluate((bot: BotSpec) => window.__promo.attachBot(bot), show.bot);
          pilotAttached = true;
        }
        await driver.frame();
        const snap = await driver.snapshot();
        end = snap.status;
        if (snap.events.some(event => event.kind === 'shoot')) {
          lastShot = (frame + 1) * 1000 / fps;
          shoots.push(lastShot);
          await driver.page.evaluate(() => window.__promo.attachBot(null));
          pilotAttached = false;
        }
        events.push(...snap.events.map(event => ({ ...event, frame })));
        if (end.status !== 'playing') throw new Error(`Pilot stopped at frame ${frame}: ${end.status}`);
        const alpha = await driver.page.evaluate(() => (window as unknown as { __tl: { acc: number } }).__tl.acc / (1000 / 60));
        const png = await driver.shot(2, 10_000);
        const hash = createHash('sha256').update(png).digest('hex');
        hashes.add(hash);
        if (hash === previousHash) duplicateAdjacent++;
        previousHash = hash;
        const cssAnimations = await driver.page.evaluate(() => window.__captureCssClock!.snapshot());
        frames.push({ cssAnimations, frame, videoMs: frame * 1000 / fps, clockDeltaMs: end.elapsedMs - start.elapsedMs, steps: end.steps - start.steps, timeLeftMs: end.timeLeftMs, interpolationAlpha: alpha, sha256: hash });
        if (frame < 4 || frame % fps === 0 || frame === frameCount - 1) await writeFile(resolve(out, 'samples', `${String(frame).padStart(6, '0')}.png`), png);
        if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
        if (frame % fps === 0) console.log(`frame ${frame}/${frameCount}; physics ${end.steps - start.steps}; shoots ${shoots.length}`);
      }
    } finally { encoder.stdin.end(); }
    const exit = await encoded;
    if (exit !== 0) throw new Error(`ffmpeg failed (${exit}): ${encoderError}`);
    const stepDelta = end.steps - start.steps;
    const elapsedDeltaMs = end.elapsedMs - start.elapsedMs;
    const timerDeltaMs = start.timeLeftMs === null || end.timeLeftMs === null ? null : start.timeLeftMs - end.timeLeftMs;
    const gaps = shoots.slice(1).map((time, i) => time - shoots[i]);
    const evidence = {
      kind: 'normal-speed-capture-pilot', sourceCommit: process.env.GITHUB_SHA ?? null, scene: sceneId, recipe: { config: show.config, bot: show.bot },
      fps, frames: frameCount, durationSeconds: seconds, viewport, electronVersion, chromiumVersion,
      warmupSeconds: warmup, shotGapSeconds: shotGap, botCadence: 'Existing pilot attached until each shot, then detached until the gap; reattachment reconstructs the seeded pilot, so this is new capture choreography, not original pilot continuity.',
      physicsHz: 60, stepDelta, expectedStepDelta: seconds * 60, elapsedDeltaMs, timerDeltaMs,
      shootTimesMs: shoots, shotGapsMs: gaps, uniquePngs: hashes.size, duplicateAdjacent,
      samples: 'samples/', events, frameEvidence: frames,
      validation: { normalSpeed: stepDelta === seconds * 60 && Math.abs(elapsedDeltaMs - seconds * 1000) < 0.1 && timerDeltaMs !== null && Math.abs(timerDeltaMs - seconds * 1000) < 0.1, paced: shoots.length >= 2 && gaps.every(gap => gap >= shotGap * 1000 - 0.01), distinctFrames: duplicateAdjacent === 0 },
      limitations: 'Silent four-second pilot, not a final trailer. No optical-flow interpolation or duplicated-frame conversion is used. Full eight-scene event choreography and soundtrack assembly remain separate.',
    };
    await writeFile(resolve(out, `pilot-${sceneId}-${fps}fps.json`), JSON.stringify(evidence, null, 2));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-vf', `fps=1,scale=480:270,tile=4x1`, '-frames:v', '1', resolve(out, `contact-${fps}fps.jpg`)]);
    console.log(JSON.stringify({ mp4, stepDelta, elapsedDeltaMs, timerDeltaMs, shots: shoots.length, validation: evidence.validation }));
    if (!Object.values(evidence.validation).every(Boolean)) throw new Error('Pilot evidence failed; do not label this as validated native high-frame-rate capture');
  } finally { await driver.close(); }
} finally {
  for (const electron of sessions) await electron.close().catch(() => {});
  await server.close();
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}

