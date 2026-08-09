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
/** Set while the app is backgrounded, so playback that arrives from a timer or
 *  a pending promise while hidden does not start something audible behind a
 *  screen the player is not looking at. */
let suspended = false;

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
 * A stinger marks a moment and then owns the music channel until something
 * else asks for a bed.
 *
 * It STOPS the looping music rather than ducking or pausing it. Two earlier
 * shapes were both wrong in play:
 *
 *  - Ducking to 25% left two songs in two keys audible together for twenty
 *    seconds. These are musical pieces, not 200ms stings.
 *  - Pausing and resuming meant the bay-clear sting was followed by the bay's
 *    bed fading back in under the hazard draft, which is a second transition
 *    nobody asked for. A cleared bay should ring out and then leave the player
 *    in silence to choose.
 *
 * So the stinger plays over nothing and ends into nothing; the next state that
 * wants a bed asks for one. Because the bed is stopped here rather than by the
 * caller, no call site can reintroduce the overlap.
 */
export function playStinger(name: StingerName): void {
  if (!musicOn) return;
  // Same stinger already running: leave it alone. refit and draft are separate
  // app states, so without this, walking between them restarts a 24s piece.
  if (stinger && stingerName === name) return;
  stopStinger();
  playMusic(null);
  try {
    const el = new Audio(`${BASE}audio/stingers/${name}.mp3`);
    el.preload = "auto";
    stinger = el;
    stingerName = name;
    void el.play().then(() => { if (stinger === el) fadeIn(el, STINGER_GAIN); })
      .catch(() => { /* ignore */ });
    el.addEventListener("ended", () => {
      if (stinger !== el) return;
      stinger = null;
      stingerName = null;
    }, { once: true });
  } catch {
    stinger = null;
    stingerName = null;
  }
}

export function stopStinger(): void {
  if (!stinger) return;
  fadeOutAndStop(stinger);
  stinger = null;
  stingerName = null;
}

/* --------------------------------------------------------- backgrounding */

/**
 * Silence everything while the app is not in front, and pick up where it left
 * off when it comes back.
 *
 * Nothing does this for us. An <audio> element keeps playing when the activity
 * goes to the background — that is the correct default for a podcast and quite
 * wrong for a game, which is how you end up as the app still playing music
 * under someone's phone call. Android may eventually take audio focus away, but
 * "eventually, sometimes" is not a behaviour to ship.
 *
 * Paused, not stopped: the player is coming back mid-bay and the bed should
 * resume rather than restart from the top. The AudioContext is suspended too,
 * so no queued effect fires into a screen nobody is looking at.
 */
export function suspendAudio(): void {
  if (suspended) return;
  suspended = true;
  try { music?.pause(); } catch { /* ignore */ }
  try { stinger?.pause(); } catch { /* ignore */ }
  void ctx?.suspend().catch(() => { /* ignore */ });
}

export function resumeAudio(): void {
  if (!suspended) return;
  suspended = false;
  void ctx?.resume().catch(() => { /* ignore */ });
  if (!musicOn) return;
  // Only the element still current is resumed — one replaced while hidden is
  // already being faded out and must stay down.
  const m = music;
  if (m) void m.play().catch(() => { /* ignore */ });
  const s = stinger;
  if (s) void s.play().catch(() => { /* ignore */ });
}
