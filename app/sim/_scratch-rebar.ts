// Scratch: PAIRED per-axis pricing at high Tiers, the shape --mode counter uses
// but sweeping the RATCHET STACK instead of the counter kit. One bay, one rig,
// the same seeds under every stack, so each row is a paired comparison.
import { makeBaseLevel } from "../src/game/level";
import { applyRatchets, type Ratchets } from "../src/game/hazards";
import { applyUpgrades } from "../src/game/upgrades";
import { CARRY_CAP } from "../src/game/run";
import { BOTS } from "./bots";
import { bondHands } from "./counters";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";
import { runBay } from "./runner";

const arg = (f: string, d: string): string => {
  const i = process.argv.indexOf(f);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const SEEDS = parseInt(arg("--seeds", "48"), 10);
const MARK = parseInt(arg("--mark", "8"), 10);
const BAY = parseInt(arg("--bay", "10"), 10);
const BUILD = arg("--build", "material");
const BOT = arg("--bot", "demo");

const DEFAULT_STACKS = "clean,rebar:1,rebar:3,rebar:6,cryo:1,cryo:3,slag:3,tar:3,magnetic:3,volatile:3,volatile:6";
const STACKS: [string, Ratchets][] = arg("--stacks", DEFAULT_STACKS)
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((name) => {
    if (name === "clean") return [name, {} as Ratchets];
    const out: Ratchets = {};
    for (const part of name.split("+")) {
      const [id, n] = part.split(":");
      (out as Record<string, number>)[id] = parseInt(n ?? "1", 10) || 1;
    }
    return [name, out];
  });

const loadout = loadoutFor(PRIORITY_ORDERS[BUILD], MARK);

function fly(stack: Ratchets) {
  let wins = 0, lines = 0, shots = 0, end = 0, maxCubes = 0, lost = 0, secs = 0;
  const why: Record<string, number> = {};
  for (let s = 1; s <= SEEDS; s++) {
    const cfg = makeBaseLevel(BAY - 1, MARK);
    applyUpgrades(cfg, loadout);
    const flown = applyRatchets(cfg, stack);
    if (BAY > 1 && !process.argv.includes("--nocarry")) flown.startingFunds += CARRY_CAP;
    const o = runBay(flown, bondHands(BOTS[BOT](s)), s);
    if (o.status === "won") wins += 1;
    else why[o.lossReason ?? o.status] = (why[o.lossReason ?? o.status] ?? 0) + 1;
    lines += o.lines; shots += o.shots; end += o.endScore;
    maxCubes += o.maxCubes; lost += o.lost; secs += o.secs;
  }
  const n = SEEDS;
  return {
    wins, lines: lines / n, shots: shots / n, end: end / n,
    maxCubes: maxCubes / n, lost: lost / n, secs: secs / n,
    why: Object.entries(why).map(([k, v]) => `${k}x${v}`).join(" "),
  };
}

console.log(`\n=== Tier ${MARK} bay ${BAY} · rig ${BUILD} · pilot ${BOT}+bond · ${SEEDS} paired seeds ===\n`);
console.log(["stack".padEnd(12), "win".padStart(7), "lines".padStart(6), "shots".padStart(6),
  "end$".padStart(7), "maxCube".padStart(8), "lost".padStart(6), "secs".padStart(6), "  losses"].join(" "));
for (const [name, stack] of STACKS) {
  const r = fly(stack);
  console.log([
    name.padEnd(12), `${r.wins}/${SEEDS}`.padStart(7), r.lines.toFixed(1).padStart(6),
    r.shots.toFixed(1).padStart(6), `$${Math.round(r.end)}`.padStart(7),
    r.maxCubes.toFixed(1).padStart(8), r.lost.toFixed(1).padStart(6),
    r.secs.toFixed(0).padStart(6), "  " + r.why,
  ].join(" "));
}
