// Scratch: are the two 100%-REBAR drills still winnable? They are the authored
// bays this change touches hardest (materialRate 1 and a 16-launch budget), and
// a teaching bay that cannot be beaten is a shipped bug, not a difficulty.
import { DRILLS, levelForDrill } from "../src/game/drills";
import { BOTS } from "./bots";
import { bondHands } from "./counters";
import { runBay } from "./runner";

const SEEDS = parseInt(process.argv[process.argv.indexOf("--seeds") + 1] ?? "24", 10);
const IDS = (process.argv[process.argv.indexOf("--ids") + 1] ?? "mat-rebar,bondbreaker,mat-magnetic,mat-cryo")
  .split(",");

console.log(`\n=== drills, ${SEEDS} seeds, demo+bond pilot ===\n`);
console.log(["drill".padEnd(16), "win".padStart(7), "lines".padStart(6), "shots".padStart(6), "  losses"].join(" "));
for (const id of IDS) {
  const spec = DRILLS[id];
  if (!spec) { console.log(`${id}: NOT FOUND`); continue; }
  let wins = 0, lines = 0, shots = 0;
  const why: Record<string, number> = {};
  for (let s = 1; s <= SEEDS; s++) {
    const cfg = levelForDrill(id, spec);
    const o = runBay(cfg, bondHands(BOTS.demo(s)), s);
    if (o.status === "won") wins += 1;
    else why[o.lossReason ?? o.status] = (why[o.lossReason ?? o.status] ?? 0) + 1;
    lines += o.lines; shots += o.shots;
  }
  console.log([
    id.padEnd(16), `${wins}/${SEEDS}`.padStart(7), (lines / SEEDS).toFixed(1).padStart(6),
    (shots / SEEDS).toFixed(1).padStart(6),
    "  " + Object.entries(why).map(([k, v]) => `${k}x${v}`).join(" "),
  ].join(" "));
}
