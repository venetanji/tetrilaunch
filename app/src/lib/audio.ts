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

import type { ContractBed } from "../game/contracts";
import type { BayTrack } from "../game/run";

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

/**
 * The menu lounge, the Deep Run's per-bay ladder, and the Contract bed — which
 * is one of the run's beds on loan today (contracts.ts's CONTRACT_BED).
 *
 * WHICH bed covers which bay is run design, not playback, so it lives in
 * game/run.ts (bayMusic) and this module only knows how to play what it is
 * handed. The names are roles; scripts/prepare-audio.mjs decides which
 * generated master becomes each one.
 */
export type MusicName = "menu" | ContractBed | BayTrack;
export type StingerName = "bayClear" | "gameOver" | "gameOver2" | "refit";

const FX_NAMES: FxName[] = [
  "shoot", "impact", "lineClear", "pieceLost", "settleStart",
  "cryoShatter", "bondBreak", "bondBreak2", "reloadReady",
];

/**
 * THE MIX — and it is deliberately the inverse of what these numbers used to
 * say.
 *
 * Effects sat 4.4dB OVER the bed (0.75 against 0.45), which made the
 * soundtrack the thing playing behind the game instead of the thing the game
 * is played to. Music is the foreground now; everything else is placed against
 * it. A launch still fires several times a second, so one-shots over a bed
 * still turn into a wall — they are just doing it from underneath.
 *
 * Headroom is the constraint on how far this can go, because these all sum at
 * the destination and Web Audio hard-clips at 1.0. A bed reaches 0.84 before
 * its gain (loudness-normalised with a -1.5 dBTP ceiling) and an effect 0.71
 * (peak-normalised to -3dBFS), so at 0.75 and 0.6 a typical coincidence lands
 * near 0.98 and the worst imaginable one at 1.05. That is why bringing music
 * up meant taking effects down rather than leaving them where they were.
 *
 * Stingers sit BELOW the bed, and matching their files to the same -15 LUFS
 * target is exactly why they have to. Equal integrated loudness is not equal
 * perceived loudness: bayClear measures LRA 1.3, the flattest thing in the
 * whole set, against 3.7 for bay-1 and 2.5-6.0 for everything else. A track
 * with no dynamics sits AT its level for all twenty seconds while a bed only
 * touches its own on peaks, so the two read a good 1.5 LU apart while the
 * meter calls them identical. Landing into silence — playStinger stops the
 * music outright rather than ducking it (see below) — is what makes that
 * difference land as a shout rather than a transition.
 *
 * So the jingle is placed by ear, under the bed, and 3dB is where "the same or
 * lower" actually sounded like the same or lower. Note that the masters
 * already said this: bayClear is 0.8 LU quieter than bay-1 as generated, and
 * normalising both to one target is what threw that away. This constant buys
 * it back. Keeping it a ratio OF MUSIC_GAIN rather than a bare number is the
 * part that matters — the whole point of a level target is that the bed moves
 * and the jingle keeps its distance.
 */
const FX_BUS_GAIN = 0.6;
const MUSIC_GAIN = 0.75;
const STINGER_UNDER_DB = -3;
const STINGER_GAIN = MUSIC_GAIN * 10 ** (STINGER_UNDER_DB / 20);
/** Crossfade between tracks, and the fade applied when a stinger is cut short
 *  by the next screen. Long enough not to click, short enough not to muddy. */
const FADE_MS = 450;

/* ------------------------------------------------------ the congestion cue */

/**
 * Congestion has always been something the player SEES — the bay floor lights
 * row by row (game/render.ts's drawCongestionRows). This is the same state
 * offered to the ear: static rises over the bed and the bed itself goes
 * muffled, so a bay filling up sounds like a signal degrading rather than
 * sounding like nothing at all.
 *
 * The static is GENERATED, not shipped. It is white noise through a bandpass,
 * which is what static IS, and an mp3 would have cost ~2.5 MB in a precache
 * already carrying 29 MB of music to say what Math.random says for free.
 *
 * Muffling means a lowpass, which means the music has to reach the audio graph
 * — so playMusic now routes its element through createMediaElementSource. That
 * does NOT undo the reason music uses <audio> at all (see the module note
 * above): a MediaElementSource STREAMS. It never decodes the track into an
 * AudioBuffer, so the megabytes-of-PCM argument holds exactly as written.
 */

/** Lowpass corner with a clean bay — above hearing, i.e. not filtering at all —
 *  and where it lands at full congestion. */
const MUSIC_OPEN_HZ = 20000;
const MUSIC_MUFFLED_HZ = 900;
/**
 * Peak static, before the effects bus applies its own gain. Broadband noise
 * reads far louder than its amplitude suggests, and this cue is meant to nag
 * from under the music rather than take the mix over.
 *
 * Congestion is the one thing allowed to interfere with the bed, so this is
 * pinned to the bed's level rather than left to drift against it. The cue was
 * tuned at 0.1 through a 0.75 effects bus against a 0.45 bed; 0.21 through 0.6
 * against a 0.75 bed is the same ratio, arrived at the same way. Raising the
 * music without bringing the static with it would have quietly retired the
 * only cue that is supposed to cut through.
 */
const STATIC_GAIN = 0.21;
/** Static rises fast and falls slow. That is the right dramatic shape, and it
 *  is also free hysteresis: a cube count sitting on a threshold crosses the
 *  tier several times a second, and a symmetric ramp would stutter audibly. */
const CUE_RISE_TAU = 0.08;
const CUE_FALL_TAU = 0.35;

let ctx: AudioContext | null = null;
let fxBus: GainNode | null = null;
/** Music's last stop before the output, so congestion can close it down. */
let musicFilter: BiquadFilterNode | null = null;
/** The static's level. Null until the first congested bay — a player who never
 *  fills one never pays for the noise source at all. */
let staticGain: GainNode | null = null;
let congestion = 0;
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
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = MUSIC_OPEN_HZ;
    musicFilter.connect(ctx.destination);
    // The context can be stopped from OUTSIDE suspendAudio: a phone call, a
    // voice assistant, an alarm, a Bluetooth handoff — the OS ends the audio
    // session while the page stays visible, so the visibilitychange pair never
    // runs and `suspended` stays false. Music routes through the graph
    // (routeMusic), so a context left that way silences every bed while the
    // unrouted stingers still play — which reads as "the music got quiet", not
    // "audio died", and it stays that way for the rest of the session. Resume
    // on any stop we did not ask for; while backgrounded, suspendAudio owns
    // the state and this stays out of its way.
    ctx.addEventListener("statechange", () => {
      resumeStoppedContext();
    });
    void ctx.resume();
    void loadEffects();
  } catch {
    ctx = null;
  }
}

/** Resume a context that stopped without suspendAudio asking it to — see the
 *  statechange note in unlockAudio. Also nudged from the moments that need the
 *  graph audible (a bed routing in, a congestion cue), because an OS-side
 *  interruption does not fire statechange on every engine. A refusal is left
 *  alone: the session is still held, and the next nudge retries. */
function resumeStoppedContext(): void {
  if (ctx && !suspended && ctx.state !== "running") {
    void ctx.resume().catch(() => { /* still interrupted — retried on the next nudge */ });
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

/**
 * Impacts arrive in bursts as a piece settles. The 60ms floor stops them
 * overlapping into mush; the small random detune keeps repeats from sounding
 * like one looped sample.
 *
 * The curve rides on a floor rather than running from zero. Measured over a
 * real bay (24 shots, 18 impacts) the median relative speed is 8.3, which the
 * strength mapping turns into 0.43 — HALF of all impacts sit at the bottom of
 * the range, and a landing that maps to near-silence is a landing the player
 * does not feel.
 *
 * That floor was 0.55 and is now 0.40, which is the SAME sound coming out. It
 * was raised to 0.55 to chase an impact that read as "not very audible",
 * against a note that the sample was never the problem. The sample was the
 * problem: impact.mp3 shipped at -5.7dBFS against the pipeline's -3 target,
 * alone among the nine effects, because its gain was computed from a source
 * peak that the trim had already cut away — see maxVolumeDb in
 * scripts/prepare-audio.mjs, which now measures the window it actually ships
 * and verifies the finished file. The sample arrives 2.7dB hotter, so 0.40
 * against it is 0.55 against the old one, to within a rounding error.
 *
 * Re-tune by ear if it wants it. Just not because something moved underneath.
 */
let lastImpactAt = 0;
export function playImpact(strength = 1): void {
  const now = performance.now();
  if (now - lastImpactAt < 60) return;
  lastImpactAt = now;
  const s = Math.max(0, Math.min(1, strength));
  playFx("impact", {
    rate: 0.92 + Math.random() * 0.16,
    gain: 0.40 + 0.33 * s,
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
    routeMusic(el);
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

/**
 * Send a music element through the graph so the congestion lowpass reaches it.
 *
 * Best-effort by design, and the failure has to fall the safe way. With no
 * AudioContext yet — the menu bed starts before the first pointerdown unlocks
 * one — the element plays straight to the output unfiltered, which is correct:
 * nothing is congested on a menu, and that bed is replaced before a bay begins.
 * If createMediaElementSource throws it never captured the element, so the
 * element goes on playing by itself. Either way the music ends up unmuffled
 * rather than silent, and silent music would be much the worse bug.
 */
function routeMusic(el: HTMLAudioElement): void {
  if (!ctx || !musicFilter) return;
  // Once captured, this element is audible only while the context runs — so a
  // bed starting against a context stopped by an OS interruption must wake it,
  // or the track plays silently into a dead graph (see resumeStoppedContext).
  resumeStoppedContext();
  try {
    ctx.createMediaElementSource(el).connect(musicFilter);
  } catch {
    /* left playing to the output on its own — see above */
  }
}

/** The noise source, built on the first congested bay and then left running at
 *  zero gain for good. A BufferSource cannot be restarted, and a looping
 *  2-second buffer through one filter is not worth the bookkeeping of tearing
 *  down and rebuilding every time a bay gets tidied. */
function ensureStatic(): void {
  if (!ctx || !fxBus || staticGain) return;
  try {
    // Two seconds is long enough that the loop point is inaudible in noise.
    const frames = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Flat white noise is a hiss. A wide bandpass through the presence range is
    // what makes it read as a signal breaking up rather than a blown speaker.
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2000;
    band.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Through the EFFECTS bus rather than straight to the output: the static is
    // a game cue, so the Sound toggle should govern it and it should sit at the
    // effects level. Routing it here means both come for free.
    src.connect(band).connect(gain).connect(fxBus);
    src.start();
    staticGain = gain;
  } catch {
    staticGain = null;
  }
}

/**
 * How congested the bay is: 0 for clean, 1 for the worst tier.
 *
 * Driven by tier CROSSINGS (game.ts's onCongestion) rather than per frame, and
 * idempotent — so main.ts can also call it on a screen change to guarantee the
 * cue never outlives the bay that earned it.
 */
export function setCongestion(level: number): void {
  const next = Math.max(0, Math.min(1, level));
  const rising = next > congestion;
  congestion = next;
  if (!ctx) return;
  resumeStoppedContext();
  if (next > 0) ensureStatic();
  const now = ctx.currentTime;
  const tau = rising ? CUE_RISE_TAU : CUE_FALL_TAU;
  staticGain?.gain.setTargetAtTime(STATIC_GAIN * next, now, tau);
  // GEOMETRIC between the two corners, because pitch is. Interpolating hertz
  // linearly would spend the first half of the travel between 20kHz and 10kHz,
  // where a lowpass does nothing anyone can hear, and then dump the entire
  // audible change into the last few percent.
  musicFilter?.frequency.setTargetAtTime(
    MUSIC_OPEN_HZ * Math.pow(MUSIC_MUFFLED_HZ / MUSIC_OPEN_HZ, next),
    now,
    tau,
  );
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
