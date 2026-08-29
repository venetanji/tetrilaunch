#!/usr/bin/env npx tsx
/**
 * PACING DECOMPOSITION — why does a bay end so fast?
 *
 * Two candidate causes, measured apart: the graded pay ladder, and a Reactor
 * refit reaching tier 2 while the Mark is still low. One rig, one seed set,
 * one variable at a time.
 */
import { makeBaseLevel } from "../src/game/level";
import { applyUpgrades, newTiers, type UpgradeTiers } from "../src/game/upgrades";
import { runBay } from "./runner";
import { ADAPTIVE_BOTS } from "./bots";
import { excellentStrategy, naiveStrategy, strategyPilot, timedStrategy } from "./aim-strategies";

const SEEDS = Number(process.env.SEEDS ?? 6);
const ARMS = [
  ["sweep", naiveStrategy],
  ["timed", timedStrategy],
  ["excel", excellentStrategy],
] as const;

function tiersWith(reactor: number): UpgradeTiers {
  const t = newTiers();
  t.reactor = reactor;
  return t;
}

console.log("| Mark | Bay | Reactor | Arm | Win | Secs | Lines | Shots | End$ | Target | End/Tgt |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const mark of (process.env.MARKS ?? "2,3,5,8").split(",").map(Number)) {
  for (const bay of (process.env.BAYS ?? "1,5").split(",").map(Number)) {
    for (const reactor of [0, 1, 2]) {
      for (const [name, spec] of ARMS) {
        let wins = 0, secs = 0, lines = 0, shots = 0, end = 0, target = 0;
        for (let s = 0; s < SEEDS; s++) {
          const seed = 1000 + s;
          const cfg = makeBaseLevel(bay - 1, mark);
          applyUpgrades(cfg, tiersWith(reactor));
          const out = runBay(cfg, strategyPilot(spec, { bot: ADAPTIVE_BOTS.demo })(seed), seed);
          if (out.status === "won") { wins += 1; secs += out.secs; }
          lines += out.lines; shots += out.shots; end += out.endScore; target = out.target;
        }
        const w = wins || 1;
        console.log(
          `| ${mark} | ${bay} | T${reactor} | ${name} | ${Math.round(100 * wins / SEEDS)}% `
          + `| ${wins ? (secs / w).toFixed(0) : "—"} | ${(lines / SEEDS).toFixed(1)} `
          + `| ${(shots / SEEDS).toFixed(1)} | ${Math.round(end / SEEDS)} | ${target} `
          + `| ${(end / SEEDS / target).toFixed(2)} |`,
        );
      }
    }
  }
}
