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
];

/**
 * Stingers: 20–25s pieces that mark a moment and then play on under the screen
 * that follows. Not one-shots — trimming them to a transient would cut the
 * phrase off mid-bar — and not looping music either. Levelled and re-encoded
 * but never trimmed, and kept stereo: unlike a 200ms thud these are musical and
 * the width is the point.
 */
const STINGERS = ["bayClear", "gameOver", "gameOver2", "refit"];

const MUSIC = {
  "lounge-menu-pause.mp3": "menu",
  "Neon Pixel Pulse.mp3": "deep-run",
  "Neon Static.mp3": "contracts",
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
const PEAK_DBFS = -3;

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

async function maxVolumeDb(file) {
  const out = await ffmpegAnalyse([
    "-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-",
  ]);
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
  return m ? parseFloat(m[1]) : 0;
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

async function encodeFx(srcFile, name, override) {
  const duration = await ffprobeDuration(srcFile);
  const { start, dur } = override?.full
    ? { start: 0, dur: duration }
    : override?.dur !== undefined
      ? { start: override.start ?? 0, dur: override.dur }
      : await firstSoundWindow(srcFile, duration);
  const gain = PEAK_DBFS - (await maxVolumeDb(srcFile));
  const fade = Math.min(0.03, dur * 0.15);
  const dst = join(OUT, "fx", `${name}.mp3`);

  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", start.toFixed(4), "-t", dur.toFixed(4), "-i", srcFile, "-vn",
    "-af", [
      `volume=${gain.toFixed(2)}dB`,
      `afade=t=out:st=${Math.max(0, dur - fade).toFixed(4)}:d=${fade.toFixed(4)}`,
      "pan=mono|c0=0.5*c0+0.5*c1",
    ].join(","),
    "-ar", "44100", "-b:a", "128k", dst,
  ]);
  return { name, dst, srcDur: duration, start, dur, gain, override: !!override };
}

/** Music and stingers: levelled and re-encoded, never trimmed, kept stereo. */
async function encodeLong(srcFile, name, folder) {
  const dst = join(OUT, folder, `${name}.mp3`);
  const gain = PEAK_DBFS - (await maxVolumeDb(srcFile));
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", srcFile, "-vn",
    "-af", `volume=${gain.toFixed(2)}dB`,
    "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", dst,
  ]);
  return { name, dst, dur: await ffprobeDuration(srcFile), gain };
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
  console.log("effects (mono, peak -3dBFS). CHECK THE WINDOW COLUMN — a wrong");
  console.log("trim shows up here, and OVERRIDES in this script is the fix:");
  for (const name of FX) {
    const file = `${name}.mp3`;
    if (!fxFiles.has(file)) continue;
    const r = await encodeFx(join(SRC, "fx", file), name, OVERRIDES[file]);
    const size = (await stat(r.dst)).size;
    total += size;
    const window = `${r.start.toFixed(2)}–${(r.start + r.dur).toFixed(2)}s of ${r.srcDur.toFixed(2)}s`;
    console.log(
      `  ${name.padEnd(12)} ${(r.dur * 1000).toFixed(0).padStart(6)}ms  ` +
      `${String(size).padStart(7)}B  ${window.padEnd(22)}` +
      `${r.gain >= 0 ? "+" : ""}${r.gain.toFixed(1)}dB${r.override ? "  [override]" : ""}`,
    );
  }

  console.log("stingers (full length, stereo, levelled — never trimmed):");
  for (const name of STINGERS) {
    const file = `${name}.mp3`;
    if (!stingerFiles.has(file)) { console.log(`  ${name.padEnd(12)} MISSING (${file})`); continue; }
    const r = await encodeLong(join(SRC, "stingers", file), name, "stingers");
    const size = (await stat(r.dst)).size;
    total += size;
    console.log(`  ${name.padEnd(12)} ${r.dur.toFixed(1).padStart(6)}s  ${(size / 1024).toFixed(0).padStart(5)}KB`);
  }

  console.log("music (cover art stripped, 128k):");
  const tracks = new Set(await readdir(join(SRC, "tracks")).catch(() => []));
  for (const [file, name] of Object.entries(MUSIC)) {
    if (!tracks.has(file)) { console.log(`  ${name.padEnd(12)} MISSING (${file})`); continue; }
    const r = await encodeLong(join(SRC, "tracks", file), name, "music");
    const size = (await stat(r.dst)).size;
    total += size;
    console.log(`  ${name.padEnd(12)} ${r.dur.toFixed(0).padStart(5)}s   ${(size / 1048576).toFixed(2)}MB`);
  }

  console.log(`total shipped: ${(total / 1048576).toFixed(2)} MB`);
  if (missing.length) console.log(`note: mapped but not present: ${missing.join(", ")}`);
  if (unmapped.length) {
    console.log(`note: present but unmapped, so NOT shipped: ${unmapped.join(", ")}`);
    console.log("      add them to FX in this script with the callback name they belong to.");
  }
}

main().catch((err) => {
  console.error(`✗ audio prepare failed: ${err.message}`);
  if (err.stderr) console.error(String(err.stderr).split("\n").slice(-5).join("\n"));
  process.exit(1);
});
