#!/usr/bin/env npx tsx
/**
 * THE TEE SHOT — can a fixed shot at an authored trench be TIMED, and how often?
 *
 * The set-piece Contract's whole bet, stated as a measurement before a line of
 * it is designed. `sim/_scratch-flight.ts` measured launch-to-rest at 33-107
 * steps (median 71) across the aim search's WHOLE grid, and `crushWindowSteps`
 * is ~17 at stock hydraulics — fired blind, three timed clears in a row is
 * arithmetic nobody would ship. The claim the Contract rests on is that a pilot
 * firing THE SAME arc at THE SAME trench, over and over, has a far tighter
 * spread than that grid-wide figure, and nobody had measured the fixed-shot
 * spread.
 *
 *   npx tsx sim/_scratch-teeshot.ts                    # rack depth x tier
 *   SHAPES=1 npx tsx sim/_scratch-teeshot.ts           # the rack SHAPE question
 *   PLAN=1 npx tsx sim/_scratch-teeshot.ts             # shipping candidates;
 *       GRID=7:3,10:3 DEPTHS=3,4,5,6 BUDGETS=9,12 narrow it
 *   SHIP=1 npx tsx sim/_scratch-teeshot.ts             # the ladder as shipped,
 *       reading depths and budgets straight off contracts.ts, so a table quoted
 *       in a commit message cannot drift from the code it is defending
 *
 * Reports, per (tier, rack depth R): clears, the TIMED share of them, the best
 * consecutive-timed streak reached, and how many launches it took. The streak
 * comes off `Game.bestTimedStreak` — the shipped rule, not a copy of it — so
 * what this table measures is what the Contract will ask for.
 *
 * BIAS, and it is the usual one: the `aim` bot flies open-loop off a fixed
 * flight-step estimate, never reads the pile mid-flight and never uses a Bond
 * Breaker. Every figure below is a FLOOR.
 */
import {
  rackDepthFor, rackProfile, setpieceLaunches, setpiecePasses,
} from "../src/game/contracts";
import { applyBayDials } from "../src/game/drills";
import { makeBaseLevel } from "../src/game/level";
import { ADAPTIVE_BOTS } from "./bots";
import { strategyPilot, timedStrategy } from "./aim-strategies";
import { runBay } from "./runner";
import type { LevelConfig } from "../src/game/level";

const SEEDS = Number(process.env.SEEDS ?? 12);
const BUDGET = Number(process.env.BUDGET ?? 14);

/** The rack, as a column profile: `lip` columns of standing scrap at each end
 *  of a 4-wide trench, every one of them R deep. Slot 0 is the column against
 *  the far wall (pieces.ts's createStandingWall), so lip 2 is the licence's own
 *  TRENCH board at depth — and is what contracts.ts's rackProfile builds, which
 *  this defers to whenever it is asked for that shape rather than a probe one. */
function rack(depth: number, farLip: number, nearLip: number): number[] {
  if (farLip === 2 && nearLip === 2) return rackProfile(depth);
  const cols = 8;
  return Array.from({ length: cols }, (_, k) =>
    (k < farLip || k >= cols - nearLip ? depth : 0));
}

function setpieceBay(tier: number, wall: number[], budget: number): LevelConfig {
  const cfg = makeBaseLevel(Math.min(9, tier));
  cfg.launchCost = 0;
  cfg.startingFunds = 0;
  cfg.targetScore = Number.MAX_SAFE_INTEGER;
  cfg.timeLimitSec = 0;
  cfg.objectiveLines = 0;
  cfg.penaltyPerLostPiece = 0;
  cfg.launchBudget = budget;
  cfg.windMax = 0;
  cfg.windGust = 0;
  applyBayDials(cfg, { wall, wallMaterial: "standard", sequence: ["I"] });
  return cfg;
}

function probe(tier: number, wall: number[], budget: number): string {
  let clears = 0, timed = 0, shots = 0, cubes = 0;
  const streaks: number[] = [];
  for (let s = 0; s < SEEDS; s++) {
    const seed = 4000 + s;
    const pilot = strategyPilot(timedStrategy, { bot: ADAPTIVE_BOTS.aim });
    const out = runBay(setpieceBay(tier, wall, budget), pilot(seed), seed);
    const n = out.grades.excellent + out.grades.good + out.grades.swept + out.grades.lucky;
    clears += n;
    timed += out.grades.excellent + out.grades.good;
    shots += out.shots;
    cubes += out.maxCubes;
    streaks.push(out.bestTimedStreak);
  }
  const reach = (n: number): string =>
    `${Math.round((streaks.filter((x) => x >= n).length / SEEDS) * 100).toString().padStart(3)}%`;
  return `${String(clears / SEEDS).padStart(5)} ${String(shots / SEEDS).padStart(5)}`
    + `  ${(clears ? timed / clears : 0).toFixed(2)}`
    + `  ${reach(1)} ${reach(2)} ${reach(3)}`
    + `  max ${String(Math.max(...streaks)).padStart(2)}`
    + `  cubes ${String(Math.round(cubes / SEEDS)).padStart(3)}`;
}

const header = "  rows/bay shots  timed  1+   2+   3+";

/** P(best streak reaches `to`) — the shipping question, at one candidate. */
function plan(tier: number, to: number, R: number, budget: number, seeds: number): {
  win: number; shots: number; timed: number; cubes: number;
} {
  let won = 0, shots = 0, clears = 0, timed = 0, cubes = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = 4000 + s;
    const pilot = strategyPilot(timedStrategy, { bot: ADAPTIVE_BOTS.aim });
    const out = runBay(setpieceBay(tier, rack(R, 2, 2), budget), pilot(seed), seed);
    if (out.bestTimedStreak >= to) won += 1;
    shots += out.shots;
    clears += out.grades.excellent + out.grades.good + out.grades.swept + out.grades.lucky;
    timed += out.grades.excellent + out.grades.good;
    cubes += out.maxCubes;
  }
  return {
    win: won / seeds, shots: shots / seeds, cubes: cubes / seeds,
    timed: clears ? timed / clears : 0,
  };
}

if (process.env.SHIP) {
  // THE SHIPPED LADDER, read off contracts.ts rather than retyped — the table
  // the commit message quotes.
  const seeds = Number(process.env.SEEDS ?? 60);
  console.log(`SHIPPED LADDER — ${seeds} seeds, aim:timed (a FLOOR: see the header)`);
  console.log("  tier  N   R  budget   win  timed  maxcubes");
  for (let tier = 2; tier <= 10; tier++) {
    const to = setpiecePasses(tier);
    const R = rackDepthFor(tier);
    const budget = setpieceLaunches(tier);
    const r = plan(tier, to, R, budget, seeds);
    console.log(
      `  ${String(tier).padStart(4)}  ${to}   ${R}  ${String(budget).padStart(6)}`
      + `  ${(r.win * 100).toFixed(0).padStart(4)}%  ${r.timed.toFixed(2)}`
      + `  ${r.cubes.toFixed(0).padStart(8)}`,
    );
  }
} else if (process.env.PLAN) {
  const seeds = Number(process.env.SEEDS ?? 40);
  console.log(`SHIPPING CANDIDATES — ${seeds} seeds, aim:timed`);
  console.log("  tier  N   R  budget   win  shots  timed  maxcubes");
  const grid = (process.env.GRID ?? "2:1,3:1,4:2,6:2,7:3,10:3")
    .split(",").map((s) => s.split(":").map(Number) as [number, number]);
  const depths = (process.env.DEPTHS ?? "").split(",").filter(Boolean).map(Number);
  const budgets = (process.env.BUDGETS ?? "8,10,12,14").split(",").map(Number);
  for (const [tier, to] of grid) {
    for (const R of depths.length ? depths : [to + 1, to + 2, to + 3]) {
      for (const budget of budgets) {
        const r = plan(tier, to, R, budget, seeds);
        console.log(
          `  ${String(tier).padStart(4)}  ${to}   ${R}  ${String(budget).padStart(6)}`
          + `  ${(r.win * 100).toFixed(0).padStart(4)}%`
          + `  ${r.shots.toFixed(1).padStart(5)}`
          + `  ${r.timed.toFixed(2)}`
          + `  ${r.cubes.toFixed(0).padStart(8)}`,
        );
      }
    }
  }
} else if (process.env.SHAPES) {
  console.log(`RACK SHAPE — tier 5, R=5, budget ${BUDGET}, ${SEEDS} seeds`);
  console.log(`  far/near${header}`);
  for (const [f, n] of [[2, 2], [3, 1], [4, 0], [0, 4]] as const) {
    console.log(`  ${f}/${n}     ${probe(5, rack(5, f, n), BUDGET)}`);
  }
} else {
  console.log(`RACK DEPTH — trench 4 wide, lips 2/2, budget ${BUDGET}, ${SEEDS} seeds`);
  console.log(`  tier R${header}`);
  for (const tier of [2, 4, 5, 7, 10]) {
    for (const R of [3, 4, 5, 6, 7]) {
      console.log(`  ${String(tier).padStart(4)} ${R} ${probe(tier, rack(R, 2, 2), BUDGET)}`);
    }
  }
}
