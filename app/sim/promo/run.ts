#!/usr/bin/env npx tsx
/**
 * PROMO CAPTURE HARNESS — the trailer's beats and the store's screenshots,
 * rendered by the shipped App in a real Chromium, one exact frame at a time.
 *
 *   npx tsx sim/promo/run.ts --beat=plan [--beat=precision …] [--all]
 *                            [--fps=60] [--size=1920x1080] [--out=<dir>]
 *                            [--seeds=40] [--no-webm]
 *   npx tsx sim/promo/run.ts --shots [--store=play|appstore|all] [--out=<dir>]
 *
 * Each beat writes <out>/<beat>/frames/%06d.png, <out>/<beat>/beat.json (the
 * configuration, the seed, the frame count and the frame index of every
 * notable event) and, when an ffmpeg is found, <out>/<beat>.webm. Store shots
 * land in <out>/store/<store>/<size>/<NN>-<scene>.png with a manifest.json.
 * <out> defaults to sim/results/promo (gitignored).
 *
 * HOW TIME WORKS. Chromium's virtual time policy (CDP Emulation) is paused
 * once the page has loaded, then advanced by exactly 1000/fps ms per frame:
 * timers, Date, performance.now and CSS transitions move by that much and by
 * nothing else. requestAnimationFrame is the exception — the compositor's
 * BeginFrame that drives it stays on the wall clock under virtual time
 * (measured: five callbacks in sixty 16.7ms budgets), and the App's loop is
 * an rAF loop — so rAF is shimmed before the page loads and flushed once per
 * frame with the virtual clock as its timestamp. A 60fps capture is then 60
 * physics steps a second by construction rather than by wall-clock luck: the
 * fixed-clock stance sim/renderperf takes, extended to the whole page, and
 * the reason a headless preroll (preroll.ts) can predict a browser bay to the
 * step. The screenshot goes through CDP too (Page.captureScreenshot):
 * Playwright's page.screenshot waits on page timers for fonts, which never
 * fire while time is paused.
 *
 * Everything else the page does is the App's own. See harness.ts.
 */
import { createServer } from "vite";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import {
  BEATS, BEAT_ORDER, isCornerDouble, PROMO_DT, SCENES, STORE_META, STORE_SIZES,
  type BayConfig, type BayPhase, type BeatDef, type BotSpec, type DomPhase,
  type PromoEvent, type PromoStatus, type SceneDef, type StoreSize,
} from "./beats";
import type { FlightLog } from "./preroll";
import { newMeta, type MetaState } from "../../src/game/meta";
import { towerTravelMs } from "../../src/ui/screens";
import type {} from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opts = (name: string): string[] =>
  argv.filter((a) => a.startsWith(`--${name}=`)).flatMap((a) => a.slice(name.length + 3).split(","));
const opt = (name: string): string | null => opts(name).at(-1) ?? null;

const FPS = Number(opt("fps") ?? 60);
/** Frame length in ms for the clip's timeline… */
const DT = 1000 / FPS;
/** …and the number the page clock actually advances by (beats.ts's PROMO_DT
 *  at 60fps: the 60Hz frame plus one nudge). At any other fps the same nudge
 *  is applied to that frame, for the same reason. */
const CLOCK_DT = FPS === 60 ? PROMO_DT : 1000 / FPS + 2 ** -36;
const [SIZE_W, SIZE_H] = (opt("size") ?? "1920x1080").split("x").map(Number);
const OUT = resolve(opt("out") ?? resolve(HERE, "..", "results", "promo"));
const SHOTS = flag("shots");
const STORE = opt("store") ?? "all";
const SEEDS = opt("seeds") ? Number(opt("seeds")) : null;
const WEBM = !flag("no-webm");
const BEAT_IDS = flag("all") ? BEAT_ORDER : opts("beat");
const VERBOSE = flag("verbose") || opt("verbose") !== null;
const trace = (msg: string): void => { if (VERBOSE) console.log(`    … ${msg}`); };
/** Per-frame detail; only under --verbose=frames. */
const trace2 = (msg: string): void => { if (opt("verbose") === "frames") console.log(`      ‥ ${msg}`); };

if (!SHOTS && BEAT_IDS.length === 0) {
  console.error("nothing to do: pass --beat=<id> (one of " + BEAT_ORDER.join(", ") + "), --all, or --shots");
  process.exit(1);
}
for (const id of BEAT_IDS) {
  if (!BEATS[id]) { console.error(`✗ unknown beat "${id}"`); process.exit(1); }
}

/* ---------------------------------------------------------------------------
 * ffmpeg — Playwright's bundled build if nothing else is on the box
 * ------------------------------------------------------------------------- */

function findFfmpeg(): string | null {
  if (process.env.PROMO_FFMPEG && existsSync(process.env.PROMO_FFMPEG)) return process.env.PROMO_FFMPEG;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = resolve(dir, "ffmpeg");
    if (dir && existsSync(p)) return p;
  }
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", resolve(process.env.HOME ?? "", ".cache/ms-playwright")]
    .filter((r): r is string => !!r && existsSync(r));
  for (const root of roots) {
    for (const d of readdirSync(root)) {
      if (!d.startsWith("ffmpeg-")) continue;
      for (const bin of ["ffmpeg-linux", "ffmpeg-mac", "ffmpeg-mac-arm64", "ffmpeg-win64.exe"]) {
        const p = resolve(root, d, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const FFMPEG = findFfmpeg();

function run(cmd: string, args: string[], stdin?: () => AsyncIterable<Buffer>): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => { err += String(d); });
    child.on("close", (code) => {
      if (code !== 0) console.error(err.split("\n").slice(-8).join("\n"));
      res(code ?? 1);
    });
    if (stdin) {
      void (async () => {
        try {
          for await (const chunk of stdin()) {
            if (!child.stdin!.write(chunk)) await new Promise((r) => child.stdin!.once("drain", r));
          }
        } finally { child.stdin!.end(); }
      })();
    }
  });
}

function ffmpegHas(kind: "decoders" | "demuxers", name: string): boolean {
  if (!FFMPEG) return false;
  try {
    const out = execFileSync(FFMPEG, ["-hide_banner", `-${kind}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(out);
  } catch { return false; }
}

/** Playwright's bundled ffmpeg (the fallback when none is on PATH) decodes
 *  MJPEG and VP8 and nothing else — no PNG, no image2. A full ffmpeg reads
 *  the PNG sequence straight off disk; the bundled one gets a JPEG twin of
 *  every frame piped through image2pipe. Either way the preview is the same
 *  clip; the frames the owner assembles from are always the PNGs. */
const FFMPEG_READS_PNG = ffmpegHas("decoders", "png") && ffmpegHas("demuxers", "image2");

const VPX = ["-c:v", "libvpx", "-b:v", "12M", "-crf", "6", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p", "-auto-alt-ref", "0"];

/** Frames -> .webm through libvpx, the one video encoder Playwright's ffmpeg
 *  carries. The assemble step (assemble.ts) wants a fuller ffmpeg anyway; this
 *  is the per-beat preview. */
async function muxWebm(framesDir: string, jpegDir: string | null, out: string): Promise<boolean> {
  if (!FFMPEG) return false;
  if (FFMPEG_READS_PNG) {
    const code = await run(FFMPEG, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-framerate", String(FPS), "-i", resolve(framesDir, "%06d.png"), ...VPX, out,
    ]);
    return code === 0;
  }
  if (!jpegDir) return false;
  const files = readdirSync(jpegDir).filter((f) => f.endsWith(".jpg")).sort();
  const code = await run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0", ...VPX, out,
  ], async function* () {
    for (const f of files) yield await readFile(resolve(jpegDir, f));
  });
  return code === 0;
}

/* ---------------------------------------------------------------------------
 * Browser plumbing
 * ------------------------------------------------------------------------- */

interface Driver {
  ctx: BrowserContext;
  page: Page;
  cdp: CDPSession;
  /** One filmed frame: the page clock forward by 1000/fps and the rAF queue
   *  flushed — one App loop iteration, one physics step — with the
   *  stylesheet's clock (CDP virtual time) moved the same amount unless
   *  `css` is false. */
  frame(css?: boolean): Promise<void>;
  /** `frames` un-filmed frames in one round trip; same clock, no screenshot. */
  tick(frames: number): Promise<number>;
  shot(): Promise<Buffer>;
  /** A JPEG of the same frame, for the preview mux when the only ffmpeg on
   *  the box cannot decode PNG (Playwright's bundled build). */
  jpeg(): Promise<Buffer>;
  snapshot(): Promise<{ status: PromoStatus; events: PromoEvent[] }>;
  /** Wall-clock cost so far, ms, by stage. */
  timing: Record<string, number>;
  close(): Promise<void>;
}

/**
 * THE PAGE'S CLOCK, installed before any page script runs.
 *
 * performance.now, setTimeout/setInterval and requestAnimationFrame are
 * replaced by a clock that moves only when __tick(frames, dt) is called:
 * each frame fires the timers that fall due (in order, with the clock set to
 * their time), advances by exactly `dt`, then flushes the rAF queue with the
 * new time as its timestamp. Chromium's own virtual time was tried first and
 * fell short twice: its budgets land on 0.1ms granules (16.6, 16.7), which
 * makes the App's fixed-step accumulator skip a step here and double one
 * there, and the compositor's BeginFrame that drives rAF stays on the wall
 * clock regardless. Here every frame is one App loop iteration with a `now`
 * that is bit-for-bit the preroll's `t += DT` — which is what lets
 * preroll.ts predict the browser's bay to the step.
 *
 * __clock.reset() zeroes the clock (pending timers keep their remaining
 * delay); harness.ts calls it as a bay launches so the bay's first step is at
 * t = dt exactly as it is in node. Date is left alone: it seeds the daily
 * board and stamps submissions, and nothing in a bay reads it.
 */
function clockShim(): void {
  type Timer = { id: number; at: number; cb: (...a: unknown[]) => void; args: unknown[]; every: number | null };
  const w = window as unknown as Record<string, unknown>;
  // FIRST, before any arrow below is assigned: tsx's esbuild keepNames wraps
  // every function that gets an inferred name in a __name() call, and this
  // function travels into the page by toString, where nothing defines it.
  w.__name = (fn: unknown) => fn;
  let now = performance.now();
  let seq = 0;
  const timers = new Map<number, Timer>();
  let rafQ: Array<[number, FrameRequestCallback]> = [];
  performance.now = () => now;
  // Never sooner than 1ms, as browsers clamp nested timeouts: a callback
  // that re-arms itself at 0 has to move through time, or the due-timer
  // loop below would never reach the end of the frame.
  const MIN_DELAY = 1;
  w.setTimeout = (cb: (...a: unknown[]) => void, delay = 0, ...args: unknown[]) => {
    const id = ++seq;
    timers.set(id, { id, at: now + Math.max(MIN_DELAY, Number(delay) || 0), cb, args, every: null });
    return id;
  };
  w.setInterval = (cb: (...a: unknown[]) => void, delay = 0, ...args: unknown[]) => {
    const id = ++seq;
    const every = Math.max(MIN_DELAY, Number(delay) || 0);
    timers.set(id, { id, at: now + every, cb, args, every });
    return id;
  };
  w.clearTimeout = w.clearInterval = (id: number) => { timers.delete(id); };
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { const id = ++seq; rafQ.push([id, cb]); return id; };
  w.cancelAnimationFrame = (id: number) => { rafQ = rafQ.filter(([i]) => i !== id); };
  w.__tick = (frames: number, dt: number) => {
    for (let f = 0; f < frames; f++) {
      const target = now + dt;
      // A cap on top of the clamp, so a runaway timer costs a warning and a
      // frame rather than the run.
      for (let fired = 0; fired < 10_000; fired++) {
        let next: Timer | null = null;
        for (const t of timers.values()) {
          if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        }
        if (!next) break;
        if (fired === 9_999) console.warn("promo clock: 10000 timers fired in one frame; a timer is re-arming itself");
        now = Math.max(now, next.at);
        if (next.every !== null) next.at += next.every; else timers.delete(next.id);
        try { next.cb(...next.args); } catch (e) { console.error(e); }
      }
      now = target;
      const due = rafQ;
      rafQ = [];
      for (const [, cb] of due) {
        try { cb(now); } catch (e) { console.error(e); }
      }
    }
    return now;
  };
  w.__clock = {
    now: () => now,
    reset: () => {
      for (const t of timers.values()) t.at -= now;
      now = 0;
    },
  };
}

declare global {
  interface Window {
    __tick: (frames: number, dt: number) => number;
    __clock: { now(): number; reset(): void };
  }
}

/** Node-side sleep — the page's timers are shimmed, so waits happen here. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const time = async <T>(t: Record<string, number>, key: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try { return await fn(); } finally { t[key] = (t[key] ?? 0) + performance.now() - t0; }
};

const MOCK_BOARD = {
  scores: [
    ["VASQUEZ", 98_760, 10, 240], ["HALE", 91_120, 10, 226], ["OKONKWO", 84_305, 9, 211],
    ["LONGESTNAME", 77_940, 9, 198], ["PILOT5", 70_212, 8, 184], ["MARIS", 63_400, 8, 171],
    ["JUNO", 55_980, 7, 156], ["TAKEDA", 48_115, 6, 140], ["ORSO", 41_730, 6, 128], ["PILOT10", 33_640, 5, 111],
  ].map(([name, score, level, lines], i) => ({
    name, score, mark: 7, level, lines, created_at: 1_757_000_000_000 - i * 86_400_000,
  })),
};

async function openDriver(
  browser: Browser, base: string,
  view: { w: number; h: number; dpr: number; touch?: boolean },
  meta: Partial<MetaState> = {},
): Promise<Driver> {
  // `touch` is what app.css's `@media (pointer: coarse)` rules key off (see
  // sim/uifit/run.ts on the two flags): the store shots want the phone's rail,
  // the trailer is filmed with the desktop keycaps.
  const ctx = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    deviceScaleFactor: view.dpr,
    isMobile: !!view.touch,
    hasTouch: !!view.touch,
  });
  // The save the App boots with, written before any page script runs.
  // A complete MetaState from the App's own newMeta so lib/store's migration
  // path has nothing to guess at; the settings are the "already taught" set —
  // no drag hint, no coach — with audio off (headless has no output anyway).
  const save = {
    meta: JSON.stringify({ ...newMeta(), ...meta }),
    settings: JSON.stringify({
      sound: false, music: false, seenDragHint: true, seenTutorial: true, devMode: true,
    }),
    name: "PILOT4",
  };
  await ctx.addInitScript((s: typeof save) => {
    localStorage.setItem("tetrilaunch.meta", s.meta);
    localStorage.setItem("tetrilaunch.settings", s.settings);
    localStorage.setItem("tetrilaunch.name", s.name);
  }, save);
  await ctx.addInitScript(clockShim);
  // No network but the dev server's own. The leaderboard's fetch is answered
  // with a fixed board; everything else off-origin is refused quietly.
  await ctx.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (/\/api\/(scores|daily)/.test(url)) {
      trace(`board fetch answered: ${url.slice(0, 80)}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_BOARD) });
    }
    trace(`refused off-origin: ${url.slice(0, 80)}`);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("  ✗ page error:", err.message));
  await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
  // Not waitForFunction: Playwright polls that through the page's rAF, which
  // the clock shim holds until a tick.
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => !!window.__promo && window.__promo.ready())) break;
    await sleep(100);
  }
  await page.evaluate(() => window.__promo.fonts());
  const cdp = await ctx.newCDPSession(page);
  // Chromium's virtual time is still what the STYLESHEET runs on — the
  // tower's ride, a modal's pop, the HUD's warn tint fading in — so it is
  // paused here and advanced by one frame's worth alongside every frame that
  // is actually filmed. Un-filmed frames leave it paused: nothing on screen is
  // being kept, and each advance costs a CDP round trip.
  await cdp.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
  const timing: Record<string, number> = {};
  const advance = async (ms: number): Promise<void> => {
    const done = new Promise<void>((r) => cdp.once("Emulation.virtualTimeBudgetExpired", () => r()));
    await cdp.send("Emulation.setVirtualTimePolicy", { policy: "advance", budget: ms });
    await done;
  };
  let cursor = 0;
  const driver: Driver = {
    ctx, page, cdp, timing,
    frame: async (css = true) => {
      if (css) await time(timing, "css", () => advance(DT));
      trace2("css advanced");
      await time(timing, "tick", () => page.evaluate((dt) => window.__tick(1, dt), CLOCK_DT));
      trace2("ticked");
    },
    tick: (frames) => time(timing, "skip", () => page.evaluate(([n, dt]) => window.__tick(n, dt), [frames, CLOCK_DT] as const)),
    shot: () => time(timing, "png", async () => {
      trace2("shot");
      // A capture that has not returned in 20s is a STALLED COMPOSITOR, not a
      // slow one — measured on the `climb` beat's paused-bay-plus-modal DOM
      // phase (a truly static frame: no canvas draw loop, no CSS animation,
      // nothing for Chromium to schedule a recomposite over), where a single
      // nudge-and-re-await of the SAME in-flight command left the run hung
      // indefinitely rather than recovering — the original CDP command can be
      // wedged for good, so retrying has to mean a FRESH `captureScreenshot`
      // call, not a second wait on the one that already isn't answering.
      // Nudging virtual time before each retry is what has a chance of
      // waking the compositor up at all; several small nudges recover cases a
      // single one does not.
      for (let attempt = 0; ; attempt++) {
        const capture = cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
        const r = await Promise.race([capture, sleep(20_000).then(() => null)]);
        if (r !== null) {
          if (attempt > 0) console.log(`  · capture completed on retry ${attempt}`);
          trace2("shot done");
          return Buffer.from(r.data, "base64");
        }
        const state = await Promise.race([
          page.evaluate(() => ({
            fonts: document.fonts.status,
            animations: document.getAnimations().map((a) => `${(a as Animation & { animationName?: string }).animationName ?? a.id ?? "?"}:${a.playState}@${a.currentTime}`).slice(0, 8),
            images: Array.from(document.images).filter((i) => !i.complete).length,
            visibility: document.visibilityState,
          })),
          sleep(5_000).then(() => "silent" as const),
        ]);
        console.log(`  ⚠ screenshot has taken 20s (attempt ${attempt + 1}/5); page: ${JSON.stringify(state)}`);
        if (attempt >= 4) {
          console.log("  ✗ capture still stalled after 5 attempts — giving up on this frame");
          throw new Error("screenshot capture stalled: compositor produced no frame after 5 nudged retries");
        }
        // A page with nothing animating (no CSS transition, no canvas draw
        // loop under the shimmed rAF) can leave Chromium's compositor with no
        // dirty region to recomposite, ever — a plain virtual-time nudge is
        // for a frame parked behind a scheduled animation start, which this
        // is not. HeadlessExperimental.beginFrame asks the compositor to
        // produce exactly one frame regardless of whether anything is
        // "dirty"; harmless to try and ignored if this Chromium build has no
        // such domain (old-headless only).
        await cdp.send("HeadlessExperimental.beginFrame" as never, {} as never).catch(() => {});
        await advance(0.1);
      }
    }),
    // The JPEG twin is best-effort — only the per-beat PREVIEW webm wants it
    // (muxWebm's image2pipe fallback for an ffmpeg that cannot decode PNG),
    // never the frames assemble.ts cuts the real trailer from — so unlike
    // shot() this does not retry a stall, it just gives up after 15s: a page
    // whose PNG capture is fine but whose JPEG one hangs (observed on the
    // same static DOM phases shot() itself needs nudged retries for) must
    // not be allowed to wedge the whole run over a frame nothing downstream
    // but a preview actually needs.
    jpeg: () => time(timing, "jpeg", async () => {
      const capture = cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
      const r = await Promise.race([capture, sleep(15_000).then(() => null)]);
      if (r === null) throw new Error("jpeg screenshot stalled (15s)");
      return Buffer.from(r.data, "base64");
    }),
    snapshot: () => time(timing, "poll", async () => {
      const r = await page.evaluate((c) => window.__promo.snapshot(c), cursor);
      cursor = r.cursor;
      return { status: r.status, events: r.events };
    }),
    close: () => ctx.close(),
  };
  await page.evaluate(() => window.__promo.prep());
  // Through the splash (1600ms in main.ts) and onto the menu.
  for (let i = 0; i < 40; i++) {
    await driver.tick(6);
    if ((await driver.snapshot()).status.state === "menu") break;
  }
  return driver;
}

/** Wall-clock summary for one driver's life, e.g. "advance 3.1ms tick 1.2ms …". */
function timingLine(t: Record<string, number>, frames: number): string {
  if (frames === 0) return "";
  return Object.entries(t).map(([k, v]) => `${k} ${(v / frames).toFixed(1)}ms`).join(" · ") + " per frame";
}

/* ---------------------------------------------------------------------------
 * Beats
 * ------------------------------------------------------------------------- */

interface StampedEvent extends PromoEvent {
  frame: number;
  bayMs: number;
  phase: number;
}

interface BeatJson {
  beat: string;
  card: string;
  fps: number;
  size: string;
  frames: number;
  phases: Array<{
    index: number; kind: string; startFrame: number; endFrame: number;
    config?: BayConfig; bot?: BotSpec | null; captureFromMs?: number; doneAtMs?: number | null;
    show?: DomPhase["show"];
    /** Set when this dom phase's compositor stalled partway through its hold
     *  (see runDomPhase) — the frame index from which every frame is a
     *  repeat of the last one `push` actually captured, rather than a fresh
     *  screenshot. Undefined for a phase that captured cleanly throughout. */
    frozeAtFrame?: number;
  }>;
  events: StampedEvent[];
  notable: Record<string, number[]>;
  preroll?: Record<string, unknown>;
  seed?: number;
  webm?: string | null;
  contact?: string;
  stepsPerFrame?: number;
}

const NOTABLE: Record<string, (e: PromoEvent) => boolean> = {
  lineClear: (e) => e.kind === "clear",
  gradeStamp: (e) => e.kind === "stamp",
  excellent: (e) => e.kind === "stamp" && e.grade === "excellent",
  lucky: (e) => e.kind === "stamp" && e.grade === "lucky",
  blast: (e) => e.kind === "explosion",
  bomb: (e) => e.kind === "explosion" && e.explosion === "bomb",
  thaw: (e) => e.kind === "thaw",
  congestion: (e) => e.kind === "congestion",
  bayClear: (e) => e.kind === "bayclear",
  loss: (e) => e.kind === "loss",
  buzzer: (e) => e.kind === "buzzer",
  cornerDouble: isCornerDouble,
};

class FrameSink {
  private pending: Promise<void>[] = [];
  private lastPng: Buffer | null = null;
  private lastJpeg: Buffer | null = null;
  count = 0;
  constructor(private dir: string, private jpegDir: string | null) {}
  /** Forget the last captured frame — call once per DOM phase, before its
   *  hold loop, so a phase whose OWN first frame stalls can never fall back
   *  to `repeat()`-ing a DIFFERENT phase's last screenshot (see
   *  runDomPhase): that would silently show the wrong screen for a whole
   *  hold rather than the honest "this phase captured nothing" its caller
   *  can act on. */
  resetRepeat(): void { this.lastPng = null; this.lastJpeg = null; }
  /** One frame to disk: the PNG, and its JPEG twin when the mux needs one.
   *
   *  `count` is committed only once `d.shot()` has actually returned a PNG —
   *  not claimed up front — so a shot that throws (the stalled-compositor
   *  failure `runDomPhase` catches) leaves no numbered gap in the sequence on
   *  disk: the next attempt, whether a retry or `repeat()`'s fallback, reuses
   *  the SAME index rather than skipping one ffmpeg's `%06d.png` pattern
   *  would then never find. */
  async push(d: Driver): Promise<number> {
    const idx = this.count;
    const name = String(idx).padStart(6, "0");
    const png = await d.shot();
    this.lastPng = png;
    this.count = idx + 1;
    this.pending.push(writeFile(resolve(this.dir, `${name}.png`), png));
    if (this.jpegDir) {
      // Best-effort: a stalled jpeg (see Driver.jpeg) costs this one frame
      // in the PREVIEW webm only — never the PNG the real trailer is cut
      // from, already queued above — so it is skipped, not fatal.
      try {
        const jpeg = await d.jpeg();
        this.lastJpeg = jpeg;
        this.pending.push(writeFile(resolve(this.jpegDir, `${name}.jpg`), jpeg));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ⚠ jpeg twin for frame ${idx} skipped: ${msg}`);
      }
    }
    if (this.pending.length >= 16) { await Promise.all(this.pending); this.pending = []; }
    return idx;
  }
  /** Write the LAST successfully captured frame again, without asking
   *  Chromium for a new one — the fallback for a DOM hold whose compositor
   *  stalls partway through (see runDomPhase): a screen `push` has already
   *  shown not to be changing is honestly represented by repeating the frame
   *  it already produced, and every consumer downstream (the webm mux, the
   *  contact sheet, assemble.ts) only ever wants a contiguous PNG sequence of
   *  the count the beat promised, not an early, silently short one. */
  async repeat(): Promise<number> {
    if (!this.lastPng) throw new Error("FrameSink.repeat() called before any frame was captured");
    const idx = this.count++;
    const name = String(idx).padStart(6, "0");
    this.pending.push(writeFile(resolve(this.dir, `${name}.png`), this.lastPng));
    if (this.jpegDir && this.lastJpeg) this.pending.push(writeFile(resolve(this.jpegDir, `${name}.jpg`), this.lastJpeg));
    if (this.pending.length >= 16) { await Promise.all(this.pending); this.pending = []; }
    return idx;
  }
  async flush(): Promise<void> { await Promise.all(this.pending); this.pending = []; }
}

/** Fly `frames` frames un-filmed in batches, polling between batches for
 *  the bay's end. Event times come from the page's own clock, so the batch
 *  size costs nothing in accuracy. */
async function skip(d: Driver, frames: number, stop?: (st: PromoStatus) => boolean): Promise<PromoEvent[]> {
  const events: PromoEvent[] = [];
  const batch = FPS;
  for (let done = 0; done < frames;) {
    const n = Math.min(batch, frames - done);
    await d.tick(n);
    done += n;
    const snap = await d.snapshot();
    events.push(...snap.events);
    if (stop?.(snap.status)) break;
  }
  return events;
}

async function runBayPhase(
  d: Driver, phase: BayPhase, index: number, sink: FrameSink, json: BeatJson,
  captureFromMs: number, doneMs: number | null,
): Promise<void> {
  const startFrame = sink.count;
  await d.page.evaluate(
    ([cfg, bot]) => window.__promo.launchBay(cfg as BayConfig, bot as BotSpec | null),
    [phase.config, phase.bot] as const,
  );
  // The bay's clock is zero at launch (harness.ts resets it), so an event's
  // page time IS its bay time, and matches the preroll's.
  // Whatever card is up on the first frame goes.
  await d.frame(false);
  if (await d.page.evaluate(() => window.__promo.dismissCoach())) console.log("  · dismissed a coach card");
  const fired = new Set<number>();
  const seen: PromoEvent[] = [];
  let bayMs = DT;
  let doneAt: number | null = null;
  const maxMs = phase.maxSec * 1000;
  const stamp = (e: PromoEvent, frame: number): void => {
    seen.push(e);
    json.events.push({ ...e, frame, bayMs: Math.round(e.t), phase: index });
  };
  // Every frame is one physics step, filmed or not — the un-filmed ones just
  // run in batches without a screenshot, which is where the wall-clock goes.
  while (bayMs < maxMs) {
    const capturing = bayMs >= captureFromMs;
    if (!capturing) {
      const ahead = Math.max(1, Math.round((captureFromMs - bayMs) / DT));
      const ev = await skip(d, ahead, (st) => !!st.status && st.status !== "playing");
      bayMs += ahead * DT;
      for (const e of ev) stamp(e, -1);
      if (ev.some((e) => e.kind === "status")) break;
      continue;
    }
    await d.frame();
    bayMs += DT;
    const frame = await sink.push(d);
    const snap = await d.snapshot();
    for (const e of snap.events) stamp(e, frame);
    const st = snap.status;
    if (phase.scripted) {
      for (let i = 0; i < phase.scripted.length; i++) {
        const s = phase.scripted[i];
        if (fired.has(i) || !s.when(st, seen)) continue;
        const ok = await d.page.evaluate(
          (a) => a === "bomb" ? window.__promo.fireBomb() : a === "thaw" ? window.__promo.fireThaw() : window.__promo.fireBond(),
          s.action,
        );
        if (ok) { fired.add(i); console.log(`  · scripted ${s.action} at ${(bayMs / 1000).toFixed(2)}s`); }
      }
    }
    if (doneAt === null && phase.done(st, seen)) {
      doneAt = bayMs;
      console.log(`  · done at ${(bayMs / 1000).toFixed(2)}s (frame ${frame})` +
        (doneMs !== null ? ` — preroll said ${(doneMs / 1000).toFixed(2)}s` : ""));
    }
    if (doneAt !== null && bayMs >= doneAt + phase.tailSec * 1000) break;
    if (st.status && st.status !== "playing" && doneAt === null) {
      // The bay ended before the beat's own condition did: keep the tail so
      // the end card reads, then stop rather than film a dead bay for maxSec.
      doneAt = bayMs;
      console.log(`  · bay ended (${st.status}/${st.lossReason ?? "-"}) at ${(bayMs / 1000).toFixed(2)}s before done()`);
    }
  }
  const snap = await d.snapshot();
  const frames = sink.count - startFrame;
  json.stepsPerFrame = frames > 0 ? snap.status.steps / Math.round(bayMs / DT) : undefined;
  json.phases.push({
    index, kind: "bay", startFrame, endFrame: sink.count - 1,
    config: phase.config, bot: phase.bot, captureFromMs, doneAtMs: doneAt,
  });
}

async function runDomPhase(d: Driver, phase: DomPhase, index: number, sink: FrameSink, json: BeatJson): Promise<void> {
  const startFrame = sink.count;
  sink.resetRepeat();
  const show = phase.show;
  trace(`dom phase ${index}: ${JSON.stringify(show).slice(0, 80)}`);
  if ("fixture" in show) {
    await d.page.evaluate((id) => window.__promo.fixture(id), show.fixture);
    trace("fixture rendered");
  } else if ("state" in show) {
    if (show.meta) await d.page.evaluate((m) => window.__promo.patchMeta(m as Partial<MetaState>), show.meta);
    await d.page.evaluate((s) => window.__promo.setState(s), show.state);
  } else if ("ride" in show) {
    if (show.meta) await d.page.evaluate((m) => window.__promo.patchMeta(m as Partial<MetaState>), show.meta);
    await d.page.evaluate(() => window.__promo.setState("menu"));
    await d.page.evaluate((t) => window.__promo.pickTier(t), show.from);
    // Let the car settle on the departure floor, un-filmed, then ride.
    await skip(d, Math.round((towerTravelMs(1, show.from) + 400) / DT));
    await d.page.evaluate((t) => window.__promo.pickTier(t), show.ride);
  } else {
    const p = show.pausedOver;
    await d.page.evaluate(
      ([cfg, bot]) => window.__promo.launchBay(cfg as BayConfig, bot as BotSpec),
      [p.config, p.bot] as const,
    );
    await d.frame(false);
    await d.page.evaluate(() => window.__promo.dismissCoach());
    await skip(d, Math.round(p.warmSec * FPS));
    // The banner goes over the bay's LAST FRAME, held on the canvas by way of
    // the menu state: main.ts never clears a canvas that has a game on it,
    // and on a state that covers the canvas it stops repainting — so the
    // bay freezes exactly where it was when the card came up, as a pause
    // would show it. Pausing for real, or leaving the bay playing under the
    // card, both stalled Chromium's capture on the fourth frame (a compositor
    // that never produced the frame, with the page still answering, nothing
    // loading and no animation running); the frozen canvas films cleanly.
    await d.page.evaluate(() => window.__promo.setState("menu"));
    await d.page.evaluate((id) => window.__promo.fixture(id), p.fixture);
  }
  const frames = Math.round(phase.holdSec * FPS);
  trace(`holding ${frames} frames`);
  // A screen with nothing animating on it (no canvas draw loop, no CSS
  // transition — a DOM fixture or a frozen bay under one) can leave
  // Chromium's compositor with no dirty region to ever recomposite again,
  // here, after the first couple of captures (measured on `climb`'s
  // paused-bay-plus-modal and workshop-state phases; shot()'s own nudged
  // retries do not recover it). Once that happens the screen has already
  // PROVEN it is not changing, so the honest and much cheaper way to fill
  // the rest of the hold is to repeat the last frame `push` did manage
  // rather than keep asking a compositor that has stopped answering.
  let frozen = false;
  for (let f = 0; f < frames; f++) {
    if (frozen) { await sink.repeat(); continue; }
    if (f < 3) trace(`frame ${f}: css advance`);
    await d.frame(f >= 3 || undefined);
    if (f < 3) trace(`frame ${f}: ticked`);
    try {
      await sink.push(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ⚠ dom phase ${index} stalled at frame ${f}/${frames}; repeating its last frame for the rest: ${msg}`);
      frozen = true;
      await sink.repeat();
    }
    if (f < 3) trace(`frame ${f}: filmed`);
  }
  json.phases.push({ index, kind: "dom", startFrame, endFrame: sink.count - 1, show, frozeAtFrame: frozen ? sink.count : undefined });
}

/** Every 30th frame, tiled — a glance at the whole beat. Built as a page of
 *  <img>s and screenshotted by the browser, since the only image tool on the
 *  box is the one already open. */
async function contactSheet(browser: Browser, beatDir: string, frames: number): Promise<string | null> {
  if (frames === 0) return null;
  const every = 30;
  const cols = 6;
  const thumbW = 320;
  const thumbH = Math.round((thumbW * SIZE_H) / SIZE_W);
  const idx: number[] = [];
  for (let i = 0; i < frames; i += every) idx.push(i);
  const rows = Math.ceil(idx.length / cols);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;font:11px monospace;color:#ddd}
    .g{display:grid;grid-template-columns:repeat(${cols},${thumbW}px);gap:4px;padding:4px}
    figure{margin:0;position:relative}img{width:${thumbW}px;height:${thumbH}px;display:block}
    figcaption{position:absolute;left:0;bottom:0;background:#000a;padding:1px 4px}
  </style><div class="g">${idx.map((i) =>
    `<figure><img src="frames/${String(i).padStart(6, "0")}.png"><figcaption>${i}</figcaption></figure>`).join("")}</div>`;
  const path = resolve(beatDir, "contact.html");
  await writeFile(path, html);
  const ctx = await browser.newContext({
    viewport: { width: cols * (thumbW + 4) + 4, height: rows * (thumbH + 4) + 4 }, deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(`file://${path}`, { waitUntil: "load" });
  const out = resolve(beatDir, "contact.png");
  await page.screenshot({ path: out, fullPage: true });
  await ctx.close();
  return out;
}

async function runBeat(browser: Browser, base: string, beat: BeatDef): Promise<void> {
  const beatDir = resolve(OUT, beat.id);
  const framesDir = resolve(beatDir, "frames");
  await mkdir(framesDir, { recursive: true });
  console.log(`▶ ${beat.id} — "${beat.card}"`);
  trace("opening the page");
  const json: BeatJson = {
    beat: beat.id, card: beat.card, fps: FPS, size: `${SIZE_W}x${SIZE_H}`,
    frames: 0, phases: [], events: [], notable: {},
  };

  const d = await openDriver(browser, base, { w: SIZE_W, h: SIZE_H, dpr: 1 }, STORE_META);
  trace("page open, on the menu");

  // Seed search and lead-in timing: headless flights, but IN THE PAGE
  // (harness.ts's fly/prerollPhase/findLuckySeed), because node's V8 and
  // Chromium's disagree in the last bit of enough arithmetic that the same
  // bay diverges after a few hundred steps. Flown in this engine, with the
  // same clock delta, the preroll predicts the App's bay to the step —
  // beat.json's preroll.phases[].match says whether it did.
  const phases = beat.phases.map((p) => ({ ...p }));
  if (beat.seedSearch) {
    const pi = phases.findIndex((p) => p.kind === "bay");
    const phase = phases[pi] as BayPhase;
    const { from, criterion } = beat.seedSearch;
    const count = SEEDS ?? beat.seedSearch.count;
    if (criterion === "lucky") {
      console.log(`  · searching ${count} seeds from ${from} for a lucky last clear at the buzzer…`);
      const res = await d.page.evaluate(
        ([id, i, f, n]) => window.__promo.findLuckySeed(id, i, f, n),
        [beat.id, pi, from, count] as const,
      );
      if (!res) {
        console.error(`  ✗ no seed in ${count} produced a lucky last clear on a clock-ended bay; try --seeds=N`);
        json.preroll = { seedSearch: { from, count, criterion, found: false } };
      } else {
        phase.config = { ...phase.config, seed: res.seed };
        json.seed = res.seed;
        json.preroll = {
          seedSearch: {
            from, count, criterion, tried: res.tried, found: true,
            seed: res.seed, met: res.criterion, gapMs: Math.round(res.gapMs),
            endMs: Math.round(res.log.endMs), status: res.log.status, lossReason: res.log.lossReason,
          },
        };
        console.log(`  · seed ${res.seed} (${res.criterion}; lucky clear ${(res.gapMs / 1000).toFixed(1)}s before the buzzer)`);
      }
    } else {
      const res = await d.page.evaluate(
        ([id, i, f, n]) => window.__promo.findDoneSeed(id, i, f, n),
        [beat.id, pi, from, count] as const,
      );
      if (!res) {
        console.error(`  ✗ no seed in ${count} from ${from} reached the beat's end condition inside ${phase.maxSec}s; try --seeds=N`);
        json.preroll = { seedSearch: { from, count, criterion, found: false } };
      } else {
        phase.config = { ...phase.config, seed: res.seed };
        json.seed = res.seed;
        json.preroll = { seedSearch: { from, count, criterion, tried: res.tried, found: true, seed: res.seed, doneMs: Math.round(res.at) } };
        if (res.tried > 1) console.log(`  · seed ${res.seed} (the ${res.tried - 1} before it never reached the beat's event in this engine)`);
      }
    }
  }
  // Every bay phase is flown first: the capture window opens `leadSec`
  // before the beat's own condition lands, or at `skipSec` when it never does.
  const leadIn = new Map<number, { captureFromMs: number; doneMs: number | null; log: FlightLog }>();
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.kind !== "bay") continue;
    const { at: doneMs, log } = await d.page.evaluate(
      ([id, k, cfg]) => window.__promo.prerollPhase(id, k, cfg as BayConfig),
      [beat.id, i, p.config] as const,
    );
    const skipMs = (p.skipSec ?? 0) * 1000;
    const captureFromMs = doneMs === null || !p.leadSec ? skipMs : Math.max(skipMs, doneMs - p.leadSec * 1000);
    leadIn.set(i, { captureFromMs, doneMs, log });
    console.log(
      `  · preroll phase ${i}: ${log.status}/${log.lossReason ?? "-"} at ${(log.endMs / 1000).toFixed(1)}s, ` +
      `done ${doneMs === null ? "never" : `@${(doneMs / 1000).toFixed(2)}s`}; capturing from ${(captureFromMs / 1000).toFixed(2)}s`,
    );
  }

  const jpegDir = WEBM && FFMPEG && !FFMPEG_READS_PNG ? resolve(beatDir, "frames-jpg") : null;
  if (jpegDir) await mkdir(jpegDir, { recursive: true });
  const sink = new FrameSink(framesDir, jpegDir);
  try {
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      if (p.kind === "bay") {
        const lead = leadIn.get(i)!;
        await runBayPhase(d, p, i, sink, json, lead.captureFromMs, lead.doneMs);
        // Did the browser's bay match the headless one? Compare where the
        // beat's own condition landed (both null counts as a match).
        const browserDone = json.phases[json.phases.length - 1].doneAtMs ?? null;
        const match = browserDone === null && lead.doneMs === null
          ? true
          : browserDone !== null && lead.doneMs !== null && Math.abs(browserDone - lead.doneMs) <= DT * 2;
        const prior = (json.preroll?.phases as unknown[] | undefined) ?? [];
        json.preroll = { ...(json.preroll ?? {}), phases: [...prior, { phase: i, prerollDoneMs: lead.doneMs, browserDoneMs: browserDone, match }] };
        if (!match) console.log(`  ⚠ browser bay diverged from the preroll (preroll ${lead.doneMs}ms, browser ${browserDone}ms)`);
      } else {
        // A DOM phase can hit the stalled-compositor failure mode shot()
        // gives up on after 5 nudged retries (measured on `climb`'s paused-
        // bay-plus-modal phase: a genuinely static frame Chromium never
        // recomposites, in this environment, no matter how it is reached —
        // frozen via menu state or paused for real, both tried). One phase
        // failing to capture is not a reason to lose every phase around it —
        // OTHER beats, and this beat's OTHER phases, still have a story to
        // tell — so it is logged and skipped rather than thrown, and
        // `json.phases` records the gap for assemble.ts and the report to see.
        const beforeCount = sink.count;
        try {
          await runDomPhase(d, p, i, sink, json);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`  ✗ dom phase ${i} failed to capture (kept ${sink.count - beforeCount} of its frames), skipping the rest: ${msg}`);
          json.phases.push({ index: i, kind: "dom", startFrame: beforeCount, endFrame: sink.count - 1, show: p.show });
        }
      }
    }
  } finally {
    await sink.flush();
    await d.close();
  }
  json.frames = sink.count;
  console.log(`  · ${timingLine(d.timing, Math.max(1, sink.count))}`);
  for (const [name, test] of Object.entries(NOTABLE)) {
    const frames = json.events.filter((e) => e.frame >= 0 && test(e)).map((e) => e.frame);
    if (frames.length) json.notable[name] = frames;
  }
  json.contact = (await contactSheet(browser, beatDir, sink.count)) ?? undefined;
  if (WEBM && FFMPEG && sink.count > 0) {
    const webm = resolve(OUT, `${beat.id}.webm`);
    console.log(`  · muxing ${sink.count} frames → ${webm}`);
    json.webm = (await muxWebm(framesDir, jpegDir, webm)) ? webm : null;
  } else {
    json.webm = null;
  }
  await writeFile(resolve(beatDir, "beat.json"), JSON.stringify(json, null, 2));
  const summary = Object.entries(json.notable).map(([k, v]) => `${k}@${v.join(",")}`).join(" ");
  console.log(`  ✓ ${sink.count} frames (${(sink.count / FPS).toFixed(1)}s) ${summary}`);
}

/* ---------------------------------------------------------------------------
 * Store screenshots
 * ------------------------------------------------------------------------- */

interface ShotRecord {
  file: string; scene: string; store: string; size: string; px: { w: number; h: number };
  css: { w: number; h: number }; dpr: number; family: string; config: unknown; note?: string;
}

async function captureScene(browser: Browser, base: string, size: StoreSize, scene: SceneDef, file: string): Promise<ShotRecord> {
  const css = size.css[scene.family];
  const dpr = size.px.w / css.w;
  if (Math.abs(css.h * dpr - size.px.h) > 0.01) throw new Error(`${size.label}/${scene.family}: ${css.w}x${css.h} @${dpr} is not ${size.px.w}x${size.px.h}`);
  const d = await openDriver(browser, base, { w: css.w, h: css.h, dpr, touch: true }, STORE_META);
  const show = scene.show;
  // Screens enter on a stylesheet transition; un-filmed frames leave the
  // stylesheet's clock paused, so a scene gets half a second of filmed-style
  // frames before its shot or its fade would be caught at opacity 0.
  const settle = async (): Promise<void> => { for (let f = 0; f < FPS / 2; f++) await d.frame(); };
  try {
    if (show.kind === "menu") {
      await skip(d, Math.round(show.warmSec * FPS));
      await settle();
    } else if (show.kind === "state") {
      await d.page.evaluate((s) => window.__promo.setState(s), show.state);
      await skip(d, Math.round(show.warmSec * FPS));
      await settle();
    } else {
      await d.page.evaluate(
        ([cfg, bot]) => window.__promo.launchBay(cfg as BayConfig, bot as BotSpec),
        [show.config, show.bot] as const,
      );
      await d.frame(false);
      await d.page.evaluate(() => window.__promo.dismissCoach());
      const seen: PromoEvent[] = [];
      let ms = 0;
      // Un-filmed, so batched; polled every few frames for `until`.
      while (ms < show.warmSec * 1000) {
        await d.tick(4); ms += DT * 4;
        const snap = await d.snapshot();
        seen.push(...snap.events);
        if (show.until && show.until(snap.status, seen)) break;
      }
      for (let f = 0; f < (show.settleFrames ?? 0); f++) await d.frame();
      if (show.aiming) await d.page.evaluate(() => window.__promo.setAiming(true));
      await settle();
    }
    const png = await d.shot();
    await writeFile(file, png);
  } finally {
    await d.close();
  }
  return {
    file, scene: scene.id, store: size.store, size: size.label, px: size.px, css, dpr,
    family: scene.family, config: show.kind === "bay" ? { config: show.config, bot: show.bot } : { meta: STORE_META },
    note: size.note,
  };
}

async function runShots(browser: Browser, base: string): Promise<void> {
  const sizes = STORE_SIZES.filter((s) => STORE === "all" || s.store === STORE);
  if (sizes.length === 0) { console.error(`✗ --store must be play, appstore or all`); process.exit(1); }
  const manifest: ShotRecord[] = [];
  for (const size of sizes) {
    const dir = resolve(OUT, "store", size.store, size.label);
    await mkdir(dir, { recursive: true });
    console.log(`▶ store ${size.store}/${size.label}${size.note ? ` — ${size.note}` : ""}`);
    for (let i = 0; i < SCENES.length; i++) {
      const scene = SCENES[i];
      if (size.only && !size.only.includes(scene.id)) continue;
      const file = resolve(dir, `${String(i + 1).padStart(2, "0")}-${scene.id}.png`);
      const rec = await captureScene(browser, base, size, scene, file);
      manifest.push(rec);
      console.log(`  ✓ ${rec.file} (${rec.css.w}x${rec.css.h} @${rec.dpr})`);
    }
  }
  await writeFile(resolve(OUT, "store", "manifest.json"), JSON.stringify({
    generated: new Date().toISOString(),
    meta: STORE_META,
    note: "The game is landscape-only; portrait rows render the rotate guard and are listed for completeness, not for upload.",
    shots: manifest,
  }, null, 2));
}

/* ---------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------- */

await mkdir(OUT, { recursive: true });
await access(resolve(APP, "node_modules")).catch(() => {
  console.error("✗ app/node_modules is missing — npm install first");
  process.exit(1);
});
console.log(`out: ${OUT}\nffmpeg: ${FFMPEG ?? "none (frames + mux.sh only)"}`);

const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) { console.error("✗ the harness dev server reported no local URL"); process.exit(1); }

const playwright = await import("playwright");
const browser = await playwright.chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
try {
  for (const id of BEAT_IDS) await runBeat(browser, base, BEATS[id]);
  if (SHOTS) await runShots(browser, base);
} finally {
  await browser.close();
  await server.close();
}
