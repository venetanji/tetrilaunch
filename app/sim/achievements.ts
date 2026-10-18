import {
  achievementIds, recordBayAchievements, recordClearAchievements, recordRunAchievements,
  reconcileAchievements,
} from "../src/game/achievements";
import { INSTALLS, newMeta } from "../src/game/meta";
import { advanceRun, newRun, RUN_LEVELS } from "../src/game/run";
import { schoolContract } from "../src/game/contracts";
import { skydeckRunFor } from "../src/game/skydeck";
import { stockTiers } from "../src/game/upgrades";
import { loadMeta, saveMeta } from "../src/lib/store";

type Check = (name: string, condition: boolean, detail?: string) => void;

export function checkAchievements(check: Check): void {
  const fresh = newMeta();
  const run = newRun(17, [], 0, stockTiers(), 3);
  const has = (meta: ReturnType<typeof newMeta>, id: string): boolean =>
    (meta.achievements ?? []).includes(id);

  check("achievement save input rejects unknown IDs, non-strings and duplicates",
    JSON.stringify(achievementIds(["FULL_CHAIN", "NO_SUCH_ID", null, "FULL_CHAIN"]))
      === '["FULL_CHAIN"]' && achievementIds("FULL_CHAIN").length === 0);
  const initial = reconcileAchievements(fresh);
  check("the starting tier is available from the first launch",
    JSON.stringify(initial.achievements) === '["TIER_1_UNLOCKED"]');
  check("an unchanged reconciliation preserves the state object", reconcileAchievements(initial) === initial);
  check("tier achievements reflect unlocked tiers, not runs won at those tiers",
    JSON.stringify(reconcileAchievements({ ...fresh, mark: 2 }).achievements)
      === '["TIER_1_UNLOCKED","TIER_2_UNLOCKED","TIER_3_UNLOCKED"]');
  check("an unclaimed tier does not award the next tier",
    !has(reconcileAchievements({ ...fresh, tierRunDone: true, tierContracts: 3 }), "TIER_2_UNLOCKED"));

  const triple = recordClearAchievements(fresh, 3, 1, true);
  check("three simultaneous lines award the global triple feat",
    JSON.stringify(triple.achievements) === '["TRIPLE_CLEAR"]');
  const quad = recordClearAchievements(fresh, 4, 0, true);
  check("a four-row all-clear awards the triple, quad and empty-board feats",
    has(quad, "TRIPLE_CLEAR") && has(quad, "QUAD_CLEAR") && has(quad, "ALL_CLEAR")
      && quad.achievements?.length === 3);
  const singles = [1, 1, 1, 1].reduce((m, n) => recordClearAchievements(m, n, 1, true), fresh);
  check("four separate singles never become a simultaneous multi-clear", !singles.achievements?.length);
  check("an empty board without a line sale is not an all-clear",
    recordClearAchievements(fresh, 0, 0, true) === fresh);
  check("remaining cargo blocks an all-clear", !has(triple, "ALL_CLEAR"));
  check("fractional and invalid event counts earn nothing",
    recordClearAchievements(fresh, 3.5, 0, true) === fresh
      && recordClearAchievements(fresh, 4, -1, true) === fresh);
  check("awarding an already-earned clear is idempotent",
    recordClearAchievements(quad, 4, 0, true) === quad);

  const roof = skydeckRunFor(stockTiers(), [], new Date("2026-10-18T12:00:00Z"));
  check("practice and training cannot award clear feats",
    recordClearAchievements(fresh, 4, 0, false) === fresh);
  check("practice cannot award a bay full chain",
    recordBayAchievements(fresh, { ...run, sandbox: true }, true, true) === fresh
      && recordBayAchievements(fresh, null, true, true) === fresh);
  check("Skydeck bays qualify for the global full chain",
    has(recordBayAchievements(fresh, roof, true, true), "FULL_CHAIN"));
  check("a bay in progress has not earned a full chain", recordBayAchievements(fresh, run, false, true) === fresh);
  check("a won full-chain bay earns Unbroken", has(recordBayAchievements(fresh, run, true, true), "FULL_CHAIN"));

  const final = { ...run, levelIndex: RUN_LEVELS - 1 };
  check("a completed clean ten-bay run earns the global clean-run feat",
    has(recordRunAchievements(fresh, final, true), "CLEAN_RUN"));
  check("a loss or early finish cannot earn a clean run",
    recordRunAchievements(fresh, final, false) === fresh
      && recordRunAchievements(fresh, run, true) === fresh);
  check("earlier congestion disqualifies a clean run even after a retry",
    recordRunAchievements(fresh, { ...final, restarts: 1, congestionSeen: true }, true) === fresh);
  check("retrying a clean bay does not invent congestion",
    has(recordRunAchievements(fresh, { ...final, restarts: 1 }, true), "CLEAN_RUN"));
  const nextBay = advanceRun({ ...run, congestionSeen: true }, 1000, 900, 3, 1);
  check("congestion history survives a bay boundary", nextBay.congestionSeen);
  check("a fresh run starts without congestion history", run.congestionSeen === false);
  check("sandbox completion never awards real run feats",
    recordRunAchievements(fresh, { ...final, sandbox: true }, true) === fresh);
  check("a clean Skydeck win earns both global run feats",
    JSON.stringify(recordRunAchievements(fresh, { ...roof, levelIndex: 9 }, true).achievements)
      === '["SKYDECK_WIN","CLEAN_RUN"]');

  const four = { ...fresh, loadout: { ...fresh.loadout } };
  for (const system of INSTALLS.slice(0, 4)) four.loadout[system.id] = 2;
  check("uprates count as systems, not multiple purchases", !has(reconcileAchievements(four), "SYSTEMS_HALF"));
  const five = { ...four, loadout: { ...four.loadout, [INSTALLS[4].id]: 1 }, stowed: INSTALLS.slice(0, 5).map((s) => s.id) };
  const halfway = reconcileAchievements(five);
  check("five owned systems count even when stowed", has(halfway, "SYSTEMS_HALF") && !has(halfway, "SYSTEMS_ALL"));
  const all = { ...five, loadout: { ...five.loadout } };
  for (const system of INSTALLS) all.loadout[system.id] = 1;
  check("all ten owned systems earn the complete Workshop feat", has(reconcileAchievements(all), "SYSTEMS_ALL"));
  check("achievement history survives later changes to the rig",
    has(reconcileAchievements({ ...halfway, loadout: stockTiers() }), "SYSTEMS_HALF"));
  check("retired licences cannot stand in for Workshop systems",
    !has(reconcileAchievements({ ...fresh, unlocks: ["demo", "bulk", "auto", "micro", "sturdy"] }), "SYSTEMS_HALF"));
  check("Flight School alone is not a real daily Contract",
    !has(reconcileAchievements({ ...fresh, claimedContracts: [schoolContract().id] }), "FIRST_CONTRACT"));
  check("historic real daily wins backfill First Delivery",
    has(reconcileAchievements({ ...fresh, claimedContracts: ["2026-10-18-3-0"] }), "FIRST_CONTRACT"));
  check("finishing the ladder without all seals does not open the Skydeck",
    !has(reconcileAchievements({ ...fresh, mark: 10 }), "SKYDECK_OPEN"));
  const unlockedRoof = reconcileAchievements({ ...fresh, mark: 10, sealedMarks: [1,2,3,4,5,6,7,8,9,10] });
  check("existing ladder and seals backfill the Skydeck door", has(unlockedRoof, "SKYDECK_OPEN"));
  check("historic seals do not invent unrecorded clean runs or multi-clears",
    !has(unlockedRoof, "CLEAN_RUN") && !has(unlockedRoof, "QUAD_CLEAR"));
  const secret = reconcileAchievements(fresh, true);
  check("Tier S discovery latches permanently when developer mode turns off",
    has(secret, "SECRET_TIER_S") && has(reconcileAchievements(secret, false), "SECRET_TIER_S"));

  const originalStorage = globalThis.localStorage;
  const entries = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  } as Storage;
  try {
    saveMeta(quad);
    check("earned skill feats survive a real save/load round trip", has(loadMeta(), "QUAD_CLEAR"));
    entries.set("tetrilaunch.meta", JSON.stringify({ ...fresh, achievements: [null, "FULL_CHAIN", "UNKNOWN", "FULL_CHAIN"] }));
    check("loading an old or corrupt save sanitizes achievement IDs",
      JSON.stringify(loadMeta().achievements) === '["FULL_CHAIN"]');
    entries.set("tetrilaunch.meta", JSON.stringify({ ...fresh, achievements: null }));
    check("missing achievement history migrates to an empty collection", loadMeta().achievements?.length === 0);
    saveMeta(five);
    check("normal progression saves persist backfilled achievements", has(loadMeta(), "SYSTEMS_HALF"));
    const saved = saveMeta({ ...fresh, mark: 10, sealedMarks: [1,2,3,4,5,6,7,8,9,10] });
    check("saving returns the same achievement proofs retained on disk", !!saved && has(saved, "SKYDECK_OPEN"));
    if (saved) {
      saveMeta({ ...saved, sealedMarks: [1,2,3,4,5,6,7,8,9] });
      check("reduced save evidence cannot erase an earned Skydeck achievement", has(loadMeta(), "SKYDECK_OPEN"));
    }
  } finally {
    globalThis.localStorage = originalStorage;
  }
}
