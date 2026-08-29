// Scratch probe: the TICK-BOUNDARY audit for the timing grade's clock.
//
// Replays game.ts's own step order — sample, stamp, compactor.update, clear —
// around the bar's stops, and prints the grade a row actually receives. Every
// band boundary the design claims lives on one of these ticks.
//
// ONE STRUCTURAL FACT FIRST, and it decides which boundaries can even exist: a
// row only clears when the compaction zone is narrow enough that the row's
// width IS the zone's (`zoneGrid`'s `needed = round(zoneW / CELL)`). The zone is
// narrowest at FULL ADVANCE, so clears cluster in the last steps of the
// advancing stroke — which is exactly where the fencepost lives. At the OPEN
// stop the zone is at its widest (12 cells against a row of 8), and `pressing`
// is false there anyway, so no clear is ever evaluated on that tick.
import Matter from "matter-js";
import { createPhysics, WORLD, WALL_INNER, CELL } from "../src/game/engine";
import { Compactor } from "../src/game/compactor";
import { makeBaseLevel } from "../src/game/level";
import { stampLandings, updateLineClear } from "../src/game/lineClear";
import type { Cube } from "../src/game/pieces";
import type { ClearClock } from "../src/game/grades";

const level = makeBaseLevel(0);

/** A bay whose bar is ADVANCING and exactly `stepsBefore` steps short of the
 *  right stop. Driven, never teleported — the bar's own travel is what puts it
 *  there, so the counters are whatever a real bay would hold. */
function bayBeforeRightStop(stepsBefore: number) {
  const phys = createPhysics(level);
  const bar = new Compactor(phys.world, level);
  // Two full round trips, so `strokes` and `halfCycles` are past zero and a
  // sweep count of 1 is distinguishable from "the bay just opened".
  while (bar.halfCycles < 4) bar.update();
  while (bar.dir !== 1) bar.update();
  while (bar.rightX - bar.x > stepsBefore * bar.speed + 0.001) bar.update();
  return { phys, bar };
}

function row(phys: ReturnType<typeof createPhysics>): Cube[] {
  const cubes: Cube[] = [];
  const rowY = WORLD.height - CELL / 2;
  for (let k = 0; k < level.compactorMinLineCells; k++) {
    const body = Matter.Bodies.rectangle(
      WALL_INNER - CELL / 2 - k * CELL, rowY, CELL, CELL, { label: "cube" },
    );
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
    Matter.Composite.add(phys.world, body);
    cubes.push({
      body, type: "O", color: "#fff", blinkStart: null,
      material: "standard", struck: true, shipment: 1,
    });
  }
  return cubes;
}

interface Step { grade: string | null; atStop: boolean }

/** One step of game.ts's real order. `sampled` picks which clock the CLEAR is
 *  graded against: the step's own pre-update sample (the fix) or the bar's live
 *  post-update reading (what shipped). */
function step(
  bar: Compactor, phys: ReturnType<typeof createPhysics>, cubes: Cube[],
  sampled: boolean, stampNow: boolean, stepNo: number,
): Step {
  const clock: ClearClock = { stroke: bar.strokes, halfCycle: bar.halfCycles, step: stepNo };
  if (stampNow) stampLandings(cubes, clock);
  const pressing = bar.pressing;
  const before = bar.strokes;
  bar.update();
  const atStop = bar.strokes !== before;
  if (!pressing) return { grade: null, atStop };
  const live: ClearClock = { stroke: bar.strokes, halfCycle: bar.halfCycles, step: stepNo };
  const out = updateLineClear(
    phys.world, cubes, bar, level, [],
    // Both gates open: this probe is about the CLOCK's fencepost and nothing
    // else. The row builder stamps the same shipment.
    { clock: sampled ? clock : live, congested: false, shipment: 1 },
  );
  return { grade: out.graded[0]?.grade ?? null, atStop };
}

/** Land the row `before` steps short of the stop and let it clear. */
function landAndClear(before: number, sampled: boolean): { grade: string | null; onStop: boolean } {
  const { phys, bar } = bayBeforeRightStop(before);
  const cubes = row(phys);
  let grade: string | null = null;
  let onStop = false;
  for (let i = 0; i < 600 && grade === null; i++) {
    const s = step(bar, phys, cubes, sampled, i === 0, i);
    grade = s.grade;
    if (grade !== null) onStop = s.atStop;
  }
  Matter.Engine.clear(phys.engine);
  return { grade, onStop };
}

console.log("A landing N steps short of the right stop, on a row that is already complete");
console.log("| steps before stop | cleared on the stop tick? | shipped (live) | fixed (step) |");
console.log("|---|---|---|---|");
for (const before of [0, 1, 2, 5]) {
  const bad = landAndClear(before, false);
  const good = landAndClear(before, true);
  console.log(
    `| ${before} | ${bad.onStop ? "yes" : "no"} | ${bad.grade ?? "-"} | ${good.grade ?? "-"} |`,
  );
}

/* THE REVERSAL TICK — the EXCELLENT/GOOD boundary at the OPEN stop.
 *
 * No clear is ever evaluated during a retreat (`pressing` is false), so the
 * open stop has no clear-side exposure at all. What it has is a STAMP-side one:
 * a cube first coming to rest within a tick of the flip is attributed to one
 * stroke or the other, and that decides whether the next press sells it as
 * EXCELLENT or GOOD. Land a complete row at each tick around the flip and read
 * the grade the following advance gives it. */
console.log("\nA landing N ticks around the OPEN stop's reversal, cleared on the next advance");
console.log("| landed | bar was | grade |");
console.log("|---|---|---|");
for (const offset of [-2, -1, 0, 1, 2]) {
  const phys = createPhysics(level);
  const bar = new Compactor(phys.world, level);
  while (bar.halfCycles < 4) bar.update();
  // Walk to one tick before the flip at the open stop.
  while (bar.dir !== -1) bar.update();
  while (bar.x - bar.leftX > bar.speed + 0.001) bar.update();
  const cubes = row(phys);
  // `offset` < 0 lands before the flip tick, > 0 after it.
  for (let i = 0; i < Math.max(0, offset); i++) step(bar, phys, cubes, true, false, i);
  // Negative offsets need no walk: the bar is already parked one tick short of
  // the flip, and every tick before it is the same retreating stroke.
  const dirAtLanding: string = bar.pressing ? "advancing" : "retreating";
  let grade: string | null = null;
  for (let i = 0; i < 600 && grade === null; i++) {
    grade = step(bar, phys, cubes, true, i === 0, Math.max(0, offset) + i).grade;
  }
  console.log(`| flip${offset >= 0 ? "+" : ""}${offset} | ${dirAtLanding} | ${grade ?? "-"} |`);
  Matter.Engine.clear(phys.engine);
}

console.log("\nA landing on the stop tick whose row is NOT yet complete —");
console.log("it must still be charged the sweep that really happened.");
for (const sampled of [false, true]) {
  const { phys, bar } = bayBeforeRightStop(0);
  const cubes = row(phys);
  // Hide one cube off its slot so the stop tick finds a hole, then restore it
  // once the bar is advancing again.
  const stray = cubes[0];
  const home = stray.body.position.x;
  Matter.Body.setPosition(stray.body, { x: home - CELL / 2, y: stray.body.position.y });
  step(bar, phys, cubes, sampled, true, 0);
  Matter.Body.setPosition(stray.body, { x: home, y: stray.body.position.y });
  let g: string | null = null;
  for (let i = 0; i < 600 && g === null; i++) g = step(bar, phys, cubes, sampled, false, 1 + i).grade;
  console.log(`  ${sampled ? "fixed " : "shipped"}: ${g ?? "-"}`);
  Matter.Engine.clear(phys.engine);
}
