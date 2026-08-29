#!/usr/bin/env npx tsx
/**
 * DOES A TEN-SLOT RACK ERASE BUILD IDENTITY LATE?
 *
 *   npx tsx sim/_scratch-slotid.ts
 *   MARKS=8,10 BAYS=5,10 SEEDS=6 npx tsx sim/_scratch-slotid.ts
 *
 * `sim/slots.ts` asks this at RUN level and answers in mean bays cleared, which
 * is the right readout for "does a width wall a tier" and too coarse for "does
 * the everything-rig dominate every specialist". This asks the same question one
 * bay at a time, where win rate, SECONDS-TO-WIN and end-money margin all exist.
 *
 * THE ARMS, and the one that matters is the last:
 *
 *   spec@4 / spec@6   the content's own mount order, truncated to K slots
 *   gen@4  / gen@6    the SAME width, the wrong choice — the identity control
 *   full@10           every system aboard
 *
 * At K = 10 all four mount orders are the same rig BY CONSTRUCTION (builds.ts),
 * so `full@10` is every specialist at once and there is only one of it.
 *
 * THE BUDGET IS THE CONFOUND AND IT IS NOT A BUG. `mountedLoadout` spends the
 * Mark's whole allowance over the mounted tracks only, so a narrow rack at a
 * late Mark STRANDS budget it cannot spend — 4 slots x 110 points against
 * `budgetForMark(10)` = 1100 strands 660. That is exactly what a slot cap would
 * do to a player who has already bought ten, so it is the effect being priced,
 * not an artefact to correct for.
 */
import { applyRatchets, type HazardId, type Ratchets } from "../src/game/hazards";
import { makeBaseLevel } from "../src/game/level";
import { applyUpgrades, tiersCost, type UpgradeId } from "../src/game/upgrades";
import { CARRY_CAP, RUN_LEVELS } from "../src/game/run";
import { ADAPTIVE_BOTS, BOTS, type Bot } from "./bots";
import { mountedLoadout, mountedTracks, PRIORITY_ORDERS } from "./builds";
import { bondHands } from "./counters";
import { runBay } from "./runner";
import {
  cushionStrategy, lanceStrategy, naiveStrategy, strategyPilot, type AimStrategySpec,
} from "./aim-strategies";

const MARKS = (process.env.MARKS ?? "8,10").split(",").map(Number);
const BAYS = (process.env.BAYS ?? "5,10").split(",").map(Number);
const SEEDS = Number(process.env.SEEDS ?? 6);
const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);

interface Content {
  name: string;
  stack: Ratchets;
  answer: UpgradeId | null;
  mount: string;
}
/** Notches the arrival carries, all poured into one axis — the corner a mount
 *  decision is actually made against. `clean` spends the same count on the
 *  number axes instead, so every row is the same amount of ratchet.
 *
 *  THREE, arrived at by measurement rather than by taste. A first pass used
 *  `3 + bay - 1` (7 by bay 5, 12 by bay 10) and every cryo cell came back 0%
 *  for every arm; four notches (0.22 of the belt) still read 0% on cryo at
 *  Tier 8 bay 5 for all five racks. `materialRate` is 0.07 + 0.05 a notch, and
 *  a row where every arm loses measures the RATCHET, not the rack — so the
 *  depth is the deepest single axis that still leaves signal in every column.
 *  Three notches is 0.17 of the belt. */
const N = (_bay: number): number => 3;
const CONTENTS = (bay: number): Content[] => [
  {
    name: "clean", answer: null, mount: "mount-generic",
    stack: { target: Math.ceil(N(bay) / 3), wind: Math.ceil(N(bay) / 3), cost: Math.floor(N(bay) / 3) } as Ratchets,
  },
  { name: "cryo", answer: "thaw", mount: "mount-cryo", stack: { cryo: N(bay) } },
  { name: "volatile", answer: "cushion", mount: "mount-volatile", stack: { volatile: N(bay) } },
  { name: "slag", answer: "demolition", mount: "mount-slag", stack: { slag: N(bay) } },
];

function strategyFor(answer: UpgradeId | null, tracks: UpgradeId[]): AimStrategySpec {
  if (!answer || !tracks.includes(answer)) return naiveStrategy;
  if (answer === "cushion") return cushionStrategy;
  if (answer === "thaw") return lanceStrategy;
  return naiveStrategy;
}
const basePilot = (seed: number): Bot => bondHands(BOTS.demo(seed));
const pilotFor = (spec: AimStrategySpec): ((seed: number) => Bot) =>
  spec === naiveStrategy ? basePilot : strategyPilot(spec, { bot: ADAPTIVE_BOTS.demo });

interface Arm { label: string; mount: string; slots: number }

console.log(
  `Slot identity, per bay — marks ${MARKS.join(",")} · bays ${BAYS.join(",")}`
  + ` · ${SEEDS} paired seeds · bot demo+bond`,
);
console.log("| Mark | Bay | content | arm | pts | pilot | win | secs | end$ | tgt | end/tgt | rack |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");

for (const mark of MARKS) {
  for (const bay of BAYS) {
    for (const content of CONTENTS(bay)) {
      const arms: Arm[] = [
        { label: "spec@4", mount: content.mount, slots: 4 },
        { label: "gen@4", mount: "mount-generic", slots: 4 },
        { label: "spec@6", mount: content.mount, slots: 6 },
        // THE WIDEST MEASURABLE RACK, and the one past it. `system-slots.md`
        // §5 stops every claim at eight, because slots 9 and 10 of every mount
        // order are the Incinerator (a measured zero to a pilot that never aims
        // into the flue) and the Loader Magazine ("a self-inflicted wound to a
        // bot that fires on every cooldown" — marks.ts). Both are printed so
        // the artefact is a number rather than a caveat.
        { label: "full@8", mount: "mount-generic", slots: 8 },
        { label: "full@10", mount: "mount-generic", slots: 10 },
      ];
      for (const arm of arms) {
        const order = PRIORITY_ORDERS[arm.mount];
        const tracks = mountedTracks(order, mark, arm.slots);
        const loadout = mountedLoadout(order, mark, arm.slots);
        const spec = strategyFor(content.answer, tracks);
        const pilot = pilotFor(spec);
        let wins = 0, secs = 0, end = 0, target = 0;
        for (const seed of seeds) {
          const cfg = makeBaseLevel(bay - 1, mark);
          applyUpgrades(cfg, loadout);
          const flown = applyRatchets(cfg, content.stack);
          if (bay > 1) flown.startingFunds += CARRY_CAP;
          const out = runBay(flown, pilot(seed), seed);
          if (out.status === "won") { wins += 1; secs += out.secs; }
          end += out.endScore; target = out.target;
        }
        const n = seeds.length;
        console.log(
          `| ${mark} | ${bay} | ${content.name} | ${arm.label} | ${tiersCost(loadout)} `
          + `| ${spec.name} | ${Math.round((100 * wins) / n)}% `
          + `| ${wins ? (secs / wins).toFixed(0) : "—"} | ${Math.round(end / n)} | ${target} `
          + `| ${(end / n / target).toFixed(2)} | ${tracks.map((t) => t.slice(0, 3)).join(" ")} |`,
        );
      }
    }
  }
}
void RUN_LEVELS;
void ({} as HazardId);
