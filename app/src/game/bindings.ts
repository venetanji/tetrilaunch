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
  | "fire" | "bond" | "demo" | "thaw" | "auto" | "pause";

export const BINDABLE_ACTIONS: BindableAction[] = [
  "fire", "rotl", "rotr", "aimUp", "aimDown", "powerUp", "powerDown",
  "bond", "demo", "thaw", "auto", "pause",
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
  thaw: "Thaw Lance",
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
  // C for cryo: the three ability keys sit B/X/C, one row of the keyboard's
  // bottom-left cluster, within reach of the same hand that holds Q/E while
  // the other aims. V was the alternative and is a worse fit — it puts a
  // fourth key on the row for a control the player uses in bursts.
  bond: "b", demo: "x", thaw: "c", auto: "f",
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
  // LT, the shoulder opposite the Autoloader's RT. NOT the face buttons'
  // remaining seat: padnav.ts reserves button 1 (B / Circle) as BACK on every
  // menu, and a default that shipped an ability on it would be a rebind the
  // player has to make before the pad is usable. A trigger is also the right
  // shape for the control — a quick pull, the same way the rail button is a
  // tap where Bond Breaker's is a hold.
  thaw: 6,        // LT
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

/* ---------------------------------------------------------------------------
 * PAD FAMILIES — the same standard-mapping INDEX, said in two vocabularies.
 *
 * The Gamepad API's standard mapping is positional: button 0 is the bottom
 * face button whatever is printed on it. Until now this module named those
 * positions in Xbox lettering and left it there, on the reasoning that "a
 * PlayStation player reads positions, which match". That is true of the FACE
 * diamond and false of everything around it — a DualSense has no button
 * labelled LB, RB, LT, RT or Start anywhere on it, so half of what the game
 * told a PlayStation player to press was a name their hardware does not use.
 *
 * So the names are a table per family now, chosen by what the browser reports
 * the connected pad to BE (padFamilyFromId), and every existing caller —
 * padLabel, the hint table below, the Controls screen's rebind rows — follows
 * the connected pad without asking. Xbox is the default and the fallback: it
 * is the lettering the standard mapping is documented in, so an unknown pad
 * gets the convention rather than a guess.
 * ------------------------------------------------------------------------ */
export type PadFamily = "xbox" | "playstation";

const PAD_NAMES: Record<PadFamily, string[]> = {
  xbox: [
    "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
    "Back", "Start", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "Guide",
  ],
  playstation: [
    "Cross", "Circle", "Square", "Triangle", "L1", "R1", "L2", "R2",
    "Create", "Options", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "PS",
  ],
};

/**
 * Which family a `Gamepad.id` belongs to, or null when nothing is connected.
 *
 * Pure and exported so sim/systems.ts can pin it against real reported ids
 * rather than against the regex's own shape. The strings are what browsers
 * actually hand back:
 *
 *   Chrome/Windows, DualSense: "DualSense Wireless Controller (STANDARD
 *     GAMEPAD Vendor: 054c Product: 0ce6)"
 *   Firefox/Linux, DualShock 4: "054c-09cc-Wireless Controller"
 *   Chrome, Xbox Series pad:   "Xbox Wireless Controller (STANDARD GAMEPAD
 *     Vendor: 045e Product: 0b13)"
 *
 * The VENDOR ID is the load-bearing half. Sony's 054c and Microsoft's 045e are
 * in every one of those strings and cannot be spelled a second way, where the
 * human-readable part can ("Wireless Controller" alone, which Firefox reports
 * for a DualShock 4, is also what several third-party Xbox pads call
 * themselves). The word tests are the fallback for drivers that report no
 * vendor at all.
 */
export function padFamilyFromId(id: string | null | undefined): PadFamily | null {
  if (!id) return null;
  const s = id.toLowerCase();
  if (/\b054c\b|dualsense|dualshock|playstation|\bps[345]\b/.test(s)) return "playstation";
  return "xbox";
}

/** The family every unqualified padLabel/padChip call speaks. main.ts writes
 *  it from the connected pad (setPadFamily); "xbox" until something says
 *  otherwise, because that is the lettering the standard mapping is defined
 *  in and the honest default for a pad nobody recognised. */
let padFamily: PadFamily = "xbox";

export function setPadFamily(f: PadFamily | null): void {
  padFamily = f ?? "xbox";
}

export function getPadFamily(): PadFamily {
  return padFamily;
}

export function padLabel(button: number, family: PadFamily = padFamily): string {
  return PAD_NAMES[family][button] ?? `B${button}`;
}

/**
 * THE RAIL'S form of a pad button — a glyph, not a word.
 *
 * The button rail's chips are ~20px wide inside a 60px control, so "Options"
 * and "Triangle" are not available to it even though they are the right words
 * on the pause card. This says what to DRAW instead, and it is a data
 * description rather than markup so that bindings.ts stays the module that
 * knows pads and ui/ stays the module that knows pixels (components.ts's
 * padChipHTML renders it; icons.ts owns the four shapes).
 *
 * The three kinds are the three vocabularies the two families actually use:
 *
 *   "face"  — Xbox's coloured letters. A/B/X/Y are the only pad buttons in
 *             either family that carry a COLOUR as part of their identity, and
 *             dropping it would throw away the fastest read on the chip.
 *   "shape" — PlayStation's four marks. They have no letters at all; a chip
 *             saying "X" for button 2 would name the Xbox button that sits in
 *             the OTHER position (2 is Square, and Xbox's X is 2 as well —
 *             the one coincidence guaranteed to mislead).
 *   "text"  — everything else, where both families use a short printed code
 *             (LB/L1, RT/R2) that is already chip-sized.
 *
 * ...plus "menu" for button 9, which is Start on one pad and Options on the
 * other and is three stacked bars on both. One glyph is the truth there.
 */
export type PadChip =
  | { kind: "face"; letter: "A" | "B" | "X" | "Y" }
  | { kind: "shape"; shape: "cross" | "circle" | "square" | "triangle" }
  | { kind: "menu" }
  | { kind: "text"; text: string };

const PS_SHAPES = ["cross", "circle", "square", "triangle"] as const;

export function padChip(button: number, family: PadFamily = padFamily): PadChip {
  if (button === 9) return { kind: "menu" };
  if (button >= 0 && button <= 3) {
    return family === "playstation"
      ? { kind: "shape", shape: PS_SHAPES[button] }
      : { kind: "face", letter: PAD_NAMES.xbox[button] as "A" | "B" | "X" | "Y" };
  }
  return { kind: "text", text: padLabel(button, family) };
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
    return `aim with the left stick — up/down for angle, left/right for power — and press ${padLabel(padFor("fire"))} to fire`;
  }
  // MOUSE AND TOUCH NOW AIM DIFFERENTLY, which is exactly the situation this
  // table exists for. The mouse points at a spot and the cannon solves the arc
  // onto it (game/input.ts); the finger still pulls back like a slingshot,
  // because a thumb covers the spot it is aiming at and because the misfire
  // gate has nothing to measure without a gesture that travels. So the touch
  // sentence above and this one describe two real, different controls rather
  // than one control worded twice — and neither can be rendered to the wrong
  // device without going through here first.
  return (
    `click where it should land, or aim with ${keyLabel(keyFor("aimUp"))}/${keyLabel(keyFor("aimDown"))} and ` +
    `power with ${keyLabel(keyFor("powerDown"))}/${keyLabel(keyFor("powerUp"))}, then ${keyLabel(keyFor("fire"))} to fire`
  );
}

/* No hintAbility here: the ability buttons and chips carry their own labels
 * (screens.ts renders the key/pad tag on the trigger itself), so no screen
 * ever asked the table for an ability sentence. One was exported anyway and
 * sat unused — the header's "every player-facing instruction renders through
 * these" is about the hints that exist, not a promise to pre-write hints
 * nothing renders. */

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
