import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";
import { predictTrajectory } from "../src/game/cannon";
import { pathStrands } from "../src/game/chute";

type Model = { frictionAir: number; steps: number; wind: number; windAt: (step: number) => number };
type Internals = { gAccel: number; windCur: number; previewModel(): Model };
const internals = (g: Game) => g as unknown as Internals;
function exact(g: Game): void {
  const p = internals(g).previewModel();
  const expected = predictTrajectory(g.cannon.tip, g.cannon.velocity, internals(g).gAccel,
    p.frictionAir, p.steps, p.windAt);
  assert.deepEqual(g.trajectory, expected, "cached preview must equal the shared integrator exactly");
  assert.equal(g.trajectoryStrands, pathStrands(expected, g.strandCutoffX));
}

if (process.argv.includes("--bench")) {
  const iterations = 50_000;
  for (const changing of [false, true]) {
    const times: number[] = [];
    const g = new Game(makeBaseLevel(1));
    for (let round = 0; round < 6; round++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        if (changing) g.cannon.angle = (i % 1000) / 1000 - 0.5;
        g.updateTrajectory();
      }
      if (round) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(`${changing ? "changing aim" : "unchanged"}: ${times[2].toFixed(2)}ms / ${iterations} calls (median of 5, warmup excluded)`);
    g.destroy();
  }
} else {
  const g = new Game(makeBaseLevel(1));
  let previous = g.trajectory;
  g.updateTrajectory();
  assert.equal(g.trajectory, previous, "unchanged inputs reuse the trajectory array");
  exact(g);

  // Vary each numeric dependency independently, including coordinates whose
  // normal Cannon getters couple together when angle or power changes.
  const tip = { ...g.cannon.tip };
  const velocity = { ...g.cannon.velocity };
  const model = internals(g).previewModel();
  let wind = g.windNow;
  let cutoff = g.strandCutoffX;
  Object.defineProperty(g.cannon, "tip", { get: () => ({ ...tip }) });
  Object.defineProperty(g.cannon, "velocity", { get: () => ({ ...velocity }) });
  Object.defineProperty(g, "strandCutoffX", { get: () => cutoff });
  internals(g).previewModel = () => ({ ...model, wind, windAt: () => wind });
  for (const [label, change] of [
    ["tip x", () => tip.x++], ["tip y", () => tip.y++],
    ["velocity x", () => velocity.x++], ["velocity y", () => velocity.y++],
    ["gravity", () => internals(g).gAccel += 0.01],
    ["air friction", () => model.frictionAir += 0.001],
    ["step count", () => model.steps++], ["wind", () => wind += 0.002],
    ["strand cutoff", () => cutoff += 1000],
  ] as const) {
    previous = g.trajectory;
    change();
    g.updateTrajectory();
    assert.notEqual(g.trajectory, previous, `${label} invalidates the cached prediction`);
    exact(g);
    previous = g.trajectory;
    g.updateTrajectory();
    assert.equal(g.trajectory, previous, `${label} settles back to reuse`);
  }
  g.destroy();

  const live = new Game(makeBaseLevel(1));
  for (const change of [
    () => live.aimAt({ x: 1100, y: 500 }),
    () => { internals(live).windCur = 0.025; },
    () => { live.level.windAssist = 0.4; },
    () => { live.bombCharges = 1; assert.equal(live.armBomb(), true); },
    () => { live.armBomb(); },
  ]) {
    change();
    live.updateTrajectory();
    exact(live);
  }
  const fresh = new Game(makeBaseLevel(1));
  assert.notEqual(fresh.trajectory, live.trajectory, "new bays never share a cached array");
  exact(fresh);
  fresh.destroy();
  live.destroy();
  console.log("Trajectory cache: reuse, nine independent invalidations, exact integrator, aim/wind/charge/new-bay checks passed.");
}
