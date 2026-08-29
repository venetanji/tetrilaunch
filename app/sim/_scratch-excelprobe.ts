#!/usr/bin/env npx tsx
/**
 * THE STARVATION PROBE — why `excellent` needed a patience rule.
 *
 * Three arms, one bay, one seed, printed side by side. It exists because the
 * first version of `aim-strategies.ts`'s `excellent` policy looked plausible and
 * was catastrophic, and the difference is invisible in an averaged table: the
 * arm held for the crush window and took SEVEN shots in a 180-second bay,
 * losing it with zero lines. Averaged over seeds and bays that reads as "a
 * weaker arm"; on one bay it reads as what it is.
 *
 *   npx tsx sim/_scratch-excelprobe.ts
 *
 * The cause is a beat, not a probability — the reload is a fixed 1350ms and the
 * bar's round trip a fixed ~222 steps, so a pilot that can only fire in one
 * seventeen-step slice of each round trip spends most of them ready and
 * watching the slice go past. design/balance/timed-clears.md §2i.
 */
import { makeBaseLevel } from "../src/game/level";
import { runBay } from "./runner";
import { ADAPTIVE_BOTS } from "./bots";
import {
  excellentStrategy, naiveStrategy, strategyPilot, timedStrategy,
} from "./aim-strategies";

const SEED = Number(process.env.SEED ?? 1000);
const BAY = Number(process.env.BAY ?? 1);
const MARK = Number(process.env.MARK ?? 1);

for (const [name, spec] of [
  ["naive", naiveStrategy], ["timed", timedStrategy], ["excel", excellentStrategy],
] as const) {
  const pilot = strategyPilot(spec, { bot: ADAPTIVE_BOTS.demo });
  const out = runBay(makeBaseLevel(BAY - 1, MARK), pilot(SEED), SEED);
  console.log(
    `${name.padEnd(6)} shots ${String(out.shots).padStart(3)}`
    + `  lines ${String(out.lines).padStart(3)}`
    + `  ${out.status.padEnd(4)}  grades ${JSON.stringify(out.grades)}`,
  );
}
