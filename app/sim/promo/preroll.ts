#!/usr/bin/env npx tsx
/**
 * PREROLL — fly a beat's bay headlessly, before the browser spends a frame.
 *
 * Two beats need to know something about a bay before they capture it:
 *
 *  - `luck` needs a SEED whose bay ends on the clock with the last clear
 *    graded "lucky" (grades.ts), and finding one means flying bays until it
 *    happens. At 60 physics steps a second a 180-second bay is 10,800 steps —
 *    seconds in node, minutes of screenshots in Chromium.
 *  - `loss` and `luck` capture only the last few seconds before their event,
 *    so the driver has to know WHEN the event lands to start capturing ahead
 *    of it.
 *
 * Both are the same bay the App will launch: game/sandbox.ts's sandboxRunFor,
 * run.ts's levelForRun, applySandboxMaterials and a Game seeded with the run's
 * seed — the exact chain main.ts's launchSandbox → startLevel walks — flown
 * by the same pilot from beats.ts with the same seed, acting before each
 * update as the harness's wrapper does, on the same clock delta (PROMO_DT).
 *
 * WHERE IT RUNS. run.ts calls these through the page (harness.ts's fly /
 * prerollPhase / findLuckySeed), not in node: node's V8 and Chromium's differ
 * in the last bit of enough arithmetic that the same bay parts ways after a
 * few hundred steps of a chaotic pile (measured: identical for seven shots,
 * then a clear one side never saw). Flown in the page, the preroll predicts
 * the filmed bay to the step, and run.ts checks that it did
 * (beat.json → preroll.phases[].match). The node CLI below is for exploring
 * configurations quickly; its timings are a close guide, not the browser's.
 *
 *   npx tsx sim/promo/preroll.ts --beat=luck [--seeds=40]   # print the search
 */
import { Game } from "../../src/game/game";
import { levelForRun } from "../../src/game/run";
import { applySandboxMaterials, newSandbox, sandboxRunFor, type SandboxState } from "../../src/game/sandbox";
import { newTiers } from "../../src/game/upgrades";
import {
  BEATS, makeBot, PROMO_DT, type BayConfig, type BayPhase, type BotSpec, type PromoEvent, type ScriptedAction,
} from "./beats";
import { recordEvents } from "./events";
import { HANDS, statusOf } from "./hands";

/** beats.ts explains the nudge; the App's own clock in the page advances by the same number. */
const DT = PROMO_DT;

export function sandboxFor(cfg: BayConfig): SandboxState {
  const s = newSandbox();
  s.tier = cfg.tier;
  s.seed = cfg.seed;
  s.target = { kind: "bay", bay: cfg.bay ?? 1 };
  s.tiers = { ...newTiers(), ...(cfg.tiers ?? {}) };
  s.ratchets = { ...(cfg.ratchets ?? {}) };
  s.material = cfg.material ?? "mix";
  return s;
}

/** The Game main.ts's launchSandbox would build for this config. */
export function buildBay(cfg: BayConfig): Game {
  const s = sandboxFor(cfg);
  const run = sandboxRunFor(s, []);
  const level = applySandboxMaterials(levelForRun(run), s.material);
  const g = new Game(level, {}, run.seed);
  if (cfg.funds !== undefined) g.score = cfg.funds;
  return g;
}

export interface FlightLog {
  endMs: number;
  status: string;
  lossReason: string | null;
  events: PromoEvent[];
  lines: number;
  score: number;
  target: number;
}

/**
 * Fly one bay to `maxSec` or its end. Event times are bay-relative ms.
 *
 * Scripted hands fire here exactly as run.ts fires them in the page: read
 * after the step's update, from the same status shape, once each — so the
 * preroll's blast is the browser's blast.
 */
export function flyBay(
  cfg: BayConfig, botSpec: BotSpec | null, maxSec: number, scripted: ScriptedAction[] = [],
): FlightLog {
  const g = buildBay(cfg);
  const bot = botSpec ? makeBot(botSpec) : null;
  const events: PromoEvent[] = [];
  let t = 0;
  recordEvents(g, () => t, (e) => events.push(e));
  const steps = Math.ceil(maxSec * 60);
  const fired = new Set<number>();
  for (let i = 0; i < steps && g.status === "playing"; i++) {
    t += DT;
    if (bot) bot.act(g, t);
    g.update(t);
    if (scripted.length) {
      const st = statusOf(g, "playing", i + 1);
      for (let k = 0; k < scripted.length; k++) {
        const s = scripted[k];
        if (fired.has(k) || !s.when(st, events)) continue;
        if (HANDS[s.action](g, t)) {
          fired.add(k);
          events.push({ t, kind: "scripted", action: s.action });
        }
      }
    }
  }
  const log: FlightLog = {
    endMs: t, status: g.status, lossReason: g.lossReason, events,
    lines: g.linesTotal, score: g.score, target: g.target,
  };
  g.destroy();
  return log;
}

/** When a phase's `done` first holds in a headless flight (null if never),
 *  and the flight it held in. */
export function doneAtMs(phase: BayPhase): { at: number | null; log: FlightLog } {
  const log = flyBay(phase.config, phase.bot, phase.maxSec, phase.scripted ?? []);
  // Replay the log through the same predicate the driver polls with, one
  // event at a time, so "when" means the same thing in both places. The
  // predicates read events (and elapsedMs) — the rest of the status is not
  // available after the fact and none of them ask for it.
  const seen: PromoEvent[] = [];
  for (const e of log.events) {
    seen.push(e);
    const st = {
      state: "playing", hasGame: true, status: "playing", ready: false, lossReason: null,
      timeLeftMs: null, elapsedMs: e.t, cubes: 0, lines: 0, score: 0, target: 0,
      bombs: 0, thaw: 0, steps: 0,
    };
    if (phase.done(st, seen)) return { at: e.t, log };
  }
  return { at: null, log };
}

/**
 * The luck criterion: the bay ended on the clock, and the last row it paid
 * was graded lucky within `windowMs` of the buzzer. "Final clear's grade is
 * lucky at the buzzer", read literally.
 */
export const LUCK_WINDOW_MS = 4000;

export interface LuckResult {
  seed: number;
  tried: number;
  /** "strict" met the buzzer window; "relaxed" is the best fallback — a lucky
   *  last clear on a clock-ended bay, whatever the gap. */
  criterion: "strict" | "relaxed";
  gapMs: number;
  log: FlightLog;
}

/**
 * The first seed from `from` whose bay reaches the phase's own `done`
 * condition — the seed the beat was written against is tried first, so a
 * search only walks on when the engine at hand plays that seed differently
 * from the one the beat was tuned in (see the header on node vs Chromium).
 */
export function findDoneSeed(
  phase: BayPhase, from: number, count: number, report?: (line: string) => void,
): { seed: number; at: number; log: FlightLog; tried: number } | null {
  for (let i = 0; i < count; i++) {
    const seed = from + i;
    const { at, log } = doneAtMs({ ...phase, config: { ...phase.config, seed } });
    report?.(`seed ${seed}: ${log.status}/${log.lossReason ?? "-"} at ${(log.endMs / 1000).toFixed(1)}s, done ${at === null ? "never" : `@${(at / 1000).toFixed(2)}s`}`);
    if (at !== null) return { seed, at, log, tried: i + 1 };
  }
  return null;
}

export function findLuckySeed(
  phase: BayPhase, from: number, count: number, report?: (line: string) => void,
): LuckResult | null {
  let relaxed: LuckResult | null = null;
  for (let i = 0; i < count; i++) {
    const seed = from + i;
    const log = flyBay({ ...phase.config, seed }, phase.bot, phase.maxSec);
    const buzzer = log.events.find((e) => e.kind === "buzzer");
    const clears = log.events.filter((e) => e.kind === "clear");
    const last = clears[clears.length - 1];
    const gap = buzzer && last ? buzzer.t - last.t : Infinity;
    report?.(
      `seed ${seed}: ${log.status}/${log.lossReason ?? "-"} at ${(log.endMs / 1000).toFixed(1)}s, ` +
      `${clears.length} clears, last ${last ? `${last.grade} @${(last.t / 1000).toFixed(1)}s` : "-"}` +
      (buzzer ? `, gap ${(gap / 1000).toFixed(1)}s` : ""),
    );
    if (!buzzer || !last || last.grade !== "lucky") continue;
    const res: LuckResult = { seed, tried: i + 1, criterion: "strict", gapMs: gap, log };
    if (gap <= LUCK_WINDOW_MS) return res;
    if (!relaxed || gap < relaxed.gapMs) relaxed = { ...res, criterion: "relaxed" };
  }
  return relaxed ? { ...relaxed, tried: count } : null;
}

// CLI: print the search for a beat without capturing anything. Guarded on
// `process` because harness.ts imports this module into the page, where the
// same flights run inside Chromium's own engine (see run.ts on why).
if (typeof process !== "undefined" && process.argv?.[1] && /preroll\.ts$/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  const opt = (n: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : null;
  };
  const id = opt("beat") ?? "luck";
  const beat = BEATS[id];
  if (!beat) { console.error(`unknown beat "${id}"`); process.exit(1); }
  const phase = beat.phases.find((p): p is BayPhase => p.kind === "bay");
  if (!phase) { console.error(`beat "${id}" has no bay phase`); process.exit(1); }
  if (beat.seedSearch) {
    const count = Number(opt("seeds") ?? beat.seedSearch.count);
    const res = findLuckySeed(phase, Number(opt("from") ?? beat.seedSearch.from), count, (l) => console.log(l));
    console.log(res ? `→ seed ${res.seed} (${res.criterion}, gap ${(res.gapMs / 1000).toFixed(1)}s)` : "→ no seed met the criterion");
  } else {
    const { at, log } = doneAtMs(phase);
    console.log(`${id}: ${log.status}/${log.lossReason ?? "-"} at ${(log.endMs / 1000).toFixed(1)}s; done ${at !== null ? `@${(at / 1000).toFixed(2)}s` : "never"}`);
    for (const e of log.events) {
      if (e.kind === "shoot") continue;
      console.log(`  ${(e.t / 1000).toFixed(2)}s ${e.kind}${e.lines ? ` x${e.lines} ${e.grade}` : ""}${e.explosion ? ` ${e.explosion}` : ""}${e.status ? ` ${e.status}` : ""}${e.tier !== undefined ? ` tier ${e.tier}` : ""}`);
    }
  }
}
