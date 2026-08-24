// Small persisted settings + player-name + meta-progression store (localStorage).
import { newMeta, refundRetiredUnlocks, type MetaState } from "../game/meta";
import { newTiers, type UpgradeTiers } from "../game/upgrades";
import { newGodRecord, type GodRecord } from "../game/god";

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
  /** Mirror the touch rail to the LEFT edge (Controls screen's touch tab) —
   *  the solver reserves its band on that side too (layout.ts setRailSide). */
  leftHandRail: boolean;
  /** Gamepad stick-aiming assist: the left stick's aim is smoothed through a
   *  short lerp so analogue jitter doesn't wobble the arc (gamepad.ts). */
  stickAssist: boolean;
}

const SETTINGS_KEY = "tetrilaunch.settings";
const NAME_KEY = "tetrilaunch.name";
const BEST_KEY = "tetrilaunch.best";
const META_KEY = "tetrilaunch.meta";

const DEFAULTS: Settings = {
  sound: true, music: true, haptics: true, seenDragHint: false, seenTutorial: false,
  leftHandRail: false, stickAssist: true,
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
    // Commission claims (game/commissions.ts's `clause@tier`). Same fail-closed
    // read: a claim can tick a tier milestone, so a corrupt entry must load as
    // "not claimed" rather than throw inside recordRunEnd's award path. Entries
    // this build doesn't recognise are LEFT IN rather than dropped — parseClaim
    // ignores them at every read site, and dropping them here would quietly
    // delete a claim belonging to a clause a later build restores.
    if (!Array.isArray(meta.commissions)) meta.commissions = [];
    meta.commissions = meta.commissions.filter((c): c is string => typeof c === "string");
    meta.salvage = Number.isFinite(meta.salvage) ? Math.max(0, Math.floor(meta.salvage)) : 0;
    meta.runs = Number.isFinite(meta.runs) ? Math.max(0, Math.floor(meta.runs)) : 0;
    meta.bestBay = Number.isFinite(meta.bestBay) ? Math.max(0, Math.floor(meta.bestBay)) : 0;
    meta.mark = Number.isFinite(meta.mark) ? Math.max(0, Math.floor(meta.mark)) : 0;
    // Tier-completion progress (see meta.ts's recordRunEnd/recordContractClear).
    // Same fail-closed reading as the lists above: corrupt progress loads as
    // "nothing done yet" rather than as a free tier.
    meta.tierRunDone = meta.tierRunDone === true;
    meta.tierContracts = Number.isFinite(meta.tierContracts)
      ? Math.max(0, Math.floor(meta.tierContracts))
      : 0;
    // God Tier standing (game/god.ts's GodRecord). Read field by field over a
    // fresh record rather than trusted wholesale: it decides how many ranked
    // attempts today still has, so a hand-edited `attempts: -5` would be an
    // unlimited daily. Every field is a non-negative integer or it isn't used.
    const rawGod = meta.god as unknown;
    const god = newGodRecord();
    if (rawGod && typeof rawGod === "object" && !Array.isArray(rawGod)) {
      for (const key of Object.keys(god) as (keyof GodRecord)[]) {
        const v = (rawGod as Record<string, unknown>)[key];
        god[key] = typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
      }
    }
    meta.god = god;
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
