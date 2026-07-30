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
import { Game } from "../src/game/game";
import { makeBaseLevel } from "../src/game/level";
import { applyMods, draftOffers, MODS } from "../src/game/mods";
import {
  applyUpgrades, newTiers, nextTierCost, tiersCost, MAX_TIER, TIER_COSTS, UPGRADES,
  budgetForMark, buyLoadoutTier, FULL_BUILD_COST, loadoutLegal, MARK_COUNT,
} from "../src/game/upgrades";
import {
  contractClaimed, markUnlocked, newMeta, safeLoadout, salvageForContract, salvageForRun,
  UNLOCKS, unlockAvailable,
} from "../src/game/meta";
import {
  advanceRun, buyUpgrade, isRefitBay, levelForRun, newRun, REFIT_EVERY, RUN_LEVELS,
} from "../src/game/run";
import {
  dailyContracts, levelForContract, DAILY_COUNT, CUBES_PER_LINE, PLANNING_EFFICIENCY,
  SPARE_SHIPMENTS,
} from "../src/game/contracts";
import { pieceCells, SIZE_SPEC } from "../src/game/pieces";
import { computeLayout, setSafeAreaInsets, RAIL_MIN } from "../src/game/layout";
import { PIECE_TYPES } from "../src/game/theme";
import { CELL } from "../src/game/engine";

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
  check("a full rig costs 660", FULL_BUILD_COST === 660, String(FULL_BUILD_COST));

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
  let patterns = 0;
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 40; seed++) {
      for (const c of dailyContracts(tier, seed)) {
        if (c.kind !== "pattern") continue;
        patterns += 1;
        const cubes = c.queue.length * SIZE_SPEC[c.pieceSize].cubes;
        if (cubes !== c.goal * CUBES_PER_LINE + SPARE_SHIPMENTS * SIZE_SPEC[c.pieceSize].cubes) {
          everInexact = true;
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
  check("every pattern queue tiles its goal exactly", !everInexact);
  check("pattern Contracts are always calm", !everWindy);
  check("pattern Contracts carry no launch budget", !everBudgeted);
  check("low tiers draw only the flat-settling shapes", !everOffPool);

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

  // Buying an upgrade deducts scrap and never mutates the input.
  const before = { ...run.tiers };
  const bought = buyUpgrade(run, "launcher", TIER_COSTS[0], MAX_TIER);
  check("buyUpgrade returns a new state", bought !== null && bought !== run);
  check("buyUpgrade deducts scrap", bought!.scrap === 26 - TIER_COSTS[0]);
  check("buyUpgrade raises the tier", bought!.tiers.launcher === 1);
  check("buyUpgrade does not mutate the input", JSON.stringify(run.tiers) === JSON.stringify(before) && run.scrap === 26);
  check("buyUpgrade refuses when broke", buyUpgrade(newRun(1), "bay", 20, MAX_TIER) === null);
  check(
    "buyUpgrade refuses a maxed track",
    buyUpgrade({ ...newRun(1), scrap: 999, tiers: { ...newTiers(), bay: MAX_TIER } }, "bay", 20, MAX_TIER) === null,
  );

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
  check("gated unlocks are unavailable until their prereq is owned", !unlockAvailable(UNLOCKS.find((u) => u.id === "auto")!, []));
  check("gated unlocks unlock with their prereq", unlockAvailable(UNLOCKS.find((u) => u.id === "auto")!, ["demo"]));
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

  // Autoloader fires without any bot driving it.
  const autoCfg = applyMods(makeBaseLevel(0), ["micro", "autoloader"]);
  let autoShots = 0;
  const g4 = new Game(autoCfg, { onShoot: () => { autoShots += 1; } }, 5);
  let at = 0;
  for (let i = 0; i < 600; i++) g4.update((at += DT));
  check("the autoloader self-fires", autoShots > 3, `${autoShots} shots in 10s`);
  check("the autoloader spends funds", g4.score < autoCfg.startingFunds);

  for (const game of [g, g2, g3, bare, stab, g4]) game.destroy();
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

console.log(
  failures === 0
    ? "\nAll systems checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
