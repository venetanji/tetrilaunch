/**
 * SOUND — effects, music and stingers.
 *
 * Assets come from scripts/prepare-audio.mjs, which trims the generated
 * originals in `audio/` into `public/audio/`. Effect names here are the game
 * callback names (GameEvents in game/game.ts) so there is no translation step
 * between "what fired" and "what plays".
 *
 * Two mechanisms, chosen per job rather than one for both:
 *
 *  - **Effects use Web Audio.** They are tiny (60 KB for all nine), they
 *    overlap — several cubes land in the same frame — and they must fire on the
 *    physics event with no perceptible delay. Decoding each once into an
 *    AudioBuffer and firing a throwaway BufferSource gives unlimited overlap
 *    and no per-play allocation of a decoder. An <audio> element per effect
 *    cannot overlap with itself at all: retriggering restarts the one playing.
 *
 *  - **Music and stingers use <audio> elements.** They are 0.3–2.7 MB. Decoding
 *    those into memory as AudioBuffers would cost tens of MB of PCM for no
 *    benefit, where an element streams and seeks natively.
 *
 * Nothing here throws. Audio is decoration: a missing file, a decode failure or
 * a browser that refuses playback must never interrupt a run.
 */

const BASE = import.meta.env.BASE_URL;

export type FxName =
  | "shoot"
  | "impact"
  | "lineClear"
  | "pieceLost"
  | "settleStart"
  | "cryoShatter"
  | "bondBreak"
  | "bondBreak2"
  | "reloadReady";

export type MusicName = "menu" | "deep-run" | "contracts";
export type StingerName = "bayClear" | "gameOver" | "gameOver2" | "refit";

const FX_NAMES: FxName[] = [
  "shoot", "impact", "lineClear", "pieceLost", "settleStart",
  "cryoShatter", "bondBreak", "bondBreak2", "reloadReady",
];

/** Effects sit under the music, and a launch fires several times a second —
 *  full-scale one-shots over a bed turn into a wall. */
const FX_BUS_GAIN = 0.75;
const MUSIC_GAIN = 0.45;
const STINGER_GAIN = 0.7;
/** Crossfade between tracks, and the fade applied when a stinger is cut short
 *  by the next screen. Long enough not to click, short enough not to muddy. */
const FADE_MS = 450;

let ctx: AudioContext | null = null;
let fxBus: GainNode | null = null;
const buffers = new Map<FxName, AudioBuffer>();

let music: HTMLAudioElement | null = null;
let musicName: MusicName | null = null;
let stinger: HTMLAudioElement | null = null;
let stingerName: StingerName | null = null;
/** Whether the bed was paused BY a stinger, so it is only resumed if this is
 *  what silenced it — never if the player turned music off meanwhile. */
let musicPausedByStinger = false;

let soundOn = true;
let musicOn = true;
let unlocked = false;

/* ---------------------------------------------------------------- settings */

/** Called on load and whenever the Settings toggles change. Music reacts
 *  immediately — a player switching it off mid-run expects silence now, not at
 *  the next screen. */
export function setAudioEnabled(next: { sound: boolean; music: boolean }): void {
  soundOn = next.sound;
  musicOn = next.music;
  if (fxBus && ctx) fxBus.gain.setTargetAtTime(soundOn ? FX_BUS_GAIN : 0, ctx.currentTime, 0.01);
  if (!musicOn) {
    fadeOutAndStop(music);
    music = null;
    fadeOutAndStop(stinger);
    stinger = null;
    stingerName = null;
    // Cleared, not honoured later: the bed this flag referred to is gone, and
    // a stinger ending after this must not resurrect music the player just
    // switched off.
    musicPausedByStinger = false;
  } else if (musicName) {
    // Turned back on: resume whatever the current screen wants.
    const want = musicName;
    musicName = null;
    playMusic(want);
  }
}

/* ------------------------------------------------------------------ unlock */

/**
 * Browsers start an AudioContext suspended until a user gesture, and iOS is
 * stricter still. main.ts calls this from the first pointerdown; it is cheap
 * and idempotent after the first success.
 *
 * Decoding happens here rather than at module load so a player who never
 * touches the screen never pays for it, and so the fetches do not compete with
 * the first paint.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    fxBus = ctx.createGain();
    fxBus.gain.value = soundOn ? FX_BUS_GAIN : 0;
    fxBus.connect(ctx.destination);
    void ctx.resume();
    void loadEffects();
  } catch {
    ctx = null;
  }
}

async function loadEffects(): Promise<void> {
  await Promise.all(FX_NAMES.map(async (name) => {
    try {
      const res = await fetch(`${BASE}audio/fx/${name}.mp3`);
      if (!res.ok) return;
      const buf = await ctx!.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, buf);
    } catch {
      /* a missing effect is silence, not a crash */
    }
  }));
}

/* ----------------------------------------------------------------- effects */

/**
 * `rate` detunes by resampling — the cheapest way to stop a repeated effect
 * sounding mechanical, and how lineClear escalates with the line count without
 * needing four files.
 */
export function playFx(name: FxName, opts: { rate?: number; gain?: number } = {}): void {
  if (!soundOn || !ctx || !fxBus) return;
  const buf = buffers.get(name);
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    if (opts.gain !== undefined && opts.gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = opts.gain;
      src.connect(g).connect(fxBus);
    } else {
      src.connect(fxBus);
    }
    src.start();
  } catch {
    /* ignore */
  }
}

/** Impacts arrive in bursts as a piece settles. Without a floor they overlap
 *  into mush and drown the music; the small random detune keeps repeats from
 *  sounding like one looped sample. */
let lastImpactAt = 0;
export function playImpact(strength = 1): void {
  const now = performance.now();
  if (now - lastImpactAt < 60) return;
  lastImpactAt = now;
  playFx("impact", {
    rate: 0.92 + Math.random() * 0.16,
    gain: Math.max(0.35, Math.min(1, strength)),
  });
}

/** One file, four intensities: each extra line pitches the sweep up a step. */
export function playLineClear(lines: number): void {
  playFx("lineClear", { rate: 1 + Math.max(0, lines - 1) * 0.09 });
}

/** Two takes of the same snap, alternated so a chain of breaks varies. */
let bondFlip = false;
export function playBondBreak(): void {
  bondFlip = !bondFlip;
  playFx(bondFlip ? "bondBreak" : "bondBreak2", { rate: 0.95 + Math.random() * 0.1 });
}

/* ------------------------------------------------------- music & stingers */

/**
 * Fades run on a TIMER, not requestAnimationFrame.
 *
 * rAF does not fire while the page is not compositing — a backgrounded app, a
 * hidden tab, a device with the screen off. A fade-out driven by rAF therefore
 * never reaches its final pause(), and music told to stop keeps playing until
 * the app is looked at again. Caught in exactly that state: with the page not
 * rendering, every element stayed audible forever and nothing the state machine
 * asked for took effect. Sound has to keep its promises when nothing is drawn.
 */
const FADE_STEP_MS = 25;
const fades = new WeakMap<HTMLAudioElement, ReturnType<typeof setInterval>>();

function cancelFade(el: HTMLAudioElement): void {
  const t = fades.get(el);
  if (t !== undefined) { clearInterval(t); fades.delete(el); }
}

function fadeTo(el: HTMLAudioElement, to: number, done?: () => void): void {
  cancelFade(el);
  const from = el.volume;
  const started = Date.now();
  const timer = setInterval(() => {
    const t = Math.min(1, (Date.now() - started) / FADE_MS);
    try {
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    } catch { /* element torn down mid-fade */ }
    if (t >= 1) { cancelFade(el); done?.(); }
  }, FADE_STEP_MS);
  fades.set(el, timer);
}

function fadeOutAndStop(el: HTMLAudioElement | null): void {
  if (!el) return;
  fadeTo(el, 0, () => {
    el.pause();
    // Release the stream. Assigning "" makes some engines log a failed load;
    // removeAttribute is the quiet equivalent.
    el.removeAttribute("src");
    el.load();
  });
}

function fadeIn(el: HTMLAudioElement, to: number): void {
  el.volume = 0;
  fadeTo(el, to);
}

/**
 * Screen music. Passing the track already playing is a no-op, so callers can
 * fire this on every render without restarting the bed each time — which is
 * what makes it safe to drive from renderOverlay.
 */
export function playMusic(track: MusicName | null): void {
  if (track === musicName) return;
  musicName = track;
  fadeOutAndStop(music);
  music = null;
  // The bed being replaced is the one a stinger may have paused, so the debt
  // is settled here — otherwise a stinger ending later would call play() on a
  // track that is no longer the current one.
  musicPausedByStinger = false;
  if (!track || !musicOn) return;
  try {
    const el = new Audio(`${BASE}audio/music/${track}.mp3`);
    el.loop = true;
    el.preload = "auto";
    music = el;
    // play() resolves asynchronously, and a fast screen change can replace
    // `music` before it does. Without this check the superseded element's
    // continuation fades ITSELF back in — against the fade-out already running
    // on it — and two beds end up audible.
    void el.play().then(() => { if (music === el) fadeIn(el, MUSIC_GAIN); })
      .catch(() => { /* autoplay refused */ });
  } catch {
    music = null;
  }
}

/**
 * A stinger marks a moment and keeps playing under the screen that follows —
 * bayClear runs 20s over a 1.7s transition and the hazard draft after it.
 *
 * It PAUSES the bed rather than ducking it. Ducking is right for a 200ms sting;
 * these are 20–25s musical pieces, and holding the bed at 25% underneath one
 * means two songs, in two keys, for twenty seconds. Pausing (rather than
 * stopping) means the bed resumes mid-phrase where it left off when the stinger
 * ends, instead of restarting the track.
 */
export function playStinger(name: StingerName): void {
  if (!musicOn) return;
  // Same stinger already running: leave it alone. refit and draft are separate
  // app states that share one stinger, so without this, walking from the refit
  // screen to the draft restarts a 24s piece from zero.
  if (stinger && stingerName === name) return;
  stopStinger({ resumeMusic: false });
  try {
    const el = new Audio(`${BASE}audio/stingers/${name}.mp3`);
    el.preload = "auto";
    stinger = el;
    stingerName = name;
    if (music && !music.paused) { music.pause(); musicPausedByStinger = true; }
    void el.play().then(() => { if (stinger === el) fadeIn(el, STINGER_GAIN); })
      .catch(() => { /* ignore */ });
    el.addEventListener("ended", () => {
      if (stinger !== el) return;
      stinger = null;
      stingerName = null;
      resumeMusicAfterStinger();
    }, { once: true });
  } catch {
    stinger = null;
    stingerName = null;
  }
}

/** `resumeMusic: false` is for the internal replace-one-stinger-with-another
 *  path, where the incoming stinger is about to pause the bed again anyway —
 *  resuming in between would blip a fragment of the bed between two stingers. */
export function stopStinger(opts: { resumeMusic?: boolean } = {}): void {
  if (!stinger) return;
  fadeOutAndStop(stinger);
  stinger = null;
  stingerName = null;
  if (opts.resumeMusic !== false) resumeMusicAfterStinger();
}

function resumeMusicAfterStinger(): void {
  if (!musicPausedByStinger) return;
  musicPausedByStinger = false;
  if (!music || !musicOn) return;
  const el = music;
  void el.play().then(() => { if (music === el) fadeIn(el, MUSIC_GAIN); }).catch(() => { /* ignore */ });
}
