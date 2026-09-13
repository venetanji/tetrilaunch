#!/usr/bin/env npx tsx
/**
 * ASSEMBLE — the captured beats into the two cuts timeline.json describes.
 *
 *   npx tsx sim/promo/assemble.ts [--out=<dir>] [--cut=promo|materials|all]
 *                                 [--font=<file>] [--ffmpeg=<path>] [--run]
 *                                 [--vertical]
 *
 * Reads sim/promo/timeline.json and every <out>/<beat>/beat.json run.ts
 * wrote, and emits the ffmpeg command lines that:
 *
 *   1. cut each beat's PNG sequence to its target length (from the end when
 *      the timeline says `align: end`, since the beats are captured with a
 *      lead-in that finishes on their event) and burn its card in Orbitron
 *      over a black wash;
 *   2. concatenate the clips in timeline order;
 *   3. lay the music bed under each beat and drop the stingers on the frames
 *      beat.json's `notable` map names, mixed to one track;
 *   4. mux to <out>/<output> as H.264 + AAC;
 *   5. (--vertical) centre-crop the finished cut to 9:16.
 *
 * DRY-RUN BY DEFAULT. The commands are written to <out>/mux.sh and printed;
 * --run executes them. The reason is the ffmpeg on the capture box: the
 * one Playwright bundles carries libvpx and png and nothing else — no x264,
 * no aac, no drawtext, no concat — so the assembly is a script that runs
 * wherever a full ffmpeg exists (`brew install ffmpeg`, `apt install ffmpeg`),
 * and this file's own check of the filters and encoders that ffmpeg reports
 * is what --run gates on.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opt = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const OUT = resolve(opt("out") ?? resolve(HERE, "..", "results", "promo"));
const CUT = opt("cut") ?? "all";
const RUN = flag("run");
const VERTICAL = flag("vertical");

interface Stinger { on: string; file: string; gain?: number }
interface Item {
  kind?: "title";
  beat?: string;
  sec: number;
  card: string;
  music?: string;
  align?: "start" | "end";
  stingers?: Stinger[];
}
interface Timeline {
  fps: number;
  size: string;
  font: { family: string; file: string };
  card: { sizePx: number; color: string; wash: string; washPad: number; inSec: number; holdSec: number; outSec: number };
  stingerFiles: Record<string, string>;
  cuts: Record<string, { output: string; targetSec: number; order: Item[] }>;
  vertical: { cropW: number; cropXOffset: number; output: string };
}
interface BeatJson {
  frames: number;
  fps: number;
  phases: Array<{ index: number; kind: string; startFrame: number; endFrame: number }>;
  notable: Record<string, number[]>;
}

const timeline = JSON.parse(readFileSync(resolve(HERE, "timeline.json"), "utf8")) as Timeline;
const FPS = timeline.fps;
const [W, H] = timeline.size.split("x").map(Number);
const FONT = resolve(APP, opt("font") ?? timeline.font.file);

function findFfmpeg(): string | null {
  if (opt("ffmpeg")) return opt("ffmpeg");
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = resolve(dir, "ffmpeg");
    if (dir && existsSync(p)) return p;
  }
  return null;
}
const FFMPEG = findFfmpeg();

/** What this ffmpeg can do, from its own -filters / -encoders output. */
function capabilities(ff: string): { filters: Set<string>; encoders: Set<string> } {
  const list = (kind: string): Set<string> => {
    try {
      const out = execFileSync(ff, ["-hide_banner", `-${kind}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return new Set(out.split("\n").map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
    } catch { return new Set(); }
  };
  return { filters: list("filters"), encoders: list("encoders") };
}
const NEEDED_FILTERS = ["drawtext", "concat", "amix", "adelay", "fade", "afade", "atrim", "crop", "scale", "format"];
const NEEDED_ENCODERS = ["libx264", "aac"];

/** Shell-quote one argument. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
/** drawtext wants its own escaping on top: \ : ' % and commas inside the filter graph. */
const dt = (s: string): string => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\\\\\'").replace(/%/g, "%%").replace(/,/g, "\\,");

function cardFilter(text: string, startSec: number): string {
  if (!text) return "";
  const c = timeline.card;
  const t0 = startSec;
  const t1 = t0 + c.inSec;
  const t2 = t1 + c.holdSec;
  const t3 = t2 + c.outSec;
  const alpha = `if(lt(t,${t0}),0,if(lt(t,${t1}),(t-${t0})/${c.inSec},if(lt(t,${t2}),1,if(lt(t,${t3}),1-(t-${t2})/${c.outSec},0))))`;
  return `drawtext=fontfile=${dt(FONT)}:text=${dt(text)}:fontsize=${c.sizePx}:fontcolor=${c.color}` +
    `:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=${c.wash}:boxborderw=${c.washPad}` +
    `:alpha='${alpha}':enable='between(t,${t0},${t3})'`;
}

interface Clip { file: string; sec: number; item: Item; beat: BeatJson | null; startFrame: number }

function readBeat(id: string): BeatJson | null {
  const p = resolve(OUT, id, "beat.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as BeatJson;
}

function buildCut(name: string, cut: Timeline["cuts"][string]): { cmds: string[]; missing: string[] } {
  const cmds: string[] = [];
  const missing: string[] = [];
  const clips: Clip[] = [];
  const work = resolve(OUT, "work", name);
  cmds.push(`mkdir -p ${q(work)}`);

  cut.order.forEach((item, i) => {
    const frames = Math.round(item.sec * FPS);
    const clipFile = resolve(work, `${String(i).padStart(2, "0")}-${item.beat ?? "title"}.mp4`);
    if (item.kind === "title") {
      // A black card with the title text, faded in and out over the whole item.
      const vf = [
        `color=c=black:s=${W}x${H}:r=${FPS}:d=${item.sec}`,
        cardFilter(item.card, 0.2),
        `format=yuv420p`,
      ].filter(Boolean).join(",");
      cmds.push(`${q(FFMPEG ?? "ffmpeg")} -y -f lavfi -i ${q(vf)} -c:v libx264 -preset medium -crf 18 -r ${FPS} ${q(clipFile)}`);
      clips.push({ file: clipFile, sec: item.sec, item, beat: null, startFrame: 0 });
      return;
    }
    const beat = readBeat(item.beat!);
    if (!beat) { missing.push(item.beat!); return; }
    const framesDir = resolve(OUT, item.beat!, "frames");
    // Which frames: the last N when aligned to the end, the first N otherwise.
    const available = beat.frames;
    const take = Math.min(frames, available);
    const startFrame = item.align === "end" ? available - take : 0;
    if (take < frames) missing.push(`${item.beat}: only ${(available / FPS).toFixed(1)}s captured for a ${item.sec}s slot`);
    const vf = [cardFilter(item.card, 0.15), "format=yuv420p"].filter(Boolean).join(",");
    cmds.push(
      `${q(FFMPEG ?? "ffmpeg")} -y -framerate ${FPS} -start_number ${startFrame} -i ${q(resolve(framesDir, "%06d.png"))} ` +
      `-frames:v ${take} -vf ${q(vf)} -c:v libx264 -preset medium -crf 18 -r ${FPS} ${q(clipFile)}`,
    );
    clips.push({ file: clipFile, sec: take / FPS, item, beat, startFrame });
  });

  // Video concat through the demuxer: every clip is the same size, fps and
  // codec, so a stream copy is exact and cheap.
  const listFile = resolve(work, "concat.txt");
  cmds.push(`printf '%s\\n' ${clips.map((c) => q(`file '${c.file}'`)).join(" ")} > ${q(listFile)}`);
  const videoFile = resolve(work, "video.mp4");
  cmds.push(`${q(FFMPEG ?? "ffmpeg")} -y -f concat -safe 0 -i ${q(listFile)} -c copy ${q(videoFile)}`);

  // Audio: one bed per clip, trimmed to the clip and delayed to its offset,
  // each stinger delayed to its cue, all mixed once.
  const inputs: string[] = [];
  const chains: string[] = [];
  let offset = 0;
  let idx = 0;
  const addInput = (file: string): number => { inputs.push(`-i ${q(resolve(APP, "public", file))}`); return idx++; };
  for (const clip of clips) {
    const it = clip.item;
    if (it.music) {
      const k = addInput(it.music);
      // A short fade at both ends of every bed so consecutive beats on the
      // same track do not click; beds on the same file simply continue.
      chains.push(`[${k}:a]atrim=0:${clip.sec.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, clip.sec - 0.6).toFixed(3)}:d=0.6,volume=0.8,adelay=${Math.round(offset * 1000)}|${Math.round(offset * 1000)}[m${k}]`);
    }
    for (const s of it.stingers ?? []) {
      if (!clip.beat) continue;
      let cueFrames: number[] = [];
      if (s.on.startsWith("phase:")) {
        const ph = clip.beat.phases.find((p) => p.index === Number(s.on.slice(6)));
        if (ph) cueFrames = [ph.startFrame];
      } else {
        cueFrames = clip.beat.notable[s.on] ?? [];
      }
      // Only cues inside the frames this clip kept, at most three per clip so
      // a busy beat does not become a drum roll.
      const inClip = cueFrames.filter((f) => f >= clip.startFrame && f < clip.startFrame + clip.sec * FPS).slice(0, 3);
      for (const f of inClip) {
        const file = timeline.stingerFiles[s.file];
        if (!file) { missing.push(`stinger "${s.file}" is not in timeline.stingerFiles`); continue; }
        const k = addInput(file);
        const at = Math.round((offset + (f - clip.startFrame) / FPS) * 1000);
        chains.push(`[${k}:a]volume=${s.gain ?? 0.8},adelay=${at}|${at}[m${k}]`);
      }
    }
    offset += clip.sec;
  }
  const outFile = resolve(OUT, cut.output);
  if (chains.length) {
    const labels = chains.map((c) => c.slice(c.lastIndexOf("["))).join("");
    const graph = `${chains.join(";")};${labels}amix=inputs=${chains.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[mix]`;
    cmds.push(
      `${q(FFMPEG ?? "ffmpeg")} -y -i ${q(videoFile)} ${inputs.join(" ")} -filter_complex ${q(graph)} ` +
      `-map 0:v -map "[mix]" -c:v copy -c:a aac -b:a 192k -shortest ${q(outFile)}`,
    );
  } else {
    cmds.push(`cp ${q(videoFile)} ${q(outFile)}`);
  }
  if (VERTICAL && name === "promo") {
    const v = timeline.vertical;
    const x = Math.round((W - v.cropW) / 2 + v.cropXOffset);
    cmds.push(
      `${q(FFMPEG ?? "ffmpeg")} -y -i ${q(outFile)} -vf ${q(`crop=${v.cropW}:${H}:${x}:0,scale=1080:1920:flags=lanczos`)} ` +
      `-c:v libx264 -preset medium -crf 18 -c:a copy ${q(resolve(OUT, v.output))}`,
    );
  }
  return { cmds, missing };
}

await mkdir(OUT, { recursive: true });
const script: string[] = ["#!/usr/bin/env bash", "# Generated by sim/promo/assemble.ts — run where a full ffmpeg exists.", "set -euo pipefail", ""];
const problems: string[] = [];
for (const [name, cut] of Object.entries(timeline.cuts)) {
  if (CUT !== "all" && CUT !== name) continue;
  const { cmds, missing } = buildCut(name, cut);
  script.push(`# ---- ${name}: ${cut.output} (${cut.targetSec}s) ----`, ...cmds, "");
  for (const m of missing) problems.push(`${name}: ${m}`);
}
const muxPath = resolve(OUT, "mux.sh");
await writeFile(muxPath, script.join("\n"));
console.log(script.join("\n"));
console.log(`\n→ ${muxPath}`);
for (const p of problems) console.log(`⚠ ${p}`);
if (!existsSync(FONT)) console.log(`⚠ font file not found: ${FONT} (pass --font=…)`);

if (RUN) {
  if (!FFMPEG) { console.error("✗ no ffmpeg on PATH (or --ffmpeg=)"); process.exit(1); }
  const caps = capabilities(FFMPEG);
  const lackF = NEEDED_FILTERS.filter((f) => !caps.filters.has(f));
  const lackE = NEEDED_ENCODERS.filter((e) => !caps.encoders.has(e));
  if (lackF.length || lackE.length) {
    console.error(`✗ ${FFMPEG} lacks filters [${lackF.join(", ")}] encoders [${lackE.join(", ")}] — run mux.sh where a full ffmpeg is installed`);
    process.exit(1);
  }
  if (problems.length) { console.error("✗ not running: capture the missing beats first"); process.exit(1); }
  execFileSync("bash", [muxPath], { stdio: "inherit" });
} else {
  const missingBeats = readdirSync(OUT, { withFileTypes: true }).length === 0;
  console.log(missingBeats ? "(dry run; nothing captured yet)" : "(dry run; add --run to execute)");
}
