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
  applyUpgrades, newTiers, nextTierCost, scrapInvested, MAX_TIER, TIER_COSTS, UPGRADES,
} from "../src/game/upgrades";
import { salvageForRun, UNLOCKS, unlockAvailable } from "../src/game/meta";
import {
  advanceRun, buyUpgrade, isRefitBay, levelForRun, newRun, REFIT_EVERY, RUN_LEVELS,
} from "../src/game/run";
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
    "scrapInvested totals a maxed track",
    scrapInvested({ ...newTiers(), bay: MAX_TIER }) === full,
    String(scrapInvested({ ...newTiers(), bay: MAX_TIER })),
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
