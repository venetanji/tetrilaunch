// Small persisted settings + player-name store (localStorage).

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
}

const SETTINGS_KEY = "tetrilaunch.settings";
const NAME_KEY = "tetrilaunch.name";
const BEST_KEY = "tetrilaunch.best";

const DEFAULTS: Settings = { sound: true, music: true, haptics: true };

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
