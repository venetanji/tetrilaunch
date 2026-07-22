// Drives a single (level, bot, seed) combination to completion (win / loss /
// step cap) and reports a compact outcome record. No rendering, no browser —
// this is the same Game class the real app uses, just driven headlessly.
import { Game } from "../src/game/game";
import type { LevelConfig } from "../src/game/level";
import type { Bot } from "./bots";

const DT = 1000 / 60;

export interface BayOutcome {
  bot: string;
  bay: number;
  mods: string[];
  seed: number;
  status: "won" | "lost" | "cap";
  lossReason: string | null;
  secs: number;
  shots: number;
  lines: number;
  lost: number;
  endScore: number;
  maxCubes: number;
}

/**
 * Run one bay to completion.
 *
 * `bay`/`mods` are NOT inputs here on purpose (the signature mirrors the
 * spec's `runBay(cfg, bot, seed)` exactly) — `bay` is derived from
 * `cfg.id` (makeBaseLevel(i).id === i + 1, i.e. already the 1-based bay
 * number the caller is testing) and `mods` defaults to `[]`. Callers that
 * are sweeping a modifier (sweep.ts) overwrite `outcome.mods` after the
 * call; it's a plain field, not a computed one, so that's safe.
 */
export function runBay(cfg: LevelConfig, bot: Bot, seed: number): BayOutcome {
  let shots = 0;
  const g = new Game(cfg, {
    onShoot: () => {
      shots += 1;
    },
  }, seed);

  const stepCap = cfg.timeLimitSec > 0 ? cfg.timeLimitSec * 60 + 3600 : 36_000;

  let now = 0;
  let steps = 0;
  let maxCubes = g.cubes.length;

  while (g.status === "playing" && steps < stepCap) {
    now += DT;
    bot.act(g, now);
    g.update(now);
    steps += 1;
    if (g.cubes.length > maxCubes) maxCubes = g.cubes.length;
  }

  const status: "won" | "lost" | "cap" = g.status === "playing" ? "cap" : g.status;

  const outcome: BayOutcome = {
    bot: bot.name,
    bay: cfg.id,
    mods: [],
    seed,
    status,
    lossReason: g.lossReason,
    secs: steps / 60,
    shots,
    lines: g.linesTotal,
    lost: g.lostTotal,
    endScore: g.score,
    maxCubes,
  };

  g.destroy();
  return outcome;
}
