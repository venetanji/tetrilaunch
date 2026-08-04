#!/usr/bin/env npx tsx
/**
 * Systems smoke test: drives the NON-physics systems added in the refit phase
 * (piece sizes, ship upgrades, refit stops, scrap/salvage economy, the reworked
 * demolition charges, the layout solver) headlessly and asserts the invariants
 * that would otherwise only be checked by playing.
 *
 *   npx tsx sim/systems.ts
 *
 * Deliberately NOT a balance sweep (that's sweep.ts) and not a perf test
 * (perf.ts) — this answers "are the new systems wired up correctly and do their
 * numbers compose the way the design says", which is the class of bug that a
 * balance sweep passes right over.
 */
import Matter from "matter-js";
import { Game, AUTO_SPREAD_RAD, AUTO_POWER_JITTER } from "../src/game/game";
import { makeBaseLevel, materialMixFor, MATERIAL_SCHEDULE } from "../src/game/level";
import { applyMods, draftOffers, MODS, mulberry32 } from "../src/game/mods";
import { Cannon } from "../src/game/cannon";
import { Compactor } from "../src/game/compactor";
import { createPhysics, WORLD, WALL_INNER } from "../src/game/engine";
import {
  fillsSlots, strikeCryo, shatterColdCryo, updateLineClear, CRYO_STRIKE_SPEED,
} from "../src/game/lineClear";
import type { Cube } from "../src/game/pieces";
import type { Material } from "../src/game/theme";
import {
  applyUpgrades, newTiers, nextTierCost, tiersCost, MAX_TIER, TIER_COSTS, UPGRADES,
  budgetForMark, buyLoadoutTier, FULL_BUILD_COST, loadoutLegal, MARK_COUNT,
} from "../src/game/upgrades";
import {
  contractClaimed, markUnlocked, newMeta, safeLoadout, salvageForContract, salvageForRun,
  UNLOCKS, unlockAvailable, draftSlots, DRAFT_BASE_SLOTS, DRAFT_FULL_SLOTS,
  DRAFT_THIRD_SLOT_CONTRACTS, INSTALLS, installById, installAvailable, installGates,
  buyInstall, markBudget, type InstallDef, type MetaState,
} from "../src/game/meta";
import {
  advanceRun, buyUpgrade, isRefitBay, levelForRun, newRun, REFIT_EVERY, RUN_LEVELS,
} from "../src/game/run";
import {
  dailyContracts, levelForContract, DAILY_COUNT, CUBES_PER_LINE, PLANNING_EFFICIENCY,
  SPARE_SHIPMENTS, TINY_PATTERN_MIN_TIER,
} from "../src/game/contracts";
import { pieceCells, SIZE_SPEC } from "../src/game/pieces";
import { tilesRegion } from "../src/game/tiling";
import { computeLayout, setSafeAreaInsets, RAIL_MIN } from "../src/game/layout";
import { PIECE_TYPES } from "../src/game/theme";
import { CELL } from "../src/game/engine";
import { endBoard, fullBoard, END_BOARD_TOP, contractsScreen } from "../src/ui/screens";
import type { ScoreEntry } from "../src/lib/api";

let failures = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section("Piece sizes (theme.ts PENTA_SHAPES / pieces.ts SIZE_SPEC)");
// ---------------------------------------------------------------------------
for (const t of PIECE_TYPES) {
  check(`${t} tiny has 2 cells`, pieceCells(t, "tiny").length === 2);
  check(`${t} std has 4 cells`, pieceCells(t, "std").length === 4);
  check(`${t} bulk has 5 cells`, pieceCells(t, "bulk").length === 5);
  // Every preview grid in the UI is 4x4 (components.ts's pieceCellsHTML), so a
  // shape whose extent exceeds that would silently render clipped.
  const cells = pieceCells(t, "bulk");
  const w = Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1;
  const h = Math.max(...cells.map(([, y]) => y)) - Math.min(...cells.map(([, y]) => y)) + 1;
  check(`${t} bulk fits a 4x4 preview box`, w <= 4 && h <= 4, `${w}x${h}`);
  // A pentomino must be edge-connected or it would spawn as disjoint clumps.
  const key = (x: number, y: number) => `${x},${y}`;
  const set = new Set(cells.map(([x, y]) => key(x, y)));
  const seen = new Set<string>();
  const stack = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (seen.has(key(x, y))) continue;
    seen.add(key(x, y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (set.has(key(x + dx, y + dy))) stack.push([x + dx, y + dy]);
    }
  }
  check(`${t} bulk is edge-connected`, seen.size === cells.length, `${seen.size}/${cells.length}`);
}
// The design intent: tiny is lighter AND more fragile, bulk heavier AND tougher.
check("tiny is lighter than std", SIZE_SPEC.tiny.densityMult < SIZE_SPEC.std.densityMult);
check("bulk is heavier than std", SIZE_SPEC.bulk.densityMult > SIZE_SPEC.std.densityMult);
check("tiny breaks more easily", SIZE_SPEC.tiny.breakMult < SIZE_SPEC.std.breakMult);
check("bulk is more rigid", SIZE_SPEC.bulk.breakMult > SIZE_SPEC.std.breakMult);

// ---------------------------------------------------------------------------
section("Ship upgrades (upgrades.ts)");
// ---------------------------------------------------------------------------
{
  const stock = makeBaseLevel(0);
  const maxed = makeBaseLevel(0);
  const tiers = newTiers();
  for (const u of UPGRADES) tiers[u.id] = MAX_TIER;
  applyUpgrades(maxed, tiers);

  check("BAY t3 reaches 18 open cells", maxed.compactorOpenCells === 18, String(maxed.compactorOpenCells));
  check("LAUNCHER t3 raises muzzle power", maxed.launchPower > stock.launchPower);
  check(
    "LAUNCHER t3 cancels most wind but never all of it",
    maxed.windAssist > 0.5 && maxed.windAssist < 1,
    String(maxed.windAssist),
  );
  check("HYDRAULICS t3 raises settle assist", maxed.settleAssist > stock.settleAssist);
  check("MAGAZINE t3 cuts cooldown", maxed.cooldownMs < stock.cooldownMs);
  check("MAGAZINE keeps a positive cooldown", maxed.cooldownMs > 0, String(maxed.cooldownMs));
  check("REACTOR t3 raises float and rate", maxed.startingFunds > stock.startingFunds && maxed.scorePerLine > stock.scorePerLine);
  check("BONDS t3 grants charges", maxed.bondBreakerCharges === MAX_TIER, String(maxed.bondBreakerCharges));

  // Tier 0 must be a true no-op — the stock ship is the base ladder exactly.
  const untouched = makeBaseLevel(3);
  const before = JSON.stringify(untouched);
  applyUpgrades(untouched, newTiers());
  check("tier 0 across the board is a no-op", JSON.stringify(untouched) === before);

  check(
    "nextTierCost walks the ladder then reports MAX",
    nextTierCost(0) === TIER_COSTS[0] && nextTierCost(2) === TIER_COSTS[2] && nextTierCost(3) === null,
  );
  const full = TIER_COSTS.reduce((a, b) => a + b, 0);
  check(
    "tiersCost totals a maxed track",
    tiersCost({ ...newTiers(), bay: MAX_TIER }) === full,
    String(tiersCost({ ...newTiers(), bay: MAX_TIER })),
  );

  // Demolition is a TRACK, not only a drafted card. Installing a system has to
  // actually grant the thing the system is named for, or a Workshop purchase
  // buys nothing — which is the bug this whole layer exists to fix.
  const demoCfg = makeBaseLevel(0);
  applyUpgrades(demoCfg, { ...newTiers(), demolition: 2 });
  check("the demolition track grants charges", demoCfg.bombCharges === 2, String(demoCfg.bombCharges));
  const demoStock = makeBaseLevel(0);
  applyUpgrades(demoStock, newTiers());
  check("an uninstalled demolition track grants none", demoStock.bombCharges === 0, String(demoStock.bombCharges));
  check("a full rig now costs 770", FULL_BUILD_COST === 770, String(FULL_BUILD_COST));
}

// ---------------------------------------------------------------------------
section("Build budget + Mark ladder (upgrades.ts / meta.ts / level.ts)");
// ---------------------------------------------------------------------------
{
  // The budget is DERIVED from the price ladder, so a re-price can't leave a
  // stale total behind.
  check(
    "FULL_BUILD_COST is every track maxed",
    FULL_BUILD_COST === tiersCost(Object.fromEntries(UPGRADES.map((u) => [u.id, MAX_TIER])) as never),
    String(FULL_BUILD_COST),
  );
  check("a full rig costs 770", FULL_BUILD_COST === 770, String(FULL_BUILD_COST));

  // Monotone, and the ladder spans "one system" to "everything".
  let monotone = true;
  for (let m = 2; m <= MARK_COUNT; m++) if (budgetForMark(m) <= budgetForMark(m - 1)) monotone = false;
  check("budget rises with every Mark", monotone);
  check("the top Mark affords a full rig", budgetForMark(MARK_COUNT) === FULL_BUILD_COST);
  check(
    "Mark 1 affords roughly one system",
    budgetForMark(1) >= TIER_COSTS[0] && budgetForMark(1) < FULL_BUILD_COST / 5,
    String(budgetForMark(1)),
  );
  // Out-of-range Marks clamp rather than producing a negative or runaway budget
  // — meta.mark comes off localStorage and can be anything.
  check("budget clamps below Mark 1", budgetForMark(0) === budgetForMark(1) && budgetForMark(-5) === budgetForMark(1));
  check("budget clamps above the ladder", budgetForMark(MARK_COUNT + 99) === FULL_BUILD_COST);

  // Legality: the budget is the ONLY cap, so a loadout may pile everything into
  // one track as long as it fits.
  const oneTrackMaxed = { ...newTiers(), hydraulics: MAX_TIER };
  check("a single maxed track is legal once affordable", loadoutLegal(oneTrackMaxed, MARK_COUNT));
  check("...and illegal at Mark 1", !loadoutLegal(oneTrackMaxed, 1));
  check("an empty loadout is always legal", loadoutLegal(newTiers(), 1));
  check(
    "a full rig is illegal below the top Mark",
    !loadoutLegal(Object.fromEntries(UPGRADES.map((u) => [u.id, MAX_TIER])) as never, MARK_COUNT - 1),
  );
  check("a tier above MAX_TIER is rejected", !loadoutLegal({ ...newTiers(), bay: MAX_TIER + 1 }, MARK_COUNT));
  check("a negative tier is rejected", !loadoutLegal({ ...newTiers(), bay: -1 }, MARK_COUNT));
  check("a fractional tier is rejected", !loadoutLegal({ ...newTiers(), bay: 1.5 }, MARK_COUNT));

  // buyLoadoutTier mirrors run.ts's buyUpgrade: never mutates, refuses when the
  // next tier doesn't fit.
  const start = newTiers();
  const one = buyLoadoutTier(start, "bay", 1);
  check("buyLoadoutTier returns a new object", one !== null && one !== start);
  check("buyLoadoutTier raises the tier", one!.bay === 1);
  check("buyLoadoutTier does not mutate the input", start.bay === 0);
  check("buyLoadoutTier refuses a maxed track", buyLoadoutTier({ ...newTiers(), bay: MAX_TIER }, "bay", MARK_COUNT) === null);
  // Mark 1's budget (66) buys 20+35 = 55 but not the 55-point third tier.
  const twoTiers = buyLoadoutTier(buyLoadoutTier(newTiers(), "bay", 1)!, "bay", 1);
  check("Mark 1 affords two tiers of a track", twoTiers !== null && twoTiers.bay === 2);
  check("Mark 1 cannot afford the third", buyLoadoutTier(twoTiers!, "bay", 1) === null);

  // safeLoadout is the gate that stops a hand-edited save flying an illegal rig.
  const cheat = { ...newMeta(), mark: 0, loadout: { ...newTiers(), reactor: MAX_TIER, bay: MAX_TIER } };
  check("safeLoadout drops an over-budget loadout to stock", tiersCost(safeLoadout(cheat)) === 0);
  const honest = { ...newMeta(), mark: 0, loadout: { ...newTiers(), bay: 1 } };
  check("safeLoadout keeps a legal loadout", safeLoadout(honest).bay === 1);
  check("safeLoadout copies rather than aliases", safeLoadout(honest) !== honest.loadout);

  check("markUnlocked is one above the best clear", markUnlocked({ ...newMeta(), mark: 3 }) === 4);
  check("markUnlocked starts at 1", markUnlocked(newMeta()) === 1);
  check("markUnlocked holds at the top", markUnlocked({ ...newMeta(), mark: MARK_COUNT }) === MARK_COUNT);

  // The ladder must raise the floor and the bar TOGETHER. Mark 1 is stock, so
  // every tuned constant in makeBaseLevel survives at the bottom.
  check(
    "Mark 1 is byte-identical to the stock ladder",
    JSON.stringify(makeBaseLevel(4, 1)) === JSON.stringify(makeBaseLevel(4)),
  );
  let barRises = true;
  for (let m = 2; m <= MARK_COUNT; m++) {
    if (makeBaseLevel(0, m).targetScore <= makeBaseLevel(0, m - 1).targetScore) barRises = false;
  }
  check("every Mark raises the bay's target", barRises);
  // Compactor speed is deliberately Mark-invariant (MARK_SPEED_STEP is 0).
  // sim/marks.ts measured it as an erratic bankruptcy tax rather than a
  // difficulty ramp: a faster sweep pushes pieces out before they settle, and
  // the lost-piece penalty drains the bankroll. Asserted so re-enabling it is a
  // deliberate act with a failing test to read, not a quiet regression.
  check(
    "compactor speed does not scale with Mark",
    makeBaseLevel(0, MARK_COUNT).compactorSpeed === makeBaseLevel(0, 1).compactorSpeed,
  );
  // Deliberately NOT scaled — these would compound with the target into a cliff.
  check(
    "launch cost and loss penalty are Mark-invariant",
    makeBaseLevel(5, MARK_COUNT).launchCost === makeBaseLevel(5, 1).launchCost &&
      makeBaseLevel(5, MARK_COUNT).penaltyPerLostPiece === makeBaseLevel(5, 1).penaltyPerLostPiece,
  );

  // A run flies the loadout it was handed, and the Mark reaches the level.
  const loaded = newRun(9, [], 0, { ...newTiers(), launcher: 2 }, 3);
  check("newRun seeds tiers from the loadout", loaded.tiers.launcher === 2);
  check("newRun records the Mark", loaded.mark === 3);
  check(
    "the loadout survives into the level config",
    levelForRun(loaded).launchPower > makeBaseLevel(0, 3).launchPower,
  );
  check(
    "levelForRun uses the run's Mark",
    levelForRun(newRun(9, [], 0, newTiers(), 4)).targetScore === makeBaseLevel(0, 4).targetScore,
  );
  check("advanceRun carries the Mark", advanceRun(loaded, 900, 800, 8, 26, null).mark === 3);
  const source = { ...newTiers(), bay: 1 };
  newRun(1, [], 0, source, 2).tiers.bay = 3;
  check("newRun copies the loadout rather than aliasing it", source.bay === 1);
}

// ---------------------------------------------------------------------------
section("Installs — what salvage buys (meta.ts)");
// ---------------------------------------------------------------------------
{
  // Every system must be installable, or a track exists that salvage can never
  // reach and the refit menu shows a card nobody can ever use.
  check("every upgrade track has exactly one install",
    UPGRADES.every((u) => INSTALLS.filter((i) => i.id === u.id).length === 1) &&
      INSTALLS.length === UPGRADES.length,
    `${INSTALLS.length} installs vs ${UPGRADES.length} tracks`);
  check("no install is priced at zero", INSTALLS.every((i) => i.cost > 0));
  check("every Mark gate is inside the ladder",
    INSTALLS.every((i) => i.requiresMark === undefined || (i.requiresMark >= 1 && i.requiresMark < MARK_COUNT)));
  // Mark 1 must open enough systems to make a first shop trip a real choice.
  check("at least two systems need no Mark at all",
    INSTALLS.filter((i) => i.requiresMark === undefined).length >= 2);

  const freshMeta = (over: Partial<MetaState> = {}): MetaState => ({ ...newMeta(), ...over });
  const tooExpensiveForBudget = (m: MetaState, i: InstallDef): boolean =>
    tiersCost({ ...m.loadout, [i.id]: 1 }) > markBudget(m);

  // The monetization invariant, executable. No salvage total buys a system
  // whose Mark has not been beaten.
  const rich = freshMeta({ salvage: 99999 });
  check("no amount of salvage buys a Mark-gated install below its Mark",
    INSTALLS.filter((i) => i.requiresMark !== undefined)
      .every((i) => !installAvailable(rich, i)));
  const topMark = freshMeta({ salvage: 99999, mark: MARK_COUNT });
  check("a Mark-gated install opens once its Mark is beaten",
    INSTALLS.every((i) => installAvailable(topMark, i) || tooExpensiveForBudget(topMark, i)));

  // The budget cap, executable. This is what stops installs being raw power.
  let greedy = freshMeta({ salvage: 99999, mark: 0 });
  for (const i of INSTALLS) {
    const next = buyInstall(greedy, i.id);
    if (next) greedy = next;
  }
  check("greedy installing never exceeds the Mark's build budget",
    tiersCost(greedy.loadout) <= markBudget(greedy),
    `${tiersCost(greedy.loadout)} vs ${markBudget(greedy)}`);
  check("Mark 1 affords exactly three installs",
    Object.values(greedy.loadout).filter((t) => t > 0).length === 3,
    JSON.stringify(greedy.loadout));

  // An install grants tier 1 and charges salvage.
  const bought = buyInstall(freshMeta({ salvage: 100 }), "reactor");
  check("an install grants exactly tier 1", bought?.loadout.reactor === 1);
  check("an install charges its salvage price", bought?.salvage === 80, String(bought?.salvage));
  check("an install the player cannot afford is refused",
    buyInstall(freshMeta({ salvage: 5 }), "reactor") === null);
  check("installing twice is refused", buyInstall(bought!, "reactor") === null);
  const before = freshMeta({ salvage: 100 });
  buyInstall(before, "reactor");
  check("buyInstall never mutates its input",
    before.loadout.reactor === 0 && before.salvage === 100);

  // The locked copy the Workshop prints must name the gate the purchase path
  // actually applies — one function, so the two can never drift.
  const gated = INSTALLS.find((i) => i.requiresMark === 2)!;
  check("installGates names the Mark a gated system waits on",
    installGates(freshMeta(), gated).some((g) => g.includes("Mark 2")),
    installGates(freshMeta(), gated).join(" · "));
  check("installGates is empty for an available system",
    installGates(freshMeta(), installById("reactor")!).length === 0);
  // A spent budget refuses the next install on its own, with salvage to burn
  // and no Mark left to blame — the cap has to bite where the gate does not.
  const remaining = INSTALLS.filter((i) => (greedy.loadout[i.id] ?? 0) === 0);
  check("a spent budget refuses every remaining install",
    remaining.length > 0 && remaining.every((i) => buyInstall(greedy, i.id) === null),
    `${remaining.length} left at ${tiersCost(greedy.loadout)}/${markBudget(greedy)}`);
  const budgetBound = remaining.find((i) => i.requiresMark === undefined);
  check("a budget block reads as a budget, not as a Mark",
    budgetBound === undefined ||
      installGates(greedy, budgetBound).some((g) => g.includes("budget")),
    budgetBound && installGates(greedy, budgetBound).join(" · "));
}

// ---------------------------------------------------------------------------
section("Contracts (contracts.ts)");
// ---------------------------------------------------------------------------
{
  // A daily set must regenerate identically or a per-Contract board is
  // meaningless — every player has to be playing the same bay.
  check(
    "the same day regenerates identically",
    JSON.stringify(dailyContracts(3, 20260730)) === JSON.stringify(dailyContracts(3, 20260730)),
  );
  check(
    "a different day differs",
    JSON.stringify(dailyContracts(3, 20260730)) !== JSON.stringify(dailyContracts(3, 20260731)),
  );
  check("a day offers DAILY_COUNT contracts", dailyContracts(1).length === DAILY_COUNT);

  // The single worst thing this generator could emit is an impossible
  // Contract, so the launch budget is derived from the goal rather than rolled.
  //
  // The predecessor of this check asserted only `strokes >= goal` — at least
  // one compactor press per line. That bound is far below what the game
  // actually demands: measured play needs ~2.9 launches per line, so the test
  // passed while 35% of generated Contracts were unwinnable. The real test is
  // the cube budget: a line spans CUBES_PER_LINE cubes, a launch delivers
  // SIZE_SPEC[size].cubes, and only PLANNING_EFFICIENCY of what's fired lands
  // in a completed line.
  let everImpossible = false;
  let everNegativeWind = false;
  let tierOneTooWindy = false;
  let worstRatio = Infinity;
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 40; seed++) {
      for (const c of dailyContracts(tier, seed)) {
        // Pattern Contracts are bounded by their queue, not a launch budget,
        // and their feasibility is exact rather than statistical — they get
        // their own block below.
        if (c.kind !== "lines") continue;
        const supply = c.launches * SIZE_SPEC[c.pieceSize].cubes * PLANNING_EFFICIENCY;
        const demand = c.goal * CUBES_PER_LINE;
        worstRatio = Math.min(worstRatio, supply / demand);
        if (supply < demand) everImpossible = true;
        if (c.windMax < 0) everNegativeWind = true;
        if (tier === 1 && c.windMax > 0.1) tierOneTooWindy = true;
      }
    }
  }
  check("every contract can supply the cubes its goal needs", !everImpossible);
  // Not merely >= 1: a Contract is the forgiving half of the game, so even the
  // tightest generated one must leave room for an imperfect attempt.
  check(`tightest contract keeps headroom (${worstRatio.toFixed(2)}x)`, worstRatio >= 1.05);

  // CUBES_PER_LINE is a constant in contracts.ts but a consequence of the
  // compactor's geometry. If the min-line stop ever moves, every budget the
  // generator has ever emitted is silently wrong.
  check(
    "CUBES_PER_LINE matches the compactor's min-line stop",
    CUBES_PER_LINE === makeBaseLevel(0).compactorMinLineCells,
  );
  check("wind is never negative", !everNegativeWind);
  // Tier 1 drawing bay-8 weather is the "unfair and you saw it coming" failure
  // the wind rework existed to remove.
  check("tier 1 stays gentle", !tierOneTooWindy);

  // The day's three must be three different problems, not three rolls of one
  // die — that's the difference between a curated board and a shuffle.
  const day = dailyContracts(4, 20260730);
  check(
    "the day's contracts differ from each other",
    new Set(day.map((c) => `${c.pieceSize}|${c.windMax > 0}|${c.launches}|${c.goal}`)).size > 1,
  );
  check("names within a day are distinct", new Set(day.map((c) => c.name)).size === day.length);

  // Contracts carry NEITHER of Deep Run's pressures. If either leaks in, the
  // mode silently stops being the relaxed half.
  for (const c of dailyContracts(5, 20260730)) {
    const cfg = levelForContract(c);
    check(`${c.name}: no launch cost`, cfg.launchCost === 0);
    check(`${c.name}: no clock`, cfg.timeLimitSec === 0);
    check(`${c.name}: line objective set`, cfg.objectiveLines === c.goal);
    // A funds target of 0 would win the bay on frame one; it must be
    // unreachable so the objective is the only thing that can end it.
    check(`${c.name}: funds target unreachable`, cfg.targetScore > 1e9);
    // Exactly ONE supply limit, whichever kind this is. A bay carrying both a
    // queue and a launch budget would count the same limit twice under two
    // names, and whichever ran out first would end it for the wrong stated
    // reason.
    const budgeted = cfg.launchBudget > 0;
    const queued = (cfg.pieceQueue?.length ?? 0) > 0;
    check(`${c.name}: exactly one supply limit`, budgeted !== queued);
    if (c.kind === "lines") {
      check(`${c.name}: launch budget set`, cfg.launchBudget === c.launches && budgeted);
    } else {
      check(`${c.name}: queue set`, cfg.pieceQueue?.length === c.queue.length);
    }
  }

  // Deep Run must be untouched by any of this.
  const deep = makeBaseLevel(0);
  check("Deep Run bays have no launch budget", deep.launchBudget === 0);
  check("Deep Run bays win on funds", deep.objectiveLines === 0);
  check("Deep Run bays draw from an endless bag", deep.pieceQueue === null);
}

// ---------------------------------------------------------------------------
section("Pattern Contracts (contracts.ts)");
// ---------------------------------------------------------------------------
{
  // EXACTNESS is the whole mechanic. A queue one cube over is a different (and
  // easier) game; one cube under is unwinnable from frame one, which is the
  // single worst thing this generator can emit — and unlike a launch budget,
  // it's arithmetic, so it can be proved rather than estimated.
  let everInexact = false;
  let everWindy = false;
  let everBudgeted = false;
  let everOffPool = false;
  let everUntileable = false;
  let patterns = 0;
  const varietyByTier = new Map<number, number>();
  const sizesSeen = new Set<string>();
  const tinyByTier = new Map<number, number[]>();
  const stdByTier = new Map<number, number[]>();
  let tinyEverMultiShape = false;
  let tinyBelowMinTier = false;
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 40; seed++) {
      for (const c of dailyContracts(tier, seed)) {
        if (c.kind !== "pattern") continue;
        patterns += 1;
        const cubes = c.queue.length * SIZE_SPEC[c.pieceSize].cubes;
        if (cubes !== c.goal * CUBES_PER_LINE + SPARE_SHIPMENTS * SIZE_SPEC[c.pieceSize].cubes) {
          everInexact = true;
        }
        // The cube COUNT above is necessary but nowhere near sufficient: the
        // generator shipped [I, O, J, J] for two lines, which counts perfectly
        // and tiles nothing. Re-solved here with an independent search rather
        // than trusting the one that built it — a guarantee re-derived by the
        // same route it was produced by proves only that the code is itself.
        const lineCells = makeBaseLevel(Math.min(9, tier)).compactorMinLineCells;
        if (!tilesRegion(c.queue, c.goal, lineCells, c.pieceSize)) everUntileable = true;
        varietyByTier.set(tier, Math.max(varietyByTier.get(tier) ?? 0, new Set(c.queue).size));
        sizesSeen.add(c.pieceSize);
        if (c.pieceSize === "tiny") {
          (tinyByTier.get(tier) ?? tinyByTier.set(tier, []).get(tier)!).push(c.goal);
          // A domino ignores its type (pieces.ts's pieceCells), so a tiny
          // Contract that reported several "shapes" would be describing a
          // distinction the player cannot see on the field.
          if (new Set(c.queue).size > 1 && !c.brief.includes("dominoes")) tinyEverMultiShape = true;
          if (tier < TINY_PATTERN_MIN_TIER) tinyBelowMinTier = true;
        } else {
          (stdByTier.get(tier) ?? stdByTier.set(tier, []).get(tier)!).push(c.goal);
        }

        if (c.windMax !== 0) everWindy = true;
        if (c.launches !== 0) everBudgeted = true;
        // Low tiers stay on the two shapes that settle flat. Drawing an S into
        // a tier-1 zero-waste bay is the same unfairness as tier-1 crosswind.
        if (tier <= 2 && c.queue.some((t) => t !== "I" && t !== "O")) everOffPool = true;
      }
    }
  }
  check(`the daily board offers pattern Contracts (${patterns} sampled)`, patterns > 0);
  check("every pattern queue holds exactly the goal's cubes", !everInexact);
  check("every pattern queue tiles its goal region", !everUntileable);
  check("pattern Contracts are always calm", !everWindy);
  check("pattern Contracts carry no launch budget", !everBudgeted);
  check("low tiers draw only the flat-settling shapes", !everOffPool);

  // Difficulty is the number of DIFFERENT shapes in one Contract, so the ladder
  // has to actually climb — a generator that always found a single-shape tiling
  // would pass every check above while offering the same puzzle at every tier.
  // --- Payload sizes -------------------------------------------------------
  // Tiny is a MIXED variant, so a board must be able to produce either.
  check("pattern Contracts ship more than one payload size", sizesSeen.size > 1,
    [...sizesSeen].join(","));
  check("pattern Contracts still ship tetrominoes", sizesSeen.has("std"));
  check("pattern Contracts can ship dominoes", sizesSeen.has("tiny"));
  check("dominoes never appear below their minimum tier", !tinyBelowMinTier);
  check("a domino Contract never advertises a shape count", !tinyEverMultiShape);
  // Tiny cannot scale on shape variety (one shape by construction), so it has
  // to scale on goal instead, or every tier ships the identical Contract.
  const tinyMax = (t: number) => Math.max(...(tinyByTier.get(t) ?? [0]));
  check(
    `domino goals climb with tier (${[2, 5, 9].map(tinyMax).join(" -> ")})`,
    tinyMax(9) > tinyMax(2),
    `${tinyMax(2)} -> ${tinyMax(9)}`,
  );
  // And a domino Contract must be strictly more DELIVERY than a std one: the
  // whole reason it is interesting is that it needs about twice the shipments.
  const stdMax = (t: number) => Math.max(...(stdByTier.get(t) ?? [0]));
  check(
    "a domino Contract asks for at least as many lines as a tetromino one",
    tinyMax(5) >= stdMax(5),
    `tiny ${tinyMax(5)} vs std ${stdMax(5)}`,
  );

  check("a low tier can be a single-shape Contract", varietyByTier.get(1) === 1);
  check(
    `shape variety climbs with tier (${[1, 3, 5, 7].map((t) => varietyByTier.get(t)).join(" -> ")})`,
    varietyByTier.get(3)! > varietyByTier.get(1)! &&
      varietyByTier.get(5)! > varietyByTier.get(3)! &&
      varietyByTier.get(7)! > varietyByTier.get(5)!,
  );

  // The tiling checker is now load-bearing for feasibility, so it gets its own
  // evidence: one that answered "yes" unconditionally would silently bless every
  // regression above. These are the exact sets the old generator shipped.
  check("checker rejects the [I,O,J,J] Contract that shipped", !tilesRegion(["I", "O", "J", "J"], 2, 8));
  check("checker rejects [I,I,I,T,S,Z] over three lines", !tilesRegion(["I", "I", "I", "T", "S", "Z"], 3, 8));
  check("checker accepts a known-good pair of rows", tilesRegion(["I", "I", "O", "O"], 2, 8));
  check("checker accepts four L shipments", tilesRegion(["L", "L", "L", "L"], 2, 8));
  // S and Z tile no rectangle at all, and four T pieces need four rows, not two
  // — the two facts that make "just widen the pool" the wrong difficulty knob.
  check("checker rejects S/Z-only rows", !tilesRegion(["S", "S", "Z", "Z"], 2, 8));
  check("checker rejects four T over two rows", !tilesRegion(["T", "T", "T", "T"], 2, 8));
  check("checker accepts four T over four rows", tilesRegion(["T", "T", "T", "T"], 4, 4));
  // Wrong cube count is rejected on arithmetic before any search runs.
  check("checker rejects a queue that can't fill the area", !tilesRegion(["I", "O"], 2, 8));

  // The width the inventory is sized to must be the width the bay actually
  // demands at full advance. If those ever part company, every pattern Contract
  // is off by a cube per line — the same defect class the tiling bug was.
  check(
    "pattern inventories are sized to the bay's own line width",
    makeBaseLevel(0).compactorMinLineCells === CUBES_PER_LINE,
  );

  const c = dailyContracts(6, 20260730).find((x) => x.kind === "pattern")!;
  // The SET is the shared challenge and must be reproducible from the id. The
  // ORDER must NOT be: one unlucky permutation would otherwise make this
  // Contract permanently unwinnable for everyone who drew it, and free retries
  // would hand back the identical bad order forever.
  const again = dailyContracts(6, 20260730).find((x) => x.kind === "pattern")!;
  check("the set is stable for a Contract id", JSON.stringify(c.queue) === JSON.stringify(again.queue));

  // Deterministic stand-in for Math.random, so "the order is re-rolled" is
  // tested rather than hoped for — a fixed permutation would pass a
  // same-multiset check while failing the property that matters.
  let n = 0;
  const fakeRng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
  const a = levelForContract(c, fakeRng).pieceQueue!;
  const b = levelForContract(c, fakeRng).pieceQueue!;
  check("an attempt receives the whole set", a.length === c.queue.length);
  check(
    "an attempt receives exactly the advertised multiset",
    JSON.stringify([...a].sort()) === JSON.stringify([...c.queue].sort()),
  );
  check("the play order is re-rolled per attempt", JSON.stringify(a) !== JSON.stringify(b));

  // --- Contract payout -----------------------------------------------------
  let payoutMonotone = true;
  for (let t = 2; t <= 12; t++) {
    if (salvageForContract(t) <= salvageForContract(t - 1)) payoutMonotone = false;
  }
  check("contract payout rises with tier", payoutMonotone);
  check("payout clamps below tier 1", salvageForContract(0) === salvageForContract(1));

  // A Contract must not out-earn the exam. Three dailies a day against a run
  // that pays ~43 for a decent attempt: a week of tier-1 dailies should buy a
  // visible slice of the unlock tree without trivialising it.
  const treeCost = UNLOCKS.reduce((a, u) => a + u.cost, 0);
  const weekOfDailies = 7 * DAILY_COUNT * salvageForContract(1);
  check(
    `a week of tier-1 dailies is a fraction of the tree (${weekOfDailies}/${treeCost})`,
    weekOfDailies > 0 && weekOfDailies < treeCost * 0.6,
    `${((weekOfDailies / treeCost) * 100).toFixed(0)}%`,
  );

  // The payout gate is meta.claimedContracts, and it must fail CLOSED: an
  // unknown Contract is unpaid, a listed one is paid. If this ever inverted,
  // every Contract would pay on every replay — the monetization leak the
  // launch-budget spec exists to prevent.
  const paid = { ...newMeta(), claimedContracts: ["20260730-1-0"] };
  check("a claimed contract reads as claimed", contractClaimed(paid, "20260730-1-0"));
  check("an unseen contract reads as unclaimed", !contractClaimed(paid, "20260730-1-1"));
  check("a fresh save has claimed nothing", newMeta().claimedContracts.length === 0);

  // The board's tick reads that SAME persisted list. It used to read a
  // session-only array, so clearing a Contract and coming back later showed an
  // untouched board — the progress was recorded and then not displayed.
  const board = dailyContracts(1, 20260730);
  const ticked = contractsScreen({ contracts: board, tier: 1, cleared: [board[1].id] });
  const untouched = contractsScreen({ contracts: board, tier: 1, cleared: [] });
  check("a cleared contract is ticked on the board", ticked.includes("contract-card--done"));
  check("its slot number is replaced by the tick", ticked.includes(">✓<"));
  check("an unplayed board shows no ticks", !untouched.includes("contract-card--done"));
  check(
    "only the cleared slot is ticked",
    (ticked.match(/contract-card--done/g) ?? []).length === 1,
  );
  // Ids embed the daily seed, so the caller can hand over EVERY clear it has
  // ever recorded and yesterday's can't tick today's board. That is what lets
  // the tick be persistent without anyone having to prune the list at midnight.
  const yesterday = dailyContracts(1, 20260729).map((c) => c.id);
  check(
    "yesterday's clears don't tick today's board",
    !contractsScreen({ contracts: board, tier: 1, cleared: yesterday })
      .includes("contract-card--done"),
  );
}

// ---------------------------------------------------------------------------
section("Refit cadence + run economy (run.ts)");
// ---------------------------------------------------------------------------
{
  const stops: number[] = [];
  for (let i = 0; i < RUN_LEVELS; i++) if (isRefitBay(i)) stops.push(i + 1);
  check("refit stops land after bays 3/6/9", stops.join(",") === "3,6,9", stops.join(","));
  check("no refit after the final bay", !isRefitBay(RUN_LEVELS - 1));
  check("REFIT_EVERY matches the cadence", REFIT_EVERY === 3);

  let run = newRun(1234, ["demo"], 0);
  check("a fresh run has a stock ship", Object.values(run.tiers).every((t) => t === 0));
  check("a fresh run has no scrap without the cache unlock", run.scrap === 0);
  check("scrap-cache seeds starting scrap", newRun(1, [], 30).scrap === 30);

  // Bank a bay: overshoot carries as funds, scrap accumulates separately.
  run = advanceRun(run, 950, 800, 8, 26, "premium");
  check("overshoot carries as funds", run.carry === 150, String(run.carry));
  check("scrap accumulates", run.scrap === 26 && run.scrapEarned === 26);
  check("the drafted pick is recorded", run.modIds.join(",") === "premium");
  check("levelIndex advanced", run.levelIndex === 1);

  // Ending at/under target carries no debt.
  check("no debt carries", advanceRun(run, 500, 800, 0, 0, null).carry === 0);

  // Buying an upgrade deducts scrap and never mutates the input. The track
  // under test is seeded at tier 1 and priced at the tier-2 rung, because a
  // refit can only raise a system the Workshop already installed.
  const refit = { ...run, scrap: 60, tiers: { ...run.tiers, launcher: 1 } };
  const before = { ...refit.tiers };
  const bought = buyUpgrade(refit, "launcher", TIER_COSTS[1], MAX_TIER);
  check("buyUpgrade returns a new state", bought !== null && bought !== refit);
  check("buyUpgrade deducts scrap", bought!.scrap === 60 - TIER_COSTS[1]);
  check("buyUpgrade raises the tier", bought!.tiers.launcher === 2);
  check("buyUpgrade does not mutate the input",
    JSON.stringify(refit.tiers) === JSON.stringify(before) && refit.scrap === 60);
  // Installed, so this can only be refused for poverty — the reason under test.
  check(
    "buyUpgrade refuses when broke",
    buyUpgrade(newRun(1, [], 0, { ...newTiers(), bay: 1 }), "bay", TIER_COSTS[1], MAX_TIER) === null,
  );
  check(
    "buyUpgrade refuses a maxed track",
    buyUpgrade({ ...newRun(1), scrap: 999, tiers: { ...newTiers(), bay: MAX_TIER } }, "bay", 20, MAX_TIER) === null,
  );

  // Refit TIERS an installed system; it does not install one. In-run scrap is
  // uncapped, so a scrap install would route around the Mark's build budget —
  // the cap that makes two rigs at one Mark equal in power. Both runs are given
  // the whole ladder's price so poverty can never be the reason for a refusal,
  // and both prices are read off nextTierCost so a re-price can't turn either
  // check into a tautology.
  const flush = TIER_COSTS.reduce((a, b) => a + b, 0);
  const stockRun = newRun(1, [], flush);
  check("refit cannot install an uninstalled system",
    buyUpgrade(stockRun, "demolition", nextTierCost(0)!, MAX_TIER) === null);
  const installedRun = newRun(1, [], flush, { ...newTiers(), demolition: 1 });
  check("refit can tier a system that IS installed",
    buyUpgrade(installedRun, "demolition", nextTierCost(1)!, MAX_TIER)?.tiers.demolition === 2);

  // Upgrades apply BEFORE mods, so a mod's multiplier compounds over the ship.
  const withShip = levelForRun({
    ...newRun(7),
    levelIndex: 0,
    tiers: { ...newTiers(), magazine: 1 },
    modIds: ["rapid"],
  });
  const stockCooldown = makeBaseLevel(0).cooldownMs;
  const expected = Math.round(Math.max(120, Math.round(stockCooldown * 0.85)) * 0.65);
  check("mods compound on top of upgrades", withShip.cooldownMs === expected, `${withShip.cooldownMs} vs ${expected}`);
}

// ---------------------------------------------------------------------------
section("Draft gating (mods.ts + meta.ts)");
// ---------------------------------------------------------------------------
{
  const locked = new Set<string>();
  for (let i = 0; i < RUN_LEVELS; i++) {
    for (const m of draftOffers(99, i, [], 3, [])) locked.add(m.id);
  }
  const gated = MODS.filter((m) => m.unlock).map((m) => m.id);
  check(
    "unlock-gated mods never appear without their unlock",
    gated.every((id) => !locked.has(id)),
    gated.filter((id) => locked.has(id)).join(","),
  );

  // With every unlock, the gated mods become reachable. Two owned-sets are
  // needed to cover the whole pool: Autoloader only appears once Micro is
  // owned, but Micro itself is non-stackable so it's excluded from that same
  // pass — no single draft state can offer both.
  const allUnlocks = UNLOCKS.map((u) => u.id);
  const reachable = new Set<string>();
  for (const owned of [[] as string[], ["micro"]]) {
    for (let seed = 0; seed < 60; seed++) {
      for (let i = 0; i < RUN_LEVELS; i++) {
        for (const m of draftOffers(seed, i, owned, 3, allUnlocks)) reachable.add(m.id);
      }
    }
  }
  check("every mod is reachable once unlocked", MODS.every((m) => reachable.has(m.id)),
    MODS.filter((m) => !reachable.has(m.id)).map((m) => m.id).join(","));

  // ...but the Autoloader still needs its synergy prerequisite owned.
  const noMicro = new Set<string>();
  for (let seed = 0; seed < 60; seed++) {
    for (let i = 0; i < RUN_LEVELS; i++) {
      for (const m of draftOffers(seed, i, [], 3, allUnlocks)) noMicro.add(m.id);
    }
  }
  check("Autoloader requires Micro Shipments in the run", !noMicro.has("autoloader"));

  check("drafts are deterministic per seed", JSON.stringify(draftOffers(5, 2, ["premium"], 3, ["demo"]).map((m) => m.id)) ===
    JSON.stringify(draftOffers(5, 2, ["premium"], 3, ["demo"]).map((m) => m.id)));

  check("no unlock is priced at zero", UNLOCKS.every((u) => u.cost > 0));
  check(
    "unlock prerequisites all resolve to real unlocks",
    UNLOCKS.every((u) => (u.requires ?? []).every((r) => UNLOCKS.some((o) => o.id === r))),
  );
  const auto = UNLOCKS.find((u) => u.id === "auto")!;
  check("gated unlocks are unavailable until their prereq is owned", !unlockAvailable(auto, []));
  check("gated unlocks unlock with their prereq", unlockAvailable(auto, ["demo", "micro"]));

  // --- Modifiers as the tree ----------------------------------------------
  // Every mod's `unlock` must name a real UNLOCK, or it is unreachable forever:
  // draftOffers filters on an id nothing can ever buy.
  check(
    "every mod's unlock id resolves to a real unlock",
    MODS.every((m) => !m.unlock || UNLOCKS.some((u) => u.id === m.unlock)),
    MODS.filter((m) => m.unlock && !UNLOCKS.some((u) => u.id === m.unlock)).map((m) => m.id).join(","),
  );
  // The free four are what a player who has bought NOTHING gets offered. If this
  // ever empties, run one has no draft at all — the on-ramp the whole gating
  // scheme is supposed to protect.
  const FREE = ["overtime", "premium", "heavy", "rapid"];
  check(
    "exactly the four plain tradeoffs stay free",
    JSON.stringify(MODS.filter((m) => !m.unlock).map((m) => m.id).sort()) ===
      JSON.stringify([...FREE].sort()),
    MODS.filter((m) => !m.unlock).map((m) => m.id).join(","),
  );
  check("a player who owns nothing is still offered a draft", FREE.every((id) => locked.has(id)));

  // --- Draft width -----------------------------------------------------------
  // Three slots against four free mods meant a new player was shown three of
  // the four every draft: the same list, reshuffled, with no real pick. Two of
  // four is six possible pairs, and the third card becomes something to earn.
  check("a new player drafts from two", draftSlots([]) === DRAFT_BASE_SLOTS, String(draftSlots([])));
  check(
    "the third slot needs the full count",
    draftSlots(new Array(DRAFT_THIRD_SLOT_CONTRACTS - 1).fill("c")) === DRAFT_BASE_SLOTS,
  );
  check(
    "clearing enough Contracts earns the third slot",
    draftSlots(new Array(DRAFT_THIRD_SLOT_CONTRACTS).fill("c")) === DRAFT_FULL_SLOTS,
  );
  check(
    "more Contracts never widen it further",
    draftSlots(new Array(DRAFT_THIRD_SLOT_CONTRACTS * 4).fill("c")) === DRAFT_FULL_SLOTS,
  );
  // The point of narrowing to two: the free pool must still out-number the
  // slots, or run one is a fixed list again.
  check(
    "the free pool out-numbers the starting slots",
    MODS.filter((m) => !m.unlock).length > DRAFT_BASE_SLOTS,
    `${MODS.filter((m) => !m.unlock).length} free vs ${DRAFT_BASE_SLOTS} slots`,
  );
  check(
    "a two-slot draft returns two distinct mods",
    (() => {
      const o = draftOffers(1234, 0, [], DRAFT_BASE_SLOTS, []);
      return o.length === DRAFT_BASE_SLOTS && new Set(o.map((m) => m.id)).size === DRAFT_BASE_SLOTS;
    })(),
  );

  // --- Mark gating: the monetization invariant -----------------------------
  // Salvage is grindable (Unlimited sells uncapped dailies); a Mark is not. So
  // the tree must NOT be completable by money alone, at any Mark below the top.
  const markGated = UNLOCKS.filter((u) => u.requiresMark !== undefined);
  check(`the tree's tail is Mark-gated (${markGated.length} unlocks)`, markGated.length > 0);
  check(
    "no amount of salvage buys a Mark-gated unlock below its Mark",
    markGated.every((u) => !unlockAvailable(u, UNLOCKS.map((o) => o.id), u.requiresMark! - 1)),
  );
  check(
    "a Mark-gated unlock opens at its Mark",
    markGated.every((u) => unlockAvailable(u, UNLOCKS.map((o) => o.id), u.requiresMark!)),
  );
  check(
    "every Mark gate is inside the ladder",
    markGated.every((u) => u.requiresMark! >= 1 && u.requiresMark! <= MARK_COUNT),
  );

  // --- Shape of the ladder --------------------------------------------------
  const total = UNLOCKS.reduce((a, u) => a + u.cost, 0);
  check(`the tree costs ${total} salvage`, total === 1400, String(total));
  // Rank is what the Workshop groups by, and it promises rising price. A rank-2
  // unlock cheaper than a rank-1 would sort into a band it undercuts.
  const maxOf = (r: number) => Math.max(...UNLOCKS.filter((u) => u.rank === r).map((u) => u.cost));
  const minOf = (r: number) => Math.min(...UNLOCKS.filter((u) => u.rank === r).map((u) => u.cost));
  check("rank 2 is dearer than rank 1", minOf(2) > maxOf(1));
  check("rank 3 is dearer than rank 2", minOf(3) > maxOf(2));
  check("only rank 3 carries a Mark gate", markGated.every((u) => u.rank === 3));
  // Rank 1 is the on-ramp, so a first option has to stay within a couple of
  // runs however much the tail inflates. Two rather than one is not a rounding
  // of ambition: a decent run (5 bays, 31 lines) pays 43 against a 45 floor, so
  // the cheapest unlock has ALWAYS been a hair over one run. Left at its real
  // value rather than repriced to flatter the check.
  const decentRun = salvageForRun(5, 31, false);
  check(
    `the cheapest unlock is ~${(minOf(1) / decentRun).toFixed(1)} runs (${minOf(1)} vs ${decentRun})`,
    minOf(1) <= decentRun * 2,
  );
}

// ---------------------------------------------------------------------------
section("Salvage always pays (meta.ts)");
// ---------------------------------------------------------------------------
{
  // The point of the meta layer: a run that dies immediately still ships
  // something back to the yard.
  check("a bay-1 flameout still pays salvage", salvageForRun(0, 0, false) > 0, String(salvageForRun(0, 0, false)));
  check("deeper runs pay more", salvageForRun(5, 40, false) > salvageForRun(2, 16, false));
  check("a full run pays a bonus", salvageForRun(10, 80, true) > salvageForRun(10, 80, false));
}

// ---------------------------------------------------------------------------
section("Demolition charges + settle window (game.ts)");
// ---------------------------------------------------------------------------
{
  const DT = 1000 / 60;
  const cfg = applyMods(makeBaseLevel(0), ["demo"]);
  const g = new Game(cfg, {}, 42);
  check("demo mod grants charges", g.bombCharges === 2, String(g.bombCharges));

  // Arming is free and reversible.
  g.armBomb();
  check("arming sets bombArmed", g.bombArmed);
  check("arming does not consume a charge", g.bombCharges === 2);
  check("the muzzle promises a bomb while armed", g.nextIsBomb);
  g.armBomb();
  check("arming again disarms", !g.bombArmed && g.bombCharges === 2);

  // Firing an armed charge costs no funds — the economic fix.
  g.armBomb();
  const fundsBefore = g.score;
  let now = 5000;
  check("the armed charge fires", g.shoot(now));
  check("firing a charge costs no funds", g.score === fundsBefore, `${g.score} vs ${fundsBefore}`);
  check("firing consumes a charge", g.bombCharges === 1, String(g.bombCharges));
  check("firing disarms", !g.bombArmed);

  // A normal launch still costs launchCost.
  now += cfg.cooldownMs + 10;
  const beforeShot = g.score;
  g.shoot(now);
  check("a normal launch costs launchCost", g.score === beforeShot - cfg.launchCost);

  // With no charges left, arming is refused.
  const g2 = new Game(makeBaseLevel(0), {}, 1);
  check("arming with no charges is refused", !g2.armBomb() && !g2.bombArmed);

  // Settle window: crossing the target must NOT win instantly.
  let settleStarts = 0;
  let statuses: string[] = [];
  const g3 = new Game(makeBaseLevel(0), {
    onSettleStart: () => { settleStarts += 1; },
    onStatus: (st) => { statuses.push(st); },
  }, 3);
  g3.score = g3.target + 10;
  let t = 0;
  g3.update((t += DT));
  check("crossing the target opens the settle window", g3.settling && settleStarts === 1);
  check("crossing the target does not win instantly", g3.status === "playing" && statuses.length === 0);
  check("launches are refused while settling", !g3.shoot(t + 10_000));
  check("bond breakers are refused while settling", !g3.useBondBreaker(t));
  // ...and it must resolve within the backstop (4s) even on a busy field.
  let steps = 0;
  while (g3.status === "playing" && steps < 600) {
    g3.update((t += DT));
    steps += 1;
  }
  check("the settle window resolves into a win", g3.status === "won", `${g3.status} after ${steps} steps`);
  check("the win fires exactly one status event", statuses.join(",") === "won", statuses.join(","));
  check("a bayclear FX is spawned", g3.effects.some((e) => e.kind === "bayclear"));
  check("settling ends with the win", !g3.settling);

  // Wind assist must reduce the force the player actually feels.
  const windy = makeBaseLevel(9);
  const bare = new Game({ ...windy, windAssist: 0 }, {}, 11);
  const stab = new Game({ ...windy, windAssist: 0.6 }, {}, 11);
  check(
    "the stabilizer reduces effective wind",
    Math.abs(stab.windNow) < Math.abs(bare.windNow) || bare.windNow === 0,
    `${stab.windNow} vs ${bare.windNow}`,
  );
  check("windAverage exposes the raw prevailing wind", Math.abs(stab.windAverage) <= windy.windMax);

  // Autoloader is a HELD trigger, not a timer. The old version fired on its own
  // every 420ms and could not see the compactor: on device one Autoloader bay
  // threw 34 lost pieces from 32 shots (106% vs an 11% baseline) at 16 shots
  // per line, its launches spread evenly across the cycle (z=0.71) while the
  // same player's manual shots clustered in the open window (z=4.27).
  const autoCfg = applyMods(makeBaseLevel(0), ["micro", "autoloader"]);
  let autoShots = 0;
  const g4 = new Game(autoCfg, { onShoot: () => { autoShots += 1; } }, 5);
  let at = 0;
  for (let i = 0; i < 600; i++) g4.update((at += DT));
  check("an untriggered autoloader fires NOTHING", autoShots === 0, `${autoShots} shots in 10s`);
  check("an untriggered autoloader spends nothing", g4.score === autoCfg.startingFunds);

  // Held: fires, at roughly the configured cadence.
  const heldShots: number[] = [];
  const g5 = new Game(autoCfg, { onShoot: (i) => heldShots.push(i.t) }, 5);
  g5.setAutoHeld(true);
  let ht = 0;
  for (let i = 0; i < 600; i++) g5.update((ht += DT));
  check("a held autoloader fires", heldShots.length > 3, `${heldShots.length} shots in 10s`);
  check(
    "the first shot leaves immediately on press",
    heldShots.length > 0 && heldShots[0] < autoCfg.autoLaunchMs,
    `first at ${heldShots[0]?.toFixed(0)}ms vs ${autoCfg.autoLaunchMs}ms cadence`,
  );
  const gaps = heldShots.slice(1).map((t, i) => t - heldShots[i]);
  check(
    "held fire keeps the configured cadence",
    gaps.every((g) => g >= autoCfg.autoLaunchMs - DT && g <= autoCfg.autoLaunchMs + 4 * DT),
    `gaps ${gaps.map((g) => g.toFixed(0)).join(",")} vs ${autoCfg.autoLaunchMs}`,
  );

  // Releasing stops it within one cadence.
  const before = heldShots.length;
  g5.setAutoHeld(false);
  for (let i = 0; i < 600; i++) g5.update((ht += DT));
  check("releasing stops the burst", heldShots.length === before, `${heldShots.length - before} extra`);

  // Aiming must NOT suppress it — holding the trigger while dragging is the
  // whole mechanic, and the old timer bailed out on `aiming`.
  let aimShots = 0;
  const g6 = new Game(autoCfg, { onShoot: () => { aimShots += 1; } }, 5);
  g6.aiming = true;
  g6.setAutoHeld(true);
  let mt = 0;
  for (let i = 0; i < 300; i++) g6.update((mt += DT));
  check("the trigger works while aiming", aimShots > 1, `${aimShots} shots while aiming`);

  // Shots carry the auto flag so telemetry can separate rig from player.
  const tagged: boolean[] = [];
  const g7 = new Game(autoCfg, { onShoot: (i) => tagged.push(i.auto) }, 5);
  let tt = 0;
  g7.shoot((tt += DT));                       // manual
  g7.setAutoHeld(true);
  for (let i = 0; i < 200; i++) g7.update((tt += DT));
  check("a manual shot is not tagged auto", tagged[0] === false, String(tagged[0]));
  check("trigger shots are tagged auto", tagged.slice(1).every((x) => x === true) && tagged.length > 1,
    tagged.join(","));

  // The funds floor still holds — a held trigger must not overdraw.
  const g8 = new Game({ ...autoCfg, startingFunds: autoCfg.launchCost * 2 }, {}, 5);
  g8.setAutoHeld(true);
  let ft = 0;
  for (let i = 0; i < 900; i++) g8.update((ft += DT));
  check("a held trigger stops at the funds floor", g8.score < autoCfg.launchCost, String(g8.score));

  // The player's aim ANCHORS the burst, and survives it.
  //
  // This is the regression that made the mod read as useless on device. The
  // jittered angle used to be written back into the cannon, so each shot's
  // spread compounded on the last and the burst random-walked away from
  // wherever the player was pointing — at the far end pinning against the
  // +/-60deg cone limit and firing the same wasted shot over and over. The
  // power axis was worse: re-rolled across the whole upper 55% of the band
  // every shot, so the drag's power did literally nothing. Measured across 5
  // autoloader bays: 6.72 shots per line against 2.94 in hand-fired bays, and
  // 23.4% of shipments lost to the wrong side against a 10.3% baseline.
  const AIM_ANGLE = 0.35;
  // Funds ARE the score, so a bankroll big enough to sustain a long burst also
  // wins the bay on the first shot — the target has to move with it.
  const rich = { ...autoCfg, startingFunds: 100_000, targetScore: 10_000_000 };
  function burst(angle: number, powerFrac: number) {
    const shots: { angle: number; power: number }[] = [];
    const game = new Game(rich, { onShoot: (i) => shots.push({ angle: i.angle, power: i.power }) }, 5);
    game.cannon.angle = angle;
    const band = game.cannon.speedMax - game.cannon.speedMin;
    game.cannon.power = game.cannon.speedMin + band * powerFrac;
    game.setAutoHeld(true);
    let t = 0;
    for (let i = 0; i < 900; i++) game.update((t += DT));
    return { game, shots, band, aimPower: game.cannon.speedMin + band * powerFrac };
  }

  const b1 = burst(AIM_ANGLE, 0.7);
  check("a held burst leaves the player's aim untouched",
    b1.game.cannon.angle === AIM_ANGLE && b1.game.cannon.power === b1.aimPower,
    `${b1.game.cannon.angle.toFixed(4)}/${b1.game.cannon.power.toFixed(2)} vs ${AIM_ANGLE}/${b1.aimPower.toFixed(2)}`);
  check("every burst shot stays inside the aim spread",
    b1.shots.length > 5 && b1.shots.every((s) => Math.abs(s.angle - AIM_ANGLE) <= AUTO_SPREAD_RAD + 1e-9),
    `${b1.shots.length} shots, worst ${Math.max(...b1.shots.map((s) => Math.abs(s.angle - AIM_ANGLE))).toFixed(4)} vs ${AUTO_SPREAD_RAD}`);
  // The walk's signature: late shots further off-aim than early ones. Compare
  // the second half of the burst against the first — a walk diverges, a spread
  // does not.
  const half = Math.floor(b1.shots.length / 2);
  const off = (s: { angle: number }) => Math.abs(s.angle - AIM_ANGLE);
  const early = b1.shots.slice(0, half).reduce((a, s) => a + off(s), 0) / half;
  const late = b1.shots.slice(half).reduce((a, s) => a + off(s), 0) / (b1.shots.length - half);
  check("the burst does not drift off aim over time", late <= early * 2 + 1e-9,
    `early ${early.toFixed(4)} vs late ${late.toFixed(4)} rad off aim`);
  check("the burst still genuinely scatters",
    new Set(b1.shots.map((s) => s.angle.toFixed(6))).size > 3,
    `${new Set(b1.shots.map((s) => s.angle.toFixed(6))).size} distinct angles`);

  // Power now tracks the drag instead of ignoring it.
  check("every burst shot stays inside the power jitter",
    b1.shots.every((s) => Math.abs(s.power - b1.aimPower) <= AUTO_POWER_JITTER * b1.band + 1e-9),
    `worst ${Math.max(...b1.shots.map((s) => Math.abs(s.power - b1.aimPower))).toFixed(3)} vs ${(AUTO_POWER_JITTER * b1.band).toFixed(3)}`);
  const b2 = burst(AIM_ANGLE, 0.4);
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  check("a softer drag throws a softer burst",
    mean(b2.shots.map((s) => s.power)) < mean(b1.shots.map((s) => s.power)),
    `${mean(b2.shots.map((s) => s.power)).toFixed(2)} vs ${mean(b1.shots.map((s) => s.power)).toFixed(2)}`);

  for (const game of [g, g2, g3, bare, stab, g4, g5, g6, g7, g8, b1.game, b2.game]) game.destroy();
}

// ---------------------------------------------------------------------------
section("Compactor phase telemetry (compactor.ts, game.ts)");
// ---------------------------------------------------------------------------
// `wait` alone cannot tell aiming apart from waiting out a stroke, because the
// compactor's round trip and the median gap between shots are both ~4.5s.
// ShotInfo therefore carries the bar's phase at the launch. These pin the two
// properties the analysis depends on: the phase is a truthful 0..1 reading of
// the live bar, and capturing it perturbs nothing (Contracts are BUDGETED in
// Compactor.strokes, so an observer that miscounts strokes breaks the mode).
{
  const DT = 1000 / 60;
  const cfg = makeBaseLevel(0);
  const gp = new Game(cfg, {}, 3);
  const c = gp.compactor;

  check("phase reads 0 at the open stop", Math.abs(c.phase - 0) < 1e-9, `${c.phase}`);

  // Bay width must not set the pace. openCells used to drive both the room to
  // land in AND the cycle length, so Bay Extension T3 took the round trip from
  // 4.4s to 11.1s while its card advertised only "more room" — and the phase
  // telemetry shows a player fires about once per stroke, so a longer window
  // buys no shots, it only spaces them out.
  const cycleAt = (open: number, minLine: number): number => {
    const lv = { ...makeBaseLevel(0), compactorOpenCells: open, compactorMinLineCells: minLine };
    const gg = new Game(lv, {}, 3);
    const steps = gg.compactor.cycleSteps;
    gg.destroy();
    return steps;
  };
  const stockCycle = cycleAt(12, 8);
  for (const [open, minLine] of [[14, 8], [16, 8], [18, 8], [18, 6], [12, 6]] as const) {
    check(
      `cycle holds at ${open} open / ${minLine} min-line`,
      Math.abs(cycleAt(open, minLine) - stockCycle) < 1e-6,
      `${(cycleAt(open, minLine) * (1000 / 60) / 1000).toFixed(2)}s vs ${(stockCycle * (1000 / 60) / 1000).toFixed(2)}s`,
    );
  }
  // ...but Hydraulics still genuinely speeds the press up, which is what its
  // "+8% stroke speed" tier copy promises.
  const hydLevel = makeBaseLevel(0);
  applyUpgrades(hydLevel, { ...newTiers(), hydraulics: MAX_TIER });
  const hyd = new Game(hydLevel, {}, 3);
  check(
    "hydraulics still shortens the cycle",
    hyd.compactor.cycleSteps < stockCycle * 0.95,
    `${hyd.compactor.cycleSteps.toFixed(0)} vs ${stockCycle.toFixed(0)} steps`,
  );
  hyd.destroy();

  // Drive one full round trip and watch the phase, direction and stroke count.
  let t = 0;
  let sawFullAdvance = false;
  let minPhase = Infinity, maxPhase = -Infinity;
  let outOfRange = 0;
  const strokesAtStart = c.strokes;
  const cycle = Math.ceil(c.cycleSteps);
  for (let i = 0; i < cycle + 2; i++) {
    gp.update((t += DT));
    minPhase = Math.min(minPhase, c.phase);
    maxPhase = Math.max(maxPhase, c.phase);
    if (c.phase < -1e-9 || c.phase > 1 + 1e-9) outOfRange++;
    if (c.phase >= 1 - 1e-9) sawFullAdvance = true;
  }
  check("phase stays inside 0..1 across a full cycle", outOfRange === 0, `${outOfRange} readings outside`);
  check("phase reaches full advance", sawFullAdvance, `max ${maxPhase.toFixed(3)}`);
  check("phase returns toward the open stop", minPhase < 0.05, `min ${minPhase.toFixed(3)}`);
  check(
    "one cycle completes exactly one press stroke",
    c.strokes - strokesAtStart === 1,
    `${c.strokes - strokesAtStart} strokes in ${cycle} steps`,
  );

  // A shot must carry the LIVE bar reading, not a constant. Fire across the
  // cycle and require the recorded phases to actually differ.
  const seen: { phase: number; dir: number; stroke: number; live: number }[] = [];
  const gs = new Game(makeBaseLevel(0), {
    onShoot: (info) => seen.push({
      phase: info.cphase, dir: info.cdir, stroke: info.cstroke, live: gs.compactor.phase,
    }),
  }, 7);
  let ts = 0;
  const period = Math.ceil(gs.compactor.cycleSteps);
  // Spread the launches over two cycles so both directions are sampled. The
  // cannon has its own cooldown, so this fires when it can rather than every
  // step; that is fine, the assertion is about variety, not count.
  for (let i = 0; i < period * 2; i++) {
    gs.update((ts += DT));
    if (i % 11 === 0) gs.shoot(ts);
  }
  check("shots were recorded with phase", seen.length >= 4, `${seen.length} shots`);
  check(
    "each shot's phase matches the live compactor",
    seen.every((s) => Math.abs(s.phase - s.live) < 1e-9),
    `${seen.filter((s) => Math.abs(s.phase - s.live) >= 1e-9).length} mismatched`,
  );
  check(
    "recorded phase varies across the cycle (not a constant)",
    new Set(seen.map((s) => s.phase.toFixed(3))).size > 2,
    `${new Set(seen.map((s) => s.phase.toFixed(3))).size} distinct phases`,
  );
  check("both stroke directions are sampled", new Set(seen.map((s) => s.dir)).size === 2,
    `dirs ${[...new Set(seen.map((s) => s.dir))].join(",")}`);
  check("stroke index is non-decreasing across shots",
    seen.every((s, i) => i === 0 || s.stroke >= seen[i - 1].stroke));

  // The observer must not move the counter Contracts spend.
  const quiet = new Game(makeBaseLevel(0), {}, 7);
  const loud = new Game(makeBaseLevel(0), { onShoot: () => { /* reads phase */ } }, 7);
  let tq = 0;
  for (let i = 0; i < period * 2; i++) { quiet.update((tq += DT)); loud.update(tq); }
  check("reading phase does not perturb the stroke count",
    quiet.compactor.strokes === loud.compactor.strokes,
    `${quiet.compactor.strokes} vs ${loud.compactor.strokes}`);

  for (const game of [gp, gs, quiet, loud]) game.destroy();
}

// ---------------------------------------------------------------------------
section("Layout solver (layout.ts)");
// ---------------------------------------------------------------------------
{
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });
  const cases: [string, number, number][] = [
    ["21:9 phone", 2400, 1080],
    ["19.5:9 phone", 2556, 1179],
    ["18:9 phone", 2160, 1080],
    ["16:9 laptop", 1600, 900],
    ["16:10 laptop", 1600, 1000],
    ["3:2 tablet", 1500, 1000],
    ["4:3 tablet", 1024, 768],
    ["short phone", 960, 400],
  ];
  for (const [name, w, h] of cases) {
    const l = computeLayout(w, h);
    const gutterR = w - l.ox - l.fw;
    const gutterB = h - l.oy - l.fh;
    // The whole point of the solver: wherever the rail ends up, it must have
    // real room OUTSIDE the drawn field — never drawn over the play area.
    const room = l.mode === "tall" ? gutterB : gutterR;
    check(
      `${name} (${l.mode}) leaves room for the rail`,
      room >= RAIL_MIN,
      `${room.toFixed(1)}px < ${RAIL_MIN}px`,
    );
    check(`${name} keeps the field on screen`, l.ox >= -0.5 && l.oy >= -0.5 && l.ox + l.fw <= w + 0.5 && l.oy + l.fh <= h + 0.5);
    check(`${name} keeps a sane scale`, l.scale > 0.2 && l.scale < 4, String(l.scale));
    // A cube must stay finger-sized; below this the game is unplayable rather
    // than merely cramped.
    check(`${name} keeps cubes visible`, CELL * l.scale >= 12, `${(CELL * l.scale).toFixed(1)}px cubes`);
  }

  // Safe areas must actually push the field off the notch.
  const plain = computeLayout(2400, 1080);
  setSafeAreaInsets({ left: 60, right: 0, top: 0, bottom: 20 });
  const notched = computeLayout(2400, 1080);
  check("a left notch shifts the field right", notched.ox > plain.ox, `${notched.ox} vs ${plain.ox}`);
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });
}

// ---------------------------------------------------------------------------
section("HUD readout widths (the $1000+ wrap regression)");
// ---------------------------------------------------------------------------
{
  // A 4-digit bankroll against a 4-digit target ("$1259 / 1700") used to wrap
  // the funds readout onto a second line at phone CSS viewports, which pushed
  // the plant panel's content down and clipped the build-chip row in half.
  //
  // The DOM fix is in app.css (nowrap on .pl-funds .v, a bottom-anchored
  // auto-height panel, and smaller pixel-font stat labels). What CAN be checked
  // headlessly — and is the part that actually made it fragile — is the WIDTH
  // BUDGET: the funds line has to fit its column with real slack at the smallest
  // scale the game runs at, using conservative per-character advances rather
  // than the sandbox's fallback font metrics (the real Press Start 2P is far
  // wider than any fallback, which is exactly why this reproduced on a device
  // and not in a headless browser).
  //
  // Advances are expressed in em and deliberately generous:
  //   mono  0.60em — JetBrains Mono's actual advance
  //   pixel 1.45em — Press Start 2P measured on-device INCLUDING letter-spacing
  const MONO_ADV = 0.6;
  const PIXEL_ADV = 1.45;

  // The CSS geometry this mirrors. Kept as named constants so a change in
  // app.css that isn't reflected here shows up as a failing budget rather than
  // a silently stale test.
  const PANEL_W_FRAC = 0.4708;
  const PANEL_PAD_FPX = 19;
  const READ_GAP_MIN = 4, READ_GAP_FPX = 12;
  const STAT_PAD_MIN = 6, STAT_PAD_FPX = 14;
  const STAT_MARGIN_MIN = 5, STAT_MARGIN_FPX = 10;
  const FUNDS_FS_MIN = 17, FUNDS_FS_FPX = 38;
  const TGT_EM = 0.62;
  const STAT_LBL_MIN = 6, STAT_LBL_FPX = 8.6;
  const STAT_VAL_MIN = 15, STAT_VAL_FPX = 30;

  /** Width the funds line needs vs. the width its column actually gets. */
  function fundsBudget(viewportW: number, viewportH: number, funds: number, target: number) {
    const l = computeLayout(viewportW, viewportH);
    const fpx = l.fw / 1280;
    const mx = (min: number, scaled: number) => Math.max(min, scaled * fpx);

    const content = PANEL_W_FRAC * l.fw - 2 * PANEL_PAD_FPX * fpx;
    const fundsFs = mx(FUNDS_FS_MIN, FUNDS_FS_FPX);
    const statLbl = mx(STAT_LBL_MIN, STAT_LBL_FPX);
    const statVal = mx(STAT_VAL_MIN, STAT_VAL_FPX);
    const statPad = mx(STAT_PAD_MIN, STAT_PAD_FPX);

    // Each stat column is as wide as the WIDER of its pixel-font label and its
    // mono value — the label is what dominates at small scales, and missing that
    // is what made the original budget wrong.
    const col = (label: string, value: string) =>
      Math.max(label.length * PIXEL_ADV * statLbl, value.length * MONO_ADV * statVal) + statPad;
    const launchesCol = col("LAUNCHES", String(Math.floor(funds / 25)));
    const timeCol = col("TIME", "0:00") + mx(STAT_MARGIN_MIN, STAT_MARGIN_FPX);

    const gaps = 2 * mx(READ_GAP_MIN, READ_GAP_FPX);
    const available = content - launchesCol - timeCol - gaps;

    // "$1259" + a space + "/ 1700" — the target renders at TGT_EM of the figure.
    const scoreStr = "$" + funds;
    const tgtStr = "/ " + target;
    const needed =
      scoreStr.length * MONO_ADV * fundsFs +
      MONO_ADV * fundsFs +
      tgtStr.length * MONO_ADV * fundsFs * TGT_EM;

    return { available, needed, slack: available - needed, mode: l.mode };
  }

  // Every viewport class, at the worst realistic bankroll/target pairing. The
  // 800x360 case is the one that actually broke.
  const VIEWPORTS: [string, number, number][] = [
    ["phone 800x360", 800, 360],
    ["phone 864x393", 864, 393],
    ["phone 915x412", 915, 412],
    ["tablet 1024x768", 1024, 768],
    ["laptop 1600x900", 1600, 900],
    ["ultrawide 2400x1080", 2400, 1080],
  ];
  // bay-10's target is 2150, and a Reactor+carry run can carry 5 figures.
  const CASES: [number, number][] = [[250, 800], [1259, 1700], [9999, 2150], [24680, 2150]];

  for (const [name, w, h] of VIEWPORTS) {
    for (const [funds, target] of CASES) {
      const b = fundsBudget(w, h, funds, target);
      check(
        `${name} fits $${funds}/${target}`,
        b.slack >= 0,
        `needs ${b.needed.toFixed(0)}px, has ${b.available.toFixed(0)}px (short ${(-b.slack).toFixed(0)}px)`,
      );
    }
  }
}

/* ---------------------------------------------------------------------------
 * END-MODAL BOARD SLICE
 *
 * The run end modal shows the top 5 plus the player's own row when they placed
 * outside it, because six rows is a height the layout can guarantee at 360px
 * and ten is not. The slice is pure, so it is checkable without a DOM — which
 * the rest of this file has none of.
 *
 * The rank carried here is the property that matters: it comes from the FULL
 * board, not the sliced array, so a player at #23 renders as #23 and not as #6.
 * ------------------------------------------------------------------------ */
{
  section("End-modal leaderboard slice");

  const entry = (name: string, score: number): ScoreEntry => ({
    name, score, level: 1, lines: 10, created_at: 0,
  });
  const board = ["ACE", "NOVA", "RUST", "ZED", "KAI", "ORB", "FLUX", "VOLT", "HEX", "GIO"]
    .map((n, i) => entry(n, 24680 - i * 1900));

  const outside = endBoard(board, "GIO");
  check(
    "player outside the top 5 gets 6 rows",
    outside.length === END_BOARD_TOP + 1,
    `got ${outside.length}`,
  );
  check(
    "their row is last and carries its TRUE rank",
    outside[outside.length - 1].entry.name === "GIO" && outside[outside.length - 1].rank === 10,
    `got ${outside[outside.length - 1].entry.name} at rank ${outside[outside.length - 1].rank}`,
  );
  check(
    "the jump from #5 to #10 is marked",
    outside[outside.length - 1].gapBefore,
    "a discontiguous row must not read as the next rank down",
  );
  check(
    "no duplicate rows",
    new Set(outside.map((r) => r.rank)).size === outside.length,
    "a rank appears twice",
  );

  const inside = endBoard(board, "ZED"); // rank 4
  check("player inside the top 5 gets exactly 5 rows", inside.length === END_BOARD_TOP,
    `got ${inside.length}`);
  check("…and is not appended a second time",
    inside.filter((r) => r.entry.name === "ZED").length === 1);

  // Adjacent case: rank 6 sits directly under rank 5, so there is no jump to mark.
  const sixth = endBoard(board, "ORB");
  check("rank 6 is shown without a gap marker",
    sixth.length === END_BOARD_TOP + 1 && !sixth[sixth.length - 1].gapBefore);

  check("a short board returns every row", endBoard(board.slice(0, 3), "GIO").length === 3);
  check("an empty board returns nothing", endBoard([], "GIO").length === 0);
  check("no name returns just the top 5", endBoard(board).length === END_BOARD_TOP);
  check("an unknown name returns just the top 5", endBoard(board, "NOBODY").length === END_BOARD_TOP);

  check(
    "the standalone board still ranks every entry in order",
    fullBoard(board).length === board.length &&
      fullBoard(board).every((r, i) => r.rank === i + 1 && !r.gapBefore),
  );
}

section("Materials (theme.ts / level.ts / lineClear.ts)");
{
  // ---- The schedule: what appears, when, and what must stay clean ----------

  // Mark 1 is the baseline every player learns the game on. If a material can
  // reach it, "stock" stops meaning anything and the ladder has no floor.
  const mark1Clean = Array.from({ length: 10 }, (_, i) => materialMixFor(i, 1))
    .every((m) => m.slag === 0 && m.cryo === 0);
  check("Mark 1 is entirely free of materials", mark1Clean);

  check("slag waits for Mark 2", materialMixFor(9, 1).slag === 0 && materialMixFor(9, 2).slag > 0);
  check("cryo waits for Mark 3", materialMixFor(9, 2).cryo === 0 && materialMixFor(9, 3).cryo > 0);
  check(
    "one new material per Mark, in the design's order",
    MATERIAL_SCHEDULE.slag.firstMark < MATERIAL_SCHEDULE.cryo.firstMark,
  );

  // Every run opens clean regardless of Mark, so the player establishes a
  // rhythm before the bay starts arguing with them.
  check(
    "bay 1 is clean at every Mark",
    Array.from({ length: MARK_COUNT }, (_, m) => materialMixFor(0, m + 1))
      .every((mix) => mix.slag === 0 && mix.cryo === 0),
  );

  // The cap is the safety rail: without it the ramp keeps climbing and a deep
  // bay at a high Mark drowns in dead cubes.
  const deepest = materialMixFor(50, MARK_COUNT);
  check("slag stays under its cap", deepest.slag <= MATERIAL_SCHEDULE.slag.cap);
  check("cryo stays under its cap", deepest.cryo <= MATERIAL_SCHEDULE.cryo.cap);
  check(
    "slag is rarer than cryo — it is the one that cannot be recovered",
    MATERIAL_SCHEDULE.slag.cap < MATERIAL_SCHEDULE.cryo.cap,
  );
  check(
    "the mix never exceeds certainty",
    deepest.slag + deepest.cryo < 1,
    `${(deepest.slag + deepest.cryo).toFixed(3)}`,
  );

  // A ramp that isn't monotone would make a later bay easier than an earlier
  // one, which reads as a bug to a player even when it's within the cap.
  const slagRamp = Array.from({ length: 10 }, (_, i) => materialMixFor(i, MARK_COUNT).slag);
  check("the slag ramp never decreases", slagRamp.every((v, i) => i === 0 || v >= slagRamp[i - 1]));

  // ---- fillsSlots: the single definition of "worth a slot" -----------------

  const cube = (material: Material, struck = material !== "cryo"): Cube =>
    ({ material, struck }) as Cube;

  check("standard fills slots", fillsSlots(cube("standard")));
  check("slag NEVER fills a slot", !fillsSlots(cube("slag")));
  check("slag stays dead even if something strikes it", !fillsSlots(cube("slag", true)));
  check("cold cryo does not fill a slot", !fillsSlots(cube("cryo", false)));
  check("struck cryo does", fillsSlots(cube("cryo", true)));

  // ---- The queue promises what it delivers --------------------------------

  const matLevel = makeBaseLevel(9, MARK_COUNT);
  check(
    "a high-Mark deep bay actually carries materials",
    matLevel.materialMix.slag > 0 && matLevel.materialMix.cryo > 0,
  );

  // The preview is the whole basis on which cryo is fair: you must be able to
  // sequence around a shipment you can see coming.
  const c1 = new Cannon(matLevel, 1234);
  const promised: Material[] = [];
  const delivered: Material[] = [];
  for (let i = 0; i < 60; i++) {
    promised.push(c1.nextMaterial);
    c1.markShot(0);
    delivered.push(c1.currentMaterial);
  }
  check(
    "the NEXT preview is exactly what the next shot loads",
    promised.every((m, i) => m === delivered[i]),
  );

  // Same seed, same stream — a shared seed has to mean the same bay.
  const a = new Cannon(matLevel, 99);
  const b = new Cannon(matLevel, 99);
  const streamA: Material[] = [];
  const streamB: Material[] = [];
  for (let i = 0; i < 80; i++) {
    streamA.push(a.currentMaterial);
    streamB.push(b.currentMaterial);
    a.markShot(0);
    b.markShot(0);
  }
  check("the material stream is deterministic for a seed", streamA.join() === streamB.join());
  check("a seeded bay actually rolls some non-standard shipments",
    streamA.some((m) => m !== "standard"), streamA.slice(0, 12).join(","));

  // A zero mix must be byte-identical to the pre-materials game, or every bay
  // below the gates has quietly changed.
  const clean = new Cannon(makeBaseLevel(9, 1), 7);
  const cleanStream: Material[] = [];
  for (let i = 0; i < 100; i++) {
    cleanStream.push(clean.currentMaterial);
    clean.markShot(0);
  }
  check("a zero mix yields only standard shipments", cleanStream.every((m) => m === "standard"));

  // ---- Contracts stay clean, and that is a feasibility guarantee ----------

  let contractMixes = 0;
  let dirtyContracts = 0;
  for (let tier = 1; tier <= 9; tier++) {
    for (const c of dailyContracts(tier, 20260801)) {
      const cfg = levelForContract(c, mulberry32(tier * 31 + 7));
      contractMixes++;
      if (cfg.materialMix.slag !== 0 || cfg.materialMix.cryo !== 0) dirtyContracts++;
    }
  }
  check(
    "every generated Contract is material-free (its budget model assumes every cube can count)",
    dirtyContracts === 0 && contractMixes > 0,
    `${contractMixes} contracts checked`,
  );

  // ---- The rule, through the real line-clear check ------------------------

  // Hand-built rows through the ACTUAL updateLineClear rather than a
  // reimplementation of it — the claim being tested is that slag and cold cryo
  // deny a line in the real code path, and a mock of that path would prove
  // nothing about it.
  const rowLevel = makeBaseLevel(0);
  const buildRow = (materials: Material[]) => {
    const phys = createPhysics(rowLevel);
    const compactor = new Compactor(phys.world, rowLevel);
    while (compactor.x < compactor.rightX) compactor.update(); // drive to full advance
    // update() flips dir to -1 on the tick it ARRIVES at the right stop, so a
    // bar driven here is already retreating. Every press test below wants the
    // advancing stroke — the one that actually touches the pile — so restore it
    // explicitly. (Without this, shatterColdCryo returns early and the
    // "survives the press" cases pass for the wrong reason.)
    compactor.dir = 1;
    const cubes: Cube[] = [];
    const rowY = WORLD.height - CELL / 2; // bottom row
    materials.forEach((material, k) => {
      const body = Matter.Bodies.rectangle(
        WALL_INNER - CELL / 2 - k * CELL, rowY, CELL, CELL, { label: "cube" },
      );
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Composite.add(phys.world, body);
      cubes.push({
        body, type: "O", color: "#fff", blinkStart: null,
        material, struck: material !== "cryo",
      });
    });
    return { phys, compactor, cubes };
  };

  const need = rowLevel.compactorMinLineCells;
  const allStd: Material[] = Array.from({ length: need }, () => "standard" as Material);

  const good = buildRow(allStd);
  check(
    "a full row of standard shipments still clears (the baseline is intact)",
    updateLineClear(good.phys.world, good.cubes, good.compactor, rowLevel, []).lines === 1,
  );

  const withSlag = buildRow(allStd.map((m, i) => (i === 3 ? "slag" : m)));
  check(
    "one slag cube denies the whole row",
    updateLineClear(withSlag.phys.world, withSlag.cubes, withSlag.compactor, rowLevel, []).lines === 0,
  );

  const withCold = buildRow(allStd.map((m, i) => (i === 5 ? "cryo" : m)));
  check(
    "one COLD cryo cube denies the row",
    updateLineClear(withCold.phys.world, withCold.cubes, withCold.compactor, rowLevel, []).lines === 0,
  );

  // ...and the same row clears once it has been struck. This is the pair that
  // makes cryo a sequencing puzzle rather than a second slag.
  const thawed = buildRow(allStd.map((m, i) => (i === 5 ? "cryo" : m)));
  for (const c of thawed.cubes) if (c.material === "cryo") c.struck = true;
  check(
    "striking the cryo cube makes the identical row clear",
    updateLineClear(thawed.phys.world, thawed.cubes, thawed.compactor, rowLevel, []).lines === 1,
  );

  // ---- Striking ------------------------------------------------------------

  const strikeSet = buildRow(["cryo", "standard"]);
  const [cryoCube, other] = strikeSet.cubes;
  Matter.Body.setVelocity(other.body, { x: CRYO_STRIKE_SPEED * 0.4, y: 0 });
  strikeCryo(strikeSet.cubes, cryoCube.body, other.body);
  check("a gentle nudge does not thaw cryo", !cryoCube.struck);

  Matter.Body.setVelocity(other.body, { x: CRYO_STRIKE_SPEED * 2, y: 0 });
  strikeCryo(strikeSet.cubes, cryoCube.body, other.body);
  check("a hard strike thaws it", cryoCube.struck);

  // The asymmetry that makes cryo cost a shipment. Measured, not assumed: with
  // a symmetric rule every cryo cube thawed on the landing impact of the shot
  // that delivered it, and the material did nothing whatsoever.
  const arriving = buildRow(["cryo", "standard"]);
  Matter.Body.setVelocity(arriving.cubes[0].body, { x: -CRYO_STRIKE_SPEED * 4, y: 0 });
  strikeCryo(arriving.cubes, arriving.cubes[0].body, arriving.cubes[1].body);
  check(
    "cryo does NOT thaw on its own arrival — it must be struck at rest",
    !arriving.cubes[0].struck,
  );

  const notMine = buildRow(["cryo", "standard", "standard"]);
  Matter.Body.setVelocity(notMine.cubes[2].body, { x: CRYO_STRIKE_SPEED * 3, y: 0 });
  strikeCryo(notMine.cubes, notMine.cubes[1].body, notMine.cubes[2].body);
  check(
    "a hard hit elsewhere does not thaw an untouched cryo cube",
    !notMine.cubes[0].struck,
  );

  // ---- The cold press shatters ---------------------------------------------

  const press = buildRow(["cryo", "standard", "standard"]);
  // Put the cold cube exactly against the bar's face so the press lands on it.
  const face = press.compactor.x + press.compactor.width / 2;
  Matter.Body.setPosition(press.cubes[0].body, {
    x: face + CELL / 2,
    y: press.cubes[0].body.position.y,
  });
  const before = press.cubes.length;
  const neighbourVy = press.cubes[1].body.velocity.y;
  const shatter = shatterColdCryo(press.phys.world, press.cubes, press.compactor, []);
  check("pressing cold cryo shatters it", shatter.cubes.length === 1 && press.cubes.length === before - 1);
  check("the shattered cube's row is reported", shatter.rows.length === 1);
  check(
    "its row-mates are knocked off their slots",
    press.cubes.some((c) => c.body.velocity.y < neighbourVy),
  );

  // A thawed cryo cube in the same position is just a cube — no shatter.
  const safe = buildRow(["cryo", "standard"]);
  safe.cubes[0].struck = true;
  Matter.Body.setPosition(safe.cubes[0].body, {
    x: safe.compactor.x + safe.compactor.width / 2 + CELL / 2,
    y: safe.cubes[0].body.position.y,
  });
  check(
    "a THAWED cryo cube survives the press",
    shatterColdCryo(safe.phys.world, safe.cubes, safe.compactor, []).cubes.length === 0,
  );

  // The retreat stroke touches nothing, so it must not shatter anything either.
  const retreat = buildRow(["cryo", "standard"]);
  Matter.Body.setPosition(retreat.cubes[0].body, {
    x: retreat.compactor.x + retreat.compactor.width / 2 + CELL / 2,
    y: retreat.cubes[0].body.position.y,
  });
  retreat.compactor.dir = -1;
  check(
    "the retreating bar shatters nothing",
    shatterColdCryo(retreat.phys.world, retreat.cubes, retreat.compactor, []).cubes.length === 0,
  );
}

console.log(
  failures === 0
    ? "\nAll systems checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
