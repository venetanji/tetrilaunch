// Scratch: what does ONE notch of each material actually cost, same bay and rig?
// "Always avoid slag" is either correct play or superstition; this says which.
import { makeBaseLevel, TIER_COUNT } from "../src/game/level";
import { applyRatchets, HAZARDS, type Ratchets } from "../src/game/hazards";
import { applyUpgrades, newTiers, type UpgradeTiers } from "../src/game/upgrades";
import { BOTS } from "./bots";
import { runBay } from "./runner";

const SEEDS = 24;
const build: UpgradeTiers = { ...newTiers(), bay: 3, launcher: 3, hydraulics: 3, reactor: 3, bonds: 2 };
const mats = HAZARDS.filter((h) => h.kind === "content").map((h) => h.id);

function fly(bay: number, ratchets: Ratchets) {
  let cfg = makeBaseLevel(bay - 1, TIER_COUNT);
  applyUpgrades(cfg, build);
  cfg = applyRatchets(cfg, ratchets);
  cfg.startingFunds += 150;
  let wins = 0, lines = 0, score = 0;
  const why: Record<string, number> = {};
  for (let s = 1; s <= SEEDS; s++) {
    const o = runBay(cfg, BOTS.aim(s), s);
    lines += o.lines; score += o.endScore;
    if (o.status === "won") wins += 1;
    else why[o.lossReason ?? o.status] = (why[o.lossReason ?? o.status] ?? 0) + 1;
  }
  return { win: wins / SEEDS, lines: lines / SEEDS, score: score / SEEDS, why };
}

for (const bay of [5, 8]) {
  console.log(`\n=== Tier 10, bay ${bay} — one notch of each material vs a clean belt (${SEEDS} seeds) ===\n`);
  const base = fly(bay, {});
  console.log(`  ${"clean".padEnd(10)} win ${(base.win * 100).toFixed(0).padStart(3)}%   lines ${base.lines.toFixed(2).padStart(5)}   score ${base.score.toFixed(0).padStart(5)}`);
  const rows: { id: string; dWin: number; dLines: number; dScore: number; why: string }[] = [];
  for (const id of mats) {
    const r = fly(bay, { [id]: 1 } as Ratchets);
    rows.push({
      id, dWin: r.win - base.win, dLines: r.lines - base.lines, dScore: r.score - base.score,
      why: Object.entries(r.why).map(([k, v]) => `${k}:${v}`).join(" "),
    });
  }
  rows.sort((a, b) => a.dLines - b.dLines);
  console.log(`\n  worst first, by lines lost:\n`);
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(10)} dWin ${(r.dWin * 100).toFixed(0).padStart(4)}pp  dLines ${r.dLines.toFixed(2).padStart(6)}  dScore ${r.dScore.toFixed(0).padStart(6)}   ${r.why}`);
  }
}
