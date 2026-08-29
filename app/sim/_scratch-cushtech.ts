#!/usr/bin/env npx tsx
/**
 * IS THE IMPACT CUSHION SELLING A SYSTEM, OR A TECHNIQUE?
 *
 *   npx tsx sim/_scratch-cushtech.ts
 *   MARK=7 BAY=10 VOL=6 SEEDS=32 npx tsx sim/_scratch-cushtech.ts
 *
 * `aim-strategy-findings.md` §3 measures the cushion's value as almost entirely
 * a DECISION: +1 to a pilot who buys it and carries on, +38 to one who lands
 * volatile in the liner. But that table cannot say WHICH HALF of the decision
 * pays, because `cushionAware` is gated on `cushionCells > 0` and refuses to
 * act with no rig aboard — so its no-system arm is a control by construction
 * and the +38 is "the liner PLUS the aiming policy the liner enables", with no
 * way to separate them.
 *
 * A player with no cushion can still lob volatile at the wall and refuse to
 * drop cargo on an intact bomb. Nothing in the game forbids it; only the
 * harness does.
 *
 * THE SEPARATION NEEDS NO NEW STRATEGY, only a liner that is all geometry and
 * no softening: `cushionCells` deep enough to switch the policy on, with
 * `cushionMult` left at 1. The pilot then plays exactly the shipped rule and
 * gets none of the shipped protection, which is the arm the findings wanted.
 *
 *   none      / naive      the control
 *   TECHNIQUE / cushion    8 cells of liner, x1.00 softening
 *   t1        / cushion    4 cells, x1.15  (the shipped first rung)
 *   t3        / cushion    8 cells, x1.40  (maxed)
 */
import { applyRatchets, type Ratchets } from "../src/game/hazards";
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
const VOL = Number(process.env.VOL ?? 6);
const SEEDS = Number(process.env.SEEDS ?? 32);
const SHARE = process.env.SHARE ? Number(process.env.SHARE) : null;

const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
const loadout = loadoutWithoutTrack(PRIORITY_ORDERS.material, MARK, "cushion");
const stack: Ratchets = { volatile: VOL };

interface Arm {
  label: string;
  /** null = no liner at all. */
  liner: { cells: number; mult: number } | null;
  aware: boolean;
}
const ARMS: Arm[] = [
  { label: "none      / naive  ", liner: null, aware: false },
  { label: "TECHNIQUE / cushion", liner: { cells: 8, mult: 1.0 }, aware: true },
  { label: "t1        / naive  ", liner: null, aware: false },
  { label: "t1        / cushion", liner: null, aware: true },
  { label: "t3        / cushion", liner: null, aware: true },
];

console.log(
  `Cushion: system or technique? — Tier ${MARK} bay ${BAY} · volatile:${VOL}`
  + `${SHARE !== null ? ` (belt forced to ${(100 * SHARE).toFixed(0)}%)` : ""}`
  + ` · ${SEEDS} paired seeds`,
);
console.log("| arm | liner | soften | win | secs | lines | shots | end$ | tgt | bill$ |");
console.log("|---|---|---|---|---|---|---|---|---|---|");

ARMS.forEach((arm, i) => {
  let wins = 0, secs = 0, lines = 0, shots = 0, end = 0, bill = 0, target = 0;
  let cells = 0, mult = 1;
  for (const seed of seeds) {
    const cfg = makeBaseLevel(BAY - 1, MARK);
    applyUpgrades(cfg, loadout);
    const flown = applyRatchets(cfg, stack);
    if (BAY > 1) flown.startingFunds += CARRY_CAP;
    if (SHARE !== null) flown.materialMix = { ...flown.materialMix, volatile: SHARE };
    if (arm.liner) {
      flown.cushionCells = arm.liner.cells;
      flown.cushionMult = arm.liner.mult;
    } else if (i >= 2) {
      cushionKit(i === 2 || i === 3 ? 1 : 3).level!(flown);
    }
    cells = flown.cushionCells; mult = flown.cushionMult;
    const spec = arm.aware ? cushionStrategy : naiveStrategy;
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
    `| ${arm.label} | ${cells} cells | x${mult.toFixed(2)} `
    + `| ${Math.round((100 * wins) / n)}% | ${wins ? (secs / wins).toFixed(0) : "—"} `
    + `| ${(lines / n).toFixed(1)} | ${(shots / n).toFixed(1)} | ${Math.round(end / n)} `
    + `| ${target} | ${Math.round(bill / n)} |`,
  );
});
