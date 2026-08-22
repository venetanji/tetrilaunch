/**
 * PATTERN CONTRACT AUDIT — are the zero-waste Contracts actually finishable?
 *
 * sim/systems.ts asserts the invariants that must hold on every build. This is
 * the other half: a sweep that MEASURES how the pattern generator behaves across
 * the whole space it can emit, so the numbers behind those invariants can be
 * re-derived rather than remembered.
 *
 * It exists because "provably feasible" turned out to have two meanings and the
 * generator only guaranteed the weaker one. tiling.ts proves the inventory PACKS
 * the goal rectangle. It says nothing about whether those pieces, arriving one
 * at a time in a shuffled order into a bay with gravity, can be assembled into
 * that packing — and that is the question the player is actually asked.
 *
 * The gap is not theoretical, which is what this sweep exists to show. Run it:
 *
 *   npm run sim:patterns
 *   npm run sim:patterns -- --seeds 3000 --tiers 5,6,7 --orders 200
 *
 * Columns:
 *   packs   tiling.ts's guarantee — the multiset fills a goal x cols rectangle.
 *   drop%   share of arrival orders finishable landing each shipment straight
 *           down. The strict reading, and how a player reasons about the bay.
 *   tuck%   share finishable if a shipment may come to rest in any pocket it
 *           fits. The generous reading — an upper bound on what the arc, the
 *           tumbling and the press's sideways shove can buy.
 */
import { isBuildable, type BuildModel } from "../src/game/buildable";
import {
  DAILY_COUNT, dealPatternQueue, generateContract, levelForContract, type Contract,
} from "../src/game/contracts";
import { SIZE_SPEC } from "../src/game/pieces";
import { tilesRegion } from "../src/game/tiling";
import type { PieceType } from "../src/game/theme";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SEEDS = Number(arg("seeds", "1500"));
const ORDERS = Number(arg("orders", "60"));
const TIERS = arg("tiers", "1,2,3,4,5,6,7,8,9").split(",").map(Number);
/** tuck% is off by default. A tuck solve explores every pocket on the board
 *  rather than one landing per column, and at sixteen dominoes that is 77
 *  seconds for a single order — enough to turn this sweep from minutes into
 *  hours for a column that only ever refines "how bad is bad". */
const WANT_TUCK = process.argv.includes("--tuck");

/**
 * Share of random arrival orders that can be finished under `model`.
 *
 * Sampled rather than exhaustive: the bay shuffles at random, so a random sample
 * is the question the player actually faces, and the exhaustive walk costs hours
 * at eight shipments to sharpen an answer nothing depends on.
 *
 * Distinct orders are solved once and weighted. Not a micro-optimisation — a
 * domino Contract has ONE distinct order however many shipments it holds
 * (pieceCells returns the same domino for every type), so without this the
 * cheapest inventory on the board is also the most expensive to measure.
 */
function orderRate(c: Contract, cols: number, model: BuildModel, n: number): number {
  const rng = mulberry32(0x5eed ^ (c.queue.length * 131) ^ c.goal);
  const drawn = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const order = [...c.queue];
    for (let j = order.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [order[j], order[k]] = [order[k], order[j]];
    }
    const key = order.join("");
    drawn.set(key, (drawn.get(key) ?? 0) + 1);
  }
  let ok = 0;
  for (const [key, weight] of drawn) {
    if (isBuildable([...key] as PieceType[], cols, c.pieceSize, model)) ok += weight;
  }
  return ok / n;
}

interface Row { key: string; tiers: Set<number>; seen: number; contract: Contract; cols: number; }

const rows = new Map<string, Row>();
let sampled = 0;
for (let s = 0; s < SEEDS; s++) {
  const seed = 20260101 + s;
  for (const tier of TIERS) {
    for (let slot = 0; slot < DAILY_COUNT; slot++) {
      const c = generateContract(seed, tier, slot);
      if (c.kind !== "pattern") continue;
      sampled += 1;
      const cols = levelForContract(c).compactorMinLineCells;
      // Dedupe on the SHAPES, not the labels. pieceCells returns one fixed
      // domino for every type, so all seven of a tiny Contract's type names are
      // the same piece — the 894 "distinct" domino inventories at goal 4 are one
      // puzzle wearing 894 names, and measuring each separately is the whole
      // reason this sweep used to run for hours.
      const shapes = c.pieceSize === "tiny"
        ? `x${c.queue.length}`
        : [...c.queue].sort().join("");
      const key = `${c.pieceSize}|${c.goal}|${shapes}`;
      const row = rows.get(key) ?? { key, tiers: new Set<number>(), seen: 0, contract: c, cols };
      row.tiers.add(tier);
      row.seen += 1;
      rows.set(key, row);
    }
  }
}

console.log("# Pattern Contract audit\n");
console.log(
  `${sampled} pattern Contracts generated over ${SEEDS} seeds x tiers ` +
  `${TIERS.join(",")}; ${rows.size} distinct inventories.\n`,
);

interface Measured extends Row { packs: boolean; drop: number; tuck: number; dealMs: number; dealt: boolean; }
const measured: Measured[] = [];

for (const row of rows.values()) {
  const c = row.contract;
  const packs = tilesRegion(c.queue, c.goal, row.cols, c.pieceSize);
  const drop = orderRate(c, row.cols, "drop", ORDERS);
  // A queue every order of which survives the strict reading needs no generous
  // one — tuck admits every drop landing and then some. Where it IS needed it
  // gets a much coarser sample, and only when asked for; see WANT_TUCK.
  const tuck = drop === 1 ? 1 : WANT_TUCK ? orderRate(c, row.cols, "tuck", 8) : NaN;
  // The real production path, not a re-implementation of it: what matters is
  // whether the queue a player is actually handed can be finished, and that is
  // dealPatternQueue's answer to give.
  const rng = mulberry32(0xdea1 ^ row.seen);
  const t0 = Date.now();
  const order = dealPatternQueue(c, row.cols, rng);
  const dealMs = Date.now() - t0;
  const dealt = isBuildable(order, row.cols, c.pieceSize, "drop")
    || isBuildable(order, row.cols, c.pieceSize, "tuck");
  measured.push({ ...row, packs, drop, tuck, dealMs, dealt });
  // Progress on stderr, so the markdown on stdout stays pipeable and a sweep
  // that takes minutes doesn't read as a hang.
  process.stderr.write(`\r  measured ${measured.length}/${rows.size}   `);
}
process.stderr.write("\n");

const pct = (v: number) => (Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`);

console.log("## By tier\n");
console.log("| tier | inventories | all pack | min drop% | mean drop% | mean tuck% | dealable |");
console.log("|---|---|---|---|---|---|---|");
for (const tier of TIERS) {
  const mine = measured.filter((m) => m.tiers.has(tier));
  if (mine.length === 0) continue;
  const mean = (f: (m: Measured) => number) => {
    const vs = mine.map(f).filter((v) => !Number.isNaN(v));
    return vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : NaN;
  };
  console.log(
    `| ${tier} | ${mine.length} | ${mine.every((m) => m.packs) ? "yes" : "NO"} ` +
    `| ${pct(Math.min(...mine.map((m) => m.drop)))} | ${pct(mean((m) => m.drop))} ` +
    `| ${WANT_TUCK ? pct(mean((m) => m.tuck)) : "—"} ` +
    `| ${mine.filter((m) => m.dealt).length}/${mine.length} |`,
  );
}

console.log("\n## Worst inventories, by share of arrival orders that can be finished\n");
console.log("| goal | size | inventory | tiers | packs | drop% | tuck% | dealable |");
console.log("|---|---|---|---|---|---|---|---|");
for (const m of [...measured].sort((a, b) => a.drop - b.drop || a.tuck - b.tuck).slice(0, 30)) {
  console.log(
    `| ${m.contract.goal} | ${m.contract.pieceSize} | ${m.contract.queue.join("")} ` +
    `| ${[...m.tiers].sort((a, b) => a - b).join(",")} | ${m.packs ? "yes" : "NO"} ` +
    `| ${pct(m.drop)} | ${pct(m.tuck)} | ${m.dealt ? "yes" : "NO"} |`,
  );
}

const cubes = (m: Measured) => m.contract.queue.length * SIZE_SPEC[m.contract.pieceSize].cubes;
console.log("\n## Totals\n");
console.log(`- inventories that do not pack at all: **${measured.filter((m) => !m.packs).length}** (tiling.ts's guarantee)`);
console.log(`- deals that could not be proven finishable: **${measured.filter((m) => !m.dealt).length}**`);
console.log(`- inventories where SOME arrival order is unfinishable: **${measured.filter((m) => m.drop < 1).length}** of ${measured.length}`);
console.log(`- inventories where MOST arrival orders are unfinishable: **${measured.filter((m) => m.drop < 0.5).length}**`);
console.log(`- worst deal search: **${Math.max(...measured.map((m) => m.dealMs))}ms** at ${Math.max(...measured.map(cubes))} cubes`);
for (const m of measured.filter((x) => !x.packs)) console.log(`  - DOES NOT PACK: ${m.key}`);
for (const m of measured.filter((x) => !x.dealt)) console.log(`  - UNPROVEN DEAL: ${m.key}`);
