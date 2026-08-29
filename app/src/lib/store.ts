// Small persisted settings + player-name + meta-progression store (localStorage).
import { BOARD_SANDBOX, type BoardId } from "./api";
import {
  newMeta, ownedTracks, refundRetiredUnlocks, SLOT_BASE, SLOT_CAP, type MetaState,
} from "../game/meta";
import { newTiers, type UpgradeId, type UpgradeTiers } from "../game/upgrades";

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  /** Set once the player completes their first real drag-fire — gates the
   *  finger-drag onboarding hint's automatic first-bay appearance (see
   *  main.ts's armDragHint/dismissDragHint + ui/screens.ts's dragHintHTML). */
  seenDragHint: boolean;
  /** Set once the interactive first-run coach is finished or skipped — gates
   *  its automatic appearance on bay 1 of a Deep Run (see main.ts's tutorial
   *  driver + ui/screens.ts's coachHTML). The How to Play screen's "Guided
   *  Tutorial" button clears it to replay the coach on demand. */
  seenTutorial: boolean;
  /** Set once a shot has been fired from the keyboard/mouse or gamepad family
   *  — the key-hint strip's own seenDragHint. It gates the strip's full-time
   *  appearance the same way seenDragHint gates the finger loop: a hint that
   *  keeps restating a control the player has demonstrably used is chrome
   *  pretending to teach, and the pause modal carries the reference table for
   *  everyone past that point (see main.ts's armKeyHints/dismissKeyHints). */
  seenKeyHints: boolean;
  /** Mirror the touch rail to the LEFT edge (Controls screen's touch tab) —
   *  the solver reserves its band on that side too (layout.ts setRailSide). */
  leftHandRail: boolean;
  /** Gamepad stick-aiming assist: the left stick's aim is smoothed through a
   *  short lerp so analogue jitter doesn't wobble the arc (gamepad.ts). */
  stickAssist: boolean;
  /** HOW the left stick aims (gamepad.ts).
   *
   *  false (default) — RATE DIALS: up/down trims the angle, left/right trims
   *  the power, and a centred stick HOLDS the aim, so the thumb rests between
   *  adjustments. Promoted to default by the owner's pad session: holding a
   *  deflection to hold an aim keeps the thumb tense for the whole bay.
   *  true — PULL BACK like a slingshot: the stick vector is the touch drag,
   *  so the barrel swings opposite the thumb. The expressive mode — one
   *  gesture carries angle and power together — kept for the players who
   *  like it, demoted for being the tiring one.
   *
   *  A NEW FIELD RATHER THAN THE OLD `stickPull`, and that rename is the whole
   *  fix for a play-test report ("the gamepad controls still reset the aim
   *  when the stick goes to the center"). `stickPull` asked a DIFFERENT
   *  QUESTION: before the rate dials existed, both of its answers were
   *  absolute vector aiming and the flag only chose WHICH WAY — false pushed
   *  the barrel toward the stick, true pulled it back like the touch drag.
   *  Promoting the dials rewrote what `false` means without touching what a
   *  save already held, so every player who had answered "I prefer pulling
   *  back" — the natural answer to the old question, and the reporter's — had
   *  that answer silently re-read as "I prefer the slingshot to the dials",
   *  and never saw the dials at all. The mode they were left on is precisely
   *  the one where letting go of the stick rewrites the aim: aimFromDrag maps
   *  deflection to power absolutely, so a spring-back through the deadzone
   *  drops a pinned 100% pull to 25% on its way past (measured, sim pin
   *  below). One question, one key: a save that answered the old one answers
   *  nothing here and lands on the new default. */
  stickSling: boolean;
  /** The MOUSE WHEEL's job (game/input.ts).
   *
   *  false (default) — the wheel is the ARC-HEIGHT dial: a click solves the
   *  arc onto the point, scrolling chooses how steeply it comes down on that
   *  same point, and rotation lives on the buttons (right ⟳, wheel press ⟲).
   *  true — the wheel ROTATES the shipment the way it originally did, and
   *  arc height moves onto a chord drag: hold the right button mid-aim and
   *  drag up/down. The owner floated both mappings in the same play session;
   *  the wheel-lofts reading won the default for being explainable in one
   *  sentence, and this keeps the other one for hands that disagree. */
  wheelRotates: boolean;
  /** Tier S is open — the sandbox floor is drawn under the tower and the mode
   *  can be entered (see lib/devmode.ts for the gesture that flips this, and
   *  for why a MODE is a setting while the developer CHEATS stay a build flag).
   *
   *  Persisted, unlike everything the sandbox screen itself holds: finding the
   *  gesture is the discovery, and making a player re-find it on every launch
   *  would turn a hidden door into a chore. Off by default, so a save written
   *  before Tier S existed opens exactly as it did. */
  devMode: boolean;
  /** Give the pointer back to the operating system (styles/cursors.css).
   *
   *  false (default) — the game draws its own four cursors on a fine pointer:
   *  a reticle over the bay, an arrow over the chrome, a hand on anything
   *  clickable and a barred disc on anything refusing.
   *  true — every one of those reverts to the plain CSS keyword, so the
   *  player's own pointer is drawn by their OS at whatever size and colour
   *  they have set it to.
   *
   *  WHY THIS IS A SETTING AND NOT A MEDIA QUERY. cursors.css already stands
   *  down for `forced-colors: active` and `prefers-contrast: more`, and those
   *  cover the players whose accessibility needs the platform bothers to
   *  announce. They are not the whole set. Windows' pointer size/colour and
   *  macOS's pointer size are standalone preferences: a player can triple
   *  their cursor and tint it yellow without turning on high contrast, and NO
   *  media query in any engine reports that they did. A 26px bitmap would
   *  silently override the one accommodation they had made, and the only
   *  honest way to detect it is to ask. Hence a switch, and hence it reverts
   *  ALL FOUR cursors rather than only the two this build added — a player
   *  who wants their own pointer wants it over the bay too.
   *
   *  Off by default: the game's cursors are the intended look, and a player
   *  who has not asked for anything gets it. */
  systemCursor: boolean;
}

const SETTINGS_KEY = "tetrilaunch.settings";
const NAME_KEY = "tetrilaunch.name";
const BEST_KEY = "tetrilaunch.best";
const META_KEY = "tetrilaunch.meta";

const DEFAULTS: Settings = {
  sound: true, music: true, haptics: true, seenDragHint: false, seenTutorial: false,
  seenKeyHints: false,
  leftHandRail: false, stickAssist: true, stickSling: false, wheelRotates: false, devMode: false,
  systemCursor: false,
};

/** Keys a save may still carry that this build no longer answers to. Dropped
 *  on load so they stop riding along in every subsequent write — a dead flag
 *  that keeps being re-saved is a trap for the next reader, who has no way to
 *  tell it from a live one. See stickSling for what retired stickPull. */
const RETIRED_SETTINGS = ["stickPull"];

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Record<string, unknown>;
    for (const k of RETIRED_SETTINGS) delete saved[k];
    return { ...DEFAULTS, ...saved };
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

/**
 * Personal best, PER BOARD.
 *
 * The Deep Run best keeps the original key untouched, so nobody's number moves
 * when this build lands. Tier S gets its own, for the same reason it gets its
 * own leaderboard: a sandbox run can be flown at Mark 10 with a maxed rig from
 * bay 9, and one such score would permanently outrank every honest run in the
 * one figure the menu prints as "Best".
 */
function bestKey(board: BoardId): string {
  // TWO keys, not eleven. Every ladder Tier collapses to one "Best" because
  // that is the one figure the menu prints, and #86's recap prints it beside a
  // tower the player can park anywhere — a Best that changed as the car moved
  // would read as the number falling. Tier S keeps its own, because a practice
  // score is not a personal best in any sense the menu means.
  //
  // OPEN: now that BOARDS are per Tier (lib/api.ts), a per-Tier best is a
  // defensible thing to want. It is a product call, not a merge one, so this
  // keeps the behaviour both #86 and #90 were built against.
  return board === BOARD_SANDBOX ? `${BEST_KEY}.sandbox` : BEST_KEY;
}

export function loadBest(board: BoardId = 1): number {
  const n = Number(localStorage.getItem(bestKey(board)) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export function saveBest(score: number, board: BoardId = 1): void {
  if (score > loadBest(board)) {
    try {
      localStorage.setItem(bestKey(board), String(score));
    } catch {
      /* ignore */
    }
  }
}

/** Lifetime bays STARTED, any mode (canvas D3): once it passes three, the
 *  finger-drag hint retires for good — the rail and the gesture are the
 *  control surface by then, and a looping finger over a veteran's bay is
 *  chrome pretending to teach. */
const BAYS_KEY = "tetrilaunch.bays";

export function loadBaysPlayed(): number {
  const n = Number(localStorage.getItem(BAYS_KEY) || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function bumpBaysPlayed(): number {
  const n = loadBaysPlayed() + 1;
  try {
    localStorage.setItem(BAYS_KEY, String(n));
  } catch {
    /* ignore */
  }
  return n;
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
    // Same defensive read as unlocks: this list decides whether a Contract pays
    // again, so a corrupt value must fail CLOSED (empty = nothing claimed yet)
    // rather than throw inside the award path on the first Contract win.
    if (!Array.isArray(meta.claimedContracts)) meta.claimedContracts = [];
    meta.claimedContracts = meta.claimedContracts.filter((c): c is string => typeof c === "string");
    // Same fail-closed reading as the two lists above: a corrupt value loads as
    // "no seals" rather than as free ones, and entries are clamped to whole
    // non-negative Marks so a hand-edited save cannot put a badge on a floor
    // that isn't there. (An out-of-range Mark is inert rather than wrong — the
    // tower asks includes() per floor it actually draws — so this clamps
    // instead of rejecting the whole list, which would punish a save written by
    // a future build with a longer ladder.)
    if (!Array.isArray(meta.sealedMarks)) meta.sealedMarks = [];
    meta.sealedMarks = meta.sealedMarks
      .filter((m): m is number => Number.isFinite(m))
      .map((m) => Math.max(0, Math.floor(m)));
    meta.salvage = Number.isFinite(meta.salvage) ? Math.max(0, Math.floor(meta.salvage)) : 0;
    meta.runs = Number.isFinite(meta.runs) ? Math.max(0, Math.floor(meta.runs)) : 0;
    meta.bestBay = Number.isFinite(meta.bestBay) ? Math.max(0, Math.floor(meta.bestBay)) : 0;
    meta.mark = Number.isFinite(meta.mark) ? Math.max(0, Math.floor(meta.mark)) : 0;
    // THE UNLOCK CEREMONY'S WATERMARK (meta.ts's celebratedMark), and the one
    // field here whose ABSENCE must not read as its default.
    //
    // Every other field above is happy to fall back to newMeta()'s value,
    // because "missing" and "zero" mean the same thing for a counter. This one
    // they do not: a save written before this build has a `mark` earned over
    // weeks and no watermark at all, and defaulting it to 0 would owe that
    // player one ceremony per tier they have ever climbed — nine rides, back to
    // back, on the first menu after an update. So the raw object is asked
    // whether the key was ever written, and a save that predates the field
    // migrates to `mark`: those floors opened long ago and were lived in.
    //
    // Clamped to `mark` from above as well, since a watermark past the ladder
    // position is a state nothing can produce and would suppress the next real
    // unlock. Fails toward "already celebrated" on a corrupt value, which loses
    // one animation rather than replaying the whole climb.
    const rawCelebrated = (raw as Record<string, unknown>).celebratedMark;
    meta.celebratedMark = typeof rawCelebrated === "number" && Number.isFinite(rawCelebrated)
      ? Math.min(meta.mark, Math.max(0, Math.floor(rawCelebrated)))
      : meta.mark;
    // THE TWO NEW WATERMARKS (meta.ts's sealBreakSeen / skydeckCelebrated), and
    // they migrate the OPPOSITE way to the one above — the note there says why
    // that difference is deliberate rather than an oversight.
    //
    // `sealBreakSeen` false on a save that predates it: the message has never
    // been shown to anyone, and a returning player who retries a bay should get
    // it exactly once, like everybody else. It costs them one panel.
    //
    // `skydeckCelebrated` false for the same reason, and it buys something: a
    // save that already holds every seal (they have been recorded since the
    // seal shipped) opens the roof the moment this build loads it, and gets the
    // ride to it on the next menu instead of finding the floor silently open.
    // A save that does NOT hold every seal gets no ceremony until it earns one,
    // which is the flag doing its job rather than a migration.
    meta.sealBreakSeen = meta.sealBreakSeen === true;
    meta.skydeckCelebrated = meta.skydeckCelebrated === true;
    // Tier-completion progress (see meta.ts's recordRunEnd/recordContractClear).
    // Same fail-closed reading as the lists above: corrupt progress loads as
    // "nothing done yet" rather than as a free tier.
    meta.tierRunDone = meta.tierRunDone === true;
    meta.tierContracts = Number.isFinite(meta.tierContracts)
      ? Math.max(0, Math.floor(meta.tierContracts))
      : 0;
    // The loadout gates how strong a rig may be, so it gets the strictest read
    // of anything here: a non-object, or any track that isn't a finite number,
    // drops the whole thing back to stock rather than being partially trusted.
    // Whether it fits the Mark's budget is checked separately at the point of
    // use (meta.ts's safeLoadout) — that rule can change between builds, and a
    // save written under the old one shouldn't be silently rewritten on load.
    const rawLoadout = meta.loadout as unknown;
    if (!rawLoadout || typeof rawLoadout !== "object" || Array.isArray(rawLoadout)) {
      meta.loadout = newTiers();
    } else {
      const tiers = newTiers();
      for (const key of Object.keys(tiers) as (keyof UpgradeTiers & string)[]) {
        const v = (rawLoadout as Record<string, unknown>)[key];
        tiers[key] = typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
      }
      meta.loadout = tiers;
    }
    /* THE RACK, and the one migration in this file that hands something out.
     *
     * `slots` is read AFTER the loadout above, because the grandfather rule is
     * a function of it. Like `celebratedMark`, the field's ABSENCE cannot be
     * allowed to read as its default: a save written before slots existed flew
     * every system it owned, and defaulting it to SLOT_BASE would confiscate
     * the fifth, sixth and seventh system a player had already paid salvage
     * for. So a save that predates the field gets a slot for every system it
     * owns — its rig is byte-identical to the one it undocked with yesterday,
     * which is the whole promise (meta.ts's SYSTEM SLOTS header, and
     * sim/systems.ts pins it as an equality against the pre-slot rig).
     *
     * It is a ONE-TIME migration and not a floor: the value is written back on
     * the next save, so buying an eighth system later does not quietly hand out
     * an eighth slot with it. A rig grandfathered at six pays SLOT_PRICES for
     * the seventh exactly like everybody else.
     *
     * `stowed` needs no migration at all, which is the point of storing the
     * SHED rather than the rack (meta.ts's field note): absent reads as empty
     * reads as "fly everything you own". It gets the same fail-closed
     * validation as every other list here — a corrupt value stows nothing,
     * which flies MORE systems rather than fewer, and the slot count is still
     * enforced at the point of use by mountedIds. */
    const rawSlots = (raw as Record<string, unknown>).slots;
    meta.slots = typeof rawSlots === "number" && Number.isFinite(rawSlots)
      ? Math.max(SLOT_BASE, Math.min(SLOT_CAP, Math.floor(rawSlots)))
      : Math.max(SLOT_BASE, Math.min(SLOT_CAP, ownedTracks(meta).length));
    if (!Array.isArray(meta.stowed)) meta.stowed = [];
    meta.stowed = meta.stowed.filter((s): s is UpgradeId =>
      typeof s === "string" && s in meta.loadout);
    // Last: hand back the salvage any RETIRED unlock took (meta.ts's note on
    // UnlockDef.retired — the mod-pool cards sold no-ops once the hazard
    // ratchet replaced the modifier draft). Pure and idempotent, so a save
    // that never rewrites itself just re-derives the same refund each load.
    return refundRetiredUnlocks(meta);
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
