#!/usr/bin/env npx tsx
// Skydeck calibration CLI.
//
//   npx tsx sim/skydeck.ts [--bays 1,4,7,10] [--seeds 3] [--bots aim]
//     [--days 14] [--carry 150] [--mode skydeck,ladder] [--stops all]
//
// The Skydeck (game/skydeck.ts) is a Mark-10 Deep Run with three rules changed,
// and the only question worth measuring is whether the three together leave a
// run that can be flown:
//
//   - no refit stops, so the rig is the Workshop loadout for all ten bays
//   - one notch a bay, not the capstone's two
//   - THREE standing Final clauses instead of one, arming at bays 4, 7 and 10
//
// The first two make it easier than a Mark-10 ladder run and the third makes it
// harder; nothing about that trade can be asserted, so this flies both modes
// through the same bays with the same rigs and prints them side by side.
//
// `--mode ladder` is the control, and it is the shipped Mark-10 Deep Run as
// marks.ts models it: refits at the stops after bays 3/6/9, two notches a bay,
// one Final clause on bay 10 (worst of the pair, so the control is not
// flattered by a coin toss).
//
// `--stops all` is the important one. A day deals ONE clause per stop, so a
// single day's run says nothing about the mode — it says something about that
// day. With `--stops all` the harness flies every combination the bands can
// produce (4 x 12 x 2 = 96 at the shipped bands) and reports the best, the
// median and the WORST day, because the worst day is the one that decides
// whether the bands are sized right. `--days N` is the cheaper sample: the next
// N real days from today, which is what a player will actually meet.
//
// Caveats, all PESSIMISTIC and all inherited from sim/README.md: no bot fires a
// Bond Breaker, only `demo` fires a demolition charge, and fixed arcs never
// read the pile. A human clears bays these bots lose — and the Skydeck's
// standing MATERIAL clauses are exactly where that bias bites hardest, since a
// material's counter is a system the bot cannot operate. Read every material
// row here as a floor.
import { makeBaseLevel } from "../src/game/level";
import { applyRatchets } from "../src/game/hazards";
import { applyFinals, finalById, finalsForTier, type FinalId } from "../src/game/finals";
import {
  applyUpgrades, budgetForMark, MARK_COUNT, newTiers, nextTierCost, tiersCost,
  UPGRADES, type UpgradeId, type UpgradeTiers,
} from "../src/game/upgrades";
import { installById, UPRATE_MAX_TIER } from "../src/game/meta";
import { REFIT_EVERY, RUN_LEVELS, SKYDECK_PICKS_PER_BAY } from "../src/game/run";
import { CLAUSE_STOPS, dealableAt, skydeckClauses, skydeckSeed } from "../src/game/skydeck";
import { SCRAP_PER_BAY, SCRAP_PER_LINE } from "../src/game/level";
import { BOTS } from "./bots";
import { spreadRatchets } from "./ratchet-model";
import { runBay } from "./runner";

// ---------------------------------------------------------------------------
// Rigs — the same four archetypes marks.ts calibrates the ladder with, so a
// Skydeck row and a Mark-10 row from that harness are comparable. The one
// difference is the refit schedule, which is the mode's whole point: a Skydeck
// rig is the Workshop loadout at every bay.
// ---------------------------------------------------------------------------

const SCRAP_PER_CLEARED_BAY = 8 * SCRAP_PER_LINE + SCRAP_PER_BAY;
const CALIBRATION_TRACKS: UpgradeId[] = ["reactor", "hydraulics", "bay", "launcher", "bonds"];

function ownableTracks(order: UpgradeId[], mark: number): UpgradeId[] {
  return order.filter((id) => (installById(id)?.requiresMark ?? 0) <= mark - 1);
}

function loadoutFor(order: UpgradeId[], mark: number): UpgradeTiers {
  const tiers = newTiers();
  for (let tier = 1; tier <= UPRATE_MAX_TIER; tier++) {
    for (const id of ownableTracks(order, mark)) {
      if ((tiers[id] ?? 0) !== tier - 1) continue;
      if (tiersCost({ ...tiers, [id]: tier }) > budgetForMark(mark)) continue;
      tiers[id] = tier;
    }
  }
  return tiers;
}

function spendScrap(tiers: UpgradeTiers, order: UpgradeId[], bank: number, breadthFirst: boolean): number {
  let bought = true;
  while (bought) {
    bought = false;
    for (const id of order) {
      if ((tiers[id] ?? 0) < 1) continue;
      const cost = nextTierCost(tiers[id]);
      if (cost === null || cost > bank) continue;
      tiers[id] += 1;
      bank -= cost;
      bought = true;
      if (!breadthFirst) break;
    }
  }
  return bank;
}

/** The rig entering `bay`. `refits` is the mode: a ladder run banks scrap into
 *  the stops after bays 3/6/9, a Skydeck run has no stops at all. */
function tiersForBay(
  order: UpgradeId[], mark: number, bay: number, breadthFirst: boolean, refits: boolean,
): UpgradeTiers {
  const tiers = loadoutFor(order, mark);
  if (!refits) return tiers;
  let spent = 0;
  for (let stop = REFIT_EVERY; stop < RUN_LEVELS; stop += REFIT_EVERY) {
    if (bay <= stop) break;
    const bank = SCRAP_PER_CLEARED_BAY * stop - spent;
    spent += bank - spendScrap(tiers, order, bank, breadthFirst);
  }
  return tiers;
}

const ARCHETYPES: Record<string, UpgradeId[]> = {
  economy: ["reactor", "hydraulics", "bay", "launcher", "bonds"],
  spatial: ["bay", "hydraulics", "reactor", "launcher", "bonds"],
  power: ["launcher", "hydraulics", "reactor", "bay", "bonds"],
  spread: CALIBRATION_TRACKS,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const get = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

const bays = nums(get("--bays") ?? "1,4,7,10");
const seeds = parseInt(get("--seeds") ?? "3", 10);
const botNames = (get("--bots") ?? "aim").split(",").map((s) => s.trim()).filter(Boolean);
const carry = parseInt(get("--carry") ?? "150", 10);
const days = parseInt(get("--days") ?? "0", 10);
const allStops = (get("--stops") ?? "") === "all";
/**
 * The Mark the stack is priced at.
 *
 * DEFAULTS TO 10 because that is the Mark the Skydeck is flown at, and it is
 * ALSO the Mark at which this instrument has no resolution left: docs/DESIGN.md
 * publishes Mark 10 at 0% run-clear with the aim bot and a spread ratchet, and
 * says why (no Bond Breaker, no charge, MAGAZINE excluded from the rigs, an
 * unprepared round-robin ratchet). A control already sitting on the floor
 * cannot say whether a change pushed it further down.
 *
 * So `--mark 6` is not a cheat, it is the measurement that works: Mark 6 reads
 * 16% in that same table, which leaves room above and below for three standing
 * clauses to show a cost. Price the STACK at a Mark with headroom, then read
 * the Mark-10 rows for the sign rather than the size.
 */
const mark = Math.max(1, Math.min(MARK_COUNT, parseInt(get("--mark") ?? String(MARK_COUNT), 10)));
/** Which rigs to fly. All four by default (marks.ts's "beatable by a competent
 *  build" criterion); one name is four times faster when scanning bands. */
const rigNames = (get("--rigs") ?? Object.keys(ARCHETYPES).join(",")).split(",").map((s) => s.trim());

for (const b of botNames) {
  if (!(b in BOTS)) {
    console.error(`Unknown bot "${b}" — available: ${Object.keys(BOTS).join(", ")}`);
    process.exit(1);
  }
}
for (const r of rigNames) {
  if (!(r in ARCHETYPES)) {
    console.error(`Unknown rig "${r}" — available: ${Object.keys(ARCHETYPES).join(", ")}`);
    process.exit(1);
  }
}

/** Every clause by its card name, for the per-clause report card. */
const FINALS_BY_NAME = new Map(
  Array.from({ length: MARK_COUNT }, (_, i) => finalsForTier(i + 1))
    .flat()
    .map((f) => [f.name, f]),
);

/** A clause schedule to fly: the ids, and which bay each arms on. */
interface Schedule {
  label: string;
  clauses: { from: number; id: FinalId }[];
}

/** Every combination the bands can deal — the exhaustive `--stops all` set.
 *  Read off dealableAt, not off the raw tier lists, so the scan flies exactly
 *  what the day can deal (skydeck.ts's dead-cargo rule takes clauses out). */
function allSchedules(): Schedule[] {
  const perStop = CLAUSE_STOPS.map((stop, i) =>
    dealableAt(i).map((f) => ({ from: stop.fromBay - 1, id: f.id })));
  let out: { from: number; id: FinalId }[][] = [[]];
  for (const options of perStop) {
    out = out.flatMap((prefix) => options.map((o) => [...prefix, o]));
  }
  return out.map((clauses) => ({
    label: clauses.map((c) => c.id).join("+"),
    clauses,
  }));
}

/** The next `n` real days' schedules, which is what players actually meet. */
function daySchedules(n: number): Schedule[] {
  const out: Schedule[] = [];
  for (let k = 0; k < n; k++) {
    const d = new Date(Date.now() + k * 86_400_000);
    const clauses = skydeckClauses(skydeckSeed(d));
    out.push({
      label: `${d.toISOString().slice(0, 10)} ${clauses.map((c) => c.id).join("+")}`,
      clauses: [...clauses],
    });
  }
  return out;
}

/** The control: the shipped ladder run at this Mark. One clause, on the last
 *  bay only, and the heaviest of the capstone pair (Odd Lots takes the standard
 *  shipment away entirely), so the control is not flattered by a coin toss. */
const LADDER_SCHEDULE: Schedule = {
  label: "LADDER · refits, 2 notches, 1 clause",
  clauses: [{ from: RUN_LEVELS - 1, id: "odd-lots" }],
};

/** One row's rules: what the mode changes, said as three flags. */
interface Mode {
  refits: boolean;
  picksPer: number | undefined;
}
const SKYDECK_MODE: Mode = { refits: false, picksPer: SKYDECK_PICKS_PER_BAY };
const LADDER_MODE: Mode = { refits: true, picksPer: undefined };

/** Win rate for one (mode, schedule, rig) across the sampled bays. */
function evaluate(
  order: UpgradeId[], breadthFirst: boolean, schedule: Schedule, mode: Mode,
): Map<number, number> {
  const perBay = new Map<number, number>();
  for (const bay of bays) {
    const tiers = tiersForBay(order, mark, bay, breadthFirst, mode.refits);
    let wins = 0;
    let total = 0;
    for (const botName of botNames) {
      for (let s = 0; s < seeds; s++) {
        // Same order as run.ts's levelForRun: base ladder, ship, ratchets,
        // clauses, cash in hand. Anything else prices a bay nobody plays.
        let cfg = makeBaseLevel(bay - 1, mark);
        applyUpgrades(cfg, tiers);
        cfg = applyRatchets(cfg, spreadRatchets(mark, bay, mode.picksPer));
        applyFinals(cfg, schedule.clauses.filter((c) => c.from <= bay - 1).map((c) => c.id));
        if (bay > 1) cfg.startingFunds += carry;
        if (runBay(cfg, BOTS[botName](s + 1), s + 1).status === "won") wins += 1;
        total += 1;
      }
    }
    perBay.set(bay, wins / total);
  }
  return perBay;
}

/** Implied run-clear rate — the same estimator marks.ts uses, and for the same
 *  reason: a run needs every bay, so a per-bay rate flatters it badly. */
function runClearRate(perBay: Map<number, number>): number {
  const rates = [...perBay.values()];
  if (rates.some((r) => r === 0)) return 0;
  const logMean = rates.reduce((a, r) => a + Math.log(r), 0) / rates.length;
  return Math.exp(logMean * RUN_LEVELS);
}

/** The BEST rig's per-bay rates for a schedule — the same "is it beatable by a
 *  competent build" criterion marks.ts judges a Mark by. */
function best(schedule: Schedule, mode: Mode): { rig: string; perBay: Map<number, number> } {
  let bestRig = "";
  let bestPerBay = new Map<number, number>();
  let bestMean = -1;
  for (const name of rigNames) {
    const perBay = evaluate(ARCHETYPES[name], name === "spread", schedule, mode);
    const mean = [...perBay.values()].reduce((a, r) => a + r, 0) / perBay.size;
    if (mean > bestMean) {
      bestMean = mean;
      bestRig = name;
      bestPerBay = perBay;
    }
  }
  return { rig: bestRig, perBay: bestPerBay };
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

interface Row { label: string; rig: string; perBay: Map<number, number>; run: number }
const rows: Row[] = [];
function fly(label: string, schedule: Schedule, mode: Mode): Row {
  const r = best(schedule, mode);
  const row: Row = { ...r, label, run: runClearRate(r.perBay) };
  rows.push(row);
  return row;
}

/** The stack after `n` stops — the ramp that prices each stop separately. */
function prefix(sched: Schedule, n: number): Schedule {
  return { label: sched.label, clauses: sched.clauses.slice(0, n) };
}

console.log(
  `Skydeck calibration — Mark ${mark} · bays ${bays.join("/")} · ${seeds} seeds · bots ${botNames.join("+")} · rigs ${rigNames.join("+")} · carry $${carry}`,
);
console.log(
  `Skydeck: no refits, ${SKYDECK_PICKS_PER_BAY} notch/bay, ${CLAUSE_STOPS.length} standing clauses arming at bays ${CLAUSE_STOPS.map((s) => s.fromBay).join("/")}`,
);
console.log(
  `Control: the shipped ladder run — refits after bays ${REFIT_EVERY}/${REFIT_EVERY * 2}/${REFIT_EVERY * 3}, 2 notches/bay, one clause on bay ${RUN_LEVELS}.\n`,
);

const schedules = allStops ? allSchedules() : daySchedules(Math.max(1, days || 3));

// Two controls, both flown on the same bays and rigs as everything below.
//  - the LADDER row is the mode the Skydeck sits above,
//  - the BARE row is the Skydeck with the clauses taken out, which is what
//    isolates the clause stack from the two rules that make the mode EASIER
//    (no capstone double notch, and therefore half the ratchet by bay 10).
fly(LADDER_SCHEDULE.label, LADDER_SCHEDULE, LADDER_MODE);
fly("SKYDECK bare · no clauses", { label: "bare", clauses: [] }, SKYDECK_MODE);

for (const sched of schedules) {
  // The ramp, one stop at a time, so a stack that only fails at the third stop
  // is distinguishable from one that was never flyable. Skipped on a band SCAN,
  // where the ramp would triple a run that is already flying every combination
  // and the question is which full stacks survive.
  for (let n = allStops ? sched.clauses.length : 1; n <= sched.clauses.length; n++) {
    const armed = sched.clauses.slice(0, n).map((c) => finalById(c.id)?.name ?? c.id);
    fly(`  +${n} ${armed.join(" + ")}`, prefix(sched, n), SKYDECK_MODE);
  }
}

const width = Math.max(30, ...rows.map((r) => r.label.length));
console.log(
  [
    "run".padEnd(width), "rig".padStart(8),
    ...bays.map((b) => `bay${b}`.padStart(6)), "run".padStart(6),
  ].join(" "),
);
for (const r of rows) {
  console.log([
    r.label.padEnd(width),
    r.rig.padStart(8),
    ...bays.map((b) => pct(r.perBay.get(b) ?? 0).padStart(6)),
    pct(r.run).padStart(6),
  ].join(" "));
}

// The FULL stacks only — a mode is as good as the day it deals worst, and an
// average over the ramp would hide exactly that.
const full = rows.filter((r) => r.label.startsWith(`  +${CLAUSE_STOPS.length} `));
if (full.length > 1) {
  const sorted = [...full].sort((a, b) => meanRate(a) - meanRate(b));
  const mid = sorted[Math.floor(sorted.length / 2)];
  console.log(`\n${sorted.length} full stacks flown (mean per-bay rate)`);
  console.log(`  worst   ${pct(meanRate(sorted[0])).padStart(5)} ${sorted[0].label.trim()}`);
  console.log(`  median  ${pct(meanRate(mid)).padStart(5)} ${mid.label.trim()}`);
  console.log(`  best    ${pct(meanRate(sorted[sorted.length - 1])).padStart(5)} ${sorted[sorted.length - 1].label.trim()}`);

  // Which single clause drags hardest — the band's own report card, and the
  // one output that can condemn a band rather than a day.
  const byClause = new Map<string, number[]>();
  for (const r of full) {
    for (const name of r.label.replace(/^\s*\+\d+ /, "").split(" + ")) {
      if (!byClause.has(name)) byClause.set(name, []);
      byClause.get(name)!.push(meanRate(r));
    }
  }
  console.log("\nMean per-bay rate with each clause in the stack:");
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const [name, xs] of [...byClause.entries()].sort((a, b) => mean(a[1]) - mean(b[1]))) {
    const def = FINALS_BY_NAME.get(name);
    console.log(
      `  ${name.padEnd(16)} T${String(def?.tier ?? "?").padStart(2)}  ${pct(mean(xs)).padStart(5)}  (${xs.length} stacks)`,
    );
  }
}

function meanRate(r: Row): number {
  const xs = [...r.perBay.values()];
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

console.log(
  `\nUnmodelled and PESSIMISTIC: no bot fires a Bond Breaker (${UPGRADES.find((u) => u.id === "bonds")?.name}), only \`demo\` fires a charge, and fixed arcs never read the pile.`,
);
