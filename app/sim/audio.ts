import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import { contractBed, dailyContracts } from "../src/game/contracts";

type Check = (name: string, passed: boolean, detail?: string) => void;

/** Drive the actual playback module and App.syncMusic with a controllable
 * media clock. DOM bootstrapping and audio decoding are outside this seam. */
export async function checkAudioContinuity(check: Check): Promise<void> {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const audioSource = fs.readFileSync(path.join(appDir, "src/lib/audio.ts"), "utf8");
  const mainSource = fs.readFileSync(path.join(appDir, "src/main.ts"), "utf8");
  const pipelineSource = fs.readFileSync(path.join(appDir, "scripts/prepare-audio.mjs"), "utf8");
  const pipeline = ts.createSourceFile("prepare-audio.mjs", pipelineSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let musicMapSource = "";
  const findMusicMap = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(pipeline) === "MUSIC") {
      musicMapSource = node.initializer?.getText(pipeline) ?? "";
    }
    ts.forEachChild(node, findMusicMap);
  };
  findMusicMap(pipeline);
  if (!musicMapSource) throw new Error("The preparation music map was not found");
  const musicMap = runInNewContext(`(${musicMapSource})`) as Record<string, string>;
  // Hashes identify the already processed recordings: role changes must not
  // re-encode the mix or accidentally swap a primary for its former alternate.
  const recordings = {
    menu: ["Pixel Dreams.wav", "3aaf14f68a3c25ee4829842da9bc83924ecf6b11ffa0792274ac72eccb6ad3f2"],
    "bay-1": ["Fire inside.mp3", "31a8604be11c2dba8f63d16f7b8e067bdb8cd15463ef9eabc3e2cfc91fe1d37c"],
    "bay-2": ["Ecstasy of the senses.mp3", "2954b1cee8cd23193c596b5eba979c842c6987dd1c818ade69b4f8263106a7f6"],
    "bay-3": ["Oasis in Paradise.mp3", "9264a5d29f061ad99a25c00e8be673aeaa2b8bfca991a2a05a8156e5c874b8e8"],
    "contract-1": ["chill beginning (Remastered).mp3", "0d35a36ea7e30b3c23ba31f94594344310b46c5beae14d114f04e9eaef83d276"],
    "contract-2": ["2 chill.mp3", "bfbb33e44007e419187b159befc754116a334f4734bf013d888c733ac1a4501c"],
    "contract-3": ["Threes.mp3", "4ae200fd2b92dd1014c7a074a8f7a9856b6e4d414354cfd06a39162880d157f5"],
  };
  for (const [role, [master, hash]] of Object.entries(recordings)) {
    check(`${role} prepares the selected master`, musicMap[master] === role, musicMap[master]);
    const asset = path.join(appDir, "public/audio/music", `${role}.mp3`);
    check(`${role} preserves the selected recording bytes`, fs.existsSync(asset)
      && createHash("sha256").update(fs.readFileSync(asset)).digest("hex") === hash);
  }
  const contract = dailyContracts(1, 20260822)[0];
  const originalRandom = Math.random;
  try {
    for (let tier = 1; tier <= 11; tier++) {
      const picks: string[] = [];
      for (const roll of [0, 0.99]) {
        Math.random = () => roll;
        for (const pieceSize of ["std", "bulk", "tiny"] as const) {
          for (let slot = 0; slot < 3; slot++) {
            picks.push(contractBed({ ...contract, tier, slot, pieceSize }));
          }
        }
      }
      check(`Contract tier ${tier} keeps the original three songs without exceptions`,
        picks.every((bed, i) => bed === `contract-${i % 3 + 1}`), picks.join(" "));
    }
  } finally {
    Math.random = originalRandom;
  }
  const main = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true);
  let syncSource = "";
  const findSync = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name.getText(main) === "syncMusic") {
      syncSource = node.getText(main);
    }
    ts.forEachChild(node, findSync);
  };
  findSync(main);
  if (!syncSource) throw new Error("App.syncMusic was not found");
  const compile = (source: string): string => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const elements: Media[] = [];
  let now = 0;
  let random = 0.99;
  let failConstruction = false;
  let refusePlayback = false;
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  class Media {
    currentTime = 0;
    volume = 1;
    paused = true;
    loop = false;
    preload = "";
    private listeners = new Map<string, () => void>();
    constructor(public src: string) {
      if (failConstruction) throw new Error("Unavailable audio");
      elements.push(this);
    }
    play(): Promise<void> {
      if (refusePlayback) return Promise.reject(new Error("Playback refused"));
      this.paused = false;
      return Promise.resolve();
    }
    pause(): void { this.paused = true; }
    removeAttribute(name: string): void { if (name === "src") this.src = ""; }
    getAttribute(name: string): string | null { return name === "src" ? this.src : null; }
    load(): void { this.currentTime = 0; }
    addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
    end(): void { this.paused = true; this.listeners.get("ended")?.(); }
  }
  const math = Object.create(Math) as Math;
  math.random = () => random;
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const context = {
    exports, Audio: Media, Math: math, console, performance: { now: () => now },
    Date: class extends Date { static now(): number { return now; } },
    setInterval: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval: (id: number) => timers.delete(id),
  };
  runInNewContext(compile(audioSource.replace("import.meta.env.BASE_URL", '"/"')), context);
  const appExports = {} as { AudioApp: {
    new(): { syncMusic(state: string): void; game?: { seed: number; status?: string }; contractMusic?: string };
  } };
  runInNewContext(compile(`class AudioApp { ${syncSource} }\nexports.AudioApp = AudioApp;`), {
    ...context, exports: appExports, ...exports, bayMusic: () => "bay-1", refitAfterBay: () => false,
  });
  const AudioApp = appExports.AudioApp;
  const app = new AudioApp();
  app.game = { seed: 1234 };
  const tick = async (ms = 1000): Promise<void> => {
    await Promise.resolve();
    now += ms;
    for (const element of elements) if (!element.paused) element.currentTime += ms / 1000;
    for (const timer of [...timers.values()]) timer();
  };
  const audible = (): Media | undefined => [...elements].reverse().find((el) => !el.paused && el.volume > 0);

  exports.setAudioEnabled({ sound: true, music: false });
  app.syncMusic("home");
  await tick();
  check("an initially disabled soundtrack creates no media", elements.length === 0);
  exports.setAudioEnabled({ sound: true, music: true });
  app.syncMusic("home");
  await tick();
  check("the first enabled menu plays Pixel Dreams even after starting muted", audible()?.src === "/audio/music/menu.mp3",
    audible()?.src);
  const firstMenu = audible();
  app.syncMusic("settings");
  await tick();
  check("walking between menus keeps the same theme element", audible() === firstMenu);
  exports.setAudioEnabled({ sound: true, music: false });
  await tick();
  exports.setAudioEnabled({ sound: true, music: true });
  await tick();
  check("toggling music in the initial menus keeps Pixel Dreams", audible()?.src === "/audio/music/menu.mp3",
    audible()?.src);

  app.syncMusic("playing");
  await tick();
  const bed = audible();
  if (!bed) throw new Error("No bay bed started");
  bed.currentTime = 37.25;
  const count = elements.length;
  for (let i = 0; i < 3; i++) {
    app.syncMusic("paused");
    await tick();
    check(`pause ${i + 1} keeps the same bed playing`, audible() === bed && !bed.paused);
    app.syncMusic("playing");
    await tick();
    check(`resume ${i + 1} keeps its playback position`, audible() === bed && bed.currentTime === 39.25 + i * 2,
      `position ${bed.currentTime}`);
  }
  check("repeated pause/resume allocates no replacement music", elements.length === count);

  app.contractMusic = "contract-3";
  app.syncMusic("playing");
  await tick();
  let contractMedia = audible();
  app.syncMusic("paused");
  await tick();
  app.syncMusic("playing");
  await tick();
  check("Contract pause/resume preserves its assigned recording", audible() === contractMedia
    && contractMedia?.src === "/audio/music/contract-3.mp3" && contractMedia.currentTime === 3);
  exports.setAudioEnabled({ sound: true, music: false });
  await tick();
  exports.setAudioEnabled({ sound: true, music: true });
  await tick();
  check("a Contract music toggle keeps its assigned recording", audible()?.src === "/audio/music/contract-3.mp3");
  contractMedia = audible();

  exports.playStinger("brokeSettle", true);
  await tick();
  const broke = audible();
  if (!broke) throw new Error("No broke stinger started");
  broke.currentTime = 2.25;
  app.syncMusic("paused");
  await tick();
  check("broke stinger holds its position and keeps the bed muted", broke.paused
    && broke.currentTime === 2.25 && contractMedia?.volume === 0);
  app.syncMusic("playing");
  await tick();
  check("broke stinger resumes over the same muted bed", audible() === broke
    && broke.currentTime === 3.25 && contractMedia?.volume === 0);
  broke.end();
  await tick();
  check("broke stinger ending restores the same bed", audible() === contractMedia);

  exports.playStinger("timeFinal");
  await tick();
  const final = audible();
  if (!final) throw new Error("No overtime stinger started");
  final.currentTime = 4.5;
  app.syncMusic("paused");
  await tick();
  check("overtime stinger pauses at its position", final.paused && final.currentTime === 4.5);
  app.syncMusic("playing");
  await tick();
  check("overtime stinger resumes the same element", audible() === final && final.currentTime === 5.5);

  app.syncMusic("bayclear");
  await tick();
  const clear = audible();
  check("bay-clear stinger still replaces music", clear?.src === "/audio/stingers/bayClear.mp3"
    && !elements.some((el) => !el.paused && el.src.includes("/music/")));
  clear?.end();
  await tick();
  check("bay-clear stinger still ends into silence", audible() === undefined);

  const laterMenus: string[] = [];
  for (random of [0, 0.4, 0.99]) {
    app.syncMusic("playing");
    await tick();
    app.syncMusic("home");
    await tick();
    laterMenus.push(audible()?.src ?? "");
  }
  check("every later lobby return plays Pixel Dreams regardless of random draws",
    laterMenus.every((source) => source === "/audio/music/menu.mp3"), laterMenus.join(", "));
  for (const role of ["bay-1", "bay-2", "bay-3", "contract-1", "contract-2", "contract-3"]) {
    for (const salt of [1, 1234, 99999]) {
      exports.playMusic(null);
      exports.playMusic(role, salt);
      await tick();
      check(`${role} has one recording for seed ${salt}`, audible()?.src === `/audio/music/${role}.mp3`, audible()?.src);
    }
  }

  exports.playMusic(null);
  await tick();
  // The real splash asks for music before the first pointer applies the
  // persisted setting. Reproduce that ordering in a fresh playback module.
  const bootAudio: typeof exports = {};
  runInNewContext(compile(audioSource.replace("import.meta.env.BASE_URL", '"/"')), { ...context, exports: bootAudio });
  random = 0.99;
  bootAudio.playMusic("menu");
  await tick();
  bootAudio.setAudioEnabled({ sound: true, music: false });
  await tick();
  bootAudio.setAudioEnabled({ sound: true, music: true });
  await tick();
  check("splash-before-settings boot keeps Pixel Dreams when music is enabled", audible()?.src === "/audio/music/menu.mp3",
    audible()?.src);
  bootAudio.playMusic(null);
  await tick();

  refusePlayback = true;
  exports.playMusic("menu");
  exports.playStinger("gameOver");
  await tick();
  check("refused playback remains silent without throwing", audible() === undefined);
  failConstruction = true;
  exports.playMusic("menu");
  exports.playStinger("gameOver2");
  await tick();
  check("unavailable audio remains silent without throwing", audible() === undefined);

  let census = "";
  const findCensus = (node: ts.Node): void => {
    if (ts.isForOfStatement(node) && node.expression.getText(pipeline) === "tracks") census = node.getText(pipeline);
    ts.forEachChild(node, findCensus);
  };
  findCensus(pipeline);
  if (!census) throw new Error("The track-master census was not found");
  const unmapped: string[] = [];
  runInNewContext(census, {
    tracks: new Set(["Pixel Dreams.wav", "Mapped.mp3", "Future.wav", "Future.WAV", "Future.mp3", "README.md"]),
    MUSIC: { "Pixel Dreams.wav": "menu", "Mapped.mp3": "bay-1" }, unmapped,
  });
  check("the preparation census reports unmapped WAV and MP3 masters",
    ["tracks/Future.wav", "tracks/Future.WAV", "tracks/Future.mp3"].every((name) => unmapped.includes(name)),
    unmapped.join(", "));
  check("the census leaves mapped masters and non-audio files alone",
    !["tracks/Pixel Dreams.wav", "tracks/Mapped.mp3", "tracks/README.md"].some((name) => unmapped.includes(name)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failures = 0;
  await checkAudioContinuity((name, passed, detail) => {
    console.log(`${passed ? "ok" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
    if (!passed) failures++;
  });
  process.exitCode = failures ? 1 : 0;
}
