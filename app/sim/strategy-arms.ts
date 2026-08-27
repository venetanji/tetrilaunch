#!/usr/bin/env npx tsx
/**
 * THE THREE-ARM TABLE — separating what a system does from what a player does
 * with it.
 *
 *   npx tsx sim/strategy-arms.ts --system cushion --mark 7 --bay 10 \
 *     --ratchets volatile:6 --seeds 96 --build material
 *   npx tsx sim/strategy-arms.ts --system lance --mark 7 --bay 10 \
 *     --ratchets cryo:3 --seeds 48 --build material
 *
 * ---------------------------------------------------------------------------
 * WHY THREE ARMS AND NOT TWO
 *
 * `winnability.ts --mode counter` already prices a system: fly the same bay,
 * same seeds, with and without the kit, and read the difference. That is the
 * right instrument for a PASSIVE system, and the wrong one for a system whose
 * value is a decision — because the difference it measures is
 * (system + a pilot who cannot use it) minus (no system), and a pilot who
 * cannot use it is a floor of unknown depth.
 *
 * Splitting the "with" side in two turns that unknown into a number:
 *
 *   arm 1  no system,  naive pilot   the control
 *   arm 2  system,     naive pilot   what the system pays PASSIVELY
 *   arm 3  system,     aware pilot   what the system pays when PLAYED
 *
 * arm2 − arm1 is the passive value — everything the system gives a player who
 * bought it and then carried on as before. arm3 − arm2 is the strategy's added
 * value, and it is the number a price argument for a decision-shaped system has
 * to be made from. A system whose whole ladder lives in arm3 − arm2 is a system
 * the shop card has to TEACH, not merely sell.
 *
 * A FOURTH CELL IS PLAYED — no system, aware pilot — which makes the table a
 * 2x2 (system off/on x pilot naive/aware) rather than a ladder, and that is
 * what lets the two main effects and their INTERACTION be read separately:
 *
 *   system effect      arm2 − arm1   the rung, to a pilot who does not play it
 *   strategy effect    arm4 − arm1   the play, to a pilot who has not bought it
 *   together           arm3 − arm1
 *   interaction        (arm3 − arm2) − (arm4 − arm1)
 *
 * The interaction is the number that says a system is DECISION-SHAPED: positive
 * means the rung and the play are worth more together than apart, which is the
 * shape a shop card has to teach rather than merely sell.
 *
 * WHAT arm4 MEANS DIFFERS BY SYSTEM, and the tool says which it expects:
 *  - The cushion-aware strategy is gated on `g.level.cushionCells` and is inert
 *    with no liner aboard, so arm4 is a CONTROL and must land on arm1. If it
 *    does not, the strategy is buying something the system did not sell and
 *    every aware row is contaminated.
 *  - The lance-aware strategy is deliberately NOT inert: half of it is striking
 *    a frozen cube with a shipment, which is counter-play the game has always
 *    had and no rig is needed for. There arm4 is the row the findings' §7 asked
 *    for by name — it separates "cryo needs a system" from "cryo needs the
 *    counter-play the game already has".
 *
 * ---------------------------------------------------------------------------
 * PAIRING, AND WHAT IS AND IS NOT SAMPLED
 *
 * ONE bay, ONE explicit ratchet stack, and every arm flown on the SAME seed
 * list inside one process — the shape `pile.ts` uses for the congestion tax and
 * `winnability.ts --mode counter` uses for a counter, and for the reason that
 * file states: a counter changes the physics, the physics changes where every
 * later shipment lands, and ten bays of that moves the wall by more than the
 * counter is worth. A single bay has the resolution; a run does not.
 *
 * Nothing is silently dropped. Every arm plays every seed; the header prints
 * the seed count, the bay, the rig and the stack, and the JSON carries the
 * per-seed outcomes. The one approximation is the one `--mode counter` makes
 * and names: a bay past the first opens on a flat `CARRY_CAP` surplus, because
 * a single bay has no previous bay to have banked one.
 *
 * The RUN-level question — does a strategy change the cheapest rig that clears
 * a Deep Run — is not asked here. It is a dimension of
 * `winnability.ts --mode cheapest --strategies ...`, which flies ten bays.
 */
import { applyRatchets, HAZARDS, type HazardId, type Ratchets } from "../src/game/hazards";
import { makeBaseLevel } from "../src/game/level";
import { applyUpgrades, MARK_COUNT, tiersCost, type UpgradeId } from "../src/game/upgrades";
import { CARRY_CAP, RUN_LEVELS } from "../src/game/run";
import { aimBot, type Bot } from "./bots";
import { loadoutFor, loadoutWithoutTrack, PRIORITY_ORDERS } from "./builds";
import { bondHands, cushionKit, thawKit, type CounterKit } from "./counters";
import { comboKey } from "./draft-space";
import { runBay, type BayOutcome } from "./runner";
import {
  cushionStrategy, lanceStrategy, naiveStrategy, strategyHands, STRATEGIES,
  type AimStrategySpec,
} from "./aim-strategies";

/* ---------------------------------------------------------------------------
 * THE SYSTEMS THIS TOOL KNOWS HOW TO SPLIT
 *
 * A system is (its kit ladder, the strategy that plays it, the ratchet stack it
 * is a question about). The default stack is quoted from the findings the arms
 * are meant to update, so a bare `--system cushion` re-runs the exact bay §5b-ter
 * left open rather than a bay of this tool's own choosing.
 * ------------------------------------------------------------------------- */
interface SystemUnderTest {
  id: string;
  /** The upgrade track this system IS. Every arm's rig is built with it removed
   *  from the priority order, so the only thing that ever installs it is the
   *  arm's own kit — see `loadoutWithoutTrack` and the note by `loadout`. */
  track: UpgradeId;
  /** Kit for tier t (1..3): grants the track onto the bay's config. */
  kit(t: number): CounterKit;
  aware: AimStrategySpec;
  /** The stack `--ratchets` defaults to — the load the system exists to answer. */
  loaded: string;
  /**
   * Is the aware strategy expected to do NOTHING without the system aboard?
   *
   * True makes the no-system/aware cell a control with a pass/fail reading;
   * false makes it a measurement in its own right. Declared per system rather
   * than assumed, because assuming it turned the lance's most interesting row
   * into a failure notice on the first run of this tool.
   */
  expectInert: boolean;
  /** Extra column this system's story is told in. */
  readout: { label: string; of(cfg: { thawCharges: number }, o: BayOutcome): number };
}

const SYSTEMS: Record<string, SystemUnderTest> = {
  cushion: {
    id: "cushion",
    track: "cushion",
    kit: cushionKit,
    aware: cushionStrategy,
    // The belt cap. `belt.ts`'s BELT_CEILING is 1/3, so six notches of volatile
    // is as volatile as a bay can structurally get — the corner §5b-ter read.
    loaded: "volatile:6",
    // Both hooks return null at `cushionCells === 0`. A liner is the only thing
    // this strategy knows how to play around.
    expectInert: true,
    // What a detonation CHARGED the bay for its live cargo (`Game.volatileLosses`).
    // The number §5b-ter's finding turns on: a liner that defers a blast rather
    // than preventing it shows up here and nowhere else.
    readout: { label: "bill$", of: (_c, o) => o.volatileLosses },
  },
  lance: {
    id: "lance",
    track: "thaw",
    kit: thawKit,
    aware: lanceStrategy,
    loaded: "cryo:3",
    // NOT inert, on purpose: the shipment-striking half needs no rig at all.
    // That cell is the answer to the findings' §7 question rather than a
    // control, and calling it a failure would be calling the finding a bug.
    expectInert: false,
    // Charges actually spent. The whole difference between the greedy trigger
    // and a disciplined one is meant to show up here first and in wins second.
    readout: { label: "used", of: (cfg, o) => cfg.thawCharges - o.thawLeft },
  },
};

/* ---------------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const get = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);

const systemId = get("--system") ?? "cushion";
if (!(systemId in SYSTEMS)) {
  console.error(`Unknown --system "${systemId}" — available: ${Object.keys(SYSTEMS).join(", ")}`);
  process.exit(1);
}
const sut = SYSTEMS[systemId];

const mark = Math.max(1, Math.min(MARK_COUNT, parseInt(get("--mark") ?? "7", 10)));
const bay = Math.max(1, Math.min(RUN_LEVELS, parseInt(get("--bay") ?? String(RUN_LEVELS), 10)));
const seedCount = Math.max(1, parseInt(get("--seeds") ?? "24", 10));
const tiers = nums(get("--tiers") ?? "1,2,3").filter((t) => t >= 1 && t <= 3);
const buildName = get("--build") ?? "material";
const jsonOut = argv.includes("--json");

if (!(buildName in PRIORITY_ORDERS)) {
  console.error(`Unknown --build "${buildName}" — available: ${Object.keys(PRIORITY_ORDERS).join(", ")}`);
  process.exit(1);
}
if (tiers.length === 0) {
  console.error("--tiers named no tier in 1..3");
  process.exit(1);
}

/**
 * Which strategy plays the AWARE cells. Defaults to the system's own, and
 * exists because a strategy with two independent halves cannot be attributed
 * from one table.
 *
 * The lance is the case that needed it. `lance` both rations charges and sends
 * shipments at frozen cubes; run alone against `naive` it produced one number
 * for two changes, and at tier 3 that number was -15 wins — impossible to read
 * as "rationing is wrong" or "striking is wrong" without a middle arm. Running
 * the tool twice, once `--aware strike` and once `--aware lance`, against the
 * SAME control gives naive -> strike -> lance and each step is one change.
 */
const awareName = get("--aware");
if (awareName && !(awareName in STRATEGIES)) {
  console.error(`Unknown --aware "${awareName}" — available: ${Object.keys(STRATEGIES).join(", ")}`);
  process.exit(1);
}
const aware = awareName ? STRATEGIES[awareName] : sut.aware;

/** Parse `--ratchets volatile:6,wind:2`. Copied in behaviour from
 *  `winnability.ts`'s own parser rather than imported, because that file is a
 *  CLI: importing it would run a whole winnability sweep as a side effect. */
function parseRatchets(spec: string): Ratchets {
  const out: Ratchets = {};
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, n] = part.split(":");
    if (!HAZARDS.some((h) => h.id === id)) {
      console.error(`Unknown axis "${id}" in --ratchets`);
      process.exit(1);
    }
    out[id as HazardId] = Math.max(1, parseInt(n ?? "1", 10) || 1);
  }
  return out;
}

const stack = parseRatchets(get("--ratchets") ?? sut.loaded);
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
/**
 * The rig EVERY arm flies, with the system under test taken out of the priority
 * order.
 *
 * This is the tool's control, and review found it broken. `loadoutFor` alone
 * spends the Mark's budget on whatever the named order asks for — so
 * `--system cushion --build liner` installed a liner at tier 2 before any arm's
 * own tier was applied, and BOTH "off" arms flew with a cushion aboard. The
 * table's control row is then not a control, and every system effect, strategy
 * effect and interaction in it is measured against the wrong zero.
 *
 * The published tables in `design/balance/aim-strategy-findings.md` were flown
 * on `--build material`, which carries neither `cushion` nor `thaw`, so they
 * were never affected — but a tool whose correctness depends on the caller
 * picking a build that happens not to collide is a trap, not an instrument.
 * `whichWasDropped` prints when this actually removes something, so a run under
 * `--build liner` says out loud that its rig is not the one the order names.
 */
const namedRig = loadoutFor(PRIORITY_ORDERS[buildName], mark);
const loadout = loadoutWithoutTrack(PRIORITY_ORDERS[buildName], mark, sut.track);
const droppedTrack = (namedRig[sut.track] ?? 0) > 0 ? namedRig[sut.track] : 0;

/* ---------------------------------------------------------------------------
 * ONE ARM
 * ------------------------------------------------------------------------- */

interface Arm {
  /** 0 = the system is absent. */
  tier: number;
  strategy: AimStrategySpec;
  /** Fly the KIT's own hands (`thawKit`'s greedy `thawHands`) rather than the
   *  strategy's ability hook. True for every naive arm and false for every
   *  aware one, which is exactly what "naive" means for a system that ships a
   *  trigger: the pilot the harness had. */
  kitHands: boolean;
}

interface ArmResult {
  arm: Arm;
  label: string;
  wins: number;
  runs: number;
  lines: number;
  shots: number;
  end: number;
  readout: number;
  cost: number;
  losses: Record<string, number>;
  perSeed: { seed: number; won: boolean; lines: number; shots: number; end: number }[];
}

function flyArm(arm: Arm): ArmResult {
  const kit = arm.tier > 0 ? sut.kit(arm.tier) : null;
  let wins = 0;
  let lines = 0;
  let shots = 0;
  let end = 0;
  let readout = 0;
  const losses: Record<string, number> = {};
  const perSeed: ArmResult["perSeed"] = [];

  for (const seed of seeds) {
    // The same layering `run.ts`'s levelForRun uses: base ladder, then the
    // ship, then the conditions it is flown in, then the system under test.
    const cfg = makeBaseLevel(bay - 1, mark);
    applyUpgrades(cfg, loadout);
    const flown = applyRatchets(cfg, stack);
    if (bay > 1) flown.startingFunds += CARRY_CAP;
    kit?.level?.(flown);

    // The pilot, assembled in the one order every wrapper in this harness uses:
    // abilities outermost (not behind the cooldown), then Bond Breakers, then
    // the aim bot carrying the strategy's two aim hooks.
    const strategy = arm.strategy.build(seed);
    let bot: Bot = bondHands(aimBot(seed, { demolish: true, strategy }));
    bot = arm.kitHands && kit?.hands ? kit.hands(bot) : strategyHands(strategy, bot);

    const out = runBay(flown, bot, seed);
    if (out.status === "won") wins += 1;
    else losses[out.lossReason ?? "cap"] = (losses[out.lossReason ?? "cap"] ?? 0) + 1;
    lines += out.lines;
    shots += out.shots;
    end += out.endScore;
    readout += sut.readout.of(flown, out);
    perSeed.push({
      seed, won: out.status === "won", lines: out.lines, shots: out.shots, end: out.endScore,
    });
  }

  const n = seeds.length;
  return {
    arm,
    label: `${arm.tier === 0 ? "none" : `t${arm.tier}`} / ${arm.strategy.name}`,
    wins, runs: n, lines: lines / n, shots: shots / n, end: end / n, readout: readout / n,
    cost: kit?.cost ?? 0,
    losses, perSeed,
  };
}

/* ---------------------------------------------------------------------------
 * OUTPUT
 * ------------------------------------------------------------------------- */

const pad = (s: string, n: number): string => s.padStart(n);
const padE = (s: string, n: number): string => s.padEnd(n);

function showTiers(t: Record<string, number>): string {
  return Object.entries(t).filter(([, v]) => v > 0)
    .map(([id, v]) => `${id.slice(0, 3)}${v}`).join(" ") || "stock";
}

console.log(
  `Strategy arms — system ${sut.id} · aware ${aware.name} · Tier ${mark} bay ${bay}`
  + ` · ratchets ${comboKey(stack)} · rig ${buildName} ${showTiers(loadout)}`
  + ` (${tiersCost(loadout)} pts) · ${seedCount} paired seeds`,
);
if (droppedTrack > 0) {
  console.log(
    `  NOTE: the \`${buildName}\` order installs ${sut.track} at tier ${droppedTrack}, and the`
    + ` arms tool has removed it — the`,
  );
  console.log(
    `  arm's own kit is the only thing allowed to grant the system under test, or the "off"`
    + ` arms are not off.`,
  );
}
console.log(
  "  A 2x2: system off/on x pilot naive/aware. The system's PASSIVE value and the STRATEGY's",
);
console.log(
  "  added value are the two main effects; the interaction is what only exists together.",
);
console.log(
  sut.expectInert
    ? `  \`none / ${aware.name}\` is a CONTROL here — this strategy is inert without the rig,`
      + " so it must land on `none / naive`."
    : `  \`none / ${aware.name}\` is a MEASUREMENT here, not a control — this strategy's`
      + " free half needs no rig.",
);
console.log(
  "Pessimism ledger: these pilots fire demolition and Bond Breakers and re-solve every shot,",
);
console.log(
  "and still have no lookahead and no plan past the shot in hand. A human clears bays they lose.\n",
);

const arms: Arm[] = [
  { tier: 0, strategy: naiveStrategy, kitHands: false },
  { tier: 0, strategy: aware, kitHands: false },
];
for (const t of tiers) {
  arms.push({ tier: t, strategy: naiveStrategy, kitHands: true });
  arms.push({ tier: t, strategy: aware, kitHands: false });
}

console.log([
  padE("arm", 18), pad("pts", 5), pad("win", 8), pad("lines", 6), pad("shots", 6),
  pad("end$", 7), pad(sut.readout.label, 6), " losses",
].join(" "));

const results = arms.map(flyArm);
for (const r of results) {
  console.log([
    padE(r.label, 18), pad(String(r.cost), 5), pad(`${r.wins}/${r.runs}`, 8),
    pad(r.lines.toFixed(1), 6), pad(r.shots.toFixed(1), 6),
    pad(`$${Math.round(r.end)}`, 7), pad(r.readout.toFixed(1), 6),
    " " + Object.entries(r.losses).sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${k}x${c}`).join(" "),
  ].join(" "));
}

// THE DECOMPOSITION, stated rather than left to the reader's subtraction — the
// whole point of the tool is the split, and a table that only prints the four
// totals invites exactly the two-arm reading it exists to replace.
const base = results[0];
const freePlay = results[1];
const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));

console.log("");
console.log([
  padE("tier", 6), pad("system", 8), pad("strategy", 9), pad("interact", 9),
  pad("together", 9), ` (bay wins vs none/naive, of ${base.runs})`,
].join(" "));
// The strategy's effect WITHOUT the system is a property of the pilot, not of
// the tier, so it is printed once above the ladder rather than repeated in
// every row where it would look like four measurements of one thing.
console.log([
  padE("—", 6), pad("0", 8), pad(sign(freePlay.wins - base.wins), 9), pad("—", 9),
  pad(sign(freePlay.wins - base.wins), 9), "  the strategy alone, no rig aboard",
].join(" "));
for (const t of tiers) {
  const naive = results.find((r) => r.arm.tier === t && r.arm.strategy === naiveStrategy)!;
  const aware = results.find((r) => r.arm.tier === t && r.arm.strategy !== naiveStrategy)!;
  const system = naive.wins - base.wins;
  const withSystem = aware.wins - naive.wins;
  const without = freePlay.wins - base.wins;
  console.log([
    padE(`t${t}`, 6), pad(sign(system), 8), pad(sign(withSystem), 9),
    pad(sign(withSystem - without), 9), pad(sign(aware.wins - base.wins), 9),
  ].join(" "));
}

console.log("");
if (sut.expectInert) {
  console.log(
    `control: none/${aware.name} ${freePlay.wins}/${freePlay.runs}`
    + ` vs none/naive ${base.wins}/${base.runs}`
    + (freePlay.wins === base.wins
      ? " — inert without the system, as designed."
      : " — NOT INERT. The strategy is buying something the system did not sell;"
        + " every aware row above is contaminated."),
  );
} else {
  console.log(
    `free counter-play: none/${aware.name} ${freePlay.wins}/${freePlay.runs}`
    + ` vs none/naive ${base.wins}/${base.runs} — what the play is worth with NO rig aboard.`
    + " Read the ladder above against this row, not against zero.",
  );
}

if (jsonOut) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(import.meta.dirname ?? ".", "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `strategy-arms-${sut.id}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    system: sut.id, aware: aware.name, mark, bay, seeds: seedCount, build: buildName,
    ratchets: comboKey(stack), loadout,
    arms: results.map((r) => ({
      tier: r.arm.tier, strategy: r.arm.strategy.name, kitHands: r.arm.kitHands,
      wins: r.wins, runs: r.runs, lines: r.lines, shots: r.shots, end: r.end,
      readout: r.readout, losses: r.losses, perSeed: r.perSeed,
    })),
  }, null, 2));
  console.log(`\nwrote ${file}`);
}
