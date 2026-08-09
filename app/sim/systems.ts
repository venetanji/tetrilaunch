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
import { makeBaseLevel } from "../src/game/level";
import {
  HAZARDS, hazardById, hazardOffers, hazardsForMark, picksPerBay, applyRatchets,
  materialRate, totalNotches, MATERIAL_CAP, TARGET_NOTCH, COST_NOTCH, TIME_NOTCH,
  CAPSTONE_MARK, type Ratchets,
} from "../src/game/hazards";
import { applyMods, draftOffers, MODS, mulberry32 } from "../src/game/mods";
import { Cannon } from "../src/game/cannon";
import { Compactor } from "../src/game/compactor";
import { createPhysics, WORLD, WALL_INNER } from "../src/game/engine";
import {
  fillsSlots, strikeCryo, shatterColdCryo, updateLineClear, CRYO_STRIKE_SPEED,
  volatileBlast, tarWelds, alignMagnetic, VOLATILE_TRIGGER_SPEED,
} from "../src/game/lineClear";
import type { Cube } from "../src/game/pieces";
import type { Material, PieceType } from "../src/game/theme";
import {
  applyUpgrades, newTiers, nextTierCost, tiersCost, MAX_TIER, TIER_COSTS, UPGRADES,
  budgetForMark, buyLoadoutTier, FULL_BUILD_COST, loadoutLegal, MARK_COUNT,
} from "../src/game/upgrades";
import {
  contractClaimed, markUnlocked, newMeta, recordContractClear, recordRunEnd, safeLoadout,
  tierSalvage, TIER_CONTRACTS_REQUIRED, TIER_SALVAGE_BASE,
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
  contractEfficiency, contractMaterialTier, CONTRACT_MATERIAL_CAP,
} from "../src/game/contracts";
import {
  pieceCells, SIZE_SPEC, createTetrisPiece, updateBreakableJoints, breakJointsInBand,
} from "../src/game/pieces";
import { tilesRegion } from "../src/game/tiling";
import { computeLayout, setSafeAreaInsets, RAIL_MIN } from "../src/game/layout";
import { PIECE_TYPES, MATERIALS, MATERIAL_SPEC, type PieceSize } from "../src/game/theme";
import { CELL } from "../src/game/engine";
import {
  endBoard, fullBoard, END_BOARD_TOP, contractsScreen, workshopScreen, refitScreen,
  contractEndModal,
} from "../src/ui/screens";
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

  const shop = workshopScreen(freshMeta({ salvage: 50 }), "systems");
  const shopOpts = workshopScreen(freshMeta({ salvage: 50 }), "options");
  check("the Workshop offers an install to buy", shop.includes(`data-action="buy-install"`));
  check("the Workshop shows the build budget", shop.includes("build budget"));
  // Tabs, and only the active pane. The whole 500px-of-overflow fix rests on
  // the inactive section NOT being in the output — if both render, the shop is
  // the same length it always was and the CSS is decoration.
  check("both tabs render on either pane",
    shop.includes(`data-tab="systems"`) && shop.includes(`data-tab="options"`) &&
      shopOpts.includes(`data-tab="systems"`) && shopOpts.includes(`data-tab="options"`));
  check("the systems pane omits the option cards",
    shop.includes(`data-action="buy-install"`) && !shop.includes(`data-action="buy-unlock"`));
  check("the options pane omits the install cards",
    shopOpts.includes(`data-action="buy-unlock"`) && !shopOpts.includes(`data-action="buy-install"`));
  check("the build budget survives on the systems tab", shop.includes("build budget"));
  check("the active tab is marked for assistive tech",
    shop.includes(`data-tab="systems" aria-selected="true"`) &&
      shopOpts.includes(`data-tab="options" aria-selected="true"`));
  // An empty pane must still show its tabs, or a player who has installed
  // everything lands on a screen with no way back to the other half.
  const richMeta = freshMeta({ salvage: 99999, mark: MARK_COUNT });
  let allIn = richMeta;
  for (const i of INSTALLS) { const n = buyInstall(allIn, i.id); if (n) allIn = n; }
  const shopFull = workshopScreen(allIn, "systems");
  check("an exhausted systems pane keeps its tabs", shopFull.includes(`data-tab="options"`));
  // Both card kinds carry a glyph and a body wrapper, or the row layout has
  // nothing to put in its tracks and Options rows sit at a different left edge
  // from Systems rows.
  check("an option card carries its glyph",
    shopOpts.includes(`class="shop-card__name"><svg`),
    shopOpts.slice(shopOpts.indexOf("shop-card__name"), shopOpts.indexOf("shop-card__name") + 80));
  check("both card kinds wrap name and desc in a body",
    shop.includes(`class="shop-card__body"`) && shopOpts.includes(`class="shop-card__body"`));
  check("a Mark-gated system is shown, locked, rather than hidden",
    shop.includes("Bond Emitter") && shop.includes("Needs Mark 2"),
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
  const stockRefit = refitScreen({ bayNum: 3, nextBayName: "X", scrap: 999, tiers: newTiers() });
  check("an uninstalled track shows no refit button",
    stockRefit.includes("Not installed") && !stockRefit.includes(`data-upgrade="reactor"`));
  const oneUp = refitScreen({ bayNum: 3, nextBayName: "X", scrap: 999, tiers: { ...newTiers(), reactor: 1 } });
  check("an installed track shows its next tier", oneUp.includes(`data-upgrade="reactor"`));
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
  // tightest generated one must leave room for an imperfect attempt.
  check(`tightest contract keeps headroom (${worstRatio.toFixed(2)}x)`, worstRatio >= 1.05);
  check("no contract ships bulk pentominoes", !everBulk);
  check("contract materials are always countable and priced", !everSlagOrUnpriced);
  check("no material appears before its hazard rung", !everEarlyMaterial);
  check("material contracts ship std payloads", !everMaterialOffStd);

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

  // --- Tier award ------------------------------------------------------------
  // Salvage moved from per-run/per-contract trickles to a single award on TIER
  // COMPLETION (playtest call, 2026-08-08). The award must rise with the tier
  // (the ladder stays worth climbing) and clamp below tier 1.
  let payoutMonotone = true;
  for (let t = 2; t <= 12; t++) {
    if (tierSalvage(t) <= tierSalvage(t - 1)) payoutMonotone = false;
  }
  check("tier award rises with tier", payoutMonotone);
  check("award clamps below tier 1", tierSalvage(0) === tierSalvage(1));

  // A Contract clear pays NOTHING by itself — that is the whole reform. The
  // first completion (tier 1) must still be transformative: it has to fund at
  // least two entry installs, or the tree's on-ramp is out of reach of the
  // player who just proved themselves against a full tier.
  const cheapestInstall = Math.min(...INSTALLS.map((i) => i.cost));
  check(
    `tier 1 completion funds at least two entry installs (${TIER_SALVAGE_BASE} vs ${cheapestInstall}×2)`,
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

  // The end-of-Contract modal's layout hooks. Measured in a real WebView at the
  // device's 792x360 landscape viewport, the win screen stacked to 477px inside
  // a 322px box and SCROLLED — the payout sat below the fold on the screen whose
  // job is to report it. app.css lays the stats, the payout and the buttons out
  // in wrapping ROWS off these three classes; heights can only be checked in a
  // browser, but their absence can be caught here.
  const endOpts = {
    name: "Exact Manifest", kind: "pattern" as const, lines: 4, goal: 4,
    launchesUsed: 8, launches: 0, queue: ["I", "O", "T"] as PieceType[],
    cubesWasted: 0, salvageTotal: 66,
    progress: { tier: 1, runDone: false, contracts: 1, needed: 3, award: 60 },
  };
  const ceWin = contractEndModal({
    ...endOpts, won: true, award: { salvage: 60, firstClear: true, completedTier: null },
  });
  const ceLoss = contractEndModal({ ...endOpts, won: false, award: null });
  for (const [label, html] of [["win", ceWin], ["loss", ceLoss]] as const) {
    check(`the ${label} contract modal opts into the end-of-Contract layout`,
      html.includes("modal--contract-end"));
    check(`its ${label} stats and buttons sit in the wrapping rows`,
      html.includes("ce__cols") && html.includes("ce__stats") && html.includes("ce__btns"));
    // The inline width is what pinned the panel to 460px inside a 792px
    // viewport — the whole reason it had no room to lay out sideways.
    check(`the ${label} modal takes its width from CSS, not an inline cap`,
      !html.includes("width:min(460px"));
  }
  check("only a won contract shows a payout block", ceWin.includes("ce__reward") && !ceLoss.includes("ce__reward"));
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
  check("scrap accumulates", run.scrap === 26 && run.scrapEarned === 26);
  check("the ratcheted axis is recorded", run.ratchets.cost === 1);
  check("levelIndex advanced", run.levelIndex === 1);
  // The capstone hands two axes at once, and the same axis twice is a legal
  // (and grim) pick — so the ratchet counts rather than collecting ids.
  const twice = advanceRun(run, 800, 800, 0, 0, ["cost", "time"]);
  check("a second notch on an axis stacks rather than replacing",
    twice.ratchets.cost === 2 && twice.ratchets.time === 1);
  check("advanceRun never mutates the run's ratchets", run.ratchets.cost === 1);
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
  check(
    `the ten-tier ladder (${ladderTotal}) covers most of the ${total}-salvage tree`,
    ladderTotal >= total * 0.8 && ladderTotal <= total * 1.3,
  );
}

// ---------------------------------------------------------------------------
section("Tier completion is the only salvage source (meta.ts)");
// ---------------------------------------------------------------------------
{
  const board = (tier: number) =>
    Array.from({ length: TIER_CONTRACTS_REQUIRED }, (_, i) => ({ id: `t${tier}-c${i}`, tier }));

  // Neither half alone completes a tier. The run win ticks its half and pays
  // nothing; a full board of Contracts ticks the other half and pays nothing.
  const runOnly = recordRunEnd(newMeta(), 1, true, 10);
  check("a won run alone completes no tier", runOnly.completedTier === null && runOnly.salvage === 0);
  check("the run half is recorded", runOnly.meta.tierRunDone);
  check("a run alone banks no salvage", runOnly.meta.salvage === 0);

  let contractsOnly = { meta: newMeta(), completedTier: null as number | null, salvage: 0 };
  for (const c of board(1)) contractsOnly = { ...recordContractClear(contractsOnly.meta, c) };
  check("a full board alone completes no tier", contractsOnly.completedTier === null);
  check(
    "the contract half is recorded",
    contractsOnly.meta.tierContracts === TIER_CONTRACTS_REQUIRED,
  );

  // Both halves together: the tier completes, pays its award, raises the Mark,
  // and resets both counters for the next tier — in either order.
  const both = recordRunEnd(contractsOnly.meta, 1, true, 10);
  check("run + contracts completes tier 1", both.completedTier === 1);
  check("completion pays the tier award", both.salvage === tierSalvage(1) && both.meta.salvage === tierSalvage(1));
  check("completion raises the Mark", both.meta.mark === 1 && markUnlocked(both.meta) === 2);
  check("completion resets both halves", !both.meta.tierRunDone && both.meta.tierContracts === 0);

  let other = recordRunEnd(newMeta(), 1, true, 10).meta;
  let last: number | null = null;
  for (const c of board(1)) {
    const r = recordContractClear(other, c);
    other = r.meta; last = r.completedTier;
  }
  check("the completing event can be a Contract", last === 1);

  // What does NOT count: a duplicate Contract id, a Contract from another
  // tier, a lost run, and a won run flown at a Mark below the current tier.
  const dup = recordContractClear(both.meta, { id: "t1-c0", tier: 2 });
  check("a replayed Contract counts nothing", !dup.firstClear && dup.meta.tierContracts === 0);
  const offTier = recordContractClear(both.meta, { id: "elsewhere", tier: 9 });
  check("an off-tier Contract logs but does not tick", offTier.firstClear && offTier.meta.tierContracts === 0);
  const lost = recordRunEnd(newMeta(), 1, false, 4);
  check("a lost run ticks nothing", !lost.meta.tierRunDone && lost.meta.salvage === 0);
  check("a lost run still counts as a run", lost.meta.runs === 1 && lost.meta.bestBay === 4);
  const stale = recordRunEnd(both.meta, 1, true, 10);
  check("beating an old Mark does not tick the current tier", !stale.meta.tierRunDone);
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

  // The three base axes are flat now. A ramp nobody can lose to was only ever a
  // longer bay — see level.ts's calibration note.
  const bays = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, 1));
  check("the funding target is flat across a run",
    bays.every((b) => b.targetScore === bays[0].targetScore), `${bays.map((b) => b.targetScore).join(",")}`);
  check("launch cost is flat across a run",
    bays.every((b) => b.launchCost === bays[0].launchCost));
  check("the clock is flat across a run",
    bays.every((b) => b.timeLimitSec === bays[0].timeLimitSec));
  // A Mark no longer moves any of the ladder's numbers — it only changes which
  // hazards and systems exist.
  check("a Mark changes no number on the base ladder",
    Array.from({ length: MARK_COUNT }, (_, m) => makeBaseLevel(5, m + 1))
      .every((b) => b.targetScore === makeBaseLevel(5, 1).targetScore
        && b.compactorSpeed === makeBaseLevel(5, 1).compactorSpeed));

  // ---- The ladder: every Mark means something -----------------------------
  check("Mark 1 opens exactly the three base axes",
    hazardsForMark(1).length === 3
      && hazardsForMark(1).every((h) => h.kind === "number"),
    hazardsForMark(1).map((h) => h.id).join(","));
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
  check("a target notch raises the target by exactly one step",
    applyRatchets(flat, { target: 1 }).targetScore === flat.targetScore + TARGET_NOTCH);
  check("notches stack linearly",
    applyRatchets(flat, { target: 3 }).targetScore === flat.targetScore + TARGET_NOTCH * 3);
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
  let oneContentMax = true;
  for (let m = 1; m <= MARK_COUNT; m++) {
    for (let bay = 0; bay < 10; bay++) {
      const offer = hazardOffers(1234 + bay, bay, m);
      if (offer.filter((h) => h.kind === "content").length > 1) oneContentMax = false;
      if (offer.length < picksPerBay(m)) oneContentMax = false;
      if (new Set(offer.map((h) => h.id)).size !== offer.length) oneContentMax = false;
    }
  }
  check("every hand holds at most one material, enough cards, and no duplicates", oneContentMax);
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
  // Contracts now ship materials (the pentomino complication's replacement),
  // but only the ones their budget model can price: slag can never count
  // toward a line, so it must never appear, and a pattern Contract's exact
  // tiling admits no material at all. The belt must match the Contract's own
  // material/rate fields byte-for-byte — those fields are what launchesFor
  // priced, and a mix that drifts from them is a budget lying about its bay.
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
      if (c.kind === "pattern" && c.material !== null) dirtyContracts++;
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

console.log(
  failures === 0
    ? "\nAll systems checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
