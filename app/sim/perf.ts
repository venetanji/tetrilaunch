#!/usr/bin/env npx tsx
// Physics step-cost CLI: "does the game stutter with lots of pieces on
// screen, and at what count?"
//
//   npx tsx sim/perf.ts [--counts 50,100,150,200,300,400] [--steps 600]
//
// For each cube count N, builds a fresh bay-1 Game with N cubes already on
// the field (no cannon shots involved) in two shapes:
//   - variant A ("loose"): N independent cubes, no joints.
//   - variant B ("cliques"): N cubes grouped into 4-cube cliques (a fully
//     connected K4 of 6 distance joints each), matching how a real
//     tetromino's cubes are joined in pieces.ts's createTetrisPiece.
// then times g.update() (the same per-frame call the real game drives) for
// --steps consecutive frames after a 60-frame warmup.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Matter from "matter-js";
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";
import { CELL, WORLD } from "../src/game/engine";
import { PIECE_COLORS } from "../src/game/theme";
import { mulberry32 } from "../src/game/mods";
import type { Cube } from "../src/game/pieces";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DT = 1000 / 60;
const FRAME_BUDGET_MS = 1000 / 60; // 16.67ms

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { counts: number[]; steps: number } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const counts = (get("--counts") ?? "50,100,150,200,300,400")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const steps = parseInt(get("--steps") ?? "600", 10);
  return { counts, steps };
}

// ---------------------------------------------------------------------------
// Cube placement — mirrors pieces.ts's createTetrisPiece body opts exactly
// (CELL size, friction .5, frictionAir .012, restitution .05, density .001,
// chamfer 3, label "cube") so the perf test stresses the same body shape the
// real game spawns.
// ---------------------------------------------------------------------------

const RIGHT_HALF_X0 = WORLD.width / 2; // 640
const COLS = Math.floor((WORLD.width - RIGHT_HALF_X0) / CELL); // 16
const START_X = RIGHT_HALF_X0 + CELL / 2;
const START_Y = WORLD.height - CELL / 2;
const JITTER = 2; // px, so the packed grid isn't perfectly stacked

function makeCubeBody(x: number, y: number): Matter.Body {
  return Matter.Bodies.rectangle(x, y, CELL, CELL, {
    friction: 0.5,
    frictionAir: 0.012,
    restitution: 0.05,
    density: 0.001,
    label: "cube",
    chamfer: { radius: 3 },
  });
}

/** Variant A: N independent cubes, packed grid filling the right half. */
function placeLoose(g: Game, n: number, rng: () => number): void {
  for (let i = 0; i < n; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = START_X + col * CELL + (rng() * 2 - 1) * JITTER;
    const y = START_Y - row * CELL + (rng() * 2 - 1) * JITTER;
    const body = makeCubeBody(x, y);
    Matter.Composite.add(g.phys.world, body);
    g.cubes.push({ body, type: "I", color: PIECE_COLORS.I, blinkStart: null });
  }
}

/** Variant B: N cubes grouped into 4-cube cliques (2x2 blocks), every pair
 *  within a clique joined by a distance constraint (6 constraints per full
 *  clique, same K4 topology as createTetrisPiece). */
function placeCliques(g: Game, n: number, rng: () => number, jointStiffness: number): void {
  const cliqueCols = Math.max(1, Math.floor(COLS / 2));
  const offsets: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
  let placed = 0;
  let cliqueIndex = 0;
  while (placed < n) {
    const col = cliqueIndex % cliqueCols;
    const row = Math.floor(cliqueIndex / cliqueCols);
    const baseX = START_X + col * CELL * 2;
    const baseY = START_Y - row * CELL * 2;
    const clique: Cube[] = [];
    for (const [ox, oy] of offsets) {
      if (placed >= n) break;
      const x = baseX + ox * CELL + (rng() * 2 - 1) * JITTER;
      const y = baseY - oy * CELL + (rng() * 2 - 1) * JITTER;
      const body = makeCubeBody(x, y);
      Matter.Composite.add(g.phys.world, body);
      const cube: Cube = { body, type: "O", color: PIECE_COLORS.O, blinkStart: null };
      g.cubes.push(cube);
      clique.push(cube);
      placed += 1;
    }
    for (let i = 0; i < clique.length; i++) {
      for (let j = i + 1; j < clique.length; j++) {
        const a = clique[i].body;
        const b = clique[j].body;
        const rest = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        const constraint = Matter.Constraint.create({
          bodyA: a,
          bodyB: b,
          length: rest,
          stiffness: jointStiffness,
          damping: 0.1,
          render: { visible: false },
        });
        Matter.Composite.add(g.phys.world, constraint);
        g.constraints.push(constraint);
      }
    }
    cliqueIndex += 1;
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

interface TimingResult {
  variant: "loose" | "cliques";
  n: number;
  avgMs: number;
  p95Ms: number;
  worstMs: number;
  overBudgetPct: number;
}

function buildGame(variant: "loose" | "cliques", n: number): Game {
  const cfg = { ...makeBaseLevel(0), timeLimitSec: 0 };
  const g = new Game(cfg);
  const rng = mulberry32(1000 + n); // fixed per-N seed, reproducible jitter
  if (variant === "loose") placeLoose(g, n, rng);
  else placeCliques(g, n, rng, cfg.jointStiffness);
  return g;
}

/**
 * A stress-test pile can legitimately trip the real game's topout/broke/time
 * loss conditions (e.g. a packed grid of 400 cubes physically has to stack
 * above the topout line) — but Game.update() no-ops once status !== "playing",
 * which would silently zero out every remaining timed sample. This harness
 * only cares about steady-state per-step physics cost, not win/loss rules, so
 * status is forced back to "playing" immediately AFTER each timed call (never
 * inside the timed window, so it doesn't affect the measurement itself).
 */
function forcePlaying(g: Game): void {
  if (g.status !== "playing") {
    g.status = "playing";
    g.lossReason = null;
  }
}

function timeVariant(variant: "loose" | "cliques", n: number, steps: number): TimingResult {
  const g = buildGame(variant, n);
  let now = 0;

  for (let i = 0; i < 60; i++) {
    now += DT;
    g.update(now);
    forcePlaying(g);
  }

  const durations: number[] = new Array(steps);
  for (let i = 0; i < steps; i++) {
    now += DT;
    const t0 = process.hrtime.bigint();
    g.update(now);
    const t1 = process.hrtime.bigint();
    forcePlaying(g);
    durations[i] = Number(t1 - t0) / 1e6;
  }
  g.destroy();

  const sorted = [...durations].sort((a, b) => a - b);
  const avgMs = sorted.reduce((s, d) => s + d, 0) / sorted.length;
  const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
  const worstMs = sorted[sorted.length - 1];
  const overBudgetPct = (durations.filter((d) => d > FRAME_BUDGET_MS).length / durations.length) * 100;

  return { variant, n, avgMs, p95Ms, worstMs, overBudgetPct };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { counts, steps } = parseArgs(process.argv.slice(2));
  console.log("# Tetrilaunch physics step-cost sweep\n");
  console.log(`counts=${counts.join(",")} steps=${steps} (60-frame warmup, not timed)\n`);

  const results: TimingResult[] = [];
  for (const variant of ["loose", "cliques"] as const) {
    for (const n of counts) {
      results.push(timeVariant(variant, n, steps));
    }
  }

  console.log("| Variant | N | Avg ms | p95 ms | Worst ms | % over 16.67ms |");
  console.log("|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.variant} | ${r.n} | ${r.avgMs.toFixed(3)} | ${r.p95Ms.toFixed(3)} | ` +
        `${r.worstMs.toFixed(3)} | ${r.overBudgetPct.toFixed(1)}% |`,
    );
  }
  console.log();

  for (const variant of ["loose", "cliques"] as const) {
    const ok = results.filter((r) => r.variant === variant && r.p95Ms < 8).map((r) => r.n);
    const verdict = ok.length ? Math.max(...ok) : null;
    console.log(
      `Verdict (${variant}): largest N with p95 < 8ms = ${verdict === null ? "none tested" : verdict}`,
    );
  }

  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `perf-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ counts, steps, results }, null, 2));
  console.log(`\nWrote ${results.length} rows to ${outPath}`);
}

main();
