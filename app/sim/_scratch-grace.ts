// Scratch: codex's P1 on PR #151 — does the broke grace window still guarantee
// one completed press once the bar can be DRAGGED? The window is sized off the
// undragged Compactor.cycleSteps; the stroke it is guaranteeing is the dragged
// one.
import { makeBaseLevel } from "../src/game/level";
import { applyRatchets } from "../src/game/hazards";
import { applyUpgrades } from "../src/game/upgrades";
import { Compactor, rigidPressDrag, RIGID_PRESS_DRAG_CAP } from "../src/game/compactor";
import { createPhysics } from "../src/game/engine";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";

const DT = 1000 / 60;

/** Steps a round trip takes when the ADVANCE runs at `drag` and the retreat
 *  runs free — the leg split Compactor.update actually flies. */
function draggedCycle(c: Compactor, drag: number): number {
  const span = c.rightX - c.leftX;
  return span / (c.speed * drag) + span / c.speed;
}

console.log("\n=== the broke grace window against a DRAGGED round trip ===\n");
console.log(`worst-case drag at the cap (n=${RIGID_PRESS_DRAG_CAP}):`
  + ` ${rigidPressDrag(RIGID_PRESS_DRAG_CAP).toFixed(4)}`
  + ` (advance is ${(1 / rigidPressDrag(RIGID_PRESS_DRAG_CAP)).toFixed(2)}x longer)\n`);

console.log(["bay".padEnd(22), "cycle".padStart(7), "grace".padStart(7),
  "dragged cycle".padStart(14), "verdict".padStart(9)].join(" "));

const cases: [string, () => Compactor][] = [
  ["Tier 1 bay 1 stock", () => {
    const cfg = makeBaseLevel(0);
    return new Compactor(createPhysics(cfg).world, cfg);
  }],
  ["Tier 10 bay 10 material", () => {
    const cfg = makeBaseLevel(9, 10);
    applyUpgrades(cfg, loadoutFor(PRIORITY_ORDERS.material, 10));
    const flown = applyRatchets(cfg, { rebar: 6 });
    return new Compactor(createPhysics(flown).world, flown);
  }],
  ["Tier 9 bay 10 stock", () => {
    const cfg = makeBaseLevel(9, 9);
    return new Compactor(createPhysics(cfg).world, cfg);
  }],
];

for (const [name, build] of cases) {
  const c = build();
  // The same min(...) Game's constructor computes.
  const grace = Math.min(c.cycleSteps + 2000 / DT, 30_000 / DT);
  const dragged = draggedCycle(c, rigidPressDrag(RIGID_PRESS_DRAG_CAP));
  console.log([
    name.padEnd(22), c.cycleSteps.toFixed(1).padStart(7), grace.toFixed(1).padStart(7),
    dragged.toFixed(1).padStart(14),
    (dragged > grace ? "SHORT" : "ok").padStart(9),
  ].join(" "));
}

// And the same question asked by DRIVING the bar rather than by arithmetic:
// from the worst starting phase (just past full advance, i.e. about to retreat),
// how many steps until the next stroke completes?
console.log("\n=== driven, from the worst phase (bar just reversed) ===\n");
for (const [name, build] of cases) {
  const c = build();
  const grace = Math.min(c.cycleSteps + 2000 / DT, 30_000 / DT);
  const drag = rigidPressDrag(RIGID_PRESS_DRAG_CAP);
  // Put it exactly at the reversal: at rightX, already flipped to retreating.
  while (c.strokes === 0) c.update();
  const from = c.strokes;
  let steps = 0;
  while (c.strokes === from && steps < 100_000) { c.update(drag); steps += 1; }
  console.log(`  ${name.padEnd(22)} next stroke at step ${String(steps).padStart(4)}`
    + `  · grace fires at ${grace.toFixed(0).padStart(4)}`
    + `  → ${steps > grace ? "BROKE VERDICT LANDS FIRST" : "ok"}`);
}
