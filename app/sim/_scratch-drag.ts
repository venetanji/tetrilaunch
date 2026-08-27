// Scratch: how much rigid cargo is actually IN FRONT OF THE FACE, per notch
// count? The drag's cap can only be chosen from this distribution — a cap under
// what a belt at the ceiling produces flattens the axis, and a cap over it is
// dead code.
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";
import { applyRatchets, type Ratchets } from "../src/game/hazards";
import { applyUpgrades } from "../src/game/upgrades";
import { CARRY_CAP } from "../src/game/run";
import { MATERIAL_SPEC } from "../src/game/theme";
import { BOTS } from "./bots";
import { bondHands } from "./counters";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";

const arg = (f: string, d: string): string => {
  const i = process.argv.indexOf(f);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const SEEDS = parseInt(arg("--seeds", "16"), 10);
const MARK = parseInt(arg("--mark", "10"), 10);
const BAY = parseInt(arg("--bay", "10"), 10);
const loadout = loadoutFor(PRIORITY_ORDERS["material"], MARK);
const DT = 1000 / 60;

const STACKS = arg("--stacks", "rebar:1,rebar:3,rebar:6").split(",");

// Count exactly what Game.rigidPressDrag counts, but WITHOUT the cap, so the
// histogram says what the cap should be rather than echoing it back.
function rigidInPath(g: Game): number {
  const bonded = new Set<number>();
  for (const c of g.constraints) {
    if (c.bodyA) bonded.add(c.bodyA.id);
    if (c.bodyB) bonded.add(c.bodyB.id);
  }
  const face = g.compactor.x + g.compactor.width / 2;
  const top = g.compactor.top;
  let n = 0;
  for (const cube of g.cubes) {
    if (cube.blinkStart !== null) continue;
    if (!MATERIAL_SPEC[cube.material].rigid) continue;
    const b = cube.body;
    if (b.position.x < face || b.position.y < top) continue;
    if (bonded.has(b.id)) n += 1;
  }
  return n;
}

console.log(`\n=== rigid cubes in the bar's path — Tier ${MARK} bay ${BAY}, ${SEEDS} seeds ===`);
console.log(`(pressing steps only; p50/p90/p99/max over the whole bay)\n`);
console.log(["stack".padEnd(10), "mean".padStart(6), "p50".padStart(5), "p90".padStart(5),
  "p99".padStart(5), "max".padStart(5), "share>0".padStart(8)].join(" "));
for (const name of STACKS) {
  const stack: Ratchets = {};
  for (const part of name.split("+")) {
    const [id, k] = part.split(":");
    (stack as Record<string, number>)[id] = parseInt(k ?? "1", 10) || 1;
  }
  const counts: number[] = [];
  for (let s = 1; s <= SEEDS; s++) {
    const cfg = makeBaseLevel(BAY - 1, MARK);
    applyUpgrades(cfg, loadout);
    const flown = applyRatchets(cfg, stack);
    if (BAY > 1) flown.startingFunds += CARRY_CAP;
    const g = new Game(flown, {}, s);
    const bot = bondHands(BOTS.demo(s));
    let now = 0, steps = 0;
    const cap = flown.timeLimitSec > 0 ? flown.timeLimitSec * 60 + 3600 : 36_000;
    while (g.status === "playing" && steps < cap) {
      now += DT; bot.act(g, now);
      if (g.compactor.pressing) counts.push(rigidInPath(g));
      g.update(now); steps += 1;
    }
    g.destroy();
  }
  counts.sort((a, b) => a - b);
  const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(counts.length * p))] ?? 0;
  const mean = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
  console.log([
    name.padEnd(10), mean.toFixed(2).padStart(6), String(q(0.5)).padStart(5),
    String(q(0.9)).padStart(5), String(q(0.99)).padStart(5),
    String(counts[counts.length - 1] ?? 0).padStart(5),
    `${((counts.filter((c) => c > 0).length / (counts.length || 1)) * 100).toFixed(0)}%`.padStart(8),
  ].join(" "));
}
