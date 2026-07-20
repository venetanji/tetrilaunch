// Small persisted settings + player-name store (localStorage).

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  /** Show the on-canvas wind gauge (top-center meter, see render.ts's
   *  drawWindIndicator). On by default; players can hide it. */
  showWind: boolean;
  /** Set once the player completes their first real drag-fire — gates the
   *  finger-drag onboarding hint's automatic first-bay appearance (see
   *  main.ts's armDragHint/dismissDragHint + ui/screens.ts's dragHintHTML). */
  seenDragHint: boolean;
}

const SETTINGS_KEY = "tetrilaunch.settings";
const NAME_KEY = "tetrilaunch.name";
const BEST_KEY = "tetrilaunch.best";

const DEFAULTS: Settings = {
  sound: true, music: true, haptics: true, showWind: true, seenDragHint: false,
};

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
