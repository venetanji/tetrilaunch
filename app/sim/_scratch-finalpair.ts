#!/usr/bin/env npx tsx
/**
 * TIER-1 MONEY PAIR — does Rush Order ever cross Rate Cut?
 *
 * finals.ts sizes each Final Inspection pair in ONE unit: extra lines the last
 * bay has to sell. This probe rebuilds that unit from the shipped bay rather
 * than from the note's arithmetic, so a re-sizing is checked against the code
 * that will run rather than against a table typed a release ago.
 *
 * Two arms, and the second one only confirms an ordering the first computes:
 *
 *  - LINES — the line model. bay 10 at Mark 1 (makeBaseLevel(RUN_LEVELS - 1))
 *    with `reactor` tiers applied exactly as run.ts's levelForRun applies them
 *    (ship first, clause after), a full CARRY_CAP carry, and the repo's
 *    measured ~2.9 launches a line (contracts.ts's PLANNING_EFFICIENCY note).
 *  - BOT — the `aim` bot on that same bay. finals.ts's instrument note says
 *    this harness prices exactly two things well and MONEY is one of them
 *    ("the bot stops firing when it is broke"), which is why a money pair is
 *    the one pair worth flying.
 *
 * Usage:
 *   npx tsx sim/_scratch-finalpair.ts                     # shipped constants
 *   QUOTA=875 CUT=0.2 npx tsx sim/_scratch-finalpair.ts   # a candidate
 *   WINDOW=1 npx tsx sim/_scratch-finalpair.ts            # the crossing window
 *   BOT=1 SEEDS=24 npx tsx sim/_scratch-finalpair.ts      # add the bot arm
 */
import { makeBaseLevel, type LevelConfig } from "../src/game/level";
import { applyUpgrades, newTiers } from "../src/game/upgrades";
import { CARRY_CAP, RUN_LEVELS } from "../src/game/run";
import { RATE_CUT, RUSH_ORDER_QUOTA } from "../src/game/finals";
import { BOTS } from "./bots";
import { runBay } from "./runner";

/** The repo's measured launches-a-line (level.ts, grades.ts, sim/systems.ts). */
const LAUNCHES_PER_LINE = Number(process.env.LPL ?? 2.9);
const CARRY = Number(process.env.CARRY ?? CARRY_CAP);
const QUOTA = Number(process.env.QUOTA ?? RUSH_ORDER_QUOTA);
const CUT = Number(process.env.CUT ?? RATE_CUT);
const MARK = Number(process.env.MARK ?? 1);
const RIGS = (process.env.RIGS ?? "0,1,2,3").split(",").map(Number);

/** Bay 10 as the run hands it over: ladder, then ship, then the carry. */
function bay10(reactor: number): LevelConfig {
  const cfg = makeBaseLevel(RUN_LEVELS - 1, MARK);
  applyUpgrades(cfg, { ...newTiers(), reactor });
  cfg.startingFunds += CARRY;
  return cfg;
}

/** Lines the bay must sell: what the float does not already cover, over what a
 *  line nets after the launches that make it. */
function lines(cfg: LevelConfig): number {
  const net = cfg.scorePerLine - LAUNCHES_PER_LINE * cfg.launchCost;
  return (cfg.targetScore - cfg.startingFunds) / net;
}

function rushOrder(cfg: LevelConfig): LevelConfig {
  return { ...cfg, targetScore: cfg.targetScore + QUOTA };
}
function rateCut(cfg: LevelConfig): LevelConfig {
  return { ...cfg, scorePerLine: Math.round(cfg.scorePerLine * (1 - CUT)) };
}

console.log(`Mark ${MARK} bay ${RUN_LEVELS} · quota $${QUOTA} · cut ${CUT} · carry $${CARRY} · ${LAUNCHES_PER_LINE} launches/line\n`);
console.log("| Reactor | target | rate | shot | float | net/line | baseline | Rush Order | Rate Cut | cheaper |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of RIGS) {
  const cfg = bay10(r);
  const base = lines(cfg);
  const ro = lines(rushOrder(cfg)) - base;
  const rc = lines(rateCut(cfg)) - base;
  console.log(
    `| ${r} | $${cfg.targetScore} | $${cfg.scorePerLine} | $${cfg.launchCost} | $${cfg.startingFunds}`
    + ` | $${(cfg.scorePerLine - LAUNCHES_PER_LINE * cfg.launchCost).toFixed(1)} | ${base.toFixed(1)}`
    + ` | +${ro.toFixed(2)} | +${rc.toFixed(2)} | ${ro < rc ? "Rush Order" : "Rate Cut"} |`,
  );
}

// The window a flat quota has to sit in for the pair to CROSS inside the rig
// range: dearer than Rate Cut on the fattest rig, cheaper on the thinnest.
if (process.env.WINDOW) {
  const thin = bay10(RIGS[0]);
  const fat = bay10(RIGS[RIGS.length - 1]);
  const at = (cfg: LevelConfig): number =>
    (lines(rateCut(cfg)) - lines(cfg)) * (cfg.scorePerLine - LAUNCHES_PER_LINE * cfg.launchCost);
  console.log(`\ncrossing window for the quota at cut ${CUT}: $${at(fat).toFixed(0)} .. $${at(thin).toFixed(0)}`);
}

if (process.env.BOT) {
  const seeds = Number(process.env.SEEDS ?? 24);
  console.log(`\n${process.env.BOTNAME ?? "aim"} bot, ${seeds} seeds\n`);
  console.log("| Reactor | none | Rush Order | Rate Cut |");
  console.log("|---|---|---|---|");
  for (const r of RIGS) {
    const cfg = bay10(r);
    const arms: [string, LevelConfig][] = [["none", cfg], ["ro", rushOrder(cfg)], ["rc", rateCut(cfg)]];
    const cells = arms.map(([, c]) => {
      let won = 0;
      for (let s = 1; s <= seeds; s++) {
        if (runBay(c, BOTS[process.env.BOTNAME ?? "aim"](s), s).status === "won") won += 1;
      }
      return `${Math.round((100 * won) / seeds)}%`;
    });
    console.log(`| ${r} | ${cells.join(" | ")} |`);
  }
}
