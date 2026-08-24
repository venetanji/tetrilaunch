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
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Matter from "matter-js";
import { Game, AUTO_SPREAD_RAD, AUTO_POWER_JITTER } from "../src/game/game";
import {
  makeBaseLevel, payoutMult, BASE_BREAK_STRETCH, BOND_MARK_STEP, COMBO_STEP,
  PILE_TIERS, TARGET_PER_BAY, UNBREAKABLE_MARK, WIND_GUST_FRACTION,
  type LevelConfig, type PileTier,
} from "../src/game/level";
import {
  HAZARDS, hazardById, hazardOffers, hazardsForMark, isMaterialDraft, MATERIAL_DRAFT_BAYS,
  picksPerBay, applyRatchets, togglePick,
  materialRate, totalNotches, MATERIAL_CAP, TARGET_NOTCH, COST_NOTCH, TIME_NOTCH,
  CAPSTONE_MARK, TIME_LADDER, COST_LADDER, notchTotal,
  type HazardId, type Ratchets,
} from "../src/game/hazards";
import { previewRows, type PreviewRow } from "../src/game/preview";
import { applyMods, draftOffers, MODS, mulberry32 } from "../src/game/mods";
import { Cannon } from "../src/game/cannon";
import { Compactor } from "../src/game/compactor";
import { createPhysics, WORLD, WALL_INNER } from "../src/game/engine";
import {
  fillsSlots, strikeCryo, shatterColdCryo, updateLineClear, CRYO_STRIKE_SPEED,
  volatileBlast, tarWelds, alignMagnetic, VOLATILE_TRIGGER_SPEED, updateBlinking,
  markLostPieces,
} from "../src/game/lineClear";
import type { Cube } from "../src/game/pieces";
import type { Material, PieceType } from "../src/game/theme";
import {
  applyUpgrades, newTiers, nextTierCost, refitTracks, tiersCost, MAX_TIER, TIER_COSTS, UPGRADES,
  budgetForMark, buyLoadoutTier, FULL_BUILD_COST, loadoutLegal, MARK_COUNT,
} from "../src/game/upgrades";
import {
  contractClaimed, markUnlocked, newMeta, recordContractClear, recordRunEnd, safeLoadout,
  tierProgressFor, tierSalvage, tierMilestoneSalvage, TIER_CONTRACTS_REQUIRED, TIER_SALVAGE_BASE,
  UNLOCKS, unlockAvailable, draftSlots, DRAFT_BASE_SLOTS, DRAFT_FULL_SLOTS,
  DRAFT_THIRD_SLOT_CONTRACTS, INSTALLS, installById, installAvailable, installGates,
  buyInstall, markBudget, nextStep, refundRetiredUnlocks, type InstallDef, type MetaState,
} from "../src/game/meta";
import {
  advanceRun, bayMusic, bondChargesFor, buyUpgrade, isRefitBay, levelForRun, newRun,
  CARRY_CAP, REFIT_EVERY, RUN_LEVELS,
} from "../src/game/run";
import {
  dailyContracts, dealPatternQueue, generateContract, levelForContract, contractBed,
  variantsFor, variantSpec, CONTRACT_RARE_CHANCE, DAILY_COUNT, CUBES_PER_LINE,
  PATTERN_SLOT, VARIANTS, PLANNING_EFFICIENCY, SPARE_SHIPMENTS,
  TINY_PATTERN_MIN_TIER, contractEfficiency, contractMaterialTier, launchesFor,
  CONTRACT_MATERIAL_CAP, SALVAGE_WALL_ATTEMPTS, SALVAGE_PROBE_NODES,
  type ContractVariant,
} from "../src/game/contracts";
import {
  pieceCells, SIZE_SPEC, createStandingWall, createTetrisPiece,
  updateBreakableJoints, breakJointsInBand, WEAK_BOND_UNBREAKABLE_BASE,
} from "../src/game/pieces";
import { tilesRegion, EXACT_ATTEMPTS, NODE_BUDGET } from "../src/game/tiling";
import { isBuildable } from "../src/game/buildable";
import {
  computeLayout,
  getRailSlots,
  RAIL_GAP,
  RAIL_MIN,
  RAIL_SLOTS_BASE,
  RAIL_SLOTS_MAX,
  railSlotsFor,
  setRailSlots,
  setSafeAreaInsets,
  UI_SCALE_MIN,
} from "../src/game/layout";
import { PIECE_TYPES, MATERIALS, MATERIAL_SPEC, type PieceSize } from "../src/game/theme";
import { CELL } from "../src/game/engine";
import {
  endBoard, fullBoard, END_BOARD_TOP, contractsScreen, workshopScreen, refitScreen,
  contractEndModal, coachSteps, coachFailSteps, coachFailHTML, controlsScreen, hudHTML,
  menuScreen, salvageHTML,
} from "../src/ui/screens";
import {
  BINDABLE_ACTIONS, actionForKey, hintRotate, keyFor, padFor,
  resetKeyBindings, resetPadBindings, setKeyBinding, setPadBinding,
} from "../src/game/bindings";
import { setRailSide } from "../src/game/layout";
import { icon, type IconName } from "../src/ui/icons";
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
  check("the demolition track grants charges", demoCfg.bombCharges === 4, String(demoCfg.bombCharges));
  const demoStock = makeBaseLevel(0);
  applyUpgrades(demoStock, newTiers());
  check("an uninstalled demolition track grants none", demoStock.bombCharges === 0, String(demoStock.bombCharges));
  check("a full rig now costs 770", FULL_BUILD_COST === 770, String(FULL_BUILD_COST));
}

// ---------------------------------------------------------------------------
section("Seam Splitter (upgrades.ts bonds t2-3 / pieces.ts weakBond)");
// ---------------------------------------------------------------------------
{
  // Spawn a piece into an inert engine's world (nothing steps it — same
  // pattern as the rebar joint checks below) and read back the break
  // threshold createTetrisPiece stamped onto its constraints. The stamp is
  // the whole record: updateBreakableJoints only ever reads the constraint,
  // so asserting the stamp asserts the behaviour.
  const stamped = (cfg: LevelConfig, type: PieceType, material: Material = "standard"): number => {
    const w = Matter.Engine.create().world;
    const p = createTetrisPiece(
      w, 200, 200, 0, { x: 0, y: 0 }, type, cfg.jointStiffness, "std",
      cfg.jointBreakStretch, material,
      { types: cfg.weakBondTypes, mult: cfg.weakBondMult },
    );
    return (p.constraints[0] as unknown as { breakStretch: number }).breakStretch;
  };

  const t1 = makeBaseLevel(0);
  applyUpgrades(t1, { ...newTiers(), bonds: 1 });
  check("BONDS t1 ships no weakening — the passive is what t2-3 pay for",
    t1.weakBondTypes.length === 0 && t1.weakBondMult === 1);

  const t2 = makeBaseLevel(0);
  applyUpgrades(t2, { ...newTiers(), bonds: 2 });
  check("BONDS t2 weakens S and Z",
    t2.weakBondTypes.includes("S") && t2.weakBondTypes.includes("Z"));
  check("an S stamps a weaker threshold than a T at the same config",
    stamped(t2, "S") < stamped(t2, "T"),
    `S ${stamped(t2, "S")} vs T ${stamped(t2, "T")}`);
  check("the S/T gap is exactly weakBondMult",
    Math.abs(stamped(t2, "S") - stamped(t2, "T") * t2.weakBondMult) < 1e-9);

  // The fallback base is the whole reason the subsystem composes with an
  // unbreakable-bonds bay: Infinity x 0.7 is still Infinity, so a weakened
  // type restates bay-1 fragility instead — finite where nothing else is.
  const inf: LevelConfig = { ...t2, jointBreakStretch: Infinity };
  check("on an Infinity-stretch bay a weakened S is finite again",
    Number.isFinite(stamped(inf, "S")), String(stamped(inf, "S")));
  check("...computed from bay-1 fragility, not the bay's own Infinity",
    Math.abs(stamped(inf, "S")
      - Math.max(1.05, WEAK_BOND_UNBREAKABLE_BASE * inf.weakBondMult)) < 1e-9);
  check("a T on the same bay keeps its unbreakable bonds",
    stamped(inf, "T") === Infinity);
  check("a rebar S stays Infinity — material rigidity outranks the shape",
    stamped(inf, "S", "rebar") === Infinity && stamped(t2, "S", "rebar") === Infinity);

  const t3 = makeBaseLevel(0);
  applyUpgrades(t3, { ...newTiers(), bonds: 3 });
  check("BONDS t3 cuts deeper than t2", t3.weakBondMult < t2.weakBondMult,
    `${t3.weakBondMult} vs ${t2.weakBondMult}`);
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
  // A Mark no longer raises the bar at all — MARK_TARGET_STEP is 0 and the
  // three base axes are flat. This used to assert the opposite, and the
  // inversion IS the hazard draft: difficulty comes from which axes the player
  // ratchets, not from numbers the ladder moves behind their back.
  let barFlat = true;
  for (let m = 2; m <= MARK_COUNT; m++) {
    if (makeBaseLevel(0, m).targetScore !== makeBaseLevel(0, m - 1).targetScore) barFlat = false;
  }
  check("a Mark does not move the bay's target", barFlat);
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

  // BONDS are the one ladder number a Mark still moves (level.ts's
  // BOND_MARK_STEP) — content rather than demand: stronger bonds change how
  // the pile behaves, not how much the bay asks for.
  check(
    "bonds strengthen with the Mark",
    makeBaseLevel(0, 5).jointBreakStretch > makeBaseLevel(0, 1).jointBreakStretch,
    `${makeBaseLevel(0, 1).jointBreakStretch} -> ${makeBaseLevel(0, 5).jointBreakStretch}`,
  );
  check(
    "...by BOND_MARK_STEP per rung above Mark 1",
    makeBaseLevel(0, 5).jointBreakStretch === BASE_BREAK_STRETCH * (1 + BOND_MARK_STEP * 4),
    String(makeBaseLevel(0, 5).jointBreakStretch),
  );
  // Mark 1 multiplies by exactly 1, so the tuned 2.2 -> 4.4 bay ramp survives
  // byte-identically at the bottom of the ladder.
  check(
    "Mark 1 keeps the stock bond ramp exactly",
    Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, 1).jointBreakStretch)
      .every((v, i) => v === BASE_BREAK_STRETCH * (1 + i / 9)),
  );
  // One rung below the capstone the ramp is still an ordinary ramp — rising
  // bay over bay, finite everywhere.
  {
    const nine = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, 9).jointBreakStretch);
    check(
      "at Mark 9 bonds rise with the bay and every bay stays finite",
      nine.every((v) => Number.isFinite(v)) && nine.every((v, i) => i === 0 || v > nine[i - 1]),
      nine.map((v) => v.toFixed(2)).join(","),
    );
  }
  // The capstone bay at the capstone Mark is ONLY unbreakable bonds — nothing
  // shatters on landing, the press cannot break a piece (breakJointsInBand
  // exempts Infinity, the rebar rule), and the per-run Bond Breaker magazine
  // is the only shatter left. Exactly tier 10 bay 10; one step earlier on
  // either axis is still a breakable bay.
  check("tier 10 bay 10 is unbreakable", makeBaseLevel(9, 10).jointBreakStretch === Infinity);
  check(
    "the unbreakable bay is only the capstone's",
    Number.isFinite(makeBaseLevel(8, 10).jointBreakStretch)
      && Number.isFinite(makeBaseLevel(9, 9).jointBreakStretch),
    `${makeBaseLevel(8, 10).jointBreakStretch} / ${makeBaseLevel(9, 9).jointBreakStretch}`,
  );
  // UNBREAKABLE_MARK is CAPSTONE_MARK's rung restated in level.ts, which
  // cannot import it back (hazards.ts imports level.ts — the cycle). This
  // assertion is the tie that replaces the import.
  check(
    "UNBREAKABLE_MARK is the capstone rung",
    UNBREAKABLE_MARK === CAPSTONE_MARK,
    `${UNBREAKABLE_MARK} vs ${CAPSTONE_MARK}`,
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
  check("advanceRun carries the Mark", advanceRun(loaded, 900, 800, 8, 26, []).mark === 3);
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
  check("an install charges its salvage price",
    bought?.salvage === 100 - installById("reactor")!.cost, String(bought?.salvage));
  check("an install the player cannot afford is refused",
    buyInstall(freshMeta({ salvage: 5 }), "reactor") === null);
  check("installing twice is refused", buyInstall(bought!, "reactor") === null);
  const before = freshMeta({ salvage: 100 });
  buyInstall(before, "reactor");
  check("buyInstall never mutates its input",
    before.loadout.reactor === 0 && before.salvage === 100);

  // The locked copy the Workshop prints must name the gate the purchase path
  // actually applies — one function, so the two can never drift. Rendered in
  // TIER numbering (B8): requiresMark 2 = "beat Mark 2" = "reach Tier 3".
  const gated = INSTALLS.find((i) => i.requiresMark === 2)!;
  check("installGates names the tier a gated system waits on",
    installGates(freshMeta(), gated).some((g) => g.includes("Tier 3")),
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

  // --- what the screens actually render ------------------------------------
  // Every track needs its own glyph. `refitScreen` casts the upgrade id to
  // IconName, and a string-literal union assertion only requires the two unions
  // to SHARE a member — so a track with no icon typechecks clean and renders a
  // blank square. This is the check tsc cannot be.
  check("every upgrade track has an icon",
    UPGRADES.every((u) => !icon(u.id as IconName).includes("undefined")),
    UPGRADES.filter((u) => icon(u.id as IconName).includes("undefined")).map((u) => u.id).join(","));

  // Same check, same reason, for the option unlocks. The Workshop row puts a
  // glyph at the head of every card so Systems and Options share a left edge;
  // an unlock with no icon renders a blank square and still typechecks, because
  // a string-literal union assertion only requires the unions to SHARE a member.
  check("every unlock has an icon",
    UNLOCKS.every((u) => !icon(u.id as IconName).includes("undefined")),
    UNLOCKS.filter((u) => icon(u.id as IconName).includes("undefined")).map((u) => u.id).join(","));

  // The retired mod-pool shelf (meta.ts's UnlockDef.retired): eight cards
  // whose only consumer was the retired modifier draft. Never sold, never
  // listed, refunded in full when a save owns one.
  check("the mod-pool shelf is retired and the live options are not",
    UNLOCKS.filter((u) => u.retired).length === 8
      && ["survey", "scrap-cache"].every((id) => UNLOCKS.some((u) => u.id === id && !u.retired)),
    UNLOCKS.filter((u) => u.retired).map((u) => u.id).join(","));
  const owedRefund = freshMeta({ salvage: 10, unlocks: ["demo", "survey", "bond-breaker"] });
  const refunded = refundRetiredUnlocks(owedRefund);
  check("owned retired unlocks refund in full and leave the list",
    refunded.salvage === 10 + 45 + 320 && JSON.stringify(refunded.unlocks) === '["survey"]',
    `${refunded.salvage} · ${refunded.unlocks.join(",")}`);
  check("a clean save passes through the refund untouched",
    refundRetiredUnlocks(refunded) === refunded);
  check("the Workshop never lists a retired unlock",
    !workshopScreen(freshMeta({ salvage: 9_999, mark: 9 })).includes("Bulk Freight Permit"));

  // A3: ONE computed next step, the rule stated once (meta.ts's nextStep) so
  // the menu, the Workshop and the fail card can never point at different
  // doors: cover an install -> spend it; contracts owed -> earn it;
  // otherwise the run is the exam.
  check("a fresh save's next step is Contracts", nextStep(freshMeta()) === "contracts");
  check("salvage covering an install says Workshop",
    nextStep(freshMeta({ salvage: 15 })) === "workshop");
  check("contracts done and salvage spent point at the run",
    nextStep(freshMeta({
      tierContracts: 3, salvage: 0,
      loadout: { ...newTiers(), reactor: 1, launcher: 1, magazine: 1 },
    })) === "run");
  // …and the menu renders exactly the one badge the rule picked (A3), the
  // tier plate in the Deep Run button (A1), and — on first launch only — the
  // Guided Tutorial in How to Play's slot, with its own START HERE marker
  // (A2: a seventh row overflows a 360dp phone, so it takes a slot).
  const menuMid = menuScreen(0, 0, undefined, tierProgressFor(freshMeta()),
    { step: "contracts", install: null, firstLaunch: false });
  check("exactly one menu action carries the NEXT STEP badge",
    (menuMid.match(/next-badge/g) ?? []).length === 1);
  check("the Deep Run button carries the tier plate", menuMid.includes("tier-plate--menu"));
  const menuFirst = menuScreen(0, 0, undefined, tierProgressFor(freshMeta()),
    { step: "contracts", install: null, firstLaunch: true });
  check("first launch swaps How to Play for the badged Guided Tutorial",
    menuFirst.includes('data-action="tutorial"') && !menuFirst.includes('data-action="howto"'));
  check("once seen, How to Play returns and the tutorial entry goes",
    menuMid.includes('data-action="howto"') && !menuMid.includes('data-action="tutorial"'));

  const shop = workshopScreen(freshMeta({ salvage: 50 }));
  check("the Workshop offers an install to buy", shop.includes(`data-action="buy-install"`));
  check("the Workshop shows the build budget", shop.includes("build budget"));
  // ONE SHELF. The tab assertions these replace were the mirror image: they
  // pinned the INACTIVE pane out of the output, because the overflow fix of
  // the day depended on only half the stock rendering. The split is gone, so
  // the property worth holding is the opposite one — every purchasable thing
  // is in the markup at once, and neither kind can go missing behind a click.
  check("the shelf carries systems and options together",
    shop.includes(`data-action="buy-install"`) && shop.includes(`data-action="buy-unlock"`));
  check("the Workshop has no tab bar", !shop.includes(`data-action="shop-tab"`));
  // The aside is the fixed column; the budget lives there now rather than on
  // the deleted tab bar, and it is the usual reason a card is greyed out.
  check("the build budget rides in the fixed aside",
    shop.includes("workshop__aside") && shop.includes("workshop__budget"));
  const richMeta = freshMeta({ salvage: 99999, mark: MARK_COUNT });
  let allIn = richMeta;
  for (const i of INSTALLS) { const n = buyInstall(allIn, i.id); if (n) allIn = n; }
  const shopFull = workshopScreen(allIn);
  check("an exhausted shelf still shows what is installed",
    shopFull.includes("✓ Installed"));
  // Both card kinds carry a glyph and a body wrapper. This mattered more once
  // they shared a shelf than it did when they sat on separate tabs: a card
  // missing its glyph now sits directly beside one that has it, at a visibly
  // different left edge, in the same grid.
  check("an option card carries its glyph",
    shop.includes(`class="shop-card__name"><svg`),
    shop.slice(shop.indexOf("shop-card__name"), shop.indexOf("shop-card__name") + 80));
  check("both card kinds wrap name and desc in a body",
    shop.includes(`class="shop-card__body"`) &&
      shop.split(`class="shop-card__body"`).length - 1 >= 2);
  check("a tier-gated system is shown, locked, rather than hidden",
    shop.includes("Bond Emitter") && shop.includes("Needs Tier 3"),
    shop.includes("Bond Emitter") ? "gate copy missing" : "card missing");
  const brokeShop = workshopScreen(freshMeta({ salvage: 0 }));
  check("an install the player cannot afford is offered but disabled",
    brokeShop.includes(`data-action="buy-install"`) && brokeShop.includes("disabled"));
  const installedShop = workshopScreen(freshMeta({ loadout: { ...newTiers(), reactor: 1 } }));
  check("an installed system leaves the shelf for the strip",
    installedShop.includes("✓ Installed") &&
      !installedShop.includes(`data-install="reactor"`));

  // Refit prices tiers 2-3 only. Tier 0 used to render a live 20-scrap button
  // that tapped to nothing once run.ts stopped letting scrap install.
  // Mark 2 here so the full six-card menu renders — Mark 1's focused stop is
  // pinned separately below.
  const stockRefit = refitScreen({ bayNum: 3, nextBayName: "X", scrap: 999, tiers: newTiers(), mark: 2 });
  check("an uninstalled track shows no refit button",
    stockRefit.includes("Not installed") && !stockRefit.includes(`data-upgrade="reactor"`));
  const oneUp = refitScreen({ bayNum: 3, nextBayName: "X", scrap: 999, tiers: { ...newTiers(), reactor: 1 }, mark: 2 });
  check("an installed track shows its next tier", oneUp.includes(`data-upgrade="reactor"`));

  // MARK-1 FOCUS: the first tier's refit stops offer only Reactor Output —
  // the run tuning assumes its three tiers get built (upgrades.ts's
  // refitTracks), and one card makes the stop a purchase, not a dilemma.
  check("refitTracks(1) offers only the reactor",
    refitTracks(1).length === 1 && refitTracks(1)[0].id === "reactor");
  check("refitTracks(2) opens the full yard", refitTracks(2).length === UPGRADES.length);
  const mark1 = refitScreen({ bayNum: 3, nextBayName: "X", scrap: 999, tiers: { ...newTiers(), reactor: 1 }, mark: 1 });
  check("a Tier-1 stop renders exactly one row",
    (mark1.match(/refit-row__name/g) ?? []).length === 1 && mark1.includes(`data-upgrade="reactor"`));
  check("a Tier-1 stop says why the yard is short", mark1.includes("opens at Tier 2"));
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
  let windiestTierOne = 0;
  let windiestEver = 0;
  let worstRatio = Infinity;
  // The pentomino Contract is gone by design (playtest, 2026-08-09): bulk
  // pieces pack visibly worse than tetrominoes, so those Contracts read as
  // dice rolls rather than puzzles. Its slot went to materials, which the
  // budget model can actually price — so the sweep also proves no bulk
  // Contract, no slag, no material below its hazard rung, and a rate the
  // model priced for.
  let everBulk = false;
  let everSlagOrUnpriced = false;
  let everEarlyMaterial = false;
  let everMaterialOffStd = false;
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 40; seed++) {
      for (const c of dailyContracts(tier, seed)) {
        if (c.pieceSize === "bulk") everBulk = true;
        // Pattern Contracts are bounded by their queue, not a launch budget,
        // and their feasibility is exact rather than statistical — they get
        // their own block below.
        if (c.kind !== "lines") continue;
        // The material-aware efficiency IS the feasibility model now: a
        // material Contract budgeted at plain PLANNING_EFFICIENCY would be
        // exactly the silently-tighter Contract this sweep exists to forbid.
        const supply =
          c.launches * SIZE_SPEC[c.pieceSize].cubes * contractEfficiency(c.material, c.materialRate);
        const demand = c.goal * CUBES_PER_LINE;
        worstRatio = Math.min(worstRatio, supply / demand);
        if (supply < demand) everImpossible = true;
        if (c.windMax < 0) everNegativeWind = true;
        if (tier === 1 && c.windMax > 0.1) tierOneTooWindy = true;
        if (tier === 1) windiestTierOne = Math.max(windiestTierOne, c.windMax);
        windiestEver = Math.max(windiestEver, c.windMax);
        if (c.material === null) {
          if (c.materialRate !== 0) everSlagOrUnpriced = true;
        } else {
          if ((c.material as string) === "slag" || (c.material as string) === "standard"
            || c.materialRate <= 0 || c.materialRate > CONTRACT_MATERIAL_CAP) {
            everSlagOrUnpriced = true;
          }
          // "Contracts teach what Deep Run tests": a material may not appear
          // in a Contract before the Mark whose Deep Run deals it.
          if (contractMaterialTier(c.material) > tier) everEarlyMaterial = true;
          // The budget prices waste per STD shipment, and the cannon's
          // size-normalized roll would double a domino belt's rate.
          if (c.pieceSize !== "std") everMaterialOffStd = true;
        }
      }
    }
  }
  check("every contract can supply the cubes its goal needs", !everImpossible);
  // Not merely >= 1: a Contract is the forgiving half of the game, so even the
  // tightest generated one must leave room for an imperfect attempt. The floor
  // is SLACK_TIGHT (1.02 since the 2026-08 balance pass tightened it from
  // 1.05) — ceil rounding can only add headroom above it, never take it away.
  check(`tightest contract keeps headroom (${worstRatio.toFixed(2)}x)`, worstRatio >= 1.02);
  check("no contract ships bulk pentominoes", !everBulk);
  check("contract materials are always countable and priced", !everSlagOrUnpriced);
  check("no material appears before its hazard rung", !everEarlyMaterial);
  check("material contracts ship std payloads", !everMaterialOffStd);

  // The 2026-08 balance pass tightened SLACK 1.25 -> 1.15 (~8% fewer launches
  // on every lines Contract). Two seams have to hold through that. The
  // Math.max(3, ...) floor in launchesFor must still be what a beginner meets:
  // no tier-1 lines Contract may budget below 3 launches, however small the
  // goal roll. And launchesFor must budget strictly fewer launches at the new
  // slack than the old for a representative goal — if it ever stops, either
  // the formula changed or someone quietly walked the constant back up, and
  // both should be a loud test failure rather than a balance drift.
  let tierOneFloorHolds = true;
  for (let seed = 20260101; seed < 20260101 + 40; seed++) {
    for (const c of dailyContracts(1, seed)) {
      if (c.kind === "lines" && c.launches < 3) tierOneFloorHolds = false;
    }
  }
  check("a tier-1 lines Contract still grants at least 3 launches", tierOneFloorHolds);
  check(
    "the tightened slack actually buys fewer launches than the old 1.25",
    launchesFor(6, 4, 1.15) < launchesFor(6, 4, 1.25),
    `${launchesFor(6, 4, 1.15)} vs ${launchesFor(6, 4, 1.25)}`,
  );

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
  // The tier cap, pinned at both ends of the 2026-08-22 halving: tier 1 caps
  // at 0.025 and the ladder tops out at 0.15 — bay 10's windMax — so a
  // generated Contract can never be windier than the windiest bay Deep Run
  // itself deals. A regression to the old 0.05 +0.03/tier cap would pass the
  // structural checks above while doubling the weather.
  check("tier 1 wind never exceeds its 0.025 cap",
    windiestTierOne <= 0.025 + 1e-9, `windiest ${windiestTierOne}`);
  check("no contract exceeds the 0.15 wind ceiling",
    windiestEver <= 0.15 + 1e-9, `windiest ${windiestEver}`);

  // A clean belt and the standard model must be the same number, or the
  // material-aware sweep above quietly stopped testing the material-free case.
  check(
    "a clean belt prices at PLANNING_EFFICIENCY exactly",
    contractEfficiency(null, 0) === PLANNING_EFFICIENCY,
  );

  // The day's three must be three different problems, not three rolls of one
  // die — that's the difference between a curated board and a shuffle.
  const day = dailyContracts(4, 20260730);
  check(
    "the day's contracts differ from each other",
    new Set(day.map((c) => `${c.pieceSize}|${c.material}|${c.windMax > 0}|${c.launches}|${c.goal}`)).size > 1,
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
    // The gust fraction is the SHARED constant, not a copy — levelForContract
    // used to hardcode 0.025, which would have silently forked from Deep Run
    // the day WIND_GUST_FRACTION was retuned (it was, to 0.015).
    check(`${c.name}: gust rides the shared fraction`,
      cfg.windGust === cfg.windMax * WIND_GUST_FRACTION);
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
  const tinyShipments = new Map<number, number[]>();
  const stdShipments = new Map<number, number[]>();
  let tinyEverMultiShape = false;
  let tinyBelowMinTier = false;
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 40; seed++) {
      for (const c of dailyContracts(tier, seed)) {
        if (c.kind !== "pattern") continue;
        patterns += 1;
        // Exactness is measured against the CONTRACT's own region, not the
        // ladder's: a "short" variant is sized to 6-cell lines, and a "salvage"
        // one is short by exactly the wall the bay opens with. Both would read
        // as inexact against a hardcoded 8-wide empty rectangle, and the whole
        // point of the check is that they are not.
        const cubes = c.queue.length * SIZE_SPEC[c.pieceSize].cubes;
        const wall = c.standing.reduce((a, h) => a + h, 0);
        if (cubes + wall !== c.goal * c.lineCells + SPARE_SHIPMENTS * SIZE_SPEC[c.pieceSize].cubes) {
          everInexact = true;
        }
        // The cube COUNT above is necessary but nowhere near sufficient: the
        // generator shipped [I, O, J, J] for two lines, which counts perfectly
        // and tiles nothing. Re-solved here with an independent search rather
        // than trusting the one that built it — a guarantee re-derived by the
        // same route it was produced by proves only that the code is itself.
        if (!tilesRegion(c.queue, c.goal, c.lineCells, c.pieceSize, c.standing)) everUntileable = true;
        varietyByTier.set(tier, Math.max(varietyByTier.get(tier) ?? 0, new Set(c.queue).size));
        sizesSeen.add(c.pieceSize);
        if (c.pieceSize === "tiny") {
          (tinyByTier.get(tier) ?? tinyByTier.set(tier, []).get(tier)!).push(c.goal);
          (tinyShipments.get(tier) ?? tinyShipments.set(tier, []).get(tier)!).push(c.queue.length);
          // A domino ignores its type (pieces.ts's pieceCells), so a tiny
          // Contract's brief may never describe a distinction between its
          // shipments — there is none to see on the field.
          //
          // The earlier version of this check was too weak in two ways at once,
          // and a Single Stock domino Contract walked through both: it only
          // looked at queues with MORE than one type (a single-type queue
          // short-circuits) and it only searched for the word "shape". The card
          // read "12 shipments · all L, no waste" about twelve identical
          // dominoes, and this line said nothing.
          //
          // So it now asserts the property rather than one phrasing of it: on a
          // domino belt the brief must not name a piece TYPE at all, whatever
          // words it uses to do it.
          if (/\bshapes?\b/.test(c.brief)) tinyEverMultiShape = true;
          if (PIECE_TYPES.some((t) => new RegExp(`\\ball ${t}\\b`).test(c.brief))) {
            tinyEverMultiShape = true;
          }
          if (tier < TINY_PATTERN_MIN_TIER) tinyBelowMinTier = true;
        } else {
          (stdByTier.get(tier) ?? stdByTier.set(tier, []).get(tier)!).push(c.goal);
          (stdShipments.get(tier) ?? stdShipments.set(tier, []).get(tier)!).push(c.queue.length);
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
  //
  // Measured in SHIPMENTS, not in lines. This compared max goal-per-tier until
  // variants arrived, and that stopped being a size comparison the moment a
  // variant could carry a goal bonus AND be std-only: Single Stock is tetromino
  // only and spends +1 line, so at tier 5 the biggest std goal (4) beat the
  // biggest tiny one (3) and the check failed while nothing was wrong. It was
  // comparing two different variants and calling the difference a size effect.
  //
  // Shipments is what the sentence above actually claims, and it is robust to
  // any variant's goal bonus: a domino bay needs twice the shipments per line,
  // so even a shorter domino goal is more deliveries than a longer std one.
  const tinyShipMax = (t: number) => Math.max(...(tinyShipments.get(t) ?? [0]));
  const stdShipMax = (t: number) => Math.max(...(stdShipments.get(t) ?? [0]));
  let deliveryHolds = true;
  const deliveryRows: string[] = [];
  for (let t = TINY_PATTERN_MIN_TIER; t <= 9; t++) {
    if (!tinyShipments.has(t) || !stdShipments.has(t)) continue;
    deliveryRows.push(`t${t} ${tinyShipMax(t)}v${stdShipMax(t)}`);
    if (tinyShipMax(t) <= stdShipMax(t)) deliveryHolds = false;
  }
  check(
    "a domino Contract asks for more shipments than a tetromino one",
    deliveryHolds,
    deliveryRows.join(" "),
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

  // --- The dealt order has to be BUILDABLE, not merely a permutation --------
  //
  // The gap this closes: tilesRegion proves the inventory PACKS the goal
  // rectangle. It says nothing about assembling that packing one shipment at a
  // time, under gravity, with a row clearing the instant it fills — which is the
  // only way a player ever gets to build it. The tier-5 board on 2026-08-22 dealt
  // [I, I, L, L, L, J] for three lines: a set that packs, and whose canonical
  // order cannot be finished by landing each shipment where it falls. It was
  // reported, correctly, as impossible.
  //
  // Re-checked with isBuildable rather than buildOrder for the same reason the
  // tiling checks above don't call tilingQueue: a guarantee re-derived by the
  // code that produced it proves only that the code agrees with itself.
  let everUnbuildable = 0;
  let everUnbuildableEvenLoosely = 0;
  let dealtPatterns = 0;
  const dealRng = (() => { let z = 0x2f6e2b1; return () => ((z = (z * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 25; seed++) {
      for (const ct of dailyContracts(tier, seed)) {
        if (ct.kind !== "pattern") continue;
        const cfg = levelForContract(ct, dealRng);
        const dealt = cfg.pieceQueue!;
        dealtPatterns += 1;
        const cols = cfg.compactorMinLineCells;
        if (!isBuildable(dealt, cols, ct.pieceSize, "drop", ct.standing)) {
          everUnbuildable += 1;
          if (!isBuildable(dealt, cols, ct.pieceSize, "tuck", ct.standing)) {
            everUnbuildableEvenLoosely += 1;
          }
        }
      }
    }
  }
  // The hard invariant is the weaker of the two, deliberately: the deal search
  // is randomized, and an assertion that every single roll finds the STRICT
  // kind of order would be a flake waiting for a slow day. What must never
  // happen is a deal nobody can finish at all.
  check(
    `every dealt pattern queue can be finished (${dealtPatterns} deals)`,
    everUnbuildableEvenLoosely === 0,
    `${everUnbuildableEvenLoosely} unbuildable under either model`,
  );
  // And the measurement beside it: since buildable.ts's move ordering landed,
  // the straight-drop search has not failed once across all 624 inventories
  // this generator can emit, so the tuck fallback is a safety net under a path
  // nothing currently takes. If this starts tripping, that has changed.
  check(
    `deals are buildable landing shipments straight down ` +
      `(${dealtPatterns - everUnbuildable}/${dealtPatterns})`,
    everUnbuildable <= dealtPatterns * 0.05,
    `${everUnbuildable} needed a tuck`,
  );

  // Evidence that the buildability checker is not answering "yes" to everything
  // — without it, the two checks above would bless any regression at all.
  // [I, I, L, L, L, J] is the board that prompted all of this: it packs, and in
  // this order nothing lands it.
  check(
    "buildability checker rejects the [I,I,L,L,L,J] order that shipped",
    tilesRegion(["I", "I", "L", "L", "L", "J"], 3, 8)
      && !isBuildable(["I", "I", "L", "L", "L", "J"], 8, "std", "drop"),
  );
  // ...and accepts the order the same SET can be finished in, so the rejection
  // above is about the ORDER rather than a checker that hates L pieces.
  check(
    "the same set is buildable in a different order",
    isBuildable(["L", "I", "L", "J", "L", "I"], 8, "std", "drop"),
  );
  check("buildability checker accepts four O shipments", isBuildable(["O", "O", "O", "O"], 8, "std", "drop"));
  // Four cubes short of two rows: rejected on arithmetic, before any search.
  check("buildability checker rejects a queue that can't fill the area", !isBuildable(["I", "O", "O"], 8, "std", "drop"));
  // Tuck is strictly more permissive than drop, or the fallback in
  // dealPatternQueue is not a fallback at all.
  check(
    "tuck admits an order drop refuses",
    isBuildable(["I", "I", "L", "L", "L", "J"], 8, "std", "tuck"),
  );
  // --- The memo must name the whole subproblem ------------------------------
  //
  // buildOrder picks the ORDER as well as the placements, so two branches reach
  // the same board having spent different pieces to get there. A memo keyed on
  // the board plus a COUNT of what is left calls those the same node, and one
  // dead branch poisons a live one — the search then reports "no order" for an
  // inventory that has one, dealPatternQueue drops to its plain-shuffle
  // fallback, and the bay is handed exactly the unwinnable deal this module
  // exists to prevent.
  //
  // `() => 0` rather than a realistic rng on purpose: it is a legal generator
  // and it pins the search to one deterministic walk, which is what makes this
  // a regression test rather than a coin flip. Under Math.random the bug hid —
  // a 624-inventory sweep never tripped it — which is exactly why it needs a
  // check that does not depend on luck.
  {
    const zero = () => 0;
    const narrow = generateContract(1002, 6, PATTERN_SLOT, "short");
    const dealt = dealPatternQueue(narrow, narrow.lineCells, zero);
    check(
      `a deterministic deal is still buildable (${narrow.queue.join("")} -> ${dealt.join("")})`,
      isBuildable(dealt, narrow.lineCells, narrow.pieceSize, "drop", narrow.standing),
    );
    // And the checker is not simply agreeing with everything: the order the
    // broken memo used to produce is genuinely unbuildable.
    check(
      "the order the broken memo dealt is genuinely unbuildable",
      !isBuildable(["I", "T", "T", "J", "J", "I"], narrow.lineCells, "std", "drop"),
    );
  }

  // The order dealPatternQueue hands out must be the advertised set, still —
  // proving an order finishable is worthless if it quietly changes the cargo.
  const proven = dealPatternQueue(c, 8, dealRng);
  check(
    "a proven order is still exactly the advertised multiset",
    JSON.stringify([...proven].sort()) === JSON.stringify([...c.queue].sort()),
  );
}

// ---------------------------------------------------------------------------
section("Pattern variants (contracts.ts VARIANTS)");
// ---------------------------------------------------------------------------
{
  // Every variant changes a RULE, and every rule it changes has to survive the
  // two proofs a pattern Contract rests on. Swept per variant and forced rather
  // than taken from the daily board: the board rolls one variant per seed, so a
  // check that took what it was given would need thousands of seeds to see the
  // rare ones once and would still not guarantee it had.
  let inexact = 0, unpackable = 0, unbuildable = 0, rowAlreadyFull = 0;
  let wallFloating = 0, offLadder = 0, wrongWidth = 0, sampled = 0;
  const goalsByVariant = new Map<string, Set<number>>();
  const shapesByVariant = new Map<string, Set<string>>();
  const wallRng = (() => { let z = 0x51ed270; return () => ((z = (z * 1664525 + 1013904223) >>> 0) / 4294967296); })();

  for (const v of VARIANTS) {
    for (let tier = 1; tier <= 10; tier++) {
      // A variant must never be generated below its rung, and forcing one is
      // the sandbox's job, not the board's — so the ladder is checked here
      // against what variantsFor offers rather than against a forced roll.
      if (v.tier > tier) {
        if (variantsFor(tier).some((x) => x.id === v.id)) offLadder += 1;
        continue;
      }
      if (!variantsFor(tier).some((x) => x.id === v.id)) offLadder += 1;

      for (let seed = 20260101; seed < 20260101 + 12; seed++) {
        const ct = generateContract(seed, tier, PATTERN_SLOT, v.id);
        sampled += 1;
        const cubes = ct.queue.length * SIZE_SPEC[ct.pieceSize].cubes;
        const wall = ct.standing.reduce((a, h) => a + h, 0);
        if (cubes + wall !== ct.goal * ct.lineCells) inexact += 1;
        if (!tilesRegion(ct.queue, ct.goal, ct.lineCells, ct.pieceSize, ct.standing)) unpackable += 1;

        const cfg = levelForContract(ct, wallRng);
        // The bay must be built to the width the inventory was sized to. If
        // these ever part company every Contract of that variant is short by a
        // cube a line — the same defect class the tiling bug was.
        if (cfg.compactorMinLineCells !== ct.lineCells) wrongWidth += 1;
        if (cfg.compactorOpenCells <= cfg.compactorMinLineCells) wrongWidth += 1;

        const dealt = cfg.pieceQueue!;
        if (!isBuildable(dealt, ct.lineCells, ct.pieceSize, "drop", ct.standing)
          && !isBuildable(dealt, ct.lineCells, ct.pieceSize, "tuck", ct.standing)) {
          unbuildable += 1;
        }

        // A standing wall has two invariants of its own, and both are silent
        // failures rather than crashes. A wall with no gap completes a row on
        // frame one — the bay hands back a line nobody earned and the exact
        // inventory is now one line long. A wall that is not a column profile
        // could ask the player to build under a floating slab.
        if (ct.standing.length > 0) {
          if (ct.standing.length !== ct.lineCells) wallFloating += 1;
          if (Math.min(...ct.standing) > 0) rowAlreadyFull += 1;
          if (ct.standing.some((h) => h < 0 || h >= ct.goal)) wallFloating += 1;
        }
        // A variant that does NOT open on a wall must never carry one.
        if (!variantSpec(v.id).salvage && ct.standing.length > 0) wallFloating += 1;

        (goalsByVariant.get(v.id) ?? goalsByVariant.set(v.id, new Set()).get(v.id)!).add(ct.goal);
        (shapesByVariant.get(v.id) ?? shapesByVariant.set(v.id, new Set()).get(v.id)!)
          .add([...new Set(ct.queue)].sort().join(""));
      }
    }
  }

  check(`every variant generates (${sampled} sampled across ${VARIANTS.length} variants)`, sampled > 0);
  check("every variant's inventory is exact for its own region", inexact === 0, `${inexact} inexact`);
  check("every variant's inventory packs its own region", unpackable === 0, `${unpackable} unpackable`);
  check("every variant deals a finishable order", unbuildable === 0, `${unbuildable} unbuildable`);
  check("every variant's bay is built to the width its inventory assumes", wrongWidth === 0, `${wrongWidth} mismatched`);
  check("a variant never appears below its rung", offLadder === 0, `${offLadder} off-ladder`);
  check("only the salvage variant opens on a wall, and it is a column profile", wallFloating === 0);
  check("a salvage wall never already completes a row", rowAlreadyFull === 0);

  // The rules each variant claims on its card must actually be true of the bay.
  const at = (id: ContractVariant, tier: number) =>
    levelForContract(generateContract(20260101, tier, PATTERN_SLOT, id), wallRng);
  check("Narrow Gauge really narrows the line", at("short", 4).compactorMinLineCells === 6);
  check("Full Rebar really ships rebar, on every shipment", at("rebar", 5).materialMix.rebar === 1);
  check("Guided really ships magnetic", at("guided", 9).materialMix.magnetic === 1);
  check("Blackout really hides the preview", at("blind", 7).hideNextPreview);
  check("Part Load really opens on a wall", at("salvage", 6).standingWall.some((h) => h > 0));
  check(
    "Single Stock really ships one shape",
    new Set(generateContract(20260101, 5, PATTERN_SLOT, "single").queue).size === 1,
  );
  // ...and the ones that don't claim a rule must not quietly carry one.
  const plain = at("plain", 9);
  check(
    "Standard changes nothing",
    plain.compactorMinLineCells === CUBES_PER_LINE && !plain.hideNextPreview
      && plain.standingWall.length === 0
      && Object.values(plain.materialMix).every((r) => r === 0),
  );

  // Variety, per variant. A variant whose generator always found the same
  // answer would pass every check above while being one Contract wearing nine
  // tiers — the exact failure the variant axis exists to fix.
  let stuck = "";
  for (const v of VARIANTS) {
    const shapes = shapesByVariant.get(v.id)?.size ?? 0;
    // Single Stock is the one that legitimately has few: it is one shape by
    // definition, and only some single shapes tile a rectangle at all.
    if (shapes < (v.oneShape ? 2 : 4)) stuck += `${v.id}:${shapes} `;
  }
  check("every variant produces a range of inventories", stuck === "", stuck);

  // ---- A card may not advertise a wall the bay does not have ---------------
  //
  // salvageProfile guarantees ARITHMETIC (the empty area divides by the payload)
  // and not geometry, so a profile can leave a region nothing tiles. The
  // generator used to keep the salvage variant and its brief anyway when that
  // happened, shipping an ordinary empty bay whose card read "0 cubes already
  // down" — measured at 19.5% of Part Load Contracts. A variant that silently
  // becomes another variant, while still charging a rung of the ladder for
  // itself, is worse than one that is merely rare.
  {
    let salvaged = 0, wallless = 0, lying = 0, worstMs = 0;
    for (let tier = 6; tier <= 9; tier++) {
      for (let seed = 20260101; seed < 20260101 + 60; seed++) {
        const t0 = Date.now();
        const ct = generateContract(seed, tier, PATTERN_SLOT, "salvage");
        worstMs = Math.max(worstMs, Date.now() - t0);
        salvaged += 1;
        const wall = ct.standing.reduce((a, h) => a + h, 0);
        if (wall === 0) wallless += 1;
        // Two ways the card could lie, both checked: the brief claiming cubes
        // that are not there, and the variant naming itself Part Load with an
        // empty bay behind it.
        if (wall === 0 && /cubes already down/.test(ct.brief)) lying += 1;
        if (wall === 0 && ct.variant === "salvage") lying += 1;
      }
    }
    check(`no Contract advertises a wall it does not have (${salvaged} sampled)`, lying === 0);
    check(
      `a salvage Contract usually gets its wall (${salvaged - wallless}/${salvaged})`,
      wallless <= salvaged * 0.1,
      `${wallless} fell back to plain`,
    );
    // Generation sits on the render path (main.ts calls dailyContracts on every
    // paint of the Contracts screen), so an unbounded search here is a freeze.
    //
    // The BOUND is asserted in nodes, not milliseconds, and that is the whole
    // lesson of this check. Its first cut asserted `worstMs < 1500` alone —
    // which passed at 980ms on one machine and failed at 2135ms on another,
    // running byte-identical code over the same fixed seeds. The workload is
    // deterministic; only the clock is not. A ms bound on it does not measure
    // the thing it claims to measure, it measures the runner, so it goes red on
    // a slow box and green on a fast one whatever the code does.
    //
    // What is worth pinning is the design promise itself, stated literally:
    // probing every candidate wall must cost LESS THAN PROVING ONE. The moment
    // the loop can outspend a single unbounded solve, "probe cheaply instead of
    // proving expensively" stops describing the code, and the fallback it was
    // built to avoid becomes the cheaper path.
    //
    // Note the EXACT_ATTEMPTS factor, which is the part that is easy to miss and
    // is exactly what went wrong: tilingQueue re-runs its own search that many
    // times chasing a shipment-type count, and each of those runs gets the full
    // per-probe ceiling. The cost is the product of all THREE numbers, not the
    // two that appear at the call site. The first cut of this fix cut the
    // per-probe ceiling tenfold and raised the wall count sixfold, which reads
    // like a large saving and was 720,000 nodes against a solve's 200,000 —
    // over budget in the direction it believed it had fixed.
    const probeNodes = SALVAGE_WALL_ATTEMPTS * EXACT_ATTEMPTS * SALVAGE_PROBE_NODES;
    check(
      `probing every wall costs less than proving one ` +
      `(${probeNodes} nodes vs a solve's ${NODE_BUDGET})`,
      probeNodes < NODE_BUDGET,
      `${SALVAGE_WALL_ATTEMPTS} walls x ${EXACT_ATTEMPTS} attempts x ${SALVAGE_PROBE_NODES} nodes`,
    );
    // And a smoke bound on top, kept deliberately loose. It is here to catch an
    // order-of-magnitude regression that the node arithmetic cannot see (a new
    // caller, a pathological profile generator), NOT to police tens of ms — so
    // it sits ~12x over what this workload measures rather than 1.5x, which is
    // the margin that made the first cut machine-dependent.
    check(`generating a salvage Contract stays bounded (worst ${worstMs}ms)`, worstMs < 1500);
  }

  // ---- The day's board is memoised -----------------------------------------
  //
  // Pure, and therefore assumed free — it is not: a board carrying a salvage
  // variant probes candidate walls against the tiling solver. Recomputing it per
  // render spent that on every repaint of a screen whose content cannot change.
  {
    const cold0 = Date.now();
    const first = dailyContracts(6, 20260102);
    const coldMs = Date.now() - cold0;
    const warm0 = Date.now();
    const again = dailyContracts(6, 20260102);
    const warmMs = Date.now() - warm0;
    check(`a repeat board render is free (cold ${coldMs}ms -> warm ${warmMs}ms)`, warmMs <= 2);
    check("the memoised board is the same board",
      JSON.stringify(first) === JSON.stringify(again));
    // Keyed on the inputs, so a rollover or a different Mark cannot be served a
    // stale table — the shared-daily promise depends on this.
    check("a different seed is a different board",
      JSON.stringify(dailyContracts(6, 20260103)) !== JSON.stringify(first));
    check("a different tier is a different board",
      JSON.stringify(dailyContracts(7, 20260102)) !== JSON.stringify(first));
  }

  // The salvage wall has to land on the SLOT GRID the line check reads, or the
  // bay opens with cubes that look settled and can never fill a slot.
  {
    const profile = [1, 0, 2, 1, 0, 2, 1, 1];
    const cubes = createStandingWall(Matter.Engine.create().world, profile);
    const onGrid = cubes.every((cu) => {
      const k = (WALL_INNER - CELL / 2 - cu.body.position.x) / CELL;
      const row = (WORLD.height - CELL / 2 - cu.body.position.y) / CELL;
      return Number.isInteger(k) && Number.isInteger(row) && k >= 0 && k < profile.length;
    });
    check(
      `a standing wall is exactly its profile (${cubes.length} cubes)`,
      cubes.length === profile.reduce((a, h) => a + h, 0),
    );
    check("every standing cube lands on the slot grid", onGrid);
    check("standing cubes are countable, settled and loose",
      cubes.every((cu) => cu.material === "standard" && cu.struck && cu.blinkStart === null));
  }

  // End to end: the bay's own zero-waste arithmetic has to COUNT the wall, or
  // objectiveUnreachable calls a perfectly winnable Part Load dead on frame one.
  {
    const ct = generateContract(20260101, 6, PATTERN_SLOT, "salvage");
    const g = new Game(levelForContract(ct, wallRng), {}, ct.seed);
    const wall = ct.standing.reduce((a, h) => a + h, 0);
    check("a salvage bay opens with its wall on the field", g.cubes.length === wall, `${g.cubes.length} vs ${wall}`);
    check(
      "a salvage bay is not born unwinnable",
      !g.objectiveUnreachable && g.cubesAvailable === g.cubesRequired,
      `${g.cubesAvailable} available vs ${g.cubesRequired} required`,
    );
    // A wall placed off-grid or overlapping would slump the moment physics ran.
    const before = g.cubes.map((cu) => ({ x: cu.body.position.x, y: cu.body.position.y }));
    for (let i = 0; i < 240; i++) g.update(i * 16.6667);
    const moved = g.cubes.filter((cu, i) =>
      before[i] && Math.hypot(cu.body.position.x - before[i].x, cu.body.position.y - before[i].y) > 1);
    check("the wall is already settled — 4s of physics does not move it", moved.length === 0,
      `${moved.length} cubes slumped`);
  }

  // --- Tier award ------------------------------------------------------------
  // Salvage moved from per-run/per-contract trickles to a single award on TIER
  // FLAT across tiers, deliberately — this used to assert the award RISES.
  // The slope was the whole surplus: +20/tier reached 240 a tier against a
  // shelf that does not grow, and after eight of the ten unlocks were retired
  // the ladder paid 1,500 against 325 of spendable stock. What has to hold now
  // is the opposite property — every tier pays the same, so a milestone is
  // always exactly one entry system and never drifts into pocket change.
  let payoutFlat = true;
  for (let t = 2; t <= 12; t++) {
    if (tierSalvage(t) !== tierSalvage(1)) payoutFlat = false;
  }
  check("tier award is flat across the ladder", payoutFlat);
  check("award clamps below tier 1", tierSalvage(0) === tierSalvage(1));

  // A Contract clear pays its MILESTONE SHARE and nothing more (see meta.ts's
  // tier milestone notes — the once-ever and at-tier rules are what keep the
  // re-timed trickle grind-proof). The full tier-1 award must still be
  // transformative: it has to fund at least two entry installs, or the tree's
  // on-ramp is out of reach of the player who just proved themselves against
  // a full tier.
  const cheapestInstall = Math.min(...INSTALLS.map((i) => i.cost));
  check(
    `the tier 1 award funds at least two entry installs (${TIER_SALVAGE_BASE} vs ${cheapestInstall}×2)`,
    TIER_SALVAGE_BASE >= cheapestInstall * 2,
  );
  // Requiring exactly the daily board is deliberate: "the 3 contracts" is one
  // day's board, so a tier is completable in a day of Contracts plus the run.
  check("a tier asks for one daily board of Contracts", TIER_CONTRACTS_REQUIRED === DAILY_COUNT);

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

  // What one clear banks NOW (the milestone share, not the old completion-only
  // award) is stated on the card that would bank it, as a value rather than
  // inside a sentence. It used to be a ~120-character status line above the
  // board — the same line whose earlier home, an eyebrow suffix, wrapped on a
  // landscape phone and dropped an orphaned salvage figure into the heading.
  const withProgress = contractsScreen({
    contracts: board, tier: 1, cleared: [], progress: tierProgressFor(newMeta()),
  });
  check(
    "the board quotes the per-clear milestone share",
    // Through salvageHTML rather than a literal: the figure is a drawn glyph
    // plus a number now (screens.ts's two currencies), and the point of the
    // check is that the card quotes the SALVAGE share — which a bare number
    // would no longer prove.
    withProgress.includes(`contract-card__state--pays">${salvageHTML(`+${tierMilestoneSalvage(1)}`)}<`),
  );
  check(
    "the eyebrow no longer carries the wrapping progress suffix",
    !withProgress.includes("both halves complete the tier for"),
  );
  // The tick is on the card, in words, not just in a class name — the border
  // recolour alone is a cue a player can miss on a board of three.
  check(
    "a cleared card says so on its face",
    ticked.includes(`contract-card__state--done">✓ Cleared<`),
  );
  // A cleared Contract stays replayable but pays nothing a second time, so it
  // must never keep advertising the payout beside the tick.
  check(
    "a cleared card drops the payout it can no longer bank",
    !contractsScreen({
      contracts: board, tier: 1, cleared: board.map((c) => c.id),
      progress: tierProgressFor(newMeta()),
    }).includes("contract-card__state--pays"),
  );
  // Past the tier's quota a first clear banks nothing (meta.ts pays for only
  // the first TIER_CONTRACTS_REQUIRED), and the board has to stop promising a
  // share it will not pay.
  const quotaMet = contractsScreen({
    contracts: board, tier: 1, cleared: [],
    progress: tierProgressFor({ ...newMeta(), tierContracts: TIER_CONTRACTS_REQUIRED }),
  });
  check(
    "a full quota reads as practice, not as a payout",
    quotaMet.includes(">Practice<") && !quotaMet.includes("contract-card__state--pays"),
  );
  // The board is three offers compared side by side, so it must not borrow the
  // How-to deck's horizontal snap row — that layout put cards 2 and 3 off-screen
  // behind a sideways scroll.
  check(
    "the board is its own block, not the how-to snap row",
    withProgress.includes("contracts__board") && !withProgress.includes("howto__grid"),
  );
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

  // The end-of-Contract modal is built from the ONE end-screen skeleton
  // (canvas A10): the run-end modal's own parts — stat-row, salvage-row, one
  // end__actions row — with the leaderboard geometry dropped via
  // .end--contract. Heights can only be checked in a browser (sim/uifit's
  // contract-end fixture); the shared parts' absence can be caught here.
  const endOpts = {
    name: "Exact Manifest", kind: "pattern" as const, lines: 4, goal: 4,
    launchesUsed: 8, launches: 0, queue: ["I", "O", "T"] as PieceType[],
    cubesWasted: 0, salvageTotal: 66,
    progress: { tier: 1, runDone: false, contracts: 1, needed: 3, award: 60, milestone: 15 },
  };
  const ceWin = contractEndModal({
    ...endOpts, won: true, award: { salvage: 60, firstClear: true, completedTier: null },
  });
  const ceLoss = contractEndModal({ ...endOpts, won: false, award: null });
  for (const [label, html] of [["win", ceWin], ["loss", ceLoss]] as const) {
    check(`the ${label} contract modal shares the end-screen skeleton`,
      html.includes("end--contract") && html.includes("stat-row") && html.includes("end__actions"));
    // The inline width is what pinned the panel to 460px inside a 792px
    // viewport — the whole reason it had no room to lay out sideways.
    check(`the ${label} modal takes its width from CSS, not an inline cap`,
      !html.includes("width:min(460px"));
    // B4: a decide-modal has no close ✕; B2: exactly one primary.
    check(`the ${label} modal keeps decide-modal discipline`,
      !html.includes('aria-label="Back"'));
    check(`the ${label} modal has exactly one primary action (B2)`,
      (html.match(/btn--primary/g) ?? []).length === 1);
  }
  check("only a won contract shows a payout row",
    ceWin.includes("salvage-row") && !ceLoss.includes("salvage-row"));
  // A10's "state the target": the payout names the price it is walking toward
  // when the caller knows one, and stays silent when it doesn't.
  const ceTarget = contractEndModal({
    ...endOpts, won: true,
    award: { salvage: 15, firstClear: true, completedTier: null },
    nextInstall: { name: "Reactor Output", cost: 15 },
  });
  check("the salvage row states the target price",
    ceTarget.includes(`Reactor Output costs ${salvageHTML(15)} in the Workshop`));
  check("no target price is invented without one", !ceWin.includes("in the Workshop"));
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
  run = advanceRun(run, 950, 800, 8, 26, ["cost"]);
  check("overshoot carries as funds", run.carry === 150, String(run.carry));
  // ...but only up to CARRY_CAP: an uncapped carry let one blowout bay bank
  // the next one outright (the "carry clears two levels" exploit), which
  // removed the puzzle from the deep run. Past the cap the excess is banked
  // nowhere — the reward for a blowout is the capped head start, not the bay.
  check("carry is capped at CARRY_CAP",
    advanceRun(run, 5000, 1000, 0, 0, []).carry === CARRY_CAP,
    String(advanceRun(run, 5000, 1000, 0, 0, []).carry));
  // Below the cap the overshoot carries EXACTLY, not the cap: the first
  // check above happens to land right at CARRY_CAP (950-800=150), so without
  // this a regression that banked the full cap for any positive overshoot
  // would pass both.
  check("a small overshoot carries itself, not the cap",
    advanceRun(run, 850, 800, 0, 0, []).carry === 50,
    String(advanceRun(run, 850, 800, 0, 0, []).carry));
  check("scrap accumulates", run.scrap === 26 && run.scrapEarned === 26);
  // Demolition recovery rides along as a run-long STAT. The default is 0, not
  // the running total: a caller that forgets the argument must under-report one
  // bay rather than re-count every bay before it, and the call above (which
  // omits it) is what proves the default is the harmless one.
  check("a bay that blew nothing up recovers nothing", run.salvagedFunds === 0,
    String(run.salvagedFunds));
  const demoA = advanceRun(run, 800, 800, 0, 0, [], run.bondCharges, 120);
  const demoB = advanceRun(demoA, 800, 800, 0, 0, [], demoA.bondCharges, 45);
  check("demolition recovery accumulates across bays", demoB.salvagedFunds === 165,
    String(demoB.salvagedFunds));
  // It is a readout, never operating cash: the refund already landed in the
  // bay's score when the charge blew, so carrying it into the next bay's float
  // would pay the player for the same blast twice.
  check("demolition recovery never leaks into the carried float", demoA.carry === 0,
    String(demoA.carry));
  check("the ratcheted axis is recorded", run.ratchets.cost === 1);
  check("levelIndex advanced", run.levelIndex === 1);
  // The capstone hands two axes at once, and the same axis twice is a legal
  // (and grim) pick — so the ratchet counts rather than collecting ids.
  const twice = advanceRun(run, 800, 800, 0, 0, ["cost", "time"]);
  check("a second notch on an axis stacks rather than replacing",
    twice.ratchets.cost === 2 && twice.ratchets.time === 1);
  check("advanceRun never mutates the run's ratchets", run.ratchets.cost === 1);

  // ---- The Bond Breaker magazine: rare, consumable, run-scoped ------------
  // This is the mechanic the "one carry clears two bays" exploit was built on.
  // The charges used to be REDERIVED every bay (applyUpgrades wrote them onto
  // a fresh base each level), which silently refilled the magazine at every
  // bay boundary — so "flatten the entire field into loose cubes" was a free
  // action once per level. It is a run-long consumable now, and every claim in
  // that sentence is checked here.
  {
    const emitter = { ...newTiers(), bonds: 2 };
    let br = newRun(7, [], 0, emitter, 1);
    check("the emitter's tier is the run's whole magazine",
      br.bondCharges === bondChargesFor(2) && br.bondCharges === 2, String(br.bondCharges));
    check("a stock ship carries no charges", newRun(7).bondCharges === 0);
    check("bay 1 opens with the full magazine",
      levelForRun(br).bondBreakerCharges === 2);

    // Spend one in bay 1: bay 2 opens with what is LEFT, not with a refill.
    br = advanceRun(br, 900, 800, 8, 10, [], 1);
    check("a spent charge stays spent into the next bay",
      br.bondCharges === 1 && levelForRun(br).bondBreakerCharges === 1,
      `${br.bondCharges} left, cfg says ${levelForRun(br).bondBreakerCharges}`);
    // Spend the last one: the magazine is empty for the rest of the run, and
    // the config must say so rather than quietly re-granting the tier.
    br = advanceRun(br, 900, 800, 8, 10, [], 0);
    check("an emptied magazine stays empty for the rest of the run",
      br.bondCharges === 0 && levelForRun(br).bondBreakerCharges === 0);
    check("applyUpgrades alone would still have re-granted them — levelForRun is what stops it",
      (() => { const c = makeBaseLevel(br.levelIndex, 1); applyUpgrades(c, br.tiers); return c.bondBreakerCharges === 2; })());

    // A bay cannot hand back more than it was issued.
    check("a bay cannot return more charges than it was issued",
      advanceRun({ ...br, bondCharges: 1 }, 900, 800, 0, 0, [], 99).bondCharges === 1);
    // ...and a caller that forgets the argument must not confiscate the stock.
    check("omitting the ending stock leaves the magazine untouched",
      advanceRun({ ...br, bondCharges: 2 }, 900, 800, 0, 0, []).bondCharges === 2);

    // A refit issues the DELTA between tiers, never a refill of what was spent.
    const spent = { ...newRun(7, [], 500, { ...newTiers(), bonds: 1 }, 1), bondCharges: 0 };
    const refit = buyUpgrade(spent, "bonds", 10, MAX_TIER)!;
    check("refitting the emitter issues only the tier's extra charge",
      refit.tiers.bonds === 2 && refit.bondCharges === 1, String(refit.bondCharges));
    check("refitting another system leaves the magazine alone",
      buyUpgrade({ ...spent, tiers: { ...spent.tiers, bay: 1 }, bondCharges: 1 }, "bay", 10, MAX_TIER)!
        .bondCharges === 1);
  }
  // A ratcheted run must actually play harder than a clean one at the same bay.
  const clean = levelForRun({ ...run, ratchets: {} });
  const notched = levelForRun({ ...run, ratchets: { target: 1, cost: 1, time: 1 } });
  check("a ratcheted bay demands more than a clean one",
    notched.targetScore > clean.targetScore
      && notched.launchCost > clean.launchCost
      && notched.timeLimitSec < clean.timeLimitSec);

  // Ending at/under target carries no debt.
  check("no debt carries", advanceRun(run, 500, 800, 0, 0, []).carry === 0);

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

  // Upgrades apply BEFORE ratchets, and that ordering carries the design's
  // central claim: a system does not delete a hazard, it makes one specific
  // hazard cheap for you. The ship's numbers have to already be in the config
  // when the notch lands on top of them, or a notch would be answering a stock
  // rig no matter what the player installed.
  const withShip = levelForRun({
    ...newRun(7),
    levelIndex: 0,
    tiers: { ...newTiers(), launcher: 2 },
    ratchets: { wind: 2 },
  });
  const shipOnly = levelForRun({
    ...newRun(7), levelIndex: 0, tiers: { ...newTiers(), launcher: 2 }, ratchets: {},
  });
  check("a notch lands on top of the refitted ship, not a stock one",
    withShip.windMax > shipOnly.windMax && withShip.launchPower === shipOnly.launchPower,
    `${withShip.windMax} vs ${shipOnly.windMax}`);
}

// ---------------------------------------------------------------------------
section("Bay-clear ratchet: toggle + next-bay projection (hazards.ts, preview.ts)");
// ---------------------------------------------------------------------------
{
  // The draft SELECTS before it commits, so the hand has to behave like a hand:
  // every tap moves it, and any hand is reachable without a reset button.
  check("a tap selects", JSON.stringify(togglePick([], "cost", 1)) === '["cost"]');
  check("a second tap on the same axis takes it back",
    togglePick(["cost"], "cost", 1).length === 0);
  check("at one pick, another card SWITCHES rather than stacking",
    JSON.stringify(togglePick(["cost"], "time", 1)) === '["time"]');
  check("at two picks, a second axis is added",
    JSON.stringify(togglePick(["cost"], "time", 2)) === '["cost","time"]');
  // The capstone's double notch: with room left in the hand, a second tap on
  // the same card asks for the axis twice rather than taking it back.
  check("at two picks, the same axis stacks to a double notch",
    JSON.stringify(togglePick(["cost"], "cost", 2)) === '["cost","cost"]');
  check("once the hand is full, a tap on a selected card takes one back",
    JSON.stringify(togglePick(["cost", "time"], "cost", 2)) === '["time"]');
  check("a stacked axis un-stacks one notch at a time",
    JSON.stringify(togglePick(["cost", "cost"], "cost", 2)) === '["cost"]');
  // A,B,A must fall back to A,B — dropping the FIRST A would reorder the hand
  // under the player between two taps that both said "cost".
  check("un-picking drops the last notch of that axis, not the first",
    JSON.stringify(togglePick(["cost", "time", "cost"], "cost", 3)) === '["cost","time"]');
  check("a full hand still moves when a new card is tapped",
    JSON.stringify(togglePick(["cost", "time"], "wind", 2)) === '["time","wind"]');
  check("togglePick never mutates the hand it was given", (() => {
    const hand: HazardId[] = ["cost"];
    togglePick(hand, "time", 2);
    return hand.length === 1;
  })());

  // The projection is drawn from levelForRun on both sides — the same call the
  // bay is actually built with — so what the modal promises is what gets flown.
  const drafting = { ...newRun(11, [], 500, newTiers(), 3), levelIndex: 3 };
  const rowsFor = (picks: HazardId[]): PreviewRow[] => previewRows(
    levelForRun(drafting),
    levelForRun({
      ...drafting,
      ratchets: picks.reduce<Ratchets>((r, id) => ({ ...r, [id]: (r[id] ?? 0) + 1 }), { ...drafting.ratchets }),
    }),
  );
  const row = (rows: PreviewRow[], id: string): PreviewRow | undefined => rows.find((r) => r.id === id);

  const idle = rowsFor([]);
  // The compact grid drops unmoved CONTEXT rows and keeps the priced five (see
  // app.css's [data-density="compact"] rule). That only holds if every always-on
  // row is tagged core and everything else context.
  // The compact grid is four tiles across a phone's projection column, so every
  // row needs a label that survives ~63px. The long ones do not, which is what
  // `short` is for — and a short label that isn't shorter is a row that will
  // ellipsise to a single letter in the dense grid.
  check("every row carries a dense-grid label that fits one",
    idle.every((r) => r.short.length > 0 && r.short.length <= r.label.length && r.short.length <= 11),
    idle.filter((r) => r.short.length > 11 || r.short.length > r.label.length).map((r) => r.short).join(","));
  check("the priced numbers are the core rows, and nothing else is",
    idle.filter((r) => r.kind === "core").map((r) => r.id).join(",") === "target,float,cost,shots,clock",
    idle.filter((r) => r.kind === "core").map((r) => r.id).join(","));
  check("an empty selection changes nothing", idle.every((r) => !r.changed && r.tone === "same"));
  // The four numbers a bay is priced by are the frame the change is read
  // against, so they are on screen before anything is picked.
  check("the priced numbers are always on screen",
    ["target", "float", "cost", "shots", "clock"].every((id) => row(idle, id) !== undefined),
    idle.map((r) => r.id).join(","));

  const levy = rowsFor(["cost"]);
  check("Fuel Levy moves the launch cost", row(levy, "cost")!.changed);
  check("a dearer launch reads as worse", row(levy, "cost")!.tone === "worse");
  check("the levy's real cost — fewer shots in the bank — is projected",
    row(levy, "shots")!.changed && row(levy, "shots")!.tone === "worse",
    `${row(levy, "shots")!.from} -> ${row(levy, "shots")!.to}`);
  check("an untouched number stays quiet", !row(levy, "clock")!.changed);
  check("the projection matches the config the bay is built from",
    row(levy, "cost")!.to === `$${levelForRun({ ...drafting, ratchets: { cost: 1 } }).launchCost}`);

  const shift = rowsFor(["time"]);
  check("Shift Cut shortens the clock", row(shift, "clock")!.changed);
  // A shorter clock is a SMALLER number and still bad news; a projection that
  // colours by direction alone would call it an improvement.
  check("a shorter clock still reads as worse", row(shift, "clock")!.tone === "worse");

  // Axes that are not in play stay off the grid until a pick touches them —
  // the grid is a landscape phone's worth of space, and a row that never moves
  // is a row that buries the one that did.
  check("a dormant axis is hidden until it is picked", row(idle, "sweeper") === undefined);
  const sweep = rowsFor(["sweeper"]);
  check("picking the sweeper reveals both halves of its notch",
    row(sweep, "sweeper")!.changed && row(sweep, "cells")!.changed);
  check("the press gap closing reads as worse", row(sweep, "cells")!.tone === "worse");
  check("a material appears on the belt only once its axis is picked",
    row(idle, "mat:cryo") === undefined && row(rowsFor(["cryo"]), "mat:cryo")!.changed);

  // Two notches at Mark 10 project as one bay, not as two separate promises.
  const both = rowsFor(["cost", "time"]);
  check("a two-pick hand projects both notches at once",
    row(both, "cost")!.changed && row(both, "clock")!.changed);
  check("a stacked axis projects the stacked number",
    row(rowsFor(["cost", "cost"]), "cost")!.to
      === `$${levelForRun({ ...drafting, ratchets: { cost: 2 } }).launchCost}`);

  // Codex #1 (canvas A12): a BANKED axis is live pressure on the next bay
  // whatever the current selection touches. Its rows stay on the projection,
  // flagged active and promoted to core — the compact grid drops context rows,
  // and a live pressure must never be one of those.
  const banked = { ...drafting, ratchets: { sweeper: 1 } as Ratchets };
  const bankedRows = previewRows(levelForRun(banked), levelForRun(banked), banked.ratchets);
  check("a banked sweeper stays on the projection with nothing selected",
    row(bankedRows, "sweeper") !== undefined && row(bankedRows, "cells") !== undefined,
    bankedRows.map((r) => r.id).join(","));
  check("a banked axis's rows are active and core",
    bankedRows.filter((r) => r.id === "sweeper" || r.id === "cells")
      .every((r) => r.active && r.kind === "core"));
  check("without banked notches nothing is active", rowsFor([]).every((r) => !r.active));
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
  // LIVE stock only. This counted every UNLOCKS row including the eight marked
  // retired, which is how a 1,500-salvage ladder came to look balanced against
  // a "1,600-salvage tree" that the player could not actually buy: 1,270 of
  // that total does nothing and is never listed. Counting what ships is the
  // point of the assertion.
  const liveUnlocks = UNLOCKS.filter((u) => !u.retired);
  const total = liveUnlocks.reduce((a, u) => a + u.cost, 0)
    + INSTALLS.reduce((a, i) => a + i.cost, 0);
  check(`the shelf costs ${total} salvage`, total === 445, String(total));
  // Rank is what the Workshop groups by, and it promises rising price. A rank-2
  // unlock cheaper than a rank-1 would sort into a band it undercuts.
  const maxOf = (r: number) => Math.max(...liveUnlocks.filter((u) => u.rank === r).map((u) => u.cost));
  const minOf = (r: number) => Math.min(...liveUnlocks.filter((u) => u.rank === r).map((u) => u.cost));
  check("rank 2 is dearer than rank 1", minOf(2) > maxOf(1));
  check("rank 3 is dearer than rank 2", minOf(3) > maxOf(2));
  check("only rank 3 carries a Mark gate", markGated.every((u) => u.rank === 3));
  // Rank 1 is the on-ramp: the first tier completion must cover the cheapest
  // unlock outright, or the first award reads as a down payment rather than a
  // purchase — the same "first option is transformative" rule the installs
  // section asserts against TIER_SALVAGE_BASE.
  check(
    `the cheapest unlock fits inside the tier-1 award (${minOf(1)} vs ${tierSalvage(1)})`,
    minOf(1) <= tierSalvage(1),
  );
  // And the FULL ladder must roughly pay for the full tree — the tree may not
  // finish ahead of the exam, but it must finish: a tree the ladder cannot
  // afford would make the last unlocks purely theoretical.
  const ladderTotal = Array.from({ length: MARK_COUNT }, (_, i) => tierSalvage(i + 1))
    .reduce((a, b) => a + b, 0);
  // Income against LIVE stock, with a ceiling that actually bites. The old
  // bound allowed 1.3x and was measured against retired merchandise, so a
  // 4.6x real oversupply passed it. Between 1.0x and 1.6x: the ladder must
  // finish the shelf (or the last systems are theoretical) without paying for
  // it several times over (or salvage stops being a decision).
  check(
    `the ten-tier ladder (${ladderTotal}) covers the ${total}-salvage shelf without flooding it`,
    ladderTotal >= total && ladderTotal <= total * 1.6,
    `${(ladderTotal / total).toFixed(2)}x`,
  );
}

// ---------------------------------------------------------------------------
section("Tier milestones pay the salvage (meta.ts)");
// ---------------------------------------------------------------------------
{
  const board = (tier: number) =>
    Array.from({ length: TIER_CONTRACTS_REQUIRED }, (_, i) => ({ id: `t${tier}-c${i}`, tier }));
  const share = tierMilestoneSalvage(1);

  // The on-ramp the milestone re-timing exists for: ONE at-tier Contract must
  // fund the cheapest entry install (the Reactor), or the loop has no entry
  // point — see meta.ts's tier milestone notes for the deadlock this fixes.
  const cheapest = Math.min(...INSTALLS.map((i) => i.cost));
  check(
    `one tier-1 milestone funds the cheapest install (${share} vs ${cheapest})`,
    share >= cheapest,
  );

  // Each half pays its share the moment it lands — but completes nothing alone.
  const runOnly = recordRunEnd(newMeta(), 1, true, 10);
  check("a won run alone completes no tier", runOnly.completedTier === null);
  check("the run half is recorded", runOnly.meta.tierRunDone);
  check(
    "a first at-tier win banks its milestone share",
    runOnly.salvage === share && runOnly.meta.salvage === share,
  );

  let contractsOnly = { meta: newMeta(), completedTier: null as number | null, salvage: 0 };
  for (const c of board(1)) {
    const r = recordContractClear(contractsOnly.meta, c);
    check(`an at-tier first clear banks its share (${r.salvage})`, r.salvage === share);
    contractsOnly = r;
  }
  check("a full board alone completes no tier", contractsOnly.completedTier === null);
  check(
    "the contract half is recorded",
    contractsOnly.meta.tierContracts === TIER_CONTRACTS_REQUIRED,
  );
  check(
    "a fourth at-tier clear ticks and pays nothing",
    (() => {
      const extra = recordContractClear(contractsOnly.meta, { id: "t1-extra", tier: 1 });
      return extra.firstClear && extra.salvage === 0 &&
        extra.meta.tierContracts === TIER_CONTRACTS_REQUIRED;
    })(),
  );

  // Both halves together: the tier completes, the Mark rises, and the TOTAL
  // banked across all milestones + the completion remainder is exactly the
  // tier award — the re-timing must never grow the ladder's payout.
  const both = recordRunEnd(contractsOnly.meta, 1, true, 10);
  check("run + contracts completes tier 1", both.completedTier === 1);
  check(
    "a tier pays exactly its award across all milestones",
    both.meta.salvage === tierSalvage(1),
  );
  check("completion raises the Mark", both.meta.mark === 1 && markUnlocked(both.meta) === 2);
  check("completion resets both halves", !both.meta.tierRunDone && both.meta.tierContracts === 0);

  let other = recordRunEnd(newMeta(), 1, true, 10).meta;
  let last: number | null = null;
  for (const c of board(1)) {
    const r = recordContractClear(other, c);
    other = r.meta; last = r.completedTier;
  }
  check("the completing event can be a Contract", last === 1);
  check("the tier total is order-independent", other.salvage === tierSalvage(1));

  // What does NOT count: a duplicate Contract id, a Contract from another
  // tier, a lost run, and a won run flown at a Mark below the current tier.
  const dup = recordContractClear(both.meta, { id: "t1-c0", tier: 2 });
  check(
    "a replayed Contract counts nothing",
    !dup.firstClear && dup.meta.tierContracts === 0 && dup.salvage === 0,
  );
  const offTier = recordContractClear(both.meta, { id: "elsewhere", tier: 9 });
  check(
    "an off-tier Contract logs but ticks and pays nothing",
    offTier.firstClear && offTier.meta.tierContracts === 0 && offTier.salvage === 0,
  );
  const lost = recordRunEnd(newMeta(), 1, false, 4);
  check("a lost run ticks nothing", !lost.meta.tierRunDone && lost.meta.salvage === 0);
  check("a lost run still counts as a run", lost.meta.runs === 1 && lost.meta.bestBay === 4);
  const stale = recordRunEnd(both.meta, 1, true, 10);
  check(
    "beating an old Mark ticks and pays nothing",
    !stale.meta.tierRunDone && stale.salvage === 0,
  );
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
  // threw 34 lost CUBES from 32 shots (1.06 per shot vs a 0.11 baseline; not
  // the "106%" this was long written as — lostTotal counts cubes) at 16 shots
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
  // 0.234 cubes lost to the wrong side per shot against a 0.103 baseline.
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
  // cycle and require the recorded phases to actually differ. The config is
  // deliberately over-funded and over-quota'd: this section measures
  // compactor-phase recording, not the bay economy — and the real bay-1 float
  // ($200 at $25/launch toward an $800 target) would WIN the bay mid-test (a
  // settling bay refuses new shots) before both stroke directions were seen.
  const seen: { phase: number; dir: number; stroke: number; live: number }[] = [];
  const gs = new Game({ ...makeBaseLevel(0), startingFunds: 100_000, targetScore: 10_000_000 }, {
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
  // The solver's worst case: a fully drafted run's rail (see railSlotsFor).
  setRailSlots(RAIL_SLOTS_MAX);
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
    // The rail's buttons are the game's PRIMARY touch controls, and a flex
    // column will happily shrink them past the tap floor to make a stack fit.
    // The solver has to hand back a size whose whole column actually stacks —
    // it did not, and the buttons came out at 46px on a Pixel 7.
    check(`${name} rail buttons meet the tap floor`, l.railSize >= RAIL_MIN, `${l.railSize.toFixed(1)}px`);
    if (l.mode !== "tall") {
      const uh = h - l.safe.top - l.safe.bottom;
      const stack = getRailSlots() * l.railSize + (getRailSlots() - 1) * RAIL_GAP;
      check(`${name} fits all ${getRailSlots()} rail buttons in its column`, stack <= uh, `${stack.toFixed(0)}px stack in ${uh}px`);
    }
  }

  // Safe areas must actually push the field off the notch.
  const plain = computeLayout(2400, 1080);
  setSafeAreaInsets({ left: 60, right: 0, top: 0, bottom: 20 });
  const notched = computeLayout(2400, 1080);
  check("a left notch shifts the field right", notched.ox > plain.ox, `${notched.ox} vs ${plain.ox}`);
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });
}

// ---------------------------------------------------------------------------
section("Rail slot budget (layout.ts railSlotsFor / setRailSlots)");
// The regression this guards: a fixed worst-case budget (8 slots, counting the
// aim-state cancel) needs a 410px column at the 44px floor, which priced the
// vertical rail off every 360dp-tall landscape phone — the most common Android
// class got the bottom strip and a ~19% smaller field, for buttons that were
// not on screen. The budget is now the loadout the run actually has, and the
// cancel ✕ swaps into the pause slot instead of owning one (app.css).
{
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });

  // B5: no emoji or dingbat in a CONTROL — an emoji is platform-drawn art
  // that can't take the accent colour and wobbles the button metrics. The
  // rail, the plant's ability chips and every buy/close button carry inline
  // SVG now — and so do both currencies, which used to share the ♻ character
  // between scrap and salvage and now have a glyph each (icons.ts). The
  // remaining flavour glyphs (the belt's 💣 tile, the leaderboard medals) are
  // copy and stay.
  {
    const hud = hudHTML({
      beltPreview: { bomb: false, type: "T", quarterTurns: 0, empty: false, hidden: false, material: "standard" },
      loaded: { bomb: false, type: "L", quarterTurns: 1, empty: false, hidden: false, material: "standard" },
      tier: 2,
      target: 800, score: 200, launchCost: 25, bayNum: 1, timeLimitSec: 150,
      timeLeftMs: 150_000, pieceSize: "std",
      bondBreakerOwned: true, bondCharges: 1, demoOwned: true, bombCharges: 2,
      autoloaderOwned: true, ratchets: {}, tiers: newTiers(), contract: null,
    });
    const rail = hud.slice(hud.indexOf('class="side-rail"'), hud.indexOf('class="bay-banner"'));
    check("no emoji or dingbat survives in a rail control (B5)",
      !/[⛶⏸⟲⟳✕⚡💥↻▶★♻]/u.test(rail), rail.match(/[⛶⏸⟲⟳✕⚡💥↻▶★♻]/u)?.[0] ?? "");
    check("the rail's controls are drawn as inline SVG",
      (rail.match(/<svg/g) ?? []).length >= 7, String((rail.match(/<svg/g) ?? []).length));
    // A4: the run's tier rides the bay banner as the plate's banner size;
    // A5: the transport carries both queue slots and the shipment-class tag.
    check("the bay banner carries the tier plate", hud.includes("tier-plate--banner"));
    check("the transport renders the two-deep queue and its size tag",
      hud.includes('id="hud-loaded"') && hud.includes('id="hud-next"') && hud.includes('class="belt__tag"'));
  }

  check("a bare rail is the four base buttons",
    railSlotsFor({ bond: false, demo: false, auto: false }) === RAIL_SLOTS_BASE);
  check("each drafted ability adds exactly one slot",
    railSlotsFor({ bond: true, demo: false, auto: false }) === 5 &&
    railSlotsFor({ bond: true, demo: true, auto: false }) === 6 &&
    railSlotsFor({ bond: true, demo: true, auto: true }) === RAIL_SLOTS_MAX);
  check("fine pointers budget only fullscreen + pause",
    railSlotsFor({ bond: true, demo: true, auto: true, finePointer: true }) === 2);
  check("the budget clamps to the seven-slot worst case",
    (setRailSlots(9), getRailSlots() === RAIL_SLOTS_MAX));
  check("the budget clamps above the fine-pointer floor",
    (setRailSlots(0), getRailSlots() === 2));

  // The reported device: a 360dp-tall Android phone (2376x1080 @3x) in
  // fullscreen Chrome. It must keep the vertical side rail at every loadout —
  // at the full seven-slot draft the column fits its 360px exactly
  // (7x44 + 6x6 + 16 = 360).
  for (const slots of [RAIL_SLOTS_BASE, 5, 6, RAIL_SLOTS_MAX]) {
    setRailSlots(slots);
    const l = computeLayout(792, 360);
    check(`792x360 keeps the side rail with ${slots} buttons`, l.mode === "wide", l.mode);
  }

  // A 16:9 phone has no natural gutter: the solver must still prefer the
  // reserved RIGHT band (vertical rail) over the bottom strip while the
  // column fits...
  setRailSlots(RAIL_SLOTS_MAX);
  check("640x360 reserves a right band, not the bottom", computeLayout(640, 360).mode === "snug",
    computeLayout(640, 360).mode);
  // ...and fall back to the bottom strip only when it genuinely cannot
  // (7x44 + gaps = 360 > 320).
  check("640x320 falls back to the bottom strip at a full draft",
    computeLayout(640, 320).mode === "tall", computeLayout(640, 320).mode);
  setRailSlots(RAIL_SLOTS_BASE);
  check("640x320 keeps a vertical rail with the base buttons",
    computeLayout(640, 320).mode !== "tall", computeLayout(640, 320).mode);

  // The budget must never move the field mid-aim: the cancel swap keeps the
  // slot count constant, so the same viewport at the same budget is the same
  // layout — aiming state is invisible to the solver by construction.
  setRailSlots(RAIL_SLOTS_MAX);
}

// ---------------------------------------------------------------------------
section("Input bindings + the one hint table (bindings.ts — canvas D1/D2)");
// ---------------------------------------------------------------------------
{
  resetKeyBindings();
  resetPadBindings();
  check("every action has a key and a pad button",
    BINDABLE_ACTIONS.every((a) => typeof keyFor(a) === "string" && Number.isInteger(padFor(a))));
  check("no two actions share a key",
    new Set(BINDABLE_ACTIONS.map(keyFor)).size === BINDABLE_ACTIONS.length);
  check("actionForKey inverts keyFor",
    BINDABLE_ACTIONS.every((a) => actionForKey(keyFor(a)) === a));

  // A conflicting rebind SWAPS rather than steals — every action stays
  // reachable through any sequence of rebinds.
  setKeyBinding("fire", "q");
  check("a conflicting key rebind swaps, never strands",
    keyFor("fire") === "q" && keyFor("rotl") === " " &&
      new Set(BINDABLE_ACTIONS.map(keyFor)).size === BINDABLE_ACTIONS.length);
  resetKeyBindings();
  check("reset restores the keyboard defaults", keyFor("fire") === " " && keyFor("rotl") === "q");
  setPadBinding("bond", 5);
  check("a conflicting pad rebind swaps the same way",
    padFor("bond") === 5 && padFor("rotr") === 2);
  resetPadBindings();

  // D2: one hint, three renderings — and the keyboard rendering can never
  // tell the player to tap a rail button `pointer: fine` hides, which is the
  // shipping bug this table exists to make unwritable.
  check("the rotate hint renders per input family",
    hintRotate("touch").includes("⟲") && hintRotate("keyboard").includes("Q") &&
      hintRotate("gamepad").includes("LB"));
  check("the keyboard hint never points at the touch rail",
    !hintRotate("keyboard").includes("⟲"));
  const desktopCoach = coachSteps(makeBaseLevel(0), "keyboard");
  check("the desktop coach teaches keys, not hidden buttons",
    !desktopCoach[1].body.includes("⟲") && desktopCoach[1].body.includes("Q"));
  check("the gamepad coach teaches the pad",
    coachSteps(makeBaseLevel(0), "gamepad")[1].body.includes("LB"));
  check("the touch coach still points at the rail",
    coachSteps(makeBaseLevel(0))[1].body.includes("⟲"));

  // D1: the Controls screen renders every binding as a rebindable row, says
  // when it is capturing, and reports an absent pad as absent — not broken.
  const ctrlSettings = {
    sound: true, music: true, haptics: true, seenDragHint: true, seenTutorial: true,
    leftHandRail: false, stickAssist: true,
  };
  const kb = controlsScreen({ tab: "keyboard", settings: ctrlSettings, padName: null, rebinding: null });
  check("every action is a rebindable row",
    BINDABLE_ACTIONS.every((a) => kb.includes(`data-bind="${a}"`)));
  check("a capturing row says so",
    controlsScreen({ tab: "keyboard", settings: ctrlSettings, padName: null, rebinding: "fire" })
      .includes("Press a key…"));
  const padPane = controlsScreen({ tab: "gamepad", settings: ctrlSettings, padName: null, rebinding: null });
  check("an absent gamepad reads as absent, not broken", padPane.includes("No gamepad"));
  check("the touch tab carries the left-hand rail toggle",
    controlsScreen({ tab: "touch", settings: ctrlSettings, padName: null, rebinding: null })
      .includes('data-toggle="leftHandRail"'));
  check("the gamepad tab carries the stick-assist toggle",
    padPane.includes('data-toggle="stickAssist"'));

  // The left-handed mirror is solver state, not just CSS: snug mode reserves
  // its band on the rail's side, so the field shifts the other way.
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });
  setRailSlots(4);
  setRailSide("left");
  const mirrored = computeLayout(800, 450);
  setRailSide("right");
  const standard = computeLayout(800, 450);
  if (standard.mode === "snug") {
    check("a left-handed snug layout reserves its band on the left",
      mirrored.reserve.left > 0 && mirrored.reserve.right === 0 && mirrored.ox > standard.ox,
      `${mirrored.reserve.left}/${mirrored.reserve.right} ox ${mirrored.ox} vs ${standard.ox}`);
  } else {
    check("mirroring never changes the field's size", mirrored.fw === standard.fw);
  }
  setRailSlots(RAIL_SLOTS_MAX);
}

// ---------------------------------------------------------------------------
section("Chrome scale (layout.ts uiScaleFor / data-density)");
// The DOM chrome's counterpart to the field's --fpx. These are the invariants
// the 15 hand-tuned `max-height` blocks in app.css never had: monotonic, bounded
// and, above all, aware of the safe-area insets a media query cannot see.
{
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });

  check("a desktop viewport is never scaled", computeLayout(1600, 900).uiScale === 1);
  check("a desktop viewport is roomy", computeLayout(1600, 900).density === "roomy");

  // Every landscape phone in the device matrix lands on the floor. That is the
  // finding, not a rounding artifact: below it the answer has to be a
  // structural change, which is what `compact` exists to trigger.
  for (const [name, w, h] of [
    ["640x360 budget", 640, 360],
    ["OnePlus 12", 792, 360],
    ["Pixel 7", 915, 412],
    ["iPhone SE 3", 667, 375],
  ] as [string, number, number][]) {
    const l = computeLayout(w, h);
    check(`${name} bottoms out at the scale floor`, l.uiScale === UI_SCALE_MIN, String(l.uiScale));
    check(`${name} is compact`, l.density === "compact", l.density);
  }

  // Monotonic in both axes — a bigger viewport can never scale the chrome down.
  let prev = 0;
  for (const h of [360, 420, 480, 540, 600, 660, 720, 900]) {
    const s = computeLayout(1600, h).uiScale;
    check(`ui scale is monotonic at ${h}px tall`, s >= prev, `${s} < ${prev}`);
    prev = s;
  }

  check("ui scale never exceeds 1", computeLayout(4000, 3000).uiScale === 1);
  check("ui scale never drops below the floor", computeLayout(320, 200).uiScale === UI_SCALE_MIN);

  // The reason this is solved in JS at all: a media query cannot subtract the
  // notch. An iPhone's landscape insets take ~120px of width and 21px of height,
  // and the chrome has to answer to the box that is actually left.
  const bare = computeLayout(1100, 760);
  setSafeAreaInsets({ left: 62, right: 62, top: 0, bottom: 21 });
  const inset = computeLayout(1100, 760);
  check(
    "safe-area insets shrink the chrome scale",
    inset.uiScale < bare.uiScale,
    `${inset.uiScale} vs ${bare.uiScale}`,
  );
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });

  // Density tiers must partition the scale range with no gap and no overlap —
  // at full width, where the HEIGHT term is the binding axis. (Width may
  // bottom the scale out without forcing compact; see the check below.)
  for (const h of [300, 400, 500, 560, 620, 680, 720, 800]) {
    const l = computeLayout(1600, h);
    const expected =
      l.uiScale === 1 ? "roomy" : l.uiScale === UI_SCALE_MIN ? "compact" : "regular";
    check(`density agrees with scale at ${h}px tall`, l.density === expected, `${l.density} vs ${expected} (${l.uiScale})`);
  }

  // Compact is a HEIGHT verdict. The compact rules RESTRUCTURE — they drop
  // rows, chips and context tiles measured against 360px-tall phones — and a
  // narrow-but-tall desktop window still has the height those rules exist to
  // buy back. The scale may bottom out on the width term; the restructure may
  // not fire on it.
  const narrow = computeLayout(700, 720);
  check("a narrow-but-tall window bottoms the scale without going compact",
    narrow.uiScale === UI_SCALE_MIN && narrow.density === "regular",
    `${narrow.uiScale} / ${narrow.density}`);
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
  // COMPACT overrides (app.css's [data-density="compact"] plant rules). At the
  // scale floor the funds figure steps down a notch and the tier-2 labels leave
  // the pixel face for Rajdhani — which is the whole point of those rules, so
  // the budget has to model them or it prices a layout that no phone renders.
  const C_FUNDS_FS_MIN = 15, C_FUNDS_FS_FPX = 34;
  const C_STAT_LBL_MIN = 8, C_STAT_LBL_FPX = 12;
  /** Rajdhani's advance, vs the pixel face's 1.45em — this ratio is exactly why
   *  an 8-glyph heading fits a phone column in one face and not the other. */
  const UI_ADV = 0.45;

  /** Width the funds line needs vs. the width its column actually gets. */
  function fundsBudget(viewportW: number, viewportH: number, funds: number, target: number) {
    const l = computeLayout(viewportW, viewportH);
    const fpx = l.fw / 1280;
    const mx = (min: number, scaled: number) => Math.max(min, scaled * fpx);

    const compact = l.density === "compact";
    const content = PANEL_W_FRAC * l.fw - 2 * PANEL_PAD_FPX * fpx;
    const fundsFs = compact
      ? mx(C_FUNDS_FS_MIN, C_FUNDS_FS_FPX)
      : mx(FUNDS_FS_MIN, FUNDS_FS_FPX);
    const statLbl = compact
      ? mx(C_STAT_LBL_MIN, C_STAT_LBL_FPX)
      : mx(STAT_LBL_MIN, STAT_LBL_FPX);
    const lblAdv = compact ? UI_ADV : PIXEL_ADV;
    const statVal = mx(STAT_VAL_MIN, STAT_VAL_FPX);
    const statPad = mx(STAT_PAD_MIN, STAT_PAD_FPX);

    // Each stat column is as wide as the WIDER of its pixel-font label and its
    // mono value — the label is what dominates at small scales, and missing that
    // is what made the original budget wrong.
    const col = (label: string, value: string) =>
      Math.max(label.length * lblAdv * statLbl, value.length * MONO_ADV * statVal) + statPad;
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
  // bay-10's target is 800 + TARGET_PER_BAY*9 = 1700, and a Reactor+carry run
  // can carry 5 figures.
  const CASES: [number, number][] = [[250, 800], [1259, 1700], [9999, 1700], [24680, 1700]];

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
  // ---- The RATCHET, not a schedule ----------------------------------------
  // Materials used to arrive on a per-Mark, per-bay probability ramp. They do
  // not any more: a material appears only when the player ratchets its axis, so
  // every check that asserted a schedule now asserts that there ISN'T one.

  // The strongest statement the new model makes: no bay, at any Mark, at any
  // depth, carries a material the player did not ask for. This is the check
  // that would have caught the original bug from the other side — a material
  // the ladder inflicts on someone who owns no answer to it.
  const everyBayEveryMark = Array.from({ length: MARK_COUNT }, (_, m) =>
    Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, m + 1))).flat();
  check("no bay carries a material unless it was ratcheted",
    everyBayEveryMark.every((cfg) =>
      Object.values(cfg.materialMix).every((v) => v === 0)));

  // The three base economies: the target climbs every bay on its own (that
  // ramp IS the ladder's difficulty now that the purse is the constraint —
  // see level.ts's targetScoreFor note), while launch cost and the clock stay
  // flat so the pressure comes from the quota rising against the same money.
  const bays = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, 1));
  check("the funding target rises every bay",
    bays.every((b, i) => b.targetScore === 800 + TARGET_PER_BAY * i),
    `${bays.map((b) => b.targetScore).join(",")}`);
  check("the rise is strictly positive",
    TARGET_PER_BAY > 0 && bays[1].targetScore > bays[0].targetScore);
  check("launch cost is flat across a run",
    bays.every((b) => b.launchCost === bays[0].launchCost));
  check("the clock is flat across a run",
    bays.every((b) => b.timeLimitSec === bays[0].timeLimitSec));
  // The purse is TIGHT: the float is the mistake budget, and at eight stock
  // launches a bay is a small number of precise shots rather than a spray.
  // Asserted as a RANGE, because this number is wrong in both directions —
  // above nine the volume strategy pays for itself again (the sweep put the
  // bay-1 volume bot at 38% on the old ten-launch float), and at six or fewer
  // the bay is decided by the first two shots and stops being a puzzle at all.
  // Loosening or tightening it should be a deliberate act with a failing test
  // to read.
  check("the starting float is a tight budget, but a playable one",
    bays.every((b) => b.startingFunds >= 7 * b.launchCost && b.startingFunds <= 9 * b.launchCost),
    `${bays[0].startingFunds} float vs $${bays[0].launchCost}/launch`);
  // The wind ladder, at HALF its previous strength (playtest, 2026-08-22:
  // wind at 0.06 +0.04/bay discouraged aiming — and the gust noise punished a
  // solved shot with a random miss, so WIND_GUST_FRACTION was cut on top).
  // Pinned exactly, because the halving was deliberate and a regression to
  // the old ramp would double the weather without failing any structural
  // check. Epsilon for the float sums, not slack: 0.02 has no exact binary
  // representation.
  const WIND_EPS = 1e-9;
  check("the first three bays are dead calm",
    bays.slice(0, 3).every((b) => b.windMax === 0 && b.windGust === 0),
    bays.slice(0, 3).map((b) => b.windMax).join(","));
  check("bay 4 opens the weather at 0.03",
    Math.abs(bays[3].windMax - 0.03) < WIND_EPS, String(bays[3].windMax));
  check("bay 10 tops the ramp at 0.15",
    Math.abs(bays[9].windMax - 0.15) < WIND_EPS, String(bays[9].windMax));
  // Gust rides the cap by the ONE shared fraction on every bay — the same
  // invariant hazards.ts's wind notch and contracts.ts's levelForContract
  // maintain at their ends, asserted here at the source.
  check("windGust is windMax * WIND_GUST_FRACTION on every bay",
    bays.every((b) => b.windGust === b.windMax * WIND_GUST_FRACTION),
    `${bays[3].windGust} at bay 4, ${bays[9].windGust} at bay 10`);
  // A Mark no longer moves any of the ladder's numbers — it only changes which
  // hazards and systems exist.
  check("a Mark changes no number on the base ladder",
    Array.from({ length: MARK_COUNT }, (_, m) => makeBaseLevel(5, m + 1))
      .every((b) => b.targetScore === makeBaseLevel(5, 1).targetScore
        && b.compactorSpeed === makeBaseLevel(5, 1).compactorSpeed));

  // ---- The ladder: every Mark means something -----------------------------
  // Mark 1's rung is the two base numbers the draft may still deal. The third,
  // Quota Raise, is retired from the offer (hazards.ts's RETIRED_AXES) now
  // that the quota climbs on its own every bay — so hazardsForMark, which is
  // what the draft deals from, must not return it at any Mark.
  check("Mark 1 opens exactly the two dealt base axes",
    hazardsForMark(1).length === 2
      && hazardsForMark(1).every((h) => h.kind === "number"),
    hazardsForMark(1).map((h) => h.id).join(","));
  check("the retired quota axis is never dealt, at any Mark",
    Array.from({ length: CAPSTONE_MARK }, (_, i) => hazardsForMark(i + 1))
      .every((pool) => !pool.some((h) => h.id === "target")));
  // ...but it is still APPLIED, so a run that banked a notch on it before it
  // was retired keeps resolving to the numbers it was taken at.
  check("an already-banked quota notch still applies",
    applyRatchets(makeBaseLevel(0, 1), { target: 1 }).targetScore
      === makeBaseLevel(0, 1).targetScore + TARGET_NOTCH);
  // The rung-by-rung promise: no Mark from 1 to 9 is a no-op.
  let ladderGrows = true;
  for (let m = 2; m <= 9; m++) {
    if (hazardsForMark(m).length !== hazardsForMark(m - 1).length + 1) ladderGrows = false;
  }
  check("every Mark from 2 to 9 adds exactly one axis", ladderGrows,
    Array.from({ length: 9 }, (_, m) => hazardsForMark(m + 1).length).join(","));
  check("the capstone adds no axis and asks for two picks",
    hazardsForMark(CAPSTONE_MARK).length === hazardsForMark(9).length
      && picksPerBay(CAPSTONE_MARK) === 2 && picksPerBay(9) === 1);
  check("every axis id is unique",
    new Set(HAZARDS.map((h) => h.id)).size === HAZARDS.length);
  check("every axis names its number in its own copy",
    HAZARDS.filter((h) => h.kind === "number").every((h) => /\d/.test(h.desc)),
    HAZARDS.filter((h) => h.kind === "number" && !/\d/.test(h.desc)).map((h) => h.id).join(","));

  // ---- Notches actually bite ----------------------------------------------
  const flat = makeBaseLevel(0, 1);
  // Asserted on a DEEP bay rather than bay 1: the retired quota notch is flat,
  // and at bay 1 (cfg.id === 1) a flat notch and a per-bay one are the same
  // number, so bay 1 alone could not tell a regression from correct code.
  const deep = makeBaseLevel(6, 1);
  check("a target notch raises the target by exactly one flat step",
    applyRatchets(deep, { target: 1 }).targetScore === deep.targetScore + TARGET_NOTCH);
  check("notches stack linearly",
    applyRatchets(deep, { target: 3 }).targetScore === deep.targetScore + TARGET_NOTCH * 3);
  check("a cost notch raises the launch cost",
    applyRatchets(flat, { cost: 2 }).launchCost === flat.launchCost + COST_NOTCH * 2);
  check("a time notch cuts the clock",
    applyRatchets(flat, { time: 1 }).timeLimitSec === flat.timeLimitSec - TIME_NOTCH);
  // An axis that can reach an unplayable bay is a lose button, not a knob.
  check("the clock never ratchets to nothing",
    applyRatchets(flat, { time: 99 }).timeLimitSec > 0,
    `${applyRatchets(flat, { time: 99 }).timeLimitSec}s`);
  // Same rail on the other side: a bay must stay physically able to hold a
  // sellable row however hard the sweeper is ratcheted.
  const swept = applyRatchets(flat, { sweeper: 99 });
  // STRICTLY greater, not >=. At equality compactor.ts's leftX and rightX are
  // the same X — the press has zero travel, stops moving for the rest of the
  // run and counts a phantom stroke every other step. The old >= admitted
  // exactly that state, and a stock rig reached it at four notches.
  check("the bay never ratchets below a sellable line",
    swept.compactorOpenCells > swept.compactorMinLineCells,
    `${swept.compactorOpenCells} open vs ${swept.compactorMinLineCells} needed`);
  // Asserted against the press itself, because that is where the damage landed:
  // the config invariant above is only a proxy for "the bar can still move".
  for (const n of [1, 4, 7, 99]) {
    const cfg = applyRatchets(flat, { sweeper: n });
    const c = new Compactor(Matter.Engine.create().world, cfg);
    check(`the press still has stroke at ${n} sweeper notch${n === 1 ? "" : "es"}`,
      c.rightX - c.leftX >= CELL, `travel ${(c.rightX - c.leftX).toFixed(1)}px`);
  }
  check("a sweeper notch speeds the press up",
    applyRatchets(flat, { sweeper: 1 }).compactorSpeed > flat.compactorSpeed);
  // Wind's texture has to ride its cap, or a ratcheted bay gets a stiff average
  // with the gust profile of a calm one.
  const windy = applyRatchets(flat, { wind: 2 });
  check("a wind notch raises both the cap and its gust",
    windy.windMax > flat.windMax && windy.windGust > 0);

  check("applyRatchets never mutates its input",
    (() => { const before = flat.targetScore; applyRatchets(flat, { target: 5 }); return flat.targetScore === before; })());
  check("an unknown axis id is ignored rather than crashing",
    applyRatchets(flat, { nope: 3 } as unknown as Ratchets).targetScore === flat.targetScore);

  // ---- Content axes --------------------------------------------------------
  check("a content notch puts its material on the belt",
    applyRatchets(flat, { slag: 1 }).materialMix.slag === materialRate(1));
  check("a material rate rises with notches",
    materialRate(2) > materialRate(1) && materialRate(3) > materialRate(2));
  check("a material rate is capped however hard it is ratcheted",
    materialRate(99) === MATERIAL_CAP && MATERIAL_CAP < 1);
  // Every content axis must correspond to a real material, or the belt rolls a
  // shipment made of a string nothing knows how to draw.
  check("every content axis names a material the mix carries",
    HAZARDS.filter((h) => h.kind === "content")
      .every((h) => h.material !== undefined && h.material in flat.materialMix),
    HAZARDS.filter((h) => h.kind === "content" && !(h.material! in flat.materialMix))
      .map((h) => h.id).join(","));
  // Even every axis maxed cannot fill the belt with hazards — a bay that is
  // more hazard than cargo stops being a bay and starts being a wall.
  const allMaxed = applyRatchets(flat, Object.fromEntries(
    HAZARDS.filter((h) => h.kind === "content").map((h) => [h.id, 99])) as Ratchets);
  check("the mix never reaches certainty even fully ratcheted",
    Object.values(allMaxed.materialMix).reduce((a, b) => a + b, 0) < 1,
    `${Object.values(allMaxed.materialMix).reduce((a, b) => a + b, 0).toFixed(2)}`);

  // ---- The offer -----------------------------------------------------------
  check("the offer is deterministic in the seed",
    hazardOffers(99, 3, 6).map((h) => h.id).join(",")
      === hazardOffers(99, 3, 6).map((h) => h.id).join(","));
  check("the offer never exceeds what the Mark has opened",
    Array.from({ length: MARK_COUNT }, (_, m) =>
      hazardOffers(7, 2, m + 1).every((h) => h.mark <= m + 1)).every(Boolean));
  // At most one material per hand: the content axes all read alike, and three
  // at once is a pile-on rather than a choice between kinds of pressure.
  //
  // Scoped to the ORDINARY bays, because MATERIAL_DRAFT_BAYS suspends exactly
  // this rule on purpose — see the materials-only block below. The structural
  // half (enough cards, no duplicates) still has to hold everywhere.
  let oneContentMax = true;
  let handWellFormed = true;
  for (let m = 1; m <= MARK_COUNT; m++) {
    for (let bay = 0; bay < 10; bay++) {
      const offer = hazardOffers(1234 + bay, bay, m);
      if (!isMaterialDraft(bay) && offer.filter((h) => h.kind === "content").length > 1) {
        oneContentMax = false;
      }
      if (offer.length < picksPerBay(m)) handWellFormed = false;
      if (new Set(offer.map((h) => h.id)).size !== offer.length) handWellFormed = false;
      if (offer.some((h) => h.mark > m)) handWellFormed = false;
    }
  }
  check("an ordinary hand holds at most one material", oneContentMax);
  check("every hand has enough cards, no duplicates, nothing above the Mark", handWellFormed);

  // ---- Materials-only bays -------------------------------------------------
  //
  // The ladder is otherwise dodgeable — one content card per hand means a run
  // can reach bay 10 having taken no material at all, which leaves half the
  // content unseen and every ship system that answers a material a purchase
  // with nothing to answer. These bays take the dodge away.
  {
    let forcedEverywhere = true;
    let pairedWhenSingle = true;
    let slagEverAlone = false;
    let slagOffered = false;
    let offBaysUnchanged = true;
    let capstoneShort = false;
    const ratchets: Ratchets = { cost: 2, time: 1, wind: 3 };

    for (let m = 1; m <= MARK_COUNT; m++) {
      const materials = hazardsForMark(m).filter((h) => h.kind === "content");
      for (let bay = 0; bay < 10; bay++) {
        const offer = hazardOffers(4242 + bay, bay, m, undefined, ratchets);
        const inHand = offer.filter((h) => h.kind === "content");
        if (!isMaterialDraft(bay)) {
          // A non-material bay must be untouched by any of this.
          if (inHand.length > 1) offBaysUnchanged = false;
          continue;
        }
        if (materials.length >= 2) {
          // TWO materials on offer and one pick: the choice is which material,
          // never whether. This is the whole feature.
          if (inHand.length !== offer.length) forcedEverywhere = false;
          // ...and slag may fill a seat but never the last one — it is the one
          // material with no passive counter, so a hand of nothing but slag is
          // a bay that cannot be won by playing well.
          if (offer.every((h) => h.id === "slag")) slagEverAlone = true;
          if (offer.some((h) => h.id === "slag")) slagOffered = true;
        } else if (materials.length === 1) {
          // One material: paired with the axis the run has leaned on hardest,
          // so the hand is still a draft rather than a single card to tap past.
          if (inHand.length !== 1) pairedWhenSingle = false;
          if (offer.length !== 2) pairedWhenSingle = false;
          if (!offer.some((h) => h.id === "wind")) pairedWhenSingle = false;
        } else {
          // Marks 1-3 have no material to force; the ordinary draft stands.
          if (inHand.length !== 0) forcedEverywhere = false;
        }
        if (offer.length < picksPerBay(m)) capstoneShort = true;
      }
    }
    check(`materials-only bays are ${MATERIAL_DRAFT_BAYS.join(", ")}`,
      MATERIAL_DRAFT_BAYS.every((b) => isMaterialDraft(b - 1))
        && !isMaterialDraft(0) && !isMaterialDraft(2));
    check("with two or more materials, every card in the hand is a material", forcedEverywhere);
    check("with one material, it is paired with the run's hardest active axis", pairedWhenSingle);
    // Kept, but no longer the whole story: with two DISTINCT materials in the
    // hand this cannot fire, and saying so is more honest than implying a guard
    // is holding it back. The property that actually needs pinning is the one
    // below — slag IS dealt on forced bays, and at the capstone the player has
    // no room to refuse it.
    check("slag is never the only thing on offer", !slagEverAlone);
    check("slag is genuinely dealt on forced bays (not quietly excluded)", slagOffered);
    {
      // At the capstone, picksPerBay equals the hand size, so a forced hand is
      // taken WHOLE — there is no choosing. If slag is in it, the player eats
      // slag. That is an edge of this feature, not a defect, and it is pinned
      // here so it cannot change without someone deciding to change it.
      const capstoneForced = hazardOffers(4242, MATERIAL_DRAFT_BAYS[0] - 1, CAPSTONE_MARK);
      check(
        `a capstone forced hand is taken whole (${capstoneForced.length} cards, ${picksPerBay(CAPSTONE_MARK)} picks)`,
        capstoneForced.length === picksPerBay(CAPSTONE_MARK)
          && capstoneForced.every((h) => h.kind === "content"),
        capstoneForced.map((h) => h.id).join(","),
      );
    }
    check("ordinary bays are untouched by the forced hands", offBaysUnchanged);
    check("a forced hand still deals at least as many cards as picks", !capstoneShort);

    // The offer must stay a function of (seed, bay, Mark) — a restarted run has
    // to deal the same table, and the ratchets must not smuggle in variation
    // beyond the single-material partner they are read for.
    // levelIndex 4, not 5. MATERIAL_DRAFT_BAYS names bays 1-based, so the forced
    // levelIndexes are 1, 4 and 7 — these two checks used to pass 5, which is
    // bay SIX, an ordinary bay. They asserted determinism of a hand that was
    // never forced and would have passed with the whole feature deleted.
    const forcedIndex = MATERIAL_DRAFT_BAYS[1] - 1;
    check(`the determinism checks use a forced bay (levelIndex ${forcedIndex})`,
      isMaterialDraft(forcedIndex));
    const a = hazardOffers(99, forcedIndex, 6, undefined, ratchets).map((h) => h.id).join(",");
    const b = hazardOffers(99, forcedIndex, 6, undefined, ratchets).map((h) => h.id).join(",");
    check("a forced hand is deterministic in the seed", a === b);

    // What this replaces asserted that a hand is the same with and without a
    // ratchet history — by comparing hazardOffers(...) against
    // hazardOffers(..., {}), which is the SAME CALL, since the parameter
    // defaults to {}. It was tautological, and the property it meant to assert
    // is false by design: on a single-material bay the ratchets pick the
    // partner. So assert the true thing, in both directions.
    const oneMat = MATERIAL_DRAFT_BAYS[0] - 1;
    const withTime = hazardOffers(11, oneMat, 4, undefined, { time: 3 }).map((h) => h.id).join(",");
    const withSweep = hazardOffers(11, oneMat, 4, undefined, { sweeper: 2 }).map((h) => h.id).join(",");
    check("a single-material hand takes its partner from the run's ratchets",
      withTime !== withSweep && withTime.includes("time") && withSweep.includes("sweeper"),
      `${withTime} vs ${withSweep}`);
    check("...and is still stable for one ratchet history",
      hazardOffers(11, oneMat, 4, undefined, { time: 3 }).map((h) => h.id).join(",") === withTime);

    // A run must be able to reach a shop after every forced material: that is
    // why these bays sit where they do, and a schedule that broke it would be
    // handing the player a problem with nothing left to buy the answer with.
    // The schedule's whole justification: a forced material is carried for ONE
    // bay and then its counter is on sale. "A refit happens eventually" is not
    // the same promise — at bay 6 the next shop is three bays away, which is a
    // far harder ask wearing the same clothes.
    const carriedBays = MATERIAL_DRAFT_BAYS.map((b) => {
      for (let i = b; i < RUN_LEVELS - 1; i++) if (isRefitBay(i)) return i + 1 - b;
      return Infinity;
    });
    check(
      `every forced material reaches a shop after one bay (${carriedBays.join(", ")})`,
      carriedBays.every((n) => n === 1),
      `bays ${MATERIAL_DRAFT_BAYS.join(",")} carry ${carriedBays.join(",")}`,
    );
  }
  check("totalNotches counts every axis",
    totalNotches({ target: 2, slag: 1, wind: 3 }) === 6 && totalNotches({}) === 0);
  check("hazardById resolves every id and rejects junk",
    HAZARDS.every((h) => hazardById(h.id) === h) && hazardById("nope") === undefined);

  // ---- fillsSlots: the single definition of "worth a slot" -----------------

  const cube = (material: Material, struck = material !== "cryo"): Cube =>
    ({ material, struck }) as Cube;

  // ---- The four late materials (phase 3) -----------------------------------
  // Each is a rule about how a cube interacts with the existing engine — none
  // adds a system, a screen or a new player verb, which is the constraint the
  // whole material vocabulary is built under.
  check("every material the mix can roll has a spec",
    MATERIALS.every((m) => MATERIAL_SPEC[m] !== undefined)
      && MATERIALS.length === Object.keys(MATERIAL_SPEC).length);
  check("every non-standard material is visually distinct",
    new Set(MATERIALS.map((m) => MATERIAL_SPEC[m].color)).size === MATERIALS.length,
    MATERIALS.map((m) => MATERIAL_SPEC[m].color).join(","));
  // A material with no rule flag at all is indistinguishable from standard once
  // it is on the field, which makes it a colour swap rather than content.
  check("every non-standard material carries a rule, not just a colour",
    MATERIALS.filter((m) => m !== "standard").every((m) => {
      const sp = MATERIAL_SPEC[m];
      return !sp.countsForLines || sp.needsStrike || sp.rigid || sp.detonates || sp.welds || sp.aligns;
    }));
  // The four late materials are answered by systems the ship already has, or
  // deliberately by nothing — cryo and magnetic are the two rungs that teach a
  // hazard is something you absorb rather than something you shop for.
  check("rebar is rigid and nothing else", MATERIAL_SPEC.rebar.rigid === true
    && MATERIAL_SPEC.rebar.countsForLines);
  check("volatile detonates and still counts if it survives",
    MATERIAL_SPEC.volatile.detonates === true && MATERIAL_SPEC.volatile.countsForLines);
  check("tar welds", MATERIAL_SPEC.tar.welds === true);
  check("magnetic is the helpful one — it aligns and blocks nothing",
    MATERIAL_SPEC.magnetic.aligns === true && MATERIAL_SPEC.magnetic.countsForLines
      && !MATERIAL_SPEC.magnetic.needsStrike);

  // Rebar's joints are exempt from the break check at any stretch, which is the
  // mechanical statement of "what lands is what you keep".
  {
    // An engine's world rather than a bare Composite: createTetrisPiece and
    // updateBreakableJoints are typed against Matter.World, and a Composite has
    // no gravity/bounds. Nothing steps this engine, so it stays the inert
    // container these joint checks want.
    const w = Matter.Engine.create().world;
    const rigid = createTetrisPiece(w, 200, 200, 0, { x: 0, y: 0 }, "T", 0.95, "std", 1.7, "rebar");
    const plain = createTetrisPiece(w, 200, 200, 0, { x: 0, y: 0 }, "T", 0.95, "std", 1.7, "standard");
    const limitOf = (c: Matter.Constraint): number =>
      (c as unknown as { breakStretch: number }).breakStretch;
    check("rebar joints never break, at any stretch",
      rigid.constraints.every((c) => limitOf(c) === Infinity));
    check("a standard piece keeps a finite break threshold",
      plain.constraints.every((c) => Number.isFinite(limitOf(c))));
    // Yank one cube far past any threshold and confirm only the standard piece
    // lets go. Moving a single cube strains the joints it is part of, not all
    // six of a T's pairs — so the assertion is "kept every joint" against "lost
    // some", not a count.
    const yank = (r: { cubes: Cube[]; constraints: Matter.Constraint[] }): number => {
      const before = r.constraints.length;
      Matter.Body.setPosition(r.cubes[0].body, { x: 9000, y: 9000 });
      updateBreakableJoints(w, r.constraints, 1.7);
      return before - r.constraints.length;
    };
    check("a rebar piece survives a stretch that shatters a standard one",
      yank(rigid) === 0 && yank(plain) > 0,
      `rebar lost ${yank(rigid)}, standard lost ${yank(plain)}`);

    // The press was the hole in all of this. breakJointsInBand deletes on
    // GEOMETRY alone and read no metadata, so the one thing rebar is sold on —
    // "what lands is what you keep" — was undone by the bar sweeping over it,
    // and a tar weld dissolved the same way. updateBreakableJoints honoured
    // both exemptions; the press did not. A Bond Breaker is meant to be the
    // only answer to either.
    {
      const w3 = Matter.Engine.create().world;
      const bar = createTetrisPiece(w3, 300, 300, 0, { x: 0, y: 0 }, "O", 0.95, "std", 1.7, "rebar");
      const soft = createTetrisPiece(w3, 300, 300, 0, { x: 0, y: 0 }, "O", 0.95, "std", 1.7, "standard");
      const weld = Matter.Constraint.create({
        bodyA: Matter.Bodies.rectangle(300, 300, CELL, CELL),
        bodyB: Matter.Bodies.rectangle(300 + CELL, 300, CELL, CELL),
        length: CELL,
      });
      (weld as unknown as { welded: boolean }).welded = true;
      const welds = [weld];
      // Band wide enough to cover every one of these bodies.
      breakJointsInBand(w3, bar.constraints, 300, 0, 500);
      breakJointsInBand(w3, soft.constraints, 300, 0, 500);
      breakJointsInBand(w3, welds, 300, 0, 500);
      check("the press does not break rebar joints",
        bar.constraints.length === 6, `${bar.constraints.length}/6 left`);
      check("the press DOES still shatter an ordinary piece",
        soft.constraints.length === 0, `${soft.constraints.length} left`);
      check("the press does not dissolve a tar weld",
        welds.length === 1, `${welds.length} left`);
    }
  }

  // Volatile needs a HARD impact — above cryo's strike speed, or the landing
  // that thaws ice would also set off a bomb and volatile would stop being a
  // landing the player can control.
  check("volatile's trigger is harder than a cryo strike",
    VOLATILE_TRIGGER_SPEED > CRYO_STRIKE_SPEED);
  // ...and that was the ONLY bound, which is how the trigger shipped at 9.5 —
  // below the speed any launch can even arrive at. Measured over every angle
  // and power the cannon produces, first contact runs 17.3 to 30.8, so a
  // trigger outside that band is not a difficulty setting, it is an always-on
  // or never-on switch: under it every volatile shipment detonates on arrival
  // and countsForLines is dead code, over it volatile is inert. The band is a
  // property of speedMax and gravity — if either moves, re-measure rather than
  // widening these numbers.
  const IMPACT_MIN = 17.3, IMPACT_MAX = 30.8;
  check("volatile's trigger sits inside the impact speeds a launch can produce",
    VOLATILE_TRIGGER_SPEED > IMPACT_MIN && VOLATILE_TRIGGER_SPEED < IMPACT_MAX,
    `${VOLATILE_TRIGGER_SPEED} vs measured ${IMPACT_MIN}..${IMPACT_MAX}`);
  {
    const bodyAt = (x: number, y: number, vx = 0): Matter.Body => {
      const b = Matter.Bodies.rectangle(x, y, CELL, CELL);
      Matter.Body.setVelocity(b, { x: vx, y: 0 });
      return b;
    };
    const vol = bodyAt(100, 100, VOLATILE_TRIGGER_SPEED + 2);
    const near = bodyAt(100 + CELL, 100);
    const far = bodyAt(100 + CELL * 6, 100);
    const field: Cube[] = [
      { body: vol, material: "volatile", struck: true } as Cube,
      { body: near, material: "standard", struck: true } as Cube,
      { body: far, material: "standard", struck: true } as Cube,
    ];
    const blast = volatileBlast(field, vol, near);
    check("a hard impact takes the volatile cube and its neighbour",
      blast.length === 2 && blast.some((c) => c.body === vol) && blast.some((c) => c.body === near));
    check("the blast does not reach across the bay",
      !blast.some((c) => c.body === far));
    const soft = bodyAt(300, 100, 1);
    const softField: Cube[] = [
      { body: soft, material: "volatile", struck: true } as Cube,
      { body: bodyAt(300 + CELL, 100), material: "standard", struck: true } as Cube,
    ];
    check("a soft landing does not set volatile off",
      volatileBlast(softField, softField[0].body, softField[1].body).length === 0);
    // The answer to volatile is a soft landing, so a bay with no volatile in it
    // must never produce a blast however hard the collision.
    // The pair handed to volatileBlast must be the SAME body objects that are
    // in the field: it finds the primed cube by identity before it ever reads
    // MATERIAL_SPEC. Calling bodyAt() a second time to build the arguments
    // makes the lookup miss and the function return [] for any material at
    // all, which is a check that passes no matter what volatile does.
    const inertA = bodyAt(500, 100, 40);
    const inertB = bodyAt(500 + CELL, 100);
    check("nothing detonates on a belt with no volatile",
      volatileBlast([
        { body: inertA, material: "standard", struck: true } as Cube,
        { body: inertB, material: "slag", struck: true } as Cube,
      ], inertA, inertB).length === 0);
  }

  // Tar welds to what it settles against, and the weld is the joint nothing
  // breaks. That exemption is the whole reason tar is a different problem from
  // rebar rather than a re-skin of it.
  {
    const at = (x: number, y: number, vx = 0): Matter.Body => {
      const b = Matter.Bodies.rectangle(x, y, CELL, CELL);
      Matter.Body.setVelocity(b, { x: vx, y: 0 });
      return b;
    };
    const stuck = at(100, 100);
    const pile = at(100 + CELL, 100);
    const field: Cube[] = [
      { body: stuck, material: "tar", struck: true } as Cube,
      { body: pile, material: "standard", struck: true } as Cube,
    ];
    check("tar welds to what it settles against", tarWelds(field, stuck, pile).length === 1);
    // Same identity trap as the volatile check above: tarWelds looks the pair
    // up in the field by object identity and bails at !ca || !cb, so building
    // the arguments with a second at() call means `welds` is never consulted
    // and the check would pass even with both cubes made of tar.
    const plainA = at(300, 100);
    const plainB = at(300 + CELL, 100);
    check("two ordinary cubes never weld",
      tarWelds([
        { body: plainA, material: "standard", struck: true } as Cube,
        { body: plainB, material: "standard", struck: true } as Cube,
      ], plainA, plainB).length === 0);
    // Mid-air tar must not fuse with the shipment it was launched beside — it
    // sticks to the PILE, which is what makes it a placement problem.
    const flyA = at(500, 100, 30);
    const flyB = at(500 + CELL, 100, 30);
    // The weld survives the stretch check that breaks every ordinary joint —
    // asserted against updateBreakableJoints directly, because that is the
    // function a future change would most plausibly break it in.
    {
      const w2 = Matter.Engine.create().world;
      const c = Matter.Constraint.create({ bodyA: at(700, 100), bodyB: at(700 + CELL, 100), length: CELL });
      (c as unknown as { restLength: number; welded: boolean }).restLength = CELL;
      (c as unknown as { welded: boolean }).welded = true;
      const list = [c];
      Matter.Body.setPosition(c.bodyA!, { x: 9000, y: 9000 });
      updateBreakableJoints(w2, list, 1.7);
      check("a tar weld survives a stretch that breaks any ordinary joint", list.length === 1);
    }
    check("tar does not weld to something still in flight",
      tarWelds([
        { body: flyA, material: "tar", struck: true } as Cube,
        { body: flyB, material: "standard", struck: true } as Cube,
      ], flyA, flyB).length === 0);
  }

  // Magnetic squares itself up once at rest — it fills a slot you may not have
  // wanted filled, but it does the press's job on the way in.
  {
    const skew = Matter.Bodies.rectangle(200, 400, CELL, CELL);
    Matter.Body.setAngle(skew, 0.24);
    Matter.Body.setVelocity(skew, { x: 0, y: 0 });
    // The anchor game.ts passes. Asserting "an integer number of cells from
    // whatever floorY we handed in" is what the first version of this check
    // did, and alignMagnetic guarantees that for EVERY floorY — so it passed
    // just as happily while game.ts was passing WORLD.height - WALL_INNER, an
    // X coordinate that put the snap grid half a cell off the rows. The
    // property worth asserting is the one lineClear actually reads: the cube
    // has to land on a row CENTER, so measure against rowY, not against the
    // input.
    const floorY = WORLD.height - CELL / 2;
    Matter.Body.setPosition(skew, { x: 200, y: floorY - CELL * 3 + 5 });
    const mags: Cube[] = [{ body: skew, material: "magnetic", struck: true } as Cube];
    alignMagnetic(mags, floorY);
    check("a settled magnetic cube snaps to a quarter turn",
      Math.abs(skew.angle % (Math.PI / 2)) < 1e-6, String(skew.angle));
    const rowCenters = Array.from({ length: 12 }, (_, r) => WORLD.height - CELL / 2 - r * CELL);
    check("a settled magnetic cube snaps onto updateLineClear's row grid",
      rowCenters.some((y) => Math.abs(skew.position.y - y) < 1e-6),
      `y=${skew.position.y} nearest=${rowCenters.reduce((a, b) =>
        Math.abs(b - skew.position.y) < Math.abs(a - skew.position.y) ? b : a)}`);
    // A moving one is still in play and must not be teleported mid-flight.
    const flying = Matter.Bodies.rectangle(200, 200, CELL, CELL);
    Matter.Body.setAngle(flying, 0.3);
    Matter.Body.setVelocity(flying, { x: 6, y: 3 });
    alignMagnetic([{ body: flying, material: "magnetic", struck: true } as Cube], floorY);
    check("a magnetic cube in flight is left alone", Math.abs(flying.angle - 0.3) < 1e-9);
    // And it must not reach through the material table to straighten anything else.
    const other = Matter.Bodies.rectangle(200, 200, CELL, CELL);
    Matter.Body.setAngle(other, 0.3);
    Matter.Body.setVelocity(other, { x: 0, y: 0 });
    alignMagnetic([{ body: other, material: "standard", struck: true } as Cube], floorY);
    check("magnetic alignment touches only magnetic cubes", Math.abs(other.angle - 0.3) < 1e-9);
  }

  check("standard fills slots", fillsSlots(cube("standard")));
  check("slag NEVER fills a slot", !fillsSlots(cube("slag")));
  check("slag stays dead even if something strikes it", !fillsSlots(cube("slag", true)));
  check("cold cryo does not fill a slot", !fillsSlots(cube("cryo", false)));
  check("struck cryo does", fillsSlots(cube("cryo", true)));

  // ---- The queue promises what it delivers --------------------------------

  // A RATCHETED bay carries what was ratcheted onto it — and only that. The
  // old form of this check asked a deep high-Mark bay to carry materials on its
  // own; it deliberately no longer does.
  const matLevel = applyRatchets(makeBaseLevel(9, MARK_COUNT), { slag: 2, cryo: 1 });
  check(
    "a ratcheted bay carries exactly the materials that were ratcheted",
    matLevel.materialMix.slag > 0 && matLevel.materialMix.cryo > 0
      && matLevel.materialMix.rebar === 0 && matLevel.materialMix.tar === 0,
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

  // ---- The 7-bag shipment randomizer (cannon.ts's deal) -------------------
  //
  // Deep Run bays used to ship a fixed I,O,T,L,J,S,Z rotation, so every run's
  // first minute played out identically (playtest, 2026-08-09). The bag fixes
  // the sameness while KEEPING the rotation's fairness — each type exactly
  // once per seven shipments — and staying seeded, because a restarted bay
  // must replay its exact deal and a shared seed must mean the same bay.
  check("every base bay ships the bag, not a fixed rotation",
    Array.from({ length: 10 }, (_, i) => makeBaseLevel(i)).every((l) => l.pieceSequence === null));

  const bagStream = (seed: number, n: number): string => {
    const c = new Cannon(makeBaseLevel(0), seed);
    const out: PieceType[] = [c.currentType];
    for (let i = 1; i < n; i++) { c.markShot(0); out.push(c.currentType); }
    return out.join("");
  };
  check("the bag deals every type exactly once per seven shipments",
    [0, 1, 2, 3].every((chunk) => {
      const window = bagStream(555, 28).slice(chunk * 7, chunk * 7 + 7);
      return new Set(window).size === 7;
    }));
  check("the deal is deterministic for a seed (a restarted bay replays it)",
    bagStream(4242, 21) === bagStream(4242, 21));
  check("different seeds deal different openings",
    bagStream(1, 21) !== bagStream(2, 21));

  // The fixed-sequence seam survives for the modes that declare one.
  const fixedCfg = { ...makeBaseLevel(0), pieceSequence: ["I", "O"] as PieceType[] };
  const fixed = new Cannon(fixedCfg, 7);
  const fixedSeen: PieceType[] = [fixed.currentType];
  for (let i = 0; i < 3; i++) { fixed.markShot(0); fixedSeen.push(fixed.currentType); }
  check("an explicit pieceSequence still cycles verbatim",
    fixedSeen.join("") === "IOIO");

  // SIZE NORMALIZATION — the live bug the spec found. The roll is per SHIPMENT
  // while the cost is per CUBE, so at one rate a 5-cube Bulk shipment ate 2.5x
  // the dead cubes of a 2-cube Micro one, on top of Bulk's +50% launch cost and
  // its 1.6 breakMult. Dead cubes per LAUNCH is the unit the player spends, so
  // that is the unit held equal.
  const deadCubesPerLaunch = (size: PieceSize): number => {
    const cfg = { ...applyRatchets(makeBaseLevel(0, 1), { slag: 3 }), pieceSize: size };
    const c = new Cannon(cfg, 4242);
    let dead = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (c.currentMaterial === "slag") dead += SIZE_SPEC[size].cubes;
      c.markShot(0);
    }
    return dead / N;
  };
  const tiny = deadCubesPerLaunch("tiny");
  const std = deadCubesPerLaunch("std");
  const bulk = deadCubesPerLaunch("bulk");
  const spread = Math.max(tiny, std, bulk) - Math.min(tiny, std, bulk);
  check("a slag notch costs every shipment size the same cargo per launch",
    spread < 0.12,
    `tiny ${tiny.toFixed(2)} · std ${std.toFixed(2)} · bulk ${bulk.toFixed(2)}`);
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

  // ---- A Contract's belt carries exactly what it priced -------------------
  //
  // Contracts ship materials (the pentomino complication's replacement), but
  // only the ones their model can account for. Slag can never count toward a
  // line, so it must never appear anywhere. The belt must otherwise match the
  // Contract's own material/rate fields byte-for-byte — on a lines Contract
  // those fields are what launchesFor priced, and a mix that drifts from them
  // is a budget lying about its bay.
  //
  // A PATTERN Contract's belt is no longer required to be clean, and that is a
  // narrowing rather than a loosening. Its exact tiling admits only materials
  // that leave a landed cube COUNTING, IN THE CELL THE TILING PUT IT IN: rebar
  // refuses to come apart, magnetic squares itself onto its slot. Cryo (dead
  // until struck), volatile (takes its neighbours) and tar (welds where it
  // fell) all change what a landed cube is, so an exact inventory stops being
  // exact — they stay forbidden, and this is where that is enforced.
  const PATTERN_SAFE_MATERIALS = new Set(["rebar", "magnetic"]);
  let contractMixes = 0;
  let dirtyContracts = 0;
  let materialContracts = 0;
  for (let tier = 1; tier <= 9; tier++) {
    for (const c of dailyContracts(tier, 20260801 + tier)) {
      const cfg = levelForContract(c, mulberry32(tier * 31 + 7));
      contractMixes++;
      if (c.material) materialContracts++;
      if (cfg.materialMix.slag !== 0) dirtyContracts++;
      for (const [m, rate] of Object.entries(cfg.materialMix)) {
        const priced = c.material === m ? c.materialRate : 0;
        if (rate !== priced) dirtyContracts++;
      }
      if (c.kind === "pattern" && c.material !== null) {
        if (!PATTERN_SAFE_MATERIALS.has(c.material)) dirtyContracts++;
        // A variant that ships a material ships it on EVERY shipment. A
        // per-shipment roll would make "nothing shatters" true of most of the
        // bay, which is a different and much worse promise than the card's.
        if (c.materialRate !== 1) dirtyContracts++;
      }
    }
  }
  check(
    "every Contract's belt matches its priced mix, and slag never rides it",
    dirtyContracts === 0 && contractMixes > 0,
    `${contractMixes} contracts checked`,
  );
  check(
    "the board actually deals material Contracts at high tiers",
    materialContracts > 0,
    `${materialContracts} material contracts in the sample`,
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

  // ---- The penalty path reports WHERE the cargo was lost ------------------
  //
  // game.ts spawns the "−$" penalty FX at the blinked-out cubes' centroid, so
  // updateBlinking has to hand back positions, not just a count — an FX at
  // (0,0) would read as noise rather than a consequence, which is the exact
  // failure the penalty toast exists to fix (a fine the player only ever met
  // in the end screen's tally read as a hidden rule).
  {
    const blink = buildRow(allStd.slice(0, 2));
    const [a, b] = blink.cubes;
    const ax = a.body.position.x, ay = a.body.position.y;
    a.blinkStart = 0; // long expired against now=10_000 below
    const lost = updateBlinking(blink.phys.world, blink.cubes, 10_000, []);
    check("a blinked-out cube reports its last position",
      lost.length === 1 && lost[0].x === ax && lost[0].y === ay);
    check("cubes not yet blinking are untouched",
      blink.cubes.length === 1 && blink.cubes[0] === b);
    // The tutorial teaches the fine with the bay's real number on the card —
    // same rule as every other coach step, and the reason the copy can never
    // drift from the level it narrates.
    // "fine $N", not a bare "$N" — bay 1's launch cost is also $25, so a loose
    // match would pass with the fine sentence deleted. The verb and the number
    // are the assertion; the sentence they sit in is the card's to write, and
    // is written to a hard height budget (see coachSteps), so this matches as
    // little of it as it can and still mean something.
    //
    // Against the RENDERED text, tags stripped, for the same reason: the cards
    // emphasise their figures, and where the <b> falls inside a phrase is
    // typography rather than meaning — "fine <b>$25</b>" and "<b>fine $25</b>"
    // read identically to a player, and only one matches a raw-markup search.
    const plain = (html: string): string => html.replace(/<[^>]+>/g, "");
    const steps = coachSteps(rowLevel);
    const economy = plain(steps.map((s) => s.body).join(" "));
    check("the coach names the lost-cargo fine",
      economy.includes(`fine $${rowLevel.penaltyPerLostPiece}`), economy);
    // ONE CARD PER COMPLETABLE ACTION (see coachSteps' note): aim, power and
    // release are one continuous drag, so they must be taught on one card —
    // split across cards they advance mid-gesture and flash past unread,
    // which is the playtest bug ("steps 2 and 4 are skipped immediately").
    // The first card must therefore cover the whole gesture, and the deck
    // must stay at four steps: fire, rotate, row, resources.
    // Lower-cased: which clause opens the sentence is the copy's business, and
    // "Release to fire" teaches the same gesture as "release to fire" while
    // failing a literal match.
    const drag = plain(steps[0].body).toLowerCase();
    check("the coach teaches the drag as one card (power and release together)",
      drag.includes("power") && drag.includes("release"), steps[0].body);
    check("the coach deck is one card per completable action",
      steps.length === 4);

    // ---- The coach handles its own failures --------------------------------
    // A lost first bay used to route straight into the run-end modal: "Game
    // Over", a leaderboard submit box and a zeroed tier ledger, ninety seconds
    // into a first game. The tutorial explains the loss and hands the bay back
    // instead (screens.ts's coachFailHTML) — and since the tightened float
    // (level.ts's economy note) makes "broke" the failure a new player will
    // actually meet, that branch has to carry the arithmetic, not a mood.
    const broke = coachFailSteps("broke", rowLevel);
    check("the failure card names the launch price and the target",
      broke.body.includes(`$${rowLevel.launchCost}`)
        && broke.body.includes(`$${rowLevel.targetScore}`),
      broke.body);
    check("the failure card counts the bay's shots rather than asserting a number",
      broke.body.includes(`${Math.floor(rowLevel.startingFunds / rowLevel.launchCost)} shots`),
      broke.body);
    check("every Deep Run loss reason gets its own explanation",
      new Set((["broke", "time", "topout"] as const).map((r) => coachFailSteps(r, rowLevel).title)).size === 3);
    check("an unknown reason still explains itself rather than rendering blank",
      coachFailSteps(null, rowLevel).body.length > 40);
    // The whole point of the card: one obvious way back in, and no leaderboard.
    const failCard = coachFailHTML("broke", rowLevel, "Launch Bay");
    check("the failure card offers retry as the primary, full-width action",
      failCard.includes(`data-action="coach-retry"`) && failCard.includes("btn--block"));
    check("the failure card offers a way past the tutorial and a way out",
      failCard.includes(`data-action="coach-skip-run"`) && failCard.includes(`data-action="menu"`));
    check("the failure card never asks a beaten first-timer for a leaderboard name",
      !failCard.includes(`data-action="submit-score"`) && !failCard.includes("name-input")
        && !failCard.toLowerCase().includes("game over"));
    check("the failure card is a scrim modal, not an in-panel step",
      failCard.includes(`class="modal-scrim"`) && failCard.includes("coach--fail"));
  }

  // The end-to-end check the unit checks above could not make. alignMagnetic
  // is only correct relative to the anchor its CALLER passes, so the property
  // that matters is not "lands on a multiple of CELL" — it is "a magnetic row
  // that has been through the align pass still fills its slots". game.ts was
  // passing WORLD.height - WALL_INNER, an X coordinate, which snapped every
  // magnetic cube exactly CELL/2 off the row grid: past Y_TOL, so the row
  // silently stopped clearing and magnetic became a worse slag. Nudge the row
  // off-grid the way a real landing leaves it, then align, then clear.
  const magnets = buildRow(allStd.map(() => "magnetic" as Material));
  for (const c of magnets.cubes) {
    Matter.Body.setPosition(c.body, { x: c.body.position.x, y: c.body.position.y - 6 });
    Matter.Body.setVelocity(c.body, { x: 0, y: 0 });
  }
  alignMagnetic(magnets.cubes, WORLD.height - CELL / 2);
  check(
    "a magnetic row survives the align pass and still clears",
    updateLineClear(magnets.phys.world, magnets.cubes, magnets.compactor, rowLevel, []).lines === 1,
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

// ---------------------------------------------------------------------------
section("Sleeping (engine.ts enableSleeping + the wake rules that make it safe)");
// ---------------------------------------------------------------------------
{
  const DT = 1000 / 60;
  const cubeAt = (g: Game, x: number, y: number): Cube => {
    const body = Matter.Bodies.rectangle(x, y, CELL, CELL, {
      friction: 0.5, frictionAir: 0.012, restitution: 0.05,
      density: 0.001, label: "cube", chamfer: { radius: 3 },
    });
    Matter.Composite.add(g.phys.world, body);
    const cube: Cube = {
      body, type: "O", color: "#ffd500", blinkStart: null,
      material: "standard", struck: true,
    };
    g.cubes.push(cube);
    return cube;
  };

  // 1. A settled stack actually falls asleep. Placed right of the bar's
  //    full-advance stop so the wake band never touches it. This is the check
  //    that enableSleeping is really on — everything below is about waking.
  const calm = { ...makeBaseLevel(0), timeLimitSec: 0, windMax: 0 };
  {
    const g = new Game(calm);
    const floorY = WORLD.height - CELL / 2;
    const x = WALL_INNER - CELL / 2 - CELL; // one slot off the wall
    for (let r = 0; r < 3; r++) cubeAt(g, x, floorY - r * CELL);
    let now = 0;
    for (let i = 0; i < 240; i++) { now += DT; g.update(now); }
    check(
      "a settled stack sleeps within 4s",
      g.cubes.every((c) => c.body.isSleeping),
      g.cubes.map((c) => c.body.isSleeping).join(","),
    );
    g.destroy();
  }

  // 2. The advancing bar WAKES a sleeping cube in its path and pushes it,
  //    instead of tunneling through it (static setPosition motion generates
  //    no collision against a sleeping body — only wakeCompactorBand saves
  //    this). The cube starts mid-corridor, forced asleep, and must end up
  //    pushed at least a couple of cells toward the wall by the press.
  {
    const g = new Game(calm);
    const face0 = g.compactor.leftX + g.compactor.width / 2;
    const startX = face0 + CELL * 2;
    const cube = cubeAt(g, startX, WORLD.height - CELL / 2);
    Matter.Sleeping.set(cube.body, true);
    let now = 0;
    for (let i = 0; i < 600 && g.compactor.strokes < 1; i++) { now += DT; g.update(now); }
    check("one press stroke completed", g.compactor.strokes >= 1);
    check(
      "the press wakes and pushes a sleeping cube (no tunneling)",
      cube.body.position.x > startX + CELL,
      `x ${startX.toFixed(0)} -> ${cube.body.position.x.toFixed(0)}`,
    );
    g.destroy();
  }

  // 3. Removing a cube wakes what rested on it. Two-cube tower, both forced
  //    asleep, bottom blinked out — the survivor must wake (and then fall),
  //    not sleep on air. Drives updateBlinking directly, the same call
  //    Game.update makes.
  {
    const g = new Game(calm);
    const floorY = WORLD.height - CELL / 2;
    const x = WALL_INNER - CELL / 2 - CELL * 3;
    const bottom = cubeAt(g, x, floorY);
    const top = cubeAt(g, x, floorY - CELL);
    Matter.Sleeping.set(bottom.body, true);
    Matter.Sleeping.set(top.body, true);
    bottom.blinkStart = 0;
    const lost = updateBlinking(g.phys.world, g.cubes, 10_000, g.constraints);
    check("the blinked-out cube was removed", lost.length === 1 && g.cubes.length === 1);
    check(
      "its removal wakes the cube that rested on it",
      !top.body.isSleeping,
    );
    g.destroy();
  }
}

// ---------------------------------------------------------------------------
section("Lost-piece mark is revocable (lineClear.ts markLostPieces)");
// ---------------------------------------------------------------------------
{
  const cfg = makeBaseLevel(0);
  const phys = createPhysics(cfg);
  const comp = new Compactor(phys.world, cfg);
  const cutoff = comp.leftX + comp.width / 2 - CELL / 2;
  const body = Matter.Bodies.rectangle(cutoff - 60, WORLD.height - CELL / 2, CELL, CELL, {
    friction: 0.5, frictionAir: 0.012, restitution: 0.05,
    density: 0.001, label: "cube", chamfer: { radius: 3 },
  });
  Matter.Composite.add(phys.world, body);
  const cube: Cube = {
    body, type: "I", color: "#fff", blinkStart: null, material: "standard", struck: true,
  };
  const cubes = [cube];

  markLostPieces(cubes, comp, 1000);
  check("a stranded resting cube is marked", cube.blinkStart === 1000);
  // A break/shove carries it back into the bay before the blink expires — the
  // sentence must be lifted, not executed where the cube no longer is.
  Matter.Body.setPosition(body, { x: cutoff + 100, y: body.position.y });
  markLostPieces(cubes, comp, 1100);
  check("carried back into the bay, the mark is lifted", cube.blinkStart === null);
  Matter.Body.setPosition(body, { x: cutoff - 60, y: body.position.y });
  markLostPieces(cubes, comp, 1200);
  check("re-stranded, it re-marks with a fresh blink", cube.blinkStart === 1200);
}


// ---------------------------------------------------------------------------
section("Congestion tax (level.ts PILE_TIERS / game.ts pileTier)");
{
  // A bay with the tax on. Every assertion here is about PRICING, so the
  // thresholds are set absurdly low and the physics is left to do whatever it
  // likes — what matters is the cube count and the price it implies.
  // Thresholds are EXCLUSIVE (game.ts's pileTier tests `n > t.cubes`), so 8
  // cubes on the field trips a tier written at 7 and not one written at 8.
  // payMult: Infinity throughout — every assertion below is about PRICING or
  // the reload, and a payout cap riding along would quietly be a second
  // variable in each of them. The cap gets its own block at the end.
  const tiers: PileTier[] = [
    { cubes: 3, costMult: 1.5, clockSec: 2, reloadMult: 1, payMult: Infinity },
    { cubes: 7, costMult: 2, clockSec: 5, reloadMult: 1, payMult: Infinity },
  ];
  const congestedCfg: LevelConfig = {
    ...makeBaseLevel(0), pileTiers: tiers, pileAllowance: 0,
  };
  const cg = new Game(congestedCfg, {}, 1);

  check("an empty bay is untaxed", cg.pileTier === null);
  // The reload penalty. Money and clock both come out of stores a player can
  // rebuild by clearing lines; a slower reload is taken in the shots they will
  // never get back, and it is the one a spam volley feels immediately.
  //
  // Tested on the cannon rather than through a populated bay because the
  // interesting property is that the scale is LIVE and reversible — folding it
  // into cooldownMs would make the tax permanent from the moment it first
  // fired, which is the opposite of a rule you can play your way out of.
  {
    const cn = cg.cannon;
    cn.markCooldown(0);
    const listPrice = cn.cooldownRemaining(0);
    check("a clean bay reloads at the level's cooldown",
      Math.round(listPrice) === makeBaseLevel(0).cooldownMs, String(listPrice));
    cn.setCooldownScale(1.5);
    check("the first tier reloads half again as slowly",
      Math.round(cn.cooldownRemaining(0)) === Math.round(listPrice * 1.5),
      String(cn.cooldownRemaining(0)));
    cn.setCooldownScale(2);
    check("the second tier reloads twice as slowly",
      Math.round(cn.cooldownRemaining(0)) === Math.round(listPrice * 2),
      String(cn.cooldownRemaining(0)));
    check("the reload bar reports the congested fill, not the list one",
      Math.abs(cn.reloadRatio(listPrice) - 0.5) < 0.01, String(cn.reloadRatio(listPrice)));
    cn.setCooldownScale(1);
    check("clearing the bay gives the reload back",
      Math.round(cn.cooldownRemaining(0)) === Math.round(listPrice));
  }
  // Crossing into congestion ends the streak. The other three taxes are rates
  // a player can decide to keep paying; a combo can only be charged by being
  // ended, which makes this the part of congestion that cannot be absorbed by
  // firing anyway.
  {
    const g2 = new Game(
      { ...makeBaseLevel(0), pileTiers: [{ cubes: 0, costMult: 1, clockSec: 0, reloadMult: 1, payMult: Infinity }] },
      {}, 1);
    g2.combo = 4;
    g2.update(0);
    check("a clean bay leaves the combo alone", g2.combo === 4, String(g2.combo));
    // cubes > 0 puts it over the `cubes: 0` threshold on the next step.
    g2.shoot(0);
    g2.update(16);
    check("crossing into congestion kills the combo", g2.combo === 0, String(g2.combo));
    // And it charges once, on the transition — not every step it stays there,
    // which would make the combo unrebuildable until the bay was tidied.
    g2.combo = 3;
    g2.update(32);
    check("staying congested does not keep charging", g2.combo === 3, String(g2.combo));
  }

  // The joint ramp, stated where it can be checked: bay 10 is exactly twice
  // bay 1, and bay 1 opens where the old ramp's bay 5/6 sat.
  check("bay 10 bonds are twice bay 1's",
    Math.abs(makeBaseLevel(9).jointBreakStretch - makeBaseLevel(0).jointBreakStretch * 2) < 1e-9,
    `${makeBaseLevel(0).jointBreakStretch} -> ${makeBaseLevel(9).jointBreakStretch}`);
  // The tax has a purchase that answers it. pileAllowance shipped as a seam
  // nothing could move — read by pileTier, swept by sim/pile.ts, and 0 in
  // every real level — so the congestion rule had no counter you could buy.
  // Bay Extension raises it, which is what makes a system the coping
  // mechanism rather than the tax being a flat difficulty knob.
  {
    const allowanceAt = (bay: number): number => {
      const cfg = makeBaseLevel(0);
      applyUpgrades(cfg, { ...newTiers(), bay });
      return cfg.pileAllowance;
    };
    check("a stock rig gets no congestion allowance", allowanceAt(0) === 0,
      String(allowanceAt(0)));
    check("Bay Extension buys room before the tax bites", allowanceAt(3) === 12,
      String(allowanceAt(3)));
    check("the allowance rises with the tier",
      allowanceAt(1) === 4 && allowanceAt(2) === 8,
      `${allowanceAt(1)}/${allowanceAt(2)}`);
  }
  check("an untaxed launch costs the base rate", cg.launchCostNow === congestedCfg.launchCost);

  // A std shipment is 4 cubes, so two launches put 8 on the field — past both
  // thresholds. Stepping only a few frames between them keeps everything alive.
  const fireTwice = (game: Game) => {
    for (let i = 0; i < 2; i++) {
      const t = 10_000 + i * 10_000;
      game.shoot(t);
      for (let s = 0; s < 5; s++) game.update(t + s);
    }
  };
  fireTwice(cg);
  check("8 cubes trips the second tier", cg.cubes.length === 8 && cg.pileTier === tiers[1],
    `${cg.cubes.length} cubes`);
  check("the second tier doubles the launch price",
    cg.launchCostNow === congestedCfg.launchCost * 2, String(cg.launchCostNow));

  // The allowance is the upgrade seam: identical field, higher bar.
  const roomy = new Game({ ...congestedCfg, pileAllowance: 8 }, {}, 1);
  fireTwice(roomy);
  check("an allowance lifts the same field back under the tax",
    roomy.cubes.length === 8 && roomy.pileTier === null,
    `${roomy.cubes.length} cubes, tier ${roomy.pileTier ? "set" : "null"}`);

  // The clock tax, and the reason burnCongestionClock floors at 1ms rather
  // than 0: a bay must be SHORTENED by the tax, never ended by it.
  //
  // Note the ORDER this depends on: shoot() prices the launch and burns the
  // clock from the PRE-shot field, before the new piece exists. So the first
  // launch into an empty bay is always untaxed, however low the threshold —
  // it is the launch AFTER it that pays.
  const clock = new Game(
    { ...makeBaseLevel(0), pileTiers: [{ cubes: 0, costMult: 1, clockSec: 9999, reloadMult: 1, payMult: Infinity }] }, {}, 1);
  clock.shoot(10_000);
  for (let s = 0; s < 5; s++) clock.update(10_000 + s);
  check("the first launch into an empty bay is untaxed", clock.timeLeftMs > 140_000,
    String(clock.timeLeftMs));
  const before = clock.timeLeftMs;
  clock.shoot(20_000);
  check("the next launch, over the threshold, burns clock", clock.timeLeftMs < before,
    String(clock.timeLeftMs));
  check("an absurd clock tax still leaves the bay alive", clock.timeLeftMs > 0,
    String(clock.timeLeftMs));

  // REGRESSION: funds between the base price and the congested price must not
  // strand the bay. shoot() refuses the launch, so if the broke countdown read
  // the BASE cost it would report the player solvent and the bay would sit
  // there saying nothing until the clock ran out.
  const stuck = new Game(
    { ...makeBaseLevel(0), pileTiers: [{ cubes: 0, costMult: 2, clockSec: 0, reloadMult: 1, payMult: Infinity }] }, {}, 1);
  // One launch to put cargo on the field, so the NEXT one is priced congested.
  stuck.shoot(10_000);
  for (let s = 0; s < 5; s++) stuck.update(10_000 + s);
  stuck.score = congestedCfg.launchCost + 1; // affords the base rate, not the doubled one
  check("congested pricing sits above the player's funds", stuck.launchCostNow > stuck.score,
    `cost ${stuck.launchCostNow} vs funds ${stuck.score}`);
  check("the launch is refused", stuck.shoot(20_000) === false);
  // Long enough for the broke grace (one compactor round trip plus a buffer)
  // to elapse — the point is that a verdict ARRIVES, not that it is instant.
  for (let s = 0; s < 4000 && stuck.status === "playing"; s++) stuck.update(20_000 + s * 16);
  check("the bay reaches a verdict instead of stalling",
    stuck.status === "lost" && stuck.lossReason === "broke",
    `status ${stuck.status}, reason ${stuck.lossReason}`);

  // ---- The payout cap (level.ts's payoutMult / PileTier.payMult) -----------
  //
  // The fourth pressure. The other three price the SHOT, which left the
  // stack-and-collapse loop intact: keep stacking until the weight breaks the
  // bottom bonds, pay ONE congested launch fee, and get the whole multi-row
  // collapse at list price.
  {
    const [t1, t2] = PILE_TIERS;
    check("the shipped ladder caps payouts below list",
      t1.payMult === 0.75 && t2.payMult === 0.5, `${t1.payMult}/${t2.payMult}`);
    check("the second knee cuts deeper than the first", t2.payMult < t1.payMult,
      `${t1.payMult} vs ${t2.payMult}`);

    // A clean bay is untouched — the streak is the entire reward for tidy play,
    // and congestion is not allowed to become a tax on recovering from it.
    check("a clean bay pays the streak",
      payoutMult(1, null) === 1 && payoutMult(5, null) === 2,
      `${payoutMult(1, null)} / ${payoutMult(5, null)}`);
    check("the streak climbs by COMBO_STEP",
      payoutMult(3, null) - payoutMult(2, null) === COMBO_STEP);
    check("a combo of 0 is not a negative multiplier", payoutMult(0, null) === 1,
      String(payoutMult(0, null)));

    // Congested, the cap REPLACES the streak rather than scaling it. The combo
    // advances once per CRUSH while the payout scales with the LINES inside it,
    // so scaling would barely dent a four-row collapse.
    check("a congested clear pays the cap, not the streak",
      payoutMult(1, t1) === 0.75 && payoutMult(9, t1) === 0.75,
      `${payoutMult(1, t1)} / ${payoutMult(9, t1)}`);
    check("no streak climbs back over the cap", payoutMult(99, t2) === 0.5,
      String(payoutMult(99, t2)));
    check("every congested payout is below list price",
      [1, 2, 5, 20, 99].every((c) => payoutMult(c, t1) < 1 && payoutMult(c, t2) < 1));
    check("Infinity is the off switch",
      payoutMult(5, { ...t1, payMult: Infinity }) === payoutMult(5, null));

    // THE ORDERING THIS TURNS ON, and the reason stepPileTier exists.
    //
    // updateLineClear pulls the crushed cubes out of `cubes` BEFORE the payout
    // is computed, so the live `pileTier` at that moment describes the bay
    // after it was tidied. Price the collapse with that and a four-row crush
    // off a full stack reads as a clean bay — the tax would miss exactly the
    // play it was added for. stepPileTier is the snapshot from the top of the
    // step: the bay the player actually built and fired into.
    const payTiers: PileTier[] = [
      { cubes: 3, costMult: 1, clockSec: 0, reloadMult: 1, payMult: 0.75 },
      { cubes: 7, costMult: 1, clockSec: 0, reloadMult: 1, payMult: 0.5 },
    ];
    const snap = new Game(
      { ...makeBaseLevel(0), pileTiers: payTiers, pileAllowance: 0 }, {}, 1);
    fireTwice(snap);
    snap.update(30_000);
    check("the step's tier sees the pile the player built",
      snap.stepPileTier === payTiers[1], snap.stepPileTier ? "set" : "null");
    snap.cubes.length = 0; // stands in for the crush emptying the field
    check("the live reading now calls the bay clean", snap.pileTier === null);
    check("but the step's tier still prices the crush",
      snap.stepPileTier === payTiers[1], snap.stepPileTier ? "set" : "null");
    check("so the collapse is paid at the congested rate, not the tidied one",
      payoutMult(1, snap.stepPileTier) === 0.5 && payoutMult(1, snap.pileTier) === 1,
      `${payoutMult(1, snap.stepPileTier)} vs ${payoutMult(1, snap.pileTier)}`);
    // And the snapshot is a SNAPSHOT, not a stuck value: step again on the now
    // empty field and it agrees with the live reading.
    snap.update(30_016);
    check("the next step re-reads the tidied bay", snap.stepPileTier === null);
  }

  // ---- The cue event (game.ts's onCongestion) ------------------------------
  //
  // What lib/audio.ts's setCongestion is driven by. The contract is the whole
  // value here: fire on CROSSINGS in both directions, and not in between. The
  // cue is a rising static bed and a lowpass on the music, so a missed
  // downward crossing leaves a tidy bay sounding congested for the rest of the
  // level, and firing every step would restart the ramp 60 times a second.
  {
    const seen: number[] = [];
    const cue = new Game(
      {
        ...makeBaseLevel(0),
        pileTiers: [
          { cubes: 0, costMult: 1, clockSec: 0, reloadMult: 1, payMult: Infinity },
          { cubes: 5, costMult: 1, clockSec: 0, reloadMult: 1, payMult: Infinity },
        ],
      },
      { onCongestion: (tier) => seen.push(tier) },
      1,
    );
    cue.update(0);
    check("a clean bay says nothing at all", seen.length === 0, seen.join(","));

    fireTwice(cue); // a std shipment is 4 cubes, so this clears both rungs
    check("crossing up reports the rung it reached",
      seen.length > 0 && seen[seen.length - 1] === 2, seen.join(","));
    check("it reports the rungs in order, not just the last",
      seen.join(",") === "1,2", seen.join(","));

    const afterUp = seen.length;
    for (let i = 0; i < 20; i++) cue.update(30_000 + i * 16);
    check("staying congested does not keep firing", seen.length === afterUp, seen.join(","));

    // The direction the combo break deliberately ignores, and the one a cue
    // cannot afford to: something has to say the mess is gone.
    cue.cubes.length = 0;
    cue.update(31_000);
    check("tidying the bay takes the cue back", seen[seen.length - 1] === 0, seen.join(","));

    // 0 is a clean bay, and `tiers` lets a consumer normalise without knowing
    // how long this bay's ladder is — main.ts scales the cue by tier / tiers.
    const ladder: number[] = [];
    const two = new Game(
      { ...makeBaseLevel(0), pileTiers: [
        { cubes: 0, costMult: 1, clockSec: 0, reloadMult: 1, payMult: Infinity },
      ] },
      { onCongestion: (_t, tiers) => ladder.push(tiers) },
      1,
    );
    fireTwice(two);
    check("the event reports the ladder's own length",
      ladder.length > 0 && ladder.every((n) => n === 1), ladder.join(","));
  }
}

// ---------------------------------------------------------------------------
section("Escalating hazard ladders (hazards.ts TIME_LADDER / COST_LADDER)");
{
  // The whole point of the shape: notch N+1 must cost strictly more than notch
  // N. Under the flat step this replaced, every notch cost the same, so the
  // axis a player opened early stayed the cheapest card on the table forever.
  for (const [name, ladder] of [["time", TIME_LADDER], ["cost", COST_LADDER]] as const) {
    let strictlyRising = true;
    let prevRung = 0;
    for (let n = 1; n <= 10; n++) {
      const rung = notchTotal(ladder, n) - notchTotal(ladder, n - 1);
      // COST_LADDER opens 1,1 — deliberately flat for exactly one step, so the
      // first two levies feel the same and the third is where it bites.
      if (n > 2 && rung <= prevRung) strictlyRising = false;
      prevRung = rung;
    }
    check(`the ${name} ladder never gets cheaper per notch`, strictlyRising);
  }

  check("notchTotal(time, 0) is free", notchTotal(TIME_LADDER, 0) === 0);
  check("notchTotal(time, 3) sums 1+2+3", notchTotal(TIME_LADDER, 3) === 6,
    String(notchTotal(TIME_LADDER, 3)));
  check("notchTotal(cost, 5) sums 1+1+2+3+5", notchTotal(COST_LADDER, 5) === 12,
    String(notchTotal(COST_LADDER, 5)));
  // Past the table the recurrence continues rather than clamping — a Mark-10
  // run taking two notches a bay can walk off the end of the written rungs.
  check("the time ladder continues past its table",
    notchTotal(TIME_LADDER, 7) === 32 + 21, String(notchTotal(TIME_LADDER, 7)));

  // And the axes actually spend it.
  const base = makeBaseLevel(0);
  const oneLevy = applyRatchets(base, { cost: 1 });
  const fiveLevies = applyRatchets(base, { cost: 5 });
  check("one levy costs the first rung",
    oneLevy.launchCost === base.launchCost + 1, String(oneLevy.launchCost));
  check("five levies cost the cumulative ladder",
    fiveLevies.launchCost === base.launchCost + 12, String(fiveLevies.launchCost));

  // The ladder STARTS higher the further you have got — one rung per TWO
  // Marks (hazards.ts's ladderStart), not per Mark. The full-Mark slide was
  // measured fatal: sim/marks.ts read Marks 5-10 as 0% run-clear under it,
  // and at Mark 10 the FIRST Shift Cut cost rung 9 = 89s, an instant clock
  // floor. First-notch prices now grow linearly with the Mark
  // (1,1,2,2,3,3,5,5,8,8s), matching the linear build budget, while a run's
  // own repeats still climb the full Fibonacci from wherever they start.
  {
    const m1 = applyRatchets(makeBaseLevel(0, 1), { time: 1 });
    const m3 = applyRatchets(makeBaseLevel(0, 3), { time: 1 });
    const m5 = applyRatchets(makeBaseLevel(0, 5), { time: 1 });
    const m10 = applyRatchets(makeBaseLevel(0, 10), { time: 1 });
    const cut = (c: LevelConfig, at: number): number =>
      makeBaseLevel(0, at).timeLimitSec - c.timeLimitSec;
    check("a Mark-1 first cut costs the first rung", cut(m1, 1) === TIME_LADDER[0],
      String(cut(m1, 1)));
    check("a Mark-3 first cut starts one rung up", cut(m3, 3) === TIME_LADDER[1],
      String(cut(m3, 3)));
    check("a Mark-5 first cut starts two rungs up", cut(m5, 5) === TIME_LADDER[2],
      String(cut(m5, 5)));
    check("a Mark-10 first cut is steep, never fatal", cut(m10, 10) === TIME_LADDER[4],
      String(cut(m10, 10)));
    // The SHAPE survives the slide — still Fibonacci, just never as cheap.
    const m5two = applyRatchets(makeBaseLevel(0, 5), { time: 2 });
    check("a slid ladder still compounds",
      makeBaseLevel(0, 5).timeLimitSec - m5two.timeLimitSec === TIME_LADDER[2] + TIME_LADDER[3],
      String(makeBaseLevel(0, 5).timeLimitSec - m5two.timeLimitSec));
  }

  const threeCuts = applyRatchets(base, { time: 3 });
  check("three shift cuts take 1+2+3 seconds",
    threeCuts.timeLimitSec === base.timeLimitSec - 6, String(threeCuts.timeLimitSec));
  // The floor still holds, and matters MORE under Fibonacci than it did under a
  // flat step — the ladder reaches it in far fewer notches.
  const manyCuts = applyRatchets(base, { time: 12 });
  check("the clock floor still holds at depth", manyCuts.timeLimitSec === 45,
    String(manyCuts.timeLimitSec));
}

// ---------------------------------------------------------------------------
section("Music beds (run ladder + Contract picks vs public/audio/music)");
{
  // The one bed that plays OUTSIDE a bay. Mirrored from lib/audio.ts's
  // MusicName rather than imported: that module reads import.meta.env at load
  // and reaches for Audio/AudioContext, so it cannot be pulled into a Node
  // harness at all. One literal is a cheap price for checking the shipped set
  // against what the game actually asks for.
  const SCREEN_BEDS = ["menu"];

  const beds = Array.from({ length: RUN_LEVELS }, (_, i) => bayMusic(i));
  const trace = beds.map((b, i) => `${i + 1}:${b}`).join(" ");
  /** The bay a bed is NAMED for, which is not always the bay playing it. */
  const bayOf = (bed: string): number => Number(bed.slice(4));

  check("bay 1 opens on its own bed", beds[0] === "bay-1", beds[0]);
  // The 5/4 bed is assigned on the bay NUMBER rather than on difficulty, which
  // makes it the one row a reshuffle can quietly move. Pin both halves.
  check("bay 5 gets the 5/4 bed", beds[4] === "bay-5", beds[4]);
  check("nothing but bay 5 gets it", beds.filter((b) => b === "bay-5").length === 1, trace);
  // This ties the table's LENGTH back to RUN_LEVELS through the naming
  // convention: lengthen the run without extending the ladder and the extra
  // bays clamp onto bay-10, so the closer would play over the last three. Fails
  // here rather than being found by ear at the end of a twenty-minute run.
  check("the last bay plays the bed named for it",
    beds[RUN_LEVELS - 1] === `bay-${RUN_LEVELS}`, beds[RUN_LEVELS - 1]);
  // A bay may borrow an EARLIER bay's bed — 2-4 do, until their songs exist —
  // but never a later one, and the arc never runs backwards. Two halves of the
  // same guard, catching a mis-numbered row from either side.
  check("no bay borrows a later bay's bed", beds.every((b, i) => bayOf(b) <= i + 1), trace);
  check("the arc never runs backwards",
    beds.every((b, i) => i === 0 || bayOf(b) >= bayOf(beds[i - 1])), trace);

  // ---- Contract beds ------------------------------------------------------
  // Contracts have no theme of their own: each borrows a bay's bed, with two
  // overrides on top. All three layers are checked, and so is the order they
  // beat each other in, because the ORDER is the part that reads as arbitrary
  // and is not.
  const day = dailyContracts(1, 20260822);
  const never = () => 1;   // a roll that can never be the special
  const always = () => 0;  // a roll that always is
  const withSize = (c: typeof day[0], size: PieceSize, r: () => number) =>
    contractBed({ ...c, pieceSize: size }, r);

  check("the day deals one Contract per slot", day.length === DAILY_COUNT, String(day.length));
  check("slots are 0,1,2 in order", day.every((c, i) => c.slot === i),
    day.map((c) => c.slot).join(","));

  const std = day.map((c) => withSize(c, "std", never));
  check("Contracts 1-3 borrow bays 1-3", std.join(" ") === "bay-1 bay-2 bay-3", std.join(" "));
  // Distinct is the point of indexing by slot rather than rolling: the three
  // cards on the board must never sound like each other. This also catches
  // DAILY_COUNT growing past the slot table, where slot 3 would wrap to bay 1.
  check("no two of the day's Contracts share a bed",
    new Set(std).size === std.length, std.join(" "));

  // The joke: a five-cube shipment gets the bed written in 5/4, from any slot.
  const bulk = day.map((c) => withSize(c, "bulk", never));
  check("a pentomino Contract gets the 5/4 bed", bulk.every((b) => b === "bay-5"), bulk.join(" "));
  check("a domino Contract does not",
    day.every((c) => withSize(c, "tiny", never) !== "bay-5"));

  // The special outranks both. If it did not, it could never be heard on a
  // pentomino Contract at all — a rare thing that yields to a rule is not rare.
  check("the special beats the slot bed", withSize(day[0], "std", always) === "contract-rare");
  check("the special beats the 5/4 rule", withSize(day[0], "bulk", always) === "contract-rare");
  // Both sides of the boundary: `<`, not `<=`.
  check("a roll just under the chance is special",
    contractBed(day[0], () => CONTRACT_RARE_CHANCE - 1e-9) === "contract-rare");
  check("a roll exactly at the chance is not",
    contractBed(day[0], () => CONTRACT_RARE_CHANCE) !== "contract-rare");
  check("the special is rare by construction",
    CONTRACT_RARE_CHANCE > 0 && CONTRACT_RARE_CHANCE <= 0.1, String(CONTRACT_RARE_CHANCE));

  // The rate MEASURED through the real function, off a seeded stream so this is
  // a check and not a coin flip in CI. Catches the wiring being right and the
  // frequency being wrong — a flipped comparison, or a constant read but not
  // used, both of which pass every assertion above.
  {
    const rng = mulberry32(20260822);
    const N = 20000;
    let specials = 0;
    for (let i = 0; i < N; i++) if (contractBed(day[0], rng) === "contract-rare") specials += 1;
    const rate = specials / N;
    check("the special lands at about its stated rate",
      Math.abs(rate - CONTRACT_RARE_CHANCE) < 0.005, `${(rate * 100).toFixed(2)}%`);
  }

  // The check that catches drift between this ladder and prepare-audio.mjs's
  // MUSIC map — the failure neither typecheck nor the browser will report. A
  // bed with no file behind it is a SILENT bay: playMusic's fetch 404s, the
  // catch swallows it by design, and the only symptom is one stretch of the run
  // playing nothing. Set EQUALITY rather than a subset, so the reverse — an
  // orphaned track hauled around in the PWA precache for nothing — fails too.
  // Every bed a Contract can draw is in `wanted` on its own account: they
  // happen to be bay beds today apart from the special, and must each still
  // resolve to a real file if that stops being true.
  const musicDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), "..", "public", "audio", "music",
  );
  const shipped = new Set(
    fs.readdirSync(musicDir).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)),
  );
  const wanted = new Set([...SCREEN_BEDS, ...beds, ...std, ...bulk, "contract-rare"]);
  const absent = [...wanted].filter((n) => !shipped.has(n));
  const orphaned = [...shipped].filter((n) => !wanted.has(n));
  check("every bed the game asks for is shipped", absent.length === 0, absent.join(", "));
  check("no music file ships unclaimed", orphaned.length === 0, orphaned.join(", "));
}


console.log(
  failures === 0
    ? "\nAll systems checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
