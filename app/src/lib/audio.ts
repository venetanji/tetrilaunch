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
  | "reloadReady"
  | "explosion"
  | "uiClick"
  | "bombArm"
  | "uiConfirm"
  | "congestionLoop"
  | "congestionLoop2"
  | "congestionLoop3";

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
  "explosion", "uiClick", "bombArm", "uiConfirm",
  "congestionLoop", "congestionLoop2", "congestionLoop3",
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
 * So the jingle is placed by ear, under the bed. 3dB was not enough and this
 * is 6: the gap it has to cover is bigger than the LRA story alone, because
 * bayClear also carries far more of its energy where a phone speaker actually
 * works. Against the beds it interrupts it measured 5.6 dB hotter above 500Hz
 * while every file read -15.4 LUFS — see PHONE_SPREAD_DB in
 * scripts/prepare-audio.mjs, which now fails a run that lets that gap open
 * again. Half of it is fixed there, in bay-1's master; this is the other half.
 *
 * Note the masters already said as much: bayClear is 0.8 LU quieter than bay-1
 * as generated, and normalising both to one target is what threw that away.
 * Keeping this a ratio OF MUSIC_GAIN rather than a bare number is the part that
 * matters — the point of a level target is that the bed can move and the jingle
 * keeps its distance.
 */
const FX_BUS_GAIN = 0.6;
/** Set by ear on the test phone, not by meter. The master limiter below
 *  passes the bed through untouched (0.0001 dB of reduction over 20s of
 *  music) but Blink's makeup gain still lifts the routed path, so 0.75 read
 *  hotter out of the speaker than the constant suggests. STINGER_GAIN is a
 *  ratio of this, so the bay-clear jingle keeps its 6 dB gap for free. */
const MUSIC_GAIN = 0.65;
/**
 * THE MASTER LIMITER — the safety net the headroom note above assumed it did
 * not need.
 *
 * That note budgets for ONE effect over the bed: 0.84 x 0.75 = 0.63 for the
 * music, 0.71 x 0.6 = 0.43 for the effect, and it calls the resulting 1.05
 * "the worst imaginable" coincidence. It is not. Twelve lines earlier the same
 * block says a launch "fires several times a second", and playFx applies no
 * voice cap at all — every call spawns a fresh BufferSource straight into the
 * bus. Two coincident effects over the bed is 0.63 + 0.43 + 0.43 = 1.48, about
 * 3.4 dB past the 1.0 where Web Audio hard-clips, and impacts arrive in bursts
 * by design (see the 60ms floor in playImpact). Nothing sat between the sum
 * and the destination, so that overage went out as distortion.
 *
 * Reported from an Android playtest as the LEVEL MUSIC breaking up while the
 * stingers stayed clean, which is exactly the signature this predicts: the bed
 * is the only thing effects stack on top of, and stingers are unrouted <audio>
 * (see unlockAudio) that never reach this node at all. The bed is the victim
 * of the sum, not the source of it — so the fix belongs at the sum.
 *
 * Tuned as a limiter, not a compressor. Hard knee and ratio 20 mean nothing
 * happens at all until the ceiling is actually threatened, which keeps the
 * music — the foreground, per the mix note — untouched in the ordinary case.
 * The 3ms attack is fast enough for those transients without the low-frequency
 * distortion a sub-millisecond attack causes; the 250ms release is long enough
 * not to pump on burst fire.
 *
 * THRESHOLD IS -4, NOT -2, AND THE REASON IS MEASURED RATHER THAN ARITHMETIC.
 * The steady-state sum says -2 is plenty: ratio 20 puts even a 5.4 dB overage
 * at -1.7 dBFS. But DynamicsCompressorNode has NO LOOKAHEAD, so a sharp
 * transient runs open for the length of the attack before the gain reduction
 * bites, and the peak that escapes in those 3ms is not what the ratio predicts.
 * Rendered through the real graph and the real mp3s on an Android WebView
 * (Chrome 150, OnePlus CPH2573), peak at the destination, worst of three beds
 * against impact/explosion stacked 3 and 5 deep:
 *
 *   threshold -2, attack 3ms -> 1.011   STILL CLIPS
 *   threshold -3, attack 3ms -> 0.980
 *   threshold -4, attack 3ms -> 0.951
 *
 * -4 also comes back LOUDER, not quieter: Blink's compressor applies an
 * internal makeup gain that grows as the threshold drops, so the quietest bed
 * measured 0.626 at -4 against 0.549 at -2. Lowering MUSIC_GAIN does NOT
 * substitute for this — swept 0.75 down to 0.45, the 4-effect peak only moved
 * 1.030 -> 1.010, because once the limiter is engaged the output sits at its
 * ceiling and the residual overage is the transient escaping the attack, which
 * the bed level does not control.
 *
 * This bounds the SUMMED graph, which is not a licence to raise the parts. If
 * the limiter is audibly working during normal play, the mix underneath it is
 * too hot and the durable fix is still the one prepare-audio.mjs owns.
 */
const LIMITER_THRESHOLD_DB = -4;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_S = 0.003;
const LIMITER_RELEASE_S = 0.25;
const STINGER_UNDER_DB = -6;
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
 * The cue prefers a SHIPPED texture and synthesizes its old self as the
 * fallback: congestionLoop.mp3 — a designed loop, ~150 KB mono, whatever the
 * sound design wants congestion to BE (interference, clanking cargo strain) —
 * plays when its buffer has arrived, and white noise through a bandpass still
 * covers a missing file, a failed decode, or a bay that congests before the
 * effects finish loading. Whatever the texture is, it must stay CONTINUOUS:
 * discrete events with silence between them would read as more of the real
 * impact one-shots this plays under, not as a state. The noise-only form was
 * defended here as "an mp3 would have cost ~2.5 MB"; a short mono loop costs a
 * twentieth of that, which buys character Math.random cannot say.
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
/** The shipped loop at the same job. Separate from STATIC_GAIN because the two
 *  sources arrive at very different levels: raw ±1.0 noise loses most of its
 *  energy in the bandpass, while the sample is peak-normalised to -3dBFS and
 *  bypasses the filter.
 *
 *  Tuned BY EAR to 1.0, and the number is hot for a reason the peak math
 *  hides: the pipeline levels these takes by PEAK like every one-shot, but a
 *  sparse clank texture carries its body ~17dB under its peaks (measured:
 *  -21dB RMS against a -3.8dBFS peak), where a loudness-normalised bed keeps
 *  its body AT its level. 0.12 and then 0.5 both read as nothing under music
 *  for exactly that reason. At 1.0 the loop's sustained level still sits
 *  several dB under the bed's; what makes it land is that congestion is also
 *  closing the lowpass over the music, clearing out the very midrange the
 *  clanks live in.
 *
 *  Headroom: a clank peak reaches 0.71 x 1.0 x 0.6 = 0.43 at the destination,
 *  against a bed at 0.63 — a hard coincidence brushes the same ~1.05 the
 *  bus-gain note above already accepts, and only at full congestion, where
 *  the filter has already pulled the bed well off that figure. If this
 *  number keeps fighting the mix, the durable fix is in prepare-audio.mjs:
 *  level the loop takes by LOUDNESS like the beds (its own doctrine for
 *  continuous audio) and bring this back to a sane fraction. */
const STATIC_SAMPLE_GAIN = 1.0;
/** Static rises fast and falls slow. That is the right dramatic shape, and it
 *  is also free hysteresis: a cube count sitting on a threshold crosses the
 *  tier several times a second, and a symmetric ramp would stutter audibly. */
const CUE_RISE_TAU = 0.08;
const CUE_FALL_TAU = 0.35;

let ctx: AudioContext | null = null;
let fxBus: GainNode | null = null;
/** Music's last stop before the output, so congestion can close it down. */
let musicFilter: BiquadFilterNode | null = null;
/** The one node every routed source passes through on its way out. Null only
 *  if the context could not build one, in which case the buses fall back to
 *  connecting straight at the destination exactly as they used to. */
let master: DynamicsCompressorNode | null = null;
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
    // Built before the buses so both can be pointed at it. A context too old
    // to have a compressor still gets the pre-limiter graph rather than no
    // audio: `out` is simply the destination in that case.
    try {
      master = ctx.createDynamicsCompressor();
      master.threshold.value = LIMITER_THRESHOLD_DB;
      master.knee.value = LIMITER_KNEE_DB;
      master.ratio.value = LIMITER_RATIO;
      master.attack.value = LIMITER_ATTACK_S;
      master.release.value = LIMITER_RELEASE_S;
      master.connect(ctx.destination);
    } catch {
      master = null;
    }
    const out: AudioNode = master ?? ctx.destination;
    fxBus = ctx.createGain();
    fxBus.gain.value = soundOn ? FX_BUS_GAIN : 0;
    fxBus.connect(out);
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = MUSIC_OPEN_HZ;
    musicFilter.connect(out);
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

/** One blast file, two blasts. A demolition charge is the player's tool going
 *  off at full size; a volatile shipment cooking off is a hazard at well under
 *  half the radius (VOLATILE_BLAST_CELLS against BOMB_BLAST_R) — so it plays
 *  smaller, pitched up and pulled back, rather than shipping a second file to
 *  say a smaller version of the same thing. */
export function playExplosion(kind: "bomb" | "volatile"): void {
  playFx("explosion", kind === "bomb"
    ? { rate: 0.96 + Math.random() * 0.08 }
    : { rate: 1.18 + Math.random() * 0.08, gain: 0.7 });
}

/** Menu taps. Quiet on purpose — a click is confirmation, not an event — and
 *  detuned a little per press so walking a menu is not one key bouncing.
 *  `rate` shifts the whole press: toggles pitch up when they switch on and
 *  down when they switch off, which reads without looking at the pill. */
export function playUiClick(rate = 1): void {
  playFx("uiClick", { rate: rate * (0.97 + Math.random() * 0.06), gain: 0.5 });
}

/** The COMMITTING press — play, buy, undock, confirm. Same master as uiClick,
 *  different cut: the take was one tick followed by a three-tick flutter, the
 *  tick ships as the click and the flutter as this blip, so the two are
 *  tonally one family and temporally two words. Navigation says "tk",
 *  commitment says "bl-blip". */
export function playUiConfirm(): void {
  playFx("uiConfirm", { rate: 0.97 + Math.random() * 0.06, gain: 0.5 });
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

/** The static source, built on the first congested bay and then left running
 *  at zero gain for good. A BufferSource cannot be restarted, and one looping
 *  buffer is not worth the bookkeeping of tearing down and rebuilding every
 *  time a bay gets tidied.
 *
 *  Which source it is gets decided HERE, once: one of the shipped loop takes
 *  at random if any buffer has arrived (loadEffects), synthesized noise
 *  otherwise. Per SESSION rather than per bay on purpose — re-rolling each bay
 *  would mean tearing the source down and rebuilding it, which is exactly the
 *  bookkeeping this builder exists to avoid, and the random start offset below
 *  already keeps one session's cue from opening on the same clank twice. A bay
 *  that congests before the decodes land keeps the noise for the session —
 *  acceptable, because the fallback is the cue this shipped with for months,
 *  and swapping sources mid-cue would be audible as a glitch nobody asked
 *  for. */
let staticSrc: AudioBufferSourceNode | null = null;
/** Peak level for setCongestion to scale — depends on which source won. */
let staticPeak = STATIC_GAIN;
const LOOP_TAKES: FxName[] = ["congestionLoop", "congestionLoop2", "congestionLoop3"];
function ensureStatic(): void {
  if (!ctx || !fxBus || staticGain) return;
  try {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const src = ctx.createBufferSource();
    // Whichever takes have decoded by now are the pool — a partial drop (one
    // variant shipped, two pending) rotates over what exists.
    const takes = LOOP_TAKES.map((n) => buffers.get(n))
      .filter((b): b is AudioBuffer => b !== undefined);
    const sample = takes.length
      ? takes[Math.floor(Math.random() * takes.length)]
      : undefined;
    if (sample) {
      src.buffer = sample;
      src.loop = true;
      // Loop an INTERIOR region: mp3 carries encoder padding at both ends and
      // the pipeline's 30ms fade-out sits inside the last 60ms, so looping
      // edge-to-edge would put a dip and a click on every cycle. 60ms in from
      // each end the seam is texture against texture.
      const pad = Math.min(0.06, sample.duration / 8);
      src.loopStart = pad;
      src.loopEnd = sample.duration - pad;
      staticPeak = STATIC_SAMPLE_GAIN;
      // No bandpass: the sample IS the designed spectrum. Straight to gain.
      src.connect(gain).connect(fxBus);
    } else {
      // Two seconds is long enough that the loop point is inaudible in noise.
      const frames = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      src.buffer = buf;
      src.loop = true;
      // Flat white noise is a hiss. A wide bandpass through the presence range
      // is what makes it read as a signal breaking up, not a blown speaker.
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2000;
      band.Q.value = 0.6;
      staticPeak = STATIC_GAIN;
      src.connect(band).connect(gain).connect(fxBus);
    }
    // Through the EFFECTS bus rather than straight to the output: the static is
    // a game cue, so the Sound toggle should govern it and it should sit at the
    // effects level. Routing it here means both come for free.
    //
    // Started at a random offset into the loop region, so the cue does not
    // open on the same clank every session. On the noise fallback loopStart
    // and loopEnd are both 0, so the offset is 0 and nothing changes.
    src.start(0, src.loopStart + Math.random() * Math.max(0, src.loopEnd - src.loopStart));
    staticSrc = src;
    staticGain = gain;
  } catch {
    staticGain = null;
    staticSrc = null;
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
  staticGain?.gain.setTargetAtTime(staticPeak * next, now, tau);
  // A congesting bay also drags the texture's pitch up a shade, so the cue
  // reads as getting WORSE, not merely louder. Small on purpose: ±12% is a
  // timbre shift, not a note — the loop stays atonal against every bed. On the
  // noise fallback resampling is near-inaudible, which is fine.
  staticSrc?.playbackRate.setTargetAtTime(1 + 0.12 * next, now, tau);
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
