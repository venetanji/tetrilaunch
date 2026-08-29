#!/usr/bin/env npx tsx
/**
 * HOW OFTEN DOES THE CONGESTION GATE ACTUALLY FIRE?
 *
 * The gate reads `Game.stepPileTier` on the step a row clears (grades.ts,
 * design/balance/timed-clears.md §2e). This counts, per arm, the share of
 * CLEARED LINES sold out of a congested bay — the gate's exposure — without
 * adding a field to Game: `onLineClear` fires inside the clear block, while
 * `lastCongestionIdx` still describes the bay at the top of that step.
 */
import { makeBaseLevel } from "../src/game/level";
import { applyUpgrades, budgetForMark } from "../src/game/upgrades";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";
import { Game } from "../src/game/game";
import { ADAPTIVE_BOTS } from "./bots";
import { excellentStrategy, naiveStrategy, strategyPilot, timedStrategy } from "./aim-strategies";

const DT = 1000 / 60;
const SEEDS = Number(process.env.SEEDS ?? 4);
const ARMS = [["sweep", naiveStrategy], ["timed", timedStrategy], ["excel", excellentStrategy]] as const;

console.log("| Mark | Bay | Arm | Lines | Congested lines | Share | Max cubes | Knee |");
console.log("|---|---|---|---|---|---|---|---|");
for (const mark of (process.env.MARKS ?? "4,10").split(",").map(Number)) {
  for (const bay of (process.env.BAYS ?? "1,10").split(",").map(Number)) {
    for (const [name, spec] of ARMS) {
      let lines = 0, congested = 0, maxCubes = 0, knee = 0;
      for (let s = 0; s < SEEDS; s++) {
        const seed = 1000 + s;
        const cfg = makeBaseLevel(bay - 1, mark);
        applyUpgrades(cfg, loadoutFor(PRIORITY_ORDERS.full, mark, budgetForMark(mark)));
        knee = cfg.pileTiers[0].cubes + cfg.pileAllowance;
        let g!: Game;
        g = new Game(cfg, {
          onLineClear: (n) => { lines += n; if (g.stepPileTier) congested += n; },
        }, seed);
        const bot = strategyPilot(spec, { bot: ADAPTIVE_BOTS.demo })(seed);
        const cap = cfg.timeLimitSec > 0 ? cfg.timeLimitSec * 60 + 3600 : 36_000;
        let now = 0;
        for (let i = 0; g.status === "playing" && i < cap; i++) {
          now += DT; bot.act(g, now); g.update(now);
          if (g.cubes.length > maxCubes) maxCubes = g.cubes.length;
        }
        g.destroy();
      }
      console.log(
        `| ${mark} | ${bay} | ${name} | ${lines} | ${congested} `
        + `| ${lines ? Math.round((100 * congested) / lines) : 0}% | ${maxCubes} | ${knee} |`,
      );
    }
  }
}
