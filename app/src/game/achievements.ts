import catalog from "../../../store/steam/achievements/catalog.json";
import { isSchoolContract } from "./contracts";
import { INSTALLS, markUnlocked, skydeckOpen, type MetaState } from "./meta";
import { RUN_LEVELS, tracksLadder, type RunState } from "./run";

export const ACHIEVEMENTS = catalog;
const knownIds = new Set(catalog.map((achievement) => achievement.apiName));

export function achievementIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && knownIds.has(id)))];
}

function award(meta: MetaState, ids: readonly string[]): MetaState {
  const previous = meta.achievements ?? [];
  const next = achievementIds([...previous, ...ids]);
  if (next.length === previous.length && next.every((id, i) => id === previous[i])) return meta;
  return { ...meta, achievements: next };
}

/** Only backfill facts the save proves. Seals cannot prove historic congestion or multi-clears. */
export function reconcileAchievements(meta: MetaState, discoveredTierS = false): MetaState {
  const earned: string[] = [];
  for (let tier = 1; tier <= markUnlocked(meta); tier++) earned.push(`TIER_${tier}_UNLOCKED`);
  const owned = INSTALLS.filter((system) => (meta.loadout[system.id] ?? 0) > 0).length;
  if (owned >= Math.ceil(INSTALLS.length / 2)) earned.push("SYSTEMS_HALF");
  if (owned === INSTALLS.length) earned.push("SYSTEMS_ALL");
  if (meta.claimedContracts.some((id) => !isSchoolContract(id))) earned.push("FIRST_CONTRACT");
  if (skydeckOpen(meta)) earned.push("SKYDECK_OPEN");
  if (discoveredTierS) earned.push("SECRET_TIER_S");
  return award(meta, earned);
}

/** One clear event, after the sold cubes were removed; explosions never call this. */
export function recordClearAchievements(
  meta: MetaState, lines: number, cubesRemaining: number, eligible: boolean,
): MetaState {
  if (!eligible || !Number.isInteger(lines) || lines < 1
    || !Number.isInteger(cubesRemaining) || cubesRemaining < 0) return meta;
  const earned: string[] = [];
  if (lines >= 3) earned.push("TRIPLE_CLEAR");
  if (lines >= 4) earned.push("QUAD_CLEAR");
  if (cubesRemaining === 0) earned.push("ALL_CLEAR");
  return award(meta, earned);
}

export function recordBayAchievements(
  meta: MetaState, run: RunState | null, won: boolean, fullChain: boolean,
): MetaState {
  return run && !run.sandbox && won && fullChain ? award(meta, ["FULL_CHAIN"]) : meta;
}

export function recordRunAchievements(meta: MetaState, run: RunState, won: boolean): MetaState {
  if (!won || run.sandbox || run.levelIndex !== RUN_LEVELS - 1) return meta;
  const earned: string[] = [];
  if (!tracksLadder(run)) earned.push("SKYDECK_WIN");
  if (!run.congestionSeen) earned.push("CLEAN_RUN");
  return award(meta, earned);
}
