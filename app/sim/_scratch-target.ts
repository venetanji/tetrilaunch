#!/usr/bin/env npx tsx
/** TARGET CALIBRATION — win rate AND seconds-to-win as the base target is
 *  multiplied, on the Mark's own full build, both arms. */
import { makeBaseLevel } from "../src/game/level";
import { applyUpgrades, budgetForMark } from "../src/game/upgrades";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";
import { runBay } from "./runner";
import { ADAPTIVE_BOTS } from "./bots";
import { excellentStrategy, naiveStrategy, strategyPilot, timedStrategy } from "./aim-strategies";

const SEEDS = Number(process.env.SEEDS ?? 6);
const MULTS = (process.env.MULTS ?? "1.0,1.3,1.6,2.0").split(",").map(Number);
const ARMS = [["sweep", naiveStrategy], ["timed", timedStrategy], ["excel", excellentStrategy]] as const;

const head = ["| Mark | Bay | Arm |", ...MULTS.map((m) => ` x${m.toFixed(2)} |`)].join("");
console.log(head);
console.log("|---|---|---|" + MULTS.map(() => "---|").join(""));
for (const mark of (process.env.MARKS ?? "2,5,8,10").split(",").map(Number)) {
  for (const bay of (process.env.BAYS ?? "1,5").split(",").map(Number)) {
    for (const [name, spec] of ARMS) {
      const cells: string[] = [];
      for (const mult of MULTS) {
        let wins = 0, secs = 0;
        for (let s = 0; s < SEEDS; s++) {
          const seed = 1000 + s;
          const cfg = makeBaseLevel(bay - 1, mark);
          applyUpgrades(cfg, loadoutFor(PRIORITY_ORDERS.full, mark, budgetForMark(mark)));
          cfg.targetScore = Math.round(cfg.targetScore * mult);
          const out = runBay(cfg, strategyPilot(spec, { bot: ADAPTIVE_BOTS.demo })(seed), seed);
          if (out.status === "won") { wins += 1; secs += out.secs; }
        }
        const pct = Math.round((100 * wins) / SEEDS);
        cells.push(` ${pct}%/${wins ? (secs / wins).toFixed(0) + "s" : "—"} |`);
      }
      console.log(`| ${mark} | ${bay} | ${name} |` + cells.join(""));
    }
  }
}
