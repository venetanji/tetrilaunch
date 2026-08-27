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
import { Game, AUTO_SPREAD_RAD, AUTO_POWER_JITTER, STRAND_WARN_DELAY_MS } from "../src/game/game";
import {
  makeBaseLevel, payoutMult, BASE_BREAK_STRETCH, BOND_MARK_STEP, COMBO_STEP,
  LAUNCH_COST_BASE, LAUNCH_COST_TOP, TARGET_BASE, TARGET_PER_BAY,
  TARGET_PER_BAY_PER_TIER, TARGET_PER_TIER, TIER_COUNT, TIME_BASE, TIME_PER_TIER,
  tierDemands,
  PILE_TIERS, UNBREAKABLE_MARK, WIND_GUST_FRACTION,
  penaltyPerLostPieceFor, SPILL_FINE_TIER1, SPILL_FINE_TOP_BASE, SPILL_FINE_TOP_PER_BAY,
  bombResupply, SLAG_BOUNTY, DEMO_RESUPPLY_LINES, SCRAP_PER_BAY,
  VOLATILE_LOSS_SHARE,
  DEMO_BLAST_MULT, DEMO_SALVAGE_MULT, NO_MATERIALS,
  type LevelConfig, type MaterialMix, type PileTier,
} from "../src/game/level";
import { BELT_CEILING, MATERIAL_GAP, mixTotal } from "../src/game/belt";
import { BOTS } from "./bots";
import {
  HAZARDS, hazardById, hazardOffers, hazardsForMark, isMaterialDraft, MATERIAL_DRAFT_BAYS,
  picksPerBay, applyRatchets, togglePick,
  materialRate, totalNotches, MATERIAL_CAP, MIX_TOTAL_CAP, TARGET_NOTCH, COST_NOTCH, TIME_NOTCH,
  CAPSTONE_MARK, TIME_LADDER, COST_LADDER, notchTotal,
  type HazardDef, type HazardId, type Ratchets,
} from "../src/game/hazards";
// The winnability harness (sim/draft-space.ts, sim/deeprun.ts, sim/counters.ts,
// sim/builds.ts) — its section is at the bottom of this file.
import {
  comboKey, dodgePolicy, enumerateSpace, legalHands, randomSpec, rungFor, spreadPolicy,
} from "./draft-space";
import { greedyRefit, runDeepRun } from "./deeprun";
import { runBay } from "./runner";
import { loadoutFor, PRIORITY_ORDERS } from "./builds";
import {
  BOND_MIN_CUBES, bondHands, CUSHION_TRIGGER_MULT, cushionKit, cushionThreshold, thawHands,
} from "./counters";
import { previewRows, type PreviewRow } from "../src/game/preview";
import { applyMods, draftOffers, MODS, mulberry32 } from "../src/game/mods";
import {
  AIM_CONE, AIM_HIT_TOL, AIM_LOFT_DEFAULT, Cannon, CANNON, MIN_FIRE_RATIO, powerRatioForDrag,
  predictTrajectory, solveAimForTarget, SPEED_MAX, SPEED_MIN,
} from "../src/game/cannon";
import {
  CHUTE, CHUTE_MOUTH_X0, CHUTE_SURFACE_Y, chuteMouth, chuteRightEdge, inChute, pathStrands,
} from "../src/game/chute";
import { screenToWorld } from "../src/game/render";
import { Compactor } from "../src/game/compactor";
import { createPhysics, WORLD, WALL_INNER } from "../src/game/engine";
import {
  fillsSlots, strikeCryo, shatterColdCryo, updateLineClear, CRYO_STRIKE_SPEED,
  volatileBlast, tarWelds, alignMagnetic, VOLATILE_TRIGGER_SPEED, updateBlinking,
  volatileLossFor, settleBlast,
  markLostPieces, slagBountyFor,
} from "../src/game/lineClear";
import type { Cube } from "../src/game/pieces";
import type { Material, PieceType } from "../src/game/theme";
import {
  applyUpgrades, newTiers, nextTierCost, refitTracks, tiersCost, upgradeById,
  clearTrack, orderCost, orderRungs, orderSize, orderedTier, orderedTiers, stageTier,
  MAX_TIER, TIER_COSTS, UPGRADES, type RefitOrder, type UpgradeTiers,
  budgetForMark, buyLoadoutTier, FULL_BUILD_COST, loadoutLegal, MARK_COUNT,
} from "../src/game/upgrades";
import {
  contractClaimed, markUnlocked, markUnlockCelebrated, newMeta, pendingUnlockMark,
  recordContractClear, recordRunEnd, safeLoadout,
  tierProgressFor, tierSalvage, tierMilestoneSalvage, TIER_CONTRACTS_REQUIRED, TIER_SALVAGE_BASE,
  UNLOCKS, unlockAvailable, draftSlots, DRAFT_BASE_SLOTS, DRAFT_FULL_SLOTS,
  DRAFT_THIRD_SLOT_CONTRACTS, INSTALLS, installById, installAvailable, installGates,
  buyInstall, markBudget, nextStep, refundRetiredUnlocks, UPRATE_MAX_TIER,
  pendingLadderRide, pendingSkydeck, sealBreakOwed, sealBreakShown, skydeckCelebrated,
  skydeckOpen, tierOpenableBy, unsealedMarks,
  type InstallDef, type MetaState,
} from "../src/game/meta";
import {
  advanceRun, bayMusic, bondChargesFor, buyUpgrade, buyUpgrades, isFinalDraft, isRefitBay, levelForRun,
  newRun, refitAfterBay, finalDraftFor, baysUntilRefitFor, picksForRun, standingClauses,
  tracksLadder, retryBreaksSeal, sealStateFor, CARRY_CAP, REFIT_EVERY, RUN_LEVELS, SKYDECK_PICKS_PER_BAY, type RunState,
} from "../src/game/run";
// Node has no localStorage, so telemetry.recording() is false here and nothing
// in this module records — which is exactly what makes runMode safe to import:
// it is a pure tag function, and it is the one thing sim/playtest.ts's whole
// grouping turns on.
import * as telemetry from "../src/lib/telemetry";
import {
  CLAUSE_STOPS, clauseDefs, dealableAt, schedulesDeadCargo, skydeckRulesFor, skydeckRunFor,
  skydeckSeed,
} from "../src/game/skydeck";
import {
  FINALS, FINAL_MATERIAL_CAP, applyFinal, applyFinals, finalById, finalsForTier, type FinalId,
} from "../src/game/finals";
import {
  dailyContracts, dailySeed, dealPatternQueue, generateContract, levelForContract, contractBed,
  contractSlotBed, CONTRACT_BED_TOP_BASE,
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
import {
  applySandboxMaterials, bumpSandboxRatchet, finalFitsTier, maxedTiers, newSandbox,
  ratchetTotal, sandboxAxes, sandboxFinals, sandboxRunFor, SANDBOX_FINAL_BAY,
  SANDBOX_MATERIALS, SANDBOX_RATCHET_MAX,
  type SandboxState,
} from "../src/game/sandbox";
import { sandboxScreen } from "../src/ui/sandbox-screen";
import { applyCheat, cheatRowHTML } from "../src/lib/sandbox-cheats";
import { DEV_TAPS_REQUIRED, DEV_TAP_WINDOW_MS, TapStreak } from "../src/lib/devmode";
import { InputController, wheelNotch } from "../src/game/input";
import { GamepadPoller, stickRate } from "../src/game/gamepad";
import { loadSettings } from "../src/lib/store";
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
  skyTop,
  UI_SCALE_MIN,
} from "../src/game/layout";
import {
  BAY_GLYPH_MATERIALS, glyphInk, MATERIAL_GLYPH, MATERIALS, MATERIAL_SPEC,
  PIECE_COLORS, PIECE_TYPES, type PieceSize,
} from "../src/game/theme";
import { CELL } from "../src/game/engine";
import {
  endBoard, fullBoard, END_BOARD_TOP, contractsScreen, workshopScreen, refitScreen,
  contractEndModal, coachSteps, coachFailSteps, coachFailHTML, controlsScreen, hudHTML,
  menuScreen, salvageHTML,
  collapsingDial, DIAL_COLLAPSE_MS, DIAL_COLLAPSE_HOLD_MS,
} from "../src/ui/screens";
import {
  BINDABLE_ACTIONS, actionForKey, hintAim, hintRotate, keyFor, keyLabel, padFor, padLabel,
  resetKeyBindings, resetPadBindings, setKeyBinding, setPadBinding,
} from "../src/game/bindings";
import { setRailSide } from "../src/game/layout";
import {
  PAD_BACK, PAD_CONFIRM, PAD_CONTROLS, PAD_NAV, pickNext, type NavRect,
} from "../src/ui/padnav";
import * as S from "../src/ui/screens";
import {
  CHAPTERS, GUIDE_TOPICS, drillUnlocked, guideTopics, topicById, topicsIn,
} from "../src/game/guide";
import { DRILLS, levelForDrill } from "../src/game/drills";
import { icon, type IconName } from "../src/ui/icons";
import { runNotchTallyHTML } from "../src/ui/components";
import { BOARD_SANDBOX, isLadderBoard, type ScoreEntry } from "../src/lib/api";

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

/**
 * CIEDE2000 distance between two "#rrggbb" colours.
 *
 * Here rather than in src/ because it is a TEST instrument: nothing the game
 * draws needs to measure a colour difference at runtime, and a palette check
 * that imported its own yardstick from the thing it is checking would be able to
 * pass by changing the yardstick.
 *
 * Plain Euclidean RGB distance would not do. It rates rebar's old #ff8a1f
 * against the L shipment's #ff8a00 as 31 units apart — a number that sounds like
 * a difference — while a human sees one colour. dE00 rates the same pair at 2.0,
 * which is what the eye reports, and that is the whole reason for the arithmetic
 * below.
 */
function deltaE00(hexA: string, hexB: string): number {
  const lab = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [L1, a1, b1] = lab(hexA);
  const [L2, a2, b2] = lab(hexB);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
  const Cp1 = Math.hypot(A1, b1), Cp2 = Math.hypot(A2, b2);
  let h1 = Math.atan2(b1, A1) * deg; if (h1 < 0) h1 += 360;
  let h2 = Math.atan2(b2, A2) * deg; if (h2 < 0) h2 += 360;
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb: number;
  if (Cp1 * Cp2 === 0) hb = h1 + h2;
  else {
    hb = (h1 + h2) / 2;
    if (Math.abs(h1 - h2) > 180) hb += h1 + h2 < 360 ? 180 : -180;
  }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
    + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
  const Rt = -2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7))
    * Math.sin(2 * (30 * Math.exp(-(((hb - 275) / 25) ** 2))) * rad);
  return Math.sqrt(
    (dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh),
  );
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

  // The ladder must raise the floor and the bar TOGETHER: a Mark hands out a
  // bigger build budget (upgrades.ts's budgetForMark) and the tier ladder
  // (level.ts) is the matching rise in what a bay demands.
  check("the mark parameter defaults to 1",
    JSON.stringify(makeBaseLevel(4, 1)) === JSON.stringify(makeBaseLevel(4)));
  check("level.ts's tier count matches the Mark ladder", TIER_COUNT === MARK_COUNT);

  // The three knobs a tier states, at both ends of the ladder. Written as
  // literals rather than re-derived from the constants: these numbers ARE the
  // design decision, and a test that recomputes the formula would agree with any
  // formula at all.
  const t1 = tierDemands(1);
  const top = tierDemands(MARK_COUNT);
  check("Tier 1 opens at $600, 180s, $20 a shot",
    t1.targetScore === 600 && t1.timeLimitSec === 180 && t1.launchCost === 20,
    `$${t1.targetScore}/${t1.timeLimitSec}s/$${t1.launchCost}`);
  check("the top tier opens at $780, 144s, $30 a shot",
    top.targetScore === 780 && top.timeLimitSec === 144 && top.launchCost === 30,
    `$${top.targetScore}/${top.timeLimitSec}s/$${top.launchCost}`);
  // Where a run ENDS is the tier's opening plus the ladder's own per-bay climb
  // (TARGET_PER_BAY, steepened a little by the tier) — the two curves compose,
  // and this is the number that says by how much.
  check("the last bay of a run climbs from $1500 at Tier 1 to $1842 at the top",
    makeBaseLevel(9, 1).targetScore === 1500 && makeBaseLevel(9, MARK_COUNT).targetScore === 1842,
    `${makeBaseLevel(9, 1).targetScore}/${makeBaseLevel(9, MARK_COUNT).targetScore}`);

  // Every rung has to move, or a tier is a no-op the player still paid for.
  let barRises = true;
  let stepRises = true;
  for (let m = 2; m <= MARK_COUNT; m++) {
    const lo = makeBaseLevel(0, m - 1);
    const hi = makeBaseLevel(0, m);
    if (hi.targetScore - lo.targetScore !== TARGET_PER_TIER) barRises = false;
    if (hi.timeLimitSec - lo.timeLimitSec !== -TIME_PER_TIER) barRises = false;
    if (hi.launchCost < lo.launchCost) barRises = false;
    const step = makeBaseLevel(1, m).targetScore - hi.targetScore;
    if (step !== TARGET_PER_BAY + TARGET_PER_BAY_PER_TIER * (m - 1)) stepRises = false;
  }
  check("each tier raises the target and shortens the clock by exactly one step", barRises);
  check("each tier steepens the per-bay target climb", stepRises);
  check("the tier ladder's endpoints match its named constants",
    t1.targetScore === TARGET_BASE && t1.timeLimitSec === TIME_BASE
      && t1.launchCost === LAUNCH_COST_BASE && top.launchCost === LAUNCH_COST_TOP
      && top.targetScore === TARGET_BASE + TARGET_PER_TIER * (MARK_COUNT - 1));

  // A hand-edited save (or a sim caller) must never be able to walk the curve
  // off either end — level.ts's tierOf clamps, and nothing else does.
  // Compared knob by knob rather than as whole configs: makeBaseLevel records
  // the RAW mark on cfg.mark (the ratchet ladders read it), so an absurd mark
  // legitimately shows up there — what must not happen is the tier CURVES
  // extrapolating off either end into a bay nobody can play.
  const sameBar = (a: number, b: number): boolean =>
    tierDemands(a).targetScore === tierDemands(b).targetScore
      && tierDemands(a).timeLimitSec === tierDemands(b).timeLimitSec
      && tierDemands(a).launchCost === tierDemands(b).launchCost
      && makeBaseLevel(0, a).startingFunds === makeBaseLevel(0, b).startingFunds
      && makeBaseLevel(5, a).penaltyPerLostPiece === makeBaseLevel(5, b).penaltyPerLostPiece;
  check("the curve refuses to extrapolate past the ladder",
    sameBar(0, 1) && sameBar(9999, MARK_COUNT));

  // Compactor speed is deliberately Mark-invariant (MARK_SPEED_STEP is 0).
  // sim/marks.ts measured it as an erratic bankruptcy tax rather than a
  // difficulty ramp: a faster sweep pushes pieces out before they settle, and
  // the lost-piece penalty drains the bankroll. Asserted so re-enabling it is a
  // deliberate act with a failing test to read, not a quiet regression.
  check(
    "compactor speed does not scale with Mark",
    makeBaseLevel(0, MARK_COUNT).compactorSpeed === makeBaseLevel(0, 1).compactorSpeed,
  );
  // THE SPILL FINE RAMP (level.ts's penaltyPerLostPieceFor). The fine used to
  // be Mark-invariant — a flat 25 + 2i on the bay index at every tier — which
  // billed a beginner $100 for one bounced tetromino against Tier 1's $160
  // float. It now rides the tier as well: $1 a cube at Tier 1, the historical
  // ladder at Tier 10.
  //
  // The ENDPOINTS are pinned rather than the curve, because the endpoints are
  // what was decided; the straight line between them is an implementation of
  // that decision and a play pass is free to re-shape it (see the derivation)
  // as long as it still starts and ends where the design says.
  check(
    "the spill fine bottoms out at $1 a cube on every Tier 1 bay",
    Array.from({ length: RUN_LEVELS }, (_, i) => makeBaseLevel(i, 1).penaltyPerLostPiece)
      .every((v) => v === SPILL_FINE_TIER1),
  );
  check(
    "the spill fine tops out at the historical 25 + 2i ladder at Tier 10",
    Array.from({ length: RUN_LEVELS }, (_, i) => makeBaseLevel(i, MARK_COUNT).penaltyPerLostPiece)
      .every((v, i) => v === SPILL_FINE_TOP_BASE + SPILL_FINE_TOP_PER_BAY * i),
  );
  // MONOTONICITY, in both arguments and after rounding — the property that
  // makes this a ramp rather than a table. A tier never charges less for the
  // same mistake than the tier below it, and no bay inside a run is cheaper to
  // spill in than the bay before it. Rounding is where a re-shaped curve would
  // break this quietly (a step that lands under half a dollar per tier can
  // round backwards), so it is checked over every (bay, tier) pair rather than
  // argued from the formula.
  let fineRises = true;
  for (let i = 0; i < RUN_LEVELS; i++) {
    for (let m = 1; m <= MARK_COUNT; m++) {
      const here = penaltyPerLostPieceFor(i, m);
      if (m > 1 && here < penaltyPerLostPieceFor(i, m - 1)) fineRises = false;
      if (i > 0 && here < penaltyPerLostPieceFor(i - 1, m)) fineRises = false;
      if (here !== makeBaseLevel(i, m).penaltyPerLostPiece) fineRises = false;
    }
  }
  check("the spill fine never falls with the tier or the bay", fineRises);
  // THE FINE IS A MISTAKE PRICE, NOT A LOSE BUTTON. A bay whose fine can
  // outrun its own float is losable to one bad shot before a line has ever
  // been paid for, and "you still have money" is not the bar — game.ts's fire
  // refuses to launch at all once funds drop below launchCost, so a bankroll
  // stranded under the price of a shot is a dead bay with a non-zero HUD.
  //
  // The invariant is therefore stated in SHOTS, over the worst case a stock
  // bay can produce: the player is on the opening float, pays for one launch,
  // and every cube of that shipment spills.
  //
  //   startingFunds - launchCost - cubes x fine  >=  launchCost
  //            ^ float      ^ the shot that spilled       ^ one more shot
  //
  // `cubes` is read off the BAY's own pieceSize rather than fixed at four or
  // maximised over SIZE_SPEC, which is what makes this the invariant rather
  // than a patch for today's layout: it follows whatever the ladder decides a
  // shipment is. Every Deep Run bay ships "std" today (mods.ts is the only
  // writer of bulk/tiny and the game no longer drafts mods; contracts.ts and
  // drills.ts write it but zero the fine), so what is checked is 4 cubes — and
  // the day a bay ships bulk this fails on its own, which is the point.
  //
  // MEASURED over all 10 bays x 10 tiers. The ramp holds everywhere, tightest
  // at Tier 10 bay 10: $240 - $30 - 4x$43 = $38 against a $30 shot, $8 of
  // slack. The FLAT fine this replaced failed in 32 of those 100 bays — from
  // bay 4 of a Tier 1 run onward ($160 - $20 - 4x$31 = $16 against a $20 shot)
  // down to -$52 at Tier 1 bay 10, where a single fully-spilled shipment on
  // the opening float ended the bay outright. The old pin passed anyway
  // because it asked only whether funds stayed above zero, on one bay, at the
  // one tier the flat fine happened to survive.
  //
  // KNOWN HEADROOM, not a shipped hole: at a bulk shipment's 5 cubes the same
  // arithmetic gives $240 - $30 - 5x$43 = -$5 at Tier 10 bay 10 (8 of 100 bays
  // fail, all at Tiers 8-10). Nothing in a Deep Run can ship bulk, so this is
  // a tripwire for a future feature rather than a live bug — deliberately left
  // as one instead of moving an endpoint the design decided, and reported to
  // the owner as a balance finding.
  let fineLeavesAShot = true;
  const spillDetail: string[] = [];
  for (let i = 0; i < RUN_LEVELS; i++) {
    for (let m = 1; m <= MARK_COUNT; m++) {
      const cfg = makeBaseLevel(i, m);
      const cubes = SIZE_SPEC[cfg.pieceSize].cubes;
      const left = cfg.startingFunds - cfg.launchCost - cubes * cfg.penaltyPerLostPiece;
      if (left < cfg.launchCost) {
        fineLeavesAShot = false;
        spillDetail.push(`T${m} bay ${i + 1}: $${left} left, needs $${cfg.launchCost}`);
      }
    }
  }
  check(
    "a fully spilled shipment always leaves the float another launch",
    fineLeavesAShot,
    spillDetail.slice(0, 4).join("; "),
  );
  // The scope check, and the one that catches the likeliest way to get this
  // wrong: keying the curve off the BAY index `i` (which carries every other
  // ramp in makeBaseLevel) instead of off the mark. Only these may differ
  // between the bottom and the top of the ladder — the three the tier states
  // (target, clock, launch cost), the spill fine the tier now ramps
  // (penaltyPerLostPieceFor), the volatile charge DERIVED from that same fine
  // (VOLATILE_LOSS_SHARE — it rides the spill fine precisely so it ramps with
  // the tier instead of being right at one of them, so it moving here is the
  // intent rather than a leak), the float derived from the launch cost
  // (LAUNCH_BUDGET_SHOTS), the bond ramp a Mark is allowed to move
  // (BOND_MARK_STEP) and the recorded mark itself.
  const lowBay = makeBaseLevel(5, 1) as unknown as Record<string, unknown>;
  const highBay = makeBaseLevel(5, MARK_COUNT) as unknown as Record<string, unknown>;
  const moved = Object.keys(lowBay)
    .filter((k) => JSON.stringify(lowBay[k]) !== JSON.stringify(highBay[k]))
    .sort()
    .join(",");
  check("a tier moves exactly the demand knobs and nothing else",
    moved === "jointBreakStretch,launchCost,mark,penaltyPerLostPiece,startingFunds,"
      + "targetScore,timeLimitSec,volatileLoss",
    moved || "(nothing moved)");

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
  // Both halves matter. The equality proves levelForRun threads the mark; the
  // INEQUALITY proves it threads THE RUN'S mark rather than a constant — before
  // the tier ladder every Mark scored the same target, so the equality alone
  // passed no matter what levelForRun did with the number.
  check(
    "levelForRun uses the run's Mark",
    levelForRun(newRun(9, [], 0, newTiers(), 4)).targetScore === makeBaseLevel(0, 4).targetScore
      && levelForRun(newRun(9, [], 0, newTiers(), 4)).targetScore !== makeBaseLevel(0, 7).targetScore,
  );
  // The whole run, not just its first bay: a later bay must read that bay's
  // rung of the tier's own per-bay climb.
  const deepRun = { ...newRun(9, [], 0, newTiers(), 7), levelIndex: 5 };
  check(
    "levelForRun climbs the tier's per-bay target",
    levelForRun(deepRun).targetScore === makeBaseLevel(5, 7).targetScore
      && levelForRun(deepRun).targetScore > levelForRun(newRun(9, [], 0, newTiers(), 7)).targetScore,
    `${levelForRun(deepRun).targetScore}`,
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
  // The Workshop sells TWO rungs now (meta.ts's UPRATE_MAX_TIER). This check
  // used to assert that a second purchase was refused; that refusal is exactly
  // what made budgetForMark inert, so what is pinned instead is the new cap.
  const uprated = buyInstall({ ...bought!, salvage: 100 }, "reactor");
  check("the Workshop uprates an owned track to tier 2", uprated?.loadout.reactor === 2);
  check("an uprate costs the same as the install",
    uprated?.salvage === 100 - installById("reactor")!.cost, String(uprated?.salvage));
  check("a third rung is refused — tier 3 is the refit stop's scrap",
    buyInstall({ ...uprated!, salvage: 1000 }, "reactor") === null);
  // The rule the whole loadout system rests on: salvage may not buy a rig the
  // Mark does not pay for. Seven tracks at tier 2 is 385 points; a Mark-1
  // budget is 77, so the seventh uprate must be refused for BUDGET, not price.
  {
    const rich = freshMeta({ salvage: 100_000 });
    let m: MetaState = rich;
    let bought7 = 0;
    for (const i of INSTALLS) {
      for (let t = 0; t < 2; t++) {
        const next = buyInstall(m, i.id);
        if (next) { m = next; bought7++; }
      }
    }
    check("unlimited salvage cannot outspend a Mark-1 build budget",
      tiersCost(m.loadout) <= markBudget(m), `${tiersCost(m.loadout)}/${markBudget(m)}`);
    check("...and the budget, not the price, is what stopped it", bought7 < 14);
    check("a Mark never moves on a purchase", m.mark === rich.mark);
  }
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
  const installedShop = workshopScreen(
    freshMeta({ salvage: 500, loadout: { ...newTiers(), reactor: 1 } }));
  check("an owned track stays on the shelf, offering its next tier",
    installedShop.includes(`data-install="reactor"`) && installedShop.includes("T2"));
  const maxedShop = workshopScreen(
    freshMeta({ salvage: 500, loadout: { ...newTiers(), reactor: UPRATE_MAX_TIER } }));
  check("a track at the Workshop's cap leaves the shelf for the strip",
    maxedShop.includes("✓ Installed") && !maxedShop.includes(`data-install="reactor"`));

  // The yard renders on the WORKSHOP'S CARD now, description and all — the
  // whole reason the screen moved (screens.ts's refitScreen). A refit row that
  // states only a name and a number is the shop the Workshop already refused
  // to be, so this pins the sentence rather than the layout.
  const yard = (over: Partial<Parameters<typeof refitScreen>[0]> = {}): string => refitScreen({
    bayNum: 3, nextBayName: "X", scrap: 999, tiers: { ...newTiers(), reactor: 1 },
    mark: 2, order: {}, preview: [], ...over,
  });
  const buyButtons = (html: string): string[] => html.match(/<button[^>]*refit-card__buy[^>]*>/g) ?? [];
  const oneUp = yard();
  check("the yard sells from the Workshop's card",
    (oneUp.match(/class="shop-card refit-card/g) ?? []).length === UPGRADES.length,
    String((oneUp.match(/class="shop-card refit-card/g) ?? []).length));
  check("every track's own sentence reaches the player",
    UPGRADES.every((u) => oneUp.includes(u.blurb)),
    UPGRADES.filter((u) => !oneUp.includes(u.blurb)).map((u) => u.id).join(","));

  // Refit prices tiers 2-3 only. Tier 0 used to render a live 20-scrap button
  // that tapped to nothing once run.ts stopped letting scrap install.
  // Mark 2 here so the full seven-card menu renders — Mark 1's focused stop is
  // pinned separately below.
  const stockRefit = yard({ tiers: newTiers() });
  check("an uninstalled track shows no refit button",
    stockRefit.includes("Not installed") && !stockRefit.includes(`data-upgrade="reactor"`));
  check("an installed track shows its next tier", oneUp.includes(`data-upgrade="reactor"`));

  // STAGING, not buying. Every button on this shelf queues a tier into an
  // order that Undock commits (run.ts's buyUpgrades); a button that spent on
  // the tap is the screen this one replaced.
  check("a track's button stages rather than buys",
    oneUp.includes(`data-action="stage-upgrade" data-upgrade="reactor"`) &&
      !oneUp.includes(`data-action="buy-upgrade"`));
  const staged = yard({ order: { reactor: 1 } });
  check("a staged track offers the tier ABOVE the one queued",
    staged.includes(`T3<span class="price__sep">·</span>`),
    staged.includes("T2<span") ? "still offering T2" : "no price");
  // ONE CYCLING BUTTON per card: it stages while the track has room, and turns
  // into the way out once it cannot. Two controls is what the 44px tap floor
  // cannot afford across a seven-card shelf.
  check("a card carries exactly one control",
    (staged.match(/refit-card__buy/g) ?? []).length === buyButtons(staged).length);
  check("a track with room left keeps offering the next rung",
    staged.includes(`data-action="stage-upgrade" data-upgrade="reactor"`));
  check("a staged track shows what the order does to it",
    staged.includes(upgradeById("reactor")!.current(1)) &&
      staged.includes(upgradeById("reactor")!.current(2)));
  check("the order names its own price on the commit",
    staged.includes("Install 1") && staged.includes(`>${TIER_COSTS[1]}<`),
    staged.includes("Install 1") ? "price missing" : "count missing");
  check("an empty order undocks without a price", yard().includes("Undock →"));
  // The four regions main.ts's refreshRefit lifts out of a detached render on
  // every stage. It addresses them by id, so a rename here does not break the
  // build — it silently stops that part of the screen updating: the scrap
  // total keeps its old number, or the projection stops redrawing under the
  // taps it exists to answer.
  for (const id of ["refit-grid", "refit-order", "refit-preview", "refit-foot"]) {
    check(`the yard mounts #${id} for the in-place patch`, oneUp.includes(`id="${id}"`));
  }
  // The scrap readout counts what is LEFT to stage against, not what the run
  // owns: every button on the shelf prices itself against the queue in front
  // of it, and a total that ignored the order would disable nothing.
  check("the order box spends the scrap the order has claimed",
    yard({ scrap: 100, order: { reactor: 1 } }).includes(`>${100 - TIER_COSTS[1]}<`));
  const pair = { ...newTiers(), reactor: 1, bay: 1 };
  const flushShelf = yard({ tiers: pair, scrap: TIER_COSTS[1] });
  const spentShelf = yard({ tiers: pair, scrap: TIER_COSTS[1], order: { reactor: 1 } });
  check("the shelf is live while the scrap is unspoken for",
    buyButtons(flushShelf).some((b) => !b.includes("disabled")));
  // "the rest of the shelf": every track the order has NOT staged. A staged
  // track never goes dead — its button turns into the way out instead, because
  // a disabled button on a staged track is an order the player cannot undo.
  check("an order that eats the scrap disables the rest of the shelf",
    buyButtons(spentShelf).filter((b) => b.includes("stage-upgrade") && !b.includes("unstage")).length > 0 &&
      buyButtons(spentShelf)
        .filter((b) => b.includes("stage-upgrade") && !b.includes("unstage"))
        .every((b) => b.includes("disabled")),
    buyButtons(spentShelf).join(" | "));
  check("…but a staged track always offers its way out",
    spentShelf.includes(`data-action="unstage-upgrade" data-upgrade="reactor"`) &&
      !buyButtons(spentShelf).some((b) => b.includes("unstage") && b.includes("disabled")));

  // MARK-1 FOCUS: the first tier's refit stops offer only Reactor Output —
  // the run tuning assumes its three tiers get built (upgrades.ts's
  // refitTracks), and one card makes the stop a purchase, not a dilemma.
  check("refitTracks(1) offers only the reactor",
    refitTracks(1).length === 1 && refitTracks(1)[0].id === "reactor");
  check("refitTracks(2) opens the full yard", refitTracks(2).length === UPGRADES.length);
  const mark1 = yard({ mark: 1 });
  check("a Tier-1 stop renders exactly one card",
    (mark1.match(/class="shop-card refit-card/g) ?? []).length === 1 &&
      mark1.includes(`data-upgrade="reactor"`));
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
    // The three knobs the TIER ladder moves are also the three a Contract must
    // not carry. These pin levelForContract's UNCONDITIONAL overwrites — they
    // cannot fail for any makeBaseLevel curve, only for a dropped assignment,
    // which is exactly what makes the Contract path immune to the tier ladder.
    check(`${c.name}: no launch cost`, cfg.launchCost === 0);
    check(`${c.name}: no clock`, cfg.timeLimitSec === 0);
    // What the three above CAN'T see: which argument slot the tier goes in.
    // levelForContract passes the contract's tier as the BAY INDEX with the
    // mark left at 1 (contracts.ts), so scorePerLine — a per-bay ramp the
    // overwrites don't touch — is the only field that tells that reading apart
    // from `makeBaseLevel(0, c.tier)`. Without this, "fixing" contracts to pass
    // the tier as a mark now that a mark parameter exists would silently change
    // every Contract's payout and no check would notice.
    check(`${c.name}: built from its tier as a BAY index`,
      cfg.scorePerLine === makeBaseLevel(Math.min(9, c.tier)).scorePerLine,
      `${cfg.scorePerLine}`);
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

// `conditions` is what the PLANT panel shows and `brief` is what the CARD
// shows. They are the same string on a lines Contract and differ by the
// shipment-count prefix on a pattern one, which the panel already states as
// its Shipments column and its manifest row. Pinned in both directions: the
// card must not change, and the panel must not repeat itself.
{
  const lines = generateContract(20260824, 6, 0);
  check("a lines Contract's conditions are its brief",
    lines.kind === "lines" && lines.conditions === lines.brief,
    `${lines.kind}: ${lines.conditions} / ${lines.brief}`);
  check("a lines Contract states conditions, never empty",
    lines.conditions.length > 0, lines.conditions);

  const pattern = generateContract(20260824, 6, PATTERN_SLOT);
  check("a pattern Contract's brief is its shipment count plus its conditions",
    pattern.brief === `${pattern.queue.length} shipments · ${pattern.conditions}`,
    `${pattern.brief} !== ${pattern.queue.length} shipments · ${pattern.conditions}`);
  check("a pattern Contract's conditions do not repeat the shipment count",
    !pattern.conditions.includes("shipments"), pattern.conditions);

  // Every variant, not just the one today's seed rolled: the tail is a switch
  // and a case that forgot to drop the prefix would pass on one draw.
  for (const v of VARIANTS) {
    const c = generateContract(20260824, 9, PATTERN_SLOT, v.id);
    check(`variant ${v.id} splits brief into count + conditions`,
      c.brief === `${c.queue.length} shipments · ${c.conditions}`,
      `${c.brief} / ${c.conditions}`);
    // brief is built FROM conditions (one local, one interpolation), so the
    // check above is a syntactic identity — it would still pass if a case
    // re-added the prefix into conditions itself, doubling it on the card.
    // This is the check that actually catches that.
    check(`variant ${v.id} states no shipment count`,
      !c.conditions.includes("shipments"), c.conditions);
  }
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
  let everConditionsNamedShipments = false;
  for (let tier = 1; tier <= 12; tier++) {
    for (let seed = 20260101; seed < 20260101 + 40; seed++) {
      for (const c of dailyContracts(tier, seed)) {
        if (c.kind !== "pattern") continue;
        patterns += 1;
        // The forced-variant loop above only ever sees a tier-9 std queue with
        // a surviving salvage wall, so it never exercises patternConditions's
        // tiny → "dominoes" branch. This sweep already walks every tier and 40
        // seeds per tier for exactness, so it is where that branch actually
        // gets checked. A degraded salvage needs no check of its own:
        // generatePatternContract (not patternConditions) falls back to
        // variantSpec("plain") when the wall doesn't survive, so conditions
        // takes the same `default` case "plain" already hits 185 times over
        // this same range — and the degrade is too rare for this range to see
        // regardless (0 of 50 salvage attempts here; ~0.4%, 2 of 492, at 400
        // seeds/tier).
        if (c.conditions.includes("shipments")) everConditionsNamedShipments = true;
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
  // conditions is what the plant panel renders verbatim; the panel already
  // states the shipment count as its own readout column and its own manifest
  // row, so no pattern Contract's conditions may say it a third time.
  check("no pattern Contract's conditions names the shipment count",
    !everConditionsNamedShipments);

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
  check("a fresh run has taken no restarts", newRun(1).restarts === 0);
  // The seal turns entirely on this surviving a bay boundary. advanceRun
  // rebuilds the run field by field, so a rebuild that dropped the field would
  // zero the count at bay 2 and hand the badge to a run that restarted bay 1
  // three times and then went the distance. Two boundaries, not one, so a
  // version that carried it across the first and not the second is caught too.
  const conceded = advanceRun(
    advanceRun({ ...newRun(5), restarts: 2 }, 800, 800, 0, 0, []), 800, 800, 0, 0, [],
  );
  check(
    "restarts survive the bays they were taken in",
    conceded.restarts === 2,
    String(conceded.restarts),
  );
  // …and so does the FILED flag, for the same reason and with a different
  // consequence. A run that lost bay 7, retried it from the game-over card and
  // then cleared it has already been booked once (meta.ts's recordRunEnd
  // `refiled`); a rebuild that dropped the flag would re-count the run in the
  // lifetime total at the very next bay boundary.
  check("a filed run stays filed across a bay boundary", conceded.filed === false);
  const resumed = advanceRun(
    advanceRun({ ...newRun(5), filed: true }, 800, 800, 0, 0, []), 800, 800, 0, 0, [],
  );
  check("...and a resumed one is still on the books", resumed.filed === true);

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
  // THE SAME THREE PROPERTIES, for what volatile TOOK. It is the mirror of the
  // stat above and it fails the same three ways, so it is pinned the same three
  // ways rather than trusted to the symmetry: run-long, defaulted to 0, and
  // never operating cash. The last is the one worth stating out loud in this
  // direction — the charge already came out of the bay's score when the blast
  // settled (lineClear.ts's settleBlast), so a leak into carry would bill the
  // player for the same detonation twice.
  check("a bay nothing detonated in is charged nothing", run.volatileLosses === 0,
    String(run.volatileLosses));
  const volA = advanceRun(run, 800, 800, 0, 0, [], run.bondCharges, 0, 90);
  const volB = advanceRun(volA, 800, 800, 0, 0, [], volA.bondCharges, 0, 35);
  check("detonation charges accumulate across bays", volB.volatileLosses === 125,
    String(volB.volatileLosses));
  check("detonation charges never leak into the carried float", volA.carry === 0,
    String(volA.carry));
  // The two stats are independent columns, not one signed number: a bay can pay
  // a bounty and be charged in the very same blast, and a version that netted
  // them into one field would report a wash as "nothing happened".
  const both = advanceRun(run, 800, 800, 0, 0, [], run.bondCharges, 60, 60);
  check("a bay that both recovered and lost reports both, not the net",
    both.salvagedFunds === 60 && both.volatileLosses === 60,
    `${both.salvagedFunds} / ${both.volatileLosses}`);
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
section("Refit order: stage, revise, undock (upgrades.ts, run.ts, preview.ts)");
// ---------------------------------------------------------------------------
{
  // The yard STAGES and Undock commits. The whole value of that is that an
  // order can be revised, so the order model has to behave like one: every tap
  // moves it, every tap is reversible, and nothing is spent until the commit.
  const rig: UpgradeTiers = { ...newTiers(), reactor: 1, bay: 2, bonds: 1 };
  const T = TIER_COSTS;

  check("an empty order costs nothing and stages nothing",
    orderCost(rig, {}) === 0 && orderSize(rig, {}) === 0);
  const one = stageTier(rig, {}, "reactor", 999)!;
  check("staging queues a rung", orderSize(rig, one) === 1 && orderedTier(rig, one, "reactor") === 2);
  check("a staged rung is priced off the shared ladder", orderCost(rig, one) === T[1]);
  const two = stageTier(rig, one, "reactor", 999)!;
  check("the same track stages again", orderedTier(rig, two, "reactor") === MAX_TIER);
  check("a two-rung order costs both rungs", orderCost(rig, two) === T[1] + T[2]);
  check("a maxed track refuses another rung", stageTier(rig, two, "reactor", 999) === null);
  // Tier 0 is a system that is not aboard, not a cheaper first rung — the same
  // rule buyUpgrade enforces, asserted here so the button is disabled for the
  // reason the commit would refuse it.
  check("an uninstalled track cannot be staged", stageTier(rig, {}, "demolition", 999) === null);

  // AFFORDABILITY IS AGAINST THE WHOLE ORDER. With one purchase per tap the
  // scrap was already gone by the time the next button rendered; staged, it is
  // not, so each rung has to price itself against the queue in front of it.
  check("a rung that fits alone is refused behind a queue that spent the scrap",
    stageTier(rig, {}, "reactor", T[1]) !== null &&
      stageTier(rig, stageTier(rig, {}, "reactor", T[1])!, "bay", T[1]) === null);
  check("staging never mutates the order it was given", (() => {
    const o: RefitOrder = { reactor: 1 };
    stageTier(rig, o, "bay", 999);
    clearTrack(o, "reactor");
    return JSON.stringify(o) === '{"reactor":1}';
  })());
  // ALL of a track's rungs, not the last one. The card carries one cycling
  // button (the tap floor leaves room for one), so it stages while the track
  // has room and undoes at MAX — and a one-rung undo there would leave the
  // track oscillating between its top two tiers with no way back down.
  check("undoing takes the whole track back off the order",
    JSON.stringify(clearTrack(two, "reactor")) === "{}" &&
      JSON.stringify(clearTrack(one, "reactor")) === "{}");
  check("undoing leaves the rest of the order alone",
    JSON.stringify(clearTrack({ reactor: 2, bay: 1 }, "reactor")) === '{"bay":1}');
  check("undoing a track that is not staged is a no-op",
    clearTrack(one, "bay") === one);

  // A hand-edited order must not read as a fourth tier nothing implements.
  check("an over-ordered track clamps at MAX",
    orderedTier(rig, { reactor: 9 }, "reactor") === MAX_TIER &&
      orderedTiers(rig, { reactor: 9 }).reactor === MAX_TIER);

  // THE RUNGS, in installation order. buyUpgrades walks these to install and
  // main.ts walks the same list to reconstruct the per-rung `scrapBefore` its
  // telemetry records, so the two cannot disagree about what was bought at
  // what balance.
  const rungs = orderRungs(rig, { bay: 1, reactor: 2 });
  check("rungs come back in UPGRADES order, not the order's key order",
    rungs.map((r) => r.id).join(",") === "bay,reactor,reactor",
    rungs.map((r) => r.id).join(","));
  check("each rung names the tier it climbs FROM",
    rungs.map((r) => r.from).join(",") === "2,1,2",
    rungs.map((r) => r.from).join(","));
  check("each rung is priced at that tier's rung of the ladder",
    rungs.map((r) => r.cost).join(",") === [T[2], T[1], T[2]].join(","),
    rungs.map((r) => r.cost).join(","));
  check("the rungs' prices sum to what the order costs",
    rungs.reduce((a, r) => a + r.cost, 0) === orderCost(rig, { bay: 1, reactor: 2 }));
  check("an order past the ladder's top enumerates only the rungs that exist",
    orderRungs(rig, { reactor: 9 }).length === MAX_TIER - 1);
  check("an empty order has no rungs", orderRungs(rig, {}).length === 0);
  // The reconstruction main.ts performs: start at the run's balance, subtract
  // each rung in turn. It has to land exactly on what the commit deducted, or
  // the telemetry's `scrapBefore` series is describing a different purchase.
  check("walking the rungs from the opening balance lands on the commit's", (() => {
    const start = { ...newRun(9, [], 0, rig, 6), scrap: 300 };
    const o: RefitOrder = { bay: 1, reactor: 2 };
    let scrap = start.scrap;
    const before: number[] = [];
    for (const r of orderRungs(start.tiers, o)) { before.push(scrap); scrap -= r.cost; }
    return scrap === buyUpgrades(start, o, MAX_TIER)!.scrap
      && before[0] === 300 && before.length === 3
      && before.every((b, i) => i === 0 || b < before[i - 1]);
  })());

  // THE COMMIT. All or nothing: a half-installed order would spend real scrap
  // on a build the player never saw projected, which is the surprise staging
  // exists to remove.
  const docked = { ...newRun(4, [], 0, rig, 6), scrap: 200 };
  const order: RefitOrder = { reactor: 1, bay: 1 };
  const undocked = buyUpgrades(docked, order, MAX_TIER)!;
  check("undocking installs every staged rung",
    undocked.tiers.reactor === 2 && undocked.tiers.bay === MAX_TIER);
  check("undocking deducts exactly what the order quoted",
    undocked.scrap === 200 - orderCost(rig, order) && orderCost(rig, order) === T[1] + T[2]);
  check("undocking does not mutate the run it was given",
    docked.scrap === 200 && docked.tiers.reactor === 1);
  check("an empty order changes nothing", (() => {
    const same = buyUpgrades(docked, {}, MAX_TIER)!;
    return same.scrap === 200 && JSON.stringify(same.tiers) === JSON.stringify(rig);
  })());
  check("an order the run cannot pay for is refused whole",
    buyUpgrades({ ...docked, scrap: T[1] }, { reactor: 1, bay: 1 }, MAX_TIER) === null);
  check("an order naming an uninstalled system is refused whole",
    buyUpgrades(docked, { reactor: 1, demolition: 1 }, MAX_TIER) === null);
  check("an order climbing past MAX is refused whole",
    buyUpgrades(docked, { reactor: 9 }, MAX_TIER) === null);
  // The Bond Emitter's magazine delta lives in buyUpgrade, so a batched commit
  // has to go through it rather than writing tiers directly — otherwise the
  // one track whose purchase issues a consumable would stop issuing it.
  check("a staged emitter still issues its charge",
    buyUpgrades({ ...docked, bondCharges: 0 }, { bonds: 1 }, MAX_TIER)!.bondCharges === 1);

  // THE PROJECTION. Every refit track has to move at least one number on it:
  // a shop where a purchase projects nothing teaches that the purchase does
  // nothing, and three tracks used to do exactly that.
  const stopped = { ...newRun(4, [], 0, {
    bay: 1, launcher: 1, hydraulics: 1, magazine: 1, reactor: 1, bonds: 1, demolition: 1,
  }, 6), levelIndex: 6, scrap: 999 };
  for (const u of UPGRADES) {
    const after = buyUpgrades(stopped, { [u.id]: 1 }, MAX_TIER)!;
    const rows = previewRows(levelForRun(stopped), levelForRun(after)).filter((r) => r.changed);
    check(`the yard projects what ${u.id} buys`, rows.length > 0,
      "nothing moved");
    // At least one, not every one: a track is allowed to be a trade-off (see
    // the hydraulics check below), but a purchase that buys nothing the player
    // can read as a gain is one the yard should not be selling.
    check(`${u.id} buys at least one visible improvement`,
      rows.some((r) => r.tone === "better"),
      rows.map((r) => `${r.id}:${r.tone}`).join(","));
  }
  // PRESS HYDRAULICS IS A TRADE-OFF, and the projection says so. The track
  // raises settle assist (the improvement it is sold on) and stroke speed
  // together — and stroke speed is the very number the Sweeper Detail notch
  // ratchets as PRESSURE (hazards.ts), so the same field cannot be an
  // improvement here and a cost there. Shown honestly rather than recoloured:
  // a faster press really does give a near-line less time to close, and a
  // projection that hid that to keep a purchase all-green would be the lying
  // projection preview.ts exists to prevent.
  const pressRows = previewRows(levelForRun(stopped),
    levelForRun(buyUpgrades(stopped, { hydraulics: 1 }, MAX_TIER)!)).filter((r) => r.changed);
  check("hydraulics projects its assist as the gain",
    pressRows.some((r) => r.id === "assist" && r.tone === "better"));
  check("…and its faster stroke as the cost the sweeper notch calls one",
    pressRows.some((r) => r.id === "sweeper" && r.tone === "worse"));

  // The capstone is a resupply LINE rather than another +2 charges, so a
  // projection that only counted charges would show tier 3 buying tier 2.
  const rackTop = { ...stopped, tiers: { ...stopped.tiers, demolition: 2 } };
  check("the demolition capstone projects its resupply line",
    previewRows(levelForRun(rackTop), levelForRun(buyUpgrades(rackTop, { demolition: 1 }, MAX_TIER)!))
      .some((r) => r.id === "resupply" && r.changed));
  // Same rule the draft's rows follow: a dense grid packs these three across a
  // phone's projection column, and a label that does not survive that names
  // nothing.
  const shipRows = previewRows(levelForRun(stopped),
    levelForRun(buyUpgrades(stopped, {
      bay: 1, launcher: 1, hydraulics: 1, magazine: 1, reactor: 1, bonds: 1, demolition: 1,
    }, MAX_TIER)!));
  check("every ship row carries a dense-grid label that fits one",
    shipRows.every((r) => r.short.length > 0 && r.short.length <= r.label.length && r.short.length <= 11),
    shipRows.filter((r) => r.short.length > 11 || r.short.length > r.label.length).map((r) => r.short).join(","));
  // …and they stay OFF the ratchet draft, where no axis touches them: the rows
  // were added for the yard, and a permanent tile per ship stat would be one
  // more thing for a landscape phone to pack four across for nothing.
  const quiet = previewRows(levelForRun(stopped), levelForRun(stopped));
  check("the ship's own rows are silent when nothing moves them",
    !quiet.some((r) => ["power", "stabilizer", "reload", "breakers", "seams", "bombs", "resupply"].includes(r.id)),
    quiet.map((r) => r.id).join(","));
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

  // THE FORCED HAND'S PARTNER IS CAPPED AT ONE SEAT — found in review. The
  // capstone's forced-material hand deals two materials plus the number-axis
  // partner and asks for two picks; without the cap, two taps on the partner
  // produced [partner, partner], passed the full-hand confirmation, and took
  // no material notch at all — voiding the one guarantee these bays exist for.
  {
    const mat = HAZARDS.find((h) => h.kind === "content")!.id;
    check("on a forced hand, a second tap on the picked partner removes it",
      togglePick(["cost"], "cost", 2, true).length === 0);
    check("on a forced hand, a material still stacks to a double notch",
      JSON.stringify(togglePick([mat], mat, 2, true)) === JSON.stringify([mat, mat]));
    check("on a forced hand, partner beside a material still un-picks cleanly",
      JSON.stringify(togglePick([mat, "cost"], "cost", 2, true)) === JSON.stringify([mat]));
    check("an ordinary hand still stacks the number axis (the flag defaults off)",
      JSON.stringify(togglePick(["cost"], "cost", 2)) === '["cost","cost"]');
    // No reachable tap sequence may fill a forced two-pick hand without a
    // material: from every material-free state, tapping the partner never
    // completes the hand.
    check("a forced two-pick hand cannot be completed by the partner alone", (() => {
      let picks: HazardId[] = [];
      for (let taps = 0; taps < 6; taps++) {
        picks = togglePick(picks, "cost", 2, true);
        if (picks.length === 2 && picks.every((p) => p === "cost")) return false;
      }
      return true;
    })());
  }

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
  // ONE belt row, not one per material — the owner's device pass found a Tier
  // 10 material clause moving six tiles at once, two extra rows on the screen
  // that overflows first. The total is the number that prices the bay
  // (belt.ts's ceiling: notches past it recompose rather than thicken); which
  // material it is lives on the card being tapped.
  check("the belt row appears only once a content axis is picked",
    row(idle, "belt") === undefined && row(rowsFor(["cryo"]), "belt")!.changed);
  check("a second material moves the same one belt row",
    rowsFor(["cryo", "slag"]).filter((r) => r.id === "belt").length === 1
      && row(rowsFor(["cryo", "slag"]), "belt")!.changed);

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

  // The seal (meta.ts's sealedMarks): a Deep Run cleared without ever
  // restarting a bay gets a badge on that floor of the tower, and nothing else.
  const clean = recordRunEnd(newMeta(), 1, true, 5, 0);
  check("a run won without a restart is sealed", clean.meta.sealedMarks.includes(1));
  const messy = recordRunEnd(newMeta(), 1, true, 5, 3);
  check("a run won after a restart is not sealed", !messy.meta.sealedMarks.includes(1));
  const lostClean = recordRunEnd(newMeta(), 1, false, 5, 0);
  check("a run LOST without a restart is not sealed", !lostClean.meta.sealedMarks.includes(1));
  // Cosmetic BY CONSTRUCTION (docs/DESIGN.md prints "Purchasable power: none"
  // for both modes — nothing that can be earned a second way may move the
  // ladder). A seal that paid out would be exactly that second axis, so a
  // sealed run and an identical unsealed one must be indistinguishable in Mark
  // and in salvage, both the banked total and the share this call hands back.
  const unsealed = recordRunEnd(newMeta(), 1, true, 5, 9);
  check(
    "sealing pays nothing and moves no Mark",
    clean.meta.mark === unsealed.meta.mark
      && clean.meta.salvage === unsealed.meta.salvage
      && clean.salvage === unsealed.salvage,
  );
  // Once per floor. A player who re-flies a Mark they already sealed must not
  // grow the list, or the tower's per-floor lookup starts scanning duplicates
  // and any future count of "floors sealed" reads high.
  const again = recordRunEnd(clean.meta, 1, true, 5, 0);
  check("re-flying a sealed Mark clean seals it once", again.meta.sealedMarks.length === 1);

  // ---- A RUN THAT ENDS TWICE ---------------------------------------------
  // The game-over card's Retry Bay hands the SAME run back (main.ts's
  // retryBay), so a run can reach recordRunEnd twice: once as the loss that
  // opened the card, once as whatever it becomes afterwards. Everything here is
  // idempotent under that except the lifetime run COUNT, which counts runs and
  // not endings — RunState.filed is what says "this one is already on the
  // books" and `refiled` is what carries it in.
  {
    const start = newMeta();
    // Bay 7 kills it. Filed: one run, deepest bay 7, nothing sealed.
    const died = recordRunEnd(start, 1, false, 7, 0).meta;
    check("the loss is filed as one run", died.runs === 1 && died.bestBay === 7);
    // Retry, then the distance. Same run, second filing, one retry on it.
    const finished = recordRunEnd(died, 1, true, RUN_LEVELS, 1, true);
    check("a resumed run is still one run", finished.meta.runs === 1,
      `${finished.meta.runs} runs`);
    check("...and still banks the tier it won", finished.meta.tierRunDone
      && finished.salvage === share);
    check("...and still reaches the bay it reached", finished.meta.bestBay === RUN_LEVELS);
    // THE PRICE. This is the whole of what a retry costs, and the notice the
    // player is shown once (screens.ts's sealBreakModal) promises exactly this
    // pair: the seal goes, the tier does not.
    check("...but cannot be sealed", !finished.meta.sealedMarks.includes(1));
    // The control: the identical run with no retry on it seals, so the check
    // above is measuring the retry rather than something else about the path.
    check("...where the same run flown clean would have sealed",
      recordRunEnd(died, 1, true, RUN_LEVELS, 0, true).meta.sealedMarks.includes(1));
    // …and `refiled` is the ONLY thing the flag changes. Two filings of the
    // same shape differ in the run counter and in nothing else, or the flag has
    // grown a second meaning nobody declared.
    const counted = recordRunEnd(died, 1, true, RUN_LEVELS, 1, false).meta;
    check("refiling changes the run count and nothing else",
      counted.runs === died.runs + 1
        && JSON.stringify({ ...counted, runs: 0 })
          === JSON.stringify({ ...finished.meta, runs: 0 }));
  }

  // ---- THE SEALS ARE THE SKYDECK'S KEY (meta.ts's skydeckOpen) ------------
  // The gate #124 shipped was "the ladder is beaten". It is now "the ladder is
  // beaten AND every Mark is sealed", because a ladder can be beaten with a
  // retry on every bay — the roof would have been handed to a player who had
  // never flown a bay they could not restart, which is precisely what the roof
  // asks for on the day (skydeck.ts: no yard, no chosen difficulty, one
  // attempt).
  {
    const allMarks = Array.from({ length: MARK_COUNT }, (_, i) => i + 1);
    const beaten: MetaState = { ...newMeta(), mark: MARK_COUNT };
    check("the ladder beaten alone no longer opens the roof", !skydeckOpen(beaten));
    check("...and it is the seals that are missing",
      unsealedMarks(beaten).length === MARK_COUNT);
    const sealedNotBeaten: MetaState = { ...newMeta(), mark: MARK_COUNT - 1, sealedMarks: allMarks };
    // The near-miss that makes the second condition load-bearing rather than
    // decorative: a Mark-10 WIN seals Mark 10 the moment it lands, while `mark`
    // only reaches MARK_COUNT once that tier's Contracts land too. Ten seals
    // and two owed Contracts is not a beaten ladder.
    check("every seal without a beaten ladder does not open it either",
      unsealedMarks(sealedNotBeaten).length === 0 && !skydeckOpen(sealedNotBeaten));
    const both: MetaState = { ...beaten, sealedMarks: allMarks };
    check("both together open it", skydeckOpen(both));
    // One missing seal shuts it again — the gate is the SET, not a count that
    // could be satisfied by a duplicate or an out-of-range entry.
    check("one missing seal shuts it",
      !skydeckOpen({ ...both, sealedMarks: allMarks.filter((m) => m !== 4) }));
    check("...and a duplicate does not stand in for it",
      !skydeckOpen({ ...both, sealedMarks: [...allMarks.filter((m) => m !== 4), 3] }));
    // ACCESS IS NOT POWER, which is what keeps the seal inside the rule the
    // section above states. The roof banks no salvage and ticks no tier
    // (run.ts's tracksLadder), so nothing a seal opens can make a later run
    // numerically stronger.
    check("what the seals open still pays nothing",
      !tracksLadder(skydeckRunFor(newTiers(), [], new Date(Date.UTC(2026, 7, 27)))));

    // THE ROOF'S OWN CEREMONY. It used to ride on the Mark's watermark, because
    // beating Mark 10 WAS the roof opening; the two events have come apart, so
    // the roof needs its own — and it fires once.
    check("the roof owes a ride the moment it opens", pendingSkydeck(both));
    check("...and a shut roof owes none", !pendingSkydeck(beaten));
    const ridden = skydeckCelebrated(both);
    check("...and only one", !pendingSkydeck(ridden));
    check("...burning it is idempotent", skydeckCelebrated(ridden) === ridden);
  }

  // ---- THE ONE-TIME SEAL NOTICE ------------------------------------------
  // A bay retry has always cost the seal silently. It cannot stay silent now
  // that the seals open a door, so the cost is quoted once, ever, on a
  // watermark — see screens.ts's sealBreakModal for why once and not always.
  {
    check("a fresh save is owed the notice", sealBreakOwed(newMeta()));
    const shown = sealBreakShown(newMeta());
    check("...and is owed it exactly once", !sealBreakOwed(shown));
    check("...showing it again changes nothing", sealBreakShown(shown) === shown);
    // It is a WATERMARK and nothing else: it must not be able to move a number
    // the ladder reads, or a message would have become a currency.
    check("the notice moves no progression",
      JSON.stringify({ ...shown, sealBreakSeen: false }) === JSON.stringify(newMeta()));
  }

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

  // A charge costs a launch, like everything else that leaves the muzzle.
  // It used to fire free, which — once the $8-a-cube refund and the $20 slag
  // bounty shipped — made a maxed rack an income source rather than a tool
  // (~$480-670 a bay against a Tier 5 opening target of $680, measured).
  g.armBomb();
  const fundsBefore = g.score;
  let now = 5000;
  check("the armed charge fires", g.shoot(now));
  check("firing a charge costs a launch",
    g.score === fundsBefore - cfg.launchCost, `${g.score} vs ${fundsBefore - cfg.launchCost}`);
  check("...and it stays worth firing at three cubes or more",
    3 * cfg.salvagePerCube > cfg.launchCost,
    `${3 * cfg.salvagePerCube} vs ${cfg.launchCost}`);
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

  // The resupply line's CONFIG path, end to end: a maxed Demolition Rack has to
  // reach the bay the player is actually flying, and the bay has to open owing
  // nothing. The grant itself is level.ts's bombResupply (proved there against
  // its own mutants) — driving a real line clear would need a settled row, and
  // this harness leaves physics to sim/sweep.ts's bots.
  {
    const maxed = makeBaseLevel(0);
    const tiers = newTiers();
    tiers.demolition = MAX_TIER;
    applyUpgrades(maxed, tiers);
    const g4 = new Game(maxed, {}, 7);
    check("a maxed rack carries its resupply interval into the bay",
      g4.level.bombResupplyLines === DEMO_RESUPPLY_LINES);
    check("a bay opens owing no resupply", g4.bombsResupplied === 0);
    // A stock bay must not quietly resupply — 0 is what disables it.
    check("a stock bay carries no resupply line",
      new Game(makeBaseLevel(0), {}, 8).level.bombResupplyLines === 0);
  }

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
section("Open sky above the field (layout.ts skyTop)");
// The reported bug: fullscreen on a 16:9 desktop or TV drew a black band across
// the top of the screen and the field stopped short of it. Nothing was broken
// in the solver — the band IS the letterbox, and at exactly 16:9 it exists
// because "snug" reserves a rail band out of the WIDTH, which costs height when
// the world is refitted. The renderer then clipped every layer to the world
// rect, so the band could only ever be backdrop colour.
//
// engine.ts's top boundary is deliberately OPEN (pieces fly above y=0 and fall
// back in, the side walls span y=-SKY..H to keep them in the shaft), so the
// band was capping a shaft the physics treats as unbounded. skyTop is how far
// above the world's own top edge the canvas reaches, in world px — the number
// the background bake and the render clip open upward by, so the sky reaches
// the top of the screen at every aspect.
{
  setSafeAreaInsets({ left: 0, right: 0, top: 0, bottom: 0 });
  setRailSlots(RAIL_SLOTS_MAX);
  const cases: [string, number, number][] = [
    ["1080p fullscreen", 1920, 1080],
    ["4K fullscreen", 3840, 2160],
    ["960x540 window", 960, 540],
    ["16:10 laptop", 1600, 1000],
    ["4:3 tablet", 1024, 768],
    ["21:9 phone", 2400, 1080],
    ["19.5:9 phone", 2556, 1179],
    ["short phone", 960, 400],
  ];
  for (const [name, w, h] of cases) {
    const l = computeLayout(w, h);
    const top = skyTop(l.scale, l.oy);
    // THE invariant: map the sky's top edge back through the very transform
    // render() draws with. It must land at or above the canvas's first row —
    // if it lands below, that difference is the black band the player sees.
    const topCss = l.oy + top * l.scale;
    check(`${name} paints the sky to the canvas top`, topCss <= 0, `${topCss.toFixed(2)}px of bare backdrop`);
    // ...and it may only ever open UPWARD. A positive skyTop would crop the
    // world's own first rows, which is the same bug pointing the other way.
    check(`${name} never crops the world's top`, top <= 0, String(top));
    // Nothing is opened that the viewport does not actually show: the sky is
    // the letterbox band converted to world px and one px of overdraw, never a
    // fixed slab bolted above the field.
    const band = l.oy / l.scale;
    check(`${name} opens only the band it has`, -top <= band + 2 + 1e-9, `${(-top).toFixed(2)} world px for a ${band.toFixed(2)} px band`);
  }

  // Why this is not a rounding curiosity: 1920x1080 is the world's OWN aspect,
  // and it still letterboxes, because the rail band comes out of the width
  // before the world is fitted. 23.6 CSS px at 1080p, and the same 23.6 at 4K
  // — a band that survives every resolution the player might pick.
  check("16:9 fullscreen still letterboxes (this is why the sky exists)",
    computeLayout(1920, 1080).oy > 20, String(computeLayout(1920, 1080).oy));
  // A viewport whose height is fully used has no band to open, and opens
  // EXACTLY nothing — every landscape phone comes out of this pixel-identical,
  // rather than pixel-identical-plus-a-rounding-margin.
  const wide = computeLayout(2400, 1080);
  check("a height-filling viewport opens no sky at all", wide.oy === 0 && skyTop(wide.scale, wide.oy) === 0,
    `${wide.oy} / ${skyTop(wide.scale, wide.oy)}`);
  // The world is 1280x720 and the sky is measured in the same units — a sanity
  // rail against a future change that starts returning CSS px here.
  check("the sky is measured in world px", Math.abs(skyTop(1, 100) - -101) < 1 + 1e-9, String(skyTop(1, 100)));
  check("the sky scales with the field", skyTop(2, 100) > skyTop(1, 100), `${skyTop(2, 100)} vs ${skyTop(1, 100)}`);
  check("the world's own height is untouched by the sky", WORLD.height === 720);
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
    // TAP pauses, HOLD restarts the bay (main.ts's startHold). The second half
    // has nowhere else to go on touch: the .kbd-hint strip that names it is
    // display:none on a coarse pointer AND aria-hidden everywhere, and this
    // rail carries no visible labels. So the accessible name is the only route
    // a touch or assistive-technology player has to the gesture, and it is
    // asserted here because this is where the rail markup already is.
    check("the pause button's accessible name carries the hold gesture",
      /aria-label="Pause[^"]*hold to restart/i.test(rail),
      rail.match(/aria-label="Pause[^"]*"/)?.[0] ?? "no pause button");
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
  // Where no fullscreen toggle mounts at all (the native shells, iPhone
  // Safari — platform.ts's fullscreenSupported), the budget must not reserve
  // its slot: screens.ts renders no button there, and an empty slot is field
  // width given away for nothing.
  check("no fullscreen toggle (native shells) frees its slot",
    railSlotsFor({ bond: false, demo: false, auto: false, fullscreen: false }) === RAIL_SLOTS_BASE - 1 &&
    railSlotsFor({ bond: true, demo: true, auto: true, fullscreen: false }) === RAIL_SLOTS_MAX - 1);
  check("a fine pointer without fullscreen budgets the pause button alone",
    railSlotsFor({ bond: true, demo: true, auto: true, finePointer: true, fullscreen: false }) === 1);
  check("the budget clamps to the seven-slot worst case",
    (setRailSlots(9), getRailSlots() === RAIL_SLOTS_MAX));
  // Floor of ONE: the pause-only rail (fine pointer, no fullscreen toggle) is
  // a real budget and must survive the clamp — see setRailSlots.
  check("the budget clamps at the one-button floor",
    (setRailSlots(0), getRailSlots() === 1));
  check("the pause-only budget survives the clamp",
    (setRailSlots(railSlotsFor({ bond: false, demo: false, auto: false, finePointer: true, fullscreen: false })),
      getRailSlots() === 1));

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

section("Contract plant panel (screens.ts hudHTML)");
// The Contract plant panel's three additions. A Contract has no clock, so the
// third readout column renders empty — on a LINES Contract it carries cubes
// lost instead. Not on a pattern one: SPARE_SHIPMENTS is 0, so the margin is 0
// on frame one and one stranded cube ends the attempt — it never even reaches
// 1, because cubesAvailable stops counting a cube the moment it starts
// blinking (lineClear.ts's markLostPieces), so objectiveUnreachable fires
// 1.4s before lostTotal increments, and the bay is called 0.4s before that.
{
  const base = {
    beltPreview: { bomb: false, type: "T" as const, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
    loaded: { bomb: false, type: "L" as const, quarterTurns: 1, empty: false, hidden: false, material: "standard" as const },
    tier: null, target: 800, score: 200, launchCost: 0, bayNum: 1,
    timeLimitSec: 0, timeLeftMs: 0, pieceSize: "std" as const,
    bondBreakerOwned: false, bondCharges: 0, demoOwned: false, bombCharges: 0,
    autoloaderOwned: false, ratchets: {}, tiers: newTiers(),
  };
  const progress = { tier: 1, runDone: false, contracts: 0, needed: 3, award: 45, milestone: 15 };
  const linesHud = hudHTML({
    ...base,
    contract: {
      name: "Foundry Overrun", kind: "lines", goal: 5, lines: 2, launchesLeft: 9,
      remaining: [], lost: 7, conditions: "crosswind · cryo shipments", tier: 1, progress,
    },
  });
  // A clean stretch — nothing stranded yet — is the common opening reading for
  // every lines Contract, and this panel already has a rule against permanent
  // zeroes (the COMBO/LAUNCH COST/SCRAP row above dropped out of Contracts for
  // exactly that). Lost is not permanent: it moves the moment a shipment
  // strands. Pinned so a future "blank until the first loss" change has to be
  // deliberate, not a silent side effect of some unrelated edit.
  const linesZeroHud = hudHTML({
    ...base,
    contract: {
      name: "Cargo Bay Reroute", kind: "lines", goal: 6, lines: 0, launchesLeft: 11,
      remaining: [], lost: 0, conditions: "no complications", tier: 1, progress,
    },
  });
  const patternHud = hudHTML({
    ...base,
    contract: {
      name: "Cold Storage Backlog", kind: "pattern", goal: 4, lines: 1, launchesLeft: 6,
      remaining: ["I", "O", "T"], lost: 0, conditions: "3 shapes, no waste", tier: 1, progress,
    },
  });

  // Anchored to the element it proves rather than a bare ">7<" — 7 happens to
  // be unique across this fixture's other numbers, but that's a fact about the
  // fixture, not the markup, and a regression coupling to it should not read
  // as "ok" for the wrong reason.
  check("a lines Contract fills the empty clock column with cubes lost",
    linesHud.includes('id="hud-lost">7<'));
  check("...and still renders it at zero — Lost moves, unlike Combo/Scrap",
    linesZeroHud.includes('id="hud-lost">0<'));
  check("a pattern Contract does not — its margin is 0 by construction",
    !patternHud.includes('id="hud-lost"'));
  check("neither Contract renders a clock",
    !linesHud.includes('id="hud-time"') && !patternHud.includes('id="hud-time"'));
  check("Lost reads after Launches, not before",
    linesHud.indexOf("pl-launches") < linesHud.indexOf("pl-lost"));
  // Order-independent: a regression that writes class="pl-stat pl-stat--danger
  // pl-lost" (danger before the marker class) is exactly as wrong as one that
  // writes it after, and the check has to catch both.
  check("cubes lost takes no danger treatment — there is no threshold",
    !/<div class="(?=[^"]*\bpl-lost\b)(?=[^"]*\bpl-stat--danger\b)[^"]*">/.test(linesHud));

  check("a Contract states the bay's conditions in the panel",
    linesHud.includes('id="hud-conditions"') && linesHud.includes("crosswind · cryo shipments"));
  // The comment on this row argues at length that conditions can never be
  // empty (budgetForTier / the two ungated complications / patternConditions
  // always returning a literal) — argued, but until now never actually
  // pinned. `conditions: ""` would still satisfy the check above (`includes`
  // finds the id regardless of what's inside the tag), so this closes the gap
  // the argument opened: an empty tag reads `id="hud-conditions"></b>`.
  check("...and the row can never render with an empty value",
    !linesHud.includes('id="hud-conditions"></b>'));
  check("a pattern Contract states its variant's conditions",
    patternHud.includes("3 shapes, no waste"));
  // "Tier 1" is a prefix of "Tier 10" and "0/3" is a bare substring either
  // could appear as, coincidentally, in unrelated markup — the same objection
  // the Lost check raises above about a bare `>7<`. Anchored on the label's
  // own closing tag (rules out the "Tier 10" prefix) and on `id="hud-tier"`
  // (rules out "0/3" turning up elsewhere).
  check("a Contract states the tier the clear counts toward, unambiguously",
    linesHud.includes('class="pl-tier"') && linesHud.includes('<span class="lbl">Tier 1</span>'));
  // The milestone salvage — the number that actually answers "why is this bay
  // worth playing" — had no assertion at all: every check above still passes
  // with `${icon("salvage", 9)} ${contract.progress.milestone}` deleted
  // outright. Anchored to id="hud-tier" for the same reason as above, and
  // covers three things at once: the count (0/3), that it is immediately
  // followed by the salvageHTML currency span (no stray whitespace text node
  // between them — `.pl-tier b` already has a `gap`), and that the milestone
  // (15) closes the tag. Not coupled to icon()'s SVG internals: `>15` anchors
  // on the ">" that ends WHATEVER the icon renders, not its path data.
  check("...the clear count, the reward glyph and the milestone salvage, in order and with no stray whitespace",
    linesHud.includes('id="hud-tier">0/3<span class="currency">') && linesHud.includes('>15</span></b>'));
  // Order was unchecked: swapping the Bay and Tier blocks (or the manifest
  // row and either of them) left every check above green. This file already
  // has the idiom two sections up (Lost after Launches) — same idea here.
  check("the Bay conditions row reads before the Tier row",
    linesHud.indexOf('id="hud-conditions"') < linesHud.indexOf('id="hud-tier"'));
  check("on a pattern Contract, the manifest reads before both",
    patternHud.indexOf('id="hud-queue"') < patternHud.indexOf('id="hud-conditions"') &&
      patternHud.indexOf('id="hud-conditions"') < patternHud.indexOf('id="hud-tier"'));
  // The row's OTHER state, and the reason it has one: hudOpts passes `progress`
  // only while this attempt would still bank the milestone the row quotes
  // (unclaimed, at the current tier, under the cap — recordContractClear's own
  // three conditions). Without the null case the panel kept quoting a snapshot
  // taken after the clear banked, so a replay and the fresh contract-end render
  // both advertised a count and a salvage figure the bay could never pay — and
  // once a clear COMPLETED the tier it advertised the NEXT tier's number on a
  // bay that is still the old tier's. Practice names the bay's own tier for
  // that reason: a tier-6 board entry stays tier 6 on a tier-7 player's screen.
  check("a Contract that can bank nothing says so, in the BAY's tier",
    (() => {
      const practice = hudHTML({
        ...base,
        contract: {
          name: "Foundry Overrun", kind: "lines", goal: 5, lines: 2, launchesLeft: 9,
          remaining: [], lost: 7, conditions: "crosswind · cryo shipments",
          tier: 6, progress: null,
        },
      });
      return practice.includes('class="pl-tier"')
        && practice.includes('<span class="lbl">Tier 6</span>')
        && practice.includes('id="hud-tier">Practice</b>')
        && !practice.includes('class="currency"');
    })());
  check("a Deep Run bay renders neither row — it has notches instead",
    (() => {
      const run = hudHTML({ ...base, contract: null, timeLimitSec: 150, timeLeftMs: 90_000 });
      return !run.includes('id="hud-conditions"') && !run.includes('class="pl-tier"')
        && run.includes('id="hud-notches"');
    })());
}

// ---------------------------------------------------------------------------
section("The notch line's marks are big enough to read (components.ts)");
// The tally shipped its marks at 9px — the box the two-letter TEXT code they
// replaced had used — and on a phone that is four and a half device-independent
// pixels of stroked line work per axis. The owner's report was that the row
// read as coloured specks, and the fix was to double the box.
//
// Pinned as a NUMBER rather than against an exported constant, on purpose: a
// test that reads NOTCH_MARK_PX would agree with any value that constant ever
// takes, including 9 again. What is being defended is the floor itself — 18px,
// twice what it was — and the cost of it (a 9px-taller row) is what app.css's
// "one rhythm" note under `.pl-notch b` had to find room for, so a silent
// shrink back would leave that whole argument dangling.
{
  // Both kinds of mark in one line: a NUMBER axis draws an icons.ts glyph
  // (cost -> levy), a CONTENT axis draws the material's own belt icon
  // (cryo -> a mat-icon on a 24-unit grid), and the Final Inspection's clause
  // adds the ship system it examines. Three different drawing paths, one size.
  const tally = runNotchTallyHTML({ cost: 2, wind: 1, cryo: 1 } as Ratchets, "rush-order");
  const boxes = [...tally.matchAll(/width="(\d+)" height="(\d+)"/g)]
    .map((m) => [Number(m[1]), Number(m[2])] as const);
  check("every axis and the clause draw a mark", boxes.length === 4, `${boxes.length} marks`);
  check("no mark is under the 18px floor — twice the 9px the owner could not read",
    boxes.every(([w, h]) => w >= 18 && h >= 18), JSON.stringify(boxes));
  check("the marks are square, so the 16- and 24-unit grids agree on one box",
    boxes.every(([w, h]) => w === h));
  // The material glyph is the one that arrives through a different helper
  // (materialIconHTML, its own viewBox, its own colours) and so the one a
  // size change is most likely to miss.
  check("the material axis's belt icon takes the same box as the stroked ones",
    tally.includes('class="mat-icon" width="18" height="18"'));
}

// ---------------------------------------------------------------------------
section("The dial collapse (screens.ts collapsingDial + app.css)");
// The two losses a player could not tell apart. Running out of TIME and running
// out of MONEY both ended the same way — field freezes, modal arrives — and
// play-testers afterwards could not name which dial had emptied, because the
// modal that explains it has replaced the instrument it is explaining. The
// losing readout now crunches flat where it stands, one beat before the scrim
// covers it.
//
// Three things are pinned here, and they are the three that can silently rot:
// the reason -> readout mapping (a pure function, so it is testable at all),
// the MARKUP carrying the hook (the mapping is worthless if hudHTML stops
// emitting the class), and the animation's no-layout-change contract (read
// back out of app.css, because the harness that would otherwise catch a
// geometry change — sim/uifit — never renders a lost bay).
{
  const base = {
    beltPreview: { bomb: false, type: "T" as const, quarterTurns: 0, empty: false, hidden: false, material: "standard" as const },
    loaded: null,
    tier: 2, target: 800, score: 40, launchCost: 25, bayNum: 3,
    timeLimitSec: 150, timeLeftMs: 0, pieceSize: "std" as const,
    bondBreakerOwned: false, bondCharges: 0, demoOwned: false, bombCharges: 0,
    autoloaderOwned: false, ratchets: {} as Ratchets, tiers: newTiers(),
    contract: null,
  };
  const both = { funds: true, clock: true };

  check("the clock runs out -> the clock collapses",
    collapsingDial("time", both) === "time");
  check("the bankroll runs out -> the funds readout collapses",
    collapsingDial("broke", both) === "funds");
  // Every other verdict is deliberately silent. A topout is already its own
  // picture (the pile is against the ceiling, mid-screen) and points at no
  // dial; "launches" and "pieces" are supply verdicts whose column has been
  // counting down in plain sight, and crushing a readout for each of the five
  // reasons would make the cue mean "you lost" rather than "check THIS".
  check("every other loss collapses nothing",
    (["topout", "launches", "pieces"] as const).every((r) => collapsingDial(r, both) === null));
  check("a bay still being played collapses nothing",
    collapsingDial(null, both) === null && collapsingDial(undefined, both) === null);
  // The guards are the point of the second argument. Time out on a bay with no
  // clock is not a state the game can reach today (game.ts only sets "time"
  // when timeLeftMs hits 0, and it is Infinity without a limit), but the
  // MAPPING must not be the thing that assumes it: a Contract reporting
  // "broke" would otherwise crush its Lines/Goal figure, which is a number
  // that did not run out and cannot.
  check("no clock on the panel, no clock to crush",
    collapsingDial("time", { funds: true, clock: false }) === null);
  check("no Funds column on the panel, no bankroll to crush",
    collapsingDial("broke", { funds: false, clock: true }) === null);

  // --- the markup carrying the hook ----------------------------------------
  const timeOut = hudHTML({ ...base, lossReason: "time" });
  const broke = hudHTML({ ...base, lossReason: "broke" });
  const topout = hudHTML({ ...base, lossReason: "topout" });
  const alive = hudHTML({ ...base });
  // Anchored on the readout's own opening tag rather than on a bare
  // "dial-collapse", which would pass with the class on either column — the
  // one failure this cue cannot survive is pointing at the wrong dial.
  const hooked = (hud: string, cls: string): boolean =>
    new RegExp(`<div class="[^"]*\\b${cls}\\b[^"]*\\bdial-collapse\\b`).test(hud);
  check("a time loss hooks the clock column and only the clock column",
    hooked(timeOut, "pl-time") && !hooked(timeOut, "pl-funds"));
  check("a broke loss hooks the funds column and only the funds column",
    hooked(broke, "pl-funds") && !hooked(broke, "pl-time"));
  check("a topout hooks neither", !topout.includes("dial-collapse"));
  check("a bay in progress hooks neither", !alive.includes("dial-collapse"));
  // hudHTML asks collapsingDial with the two facts that decide whether the
  // column is on the panel at all, so the hook can never land on a column this
  // render did not emit. Both halves of that, both modes.
  check("a bay with no clock renders no clock to hook",
    !hudHTML({ ...base, timeLimitSec: 0, lossReason: "time" }).includes("dial-collapse"));
  check("a Contract's Lines/Goal figure is never crushed as a bankroll",
    !hudHTML({
      ...base,
      timeLimitSec: 0,
      lossReason: "broke",
      contract: {
        name: "Foundry Overrun", kind: "lines", goal: 5, lines: 2, launchesLeft: 9,
        remaining: [], lost: 0, conditions: "crosswind", tier: 1,
        progress: { tier: 1, runDone: false, contracts: 0, needed: 3, award: 45, milestone: 15 },
      },
    }).includes("dial-collapse"));

  // --- the choreography -----------------------------------------------------
  // The scrim's hold has to end INSIDE the crunch, not after it. Landing the
  // modal on a finished animation would put a still frame on screen for the
  // gap and read as a stall; landing it during the settle (the number is
  // already crushed and red by ~65%) reads as the modal arriving on top of
  // what just happened, which is the sequencing the cue is for.
  check("the scrim is held for most of the crunch, and lifts before it ends",
    DIAL_COLLAPSE_HOLD_MS < DIAL_COLLAPSE_MS && DIAL_COLLAPSE_HOLD_MS > DIAL_COLLAPSE_MS / 2,
    `${DIAL_COLLAPSE_HOLD_MS} vs ${DIAL_COLLAPSE_MS}`);

  // --- the stylesheet, read back --------------------------------------------
  // Same instrument the chute's geometry check uses two sections down: two
  // files in two languages own halves of one fact, so read the other half
  // rather than trusting a comment to stay true.
  {
    const styles = (name: string): string =>
      fs.readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", name),
        "utf8",
      );
    const tokens = styles("tokens.css");
    const css = styles("app.css");
    const token = tokens.match(/--dial-collapse:\s*(\d+)ms/);
    check("the crunch's duration is one number in two files",
      token !== null && Number(token[1]) === DIAL_COLLAPSE_MS,
      `${token?.[1] ?? "missing"} vs ${DIAL_COLLAPSE_MS}`);

    const kf = css.slice(css.indexOf("@keyframes dial-collapse"));
    const body = kf.slice(kf.indexOf("{") + 1, kf.indexOf("\n}"));
    check("the collapse keyframes are still findable", body.length > 0 && kf.startsWith("@keyframes"));
    // THE LAYOUT CONTRACT. Only compositor/paint properties may appear inside
    // these keyframes. This is the assertion the animation was designed
    // against: the plant panel's design box is a measured fit on the tightest
    // handset in sim/uifit's matrix, and a readout that grew by a pixel
    // mid-collapse would take the panel with it — on a screen sim/uifit never
    // renders, because the harness has no lost bay among its fixtures. A
    // `font-size`, `padding`, `width`, `margin` or `letter-spacing` sneaking
    // in here would therefore ship unmeasured. It cannot: this fails first.
    const ANIMATABLE = ["transform", "opacity", "color", "text-shadow"];
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    check("the crunch animates nothing that lays out",
      props.length > 0 && props.every((p) => ANIMATABLE.includes(p)),
      props.filter((p) => !ANIMATABLE.includes(p)).join(", "));
    // It also has to END somewhere, and where it ends is the state the run-end
    // modal fades in over: crushed, red, and still fully opaque. A collapse
    // that faded the number out would take the evidence away exactly when the
    // modal starts talking about it.
    const last = body.slice(body.lastIndexOf("100%"));
    check("...and settles crushed, red and readable, not faded away",
      /scale\(/.test(last) && last.includes("var(--danger)") && /opacity:\s*1\b/.test(last),
      last.trim());
    // Reduced motion keeps the teaching (the dial still singles itself out in
    // danger red) and drops the theatre. Asserted because the animation is the
    // ONLY thing writing that colour: without an explicit static fallback,
    // switching the animation off would leave the failing dial looking exactly
    // like a healthy one, which is the whole defect this cue exists to fix.
    const reduced = css.slice(css.indexOf(".dial-collapse .v {"));
    const block = reduced.slice(0, reduced.indexOf("/* Reload"));
    check("reduced motion still names the dial, in danger red, without moving",
      /prefers-reduced-motion[\s\S]*\.dial-collapse \.v \{[\s\S]*animation:\s*none[\s\S]*var\(--danger\)/.test(block),
      block.slice(-240).trim());
  }
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
    sound: true, music: true, haptics: true, seenDragHint: true, seenTutorial: true, seenKeyHints: true,
    leftHandRail: false, stickAssist: true, stickSling: false, wheelRotates: false, devMode: false,
  };
  const kb = controlsScreen({ tab: "keyboard", settings: ctrlSettings, padName: null, rebinding: null });
  check("every action is a rebindable row",
    BINDABLE_ACTIONS.every((a) => kb.includes(`data-bind="${a}"`)));
  check("the keyboard tab carries the wheel-rotates toggle",
    kb.includes('data-toggle="wheelRotates"'));
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
  // The toggle's KEY is what main.ts's generic onToggle writes into settings,
  // so a pane still naming the retired stickPull would flip a field nothing
  // reads and leave the mode stuck — silently, since neither end would error.
  check("the slingshot toggle writes the field the poller reads",
    padPane.includes('data-toggle="stickSling"') && !padPane.includes("stickPull"));
  // The dials' defining property is the one a player cannot discover by
  // pushing the stick — you find out a centred stick holds by NOT touching it
  // — so the row that describes the stick has to say it.
  check("...and the aim row states that a centred stick holds",
    padPane.includes("centre holds"));
  // THE AIM ROW DESCRIBES THE MODE THAT IS ON. Found in review: the row said
  // "centre holds" whatever the toggle underneath it was set to, so a player
  // who chose the slingshot was told the centre holds by the same screen whose
  // next row told them releasing lets the pull go. Two opposite answers to
  // "what happens when I let go", on one pane, one of them false.
  const slingPane = controlsScreen({
    tab: "gamepad",
    settings: { ...ctrlSettings, stickSling: true },
    padName: null,
    rebinding: null,
  });
  check("the slingshot's aim row describes the slingshot",
    slingPane.includes("pull back to aim") && slingPane.includes("release lets go"));
  check("...and does not also claim the centre holds",
    !slingPane.includes("centre holds"));
  check("...while the dials' row still claims it and not the pull",
    padPane.includes("centre holds") && !padPane.includes("pull back to aim"));
  // The assist only ever smoothed the SLINGSHOT's stick (gamepad.ts) — the
  // dials need none. Unqualified, the row offered a dial player a control that
  // does nothing. It names its scope instead of switching, so one string is
  // true in both modes.
  check("the assist toggle names the mode it actually smooths",
    padPane.includes("Smooth the slingshot stick")
      && slingPane.includes("Smooth the slingshot stick"));
  // The fixed menu buttons (ui/padnav.ts) are the one part of the pad's scheme
  // that has no row in the table below, because they have no binding — so the
  // pane states them, or they are documented nowhere at all.
  check("the gamepad pane states the fixed menu buttons",
    padPane.includes("D-pad move") &&
      padPane.includes(`${padLabel(PAD_CONFIRM)} select`) &&
      padPane.includes(`${padLabel(PAD_BACK)} back`));
  check("the gamepad pane names the button that opens it",
    padPane.includes("Open Controls") && padPane.includes(padLabel(PAD_CONTROLS)));
  // Controls is now reachable from every out-of-run menu (the pad's shortcut),
  // and its header has to say where Done will land — an eyebrow stuck on
  // "Settings" would be a screen lying about its own exit.
  check("the header names the door the player came through",
    controlsScreen({ tab: "touch", settings: ctrlSettings, padName: null, rebinding: null, back: "workshop" })
      .includes(">Workshop<") &&
      controlsScreen({ tab: "touch", settings: ctrlSettings, padName: null, rebinding: null, back: "howto" })
        .includes(">How to Play<"));
  check("both exits lead back through that same door",
    (controlsScreen({ tab: "touch", settings: ctrlSettings, padName: null, rebinding: null, back: "leaderboard" })
      .match(/data-action="leaderboard"/g) ?? []).length === 2);

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

  check("a desktop viewport is never shrunk", computeLayout(1600, 900).uiScale === 1);
  check("a desktop viewport is roomy", computeLayout(1600, 900).density === "roomy");
  // ...and is MAGNIFIED, which is the half that did not exist. 900px of height
  // against the 720px authored box is 1.25, and the width term (1.6) does not
  // bind. A desktop that came back at 1 here is the bug this channel fixes:
  // phone-sized furniture rendered 1:1 in the middle of a 1600px window.
  check("a desktop viewport is magnified", computeLayout(1600, 900).chromeZoom === 1.25,
    String(computeLayout(1600, 900).chromeZoom));

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

  // --- the magnification channel (chromeZoom) ------------------------------
  // Monotonic, bounded, and — the invariant the whole two-channel split rests
  // on — never simultaneous with a shrink. A viewport is either under the
  // authored box or over it, so a build where both are off their neutral
  // value at once means one of the two clamps has been mis-edited.
  {
    let prevZoom = 0;
    for (const h of [360, 480, 600, 720, 800, 900, 1080, 1440, 2160]) {
      const l = computeLayout(2560, h);
      check(`chrome zoom is monotonic at ${h}px tall`, l.chromeZoom >= prevZoom,
        `${l.chromeZoom} < ${prevZoom}`);
      prevZoom = l.chromeZoom;
    }
    for (const [w, h] of [[320, 200], [640, 360], [792, 360], [1000, 720], [1600, 900],
      [1920, 1080], [2560, 1440], [4000, 3000]] as [number, number][]) {
      const l = computeLayout(w, h);
      check(`${w}x${h} never shrinks and magnifies at once`,
        l.uiScale === 1 || l.chromeZoom === 1, `${l.uiScale} / ${l.chromeZoom}`);
      check(`${w}x${h} stays inside the zoom bounds`,
        l.chromeZoom >= 1 && l.chromeZoom <= 2, String(l.chromeZoom));
    }
    // Every HANDSET in the device matrix renders at 1:1. Not a rounding
    // result — a landscape phone is under the authored box on both axes by a
    // wide margin, so `zoom` is inert on the whole class and this change
    // cannot reach the devices the chrome was tuned on.
    for (const [name, w, h] of [
      ["640x360 budget", 640, 360],
      ["OnePlus 12", 792, 360],
      ["Pixel 7", 915, 412],
      ["iPhone SE 3", 667, 375],
      ["iPhone 16 Pro Max", 956, 440],
    ] as [string, number, number][]) {
      check(`${name} is not magnified`, computeLayout(w, h).chromeZoom === 1,
        String(computeLayout(w, h).chromeZoom));
    }
    // The tablets straddle the box, and the numbers say why the reference is a
    // reference rather than a ceiling: an iPad mini is 2% over it and an iPad
    // Pro 37% over. Neither is a phone, and rendering both at the same 1:1 the
    // 360px handsets get is what left the larger one looking like a screenshot
    // of the smaller one.
    check("iPad mini is barely magnified", computeLayout(1024, 768).chromeZoom === 1.024,
      String(computeLayout(1024, 768).chromeZoom));
    check("iPad Pro 12.9 is magnified on its width",
      Math.abs(computeLayout(1366, 1024).chromeZoom - 1.366) < 1e-9,
      String(computeLayout(1366, 1024).chromeZoom));
    // The WIDTH term binds too. A tall narrow window has no more room for the
    // menu's three-column row than a short one does, and magnifying on height
    // alone would push the action rail off the side of it.
    check("a tall narrow window is not magnified on height alone",
      computeLayout(1100, 2000).chromeZoom === 1.1,
      String(computeLayout(1100, 2000).chromeZoom));
    // 2560x1440 reaches the cap exactly; nothing past it goes further.
    check("chrome zoom caps at one doubling", computeLayout(4000, 3000).chromeZoom === 2,
      String(computeLayout(4000, 3000).chromeZoom));
  }

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

  // A viewport 460px tall or shorter can never be magnified, and app.css leans
  // on that: the menu's phone pin for --brand-w is written as
  // `@media (max-height: 460px)`, i.e. a VIEWPORT query standing in for a
  // question about the BOX the chrome is laid out in. The two are the same
  // number only while zoom is 1, and down here it provably is — 460/720 is
  // 0.64, and chromeZoom takes the smaller axis ratio and clamps it up to 1.
  // If the reference box ever grew past 720, this fails before the phones
  // silently start rendering a rule written for a box they no longer have.
  for (const w of [640, 792, 915, 1280, 2560, 4000]) {
    check(`a ${w}px-wide viewport 460px tall is not magnified`,
      computeLayout(w, 460).chromeZoom === 1, String(computeLayout(w, 460).chromeZoom));
  }
}

// ---------------------------------------------------------------------------
section("The odometer (app.css .roll — the lift's readouts)");
// Riding the tower changes the tier plate's number AND the destination panel's
// four readouts, and one shared mechanism rolls all five so the screen makes
// one move rather than five. The parts worth pinning are the ones that would
// break silently: the motion is a TRANSFORM (a roll that laid out would drag
// the panel's grid for the length of every ride), the curve is one token the
// car also uses (two copies would drift and the panel would stop travelling
// with the lift), reduced motion keeps the value and drops the travel, and the
// cells inherit their host's truncation.
{
  const styles = (name: string): string =>
    fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", name),
      "utf8",
    );
  const css = styles("app.css");
  const tokens = styles("tokens.css");

  // ONE CURVE, ONE TOKEN. The whole point of this change is that the panel
  // reads as travelling WITH the car, which is only true while the two share an
  // easing. They were the same literal cubic-bezier in two rules before this;
  // a token is what stops one of them being tuned alone.
  check("the lift's easing is a token, not a literal repeated per rule",
    /--roll-ease:\s*cubic-bezier\([^)]*\)/.test(tokens),
    "no --roll-ease in tokens.css");
  // Comments stripped first — the prose around these rules names the curve to
  // explain which motions deliberately do NOT use it, and a mention is not a
  // second copy.
  const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const literals = [...cssBare.matchAll(/cubic-bezier\(0\.34,\s*1\.28,\s*0\.64,\s*1\)/g)].length;
  check("...and no rule still carries that curve as a literal", literals === 0,
    `${literals} literal copies left in app.css`);
  const usesEase = [...css.matchAll(/transition:[^;]*var\(--roll-ease\)/g)].length;
  check("the car and the odometer both ride it", usesEase >= 2, `${usesEase} user(s)`);

  // THE LAYOUT CONTRACT, the same one the loss dial's keyframes are held to.
  // The track is transformed; nothing here may animate a box. A `height` or
  // `top` in this transition would move the panel's whole grid for the length
  // of every ride, on a screen whose column budgets are measured to the pixel.
  const rollRule = css.slice(css.indexOf(".is-rolling .roll {"));
  const rollBody = rollRule.slice(rollRule.indexOf("{") + 1, rollRule.indexOf("}"));
  // The WHOLE shorthand, split on its own TOP-LEVEL commas. Two traps here and
  // this check fell into both while it was being written: `transition` takes a
  // LIST, so reading only the first property lets `transform ..., height ...`
  // sail straight past — and a naive split on every comma tears
  // `var(--roll-dur, 355ms)` in half and reports the fallback as an animated
  // property. Depth-tracking is what distinguishes a list separator from a
  // comma inside a function.
  const transitionList = rollBody.match(/transition:\s*([^;]+);/)?.[1] ?? "";
  const segments: string[] = [];
  let depth = 0;
  let seg = "";
  for (const ch of transitionList) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { segments.push(seg); seg = ""; continue; }
    seg += ch;
  }
  segments.push(seg);
  const animated = segments.map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  check("the roll animates transform and nothing else",
    animated.length > 0 && animated.every((p) => p === "transform"), animated.join(", "));

  // The cell height is a VARIABLE with a 1em default, and that is load-bearing
  // rather than tidy: the plate's number sets `line-height: 1` so 1em is its
  // line box, while .bay-stat__val inherits `normal` and measures 13px against
  // its 11px font. A hard-coded 1em would crop every readout by 2px while it
  // rolled. main.ts measures the resting box and passes it in.
  // BOTH boxes, counted — the window and the cells inside it. Asserting the
  // pattern merely EXISTS passes while one of the two is hard-coded, and a
  // hard-coded window with variable cells is precisely the 2px crop this is
  // here to prevent.
  const sized = [...css.matchAll(/height:\s*var\(--roll-h,\s*1em\)/g)].length;
  check("both the roll's window and its cells take the overridable height",
    sized >= 2, `${sized} of the 2 boxes use var(--roll-h, 1em)`);

  // Reduced motion: the theatre goes, the teaching stays. With no transition
  // the track is laid out at its END offset on the first frame, so the new
  // value is simply there — which is the same treatment the plate has always
  // had, and the reason this is one line rather than a second set of keyframes.
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)",
    css.indexOf(".is-rolling .roll {")));
  check("reduced motion drops the travel and keeps the value",
    /\.is-rolling \.roll\s*\{\s*transition:\s*none/.test(reduced.slice(0, 200)),
    reduced.slice(0, 160).trim());

  // Each cell keeps its host's truncation. `.bay-stat__val` ellipsizes — the
  // clock's "2:24 · 10 bays" is over budget on the narrowest phones and
  // sim/uifit warns about exactly that — and that behaviour lives on the
  // element whose contents the roll replaces, so without this the longest
  // readout would grow its cell and push the track out of its own window.
  check("a rolling cell inherits the readout's own truncation",
    /\.roll > b\s*\{[^}]*white-space:\s*inherit[^}]*text-overflow:\s*inherit/.test(css),
    "the roll's cells do not inherit white-space/text-overflow");

  // WHY THE UNCHANGED-VALUE GATE EXISTS, stated as the fact that forces it.
  // A track of two identical cells does not look still while it moves: at any
  // offset you see the bottom of one copy above the top of the other, so an
  // unchanged readout would spend the ride torn in half to say nothing. Every
  // adjacent Mark step changes all four values — but the Skydeck flies
  // MARK_COUNT's bays, so a ride between the top Mark and the roof changes
  // none of them. That is the trip the gate is for, and if the balance ever
  // separates the two this check says the example has gone stale.
  const statsFor = (tier: number): string[] => {
    const html = S.baseBayPanelHTML({ tier, best: 0 });
    return [...html.matchAll(/class="bay-stat__val"[^>]*>([^<]*)</g)].map((m) => m[1]);
  };
  const top = statsFor(MARK_COUNT);
  const roof = statsFor(S.SKYDECK_TIER);
  check("the roof quotes the top Mark's bay, so a ride between them changes no readout",
    top.length === 4 && JSON.stringify(top) === JSON.stringify(roof),
    `${JSON.stringify(top)} vs ${JSON.stringify(roof)}`);
  // ...and the adjacent Marks are the opposite case, so the gate can never be
  // mistaken for "this panel never animates".
  let movedEverywhere = true;
  for (let m = 2; m <= MARK_COUNT; m++) {
    const a = statsFor(m - 1), b = statsFor(m);
    if (a.some((v, i) => v === b[i])) movedEverywhere = false;
  }
  check("...while every adjacent Mark step changes all four", movedEverywhere,
    "some adjacent pair shares a readout, so a normal ride would hold one still");
}

// ---------------------------------------------------------------------------
section("The menu's demo panel is an equation (app.css --brand-w)");
// The home screen's attract panel is 16:9 and shares its column with a shelf
// that has a hard floor, so its width is not a taste decision — it is the
// solution of a budget. It used to be a STAIRCASE of height media queries
// instead: 360px under a 620px-tall viewport, 640px at 700 and over, and a
// 440px default filling the band between. Read as a function of height that
// middle step is only reachable between box heights 621 and 699, which is a
// band no row in sim/uifit/devices.ts had — and exactly the band a desktop
// shell window lands in once the OS titlebar comes off a 1280x720 frame. The
// panel drew itself 440 wide in a 658px column and the shelf under it hit its
// per-row cap, which is the dead band a player reported from windowed Electron.
//
// Two files own halves of this now: the equation lives in app.css and the
// magnification it is written against lives in layout.ts. Read the stylesheet
// back rather than trusting a comment to stay true — same instrument the dial
// collapse uses on its keyframes.
{
  const styles = (name: string): string =>
    fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", name),
      "utf8",
    );
  const css = styles("app.css");
  const tokens = styles("tokens.css");

  const spacing = (n: number): number => {
    const m = tokens.match(new RegExp(`--sp-${n}:\\s*(\\d+)px`));
    if (!m) throw new Error(`--sp-${n} is not in tokens.css`);
    return Number(m[1]);
  };

  // THE CONTAINER THE EQUATION READS. `100cqh` needs a size container above it,
  // and if .menu stops being one the unit does not error — it silently falls
  // back to the small viewport height, which in a magnified subtree is the raw
  // window rather than the divided box the chrome is laid out in. That is a
  // wrong panel on every tablet and every desktop, with nothing to see in the
  // diff but a deleted line. So the line is pinned.
  const menuRule = css.slice(css.indexOf("\n.menu {"), css.indexOf("\n.menu__brand {"));
  check("the menu row is a size container, so 100cqh means the column's height",
    /container-type:\s*size/.test(menuRule),
    menuRule.slice(0, 200).trim());

  const brandRule = css.slice(css.indexOf("\n.menu__brand {"));
  const brandBody = brandRule.slice(brandRule.indexOf("{") + 1, brandRule.indexOf("\n}"));
  check("--brand-w is solved from the column's own height somewhere in the sheet",
    /--brand-w:\s*min\(100%,\s*calc\(\(100cqh\s*-\s*var\(--brand-reserve\)\)\s*\*\s*16\s*\/\s*9\)\)/
      .test(css),
    (css.match(/--brand-w:.*/g) ?? ["--brand-w is not declared"]).join(" | "));

  // The solver is kept off the STACKED branch, where the equation's premise
  // fails: `100cqh` is the whole .menu row, and the row is this column only
  // while the grid has one row. Guarded rather than overridden downstream —
  // an override would have to sit after the @supports block to win, which is
  // the arrangement that made the first attempt at this fragile.
  check("the solver is scoped away from the one-column branch",
    /@media\s+not\s+all\s+and\s*\(max-aspect-ratio:\s*1\s*\/\s*1\)\s*\{[\s\S]{0,400}?--brand-w:[^;]*100cqh/
      .test(css),
    "the 100cqh declaration is not inside a `not all and (max-aspect-ratio: 1/1)` guard");

  // The reserve, read back out of the stylesheet and re-derived here. Three
  // shelf rows is the shelf at its tallest (an entitlement entry above
  // Leaderboard and Settings), 44px is the tap floor the whole screen is built
  // to, and the 12px on top is the margin for a face whose rows measure taller
  // than Chromium's — WebKit's do.
  const floorExpr = brandBody.match(/--shelf-floor:\s*calc\(3\s*\*\s*(\d+)px\s*\+\s*2\s*\*\s*var\(--sp-3\)\)/);
  check("the shelf floor is three tap-sized rows and the gaps between them",
    floorExpr !== null && Number(floorExpr[1]) === 44, floorExpr?.[1] ?? "missing");
  const shelfFloor = 3 * 44 + 2 * spacing(3);
  check("...which is the 156px the old 640px step was derived against", shelfFloor === 156,
    String(shelfFloor));

  const reserveExpr = brandBody.match(
    /--brand-reserve:\s*calc\(var\(--shelf-floor\)\s*\+\s*(\d+)px\s*\+\s*var\(--sp-4\)\)/,
  );
  check("the reserve is the floor, the cross-engine headroom and the column's gap",
    reserveExpr !== null, brandBody.trim().slice(0, 200));
  const reserve = shelfFloor + Number(reserveExpr?.[1] ?? 0) + spacing(4);
  check("the reserve comes to 184px", reserve === 184, String(reserve));

  // THE IDENTITY THAT MAKES THIS A REFACTOR RATHER THAN A REDESIGN. In the
  // authored 1280x720 box the brand column is 544px tall and 640px wide, and
  // the equation returns exactly the 640 the deleted step declared by hand. So
  // every viewport the old step governed — every tablet, 1512x945, 1920x1080,
  // 2560x1080, all of them magnified to the same 720px box — lands on the same
  // number it landed on before, and only the band that had no step moves.
  const AUTHORED_COLUMN_H = 544;
  const panel = (columnH: number): number => ((columnH - reserve) * 16) / 9;
  check("the equation reproduces the authored 640px panel exactly",
    panel(AUTHORED_COLUMN_H) === 640, String(panel(AUTHORED_COLUMN_H)));
  // ...and the shelf it leaves is the 168px the old comment quoted: 12 more
  // than its floor, which is where that 12 came from.
  check("...leaving the shelf 12px over its floor",
    AUTHORED_COLUMN_H - panel(AUTHORED_COLUMN_H) * 9 / 16 - spacing(4) === shelfFloor + 12,
    String(AUTHORED_COLUMN_H - panel(AUTHORED_COLUMN_H) * 9 / 16 - spacing(4)));

  // The reported window, which is what the whole change is for. 1269x663 is a
  // 1280x720 desktop-shell frame minus the titlebar; its brand column measures
  // 505.7px tall and 658.5px wide (sim/uifit's own row measures both). The old
  // 440px default left a THIRD of that column empty beside the panel; the
  // equation spends it.
  const REPORTED_COLUMN_H = 505.7;
  const REPORTED_COLUMN_W = 658.5;
  const reported = Math.min(REPORTED_COLUMN_W, panel(REPORTED_COLUMN_H));
  check("the reported windowed size grows the panel well past the old 440px default",
    reported > 560 && reported < REPORTED_COLUMN_W, String(reported));
  check("...and still leaves the shelf its floor",
    REPORTED_COLUMN_H - reported * 9 / 16 - spacing(4) >= shelfFloor,
    String(REPORTED_COLUMN_H - reported * 9 / 16 - spacing(4)));

  // The 16/9 in the equation is the panel's own aspect ratio, not a constant
  // that happens to look right. If the panel is ever redrawn to another shape
  // the equation is wrong by exactly the difference, silently.
  const demoRule = css.slice(css.indexOf(".menu__demo.is-live {"));
  check("the equation's 16/9 is the panel's own aspect-ratio",
    /aspect-ratio:\s*16\s*\/\s*9/.test(demoRule.slice(0, demoRule.indexOf("\n}"))),
    demoRule.slice(0, 300).trim());

  // The wordmark rode the same staircase (31px under 700px tall, 42 above) and
  // is one number now for the same reason. A second cap coming back is a second
  // thing keyed to a height the panel no longer answers to.
  check("the wordmark's plate clamp is one cap, not a staircase",
    (css.match(/font-size:\s*clamp\(8px,\s*6\.8cqw,\s*\d+px\)/g) ?? []).length === 1,
    String((css.match(/font-size:\s*clamp\(8px,\s*6\.8cqw,\s*\d+px\)/g) ?? []).length));

  // --- ...and the engine that cannot solve it -------------------------------
  // THE DEPLOYMENT TARGET IS THE WHOLE REASON THE STEPS ARE STILL HERE.
  // Container queries reached WKWebView in Safari 16; this app ships to iOS
  // 15, so a supported device parses this stylesheet with no container units
  // at all and has to be handed the staircase instead. Read the target out of
  // the Xcode project rather than trusting the comment beside the CSS: the day
  // someone raises it to 16 the fallback becomes dead weight, and this is the
  // check that says so out loud instead of leaving it to rot.
  const pbx = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ios", "App",
      "App.xcodeproj", "project.pbxproj"),
    "utf8",
  );
  const targets = [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => parseFloat(m[1]));
  check("the iOS deployment target is still readable from the Xcode project",
    targets.length > 0, String(targets.length));
  const CONTAINER_QUERY_IOS = 16;
  check("...and still below the iOS that has container queries, so the steps are load-bearing",
    Math.min(...targets) < CONTAINER_QUERY_IOS, `min target ${Math.min(...targets)}`);

  // The fallback CANNOT be two declarations of the same custom property, which
  // is what this rule tried first and what a review caught. A custom property's
  // value is an untyped token stream, so an engine with no `cqh` still accepts
  // the declaration and still lets it win on source order; the unit is only
  // rejected when `width: var(--brand-w)` is substituted, and an
  // invalid-at-computed-value-time `width` falls back to `auto`, not to the
  // earlier declaration. Measured: on the reported 1269x663 window that took
  // the brand column to 552.6px inside a 505.7px row — a 47px overflow under
  // .screen's `overflow: hidden`, worse than the band the change set out to
  // fix. So: exactly one --brand-w in .menu__brand's own block.
  const ownBlock = brandBody.replace(/\/\*[\s\S]*?\*\//g, "");
  check("the brand rule declares --brand-w once, not as a two-declaration fallback",
    (ownBlock.match(/--brand-w\s*:/g) ?? []).length === 1,
    String((ownBlock.match(/--brand-w\s*:/g) ?? []).length));

  // Every container-unit use of --brand-w lives inside a feature query. Cut the
  // @supports blocks out and no `cq*` unit may be left setting this token.
  //
  // Comments come out FIRST, and that is not tidiness — the prose beside these
  // rules discusses @supports by name, and a brace-matcher that starts from the
  // first literal "@supports" in the file starts inside a comment and swallows
  // every rule between there and the next closing brace. It did exactly that on
  // the first run of this check, which is how the two step assertions below
  // went red against a stylesheet that already had them.
  const stripSupports = (s: string): string => {
    let out = "";
    for (let i = 0; i < s.length; ) {
      const at = s.indexOf("@supports", i);
      if (at < 0) { out += s.slice(i); break; }
      out += s.slice(i, at);
      let depth = 0, j = s.indexOf("{", at);
      for (; j < s.length; j++) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}" && --depth === 0) { j++; break; }
      }
      i = j;
    }
    return out;
  };
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const noSupports = stripSupports(noComments);
  check("stripping @supports leaves the rest of the stylesheet intact",
    noSupports.includes(".menu__brand") && noSupports.length > noComments.length * 0.9,
    `${noSupports.length} of ${noComments.length} chars survived`);
  check("no --brand-w outside a feature query uses a container unit",
    !/--brand-w\s*:[^;]*\bcq(h|w|i|b|min|max)\b/.test(noSupports),
    (noSupports.match(/--brand-w\s*:[^;]*cq[a-z]+[^;]*/g) ?? []).join(" | "));
  // ...and the solver really is behind one, rather than simply absent.
  check("the solved --brand-w sits inside an @supports for container units",
    /@supports\s*\(\s*width:\s*1cq[a-z]+\s*\)/.test(css)
      && /--brand-w\s*:[^;]*100cqh/.test(css),
    "no @supports (width: 1cq*) guarding the solver");

  // STRIP THE ENHANCEMENT AND THE OLD SCREEN HAS TO BE UNDERNEATH IT. These are
  // the three steps this change replaced, and an iOS 15 device gets exactly
  // them; the simulated run (cq units stubbed out) reproduces staging's panel
  // at all eight sampled sizes. Asserted on the stripped stylesheet so that
  // deleting a step "because the equation covers it" fails here rather than on
  // a device nobody in this repo owns.
  for (const [label, re] of [
    ["440px default", /\.menu__brand\s*\{[^}]*--brand-w:\s*min\(100%,\s*440px\)/],
    ["360px step under a 620px-tall viewport",
      /@media\s*\(max-height:\s*620px\)\s*\{\s*\.menu__brand\s*\{\s*--brand-w:\s*min\(100%,\s*360px\)/],
    ["640px step at 700px and over",
      /@media\s*\(min-height:\s*700px\)\s*\{\s*\.menu__brand\s*\{\s*--brand-w:\s*min\(100%,\s*640px\)/],
  ] as [string, RegExp][]) {
    check(`the pre-container-query base still carries its ${label}`, re.test(noSupports),
      "missing from the stylesheet with @supports stripped");
  }
  // The two thresholds must not OVERLAP. They are read back rather than
  // assumed: if someone nudged the step-down past the step-up, both queries
  // would match on the same viewport and the answer would come down to which
  // rule happened to be later in the file. The band they leave between them is
  // deliberate — it is where the 440px default lives, and on a modern engine it
  // is exactly where the equation takes over.
  const stepDown = noSupports.match(/@media\s*\(max-height:\s*(\d+)px\)\s*\{\s*\.menu__brand\s*\{\s*--brand-w/);
  const stepUp = noSupports.match(/@media\s*\(min-height:\s*(\d+)px\)\s*\{\s*\.menu__brand\s*\{\s*--brand-w/);
  check("the stepped fallback's two thresholds do not overlap",
    stepDown !== null && stepUp !== null && Number(stepDown[1]) < Number(stepUp[1]),
    `${stepDown?.[1] ?? "?"} / ${stepUp?.[1] ?? "?"}`);
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
  // scale the game runs at, using advances measured from the app's OWN font
  // files rather than the sandbox's fallback font metrics (the real Press Start
  // 2P is far wider than any fallback, which is exactly why this reproduced on a
  // device and not in a headless browser).
  //
  // EVERY advance below is MEASURED against app/public/fonts/*.woff2 under the
  // exact app.css rule named beside it — not estimated. Estimating is what went
  // wrong before: a flat "Rajdhani averages 0.45em/glyph" under-priced every
  // tier-2 label by 13-30%. That matters in the UNSAFE direction, because
  // fundsBudget SUBTRACTS those labels from the width it hands the funds line —
  // undershooting a label inflates `available`, so the budget can only ever be
  // too optimistic, never too strict. (It had not yet swallowed a real overflow:
  // recalibrating cost the compact cases ~13px of `available` and the tightest
  // one still clears by 64px. The margin was real; the arithmetic was not.)
  // Measurement is linear in font-size to within 0.05%, so one em figure per
  // string covers every scale.
  //
  // Both of these faces are MONOSPACE, so one per-glyph advance is exact:
  //   mono  0.60em/glyph — JetBrains Mono, .pl-stat .v / .pl-funds .v; identical
  //                        at weight 700 and 800
  //   pixel 1.00em/glyph — Press Start 2P at .pl-stat .lbl's `letter-spacing: 0`
  const MONO_ADV = 0.6;
  const PIXEL_ADV = 1.0;

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
  /**
   * Rajdhani is PROPORTIONAL, so — unlike the two monospace faces above — no
   * single per-glyph advance is right for it. Its real per-glyph cost runs from
   * 0.516em (LEFT) to 0.645em (COMBO) depending on how many round bowls the word
   * carries, which is why a flat average failed worst on exactly the labels this
   * budget uses. These are measured widths of the WHOLE WORD, in em of the
   * label's font-size, as [data-density="compact"] .pl-stat .lbl renders it:
   * rajdhani-700.woff2, letter-spacing 0.06em, uppercase.
   */
  const UI_EM: Record<string, number> = {
    LAUNCHES: 4.7637, // 38.109px @ 8px
    SHIPMENTS: 5.2246, // 41.797px @ 8px
    TIME: 2.1563, // 17.250px @ 8px
  };
  /** Worst per-glyph advance seen across a wider survey of the HUD's labels
   *  (COMBO, 0.6449em). A label that is not in the table above is priced at this
   *  rather than at an average, so adding one can never quietly price it
   *  NARROWER than a word that was actually measured. */
  const UI_ADV_MAX = 0.6449;
  const uiLabelEm = (label: string) => UI_EM[label] ?? label.length * UI_ADV_MAX;

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
    /** Width of a tier-2 label in em of its own font-size. Compact swaps the
     *  face, so it swaps the metric with it. */
    const lblEm = (label: string) =>
      compact ? uiLabelEm(label) : label.length * PIXEL_ADV;
    const statVal = mx(STAT_VAL_MIN, STAT_VAL_FPX);
    const statPad = mx(STAT_PAD_MIN, STAT_PAD_FPX);

    // Each stat column is as wide as the WIDER of its label and its mono value —
    // the label is what dominates at small scales, and missing that is what made
    // the original budget wrong.
    const col = (label: string, value: string) =>
      Math.max(lblEm(label) * statLbl, value.length * MONO_ADV * statVal) + statPad;
    // The first column's heading is "Launches" on a normal bay and "Shipments"
    // on a pattern Contract (screens.ts's plant panel) — one glyph longer and
    // 0.46em wider. The budget has to price the WIDER of the two it can render,
    // or it proves the case that happens not to be the tight one.
    const launchesCol = col("SHIPMENTS", String(Math.floor(funds / 25)));
    const timeCol = col("TIME", "0:00") + mx(STAT_MARGIN_MIN, STAT_MARGIN_FPX);
    // A LINES Contract renders a third column where a Deep Run puts its clock
    // (screens.ts's hudHTML). It cannot be the binding one: "LOST" and "TIME"
    // are both 4 glyphs, so the label term is identical, and its widest value
    // ("999", the degenerate near-total-loss case) is shorter than "0:00" — so
    // lostCol <= timeCol holds by construction at every viewport. Returned so
    // the check below reads the same numbers this budget does rather than
    // re-deriving them from a second copy of the model.
    const lostCol = col("LOST", "999") + mx(STAT_MARGIN_MIN, STAT_MARGIN_FPX);

    const gaps = 2 * mx(READ_GAP_MIN, READ_GAP_FPX);
    const available = content - launchesCol - timeCol - gaps;

    // "$1259" + a space + "/ 1700" — the target renders at TGT_EM of the figure.
    const scoreStr = "$" + funds;
    const tgtStr = "/ " + target;
    const needed =
      scoreStr.length * MONO_ADV * fundsFs +
      MONO_ADV * fundsFs +
      tgtStr.length * MONO_ADV * fundsFs * TGT_EM;

    return { available, needed, slack: available - needed, mode: l.mode, timeCol, lostCol };
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

  // fundsBudget only ever models the DEEP RUN column set (Funds/Target +
  // Launches + Time) — it knows nothing about a lines Contract's row (Lines/
  // Goal + Launches + Lost). The two extra columns are not the risk: goal
  // never leaves single digits (contracts.ts's lines-goal formula tops out at
  // 3 + 2 + 4 = 9) where a Deep Run target runs to 4 figures, and a Contract's
  // launch budget tops out at 44 (launchesFor at goal 9, std pieces, volatile
  // material at its rate cap, tight launch budget — the same worst-case
  // branch sim/uifit/fixtures.ts's hud-contract-lines fixture derives 176
  // from, ~line 401: 44 launches x 4 cubes/piece), well inside the 3-digit
  // launchesCol the loop above already proves fits. LOST is the one column
  // nothing has priced: same label length as TIME ("LOST" / "TIME", 4
  // glyphs), and a lines Contract cannot lose more cubes than that same
  // worst case ever ships (176), so "999" is a deliberately generous
  // stand-in for the value string, not the real ceiling.
  //
  // The check below guards that ASSUMED value width, not the DOM: it never
  // reads screens.ts's actual markup, so renaming the LOST label there would
  // not fail it. It is also a SINGLE assertion rather than one per viewport,
  // on purpose — `col`'s formula makes the label term identical for LOST and
  // TIME (same 4 glyphs) and the value term strictly smaller for LOST ("999"
  // is 3 characters against "0:00"'s 4), so max(label, value) for LOST can
  // never exceed the same for TIME, for every scale factor computeLayout can
  // produce — it holds by construction, not by measurement. The viewport
  // below is arbitrary; six of them were six copies of one arithmetic fact,
  // which is not six times the coverage.
  {
    const [name, w, h] = VIEWPORTS[0];
    const { timeCol, lostCol } = fundsBudget(w, h, 1_259, 1_700);
    check(
      `${name}: a lines Contract's assumed Lost width fits inside Time's (holds for every viewport by construction)`,
      lostCol <= timeCol,
      `lostCol ${lostCol.toFixed(1)}px vs timeCol ${timeCol.toFixed(1)}px`,
    );
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
    name, score, mark: 1, level: 1, lines: 10, created_at: 0,
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
  // see level.ts's targetScoreFor note), from an opening the TIER sets, while
  // launch cost and the clock stay flat inside a run so the pressure comes
  // from the quota rising against the same money.
  const bays = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, 1));
  check("the funding target rises every bay",
    bays.every((b, i) => b.targetScore === TARGET_BASE + TARGET_PER_BAY * i),
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
  const topBays = Array.from({ length: 10 }, (_, i) => makeBaseLevel(i, MARK_COUNT));
  check("a higher tier climbs faster inside the run than a lower one",
    topBays[9].targetScore - topBays[0].targetScore > bays[9].targetScore - bays[0].targetScore,
    `${topBays[9].targetScore - topBays[0].targetScore} vs ${bays[9].targetScore - bays[0].targetScore}`);
  // The mistake budget is a SHOT count, not a dollar figure, so it has to hold
  // at every tier — not just at the Mark-1 bays the float check above walks.
  check("every tier's float buys the same tight launch budget",
    Array.from({ length: MARK_COUNT }, (_, m) => makeBaseLevel(0, m + 1))
      .every((b) => b.startingFunds >= 7 * b.launchCost && b.startingFunds <= 9 * b.launchCost),
    Array.from({ length: MARK_COUNT }, (_, m) => {
      const b = makeBaseLevel(0, m + 1);
      return `${Math.round(b.startingFunds / b.launchCost)}`;
    }).join(","));
  // What a Mark still does NOT move: the press tempo. It is the one knob
  // sim/marks.ts measured as actively harmful (see level.ts's calibration note).
  check("a Mark changes no press tempo on the base ladder",
    Array.from({ length: MARK_COUNT }, (_, m) => makeBaseLevel(5, m + 1))
      .every((b) => b.compactorSpeed === makeBaseLevel(5, 1).compactorSpeed));

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
  // The two caps are ONE number, and that is what keeps materialMix a literal
  // per-shipment probability all the way to the top of the ratchet: the belt
  // can deliver at most BELT_CEILING, so a mix allowed to sum above it would be
  // a promise the schedule cannot keep — and preview.ts prints those numbers to
  // the player unmediated.
  check("the mix cap is the belt ceiling",
    MIX_TOTAL_CAP === BELT_CEILING, `${MIX_TOTAL_CAP} vs ${BELT_CEILING}`);
  check("a fully ratcheted belt lands exactly on the ceiling",
    Math.abs(mixTotal(allMaxed.materialMix) - BELT_CEILING) < 1e-9,
    `${mixTotal(allMaxed.materialMix).toFixed(4)}`);
  // The scale-down is PROPORTIONAL, so notches past the ceiling stop adding
  // specials and start deciding WHICH special — belt.ts's rule 3, and the whole
  // reason a capped belt is still an escalating one.
  {
    const lopsided = applyRatchets(flat, { slag: 6, cryo: 1 });
    const share = lopsided.materialMix.slag
      / (lopsided.materialMix.slag + lopsided.materialMix.cryo);
    check("past the ceiling, notches buy composition rather than arrivals",
      Math.abs(mixTotal(lopsided.materialMix) - BELT_CEILING) < 1e-9 && share > 0.8,
      `belt ${mixTotal(lopsided.materialMix).toFixed(3)}, slag ${(share * 100).toFixed(0)}% of it`);
  }

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
          // TWO materials, two cards, at every Mark: the choice is which
          // material, never whether. At the capstone both picks land on
          // materials — one of each, or one doubled — and that is a
          // RE-decision (see materialHand): the spare number card it briefly
          // dealt guarded against a belt flood the belt ceiling has since
          // capped structurally, and its real price was the phone's
          // projection scrolling behind a three-card column.
          if (inHand.length !== 2) forcedEverywhere = false;
          if (offer.length !== 2) forcedEverywhere = false;
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
    check("with two or more materials, the hand forces one and offers a choice of which",
      forcedEverywhere);
    check("with one material, it is paired with the run's hardest active axis", pairedWhenSingle);
    // Kept, but no longer the whole story: with two DISTINCT materials in the
    // hand this cannot fire, and saying so is more honest than implying a guard
    // is holding it back. The property that actually needs pinning is the one
    // below — slag IS dealt on forced bays, and at the capstone the player has
    // no room to refuse it.
    check("slag is never the only thing on offer", !slagEverAlone);
    check("slag is genuinely dealt on forced bays (not quietly excluded)", slagOffered);
    {
      // The capstone's forced hand is TWO MATERIALS and nothing else — the
      // "materials only" promise, held at the rung where it briefly grew a
      // spare number card. That card's history is in materialHand: it guarded
      // against a belt flood (two material notches a forced bay, three forced
      // bays a run) that belt.ts's ceiling has since capped structurally —
      // past one-in-three, notches recompose the belt rather than thicken it
      // — and what it still cost was the phone's projection scrolling behind
      // a three-card column. Both picks therefore land on materials: one of
      // each, or one doubled, which is a real choice of composition and the
      // reason slag can still be refused (put both picks on the other card).
      const capstoneForced = hazardOffers(4242, MATERIAL_DRAFT_BAYS[0] - 1, CAPSTONE_MARK);
      const picks = picksPerBay(CAPSTONE_MARK);
      const mats = capstoneForced.filter((h) => h.kind === "content");
      check(
        `a capstone forced hand is two materials, and only two cards (${picks} picks)`,
        capstoneForced.length === 2 && mats.length === 2,
        capstoneForced.map((h) => h.id).join(","),
      );
      check(
        "a capstone forced hand cannot be dodged entirely",
        capstoneForced.length - mats.length < picks,
        `${mats.length} material(s) among ${capstoneForced.length} cards`,
      );
    }
    check("ordinary bays are untouched by the forced hands", offBaysUnchanged);
    check("a forced hand still deals at least as many cards as picks", !capstoneShort);

    // EVERY hand deals TWO cards (the pool permitting), and two cards is a
    // real draft at every quota because of togglePick's double: one pick
    // chooses between them, two picks choose among {A twice, one of each,
    // B twice}. The hand briefly grew to three at the capstone on the reading
    // that two-cards-two-picks was no choice — a reading that missed the
    // double — and the third card's real price was the phone's projection
    // scrolling behind the card column (the owner's device pass).
    //
    // Slag's dodgeability is re-pinned WITH doubles counted, because it is the
    // rule that actually matters: slag is the one material with no passive
    // counter, so a bay that ratchets it onto a player with an empty bomb rack
    // is quietly unwinnable. A hand dodges slag if its non-slag cards can
    // absorb every pick — any non-slag card can take them all by doubling,
    // EXCEPT a forced hand's partner, which togglePick caps at one seat.
    {
      let tooSmall: string[] = [];
      let slagForced = 0;
      for (let m = 1; m <= MARK_COUNT; m++) {
        for (let seed = 0; seed < 300; seed++) {
          for (let b = 0; b < 10; b++) {
            const offer = hazardOffers(seed, b, m, undefined, { cost: 2, time: 2, wind: 1 });
            const picks = picksPerBay(m);
            // Marks 1-2 deal the whole pool (two axes, one pick) — a hand
            // cannot be bigger than the axes that exist, and hazardOffers
            // returns the pool wholesale there. That is the one honest
            // exception to the two-card floor.
            if (offer.length < 2 && hazardsForMark(m).length >= 2) {
              tooSmall.push(`m${m}b${b}:${offer.length}`);
            }
            if (offer.length < picks) tooSmall.push(`m${m}b${b}:${offer.length}<${picks}`);
            const forcedHand = isMaterialDraft(b);
            const dodgeCapacity = offer
              .filter((h) => h.id !== "slag")
              .reduce((cap, h) => cap + (forcedHand && h.kind !== "content" ? 1 : picks), 0);
            if (dodgeCapacity < picks) slagForced += 1;
          }
        }
      }
      check("every hand deals two cards, and never fewer than its picks",
        tooSmall.length === 0, tooSmall.slice(0, 4).join(" "));
      check("no hand can force slag on a player who refuses it (doubles counted)",
        slagForced === 0, `${slagForced} forced hands`);
    }

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

  // ---- The draft card's title row belongs to the NAME ----------------------
  //
  // A player on a 792x360 phone reported "Volatile Contract" rendering as
  // "Volatile Contrac". The cause was furniture: the notch-level badge and the
  // pick box shared the title row with the name, and on a phone the two cards
  // sit side by side, so the name was negotiating for ~100px against ~50px of
  // badge and box. Both now ride the card's FOOTER (screens.ts's
  // `.mod-card__foot`), and this pins the arrangement rather than the symptom —
  // an overflow assertion cannot see a `-webkit-line-clamp` eating a word, so
  // the uifit harness never would have caught this and did not.
  //
  // Structural, in both directions: the title row must not contain the badge or
  // the box, and the footer must contain both, on the ratchet card AND on the
  // Final Inspection's clause card. The two screens are deliberately one shell
  // (see finalScreen's note), and a fix applied to only one of them is how that
  // sameness gets lost.
  {
    const between = (html: string, open: string, close: string): string => {
      const i = html.indexOf(open);
      return i < 0 ? "" : html.slice(i, html.indexOf(close, i));
    };
    const run = { ...newRun(25, [], 400, undefined, 10), levelIndex: 7, carry: 120, scrap: 340 };
    const marks: Ratchets = { volatile: 1, magnetic: 1 };
    const draft = S.draftScreen({
      bayNum: 8, tier: 10, funds: 1_820, carry: 120,
      offers: hazardOffers(25, 7, 10, 2, marks),
      ratchets: marks, selected: ["volatile"], picksNeeded: 2,
      preview: previewRows(levelForRun(run), levelForRun(run), marks),
      scrap: 340, baysToRefit: 1, forced: true,
    });
    const inspection = S.finalScreen({
      bayNum: 9, tier: 10, funds: 1_820, carry: 120,
      offers: finalsForTier(10), selected: finalsForTier(10)[0].id,
      preview: previewRows(levelForRun(run), levelForRun(run), marks),
      scrap: 340,
    });
    for (const [name, html] of [["ratchet", draft], ["inspection", inspection]] as const) {
      const top = between(html, `<div class="mod-card__top">`, `</div>`);
      const foot = between(html, `<div class="mod-card__foot">`, `</div>`);
      check(`the ${name} card's title row carries no pick box`,
        top !== "" && !top.includes("mod-card__box"), top);
      check(`the ${name} card's footer carries the pick box, bottom-right`,
        foot.includes("mod-card__box") && foot.includes("mod-card__state"), foot);
    }
    // The level badge is the ratchet card's alone (a clause has no notches),
    // and it belongs beside the box, not beside the name.
    const draftTop = between(draft, `<div class="mod-card__top">`, `</div>`);
    const draftFoot = between(draft, `<div class="mod-card__foot">`, `</div>`);
    check("the notch level rides the footer, not the title row",
      !draftTop.includes("mod-card__lvl") && draftFoot.includes("mod-card__lvl"), draftFoot);
    // And the name is emitted whole. This one passed before the fix too — the
    // clipping was CSS, not the template — and it is here so that a future
    // "just truncate it in the string" never becomes the answer.
    check("the card names the hazard in full",
      draft.includes(`<span class="mod-card__name">Volatile Contract</span>`));
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
  // VISUAL DISTINCTNESS. This check used to compare the colours as STRINGS, and
  // it passed for months while rebar sat at a CIEDE2000 distance of 2.0 from the
  // L shipment's own colour — two different hex literals, one colour to the eye,
  // and a player reporting they could not tell a rigid shipment from an ordinary
  // one. Set-of-strings is not a distinctness test; it is a typo test.
  //
  // So the floor is perceptual, and it is measured against the PIECE colours too
  // — a material is worn by every shape, so "distinct from the other materials"
  // was never the whole question. dE00 10 is deliberately modest: it is roughly
  // "clearly not the same swatch", not "comfortably distinguishable", because
  // the palette provably cannot deliver the latter (theme.ts's MATERIAL_GLYPH)
  // and a threshold nothing can pass is a threshold that gets deleted.
  {
    const swatches: Array<[string, string]> = [
      ...MATERIALS.filter((m) => m !== "standard")
        .map((m) => [m, MATERIAL_SPEC[m].color!] as [string, string]),
      ...PIECE_TYPES.map((t) => [`piece-${t}`, PIECE_COLORS[t]] as [string, string]),
    ];
    let worst = Infinity;
    let worstPair = "";
    for (let i = 0; i < swatches.length; i++) {
      for (let j = i + 1; j < swatches.length; j++) {
        const d = deltaE00(swatches[i][1], swatches[j][1]);
        if (d < worst) { worst = d; worstPair = `${swatches[i][0]}/${swatches[j][0]}`; }
      }
    }
    check("no two swatches on the field are the same colour",
      worst >= 10, `closest pair ${worstPair} at dE00 ${worst.toFixed(1)}`);
  }
  // The glyphs are what actually carry a material now, so they get the same
  // treatment the colours failed: every one present, and every one different.
  check("every non-standard material has a glyph",
    MATERIALS.filter((m) => m !== "standard")
      .every((m) => MATERIAL_GLYPH[m as Exclude<Material, "standard">]?.d.length > 0));
  check("no two materials share a glyph",
    new Set(Object.values(MATERIAL_GLYPH).map((g) => g.d)).size
      === Object.keys(MATERIAL_GLYPH).length);
  // The bay-glyph list is a SUBSET of the materials that have glyphs, and it
  // deliberately excludes the two whose bay treatment is already correct — see
  // theme.ts's BAY_GLYPH_MATERIALS for the "do you still decide about this cube
  // after it lands" test that picks them.
  check("bay glyphs are drawn only for materials that have one",
    BAY_GLYPH_MATERIALS.every((m) => m !== "standard"
      && MATERIAL_GLYPH[m as Exclude<Material, "standard">] !== undefined));
  check("magnetic and cryo carry no bay glyph",
    !BAY_GLYPH_MATERIALS.includes("magnetic") && !BAY_GLYPH_MATERIALS.includes("cryo"));
  // Ink has to flip, or the mark is invisible on the material it is marking.
  check("glyph ink flips with the material's luminance",
    glyphInk(MATERIAL_SPEC.tar.color!) !== glyphInk(MATERIAL_SPEC.volatile.color!));
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

  // THE SLAG BOUNTY. A volatile detonation pays for the SLAG it destroys and
  // for nothing else. The distinction is the entire licence for this payout:
  // game.ts's resolveVolatile refuses to pay for a detonation as such, because
  // "paying for it would make ratcheting the volatile axis an income strategy,
  // which is the exact inversion of a hazard". A bounty on slag is not that —
  // it pays only where the player ratcheted a SECOND axis, and it pays for
  // removing cargo that was already worth nothing. If a future edit ever makes
  // a standard cube pay here, that argument is broken and check 2 is the one
  // that says so.
  {
    const at = (x: number, material: Material): Cube => ({
      body: Matter.Bodies.rectangle(x, 100, CELL, CELL),
      material, struck: true,
    } as Cube);
    const slag3 = [at(0, "slag"), at(CELL, "slag"), at(CELL * 2, "slag")];
    check("a volatile blast pays the bounty for every slag cube it destroys",
      slagBountyFor(slag3, SLAG_BOUNTY) === 3 * SLAG_BOUNTY,
      `${slagBountyFor(slag3, SLAG_BOUNTY)} vs ${3 * SLAG_BOUNTY}`);
    // The anti-inversion rule, pinned. Live cargo obliterated by a hazard is a
    // LOSS and must stay one.
    const cargo = [at(0, "standard"), at(CELL, "cryo"), at(CELL * 2, "volatile")];
    check("a volatile blast pays nothing for the live cargo it destroys",
      slagBountyFor(cargo, SLAG_BOUNTY) === 0);
    check("a mixed blast pays for the slag half only",
      slagBountyFor([...slag3, ...cargo], SLAG_BOUNTY) === 3 * SLAG_BOUNTY);
    // The premium is what makes disposal worth a launch; equal to salvagePerCube
    // it would just be the bomb's refund with extra steps.
    const stock = makeBaseLevel(0);
    check("slag is worth strictly more than a standard cube's salvage",
      SLAG_BOUNTY > stock.salvagePerCube,
      `bounty ${SLAG_BOUNTY} vs salvage ${stock.salvagePerCube}`);
    // ...and strictly less than a line, or disposal becomes the game.
    check("a blast full of slag still pays less than one line",
      3 * SLAG_BOUNTY < stock.scorePerLine * 2,
      `${3 * SLAG_BOUNTY} vs ${stock.scorePerLine * 2}`);
  }

  // THE RESUPPLY LINE. A bay is long enough to out-last six charges — PR #70's
  // Slag Wall opens one on 11 cubes of it — so the capstone returns charges as
  // lines are cleared. Metered on LINES cumulatively rather than on a per-clear
  // delta: a 4-line clear arrives as one event, and an equality test against
  // the interval would silently skip the grant.
  {
    const N = DEMO_RESUPPLY_LINES;
    check("no charge is owed before the first interval is reached",
      bombResupply(N - 1, 0, N) === 0);
    check("one charge is owed at the interval",
      bombResupply(N, 0, N) === 1);
    check("a charge already granted is never granted twice",
      bombResupply(N, 1, N) === 0);
    // The delta-vs-cumulative trap: four lines at once must still pay.
    check("a single multi-line clear that spans an interval still pays",
      bombResupply(N * 2, 1, N) === 1);
    check("a clear spanning two intervals pays both",
      bombResupply(N * 2, 0, N) === 2);
    // 0 disables — every tier below the capstone, and every bay of a run that
    // never bought the track.
    check("an interval of 0 never returns a charge",
      bombResupply(999, 0, 0) === 0);
  }

  // Only the MAXED Demolition Rack resupplies. The lower tiers stay a flat
  // count, so the capstone is a change in kind rather than another +2.
  {
    const tiersAt = (t: number) => {
      const tiers = newTiers();
      tiers.demolition = t;
      const cfg = makeBaseLevel(0);
      applyUpgrades(cfg, tiers);
      return cfg;
    };
    check("demolition tiers 0-2 grant no resupply",
      [0, 1, 2].every((t) => tiersAt(t).bombResupplyLines === 0));
    check("demolition tier 3 opens the resupply line",
      tiersAt(MAX_TIER).bombResupplyLines === DEMO_RESUPPLY_LINES,
      `${tiersAt(MAX_TIER).bombResupplyLines}`);
    // The charge count itself is untouched by this change.
    check("the capstone still grants its six charges",
      tiersAt(MAX_TIER).bombCharges === 6);

    // The capstone's other two halves. Charges alone did not answer the bay
    // that actually loses — a Tier-10 belt deep in slag and tar, where a full
    // rack still could not open the crust or pay for the shots it took. See
    // level.ts's DEMO_BLAST_MULT note.
    const stock = tiersAt(0);
    const capped = tiersAt(MAX_TIER);
    check("demolition tiers 0-2 leave the blast and the rate stock",
      [0, 1, 2].every((t) =>
        tiersAt(t).bombBlastMult === 1 && tiersAt(t).salvagePerCube === stock.salvagePerCube));
    check("demolition tier 3 widens the blast",
      Math.abs(capped.bombBlastMult - DEMO_BLAST_MULT) < 1e-9,
      `x${capped.bombBlastMult}`);
    check("demolition tier 3 raises the salvage rate",
      capped.salvagePerCube === Math.round(stock.salvagePerCube * DEMO_SALVAGE_MULT),
      `$${stock.salvagePerCube} -> $${capped.salvagePerCube}/cube`);
    // The hierarchy level.ts's SLAG_BOUNTY note sets out has to survive the
    // raise: disposal must clearly beat the shot that delivers it and must
    // never out-earn playing the game. A line-sized salvage is
    // compactorMinLineCells cubes; one line pays scorePerLine before combo.
    {
      const bay10 = makeBaseLevel(9, TIER_COUNT);
      applyUpgrades(bay10, { ...newTiers(), demolition: MAX_TIER });
      const lineSized = bay10.compactorMinLineCells * bay10.salvagePerCube;
      check("a maxed rack's salvage beats a launch but never a line",
        lineSized > bay10.launchCost && lineSized < bay10.scorePerLine,
        `$${lineSized} vs launch $${bay10.launchCost}, line $${bay10.scorePerLine}`);
    }
    // Radius, not count — and the reason is area. A capstone that read as "a
    // bit wider" on the card has to be substantially bigger in the hole it
    // actually cuts, which is what makes it a change in kind.
    check("the wider blast is worth roughly double the area",
      DEMO_BLAST_MULT ** 2 > 1.7 && DEMO_BLAST_MULT ** 2 < 2,
      `x${(DEMO_BLAST_MULT ** 2).toFixed(2)} area`);
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
    // "fine $N", not a bare "$N": match the VERB and the number, so the check
    // keeps its teeth when a re-tune makes the fine collide with another figure
    // on the card (it was equal to the launch cost until the tier ladder moved
    // Tier 1's shot to $20). The sentence they sit in is the card's to write,
    // and is written to a hard height budget (see coachSteps), so this matches
    // as little of it as it can and still mean something.
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
section("The demolition bot actually fires charges (sim/bots.ts)");
// ---------------------------------------------------------------------------
{
  // `demo` is `aim` plus a pair of hands for the rack, and the ONLY thing that
  // makes it worth having is that it pulls the trigger. A scoring change that
  // quietly stopped it firing would not fail anything — it would just silently
  // become `aim` again and every material it was built to price would read as
  // unanswerable. That already happened once: the first blast valuation counted
  // every live cube caught as a loss, which reads a packed pile as a terrible
  // place to bomb, and the bot fired one charge across six bays holding six
  // apiece. This is the tripwire for that.
  const build = { ...newTiers(), reactor: 3, hydraulics: 2, bay: 2, demolition: MAX_TIER };
  let cfg = makeBaseLevel(4, TIER_COUNT);
  applyUpgrades(cfg, build);
  cfg = applyRatchets(cfg, { slag: 2 } as Ratchets);
  cfg.startingFunds += 150;

  const fly = (botName: string) => {
    let bombs = 0;
    let lines = 0;
    const SEEDS = 3;
    for (let s = 1; s <= SEEDS; s++) {
      const g = new Game(cfg, { onShoot: (info) => { if (info?.bomb) bombs += 1; } }, s);
      const bot = BOTS[botName](s);
      let now = 0;
      let steps = 0;
      const cap = cfg.timeLimitSec * 60 + 3600;
      while (g.status === "playing" && steps < cap) {
        now += 1000 / 60;
        bot.act(g, now);
        g.update(now);
        steps += 1;
      }
      lines += g.linesTotal;
      g.destroy();
    }
    return { bombs, lines: lines / SEEDS };
  };

  check("the bay under test actually carries charges and slag",
    cfg.bombCharges > 0 && cfg.materialMix.slag > 0,
    `${cfg.bombCharges} charges, slag ${cfg.materialMix.slag.toFixed(2)}`);

  const plain = fly("aim");
  const demo = fly("demo");
  check("`aim` fires no charges (it has no hands)", plain.bombs === 0, `${plain.bombs}`);
  // At least one per bay. The real rate measured ~5/bay on this rig; the floor
  // is deliberately far below that, because this pins THAT IT FIRES, not how
  // often — a tripwire that also encodes the tuning would fail on every honest
  // retune of DEMO_MIN_NET.
  check("`demo` fires charges on a slag bay", demo.bombs >= 3, `${demo.bombs} across 3 bays`);
  // And the charges have to be worth firing, or the bot is just burning funds.
  check("`demo` clears more lines than `aim` on a slag bay",
    demo.lines > plain.lines, `demo ${demo.lines.toFixed(1)} vs aim ${plain.lines.toFixed(1)}`);
  // A rack-less rig must fall back to `aim` exactly, or every sweep that runs
  // `demo` on a stock build is quietly measuring a different bot.
  {
    const bare = makeBaseLevel(4, TIER_COUNT);
    check("`demo` on a rig with no rack has nothing to fire",
      bare.bombCharges === 0);
  }
}

// ---------------------------------------------------------------------------
section("The belt schedule: ceiling, escalation, composition (belt.ts)");
// ---------------------------------------------------------------------------
{
  // Everything here is measured off a real Cannon over a long stream rather
  // than off BeltSchedule directly, because what has to hold is what the PLAYER
  // meets — the cannon's seeded stream, its two-draws-per-shipment contract and
  // its size normalization included. A unit test of the class alone would have
  // passed happily while the cannon fed it a different mix.
  const ROLLS = 20_000;

  /** The material of every shipment a bay would deal, in order. */
  function stream(cfg: LevelConfig, seed = 4242): Material[] {
    const cannon = new Cannon(cfg, seed);
    const out: Material[] = [];
    for (let i = 0; i < ROLLS; i++) {
      out.push(cannon.currentMaterial);
      cannon.markShot(i * 1000);
    }
    return out;
  }

  /** The longest run of consecutive non-standard shipments. */
  function longestStreak(s: Material[]): number {
    let best = 0;
    let cur = 0;
    for (const m of s) {
      cur = m === "standard" ? 0 : cur + 1;
      best = Math.max(best, cur);
    }
    return best;
  }

  const bay = makeBaseLevel(5, CAPSTONE_MARK);

  // ---- THE CEILING --------------------------------------------------------
  // The headline promise, and the one the owner asked for in the words "max 2
  // normal pieces and a material is fair". It is structural, not statistical:
  // no seed, no ratchet and no combination of them produces two materials back
  // to back on a bay the ladder built.
  {
    const maxed = applyRatchets(bay, Object.fromEntries(
      HAZARDS.filter((h) => h.kind === "content").map((h) => [h.id, 99])) as Ratchets);
    let worstStreak = 0;
    let worstShare = 0;
    let worstGap = Infinity;
    for (let seed = 1; seed <= 12; seed++) {
      const s = stream(maxed, seed);
      worstStreak = Math.max(worstStreak, longestStreak(s));
      worstShare = Math.max(worstShare, s.filter((m) => m !== "standard").length / s.length);
      // Smallest observed spacing between two materials, in shipments.
      let last = -Infinity;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "standard") continue;
        worstGap = Math.min(worstGap, i - last);
        last = i;
      }
    }
    check("a fully ratcheted belt never deals two materials in a row",
      worstStreak === 1, `longest streak ${worstStreak}`);
    check(`every material is followed by ${MATERIAL_GAP} standard shipments`,
      worstGap >= MATERIAL_GAP + 1, `closest spacing ${worstGap}`);
    check("a fully ratcheted belt still leaves two thirds of shipments standard",
      worstShare <= BELT_CEILING + 1e-9,
      `${(worstShare * 100).toFixed(1)}% material, ceiling ${(BELT_CEILING * 100).toFixed(1)}%`);
  }

  // ---- THE RATE IS STILL THE MIX ------------------------------------------
  // The spacing rule may bound the belt; it may not quietly TAX it. materialMix
  // is documented as a per-shipment probability and printed to the player as
  // one, so a schedule that delivered 5% while the card said 7% would make
  // every material row in preview.ts a lie. Stochastic rounding is exact in the
  // long run, which is why it is the mechanism (belt.ts's rule 2).
  {
    const drifted: string[] = [];
    for (const notches of [1, 2, 4, 6]) {
      const cfg = applyRatchets(bay, { slag: notches });
      const want = cfg.materialMix.slag;
      const got = stream(cfg).filter((m) => m !== "standard").length / ROLLS;
      if (Math.abs(got - want) > 0.006) drifted.push(`x${notches}: want ${want.toFixed(3)}, got ${got.toFixed(3)}`);
    }
    check("the belt delivers the rate the mix states", drifted.length === 0, drifted.join("; "));
  }

  // ---- THE ESCALATION -----------------------------------------------------
  // A drought has to close itself, which is the other half of what makes the
  // ceiling affordable: capping the floods would be a straight nerf if the
  // droughts stayed as long as an independent roll's. Measured as the SPREAD of
  // the gaps rather than their mean — the mean is pinned by the check above, so
  // only the variance can move, and the point of the pity credit is that it
  // shrinks it.
  {
    const cfg = applyRatchets(bay, { slag: 2 });
    const s = stream(cfg);
    const gaps: number[] = [];
    let last = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "standard") continue;
      if (last >= 0) gaps.push(i - last);
      last = i;
    }
    const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    // An independent roll at rate p has geometric gaps: sd/mean -> 1 as p
    // shrinks (sd = sqrt(1-p)/p against mean 1/p). Anything well under that is
    // a schedule with memory. Measured at ~0.42 here against the geometric
    // ~0.94 the old roll produced at the same rate.
    check("a clean stretch makes the next material likelier (gaps cluster)",
      sd / mean < 0.7, `sd/mean ${(sd / mean).toFixed(2)} over ${gaps.length} gaps`);
    check("the longest drought is bounded well under an independent roll's",
      Math.max(...gaps) < 4 / cfg.materialMix.slag,
      `longest ${Math.max(...gaps)} shipments at rate ${cfg.materialMix.slag.toFixed(3)}`);
  }

  // ---- COMPOSITION --------------------------------------------------------
  // Rule 3: which material is a separate draw off the mix ratio. This is what a
  // notch past the ceiling actually buys, so it has to be visible in the stream
  // and not merely in the config.
  {
    const cfg = applyRatchets(bay, { slag: 6, cryo: 1 });
    const s = stream(cfg).filter((m) => m !== "standard");
    const slagShare = s.filter((m) => m === "slag").length / s.length;
    const want = cfg.materialMix.slag / mixTotal(cfg.materialMix);
    check("which material follows the mix ratio",
      Math.abs(slagShare - want) < 0.02,
      `slag ${(slagShare * 100).toFixed(1)}% of materials, mix says ${(want * 100).toFixed(1)}%`);
  }

  // ---- AN AUTHORED BAY IS EXEMPT ------------------------------------------
  // A drill, a Contract or a Final clause that states a density above the
  // ceiling gets what it asked for. The ceiling governs the RATCHET ladder,
  // which is the thing that stacks behind the player's back; a bay that names
  // its own number is not stacking anything.
  {
    const solo = { ...bay, materialMix: { ...NO_MATERIALS, rebar: 1 } };
    check("a bay that states every shipment is a material still gets every shipment",
      stream(solo).every((m) => m === "rebar"));
  }

  // ---- DETERMINISM --------------------------------------------------------
  // The schedule carries state across a bay, which is exactly the kind of thing
  // that breaks a replay. Same seed, same bay, same belt.
  {
    const cfg = applyRatchets(bay, { slag: 2, tar: 2 });
    check("the belt is deterministic in the run seed",
      stream(cfg, 77).join(",") === stream(cfg, 77).join(","));
    check("a different seed deals a different belt",
      stream(cfg, 77).join(",") !== stream(cfg, 78).join(","));
  }
}

// ---------------------------------------------------------------------------
section("Sandbox material parade survives size normalization (sandbox.ts)");
// ---------------------------------------------------------------------------
{
  // rollMaterial is SIZE-NORMALIZED — it scales every probability by
  // std-cubes/own-cubes so dead cubes per LAUNCH stay constant across size
  // classes. The sandbox asks for a mix of SHIPMENTS, so it has to divide that
  // back out. Without the correction the screen quietly lied in both
  // directions, and only away from the standard size class, which is exactly
  // where nobody looks.
  const SIZES = ["tiny", "std", "bulk"] as const;
  const ROLLS = 4000;

  /** Materials actually produced by a real Cannon over ROLLS shipments. */
  function parade(size: (typeof SIZES)[number], choice: Parameters<typeof applySandboxMaterials>[1]) {
    const cfg = applySandboxMaterials({ ...makeBaseLevel(1), pieceSize: size }, choice);
    const cannon = new Cannon(cfg, 12345);
    const seen = new Map<Material, number>();
    for (let i = 0; i < ROLLS; i++) {
      seen.set(cannon.currentMaterial, (seen.get(cannon.currentMaterial) ?? 0) + 1);
      cannon.markShot(i * 1000);
    }
    return seen;
  }

  for (const size of SIZES) {
    // ---- one material means ONE material -----------------------------------
    // The reported symptom: a Bulk bay set to a single material still rolled
    // 20% standard, because 1 x (4/5) left a fifth of the range falling through
    // the end of the walk.
    const solo = parade(size, "slag");
    check(
      `a ${size} bay set to one material launches only that material`,
      solo.get("slag") === ROLLS,
      `slag ${solo.get("slag") ?? 0}/${ROLLS}, standard ${solo.get("standard") ?? 0}`,
    );

    // ---- ALL means all of them ---------------------------------------------
    // The other direction: on Micro the scaled probabilities ran past cumulative
    // 1.0 partway through the walk, so the tail of MATERIAL_ROLL_ORDER could
    // never be reached — the parade silently dropped materials.
    const all = parade(size, "all");
    const missing = SANDBOX_MATERIALS.filter((m) => !all.get(m));
    check(
      `a ${size} bay set to ALL launches every material`,
      missing.length === 0,
      missing.length ? `never appeared: ${missing.join(", ")}` : "",
    );
    // The deliberate sliver: something plain has to walk past, or there is
    // nothing to compare a material against.
    check(
      `...and still lets an ordinary shipment through to compare against`,
      (all.get("standard") ?? 0) > 0,
      `standard ${all.get("standard") ?? 0}/${ROLLS}`,
    );
  }
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
  //
  // AIMED, deliberately. The cannon's rest pose is 20 degrees at minimum power,
  // which drops the shipment about 490px out — inside the recycling plant's
  // intake (chute.ts), where it is now shredded within ~20 steps. These checks
  // are about what a POPULATED field costs, so they have to put cargo somewhere
  // the bay actually keeps it; before the chute existed the fumbled default
  // happened to work, which is the whole reason the chute exists.
  const fireTwice = (game: Game) => {
    for (let i = 0; i < 2; i++) {
      const t = 10_000 + i * 10_000;
      game.cannon.angle = Math.PI / 6;
      game.cannon.power = game.cannon.speedMax;
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
section("Final Inspection: the run's last draft (finals.ts, run.ts)");
{
  // EVERY Tier deals a pair. A Tier with no pair falls back to the table's top
  // rung rather than dealing nothing (finalsForTier), which is the right
  // behaviour for a Tier ABOVE the ladder and a silent hole for one inside it —
  // so the hole is checked here rather than discovered on a player's last bay.
  let everyTierPaired = true;
  const missing: number[] = [];
  for (let tier = 1; tier <= MARK_COUNT; tier++) {
    if (!FINALS.some((f) => f.tier === tier)) {
      everyTierPaired = false;
      missing.push(tier);
    }
  }
  check("every Tier 1..MARK_COUNT has its own pair in the table",
    everyTierPaired, `missing: ${missing.join(", ")}`);

  let handsWellFormed = true;
  const illFormed: string[] = [];
  for (let tier = 1; tier <= MARK_COUNT; tier++) {
    const hand = finalsForTier(tier);
    // Exactly two, and two DIFFERENT clauses: the whole feature is a fork, and
    // a hand of one (or of the same card twice) is a toll with a card frame
    // around it.
    if (hand.length !== 2 || hand[0].id === hand[1].id) {
      handsWellFormed = false;
      illFormed.push(`tier ${tier}: ${hand.map((f) => f.id).join(",") || "empty"}`);
    }
  }
  check("every Tier deals exactly two distinct clauses", handsWellFormed, illFormed.join(" · "));

  const ids = FINALS.map((f) => f.id);
  check("clause ids are unique", new Set(ids).size === ids.length);
  check("every clause resolves by id", ids.every((id) => finalById(id)?.id === id));
  check("an unknown id resolves to nothing", finalById("no-such-clause") === undefined);

  // Card copy carries its own number, the same rule every HazardDef.desc
  // follows: the player is accepting a cost sight-unseen on the run's LAST bay,
  // where a vague card turns a deliberate trade into a guess. A clause whose
  // effect is a direction rather than a size (the wind pair) says so in words.
  const vague = FINALS.filter((f) => !/\d/.test(f.desc) && !/\b(full|pinned|nothing|never)\b/i.test(f.desc));
  check("every clause states its own size", vague.length === 0, vague.map((f) => f.id).join(", "));

  // The boundary. The offer is built at the moment a bay is WON, before the run
  // advances, so the index is the bay just cleared: clearing bay 9 (index 8)
  // opens the inspection and nothing else does.
  const finalDrafts = Array.from({ length: RUN_LEVELS }, (_, i) => i).filter(isFinalDraft);
  check("exactly one draft in a run is the inspection",
    finalDrafts.length === 1 && finalDrafts[0] === RUN_LEVELS - 2, finalDrafts.join(","));

  // The clause lands on the LAST bay and on no other. A run carrying a clause
  // must play bays 1-9 exactly as a run without one — otherwise a replayed
  // earlier bay (Restart Bay) would silently inherit the final bay's terms.
  {
    let leaks = 0;
    for (const clause of FINALS) {
      for (let i = 0; i < RUN_LEVELS - 1; i++) {
        const run = { ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: i };
        const withClause = levelForRun({ ...run, final: clause.id });
        const without = levelForRun(run);
        if (JSON.stringify(withClause) !== JSON.stringify(without)) leaks += 1;
      }
    }
    check("no clause touches any bay but the last", leaks === 0, `${leaks} leak(s)`);
  }

  // …and it DOES land there. A clause that changed nothing would be a free
  // pick, which is the one thing an inspection may never be.
  {
    const inert: string[] = [];
    for (const clause of FINALS) {
      const run = {
        ...newRun(7, [], 0, newTiers(), clause.tier),
        levelIndex: RUN_LEVELS - 1,
      };
      const before = levelForRun(run);
      const after = levelForRun({ ...run, final: clause.id });
      if (JSON.stringify(before) === JSON.stringify(after)) inert.push(clause.id);
    }
    check("every clause actually changes the final bay", inert.length === 0, inert.join(", "));
  }

  // A pair whose two clauses produce the SAME bay is not a choice.
  {
    const same: string[] = [];
    for (let tier = 1; tier <= MARK_COUNT; tier++) {
      const [a, b] = finalsForTier(tier);
      const run = { ...newRun(7, [], 0, newTiers(), tier), levelIndex: RUN_LEVELS - 1 };
      if (JSON.stringify(levelForRun({ ...run, final: a.id }))
        === JSON.stringify(levelForRun({ ...run, final: b.id }))) same.push(`tier ${tier}`);
    }
    check("a pair's two clauses build different bays", same.length === 0, same.join(", "));
  }

  check("no clause is a no-op on a null id", (() => {
    const cfg = makeBaseLevel(9, 1);
    const before = JSON.stringify(cfg);
    applyFinal(cfg, null);
    // Unknown ids are ignored for the same forward-compatibility reason
    // applyRatchets ignores unknown axes — a renamed clause must not throw on
    // a run's last bay.
    applyFinal(cfg, "not-a-clause" as FinalId);
    return JSON.stringify(cfg) === before;
  })());

  // NOT A LOSE BUTTON. hazards.ts floors Shift Cut at 45s because "an axis that
  // can reach an unplayable bay is not a difficulty knob, it is a lose button",
  // and the rule binds harder here: this fires on the run's last bay, where a
  // dead bay costs the whole run rather than one notch. Checked on the WORST
  // realistic arrival — every ratchet the Tier can deal, taken as deep as a run
  // can take it — rather than on a clean base, because a clause that is safe
  // alone and fatal on top of nine notches is still fatal.
  {
    const broken: string[] = [];
    // TWO arrivals per clause, because the obvious one is not the worst one.
    //
    // Round-robin over every axis the Tier deals is the arrival that looks
    // adversarial, and for the material clauses it is the GENEROUS one: it
    // ratchets the clause's own material too, which the clause then overwrites
    // rather than stacks on. The real worst case pours every notch into the
    // materials the clause does NOT write, so applyRatchets caps a full belt
    // and the clause lands on top of it. Measured before applyFinal re-capped:
    // that arrival took Powder Run to 0.78 of the belt while this check, run
    // on the round-robin alone, passed at 0.55. A worst-case assertion that
    // does not construct the worst case is not an assertion.
    const arrivals = (clause: (typeof FINALS)[number]): Ratchets[] => {
      const notches = (RUN_LEVELS - 1) * picksPerBay(clause.tier);
      const pour = (axes: typeof HAZARDS): Ratchets => {
        const r: Ratchets = {};
        if (!axes.length) return r;
        for (let n = 0; n < notches; n++) {
          const a = axes[n % axes.length];
          r[a.id] = (r[a.id] ?? 0) + 1;
        }
        return r;
      };
      const pool = hazardsForMark(clause.tier);
      // Which material the clause writes, read off a clean bay rather than
      // declared: a clause that grows a second material later is covered
      // without anyone remembering to update a list here.
      const clean = levelForRun({
        ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: RUN_LEVELS - 1, final: clause.id,
      });
      const own = (Object.keys(clean.materialMix) as Array<keyof typeof clean.materialMix>)
        .filter((k) => clean.materialMix[k] > 0);
      // The second pour is CONTENT AXES ONLY, minus the clause's own material.
      // Including the number axes would spread the notches so thin that the
      // belt never fills, which is exactly how the first version of this check
      // passed while Powder Run was reaching 0.78 — the pour has to be able to
      // reach the cap before the clause is asked to push past it.
      return [
        pour(pool),
        pour(pool.filter((h) => h.kind === "content" && !own.includes(h.material!))),
      ];
    };
    for (const clause of FINALS) {
     for (const ratchets of arrivals(clause)) {
      const run = {
        ...newRun(7, [], 0, newTiers(), clause.tier),
        levelIndex: RUN_LEVELS - 1,
        ratchets,
        final: clause.id,
      };
      const cfg = levelForRun(run);
      const why: string[] = [];
      if (!(cfg.targetScore > 0)) why.push("target <= 0");
      if (!(cfg.scorePerLine > 0)) why.push("pays nothing per line");
      if (!(cfg.startingFunds >= cfg.launchCost)) why.push("cannot afford one launch");
      if (!(cfg.timeLimitSec >= 45)) why.push(`clock ${cfg.timeLimitSec}s`);
      // compactor.ts's floor: at equality the two stops share an X and the bar
      // has zero travel — it never moves again while still counting strokes.
      if (!(cfg.compactorOpenCells > cfg.compactorMinLineCells)) why.push("press has no stroke");
      if (!(cfg.compactorSpeed > 0)) why.push("press stopped");
      if (!Number.isFinite(cfg.windLock ?? 0) || Math.abs(cfg.windLock ?? 0) > 1) why.push("wind lock out of range");
      // Every shipment a hazard, at any ratchet depth, is not a hard bay — it
      // is one with no cargo to build rows out of. Asserted against hazards.ts's
      // OWN cap rather than a looser number of this file's invention: the
      // ratchet mix is held to 0.55 and a clause may not route around it (see
      // applyFinal's re-cap). A tolerance, not equality, because the scaling is
      // floating point.
      //
      // EXCEPT the capstone's full-belt pair, whose whole design is that
      // nothing standard ships: there the belt must land at exactly 1, and
      // the playability line is drawn where hazards.ts always drew it — on
      // cargo that can never count. Slag is the one material whose cubes
      // cannot fill a slot (theme.ts's countsForLines), so slag is what stays
      // bounded; and the pair's other promise — the capstone stopped dealing
      // shipment sizes — is pinned in the same breath.
      const mix = Object.values(cfg.materialMix).reduce((a, b) => a + b, 0);
      if (clause.fullBelt) {
        if (Math.abs(mix - 1) > 1e-9) why.push(`full belt sums ${mix.toFixed(3)}`);
        if (cfg.materialMix.slag > FINAL_MATERIAL_CAP + 1e-9) why.push(`slag at ${cfg.materialMix.slag.toFixed(3)}`);
        if (cfg.pieceSize !== "std") why.push(`ships ${cfg.pieceSize} shipments`);
      } else if (mix > MIX_TOTAL_CAP + 1e-9) {
        why.push(`materials sum ${mix.toFixed(3)}`);
      }
      if (why.length) broken.push(`${clause.id}: ${why.join(", ")}`);
     }
    }
    check("no clause can build an unplayable final bay", broken.length === 0, broken.join(" · "));

    // …and the re-cap takes its reduction from the RATCHETED materials, never
    // from the clause's own. FinalDef.desc prints that rate as a promise the
    // player accepted one screen ago; scaling it would make the card lie about
    // the bay it just sold them.
    const lied: string[] = [];
    for (const clause of FINALS) {
      // The full-belt pair's card quotes no per-material rate to hold — its
      // promise is the belt's SHAPE (nothing standard), held by its own
      // block below on the same arrivals.
      if (clause.fullBelt) continue;
      const clean = levelForRun({
        ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: RUN_LEVELS - 1, final: clause.id,
      });
      const own = (Object.keys(clean.materialMix) as Array<keyof typeof clean.materialMix>)
        .filter((k) => clean.materialMix[k] > 0);
      if (!own.length) continue;
      for (const ratchets of arrivals(clause)) {
        const full = levelForRun({
          ...newRun(7, [], 0, newTiers(), clause.tier),
          levelIndex: RUN_LEVELS - 1, ratchets, final: clause.id,
        });
        for (const k of own) {
          if (full.materialMix[k] < clean.materialMix[k] - 1e-9) {
            lied.push(`${clause.id}:${k} ${clean.materialMix[k].toFixed(2)}->${full.materialMix[k].toFixed(2)}`);
          }
        }
      }
    }
    check("the re-cap never scales the rate a clause's card quotes",
      lied.length === 0, lied.join(", "));

    // ...and where the arriving ratchet pushes the belt PAST the card's rate,
    // the card has to say so. schedule() floors a material at the quoted rate
    // and then adds a notch on top, so a run carrying two Slag notches meets
    // Slag Wall's "8%" card with a belt at 12%. That is the design — a
    // mandatory cost the player's own earlier choices could pre-pay is not a
    // cost — but it makes a bare number on the card wrong on exactly the
    // arrivals it matters for. "At least" is what makes it true on all of them.
    const bare: string[] = [];
    for (const clause of FINALS) {
      if (clause.fullBelt) continue; // no numeric rate on the card to outrun
      const clean = levelForRun({
        ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: RUN_LEVELS - 1, final: clause.id,
      });
      const own = (Object.keys(clean.materialMix) as Array<keyof typeof clean.materialMix>)
        .filter((k) => clean.materialMix[k] > 0);
      if (!own.length) continue;
      let overshoots = false;
      for (const ratchets of arrivals(clause)) {
        const full = levelForRun({
          ...newRun(7, [], 0, newTiers(), clause.tier),
          levelIndex: RUN_LEVELS - 1, ratchets, final: clause.id,
        });
        for (const k of own) {
          if (full.materialMix[k] > clean.materialMix[k] + 1e-9) overshoots = true;
        }
      }
      if (overshoots && !/at least/i.test(clause.desc)) bare.push(clause.id);
    }
    check("a clause that can outrun its own card says \"at least\" on it",
      bare.length === 0, bare.join(", "));

    // THE CAPSTONE PAIR SHIPS NO STANDARD CARGO — on every arrival, and
    // without refunding anything. "Nothing standard" is each card's whole
    // promise, so it gets the same treatment the rate cards' numbers get:
    // checked on the worst arrivals, not just the clean one. And the full
    // belt must still be the one the run's own ratchets built — a clause that
    // converted a ratcheted material into easier cargo would be the refund
    // bug (see finals.ts's schedule()) wearing its third coat.
    {
      const pair = finalsForTier(MARK_COUNT);
      check("the capstone's pair is the full-belt pair, and nothing else is",
        pair.every((c) => c.fullBelt === true)
          && FINALS.every((c) => !c.fullBelt || c.tier === MARK_COUNT),
        FINALS.filter((c) => c.fullBelt).map((c) => `${c.id}@${c.tier}`).join(", "));
      const partial: string[] = [];
      const converted: string[] = [];
      for (const clause of FINALS.filter((c) => c.fullBelt)) {
        for (const ratchets of [{} as Ratchets, ...arrivals(clause)]) {
          const base = {
            ...newRun(7, [], 0, newTiers(), clause.tier),
            levelIndex: RUN_LEVELS - 1,
            ratchets,
          };
          const before = levelForRun(base);
          const after = levelForRun({ ...base, final: clause.id });
          const total = Object.values(after.materialMix).reduce((a, b) => a + b, 0);
          if (Math.abs(total - 1) > 1e-9) partial.push(`${clause.id} at ${total.toFixed(3)}`);
          for (const k of Object.keys(after.materialMix) as Array<keyof typeof after.materialMix>) {
            if (after.materialMix[k] < before.materialMix[k] - 1e-9) {
              converted.push(`${clause.id} refunds ${k}`);
            }
          }
        }
      }
      check("a full belt ships nothing standard on any arrival",
        partial.length === 0, partial.join(", "));
      check("a full belt keeps every material the run arrived with",
        converted.length === 0, converted.join(", "));
    }
  }

  // The wind pair's seam. A locked bay must actually blow the way its card
  // says, at the cap, rather than rolling — and an UNLOCKED bay must keep
  // rolling exactly as it always did.
  {
    const cfg = makeBaseLevel(9, 1);
    const rolled = new Game(cfg, {}, 4242).windAverage;
    const head = new Game({ ...cfg, windLock: -1 }, {}, 4242).windAverage;
    const tail = new Game({ ...cfg, windLock: 1 }, {}, 4242).windAverage;
    check("a locked headwind sits at the bay's cap, against",
      Math.abs(head + cfg.windMax) < 1e-9, String(head));
    check("a locked tailwind sits at the bay's cap, behind",
      Math.abs(tail - cfg.windMax) < 1e-9, String(tail));
    check("an unlocked bay still rolls", Math.abs(rolled) < cfg.windMax && rolled !== head && rolled !== tail,
      String(rolled));
    // A calm bay stays calm however the clause is written — bays 1-3 carry
    // windMax 0 and the lock rides the cap, so it has nothing to multiply.
    const calm = makeBaseLevel(0, 1);
    check("a lock cannot conjure wind out of a calm bay",
      new Game({ ...calm, windLock: -1 }, {}, 1).windAverage === 0);
  }

  // The projection has to SHOW every clause, or the player is signing blind.
  // preview.ts drops a row nothing moved, so a clause whose only effect is on a
  // field with no row is invisible on the one screen built to price it.
  {
    const unseen: string[] = [];
    for (const clause of FINALS) {
      const run = { ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: RUN_LEVELS - 1 };
      const rows = previewRows(levelForRun(run), levelForRun({ ...run, final: clause.id }));
      if (!rows.some((r) => r.changed)) unseen.push(clause.id);
    }
    check("every clause moves at least one projected number", unseen.length === 0, unseen.join(", "));

    // …and at least one of those rows has to read as a COST.
    //
    // Moving a number is not enough, and a review round proved it: the Bonds
    // row carried higherIsWorse: false, so Cold Weld — one half of a mandatory
    // pair — projected its unbreakable bay entirely in the "better" tone and
    // read as the free choice in a fork that is supposed to have none. The
    // clause was correct, the number was correct, and the screen still told the
    // player the opposite of the truth.
    //
    // Some rows going GREEN is fine and deliberate: the retired size pair
    // genuinely moved launch money in the player's favour on one half, and a
    // future clause may trade the same way again. What no clause may do is
    // project a bay that costs nothing anywhere.
    const painless: string[] = [];
    for (const clause of FINALS) {
      const run = { ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: RUN_LEVELS - 1 };
      const rows = previewRows(levelForRun(run), levelForRun({ ...run, final: clause.id }));
      if (!rows.some((r) => r.tone === "worse")) painless.push(clause.id);
    }
    check("every clause projects at least one row as a cost",
      painless.length === 0, painless.join(", "));

    // …and it must still move one on a DEEP arrival, not just a clean bay.
    //
    // Found in review, and the clean-bay check above is exactly what missed it:
    // Tight Gauge clamps at compactor.ts's stroke floor, and three Sweeper
    // notches reach that floor before the inspection is dealt, so a MANDATORY
    // cost the player picked over Double Shift changed nothing at all. Every
    // clause is re-checked here against the deepest ratchet its own Tier can
    // deal on each axis in turn — a clause that can be silently eaten by a
    // ratchet the player already took is not a cost, and nothing about the
    // clean bay reveals it.
    const eaten: string[] = [];
    for (const clause of FINALS) {
      const notches = (RUN_LEVELS - 1) * picksPerBay(clause.tier);
      for (const axis of hazardsForMark(clause.tier)) {
        const run = {
          ...newRun(7, [], 0, newTiers(), clause.tier),
          levelIndex: RUN_LEVELS - 1,
          ratchets: { [axis.id]: notches } as Ratchets,
        };
        const rows = previewRows(levelForRun(run), levelForRun({ ...run, final: clause.id }));
        if (!rows.some((r) => r.changed)) eaten.push(`${clause.id} under ${axis.id}x${notches}`);
      }
    }
    check("no ratchet can silently eat a clause", eaten.length === 0, eaten.join(", "));

    // A clause may never REFUND a material the run already ratcheted deeper
    // than the clause asks for. Also found in review: every material clause
    // used to assign its rate outright, so at six cryo notches a Tier-4 bay
    // entered the inspection at 0.32 and Cold Chain — whose apply does nothing
    // else — took it to 0.22, making the mandatory final cost strictly easier.
    // finals.ts's schedule() is the floor that fixes it.
    //
    // Read per material against the arrival, not off the total: the re-cap
    // legitimately scales OTHER materials down to make room for the clause's
    // own (rebar-run on a cryo-ratcheted bay moves 0.32 cryo to 0.23 while the
    // belt goes 0.32 -> 0.55 overall), so the total is allowed to rise and a
    // non-clause material is allowed to fall. What is never allowed is the
    // clause's own material coming out lower than it went in.
    const refunded: string[] = [];
    for (const clause of FINALS) {
      const notches = (RUN_LEVELS - 1) * picksPerBay(clause.tier);
      for (const axis of hazardsForMark(clause.tier)) {
        if (axis.kind !== "content") continue;
        const mat = axis.material!;
        const run = {
          ...newRun(7, [], 0, newTiers(), clause.tier),
          levelIndex: RUN_LEVELS - 1,
          ratchets: { [axis.id]: notches } as Ratchets,
        };
        const before = levelForRun(run);
        const after = levelForRun({ ...run, final: clause.id });
        // Only the material this clause SCHEDULES is held; the rest may be
        // scaled by the re-cap, which is the cap doing its job.
        const clean = levelForRun({
          ...newRun(7, [], 0, newTiers(), clause.tier), levelIndex: RUN_LEVELS - 1, final: clause.id,
        });
        if (clean.materialMix[mat] <= 0) continue;
        if (after.materialMix[mat] < before.materialMix[mat] - 1e-9) {
          refunded.push(`${clause.id} cut ${mat} ${before.materialMix[mat].toFixed(2)}->${after.materialMix[mat].toFixed(2)}`);
        }
      }
    }
    check("no clause refunds a material the run ratcheted deeper",
      refunded.length === 0, refunded.join(", "));
  }

  // advanceRun must carry the clause. It is banked at the last draft and read
  // on the bay after it, so a step that dropped it would quietly refund the
  // player's choice.
  {
    const run = { ...newRun(7, [], 0, newTiers(), 1), levelIndex: 8, final: "rate-cut" as FinalId };
    check("advanceRun carries the accepted clause",
      advanceRun(run, 100, 100, 0, 0).final === "rate-cut");
  }

  // COLD WELD MEANS IT, on a rig that bought the Seam Splitter.
  //
  // Found by review, not by the checks above: pieces.ts restates a FINITE base
  // for a weakened type when the bay's own stretch is not finite (Infinity x
  // 0.7 is still Infinity, so the passive would otherwise be a no-op on an
  // unbreakable bay). That fallback is right for the capstone format, which the
  // ladder imposes — and wrong here, where the player signed a card that says
  // nothing comes apart. Left alone, a Bond Emitter t2/t3 rig flew Cold Weld
  // with S and Z splitting at 1.54, the most fragile thing in the bay, under a
  // card and a projection tile that both said "unbreakable".
  //
  // Asserted through createTetrisPiece rather than off the config, because the
  // stamp on the constraint is what updateBreakableJoints actually reads — a
  // config check would have passed while the bay still shattered.
  {
    const stampOf = (cfg: LevelConfig, type: PieceType): number => {
      const w = Matter.Engine.create().world;
      const p = createTetrisPiece(
        w, 200, 200, 0, { x: 0, y: 0 }, type, cfg.jointStiffness, cfg.pieceSize,
        cfg.jointBreakStretch, "standard",
        { types: cfg.weakBondTypes, mult: cfg.weakBondMult },
      );
      return (p.constraints[0] as unknown as { breakStretch: number }).breakStretch;
    };
    const run = {
      ...newRun(7, [], 0, { ...newTiers(), bonds: 3 }, 5),
      levelIndex: RUN_LEVELS - 1,
      final: "cold-weld" as FinalId,
    };
    const cfg = levelForRun(run);
    check("Cold Weld stands the Seam Splitter down",
      cfg.weakBondTypes.length === 0 && cfg.weakBondMult === 1,
      `${cfg.weakBondTypes.join(",")} x${cfg.weakBondMult}`);
    check("...so every shape it ships really is unbreakable",
      PIECE_TYPES.every((t) => stampOf(cfg, t) === Infinity),
      PIECE_TYPES.filter((t) => stampOf(cfg, t) !== Infinity).join(", "));
    // The fallback is untouched where it belongs: the CAPSTONE bay is
    // unbreakable because the ladder made it so, and the passive the player
    // paid for still survives that.
    const capstone = levelForRun({
      ...newRun(7, [], 0, { ...newTiers(), bonds: 3 }, UNBREAKABLE_MARK),
      levelIndex: RUN_LEVELS - 1,
    });
    check("the capstone's own unbreakable bay still honours the Seam Splitter",
      Number.isFinite(stampOf(capstone, "S")) && stampOf(capstone, "T") === Infinity,
      `S ${stampOf(capstone, "S")} / T ${stampOf(capstone, "T")}`);
  }

  // Every clause names a real ship system, and the copy on the card resolves.
  {
    const orphans = FINALS.filter((f) => !UPGRADES.some((u) => u.id === f.system));
    check("every clause names a real ship system", orphans.length === 0,
      orphans.map((f) => `${f.id} -> ${f.system}`).join(", "));
  }
}

// ---------------------------------------------------------------------------
section("The Skydeck — the day's run, no yard, one notch a bay (skydeck.ts)");
// ---------------------------------------------------------------------------
{
  const skyRun = (levelIndex = 0, d = new Date(Date.UTC(2026, 7, 27))): RunState =>
    ({ ...skydeckRunFor(newTiers(), [], d), levelIndex });

  // ---- THE DAY IS THE RUN -------------------------------------------------
  // Two players who open the Skydeck on the same UTC day must fly the same
  // thing, which is the whole reason it has a seed at all rather than
  // Date.now(). Checked across the rollover in both directions, because "the
  // same day" is a claim about a boundary and a boundary is where an off-by-one
  // lives.
  {
    const a = new Date(Date.UTC(2026, 7, 27, 0, 0, 1));
    const b = new Date(Date.UTC(2026, 7, 27, 23, 59, 59));
    const c = new Date(Date.UTC(2026, 7, 28, 0, 0, 1));
    check("one UTC day deals one Skydeck run",
      skydeckSeed(a) === skydeckSeed(b) && JSON.stringify(skydeckRulesFor(a).clauses)
        === JSON.stringify(skydeckRulesFor(b).clauses));
    check("the next day deals a different seed", skydeckSeed(b) !== skydeckSeed(c));
    // Shares a DATE with the Contract board, not a stream: the two dailies must
    // roll over at the same instant, and must not correlate.
    check("the Skydeck rolls over with the Contract board", dailySeed(a) === dailySeed(b));
    check("the Skydeck's stream is not the Contract board's",
      skydeckSeed(a) !== dailySeed(a));
  }

  // ---- NO YARD ------------------------------------------------------------
  // "You play with the rig you have." Every bay of every Skydeck run, against
  // the ladder run that opens a stop on three of them.
  {
    const sky = skyRun();
    const ladder = newRun(7, [], 0, newTiers(), MARK_COUNT);
    const skyStops = Array.from({ length: RUN_LEVELS }, (_, i) => i)
      .filter((i) => refitAfterBay(sky, i));
    const ladderStops = Array.from({ length: RUN_LEVELS }, (_, i) => i)
      .filter((i) => refitAfterBay(ladder, i));
    check("a Skydeck run opens no refit stop", skyStops.length === 0, skyStops.join(","));
    check("...where the ladder run it sits above opens three",
      ladderStops.length === 3, ladderStops.join(","));
    check("and the draft is told there is no stop coming",
      baysUntilRefitFor(sky) === null && baysUntilRefitFor(ladder) !== null);
  }

  // ---- ONE NOTCH A BAY ----------------------------------------------------
  // At the capstone Mark, where the LADDER's own rule is two (picksPerBay). The
  // Skydeck pays that pressure in standing clauses instead, and charging both
  // would charge twice for one rung.
  {
    const sky = skyRun();
    check("the Skydeck charges one notch a bay", picksForRun(sky) === SKYDECK_PICKS_PER_BAY);
    check("...at a Mark whose ladder rule is two",
      sky.mark === CAPSTONE_MARK && picksPerBay(sky.mark) === 2
        && picksForRun(newRun(7, [], 0, newTiers(), CAPSTONE_MARK)) === 2);
    // The hand is still one card bigger than the picks — hazards.ts's rule, and
    // the one thing that makes a draft a draft rather than a bill. Checked on
    // every bay a Skydeck run drafts on, forced-material bays included.
    const thin: number[] = [];
    for (let i = 0; i < RUN_LEVELS - 1; i++) {
      const hand = hazardOffers(sky.seed, i, sky.mark, undefined, sky.ratchets);
      if (hand.length <= SKYDECK_PICKS_PER_BAY) thin.push(i + 1);
    }
    check("every Skydeck hand is bigger than its picks", thin.length === 0, thin.join(","));
  }

  // ---- NO DRAFTED INSPECTION ----------------------------------------------
  // The clauses are the DAY's, so the last draft of a Skydeck run is an
  // ordinary notch. A run that dealt both would charge for the inspection twice.
  {
    const sky = skyRun(RUN_LEVELS - 2);
    const ladder = { ...newRun(7, [], 0, newTiers(), MARK_COUNT), levelIndex: RUN_LEVELS - 2 };
    check("the Skydeck never deals the drafted inspection", !finalDraftFor(sky));
    check("...where the ladder run does", finalDraftFor(ladder));
  }

  // ---- THE STOPS ----------------------------------------------------------
  {
    check("every stop is a real bay",
      CLAUSE_STOPS.every((s) => s.fromBay >= 1 && s.fromBay <= RUN_LEVELS),
      CLAUSE_STOPS.map((s) => s.fromBay).join(","));
    check("the stops arm in order",
      CLAUSE_STOPS.every((s, i) => i === 0 || s.fromBay > CLAUSE_STOPS[i - 1].fromBay));
    // DERIVED from the yard's spacing, not typed out: a stop is the bay a Deep
    // Run would have opened on a fresh rig, and a ladder that re-spaces its
    // refits has to re-space these with it.
    check("the stops are the bays after the yard's own",
      CLAUSE_STOPS.every((s, i) => s.fromBay === REFIT_EVERY * (i + 1) + 1),
      CLAUSE_STOPS.map((s) => s.fromBay).join(","));
    check("every stop can deal at least two different clauses",
      CLAUSE_STOPS.every((_, i) => new Set(dealableAt(i).map((f) => f.id)).size >= 2),
      CLAUSE_STOPS.map((_, i) => dealableAt(i).length).join(","));
  }

  // ---- DEAD CARGO IS NEVER A STANDING RULE --------------------------------
  // Slag is the one material with no passive counter — a dead cube leaves the
  // field by Demolition or not at all (theme.ts's countsForLines). hazards.ts
  // already refuses to FORCE it; a clause the day deals is a forced pick with
  // no seat to dodge into, so the same rule has to hold here.
  //
  // Asserted as the PROPERTY, not as "tier 6 is excluded": a clause added later
  // that schedules dead cargo has to be caught by this without anyone
  // remembering the rule exists.
  {
    const offenders: string[] = [];
    CLAUSE_STOPS.forEach((stop, i) => {
      if (stop.fromBay >= RUN_LEVELS) return; // one bay of exposure — see below
      for (const def of dealableAt(i)) {
        if (schedulesDeadCargo(def)) offenders.push(`bay ${stop.fromBay}: ${def.id}`);
      }
    });
    check("no clause that stands for more than one bay schedules dead cargo",
      offenders.length === 0, offenders.join(" · "));
    // The rule really has teeth: the table it filters DOES contain such
    // clauses, so a check that passed on an empty filter would be checking
    // nothing.
    check("...and the table it filters really contains some",
      FINALS.some((f) => schedulesDeadCargo(f)),
      FINALS.filter((f) => schedulesDeadCargo(f)).map((f) => f.id).join(", "));
    // The LAST stop is the exception, deliberately: it rides exactly one bay,
    // which is the same exposure a Deep Run's Final Inspection gives the
    // capstone pair (finals.ts).
    check("the last stop still deals the capstone pair",
      dealableAt(CLAUSE_STOPS.length - 1).map((f) => f.id).sort().join(",")
        === finalsForTier(MARK_COUNT).map((f) => f.id).sort().join(","));
  }

  // ---- THE CLAUSES ACTUALLY STAND -----------------------------------------
  // Each one applies from its own bay and every bay after it, and NOT before.
  // A clause that leaked backwards would rewrite a bay the player already flew;
  // one that stopped applying would be a cost the day charged and never
  // collected.
  {
    const rules = skydeckRulesFor(new Date(Date.UTC(2026, 7, 27)));
    let early = 0;
    let missing = 0;
    for (const c of rules.clauses) {
      for (let i = 0; i < RUN_LEVELS; i++) {
        const active = standingClauses(skyRun(i));
        if (i < c.from && active.includes(c.id)) early += 1;
        if (i >= c.from && !active.includes(c.id)) missing += 1;
      }
    }
    check("no clause applies before its own bay", early === 0, `${early}`);
    check("every clause applies from its bay to the end", missing === 0, `${missing}`);
    check("the last bay carries the whole stack",
      standingClauses(skyRun(RUN_LEVELS - 1)).length === CLAUSE_STOPS.length);
    // …and each one MOVES the bay. A dealt cost that changed nothing would be
    // the same failure finals.ts pins for its own pair.
    const inert: string[] = [];
    for (const c of rules.clauses) {
      const at = skyRun(c.from);
      const without = levelForRun({
        ...at,
        skydeck: { ...at.skydeck!, clauses: rules.clauses.filter((x) => x !== c) },
      });
      if (JSON.stringify(without) === JSON.stringify(levelForRun(at))) inert.push(c.id);
    }
    check("every standing clause changes the bay it arms on", inert.length === 0, inert.join(", "));
  }

  // ---- THE BELT SURVIVES THE STACK ----------------------------------------
  // finals.ts caps ONE clause against MIX_TOTAL_CAP. Three clauses on the same
  // bay, on top of nine notches poured into the materials none of them writes,
  // is the arrival that can push past it — the same worst case the Final
  // Inspection section constructs, with three cards instead of one.
  {
    let worst = 0;
    let worstAt = "";
    const contentAxes = hazardsForMark(MARK_COUNT).filter((h) => h.kind === "content");
    for (let day = 0; day < 60; day++) {
      const d = new Date(Date.UTC(2026, 7, 27 + day));
      for (let i = 0; i < RUN_LEVELS; i++) {
        // Pour every notch into content axes — the arrival that arrives with
        // the belt already full, so the clauses land on top of a cap.
        const ratchets: Ratchets = {};
        for (let n = 0; n < i; n++) {
          const a = contentAxes[n % contentAxes.length];
          ratchets[a.id] = (ratchets[a.id] ?? 0) + 1;
        }
        const cfg = levelForRun({ ...skydeckRunFor(newTiers(), [], d), levelIndex: i, ratchets });
        const total = mixTotal(cfg.materialMix);
        if (total > worst) { worst = total; worstAt = `${dailySeed(d)} bay ${i + 1}`; }
      }
    }
    // At or under the ceiling everywhere EXCEPT where the capstone's full-belt
    // pair states the whole belt (finals.ts: total 1 is that pair's authored
    // case, and belt.ts's spacing rule deliberately stands down for it).
    check("the stacked belt never exceeds the ceiling, bar the full-belt pair",
      worst <= MIX_TOTAL_CAP + 1e-9 || Math.abs(worst - 1) < 1e-9,
      `worst ${worst.toFixed(3)} at ${worstAt}`);
  }

  // ---- THE MODE SURVIVES A BAY BOUNDARY -----------------------------------
  // advanceRun rebuilds the run field by field, so a rebuild that dropped
  // `skydeck` would open the yard, double the notch quota and stop applying the
  // day's clauses — all at the first bay boundary, and all silently.
  {
    const after = advanceRun(skyRun(0), 900, 780, 6, 40, ["time"]);
    check("the mode survives advanceRun", after.skydeck !== null);
    check("...with the same clauses",
      JSON.stringify(after.skydeck) === JSON.stringify(skyRun(0).skydeck));
    check("...and the Skydeck still refuses the yard and the second notch",
      !refitAfterBay(after, after.levelIndex) && picksForRun(after) === SKYDECK_PICKS_PER_BAY);
    // A ladder run is untouched by any of this.
    const ladderAfter = advanceRun(newRun(7, [], 0, newTiers(), MARK_COUNT), 900, 780, 6, 40, ["time"]);
    check("a ladder run stays a ladder run", ladderAfter.skydeck === null);
  }

  // ---- A LADDER RUN IS UNCHANGED ------------------------------------------
  // The whole feature is additive or it is a regression. Every bay of a ladder
  // run at every Mark must build byte-identically to what it built before the
  // mode existed, which is what `skydeck: null` short-circuiting every one of
  // the four predicates is FOR.
  {
    let moved = 0;
    for (let mark = 1; mark <= MARK_COUNT; mark++) {
      for (let i = 0; i < RUN_LEVELS; i++) {
        const run = { ...newRun(7, [], 0, newTiers(), mark), levelIndex: i };
        const cfg = levelForRun(run);
        // The same config built the long way round: base, ship, ratchets, and
        // the single final clause — i.e. everything levelForRun does EXCEPT the
        // standing-clause line this change added.
        const manual = applyRatchets(makeBaseLevel(i, mark), {});
        if (i === RUN_LEVELS - 1) applyFinal(manual, run.final);
        manual.bondBreakerCharges = Math.max(0, run.bondCharges);
        if (JSON.stringify(cfg) !== JSON.stringify(manual)) moved += 1;
      }
    }
    check("a ladder run's bays are untouched by the mode", moved === 0, `${moved}`);
  }

  // ---- applyFinals: the stack's own rules ---------------------------------
  {
    // Order-independence. Which bay a clause was signed on must not change the
    // bay it is flown on, so applyFinals sorts by tier rather than by argument
    // order.
    const ids: FinalId[] = ["cold-chain", "tight-gauge", "odd-lots"];
    const a = makeBaseLevel(RUN_LEVELS - 1, MARK_COUNT);
    const b = makeBaseLevel(RUN_LEVELS - 1, MARK_COUNT);
    applyFinals(a, ids);
    applyFinals(b, [...ids].reverse());
    check("a stack is order-independent", JSON.stringify(a) === JSON.stringify(b));

    // A clause signed twice is one clause. Applying it twice would double a
    // floor the card states as a floor.
    const once = makeBaseLevel(RUN_LEVELS - 1, MARK_COUNT);
    const twice = makeBaseLevel(RUN_LEVELS - 1, MARK_COUNT);
    applyFinals(once, ["rush-order"]);
    applyFinals(twice, ["rush-order", "rush-order"]);
    check("a duplicate clause applies once", JSON.stringify(once) === JSON.stringify(twice));

    // The one-clause case is exactly what applyFinal always did.
    const disagreed: string[] = [];
    for (const f of FINALS) {
      const viaOne = makeBaseLevel(RUN_LEVELS - 1, f.tier);
      const viaMany = makeBaseLevel(RUN_LEVELS - 1, f.tier);
      applyFinal(viaOne, f.id);
      applyFinals(viaMany, [f.id]);
      if (JSON.stringify(viaOne) !== JSON.stringify(viaMany)) disagreed.push(f.id);
    }
    check("applyFinal is applyFinals' one-clause case",
      disagreed.length === 0, disagreed.join(", "));

    // NO CLAUSE IS EATEN BY ANOTHER. The re-cap holds everything the STACK
    // raised, so a material clause stacked under a second one still delivers at
    // least the rate its card quotes — the "a mandatory cost that can be
    // pre-paid is not a cost" rule, read at stack scope.
    {
      const stacked = makeBaseLevel(RUN_LEVELS - 1, MARK_COUNT);
      applyFinals(stacked, ["cold-chain", "tar-run"]);
      const alone = makeBaseLevel(RUN_LEVELS - 1, MARK_COUNT);
      applyFinals(alone, ["cold-chain"]);
      check("a stacked clause is not scaled below its own rate",
        stacked.materialMix.cryo >= alone.materialMix.cryo - 1e-9,
        `${stacked.materialMix.cryo.toFixed(3)} vs ${alone.materialMix.cryo.toFixed(3)}`);
    }
  }

  // ---- THE LADDER IS NEVER TICKED BY A DAILY ------------------------------
  // Found in review (PR #124). meta.ts's recordRunEnd ticks the tier at
  // markUnlocked(meta), and markUnlocked SATURATES at MARK_COUNT — while the
  // Skydeck opens only once the whole ladder is beaten. So every player who can
  // reach the roof is parked on that saturated tier, and an unguarded daily win
  // set tierRunDone, banked a tier milestone's salvage and printed Tier 10
  // completion copy, every day, for as long as they kept winning.
  //
  // run.ts's tracksLadder is the rule, and it is what main.ts's finishRun
  // branches on — no harness can call that method, so the predicate is what
  // gets pinned, with the meta identity asserted THROUGH it so a predicate that
  // started answering "yes" fails here rather than in a save file.
  {
    const beaten: MetaState = {
      // The arrival that makes the bug reachable: the ladder finished, so
      // markUnlocked saturates and the "tier in progress" is Mark 10 again.
      //
      // FULLY SEALED as well, now that the roof asks for it (meta.ts's
      // skydeckOpen). The seals are not what makes the bug reachable — the
      // saturation is — but a fixture that could not actually open the roof
      // would be proving the guard on a state no Skydeck player is ever in,
      // which is how a pin quietly stops covering the thing it was written for.
      ...newMeta(), mark: MARK_COUNT, salvage: 40,
      sealedMarks: Array.from({ length: MARK_COUNT }, (_, i) => i + 1),
    };
    check("the arrival is the one that opens the Skydeck",
      markUnlocked(beaten) === MARK_COUNT && skydeckOpen(beaten));

    const sky = skydeckRunFor(newTiers(), [], new Date(Date.UTC(2026, 7, 27)));
    const ladder = newRun(7, [], 0, newTiers(), MARK_COUNT);
    check("a Skydeck run does not track the ladder", !tracksLadder(sky));
    check("...where a ladder run at the same Mark does", tracksLadder(ladder));
    check("...and Tier S still does not either",
      !tracksLadder({ ...ladder, sandbox: true }));

    // finishRun's branch, exactly: tick only when the run tracks the ladder.
    const finish = (run: RunState, won: boolean): MetaState =>
      tracksLadder(run)
        ? recordRunEnd(beaten, run.mark, won, RUN_LEVELS, 0).meta
        : beaten;

    // The control first — without it "nothing moved" could mean the arrival was
    // inert rather than that the gate held.
    check("a ladder win at that Mark really would tick it",
      JSON.stringify(finish(ladder, true)) !== JSON.stringify(beaten)
        && finish(ladder, true).tierRunDone && !beaten.tierRunDone);
    // Compared as JSON rather than field by field, because the failure is a
    // whole function running that should not have: `runs`, `bestBay`,
    // `salvage`, `tierRunDone` and `sealedMarks` all move in it, and a check
    // that listed today's fields would pass the day a sixth is added.
    check("a Skydeck win leaves the ladder's meta byte-identical",
      JSON.stringify(finish(sky, true)) === JSON.stringify(beaten));
    check("...and so does a Skydeck loss",
      JSON.stringify(finish(sky, false)) === JSON.stringify(beaten));
    // The seal is the half NOT gated on the Mark being current (recordRunEnd's
    // `sealed`), so it is the one an "it is already done at Mark 10" argument
    // would have missed.
    //
    // Asserted as "adds none" rather than "holds none": the fixture above is
    // fully sealed, because that is the only state a Skydeck player can be in
    // now. The control is the same save with Mark 10's seal lifted — a ladder
    // run there puts it back, a Skydeck run does not, which is the difference
    // the mode's gate exists to make.
    const unsealedTop: MetaState = {
      ...beaten, sealedMarks: beaten.sealedMarks.filter((m) => m !== MARK_COUNT),
    };
    check("a Skydeck run never seals a Mark",
      finish(sky, true).sealedMarks.join() === beaten.sealedMarks.join()
        && !tracksLadder(sky)
        && recordRunEnd(unsealedTop, MARK_COUNT, true, RUN_LEVELS, 0)
          .meta.sealedMarks.includes(MARK_COUNT));
  }

  // ---- THE ANALYSER IS TOLD WHICH MODE IT IS LOOKING AT --------------------
  // Also found in review. A Skydeck bay carries mark 10 and a clock, so nothing
  // else about its telemetry record tells it apart from an ordinary Mark-10
  // Deep Run bay — and sim/playtest.ts's medians are what the tier ladder is
  // tuned against. Fixed daily seed, no refit behind it and standing clauses on
  // it, pooled into those medians, is corrupted balance data.
  {
    const sky = skydeckRunFor(newTiers(), [], new Date(Date.UTC(2026, 7, 27)));
    const ladder = newRun(7, [], 0, newTiers(), MARK_COUNT);
    check("a Skydeck bay is tagged as its own mode",
      telemetry.runMode(sky) === "skydeck", telemetry.runMode(sky));
    check("...and a ladder bay is still tagged run",
      telemetry.runMode(ladder) === "run", telemetry.runMode(ladder));
    // The two runs are otherwise indistinguishable to the record, which is why
    // the tag has to exist at all.
    check("...on two runs the record could not otherwise tell apart",
      sky.mark === ladder.mark && telemetry.runMode(sky) !== telemetry.runMode(ladder));
  }

  // ---- THE SCREENS SAY WHAT THE RUN DOES ----------------------------------
  {
    const rules = skydeckRulesFor(new Date(Date.UTC(2026, 7, 27)));
    const listed = clauseDefs(rules);
    check("the menu lists one row per stop", listed.length === CLAUSE_STOPS.length);
    check("...naming the bay each arms on",
      listed.every((r, i) => r.bay === CLAUSE_STOPS[i].fromBay),
      listed.map((r) => r.bay).join(","));
    // The draft's third bank cell is the clause tally INSTEAD of scrap, because
    // a scrap readout on a mode with no yard can only ever be 0.
    const draft = S.draftScreen({
      bayNum: 4, tier: MARK_COUNT, funds: 900, carry: 120,
      offers: hazardOffers(1, 4, MARK_COUNT), ratchets: {}, selected: [],
      picksNeeded: SKYDECK_PICKS_PER_BAY, preview: [], scrap: 0, baysToRefit: null,
      standing: { active: 1, total: CLAUSE_STOPS.length, nextBay: 7 },
    });
    check("the Skydeck draft counts clauses where the ladder counts scrap",
      draft.includes(`1/${CLAUSE_STOPS.length}`) && !/Scrap/.test(draft));
    const ladderDraft = S.draftScreen({
      bayNum: 4, tier: MARK_COUNT, funds: 900, carry: 120,
      offers: hazardOffers(1, 4, MARK_COUNT), ratchets: {}, selected: [],
      picksNeeded: 2, preview: [], scrap: 40, baysToRefit: 2,
    });
    check("...and the ladder draft still counts scrap", /Scrap/.test(ladderDraft));
    // The bay-clear card is the ONE screen between the bay that earned a clause
    // and the projection whose numbers it has already moved.
    const armed = S.bayClearScreen({
      bayNum: 3, bayName: "Cryo Vault", funds: 1200, target: 1100, lines: 9, scrap: 0,
      slot: { value: "Cold Chain", label: "clause \u00b7 from Bay 4" },
    });
    check("the bay-clear card announces the arming clause",
      armed.includes("Cold Chain") && armed.includes("from Bay 4"));
    // ...and takes the SCRAP slot to do it, rather than growing the card. The
    // card is centred in a fixed viewport with no scroller: a fourth row put
    // the HUD's own controls off the bottom of the 640x360 phone (sim/uifit).
    check("...in the slot the scrap payout would have had",
      !/scrap/i.test(armed) && (armed.match(/class="stat/g) ?? []).length === 3);
    check("...and says nothing on a ladder clear",
      /scrap/i.test(S.bayClearScreen({
        bayNum: 3, bayName: "Cryo Vault", funds: 1200, target: 1100, lines: 9, scrap: 40,
      })));
  }
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
  check("a tier-1 board borrows bays 1-3", std.join(" ") === "bay-1 bay-2 bay-3", std.join(" "));
  // Distinct is the point of indexing by slot rather than rolling: the three
  // cards on the board must never sound like each other. This also catches
  // DAILY_COUNT growing past the slot table, where slot 3 would wrap to bay 1.
  check("no two of the day's Contracts share a bed",
    new Set(std).size === std.length, std.join(" "));

  // ---- The tier window ----------------------------------------------------
  // A board's three cards walk three consecutive bays anchored at the tier they
  // were generated for (contracts.ts's contractSlotBed). Pinned through the
  // mapping itself rather than through generated boards: a board per tier costs
  // seconds of tiling work to assert something that is arithmetic, and the
  // arithmetic is the part that can go wrong.
  const windowOf = (tier: number) =>
    Array.from({ length: DAILY_COUNT }, (_, slot) => contractSlotBed(tier, slot));
  const windowTrace = (tier: number) => windowOf(tier).join(" ");
  const TIERS = Array.from({ length: RUN_LEVELS }, (_, i) => i + 1);

  check("a tier-2 board walks bays 2-4", windowTrace(2) === "bay-2 bay-3 bay-4", windowTrace(2));
  check("a tier-3 board walks bays 3-5", windowTrace(3) === "bay-3 bay-4 bay-5", windowTrace(3));
  // The clamp, from both sides. Below it the window is anchored at the tier's
  // own bay; at and above it every board keeps the last three, which is the
  // whole reason the BASE clamps rather than each slot.
  check("below the clamp a board opens on its own tier's bed",
    TIERS.filter((t) => t <= CONTRACT_BED_TOP_BASE)
      .every((t) => windowOf(t)[0] === `bay-${t}`),
    TIERS.map((t) => `${t}:${windowOf(t)[0]}`).join(" "));
  check("tiers 8, 9 and 10 all keep the last three",
    [8, 9, 10].every((t) => windowTrace(t) === "bay-8 bay-9 bay-10"),
    [8, 9, 10].map(windowTrace).join(" | "));
  // A tier past the ladder is not a real board today, but sandbox.ts hands
  // arbitrary tiers around and a window that walked off the end would clamp
  // every slot onto the closer.
  check("a tier past the ladder keeps them too",
    windowTrace(RUN_LEVELS + 5) === windowTrace(RUN_LEVELS), windowTrace(RUN_LEVELS + 5));
  check("no window runs past the last bay",
    TIERS.every((t) => windowOf(t).every((b) => bayOf(b) <= RUN_LEVELS)));
  check("no board ever deals one bed twice",
    TIERS.every((t) => new Set(windowOf(t)).size === DAILY_COUNT),
    TIERS.map(windowTrace).join(" | "));
  // The clamp is DERIVED, not typed in: it is the last anchor whose window ends
  // exactly on the last bay. Widening the board without moving it fails here.
  check("the clamp leaves room for exactly one window",
    CONTRACT_BED_TOP_BASE + DAILY_COUNT - 1 === RUN_LEVELS, String(CONTRACT_BED_TOP_BASE));

  // The joke: a five-cube shipment gets the bed written in 5/4, from any slot.
  const bulk = day.map((c) => withSize(c, "bulk", never));
  check("a pentomino Contract gets the 5/4 bed", bulk.every((b) => b === "bay-5"), bulk.join(" "));
  check("a domino Contract does not",
    day.every((c) => withSize(c, "tiny", never) !== "bay-5"));

  // The special outranks both. If it did not, it could never be heard on a
  // pentomino Contract at all — a rare thing that yields to a rule is not rare.
  check("the special beats the slot bed", withSize(day[0], "std", always) === "contract-rare");
  check("the special beats the 5/4 rule", withSize(day[0], "bulk", always) === "contract-rare");
  // …and it beats the window at every depth, not just at the tier the board
  // above happens to be. Both overrides sit ON TOP of the window rather than
  // beside it, so a deep board is the case that would expose them being folded
  // into the per-tier lookup: a tier-9 pentomino Contract must still find the
  // 5/4 bed, which is nowhere near its own window.
  {
    const deep = { ...day[0], tier: 9 };
    check("a deep board's window still yields to the special",
      contractBed(deep, always) === "contract-rare");
    check("a deep pentomino Contract still gets the 5/4 bed",
      withSize(deep, "bulk", never) === "bay-5", withSize(deep, "bulk", never));
    check("…and otherwise plays its own window",
      withSize(deep, "std", never) === windowOf(9)[deep.slot % DAILY_COUNT],
      withSize(deep, "std", never));
  }
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
  const wanted = new Set([
    ...SCREEN_BEDS, ...beds, ...std, ...bulk,
    // Every bed any tier's window can reach, asked for on the Contract board's
    // own account rather than left to overlap the run ladder — the two tables
    // are free to stop agreeing.
    ...TIERS.flatMap(windowOf),
    "contract-rare",
  ]);
  const absent = [...wanted].filter((n) => !shipped.has(n));
  const orphaned = [...shipped].filter((n) => !wanted.has(n));
  check("every bed the game asks for is shipped", absent.length === 0, absent.join(", "));
  check("no music file ships unclaimed", orphaned.length === 0, orphaned.join(", "));
}


// ---------------------------------------------------------------------------
// GESTURE MISFIRE PREVENTION — the firing floor, the strand warning, the chute.
// ---------------------------------------------------------------------------
section("Misfire prevention");
{
  const DT = 1000 / 60;

  // --- The firing floor -----------------------------------------------------
  // The threshold in world px, re-derived from the constants rather than
  // restated: DRAG_MIN + MIN_FIRE_RATIO * (DRAG_MAX - DRAG_MIN). Both drag
  // bounds are module-private in cannon.ts (nothing outside it has any business
  // knowing the mapping), so this brackets the crossing through the public
  // function instead of asserting a number.
  let floorPx = 0;
  for (let len = 0; len <= 260; len += 0.5) {
    if (powerRatioForDrag(len) >= MIN_FIRE_RATIO) { floorPx = len; break; }
  }
  check("the firing floor sits inside a thumb's reach", floorPx > 60 && floorPx < 110, `${floorPx} world px`);
  check("a pull just under the floor is refused", powerRatioForDrag(floorPx - 1) < MIN_FIRE_RATIO);
  check("a pull just over the floor fires", powerRatioForDrag(floorPx + 1) >= MIN_FIRE_RATIO);
  check("a dead tap reads zero power", powerRatioForDrag(0) === 0);

  // THE STALE-POWER BUG, asserted directly. aimFromDrag must report what THIS
  // gesture asked for, not what the cannon happens to be holding — a tap
  // returning the previous drag's ratio is precisely how a graze used to fire a
  // full-power shot at an aim nobody chose.
  {
    const c = new Cannon(makeBaseLevel(0), 7);
    const pulled = c.aimFromDrag(-120, 90);
    check("a real drag reports its own ratio", pulled >= MIN_FIRE_RATIO, String(pulled));
    check("a tap after a hard pull reports 0, not the pull", c.aimFromDrag(0, 0) === 0);
    // The cannon KEEPS the pull — a tap must not stomp an aim the player set,
    // which is also why the gate cannot read powerRatio back off it.
    check("...and leaves the cannon's power untouched", Math.abs(c.powerRatio - pulled) < 1e-9,
      `${c.powerRatio} vs ${pulled}`);
  }

  // --- The chute ------------------------------------------------------------
  // The maw is authored in world px and the panel it models is authored in CSS
  // fractions of the field, in a different file, in a different language. That
  // is a seam two people can move independently, and if they ever disagree the
  // game draws a hazard somewhere other than where it enforces one. So read the
  // stylesheet and compare. (String-matched, necessarily — this harness has no
  // browser and cannot measure a rendered box. It catches the numbers drifting
  // apart, which is the failure that matters here; the RENDERED fit is
  // sim/uifit's job.)
  {
    const cssPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "app.css",
    );
    const css = fs.readFileSync(cssPath, "utf8");
    const plant = css.slice(css.indexOf("\n.plant {"), css.indexOf("\n.pl-pwr {"));
    const frac = (re: RegExp): number | null => {
      const m = plant.match(re);
      return m ? Number(m[1]) : null;
    };
    const left = frac(/left:\s*calc\(var\(--field-x\)\s*\+\s*([\d.]+)\s*\*\s*var\(--field-w\)\)/);
    const width = frac(/width:\s*calc\(([\d.]+)\s*\*\s*var\(--field-w\)\)/);
    const bottom = frac(/bottom:\s*calc\(100%\s*-\s*var\(--field-y\)\s*-\s*([\d.]+)\s*\*\s*var\(--field-h\)\)/);
    const height = frac(/min-height:\s*calc\(([\d.]+)\s*\*\s*var\(--field-h\)\)/);
    check("the plant panel's frame fractions are still readable from app.css",
      left !== null && width !== null && bottom !== null && height !== null,
      `${left} ${width} ${bottom} ${height}`);
    if (left !== null && width !== null && bottom !== null && height !== null) {
      check("the chute's mouth ends where the plant panel does",
        CHUTE.x1 === Math.round((left + width) * WORLD.width),
        `${CHUTE.x1} vs ${Math.round((left + width) * WORLD.width)}`);
      check("the chute's lip sits at the plant panel's top edge",
        CHUTE.y0 === Math.round((bottom - height) * WORLD.height),
        `${CHUTE.y0} vs ${Math.round((bottom - height) * WORLD.height)}`);
      // WHAT IS DRAWN IS NOT THE RECT. The two above pin the physics box
      // against the stylesheet; this pins the FACE — the span render.ts's
      // drawChute actually paints the lip bar and the strand heat across.
      //
      // The rect deliberately runs 21px further left than the panel does (see
      // CHUTE's own note: the sliver beside the machine is dead space a cube
      // must never rest in). Drawing from there is a different claim, and a
      // false one: it put a machined bar — bright red under a strand warning —
      // out across the field's glowing left wall, above the panel's top-left
      // corner, in the one strip of field the crest's port band is dressing.
      // The owner saw a crimson toothed band crossing the wall; this is the
      // half of it the canvas was painting.
      const stock = chuteMouth(chuteRightEdge(new Game(makeBaseLevel(0), {}, 5).strandCutoffX));
      check("the mouth is DRAWN from the panel's left edge, not from the wall",
        Math.abs(stock.x0 - left * WORLD.width) < 0.5,
        `${stock.x0} vs ${left * WORLD.width}`);
      check("...which is inside the rect the physics enforces",
        stock.x0 > CHUTE.x0, `${stock.x0} vs ${CHUTE.x0}`);
      check("...and it still ends where the panel does",
        Math.abs(stock.x0 + stock.w - (left + width) * WORLD.width) < 0.5,
        `${stock.x0 + stock.w} vs ${(left + width) * WORLD.width}`);
    }
  }
  // A press that reaches inside the panel's own left edge is not a mouth to
  // draw inside out — the span clamps rather than going negative.
  check("a mouth narrower than nothing draws nothing",
    chuteMouth(CHUTE_MOUTH_X0 - 40).w === 0);
  check("the chute reaches the floor", CHUTE.y1 === WORLD.height);
  check("the chute reaches the left wall", CHUTE.x0 === 0);
  check("the cannon is not standing in its own chute", !inChute(CANNON.x, CANNON.y));

  // THE SURFACE IS THE MOUTH. The machine used to be a hopper — a grinder
  // plane 231px down inside it, so the footprint claimed the floor of the maw
  // but not its airspace, and cargo crossed the whole body of the machine on
  // the way to it. It is a wall now: what you can touch, it takes.
  check("the machine's surface is its mouth", CHUTE_SURFACE_Y === CHUTE.y0,
    `${CHUTE_SURFACE_Y} vs ${CHUTE.y0}`);
  // The one thing the old depth genuinely bought — no tunnelling — has to
  // survive the move. It does, by a wide margin: the region runs from the
  // surface to the floor, against a max-power launch of 28px per step.
  check("nothing can outrun the surface in one step", CHUTE.y1 - CHUTE_SURFACE_Y > SPEED_MAX * 2,
    `${CHUTE.y1 - CHUTE_SURFACE_Y} vs ${SPEED_MAX * 2}`);

  // Bay Extension T3 walks the press's open stop LEFT of the panel's edge. The
  // maw has to give that ground back, or the upgrade silently buys two cells of
  // shredder.
  {
    const wide = makeBaseLevel(0);
    applyUpgrades(wide, { ...newTiers(), bay: MAX_TIER });
    const w = new Game(wide, {}, 5);
    check("a T3 bay's press reaches inside the panel's footprint",
      w.strandCutoffX < CHUTE.x1, `${w.strandCutoffX} vs ${CHUTE.x1}`);
    check("...so the maw gives that ground back",
      chuteRightEdge(w.strandCutoffX) === w.strandCutoffX,
      String(chuteRightEdge(w.strandCutoffX)));
    check("...while a stock bay keeps the panel's own edge",
      chuteRightEdge(new Game(makeBaseLevel(0), {}, 5).strandCutoffX) === CHUTE.x1);
  }

  {
    const cfg = makeBaseLevel(0);
    const g = new Game(cfg, {}, 11);
    // Aim into the mouth and fire: steeply down at minimum power is the shape
    // of every fumbled shot, and it is the shape the old game silently ate.
    g.cannon.angle = -Math.PI / 3;
    g.cannon.power = g.cannon.speedMin;
    // A combo the misfire has to cost. Set rather than earned: this asserts the
    // shred runs the same accounting the blink path does, and `combo === 0` on
    // a bay that never cleared a line would be true whatever happened.
    g.combo = 3;
    const before = g.score;
    check("the launch is accepted", g.shoot(0));
    const paid = before - g.score;
    // A FIXED, short window rather than "step until the field empties". The old
    // behaviour also ends with an empty field — it just takes a settle plus a
    // 1.4s blink to get there (112 steps, measured with the shred disabled), so
    // a check that waits for the field to clear passes with the chute switched
    // off entirely. Half a second is the claim: gone while the player is still
    // looking at where it went.
    for (let i = 1; i <= 30; i++) g.update(i * DT);
    check("cargo fired into the chute is gone within half a second",
      g.cubes.length === 0, `${g.cubes.length} still on the field`);
    check("...and it cost the launch plus the lost-piece penalty, no more",
      before - g.score === paid + SIZE_SPEC[cfg.pieceSize].cubes * cfg.penaltyPerLostPiece,
      `${before - g.score}`);
    check("...and broke the combo", g.combo === 0, String(g.combo));
  }

  {
    // The other half of the claim: a shot the player MEANT must cross the maw
    // untouched. Full power up the middle is the ordinary delivery.
    const g = new Game(makeBaseLevel(0), {}, 12);
    g.cannon.angle = Math.PI / 4;
    g.cannon.power = g.cannon.speedMax;
    g.shoot(0);
    let anyInMaw = false;
    for (let i = 1; i < 300; i++) {
      g.update(i * DT);
      if (g.cubes.some((c) => inChute(c.body.position.x, c.body.position.y))) anyInMaw = true;
    }
    check("a good shot never enters the chute", !anyInMaw);
    check("...and is still on the field", g.cubes.length > 0);
  }

  {
    // THE FLY-THROUGH IS A STRIKE NOW. This shot — shallow, full power — used
    // to be the invariant the hopper existed to protect: its arc dips into the
    // machine's box around (519, 398) and it carried on out to x 941. The maw
    // let it, because the grinder sat 231px lower.
    //
    // That corridor is gone on purpose. Skimming the roof was never a move the
    // machine offered, and leaving it open made scraping the surface a cheap
    // way to shear the bonds off a shipment. So the assertions invert: the
    // warning must FIRE for an aim that clips the machine, and the cargo must
    // die on the surface rather than tunnel through it.
    const g = new Game(makeBaseLevel(0), {}, 14);
    g.cannon.angle = -Math.PI / 18;
    g.cannon.power = g.cannon.speedMax;
    g.updateTrajectory();
    check("an aim that clips the machine IS warned against", g.trajectoryStrands);
    g.shoot(0);
    const launched = g.cubes.length;
    let escaped = false;
    let gone = 0;
    for (let i = 1; i < 240; i++) {
      g.update(i * DT);
      // Anything that made it past the maw's right edge while still inside the
      // machine's depth got THROUGH it — the exact failure this replaces.
      if (g.cubes.some((c) => c.body.position.x > CHUTE.x1 && c.body.position.y > CHUTE_SURFACE_Y)) {
        escaped = true;
      }
      if (!g.cubes.length) { gone = i; break; }
    }
    check("...nothing comes out the far side of the machine", !escaped);
    check("...the whole shipment is taken", gone > 0 && launched > 0, `${launched} launched, gone at step ${gone}`);
  }

  // --- The strand warning ---------------------------------------------------
  {
    const g = new Game(makeBaseLevel(0), {}, 13);
    g.cannon.angle = -Math.PI / 4;
    g.cannon.power = g.cannon.speedMin;
    g.updateTrajectory();
    check("a steep weak aim is flagged as stranding", g.trajectoryStrands);

    g.cannon.angle = Math.PI / 5;
    g.cannon.power = g.cannon.speedMax;
    g.updateTrajectory();
    check("a strong lofted aim is not flagged", !g.trajectoryStrands);
  }

  {
    // THE ACTIVATION DELAY. The predicate is instant, but a slingshot drag
    // sweeps the whole aim cone and the machine sits under a good part of it,
    // so the raw flag flickers true in passing on very nearly every shot. What
    // the player SEES waits STRAND_WARN_DELAY_MS of continuous danger.
    //
    // Asserted against the constant rather than against 300, so retuning the
    // feel moves this check with it instead of breaking it.
    const g = new Game(makeBaseLevel(0), {}, 21);
    g.cannon.angle = -Math.PI / 4;
    g.cannon.power = g.cannon.speedMin;
    g.updateTrajectory();
    check("a stranding aim trips the predicate at once", g.trajectoryStrands);

    // One step of danger BEFORE asking. Reading strandWarning straight off a
    // fresh Game would pass on the field's initialiser rather than on the
    // delay, which is a check that cannot fail — the whole point of stepping
    // once here is that a zero delay makes the next line go red.
    const steps = Math.ceil(STRAND_WARN_DELAY_MS / DT);
    g.update(DT);
    check("...but the warning the player sees does not", !g.strandWarning);
    for (let i = 2; i < steps; i++) g.update(i * DT);
    check("...and is still quiet one step short of the delay", !g.strandWarning,
      `${steps - 1} of ${steps} steps`);
    g.update(steps * DT);
    check("...then fires on the step that crosses it", g.strandWarning);

    // Only ACTIVATION waits. A stale danger light is worse than none, so
    // leaving the cone has to clear it on the very next step.
    g.cannon.angle = Math.PI / 5;
    g.cannon.power = g.cannon.speedMax;
    g.updateTrajectory();
    check("...and an aim that leaves clears it immediately", !g.trajectoryStrands);
    g.update((steps + 1) * DT);
    check("...with no fade-out on the latch", !g.strandWarning);

    // The cutoff the warning uses and the one markLostPieces punishes on have to
    // be the SAME number, or the arc goes red where nothing is charged (or
    // worse, stays green where something is).
    check(
      "the warning reads the compactor's own strand cutoff",
      g.strandCutoffX === g.compactor.leftX + g.compactor.width / 2 - CELL / 2,
    );
  }

  // A truncated arc is not a landing. predictTrajectory stops at 140 steps
  // whether or not the shot has come down, and treating that cut-off point as
  // where the piece lands would flag every high lob in the game.
  check(
    "an arc still climbing at the step limit is not called short",
    !pathStrands([{ x: 200, y: 300 }, { x: 400, y: 100 }], 780),
  );

  // ...but an arc that DID run out of field is a landing, and its last stored
  // sample sits above the floor rather than on it. predictTrajectory pushes
  // each point at the top of its loop and breaks after integrating, so the
  // step that crosses y = WORLD.height is never recorded: asking the final
  // sample whether it reached the ground is asking the one point guaranteed
  // not to have. These three pin the reading that replaced it — the step
  // between the last two samples is what ended the arc, so the landing is
  // extrapolated across it.
  //
  // Measured over 121 angles x 101 powers at stock gravity: before this, the
  // warning missed 2207 of 8906 genuinely short landings (24.8%); after, 58
  // (0.7%), with no shot warned that lands long.
  //
  // Every x below is RIGHT of CHUTE.x1 (624) on purpose. The chute spans
  // x 0..624, so a short landing left of that is already caught by the
  // path-intersection branch above and would pass these checks for the wrong
  // reason — the band this test is actually about is 624..780: short of the
  // press's reach, but past the grinder, where the landing test is the only
  // thing that can see it.
  check(
    "a short landing is called short even though its last sample is airborne",
    // dy 16 puts the next step at y 722, past the floor: the arc ended here.
    // Extrapolates to x ~717 — clear of the maw, short of the press.
    pathStrands([{ x: 680, y: 690 }, { x: 700, y: 706 }], 780),
  );
  check(
    "a landing beyond the cutoff is not called short",
    pathStrands([{ x: 900, y: 690 }, { x: 920, y: 706 }], 780) === false,
  );
  check(
    "a descending arc cut by the step limit is not called short",
    // Same descent, but still 200px up: the cap ended this one, not the
    // ground, so where it lands is unknown and nothing should be claimed.
    !pathStrands([{ x: 680, y: 490 }, { x: 700, y: 506 }], 780),
  );
}


// ---------------------------------------------------------------------------
section("Tier S — the sandbox as a game mode (lib/devmode.ts, game/sandbox.ts)");
// ---------------------------------------------------------------------------
{
  // THE GESTURE. Nine taps in a row, with "in a row" meaning inside the window
  // — the failure this must not have is a counter that holds at 6 from
  // yesterday and completes on three taps today.
  const streak = new TapStreak();
  let last = streak.press(0);
  for (let i = 1; i < DEV_TAPS_REQUIRED - 1; i++) last = streak.press(i * 200);
  check("eight taps do not open the door", !last.complete);
  check("the beacon lights before the ninth tap", last.progress > 0);
  check("the ninth tap opens it",
    streak.press((DEV_TAPS_REQUIRED - 1) * 200).complete);

  const lapsed = new TapStreak();
  for (let i = 0; i < DEV_TAPS_REQUIRED - 1; i++) lapsed.press(i * 200);
  check("a lapse resets the streak",
    !lapsed.press((DEV_TAPS_REQUIRED - 1) * 200 + DEV_TAP_WINDOW_MS + 1).complete);

  const again = new TapStreak();
  for (let i = 0; i < DEV_TAPS_REQUIRED; i++) again.press(i * 200);
  // The gesture TOGGLES, so the tenth tap has to start a fresh run rather than
  // re-completing the ninth — otherwise holding a finger down would flap the
  // mode on and off.
  check("completing resets, so the next tap starts over",
    !again.press(DEV_TAPS_REQUIRED * 200).complete);

  check("an early tap says nothing", new TapStreak().press(0).progress === 0);

  // THE TOWER. Tier S is the floor on the roof: found by the beacon gesture,
  // and from then on picked, parked and flown exactly like a Mark.
  const shut: S.TowerState = { unlocked: 5, selected: 5, skydeck: false };
  const open: S.TowerState = { ...shut, sandbox: true };
  const parked: S.TowerState = { ...open, selected: S.SANDBOX_TIER };
  check("the roof is shut until the beacon is found", !S.tierOpen(shut, S.SANDBOX_TIER));
  check("the elevator serves Tier S once it is open", S.tierOpen(open, S.SANDBOX_TIER));
  check("Tier S is not a Mark", S.SANDBOX_TIER < 1);
  check("the shaft still holds only the ladder", S.TOWER_FLOORS === MARK_COUNT + 1);
  check("no floor shares Tier S's id",
    !Array.from({ length: S.TOWER_FLOORS }, (_, i) => i + 1).includes(S.SANDBOX_TIER));
  // The roof is ABOVE the Skydeck, which is index 0. Nothing rides there — the
  // index exists so travel time and the plate roll know S is above Mark 10
  // rather than, as its raw id would suggest, below Mark 1.
  check("the roof sits above the Skydeck",
    S.towerIndexOf(S.SANDBOX_TIER) < S.towerIndexOf(S.SKYDECK_TIER));
  // The lift does not serve it: picking S switches the tower off rather than
  // moving the car, so the shaft's index must NOT be the roof's.
  check("the lift goes out of service rather than to the roof",
    S.tierTowerHTML(parked).includes("tower--off")
      && !S.tierTowerHTML(parked).includes(`--tower-idx:${S.towerIndexOf(S.SANDBOX_TIER)}`));
  // The secret survives the unlock: no plate, no letter, nothing the closed
  // headhouse does not already draw. The only difference is the lamp's state.
  check("the open roof looks like the closed one",
    !S.tierTowerHTML(open).includes("tower__head-n"));
  check("no Mark shares the roof's index",
    !Array.from({ length: MARK_COUNT }, (_, i) => S.towerIndexOf(i + 1))
      .includes(S.towerIndexOf(S.SANDBOX_TIER)));
  check("the floor is absent with the mode shut",
    !S.tierTowerHTML(shut).includes(`data-tier="${S.SANDBOX_TIER}"`));
  check("the floor is drawn with the mode open",
    S.tierTowerHTML(open).includes(`data-tier="${S.SANDBOX_TIER}"`));
  // ONE control, two jobs, never both: while the mode is shut the beacon counts
  // taps, and once it is open the same element is the floor. A build where both
  // are live would let taps ten through eighteen tear the floor out from under
  // the car (see main.ts's onBeaconTap).
  check("the beacon is the gesture while shut",
    S.tierTowerHTML(shut).includes('data-action="tower-beacon"'));
  check("the beacon stops counting once it is a floor",
    !S.tierTowerHTML(open).includes('data-action="tower-beacon"'));
  // The basement plate is gone — it was the second way into one screen, and the
  // reason the shaft's cap had to be raised on the phones with least height.
  check("no basement plate survives", !S.tierTowerHTML(open).includes("tower__sub"));
  check("the roof shows it is parked on", S.tierTowerHTML(parked).includes("is-selected"));
  // The gates the ladder already had must be untouched by the new floor: an
  // unearned Mark stays shut whether or not the sandbox is open.
  check("Tier S does not unlock the ladder", !S.tierOpen(open, 6));
  check("the Skydeck still needs the ladder beaten", !S.tierOpen(open, S.SKYDECK_TIER));

  // THE TOP FLOOR'S NAME, pinned on the two things that can break it.
  //
  // ONE NAME ON EVERY SURFACE. The floor is drawn in three places that do not
  // share a string — the shaft plate (floorHTML), the tier plate on the Deep
  // Run button (tierPlateHTML) and that button's subtitle — and the accessible
  // labels are the only place the full name fits, so they are what the player
  // who cannot read a 7px pixel token gets. A build where the plate and the
  // shaft disagree about what the floor is called is two floors as far as a
  // screen reader is concerned.
  const beaten: S.TowerState = { unlocked: MARK_COUNT, selected: S.SKYDECK_TIER, skydeck: true };
  const topHTML = S.tierTowerHTML(beaten);
  check("the shaft names the top floor", topHTML.includes('aria-label="Skydeck"'));
  check("the plate names it the same thing",
    S.tierPlateHTML(S.SKYDECK_TIER, "menu").includes('aria-label="Skydeck"'));
  // AND NOTHING ELSE MAY NAME IT. The floor was the "God floor" until an owner
  // pass caught that the game has no religious frame anywhere else in it and
  // the name promised one (screens.ts's SKYDECK_TIER). Asserted over the whole
  // menu rather than over the three call sites, because the failure this
  // catches is a fourth surface — a subtitle, a guide topic, an aria-label —
  // reintroducing it somewhere nobody thought to look.
  const wholeMenu = S.menuScreen(0, 0, undefined, undefined, undefined, beaten);
  check("no surface calls it anything else", !/\bgods?\b/i.test(wholeMenu));

  // THE TOKEN IS BUDGETED, NOT CHOSEN. The shaft plate's number slot is
  // Press Start 2P at 7px, which advances exactly 1em per glyph, inside a floor
  // whose content box is 72px on the narrowest device in sim/uifit's fleet —
  // 22px car lane, ~14px number, 16px window block, two 4px gaps. That leaves
  // room for three glyphs where the ladder's own widest number ("10") takes
  // two, so a longer name does not merely look different: it squeezes
  // .tower__n and lands as a uifit spill. Pinned as the BUDGET rather than as
  // the literal "SKY", so the next rename is measured against the shaft rather
  // than against this line.
  const TOP_TOKEN_GLYPHS = 3;
  const token = /<span class="tower__n">([^<]*)<\/span>/.exec(topHTML)?.[1] ?? "";
  check(`the top floor's token fits its slot ("${token}")`,
    token.length > 0 && token.length <= TOP_TOKEN_GLYPHS,
    `${token.length} glyphs against a ${TOP_TOKEN_GLYPHS}-glyph slot`);
  // The tier plate's label slot is the same face at 4ch (app.css), and it is
  // shared with "TIER" — the string that sized it. A label longer than that is
  // the device-reported width wobble coming back.
  const PLATE_LABEL_CH = 4;
  const plateLbl = /<span class="tier-plate__lbl">([^<]*)<\/span>/
    .exec(S.tierPlateHTML(S.SKYDECK_TIER, "menu"))?.[1] ?? "";
  check(`the plate label fits the slot "TIER" sized ("${plateLbl}")`,
    plateLbl.length > 0 && plateLbl.length <= PLATE_LABEL_CH,
    `${plateLbl.length} characters against ${PLATE_LABEL_CH}ch`);

  // THE MENU'S PRIMARY BUTTON follows the parked floor: the same button flies a
  // Mark and opens the level select, because the floor decides what it does.
  const menuAt = (t: S.TowerState): string =>
    S.menuScreen(0, 0, undefined, undefined, undefined, t);
  check("the primary button flies the ladder from a Mark",
    menuAt(open).includes("Deep Run") && !menuAt(open).includes(">Sandbox<"));
  check("the primary button becomes Sandbox on the roof",
    menuAt(parked).includes(">Sandbox<"));
  // Four withheld readouts, not four wrong ones: nothing is chosen yet, and the
  // panel quoting Mark 5's bay under an S plate would be the screen promising a
  // bay the launch will not deliver.
  check("the recap withholds its numbers on the roof",
    menuAt(parked).includes("base-bay--unknown"));
  check("the recap still quotes a real bay on a Mark",
    !menuAt(open).includes("base-bay--unknown"));

  // THE RUN. This is the gate that makes the mode safe to ship, so it is
  // checked at the model rather than only in main.ts's finishRun.
  const sbx: SandboxState = {
    ...newSandbox(), tier: 9, target: { kind: "bay", bay: 7 },
    tiers: maxedTiers(), ratchets: { wind: 2 },
  };
  const sRun = sandboxRunFor(sbx);
  check("a Tier S run is marked as one", sRun.sandbox === true);
  check("a ladder run is not", newRun(1).sandbox === false);
  check("it starts at the chosen bay", sRun.levelIndex === 6);
  check("it flies the chosen Mark", sRun.mark === 9);
  check("it carries the pre-ratcheted axes", sRun.ratchets.wind === 2);
  check("it starts cold", sRun.carry === 0);
  // The flag has to survive every bay, or a run that stopped being a sandbox
  // run at bay 2 would spend the rest of the run earning salvage.
  check("the flag survives advanceRun",
    advanceRun(sRun, 900, 800, 12, 40).sandbox === true);

  // The bay the BRIEFING quotes and the bay the launch builds are the same
  // call, so they cannot describe two different bays.
  check("the briefing cannot drift from the launch",
    levelForRun(sandboxRunFor(sbx)).targetScore === levelForRun(sRun).targetScore);
  check("pre-ratcheting actually changes the bay",
    levelForRun(sandboxRunFor({ ...sbx, ratchets: {} })).timeLimitSec
      !== levelForRun(sandboxRunFor({ ...sbx, ratchets: { time: 2 } })).timeLimitSec);

  // THE FINAL INSPECTION, reachable at last. Twenty clauses that previously
  // each needed a complete run of the right rung to see once.
  const pair9 = sandboxFinals(9);
  check("a rung offers exactly two clauses", pair9.length === 2);
  check("the pair belongs to the rung", pair9.every((f) => f.tier === 9));
  check("every rung carries a pair",
    Array.from({ length: MARK_COUNT }, (_, i) => sandboxFinals(i + 1))
      .every((p) => p.length === 2));
  const lastBay: SandboxState = {
    ...sbx, target: { kind: "bay", bay: SANDBOX_FINAL_BAY }, final: pair9[0].id,
  };
  check("the clause reaches the run", sandboxRunFor(lastBay).final === pair9[0].id);
  // The point of the whole row: the clause has to actually move the bay, or the
  // screen is offering a control that reports itself and changes nothing.
  check("the clause actually changes the final bay",
    JSON.stringify(levelForRun(sandboxRunFor(lastBay)))
      !== JSON.stringify(levelForRun(sandboxRunFor({ ...lastBay, final: null }))));
  check("the two clauses of a pair differ",
    JSON.stringify(levelForRun(sandboxRunFor({ ...lastBay, final: pair9[0].id })))
      !== JSON.stringify(levelForRun(sandboxRunFor({ ...lastBay, final: pair9[1].id }))));
  // levelForRun guards on the BAY, not on the field, so a clause left selected
  // while the target walks back is inert rather than leaking onto an early bay.
  check("a clause cannot leak backwards off bay 10",
    JSON.stringify(levelForRun(sandboxRunFor({
      ...lastBay, target: { kind: "bay", bay: 3 },
    })))
      === JSON.stringify(levelForRun(sandboxRunFor({
        ...lastBay, target: { kind: "bay", bay: 3 }, final: null,
      }))));
  // A selection from another rung must not survive the Mark moving — it would
  // be in force with no chip lit to say so (main.ts's sbx-tier clears it).
  check("a clause fits only its own rung", finalFitsTier(pair9[0].id, 9));
  check("a clause from another rung is rejected", !finalFitsTier(pair9[0].id, 1));
  check("no clause is always an option",
    finalFitsTier(null, 1) && finalFitsTier(null, MARK_COUNT));
  check("the sandbox opens with the ladder's own last bay", newSandbox().final === null);

  // AXES. Only what the Mark's own ladder deals, wrapping at the cap.
  check("axes are the Mark's own ladder", sandboxAxes(1).every((h) => h.mark <= 1));
  check("a higher Mark opens more", sandboxAxes(9).length > sandboxAxes(1).length);
  let sr: Ratchets = {};
  for (let i = 0; i < SANDBOX_RATCHET_MAX; i++) sr = bumpSandboxRatchet(sr, "wind");
  check("an axis notches up to the cap", sr.wind === SANDBOX_RATCHET_MAX);
  check("and wraps back to nothing", bumpSandboxRatchet(sr, "wind").wind === undefined);
  check("the notch total is the sum", ratchetTotal({ wind: 2, sweeper: 1 }) === 3);

  // THE BOARDS. Two ids, and they must not be the same one.
  // The collision this key was reshaped to prevent: #90 filed Tier S as board
  // 2 while #88 filed Tier 2 as board 2, so sandbox scores would have landed on
  // the Tier 2 leaderboard. A negative id cannot be a rung, which is the same
  // thing the tower says by drawing Tier S under the base slab.
  check("Tier S is not a rung of the ladder", !isLadderBoard(BOARD_SANDBOX));
  check("every real Tier is", [1, 2, 5, 10].every(isLadderBoard));
  check("Tier S cannot collide with a Tier", ![1,2,3,4,5,6,7,8,9,10].includes(BOARD_SANDBOX));

  // THE SCREEN. It ships, so every control it draws has to be one main.ts
  // routes — and the ones that must never ship have to be absent.
  const sScreen = sandboxScreen({ s: sbx, meta: newMeta(), best: 0 });
  check("the screen offers every mode",
    ["bay", "pattern", "lines"].every((m) => sScreen.includes(`data-mode="${m}"`)));
  check("the screen offers every axis the Mark deals",
    sandboxAxes(9).every((h) => sScreen.includes(`data-axis="${h.id}"`)));
  check("the screen can launch", sScreen.includes('data-action="sbx-launch"'));
  // THE INSPECTION ROW — the reason the boss bay was untestable. Both of the
  // rung's clauses have to be on the screen, and so does the way back to the
  // ladder's own bay 10, or the row is a one-way door.
  check("the screen offers both of the rung's clauses",
    sandboxFinals(9).every((f) => sScreen.includes(`data-final="${f.id}"`)));
  check("the screen offers no clause at all", sScreen.includes('data-final="none"'));
  check("it offers no OTHER rung's clauses",
    sandboxFinals(1).every((f) => !sScreen.includes(`data-final="${f.id}"`)));
  // The briefing names the clause in force, so a Target the Mark's ordinary bay
  // 10 would not produce has something on the panel accounting for it.
  const sInspect = sandboxScreen({
    s: { ...sbx, target: { kind: "bay", bay: SANDBOX_FINAL_BAY }, final: sandboxFinals(9)[0].id },
    meta: newMeta(), best: 0,
  });
  check("the briefing names the clause in force",
    sInspect.includes(sandboxFinals(9)[0].name));
  check("the briefing stays quiet with no clause",
    !sScreen.includes("sbx-brief__clause"));
  check("the shipping screen carries no save-editing controls",
    !sScreen.includes("sbx-wipe") && !sScreen.includes("sbx-grant-mark"));
  check("the developer render does",
    sandboxScreen({ s: sbx, meta: newMeta(), best: 0, cheats: cheatRowHTML(newMeta()) })
      .includes("sbx-wipe"));
  // The cheats themselves, checked here because nothing else can: they are
  // eliminated from every build the app ships, so the only place their effect
  // is ever observed is a test that imports them directly.
  check("a cheat rewrites the save", applyCheat("sbx-grant-salvage", newMeta(), 1)!.salvage === 1000);
  check("a non-cheat is not handled", applyCheat("sbx-launch", newMeta(), 1) === null);

  // The end modal has to say what the run did NOT do, or a player will assume
  // it did.
  const sEnd = S.endModal({
    won: false, score: 100, lines: 4, baysCleared: 2, funds: 10, best: 0,
    name: "ACE", rows: "", reason: "broke", bayNum: 3, bayName: "Bay",
    // Tier S's own board — the check below is #90's, and this is the field
    // that now makes it true.
    boardTier: BOARD_SANDBOX,
    runComplete: false, tierCompleted: null, tierSalvage: 0,
    progress: tierProgressFor(newMeta()), salvageTotal: 0, scrapEarned: 20,
    salvagedFunds: 0, volatileLosses: 0,
    tiers: newTiers(), sandbox: true, sandboxSetup: "Mark 9 · from bay 7",
  });
  check("a Tier S end says nothing was banked", sEnd.includes("No salvage"));
  check("a Tier S end names its board", sEnd.includes("Tier S board"));
  check("a Tier S end does not draw the tier-completion row",
    !sEnd.includes("salvage-row--tier-done"));

  // THE CONTRACT HALF of the mode, and the gate it needs that the Deep Run
  // half does not. recordContractClear asks two questions — is this id
  // unclaimed, and does its tier match the player's — and a Tier S Contract
  // answers both "yes" while being rolled from a seed the player picked and
  // re-rolled until it was easy. So main.ts refuses the award path outright
  // for a sandbox Contract; this pins the property that makes that necessary.
  {
    const meta = { ...newMeta(), mark: 2 };               // playing Tier 3
    const c = generateContract(20_260_824, markUnlocked(meta), PATTERN_SLOT, "plain");
    const banked = recordContractClear(meta, c);
    check("an at-tier Contract clear banks salvage whatever seed it came from",
      banked.salvage > 0);
    // ...which is exactly why the sandbox may never reach that call: the same
    // clear, from Tier S, must leave the save untouched.
    check("...so Tier S must not reach that path at all",
      banked.meta.salvage !== meta.salvage);
  }
  // The Contract end screen has to say the same thing the Deep Run end does,
  // and point back at the bench rather than at a daily board it never came
  // from.
  {
    const cEnd = S.contractEndModal({
      won: true, name: "Practice", kind: "pattern", lines: 4, goal: 4,
      launchesUsed: 8, launches: 8, queue: ["I", "O"] as PieceType[], cubesWasted: 0,
      award: null, progress: tierProgressFor(newMeta()), salvageTotal: 0, sandbox: true,
    });
    check("a Tier S Contract end banks nothing", cEnd.includes("banks no"));
    check("a Tier S Contract end goes back to the bench",
      cEnd.includes('data-action="sandbox"') && !cEnd.includes('data-action="contracts"'));
  }

  // The leaderboard only grows a tab strip once there is a second board.
  check("one board, no tabs", !S.leaderboardScreen("").includes("lb-tab"));
  check("two boards, two tabs",
    S.leaderboardScreen("", { board: BOARD_SANDBOX, sandbox: true }).includes("lb-tab"));
  // The ladder tab names a TIER, since "Deep Run" no longer identifies a board
  // on its own once every Tier keeps one.
  check("the ladder tab names its Tier",
    S.leaderboardScreen("", { board: 7, tier: 7, sandbox: true }).includes("Tier 7"));
}

// ---------------------------------------------------------------------------
section("The guide + drills (guide.ts / drills.ts)");
// ---------------------------------------------------------------------------
{
  // THE GUIDE IS PRICED FOR THE TIER BEING FLOWN.
  //
  // It was a module-level const over LEVEL_1 — bay 1 at Mark 1 — which was
  // correct for exactly as long as a Mark did not change what a bay costs.
  // #88's ladder ended that, and the screen a player opens BECAUSE they do not
  // know the numbers spent that window telling a Tier 10 pilot that launches
  // cost $20 and the clock runs 180s. The failure was silent in every existing
  // check, because every existing check asks about ids, chapters and gates —
  // none of which vary by Mark — so the thing to pin is that the COPY moves.
  {
    const money = (mark: number): string =>
      guideTopics(mark).filter((t) => t.chapter === "economy")
        .map((t) => `${t.summary}${t.body}`).join("");
    const t1 = money(1);
    const t10 = money(10);
    check("the guide re-prices between Tier 1 and Tier 10", t1 !== t10);
    // The exact figures, so a future refactor that returns a constant string
    // cannot pass the inequality above by accident.
    const bay1 = (m: number) => makeBaseLevel(0, m);
    check("...and quotes the flown tier's launch cost",
      t1.includes(`$${bay1(1).launchCost}<`) && t10.includes(`$${bay1(10).launchCost}<`));
    check("...and its clock",
      t1.includes(`${bay1(1).timeLimitSec} seconds`)
      && t10.includes(`${bay1(10).timeLimitSec} seconds`));
    check("...and its opening target",
      t1.includes(`$${bay1(1).targetScore}<`) && t10.includes(`$${bay1(10).targetScore}<`));
    // Ids and gates are Mark-invariant, which is what lets GUIDE_TOPICS stay a
    // const for the coverage checks below.
    check("ids do not vary by Mark",
      guideTopics(1).map((t) => t.id).join() === guideTopics(10).map((t) => t.id).join());
  }

  // COVERAGE. The guide's whole reason for existing is that the old briefing
  // was a SAMPLE — nine cards for a game with six materials, eleven axes and
  // seven systems. These checks are what stop it becoming one again: every
  // material, every dealable axis and every ship track must have a row, so a
  // mechanic that ships without one fails here rather than going unmentioned.
  const ids = new Set(GUIDE_TOPICS.map((t) => t.id));
  for (const m of MATERIALS) {
    if (m === "standard") continue;
    check(`guide covers the ${m} material`, ids.has(`mat-${m}`));
  }
  for (const u of UPGRADES) check(`guide covers the ${u.id} system`, ids.has(`sys-${u.id}`));
  check(
    "every chapter has at least one topic",
    CHAPTERS.every((c) => topicsIn(c.id).length > 0),
  );
  check(
    "topic ids are unique",
    ids.size === GUIDE_TOPICS.length,
    `${GUIDE_TOPICS.length} topics, ${ids.size} ids`,
  );
  check(
    "every topic belongs to a declared chapter",
    GUIDE_TOPICS.every((t) => CHAPTERS.some((c) => c.id === t.chapter)),
  );

  // TIER GATES, on the same base hazards.ts uses. A material topic must open on
  // exactly the tier whose draft can deal that material — earlier and the drill
  // teaches a bay the player cannot meet, later and the guide is behind the
  // game. Read off HAZARDS rather than restated, so the two cannot drift.
  for (const h of HAZARDS) {
    if (h.kind !== "content" || !h.material) continue;
    const t = topicById(`mat-${h.material}`);
    check(
      `the ${h.material} topic opens at the tier its axis does`,
      t?.tier === h.mark,
      `topic ${t?.tier} vs axis ${h.mark}`,
    );
  }
  const fresh = newMeta();
  check(
    "a brand-new save can play the Basics drills",
    topicsIn("basics").filter((t) => t.drill).every((t) => drillUnlocked(t, fresh)),
  );
  check(
    "a brand-new save cannot play a material drill",
    topicsIn("cargo")
      .filter((t) => t.material && t.drill)
      .every((t) => !drillUnlocked(t, fresh)),
  );
  {
    const maxed: MetaState = { ...newMeta(), mark: MARK_COUNT };
    check(
      "a finished save can play every drill in the catalogue",
      GUIDE_TOPICS.filter((t) => t.drill).every((t) => drillUnlocked(t, maxed)),
    );
  }

  // COPY BUDGET. The detail pane does not scroll (ui/screens.ts's guideScreen,
  // and sim/uifit asserts it by leaving `.guide__body` off the scroller
  // allowlist), so a topic's body has to FIT it.
  //
  // The ceilings are measured, not chosen. A probe run of every topic against
  // the 640x360 budget phone puts the slack at 13px on the six MATERIAL panes
  // — art strip, drill card and a tier badge in one pane, the tightest the
  // screen can build — and 18px or better on everything else. Both are under
  // one 17px line, which is exactly what these numbers guard: not the
  // character count as such, but a paragraph GAINING A LINE.
  //
  // Here as well as in uifit because uifit needs a browser and thirteen device
  // profiles to say it, and this says it in milliseconds on the one edit that
  // can break it: someone lengthening a paragraph.
  const ART = new Set(["sizes", "rotate"]);
  const plain = (t: (typeof GUIDE_TOPICS)[number]): number =>
    t.body.replace(/<[^>]+>/g, "").length;
  for (const t of GUIDE_TOPICS) {
    const art = !!t.material || ART.has(t.id);
    const cap = art ? 250 : 370;
    check(
      `${t.id}'s body fits the pane (${art ? "with" : "no"} art)`,
      plain(t) <= cap,
      `${plain(t)} > ${cap}`,
    );
  }

  // DRILLS. Every drill has to be a bay that can be entered, finished and
  // failed — a drill with no goal and no limit never ends, and one whose budget
  // cannot reach its goal is a lesson in losing.
  for (const [id, spec] of Object.entries(DRILLS)) {
    const t = topicById(id);
    check(`drill "${id}" belongs to a guide topic`, t !== undefined);
    const cfg = levelForDrill(id, spec);
    check(
      `drill "${id}" can end`,
      cfg.objectiveLines > 0 || cfg.targetScore < Number.MAX_SAFE_INTEGER,
    );
    check(
      `drill "${id}" can be lost`,
      cfg.launchBudget > 0 || cfg.timeLimitSec > 0 || cfg.launchCost > 0,
    );
    if (cfg.objectiveLines > 0 && cfg.launchBudget > 0) {
      // A row is compactorMinLineCells wide and a shipment is SIZE_SPEC cubes,
      // so a perfect run needs goal*cells/cubes launches. Every drill is sized
      // at least 1.5x that: a drill failed for being slightly wasteful is
      // teaching frugality rather than the thing it is named for.
      const perfect =
        (cfg.objectiveLines * cfg.compactorMinLineCells) / SIZE_SPEC[cfg.pieceSize].cubes;
      check(
        `drill "${id}" budgets at least 1.5x a perfect run`,
        cfg.launchBudget >= perfect * 1.5,
        `${cfg.launchBudget} launches vs ${perfect.toFixed(1)} perfect`,
      );
    }
    // A standing wall may never open with a completed row — the bay would clear
    // a line on frame one. Same invariant contracts.ts's salvageProfile keeps,
    // asserted here because a drill's walls are hand-authored.
    if (cfg.standingWall.length) {
      check(
        `drill "${id}" opens with no completed row`,
        cfg.standingWall.length === cfg.compactorMinLineCells &&
          cfg.standingWall.some((h) => h === 0),
        `[${cfg.standingWall.join(",")}] against ${cfg.compactorMinLineCells} cells`,
      );
    }
    // A drill's material is the ONLY thing on its belt: a bay built to isolate
    // one material that quietly ships two teaches neither.
    const live = Object.entries(cfg.materialMix).filter(([, v]) => v > 0);
    check(
      `drill "${id}" ships at most one material`,
      live.length <= 1,
      live.map(([k]) => k).join("+"),
    );
  }
  check(
    "a drill's seed is stable across builds",
    // Not the value itself — that is an implementation detail — but the
    // property the value exists for: the same drill twice is the same bay, and
    // two different drills are not the same bay.
    levelForDrill("aim", DRILLS.aim).name === levelForDrill("aim", DRILLS.aim).name,
  );
  // NOTHING A DRILL DOES IS PROGRESS. The strongest form of this lives in
  // main.ts's onGameStatus (which routes a drill out above every bookkeeping
  // call); what CAN be asserted here is that a drill's config never carries the
  // things progress is made of.
  for (const [id, spec] of Object.entries(DRILLS)) {
    const cfg = levelForDrill(id, spec);
    check(
      `drill "${id}" pays no scrap it could bank`,
      // Scrap is banked by run.ts's advanceRun, which a drill never reaches —
      // but a drill that quoted a payout in its HUD would be advertising one.
      cfg.scrapPerLine >= 0 && cfg.scrapPerBay >= 0,
    );
  }
}

// ---------------------------------------------------------------------------
section("Bay end: convergence, not one stroke (game.ts)");
// ---------------------------------------------------------------------------
{
  const DT = 1000 / 60;

  /** A one-line bay whose manifest is a single shipment, with every other
   *  limit zeroed so `pieces` is the only reachable loss reason — the same
   *  shape levelForContract gives a pattern Contract.
   *
   *  pieceQueue is ["O"] and not []: Cannon's `finite` is
   *  `!!queue && queue.length > 0` (cannon.ts:132), so a ZERO-LENGTH queue is
   *  read as a cycling bag and piecesLeft reports Infinity. A bay built with
   *  `pieceQueue: []` never reaches the exact-inventory branch at all; it
   *  simply plays on. The queue only goes dry once a shipment has been taken
   *  off it (cannon.ts's `consumed` moves in markShot and nowhere else), which
   *  is why both scenarios below fire.
   *
   *  penaltyPerLostPiece 0 is not decoration either: the dead bay below throws
   *  its shipment away deliberately, and a fine for that drops score under
   *  launchCostNow and opens the BROKE countdown — a different verdict racing
   *  the one under test, and one whose margin shrinks as this fix lengthens
   *  the bay. */
  function spentBay(standingWall: number[]): LevelConfig {
    const cfg = makeBaseLevel(0);
    cfg.objectiveLines = 1;
    cfg.compactorMinLineCells = 6;
    cfg.compactorOpenCells = 12;
    cfg.pieceSize = "tiny";
    cfg.pieceQueue = ["O"];
    cfg.standingWall = standingWall;
    cfg.launchBudget = 0;
    cfg.launchCost = 0;
    cfg.startingFunds = 0;
    cfg.penaltyPerLostPiece = 0;
    cfg.timeLimitSec = 0;
    cfg.targetScore = Number.MAX_SAFE_INTEGER;
    cfg.windMax = 0;
    return cfg;
  }

  /** Centre of slot column k, counted from the wall outward — the same
   *  arithmetic createStandingWall lays its cubes on (pieces.ts) and the same
   *  index lineClear.ts's nearest-slot check reads, so a cube dropped here
   *  lands ON the grid the line check uses rather than near it. */
  const slotX = (k: number) => WALL_INNER - CELL / 2 - k * CELL;

  /** Which step the single shipment is fired on.
   *
   *  The bar's first full advance on this bay is step 134, and the manifest has
   *  to run dry BEFORE it so that the stroke which sets strokeDone is one the
   *  window has already opened over. Measured band on this bay: 100 through
   *  130 all reproduce the loss. Firing at or below 80 was tried and rejected —
   *  the cubes land early enough that the row clears at step 123, inside the
   *  same stroke, and the bay simply wins. Firing at 133 or later was tried and
   *  rejected too: it wins at step 402, which is the correct outcome reached by
   *  accident, because today's gate only gets this right when the manifest
   *  happens to run out AFTER the stroke rather than before it. */
  const FIRE_STEP = 120;

  /** How high above the floor the shipment is placed.
   *
   *  Cubes are placed with setPosition rather than aimed, so the scenario does
   *  not depend on the cannon's default angle and power, on the trajectory
   *  solver, or on where a lob happens to bounce. Eight cells is ~26 steps of
   *  fall: long enough that the pair is still airborne through the full advance
   *  at 134 and lands after it. Measured band: 4 through 12 cells all reproduce
   *  the loss, so this is not perched on an edge. */
  const DROP_CELLS = 8;

  // EXACT INVENTORY, ZERO WASTE — the reported failure verbatim. Four wall
  // cubes plus a two-cube shipment is exactly the six a line needs, so nothing
  // may be spent. The shipment lands in the two empty slots and completes the
  // row on the floor — but only AFTER the stroke that would have counted it.
  // Today the bay is judged the instant that pair stops moving, because
  // strokeDone was already true from step 134: lost with the winning six cubes
  // standing complete and nothing wasted.
  const g = new Game(spentBay([1, 1, 1, 1, 0, 0]), {}, 7);
  let now = 0;
  let steps = 0;
  let fired = false;
  while (g.status === "playing" && steps < 4000) {
    if (!fired && steps === FIRE_STEP) {
      fired = g.shoot(now);
      // The shipment's cubes are the two just pushed onto g.cubes by shoot().
      g.cubes.slice(-2).forEach((c, i) => {
        Matter.Body.setPosition(c.body, {
          x: slotX(4 + i),
          y: WORLD.height - CELL / 2 - CELL * DROP_CELLS,
        });
        Matter.Body.setVelocity(c.body, { x: 0, y: 0 });
        Matter.Body.setAngle(c.body, 0);
        Matter.Body.setAngularVelocity(c.body, 0);
        Matter.Sleeping.set(c.body, false);
      });
    }
    now += DT;
    g.update(now);
    steps += 1;
  }

  // The premise, asserted rather than assumed: a scenario that quietly stopped
  // being an exact-inventory bay would still pass the check below for the
  // wrong reason, which is exactly how the first draft of it went wrong.
  check(
    "the bay under test really has run its manifest dry",
    fired && g.piecesLeft === 0,
    `fired ${fired}, piecesLeft ${g.piecesLeft}`,
  );
  check(
    "a row completed after the last stroke still gets its press",
    g.status === "won" && g.linesTotal === 1,
    `${g.status}${g.lossReason ? ` (${g.lossReason})` : ""} after ${steps} steps, ` +
    `${g.linesTotal} lines, ${g.cubes.length} cubes left`,
  );

  // HANG GUARD, not a regression check: this is green before and after the
  // convergence change by construction, and it exists so that a later widening
  // of the window cannot turn a dead bay into a stall. The other half of the
  // contract — a bay that CANNOT be finished must still end, and not at the
  // backstop.
  //
  // Six cubes over five slots: the row is one slot short of a line however long
  // the press runs, and the spare is stacked on the wall column where it can
  // never fill the gap. Six and not five, because five would put cubesAvailable
  // under cubesRequired and route the bay through objectiveUnreachable's
  // one-second grace instead, which tests nothing about convergence. The pile
  // stands clear of the bar's stop, so nothing the press does moves it and the
  // first quiet stroke settles it.
  const dead = new Game(spentBay([2, 1, 1, 1, 1]), {}, 7);
  dead.shoot(0);
  let deadNow = 0;
  let deadSteps = 0;
  while (dead.status === "playing" && deadSteps < 4000) {
    deadNow += DT;
    dead.update(deadNow);
    deadSteps += 1;
  }
  check(
    "a bay that cannot be finished still ends, and not at the cap",
    dead.status === "lost" && dead.lossReason === "pieces" &&
      deadSteps < dead.compactor.cycleSteps * 4,
    `${dead.status} (${dead.lossReason}) after ${deadSteps} steps ` +
    `(cap ${(dead.compactor.cycleSteps * 6).toFixed(0)})`,
  );
}

// ---------------------------------------------------------------------------
section("The tower's seal — a Mark cleared in one unbroken run (screens.ts)");
// ---------------------------------------------------------------------------
{
  // String-only, because this file is: the SHAPE and the 25px offset are
  // app.css's, and whether they collide with the windows is sim/uifit's
  // question. What can be asserted here is that the markup says it at all,
  // says it once, and says it in words as well as in a class name.
  const base: S.TowerState = { unlocked: 3, selected: 3, skydeck: false, sealed: [2] };
  const html = S.tierTowerHTML(base);
  /** Stamps PRESSED — the filled seal, and only it. Matched on the closing
   *  quote so the empty socket's own class (`tower__seal tower__seal--owed`)
   *  cannot be counted as one: the two are now one glyph in two states, and a
   *  substring test would call the bill a receipt. */
  const stamped = (h: string): number => (h.match(/class="tower__seal"/g) ?? []).length;
  const owed = (h: string): number => (h.match(/tower__seal--owed/g) ?? []).length;
  check("a sealed floor is marked", stamped(html) === 1, `${stamped(html)} stamps`);
  // THE EMPTY SOCKET is what makes "all seals open the roof" legible without a
  // sentence on the menu (screens.ts's floorHTML): the building shows its own
  // bill. Three here — Marks 1 and 3, which are open and unsealed, and the
  // locked roof, which is waiting on both of them.
  check("every floor that still owes a seal shows an empty socket",
    owed(html) === 3, `${owed(html)} sockets`);
  // …and NOT on a Mark the player cannot fly yet. A floor above the unlock has
  // a Mark question, not a seal question, and ten sockets on a Mark-1 tower
  // would be a bill for a mode whose door that player cannot see.
  check("a locked Mark is not billed for a seal it cannot earn",
    stamped(html) + owed(html) === 4);
  // The distinction must survive a viewer who cannot separate the hues. The
  // stamp is a shape and it is aria-hidden, so the floor's accessible NAME is
  // what carries it to anyone the shape does not reach. Asserted as the whole
  // label, not as the bare word: `includes("sealed")` passes on an accident —
  // the class name alone would satisfy it.
  check(
    "the seal is named, not merely drawn",
    html.includes('aria-label="Tier 2 — sealed"'),
  );
  // The Skydeck is not a Mark. meta.ts can never record a seal for it, so a
  // build in which the Skydeck could wear a PRESSED stamp is drawing a state
  // nothing produces — and an OPEN roof wears nothing at all, socket included:
  // the socket is the floor stating what it wants, and a floor that has what it
  // wants states nothing.
  {
    const openRoof = S.tierTowerHTML({
      ...base, unlocked: MARK_COUNT, skydeck: true,
      sealed: [...Array.from({ length: MARK_COUNT }, (_, i) => i + 1), S.SKYDECK_TIER],
    });
    const skyFloor = /<button[^>]*data-tier="\d+"[^>]*>(?:(?!<\/button>).)*<span class="tower__n">SKY<\/span>(?:(?!<\/button>).)*<\/button>/s
      .exec(openRoof)?.[0] ?? "";
    check("the Skydeck is never sealed", skyFloor.length > 0 && !skyFloor.includes("tower__seal"),
      skyFloor ? "the roof carries a stamp" : "the roof was not found");
    // The bill it replaced, so the check above cannot pass by the roof simply
    // never drawing anything.
    const shutRoof = S.tierTowerHTML({ ...base, unlocked: MARK_COUNT, skydeck: false });
    check("...but a shut one shows what it is waiting for",
      shutRoof.includes("tower__seal--owed"));
  }
  // THE ROOF'S PRICE IN WORDS. The sockets are a shape and the shape is
  // aria-hidden, so the locked floor's accessible name is the only place the
  // count reaches a screen-reader user — and the count is the whole gate
  // (meta.ts's skydeckOpen).
  check("a locked roof states how many Marks are sealed",
    S.tierTowerHTML({ unlocked: MARK_COUNT, selected: MARK_COUNT, skydeck: false, sealed: [1, 2, 4] })
      .includes(`aria-label="Skydeck — locked — 3 of ${MARK_COUNT} Marks sealed"`));
  // …and an OPEN one says only its name, which is what the top-floor naming
  // pins below assert verbatim.
  check("...and an open one says only its name",
    S.tierTowerHTML({ unlocked: MARK_COUNT, selected: MARK_COUNT, skydeck: true })
      .includes('aria-label="Skydeck"'));
  // Absent reads as none — menuScreen's fallback tower and every uifit fixture
  // that predates the seal must render no STAMPS. They do now draw sockets, and
  // that is the change being made rather than a regression: a tower with no
  // seal record is a tower that owes every seal it can earn.
  check(
    "a tower with no seal record draws no stamps",
    stamped(S.tierTowerHTML({ unlocked: 3, selected: 3, skydeck: false })) === 0,
  );
}

// ---------------------------------------------------------------------------
section("The end card's exits: Contracts, Retry Run, Retry Bay (screens.ts)");
// ---------------------------------------------------------------------------
{
  /** A run end, with only the things these checks are about spelled out. The
   *  rest is a plausible losing run, because a fixture that varied everything
   *  would make each failure a hunt for which knob moved it. */
  const end = (o: Partial<Parameters<typeof S.endModal>[0]> = {}): string =>
    S.endModal({
      won: false, runComplete: false, score: 40_000, lines: 90, baysCleared: 6,
      funds: 300, best: 50_000, name: "PILOT", rows: "", reason: "broke",
      bayNum: 7, bayName: "Cryo Vault", tierCompleted: null, tierSalvage: 0,
      progress: tierProgressFor(newMeta()), salvageTotal: 0, scrapEarned: 100,
      salvagedFunds: 0, volatileLosses: 0, tiers: newTiers(), boardTier: 1,
      ...o,
    });

  /* -------------------------------------------------------------------------
   * WHAT VOLATILE TOOK IS PRINTED. A cost the player is never shown reads to
   * them exactly the way it read to the sim before it was billed — as free pile
   * relief — which is the defect lineClear.ts's volatileLossFor was written to
   * remove. Pricing it and hiding it removes the defect from the numbers and
   * leaves it in the player's head.
   *
   * On the BREAKDOWN row specifically, and that is the assertion rather than an
   * incidental fact about where the string landed. The sandbox foot beside it
   * (screens.ts's demoFoot) renders on Tier S runs only, so a charge parked
   * there would be invisible on every ladder run — i.e. on every run where it
   * cost the player anything that mattered.
   * ----------------------------------------------------------------------- */
  {
    const charged = end({ volatileLosses: 240 });
    check("a run that ate detonations says what they took",
      charged.includes("$240 lost to detonations"));
    check("...on the breakdown row, which every run draws — not the Tier S foot",
      /end__breakdown[^]*?\$240 lost to detonations[^]*?<\/div>/.test(charged));
    // Suppressed at zero rather than printed as "$0": most runs never ratchet
    // the axis, and a hazard the player never met has no business on the one
    // row that reconciles the run's money.
    check("a run that met no volatile is not told what it did not lose",
      !end({ volatileLosses: 0 }).includes("lost to detonations"));
    // The two readouts are independent, and a run can carry both. Pinned
    // because they are one sentence apart in screens.ts and the obvious
    // regression is a branch that renders whichever is checked first.
    const mixed = end({ volatileLosses: 240, salvagedFunds: 310, sandbox: true });
    check("a run that both recovered and lost prints both figures",
      mixed.includes("$240 lost to detonations")
        && mixed.includes("$310 recovered by demolition"));
  }

  // ---- THE CONTRACTS ROUTE -----------------------------------------------
  // The end card is where a player decides what to do next, and it used to
  // offer the run again or the menu. Contracts pay the salvage the next run
  // wants, so the door belongs here — but only while there is something behind
  // it: a board of three ticks is a door onto free practice, which is not what
  // to advertise on the way out of a lost run.
  check("a board with cards left offers the route",
    end({ contracts: { remaining: 2, next: false } }).includes('data-action="contracts"'));
  check("...and a fully cleared board does not",
    !end({ contracts: { remaining: 0, next: true } }).includes('data-action="contracts"'));
  check("...and a caller that knows nothing about the board draws nothing",
    !end().includes('data-action="contracts"'));
  // THE BADGE IS meta.ts's nextStep AND NOTHING ELSE, which is what keeps "one
  // surface carries it" true across the screen boundary. Available is not the
  // same question as next: a player whose salvage already covers an install is
  // being sent to the Workshop, and this card has a Workshop button of its own
  // in the salvage row.
  check("the route is badged only when Contracts are the next step",
    end({ contracts: { remaining: 3, next: true } }).includes("Next step"));
  check("...and merely being available earns no badge",
    !end({ contracts: { remaining: 3, next: false } }).includes("Next step"));
  // The card's OTHER badge-bearer, so the two cannot both light: a run that
  // banked salvage draws a Workshop button, and nextStep answers "workshop"
  // exactly when it would not answer "contracts".
  check("the two doors are the same rule's two branches",
    nextStep({ ...newMeta(), salvage: 1_000 }) === "workshop"
      && nextStep(newMeta()) === "contracts");

  // ---- RETRY BAY vs RETRY RUN --------------------------------------------
  // They were one button ("Play Again") that only ever meant the fresh start.
  // Two now, because they hand back two different things — and the pair only
  // reads if both halves say which.
  const lost = end({ retryBay: { seal: "at-stake", mark: 4 }, contracts: { remaining: 3, next: true } });
  check("a lost ladder run offers the bay back", lost.includes('data-action="retry-bay"'));
  check("...and the fresh start beside it, named", lost.includes(">Retry Run<"));
  check("...and never as one button", !lost.includes(">Play Again<"));
  // NOT THE PRIMARY, and this is the pin that matters most on this screen.
  // padnav's focusInitial lands a pad on the primary button, so whichever
  // button wears it is what a stray A after a loss presses — and Retry Bay is
  // the only control on the card that spends something permanent. The primary
  // stays the fresh start, which is the slot "Play Again" already held.
  const primary = /<button class="btn btn--primary"[^>]*data-action="([a-z-]+)"/.exec(lost)?.[1];
  check("the button a stray press finds is not the one that costs the seal",
    primary === "restart", primary ?? "no primary");
  // NEVER SILENT. The glyph is on the button and the sentence is above the row,
  // and the sentence carries the half a player will otherwise get wrong.
  check("the retry wears the seal it is about to spend", lost.includes("btn__seal"));
  check("...and says what it does and does not cost",
    /breaks this run's seal/.test(lost) && /still opens/.test(lost));

  // ---- THE BUTTON HOLDS THE MARK, BOTH WAYS -------------------------------
  // Playtest: "restart bay button should hold the mark of whether the seal has
  // been broken or not". It used to draw the glyph while the seal was INTACT
  // and nothing at all once it was spent — so the one state a player most wants
  // to read back (this run's seal is already gone, further retries are free)
  // was the state with no mark on it. Absence is not something a player can
  // read; two distinct faces are.
  const spent = end({ retryBay: { seal: "spent", mark: 4 } });
  check("a spent seal is drawn, not omitted", spent.includes("btn__seal--broken"));
  check("...and an intact one is drawn differently",
    lost.includes("btn__seal") && !lost.includes("btn__seal--broken"));
  // The struck stamp means on this button what it means on the tower: a seal
  // that is GONE. It used to mean "about to go", which is the glyph predicting
  // the press rather than reporting the run.
  check("the struck stamp reports the run, not the press",
    !spent.includes('class="btn__seal"'));
  // Both faces reach a screen reader, which the shape cannot — it is
  // aria-hidden on both.
  check("both states are named, not merely drawn",
    /breaks this run's seal/.test(lost)
      && /this run's seal is already broken/.test(spent));
  // …and the line above the row is a READOUT rather than a warning now, so it
  // has something to say in both states. The second is not the first repeated:
  // it is the opposite news, and it is news the player can act on.
  check("the spent state says retries are free now",
    /costs nothing now/.test(spent) && !/breaks this run's seal/.test(spent));

  // ---- THE THIRD FACE: A MARK ALREADY STAMPED ----------------------------
  // Found in review (codex, PR #135). A re-fly of a sealed Mark was drawn as an
  // intact seal about to be spent, which is a price no retry can charge.
  {
    const held = end({ retryBay: { seal: "held", mark: 3 } });
    // SOLID, because the stamp is not gone — the glyph means here what it means
    // on the tower — and MUTED, because nothing is at risk. It is the alarm
    // taken off the at-stake face, not the struck face reused.
    check("a held stamp is drawn solid, not struck",
      held.includes("btn__seal--held") && !held.includes("btn__seal--broken"));
    check("...and is not the at-stake face either",
      !/class="btn__seal"/.test(held));
    // THE COPY IS ABOUT THE MARK, NOT THE RUN, and this is the pin that keeps
    // it honest: the player is looking at a LOSS, and a line implying this run
    // sealed something would be flatly untrue.
    //
    // Read out of the LINE rather than out of the whole card, because the same
    // words are in the button's aria-label — a `.test(held)` over the document
    // passed with the visible line deleted, which is a pin that cannot fail for
    // the reason it was written. (Caught red-first while checking this block.)
    const sealLine = (h: string): string =>
      (/<p class="muted end__seal">([\s\S]*?)<\/p>/.exec(h)?.[1] ?? "")
        .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    check("the held line names the Mark whose stamp it is",
      /Mark 3 is already sealed/.test(sealLine(held)), sealLine(held) || "no line");
    check("...and says the press is free",
      /costs nothing/.test(sealLine(held)));
    // Case-INSENSITIVE, which is not fussiness: the spent line opens with
    // "This run's seal", so a case-sensitive test passed against the very line
    // this pin exists to rule out. (Caught red-first, same pass as the scoping
    // above.)
    check("...and never claims this run sealed anything",
      !/this run's seal/i.test(sealLine(held)));
    // The other two lines are scoped the same way, so all three are held to the
    // element the player actually reads.
    check("...where the at-stake line is the one that charges",
      /breaks this run's seal/.test(sealLine(lost)));
    check("...and the spent line is the one that reports a price paid",
      /already broken/.test(sealLine(spent)));
    // It reaches a screen reader too — the shape is aria-hidden in all three.
    check("...and the button says so as well",
      /aria-label="Retry Bay \d+ — Mark 3 is already sealed, so this costs nothing"/.test(held));
    // The bay is still offered: this is the FORGIVING state, and gating the
    // button on it would take the retry away exactly where it is free.
    check("a held seal still offers the bay back",
      held.includes('data-action="retry-bay"'));
  }
  // THE MODES THAT HAVE NO BAY TO GIVE BACK. main.ts passes `retryBay` only for
  // a run tracksLadder accepts — Tier S re-flies its whole configuration from
  // the primary, and the Skydeck is the day's single attempt, which is the
  // whole of what the mode sells (skydeck.ts).
  check("a Tier S end offers no bay retry",
    !end({ sandbox: true, sandboxSetup: "Mark 10 · from bay 9" })
      .includes('data-action="retry-bay"'));
  check("...and neither does a win",
    !end({ won: true, runComplete: true, reason: null }).includes('data-action="retry-bay"'));

  // ---- THE SEAL CONFIRMATION ----------------------------------------------
  // It was a one-time notice. It is a confirmation now (playtest: "we can also
  // keep the confirmation on breaking the seal, not just the first time"), and
  // the watermark that used to decide whether it appeared at all now decides
  // only how much of it there is — see the `explain` block below.
  {
    const note = S.sealBreakModal({ bayNum: 7, mark: 4, tier: 4, sealed: 3, explain: true });
    // The second paragraph is the whole point of the panel: a player who thinks
    // a retry forfeits the tier will abandon runs they could still win.
    check("the notice promises the tier still opens", /Tier 4 still opens/.test(note));
    check("...and quotes the roof's price in the tower's own numbers",
      note.includes(`${MARK_COUNT} Marks carry a stamp`) && /3 of 10 so far/.test(note));
    check("...and offers both answers", note.includes('data-action="seal-break-go"')
      && note.includes('data-action="seal-break-back"'));
    // Same reasoning as the end card's primary, one screen further in: the
    // reversible answer is the one a pad lands on.
    const keep = /<button class="btn btn--primary"[^>]*data-action="([a-z-]+)"/.exec(note)?.[1];
    check("keeping the seal is the default answer", keep === "seal-break-back", keep ?? "none");

    // THE PROMISE IS ONLY MADE WHERE IT IS TRUE (codex review, PR #134). The
    // panel quoted the player's HIGH-WATER tier, so a Mark-3 re-fly by a
    // Mark-10 player read "Tier 10 still opens" about a run that can move
    // nothing at all. It names the run's own Mark now, and drops the tier
    // clause entirely when there is no tier to open.
    const refly = S.sealBreakModal({ bayNum: 7, mark: 3, tier: null, sealed: 9, explain: true });
    check("a re-fly names the Mark whose seal is actually at stake",
      /Mark 3<\/b> cannot be\s+sealed/.test(refly) && !/Mark 10/.test(refly));
    check("...and promises no tier it cannot open", !/Tier \d+ still opens/.test(refly));
    // …and still says the run is not wasted, which is the half that is true on
    // every run and the half the player is actually afraid of losing.
    check("...but still says the run is not thrown away",
      /still earns/.test(refly) && /salvage banks/.test(refly));
    // The frontier panel names the Mark too — the two numbers agree there, and
    // a build that printed the tier in the seal sentence would pass the re-fly
    // check above by accident.
    check("the frontier panel names its Mark as well", /Mark 4<\/b> cannot be/.test(note));

    // ---- LONG ONCE, SHORT EVERY TIME AFTER --------------------------------
    // The watermark's whole remaining job. The LESSON — what a seal is, what
    // the full set opens — is worth exactly one reading; the DECISION is worth
    // asking every time it is real, and the short form is that decision with
    // the lesson taken out.
    const brief = S.sealBreakModal({ bayNum: 7, mark: 4, tier: 4, sealed: 3, explain: false });
    check("the first panel teaches what a seal is",
      note.includes(`${MARK_COUNT} Marks carry a stamp`));
    check("...and every one after it does not",
      !brief.includes(`${MARK_COUNT} Marks carry a stamp`));
    check("...and is genuinely shorter for it", brief.length < note.length,
      `${brief.length} vs ${note.length}`);
    // WHAT THE SHORT FORM MUST KEEP is everything the decision needs: the cost,
    // the correction to the fear (tierOpenableBy's promise, still branch-aware)
    // and both answers. A confirmation stripped to a bare "are you sure?" is a
    // dialog people dismiss without reading.
    check("...while still stating the cost", /Mark 4<\/b> cannot be\s+sealed/.test(brief));
    check("...and still correcting the fear", /Tier 4 still opens/.test(brief));
    check("...and still offering both answers",
      brief.includes('data-action="seal-break-go"')
        && brief.includes('data-action="seal-break-back"'));
    const briefKeep =
      /<button class="btn btn--primary"[^>]*data-action="([a-z-]+)"/.exec(brief)?.[1];
    check("...with the reversible answer still the default",
      briefKeep === "seal-break-back", briefKeep ?? "none");
    // The re-fly branch survives the shortening, which is the one place the two
    // features cross: a short panel on a re-fly must still not promise a tier.
    const briefRefly =
      S.sealBreakModal({ bayNum: 7, mark: 3, tier: null, sealed: 9, explain: false });
    check("...and a short re-fly panel promises no tier either",
      !/Tier \d+ still opens/.test(briefRefly) && /still earns/.test(briefRefly));
  }

  // ---- WHEN THE CONFIRMATION IS ASKED AT ALL (run.ts's retryBreaksSeal) ----
  // The predicate every door into a bay retry shares with the button's face
  // (main.ts's requestBayRetry, endModal's `retryBay.sealed`), so a build where
  // the button says one thing and the panel does another cannot exist.
  {
    const ladder = newRun(7, [], 0, newTiers(), 4);
    /** No Mark sealed — the state every check below is in unless it says so. */
    const none: number[] = [];
    check("a clean ladder run has a seal to spend", retryBreaksSeal(ladder, none));
    // TRUE AT MOST ONCE PER RUN — the property that makes confirming EVERY
    // seal-breaking retry cheap rather than nagging, and the reason a panel on
    // every retry is not a toll.
    check("...and only until it is spent",
      !retryBreaksSeal({ ...ladder, restarts: 1 }, none)
        && !retryBreaksSeal({ ...ladder, restarts: 9 }, none));
    // A CONFIRMATION FOR A FREE ACTION IS WORSE THAN NONE: it teaches the
    // player to click through the one panel that matters. The modes that keep
    // no seal answer false for the same reason recordRunEnd never seals them.
    check("Tier S has nothing to confirm",
      !retryBreaksSeal({ ...ladder, sandbox: true }, none));
    check("...and neither has the Skydeck",
      !retryBreaksSeal(
        skydeckRunFor(newTiers(), [], new Date(Date.UTC(2026, 7, 27))), none,
      ));
    // The rule is exactly the seal's own rule, asked one bay earlier: a run
    // this predicate calls spendable is a run recordRunEnd would still seal.
    check("...and it agrees with what actually seals",
      recordRunEnd(newMeta(), 4, true, RUN_LEVELS, ladder.restarts).meta.sealedMarks.includes(4)
        === retryBreaksSeal(ladder, none));

    // ---- A MARK ALREADY SEALED CANNOT BE CHARGED AGAIN -------------------
    // Found in review (codex, PR #135). A fresh re-fly of a Mark whose stamp is
    // already on the tower answered "at stake", so the confirmation claimed a
    // price no retry can take and the end card drew the seal as spendable.
    //
    // THE REASON IS meta.ts's OWN APPEND-ONLY RULE, so it is asserted rather
    // than assumed: the whole finding rests on a stamp being permanent.
    check("a stamp survives a retried run at the same Mark",
      recordRunEnd({ ...newMeta(), sealedMarks: [4] }, 4, false, 6, 3)
        .meta.sealedMarks.includes(4));
    check("...and a won one, retries and all",
      recordRunEnd({ ...newMeta(), sealedMarks: [4] }, 4, true, RUN_LEVELS, 3)
        .meta.sealedMarks.includes(4));
    // …so the gate must not ask for it.
    check("a re-fly of a sealed Mark confirms nothing", !retryBreaksSeal(ladder, [4]));
    check("...however clean the run is",
      !retryBreaksSeal({ ...ladder, restarts: 0 }, [1, 2, 3, 4, 5]));
    // THE CONTROL, and the one thing this change must not break: the
    // seal-hunting re-fly of an UNSEALED Mark is exactly as it shipped. A
    // player going back for a stamp they do not have still has one to lose.
    check("...but a re-fly of an UNSEALED Mark is unchanged",
      retryBreaksSeal(ladder, [1, 2, 3, 5, 6]));
    // The three states, stated as the states rather than as the predicate, so
    // the button's faces are pinned as well as the gate.
    check("a sealed Mark reads held", sealStateFor(ladder, [4]) === "held");
    check("...and outranks what this run has done",
      sealStateFor({ ...ladder, restarts: 2 }, [4]) === "held");
    check("an unsealed Mark on a clean run reads at-stake",
      sealStateFor(ladder, none) === "at-stake");
    check("...and reads spent once this run has retried",
      sealStateFor({ ...ladder, restarts: 1 }, none) === "spent");
    check("a run with no seal question reads as none at all",
      sealStateFor({ ...ladder, sandbox: true }, none) === null
        && sealStateFor({ ...ladder, sandbox: true }, [4]) === null);
    // One rule, two readers: the gate is DEFINED on the state, so a build that
    // let them drift would have to do it deliberately.
    check("the gate is the at-stake state and nothing else",
      ([none, [4], [1, 2]] as number[][]).every((s) =>
        [0, 1].every((r) =>
          retryBreaksSeal({ ...ladder, restarts: r }, s)
            === (sealStateFor({ ...ladder, restarts: r }, s) === "at-stake"))));

    // THE CRUX OF THE EARLIER CHANGE, stated as an independence rather than as
    // a call site (main.ts's requestBayRetry is where it is read, and no
    // harness can call that). The confirmation used to be gated on
    // `stakes && watermark`, so it appeared once per SAVE; it is gated on this
    // predicate alone now, so it appears once per RUN. What the predicate may
    // read has GROWN by exactly one thing — the saved seal record, which is the
    // #135 fix — and the watermark is still not it: a meta differing only in
    // `sealBreakSeen` cannot change the answer, because the function is never
    // handed a meta at all.
    check("whether to confirm does not depend on having confirmed before",
      retryBreaksSeal.length === 2);
    // …and the watermark still has its own, smaller job: the LESSON.
    check("the watermark now gates only the explainer",
      sealBreakOwed(newMeta()) && !sealBreakOwed(sealBreakShown(newMeta())));
  }

  // ---- WHICH TIER A RUN CAN ACTUALLY OPEN (meta.ts's tierOpenableBy) -------
  // The predicate behind the copy above, written against the same comparison
  // recordRunEnd's tier bookkeeping uses, so the panel cannot promise something
  // the recorder refuses.
  {
    const at = (mark: number): MetaState => ({ ...newMeta(), mark });
    check("a run at the frontier opens its tier", tierOpenableBy(at(3), 4) === 4);
    check("...and a re-fly of a beaten Mark opens none", tierOpenableBy(at(9), 3) === null);
    // The saturated top: markUnlocked stops moving at MARK_COUNT, so a Mark-10
    // run passes the frontier test and there is still no Tier 11 to name.
    check("...and a finished ladder opens none either",
      tierOpenableBy(at(MARK_COUNT), MARK_COUNT) === null);
    // The control: the recorder agrees. A run the predicate says opens nothing
    // must be a run recordRunEnd ticks nothing for, or the copy and the
    // bookkeeping have drifted.
    const beaten = at(9);
    check("...and the recorder agrees about the re-fly",
      recordRunEnd(beaten, 3, true, RUN_LEVELS).meta.tierRunDone === false
        && recordRunEnd(beaten, 10, true, RUN_LEVELS).meta.tierRunDone === true);
  }

  // ---- A RIDE NEEDS A FLOOR THAT WAS NOT FLYABLE BEFORE --------------------
  // pendingUnlockMark asks whether the MARK has moved somewhere the ceremony
  // has not followed; the tower needs to know whether there is a FLOOR to ride
  // to. Below saturation those are the same question. At the top they are not,
  // and the gap armed a ~4.5s ride to the floor the car was already parked on
  // every time Tier 10 completed with seals still owed. (Codex review, #134.)
  {
    const rung = (mark: number, celebrated: number): MetaState =>
      ({ ...newMeta(), mark, celebratedMark: celebrated });
    check("an ordinary tier completion still owes a ride", pendingLadderRide(rung(3, 2)));
    check("...and a celebrated one does not", !pendingLadderRide(rung(3, 3)));
    // THE BUG, stated as the state that produced it: the ladder finished, the
    // ceremony has not been told, and markUnlocked has nowhere left to go.
    const top = rung(MARK_COUNT, MARK_COUNT - 1);
    check("the ladder's last rung opens no new floor",
      markUnlocked(top) === markUnlocked(rung(MARK_COUNT - 1, MARK_COUNT - 1)));
    check("...so it owes no ladder ride", !pendingLadderRide(top));
    check("...while the watermark it still owes is real",
      pendingUnlockMark(top) !== null);
    // …and the roof is the OTHER axis, unchanged by any of this: the ride it
    // owes is asked for separately and arms the same ceremony.
    const sealedTop: MetaState = {
      ...top, sealedMarks: Array.from({ length: MARK_COUNT }, (_, i) => i + 1),
    };
    check("...and the roof still owes its own ride when the seals land",
      !pendingLadderRide(sealedTop) && pendingSkydeck(sealedTop));
  }

  // ---- THE WORKSHOP'S OTHER DOOR ------------------------------------------
  // The Workshop is where a player finds out they are short of salvage — every
  // greyed price on its shelf says so — and the thing that pays salvage was a
  // trip through the home screen away.
  {
    /** Just the Contracts button, so a badge counted here is that button's and
     *  not the shelf card's — the two live on the same screen and `includes`
     *  cannot tell them apart. */
    const route = (h: string): string =>
      /<button[^>]*data-action="contracts"[\s\S]*?<\/button>/.exec(h)?.[0] ?? "";
    const shop = S.workshopScreen(newMeta());
    check("the Workshop routes to Contracts", route(shop).length > 0);
    check("...without giving up its own primary",
      /<button class="btn btn--primary btn--lg" data-action="play"/.test(shop));
    // A fresh save owes Contracts and can afford nothing, so the badge is here;
    // a save holding salvage is being sent to the shelf instead, and the two
    // badges on this screen can never both light.
    check("...badged when Contracts are the next step", route(shop).includes("next-badge"));
    const rich = S.workshopScreen({ ...newMeta(), salvage: 1_000, mark: 3 });
    check("...and not when the shelf is the next step",
      route(rich).length > 0 && !route(rich).includes("next-badge")
        && rich.includes("shop-card--next"));
  }

  // ---- THE RECORDER FOLLOWS THE RUN BACK ----------------------------------
  // A run that is retried from the game-over card has already been FILED
  // (main.ts's finishRun), and telemetry.endRun nulls its module-level run —
  // so startBay's `!run` guard silently dropped the retried bay and every bay
  // after it, and the run's real ending no-oped. With playtest recording on,
  // the export showed a run that stopped at the bay it lost. (Codex review,
  // PR #134.)
  //
  // This is the one block in the file that has to make telemetry actually
  // RECORD, so it stands up the same localStorage stub the settings-migration
  // section uses, and puts the real one back afterwards. Everything else here
  // relies on recording() being false under Node (see this file's header).
  {
    const prevStore = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    try {
      telemetry.enable(true);
      check("the harness can make the recorder record", telemetry.recording());

      const bayCfg = (bay: number) => ({
        bay, mark: 4, seed: 1, mode: "run" as const, target: 1_000, timeLimitSec: 180,
        cooldownMs: 900, launchCost: 20, scorePerLine: 100, compactorSpeed: 26,
        compactorOpenCells: 4, compactorMinLineCells: 8, tiers: newTiers(),
        notches: [], pieceSize: "standard",
      });
      const flyBay = (bay: number, result: "won" | "lost") => {
        telemetry.startBay(bayCfg(bay));
        telemetry.endBay({
          result, reason: result === "lost" ? "broke" : null,
          secs: 90, lines: 8, lostPieces: 2, endScore: 900,
        });
      };

      telemetry.startRun(4, newTiers(), []);
      flyBay(1, "won");
      flyBay(2, "lost");
      // The loss card. finishRun files the run; the player then presses Retry
      // Bay, which is where main.ts's resetBay calls resumeRun.
      telemetry.endRun(false, 0);
      const filed = telemetry.summary();
      check("a lost run files the bays it flew", filed.runs === 1 && filed.bays === 2,
        `${filed.runs} runs / ${filed.bays} bays`);
      // THE CONTROL, and the whole finding: without the resume, this bay is
      // dropped on the floor.
      flyBay(2, "won");
      check("a bay flown after a filed loss is dropped without a resume",
        telemetry.summary().bays === 2, `${telemetry.summary().bays} bays`);

      telemetry.resumeRun();
      flyBay(3, "won");
      flyBay(4, "won");
      const resumed = telemetry.summary();
      check("...and kept once the recorder is told the run goes on",
        resumed.bays === 4, `${resumed.bays} bays`);
      // ONE RUN, which is the half that matters as much as the bays. A fresh
      // startRun would have kept the bays too and filed a SECOND run, putting
      // the analyser at odds with meta.runs — the very count recordRunEnd's
      // `refiled` exists to keep honest.
      check("...as ONE run, not two", resumed.runs === 1, `${resumed.runs} runs`);

      telemetry.endRun(true, 40);
      check("...whose ending is the one it actually reached",
        telemetry.summary().runs === 1);
      // The outcome is re-openable in both directions: the loss that was
      // reversed must not survive alongside the win.
      const exported = JSON.parse(
        globalThis.localStorage.getItem("tetrilaunch.playtest.v1") ?? "{}",
      ) as { runs?: { won: boolean | null; bays: unknown[] }[] };
      check("a resumed run reports the outcome it ended on",
        exported.runs?.length === 1 && exported.runs[0].won === true
          && exported.runs[0].bays.length === 4,
        JSON.stringify(exported.runs?.map((r) => ({ won: r.won, bays: r.bays.length }))));
      // …and a resume with nothing to resume is inert, which is what lets
      // resetBay call it on the pause modal's restart without a second test.
      telemetry.resumeRun();
      check("resuming with nothing open opens nothing", telemetry.summary().runs === 1);
    } finally {
      telemetry.enable(false);
      if (prevStore) Object.defineProperty(globalThis, "localStorage", prevStore);
      else delete (globalThis as unknown as Record<string, unknown>).localStorage;
    }
  }
}

// ---------------------------------------------------------------------------
section("The unlock ceremony — detection (meta.ts) and the ride (screens.ts)");
// ---------------------------------------------------------------------------
{
  /** Complete the tier `meta` is currently on, the long way: one won Deep Run
   *  plus a full board of at-tier first clears, through the real recorders. A
   *  hand-written `{ ...meta, mark: n }` would pass every check below while
   *  proving nothing about the path the game actually takes. */
  const completeTier = (meta: MetaState, tag = ""): MetaState => {
    const tier = markUnlocked(meta);
    let out = recordRunEnd(meta, tier, true, RUN_LEVELS).meta;
    for (let i = 0; i < TIER_CONTRACTS_REQUIRED; i++) {
      // Ids are unique per call site as well as per tier: a Contract counts
      // ONCE ever (meta.claimedContracts), so a re-used id would tick nothing
      // and the tier would silently fail to complete.
      out = recordContractClear(out, { id: `ceremony${tag}-t${tier}-c${i}`, tier }).meta;
    }
    return out;
  };

  // A NEW PLAYER IS OWED NOTHING. Tier 1 is where everyone starts — it was
  // never unlocked, and a ceremony for it would celebrate opening the front
  // door of a building you have been handed the keys to.
  check("a fresh save owes no ceremony", pendingUnlockMark(newMeta()) === null);
  check("nothing owed after a lost run",
    pendingUnlockMark(recordRunEnd(newMeta(), 1, false, 4).meta) === null);
  check("nothing owed after a half-finished tier",
    pendingUnlockMark(recordRunEnd(newMeta(), 1, true, RUN_LEVELS).meta) === null);

  const opened = completeTier(newMeta());
  check("completing a tier owes a ceremony", pendingUnlockMark(opened) !== null);
  // The ride goes to the floor that OPENED, not the one that was finished — a
  // lift takes you where you can now go. Tier 1 completing opens Tier 2.
  check("the ceremony names the floor that opened",
    pendingUnlockMark(opened) === 2 && opened.mark === 1);

  // ONCE. This is the whole contract with the home screen: the menu is
  // re-entered constantly (every back button, every Workshop visit), and a
  // ceremony that re-armed on each one would be a cutscene the player cannot
  // get out of.
  const seen = markUnlockCelebrated(opened);
  check("consuming the ceremony silences it", pendingUnlockMark(seen) === null);
  check("re-consuming is free and idempotent", markUnlockCelebrated(seen) === seen);
  // …and PERSISTS as a watermark rather than a flag, so the NEXT unlock is
  // owed its own ride. A boolean cleared here could never say that.
  check("the next unlock owes a fresh ceremony",
    pendingUnlockMark(completeTier(seen)) === 3);

  // COSMETIC BY CONSTRUCTION, the same rule the tower's seal lives under
  // (docs/DESIGN.md: "Purchasable power: none"). Watching or skipping the
  // ceremony must leave the save indistinguishable in every number the ladder
  // reads — otherwise the animation is a progression axis wearing a party hat.
  check(
    "celebrating pays nothing and moves nothing",
    seen.salvage === opened.salvage && seen.mark === opened.mark
      && seen.tierContracts === opened.tierContracts
      && seen.tierRunDone === opened.tierRunDone
      && seen.claimedContracts.length === opened.claimedContracts.length,
  );

  // THE TOP OF THE LADDER still opens something: beating Mark 10 opens the
  // Skydeck. markUnlocked saturates at MARK_COUNT there, which is why main.ts —
  // the only caller holding a tower — maps that one case onto SKYDECK_TIER
  // rather than riding to the floor the car is already parked on.
  let top = newMeta();
  for (let i = 0; i < MARK_COUNT; i++) top = markUnlockCelebrated(completeTier(top));
  check("the whole ladder can be climbed", top.mark === MARK_COUNT);
  const skyOpened = completeTier(
    { ...top, mark: MARK_COUNT - 1, celebratedMark: MARK_COUNT - 1 }, "-sky",
  );
  check("the last unlock is owed a ceremony too",
    pendingUnlockMark(skyOpened) === MARK_COUNT && skyOpened.mark === MARK_COUNT);

  // ------------------------------------------------------------------ the ride
  //
  // THE BAND. 3-6 seconds is the design's, and it is invisible from any one of
  // the four constants it is made of — a hold, a base, a per-floor step and an
  // arrival — so a plausible-looking tweak to any of them can walk the whole
  // ladder's ceremonies out of it without a single line looking wrong.
  const floors = [...Array.from({ length: MARK_COUNT - 1 }, (_, i) => i + 2), S.SKYDECK_TIER];
  for (const to of floors) {
    const ms = S.towerCelebrationMs(to);
    check(
      `the ${to === S.SKYDECK_TIER ? "Skydeck" : `Tier ${to}`} ceremony reads as an event (${ms}ms)`,
      ms >= 3000 && ms <= 6000,
    );
  }
  // Distance is the point of starting at the ground floor: the last unlock's
  // ride has to be visibly the longest climb in the game.
  check("a higher floor is a longer climb",
    floors.every((to, i) => i === 0 || S.towerRiseMs(to) > S.towerRiseMs(floors[i - 1])));
  check("the ceremony outlasts an ordinary pick",
    S.towerRiseMs(2) > S.towerTravelMs(1, 2));

  // THE WAVE (towerRisePassMs) lights the building behind the car. Two things
  // it must never do: light a floor the player has not earned, and light
  // anything before the doors close.
  const dest = 7;
  const passes = Array.from({ length: MARK_COUNT }, (_, i) => i + 1)
    .map((t) => S.towerRisePassMs(dest, t));
  check("the wave stops at the floor that opened",
    passes.slice(dest).every((p) => p === null));
  check("every floor up to it is on the wave",
    passes.slice(0, dest).every((p) => p !== null));
  check("the wave starts on the ground floor at the doors",
    passes[0] === S.TOWER_RISE_HOLD_MS);
  check("the wave ends when the car arrives",
    passes[dest - 1] === S.TOWER_RISE_HOLD_MS + S.towerRiseMs(dest));
  check("the wave travels upward, never down",
    passes.slice(0, dest).every((p, i) => i === 0 || (p ?? 0) > (passes[i - 1] ?? 0)));
  check("no floor lights outside the ride",
    passes.slice(0, dest).every((p) => (p ?? -1) >= S.TOWER_RISE_HOLD_MS
      && (p ?? Infinity) <= S.towerCelebrationMs(dest)));
  check("the Skydeck's wave covers the whole ladder",
    S.towerRisePassMs(S.SKYDECK_TIER, MARK_COUNT) !== null
      && S.towerRisePassMs(S.SKYDECK_TIER, S.SKYDECK_TIER) !== null);

  // ------------------------------------------------------------- the markup
  const resting: S.TowerState = { unlocked: 4, selected: 4, skydeck: false, contracts: 0 };
  const riding: S.TowerState = { ...resting, celebrate: true };
  // THE RESTING TOWER IS UNTOUCHED, byte for byte. sim/uifit measures a
  // building that never celebrates (no fixture passes `celebrate`), so its
  // baseline is only honest as long as the ceremony is additive — and the
  // parked car's `--tower-idx` must be the destination either way, because the
  // ride is an animation ONTO the resting position rather than a second one.
  check("a tower with no ceremony renders exactly as it always did",
    S.tierTowerHTML(resting) === S.tierTowerHTML({ ...resting, celebrate: false }));
  check("the car rests on the new floor with the ride on or off",
    S.tierTowerHTML(riding).includes(`--tower-idx:${S.towerIndexOf(4)}`)
      && S.tierTowerHTML(resting).includes(`--tower-idx:${S.towerIndexOf(4)}`));
  check("the ceremony mounts the ride", S.tierTowerHTML(riding).includes("tower--rising"));
  check("nothing rides without it", !S.tierTowerHTML(resting).includes("tower--rising"));
  check("the ride carries its own timing",
    S.tierTowerHTML(riding).includes(`--tower-rise-dur:${S.towerRiseMs(4)}ms`)
      && S.tierTowerHTML(riding).includes(`--tower-rise-from:${S.towerIndexOf(S.TOWER_RISE_FROM)}`));
  // ONE arrival, on the floor the car parks on. Two would mean the plate
  // ignition and the resting selection had come apart.
  check("exactly one floor arrives",
    (S.tierTowerHTML(riding).match(/is-arriving/g) ?? []).length === 1);
  check("the arriving floor is the one the car parks on",
    /<button class="[^"]*is-arriving[^"]*"[^>]*data-tier="(-?\d+)"/
      .exec(S.tierTowerHTML(riding))?.[1] === "4");
  // Its timing is the arrival itself, not a number of its own to drift from
  // the ride's — the plate ignites when the car gets there or it is decoration.
  check("the arrival is timed off the ride",
    S.tierTowerHTML(riding)
      .includes(`--tower-pass:${S.towerRisePassMs(4, 4)}ms`));
  // A TIMELINE, NOT A MOUNT. The menu can be re-rendered from under a running
  // ceremony (the store's entitlement callback does it), which restarts every
  // CSS animation in the replacement tower while the teardown timer keeps
  // counting from the real start. The offset is what reconciles them: it
  // becomes a negative animation-delay, so the new tower resumes the frame the
  // old one was showing. Zero on the mount that starts the ride, so a caller
  // that never re-renders sees exactly the delays the constants read as.
  check("a fresh ceremony starts at its beginning",
    S.tierTowerHTML(riding).includes("--tower-rise-elapsed:0ms"));
  check("a ceremony re-rendered mid-ride resumes where it was",
    S.tierTowerHTML({ ...riding, celebrateElapsed: 1234 })
      .includes("--tower-rise-elapsed:1234ms"));
  // A negative offset would push the ceremony into the FUTURE and desynchronise
  // it from the one timer that ends it — the ride would still be climbing when
  // its classes were stripped.
  check("the ride can never be offset backwards",
    S.tierTowerHTML({ ...riding, celebrateElapsed: -500 }).includes("--tower-rise-elapsed:0ms"));
  check("a resting tower carries no offset",
    !S.tierTowerHTML(resting).includes("--tower-rise-elapsed"));

  // THE LIFT STILL DOES NOT SERVE THE ROOF. Nothing unlocks Tier S — it is
  // found, not earned — so a ceremony can never ride there, and a build where
  // one could would contradict the whole rule the headhouse is built on.
  check("the roof is never ridden to in glory",
    !S.tierTowerHTML({ ...riding, sandbox: true, selected: S.SANDBOX_TIER })
      .includes("tower--rising"));
}

// ---------------------------------------------------------------------------
section("The hint strip names the hold-to-restart gesture (screens.ts)");
// ---------------------------------------------------------------------------
{
  // BARE LOADOUT deliberately: with the Autoloader owned the strip already
  // says "hold to autofire", and /hold.*restart/ would then match across two
  // separate hints and pass for the wrong reason.
  const bare = { bond: false, demo: false, auto: false };
  // Keyboard and touch share one arm, and the strip is drawn on the
  // fine-pointer path — where a MOUSE performs the same pointerdown hold. So
  // the keyboard strip is the one that has to name it.
  check(
    "the strip names the hold-to-restart gesture",
    /hold.*restart/i.test(S.hintStripHTML("keyboard", bare)),
  );
  check(
    "touch renders the same strip content",
    /hold.*restart/i.test(S.hintStripHTML("touch", bare)),
  );
  // GUARD, not a regression check — green before this hint existed and green
  // after. The pad's Start button is a press, not a pointer hold: nothing binds
  // a held pad button to resetBay, so the gamepad strip must not claim it.
  check(
    "the gamepad strip does not name a gesture the pad cannot make",
    !/hold.*restart/i.test(S.hintStripHTML("gamepad", bare)),
  );
  // GUARD, same reason. Every .kbd chip in this strip is a LIVE BINDING
  // (game/bindings.ts). A keycap around "Hold" would be the strip telling the
  // player to press a key that does not exist — the exact class of bug the one
  // hint table exists to make impossible.
  check(
    "the hold is not dressed as a keycap",
    !/<span class="kbd">Hold<\/span>/i.test(S.hintStripHTML("keyboard", bare)),
  );
}

// ---------------------------------------------------------------------------
section("The hint strip is transient; the pause modal is its reference (screens.ts)");
// ---------------------------------------------------------------------------
{
  const bare = { bond: false, demo: false, auto: false };
  const full = { bond: true, demo: true, auto: true };
  // The strip mounts in whichever fade state main.ts hands it — the HUD is
  // re-rendered wholesale on every state change, so a pause round-trip on a
  // dismissed strip must come back dismissed (see hudHTML's hintsDismissed).
  check("the strip mounts shown by default",
    !S.hintStripHTML("keyboard", bare).includes("kbd-hint--hidden"));
  check("the strip can mount already dismissed",
    S.hintStripHTML("keyboard", bare, true).includes("kbd-hint--hidden"));
  // The pause modal carries the same hint table (one source: hintParts), so
  // the strip a first-timer saw and the card a veteran pauses into can never
  // disagree — including about a rebind, which is the LIVE-BINDING half.
  const paused = S.pauseModal(true, "keyboard", full);
  check("the pause modal carries the control reference", paused.includes('id="pause-keys"'));
  check("the reference renders the live fire binding",
    paused.includes(`<span class="kbd">${keyLabel(keyFor("fire"))}</span>`));
  check("the reference carries the full loadout's ability hints",
    /break bonds/.test(paused) && /arm charge/.test(paused) && /autofire/.test(paused));
  check("the reference points at the Controls screen for the rest",
    /Settings → Controls/.test(paused));
  // The gamepad arm re-labels the whole table, exactly as the strip does —
  // main.ts patches #pause-keys on a profile flip mid-pause.
  const padPaused = S.pauseModal(true, "gamepad", bare);
  check("the gamepad reference speaks pad, not keys",
    padPaused.includes(`<span class="kbd">${padLabel(padFor("fire"))}</span>`) &&
      padPaused.includes("Stick"));
  // …and never names the pointer hold the pad cannot make (the pad restarts
  // through this very modal's button, which pad navigation reaches).
  check("the gamepad reference does not claim the hold gesture",
    !/hold.*restart/i.test(padPaused));
  // THE MENU GESTURES (ui/padnav.ts). The pad's route through every screen in
  // the game runs on four buttons that appear in no binding row and on no
  // other surface, and the card a pad player is reading is itself being driven
  // by them — so this is where they are written down.
  check("the gamepad reference names the menu gestures",
    /D-pad<\/span> move/.test(padPaused) &&
      padPaused.includes(`<span class="kbd">${padLabel(PAD_CONFIRM)}</span> select`) &&
      padPaused.includes(`<span class="kbd">${padLabel(PAD_BACK)}</span> back`));
  check("the gamepad reference names the way into Controls",
    padPaused.includes(`<span class="kbd">${padLabel(PAD_CONTROLS)}</span> opens Controls`));
  // …and the FIELD strip does not. It is width-budgeted onboarding for the bay
  // (four more hints wrapped it into the plant panel), and on a live field the
  // D-pad is nudging aim while A is the trigger — naming menu gestures there
  // would be naming controls the player does not have at that moment.
  check("the field strip stays the bay's own scheme",
    !/D-pad<\/span> move/.test(S.hintStripHTML("gamepad", full)));
}

// ---------------------------------------------------------------------------
section("Gamepad focus navigation picks by geometry (ui/padnav.ts)");
// ---------------------------------------------------------------------------
{
  // The layout every run-critical modal reduces to: a row of cards over a
  // full-width confirm bar (the draft, the inspection), stated in px so the
  // scoring is held to real screen shapes rather than to its own arithmetic.
  const cardA = { x: 100, y: 100, w: 200, h: 240 };
  const cardB = { x: 340, y: 100, w: 200, h: 240 };
  const confirm = { x: 100, y: 380, w: 440, h: 48 };
  const draftish = [cardA, cardB, confirm];
  check("right steps to the neighbouring card", pickNext(draftish, 0, "right") === 1);
  check("left steps back", pickNext(draftish, 1, "left") === 0);
  check("down from a card lands on the confirm bar",
    pickNext(draftish, 0, "down") === 2 && pickNext(draftish, 1, "down") === 2);
  check("up from the confirm bar returns to the nearer card",
    pickNext(draftish, 2, "up") === 0);
  // The screen's edge is a wall, not a wrap — wrapping turns "which way is
  // the confirm button" into a memory question.
  check("the edge is a wall", pickNext(draftish, 0, "left") === 0 && pickNext(draftish, 2, "down") === 2);

  // The menu tower: a vertical stack must step one floor at a time, never
  // skip to the far end (the off-axis penalty must not distort a pure column).
  const tower = Array.from({ length: 5 }, (_, i) => ({ x: 40, y: 60 * i, w: 120, h: 50 }));
  check("a column steps one floor at a time",
    pickNext(tower, 4, "up") === 3 && pickNext(tower, 0, "down") === 1);

  // A lone diagonal target still has to be reachable — the pause modal's row
  // is not perfectly aligned with the reference block under it.
  const diag = [{ x: 0, y: 0, w: 60, h: 40 }, { x: 200, y: 120, w: 60, h: 40 }];
  check("a diagonal-only neighbour is reachable",
    pickNext(diag, 0, "down") === 1 && pickNext(diag, 0, "right") === 1);

  // The UI layer's buttons are the RAW standard-mapping conventions, outside
  // the rebindable gameplay table on purpose (see padnav.ts's note) — pin
  // them so a refactor cannot quietly route menu confirm through a rebind.
  check("the UI buttons are the console conventions",
    PAD_CONFIRM === 0 && PAD_BACK === 1 && PAD_CONTROLS === 8 &&
      PAD_NAV[12] === "up" && PAD_NAV[13] === "down" &&
      PAD_NAV[14] === "left" && PAD_NAV[15] === "right");
  // …and none of them collides with a face button the platform owns: 9 is the
  // pause binding's default (bindings.ts), 16 is Guide/PS, and 17 is the
  // DualSense touchpad click, which is outside standard mapping and would
  // silently do nothing on a Deck.
  check("the UI never spends a button the platform owns",
    ![9, 16, 17].some((b) => b === PAD_CONFIRM || b === PAD_BACK || b === PAD_CONTROLS || b in PAD_NAV));

  // -------------------------------------------------------------------------
  // REACHABILITY, which is the criterion the whole picker is judged by ("all
  // functionality is accessible when using a controller"). Geometry buys
  // better-feeling movement than document order and pays for it with the risk
  // document order does not have: a control that no sequence of presses
  // reaches, or a corner that focus cannot leave. So the two-dimensional
  // screens are held to the property directly rather than to a handful of
  // hand-picked steps.
  //
  // `stranded` walks the picker to a fixed point from every control in turn
  // and reports any pair that cannot be joined — a directed strong-connectivity
  // check, since "you can get in but not out" is exactly the trap.
  const stranded = (rects: NavRect[]): string[] => {
    const dirs = ["up", "down", "left", "right"] as const;
    const out: string[] = [];
    for (let from = 0; from < rects.length; from++) {
      const seen = new Set<number>([from]);
      const queue = [from];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const d of dirs) {
          const next = pickNext(rects, cur, d);
          if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      for (let to = 0; to < rects.length; to++) if (!seen.has(to)) out.push(`${from}→${to}`);
    }
    return out;
  };

  // THE TIER S BENCH, measured out of the uifit harness (the `sandbox` fixture
  // on the 1280x720 laptop row, Chromium): three columns of chips whose middle
  // column is twice the width of the left, over a launch button parked alone
  // in the third — the densest and least regular focus field the game has, and
  // the shape the design note singled out as the one geometry might strand.
  // Real pixels rather than a tidied sketch, because the risk here is in the
  // irregularity: ragged row ends, chip rows of different lengths, and one
  // target 350px away from its nearest neighbour.
  const bench: NavRect[] = [
    { x: 1172, y: 56, w: 52, h: 52 },    // ✕, alone in the header
    { x: 70, y: 174, w: 76, h: 44 },     // mode chips
    { x: 150, y: 174, w: 72, h: 44 },
    { x: 226, y: 174, w: 51, h: 44 },
    { x: 70, y: 248, w: 44, h: 44 },     // tier chips, seven then three
    { x: 214, y: 248, w: 44, h: 44 },
    { x: 358, y: 248, w: 44, h: 44 },
    { x: 70, y: 296, w: 44, h: 44 },
    { x: 166, y: 296, w: 44, h: 44 },    // ragged end of the wrapped row
    { x: 70, y: 492, w: 102, h: 44 },    // reseed, alone at the column's foot
    { x: 445, y: 174, w: 44, h: 44 },    // rig chips, middle column
    { x: 723, y: 174, w: 44, h: 44 },
    { x: 445, y: 296, w: 94, h: 44 },    // material chips
    { x: 740, y: 344, w: 94, h: 44 },
    { x: 445, y: 466, w: 94, h: 44 },    // axis chips
    { x: 544, y: 514, w: 94, h: 44 },    // ragged end again
    { x: 445, y: 570, w: 105, h: 44 },   // clear axes
    { x: 642, y: 644, w: 94, h: 44 },    // final clause chips
    { x: 875, y: 592, w: 335, h: 58 },   // Launch, the third column entire
  ];
  check("nothing is stranded on the Tier S bench", stranded(bench).length === 0,
    stranded(bench).slice(0, 6).join(" "));
  // The two moves that make the bench usable rather than merely connected: the
  // launch button is one press right of the column beside it, and the ✕ is
  // reachable by heading up-and-right from the top of the middle column.
  check("the launch button is one press off the last column",
    pickNext(bench, 17, "right") === 18);
  check("the header's close button is reachable from the top row",
    pickNext(bench, 11, "up") === 0);

  // THE WORKSHOP, same source (`workshop-owned` on the same row): the shop's
  // column of buy buttons on the right — including one below the pane's fold,
  // which is a real focus target with a real rect the moment nav scrolls it in
  // (focusOn's scrollIntoView) — against the single Start Run button in the
  // aside, 400px to its left and out of line with every one of them.
  const shop: NavRect[] = [
    { x: 1078, y: 40, w: 52, h: 52 },    // ✕
    { x: 962, y: 188, w: 152, h: 47 },
    { x: 962, y: 276, w: 152, h: 47 },
    { x: 962, y: 364, w: 152, h: 47 },
    { x: 962, y: 461, w: 152, h: 47 },
    { x: 962, y: 559, w: 152, h: 47 },
    { x: 962, y: 656, w: 152, h: 47 },
    { x: 1016, y: 744, w: 98, h: 47 },   // below the fold of the shop pane
    { x: 531, y: 629, w: 219, h: 51 },   // Start Run, alone in the aside
  ];
  check("nothing is stranded in the workshop", stranded(shop).length === 0,
    stranded(shop).slice(0, 6).join(" "));
  check("the aside's action is one press left of the shop",
    pickNext(shop, 5, "left") === 8);

  // The coach's card is the one control alive during play, and B is its
  // button (main.ts's onPadUiButton) — so the card must label it for a pad
  // player, and must not show the chip to anyone else.
  const lvl = makeBaseLevel(0);
  check("the coach's button wears the pad chip under the gamepad profile",
    S.coachHTML(0, lvl, "gamepad").includes("coach__padkey") &&
      S.coachHTML(0, lvl, "gamepad").includes(`>${padLabel(PAD_BACK)}</span>`));
  check("no pad chip for touch or keyboard",
    !S.coachHTML(0, lvl, "touch").includes("coach__padkey") &&
      !S.coachHTML(0, lvl, "keyboard").includes("coach__padkey"));
}

// ---------------------------------------------------------------------------
section("A held direction repeats into the menus (gamepad.ts)");
// ---------------------------------------------------------------------------
// The poller driven through a stub pad, the same admission the InputController
// block below makes: there is no browser here, but GamepadPoller only asks
// navigator for a button-and-axis snapshot, so a stub runs the REAL poll loop.
// Worth a behaviour test rather than a reading of the constants, because the
// property is a cadence — one step on the press, nothing for the delay, then a
// steady stream — and every part of it is a comparison against `now`.
{
  let buttons: number[] = [];
  let playing = false;
  // Node ships its own `navigator` as a getter-only accessor on globalThis, so
  // this is defineProperty rather than an assignment — and it is restored at
  // the end of the block, since systems.ts is one long-lived process.
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      getGamepads: () => [{
        id: "stub", connected: true, mapping: "standard",
        axes: [0, 0],
        buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: buttons.includes(i) })),
      }],
    },
  });
  const ui: number[] = [];
  const pad = new GamepadPoller({
    game: () => null,
    playing: () => playing,
    onActivity: () => {},
    onPause: () => {},
    onCapture: () => false,
    onUiButton: (b) => { ui.push(b); return true; },
    assist: () => false,
    sling: () => false,
  });
  /** Polls the stub at 60Hz from `t0` for `ms`, as main.ts's loop does. */
  const run = (t0: number, ms: number): number => {
    let t = t0;
    for (; t <= t0 + ms; t += 1000 / 60) pad.poll(t);
    return t;
  };

  buttons = [13]; // D-pad down, held
  let t = run(0, 100);
  check("the press itself steps once", ui.length === 1 && ui[0] === 13, String(ui.length));
  t = run(t, 250); // ~360ms in — still inside the 400ms delay
  check("a brief hold does not double the step", ui.length === 1, String(ui.length));
  t = run(t, 400); // past the delay, then ~3-4 repeats at 120ms
  const repeats = ui.length;
  check("a held direction repeats after the delay", repeats >= 4 && repeats <= 8, String(repeats));
  check("...and every repeat is the direction being held", ui.every((b) => b === 13));

  // Release re-arms: the next press starts the delay over rather than
  // continuing the stream it was in.
  buttons = [];
  t = run(t, 200);
  check("releasing stops the stream", ui.length === repeats, String(ui.length));
  buttons = [13];
  t = run(t, 100);
  check("the next press pays the full delay again", ui.length === repeats + 1);

  // Gameplay takes the D-pad back: 12-15 are aim and power nudges while a bay
  // is live, and a repeat there would be the menu layer nudging the cannon.
  const beforePlay = ui.length;
  playing = true;
  run(t, 600);
  check("a live bay silences the repeat", ui.length === beforePlay, String(ui.length - beforePlay));
  playing = false;

  if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
}

// ---------------------------------------------------------------------------
section("The stick's rate dials hold the aim at centre (gamepad.ts)");
// ---------------------------------------------------------------------------
// The play-test report these exist for, verbatim: "the gamepad controls still
// reset the aim when the stick goes to the center ... a resting stick should
// not modify the aim". Every check below is a behaviour run through the REAL
// poller against a REAL Game, because the property is about what happens over
// many frames of doing nothing — which no reading of a constant can state.
{
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevStore = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let axes = [0, 0];
  let buttons: number[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      getGamepads: () => [{
        id: "stub", connected: true, mapping: "standard",
        axes: axes.slice(),
        buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: buttons.includes(i) })),
      }],
    },
  });

  /** One pad wired to one bay, with the stick mode supplied per case.
   *
   *  `stepMs` is the POLL CADENCE — main.ts polls once per rendered frame, so
   *  this is the display's refresh, and the whole point of some of the checks
   *  below is that it stops mattering. Defaults to 60Hz, the rate everything
   *  was tuned at. */
  const rig = (sling: boolean, stepMs = 1000 / 60, assist = false) => {
    const shots: { angle: number; power: number }[] = [];
    const g = new Game(makeBaseLevel(0), { onShoot: (s) => shots.push({ angle: s.angle, power: s.power }) }, 7);
    const pad = new GamepadPoller({
      game: () => g,
      playing: () => true,
      onActivity: () => {},
      onPause: () => {},
      onCapture: () => false,
      onUiButton: () => false,
      assist: () => assist,
      sling: () => sling,
    });
    let t = 0;
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) { pad.poll(t); t += stepMs; }
    };
    /** Skip the clock forward WITHOUT polling — a backgrounded tab, a stall. */
    const skip = (ms: number): void => { t += ms; };
    return { g, shots, frames, skip, now: () => t };
  };
  const aim = (g: Game) => ({ angle: g.cannon.angle, power: g.cannon.power });
  const same = (a: { angle: number; power: number }, b: { angle: number; power: number }) =>
    a.angle === b.angle && a.power === b.power;

  // THE RATE FUNCTION. Zero everywhere inside the deadzone including its exact
  // edge, and rescaled so the first live rate is a hair off zero rather than a
  // fifth of full speed.
  check("a centred axis asks for no rate at all", stickRate(0) === 0);
  check("...and neither does one resting inside the deadzone",
    stickRate(0.2) === 0 && stickRate(-0.2) === 0 && stickRate(0.22) === 0);
  check("the rate starts from zero at the deadzone's edge",
    stickRate(0.23) > 0 && stickRate(0.23) < 0.02, String(stickRate(0.23)));
  check("a pinned axis asks for the full rate, signed",
    Math.abs(stickRate(1) - 1) < 1e-9 && Math.abs(stickRate(-1) + 1) < 1e-9);

  // THE REPORT ITSELF, on the default mode: deflect, let go, and wait a long
  // time. Five seconds of polling is far longer than any pause between shots.
  {
    const r = rig(false);
    axes = [0.7, -0.7];
    r.frames(25);
    const held = aim(r.g);
    check("the dials move the aim while the stick is deflected",
      held.angle > Math.PI / 9 && held.power > 9, `${held.angle.toFixed(3)}/${held.power.toFixed(2)}`);
    axes = [0, 0];
    r.frames(300);
    check("a centred stick holds the aim, indefinitely", same(aim(r.g), held),
      `${r.g.cannon.angle.toFixed(4)}/${r.g.cannon.power.toFixed(3)} vs ${held.angle.toFixed(4)}/${held.power.toFixed(3)}`);

    // A stick that rests off true zero — worn, or just a pad's idle bias. This
    // one clears a CIRCULAR 0.22 gate (0.28 from centre) while sitting inside
    // both axes' own deadzones, which is precisely the case a shared radial
    // test would wave through into the aim path.
    axes = [0.2, -0.2];
    r.frames(300);
    check("a resting stick off true zero still modifies nothing", same(aim(r.g), held),
      `${r.g.cannon.angle.toFixed(4)}/${r.g.cannon.power.toFixed(3)}`);

    // …and the trigger spends the aim the player left there, with the stick
    // still at rest. Firing must never require a deflection to be alive.
    buttons = [padFor("fire")];
    r.frames(2);
    buttons = [];
    r.frames(2);
    check("the trigger fires the held aim with the stick centred",
      r.shots.length === 1 && same(r.shots[0], held),
      r.shots.length ? `${r.shots[0].angle.toFixed(4)}/${r.shots[0].power.toFixed(3)}` : "no shot");
    check("...and the aim survives its own shot", same(aim(r.g), held));
  }

  // THE TWO AXES ARE INDEPENDENT DIALS. A stick pushed straight up must not
  // touch the power, which is what makes them dials rather than a vector.
  {
    const r = rig(false);
    const before = aim(r.g);
    axes = [0, -0.9];
    r.frames(20);
    check("Y alone trims the angle and leaves the power alone",
      r.g.cannon.angle > before.angle && r.g.cannon.power === before.power);
    const mid = aim(r.g);
    axes = [0.9, 0];
    r.frames(20);
    check("X alone trims the power and leaves the angle alone",
      r.g.cannon.power > mid.power && r.g.cannon.angle === mid.angle);
    axes = [0, 0.9];
    r.frames(20);
    check("...and pulling back down lowers the barrel again",
      r.g.cannon.angle < mid.angle);
  }

  // THE DIALS CHARGE TIME, NOT POLLS. main.ts polls once per rendered frame, so
  // a per-poll rate is the display's refresh in disguise — and the owner's own
  // surface is the Electron shell on a TV, measured at ~8.3ms pacing in #116's
  // tests, i.e. the dials ran at twice their tuned speed for the one player who
  // reported them.
  //
  // Both rigs are handed the SAME WALL-CLOCK WINDOW and must trim the same
  // amount. One warm-up poll first, so the seeded first frame (see the poller's
  // lastPoll) is spent before the measurement starts and each rig then charges
  // exactly 1000ms: 60 x 16.667 against 120 x 8.333. Deflection is 0.4 rather
  // than a pin, deliberately — a pinned stick saturates against the cone and
  // the power ceiling inside a second, and two runs agreeing because both hit
  // the same wall would prove nothing at all.
  {
    const HZ_WINDOW_MS = 1000;
    const measure = (stepMs: number) => {
      const r = rig(false, stepMs);
      axes = [0.4, -0.4];
      r.frames(1);                                  // warm-up: spends the seed frame
      const from = aim(r.g);
      r.frames(Math.round(HZ_WINDOW_MS / stepMs));  // exactly one second of polls
      return {
        dAngle: r.g.cannon.angle - from.angle,
        dPower: r.g.cannon.power - from.power,
        angle: r.g.cannon.angle,
        power: r.g.cannon.power,
        ceiling: r.g.cannon.speedMax,
      };
    };
    const at60 = measure(1000 / 60);
    const at120 = measure(1000 / 120);
    // FIRST, that neither run ended against a wall. Checked BEFORE the two are
    // compared, because a clamped run and a correct run agree perfectly at the
    // limit — under the per-poll code 120Hz overshot the cone and stopped dead
    // on it, and an equality check alone would have called that a match.
    check("neither cadence's second of trim ends pinned against a limit",
      at60.angle < AIM_CONE - 1e-6 && at120.angle < AIM_CONE - 1e-6
        && at60.power < at60.ceiling - 1e-6 && at120.power < at120.ceiling - 1e-6,
      `60Hz ${at60.angle.toFixed(4)}/${at60.power.toFixed(3)} · 120Hz ${at120.angle.toFixed(4)}/${at120.power.toFixed(3)}`);
    check("a second of stick is a second of trim at 60Hz",
      at60.dAngle > 0.4 && at60.dAngle < 0.55 && at60.dPower > 5 && at60.dPower < 6,
      `${at60.dAngle.toFixed(4)}rad/${at60.dPower.toFixed(3)}`);
    check("...and 120Hz trims the same amount in the same second",
      Math.abs(at120.dAngle - at60.dAngle) < 1e-9 && Math.abs(at120.dPower - at60.dPower) < 1e-9,
      `120Hz ${at120.dAngle.toFixed(6)}/${at120.dPower.toFixed(4)} vs 60Hz ${at60.dAngle.toFixed(6)}/${at60.dPower.toFixed(4)}`);
  }

  // A DROPPED FRAME MUST NOT SLAM THE AIM. A backgrounded tab hands the next
  // poll a timestamp seconds later, and an unclamped dt would spend all of it
  // in one step — alt-tab back with a stick leaning and find the barrel pinned.
  {
    const r = rig(false);
    axes = [0.9, -0.9];
    r.frames(1);
    const before = aim(r.g);
    r.skip(5000);      // five seconds away
    r.frames(1);       // one poll charging that gap
    const jump = Math.abs(r.g.cannon.angle - before.angle);
    // The clamp is 100ms — six frames — so the worst one poll can do is six
    // frames of trim, comfortably under a tenth of the cone.
    check("a five-second stall charges the dials six frames, not five seconds",
      jump > 0 && jump < 6.5 * 0.035, `${jump.toFixed(4)}rad`);
    // …and a clock that goes backwards unwinds nothing.
    const held = aim(r.g);
    r.skip(-3000);
    r.frames(1);
    check("...and a backwards timestamp charges nothing rather than unwinding",
      r.g.cannon.angle >= held.angle);
  }

  // THE SLINGSHOT'S AIM NEEDS NO CLOCK — confirmed, not assumed. aimFromDrag is
  // an absolute map, so the same deflection is the same aim however often it is
  // asked; only the ASSIST lerp was a per-poll time constant, and that now
  // compounds over elapsed frames.
  {
    const held = (stepMs: number, assist: boolean, holdMs: number) => {
      const r = rig(true, stepMs, assist);
      axes = [-0.6, 0.45];
      r.frames(1);
      r.frames(Math.round(holdMs / stepMs));
      return aim(r.g);
    };
    check("the slingshot lands the same aim at 60Hz and 120Hz, raw",
      same(held(1000 / 60, false, 600), held(1000 / 120, false, 600)));
    // MEASURED MID-SETTLE, at ~50ms, not after the lerp has converged. Both
    // cadences arrive at the same place eventually — a lerp cannot run away —
    // so a check taken at rest agrees to six decimals whether or not the time
    // constant is honest. Halfway there is where a per-poll factor shows: at
    // 0.3 a frame, 120Hz took six bites of the gap in the time 60Hz took three,
    // and the "smoothing" the toggle promises was half as much smoothing on
    // the fast panel that needs it most.
    const a60 = held(1000 / 60, true, 50);
    const a120 = held(1000 / 120, true, 50);
    check("...and the assist is the same distance along after the same 50ms",
      Math.abs(a120.angle - a60.angle) < 1e-3 && Math.abs(a120.power - a60.power) < 0.05,
      `${a120.angle.toFixed(5)}/${a120.power.toFixed(4)} vs ${a60.angle.toFixed(5)}/${a60.power.toFixed(4)}`);
  }

  // THE SLINGSHOT STILL WORKS WHEN CHOSEN — and still lets the pull go on the
  // way back to centre, which is what a slingshot IS. Pinned here rather than
  // fixed: the option is "fire from the held pull", the way a finger does, and
  // this collapse is the measured reason it is not the default.
  {
    const r = rig(true);
    axes = [-0.85, 0.5];
    r.frames(20);
    const pulled = aim(r.g);
    check("the slingshot option still aims from the pull vector",
      pulled.angle > 0 && r.g.cannon.powerRatio > 0.99,
      `${(pulled.angle * 180 / Math.PI).toFixed(1)}deg/${(r.g.cannon.powerRatio * 100).toFixed(0)}%`);
    // A real stick springs back over several frames rather than snapping.
    for (const k of [0.75, 0.5, 0.32, 0.18, 0.06, 0]) {
      axes = [-0.85 * k, 0.5 * k];
      r.frames(1);
    }
    r.frames(60);
    check("...and letting it go lets the pull go with it",
      r.g.cannon.powerRatio < 0.3, `${(r.g.cannon.powerRatio * 100).toFixed(0)}%`);
  }

  // THE MIGRATION. `stickPull` asked which DIRECTION the vector aiming ran;
  // `stickSling` asks whether to use vector aiming at all. A save that answered
  // the first must not be read as answering the second — that re-reading is
  // what left the reporter on the slingshot and produced the report above.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      store: new Map<string, string>(),
      getItem(k: string) { return this.store.get(k) ?? null; },
      setItem(k: string, v: string) { this.store.set(k, v); },
      removeItem(k: string) { this.store.delete(k); },
    },
  });
  const ls = globalThis.localStorage;
  check("a fresh save lands on the rate dials", loadSettings().stickSling === false);
  ls.setItem("tetrilaunch.settings", JSON.stringify({ sound: true, stickPull: true }));
  check("a pre-dials save does not answer the question the dials ask",
    loadSettings().stickSling === false);
  check("...and the answer it did give stops riding along in the save",
    !("stickPull" in (loadSettings() as unknown as Record<string, unknown>)));
  ls.setItem("tetrilaunch.settings", JSON.stringify({ stickSling: true }));
  check("a save that chose the slingshot for THIS build keeps it",
    loadSettings().stickSling === true);

  // THE REPORT, END TO END, THROUGH THE SETTINGS THE APP ACTUALLY READS. The
  // rig above proves the dials hold; this proves a player carrying a pre-dials
  // save REACHES them. Same save, same poller main.ts wires, and a spring-back
  // over several frames rather than a snap, because that decay is where the
  // slingshot loses the shot.
  //
  // The bound is what separates the two schemes rather than a fudge. A rate
  // dial's release is SELF-LIMITING: the rate falls with the deflection, so the
  // last few frames of travel add ~0.02rad and ~0.23px/step and then stop for
  // good. An absolute map has no such tail — it keeps restating the whole aim
  // from a deflection that is on its way to zero, and hands back a quarter of
  // the power the player was holding. Half a power step and three degrees is
  // comfortably above the first and nowhere near the second.
  const RELEASE_ANGLE_TOL = 0.05;
  const RELEASE_POWER_TOL = 0.5;
  ls.setItem("tetrilaunch.settings", JSON.stringify({ sound: true, stickPull: true }));
  {
    const r = rig(loadSettings().stickSling);
    axes = [0.7, -0.7];
    r.frames(25);
    const held = aim(r.g);
    for (const k of [0.75, 0.5, 0.32, 0.18, 0.06, 0]) {
      axes = [0.7 * k, -0.7 * k];
      r.frames(1);
    }
    r.frames(300);
    const after = aim(r.g);
    check("a pad carried over from before the dials keeps the aim it was holding",
      Math.abs(after.angle - held.angle) < RELEASE_ANGLE_TOL
        && Math.abs(after.power - held.power) < RELEASE_POWER_TOL,
      `${after.angle.toFixed(4)}/${after.power.toFixed(3)} vs ${held.angle.toFixed(4)}/${held.power.toFixed(3)}`);
  }

  if (prevStore) Object.defineProperty(globalThis, "localStorage", prevStore);
  else delete (globalThis as unknown as Record<string, unknown>).localStorage;
  if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
  else delete (globalThis as unknown as Record<string, unknown>).navigator;
}

// ---------------------------------------------------------------------------
section("Mouse aiming solves the arc onto the cursor (cannon.ts)");
// ---------------------------------------------------------------------------
{
  // The forward model's constants, restated the way game.ts's previewModel
  // feeds them: matter's default gravity through engine.ts's fixed 60Hz step,
  // and the frictionAir every launched body is created with.
  const DT = 1000 / 60;
  const G_ACCEL = 1 * 0.001 * DT * DT;
  const FRICTION = 0.012;
  const STEPS = 140;
  const origin = { x: CANNON.x, y: CANNON.y };

  /** Closest approach of a DRAWN arc to a point, world px. The same question
   *  the solver answers internally, asked here through predictTrajectory —
   *  which is the entire point of these checks. Mouse aiming is only correct
   *  if the arc the PREVIEW draws goes where the solver said it would, so
   *  nothing below reads the solver's own miss back and calls that proof. */
  const arcMiss = (angle: number, power: number, t: { x: number; y: number }, wind = 0): number => {
    const pts = predictTrajectory(
      {
        x: origin.x + CANNON.barrel * Math.cos(angle),
        y: origin.y - CANNON.barrel * Math.sin(angle),
      },
      { x: power * Math.cos(angle), y: -power * Math.sin(angle) },
      G_ACCEL, FRICTION, STEPS, () => wind,
    );
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let u = len2 > 0 ? ((t.x - a.x) * dx + (t.y - a.y) * dy) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      best = Math.min(best, Math.hypot(a.x + u * dx - t.x, a.y + u * dy - t.y));
    }
    return best;
  };

  const solve = (t: { x: number; y: number }, min = SPEED_MIN, max = SPEED_MAX, wind = 0, loft = 0) =>
    solveAimForTarget(origin, CANNON.barrel, t, min, max, G_ACCEL, FRICTION, STEPS, () => wind, loft);

  // --- The whole point: the dots go where the click went --------------------
  // SWEPT across the playable bay rather than spot-checked, because the failure
  // this guards is not "the solver is broken" — that would be obvious on the
  // first shot — but "the solver disagrees with the preview somewhere", which
  // is a band of the field rather than a total loss, and is invisible until a
  // player trusts the arc in exactly that band.
  {
    let worst = 0;
    let worstAt = "";
    let refused = 0;
    let n = 0;
    for (let x = 400; x <= 1260; x += 20) {
      for (let y = 200; y <= 700; y += 50) {
        const t = { x, y };
        const sol = solve(t);
        n += 1;
        // Outside the cone the drag path clamps to, the autoloader's own clamp
        // (game.ts's stepAutoLaunch) would silently rewrite the aim, and the
        // arc that fired would not be the arc that was drawn.
        if (Math.abs(sol.angle) > AIM_CONE + 1e-9) {
          worst = Infinity;
          worstAt = `${x},${y} outside the cone`;
          continue;
        }
        if (!sol.hit) { refused += 1; continue; }
        const d = arcMiss(sol.angle, sol.power, t);
        if (d > worst) { worst = d; worstAt = `${x},${y}`; }
      }
    }
    check("the preview's arc passes through every point the solver claims",
      worst <= AIM_HIT_TOL, `worst ${worst.toFixed(2)}px at ${worstAt}`);
    // A solver that quietly gave up on most of the field would pass the check
    // above by never claiming anything. The stock bay is meant to be reachable
    // essentially everywhere a player can click — that is what SPEED_MAX 28 was
    // raised from 26 to buy (see its comment).
    check("the stock cannon can reach the bay it is aiming into",
      refused === 0, `${refused} of ${n} points refused`);
  }

  // --- Which of the two solutions -------------------------------------------
  // Every reachable point has a flat drive and a high lob, and solveAimForTarget
  // documents that it returns the one needing the LEAST POWER. Asserted rather
  // than trusted, by sweeping the whole cone at a power just under the one it
  // returned and confirming nothing there reaches the target.
  {
    const t = { x: 900, y: 620 };
    const sol = solve(t);
    check("a mid-bay target is reachable at all", sol.hit, `miss ${sol.miss.toFixed(1)}px`);
    let cheaperHit = "";
    const weaker = sol.power - 0.5;
    for (let i = 0; i <= 240; i++) {
      const angle = -AIM_CONE + (i / 240) * 2 * AIM_CONE;
      if (arcMiss(angle, weaker, t) <= AIM_HIT_TOL) cheaperHit = `${(angle * 180 / Math.PI).toFixed(1)}deg`;
    }
    check("no gentler shot reaches the same point", cheaperHit === "",
      `returned ${sol.power.toFixed(2)} px/step; ${cheaperHit} reached it at ${weaker.toFixed(2)}`);
    // The corollary the player actually feels: a point further out costs more,
    // so the PWR meter reads as "how close to your limit this spot is".
    check("a further target costs more power",
      solve({ x: 1200, y: 620 }).power > sol.power);
  }

  // --- Wind -----------------------------------------------------------------
  // The solver takes the same frozen wind reading the preview does (game.ts's
  // previewModel hands both callers one object). This proves it is actually
  // USED rather than accepted and dropped: an aim solved against a wind must
  // hit under that wind AND miss under still air, or the solve and the dots are
  // reading two different bays.
  {
    const t = { x: 1000, y: 620 };
    const wind = 0.03;
    const sol = solve(t, SPEED_MIN, SPEED_MAX, wind);
    check("an aim solved against the wind lands on target in that wind",
      arcMiss(sol.angle, sol.power, t, wind) <= AIM_HIT_TOL,
      `${arcMiss(sol.angle, sol.power, t, wind).toFixed(2)}px`);
    check("...and would miss in still air, so the wind is really being read",
      arcMiss(sol.angle, sol.power, t, 0) > AIM_HIT_TOL,
      `${arcMiss(sol.angle, sol.power, t, 0).toFixed(2)}px`);
  }

  // --- Loft: one landing point, a family of arcs ---------------------------
  // The wheel's dial (input.ts's onWheel → Game.aimLoft). The contract has
  // three clauses and each gets its own line: every loft LANDS ON THE SAME
  // POINT (a dial that moved the landing point would be a second aim control
  // fighting the first), more loft is a STEEPER arc (that is the whole ask —
  // come DOWN onto the spot instead of ploughing through the compactor), and
  // more loft costs MORE POWER (the lob branch of the U, which is what keeps
  // the PWR meter honest while the dial turns).
  {
    const t = { x: 900, y: 620 };
    const flat = solve(t);
    const half = solve(t, SPEED_MIN, SPEED_MAX, 0, 0.5);
    const full = solve(t, SPEED_MIN, SPEED_MAX, 0, 1);
    check("every loft lands on the same point", flat.hit && half.hit && full.hit,
      `misses ${flat.miss.toFixed(1)} / ${half.miss.toFixed(1)} / ${full.miss.toFixed(1)}px`);
    check("more loft is a steeper arc through it",
      full.angle > half.angle && half.angle > flat.angle,
      `${flat.angle.toFixed(3)} → ${half.angle.toFixed(3)} → ${full.angle.toFixed(3)} rad`);
    check("more loft costs more power, still inside the band",
      flat.power < half.power && half.power < full.power && full.power <= SPEED_MAX + 1e-9,
      `${flat.power.toFixed(2)} → ${half.power.toFixed(2)} → ${full.power.toFixed(2)} px/step`);
    // WHICH END OF THAT FAMILY THE PLAYER STARTS ON — flipped to the top
    // (cannon.ts's AIM_LOFT_DEFAULT). Pinned here, beside the family it picks
    // out of, because the two facts that make the flip safe are the two
    // asserted directly above: the steep member lands on the SAME point, and
    // it pays for the height inside the ship's speed band rather than off the
    // end of it.
    check("the dial's shipped default is the steepest member of that family",
      AIM_LOFT_DEFAULT === 1 && full.hit,
      `default ${AIM_LOFT_DEFAULT}, miss ${full.miss.toFixed(1)}px`);
    // AND IT COSTS NO REACH, which is the one claim that would sink the flip
    // if it were false: a default that quietly made part of the bay
    // unhittable would be a worse bug than the compactor bar it was flipped
    // to dodge. Swept rather than spot-checked, because "unreachable at the
    // top of the dial" would be a BAND of the field, not a total loss.
    {
      let flatHits = 0;
      let loftHits = 0;
      let lost = "";
      for (let x = 420; x <= 1240; x += 60) {
        for (let y = 200; y <= 680; y += 80) {
          const p = { x, y };
          const a = solve(p).hit;
          const b = solve(p, SPEED_MIN, SPEED_MAX, 0, AIM_LOFT_DEFAULT).hit;
          if (a) flatHits += 1;
          if (b) loftHits += 1;
          if (a && !b) lost = `${x},${y}`;
        }
      }
      check("...and the whole bay stays as reachable from the top of the dial",
        loftHits === flatHits && lost === "",
        `${flatHits} flat vs ${loftHits} lofted; first lost ${lost || "none"}`);
    }
    // ...and the SOLVER's own default is untouched at 0. Nothing that isn't a
    // human with a mouse should inherit the preference: sim/bots.ts and the
    // autopilot call this with no loft argument and want the cheapest answer
    // to "can this be reached", not the prettiest one.
    {
      const bare = solveAimForTarget(
        origin, CANNON.barrel, t, SPEED_MIN, SPEED_MAX, G_ACCEL, FRICTION, STEPS, () => 0,
      );
      check("...while the solver's own default stays the cheap arc for the bots",
        bare.angle === flat.angle && bare.power === flat.power,
        `${bare.angle.toFixed(4)}rad @ ${bare.power.toFixed(2)} vs flat ${flat.angle.toFixed(4)}rad @ ${flat.power.toFixed(2)}`);
    }
  }

  // --- Out of reach ---------------------------------------------------------
  // Documented behaviour is CLAMP, never refuse: the nearest arc the cannon can
  // throw, at the top of its band, with the miss reported honestly so the
  // preview can be the feedback channel. A half-power hull cannot cross the bay.
  {
    const t = { x: 1240, y: 700 };
    const sol = solve(t, SPEED_MIN * 0.5, SPEED_MAX * 0.5);
    check("an unreachable target is reported as one", !sol.hit);
    check("...and answered with the hardest throw available, not with nothing",
      Math.abs(sol.power - SPEED_MAX * 0.5) < 1e-6 && Number.isFinite(sol.miss),
      `power ${sol.power.toFixed(2)}, miss ${sol.miss.toFixed(1)}px`);
    check("...and the aim is still inside the cone", Math.abs(sol.angle) <= AIM_CONE + 1e-9);
  }

  // --- A click the cone cannot answer ---------------------------------------
  // Nothing behind the muzzle is reachable at any angle, so the solver aims at
  // a substitute point in front of it. The MISS it reports must still be
  // measured against the pixel the player clicked: reporting the substitute's
  // miss instead came back as a confident 0 for a click on the launcher itself,
  // which is the one number here that must never lie.
  {
    const behind = { x: CANNON.x - 60, y: CANNON.y + 300 };
    const sol = solve(behind);
    check("a click behind the muzzle reports its real miss, not the substitute's",
      !sol.hit && sol.miss > AIM_HIT_TOL, `${sol.miss.toFixed(1)}px`);
  }
}

// ---------------------------------------------------------------------------
section("Mouse and touch are taught different aiming (bindings.ts)");
// ---------------------------------------------------------------------------
{
  // The two schemes diverged (game/input.ts): a mouse points at a spot and the
  // cannon solves the arc onto it, a finger still pulls back. The one hint
  // table is all that stands between that and a strip telling a mouse player to
  // drag, so it is asserted in BOTH directions rather than only in the one that
  // changed — the touch sentence going stale would be the same bug mirrored.
  check("the mouse hint teaches the click, not the drag",
    /click/i.test(hintAim("keyboard")) && !/pull back|drag/i.test(hintAim("keyboard")),
    hintAim("keyboard"));
  check("the touch hint still teaches the pull-back",
    /pull back/i.test(hintAim("touch")) && !/click/i.test(hintAim("touch")),
    hintAim("touch"));
  // The fine-pointer strip renders on the same surface and has to agree with it.
  check("the fine-pointer strip names the click too",
    /click to aim/i.test(S.hintStripHTML("keyboard", { bond: false, demo: false, auto: false })));
}

// ---------------------------------------------------------------------------
section("The mouse buttons rotate, the wheel lofts, only the left fires (input.ts)");
// ---------------------------------------------------------------------------
// The wheel accumulator first, which is pure and needs nothing but numbers.
// The point of every case here is that ONE PHYSICAL NOTCH IS ONE STEP OF THE
// DIAL no matter what unit the device chose to report it in, and that a
// continuous device's stream of crumbs is measured by distance rather than by
// event count. (The wheel spent these notches on rotation once and spends
// them on the loft dial now — which is why the function answers in signed
// notches and owns no opinion about what a notch buys.)
{
  check("one Chrome/Edge detent down is one notch, signed with its deltaY",
    wheelNotch(0, 100, 0).notch === 1, String(wheelNotch(0, 100, 0).notch));
  check("one detent up is one notch the other way",
    wheelNotch(0, -100, 0).notch === -1, String(wheelNotch(0, -100, 0).notch));
  // deltaMode is the half of this that is easiest to write and forget: Firefox
  // reports LINES, so an unnormalised threshold of 100 would need thirty-four
  // detents per notch there and the feature would simply not work on it.
  check("one Firefox line-mode detent (deltaMode 1, 3 lines) also lands",
    wheelNotch(0, 3, 1).notch === 1, String(wheelNotch(0, 3, 1).notch));
  check("a page-mode detent (deltaMode 2) lands too",
    wheelNotch(0, 1, 2).notch === 1, String(wheelNotch(0, 1, 2).notch));
  // THE TRACKPAD CASE, which is the reason the accumulator exists. One flick
  // is one gesture; without accumulation it is thirty notches — the whole loft
  // range slammed to an end stop by a scroll that meant one step.
  {
    let accum = 0;
    let notches = 0;
    for (let i = 0; i < 30; i++) {
      const r = wheelNotch(accum, 8, 0);
      accum = r.accum;
      notches += Math.abs(r.notch);
    }
    check("a 30-event, 240px trackpad flick is two notches, not thirty",
      notches === 2, `${notches} notches`);
  }
  // A reversal has to cost one notch of travel, not two. Banking 90px downward
  // and then pushing back up must not need 190px of up before anything moves.
  {
    const banked = wheelNotch(0, 90, 0);
    check("90px of travel alone is no notch yet", banked.notch === 0);
    check("...and a full notch the OTHER way still lands immediately",
      wheelNotch(banked.accum, -100, 0).notch === -1,
      String(wheelNotch(banked.accum, -100, 0).notch));
  }
  // The remainder is DROPPED on a fire, so one event can never be worth more
  // than one notch however hard it was thrown. Carrying 300px of overflow out
  // of an inertial fling would spend it three more times — most of the loft
  // range on a gesture that asked for one step.
  {
    const fling = wheelNotch(0, 400, 0);
    check("a 400px inertial fling is exactly one notch", fling.notch === 1, String(fling.notch));
    check("...and banks nothing toward the next one", fling.accum === 0, String(fling.accum));
  }
}

// Now the controller itself, driven through a stub canvas. This harness has no
// browser (see the chute's stylesheet check for the same admission), but
// InputController only ever asks its canvas for addEventListener and a
// bounding rect, so a stub is enough to run the REAL handlers rather than
// string-matching them — and the bug this section exists to pin (a right-click
// firing a shot) is a behaviour, not a spelling.
{
  type Handler = (e: unknown) => void;
  const onCanvas = new Map<string, Handler[]>();
  const onWindow = new Map<string, Handler[]>();
  const wheelOpts: { passive?: boolean }[] = [];
  const bind = (m: Map<string, Handler[]>, t: string, h: Handler) => {
    const a = m.get(t) ?? [];
    a.push(h);
    m.set(t, a);
  };
  const canvas = {
    addEventListener: (t: string, h: Handler, o?: { passive?: boolean }) => {
      bind(onCanvas, t, h);
      if (t === "wheel" && o) wheelOpts.push(o);
    },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ width: 800, height: 450, left: 0, top: 0 }),
    setPointerCapture: () => {},
  } as unknown as HTMLCanvasElement;

  // The globals go up for the length of this block and come straight back
  // down. systems.ts is one long-lived process and a lingering `window` would
  // flip every `typeof window` feature test in src/ for whatever runs next.
  const glob = globalThis as unknown as Record<string, unknown>;
  const prevRaf = glob.requestAnimationFrame;
  glob.window = {
    addEventListener: (t: string, h: Handler) => bind(onWindow, t, h),
    removeEventListener: () => {},
  };
  glob.requestAnimationFrame = () => 0;

  const g = new Game(makeBaseLevel(0), {}, 7);
  g.status = "playing";
  let shots = 0;
  const realShoot = g.shoot.bind(g);
  g.shoot = (now: number, auto = false) => {
    shots += 1;
    return realShoot(now, auto);
  };
  // The classic-wheel toggle, mutable so one controller can be driven through
  // both schemes — settings.wheelRotates is read live in the app for the same
  // reason.
  let wheelRotates = false;
  new InputController(canvas, () => g, undefined, () => wheelRotates);

  const send = (m: Map<string, Handler[]>, t: string, e: unknown) =>
    (m.get(t) ?? []).forEach((h) => h(e));
  let prevented = 0;
  const ptr = (button: number, pointerType = "mouse", clientX = 500, buttons = 0, clientY = 260) => ({
    button, buttons, pointerId: 1, pointerType, clientX, clientY,
    preventDefault: () => { prevented += 1; },
  });
  const whl = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({
    deltaY, deltaX: 0, deltaMode, ctrlKey, metaKey: false,
    preventDefault: () => { prevented += 1; },
  });
  /** Quarter-turns the piece made across a call, signed. */
  const turned = (fn: () => void): number => {
    const before = g.cannon.pieceRotation;
    fn();
    return Math.round((g.cannon.pieceRotation - before) / (Math.PI / 2));
  };
  const fired = (fn: () => void): number => {
    const before = shots;
    fn();
    return shots - before;
  };

  check("the wheel listener is registered non-passive, or its preventDefault is ignored",
    wheelOpts.length === 1 && wheelOpts[0].passive === false, JSON.stringify(wheelOpts));
  check("the canvas refuses the browser context menu", (() => {
    prevented = 0;
    send(onCanvas, "contextmenu", { preventDefault: () => { prevented += 1; } });
    return prevented === 1;
  })());

  // THE BUG. A right press used to run the whole targeting gesture and its
  // release used to call shoot() — the misfire gate that would have caught it
  // is deliberately off for a mouse. Asserted as "no shot" and "one ⟳"
  // separately, because a fix that stopped the shot by refusing the event
  // entirely would pass the first and lose the feature.
  check("a right-click fires nothing", fired(() => {
    send(onCanvas, "pointerdown", ptr(2));
    send(onWindow, "pointerup", ptr(2));
  }) === 0);
  check("a right-click turns the shipment clockwise instead", turned(() => {
    send(onCanvas, "pointerdown", ptr(2));
    send(onWindow, "pointerup", ptr(2));
  }) === 1);
  // The middle button is the other half of the rocker — the wheel's press,
  // freed up when the wheel's scroll became the loft dial.
  check("a middle-click fires nothing either", fired(() => {
    send(onCanvas, "pointerdown", ptr(1));
    send(onWindow, "pointerup", ptr(1));
  }) === 0);
  check("a middle-click turns the shipment anticlockwise instead", turned(() => {
    send(onCanvas, "pointerdown", ptr(1));
    send(onWindow, "pointerup", ptr(1));
  }) === -1);
  check("the left button still aims and fires", fired(() => {
    send(onCanvas, "pointerdown", ptr(0));
    send(onWindow, "pointerup", ptr(0));
  }) === 1);

  // ROTATING MID-AIM, dispatched as a BROWSER dispatches it — found in
  // review. Pointer Events fire `pointerdown` only when the FIRST button
  // takes the mouse from no-buttons to pressed; a button chorded onto a held
  // one arrives as a `pointermove` whose `button` names the changed button
  // and whose `buttons` bitmask carries its new state (bit set = press, bit
  // cleared = release — both report button 2). The first draft of this block
  // dispatched a chorded pointerdown/pointerup pair no browser emits, and
  // passed against a handler the real gesture never reached. Both halves are
  // asserted: the press turns, the release does not turn again, the held aim
  // survives, and the shot waits for the LEFT button's own release.
  {
    send(onCanvas, "pointerdown", ptr(0, "mouse", 400));
    const heldAngle = g.cannon.angle;
    const heldPower = g.cannon.power;
    let t = 0;
    const early = fired(() => { t = turned(() => {
      send(onCanvas, "pointermove", ptr(2, "mouse", 400, 3)); // right pressed: L|R held
      send(onCanvas, "pointermove", ptr(2, "mouse", 400, 1)); // right released: L held
    }); });
    check("right-clicking mid-aim turns the shipment", t === 1, `${t} quarter-turns`);
    check("...without firing the aim being held", early === 0, `${early} shots`);
    // The middle button's chord, same spec shape: `button` 1 with bit 4 set is
    // the press (L|M held = 5), the same button 1 with bit 4 cleared is the
    // release and must not turn it back a second time.
    let tm = 0;
    const mEarly = fired(() => { tm = turned(() => {
      send(onCanvas, "pointermove", ptr(1, "mouse", 400, 5)); // middle pressed: L|M held
      send(onCanvas, "pointermove", ptr(1, "mouse", 400, 1)); // middle released: L held
    }); });
    check("middle-clicking mid-aim turns it back the other way",
      tm === -1 && mEarly === 0, `${tm} quarter-turns, ${mEarly} shots`);
    // A browser that (against the spec) fires pointerdown for the chord too
    // must neither shoot nor turn the piece a second time — onDown's rotate
    // branch stands down while a drag is live, precisely so the chord has
    // exactly one owner.
    let t2 = 0;
    const nonspec = fired(() => { t2 = turned(() => {
      send(onCanvas, "pointerdown", ptr(2, "mouse", 400, 3));
      send(onWindow, "pointerup", ptr(2, "mouse", 400, 1));
    }); });
    check("...and a non-spec chorded pointerdown neither fires nor double-turns",
      nonspec === 0 && t2 === 0, `${nonspec} shots, ${t2} turns`);
    check("...and without disturbing the aim itself",
      g.cannon.angle === heldAngle && g.cannon.power === heldPower);
    const late = fired(() => send(onWindow, "pointerup", ptr(0, "mouse", 400)));
    check("...the shot still waiting for the left button's own release", late === 1);
  }

  // The wheel, through the real handler this time: the pure function above
  // proves the notch arithmetic; this proves the notch is spent on the LOFT
  // dial (Game.aimLoft) rather than on the piece, and that spending it
  // re-solves the arc through the point last clicked — the release that ended
  // the chord block above left one banked in lastTarget.
  // DIRECTION FLIPPED WITH THE DEFAULT (cannon.ts's AIM_LOFT_DEFAULT). These
  // two lines used to read "scroll UP raises the dial / into a steeper arc",
  // and they failed the moment the dial started at the top — which is the
  // whole point of asserting the default at all: a fresh bay opens on the
  // steepest arc, so the only travel the wheel has is DOWNWARD, and the notch
  // that used to be the interesting one is now the one that hits a stop.
  check("a fresh bay opens on the steepest arc, not the flattest",
    g.aimLoft === AIM_LOFT_DEFAULT && AIM_LOFT_DEFAULT === 1,
    `dial at ${g.aimLoft}`);
  check("scroll down lowers the loft dial, turns nothing, and swallows the scroll", (() => {
    prevented = 0;
    const before = g.aimLoft;
    const t = turned(() => send(onCanvas, "wheel", whl(100)));
    return t === 0 && prevented === 1 && g.aimLoft < before;
  })());
  check("...re-solving the last clicked point into a flatter arc", (() => {
    const a0 = g.cannon.angle;
    send(onCanvas, "wheel", whl(100));
    return g.aimLoft < 1 && g.cannon.angle < a0;
  })());
  check("scroll up at the dial's ceiling changes nothing but still owns the event", (() => {
    // Walk the dial back to its stop first; the range is five notches.
    for (let i = 0; i < 6; i++) send(onCanvas, "wheel", whl(-100));
    prevented = 0;
    const a0 = g.cannon.angle;
    send(onCanvas, "wheel", whl(-100));
    return g.aimLoft === 1 && prevented === 1 && g.cannon.angle === a0;
  })());
  check("ctrl+wheel is left alone, so browser zoom still works", (() => {
    prevented = 0;
    const before = g.aimLoft;
    send(onCanvas, "wheel", whl(-100, 0, true));
    return g.aimLoft === before && prevented === 0;
  })());

  // TOUCH IS UNTOUCHED, asserted rather than assumed: every guard added here
  // is gated on pointerType, and a bare button test would have quietly changed
  // the pen's path. A full-power pull still fires; a tap still misfires; and
  // nothing on this path turns the piece.
  check("a touch drag still fires, and still rotates nothing", (() => {
    let t = 0;
    const s = fired(() => { t = turned(() => {
      send(onCanvas, "pointerdown", ptr(0, "touch", 700));
      send(onCanvas, "pointermove", ptr(0, "touch", 120));
      send(onWindow, "pointerup", ptr(0, "touch", 120));
    }); });
    return s === 1 && t === 0;
  })());
  check("a touch tap is still caught by the misfire gate", fired(() => {
    send(onCanvas, "pointerdown", ptr(0, "touch", 700));
    send(onWindow, "pointerup", ptr(0, "touch", 700));
  }) === 0);

  // THE CLASSIC-WHEEL OPTION (settings.wheelRotates, the Controls toggle):
  // the wheel turns the shipment again — wheel-down clockwise, as it
  // originally shipped — and arc height moves onto the right-button chord
  // drag: hold the left button on a spot, hold right too, and pull up.
  {
    wheelRotates = true;
    check("with the option on, a wheel notch turns the shipment again", (() => {
      prevented = 0;
      const loftBefore = g.aimLoft;
      const t = turned(() => send(onCanvas, "wheel", whl(100)));
      return t === 1 && prevented === 1 && g.aimLoft === loftBefore;
    })());
    // The chord drag, dispatched the way a browser speaks it: right pressed
    // mid-aim is a pointermove (button 2, bit set), the stroke is ordinary
    // moves (button -1) with the bit still held, and the left release fires.
    {
      g.aimLoft = 0;
      send(onCanvas, "pointerdown", ptr(0, "mouse", 400));
      let t = 0;
      const early = fired(() => { t = turned(() => {
        send(onCanvas, "pointermove", ptr(2, "mouse", 400, 3));        // chord press anchors the dial
        send(onCanvas, "pointermove", ptr(-1, "mouse", 400, 3, 185));  // pull up 75px = half the range
      }); });
      check("holding right mid-aim and pulling up dials the loft, rotating nothing",
        t === 0 && early === 0 && g.aimLoft > 0.4 && g.aimLoft < 0.6,
        `${t} turns, ${early} shots, loft ${g.aimLoft.toFixed(2)}`);
      const shot = fired(() => send(onWindow, "pointerup", ptr(0, "mouse", 400, 2, 185)));
      check("...and the left release still fires the held aim", shot === 1, `${shot} shots`);
    }
    wheelRotates = false;
    g.aimLoft = 0;
  }

  // A wheel on a paused bay must leave the event completely alone — no loft
  // AND no preventDefault, because an overlay the player is reading may want
  // to scroll.
  check("a paused bay neither lofts on the wheel nor blocks the scroll", (() => {
    g.paused = true;
    prevented = 0;
    const before = g.aimLoft;
    send(onCanvas, "wheel", whl(-100));
    g.paused = false;
    return g.aimLoft === before && prevented === 0;
  })());

  delete glob.window;
  glob.requestAnimationFrame = prevRaf;
}

// ===========================================================================
// THE HOVER AIM (input.ts's onMove hover branch + onLeave).
//
// Its own harness rather than more lines on the block above, for one reason
// that matters: this one has to DRIVE THE FRAME. A hovered target is recorded
// by the move and spent by the rAF tick (input.ts's pendingTarget — the solve
// is a search over the whole cone and there is nothing to gain from running it
// for a cursor position that will never be drawn), so a stub that swallows
// requestAnimationFrame the way the block above does would prove only that
// nothing crashes. This one keeps the callback and runs it on demand, which is
// also what lets the "a bay that ended between the move and the frame" case be
// stated at all.
// ===========================================================================
{
  type Handler = (e: unknown) => void;
  const onCanvas = new Map<string, Handler[]>();
  const onWindow = new Map<string, Handler[]>();
  const bind = (m: Map<string, Handler[]>, t: string, h: Handler) => {
    const a = m.get(t) ?? [];
    a.push(h);
    m.set(t, a);
  };
  const canvas = {
    addEventListener: (t: string, h: Handler) => bind(onCanvas, t, h),
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ width: 800, height: 450, left: 0, top: 0 }),
    setPointerCapture: () => {},
  } as unknown as HTMLCanvasElement;

  const glob = globalThis as unknown as Record<string, unknown>;
  const prevRaf = glob.requestAnimationFrame;
  glob.window = {
    addEventListener: (t: string, h: Handler) => bind(onWindow, t, h),
    removeEventListener: () => {},
  };
  // The frame pump. The controller re-arms at the END of every tick, so
  // holding the newest callback and calling it is exactly one drawn frame.
  let frameCb: ((t: number) => void) | null = null;
  glob.requestAnimationFrame = (cb: (t: number) => void) => { frameCb = cb; return 0; };

  const g = new Game(makeBaseLevel(0), {}, 7);
  g.status = "playing";
  let shots = 0;
  const realShoot = g.shoot.bind(g);
  g.shoot = (now: number, auto = false) => { shots += 1; return realShoot(now, auto); };
  new InputController(canvas, () => g, undefined, () => false);
  const frame = () => { const cb = frameCb; frameCb = null; cb?.(0); };

  const send = (m: Map<string, Handler[]>, t: string, e: unknown) =>
    (m.get(t) ?? []).forEach((h) => h(e));
  const move = (clientX: number, clientY: number, pointerType = "mouse", buttons = 0) =>
    send(onCanvas, "pointermove", {
      button: -1, buttons, pointerId: 1, pointerType, clientX, clientY,
      preventDefault: () => {},
    });
  /** Where the cursor at (clientX, clientY) lands in the bay — the SAME
   *  transform the controller uses, so a pin can talk about world points
   *  without re-deriving the letterbox fit. */
  const world = (clientX: number, clientY: number) =>
    screenToWorld(800, 450, 0, 0, clientX, clientY);
  /** Closest approach of the drawn arc to a world point. The arc travels
   *  15-25px between dots, so this measures against the SEGMENTS for the same
   *  reason cannon.ts's segDistSq does. */
  const arcMissTo = (p: { x: number; y: number }): number => {
    let best = Infinity;
    for (let i = 1; i < g.trajectory.length; i++) {
      const a = g.trajectory[i - 1];
      const b = g.trajectory[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
    }
    return best;
  };
  const aim = () => ({ angle: g.cannon.angle, power: g.cannon.power });
  const same = (a: { angle: number; power: number }) =>
    g.cannon.angle === a.angle && g.cannon.power === a.power;

  // THE FEATURE. A cursor over the bay with NOTHING HELD DOWN aims the cannon
  // at the spot it is over, and the dots go through that spot — the arc is a
  // readout the player can move around the bay, not something a press has to
  // buy. Both halves asserted: the barrel moved, and it moved to the right
  // place.
  {
    const before = aim();
    move(560, 300);
    check("a hover queues an aim rather than solving it on the spot",
      same(before), "the solve belongs to the frame, not to the move");
    frame();
    const t = world(560, 300);
    check("a hover with no button held aims the cannon at the cursor",
      !same(before) && arcMissTo(t) <= AIM_HIT_TOL,
      `miss ${arcMissTo(t).toFixed(1)}px`);
    // The whole point of tracking on hover is that it costs nothing. If this
    // ever fires, the feature is a way to lose a launch by moving the mouse.
    check("...and fires nothing at all", shots === 0, `${shots} shots`);
    // g.aiming drives the HUD's aim state (main.ts swaps ⏸ for ✕ off it).
    // A hover is not a gesture in progress and must not dress the chrome as
    // though one were — there is nothing to cancel.
    check("...and leaves the HUD's aim state alone", g.aiming === false);
  }

  // Moving on keeps re-solving: the second spot answers as readily as the
  // first, which is what makes it a sweep rather than a one-shot preview.
  {
    const first = aim();
    move(300, 380);
    frame();
    const t = world(300, 380);
    check("sweeping the cursor re-solves at each new spot",
      !same(first) && arcMissTo(t) <= AIM_HIT_TOL,
      `miss ${arcMissTo(t).toFixed(1)}px`);
  }

  // OUT OF THE FIELD. The bay is 16:9 and a viewport is not, so a cursor in
  // the letterbox band maps to a world point outside the bay. A CLICK there
  // still means something (the solver clamps it to the nearest honest arc); a
  // hover there is a mouse on its way to a menu, and answering it would swing
  // the barrel at the bay's edge every time one crossed.
  {
    const held = aim();
    move(5000, 300);
    frame();
    check("a hover past the field's edge leaves the aim where it was", same(held));
    move(-400, 300);
    frame();
    check("...on the near side too", same(held));
  }

  // THE CURSOR LEAVES. The queued solve is dropped so it cannot land a frame
  // later from outside the field — and the AIM STAYS PUT, because the player
  // has gone to press a rail button and snapping the barrel back to some
  // earlier position would be motion carrying no information.
  {
    const held = aim();
    move(700, 260);
    send(onCanvas, "pointerleave", { pointerId: 1, pointerType: "mouse" });
    frame();
    check("leaving the canvas drops the queued hover instead of landing it late",
      same(held));
  }

  // NOT WHILE THE BAY IS REFUSING. A paused bay is a live field under a card,
  // and it still delivers moves to the canvas; a bay that is over, or has run
  // dry, would be drawing an arc for a shot nothing will accept.
  {
    const held = aim();
    g.paused = true;
    move(420, 240);
    frame();
    check("a paused bay does not track the cursor", same(held));
    g.paused = false;
    g.status = "won";
    move(430, 250);
    frame();
    check("...and neither does a finished one", same(held));
    g.status = "playing";
  }

  // OVERTIME, which is the case that does not look like an ending. Both the
  // clock and the launch budget END A BAY BY CONVERGENCE, not by verdict:
  // update() leaves `status` at "playing" and waits on settleDone so the
  // shipments already in the air get to land, get pressed and get paid. That
  // is many cycles, and for every one of them Game.shoot has already been
  // refusing — timeLeftMs <= 0 and launchesLeft <= 0 are the second and third
  // guards it checks. The hover predicate did not check either (found in
  // review on #126), so the arc went on following the cursor through the whole
  // of overtime, advertising a launch the bay had declined before the player
  // moved the mouse.
  //
  // Asserted as a PAIR each time — shoot refuses AND the preview stays put —
  // because the bug was precisely the two disagreeing, and a pin that only
  // watched the aim would pass just as well against a bay that had quietly
  // started accepting launches again.
  {
    const held = aim();
    // The shot counter is a record of what the CONTROLLER did; the two calls
    // below are this pin talking to the Game directly, to establish what
    // shoot() says at this moment. Put back afterwards so the click pin at the
    // end of this block still counts from the same zero.
    const attempts = shots;
    const clock = g.timeLeftMs;

    g.timeLeftMs = 0;
    // The precondition, stated rather than assumed: this is a bay that still
    // calls itself playable. If either of these ever flips, the gap this pin
    // guards has closed somewhere else and the pin is measuring nothing.
    check("overtime is still status \"playing\", and not `settling`",
      g.status === "playing" && !g.settling && !g.paused);
    check("...but the clock being out already refuses every shot",
      g.shoot(performance.now()) === false);
    move(600, 380);
    frame();
    check("...so a hover in clock overtime moves neither barrel nor arc", same(held));
    g.timeLeftMs = clock;

    // The budget's overtime, same shape. launchesLeft is derived from the
    // level's budget and the shots taken, so it is spent by giving the bay a
    // budget of one and telling it one has gone.
    const budget = g.level.launchBudget;
    const spent = g.shotsFired;
    g.level.launchBudget = 1;
    g.shotsFired = 1;
    check("a spent launch budget refuses every shot too",
      g.launchesLeft === 0 && g.shoot(performance.now()) === false);
    move(640, 400);
    frame();
    check("...and a hover in budget overtime is refused with it", same(held));
    g.level.launchBudget = budget;
    g.shotsFired = spent;
    shots = attempts;

    // ...and the bay tracks again the moment the refusal lifts, so this is a
    // gate rather than a one-way latch.
    move(680, 420);
    frame();
    check("a bay that is playable again tracks the cursor again", !same(held));
  }

  // A BAY THAT ENDS BETWEEN THE MOVE AND THE FRAME. The two are up to 16ms
  // apart, and the frame must re-ask rather than spend a cursor position that
  // outlived its bay. This is the case the pump exists to state.
  {
    const held = aim();
    move(520, 300);
    g.status = "lost";
    frame();
    check("a hover queued before the bay ended is not spent after it", same(held));
    g.status = "playing";
  }

  // AND IT DOES NOT WAIT OUT THE PAUSE. Found by these pins rather than by
  // reasoning: the frame that lands during a pause used to return without
  // touching the queue, so the cursor position recorded on the last frame
  // before the card went up was still sitting there when play resumed and
  // swung the barrel on the first frame after it — an aim made before an
  // interruption, applied after it, at a moment when the player's hand had
  // moved on. The tick drops the queue now (input.ts's tickKeys).
  {
    const held = aim();
    move(540, 320);
    g.paused = true;
    frame();
    g.paused = false;
    frame();
    check("a hover queued before a pause does not swing the barrel on resume",
      same(held));
  }

  // TOUCH HAS NO HOVER, and the guard is belt-and-braces: a finger off the
  // glass sends nothing, so this is really asserting that a pen or an
  // unknown pointer type — both of which land on touch hardware, per this
  // file's standing line — cannot pick up the mouse's scheme by accident.
  {
    const held = aim();
    move(560, 300, "touch");
    frame();
    check("a touch move with nothing held aims nothing", same(held));
    move(560, 300, "pen");
    frame();
    check("...and a hovering pen keeps the slingshot too", same(held));
  }

  // AND THE CLICK STILL FIRES, at the point clicked. Hover made the press
  // optional, not decorative: the release is still the launch, and it still
  // solves the release position rather than the last frame's.
  {
    const down = { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", clientX: 600,
      clientY: 300, preventDefault: () => {} };
    send(onCanvas, "pointerdown", down);
    send(onWindow, "pointerup", { ...down, buttons: 0 });
    check("a click still fires, after all that hovering", shots === 1, `${shots} shots`);
    const t = world(600, 300);
    check("...at the point it was clicked on", arcMissTo(t) <= AIM_HIT_TOL,
      `miss ${arcMissTo(t).toFixed(1)}px`);
  }

  delete glob.window;
  glob.requestAnimationFrame = prevRaf;
}

/* ===========================================================================
 * THE WINNABILITY HARNESS (sim/draft-space.ts, sim/deeprun.ts, sim/counters.ts)
 *
 * These pins guard three claims the findings in `design/balance/` are written
 * on, and each is a property rather than a number, because a number here would
 * only re-state what the sweep printed on the day it ran.
 *
 *  1. The enumerated notch-combo space is EXACTLY what the draft can reach.
 *     `legalHands` states the rule in closed form; `togglePick` is the rule the
 *     player actually meets. If the two ever disagree the sweep is describing a
 *     ladder nobody is dealt, which is the one failure that would make every
 *     "unwinnable" claim worthless.
 *  2. The deep-run driver walks `run.ts`'s real ladder — the refit stops, the
 *     Final Inspection rung, the capped carry — rather than a re-derivation of
 *     it, and does so deterministically.
 *  3. The proposed counter systems are bounded the way their design notes say:
 *     a cushion softens and never primes, and it never reaches "volatile is
 *     inert".
 * ========================================================================= */
section("Volatile is billed for the cargo it destroys (level.ts / lineClear.ts / game.ts)");
{
  const cube = (material: Material): Cube => ({
    body: { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } },
    material, struck: true, blinkStart: null,
  } as unknown as Cube);

  // The two halves of one rule: pay for the dead, charge for the live. Same
  // test (countsForLines), same unit (per cube), opposite sign.
  const mixed = [cube("standard"), cube("slag"), cube("volatile"), cube("slag"), cube("cryo")];
  check(
    "a blast charges for exactly the cubes that could still have made a line",
    volatileLossFor(mixed, 10) === 30, `${volatileLossFor(mixed, 10)}`,
  );
  check(
    "...and pays for exactly the ones that never could, with nothing counted twice",
    slagBountyFor(mixed, 10) === 20
      && volatileLossFor(mixed, 10) / 10 + slagBountyFor(mixed, 10) / 10 === mixed.length,
  );
  check(
    "an unstruck cryo cube is LIVE cargo and is billed as such",
    volatileLossFor([{ ...cube("cryo"), struck: false } as Cube], 10) === 10,
  );
  check(
    "a blast that caught only slag is billed nothing",
    volatileLossFor([cube("slag"), cube("slag")], 10) === 0,
  );

  /* -------------------------------------------------------------------------
   * ONE SETTLEMENT, NOT TWO. The invariant is that the bounty and the charge
   * come out of the same blast and are therefore netted BEFORE the balance
   * clamp — not applied one after the other.
   *
   * Review found the hole in the sequential version and its example is pinned
   * verbatim below: a bay at $0 takes a blast that kills one standard cube and
   * one slag cube. Charging first clamps against a balance of $0, so nothing is
   * taken; then the bounty lands in full. The near-broke player — exactly the
   * one the charge is aimed at — collects $20 of relief for free and steps
   * around the broke path the clamp exists to route them into.
   *
   * The general property is the second check: as long as the blast pays for
   * itself, the charge is paid IN FULL out of the bounty, whatever the balance.
   * ----------------------------------------------------------------------- */
  {
    const perLive = 8;
    const blast = [cube("standard"), cube("slag")];
    const broke = settleBlast(blast, 0, perLive, SLAG_BOUNTY);
    check(
      "at $0 a blast that kills live cargo is charged out of its own bounty",
      broke.charged === perLive && broke.net === SLAG_BOUNTY - perLive,
      `charged ${broke.charged} of ${broke.owed}, net ${broke.net}`,
    );
    // The clamp is not removed, only re-ordered: a blast whose bounty cannot
    // cover the charge still bottoms the bay out at $0 rather than going
    // negative, which is the rule loseCubes's spill fine follows.
    for (const funds of [0, 1, 7, 40, 300]) {
      const s = settleBlast(
        [cube("standard"), cube("standard"), cube("standard"), cube("slag")],
        funds, perLive, SLAG_BOUNTY,
      );
      check(
        `at $${funds}: the settlement never drives the balance below zero, and never forgives what the bay can pay`,
        funds + s.net >= 0 && s.charged === Math.min(funds + s.bounty, s.owed),
        `charged ${s.charged} of ${s.owed}, net ${s.net}, balance ${funds + s.net}`,
      );
    }
  }

  // The price rides the bay's own spill fine, so it ramps with the tier ladder
  // instead of being right at one tier. Volatile opens at Mark 7 (hazards.ts),
  // so that is where the band is checked.
  for (const [mark, bay] of [[7, 5], [7, 10], [10, 10]] as [number, number][]) {
    const cfg = makeBaseLevel(bay - 1, mark);
    check(
      `Tier ${mark} bay ${bay}: the charge is ${VOLATILE_LOSS_SHARE} of that bay's own spill fine`,
      cfg.volatileLoss === Math.round(penaltyPerLostPieceFor(bay - 1, mark) * VOLATILE_LOSS_SHARE)
        && cfg.volatileLoss > 0,
      `${cfg.volatileLoss} vs fine ${penaltyPerLostPieceFor(bay - 1, mark)}`,
    );
  }
  check(
    "the charge is a SHARE of the fine, never the whole of it — a detonation",
    VOLATILE_LOSS_SHARE > 0 && VOLATILE_LOSS_SHARE < 1,
    `${VOLATILE_LOSS_SHARE}`,
  );

  // A BAY WITH NO VOLATILE ON THE BELT CANNOT BE BILLED, and this is what the
  // "nothing else moved" claim rests on rather than a sample that happened not
  // to deal one. skydeck.ts's report card came back byte-identical across this
  // change, but at three seeds it never dealt the Tier-7 pair at all, so the
  // sample proves less than it looks like it does. This is the property: the
  // charge is levied by resolveVolatile, resolveVolatile is reached only by a
  // detonation, and only a volatile cube detonates.
  {
    const clean = makeBaseLevel(9, 7);
    const g = new Game(clean, {}, 1);
    for (let i = 0; i < 600; i++) g.update(i * (1000 / 60));
    check(
      "a bay with no volatile on the belt is never billed for one",
      clean.materialMix.volatile === 0 && g.volatileLosses === 0,
      `mix ${clean.materialMix.volatile}, billed ${g.volatileLosses}`,
    );
    g.destroy();
  }
  /* -------------------------------------------------------------------------
   * EVERY SURFACE THAT SELLS THE AXIS DISCLOSES THE CHARGE.
   *
   * A price the player is not told about is not a price, it is a surprise, and
   * this axis is the one where that bites hardest: a detonation VISIBLY helps
   * — the pile drops, the bay breathes — so a player shown only the blast will
   * read the notch the way the sim read it before it was billed. The guide's
   * volatile topic used to end "Aimed into a dead pile, it is a free demolition
   * charge", which was the exact wrong lesson taught in the exact right words.
   *
   * Pinned as the PROPERTY over every volatile-bearing surface rather than as
   * three string equalities, so a fourth surface — a new Final clause at some
   * later tier, a reworded draft card — inherits the requirement instead of
   * quietly opting out of it. The test is deliberately loose about wording and
   * strict about subject: the copy must say the bay is charged, in whatever
   * voice that surface speaks in.
   * ----------------------------------------------------------------------- */
  {
    const disclosesCharge = (copy: string): boolean =>
      /\b(billed|pays for|charged)\b/i.test(copy);

    const card = hazardById("volatile");
    check(
      "the volatile draft card prices the notch, not just the bang",
      !!card && disclosesCharge(card.desc), card?.desc,
    );

    // Bay 1 of the tier volatile opens at, which is where the guide reads its
    // numbers from (guide.ts's buildTopics).
    const topic = guideTopics(7).find((t) => t.id === "mat-volatile");
    check(
      "the guide's volatile topic names the charge and its per-cube price",
      !!topic
        && disclosesCharge(topic.body)
        && topic.body.includes(`$${makeBaseLevel(0, 7).volatileLoss}`),
      topic?.body,
    );
    check(
      "...and no longer sells a detonation as free demolition",
      !!topic && !/free demolition/i.test(topic.body),
    );

    // Both halves of the Tier-7 pair schedule volatile, so both are selling the
    // hazard and both owe the disclosure — the clause the player picks is often
    // the only place they read about the material at all.
    //
    // Found by APPLYING each clause and reading the belt, not by matching its
    // text: a clause that sells volatile is one whose applied config puts
    // volatile on the belt, and a rule that asked the copy whether the copy was
    // right would be no rule at all.
    //
    // SELLS it, which is narrower than "schedules" it, and the difference is
    // Odd Lots. That clause deals all six materials at once and its whole
    // pitch is the breadth — it is not a volatile clause any more than it is a
    // tar one, and demanding six materials' rules in one sentence would turn a
    // disclosure into a wall nobody reads. A clause whose ONLY addition is
    // volatile has no such excuse: it is a volatile clause, that is the one
    // thing it is about, and the charge is half of what it does.
    const volatileFinals = FINALS.filter((f) => {
      const base = makeBaseLevel(9, f.tier);
      const cfg = makeBaseLevel(9, f.tier);
      applyFinal(cfg, f.id);
      const added = (Object.keys(cfg.materialMix) as (keyof MaterialMix)[])
        .filter((m) => cfg.materialMix[m] > (base.materialMix[m] ?? 0));
      return added.length === 1 && added[0] === "volatile";
    });
    check(
      "every Final clause that SELLS volatile discloses the charge too",
      volatileFinals.length >= 2 && volatileFinals.every((f) => disclosesCharge(f.desc)),
      volatileFinals.map((f) => f.id).join(),
    );
  }

  // Volatile counts for lines, so it is not dead cargo — the rule the Skydeck
  // uses to refuse a clause outright (skydeck.ts's schedulesDeadCargo) reads
  // countsForLines and therefore cannot be moved by anything priced here.
  check(
    "re-pricing volatile does not make it dead cargo, so the Skydeck's refusal is untouched",
    MATERIAL_SPEC.volatile.countsForLines
      && !FINALS.filter((f) => f.tier === 7).some((f) => schedulesDeadCargo(f)),
  );

  /* -------------------------------------------------------------------------
   * THE DIRECTION PIN. hazards.ts's contract on the ratchet is one sentence:
   * "It is mandatory and unrewarded. […] A notch is pure cost." Volatile broke
   * it — at the belt cap a volatile bay OUT-WON a clean one (16/16 against
   * 14/16 for the adaptive pilot, 15/16 against 14/16 for the fixed-arc one)
   * because detonations thinned the pile for free.
   *
   * So this pins the DIRECTION rather than a number: at the belt cap, on
   * matched seeds and a matched rig, a volatile bay must not win more often
   * than the clean control. Worded that way on purpose — a future buff that
   * re-made volatile profitable would fail here even if it moved the win rate
   * by a different mechanism and even if every constant above still typechecked.
   *
   * AT THE CAP, and the pin says why rather than leaving it to look arbitrary.
   * One notch fires ~2.5 detonations a bay against the cap's ~19.4, so the
   * shallow end of the axis sits inside this instrument's noise floor (94%
   * against an 88% control is one seed in sixteen) and a pin there would be
   * pinning a coin flip. The cap is where the defect was measurable, so the cap
   * is where it is guarded.
   *
   * BOTH PILOT PROFILES, because the original finding carried a bot-bias
   * caveat that had to be discharged rather than repeated: `aim` always lobs,
   * so it never pays volatile's ARRIVAL cost, and the advantage might have been
   * an artifact of one bot's arc. `lob-flat` is a fixed high arc with a
   * different detonation rate entirely, and it showed the same advantage before
   * and pays the same price after — so the finding was the mechanic, not the
   * bot.
   * --------------------------------------------------------------------- */
  {
    const SEEDS = 8;
    const rig = loadoutFor(PRIORITY_ORDERS.material, 7);
    const wins = (stack: Ratchets, botName: string): number => {
      let won = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const cfg = makeBaseLevel(9, 7);
        applyUpgrades(cfg, rig);
        const flown = applyRatchets(cfg, stack);
        flown.startingFunds += CARRY_CAP;
        const out = runBay(flown, bondHands(BOTS[botName](seed)), seed);
        if (out.status === "won") won += 1;
      }
      return won;
    };
    // POOLED across the two profiles, not one check each, and that is about
    // resolving power rather than tidiness. Run against the OLD pricing the
    // per-bot checks read `demo` 8/8 against clean 6/8 — a clear failure — and
    // `lob-flat` 8/8 against 8/8, which passes. The fixed-arc pilot detonates a
    // third as often (6.5 a bay against 19.4), so its share of the defect is
    // about one seed in sixteen and a per-bot check on it would be a guard that
    // cannot see what it guards. Pooling doubles the sample, keeps both
    // profiles in the claim, and still fails loudly on the old numbers.
    const detail: string[] = [];
    let clean = 0;
    let capped = 0;
    for (const botName of ["demo", "lob-flat"]) {
      const c = wins({}, botName);
      const v = wins({ volatile: 6 }, botName);
      clean += c;
      capped += v;
      detail.push(`${botName} ${v}/${c}`);
    }
    check(
      `a belt at the volatile cap never out-wins a clean bay (Tier 7 bay 10, ${SEEDS} paired seeds x 2 pilots)`,
      capped <= clean,
      `volatile ${capped} vs clean ${clean} of ${SEEDS * 2} — ${detail.join(", ")}`,
    );
  }
}

section("The winnability sweep — the enumerated combo space (sim/draft-space.ts)");
{
  /**
   * Brute force: every hand of size `need` reachable by TAPPING, folded through
   * the real `togglePick`.
   *
   * Breadth-first over tap sequences rather than a formula, deliberately — this
   * is the independent witness, so it must not share an argument with the thing
   * it is checking. Depth 6 is well past saturation for a two-card hand at one
   * or two picks (a hand of two cards has at most three states at need 2, and
   * every one is reachable in two taps), and the check below asserts the
   * frontier actually closed rather than assuming the depth was enough.
   */
  const reachableByTapping = (
    hand: HazardDef[], need: number, forced: boolean,
  ): { hands: Set<string>; closed: boolean } => {
    const seen = new Set<string>();
    const hands = new Set<string>();
    let frontier: HazardId[][] = [[]];
    seen.add("");
    let closed = false;
    for (let d = 0; d < 6; d++) {
      const next: HazardId[][] = [];
      for (const picks of frontier) {
        for (const card of hand) {
          const after = togglePick(picks, card.id, need, forced);
          const key = after.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          if (after.length === need) hands.add([...after].sort().join(","));
          next.push(after);
        }
      }
      if (next.length === 0) { closed = true; break; }
      frontier = next;
    }
    return { hands, closed };
  };

  let mismatches = 0;
  let neverClosed = 0;
  let handsChecked = 0;
  let cappedSeen = 0;
  // Every rung of every Mark, on several seeds — the whole space the sweep can
  // ever enumerate, checked in closed form against the taps that reach it.
  for (let mark = 1; mark <= MARK_COUNT; mark++) {
    for (const seed of [1, 2, 7, 4242]) {
      for (let levelIndex = 0; levelIndex < RUN_LEVELS - 1; levelIndex++) {
        const rung = rungFor(seed, mark, levelIndex, {});
        if (!rung) continue;
        handsChecked += 1;
        const brute = reachableByTapping(rung.hand, rung.need, rung.forced);
        if (!brute.closed) neverClosed += 1;
        const mine = new Set(rung.hands.map((h) => [...h].sort().join(",")));
        if (mine.size !== brute.hands.size
          || [...mine].some((k) => !brute.hands.has(k))) mismatches += 1;
        // Did this rung actually EXERCISE the forced-hand cap? A pin that never
        // reaches the branch it is guarding is a pin that passes for the wrong
        // reason, so the run counts the branch and asserts it was reached.
        if (rung.forced && rung.need > 1
          && rung.hand.some((h) => h.kind !== "content")) cappedSeen += 1;
      }
    }
  }
  check(
    "legalHands enumerates exactly the hands togglePick can reach, at every rung of every Mark",
    mismatches === 0 && handsChecked > 0,
    `${mismatches} mismatches over ${handsChecked} rungs`,
  );
  check(
    "...and the tap search saturated rather than running out of depth",
    neverClosed === 0, `${neverClosed} rungs still expanding at depth 6`,
  );
  // The cap's own branch, constructed directly rather than waited for: the
  // shipped ladder deals a forced hand of two MATERIALS at every capstone rung
  // (materialHand), so the number-axis partner is a fence and no seed reaches
  // it. hazards.ts's togglePick note says exactly that, and says the rule is
  // kept as the invariant rather than as a patch for one layout — which is
  // precisely what has to be pinned when the live ladder cannot reach it.
  {
    const material = HAZARDS.find((h) => h.kind === "content")!;
    const number = HAZARDS.find((h) => h.kind === "number" && h.id !== "target")!;
    const synthetic = [number, material];
    const brute = reachableByTapping(synthetic, 2, true);
    const mine = new Set(legalHands(synthetic, 2, true).map((h) => [...h].sort().join(",")));
    check(
      "a forced hand's number partner may never absorb the whole quota (synthetic rung)",
      !mine.has([number.id, number.id].sort().join(",")),
      `enumerated ${[...mine].join(" | ")}`,
    );
    check(
      "...and togglePick agrees, so the enumeration is not a second opinion",
      mine.size === brute.hands.size && [...mine].every((k) => brute.hands.has(k)),
      `enum ${[...mine].join(" | ")} vs taps ${[...brute.hands].join(" | ")}`,
    );
    check(
      "...while a forced MATERIAL card may still be doubled",
      mine.has([material.id, material.id].sort().join(",")),
    );
    check(
      "the live ladder never reaches that branch — it is a fence, as hazards.ts says",
      cappedSeen === 0, `${cappedSeen} live rungs carried a number partner at 2 picks`,
    );
  }

  // The space's SIZE is a closed form, and the sweep's coverage banner quotes
  // it. Pinned as the product of the per-rung hand counts rather than as a
  // literal, so a change to picksPerBay or to the hand size fails here instead
  // of silently re-scaling every "N reachable paths" line in the docs.
  for (const mark of [1, 5, 10]) {
    const space = enumerateSpace(1, mark);
    const product = space.rungs.reduce((a, r) => a * r.hands.length, 1);
    check(
      `Mark ${mark}: the enumerated path count is the product of its rungs' hands`,
      space.paths === product,
      `${space.paths} paths vs product ${product} over ${space.rungs.length} rungs`,
    );
    check(
      `Mark ${mark}: every rung deals ${picksPerBay(mark)} pick(s) from a hand of 2`,
      space.rungs.every((r) => r.need === picksPerBay(mark) && r.hand.length === 2),
    );
    check(
      `Mark ${mark}: distinct terminal combos never outnumber the paths that reach them`,
      space.vectors.size > 0 && space.vectors.size <= space.paths,
      `${space.vectors.size} combos from ${space.paths} paths`,
    );
  }
  // The ratchet ladder is RUN_LEVELS - 2 rungs long: one draft after each
  // cleared bay except the last two — bay 10 ends the run, and the draft after
  // bay 9 is the Final Inspection (finals.ts), which deals clauses, not notches.
  check(
    "the enumerated ladder stops where the Final Inspection starts",
    enumerateSpace(1, 10).rungs.length === RUN_LEVELS - 2,
    `${enumerateSpace(1, 10).rungs.length} rungs`,
  );
}

section("The winnability sweep — the deep-run driver (sim/deeprun.ts)");
{
  // A Mark-10 run, which the sweep measures as walling early — chosen for the
  // pin precisely because it is SHORT. The claim being guarded is that the
  // driver is deterministic and walks the real ladder, and neither needs ten
  // bays of physics to state.
  // A bare ladder RunState at `mark`, for asking run.ts's run-aware schedule
  // questions the same way the driver does. `newRun` writes skydeck: null, so
  // this is a ladder run by construction — which is the point: the pins below
  // check that the driver reads the RUN rather than the bay index, and a
  // ladder run is the one where a wrong reading would still pass.
  const deepRunAt = (mark: number): RunState => newRun(1, [], 0, newTiers(), mark);
  const loadout = loadoutFor(PRIORITY_ORDERS.spatial, 10);
  const opts = {
    mark: 10, seed: 1, bot: BOTS.aim, loadout, draft: spreadPolicy,
    refit: greedyRefit(PRIORITY_ORDERS.spatial, true),
  };
  const a = runDeepRun(opts);
  const b = runDeepRun(opts);
  check(
    "two deep runs with identical inputs are identical outcomes",
    JSON.stringify(a.bays.map((x) => x.outcome)) === JSON.stringify(b.bays.map((x) => x.outcome))
      && comboKey(a.ratchets) === comboKey(b.ratchets),
    `${a.baysCleared}/${b.baysCleared} bays, ${comboKey(a.ratchets)} vs ${comboKey(b.ratchets)}`,
  );
  check(
    "a run that did not clear reports the bay it died in, and played exactly that many",
    a.cleared ? a.diedAt === null : a.diedAt === a.bays.length && a.baysCleared === a.bays.length - 1,
    `cleared ${a.cleared}, diedAt ${a.diedAt}, played ${a.bays.length}, cleared ${a.baysCleared}`,
  );
  check(
    "every notch the run banked came from a hand the draft actually dealt",
    a.bays.every((rec, i) => {
      if (rec.picks.length === 0) return true;
      const rung = rungFor(1, 10, i, rec.ratchets);
      return !!rung && rung.hands.some(
        (h) => [...h].sort().join() === [...rec.picks].sort().join(),
      );
    }),
  );
  // Asked of the RUN's own reading (run.ts's picksForRun), not of the ladder's
  // picksPerBay. The two agree on a ladder run and #124 pins that they do; what
  // this guards is that the DRIVER asks the run-aware one, so pointing it at a
  // mode that charges differently cannot silently over-charge the draft.
  check(
    "the driver takes exactly the notches the RUN charges, at every draft it reached",
    a.bays.slice(0, Math.max(0, a.bays.length - 1))
      .every((rec) => rec.picks.length === picksForRun(deepRunAt(10))),
    a.bays.map((r) => r.picks.length).join(","),
  );

  // The three couplings a per-bay sweep cannot have, asserted on a run long
  // enough to have them. A Mark-1 run reaches the first refit stop.
  const long = runDeepRun({
    mark: 1, seed: 3, bot: BOTS.aim, loadout: loadoutFor(PRIORITY_ORDERS.economy, 1),
    draft: dodgePolicy, refit: greedyRefit(PRIORITY_ORDERS.economy, true),
  });
  check(
    "the carry into every bay is the previous bay's overshoot, capped at CARRY_CAP",
    long.bays[0].carryIn === 0 && long.bays.every((rec, i) => {
      if (i === 0) return true;
      const prev = long.bays[i - 1].outcome;
      return rec.carryIn === Math.min(CARRY_CAP, Math.max(0, prev.endScore - prev.target));
    }),
    long.bays.map((r) => `${r.carryIn}`).join(","),
  );
  check(
    "scrap is only ever spent at a stop the RUN opens (run.ts's refitAfterBay)",
    long.bays.every((rec) => rec.refitSpend === 0
      || refitAfterBay(deepRunAt(1), rec.bay - 1)),
    long.bays.filter((r) => r.refitSpend > 0).map((r) => `bay${r.bay}:${r.refitSpend}`).join(" "),
  );
  check(
    "a run that reached bay 10 accepted a Final Inspection clause, and one that did not, did not",
    long.bays.length >= RUN_LEVELS ? long.final !== null : long.final === null,
    `bays ${long.bays.length}, final ${long.final}`,
  );
  // The Bond magazine is a RUN consumable, and the bug it replaced ("a free
  // 'flatten the whole field' every level is what let one fat carry-over clear
  // two bays back to back", run.ts's RunState.bondCharges) is invisible unless
  // a charge is actually spent — so the check is run on a pilot that fires
  // them, at a Mark whose loadout carries the emitter, and asserts the spend
  // happened before asserting it stuck.
  {
    const armed = runDeepRun({
      mark: 5, seed: 2, bot: (s) => bondHands(BOTS.aim(s)),
      loadout: loadoutFor(PRIORITY_ORDERS.spatial, 5), draft: spreadPolicy,
      refit: greedyRefit(PRIORITY_ORDERS.spatial, true),
    });
    const magazine = armed.bays.map((r) => r.outcome.bondsLeft);
    const issued = bondChargesFor(loadoutFor(PRIORITY_ORDERS.spatial, 5).bonds);
    check(
      "the run's Bond magazine is actually spent down by a pilot that fires it",
      issued > 0 && magazine.some((n) => n < issued),
      `issued ${issued}, left per bay ${magazine.join(",")}`,
    );
    check(
      "...and never refills across a bay boundary",
      magazine.every((n, i) => i === 0 || n <= magazine[i - 1]),
      magazine.join(","),
    );
  }
}

section("The winnability sweep — proposed counters (sim/counters.ts)");
{
  // A cushion SOFTENS. Every tier must raise the trigger threshold, never lower
  // it — a "cushion" that primed the material finer would be finals.ts's Hair
  // Trigger wearing a system's name, and the sweep would read it as the
  // proposal working.
  check(
    "every cushion tier raises the volatile trigger, and each tier raises it further",
    CUSHION_TRIGGER_MULT.every((m) => m > 1)
      && CUSHION_TRIGGER_MULT.every((m, i) => i === 0 || m > CUSHION_TRIGGER_MULT[i - 1]),
    CUSHION_TRIGGER_MULT.join(","),
  );
  // The ceiling the design note argues for: the top tier lands ON the measured
  // maximum first-contact speed (lineClear.ts's VOLATILE_TRIGGER_SPEED note
  // records the range as 17.3 to 30.8) and not past it. Past it, no impact of
  // ANY kind sets a cube off and the cushion is a delete button — which
  // hazards.ts forbids outright ("a system does not DELETE a hazard").
  check(
    "the top cushion tier reaches the measured maximum arrival speed and stops there",
    Math.abs(cushionThreshold(3) - 30.8) < 0.5,
    `threshold ${cushionThreshold(3).toFixed(1)} vs measured max 30.8`,
  );
  check(
    "the first cushion tier still leaves a full-power shot dangerous (median 25.5)",
    cushionThreshold(1) < 25.6, `threshold ${cushionThreshold(1).toFixed(1)}`,
  );
  // Applied as a multiplier on whatever is already there, so a cushion and Hair
  // Trigger compose instead of one overwriting the other.
  {
    const cfg = makeBaseLevel(9, 10);
    applyFinal(cfg, "hair-trigger");
    const primed = cfg.volatileTriggerMult;
    const plain = makeBaseLevel(9, 10);
    cushionKit(3).level!(cfg);
    cushionKit(3).level!(plain);
    check(
      "a cushion composes with Hair Trigger rather than overwriting it",
      Math.abs(cfg.volatileTriggerMult - primed * CUSHION_TRIGGER_MULT[2]) < 1e-9,
      `${primed} -> ${cfg.volatileTriggerMult}`,
    );
    check(
      "...and the clause still costs the same share of whatever rig accepted it",
      Math.abs(cfg.volatileTriggerMult / plain.volatileTriggerMult - primed) < 1e-9,
      `${(cfg.volatileTriggerMult / plain.volatileTriggerMult).toFixed(3)} vs ${primed}`,
    );
    // A FINDING, pinned so it cannot quietly stop being true. The maxed cushion
    // lifts a Hair Trigger bay to 1.19x STOCK — the clause is not merely bought
    // back, it is overshot, and a Tier-7 exam a rig can walk past is not an
    // exam. The arithmetic is unavoidable (finals.ts primes at 0.85 and the
    // cushion's own ceiling is 1.40 = the measured maximum arrival speed, so
    // any cushion that achieves its stated job clears 1/0.85 = 1.176 on the
    // way), which is why design/balance/counter-systems-proposal.md puts the
    // fix on the CLAUSE side rather than on the cushion's number.
    check(
      "KNOWN: a maxed cushion overshoots Hair Trigger — the clause needs re-sizing, not the cushion",
      cfg.volatileTriggerMult > 1,
      `net ${cfg.volatileTriggerMult.toFixed(3)}x stock`,
    );
  }
  // The thaw rig's magazine renews per BAY, which is the proposal's one real
  // disagreement with the Bond Emitter it would sit beside. A wrapper is reused
  // across the ten bays of a run, so "per bay" has to be noticed at the Game
  // boundary rather than assumed at construction.
  {
    let acts = 0;
    const stub = { name: "stub", act: () => { acts += 1; } };
    const rig = thawHands(stub, 2, "stub+thaw");
    const frozen = (): Cube => ({
      body: { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } },
      material: "cryo", struck: false, blinkStart: null,
    } as unknown as Cube);
    const bay = (cubes: Cube[]): Game => ({ cubes } as unknown as Game);
    const bay1 = bay([frozen(), frozen(), frozen()]);
    for (let i = 0; i < 5; i++) rig.act(bay1, i * 16);
    check(
      "a thaw rig spends its whole magazine and no more inside one bay",
      bay1.cubes.filter((c) => c.struck).length === 2,
      `${bay1.cubes.filter((c) => c.struck).length} thawed of 3`,
    );
    const bay2 = bay([frozen(), frozen(), frozen()]);
    for (let i = 0; i < 5; i++) rig.act(bay2, i * 16);
    check(
      "...and the magazine renews at the next bay, not at the next run",
      bay2.cubes.filter((c) => c.struck).length === 2,
      `${bay2.cubes.filter((c) => c.struck).length} thawed of 3`,
    );
    check("...while still handing every tick to the bot it wraps", acts === 10, `${acts} acts`);
  }
  // Bond hands must not spend the run's rarest consumable on an empty bay.
  {
    let acts = 0;
    let used = 0;
    const stub = { name: "stub", act: () => { acts += 1; } };
    const rig = bondHands(stub);
    const bay = (n: number, charges: number): Game => ({
      cubes: new Array(n).fill(null),
      bondCharges: charges,
      timeLeftMs: 120_000,
      level: { timeLimitSec: 144 },
      useBondBreaker: () => { used += 1; return true; },
    } as unknown as Game);
    rig.act(bay(BOND_MIN_CUBES - 1, 3), 0);
    check("bond hands hold fire on a bay below the pile floor", used === 0 && acts === 1);
    rig.act(bay(BOND_MIN_CUBES, 3), 0);
    check("...and fire once the pile is deep enough", used === 1);
    rig.act(bay(BOND_MIN_CUBES + 20, 0), 0);
    check("...and never fire a charge the run does not have", used === 1 && acts === 2);
  }

  // A SAMPLED policy must not carry its RNG stream between runs. Review found
  // it doing exactly that — draft-space.ts's POLICY SPECS note has the repro
  // and the reasoning; this is the guard.
  //
  // Stated on the POLICY rather than on a deep run, deliberately. A run-level
  // version is what was tried first and it was vacuous: the pair of runs it
  // chose both died on bay 2, so the shared stream only ever advanced one draw
  // and the buggy code and the fixed code agreed. Driving the policy directly
  // over one rung makes the carry-over visible in six draws and costs no
  // physics at all.
  {
    const spec = randomSpec(20973);
    // A capstone rung: two picks from a two-card hand is three distinct hands,
    // so six draws off one stream is a sequence, not a coin flip.
    const rung = rungFor(1, CAPSTONE_MARK, 0, {})!;
    const seq = (pol: { choose: (r: typeof rung, x: Ratchets) => HazardId[] }): string =>
      Array.from({ length: 6 }, () => pol.choose(rung, {}).join("+")).join(" ");

    check(
      "two runs at one seed draw the same sampled walk when the policy is built per run",
      seq(spec.build(4)) === seq(spec.build(4)),
      `${seq(spec.build(4))} vs ${seq(spec.build(4))}`,
    );
    {
      // The shape the bug had: ONE built policy, asked twice. Its stream
      // carries, so the second pass is a continuation rather than a repeat —
      // and this asserts that it IS, because a pin blind to the defect it
      // guards is not a pin.
      const shared = spec.build(4);
      const passA = seq(shared);
      const passB = seq(shared);
      check(
        "...and a SHARED policy continues its stream instead, which is the defect",
        passA !== passB, `${passA} then ${passB}`,
      );
      check(
        "...so the per-run build is what makes the first pass of each pair agree",
        passA === seq(spec.build(4)),
      );
    }
    // And the run-level consequence the repro reported: same seed, same
    // options, identical outcome.
    const flight = () => runDeepRun({
      mark: 5, seed: 4, bot: BOTS.aim, loadout: loadoutFor(PRIORITY_ORDERS.spatial, 5),
      draft: spec.build(4), refit: greedyRefit(PRIORITY_ORDERS.spatial, true),
    });
    const a = flight();
    const b = flight();
    check(
      "a deep run under a sampled policy reproduces on the same seed",
      comboKey(a.ratchets) === comboKey(b.ratchets)
        && a.baysCleared === b.baysCleared && a.diedAt === b.diedAt,
      `${comboKey(a.ratchets)} @${a.diedAt} vs ${comboKey(b.ratchets)} @${b.diedAt}`,
    );
  }

  // Every bay's scrap payout reaches the reported total, INCLUDING the last one
  // played. The last bay never goes through advanceRun — the run ends on it —
  // so a bay-10 win returned before the accounting its nine clears went
  // through, and every successful run under-reported by that bay's payout.
  //
  // Mark 1 seed 1 is the fixture because its last bay actually PAYS (6 of the
  // run's 146). A run whose final bay earned nothing cannot tell the fixed code
  // from the broken code, which is how the first attempt at this pin passed
  // while proving nothing.
  {
    const o = runDeepRun({
      mark: 1, seed: 1, bot: BOTS.aim, loadout: loadoutFor(PRIORITY_ORDERS.spatial, 1),
      draft: spreadPolicy, refit: greedyRefit(PRIORITY_ORDERS.spatial, true),
    });
    const paid = o.bays.map((b) => b.scrapPaid);
    const tally = paid.reduce((x, y) => x + y, 0);
    const last = paid[paid.length - 1];
    check(
      "a run reports the scrap every bay it played paid out, the last one included",
      o.scrapEarned === tally, `reported ${o.scrapEarned}, bays paid ${tally}`,
    );
    check(
      "...on a fixture whose last bay pays, so the check can see the bug it guards",
      last > 0 && o.scrapEarned - last === tally - last && tally > last,
      `paid [${paid.join(",")}], last ${last}`,
    );
    check(
      "...and only a CLEARED bay collects the per-bay clear bonus",
      o.bays.every((b, i) => (i === o.bays.length - 1 && !o.cleared
        ? b.scrapPaid === b.outcome.scrapEarned
        : b.scrapPaid === b.outcome.scrapEarned + SCRAP_PER_BAY)),
      o.bays.map((b) => `${b.outcome.scrapEarned}->${b.scrapPaid}`).join(" "),
    );
  }
}

console.log(
  failures === 0
    ? "\nAll systems checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
