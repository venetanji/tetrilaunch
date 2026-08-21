/**
 * INPUT BINDINGS + THE ONE HINT TABLE (canvas D1/D2).
 *
 * Three input families — touch, keyboard, gamepad — and one place that knows
 * how each of them says every action. Before this module the hints were
 * hardcoded per surface, and they were WRONG per surface: the coach told
 * desktop players to "tap ⟲ / ⟳ on the right", buttons that are display:none
 * on fine pointers. A profile plus one string table fixes that class of bug
 * by construction: a hint cannot disagree with the bindings because it is
 * rendered FROM them.
 *
 * Keyboard and gamepad bindings are rebindable (the Controls screen), and
 * both persist to localStorage with the same defensive read the rest of the
 * store uses — a corrupt save falls back to defaults, never to a dead key.
 */
export type InputProfile = "touch" | "keyboard" | "gamepad";

/** Every action a key or pad button can carry. The aim/power axes are
 *  bindable on keyboard; on gamepad they live on the left stick and are
 *  deliberately not bindable — a stick is not a button. */
export type BindableAction =
  | "rotl" | "rotr" | "aimUp" | "aimDown" | "powerUp" | "powerDown"
  | "fire" | "bond" | "demo" | "auto" | "pause";

export const BINDABLE_ACTIONS: BindableAction[] = [
  "fire", "rotl", "rotr", "aimUp", "aimDown", "powerUp", "powerDown",
  "bond", "demo", "auto", "pause",
];

/** Player-facing name per action — the Controls screen's row labels. */
export const ACTION_LABELS: Record<BindableAction, string> = {
  fire: "Fire",
  rotl: "Rotate left",
  rotr: "Rotate right",
  aimUp: "Aim up",
  aimDown: "Aim down",
  powerUp: "More power",
  powerDown: "Less power",
  bond: "Bond Breaker",
  demo: "Arm demolition",
  auto: "Autoloader (hold)",
  pause: "Pause",
};

/* ---------------------------------------------------------------------------
 * Keyboard
 * ------------------------------------------------------------------------ */
const DEFAULT_KEYS: Record<BindableAction, string> = {
  fire: " ",
  rotl: "q", rotr: "e",
  aimUp: "w", aimDown: "s",
  powerUp: "d", powerDown: "a",
  bond: "b", demo: "x", auto: "f",
  pause: "escape",
};

const KEYS_KEY = "tetrilaunch.keys";

let keys: Record<BindableAction, string> = load(KEYS_KEY, DEFAULT_KEYS, (v) => typeof v === "string");

export function keyFor(action: BindableAction): string {
  return keys[action];
}

/** The action a key currently carries, or null. Lower-cased match — the same
 *  normalisation input.ts applies to KeyboardEvent.key. */
export function actionForKey(key: string): BindableAction | null {
  const k = key.toLowerCase();
  return BINDABLE_ACTIONS.find((a) => keys[a] === k) ?? null;
}

/** Bind `key` to `action`. A key can carry ONE action, so a conflict SWAPS:
 *  the action that held the key before takes this action's old key — every
 *  action stays reachable, which a silent steal would break. */
export function setKeyBinding(action: BindableAction, key: string): void {
  const k = key.toLowerCase();
  const holder = actionForKey(k);
  if (holder && holder !== action) keys[holder] = keys[action];
  keys[action] = k;
  save(KEYS_KEY, keys);
}

export function resetKeyBindings(): void {
  keys = { ...DEFAULT_KEYS };
  save(KEYS_KEY, keys);
}

/** Display form of a bound key ("Space", "Q", "↑", "Esc"). */
export function keyLabel(key: string): string {
  switch (key) {
    case " ": return "Space";
    case "escape": return "Esc";
    case "arrowup": return "↑";
    case "arrowdown": return "↓";
    case "arrowleft": return "←";
    case "arrowright": return "→";
    default: return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  }
}

/* ---------------------------------------------------------------------------
 * Gamepad (standard mapping indices)
 * ------------------------------------------------------------------------ */
const DEFAULT_PAD: Record<BindableAction, number> = {
  fire: 0,        // A / Cross
  rotl: 4,        // LB
  rotr: 5,        // RB
  aimUp: 12,      // D-pad up — the stick is primary, the D-pad nudges
  aimDown: 13,    // D-pad down
  powerUp: 15,    // D-pad right
  powerDown: 14,  // D-pad left
  bond: 2,        // X / Square
  demo: 3,        // Y / Triangle
  auto: 7,        // RT — held, like the rail button
  pause: 9,       // Start / Menu
};

const PADS_KEY = "tetrilaunch.pads";

let pads: Record<BindableAction, number> = load(
  PADS_KEY, DEFAULT_PAD, (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 32,
);

export function padFor(action: BindableAction): number {
  return pads[action];
}

export function actionForPad(button: number): BindableAction | null {
  return BINDABLE_ACTIONS.find((a) => pads[a] === button) ?? null;
}

/** Same swap rule as the keyboard: a button carries one action, conflicts
 *  trade rather than steal. */
export function setPadBinding(action: BindableAction, button: number): void {
  const holder = actionForPad(button);
  if (holder && holder !== action) pads[holder] = pads[action];
  pads[action] = button;
  save(PADS_KEY, pads);
}

export function resetPadBindings(): void {
  pads = { ...DEFAULT_PAD };
  save(PADS_KEY, pads);
}

/** Standard-mapping button names, Xbox lettering (what the Detected chip
 *  reports; PlayStation players read positions, which match). */
const PAD_NAMES = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
  "Back", "Start", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "Guide",
];

export function padLabel(button: number): string {
  return PAD_NAMES[button] ?? `B${button}`;
}

/* ---------------------------------------------------------------------------
 * D2: the ONE hint table — every player-facing instruction renders through
 * these, per profile, so a hint can never name a control the profile hides.
 * ------------------------------------------------------------------------ */
export function hintRotate(profile: InputProfile): string {
  if (profile === "touch") return "tap ⟲ / ⟳ on the right";
  if (profile === "gamepad") return `press ${padLabel(padFor("rotl"))} / ${padLabel(padFor("rotr"))}`;
  return `press ${keyLabel(keyFor("rotl"))} / ${keyLabel(keyFor("rotr"))}`;
}

export function hintAim(profile: InputProfile): string {
  if (profile === "touch") {
    return "touch the field and pull back — farther is more power — then release to fire";
  }
  if (profile === "gamepad") {
    return `aim with the left stick — deflection sets the power — and press ${padLabel(padFor("fire"))} to fire`;
  }
  return (
    `drag with the mouse, or aim with ${keyLabel(keyFor("aimUp"))}/${keyLabel(keyFor("aimDown"))} and ` +
    `power with ${keyLabel(keyFor("powerDown"))}/${keyLabel(keyFor("powerUp"))}, then ${keyLabel(keyFor("fire"))} to fire`
  );
}

export function hintAbility(action: "bond" | "demo" | "auto", profile: InputProfile): string {
  const what = action === "bond" ? "break bonds" : action === "demo" ? "arm a charge" : "hold to autofire";
  if (profile === "touch") return `tap the rail's ${action === "bond" ? "bolt" : action === "demo" ? "charge" : "loader"} to ${what}`;
  const label = profile === "gamepad" ? padLabel(padFor(action)) : keyLabel(keyFor(action));
  return `${action === "auto" ? "hold" : "press"} ${label} to ${what}`;
}

/* ---------------------------------------------------------------------------
 * Persistence plumbing
 * ------------------------------------------------------------------------ */
function load<T>(
  storageKey: string,
  defaults: Record<BindableAction, T>,
  valid: (v: unknown) => boolean,
): Record<BindableAction, T> {
  const out = { ...defaults };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "{}") as Record<string, unknown>;
    for (const a of BINDABLE_ACTIONS) {
      if (valid(raw[a])) out[a] = raw[a] as T;
    }
  } catch {
    /* defaults */
  }
  return out;
}

function save(storageKey: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
