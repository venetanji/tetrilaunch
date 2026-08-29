#!/usr/bin/env npx tsx
/**
 * TIMED CLEARS — does the grade separate two ways of playing, and does the
 * economy built on it separate them where the owner says the game is boring?
 *
 *   npx tsx sim/timing.ts --marks 4,8,10 --bays 1,5,10 --seeds 6
 *   npx tsx sim/timing.ts --marks 10 --bays 10 --seeds 8 --skydeck
 *   npx tsx sim/timing.ts --mode burn --marks 10 --bays 5 --seeds 8
 *   npx tsx sim/timing.ts --mode scrap --marks 10 --seeds 6 --skydeck
 *
 * ---------------------------------------------------------------------------
 * THE THREE ARMS, AND WHY THEY ARE THE RIGHT THREE
 *
 * `src/game/grades.ts` prices a row by WHEN it closed. That is only a design if
 * two pilots who play differently end up in different bands, and only a
 * BALANCE claim if the band they land in decides whether the bay clears. Four
 * arms, all on the identical bot and search (`aim-strategies.ts`'s rule: the
 * difference between two rows must be the strategy and literally nothing else):
 *
 *   sweep    `naive` — today's pilot. Fires the instant the cooldown and the
 *            purse allow, so its rows are graded by the bar's schedule. This
 *            IS the play the owner is describing: *"the maxed out systems carry
 *            you over and it's boring."*
 *   timed    `timed` — holds fire until the shipment will land inside an
 *            advancing stroke with room to be crushed. Pays for its grades in
 *            SHOTS.
 *   burn     `naive` on the `impatient` preset — the aim search's patience rule
 *            dropped, so it takes every cooldown with whatever it has. The
 *            VOLUME arm: it manufactures the most rows per bay and cares least
 *            what they are worth, which is exactly the funds→scrap conversion
 *            the owner asked to exist ("burning money to make more lines gives
 *            more scrap").
 *
 * ---------------------------------------------------------------------------
 * THE PESSIMISM LEDGER, inherited and extended
 *
 * `winnability.ts` keeps the standing list and every item on it still applies —
 * no lookahead, one landing target per shot, no reading of the pile's shape.
 * Two more belong to this tool specifically, and both run the same way:
 *
 *  - The `timed` arm predicts the bar at its NOMINAL speed, so a bay dragging
 *    under rebar fires early and loses grades it aimed for.
 *  - Its flight estimate is a constant (TIMED_FLIGHT_STEPS), so a lob and a
 *    flat shot are timed the same. A human watching the arc does better.
 *  - Its HOLD is the outermost wrapper (`strategyPilot`'s composition order),
 *    so a held tick also holds the Bond Breaker `bondHands` would have fired.
 *    A real player's thumb is not exclusive like that. Same direction as the
 *    other two: the arm is handicapped, not helped.
 *
 * So a timed share this tool reports is a FLOOR on what a human reaches, and
 * the gap between the arms is a floor on the gap a human would see.
 *
 * WHAT IT CANNOT ANSWER AT ALL, stated because the tuning turns on it: whether
 * holding fire is FUN. The arm proves the timing is reachable and prices it;
 * only a device pass can say whether waiting for the press reads as skill or as
 * dead air. See §7 of design/balance/timed-clears.md.
 */
import { makeBaseLevel, applySkydeckEconomy } from "../src/game/level";
import { applyUpgrades, budgetForMark, nextTierCost, MAX_TIER } from "../src/game/upgrades";
import { GRADES, gradeTallyTotal, timedShare, type GradeTally } from "../src/game/grades";
import { REFIT_EVERY } from "../src/game/run";
import { runBay, type BayOutcome } from "./runner";
import { ADAPTIVE_BOTS, type Bot } from "./bots";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";
import {
  excellentStrategy, naiveStrategy, strategyPilot, timedStrategy,
} from "./aim-strategies";

/* ---------------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
function get(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
const nums = (s: string): number[] =>
  s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));

const marks = nums(get("--marks") ?? "4,8,10");
const bays = nums(get("--bays") ?? "1,5,10");
const seedCount = Math.max(1, parseInt(get("--seeds") ?? "6", 10));
const buildName = get("--build") ?? "full";
const skydeck = argv.includes("--skydeck");
const jsonOut = argv.includes("--json");
const mode = (get("--mode") ?? "arms") as "arms" | "burn" | "scrap" | "target";
/** Which arm the burn table's deltas are measured AGAINST.
 *
 *  `timed` by default, and the default is the argument: the opportunity cost of
 *  spending a bay's bankroll on extra rows is the DISCIPLINED play you gave up,
 *  not the undisciplined one you were already not making. Measured against
 *  `sweep` the loop reads "free" almost everywhere, and it is free — relative to
 *  a pilot who was wasting the money anyway. `--baseline sweep` prints that
 *  reading for anyone who wants "what does this cost against today's game". */
const baselineArm = get("--baseline") ?? "timed";

if (!PRIORITY_ORDERS[buildName]) {
  console.error(`Unknown --build "${buildName}" — available: ${Object.keys(PRIORITY_ORDERS).join(", ")}`);
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * THE ARMS
 * ------------------------------------------------------------------------- */

interface Arm {
  name: string;
  /** A FACTORY, never a built bot: `bots.ts`'s own note is the reason — a bot
   *  carries a jitter RNG stream, so two rows sharing one would stop
   *  reproducing on a re-run and stop being paired across arms. */
  pilot: (seed: number) => Bot;
}

const ARMS: Arm[] = [
  // `demo` hands on all three, matching `winnability.ts`'s default pilot, so a
  // row here and a row there are the same bot plus a policy.
  { name: "sweep", pilot: strategyPilot(naiveStrategy, { bot: ADAPTIVE_BOTS.demo }) },
  { name: "timed", pilot: strategyPilot(timedStrategy, { bot: ADAPTIVE_BOTS.demo }) },
  // THE CEILING ARM (aim-strategies.ts's excellentStrategy): the same pilot
  // holding out for the CRUSH rather than for the grind. It is what the raised
  // targets are calibrated against — "what does skilled, timed play earn" —
  // where `sweep` is the floor, "what does untimed play earn".
  { name: "excel", pilot: strategyPilot(excellentStrategy, { bot: ADAPTIVE_BOTS.demo }) },
  {
    name: "burn",
    // The impatient preset PLUS demolition, assembled from the table rather
    // than from two flags — `PilotOpts.bot`'s note is the bug this avoids.
    pilot: strategyPilot(naiveStrategy, {
      bot: { ...ADAPTIVE_BOTS.demo, ...ADAPTIVE_BOTS.impatient },
    }),
  },
];

/** The bay a given (mark, bay, skydeck) row is actually flown on: the base
 *  ladder entry, the roof's economy step where asked for, then the Mark's own
 *  full build. Assembled here rather than in each mode so all three tables are
 *  measuring one rig. */
function bayFor(mark: number, bay: number): ReturnType<typeof makeBaseLevel> {
  const cfg = makeBaseLevel(bay - 1, mark);
  if (skydeck) applySkydeckEconomy(cfg, bay - 1, mark);
  applyUpgrades(cfg, loadoutFor(PRIORITY_ORDERS[buildName], mark, budgetForMark(mark)));
  return cfg;
}

interface Row {
  mark: number;
  bay: number;
  arm: string;
  n: number;
  wins: number;
  lines: number;
  shots: number;
  endScore: number;
  target: number;
  scrap: number;
  grades: GradeTally;
}

function playArm(mark: number, bay: number, arm: Arm): Row {
  const cfg = bayFor(mark, bay);
  const row: Row = {
    mark, bay, arm: arm.name, n: seedCount, wins: 0,
    lines: 0, shots: 0, endScore: 0, target: cfg.targetScore, scrap: 0,
    grades: { excellent: 0, good: 0, swept: 0, lucky: 0 },
  };
  for (let s = 0; s < seedCount; s++) {
    const seed = 1000 + s;
    const out: BayOutcome = runBay(bayFor(mark, bay), arm.pilot(seed), seed);
    if (out.status === "won") row.wins += 1;
    row.lines += out.lines;
    row.shots += out.shots;
    row.endScore += out.endScore;
    row.scrap += out.scrapEarned;
    for (const g of GRADES) row.grades[g] += out.grades[g];
  }
  return row;
}

const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((100 * a) / b)}%` : "—");
const avg = (a: number, n: number): string => (a / n).toFixed(1);

/* ---------------------------------------------------------------------------
 * MODE: arms — the grade census and what it buys
 * ------------------------------------------------------------------------- */

function armsTable(): Row[] {
  const rows: Row[] = [];
  console.log(
    `\n# Timed clears — arms\nbuild=${buildName} seeds=${seedCount}`
    + `${skydeck ? " SKYDECK (rung 11 economy)" : ""}\n`,
  );
  console.log("| Mark | Bay | Arm | Win | Lines | Shots | End/Target | Exc | Good | Swept | Lucky | Timed% | Scrap |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const mark of marks) {
    for (const bay of bays) {
      for (const arm of ARMS) {
        const r = playArm(mark, bay, arm);
        rows.push(r);
        const t = gradeTallyTotal(r.grades);
        console.log(
          `| ${r.mark} | ${r.bay} | ${r.arm} | ${pct(r.wins, r.n)} | ${avg(r.lines, r.n)} `
          + `| ${avg(r.shots, r.n)} | ${(r.endScore / r.n / r.target).toFixed(2)} `
          + `| ${pct(r.grades.excellent, t)} | ${pct(r.grades.good, t)} `
          + `| ${pct(r.grades.swept, t)} | ${pct(r.grades.lucky, t)} `
          + `| ${(100 * timedShare(r.grades)).toFixed(0)}% | ${avg(r.scrap, r.n)} |`,
        );
      }
    }
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * MODE: burn — what a dollar buys in scrap
 *
 * The owner's third ask, priced: *"there could be strategies where burning
 * money to make more lines gives more scrap"*. The loop only EXISTS as a
 * decision if it costs something, so the number this prints is the exchange
 * rate — funds given up per extra point of scrap — measured on identical seeds
 * against a stated arm (`--baseline`, see its note) rather than against a model.
 *
 * The comparison is paired and the denominator is the DIFFERENCE, which is the
 * whole point: an arm that simply cleared more lines for free would show an
 * infinite rate, and the table says so by printing "free" — a finding rather
 * than a number.
 * ------------------------------------------------------------------------- */

function burnTable(): void {
  const base0 = ARMS.find((a) => a.name === baselineArm);
  if (!base0) {
    console.error(`Unknown --baseline "${baselineArm}" — available: ${ARMS.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }
  console.log(
    `\n# Burning funds for scrap — exchange rate\nbuild=${buildName} seeds=${seedCount}`
    + ` baseline=${baselineArm}${skydeck ? " SKYDECK (rung 11 economy)" : ""}\n`,
  );
  console.log("| Mark | Bay | Arm | Win | Shots | Lines | Scrap | End$ | Δscrap | Δend$ | $/scrap |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const mark of marks) {
    for (const bay of bays) {
      const base = playArm(mark, bay, base0);
      for (const arm of ARMS) {
        const r = playArm(mark, bay, arm);
        const dScrap = (r.scrap - base.scrap) / r.n;
        const dEnd = (r.endScore - base.endScore) / r.n;
        const rate = arm.name === baselineArm
          ? "—"
          : Math.abs(dScrap) < 0.05
            ? "n/a"
            : dEnd >= 0 && dScrap > 0
              ? "free"
              : (-dEnd / dScrap).toFixed(1);
        console.log(
          `| ${mark} | ${bay} | ${r.arm} | ${pct(r.wins, r.n)} | ${avg(r.shots, r.n)} `
          + `| ${avg(r.lines, r.n)} | ${avg(r.scrap, r.n)} | ${avg(r.endScore, r.n)} `
          + `| ${dScrap.toFixed(1)} | ${dEnd.toFixed(0)} | ${rate} |`,
        );
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * MODE: scrap — can the first refit stop sell a THIRD-TIER rung?
 *
 * The owner's second ask: *"refit of some systems's third tier should be
 * possible"*. It is an arithmetic question once the line count is measured, and
 * the arithmetic is run.ts's and upgrades.ts's, not this file's:
 *
 *   stop 1 scrap = REFIT_EVERY x (lines/bay x scrapPerLine + scrapPerBay)
 *   a tier-3 rung costs nextTierCost(2)
 *
 * "SOME systems" is the design constraint and it falls out of the same
 * arithmetic: the answer is worth reporting as RUNGS AFFORDED, because one is a
 * choice and five is a shopping trip (level.ts's SKYDECK_SCRAP_SHARE note makes
 * exactly this argument about the roof).
 *
 * Bays 1-REFIT_EVERY are played individually rather than as a chained run: this
 * mode is asking what a bay YIELDS, and `deeprun.ts` would fold in the carry,
 * the ratchets and the draft, none of which change the scrap rate and all of
 * which would make the number a fact about a draft policy.
 * ------------------------------------------------------------------------- */

function scrapTable(): void {
  const rungCost = nextTierCost(MAX_TIER - 1) ?? 0;
  console.log(
    `\n# First refit stop — can it sell a tier-${MAX_TIER} rung?\n`
    + `build=${buildName} seeds=${seedCount} rung=${rungCost} scrap`
    + `${skydeck ? " SKYDECK (rung 11 economy, half scrap)" : ""}\n`,
  );
  console.log(`| Mark | Arm | Bays 1-${REFIT_EVERY} lines | Scrap at stop 1 | Rungs afforded | Timed% |`);
  console.log("|---|---|---|---|---|---|");
  for (const mark of marks) {
    for (const arm of ARMS) {
      let scrap = 0;
      let lines = 0;
      const grades: GradeTally = { excellent: 0, good: 0, swept: 0, lucky: 0 };
      for (let bay = 1; bay <= REFIT_EVERY; bay++) {
        const r = playArm(mark, bay, arm);
        // The per-bay clear bonus the RUN adds on top of what the bay paid —
        // main.ts's afterBayClear banks `g.scrapEarned + level.scrapPerBay`,
        // and a stop-1 total that omitted it would under-report by three bays'
        // worth of it.
        scrap += r.scrap / r.n + bayFor(mark, bay).scrapPerBay;
        lines += r.lines / r.n;
        for (const g of GRADES) grades[g] += r.grades[g];
      }
      console.log(
        `| ${mark} | ${arm.name} | ${lines.toFixed(1)} | ${scrap.toFixed(0)} `
        + `| ${Math.floor(scrap / rungCost)} | ${(100 * timedShare(grades)).toFixed(0)}% |`,
      );
    }
  }
}

/* ---------------------------------------------------------------------------
 * MODE: target — the raise that separates the arms
 *
 * The mode that actually CHOOSES a number, and it exists because the obvious
 * statistic does not. `End/Target` in the arms table saturates near 1.0 for
 * every winning arm and it has to: `Game`'s objective opens a settle window the
 * moment the target is met, so a bay STOPS as soon as it is paid for. A pilot
 * banking three times the money per shot does not end up with three times the
 * money — it ends up with the same money and a lot of unused clock. Reading the
 * ratio as a margin would report every arm as equally comfortable.
 *
 * So the margin is measured the only way it can be: by MOVING THE BAR and
 * seeing who is still standing. Each row multiplies the bay's own target and
 * nothing else, so the column that changes is exactly the one the design is
 * proposing to change, and the win rates are read at each step.
 *
 * WHAT A GOOD ANSWER LOOKS LIKE, stated before the numbers so the tuning is not
 * fitted to them: a multiplier at which `timed` still clears comfortably and
 * `sweep` does not. A raise that breaks both is a difficulty tax; one that
 * breaks neither is a no-op.
 * ------------------------------------------------------------------------- */

const targetMults = (get("--target-mults") ?? "1.00,1.05,1.10,1.15,1.20,1.25")
  .split(",").map((x) => parseFloat(x.trim())).filter((n) => Number.isFinite(n));

function targetTable(): void {
  console.log(
    `\n# Target raise — who is still standing\nbuild=${buildName} seeds=${seedCount}`
    + `${skydeck ? " SKYDECK (rung 11 economy)" : ""}\n`,
  );
  console.log(`| Mark | Bay | Arm | ${targetMults.map((m) => `x${m.toFixed(2)}`).join(" | ")} |`);
  console.log(`|---|---|---|${targetMults.map(() => "---").join("|")}|`);
  for (const mark of marks) {
    for (const bay of bays) {
      for (const arm of ARMS) {
        const cells: string[] = [];
        for (const mult of targetMults) {
          let wins = 0;
          for (let s = 0; s < seedCount; s++) {
            const seed = 1000 + s;
            const cfg = bayFor(mark, bay);
            cfg.targetScore = Math.round(cfg.targetScore * mult);
            if (runBay(cfg, arm.pilot(seed), seed).status === "won") wins += 1;
          }
          cells.push(pct(wins, seedCount));
        }
        console.log(`| ${mark} | ${bay} | ${arm.name} | ${cells.join(" | ")} |`);
      }
    }
  }
}

/* ------------------------------------------------------------------------- */

if (mode === "target") {
  targetTable();
} else if (mode === "arms") {
  const rows = armsTable();
  if (jsonOut) console.log(JSON.stringify(rows, null, 2));
} else if (mode === "burn") {
  burnTable();
} else if (mode === "scrap") {
  scrapTable();
} else {
  console.error(`Unknown --mode "${mode}" — available: arms, burn, scrap, target`);
  process.exit(1);
}
