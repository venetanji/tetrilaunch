/** Eight-scene progression capture. Game source and physics remain unchanged. */
import { createServer } from 'vite';
import { _electron, type Browser, type ElectronApplication, type CDPSession } from 'playwright';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { SCENES, STORE_META, SETUPS, type SceneDef, type PromoEvent, type PromoStatus } from '../beats';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const args = process.argv.slice(2);
const arg = (key: string, fallback: string): string => args.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const fps = Number(arg('fps', '120'));
const shotGap = Number(arg('shot-gap', '0.95'));
const out = resolve(arg('out', 'sim/results/steam-trailer-full'));
const ORDER = ['line-clear', 'mid-bay-launch', 'congestion', 'bond-chain', 'cryo-thaw', 'blast', 'materials-bay', 'hazard-run'];
const selected = arg('scenes', arg('scene', ORDER.join(','))).split(',');
if (![60, 120].includes(fps)) throw new Error('Capture fps must be 60 or 120');
if (!(shotGap >= 0.9 && shotGap <= 2)) throw new Error('Filmed shot gap must be 0.9–2 seconds');
if (selected.some(id => !ORDER.includes(id)) || new Set(selected).size !== selected.length) throw new Error('Unknown or repeated progression scene');
await mkdir(out, { recursive: true });
await mkdir(resolve(out, 'sections'), { recursive: true });
await mkdir(resolve(out, 'samples'), { recursive: true });
process.env.PROMO_DRIVER_ONLY = '1';
if (!args.some(value => value.startsWith('--fps='))) process.argv.push(`--fps=${fps}`);
const { openDriver } = await import('../run');
type BayScene = SceneDef & { show: Extract<SceneDef['show'], { kind: 'bay' }> };
interface Plan { scene: string; stageFrame: number; keyFrame: number; handFrame: number | null; startFrame: number; frames: number }
interface Stamped extends PromoEvent { frame: number }

function encodePngs(file: string) {
  const child = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += String(chunk); });
  child.stdin.on('error', error => { errors += String(error); });
  const finished = new Promise<number>(res => {
    child.once('error', error => { errors += String(error); res(-1); });
    child.once('close', code => res(code ?? -1));
  });
  return {
    async write(png: Buffer): Promise<void> {
      if (errors) throw new Error(errors);
      if (!child.stdin.write(png)) await once(child.stdin, 'drain');
    },
    async close(): Promise<void> {
      child.stdin.end();
      const code = await finished;
      if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${errors}`);
    },
  };
}

function probeVideo(path: string): { frames: number; duration: number; fps: number; width: number; height: number } {
  const data = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,duration,avg_frame_rate', '-of', 'json', path], { encoding: 'utf8' }));
  const stream = data.streams[0];
  const [n, d] = String(stream.avg_frame_rate).split('/').map(Number);
  return { frames: Number(stream.nb_frames), duration: Number(stream.duration), fps: n / d, width: stream.width, height: stream.height };
}

/** The same state machine drives the unfilmed probe and fresh-page filmed replay. */
async function flyScene(browser: Browser, scene: BayScene, planned?: Plan): Promise<Plan> {
  const show = scene.show;
  const lineClear = scene.id === 'line-clear';
  const driver = await openDriver(browser, 'app://tetrilaunch/', { w: 1920, h: 1080, dpr: 1, touch: false }, { ...STORE_META, ...SETUPS.ladder });
  let encoder: ReturnType<typeof encodePngs> | null = null;
  const stem = `${String(ORDER.indexOf(scene.id) + 1).padStart(2, '0')}-${scene.id}`;
  const video = resolve(out, 'sections', `${stem}-${fps}fps.mp4`);
  try {
    const viewport = await driver.page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, origin: location.origin, coarsePointer: matchMedia('(pointer: coarse)').matches }));
    if (viewport.width !== 1920 || viewport.height !== 1080 || viewport.dpr !== 1 || viewport.coarsePointer || viewport.origin !== 'app://tetrilaunch') throw new Error(`Wrong desktop viewport: ${JSON.stringify(viewport)}`);
    await driver.page.evaluate(([config, bot]) => window.__promo.launchBay(config, bot), [show.config, lineClear ? null : show.bot] as const);
    await driver.page.evaluate(() => { window.__promo.dismissCoach(); window.__promo.quiesce(); });
    let status = (await driver.snapshot()).status;
    let attached = !lineClear;
    let stageFrame: number | null = lineClear ? 0 : null;
    let keyFrame: number | null = null;
    let handFrame: number | null = null;
    let lastShotMs = -Infinity;
    let plan: Plan | null = planned ?? null;
    const events: Stamped[] = [];
    const hashes = new Set<string>();
    const frameEvidence: Array<Record<string, unknown>> = [];
    let previousHash = '';
    let duplicateAdjacent = 0;
    let captured = 0;
    let startStatus: PromoStatus | null = null;
    let dangerSeen = false;
    const maxFrames = Math.ceil((show.warmSec + 12) * fps);
    const detach = async (): Promise<void> => { if (attached) { await driver.page.evaluate(() => window.__promo.attachBot(null)); attached = false; } };
    const absorb = (fresh: PromoEvent[], frame: number): void => {
      events.push(...fresh.map(event => ({ ...event, frame })));
      for (const event of fresh) {
        if (event.kind === 'shoot') lastShotMs = frame * 1000 / fps;
        const effect = show.fire === 'bomb' ? event.kind === 'explosion' && event.explosion === 'bomb'
          : show.fire === 'thaw' ? event.kind === 'cryoShatter' : event.kind === 'bond';
        if (keyFrame === null && ((lineClear && event.kind === 'stamp') || (handFrame !== null && effect))) keyFrame = frame;
      }
    };
    for (let index = 0; index < maxFrames; index++) {
      const frame = index + 1;
      const nowMs = index * 1000 / fps;
      const filming = planned !== undefined && index >= planned.startFrame && index < planned.startFrame + planned.frames;
      if (planned && index === planned.startFrame) {
        await driver.page.evaluate(() => window.__promo.quiesce());
        startStatus = status;
        encoder = encodePngs(video);
      }
      if (stageFrame !== null) {
        const sinceStage = (index - stageFrame) / fps;
        const cue = !show.fireWhen || show.fireWhen(status, events);
        const handPending = !!show.fire && handFrame === null;
        // Leave space before the hand and after its effect. If its pile cue has
        // faded, only the normal paced pilot can build that pile back up.
        const waitingForEffect = !!show.fire && handFrame !== null && keyFrame === null;
        const effectHold = !!show.fire && keyFrame !== null && index < keyFrame + fps;
        const aimHold = scene.id === 'mid-bay-launch' && sinceStage < 0.65;
        const allowPilot = !waitingForEffect && !effectHold && !aimHold && !(handPending && (sinceStage < 0.75 || cue));
        if (!allowPilot) await detach();
        else if (!attached && nowMs - lastShotMs >= shotGap * 1000) {
          await driver.page.evaluate(bot => window.__promo.attachBot(bot), show.bot);
          attached = true;
        }
      }
      const priorStatus = status;
      const declaredClockTaxMs = filming ? await driver.page.evaluate(() => ((window as unknown as { __tl: { game: { pileTier?: { clockSec?: number } } } }).__tl.game.pileTier?.clockSec ?? 0) * 1000) : 0;
      await driver.frame(filming);
      const snap = await driver.snapshot();
      status = snap.status;
      absorb(snap.events, frame);
      if (stageFrame !== null && snap.events.some(event => event.kind === 'shoot')) await detach();
      if (status.status !== 'playing') throw new Error(`${scene.id}: ${status.status} at ${status.elapsedMs}ms before clip completion`);
      if (lineClear && keyFrame === null && frame >= Math.ceil(show.warmSec * fps)) throw new Error(`${scene.id}: no paced line-clear stamp within ${show.warmSec}s`);
      if (stageFrame === null) {
        const stageReady = show.fire ? (!show.fireWhen || show.fireWhen(status, events)) : !!show.until?.(status, events);
        if (stageReady) {
          stageFrame = frame;
          await detach();
          if (show.aiming) await driver.page.evaluate(() => window.__promo.setAiming(true));
          if (!show.fire) keyFrame = frame;
        } else if (frame >= Math.ceil(show.warmSec * fps)) throw new Error(`${scene.id}: original staging cue not reached within ${show.warmSec}s`);
      }
      if (show.fire && stageFrame !== null && handFrame === null && frame >= stageFrame + Math.ceil(0.75 * fps)
          && frame * 1000 / fps - lastShotMs >= shotGap * 1000 && (!show.fireWhen || show.fireWhen(status, events))) {
        await detach();
        const fired = await driver.page.evaluate(action => action === 'bomb' ? window.__promo.fireBomb() : action === 'thaw' ? window.__promo.fireThaw() : window.__promo.fireBond(), show.fire);
        if (fired) {
          handFrame = frame;
          const handSnapshot = await driver.snapshot();
          status = handSnapshot.status;
          absorb(handSnapshot.events, frame);
        }
      }
      if (keyFrame !== null && stageFrame !== null && plan === null) {
        const startFrame = lineClear ? Math.max(0, keyFrame - 2 * fps) : stageFrame;
        // Whole seconds keep the encoded duration and 60Hz physics count exact.
        const seconds = Math.max(6, Math.ceil((keyFrame + 1.5 * fps - startFrame) / fps));
        if (seconds > 10) throw new Error(`${scene.id}: effect needs ${seconds}s; inspect instead of silently speeding it up`);
        plan = { scene: scene.id, stageFrame, keyFrame, handFrame, startFrame, frames: seconds * fps };
      }
      if (filming) {
        if (!encoder) throw new Error('Capture encoder was not initialized');
        const alpha = await driver.page.evaluate(() => (window as unknown as { __tl: { acc: number } }).__tl.acc / (1000 / 60));
        const png = await driver.shot(2, 10_000);
        const hash = createHash('sha256').update(png).digest('hex');
        if (hash === previousHash) duplicateAdjacent++;
        hashes.add(hash); previousHash = hash;
        const physicsDeltaMs = (status.steps - priorStatus.steps) * 1000 / 60;
        const timerAdjustmentMs = priorStatus.timeLeftMs === null || status.timeLeftMs === null ? null : priorStatus.timeLeftMs - status.timeLeftMs - physicsDeltaMs;
        const thisFrameEvents = events.filter(event => event.frame === frame);
        const bombShot = thisFrameEvents.some(event => event.kind === 'scripted' && event.action === 'bomb');
        const expectedClockTaxMs = bombShot ? 0 : thisFrameEvents.filter(event => event.kind === 'shoot').length * declaredClockTaxMs;
        frameEvidence.push({ frame: captured, bayFrame: frame, elapsedMs: status.elapsedMs, steps: status.steps, timeLeftMs: status.timeLeftMs, interpolationAlpha: alpha, sha256: hash, timerAdjustmentMs, expectedClockTaxMs, timerAdjustmentExplained: timerAdjustmentMs !== null && Math.abs(timerAdjustmentMs - expectedClockTaxMs) < 0.1 });
        if (captured % fps === 0) {
          const hud = await driver.page.evaluate(() => ['plant--congest-warn', 'plant--congest-danger'].filter(c => window.__promo.present(`.${c}`)));
          dangerSeen ||= hud.includes('plant--congest-danger');
          if (captured === 0 || captured === 2 * fps || captured === 5 * fps) await writeFile(resolve(out, 'samples', `${stem}-${captured}.png`), png);
          console.log(`${scene.id}: captured ${captured}/${planned!.frames} @${fps}; ${status.cubes} cubes`);
        }
        await encoder.write(png);
        captured++;
      }
      if (plan && frame >= plan.startFrame + plan.frames) break;
    }
    if (stageFrame === null || keyFrame === null || plan === null) throw new Error(`${scene.id}: required scene event was never reached`);
    const actualPlan: Plan = { ...plan, stageFrame, keyFrame, handFrame };
    if (planned) {
      if (stageFrame !== planned.stageFrame || keyFrame !== planned.keyFrame || handFrame !== planned.handFrame) throw new Error(`${scene.id}: probe/replay event timing mismatch: ${JSON.stringify({ planned, actualPlan })}`);
      if (!startStatus || captured !== planned.frames) throw new Error(`${scene.id}: incomplete capture ${captured}/${planned.frames}`);
      if (encoder) { const active = encoder; encoder = null; await active.close(); }
      const durationSeconds = captured / fps;
      const stepDelta = status.steps - startStatus.steps;
      const elapsedDeltaMs = status.elapsedMs - startStatus.elapsedMs;
      const timerDeltaMs = startStatus.timeLeftMs === null || status.timeLeftMs === null ? null : startStatus.timeLeftMs - status.timeLeftMs;
      const inClip = events.filter(event => event.frame > planned.startFrame && event.frame <= planned.startFrame + planned.frames);
      const shotFrames = inClip.filter(event => event.kind === 'shoot').map(event => event.frame);
      const gapsMs = shotFrames.slice(1).map((frame, i) => (frame - shotFrames[i]) * 1000 / fps);
      const has = (kind: PromoEvent['kind']): boolean => inClip.some(event => event.kind === kind);
      const scripted = !show.fire || inClip.some(event => event.kind === 'scripted' && event.action === show.fire);
      const expectedEffect = scene.id === 'line-clear' ? has('stamp')
        : show.fire === 'bomb' ? inClip.some(event => event.kind === 'explosion' && event.explosion === 'bomb')
        : show.fire === 'thaw' ? has('thaw') && has('cryoShatter')
        : show.fire === 'bond' ? has('bond') : scene.id !== 'congestion' || dangerSeen;
      const encoded = probeVideo(video);
      const validation = {
        originalCueAndReplay: true, scriptedHand: scripted, requiredVisualEvent: expectedEffect,
        normalSpeed: stepDelta === durationSeconds * 60 && Math.abs(elapsedDeltaMs - durationSeconds * 1000) < 0.1,
        paced: gapsMs.every(gap => gap >= shotGap * 1000 - 0.01),
        encodedFrames: encoded.frames === captured && encoded.fps === fps && encoded.width === 1920 && encoded.height === 1080 && Math.abs(encoded.duration - durationSeconds) < 0.001,
      };
      await writeFile(resolve(out, `${stem}.json`), JSON.stringify({ sourceCommit: process.env.GITHUB_SHA ?? null, scene: scene.id, recipe: { config: show.config, bot: show.bot }, viewport, fps, plan: actualPlan, captured, durationSeconds, stepDelta, elapsedDeltaMs, timerDeltaMs, countdown: { nonPhysicsDeltaMs: timerDeltaMs === null ? null : timerDeltaMs - elapsedDeltaMs, everyFrameExplained: frameEvidence.every(frame => frame.timerAdjustmentExplained === true), note: 'Countdown may include gameplay shot taxes. Normal-speed validation uses fixed physics steps and gameplay elapsed time, not blind countdown equality.' }, shotGapSeconds: shotGap, shotGapsMs: gapsMs, uniquePngs: hashes.size, duplicateAdjacent, validation, events: inClip, frameEvidence, note: 'Staging uses the original pilot. Filmed reattachment reconstructs the seeded pilot; this is changed capture choreography, not a physics change. Duplicate frames are reported but not globally prohibited: stationary moments are valid.' }, null, 2));
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', 'fps=1,scale=480:270,tile=3x2', '-frames:v', '1', resolve(out, `${stem}-contact.jpg`)]);
      if (!Object.values(validation).every(Boolean)) throw new Error(`${scene.id}: validation failed: ${JSON.stringify(validation)}`);
    }
    return actualPlan;
  } finally {
    if (encoder) await encoder.close().catch(error => console.error(error));
    await driver.close();
  }
}

const server = await createServer({ configFile: resolve(here, '../vite.config.ts') });
const sessions = new Set<ElectronApplication>();
const profiles: string[] = [];
let electronVersion = '';
let chromiumVersion = '';
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
  const plans: Plan[] = [];
  const failures: Array<{ scene: string; message: string; requiredEvent: string }> = [];
  for (const id of ORDER.filter(sceneId => selected.includes(sceneId))) {
    const scene = SCENES.find(candidate => candidate.id === id);
    if (!scene || scene.show.kind !== 'bay') throw new Error(`Missing bay recipe ${id}`);
    try {
      console.log(`PROBE ${id}`);
      const plan = await flyScene(browser, scene as BayScene);
      await writeFile(resolve(out, `${id}-preflight.json`), JSON.stringify(plan, null, 2));
      console.log(`CAPTURE ${id}: ${JSON.stringify(plan)}`);
      await flyScene(browser, scene as BayScene, plan);
      plans.push(plan);
    } catch (error) {
      const requiredEvent = id === 'line-clear' ? 'stamp inside clip' : scene.show.fire === 'bomb' ? 'successful bomb hand and bomb explosion'
        : scene.show.fire === 'thaw' ? 'successful thaw hand, thaw and cryoShatter' : scene.show.fire === 'bond' ? 'successful bond hand and bond event'
        : id === 'congestion' ? 'congestion tier2 staging cue and visible danger HUD' : 'original SCENES.until staging predicate';
      const failure = { scene: id, message: error instanceof Error ? error.message : String(error), requiredEvent };
      failures.push(failure);
      await writeFile(resolve(out, `${id}-failure.json`), JSON.stringify(failure, null, 2));
      console.error(`FAILED ${id}: ${failure.message}; continuing independent scenes`);
    }
  }
  await writeFile(resolve(out, 'capture-status.json'), JSON.stringify({ sourceCommit: process.env.GITHUB_SHA ?? null, fps, selected, completed: plans.map(plan => plan.scene), failures, combinedMasterEligible: failures.length === 0 && plans.length === ORDER.length }, null, 2));
  if (failures.length) process.exitCode = 1;
  // A bounded --scene retry preserves its section without claiming a complete trailer.
  if (failures.length === 0 && plans.length === ORDER.length) {
  const list = resolve(out, 'sections.txt');
  await writeFile(list, plans.map(plan => `file 'sections/${String(ORDER.indexOf(plan.scene) + 1).padStart(2, '0')}-${plan.scene}-${fps}fps.mp4'`).join('\n') + '\n');
  const master = resolve(out, `gameplay-${fps}fps.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', '-movflags', '+faststart', master]);
  const expectedFrames = plans.reduce((sum, plan) => sum + plan.frames, 0);
  const masterInfo = probeVideo(master);
  if (masterInfo.frames !== expectedFrames || masterInfo.fps !== fps || Math.abs(masterInfo.duration - expectedFrames / fps) > 0.001) throw new Error(`Combined master has wrong frame count or duration: ${JSON.stringify(masterInfo)}`);
  let derived60: ReturnType<typeof probeVideo> | null = null;
  if (fps === 120) {
    const output60 = resolve(out, 'gameplay-60fps.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master, '-vf', "select='not(mod(n,2))',setpts=N/(60*TB)", '-r', '60', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output60]);
    derived60 = probeVideo(output60);
    if (derived60.frames !== expectedFrames / 2 || derived60.fps !== 60 || Math.abs(derived60.duration - masterInfo.duration) > 0.001) throw new Error('60fps alternate-frame derivative failed duration/frame validation');
  }
  await writeFile(resolve(out, 'gameplay-manifest.json'), JSON.stringify({ sourceCommit: process.env.GITHUB_SHA ?? null, electronVersion, chromiumVersion, fps, master: masterInfo, derived60, plans, originalProgressionComplete: plans.length === ORDER.length, silent: true, assemblyRemaining: 'Append the original two-second static TETRILAUNCH logo and mix Pixel Dreams from app/public/audio/music/menu.mp3 starting at13.8sec. No game-speed change; a still logo may legitimately repeat frames.' }, null, 2));
  console.log(`GAMEPLAY COMPLETE ${master}: ${masterInfo.duration}s, ${masterInfo.frames} frames`);
  }
} finally {
  for (const electron of sessions) await electron.close().catch(() => {});
  await server.close();
  for (const profile of profiles) await rm(profile, { recursive: true, force: true });
}
