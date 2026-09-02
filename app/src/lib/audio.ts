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
 *  - **Effects use Web Audio.** They are tiny (~120 KB for all thirteen
 *    one-shots; the congestion loop is the deliberate exception — one take of
 *    three, chosen per session, priced in SESSION_LOOP's note), they
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
 *
 * THE TWO MECHANISMS ARE NOT EQUALLY EXPOSED, and the first real-device iOS
 * pass is what made that matter. An iPhone X on iOS 16.7 in the Capacitor
 * WKWebView played every bed and every stinger and produced NO sound effect at
 * all — the whole of one mechanism, none of the other, which is the shape of a
 * dependency and not of a mix.
 *
 * Count what each path actually needs:
 *
 *   music/stinger  an <audio> element, and a play() the platform allows.
 *                  That is the entire list. Routing the element through the
 *                  graph — music for the congestion lowpass, both for the
 *                  gain-node fades iOS demands (see setLevel) — is
 *                  best-effort and FAILS OPEN: with no context, or a capture
 *                  that throws, the element goes on playing to the output by
 *                  itself, unfiltered and fading by volume where the
 *                  platform honours it.
 *
 *   effect         a constructed AudioContext, a context that actually reached
 *                  "running", a fetch that resolves under the app's own URL
 *                  scheme, and a decodeAudioData the engine accepts — thirty-
 *                  three times over, all of it during the first gesture.
 *
 * Any single break anywhere in the second list yields exactly the reported
 * symptom, and the module used to make that outcome permanent twice over: the
 * unlock latched before it had proven anything (so the one gesture iOS grants
 * was the only attempt a session ever made), and every failure in the chain was
 * swallowed without a word (so there was nothing to read afterwards). Both are
 * fixed below — see unlockAudio's latch, loadEffects's bounded retry, and warnOnce.
 *
 * What is NOT the cause, checked rather than assumed: the codec. Every shipped
 * effect and every shipped bed is MPEG-1 Layer III at 44.1kHz, 128kbps CBR
 * (effects mono, long-form stereo) — one family, and the same one the music
 * that plays is in. A container WebKit cannot decode would have to be
 * introduced by prepare-audio.mjs's `--codec`, which is pinned to LONG_EXT.
 */

import type { ContractBed } from "../game/contracts";
import type { BayTrack } from "../game/run";

const BASE = import.meta.env.BASE_URL;

/** Extension of the shipped long-form assets — music beds and stingers, the
 *  ~29MB that dominate every download. One-shot effects stay `.mp3` and are
 *  not governed by this. The value must match what scripts/prepare-audio.mjs
 *  last wrote to public/audio (its `--codec` flag decides — mp3/.mp3,
 *  aac/.m4a, opus/.ogg); the systems harness fails the run when the shipped
 *  files and this constant disagree, so a codec swap is these two moves and
 *  cannot half-happen. */
const LONG_EXT = ".mp3";

/* ------------------------------------------------------------ diagnostics */

/**
 * WHY THIS MODULE TALKS NOW.
 *
 * The no-throw promise at the top of this file was kept by swallowing every
 * failure in silence, and an empty `catch` is indistinguishable from a working
 * one. That is what turned a single iOS defect into a bug report that said only
 * "sound effects are silent": four different things can produce that sentence
 * and none of them left a trace.
 *
 * The guarantee is unchanged — nothing below throws, and a broken asset is
 * still exactly as harmless as it was. What changed is that each distinct
 * failure now says so ONCE, by asset name and by reason.
 *
 * NOT gated on import.meta.env.DEV, deliberately. The builds that reach a phone
 * are production builds (vite --mode native), so a DEV-only warning is a
 * warning that is absent from every environment where this class of bug is
 * actually found. A device tester with Safari's Web Inspector or `adb logcat`
 * attached is the exact reader this text is written for, and a player never
 * opens a console. The cost is one line per broken asset, in a session where
 * something is already broken.
 *
 * Deduped by key, because these live on the hot path: playFx runs several times
 * a second and a missing buffer would otherwise print several times a second.
 *
 * A MAP, not a Set, and the value is the message itself. The key alone was
 * enough while the only reader was a console, and a console is exactly what the
 * owner of the test phone does not have: Safari's Web Inspector needs a Mac.
 * Keeping the text costs one string per distinct failure — the map is bounded
 * by the number of things that can go wrong, not by playtime — and it is what
 * audioDiagnostics() below can put on the screen of the device that has the bug.
 */
const said = new Map<string, string>();
function warnOnce(key: string, message: string): void {
  if (said.has(key)) return;
  said.set(key, message);
  console.warn(`[audio] ${message}`);
}

/* -------------------------------------------------------------- black box */

/**
 * A FLIGHT RECORDER, BECAUSE A SNAPSHOT OF THE END IS NOT THE STORY.
 *
 * The state that explains this bug is mostly state that no longer exists by
 * the time anyone can look. A context that reached "running" and was
 * "interrupted" three seconds later reads, at rest, exactly like one that never
 * ran — and the difference between those two is the difference between a
 * gesture problem and an OS problem. The same goes for an unlock that took on
 * the fourth touch, a load pass that finished after the first shot was fired,
 * or a resume that was refused once and granted later.
 *
 * So transitions are stamped as they happen and kept. Seconds since module
 * load, one line each, oldest first.
 *
 * BOUNDED, and the bound is not decoration: armUnlockGestures re-arms on every
 * touch while the context refuses to run, so a genuinely stuck platform would
 * otherwise write a line per tap for the length of a session and push the
 * interesting early lines out of a panel that has to fit on a phone. Past the
 * cap the recorder counts what it dropped and says so, which is itself a
 * reading — "24 events and 300 dropped" is a platform thrashing, not a quiet
 * failure.
 */
const TRACE_MAX = 24;
const trace: string[] = [];
let traceDropped = 0;

/** Monotonic where the engine has one. Durations between two touches on one
 *  device is exactly what performance.now() is for, and a wall clock that
 *  steps mid-session would put the trace out of order. */
function clockMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
const traceStart = clockMs();

function note(event: string): void {
  if (trace.length >= TRACE_MAX) { traceDropped += 1; return; }
  trace.push(`${((clockMs() - traceStart) / 1000).toFixed(2)}s  ${event}`);
}

/**
 * WHAT playFx ACTUALLY DID, counted.
 *
 * The one question the console lines could never answer: was a sound ever SENT?
 * "No effects" collapses four different failures into one sentence, and only
 * this tally separates them —
 *
 *   asked 0                the game never called playFx at all (a wiring bug in
 *                          main.ts/game.ts, nothing to do with this module)
 *   gated                  soundOn false, or no context, or no fxBus
 *   missing                called, but the cue had no decoded buffer
 *   threw                  the engine refused start() on a live context
 *   sent > 0, still silent THE IMPORTANT ONE. Buffers existed, the graph
 *                          accepted them, sources ran — so the loss is
 *                          downstream of everything this module can observe.
 *
 * That last row is the whole reason the tally exists. Without it "buffers never
 * loaded" and "buffers loaded and inaudible" look identical from the outside,
 * and they point at opposite halves of the stack.
 */
const fxTally = { asked: 0, gated: 0, missing: 0, sent: 0, threw: 0 };

/**
 * THE WHOLE STATE OF THIS MODULE, AS TEXT, FOR A PHONE WITH NO INSPECTOR.
 *
 * Everything above is written for a reader with a console attached. The device
 * these reports come from belongs to someone with no Mac, so every warnOnce
 * line the previous pass added has been invisible on the one machine that
 * produces them. This is the same information delivered through the only output
 * that device definitely has: its screen. main.ts owns the gesture that shows
 * it (a knock on the Sound toggle) and the overlay it goes in; this function
 * owns what it says, because this module is the only thing that knows.
 *
 * IT IS BUILT TO BE DECISIVE, not to be complete. Each block below exists to
 * eliminate one suspect, and the suspects are what is left after the silent
 * switch was ruled out on the device (confirmed ON — ringer — through every
 * failing pass, so the hardware mute never entered into it):
 *
 *   ctx / trace   No context at all → no Web Audio, or a graph that threw.
 *                 A context that never leaves "suspended" → the gesture is not
 *                 taking. A context that reached "running" and then LEFT it was
 *                 taken away by the OS, and the trace is the only place that
 *                 fact survives — at rest it looks exactly like one that never
 *                 ran at all.
 *   rate          48000/44100 is a normal media session. 8000 or 16000 means
 *                 the OS handed this app a VOICE route, which is audible as
 *                 "thin and quiet" rather than as silence, and is not a bug in
 *                 this file.
 *   buffers       Decoded over asked-for. 0/N under a running context is the
 *                 loader; the per-asset failures below say whether it was the
 *                 fetch (an HTTP status from the native scheme handler) or the
 *                 decode (a codec the engine will not take).
 *   fx tally      Whether anything was ever SENT. See fxTally's note.
 *   gain          fxBus's own value, read off the node rather than from the
 *                 soundOn flag that is supposed to set it. A bus sitting at 0
 *                 with Sound on is a real possibility (setTargetAtTime against
 *                 a context whose clock never advanced) and it is silent in a
 *                 way that every other reading here calls healthy.
 *   verdict       The line that says which half of the stack to go and look in.
 *
 * No-throw like everything else here: a getter the engine dislikes must not
 * turn a diagnostic into a crash, so the body is wrapped and reports its own
 * failure as the snapshot.
 */
export function audioDiagnostics(): string {
  try {
    const total = FX_NAMES.length;
    const gain = fxBus ? fxBus.gain.value.toFixed(3) : "no bus";
    const lines = [
      `ctx      ${ctx ? ctx.state : "ABSENT"}${master ? "" : " (no limiter)"}`,
      `rate     ${ctx ? `${Math.round(ctx.sampleRate)} Hz` : "-"}`
        + `${ctx ? `  clock ${ctx.currentTime.toFixed(2)}s` : ""}`,
      `unlocked ${unlocked} after ${unlockTries} gesture${unlockTries === 1 ? "" : "s"}`,
      `buffers  ${buffers.size}/${total} decoded`,
      `fx       asked ${fxTally.asked}  sent ${fxTally.sent}`
        + `  gated ${fxTally.gated}  no-buffer ${fxTally.missing}  threw ${fxTally.threw}`,
      `gain     fxBus ${gain}  (sound=${soundOn} music=${musicOn})`,
      `music    ${musicName ?? "none"}${stingerName ? ` +stinger ${stingerName}` : ""}`,
      `suspend  ${lifecycle.length ? "" : "never ran"}`,
      ...lifecycle.map((e) => `  ${e}`),
      "",
      `verdict  ${fxVerdict()}`,
      "",
      `trace    ${trace.length} event${trace.length === 1 ? "" : "s"}`
        + `${traceDropped ? `, ${traceDropped} dropped` : ""}`,
    ];
    for (const event of trace) lines.push(`  ${event}`);
    // Per-asset, with the reason attached. The names matter as much as the
    // count: one failure is a bad file, all of them is the scheme handler or
    // the codec, and a handful is the concurrency this loader already bounds.
    lines.push("", `failed   ${fxFailures.size} of ${total}`);
    for (const [name, reason] of fxFailures) lines.push(`  ${name}: ${reason}`);
    lines.push("", `said     ${said.size} message${said.size === 1 ? "" : "s"}`);
    for (const message of said.values()) lines.push(`  - ${message}`);
    return lines.join("\n");
  } catch (err) {
    return `audioDiagnostics failed: ${why(err)}`;
  }
}

/**
 * ONE SENTENCE NAMING THE SUSPECT — the line a tester photographs.
 *
 * Ordered as a funnel: each branch is only reached once the one above it has
 * been cleared, so the sentence that comes out is about the FIRST thing in the
 * chain that is wrong rather than about all of them at once.
 *
 * The last branch is the one that had to be written down. If every observable
 * in this module is healthy — a running context, decoded buffers, an open bus,
 * sources that started — and the phone is still silent, then nothing above the
 * Web Audio output is at fault and the next place to look is the audio session,
 * the route, or the hardware. Saying that in the panel is the difference
 * between a tester reporting "no sound effects" for a third time and reporting
 * something that moves the diagnosis.
 */
function fxVerdict(): string {
  if (!ctx) return "no AudioContext — effects cannot play on this engine at all";
  if (ctx.state !== "running") {
    return `context is "${ctx.state}" — the gesture unlock never took`
      + `${unlockTries ? ` in ${unlockTries} tries` : ""}; effects are gated before the graph`;
  }
  if (buffers.size === 0) {
    return fxFailures.size
      ? "context runs but NO effect decoded — see the per-asset failures below"
      : "context runs and no effect has loaded yet — snapshot taken too early?";
  }
  if (!soundOn) return "Sound is switched OFF — effects are muted by the setting, not by a fault";
  if (fxBus && fxBus.gain.value <= 0.0001) {
    return "fx bus is at zero with Sound on — the bus never took the setting";
  }
  if (fxTally.asked === 0) {
    return "nothing has called playFx yet — play a bay before reading this";
  }
  if (fxTally.sent === 0) {
    return `playFx ran ${fxTally.asked} times and sent nothing`
      + ` (gated ${fxTally.gated}, no-buffer ${fxTally.missing}, threw ${fxTally.threw})`;
  }
  return `all ${buffers.size} buffers loaded, context running, ${fxTally.sent} fx sent`
    + " — IF STILL SILENT THE LOSS IS BELOW WEB AUDIO (audio session, route or hardware),"
    + " not in this module";
}

/** Whatever a rejected promise handed us, as something readable. DOMException
 *  (which is what a refused resume and a failed decode both are) carries its
 *  useful half in `name`, and a bare string is what some engines reject with. */
function why(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

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
  | "congestionLoop3"
  | "thawLance"
  | "timeLow"
  | "lastLaunch"
  | "broke"
  | "compactorStroke"
  | "crate"
  | "transactionConfirm"
  | "holdCharge"
  | "excellentClear"
  | "sealBreak"
  | "timeUp"
  | "compactorImpact"
  /** The three systems that were fitted without a voice. `incinerate` is the
   *  flue remitting part of a loss bill, `cushionAbsorb` is the liner catching
   *  a volatile landing that would otherwise have gone off, and `systemMount`
   *  is one master read two ways for the Workshop rack (see playRackMove). */
  | "incinerate"
  | "cushionAbsorb"
  | "systemMount"
  | "windLoop";

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
/** `contractClear` is the daily Contract's own celebration. It exists because
 *  the alternative was worse than silence: a cleared Contract used to play
 *  `gameOver`, i.e. the run's funeral over a banked milestone. Deliberately
 *  shorter and smaller than `bayClear` — a daily side-job is not a cleared bay
 *  of a Deep Run, and a bigger fanfare would mis-rank the two. */
export type StingerName =
  | "bayClear" | "gameOver" | "gameOver2" | "refit" | "contractClear"
  /** The clock running out. A stinger and not a one-shot for two reasons that
   *  arrived together: peak-normalising a sustained pad to a transient's target
   *  left it inaudible under the bed, and OVERTIME is a window rather than a
   *  moment — the bay settles for up to six compactor cycles after expiry, so a
   *  cue with a shape has somewhere to play. Stopping the bed is correct here
   *  and is the one place mid-bay it is: no further launch is accepted once the
   *  clock is out, and the verdict's own stinger replaces this one when it
   *  lands. */
  | "timeFinal"
  /** The bankroll's settle piece, and timeFinal's exact mirror: `broke` marks
   *  the moment the grace countdown starts, this plays under the bay while it
   *  converges, and the verdict replaces it. */
  | "brokeSettle"
  /** The tier ceremony. It used to borrow `contract-rare` — the daily Contract's
   *  1-in-20 special — for the biggest progression moment in the game, which
   *  said the wrong thing about what had just happened. */
  | "unlockFanfare";

const FX_ONE_SHOTS: FxName[] = [
  "shoot", "impact", "lineClear", "pieceLost", "settleStart",
  "cryoShatter", "bondBreak", "bondBreak2", "reloadReady",
  "explosion", "uiClick", "bombArm", "uiConfirm",
  "thawLance", "timeLow", "lastLaunch", "broke",
  "compactorStroke", "crate", "transactionConfirm", "holdCharge",
  "excellentClear", "sealBreak",
  // The clock's last word, and the one collision the bay does not otherwise
  // report.
  "timeUp", "compactorImpact",
  // The rig, out loud: the hood, the liner, and the rack the two are fitted in.
  "incinerate", "cushionAbsorb", "systemMount",
];

/** The three interchangeable takes of the congestion cue, played IN ROTATION —
 *  a different one each time a bay congests. See startStaticTake, which is the
 *  only thing in the module that reads one. */
const LOOP_TAKES: FxName[] = ["congestionLoop", "congestionLoop2", "congestionLoop3"];

/** The bay's weather. Its own name rather than a member of LOOP_TAKES: those
 *  three are ROTATED between congestion episodes, and this one is a single
 *  continuous bed whose level is a live reading. */
const WIND_LOOP: FxName = "windLoop";

const FX_NAMES: FxName[] = [...FX_ONE_SHOTS, ...LOOP_TAKES, WIND_LOOP];

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
 * (peak-normalised to -3dBFS), so at today's 0.55 and 0.45 a bed-plus-one-
 * effect coincidence peaks near 0.78 (0.46 + 0.32). The swap's first draft
 * (music 0.75, effects 0.6) put the same coincidence at 1.05 — past the
 * ceiling — which is why bringing music up meant taking effects down rather
 * than leaving them where they were; both then came down again by ear on the
 * test phone (see MUSIC_GAIN's note).
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
const FX_BUS_GAIN = 0.45;
/** Set by ear on the test phone, not by meter. The master limiter below
 *  passes the bed through untouched (0.0001 dB of reduction over 20s of
 *  music) but Blink's makeup gain still lifts the routed path, so the first
 *  draft's 0.75 read hotter out of the speaker than the constant suggested —
 *  hence 0.55. STINGER_GAIN is a ratio of this, so the bay-clear jingle
 *  keeps its 6 dB gap for free. */
const MUSIC_GAIN = 0.55;
/**
 * THE MASTER LIMITER — the safety net the headroom note above assumed it did
 * not need.
 *
 * That note budgets for ONE effect over the bed. It is not enough. A few
 * lines earlier the same block says a launch "fires several times a second",
 * and playFx applies no voice cap at all — every call spawns a fresh
 * BufferSource straight into the bus. At today's gains, two coincident
 * effects over the bed is 0.46 + 0.32 + 0.32 = 1.10, past the 1.0 where Web
 * Audio hard-clips; at the louder first-draft mix this was diagnosed under
 * (music 0.75, effects 0.6) the same burst summed to 0.63 + 0.43 + 0.43 =
 * 1.48, about 3.4 dB over — and impacts arrive in bursts by design (see the
 * 60ms floor in playImpact). Nothing sat between the sum and the
 * destination, so that overage went out as distortion.
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

/**
 * PER-STINGER TRIM, in dB on top of STINGER_GAIN. Empty means "no trim", which
 * is what every well-behaved piece gets.
 *
 * This exists because loudness normalisation does its job and the job is not
 * the whole story. Every stinger is baked to the same -15 LUFS integrated
 * (prepare-audio's LONG_LUFS) and lands within 0.4 LU of it — yet contractClear
 * was reported from play as much quieter than the others, and measurement
 * agreed with the ear rather than with the number: its LOUDEST three seconds
 * sit at -16.7 dB against refit's -14.3 and gameOver2's -13.6. Integrated
 * loudness is an average over a whole piece; "how loud is this cue" is a
 * question about its peak passage, and the two come apart whenever one piece is
 * sparser than another. bayClear (-17.1) has the same shape.
 *
 * Mastering cannot fix that without abandoning the single shared target — the
 * one number that makes the relative balance decidable in one place — and
 * re-encoding a piece hotter than its neighbours is exactly what that target
 * exists to prevent. So the correction goes where this module already says
 * taste belongs: a stinger is not BAKED louder, it is PLAYED louder, and by how
 * much is a number tunable by ear with no re-encode. STINGER_UNDER_DB is that
 * number for the whole class; this is the same idea per piece.
 *
 * Tune by ear against refit and gameOver2, which are the loudest of the set. A
 * denser take would need less of this, and none is the right answer when a
 * future master arrives with peaks like theirs.
 */
const STINGER_TRIM_DB: Partial<Record<StingerName, number>> = {
  // +5, arrived at over three passes and one wrong theory. +2 and +4 were both
  // reported as still too quiet, and at +4 the measurement said this was
  // ALREADY the loudest stinger in the game by 2.3 LU (K-weighted, over each
  // piece's own peak window). When a number and an ear disagree that hard, the
  // number is answering the wrong question — what was missing was DENSITY, not
  // level, and gain cannot add it. The compressor in prepare-audio's MASTER_EQ
  // is what fixed that; this is only the level on top of it.
  //
  // Kept slightly hot rather than exactly level, on purpose: it is the shortest
  // piece here at 11.6s and the only one that has to announce itself over a
  // result card the player is already reading.
  //
  // THE CEILING IS +6, and it is a real one rather than a round number: that is
  // STINGER_UNDER_DB exactly cancelled, i.e. this piece playing at a music
  // bed's own gain with nothing left to give. Anything asking for more than
  // that is asking for a denser master, not a bigger number.
  contractClear: 5,
};
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
 * The texture is a SHIPPED TAKE and nothing else: one of the congestionLoop
 * takes — a designed loop, 160-300 KB mono depending on which take the rotation
 * reached, whatever the sound design wants congestion to BE (interference,
 * clanking cargo strain). It must stay CONTINUOUS: discrete events with silence
 * between them would read as more of the real impact one-shots this plays
 * under, not as a state.
 *
 * IT USED TO BE WHITE NOISE THROUGH A BANDPASS, and that is gone. The synth was
 * what this cue was before the three takes existed — defended at the time as
 * "an mp3 would have cost ~2.5 MB", which a short mono loop then disproved at a
 * tenth of the price. When the takes landed the synth was kept on as a fallback
 * for a missing file or a slow decode, and that turned out to be the wrong
 * trade in play: the two are not the same cue at two qualities, they are two
 * different sounds, and the hiss was reported still audible UNDER the loops.
 * Congestion is now scored or it is not scored — a bay that congests before the
 * takes have decoded gets the lowpass closing over the bed, which is half the
 * cue and the half that never depended on a file, plus a repair pass on the
 * asset (see fxBuffer). Silence that means "this asset is missing" is worth
 * more than a texture that means nothing.
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
/** PEAK LEVEL OF THE CONGESTION TEXTURE, before the effects bus applies its
 *  own gain. There used to be a second constant beside this one — STATIC_GAIN
 *  0.21, the level of the synthesized noise — because the two sources arrived
 *  at wildly different levels: raw ±1.0 noise lost most of its energy in the
 *  bandpass, where a take is peak-normalised to -3dBFS and reaches the gain
 *  untouched. With the synth gone there is one source and one number, and
 *  setCongestion no longer has to carry a `staticPeak` variable to remember
 *  which of the two won.
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
 *  Headroom: a clank peak reaches 0.71 x 1.0 x 0.45 = 0.32 at the
 *  destination, against a bed at 0.46 — a hard coincidence brushes the same
 *  ~0.78 the bus-gain note above already accepts, and only at full
 *  congestion, where the filter has already pulled the bed well off that
 *  figure. If this
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
/** The cue's level. Null until the first congested bay — a player who never
 *  fills one never pays for the node at all. */
let staticGain: GainNode | null = null;
let congestion = 0;
const buffers = new Map<FxName, AudioBuffer>();
/** A tap on what the player is actually hearing move — the routed music path
 *  (post-lowpass, so congestion's muffling reads on it) plus the congestion
 *  static — for the HUD crest's beat (main.ts's syncHud polls musicLevel once
 *  per drawn frame). An AnalyserNode with nothing connected downstream is a
 *  pure observer: it costs one FFT-less time-domain copy per read and cannot
 *  colour the mix. Null wherever the graph is (no gesture yet, no Web Audio),
 *  and musicLevel simply reports silence there. */
let pulseTap: AnalyserNode | null = null;
let pulseData: Uint8Array<ArrayBuffer> | null = null;

let music: HTMLAudioElement | null = null;
let musicName: MusicName | null = null;
let stinger: HTMLAudioElement | null = null;
let stingerName: StingerName | null = null;
/** Whether the stinger now playing MUTED the bed rather than stopping it (see
 *  playStinger's keepBed). Read when it ends, so a piece that simply runs out
 *  hands the bay's music back instead of leaving it muted under nothing. */
let stingerKeptBed = false;
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
  // Held so the resume below can tell an actual OFF -> ON toggle from the many
  // calls that just restate the settings. See the branch for why that matters.
  const wasMusicOn = musicOn;
  musicOn = next.music;
  if (fxBus && ctx) fxBus.gain.setTargetAtTime(soundOn ? FX_BUS_GAIN : 0, ctx.currentTime, 0.01);
  if (!musicOn) {
    fadeOutAndStop(music);
    music = null;
    fadeOutAndStop(stinger);
    stinger = null;
    stingerName = null;
  } else if (!wasMusicOn && musicName) {
    // Turned back ON — and only then. playMusic() cannot resume an element, it
    // builds a new one from zero, so running this on a bed that was already
    // playing RESTARTS it. This function is called on load and again from the
    // first pointerdown (main.ts's syncAudioSettings), both of which restate
    // music: true over a menu bed that started at first render, so without the
    // wasMusicOn guard the bed audibly restarted twice every launch — once a
    // few seconds in as settings loaded, once on the first touch. Measured on
    // the device: menu.mp3 played at 60ms and again from zero at 3640ms, two
    // elements overlapping for 450ms before the first was faded out.
    const want = musicName;
    musicName = null;
    playMusic(want);
  }
}

/* ------------------------------------------------------------------ unlock */

/**
 * THE UNLOCK, AND WHY IT GETS MORE THAN ONE GO.
 *
 * Browsers start an AudioContext suspended until a user gesture, and iOS is
 * stricter still. main.ts calls this from the first pointerdown — with
 * `{ once: true }`, which is the detail that turned a stricter platform into a
 * silent one: this function used to set `unlocked = true` on its FIRST LINE,
 * before it had built a context, before resume() had resolved, before a single
 * byte had been fetched. One gesture, one attempt, and a permanent latch on the
 * outcome whatever the outcome was. On Chrome the first attempt always wins and
 * nobody ever saw the shape of it. On iOS 16.7 in a WKWebView it did not, and
 * every effect for the rest of the session was a `!ctx` early return in playFx
 * while music — which needs none of this (see the module note) — played on.
 *
 * So the latch now trips on PROOF rather than on intent: markUnlocked only
 * fires when the context reports "running", and until then this module keeps
 * its own gesture listeners armed and tries again on the next touch. main.ts's
 * once-only hook is still the first and usually the last attempt; it is simply
 * no longer the only one the session is allowed.
 *
 * Decoding happens here rather than at module load so a player who never
 * touches the screen never pays for it, and so the fetches do not compete with
 * the first paint.
 */
export function unlockAudio(): void {
  if (unlocked) return;
  buildGraph();
  if (!ctx) return;
  // INSIDE the gesture, before anything asynchronous. WebKit does not hand the
  // page a live output unit for merely constructing a context and calling
  // resume(); it wants a source to have actually run under the user's gesture,
  // and the canonical way to give it one is a single silent frame. Free on
  // every other engine, and the difference between silence and sound on this
  // one. It goes straight to the destination rather than through fxBus, which
  // the Sound toggle can be holding at zero.
  try {
    const kick = ctx.createBufferSource();
    kick.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    kick.connect(ctx.destination);
    kick.start(0);
  } catch (err) {
    warnOnce("kick", `silent-frame unlock kick failed — ${why(err)}`);
  }
  unlockTries += 1;
  // Only the first few, and the trace's cap would hold anyway: a platform that
  // keeps refusing re-arms on every touch, and a hundred identical "gesture"
  // lines would push the interesting first second out of the panel.
  if (unlockTries <= 3) note(`gesture #${unlockTries} (ctx ${ctx.state})`);
  void ctx.resume().then(markUnlocked, (err) => {
    // Not fatal and not final: the listeners below are still armed, so the
    // player's next touch tries again. Reported because a context that never
    // reaches "running" is the single most likely reason a platform has music
    // and no effects.
    note(`resume refused: ${why(err)} (ctx ${ctx?.state ?? "gone"})`);
    warnOnce("resume", `AudioContext.resume() refused — ${why(err)} (state ${ctx?.state})`);
    armUnlockGestures();
  });
  markUnlocked();
  if (!unlocked) armUnlockGestures();
  if (!fxLoadStarted) {
    fxLoadStarted = true;
    void loadEffects(FX_NAMES);
  }
}

/** How many gestures have asked for a running context. Only interesting when
 *  it climbs: one is the norm, and a handful means the platform is refusing
 *  something this module cannot see. */
let unlockTries = 0;
const UNLOCK_COMPLAINT_AT = 3;

/**
 * Trip the latch — but only against a context that says it is running.
 *
 * `state` is the only honest evidence available here. "suspended" means the
 * gesture did not take, "interrupted" is WebKit's own state for an audio
 * session the OS has taken away, and both of those used to be latched as
 * success.
 */
function markUnlocked(): void {
  if (unlocked || !ctx || ctx.state !== "running") {
    if (!unlocked && unlockTries >= UNLOCK_COMPLAINT_AT) {
      warnOnce("unlock", `AudioContext still ${ctx?.state ?? "absent"} after ${unlockTries} gestures`
        + " — effects will stay silent while music plays");
    }
    return;
  }
  unlocked = true;
  // The latch tripping is the single most useful line in the trace: WHEN it
  // happened separates "unlocked on the first touch" from "unlocked forty
  // seconds in, after the first bay was already played in silence".
  note(`UNLOCKED (gesture ${unlockTries})`);
  disarmUnlockGestures();
}

/**
 * THE RE-ARM, owned here rather than in main.ts.
 *
 * A retry needs a user gesture to run in, and the only hook main.ts offers is
 * consumed by the first touch. Rather than ask for a second hook over there,
 * this module listens for its own — capture phase and passive so it can never
 * interfere with the aim drag or the button rail, removed the moment the latch
 * trips, and never armed at all on a platform with no Web Audio to unlock.
 *
 * `touchend` is in the list for iOS specifically. WebKit's user-activation
 * window is at its most generous there, and it is the event the platform's own
 * unlock recipes have always used; `pointerdown` alone is what this shipped
 * with and what the device pass caught.
 */
const UNLOCK_EVENTS = ["pointerdown", "touchend", "click", "keydown"] as const;
let unlockArmed = false;
const onUnlockGesture = (): void => { unlockAudio(); };

function armUnlockGestures(): void {
  if (unlockArmed || unlocked || !ctx || typeof window === "undefined") return;
  unlockArmed = true;
  for (const ev of UNLOCK_EVENTS) {
    window.addEventListener(ev, onUnlockGesture, { capture: true, passive: true });
  }
}

function disarmUnlockGestures(): void {
  if (!unlockArmed) return;
  unlockArmed = false;
  for (const ev of UNLOCK_EVENTS) {
    window.removeEventListener(ev, onUnlockGesture, { capture: true });
  }
}

/** Build the graph once. Separate from unlockAudio because that function is now
 *  re-entrant: a second gesture must resume and re-latch, not rebuild the buses
 *  under the sources already connected to them. */
function buildGraph(): void {
  if (ctx) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      // The one failure with nothing to retry: no Web Audio means no effects on
      // this engine at all, ever. Said out loud rather than left as a silent
      // return, and the gesture listeners are never armed for it (armUnlockGestures
      // requires a context) so nothing sits on window for a session that cannot
      // be rescued.
      warnOnce("noctor", "no AudioContext on this engine — effects are unavailable, music will still play");
      return;
    }
    // "playback", NOT the default "interactive". The default asks for the
    // smallest buffer the device will give, which on the OnePlus test phone is
    // a HAL frame count of 192 — 4ms. That is the buffer the whole Web Audio
    // graph renders into, and it is what has to absorb every hiccup between
    // here and the speaker. On Bluetooth there are a lot of them: the same
    // device reports an A2DP write latency averaging 321ms with timestamp
    // jitter peaking over 1000ms, and 4ms of buffer cannot ride that out. The
    // result is an underrun — the bed audibly breaking up — which is NOT
    // clipping and is why lowering the gains never fixed it.
    //
    // The tell is that STINGERS stayed clean throughout. They are unrouted
    // <audio> elements (see below) that cross the same Bluetooth link, the
    // same AAC encode and the same vendor post-processing, so the wireless
    // path cannot be the cause. What they do not share is this buffer: the
    // platform media pipeline gives them hundreds of ms of it.
    //
    // "balanced", NOT "playback". baseLatency alone is a trap here: it reads
    // 21.3ms for "playback" against 20ms for "balanced", a difference of
    // nothing. But on Android "playback" asks for a DEEP BUFFER output track,
    // which changes the whole path behind the mixer, and the number that
    // reaches the player is outputLatency. Measured in-app over A2DP:
    //
    //   interactive   base  4ms   output 288ms   192 frames
    //   balanced      base 20ms   output 320ms   960 frames   <- here
    //   playback      base 21ms   output 696ms  1024 frames
    //
    // "playback" cost 408ms and was immediately audible as lag on the launch
    // and impact cues. "balanced" buys 5x the buffer for 32ms, which against
    // the 288ms Bluetooth already imposes is nothing.
    ctx = new Ctor({ latencyHint: "balanced" });
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
    try {
      // The crest's beat tap (see musicLevel). The smallest fftSize the spec
      // allows: only getByteTimeDomainData is ever read, so a bigger window
      // would just smear the envelope the crest is trying to ride.
      pulseTap = ctx.createAnalyser();
      pulseTap.fftSize = 256;
      pulseData = new Uint8Array(pulseTap.fftSize);
      musicFilter.connect(pulseTap);
    } catch {
      pulseTap = null;
      pulseData = null;
    }
    // The context can be stopped from OUTSIDE suspendAudio: a phone call, a
    // voice assistant, an alarm, a Bluetooth handoff — the OS ends the audio
    // session while the page stays visible, so the visibilitychange pair never
    // runs and `suspended` stays false. Music routes through the graph
    // (routeMusic), so a context left that way silences every bed while the
    // unrouted stingers still play — which reads as "the music got quiet", not
    // "audio died", and it stays that way for the rest of the session. Resume
    // on any stop we did not ask for; while backgrounded, suspendAudio owns
    // the state and this stays out of its way.
    //
    // It is also where a late unlock is NOTICED. resume() can resolve against a
    // context that is still suspended (WebKit grants the promise and the audio
    // session separately), so the latch cannot rely on the promise alone — this
    // is the event that says "running" for real, whenever that turns out to be.
    ctx.addEventListener("statechange", () => {
      // Recorded BEFORE the repair attempts, so the trace shows the state the
      // OS put us in rather than the state resumeStoppedContext left behind.
      note(`state -> ${ctx?.state ?? "gone"}`);
      resumeStoppedContext();
      markUnlocked();
    });
    note(`ctx built: ${ctx.state} @ ${Math.round(ctx.sampleRate)}Hz`
      + `${master ? "" : ", NO limiter"}`);
  } catch (err) {
    note(`graph failed: ${why(err)}`);
    warnOnce("graph", `could not build the Web Audio graph — ${why(err)}; effects are unavailable`);
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

/* ----------------------------------------------------------- effect assets */

/**
 * decodeAudioData, BOTH WAYS AT ONCE.
 *
 * The promise-returning form is what this shipped with and what every current
 * engine answers to. The callback form is what the older WebKits answer to —
 * the legacy webkitAudioContext returns undefined and settles only through its
 * two callbacks, so an `await` on it waits on a value that is not a promise and
 * the buffer never arrives. Passing both and taking whichever settles is one
 * wrapper, and it removes an entire "but it decoded on the desktop" from the
 * next diagnosis at no cost to the engines that do not need it.
 *
 * A rejection here is a REAL answer and is reported as one: it means the engine
 * has the bytes and will not turn them into audio, which is a codec the
 * platform does not decode. Everything shipped today is MPEG-1 Layer III at
 * 44.1kHz — the same family as the music that already plays on every device —
 * so this should not fire; if it ever does, the fix is prepare-audio.mjs's
 * `--codec` (its own note names aac as the safe cross-platform pick), not here.
 */
function decodeFx(bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const c = ctx;
    if (!c) { reject(new Error("no AudioContext")); return; }
    let ret: unknown;
    try {
      ret = c.decodeAudioData(bytes, resolve, reject);
    } catch (err) { reject(err); return; }
    if (ret && typeof (ret as Promise<AudioBuffer>).then === "function") {
      (ret as Promise<AudioBuffer>).then(resolve, reject);
    }
  });
}

/**
 * THE FETCHES ARE BOUNDED NOW, and the bound is the device lesson.
 *
 * This used to fire all thirty-three requests into one Promise.all, on the
 * first pointerdown, i.e. at the busiest moment of the app's life. On a desktop
 * that is free. On a phone the bundle is served by the native shell's own URL
 * scheme handler reading files off local storage, and thirty-three concurrent
 * reads competing with the first paint is a load nobody tested — a handler that
 * drops one under it drops it into a `!res.ok` or a rejected promise, and the
 * old loader turned both into an empty catch. Four at a time still has the
 * whole ~1.1MB set decoded well inside the menu.
 */
const FX_LOAD_CONCURRENCY = 4;

/** Names whose load did not produce a buffer, and why. Kept rather than
 *  forgotten so playFx can ask for another attempt — see repairFx. */
const fxFailures = new Map<FxName, string>();
/** Set on the first unlock, so a re-entrant unlockAudio resumes the context
 *  without re-fetching the whole set behind it. */
let fxLoadStarted = false;
let fxLoading = false;

/**
 * THE FETCH AND THE DECODE ARE RECORDED SEPARATELY.
 *
 * They used to share one `catch`, which made every failure read as `${name} —
 * ${url} failed`. Those are opposite bugs. A fetch that fails is the native
 * shell's URL scheme handler not producing the file — a packaging problem,
 * fixed in cap sync or in what got committed to public/audio. A DECODE that
 * fails is the file arriving intact and the engine refusing to turn it into
 * audio — a codec problem, fixed in prepare-audio.mjs's `--codec`. A tester
 * reading the on-screen panel has to be able to tell those apart from the
 * reason string alone, so each one now labels itself and the byte count comes
 * along with the decode failures (an HTML error page decodes as badly as a
 * broken mp3, and its length says which one arrived).
 */
async function loadEffect(name: FxName): Promise<void> {
  const url = `${BASE}audio/fx/${name}.mp3`;
  let bytes: ArrayBuffer;
  let status = 0;
  try {
    const res = await fetch(url);
    status = res.status;
    // NOT gated on res.ok, and a device made that decision: iOS 16's
    // WKWebView hands fetch() the capacitor:// scheme handler's response
    // with NO HTTP status at all — status 0, ok false — while the body
    // arrives intact. The same build's music played fine because <audio>
    // never consults a status. TestFlight 1.0.2 (11) read "32 of 32,
    // HTTP 0" off this very panel with every byte sitting on the phone.
    // So the body is the evidence and the status is only a label: read it
    // regardless, and let emptiness or the decoder say whether what came
    // back was the file. A 404's HTML error page fails the decode with its
    // byte count and status attached, which is strictly more diagnostic
    // than the old early return ever was.
    bytes = await res.arrayBuffer();
  } catch (err) {
    fxFailures.set(name, `fetch ${why(err)}`);
    warnOnce(`fx:${name}`, `${name} — ${url} failed: ${why(err)}`);
    return;
  }
  if (bytes.byteLength === 0) {
    fxFailures.set(name, `empty body (HTTP ${status})`);
    warnOnce(`fx:${name}`, `${name} — ${url} returned 0 bytes (HTTP ${status})`);
    return;
  }
  try {
    buffers.set(name, await decodeFx(bytes));
    fxFailures.delete(name);
  } catch (err) {
    fxFailures.set(name, `decode ${why(err)} (${bytes.byteLength}B, HTTP ${status})`);
    warnOnce(`fx:${name}`,
      `${name} — ${bytes.byteLength} bytes arrived and would not decode: ${why(err)}`);
  }
}

/** Load the named effects, at most FX_LOAD_CONCURRENCY at a time. Re-entrant
 *  by refusal rather than by queueing: a repair pass that arrives while the
 *  boot pass is still running has nothing to add. */
async function loadEffects(names: FxName[]): Promise<void> {
  if (fxLoading || !ctx) return;
  fxLoading = true;
  note(`fx load start (${names.length})`);
  try {
    const queue = [...names];
    const worker = async (): Promise<void> => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        await loadEffect(name);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(FX_LOAD_CONCURRENCY, queue.length) }, worker),
    );
  } finally {
    fxLoading = false;
  }
  // WHEN the set finished is as diagnostic as whether it did: a pass that lands
  // after the player has already fired ten shots explains ten silent impacts
  // with nothing wrong at rest.
  note(`fx load done: ${buffers.size}/${FX_NAMES.length}`
    + `${fxFailures.size ? `, ${fxFailures.size} failed` : ""}`);
  if (fxFailures.size) {
    // One line for the whole set, on top of the per-asset ones — this is the
    // number a device tester reads first, and "33 of 33 failed" and "1 of 33
    // failed" are completely different bugs wearing the same symptom.
    warnOnce("fxsummary",
      `${fxFailures.size} of ${FX_NAMES.length} effects failed to load: `
      + [...fxFailures.keys()].join(", "));
  }
}

/**
 * A SECOND CHANCE, taken at the moment the cue is actually wanted.
 *
 * The boot pass runs inside the first gesture, against a WebView that is also
 * painting the menu and inflating the native shell. An asset lost there used to
 * be lost for the session; here it is retried the next time the game asks for
 * it, and the cooldown keeps a genuinely-missing file (the pipeline's own
 * degrade-to-silence contract) from re-fetching on every impact.
 */
const FX_REPAIR_COOLDOWN_MS = 5000;
let lastRepairAt = -Infinity;
function repairFx(): void {
  if (!ctx || fxLoading || fxFailures.size === 0) return;
  const now = Date.now();
  if (now - lastRepairAt < FX_REPAIR_COOLDOWN_MS) return;
  lastRepairAt = now;
  void loadEffects([...fxFailures.keys()]);
}

/**
 * The one way this module reaches for a decoded effect.
 *
 * A `buffers.get` that came back empty used to be an early return and nothing
 * else — the exact silence the iOS pass could not explain. Every caller goes
 * through here instead, so a cue that cannot play says so once and asks for the
 * asset to be fetched again.
 */
function fxBuffer(name: FxName): AudioBuffer | undefined {
  const buf = buffers.get(name);
  if (buf) return buf;
  warnOnce(`silent:${name}`,
    `${name} has no decoded buffer — this cue is silent`
    + (fxFailures.has(name) ? ` (${fxFailures.get(name)})` : " (never loaded)"));
  repairFx();
  return undefined;
}

/* ----------------------------------------------------------------- effects */

/**
 * `rate` detunes by resampling — the cheapest way to stop a repeated effect
 * sounding mechanical, and how lineClear escalates with the line count without
 * needing four files.
 */
export function playFx(name: FxName, opts: { rate?: number; gain?: number } = {}): void {
  // COUNTED AT EVERY EXIT, and the counters are the point rather than a bonus:
  // "no sound effects" is four different bugs and only this tally tells them
  // apart on a device with no console. See fxTally's note.
  fxTally.asked += 1;
  if (!soundOn || !ctx || !fxBus) { fxTally.gated += 1; return; }
  const buf = fxBuffer(name);
  if (!buf) { fxTally.missing += 1; return; }
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
    fxTally.sent += 1;
  } catch (err) {
    // Was a bare `/* ignore */`. A running context that refuses start() is a
    // real and reportable state — and it is the one failure that can happen
    // AFTER everything else in the chain has already looked healthy.
    fxTally.threw += 1;
    warnOnce(`start:${name}`, `${name} — BufferSource.start() threw: ${why(err)}`);
  }
}

/**
 * THE HOLD METER, and the one effect in here that can be CUT SHORT.
 *
 * Every other one-shot is fire-and-forget because every other one-shot answers
 * something that already happened. This one answers something still happening —
 * a finger on a trigger — and the meter it voices visibly UNWINDS when the
 * finger leaves (app.css drains the fill rather than blinking it away). A rise
 * that kept playing over that would contradict the thing it exists to describe.
 *
 * So the source is held rather than dropped, and stopHoldCharge fades it out
 * over CHARGE_RELEASE_MS instead of calling stop() bare: cutting a sustained
 * rising tone at full amplitude is a click, and the click would be louder than
 * the cue. One at a time by construction — starting a second charge stops the
 * first — which is also true of the gesture.
 */
let holdChargeSrc: AudioBufferSourceNode | null = null;
let holdChargeGain: GainNode | null = null;
const CHARGE_RELEASE_MS = 70;

export function startHoldCharge(gain = 0.45): void {
  stopHoldCharge();
  if (!soundOn || !ctx || !fxBus) return;
  const buf = fxBuffer("holdCharge");
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(fxBus);
    // Self-clearing, so a charge that simply RAN OUT — the hold completed, or
    // the player held past the climax — leaves nothing behind for a later
    // stopHoldCharge to fade a dead node through.
    src.addEventListener("ended", () => {
      if (holdChargeSrc === src) { holdChargeSrc = null; holdChargeGain = null; }
    }, { once: true });
    src.start();
    holdChargeSrc = src;
    holdChargeGain = g;
  } catch {
    holdChargeSrc = null;
    holdChargeGain = null;
  }
}

export function stopHoldCharge(): void {
  const src = holdChargeSrc, g = holdChargeGain;
  holdChargeSrc = null;
  holdChargeGain = null;
  if (!src || !ctx) return;
  try {
    if (g) {
      const t = ctx.currentTime;
      // setValueAtTime first: without an anchor the ramp starts from whatever
      // the parameter's last SCHEDULED value was, not its current one.
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + CHARGE_RELEASE_MS / 1000);
      src.stop(t + CHARGE_RELEASE_MS / 1000);
    } else {
      src.stop();
    }
  } catch {
    /* already stopped */
  }
}

/**
 * THE BAY'S WEATHER — a bed whose level IS the reading, not a cue.
 *
 * Every bay rolls a steady average wind and drunk-walks around it (level.ts's
 * windMax, game.ts's windNow), and it bends every shot. Until now the only way
 * to learn it was to watch the trajectory preview move: a mechanic the player
 * is expected to aim around, communicated through one thin dotted line.
 *
 * So this is not a cue and never fires — it runs for the length of a windy bay
 * and its gain tracks |windNow| / windMax. A still bay is silent by
 * construction (level 0 holds the gain at zero), a bay at its cap is at
 * WIND_MAX_GAIN, and a gust is audible as a gust because the reading moves
 * every step.
 *
 * setTargetAtTime rather than a ramp: the level is sampled once a frame and a
 * linear ramp between samples would step audibly at 60Hz. The time constant is
 * deliberately slower than the drunk walk's own — the ear should hear WEATHER,
 * not the per-step noise the physics actually applies.
 *
 * Deliberately quiet at the top. This plays under everything for a whole bay,
 * and a wind bed that competes with the compactor is one a player turns the
 * game off over.
 *
 * 0.22 was that restraint applied to the wrong problem. The bed read as
 * inaudible in play, and the cause was not this number: the master is pure
 * rumble (22dB down above 500Hz), so a phone speaker rendered it as silence at
 * ANY gain. That is fixed where it belongs, in the pipeline -- see the eq on
 * prepare-audio.mjs's windLoop override, which moves 17dB into the audible
 * band while the file still peaks at the same -3dBFS.
 *
 * So this rose only a little, and it must not be read as the fix. The tilt
 * makes the SAME nominal gain far louder to an ear, because it moved the
 * energy from a band the equal-loudness contours discount steeply into the one
 * they do not -- perceived level is up much more than these 3dB.
 *
 * 0.3 was then reported as getting in the way of the music, and this is the
 * number that answers that -- the tilt stays, because the tilt is what makes it
 * present on a phone at all; only the level comes back down.
 */
const WIND_MAX_GAIN = 0.26;
const WIND_RAMP_S = 0.35;
let windSrc: AudioBufferSourceNode | null = null;
let windGain: GainNode | null = null;

export function setWind(level: number): void {
  const want = Math.max(0, Math.min(1, level)) * WIND_MAX_GAIN;
  if (!soundOn || !ctx || !fxBus) return;
  if (!windSrc) {
    // Nothing to start until the buffer has decoded, and nothing worth starting
    // on a bay with no wind at all — a source running permanently at zero is
    // just a voice held open for a bay that will never use it.
    if (want <= 0) return;
    const buf = fxBuffer(WIND_LOOP);
    if (!buf) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // Loop an INTERIOR region, for the reason startStatic's takes do: the
      // pipeline puts a 30ms fade-out inside the last 60ms of every effect, and
      // this is the one that runs for a whole bay. Edge-to-edge, that fade is a
      // dip to silence once per 2.6s cycle -- a 0.4Hz pulse, and precisely the
      // 'rhythm the bay does not have' the override's own comment warns about.
      // It went unheard only because the bed was inaudible; making it audible
      // makes the pulse audible too.
      const pad = Math.min(0.06, buf.duration / 8);
      src.loopStart = pad;
      src.loopEnd = buf.duration - pad;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(fxBus);
      src.start(0, src.loopStart);
      windSrc = src;
      windGain = g;
    } catch {
      windSrc = null;
      windGain = null;
      return;
    }
  }
  if (windGain && ctx) windGain.gain.setTargetAtTime(want, ctx.currentTime, WIND_RAMP_S);
}

/** Drop the bed outright — leaving a bay, not merely a lull. setWind(0) fades
 *  to silence but keeps the voice, which is right between gusts and wrong once
 *  the bay is over. */
export function stopWind(): void {
  const src = windSrc;
  windSrc = null;
  windGain = null;
  if (!src) return;
  try { src.stop(); } catch { /* already stopped */ }
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
export function playExplosion(kind: "bomb" | "volatile" | "chute"): void {
  // One sample, three readings. A bomb is the reference; a volatile pop is
  // pitched up and quieter (a hazard going off, not ordnance); the intake chute
  // is pitched DOWN and quieter still, which turns the same bang into a dull
  // crunch — a shredder swallowing cargo rather than an explosion. Rate and
  // gain rather than a fourth asset deliberately: this is a mistake being
  // acknowledged, and it should not out-announce a demolition charge.
  if (kind === "bomb") return playFx("explosion", { rate: 0.96 + Math.random() * 0.08 });
  if (kind === "volatile") {
    return playFx("explosion", { rate: 1.18 + Math.random() * 0.08, gain: 0.7 });
  }
  playFx("explosion", { rate: 0.66 + Math.random() * 0.06, gain: 0.62 });
}

/** Menu taps. Quiet on purpose — a click is confirmation, not an event — and
 *  detuned a little per press so walking a menu is not one key bouncing.
 *  `rate` shifts the whole press: toggles pitch up when they switch on and
 *  down when they switch off, which reads without looking at the pill. */
export function playUiClick(rate = 1): void {
  playFx("uiClick", { rate: rate * (0.97 + Math.random() * 0.06), gain: 0.5 });
}

/**
 * THE CLOCK, out loud. One file read at a sliding rate.
 *
 * The HUD already says this in colour — #hud-time-chip goes .pl-stat--danger
 * under LOW_TIME_WARN_MS and pulses on app.css's shared `pulse-danger`, a 1s
 * cycle — so this is that pulse offered to the ear, and `rate` is the whole of
 * the acceleration. A second "fast ticks" asset would be two files saying one
 * thing, exactly as a fourth lineClear would be.
 *
 * `urgency` is 0 at the warn threshold and 1 at zero, so the tick climbs about
 * a minor third across the last twenty seconds and comes up with it. It never
 * stacks: syncHud fires it on the beat, at most twice a second, and the shipped
 * sample is 105ms (see its OVERRIDES entry — the master is a four-per-second
 * clock and only ONE hit of it ships, precisely so this cannot overlap itself).
 */
export function playTimeTick(urgency: number, final: boolean): void {
  const u = Math.max(0, Math.min(1, urgency));
  // TWO BANDS, ONE THRESHOLD. `final` is the same FINAL_TIME_WARN_MS crossing
  // that halves the beat in syncHud, so the tick gets louder, faster and higher
  // at ONE moment rather than three — a single audible event ("this changed"),
  // not a gradual smear the player cannot date.
  //
  // The ramp alone was not enough, reported from play: at the ten-second mark a
  // linear 0.5->0.8 climb has only reached 0.65, and the bed sits on top of it
  // (fx run at FX_BUS_GAIN 0.45 UNDER music's 0.55, and nothing ducks). The
  // last ten seconds are where the cue has to cut through, so the band starts
  // where the old ramp ENDED and climbs from there.
  const gain = final ? 0.8 + 0.2 * (u - 0.5) * 2 : 0.5 + 0.3 * u;
  playFx("timeLow", { rate: 1 + 0.19 * u, gain: Math.min(1, gain) });
}

/**
 * THE PRESS LANDING — one cue per compactor cycle, and it is ANTICIPATORY.
 *
 * The bar's arrival at full advance is the beat the whole bay is played on, so
 * the sound has to peak THERE. That means starting it before the bar gets
 * there, which is why the caller owns the timing and this function does not: it
 * is fired a fixed lead ahead of the stop (main.ts's COMPACTOR_CUE_LEAD_MS,
 * measured off this sample's own envelope), so its loudest moment and the
 * bar's rightmost position are the same instant.
 *
 * It was first wired the obvious way — fire on the stop, once per HALF-stroke,
 * with the retreat pitched down — and both halves of that were wrong. Firing on
 * the stop put the whole sound AFTER the event it was announcing, and two
 * sustained hisses per cycle ran nearly continuously: reported as sounding like
 * a loop, which is exactly what it was. One cue per cycle, peaked on the press.
 *
 * Quiet in absolute terms. This is the most repeated sound in the game and
 * anything with personality at this rate becomes torture by bay 4.
 */
export function playCompactorStroke(squeeze = 1): void {
  // `squeeze` is how much of the ideal lead the caller could actually give us:
  // 1 when the stroke had room for the whole cue, above 1 when it did not and
  // the sample has to play faster to still finish on the crush. A quicker press
  // then also SOUNDS quicker and pitches up, which is the physically honest
  // reading of a machine running harder — so the compromise is a feature rather
  // than a fallback. Clamped, because past about a third faster it stops
  // sounding like the same press.
  const rate = Math.min(1.5, Math.max(1, squeeze)) * (0.98 + Math.random() * 0.04);
  playFx("compactorStroke", { rate, gain: 0.3 });
}

/** The COMMITTING press — play, buy, undock, confirm. Same master as uiClick,
 *  different cut: the take was one tick followed by a three-tick flutter, the
 *  tick ships as the click and the flutter as this blip, so the two are
 *  tonally one family and temporally two words. Navigation says "tk",
 *  commitment says "bl-blip". */
export function playUiConfirm(): void {
  playFx("uiConfirm", { rate: 0.97 + Math.random() * 0.06, gain: 0.5 });
}

/**
 * THE FLUE REMITTING A BILL — and the cue that tells a plan from a mistake.
 *
 * Cargo destroyed in the flue plays `pieceLost` and draws a "−$" toast exactly
 * like cargo spilled anywhere else, so deliberately dumping an unusable
 * shipment — the play the Incinerator is bought for — sounds identical to
 * fumbling one. This is the second voice in that frame, and it only ever fires
 * when the hood actually kept money (game.ts's onIncinerate).
 *
 * It LAYERS on the loss, so the same constraint excellentClear carries applies:
 * it has to stay clearly above `pieceLost`'s thud and clearly shorter, or the
 * two smear into one event and the player cannot hear which happened.
 *
 * `relief` is the hood's rating, 0.25 / 0.5 / 0.75 up the track. Rate and gain
 * rather than three assets, the way playExplosion reads one blast three ways: a
 * better hood is brighter and a little louder, so the upgrade is audible as an
 * upgrade. The span is small on purpose — this is the same event at three
 * grades, not three events — and 0.25 is the floor because tier 0 never gets
 * here at all.
 */
export function playIncinerate(relief: number): void {
  const r = Math.max(0, Math.min(1, relief));
  playFx("incinerate", { rate: 0.94 + 0.16 * r, gain: 0.34 + 0.16 * r });
}

/**
 * THE LINER CATCHING ONE — a non-event given a sound, which is the whole
 * problem it answers.
 *
 * An absorbed landing is a blast that did not happen: the cue for it competes
 * with nothing, because on an unlined bay this same instant would have been
 * `explosion`. It rides UNDER the ordinary `impact` of the landing that caused
 * it (both fire in the same frame), so it is quiet and detuned per hit for the
 * reason playImpact detunes — this is a frequent event in cushion play and a
 * fixed sample repeating at that rate reads as one looped noise.
 *
 * Deliberately not scaled by how close the arrival came to going off. The
 * player cannot see that number, the liner either held or it did not, and a cue
 * that varied with an invisible margin would read as inconsistent rather than
 * as informative.
 */
export function playCushionAbsorb(): void {
  playFx("cushionAbsorb", { rate: 0.96 + Math.random() * 0.08, gain: 0.42 });
}

/**
 * THE WORKSHOP RACK — one master, two directions.
 *
 * Mounting and stowing are the same gesture answered opposite ways, and the app
 * already says that with `rate`: playUiClick pitches a toggle up when it
 * switches on and down when it switches off, "which reads without looking at
 * the pill". A stow is a mount run backwards, so it is the same seating clack
 * pitched down and pulled back rather than a second asset — the doctrine the
 * prompt sheet states as "do not generate a new asset for something rate and
 * gain can say".
 *
 * Neither is a purchase. `transactionConfirm` belongs to the four handlers on
 * this screen that spend salvage; moving a system between rack and shed spends
 * nothing and is undone by tapping again, so a till here would price a decision
 * that has no price.
 */
export function playRackMove(mounted: boolean): void {
  playFx("systemMount", mounted
    ? { rate: 1, gain: 0.5 }
    : { rate: 0.82, gain: 0.42 });
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

/**
 * Set an element's audible level through whichever control actually works.
 *
 * Routed (the graph captured it): the GainNode is the level and el.volume is
 * left alone at 1 — driving both would multiply them into a squared fade on
 * every platform where volume works. Unrouted: el.volume, exactly as before,
 * which is a real control everywhere but iOS — and on iOS every element this
 * module plays is routed unless the capture itself threw.
 */
function setLevel(el: HTMLAudioElement, v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  levels.set(el, clamped);
  const gain = routedGains.get(el);
  if (gain) {
    gain.gain.value = clamped;
    return;
  }
  try {
    el.volume = clamped;
  } catch { /* element torn down mid-fade */ }
}

function fadeTo(el: HTMLAudioElement, to: number, done?: () => void): void {
  cancelFade(el);
  // From the TRACKED level, never from el.volume: iOS reads volume back as 1
  // no matter what was set, so a fade-out computed from it would restart from
  // full on every step.
  const from = levels.get(el) ?? el.volume;
  const started = Date.now();
  const timer = setInterval(() => {
    const t = Math.min(1, (Date.now() - started) / FADE_MS);
    setLevel(el, from + (to - from) * t);
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
    // …and release the element itself, which clearing the stream does not do.
    // See musicSources.
    unrouteMusic(el);
  });
}

function fadeIn(el: HTMLAudioElement, to: number): void {
  setLevel(el, 0);
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
    const el = new Audio(`${BASE}audio/music/${track}${LONG_EXT}`);
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
export function playStinger(name: StingerName, keepBed = false): void {
  if (!musicOn) return;
  // Same stinger already running: leave it alone. refit and draft are separate
  // app states, so without this, walking between them restarts a 24s piece.
  if (stinger && stingerName === name) return;
  stopStinger();
  // `keepBed` is for the one stinger that marks a REVERSIBLE state.
  //
  // Every other one answers something already decided — a bay cleared, a run
  // ended, the clock out — so stopping the bed is right and the screen after it
  // starts a new one. Going BROKE is not like that: a line clear pays more than
  // a launch costs, so the player can climb back out mid-bay, and a stopped bed
  // has nowhere to come back from. playMusic would restart it at bar one, which
  // is worse than the silence it replaces.
  //
  // So the bed is MUTED and left running: it keeps its position, and restoreBed
  // fades it back exactly where the bay would have been. Muted rather than
  // ducked, and that matters — this module's own note records that ducking to
  // 25% was tried and left "two songs in two keys audible together". At zero
  // there is no second key, only a piece that is still where you left it.
  // `music &&` because a bay entered with the bed already stopped (Sound on,
  // Music off) has nothing to mute — and nothing for restoreBed to hand back,
  // which it guards the same way.
  if (keepBed) { if (music) fadeTo(music, 0); }
  else playMusic(null);
  try {
    const el = new Audio(`${BASE}audio/stingers/${name}${LONG_EXT}`);
    el.preload = "auto";
    stinger = el;
    stingerName = name;
    stingerKeptBed = keepBed;
    // Routed past the congestion filter — see routeStinger for why stingers
    // enter the graph at all (fades and trims must survive iOS) and why not
    // through the filter (a jingle does not go muffled for the bay it ends).
    routeStinger(el);
    // Clamped at 1: the trim is a correction, not a second volume control.
    // The routed GainNode would technically take more, but a piece needing
    // over unity needs a better master, not a hotter fader.
    const gain = Math.min(1, STINGER_GAIN * 10 ** ((STINGER_TRIM_DB[name] ?? 0) / 20));
    void el.play().then(() => { if (stinger === el) fadeIn(el, gain); })
      .catch(() => { /* ignore */ });
    el.addEventListener("ended", () => {
      unrouteMusic(el);
      if (stinger !== el) return;
      stinger = null;
      stingerName = null;
      // RAN OUT WITH THE STATE STILL TRUE. brokeSettle is 9.6s and the grace it
      // plays over can run to brokeGraceMaxSteps — thirty seconds — so a player
      // who neither recovers nor loses in the first ten would otherwise sit
      // under a muted bed for the rest of it. That is the same silence the
      // keepBed path exists to prevent, one step later.
      if (stingerKeptBed) restoreBed();
      stingerKeptBed = false;
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
  // Deliberately NOT restoring the bed here. Every caller that stops a stinger
  // is on its way to deciding what should be playing instead — syncMusic starts
  // a bed or another stinger on the very next line — and handing the old one
  // back first would be an audible flicker of a track about to be replaced. The
  // one caller that DOES want it back (the broke rescue) asks for it.
  stingerKeptBed = false;
  // A suspended piece that gets STOPPED (quit from the pause card, a verdict
  // arriving under the seal notice) is gone; a later resume must not revive a
  // dead flag into a false "handled".
  stingerSuspended = false;
}

/**
 * Hand the bed back after a `keepBed` stinger — see playStinger.
 *
 * A no-op when there is no bed muted under one, which is every case but a broke
 * countdown the player rescued themselves out of. It does NOT stop the stinger:
 * the caller decides whether the piece it was playing is still true, and for a
 * rescue it is not, so main.ts stops it first.
 */
export function restoreBed(): void {
  if (music) fadeTo(music, MUSIC_GAIN);
}

/**
 * THE MID-BAY PIECES SURVIVE A PAUSE AS A PAUSE, not as a stop.
 *
 * timeFinal and brokeSettle are the two stingers that score a window the GAME
 * clock owns — overtime's cue-length floor (game.ts's OVERTIME_CUE_STEPS) and
 * the broke grace. Pausing freezes stepCount, so those windows freeze; a
 * stinger that was STOPPED there (which is what syncMusic's paused branch did
 * to every stinger) could only restart from bar one on resume, desynchronised
 * from the very floor it is the sound of — or, worse, be replaced by the bay
 * bed while the floor ran on in silence. Pausing the ELEMENT keeps its
 * position exactly as the frozen clock keeps its own, and the two come back
 * together.
 *
 * Only these two. Every other stinger answers something already decided, and a
 * pause over one of those (the seal notice over a loss card, say) is already
 * handled by the stop-and-replace idiom this module is built on. The pair of
 * functions is deliberately narrow — suspend answers "did I take this?" so the
 * caller can fall through to the ordinary stop when it did not.
 */
const MID_BAY_STINGERS: ReadonlySet<StingerName> = new Set(["timeFinal", "brokeSettle"]);
let stingerSuspended = false;

export function suspendMidBayStinger(): boolean {
  if (!stinger || !stingerName || !MID_BAY_STINGERS.has(stingerName)) return false;
  try { stinger.pause(); } catch { /* already unplayable — resume will no-op */ }
  stingerSuspended = true;
  return true;
}

export function resumeMidBayStinger(): boolean {
  if (!stingerSuspended) return false;
  stingerSuspended = false;
  if (!stinger) return false;
  void stinger.play().catch(() => { /* refused — the ended handler never fires
    on a paused element, so the piece simply stays silent; the bay's own exit
    still ends it and syncMusic replaces it there. */ });
  return true;
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
/**
 * The capture node for each routed element, so it can be let go of again.
 *
 * A MediaElementAudioSourceNode holds its element alive and stays in the graph
 * until it is disconnected — nothing about pausing the element, clearing its
 * src or dropping every other reference releases either one. playMusic builds
 * a FRESH element per track (it must: createMediaElementSource may be called
 * only once for a given element), so without this the graph gained one
 * permanently-connected source and one pinned element on every bed change:
 * the menu, ten bays, a contract, each refit — twenty-odd over a session, all
 * of them silent, all of them still mixed.
 *
 * Weak on purpose. This map is bookkeeping about elements, not ownership of
 * them; once fadeOutAndStop has unrouted an element and the module has dropped
 * it, nothing here should be the reason it stays.
 */
const musicSources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
/**
 * The level control for every ROUTED element, and the reason it exists is that
 * `HTMLMediaElement.volume` is a documented no-op on iOS — the setter is
 * ignored and reads back 1. Every fade in this module used to be a volume
 * fade, so on the one platform this app ships to first, fade-ins were
 * instant, fade-outs played at full level until the final pause(), and the
 * broke-state's "mute the bed under the stinger" muted nothing: two pieces in
 * two keys, both at full volume — the exact overlap playStinger's design
 * notes call wrong. A GainNode in the element's routed path answers to every
 * platform equally, so where the graph owns an element, the graph owns its
 * level; el.volume stays at 1 there (setting both would square the
 * attenuation everywhere volume works). The volume fade remains as the
 * fallback for an element the graph could not capture.
 */
const routedGains = new WeakMap<HTMLAudioElement, GainNode>();
/** What a fade last set, per element. Tracked here rather than read back from
 *  el.volume because on iOS that read is always 1 — a fade-out computed from
 *  it would start from full every step. */
const levels = new WeakMap<HTMLAudioElement, number>();

function routeMusic(el: HTMLAudioElement): void {
  if (!ctx || !musicFilter) return;
  // Once captured, this element is audible only while the context runs — so a
  // bed starting against a context stopped by an OS interruption must wake it,
  // or the track plays silently into a dead graph (see resumeStoppedContext).
  resumeStoppedContext();
  try {
    const node = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    node.connect(gain);
    gain.connect(musicFilter);
    musicSources.set(el, node);
    routedGains.set(el, gain);
  } catch {
    /* left playing to the output on its own — see above */
  }
}

/**
 * Stingers route too — but PAST the congestion filter, straight at the
 * master. They used to play unrouted entirely, and the "by design" half of
 * that was only ever about the filter: a bay-clear jingle has no business
 * going muffled because the bay it just cleared was congested. The unrouted
 * half was an accident that iOS exposed: an element outside the graph can
 * only fade by volume, which iOS ignores, so stinger fade-ins, fade-outs and
 * the per-piece trim were all silent no-ops there. Same fail-open contract as
 * routeMusic: no context or a refused capture leaves the element playing to
 * the output on its own.
 */
function routeStinger(el: HTMLAudioElement): void {
  if (!ctx) return;
  resumeStoppedContext();
  try {
    const node = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    node.connect(gain);
    gain.connect(master ?? ctx.destination);
    musicSources.set(el, node);
    routedGains.set(el, gain);
  } catch {
    /* left playing to the output on its own — see above */
  }
}

/** Release a routed element back out of the graph. A no-op for anything that
 *  was never routed — a capture that threw stored nothing to release. */
function unrouteMusic(el: HTMLAudioElement): void {
  const node = musicSources.get(el);
  const gain = routedGains.get(el);
  musicSources.delete(el);
  routedGains.delete(el);
  levels.delete(el);
  try { node?.disconnect(); } catch { /* graph already torn down */ }
  try { gain?.disconnect(); } catch { /* graph already torn down */ }
}

/** The running loop take. Replaced, not restarted, on every rotation — a
 *  BufferSource cannot be started twice — while the gain it plays through
 *  persists (see ensureStatic).
 *
 *  Which take it is gets decided per EPISODE: the next one in the rotation
 *  whose buffer has arrived (loadEffects). The cue is met a dozen times in a run,
 *  which is exactly the frequency at which hearing the same clank every time
 *  starts to read as one sound effect rather than as a machine under strain —
 *  so startStaticTake steps through the takes instead of holding one.
 *
 *  Rotating costs the source teardown this used to avoid, and the reason that
 *  was worth avoiding still stands: swapping mid-cue would be audible as a
 *  glitch nobody asked for. So a swap only ever happens between episodes, with
 *  the envelope proven quiet — see staticSilentAt, which is what makes the
 *  bookkeeping safe rather than merely cheap. A bay that congests before ANY
 *  take has decoded now starts nothing at all: the synthesized hiss that used
 *  to cover that case is gone (see the cue's note above), so the bed's lowpass
 *  carries the moment alone and the next episode picks up the take. */
let staticSrc: AudioBufferSourceNode | null = null;
/**
 * The persistent half of the cue's graph: one gain, built on the first
 * congested bay and kept for good.
 *
 * Split from the source because the source is now swapped every episode (see
 * startStaticTake). Keeping the envelope, the beat tap and the bus routing on
 * a node that never changes is what lets setCongestion go on addressing one
 * gain, and what keeps a rotation from having to re-derive any of it.
 */
function ensureStatic(): void {
  if (!ctx || !fxBus || staticGain) return;
  try {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // The static joins the crest's beat tap (see musicLevel): under heavy
    // congestion the lowpass has pulled the bed down to a murmur, and without
    // this the crest would fall STILL at exactly the moment the machine is
    // working hardest. Post-gain, so the tap hears the cue at the level the
    // player does.
    if (pulseTap) {
      try { gain.connect(pulseTap); } catch { /* observer only — losable */ }
    }
    // Through the EFFECTS bus rather than straight to the output: the static is
    // a game cue, so the Sound toggle should govern it and it should sit at the
    // effects level. Routing it here means both come for free.
    gain.connect(fxBus);
    staticGain = gain;
  } catch {
    staticGain = null;
  }
}

/**
 * ROTATION — which take the NEXT congestion episode opens with.
 *
 * Steps through the decoded takes in order from a random start, rather than
 * re-rolling: a die repeats itself, and a cue the player meets a dozen times
 * in a run is exactly where a repeat gets noticed. -1 means nothing has played
 * yet, so the first episode takes index 0 of a list that was already rotated
 * by the random start below.
 */
let staticTake = -1;
/** Where in LOOP_TAKES the session's rotation begins, so two launches do not
 *  open on the same take even though both then rotate in the same order. */
const takeOffset = Math.floor(Math.random() * LOOP_TAKES.length);

/**
 * When the cue last went quiet, on the context clock; -1 while it is audible.
 *
 * The rotation swaps one looping BufferSource for another, and a swap is only
 * inaudible if nothing is coming out at the time. `congestion` reaching 0 is
 * not that moment: the gain rides there on setTargetAtTime, which approaches
 * zero without arriving, so a bay that decongests and re-congests inside a
 * second would swap the source while its tail was still ringing. Four fall
 * time constants puts the tail under 2% of peak, which is silence in a mix
 * that also has music and impacts in it.
 */
let staticSilentAt = -1;

/** Retire the running loop. Stopped AND disconnected: a stopped BufferSource
 *  that is still wired stays in the graph, and this is a rotation, so it would
 *  happen again every bay. */
function stopStaticSource(): void {
  const src = staticSrc;
  staticSrc = null;
  if (!src) return;
  try { src.stop(); } catch { /* never started */ }
  try { src.disconnect(); } catch { /* already gone */ }
}

/**
 * Start the next take through the persistent gain built by ensureStatic.
 *
 * Everything specific to WHICH take is here; the envelope, the beat tap and
 * the bus routing live on the gain and survive every swap, so setCongestion
 * keeps addressing one node no matter how many sources have come and gone.
 */
function startStaticTake(): void {
  if (!ctx || !staticGain) return;
  // Whichever takes have decoded are the pool — a partial drop (one variant
  // shipped, two pending) rotates over what exists.
  const pool = LOOP_TAKES
    .map((n) => buffers.get(n))
    .filter((b): b is AudioBuffer => b !== undefined);
  if (!pool.length) {
    // Nothing to play, and nothing SUBSTITUTED for it. Checked before the
    // source is retired rather than after, so an episode that opens against a
    // momentarily empty pool leaves the take already running alone instead of
    // stopping it for a silence. The takes are ordinary effects, so this asks
    // for the same repair pass every other missing cue gets.
    warnOnce("congestion",
      `no congestion take decoded (${LOOP_TAKES.join(", ")}) — the cue is the bed's lowpass alone`);
    repairFx();
    return;
  }
  stopStaticSource();
  try {
    const src = ctx.createBufferSource();
    staticTake += 1;
    const sample = pool[(staticTake + takeOffset) % pool.length];
    src.buffer = sample;
    src.loop = true;
    // Loop an INTERIOR region: mp3 carries encoder padding at both ends and
    // the pipeline's 30ms fade-out sits inside the last 60ms, so looping
    // edge-to-edge would put a dip and a click on every cycle. 60ms in from
    // each end the seam is texture against texture.
    const pad = Math.min(0.06, sample.duration / 8);
    src.loopStart = pad;
    src.loopEnd = sample.duration - pad;
    // No filter of any kind: the take IS the designed spectrum. Straight to
    // gain — the bandpass that used to sit here belonged to the synthesized
    // noise, which is gone.
    src.connect(staticGain);
    // Started at a random offset into the loop region, so the cue does not
    // open on the same clank even when the rotation comes back around.
    src.start(0, src.loopStart + Math.random() * (src.loopEnd - src.loopStart));
    staticSrc = src;
  } catch {
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
  const wasSilent = congestion <= 0;
  congestion = next;
  if (!ctx) return;
  resumeStoppedContext();
  const now = ctx.currentTime;
  if (next > 0) {
    ensureStatic();
    // Rotate on the way IN to an episode, never during one. The first episode
    // has no source yet; a later one gets the next take only once the previous
    // one's tail has decayed out of earshot (see staticSilentAt), so a bay that
    // flickers across a tier boundary keeps playing rather than stuttering
    // between takes.
    const quietLongEnough = staticSilentAt >= 0 && now - staticSilentAt > CUE_FALL_TAU * 4;
    if (!staticSrc || (wasSilent && quietLongEnough)) startStaticTake();
    staticSilentAt = -1;
  } else if (!wasSilent) {
    staticSilentAt = now;
  }
  const tau = rising ? CUE_RISE_TAU : CUE_FALL_TAU;
  staticGain?.gain.setTargetAtTime(STATIC_SAMPLE_GAIN * next, now, tau);
  // A congesting bay also drags the texture's pitch up a shade, so the cue
  // reads as getting WORSE, not merely louder. Small on purpose: ±12% is a
  // timbre shift, not a note — the loop stays atonal against every bed.
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

/**
 * The live RMS of what the beat tap hears — the routed music (after the
 * congestion lowpass, so a muffled bed reads as the quieter thing it is) plus
 * the congestion static. Raw and unsmoothed on purpose: the one consumer
 * (main.ts's crest beat) runs its own envelope follower with the attack/release
 * shape IT wants, and any smoothing baked in here would just stack with it.
 *
 * The 0..~0.3 range this actually produces is normalised by the caller
 * against its own running peak rather than scaled here — a fixed scale would
 * make a quiet bed's crest permanently lazy and a loud one's permanently
 * pinned, which is the difference between "reactive to the music" and
 * "reactive to the mastering".
 *
 * Free of side effects and safe everywhere: before the first gesture, with
 * Web Audio missing, or with music off it reports 0.
 */
/**
 * Whether the beat tap currently has a soundtrack to read.
 *
 * musicLevel() reports 0 for two different worlds, and the crest treats them as
 * opposites. A quiet PASSAGE is a thing to cool down for — that is the whole
 * point of the heat drive. But "no bed at all" is not a reading of the
 * soundtrack in the first place, and the ring has to rest at its warm default
 * rather than decay to dead cold. This is the predicate that separates them:
 * a tap to listen with (Web Audio present, first gesture done), music enabled,
 * and a bed or stinger actually mounted.
 *
 * The congestion static is deliberately NOT consulted. It joins the tap to keep
 * the crest alive when the lowpass has pulled the bed down to a murmur, so it
 * matters to the LEVEL — but its source node is never cleared once started, so
 * it says nothing about liveness, and every case where it is audible has a bed
 * mounted anyway.
 *
 * Only a consumer that distinguishes the two worlds needs this; the beat and
 * the band crawl want 0 either way.
 */
export function musicTapLive(): boolean {
  return !!pulseTap && !!pulseData && musicOn && (!!music || !!stinger);
}

export function musicLevel(): number {
  if (!pulseTap || !pulseData) return 0;
  pulseTap.getByteTimeDomainData(pulseData);
  let sum = 0;
  for (let i = 0; i < pulseData.length; i++) {
    const v = (pulseData[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / pulseData.length);
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
/**
 * The lock screen's play button answers to THIS module, not to WebKit.
 *
 * On iOS, WKWebView promotes a playing <audio> element into a system media
 * session — the app appears in Control Center and on the lock screen with
 * transport controls, as if it were a music player (observed on the iPhone X:
 * "Tetrilaunch" with a play button while the app was suspended). Left alone,
 * that play button goes straight to WebKit's element resume: music starts
 * over a backgrounded game, and none of this module's state — `suspended`
 * above all — is consulted. Registering our own MediaSession handlers puts
 * this module back in the loop: play while suspended is refused (the app is
 * not being looked at; resumeAudio on foreground is the sanctioned way back),
 * play in the foreground resumes what was current, pause pauses it.
 *
 * The CARD was the .playback session category's doing, and AppDelegate.swift
 * has since traded that category for .ambient precisely to stop registering
 * it — so on current builds no card should appear at all. These handlers
 * stay: they cost nothing, they are the only defence if a future category
 * change (or a WebKit behaviour shift) brings the card back, and on any
 * platform that surfaces media keys they keep the resume path answering to
 * this module's state instead of WebKit's. Best-effort on purpose: engines
 * without MediaSession, or with partial action support, throw on
 * registration and lose nothing but the guard they don't need.
 */
(() => {
  const ms = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
  if (!ms) return;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => {
      if (suspended || !musicOn) return;
      const m = music;
      if (m) void m.play().catch(() => { /* ignore */ });
      const s = stinger;
      if (s) void s.play().catch(() => { /* ignore */ });
    }],
    ["pause", () => {
      try { music?.pause(); } catch { /* ignore */ }
      try { stinger?.pause(); } catch { /* ignore */ }
    }],
  ];
  for (const [action, handler] of handlers) {
    try { ms.setActionHandler(action, handler); } catch { /* unsupported action */ }
  }
})();

/** What suspendAudio stripped off each element so resumeAudio can rebuild it:
 *  [src, position, whether it was actually playing]. Keyed by element because
 *  music/stinger can be swapped while the app is hidden — an element replaced
 *  mid-suspension keeps its parked entry but is simply never unparked. */
const parked = new Map<HTMLAudioElement, [string, number]>();

/** The suspend/resume history, for the diagnostics panel. Build 16 proved a
 *  fix can be RIGHT and still not RUN: the element parking kills the
 *  lock-screen card wherever it executes, but a plain screen lock froze the
 *  page before the relayed resign event was delivered, so the card survived
 *  and nothing said why. Each entry records when, which trigger (visibility
 *  or the native relay), and what actually got parked — so the next photo
 *  distinguishes "the path never ran" from "the path ran and iOS kept the
 *  card anyway". Capped; oldest out. */
const lifecycle: string[] = [];
function logLifecycle(entry: string): void {
  lifecycle.push(`${(performance.now() / 1000).toFixed(1)}s ${entry}`);
  if (lifecycle.length > 10) lifecycle.shift();
}

/** Unload one element's media entirely — pause is NOT enough on iOS.
 *
 *  A paused <audio> still owns a WebKit-managed media session, and iOS offers
 *  it on the lock screen as a resumable Now Playing card — observed on the
 *  iPhone X surviving even the AppDelegate's move to the .ambient category,
 *  because WKWebView manages its own session for media elements (iOS 15+)
 *  without consulting the host app's. An element with NO source has no media
 *  session at all, so the card has nothing to describe: src comes off and
 *  load() commits the removal. resumeAudio rebuilds src/position from the
 *  parked entry, so the player hears a seamless resume. */
function parkElement(el: HTMLAudioElement | null): number {
  if (!el) return 0;
  try {
    const src = el.currentSrc || el.src;
    if (!src) return 0;
    parked.set(el, [src, el.currentTime]);
    el.pause();
    el.removeAttribute("src");
    el.load();
    return 1;
  } catch { /* ignore — worst case the element stays paused, as before */ }
  return 0;
}

function unparkElement(el: HTMLAudioElement | null): void {
  if (!el) return;
  const p = parked.get(el);
  parked.delete(el);
  if (!p) return;
  const [src, at] = p;
  try {
    el.src = src;
    el.load();
    // The position can only be applied once metadata exists; setting it
    // against an empty element is silently dropped by some engines.
    el.addEventListener(
      "loadedmetadata",
      () => { try { el.currentTime = at; } catch { /* ignore */ } },
      { once: true },
    );
    // No play() here — resumeAudio owns that decision, unconditionally for
    // the current elements, because on a plain lock nothing gets parked at
    // all (the page freezes first) and a play gated on parked state left
    // the beds silent until the next track swap.
  } catch { /* ignore */ }
}

export function suspendAudio(source = "visibility"): void {
  if (suspended) { logLifecycle(`suspend(${source}) — already suspended`); return; }
  suspended = true;
  const n = parkElement(music) + parkElement(stinger);
  logLifecycle(`suspend(${source}) parked ${n}`);
  // Belt and braces on the lock-screen card: an emptied media session should
  // already say nothing, and this makes the say-nothing explicit for engines
  // that report the last-known state instead.
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch { /* no MediaSession — nothing to clear */ }
  void ctx?.suspend().catch(() => { /* ignore */ });
}

export function resumeAudio(source = "visibility"): void {
  if (!suspended) { logLifecycle(`resume(${source}) — not suspended`); return; }
  suspended = false;
  logLifecycle(`resume(${source}) unparking ${parked.size}`);
  void ctx?.resume().catch(() => { /* ignore */ });
  // Only the elements still current are rebuilt — one replaced while hidden is
  // already being faded out and must stay down (its parked entry just ages
  // out of the map with it).
  unparkElement(music);
  unparkElement(stinger);
  if (!musicOn) return;
  // ...and the CURRENT elements are played unconditionally, parked or not.
  // This line predates the parking and came back by owner report: on a plain
  // lock the page freezes before any suspend JS runs, so nothing is parked —
  // the beds were paused NATIVELY (AppDelegate's setAllMediaPlaybackSuspended)
  // — and a resume that only unparks leaves them silent until the next track
  // swap (build 17 on hardware). An element replaced while hidden is not
  // `music` any more, so this cannot wake one that is meant to stay down.
  const m = music;
  if (m) void m.play().catch(() => { /* ignore */ });
  const s = stinger;
  if (s) void s.play().catch(() => { /* ignore */ });
}
