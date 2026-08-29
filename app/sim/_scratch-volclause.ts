#!/usr/bin/env npx tsx
/**
 * THE VOLATILE EXAM — how deep can a bay-10 belt run volatile and still be a
 * bay rather than a lose button, with and without a liner aboard?
 *
 *   npx tsx sim/_scratch-volclause.ts
 *   SHARES=0.27,0.5,0.75,1.0 TIERS=0,1,2,3 MARK=7 SEEDS=24 npx tsx sim/_scratch-volclause.ts
 *
 * The bay is a REAL arrival: the Mark's ladder-start notches plus one a bay,
 * all poured into volatile (the worst case a run can walk in with), the rig a
 * Tier-N player would fly with the cushion track REMOVED from the order, then
 * the candidate clause writes the belt share, then the kit grants the liner.
 * That is `run.ts`'s own layering and `strategy-arms.ts`'s control discipline.
 */
import { applyRatchets, ladderStart, type Ratchets } from "../src/game/hazards";
import { makeBaseLevel } from "../src/game/level";
import { applyUpgrades } from "../src/game/upgrades";
import { CARRY_CAP, RUN_LEVELS } from "../src/game/run";
import { aimBot, type Bot } from "./bots";
import { loadoutWithoutTrack, PRIORITY_ORDERS } from "./builds";
import { bondHands, cushionKit } from "./counters";
import { runBay } from "./runner";
import { cushionStrategy, naiveStrategy, strategyHands } from "./aim-strategies";

const MARK = Number(process.env.MARK ?? 7);
const BAY = Number(process.env.BAY ?? RUN_LEVELS);
const SEEDS = Number(process.env.SEEDS ?? 24);
const SHARES = (process.env.SHARES ?? "0.27,0.5,0.75,1.0").split(",").map(Number);
const TIERS = (process.env.TIERS ?? "0,1,2,3").split(",").map(Number);
const TRIGGER = Number(process.env.TRIGGER ?? 1);

const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
const loadout = loadoutWithoutTrack(PRIORITY_ORDERS.material, MARK, "cushion");

/** The stack a run actually arrives at bay `BAY` with, all of it on volatile:
 *  the ladder's entry rung plus one notch a bay. The material cap holds it at
 *  MATERIAL_CAP; the clause then writes over it. */
const stack: Ratchets = { volatile: ladderStart(MARK) + BAY - 1 };

console.log(
  `Volatile exam — Tier ${MARK} bay ${BAY} · ${SEEDS} paired seeds`
  + ` · rig ${Object.entries(loadout).filter(([, v]) => v > 0).map(([k, v]) => k.slice(0, 3) + v).join(" ")}`
  + ` · arrival ${JSON.stringify(stack)}`
  + (TRIGGER !== 1 ? ` · trigger x${TRIGGER}` : ""),
);
console.log("| belt vol | liner | pilot | win | secs | lines | shots | end$ | tgt | bill$ |");
console.log("|---|---|---|---|---|---|---|---|---|---|");

for (const share of SHARES) {
  for (const tier of TIERS) {
    for (const [pname, spec] of [["naive", naiveStrategy], ["cushion", cushionStrategy]] as const) {
      // A liner nobody plays and a pilot with no liner are both worth printing
      // once, not twice: the cushion strategy is inert at cushionCells 0.
      if (tier === 0 && pname === "cushion") continue;
      let wins = 0, secs = 0, lines = 0, shots = 0, end = 0, bill = 0, target = 0;
      for (const seed of seeds) {
        const cfg = makeBaseLevel(BAY - 1, MARK);
        applyUpgrades(cfg, loadout);
        const flown = applyRatchets(cfg, stack);
        if (BAY > 1) flown.startingFunds += CARRY_CAP;
        // THE CLAUSE. A full-belt write: the named share is volatile and the
        // remainder is standard, which is what a `fullBelt` FinalDef does.
        flown.materialMix = { ...flown.materialMix, volatile: share };
        if (TRIGGER !== 1) flown.volatileTriggerMult = TRIGGER;
        if (tier > 0) cushionKit(tier).level!(flown);
        const strategy = spec.build(seed);
        let bot: Bot = bondHands(aimBot(seed, { demolish: true, strategy }));
        bot = strategyHands(strategy, bot);
        const out = runBay(flown, bot, seed);
        if (out.status === "won") { wins += 1; secs += out.secs; }
        lines += out.lines; shots += out.shots; end += out.endScore;
        bill += out.volatileLosses; target = out.target;
      }
      const n = seeds.length;
      console.log(
        `| ${(100 * share).toFixed(0)}% | ${tier === 0 ? "none" : `t${tier}`} | ${pname} `
        + `| ${Math.round((100 * wins) / n)}% | ${wins ? (secs / wins).toFixed(0) : "—"} `
        + `| ${(lines / n).toFixed(1)} | ${(shots / n).toFixed(1)} | ${Math.round(end / n)} `
        + `| ${target} | ${Math.round(bill / n)} |`,
      );
    }
  }
}
