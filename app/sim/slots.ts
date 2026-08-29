#!/usr/bin/env npx tsx
/**
 * SYSTEM SLOTS — how wide does a rig have to be, and does the WIDTH or the
 * CHOICE do the work?
 *
 *   npx tsx sim/slots.ts --marks 5,10 --slots 3,4,5,6,10 --seeds 4
 *   npx tsx sim/slots.ts --marks 7 --slots 4 --mounts mount-generic,mount-cryo \
 *     --content cryo --seeds 6
 *   npx tsx sim/slots.ts --marks 10 --slots 4,10 --content skydeck --seeds 4
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION, AND WHY THE EXISTING SWEEPS CANNOT ANSWER IT
 *
 * `winnability.ts` asks whether a notch combo is survivable and holds the rig
 * roughly fixed; `marks.ts` asks whether a Mark's budget is sized right and
 * holds the CONTENT roughly fixed. Both spend a Mark's budget through
 * `builds.ts`'s `loadoutFor`, which walks a priority order breadth-first — so
 * in both, how many DISTINCT systems the rig carries is a side effect of how
 * long the order happens to be. Every table in `design/balance/` was measured
 * on an order of five to seven tracks, and none of them says so, because until
 * now nothing turned on it.
 *
 * A slot economy turns everything on it. So this sweep makes the width an
 * explicit axis and crosses it against the content:
 *
 *   slots K   how many systems the rig may MOUNT (builds.ts's mountedLoadout)
 *   mount     WHICH K, as a full-roster priority order
 *   content   what the belt and the ratchet stack actually throw at it
 *
 * and it answers three questions that a slot ladder cannot be priced without:
 *
 *  (a) VIABILITY — is the narrowest rig on the ladder survivable at every Mark
 *      with the RIGHT K systems? A slot ladder that walls a tier is not a
 *      difficulty knob, it is a lose button bought with salvage.
 *  (b) IDENTITY — at a fixed K, does the best mount order DEPEND on the
 *      content? If every content is answered by the same K systems, slots buy
 *      a number and not a decision, and the owner's "rigs that can have certain
 *      systems and not others" has nothing to hang on.
 *  (c) SATURATION — where does another slot stop paying? That curve is what
 *      prices the ladder: a slot worth two bays should cost more than one worth
 *      none.
 *
 * ---------------------------------------------------------------------------
 * THE PILOT, AND WHY IT IS NOT ALWAYS `naive`
 *
 * `aim-strategy-findings.md` measured that two of the three counters on the
 * shelf are DECISIONS rather than rungs — the Impact Cushion pays +4 unplayed
 * and +29 more once flown, the Incinerator pays literally zero unplayed. A slot
 * sweep flown entirely by the naive pilot would therefore price the cushion at
 * an eighth of its value and the hood at nothing, and would conclude that a
 * narrow rig should never mount either. That is a fact about the pilot.
 *
 * So the pilot MATCHES THE RACK: mount the lance and the run is flown by
 * `lance`, mount the liner and it is flown by `cushion`, mount neither and it
 * is `naive` — the same pilot every existing table was measured on. The
 * strategy is printed in every row, because a row whose pilot is not named is
 * not comparable to anything.
 *
 * ---------------------------------------------------------------------------
 * THE PESSIMISM LEDGER, inherited whole from `winnability.ts`
 *
 * The pilot fires demolition charges and Bond Breakers and now also plays the
 * lance and the liner; it still has no lookahead, reads no pile and lands every
 * shipment on a fixed target. Every bias runs one way. A slot count this sweep
 * calls survivable IS survivable; one it calls a wall beat a competent pair of
 * hands holding everything the rack it was given can hold.
 */
import { MARK_COUNT, tiersCost, type UpgradeId } from "../src/game/upgrades";
import { RUN_LEVELS } from "../src/game/run";
import { skydeckClauses } from "../src/game/skydeck";
import { UPGRADES } from "../src/game/upgrades";
import { ADAPTIVE_BOTS, BOTS, type Bot } from "./bots";
import { mountedLoadout, mountedTracks, PRIORITY_ORDERS } from "./builds";
import { bondHands } from "./counters";
import { dodgeSpec, preferSpec, spreadSpec, type DraftPolicySpec } from "./draft-space";
import { greedyRefit, runDeepRun, type DeepRunOutcome } from "./deeprun";
import {
  cushionStrategy, lanceStrategy, naiveStrategy, strategyPilot, type AimStrategySpec,
} from "./aim-strategies";

/* ---------------------------------------------------------------------------
 * CONTENT PROFILES — the belt a mount decision is being made against.
 *
 * Each one is a draft policy plus the name of the system that answers it. The
 * pairing is the point: a profile whose answer is not on the rack is what makes
 * the identity table's off-diagonal cells mean something.
 * ------------------------------------------------------------------------- */
interface ContentProfile {
  name: string;
  spec: DraftPolicySpec;
  /** The track this content is a question about, or null for the controls. */
  answer: UpgradeId | null;
  /** Fly the day's standing clauses instead of the ladder's drafted one. */
  skydeck?: boolean;
}

const CONTENT: Record<string, ContentProfile> = {
  // The CONTROL. `dodge` refuses a material wherever the hand allows one to be
  // refused, so what is left is the number axes — a rig's width measured with
  // no content question on the belt at all.
  clean: { name: "clean", spec: dodgeSpec, answer: null },
  // The three corners the shelf actually sells answers to.
  cryo: { name: "cryo", spec: preferSpec("cryo"), answer: "thaw" },
  volatile: { name: "volatile", spec: preferSpec("volatile"), answer: "cushion" },
  slag: { name: "slag", spec: preferSpec("slag"), answer: "demolition" },
  // The interior: take the shallowest axis on the table, which spreads the
  // stack across everything the Mark deals.
  spread: { name: "spread", spec: spreadSpec, answer: null },
  // The roof. Same ten bays, the day's three standing clauses instead of the
  // drafted inspection, one notch a bay — and, for this sweep, the mode where
  // the player arrives with the whole shelf bought and the slot ladder is the
  // only thing still between them and every system.
  skydeck: { name: "skydeck", spec: spreadSpec, answer: null, skydeck: true },
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
const list = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

const marks = nums(get("--marks") ?? "5,10").map((m) => Math.max(1, Math.min(MARK_COUNT, m)));
const slotCounts = nums(get("--slots") ?? "3,4,5,6,10")
  .map((k) => Math.max(1, Math.min(UPGRADES.length, k)));
const seedCount = Math.max(1, parseInt(get("--seeds") ?? "4", 10));
const contentNames = list(get("--content") ?? "clean,cryo,volatile,slag");
const mountNames = list(get("--mounts") ?? "auto");
const botName = get("--bot") ?? "demo";
const jsonOut = argv.includes("--json");

for (const c of contentNames) {
  if (!(c in CONTENT)) {
    console.error(`Unknown --content "${c}" — available: ${Object.keys(CONTENT).join(", ")}`);
    process.exit(1);
  }
}
for (const m of mountNames) {
  if (m !== "auto" && !(m in PRIORITY_ORDERS)) {
    console.error(`Unknown --mounts "${m}" — available: auto, ${Object.keys(PRIORITY_ORDERS).join(", ")}`);
    process.exit(1);
  }
}
if (!(botName in ADAPTIVE_BOTS)) {
  console.error(`--bot must be adaptive (${Object.keys(ADAPTIVE_BOTS).join("/")}), got "${botName}"`);
  process.exit(1);
}

/** The mount order a content profile's own answer would be mounted first in.
 *  `auto` resolves to this, which is what makes the viability table (a) a test
 *  of "with the RIGHT choices" rather than of one fixed shopping list. */
function autoMountFor(content: ContentProfile): string {
  if (content.answer === "thaw") return "mount-cryo";
  if (content.answer === "cushion") return "mount-volatile";
  if (content.answer === "demolition") return "mount-slag";
  return "mount-generic";
}

/**
 * The pilot the rack deserves — and only when the belt is asking the question
 * that pilot knows how to answer.
 *
 * TWO CONDITIONS, and the second one is the half that was a bug. The rack alone
 * is not enough: `mount-generic` at ten slots carries the lance whatever the
 * belt is doing, so keying only on the rack flew `clean` at K = 10 with `lance`
 * and `clean` at K = 4 with `naive` — two different pilots in the two cells of
 * a paired comparison whose whole subject is the rig. And it is not a neutral
 * swap: `aim-strategy-findings.md` measures the lance's PLAY at −15 of 48 on
 * top of a +16 rung, so the wider rack would have been handed a worse pilot and
 * the slot axis would have paid for it.
 *
 * So the strategy is the intersection: the content has an answer, and the rack
 * is carrying it. Everywhere else it is `naive` — the pilot every existing
 * table in `design/balance/` was measured on.
 */
function strategyFor(content: ContentProfile, tracks: UpgradeId[]): AimStrategySpec {
  if (!content.answer || !tracks.includes(content.answer)) return naiveStrategy;
  if (content.answer === "cushion") return cushionStrategy;
  if (content.answer === "thaw") return lanceStrategy;
  // Slag's answer is the Demolition Rack, and its "strategy" is already in the
  // bot: `bots.ts`'s `demo` fires charges. There is no aim policy to add.
  return naiveStrategy;
}

const basePilot = (seed: number): Bot => bondHands(BOTS[botName](seed));
const pilotFor = (spec: AimStrategySpec): ((seed: number) => Bot) =>
  spec === naiveStrategy
    ? basePilot
    : strategyPilot(spec, { bot: ADAPTIVE_BOTS[botName] });

const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

/* ---------------------------------------------------------------------------
 * THE SWEEP
 * ------------------------------------------------------------------------- */

interface SlotRow {
  mark: number;
  content: string;
  mount: string;
  slots: number;
  /** Tracks actually mounted — fewer than `slots` when the Mark does not sell
   *  that many systems yet, which is itself a finding. */
  tracks: UpgradeId[];
  /** Ladder points the mounted rig cost — what the Mark's budget actually
   *  bought once the slot cap took its bite. */
  points: number;
  strategy: string;
  clears: number;
  runs: number;
  medianBays: number;
  /** MEAN bays cleared, and the statistic that actually resolves this sweep.
   *  At the Tiers a slot ladder has to be priced at, the bots clear whole runs
   *  so rarely that `clears` is 0 in most cells and the median moves in whole
   *  bays — both are too coarse to see one slot. The mean moves in tenths and
   *  is the only readout here fine enough to show a slot paying for itself. */
  avgBays: number;
  deepest: number;
  /** Median bay the run DIED in; RUN_LEVELS when nothing died. */
  wall: number;
  deaths: Record<string, number>;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function flyCell(
  mark: number, content: ContentProfile, mountName: string, slots: number,
): SlotRow {
  const order = PRIORITY_ORDERS[mountName];
  const tracks = mountedTracks(order, mark, slots);
  const loadout = mountedLoadout(order, mark, slots);
  const strategy = strategyFor(content, tracks);
  const pilot = pilotFor(strategy);
  // The refit stop is handed the MOUNTED order, not the roster. `buyUpgrade`
  // already refuses a tier-0 track, so passing the whole order would behave
  // identically — but a harness whose refit policy names systems the rig is not
  // carrying is one edit away from measuring a yard that can install.
  const refit = greedyRefit(tracks, true);
  const outcomes: DeepRunOutcome[] = [];
  for (const seed of seeds) {
    outcomes.push(runDeepRun({
      mark,
      seed,
      bot: pilot,
      loadout,
      draft: content.spec.build(seed),
      refit,
      // The day's clauses, seeded off the run seed so a paired comparison at
      // two slot counts flies the SAME day. A real Skydeck day comes from the
      // date; which day it is has nothing to do with what a slot is worth.
      skydeck: content.skydeck ? { day: seed, clauses: skydeckClauses(seed) } : undefined,
    }));
  }
  const deaths: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.cleared) continue;
    deaths[`${o.lossReason ?? "?"}@${o.diedAt}`] = (deaths[`${o.lossReason ?? "?"}@${o.diedAt}`] ?? 0) + 1;
  }
  return {
    mark,
    content: content.name,
    mount: mountName,
    slots,
    tracks,
    points: tiersCost(loadout),
    strategy: strategy.name,
    clears: outcomes.filter((o) => o.cleared).length,
    runs: outcomes.length,
    medianBays: median(outcomes.map((o) => o.baysCleared)),
    avgBays: outcomes.reduce((a, o) => a + o.baysCleared, 0) / outcomes.length,
    deepest: Math.max(...outcomes.map((o) => o.baysCleared)),
    wall: median(outcomes.map((o) => o.diedAt ?? RUN_LEVELS)),
    deaths,
  };
}

const rows: SlotRow[] = [];
const started = Date.now();
for (const mark of marks) {
  for (const cName of contentNames) {
    const content = CONTENT[cName];
    const mounts = mountNames.map((m) => (m === "auto" ? autoMountFor(content) : m));
    for (const mount of new Set(mounts)) {
      for (const slots of slotCounts) rows.push(flyCell(mark, content, mount, slots));
    }
  }
}

if (jsonOut) {
  console.log(JSON.stringify({ marks, slotCounts, seeds: seedCount, rows }, null, 2));
} else {
  console.log(
    `Slot sweep — marks ${marks.join(",")} · slots ${slotCounts.join(",")} · ${seedCount} seeds`
    + ` · bot ${botName}+bond · content ${contentNames.join(",")} · mounts ${mountNames.join(",")}`,
  );
  console.log(
    "The pilot MATCHES THE RACK (liner -> cushion, lance -> lance, otherwise naive) and is printed per row.",
  );
  console.log(
    "Pessimism ledger: no lookahead, no pile reading, a fixed landing target. A human clears bays this loses.\n",
  );
  let head = "";
  for (const row of rows) {
    const key = `${row.mark}/${row.content}/${row.mount}`;
    if (key !== head) {
      head = key;
      console.log(`=== TIER ${row.mark} · ${row.content} · ${row.mount} ===`);
      console.log("  slots  pts  pilot    clear  avg  med  best  wall  rack");
    }
    console.log(
      `  ${String(row.slots).padStart(5)}`
      + `  ${String(row.points).padStart(3)}`
      + `  ${row.strategy.padEnd(7)}`
      + `  ${String(row.clears).padStart(2)}/${String(row.runs).padEnd(2)}`
      + `  ${row.avgBays.toFixed(1).padStart(4)}`
      + `  ${String(row.medianBays).padStart(3)}`
      + `  ${String(row.deepest).padStart(4)}`
      + `  ${String(row.wall).padStart(4)}`
      + `  ${row.tracks.join(" ")}`,
    );
  }
  console.log(`\n${rows.length} cells · ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
