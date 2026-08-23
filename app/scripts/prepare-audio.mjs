#!/usr/bin/env node
/**
 * Turns raw generated audio in the repo-root `audio/` folder into shippable
 * assets in `app/public/audio/`.
 *
 *   npm run audio:prepare
 *
 * Source files are generated (Suno etc.) and are NOT what should ship:
 *
 *  - The generator has a 2-second minimum, so a one-shot arrives as ~200ms of
 *    sound followed by 1.6s of silence — or worse, as a rhythmic pattern of
 *    four or five hits that must not all play when a piece lands once.
 *  - They come back at or near 0 dBFS, which clips the moment music plays
 *    underneath.
 *  - They are 48kHz stereo at ~280kbps, which is absurd for a 200ms thud.
 *
 * So each effect is trimmed to its first sound, levelled, folded to mono and
 * re-encoded. Music is stripped of cover art and re-encoded down from ~190kbps.
 *
 * LEVELLING IS TWO DIFFERENT JOBS, and conflating them is what put the shipped
 * mix out of balance once already:
 *
 *  - A one-shot is levelled by PEAK. It is 200ms of transient; integrated
 *    loudness is not defined below the 400ms gate and would be meaningless
 *    anyway, because what a thud sounds like IS its peak.
 *  - A bed or a stinger is levelled by LOUDNESS (EBU R128). Peak-normalising a
 *    three-minute track says nothing about how loud it sounds: every bay bed
 *    hit -3dBFS exactly as asked and they still came out 2.3 LU apart, with
 *    bay-1 the quietest of the ten and the stingers louder than all of them.
 *
 * Both are verified against the FINISHED file at the end of every run, which is
 * the only way a level bug shows up here rather than in someone's ears.
 *
 * Everything is derived — delete app/public/audio/ and re-run. The generated
 * originals in audio/ are the source of truth and stay untouched.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const run = promisify(execFile);
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(appDir, "..", "audio");
const OUT = join(appDir, "public", "audio");

/**
 * Effects are named after the game callback that fires them (GameEvents in
 * game/game.ts), all the way from the source file to the shipped asset to the
 * playFx() call — so there is no decoding step between "what does this sound
 * do" and "where is it wired".
 *
 * A generated file therefore has to be RENAMED on the way in, which is the
 * point at which you decide what it is. Anything unrecognised is reported and
 * not shipped rather than guessed at.
 */
const FX = [
  "shoot", "impact", "lineClear", "pieceLost", "settleStart",
  "cryoShatter", "bondBreak", "bondBreak2", "reloadReady",
  // Mapped ahead of their masters on purpose: the run FAILS (mapped but not
  // present) until explosion/uiClick/bombArm land in audio/fx/, which is the
  // loud TODO this script's design asks for. In the app a missing effect is
  // silence, so the wiring ships safely ahead of the sound.
  "explosion", "uiClick", "bombArm",
];

/**
 * Stingers: 20–25s pieces that mark a moment and then play on under the screen
 * that follows. Not one-shots — trimming them to a transient would cut the
 * phrase off mid-bar — and not looping music either. Levelled and re-encoded
 * but never trimmed, and kept stereo: unlike a 200ms thud these are musical and
 * the width is the point.
 */
const STINGERS = ["bayClear", "gameOver", "gameOver2", "refit"];

/**
 * Music: which ROLE each generated master plays. Roles, not song titles — the
 * role is the shipped filename and the only name the code knows, so re-scoring
 * a bay is a line in here and nothing in src/ moves.
 *
 * `menu` is the lounge bed that plays outside a bay. The `bay-N` roles are the
 * Deep Run's arc, one song per bay; WHICH bay each one plays over is
 * game/run.ts's BAY_TRACKS, and this map only decides what it sounds like.
 * `contract-rare` is the 1-in-20 special a Contract can draw instead of the bay
 * bed it borrows — see contracts.ts's contractBed.
 */
const MUSIC = {
  "lounge-menu-pause.mp3": "menu",
  "Whale Circuit.mp3": "contract-rare",
  "chilled beginning.mp3": "bay-1",
  "2 chill.mp3": "bay-2",
  "Threes.mp3": "bay-3",
  "Level Four on the floor.mp3": "bay-4",
  "level 5.mp3": "bay-5",
  "raggae circuit.mp3": "bay-6",
  "Chipdisco.mp3": "bay-7",
  "Neon Circuit.mp3": "bay-8",
  "Neon Static.mp3": "bay-9",
  "Neon Pixel Pulse.mp3": "bay-10",
};

/** Two hits closer than this are one sound, not two — a double-tick reload
 *  must survive trimming intact. Above it, a second hit is the generator
 *  padding the 2s minimum with a pattern, and must be dropped. Tuned against
 *  the real files: reload's gap is 42ms (kept), launch's is 54ms (cut).
 *
 *  This is a heuristic over generated audio, and generations vary — it will
 *  eventually mis-trim something. That is what OVERRIDES below is for, and why
 *  every run prints the window it chose: a bad trim should be visible in the
 *  output rather than discovered by ear three builds later. */
const GAP_MERGE_S = 0.05;
const MAX_FX_S = 2.5;

/** One-shots: peak-normalised, because a transient is its peak (see header). */
const PEAK_DBFS = -3;

/** Beds and stingers: loudness-normalised to a single integrated target, so
 *  every long-form asset arrives at the mixer sounding equally loud and the
 *  RELATIVE balance is decided in one place — src/lib/audio.ts's bus gains —
 *  rather than being an accident of how hot each master was rendered.
 *
 *  -15 LUFS is the middle of what the current masters already sit at (-14.0 to
 *  -16.3), so matching them is a gain move of about a decibel either way. The
 *  true-peak ceiling is never the binding constraint at this target: measured
 *  across all twelve tracks the worst lands at -2.1 dBTP, so `linear=true`
 *  holds everywhere and nothing is compressed to hit the number. */
const LONG_LUFS = -15;
const LONG_TP_DBFS = -1.5;
const LONG_LRA = 11;
const LOUDNORM = `loudnorm=I=${LONG_LUFS}:TP=${LONG_TP_DBFS}:LRA=${LONG_LRA}`;

/** How far a finished file may sit from its target before the run complains.
 *  Wide enough to absorb the mp3 round trip — an encode at 128k lands about
 *  0.5 LU under what loudnorm predicts, consistently, because the prediction
 *  is arithmetic on the input and the check is a measurement of the output —
 *  and narrow enough to have caught the 2.7dB impact.mp3 miss on the run that
 *  shipped it. */
const FX_TOLERANCE_DB = 1.5;
const LONG_TOLERANCE_LU = 1.0;

/** And the check that actually matters. Hitting an absolute number is a means;
 *  what the player hears is the SPREAD, and a set of tracks that all missed
 *  -15 by the same half-decibel is perfectly balanced. The ten bay beds were
 *  2.3 LU apart when every one of them was hitting its peak target exactly,
 *  which is the entire reason this file no longer levels music by peak. */
const LONG_SPREAD_LU = 1.0;

/**
 * THE SPREAD THAT MATTERS ON THE DEVICE THIS SHIPS TO.
 *
 * LONG_SPREAD_LU above measures the full band, and the full band is not what a
 * phone plays. A phone speaker produces essentially nothing under a few hundred
 * hertz, while K-weighting still counts that energy — so two files can measure
 * identically and be far apart out loud. Measured on the set that passed every
 * check above, at -15.4 LUFS each:
 *
 *      bay-1     -24.6      72% of its energy is below 200Hz
 *      bay-9     -19.6      56%
 *      bayClear  -19.0      38%
 *
 * 5.6 dB between the quietest bed and the jingle that interrupts it, invisible
 * to a meter reading -15.4 for both. That is not a subtlety, it is the whole
 * complaint: the bed is inaudible and the jingle shouts.
 *
 * So the same spread check runs again through a high pass, and this one is
 * allowed to be looser — a dark track is a legitimate choice and matching every
 * bed's midrange exactly would flatten the record. 3 dB is "different, not
 * absent". A track that cannot get inside it by level alone needs MASTER_EQ.
 *
 * BEDS ONLY. Stingers are measured and printed but cannot fail this, because
 * how loud a jingle is against a bed is no longer a property of the files —
 * audio.ts plays them at STINGER_UNDER_DB below the bed on purpose. Failing a
 * run because bayClear's FILE is hotter than bay-1's would be demanding the
 * pipeline undo a decision made deliberately downstream of it.
 */
const PHONE_HP_HZ = 500;
const PHONE_HP = `highpass=f=${PHONE_HP_HZ}:poles=2,highpass=f=${PHONE_HP_HZ}:poles=2`;
const PHONE_SPREAD_DB = 3.0;

/**
 * Tonal correction applied BEFORE levelling, keyed by role name.
 *
 * This is remastering and it is deliberately per-track, not a curve over the
 * whole set: most of these masters are fine and tilting them all to rescue one
 * would trade a real problem for eleven invented ones.
 *
 * `bay-1` is the first bed anybody hears and it was the least audible thing in
 * the game. Not quiet — it hit -15.4 LUFS like everything else — but dark, and
 * a phone cannot play dark. Straight gain could not fix it either: at -2.7 dBTP
 * it had 1.2 dB of headroom against a 5 dB deficit.
 *
 * So the shelf takes out what the phone was never going to reproduce, and
 * loudnorm gives it back as level the phone CAN reproduce. The bell is small
 * and sits where a speaker that size is most efficient. On headphones this is
 * an audibly lighter track than the master, which is the real cost and the
 * reason it is one entry and not a global setting.
 *
 * THE LIMITER IS NOT OPTIONAL HERE, and finding out why is the whole story.
 * `chilled beginning.mp3` arrives at -0.6 dBTP — already brickwalled — while
 * 72% of its loudness sits under 200Hz. Cutting 7 dB of that bass moved its
 * peak by 0.4 dB, because its peaks were never the bass. So every route to
 * making it louder where a phone can hear it breaches the ceiling, and
 * loudnorm quietly answers a breach by switching from `linear` to dynamic
 * compression it chose on its own.
 *
 * Given the compression is unavoidable, it is better declared than discovered:
 * an explicit alimiter at a stated ceiling, in the chain, visible in this map,
 * doing a bounded amount of work — rather than loudnorm silently deciding how
 * much to squash a track nobody was watching. `linear` is then a real claim
 * again, and the run FAILS on anything that still reports dynamic.
 *
 * The audible cost is stated plainly: bay-1's LRA goes 3.7 -> 2.7 and it is a
 * lighter, thinner record on headphones than the master is. That is the trade
 * for it being audible at all on the device the game ships to, and it is why
 * this is two entries rather than a curve over the whole set.
 */
const MASTER_EQ = {
  "bay-1": "lowshelf=f=220:g=-9,alimiter=limit=0.55:level=disabled",
  "menu": "lowshelf=f=220:g=-5,alimiter=limit=0.55:level=disabled",
};

/**
 * Per-file escape hatches, keyed by source filename.
 *
 *   { full: true }             keep the whole file, just level and re-encode
 *   { start: 0.3, dur: 0.45 }  pin the window explicitly, in seconds
 *
 * Reach for this when the printed window for a file looks wrong. The auto
 * detection stays the default so a new drop needs no config at all.
 */
const OVERRIDES = {};

async function ffprobeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  return parseFloat(stdout.trim());
}

/** ffmpeg writes its analysis to stderr and exits non-zero on `-f null -`
 *  in some builds, so both are tolerated and the text is what matters. */
async function ffmpegAnalyse(args) {
  try {
    const { stderr } = await run("ffmpeg", args, { maxBuffer: 1 << 24 });
    return stderr;
  } catch (err) {
    return err.stderr ?? "";
  }
}

/**
 * Peak of `file` — optionally of one WINDOW of it, and after `chain`.
 *
 * The window and the chain are not refinements, they are the whole
 * measurement. An effect's level has to be set from the peak of the audio that
 * SHIPS: a 200ms slice, faded, folded to mono. Measuring the two-second
 * generated original it was cut from is how impact.mp3 shipped at -5.7dBFS
 * against a -3 target — its loudest transient was in a later hit that the trim
 * had already dropped, so the gain was computed against a peak no longer in
 * the file. Every other effect happened to keep its loudest moment, which is
 * why exactly one of the nine was wrong and it looked like a bad sample.
 */
async function maxVolumeDb(file, { start, dur, chain = [] } = {}) {
  const window = start === undefined ? [] : ["-ss", start.toFixed(4), "-t", dur.toFixed(4)];
  const out = await ffmpegAnalyse([
    "-hide_banner", "-nostats", ...window, "-i", file,
    "-af", [...chain, "volumedetect"].join(","), "-f", "null", "-",
  ]);
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
  // NaN, not 0. A reading this code could not take is not a reading of full
  // scale, and 0 is a plausible-looking number that silently levels the file
  // against something ffmpeg never said. Callers check.
  return m ? parseFloat(m[1]) : NaN;
}

/** Integrated loudness and true peak of a FINISHED file. Every encode is
 *  measured back with this: the run reports what it actually produced rather
 *  than the gain it intended to apply, which are not the same claim. */
async function measureLoudness(file) {
  const out = await ffmpegAnalyse([
    "-hide_banner", "-nostats", "-i", file,
    "-af", "ebur128=peak=true", "-f", "null", "-",
  ]);
  const tail = out.slice(out.lastIndexOf("Summary:"));
  const num = (re) => { const m = re.exec(tail); return m ? parseFloat(m[1]) : NaN; };
  return { lufs: num(/I:\s*(-?[\d.]+) LUFS/), tp: num(/Peak:\s*(-?[\d.]+) dBFS/) };
}

/** Integrated loudness of only what a phone speaker can actually move air
 *  with. Same ebur128, behind PHONE_HP — see PHONE_SPREAD_DB for why a set that
 *  is perfectly matched full-band can still be 5.6 dB apart out loud. */
async function measurePhoneBand(file) {
  const out = await ffmpegAnalyse([
    "-hide_banner", "-nostats", "-i", file,
    "-af", `${PHONE_HP},ebur128`, "-f", "null", "-",
  ]);
  const tail = out.slice(out.lastIndexOf("Summary:"));
  const m = /I:\s*(-?[\d.]+) LUFS/.exec(tail);
  return m ? parseFloat(m[1]) : NaN;
}

/** loudnorm's first pass: measure the source so the second pass can apply a
 *  single computed gain. One-pass loudnorm is a live dynamic process that
 *  cannot know what is coming and audibly rides the opening bars; two-pass
 *  with `linear=true` is just arithmetic on a constant. */
async function loudnormMeasure(file, pre) {
  const out = await ffmpegAnalyse([
    "-hide_banner", "-nostats", "-i", file,
    // The EQ has to be in front of the measurement as well as the encode. It
    // changes the loudness it is measuring — that is the entire point of it —
    // so measuring the untouched master would hand pass two a measured_I for
    // audio that no longer exists, and linear mode would apply a gain computed
    // for the wrong file.
    "-af", `${pre ? `${pre},` : ""}${LOUDNORM}:print_format=json`, "-f", "null", "-",
  ]);
  try {
    const open = out.lastIndexOf("{");
    const m = JSON.parse(out.slice(open, out.indexOf("}", open) + 1));
    // A silent or unreadable input measures as -inf and there is nothing to
    // normalise TO; fall through to the single-pass form rather than feeding
    // NaN into the filter string.
    return Number.isFinite(parseFloat(m.input_i)) ? m : null;
  } catch {
    return null;
  }
}

/** The window containing the first real sound: from where audio starts to
 *  where it stops, merging gaps below GAP_MERGE_S. */
async function firstSoundWindow(file, duration) {
  const out = await ffmpegAnalyse([
    "-hide_banner", "-nostats", "-i", file,
    "-af", "silencedetect=noise=-40dB:d=0.04", "-f", "null", "-",
  ]);
  const events = [];
  for (const m of out.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    events.push({ kind: m[1], t: parseFloat(m[2]) });
  }

  // Sound starts either at 0, or where the leading silence ends.
  let start = 0;
  let i = 0;
  if (events.length && events[0].kind === "start" && events[0].t < 0.01) {
    start = events[1]?.t ?? 0;
    i = 2;
  }

  // Walk forward: each silence_start closes the current sound; if the matching
  // silence_end comes back within GAP_MERGE_S, it was a gap inside one sound.
  let end = duration;
  for (; i < events.length; i++) {
    if (events[i].kind !== "start") continue;
    const silenceStart = events[i].t;
    const silenceEnd = events[i + 1]?.kind === "end" ? events[i + 1].t : duration;
    if (silenceEnd - silenceStart < GAP_MERGE_S) continue; // same sound
    end = silenceStart;
    break;
  }

  const preroll = Math.min(0.01, start);
  start = Math.max(0, start - preroll);
  end = Math.min(end + 0.02, start + MAX_FX_S, duration);
  return { start, dur: Math.max(0.03, end - start) };
}

/** Everything a trimmed effect goes through EXCEPT the level move. Shared by
 *  the measurement and the encode so the gain is computed against exactly the
 *  audio it will be applied to — the fold to mono in particular can drop the
 *  peak by up to 6dB when the two channels disagree. Both stages being linear,
 *  measuring here and adding the gain there is exact, not an approximation. */
function fxChain(dur) {
  const fade = Math.min(0.03, dur * 0.15);
  return [
    `afade=t=out:st=${Math.max(0, dur - fade).toFixed(4)}:d=${fade.toFixed(4)}`,
    "pan=mono|c0=0.5*c0+0.5*c1",
  ];
}

async function encodeFx(srcFile, name, override) {
  const duration = await ffprobeDuration(srcFile);
  const { start, dur } = override?.full
    ? { start: 0, dur: duration }
    : override?.dur !== undefined
      ? { start: override.start ?? 0, dur: override.dur }
      : await firstSoundWindow(srcFile, duration);
  const chain = fxChain(dur);
  const srcPeak = await maxVolumeDb(srcFile, { start, dur, chain });
  // Unmeasurable input, so there is no gain to compute. Stopping is right:
  // carrying NaN forward puts `volume=NaNdB` in the filter graph, and ffmpeg
  // is under no obligation to reject that in a way anyone would notice.
  if (!Number.isFinite(srcPeak)) {
    throw new Error(`no max_volume in ffmpeg's output for ${srcFile}`);
  }
  const gain = PEAK_DBFS - srcPeak;
  const dst = join(OUT, "fx", `${name}.mp3`);

  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", start.toFixed(4), "-t", dur.toFixed(4), "-i", srcFile, "-vn",
    "-af", [`volume=${gain.toFixed(2)}dB`, ...chain].join(","),
    "-ar", "44100", "-b:a", "128k", dst,
  ]);
  const peak = await maxVolumeDb(dst);
  return {
    name, dst, srcDur: duration, start, dur, gain, peak,
    off: peak - PEAK_DBFS,
    override: !!override,
  };
}

/**
 * Music and stingers: loudness-normalised and re-encoded, never trimmed, kept
 * stereo.
 *
 * Two-pass EBU R128 rather than the peak normalisation this used to do. Same
 * target for both folders on purpose: a stinger is not baked louder than a
 * bed, it is PLAYED louder, and the amount lives in audio.ts's STINGER_GAIN
 * where it can be tuned by ear without re-encoding anything. Bake it into the
 * files and the two halves fight — which is exactly how the jingles ended up
 * ~4.7 LU over bay-1 with nobody having chosen that number.
 */
async function encodeLong(srcFile, name, folder) {
  const dst = join(OUT, folder, `${name}.mp3`);
  const eq = MASTER_EQ[name];
  const m = await loudnormMeasure(srcFile, eq);
  const norm = m
    ? `${LOUDNORM}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
      `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
      `:offset=${m.target_offset}:linear=true`
    : LOUDNORM;
  const af = eq ? `${eq},${norm}` : norm;
  // print_format=summary on the ENCODE, because this is the only run that can
  // say how the file was actually normalised. The measurement pass reports
  // "dynamic" unconditionally — it has no measured_* values to be linear with —
  // so reading the mode off pass one is reading it off the wrong pass.
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-loglevel", "info", "-y",
    "-i", srcFile, "-vn", "-af", `${af}:print_format=summary`,
    // loudnorm runs internally at 192kHz and will happily emit it, which would
    // quadruple every bed for no audible gain. Pin the rate back down.
    "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", dst,
  ], { maxBuffer: 1 << 24 });
  const mode = /Normalization Type:\s*(\w+)/.exec(stderr)?.[1]?.toLowerCase() ?? "?";
  const { lufs, tp } = await measureLoudness(dst);
  return {
    name, dst,
    dur: await ffprobeDuration(srcFile),
    srcLufs: m ? parseFloat(m.input_i) : NaN,
    mode, lufs, tp,
    phone: await measurePhoneBand(dst),
    eq: !!eq,
    off: lufs - LONG_LUFS,
  };
}

async function main() {
  // The masters are NOT in the repo — see audio/README.md. They are the biggest
  // thing in the project by a wide margin and only needed when re-trimming, so
  // a clean checkout has app/public/audio/ (committed, shipped) but no audio/.
  // Say so plainly instead of writing an empty output directory.
  const haveSources = existsSync(SRC);
  if (!haveSources) {
    console.error(
      `✗ audio prepare: no masters at ${SRC}\n` +
      `  They are deliberately outside git — see audio/README.md for where they\n` +
      `  live. The SHIPPED assets in app/public/audio/ are committed, so builds\n` +
      `  do not need this script; only re-trimming or adding a sound does.`,
    );
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  for (const d of ["fx", "music", "stingers"]) await mkdir(join(OUT, d), { recursive: true });

  const fxFiles = new Set(await readdir(join(SRC, "fx")).catch(() => []));
  const stingerFiles = new Set(await readdir(join(SRC, "stingers")).catch(() => []));
  const missing = [
    ...FX.filter((n) => !fxFiles.has(`${n}.mp3`)).map((n) => `fx/${n}.mp3`),
    ...STINGERS.filter((n) => !stingerFiles.has(`${n}.mp3`)).map((n) => `stingers/${n}.mp3`),
  ];
  const unmapped = [
    ...[...fxFiles].filter((f) => f.endsWith(".mp3") && !FX.includes(f.replace(/\.mp3$/, "")))
      .map((f) => `fx/${f}`),
    ...[...stingerFiles].filter((f) => f.endsWith(".mp3") && !STINGERS.includes(f.replace(/\.mp3$/, "")))
      .map((f) => `stingers/${f}`),
  ];

  let total = 0;
  /** Files that finished at the wrong level. Collected rather than thrown on,
   *  so one bad effect does not hide the state of the other twenty-four. */
  const offTarget = [];
  /** Every long-form result, so the run can check how far apart they ended up
   *  as well as how far each one is from the target. */
  const longLevels = [];
  const checkLevel = (label, r) => {
    // Reject a missing reading before it is recorded, because NaN passes every
    // check below by being false in all of them: `Math.abs(NaN) > tol` is
    // false, and a single NaN turns the spread into NaN, which is also false
    // against its limit. A broken ebur128 would otherwise print a clean run
    // that verified nothing whatsoever — which is precisely the silent,
    // plays-fine-but-wrong failure this verification exists to catch.
    if (!Number.isFinite(r.lufs) || !Number.isFinite(r.tp)) {
      offTarget.push(`${label} could not be measured — no usable ebur128 reading`);
      return;
    }
    longLevels.push({ label, lufs: r.lufs, phone: r.phone, bed: label.startsWith("music/") });
    // `linear` is a promise this pipeline makes in its header, and until now
    // nothing enforced it — loudnorm falls back to dynamic compression on its
    // own whenever the gain it wants would breach the true-peak ceiling, and
    // says so only in a column nobody reads. Where compression IS needed the
    // answer is a declared alimiter in MASTER_EQ, not loudnorm improvising.
    if (r.mode !== "linear") {
      offTarget.push(
        `${label} normalised as "${r.mode}", not linear — loudnorm compressed it ` +
        `to hold ${LONG_TP_DBFS} dBTP. Give it a declared limiter in MASTER_EQ`,
      );
    }
    if (Math.abs(r.off) > LONG_TOLERANCE_LU) {
      offTarget.push(
        `${label} at ${r.lufs.toFixed(1)} LUFS — ` +
        `${r.off >= 0 ? "+" : ""}${r.off.toFixed(1)} LU off ${LONG_LUFS}`,
      );
    }
  };
  const levels = (r) =>
    `${r.srcLufs.toFixed(1)} → ${r.lufs.toFixed(1)} LUFS  ` +
    `TP ${r.tp.toFixed(1)}dB  phone ${r.phone.toFixed(1)}  ${r.mode}` +
    `${r.eq ? "  [eq]" : ""}`;

  console.log(`effects (mono, peak ${PEAK_DBFS}dBFS). CHECK THE WINDOW COLUMN — a wrong`);
  console.log("trim shows up here, and OVERRIDES in this script is the fix:");
  for (const name of FX) {
    const file = `${name}.mp3`;
    if (!fxFiles.has(file)) continue;
    const r = await encodeFx(join(SRC, "fx", file), name, OVERRIDES[file]);
    const size = (await stat(r.dst)).size;
    total += size;
    if (!Number.isFinite(r.peak)) {
      offTarget.push(`fx/${file} could not be measured — no usable peak reading`);
    } else if (Math.abs(r.off) > FX_TOLERANCE_DB) {
      offTarget.push(
        `fx/${file} at ${r.peak.toFixed(1)}dBFS — ` +
        `${r.off >= 0 ? "+" : ""}${r.off.toFixed(1)}dB off ${PEAK_DBFS}`,
      );
    }
    const window = `${r.start.toFixed(2)}–${(r.start + r.dur).toFixed(2)}s of ${r.srcDur.toFixed(2)}s`;
    console.log(
      `  ${name.padEnd(12)} ${(r.dur * 1000).toFixed(0).padStart(6)}ms  ` +
      `${String(size).padStart(7)}B  ${window.padEnd(22)}` +
      `${r.gain >= 0 ? "+" : ""}${r.gain.toFixed(1)}dB → ${r.peak.toFixed(1)}dBFS` +
      `${r.override ? "  [override]" : ""}`,
    );
  }

  console.log(`stingers (full length, stereo, ${LONG_LUFS} LUFS — never trimmed):`);
  for (const name of STINGERS) {
    const file = `${name}.mp3`;
    if (!stingerFiles.has(file)) { console.log(`  ${name.padEnd(12)} MISSING (${file})`); continue; }
    const r = await encodeLong(join(SRC, "stingers", file), name, "stingers");
    const size = (await stat(r.dst)).size;
    total += size;
    checkLevel(`stingers/${file}`, r);
    console.log(
      `  ${name.padEnd(12)} ${r.dur.toFixed(1).padStart(6)}s  ` +
      `${(size / 1024).toFixed(0).padStart(5)}KB  ${levels(r)}`,
    );
  }

  console.log(`music (${LONG_LUFS} LUFS, cover art stripped, 128k):`);
  const tracks = new Set(await readdir(join(SRC, "tracks")).catch(() => []));
  // A master dropped into tracks/ that no role claims is silently not shipped,
  // which from the outside is indistinguishable from "I added the song and
  // nothing happened". The fx/stinger folders are already checked this way.
  for (const f of tracks) {
    if (f.endsWith(".mp3") && !MUSIC[f]) unmapped.push(`tracks/${f}`);
  }
  for (const [file, name] of Object.entries(MUSIC)) {
    if (!tracks.has(file)) {
      console.log(`  ${name.padEnd(12)} MISSING (${file})`);
      missing.push(`tracks/${file}`);
      continue;
    }
    const r = await encodeLong(join(SRC, "tracks", file), name, "music");
    const size = (await stat(r.dst)).size;
    total += size;
    checkLevel(`music/${name}.mp3`, r);
    console.log(
      `  ${name.padEnd(12)} ${r.dur.toFixed(0).padStart(5)}s   ` +
      `${(size / 1048576).toFixed(2)}MB  ${levels(r)}`,
    );
  }

  console.log(`total shipped: ${(total / 1048576).toFixed(2)} MB`);
  if (unmapped.length) {
    console.log(`note: present but unmapped, so NOT shipped: ${unmapped.join(", ")}`);
    console.log("      add them to FX / STINGERS / MUSIC above, under the role they play.");
  }

  // A file at the wrong LEVEL is the other silent failure, and the one this
  // script shipped for real: the encode succeeds, the asset is the right
  // length, it plays — it is just wrong in the mix, which nothing downstream
  // can detect and no test covers. The only place it can be caught is here,
  // against the finished file, which is why every encode is measured back.
  const spread = longLevels.length
    ? Math.max(...longLevels.map((l) => l.lufs)) - Math.min(...longLevels.map((l) => l.lufs))
    : 0;
  if (longLevels.length) {
    const lo = longLevels.reduce((a, b) => (a.lufs <= b.lufs ? a : b));
    const hi = longLevels.reduce((a, b) => (a.lufs >= b.lufs ? a : b));
    console.log(
      `long-form spread: ${spread.toFixed(1)} LU ` +
      `(${lo.label} ${lo.lufs.toFixed(1)} → ${hi.label} ${hi.lufs.toFixed(1)})`,
    );
  }
  if (spread > LONG_SPREAD_LU) {
    offTarget.push(`beds and stingers are ${spread.toFixed(1)} LU apart — max ${LONG_SPREAD_LU}`);
  }

  // And again through the high pass, because the check above passed at 0.2 LU
  // on a set that was 5.6 dB apart on a phone. See PHONE_SPREAD_DB.
  if (longLevels.some((l) => !Number.isFinite(l.phone))) {
    offTarget.push("a long-form asset had no usable phone-band reading");
  }
  const beds = longLevels.filter((l) => l.bed && Number.isFinite(l.phone));
  if (beds.length) {
    const lo = beds.reduce((a, b) => (a.phone <= b.phone ? a : b));
    const hi = beds.reduce((a, b) => (a.phone >= b.phone ? a : b));
    const pSpread = hi.phone - lo.phone;
    const sting = longLevels
      .filter((l) => !l.bed && Number.isFinite(l.phone))
      .map((l) => l.phone);
    console.log(
      `phone-band spread: ${pSpread.toFixed(1)} dB above ${PHONE_HP_HZ}Hz across the beds ` +
      `(${lo.label} ${lo.phone.toFixed(1)} → ${hi.label} ${hi.phone.toFixed(1)})` +
      (sting.length
        ? `; stingers ${Math.min(...sting).toFixed(1)} to ${Math.max(...sting).toFixed(1)} ` +
          `— placed by STINGER_UNDER_DB, not checked here`
        : ""),
    );
    if (pSpread > PHONE_SPREAD_DB) {
      offTarget.push(
        `${lo.label} is ${pSpread.toFixed(1)} dB under ${hi.label} above ` +
        `${PHONE_HP_HZ}Hz — max ${PHONE_SPREAD_DB}. Both hit the LUFS target; ` +
        `the quiet one is DARK, not quiet, and MASTER_EQ is the fix`,
      );
    }
  }

  if (offTarget.length) {
    console.error("");
    console.error("✗ audio prepare: finished at the wrong level —");
    for (const line of offTarget) console.error(`    ${line}`);
    console.error("  For an effect, suspect the trim: a window that drops the loudest");
    console.error("  hit leaves the rest levelled against a peak no longer in the file,");
    console.error("  and OVERRIDES is the fix. For a bed, check the master. Do not");
    console.error("  commit this state.");
    process.exitCode = 1;
  }

  // A mapped role with no master is a FAILURE, not a note.
  //
  // This function deletes app/public/audio/ before rebuilding it, so a run with
  // the masters missing wipes every shipped asset, prints a wall of MISSING,
  // reports "total shipped: 0.00 MB" and exits 0 — which is a green build that
  // has silently unshipped the game's entire soundtrack. Caught exactly that
  // way: masters cleaned up after an earlier run, script re-run out of habit.
  // Anything mapped and absent stops the run.
  if (missing.length) {
    console.error("");
    console.error(`✗ audio prepare: mapped but not present — ${missing.join(", ")}`);
    console.error("  app/public/audio/ was rebuilt WITHOUT them. Restore the masters (see");
    console.error("  audio/README.md for where they live) and re-run, or check the assets");
    console.error("  back out of git. Do not commit this state.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`✗ audio prepare failed: ${err.message}`);
  if (err.stderr) console.error(String(err.stderr).split("\n").slice(-5).join("\n"));
  process.exit(1);
});
