// Scratch: WHY is a rebar belt cheap? Instruments the bay directly rather than
// through runBay, so it can read the two things the outcome cannot show — how
// many CRUSHES the lines arrived in (the combo), and how long the bay spent
// above a congestion tier (the payout cap).
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";
import { applyRatchets, type Ratchets } from "../src/game/hazards";
import { applyUpgrades } from "../src/game/upgrades";
import { CARRY_CAP } from "../src/game/run";
import { BOTS } from "./bots";
import { bondHands } from "./counters";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";

const arg = (f: string, d: string): string => {
  const i = process.argv.indexOf(f);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const SEEDS = parseInt(arg("--seeds", "24"), 10);
const MARK = parseInt(arg("--mark", "10"), 10);
const BAY = parseInt(arg("--bay", "5"), 10);
const loadout = loadoutFor(PRIORITY_ORDERS[arg("--build", "material")], MARK);
const DT = 1000 / 60;

const STACKS: [string, Ratchets][] = arg("--stacks", "clean,rebar:3,rebar:6")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((name) => {
    if (name === "clean") return [name, {} as Ratchets];
    const out: Record<string, number> = {};
    for (const part of name.split("+")) {
      const [id, n] = part.split(":");
      out[id] = parseInt(n ?? "1", 10) || 1;
    }
    return [name, out as Ratchets];
  });

function fly(stack: Ratchets) {
  let wins = 0, lines = 0, crushes = 0, shots = 0, end = 0, cong = 0, steps = 0, cubeSteps = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const cfg = makeBaseLevel(BAY - 1, MARK);
    applyUpgrades(cfg, loadout);
    const flown = applyRatchets(cfg, stack);
    if (BAY > 1) flown.startingFunds += CARRY_CAP;
    let myShots = 0, myCrush = 0, tier = 0, myCong = 0, mySteps = 0, myCubes = 0;
    const g = new Game(flown, {
      onShoot: () => { myShots += 1; },
      onLineClear: () => { myCrush += 1; },
      onCongestion: (t) => { tier = t; },
    }, s);
    const bot = bondHands(BOTS.demo(s));
    let now = 0;
    const cap = flown.timeLimitSec > 0 ? flown.timeLimitSec * 60 + 3600 : 36_000;
    while (g.status === "playing" && mySteps < cap) {
      now += DT; bot.act(g, now); g.update(now); mySteps += 1;
      if (tier > 0) myCong += 1;
      myCubes += g.cubes.length;
    }
    if (g.status === "won") wins += 1;
    lines += g.linesTotal; crushes += myCrush; shots += myShots; end += g.score;
    cong += myCong; steps += mySteps; cubeSteps += myCubes;
    g.destroy();
  }
  const n = SEEDS;
  return {
    wins, lines: lines / n, crushes: crushes / n,
    perCrush: crushes ? lines / crushes : 0,
    shots: shots / n, end: end / n,
    congShare: steps ? cong / steps : 0,
    meanPile: steps ? cubeSteps / steps : 0,
    linesPerShot: shots ? lines / shots : 0,
  };
}

console.log(`\n=== WHY — Tier ${MARK} bay ${BAY} · ${SEEDS} paired seeds ===\n`);
console.log(["stack".padEnd(12), "win".padStart(6), "lines".padStart(6), "crush".padStart(6),
  "ln/cr".padStart(6), "shots".padStart(6), "ln/sh".padStart(6), "end$".padStart(7),
  "cong%".padStart(6), "pile".padStart(6)].join(" "));
for (const [name, stack] of STACKS) {
  const r = fly(stack);
  console.log([
    name.padEnd(12), `${r.wins}/${SEEDS}`.padStart(6), r.lines.toFixed(1).padStart(6),
    r.crushes.toFixed(1).padStart(6), r.perCrush.toFixed(2).padStart(6),
    r.shots.toFixed(1).padStart(6), r.linesPerShot.toFixed(3).padStart(6),
    `$${Math.round(r.end)}`.padStart(7), (r.congShare * 100).toFixed(0).padStart(6),
    r.meanPile.toFixed(1).padStart(6),
  ].join(" "));
}
