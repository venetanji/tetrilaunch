#!/usr/bin/env npx tsx
// Which congestion METRIC separates spam from clean play?
//
//   npx tsx sim/pile-metrics.ts [--bays 1,5,10] [--seeds 6] [--carry 100]
//
// sim/pile.ts's census answered "how many cubes does a bay hold" and got an
// uncomfortable answer: the median untaxed field is ~27 cubes and the p90 is
// ~71, so a 32-cube threshold taxes the majority of a CLEAN bot's shots. That
// does not mean the design is wrong — it may mean the metric is.
//
// The suspicion this script tests: total cube count is dominated by the SETTLED
// PILE, and the settled pile is not spam. It is the game. Cubes accumulate in
// the bay because rows only sell when the press closes on a full one; a player
// doing everything right still sits on thirty cubes. A tax on that is a rate
// rise.
//
// So it measures five candidate readings at every shot, for a clean bot and a
// spam bot on the same seeds, and asks of each: how far apart are the two
// distributions? The metric worth shipping is the one where the spammer's
// numbers and the careful player's numbers barely overlap — that is what makes
// a threshold a rule about behaviour rather than a rule about time elapsed.
//
//   total     — every live cube. What level.ts's PILE_TIERS currently reads.
//   settled   — cubes at rest. The pile proper.
//   moving    — cubes NOT at rest: shots in flight, and wreckage still tumbling
//               from the last one. The direct signature of firing again before
//               the bay has resolved.
//   outside   — cubes on the launcher side of the compactor face, i.e. cargo
//               the press cannot reach. The signature of firing wildly.
//   inflight  — cubes above the compactor's top edge, still descending.
//
// Separation is reported as the fraction of SPAM shots a threshold would tax
// when that threshold is set to tax only 10% of CLEAN shots. 10% is arbitrary
// but fixed across metrics, which is what makes the column comparable: it asks
// every metric to be equally gentle on good play and then scores it on how much
// bad play it still catches.
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";
import { CELL } from "../src/game/engine";
import { BOTS } from "./bots";

const DT = 1000 / 60;
/** Matches lineClear.ts's SETTLE — the speed below which a cube counts as at
 *  rest. Re-derived here rather than exported because it is a threshold this
 *  script is REPORTING on, and a silent change to it should show up as a
 *  changed number here rather than be absorbed invisibly. */
const SETTLE = 3.2;

const argv = process.argv.slice(2);
const get = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

const bays = nums(get("--bays") ?? "1,5,10");
const seeds = parseInt(get("--seeds") ?? "6", 10);
const carry = parseInt(get("--carry") ?? "100", 10);

const METRICS = ["total", "settled", "moving", "outside", "inflight"] as const;
type Metric = (typeof METRICS)[number];
type Reading = Record<Metric, number>;

/** Every metric, read off the live field in one pass. */
function read(g: Game): Reading {
  const face = g.compactor.x + g.compactor.width / 2;
  const top = g.compactor.top;
  let settled = 0;
  let outside = 0;
  let inflight = 0;
  for (const c of g.cubes) {
    const b = c.body;
    const v = b.velocity;
    if (v.x * v.x + v.y * v.y < SETTLE * SETTLE) settled += 1;
    // Half a cell of tolerance so a cube resting AGAINST the bar's face counts
    // as inside the zone rather than flickering between the two as it presses.
    if (b.position.x < face - CELL / 2) outside += 1;
    if (b.position.y < top) inflight += 1;
  }
  return {
    total: g.cubes.length,
    settled,
    moving: g.cubes.length - settled,
    outside,
    inflight,
  };
}

/** Every shot's reading, for one (bay, bot, seed). */
function sample(bay: number, botName: string, seed: number): Reading[] {
  const cfg = makeBaseLevel(bay - 1);
  if (bay > 1) cfg.startingFunds += carry;
  const out: Reading[] = [];
  let g: Game;
  const game = new Game(cfg, { onShoot: () => out.push(read(g)) }, seed);
  g = game;
  const bot = BOTS[botName](seed);
  const stepCap = cfg.timeLimitSec * 60 + 3600;
  let now = 0;
  for (let steps = 0; game.status === "playing" && steps < stepCap; steps++) {
    now += DT;
    bot.act(game, now);
    game.update(now);
  }
  game.destroy();
  return out;
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const fmt = (x: number, d = 0): string => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "n/a");

// `aim` is the strongest bot here and the closest thing the harness has to a
// careful player; `impatient` is the same search with its restraint removed,
// so it takes every cooldown instead of waiting out a bad gust.
//
// `random-up` was the obvious first choice for SPAM and is the wrong one,
// measured: it throws cargo out of the bay, eats the lost-piece fine and goes
// broke after ~80 shots, so its pile reads SMALLER than a careful player's on
// every metric here. It does not spam — it fails. The complaint is about a
// competent player with a full bankroll firing without restraint, which is what
// `impatient` models. Override with --spam to re-check.
const CLEAN = get("--clean") ?? "aim";
const SPAM = get("--spam") ?? "impatient";

const clean: Reading[] = [];
const spam: Reading[] = [];
for (const bay of bays) {
  for (let seed = 1; seed <= seeds; seed++) {
    clean.push(...sample(bay, CLEAN, seed));
    spam.push(...sample(bay, SPAM, seed));
  }
}

console.log(`# Which congestion metric separates spam from clean play?\n`);
console.log(
  `bays ${bays.join(",")} · seeds ${seeds} · carry $${carry} · ` +
  `clean=${CLEAN} (${clean.length} shots) · spam=${SPAM} (${spam.length} shots)\n`,
);
console.log(
  "| Metric | clean p50 | clean p90 | spam p50 | spam p90 | " +
  "thr@10%-clean | spam taxed there |",
);
console.log("|---|---|---|---|---|---|---|");

for (const m of METRICS) {
  const c = clean.map((r) => r[m]);
  const s = spam.map((r) => r[m]);
  // The threshold that taxes exactly 10% of clean shots is the 90th percentile
  // of the clean distribution, by definition.
  const thr = quantile(c, 0.9);
  const spamTaxed = s.filter((x) => x > thr).length / (s.length || 1);
  console.log(
    `| ${m} | ${fmt(quantile(c, 0.5))} | ${fmt(quantile(c, 0.9))} | ` +
    `${fmt(quantile(s, 0.5))} | ${fmt(quantile(s, 0.9))} | ` +
    `>${fmt(thr)} | ${pct(spamTaxed)} |`,
  );
}
console.log(
  `\nRead the last column as: "if this metric's threshold is set gently enough ` +
  `to leave 90% of a careful player's shots untaxed, this is the share of a ` +
  `spammer's shots it still catches." Higher is a sharper rule. A metric near ` +
  `10% is not separating the two behaviours at all — it is taxing the clock.\n`,
);
