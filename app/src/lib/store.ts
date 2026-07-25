// Small persisted settings + player-name + meta-progression store (localStorage).
import { newMeta, type MetaState } from "../game/meta";

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  /** Set once the player completes their first real drag-fire — gates the
   *  finger-drag onboarding hint's automatic first-bay appearance (see
   *  main.ts's armDragHint/dismissDragHint + ui/screens.ts's dragHintHTML). */
  seenDragHint: boolean;
}

const SETTINGS_KEY = "tetrilaunch.settings";
const NAME_KEY = "tetrilaunch.name";
const BEST_KEY = "tetrilaunch.best";
const META_KEY = "tetrilaunch.meta";

const DEFAULTS: Settings = { sound: true, music: true, haptics: true, seenDragHint: false };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadName(): string {
  return localStorage.getItem(NAME_KEY) || "";
}
export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function loadBest(): number {
  return Number(localStorage.getItem(BEST_KEY) || 0);
}
export function saveBest(score: number): void {
  if (score > loadBest()) localStorage.setItem(BEST_KEY, String(score));
}

/**
 * Meta-progression state (salvage + unlocks — see game/meta.ts). Merged over
 * newMeta() defaults on read so a save written by an older build (missing a
 * field this build added) loads with sane values instead of undefined leaking
 * into arithmetic. `unlocks` is defensively re-validated as an array of strings
 * for the same reason: it drives content gating, and a corrupt value would
 * otherwise throw inside draftOffers on the first bay clear.
 */
export function loadMeta(): MetaState {
  try {
    const raw = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    const meta = { ...newMeta(), ...raw } as MetaState;
    if (!Array.isArray(meta.unlocks)) meta.unlocks = [];
    meta.unlocks = meta.unlocks.filter((u): u is string => typeof u === "string");
    meta.salvage = Number.isFinite(meta.salvage) ? Math.max(0, Math.floor(meta.salvage)) : 0;
    meta.runs = Number.isFinite(meta.runs) ? Math.max(0, Math.floor(meta.runs)) : 0;
    meta.bestBay = Number.isFinite(meta.bestBay) ? Math.max(0, Math.floor(meta.bestBay)) : 0;
    return meta;
  } catch {
    return newMeta();
  }
}

export function saveMeta(m: MetaState): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
