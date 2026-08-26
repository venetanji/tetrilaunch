import { MATERIAL_SPEC, PIECE_COLORS, PIECE_TYPES, shipmentColor } from "../game/theme";
import type { LossReason } from "../game/game";
import { baseBayFor } from "../game/level";
import { RUN_LEVELS, SCORE_PER_BAY, SCORE_PER_LINE } from "../game/run";
import {
  toggleHTML, pieceCellsHTML, formatMMSS, beltPieceHTML, beltBombHTML, beltSealedHTML,
  runNotchTallyHTML, shipPlatesHTML, materialIconHTML, axisGlyph,
} from "./components";
import { icon, type IconName } from "./icons";
import {
  MARK_COUNT, MAX_TIER, UPGRADES, budgetForMark, nextTierCost, orderCost, orderSize, orderedTier,
  refitTracks, tiersCost, upgradeById,
  type RefitOrder, type UpgradeTiers,
} from "../game/upgrades";
import {
  UNLOCKS, unlockAvailable, unlockGates, INSTALLS, UPRATE_MAX_TIER, installAvailable,
  installGates, installById, markBudget, markUnlocked, tierMilestoneSalvage,
  tierProgressFor, uprateCost, TIER_CONTRACTS_REQUIRED,
  type InstallDef, type MetaState, type NextStepId, type TierProgress,
} from "../game/meta";
import { DAILY_COUNT } from "../game/contracts";
import {
  CHAPTERS, drillGate, topicsIn, unlockedDrills, type ChapterId, type GuideTopic,
} from "../game/guide";
import type { Settings } from "../lib/store";
import { BOARD_SANDBOX, isLadderBoard, type BoardId, type ScoreEntry } from "../lib/api";
import type { BeltPreview } from "../game/game";
import type { PieceSize, PieceType } from "../game/theme";
import {
  HAZARDS, picksPerBay, totalNotches, type HazardDef, type HazardId, type Ratchets,
} from "../game/hazards";
import type { FinalDef, FinalId } from "../game/finals";
import {
  ACTION_LABELS, BINDABLE_ACTIONS, hintAim, hintRotate, keyFor, keyLabel, padFor, padLabel,
  type BindableAction, type InputProfile,
} from "../game/bindings";
import type { PreviewRow } from "../game/preview";

/* ---------------------------------------------------------------------------
 * TIER PLATE — one component at three sizes (canvas A1/A4/C · A15's note):
 * 58x52 in the Deep Run menu button, 26px on the run-end primary, 11px in the
 * bay banner. The pixel TIER label with the mono number, always the same two
 * parts, so the ladder has ONE face wherever it shows up.
 * ------------------------------------------------------------------------ */
export function tierPlateHTML(tier: number, size: "menu" | "button" | "banner"): string {
  // The God floor wears the SAME plate, not a badge of its own — it is a floor
  // of the same tower, and the ladder having one face is the whole point of
  // this component. Only the two parts' contents change, plus a tint class.
  // Tier S joined them on the same terms when it became a floor: an "S" in the
  // number slot, which is why that slot is sized in `ch` rather than by digit.
  const god = tier === GOD_TIER;
  const sbx = tier === SANDBOX_TIER;
  const label = god ? "God tier" : sbx ? "Tier S — sandbox" : `Tier ${tier}`;
  const tint = god ? " tier-plate--god" : sbx ? " tier-plate--sbx" : "";
  return `<span class="tier-plate tier-plate--${size}${tint}" aria-label="${label}"><span class="tier-plate__lbl">${god ? "God" : "Tier"}</span><span class="tier-plate__n">${god ? "★" : sbx ? "S" : tier}</span></span>`;
}

/* ---------------------------------------------------------------------------
 * THE TWO CURRENCIES. Both used to print as the ♻ character — the same emoji
 * for scrap and for salvage, side by side on the refit chip and the workshop
 * chip and on both shops' price buttons. That is not a styling slip: the whole
 * point of the pair is that one dies with the run and the other never does, and
 * a shared glyph says the opposite. Every amount now goes through one of these
 * two, so a number cannot reach the screen without saying which pocket it comes
 * out of, and the glyph is drawn (icons.ts) rather than typed — the ♻ emoji
 * could not take the warm colour these readouts wear, and its metrics moved per
 * platform.
 *
 * inline-flex (see .currency) so the same call works in a chip, on a button
 * and mid sentence, and so the glyph can never wrap away from its number.
 * ------------------------------------------------------------------------ */
/** Salvage: banked at tier milestones, spent in the Workshop, kept forever. */
export function salvageHTML(amount: string | number = "", size = 12): string {
  return `<span class="currency">${icon("salvage", size)}${amount}</span>`;
}
/** Scrap: 2/line and 10/bay, spent at the refit yard, gone when the run ends. */
export function scrapHTML(amount: string | number = "", size = 12): string {
  return `<span class="currency">${icon("scrap", size)}${amount}</span>`;
}

/** The NEXT STEP badge (canvas A3): ONE surface ever carries it, computed by
 *  meta.ts's nextStep — this is just the chip. */
export function nextBadgeHTML(label = "Next step"): string {
  return `<span class="next-badge">${label}</span>`;
}

/** The portrait rotate guard. The markup lives here rather than inline in
 *  main.ts's boot HTML so the uifit harness renders the exact DOM the app
 *  shows — this was the one screen with zero fit coverage on any viewport.
 *  main.ts mounts it hidden and toggles `.show`; going portrait mid-bay also
 *  pauses the game (see onResize). */
export function rotateGuardHTML(): string {
  return `<div class="rotate-guard" id="rotate-guard">
    <div class="phone"></div>
    <div class="eyebrow">Rotate your device</div>
    <p class="muted">Tetrilaunch plays in landscape.</p>
  </div>`;
}

export function splashScreen(): string {
  // No tagline. "Physics Cannon Puzzle" undersold and mis-sold the game — it
  // reads as a physics sandbox, not a bay you have to bank a target out of —
  // and it was the same phrase on both screens, so it goes from both.
  return `<div class="screen neon-backdrop">
    <div class="splash">
      <h1 class="display neon-text brand-gradient">TETRILAUNCH</h1>
      <div class="loader"></div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
 * THE TIER TOWER — the home screen's elevator (the "tierlevator").
 *
 * The ladder used to be a NUMBER on a chip: "Tier 4", plus two ticks for the
 * halves that complete it. That told you where you were standing and nothing
 * else — not how far the ladder goes, not that the rungs below you are still
 * flyable, and not what any of them would be like. A shaft with a floor per
 * Mark says all three without a word of copy: the ten floors ARE the ladder,
 * the car parked on one is where you are, and the floors under it are visibly
 * still there.
 *
 * WHAT PICKING A FLOOR DOES. It sets the Mark the Deep Run flies at, and
 * nothing else. Flying a Mark you have already beaten earns no salvage and
 * cannot advance the ladder — meta.ts's recordRunEnd already gates its tier
 * bookkeeping on `runMark === markUnlocked(meta)`, and has since before this
 * screen existed, precisely so a replayed Mark cannot tick anything. So the
 * tower needed no new rule to be safe: the lower floors are practice, and the
 * top floor is the exam. What it does NOT do is let anyone fly ABOVE their
 * unlock — `open()` below is the gate, and main.ts re-checks it before
 * starting a run, because a DOM attribute is not a permission.
 *
 * FLOOR ORDER is top-down: God, 10, 9 … 1. A tower whose ground floor is not
 * at the bottom is not a tower.
 * ------------------------------------------------------------------------ */

/** The God floor's index in the shaft. Not a Mark — MARK_COUNT is the top of
 *  the real ladder — so it gets a number above every Mark and is compared by
 *  identity everywhere rather than by "> 10". */
export const GOD_TIER = MARK_COUNT + 1;

/**
 * TIER S — the sandbox, and the floor above the roof.
 *
 * NEGATIVE, and it stays negative even though the car now rides here. Every
 * other floor's id IS its rung: the number is a Mark, `towerIndexOf` turns it
 * into a shaft position, and clamping any integer lands on a real one. S is not
 * a rung — it is not part of the climb, it earns no salvage and it files to its
 * own board — so it keeps an id that can never be mistaken for a Mark and can
 * never be produced by clamping one. What changed is only where it is DRAWN.
 *
 * It used to be a plate under the base slab: a door in the basement wall, with
 * the elevator deactivated for it. That plate is gone, and the beacon on the
 * headhouse is the floor now (towerHeadHTML). Three things went wrong with the
 * basement door and the roof fixes all three.
 *
 *  - It was a SECOND control for a mode that already had one. The beacon is how
 *    Tier S is found; once found, the beacon was inert and a new button
 *    appeared somewhere else to be pressed instead. The thing you tapped to
 *    open the door was not the door.
 *  - It behaved unlike every other floor. Picking a Mark parks the car and
 *    re-quotes the Deep Run button; picking S skipped straight to another
 *    screen. One tower, two rules for tapping a thing in it.
 *  - It cost the shaft real height on the phones that had the least of it. The
 *    plate is 44px where the height exists and 26px where it does not, and on a
 *    landscape phone every pixel of it came out of the action rail beside the
 *    tower (see the note that was on .tower--sub).
 *
 * On the roof it is none of those. The lamp that opens the mode is the floor
 * the mode lives on, it is picked and parked exactly like a Mark, and it takes
 * its space from the gap ABOVE the shaft that the headhouse already occupied —
 * so the eleven floors below it keep every pixel of the 44px arithmetic.
 */
export const SANDBOX_TIER = -1;

/** How many floors the shaft holds: the Marks, plus God on the roof. Tier S is
 *  deliberately NOT counted — it is drawn above the shaft's own box, in the
 *  headhouse, and takes no height from the floors (see SANDBOX_TIER). */
export const TOWER_FLOORS = MARK_COUNT + 1;

export interface TowerState {
  /** The highest Mark the player may fly (meta.ts's markUnlocked). */
  unlocked: number;
  /** The floor the car is parked on — a Mark, GOD_TIER, or SANDBOX_TIER once
   *  the beacon has been found. */
  selected: number;
  /** Whether the God floor is open (the whole ladder beaten). */
  god: boolean;
  /** Whether Tier S is a floor at all (lib/store.ts's Settings.devMode, set by
   *  the beacon gesture — see lib/devmode.ts). Absent reads as off, so every
   *  caller that predates the mode renders the tower it always did. */
  sandbox?: boolean;
  /** Marks cleared in one run with no bay restart (meta.ts's sealedMarks).
   *  Absent reads as none, so every caller that predates the seal — and there
   *  are two, menuScreen's fallback tower and every uifit fixture — renders
   *  the tower it always did. */
  sealed?: number[];
  /** First-clear Contracts logged on the CURRENT tier (`unlocked`), 0-based
   *  count out of TIER_CONTRACTS_REQUIRED — meta.ts's tierProgressFor. The
   *  floors' windows read it: see floorHTML's note. Absent reads as 0, which
   *  is the honest dark for a caller with no meta to ask. */
  contracts?: number;
}

/** True when `tier` is a floor the CAR may ride to. The one gate; main.ts
 *  calls it again before a run starts.
 *
 *  Tier S now answers this question like any other floor — it is open exactly
 *  when the mode is. It used to be false here unconditionally, back when it was
 *  a basement door the elevator did not serve; the door is gone and the roof is
 *  a floor, so the two questions that used to be separate are one again. */
export function tierOpen(state: TowerState, tier: number): boolean {
  if (tier === SANDBOX_TIER) return sandboxOpen(state);
  return tier === GOD_TIER ? state.god : tier >= 1 && tier <= state.unlocked;
}

/** True when the Tier S door is there to be opened. */
export function sandboxOpen(state: TowerState): boolean {
  return state.sandbox === true;
}

/** Where a floor sits in the shaft, counting from the roof — the car's whole
 *  position is this one number (app.css does the arithmetic from --tower-idx),
 *  so the travel animation is a single custom property to write.
 *
 *  MINUS ONE for Tier S — above God, which is 0. The CAR never uses it: the
 *  lift does not serve the roof, and tierTowerHTML parks it at the top of the
 *  shaft and switches it off instead. What does use it is everything that needs
 *  the roof ORDERED against the ladder: towerTravelMs (how long the trip takes)
 *  and the plate roll's direction, both of which have to know that S is above
 *  Mark 10 and not, as its raw id would suggest, below Mark 1. */
export function towerIndexOf(tier: number): number {
  if (tier === SANDBOX_TIER) return -1;
  return tier === GOD_TIER ? 0 : MARK_COUNT - tier + 1;
}

/**
 * How long the car takes to reach `to` from `from`, in ms.
 *
 * Distance-scaled rather than flat, because a flat duration makes a one-floor
 * nudge feel sluggish and a nine-floor climb feel teleported — the whole point
 * of drawing a shaft is that the ladder has a LENGTH, and the only way the car
 * can express it is by taking longer over more of it. Capped so that even the
 * full run of the tower stays under the ~1.2s where a menu animation stops
 * reading as feedback and starts reading as a wait.
 */
export function towerTravelMs(from: number, to: number): number {
  return Math.min(1100, 260 + Math.abs(towerIndexOf(to) - towerIndexOf(from)) * 95);
}

function floorHTML(state: TowerState, tier: number): string {
  const open = tierOpen(state, tier);
  const god = tier === GOD_TIER;
  const sel = tier === state.selected;
  const cls = ["tower__floor"];
  if (god) cls.push("tower__floor--god");
  if (sel) cls.push("is-selected");
  if (!open) cls.push("is-locked");
  // The three squares are WINDOWS, and they are LIGHTS now, not decoration:
  // one per first-clear Contract the tier asks for (TIER_CONTRACTS_REQUIRED),
  // dark until that clear lands. A beaten floor burns all three — a tier
  // cannot be beaten without its Contracts (meta.ts's advanceTier), so the
  // building lights up floor by floor as the player climbs. The current
  // floor shows the tier's live count (TowerState.contracts), floors above
  // are dark, and God's burn only once the whole ladder has (it has no
  // Contracts of its own to count). They used to sit at a uniform half-lit
  // opacity, which read as "on" for floors the player had not touched — the
  // owner's pass caught it — and a dark socket still does the old job: a
  // dark building is a building.
  const lit = god
    ? (state.god ? TIER_CONTRACTS_REQUIRED : 0)
    : tier < state.unlocked
      ? TIER_CONTRACTS_REQUIRED
      : tier === state.unlocked
        ? Math.min(TIER_CONTRACTS_REQUIRED, Math.max(0, state.contracts ?? 0))
        : 0;
  const windows = `<span class="tower__windows">${
    Array.from({ length: TIER_CONTRACTS_REQUIRED }, (_, i) => `<i${i < lit ? ' class="on"' : ""}></i>`).join("")
  }</span>`;
  const label = god ? "God tier" : `Tier ${tier}`;
  // The current floor's windows are live information, so its accessible name
  // carries the same count — the other floors' lights are implied by
  // locked/open, which the label already states.
  const contractsNote = !god && tier === state.unlocked
    ? ` — Contracts ${lit}/${TIER_CONTRACTS_REQUIRED}`
    : "";
  // THE SEAL — a Mark that fell in one unbroken run (meta.ts's sealedMarks).
  // A SHAPE stamped on the plate, never a tint: the palette is full at 13
  // swatches and sim/systems.ts fails the build below dE00 10, so there is no
  // hue left to spend — and a distinction carried by hue alone is invisible to
  // a red-green viewer anyway. It has to survive a greyscale screenshot.
  // app.css draws it.
  //
  // Never on the God floor. God is not a Mark, meta.ts records no seal for it,
  // and a stamp there would be a state nothing can ever produce.
  //
  // It joins the floor's accessible NAME as well, because the shape itself is
  // aria-hidden: a distinction a screen reader has no way to reach is a
  // distinction half the audience does not get.
  const isSealed = !god && (state.sealed ?? []).includes(tier);
  const seal = isSealed ? `<span class="tower__seal" aria-hidden="true"></span>` : "";
  return `<button class="${cls.join(" ")}" type="button" data-action="pick-tier" data-tier="${tier}"`
    + ` aria-pressed="${sel}"${open ? "" : ' aria-disabled="true"'}`
    + ` aria-label="${label}${open ? "" : " — locked"}${isSealed ? " — sealed" : ""}${contractsNote}">`
    + `<span class="tower__gap" aria-hidden="true"></span>`
    + `<span class="tower__n">${god ? "GOD" : tier}</span>`
    + windows
    + seal
    + `</button>`;
}

/**
 * The headhouse and its beacon — the lock, and then the floor it unlocks.
 *
 * The motor room every real lift has on its roof, and it does two jobs in
 * sequence, never both at once.
 *
 * CLOSED, it is the lock. Nine taps on the beacon (lib/devmode.ts) open Tier S:
 * a thing nobody does by accident and anybody can be told in one sentence. In
 * this state it is deliberately OUT of the accessibility tree and out of the
 * tab order — an assistive-technology user tabbing the home screen should not
 * meet an unlabelled control whose only honest label would give the secret
 * away, and a keyboard user has no way to perform a nine-tap gesture anyway.
 *
 * OPEN, it is Tier S's selection: same `pick-tier` action and same `data-tier`
 * every rung in the shaft carries, so one tap picks it exactly as a tap on Mark
 * 7 picks that. It joins the a11y tree at that point, with a real label, and the
 * taps stop counting, because the streak has nothing left to open.
 *
 * IT LOOKS THE SAME IN BOTH STATES, and that is the point rather than an economy
 * of effort. The mode is a secret — nine taps is the whole design of finding it
 * — so the roof does not grow a plate, a letter or a highlight once it opens.
 * Anyone who has not performed the gesture is looking at a lamp on a roof, which
 * is what it was before and what it stays. What changes is the LAMP, and only
 * when the mode is selected: it blinks bigger and brighter, and the building
 * below it goes dark (see .tower--off). The one visible difference is a state
 * you can only reach by having already found it.
 *
 * ONE-WAY. Nine taps SET the mode; they do not toggle it. A gesture whose
 * meaning inverts once performed is a trap — the tap that opens the door is the
 * tap that closes it, and after the door becomes a floor those taps are
 * selections, so a tenth through eighteenth tap would have silently torn the
 * floor out from under the car. Turning it back off is Settings' job, where the
 * control has a label saying what it does.
 */
function towerHeadHTML(state: TowerState): string {
  const open = sandboxOpen(state);
  const lamps = `<i></i><b></b><i></i>`;
  if (!open) {
    return `<button class="tower__head" type="button" data-action="tower-beacon"
      aria-hidden="true" tabindex="-1">${lamps}</button>`;
  }
  const sel = state.selected === SANDBOX_TIER;
  return `<button class="tower__head tower__head--floor${sel ? " is-selected" : ""}" type="button"
    data-action="pick-tier" data-tier="${SANDBOX_TIER}" aria-pressed="${sel}"
    aria-label="Tier S — sandbox. Any Mark, any bay, any Contract. Scores are kept on a separate board."
    >${lamps}</button>`;
}

export function tierTowerHTML(state: TowerState): string {
  // Roof first, ground floor last.
  const floors: string[] = [];
  for (let t = GOD_TIER; t >= 1; t--) floors.push(floorHTML(state, t));
  // THE LIFT DOES NOT SERVE THE ROOF. Picking Tier S shuts the building down:
  // the car goes dark where it stands and the beacon takes over, blinking
  // bigger and brighter. It is not a floor the elevator reaches, and animating
  // a car up into the motor room would say it is — the tower is the LADDER, and
  // the one selection that is not a rung of it should read as the ladder
  // switching off rather than as an eleventh stop on it.
  //
  // So the car's index is never SANDBOX_TIER's. It parks at the top of the
  // shaft and powers down, which is also the honest answer to "where is the car
  // when the building is off": wherever it last was, and on a first render that
  // is as far up as it goes.
  const off = state.selected === SANDBOX_TIER;
  const idx = towerIndexOf(off ? GOD_TIER : state.selected);
  return `<div class="tower${off ? " tower--off" : ""}" role="group" aria-label="Tier tower — pick the Mark to fly">
    <div class="tower__shaft" style="--tower-idx:${idx}">
      ${towerHeadHTML(state)}
      <div class="tower__rail" aria-hidden="true"></div>
      <div class="tower__car" aria-hidden="true"><span></span></div>
      ${floors.join("")}
    </div>
    <div class="tower__base" aria-hidden="true"></div>
  </div>`;
}

/* ---------------------------------------------------------------------------
 * BASE BAY PANEL — what the selected floor is actually like to fly.
 *
 * Four numbers and a belt. All five come from the game's own tables
 * (level.ts's baseBayFor, hazards.ts's HAZARDS) rather than from copy, so the
 * panel cannot promise a bay the ladder does not deal — this is the surface a
 * balance pass is most likely to silently invalidate, and deriving is the only
 * defence that survives one.
 *
 * They are the STOCK bays: no loadout, no ratchets, no carry. That is the only
 * honest quote from a menu where none of those are chosen yet.
 * ------------------------------------------------------------------------ */
function statCellHTML(name: IconName, label: string, value: string, tint: string): string {
  return `<div class="bay-stat">${icon(name, 14)}<span class="bay-stat__txt">`
    + `<span class="bay-stat__lbl">${label}</span>`
    + `<span class="bay-stat__val" style="--stat-tint:${tint}">${value}</span>`
    + `</span></div>`;
}

/** The six material axes in ladder order, lit once the selected Mark deals
 *  them. Not a static list: it is hazards.ts's own content axes, so a material
 *  added or re-gated there shows up here with no edit. */
function beltLadderHTML(mark: number, unknown = false): string {
  const content = HAZARDS.filter((h) => h.kind === "content" && h.material);
  const glyphs = content
    .map((h) => {
      // Tier S lights the whole belt rather than withholding it. The four stat
      // tiles take a "?" because a number has a "?" the same height as itself;
      // a material glyph does not, and a row of question marks where the icons
      // go is TALLER than the icons — the panel visibly changed height as the
      // car reached the roof. Every material is reachable from Tier S anyway
      // (the belt selector offers all six and a parade of all six at once), so
      // "all of them" is not a placeholder here, it is the honest answer.
      const live = unknown || h.mark <= mark;
      const title = live
        ? `${h.name} — dealt from Tier ${h.mark}`
        : `${h.name} — unlocks at Tier ${h.mark}`;
      return `<span class="bay-belt__mat${live ? "" : " is-dark"}" title="${title}"`
        + ` role="img" aria-label="${title}">${materialIconHTML(h.material!, 13)}</span>`;
    })
    .join("");
  const live = content.filter((h) => h.mark <= mark).length;
  // picksPerBay is the capstone's OTHER rung: Mark 10 adds no new material and
  // asks for two ratchets a bay instead, which is the thing that makes the top
  // floor different from the ninth. It belongs beside the material count
  // because between them they are the whole of "what does this Mark deal".
  const picks = picksPerBay(mark);
  return `<div class="bay-belt">
    <span class="bay-belt__lbl">Belt</span>
    <span class="bay-belt__mats">${glyphs}</span>
    <span class="bay-belt__count">${
      unknown
        ? "set on launch"
        : `${live}/${content.length}${picks > 1 ? ` · ${picks} picks` : ""}`
    }</span>
  </div>`;
}

/**
 * The panel with nothing to say — Tier S parked.
 *
 * Every number on this panel is a QUOTE: it is what the ladder will deal on the
 * floor the car is parked on, derived from the same tables the bay is built
 * from so it cannot promise a bay that will not arrive. Tier S deals nothing
 * until the level-select screen has been through: the Mark, the bay, the rig,
 * the belt and the axes are all still unchosen, and there are ten Marks' worth
 * of answers behind that button.
 *
 * So the panel does not guess, and it does not go blank either. It prints the
 * one honest answer — not known yet — in the shape the four numbers already
 * occupy, so the column does not resize when the tower switches over and the
 * player can see it is the same readout with the values withheld. The glyphs
 * jitter because a static "?" reads as a value that failed to load; a moving
 * one reads as a machine that has not been told yet.
 *
 * THE BELT IS THE EXCEPTION, and it is a layout fact rather than a preference:
 * a "?" is the height of the number it replaces, but it is TALLER than a 13px
 * material glyph, so a row of six of them grew the panel and the whole column
 * wobbled as the selection changed. The belt lights all six instead — which is
 * also true, since Tier S can deal any material and a parade of all of them.
 */
function unknownBayPanelHTML(best: number, extras: string): string {
  const cell = (name: IconName, label: string, tint: string): string =>
    statCellHTML(name, label, `<span class="bay-stat__q">?</span>`, tint);
  return `<div class="panel base-bay base-bay--unknown" aria-label="Tier S — set on the level select">
    <div class="base-bay__head">
      <div class="base-bay__best">Best ${best || "—"}</div>
    </div>
    <div class="base-bay__grid">
      ${cell("reactor", "Target", "var(--accent)")}
      ${cell("launcher", "Launch", "var(--warn)")}
      ${cell("clock", "Clock", "var(--text)")}
      ${cell("bonds", "Bonds", "var(--piece-t)")}
    </div>
    ${beltLadderHTML(MARK_COUNT, true)}
    <div class="base-bay__extras">${extras}</div>
  </div>`;
}

export function baseBayPanelHTML(opts: {
  /** The floor the panel is describing — a Mark, GOD_TIER, or SANDBOX_TIER. */
  tier: number;
  best: number;
  /** The entitlement chips, if this build has any. */
  extras?: string;
}): string {
  // Tier S quotes nothing, because nothing is chosen yet — see above.
  if (opts.tier === SANDBOX_TIER) return unknownBayPanelHTML(opts.best, opts.extras ?? "");
  const god = opts.tier === GOD_TIER;
  // God flies the top of the ladder, so it reads off MARK_COUNT's bays — the
  // floor is a different CONTRACT, not a different bay table.
  const mark = god ? MARK_COUNT : Math.max(1, Math.min(MARK_COUNT, opts.tier));
  const bay = baseBayFor(mark);
  const bonds = `×${bay.bondMult.toFixed(1)}${bay.unbreakableCapstone ? " ∞" : ""}`;
  // No "Tier N \u00b7 Base bay" line any more. It named the floor the car is
  // parked on, one column away from the tower that is showing exactly that,
  // and directly above a Deep Run button whose plate says it a third time.
  // Best is what survives: the one number on this panel that appears nowhere
  // else on the screen.
  return `<div class="panel base-bay" aria-label="Selected tier \u2014 base bay">
    <div class="base-bay__head">
      <div class="base-bay__best">Best ${opts.best}</div>
    </div>
    <div class="base-bay__grid">
      ${statCellHTML("reactor", "Target", `$${bay.targetFrom}→${bay.targetTo}`, "var(--accent)")}
      ${statCellHTML("launcher", "Launch", `$${bay.launchCost} · $${bay.startingFunds}`, "var(--warn)")}
      ${statCellHTML("clock", "Clock", `${formatMMSS(bay.timeLimitSec * 1000)} · ${bay.bays} bays`, "var(--text)")}
      ${statCellHTML("bonds", "Bonds", bonds, "var(--piece-t)")}
    </div>
    ${beltLadderHTML(mark)}
    <div class="base-bay__extras">${opts.extras ?? ""}</div>
  </div>`;
}

/** `store` is absent on web and on native builds without a RevenueCat key —
 *  the store entry point hides itself rather than offering a dead button.
 *  `guide` carries the first-session system (canvas A2/A3): which action
 *  holds the ONE NEXT STEP badge, the live numbers the subtitles state the
 *  offer in, and whether the Guided Tutorial entry is still owed.
 *
 *  THREE COLUMNS now, not two. The middle one is the tier tower (see
 *  tierTowerHTML), and the brand column's chip strip is gone with it — the
 *  strip's three readouts have each moved to where they are actually used:
 *  Tier IS the tower, Best is the base-bay panel's header, and Salvage was
 *  already printed on the Workshop button's subtitle in the same breath as
 *  what it can buy, so the chip was the second, context-free copy of it.
 *  The three columns are three KINDS of thing: the SHELF (the demo panel,
 *  which is the tutorial's door, over the entries nobody opens the game to
 *  reach), the LADDER, and the LOOP (the recap of the parked floor, then the
 *  three things you can launch into). The entitlement entry is a shelf row —
 *  the demo taking How to Play's job is what freed it one. Tier S is not a row
 *  anywhere: it is the tower's top floor, and the primary button flies whatever
 *  floor the car is parked on. */
export function menuScreen(
  best: number,
  salvage = 0,
  store?: StoreState,
  progress?: TierProgress,
  guide?: {
    step: NextStepId;
    install: { name: string; cost: number } | null;
    firstLaunch: boolean;
  },
  /** Which floor the car is parked on and which floors are open. Absent only
   *  where `progress` is (a caller with no meta state at all), and the screen
   *  then falls back to a one-floor tower at Tier 1 rather than to no tower —
   *  the shaft is the menu's centre column, and a hole there is worse than a
   *  ground floor. */
  tower?: TowerState,
): string {
  const twr: TowerState = tower ?? {
    unlocked: progress?.tier ?? 1,
    selected: progress?.tier ?? 1,
    god: false,
    contracts: progress?.contracts ?? 0,
  };
  // The Deep Run flies the SELECTED floor, so everything on that button reads
  // off `selected` rather than off the unlocked Mark. main.ts rewrites both
  // parts in place while the car is travelling (it must not re-render the
  // menu — that would tear down the attract demo mid-animation), which is why
  // they carry ids rather than being found by shape.
  const sel = twr.selected;
  const godSel = sel === GOD_TIER;
  const sbxSel = sel === SANDBOX_TIER;
  // NOTHING rides the recap's footnote row any more, and it took both of these
  // branches to empty it. #86 moved the entitlement entries onto the demo
  // panel, which the demo taking How to Play's job had just freed a row on.
  // #90 then deleted the sandbox chip, because a second entry to one screen on
  // one screen is how a menu stops feeling owned — and the entry that survived
  // has since become the tower's top floor rather than a plate under it. The
  // panel keeps its optional `extras` slot for the next thing that genuinely
  // has nowhere else to go.
  return `<div class="screen neon-backdrop">
    <div class="menu split">
      <div class="menu__brand">
        <!-- The demo (game/attract.ts drives the canvas), the wordmark sitting
             in it, and the paragraph both replaced.

             The title lives INSIDE the demo box on purpose: the panel is a
             live bay with no HUD over it, so its top-left corner is the one
             place a real screenshot would have chrome and the mini-field
             doesn't. Split across two lines there because the wordmark is
             sharing the frame with the play area rather than owning a headline
             of its own — the SPANS only stack while the demo is live (see
             app.css), so the reduced-motion fallback still reads as one word.

             The copy under it stays in the DOM either way: main.ts adds the
             is-live class only once the demo is actually running, and while it
             is, the paragraph is the canvas's text alternative — a screen
             reader still gets the description, and anyone on reduced motion
             (or without a 2D context) gets it on screen. -->
        <div class="menu__demo">
          <canvas class="menu__demo-canvas" aria-hidden="true"></canvas>
          <h1 class="menu__title display neon-text brand-gradient" aria-label="Tetrilaunch"><span>TETRI</span><span>LAUNCH</span></h1>
          <p class="menu__sub">Load the cannon, arc your tetrominoes across the bay, and feed
          full rows into the compactor before it sweeps them away — across a 10-bay gauntlet
          where every cleared bay ratchets one difficulty axis of your choosing.</p>
          <!-- THE PANEL IS THE DOOR. A bay playing itself, with no HUD over
               it, is already a demonstration of how the game works — so it is
               the tutorial's entry rather than a decoration sitting beside
               one. That gives the lesson the largest, most obvious target on
               the screen AND gives the shelf below its row back, which is
               where the entitlement entry now lives as a real button.

               A transparent hit layer rather than a <button> wrapped around
               the whole panel: the wordmark inside is an <h1>, which is not
               phrasing content and cannot legally live in a button, and the
               canvas has to stay out of the accessible name. The corner tag is
               the visible affordance and rides inside the hit layer, so the
               two can never drift apart. -->
          <button class="menu__demo-hit" data-action="${guide?.firstLaunch ? "tutorial" : "howto"}"
            aria-label="${guide?.firstLaunch ? "Guided tutorial — learn the cannon in one bay" : "How to play"}">
            <span class="menu__demo-tag">${icon("howto", 11)}Tutorial</span>
            ${guide?.firstLaunch ? nextBadgeHTML("Start here") : ""}
          </button>
        </div>
        <!-- The SHELF: everything a player does not open the game to reach.
             How to Play used to head it and is now the demo panel above, which
             is what freed the row the entitlement entry takes — a full-size
             button in the column, rather than the 23px footnote it started as
             or the band across the artwork that replaced it. -->
        <div class="menu__nav">
          ${
            store?.unlimited ? unlimitedBadgeHTML()
            : store?.available ? unlockChipHTML()
            : ""
          }
          <button class="btn btn--secondary btn--block" data-action="leaderboard">${icon("leaderboard")}Leaderboard</button>
          <button class="btn btn--ghost btn--block" data-action="settings">${icon("settings")}Settings</button>
        </div>
      </div>
      ${tierTowerHTML(twr)}
      <div class="menu__actions">
        <!-- The recap sits ON the column it describes. It answers "what is
             this floor like to fly", and the button that flies it is the next
             thing under it — across the screen from it (where it started) the
             player had to hold four numbers in their head while their eye
             travelled past the whole tower to reach the button they qualify. -->
        ${baseBayPanelHTML({ tier: sel, best })}
        <!-- Plain-language subtitles under the thematic names (playtest
             feedback: "Deep Run", "Contracts" and "Workshop" mean nothing to
             a new player until each is explained). The subtitles state the
             offer in LIVE numbers (A3), the Deep Run button carries the tier
             plate (A1 — the plate takes the icon slot), and exactly one
             button ever wears the NEXT STEP badge (meta.ts's nextStep). -->
        <!-- ONE button, two faces. With Tier S parked it says Sandbox and opens
             the level select; on every other floor it says Deep Run and flies
             it. Not a second button that appears beside this one: the column is
             three rows in every build and at every entitlement state (see
             below), and the whole point of putting S in the tower is that the
             floor you park on is what the primary action does. main.ts rewrites
             the label in place while the car travels, so both faces carry ids
             rather than being found by shape. -->
        <button class="btn btn--primary btn--lg btn--block btn--menu${sbxSel ? " btn--sbx" : ""}${guide?.step === "run" && !sbxSel ? " btn--next" : ""}" data-action="play" id="menu-play">${
          tierPlateHTML(sel, "menu")
        }<span class="btn__txt"><span id="menu-play-ttl">${sbxSel ? "Sandbox" : "Deep Run"}</span><span class="btn__sub" id="menu-play-sub">${
          sbxSel
            ? "Any Mark, bay or Contract · own board"
            : godSel
              ? "All ten marks at once · no mercy"
              : `Clear ${RUN_LEVELS} bays in one run`
        }</span></span>${guide?.step === "run" && !sbxSel ? nextBadgeHTML() : ""}</button>
        <button class="btn btn--secondary btn--block btn--menu${guide?.step === "contracts" ? " btn--next" : ""}" data-action="contracts">${icon("contracts")}<span class="btn__txt"><span class="btn__ttl">Contracts${
          // THE TIER'S CONTRACT PIPS, on the button that leads to them. They
          // replaced the run-end "Tier N progress" banner: a sentence about
          // finishing Contracts on a screen the player wants to leave was
          // never read, where an unfilled pip flickering on this button is
          // the same fact at the moment the player can act on it.
          progress
            ? `<span class="tier-pips${progress.contracts < progress.needed ? " tier-pips--live" : ""}" role="img" aria-label="Tier ${progress.tier} Contracts: ${progress.contracts} of ${progress.needed} cleared">${
                Array.from({ length: progress.needed }, (_, i) =>
                  `<span class="tier-pip${i < progress.contracts ? " tier-pip--done" : ""}"></span>`).join("")
              }</span>`
            : ""
        }</span><span class="btn__sub">${
          // Numbers lead (A3): at compact the sub is one ellipsized line, so
          // the live figures must sit before the prose that can afford to go.
          progress
            ? `${DAILY_COUNT} today · ${salvageHTML(progress.milestone, 10)} each · no clock, no launch cost`
            : "Short challenges · retry freely"
        }</span></span>${guide?.step === "contracts" ? nextBadgeHTML() : ""}</button>
        <button class="btn btn--secondary btn--block btn--menu${guide?.step === "workshop" ? " btn--next" : ""}" data-action="workshop">${icon("workshop")}<span class="btn__txt">Workshop<span class="btn__sub">${
          guide
            ? guide.install
              ? salvage >= guide.install.cost
                ? `${salvageHTML(salvage, 10)} — ${guide.install.name} costs ${salvageHTML(guide.install.cost, 10)}`
                : `${salvageHTML(salvage, 10)} — Contracts pay salvage`
              : `${salvageHTML(salvage, 10)} banked`
            : "Spend Salvage on permanent unlocks"
        }</span></span>${guide?.step === "workshop" ? nextBadgeHTML() : ""}</button>
        <!-- Three, and never a fourth. This column is the recap plus the loop
             it describes, and the recap is not compressible: it holds four
             readouts and the belt. No extra entry is a button here — the
             Unlimited upsell is a shelf row in the brand column, and Tier S is
             a plate under the tower (#90) — which is what keeps this column
             the same three rows in every build and at every entitlement
             state. -->
      </div>
    </div>
    <div class="build-tag" aria-hidden="true">${
      // Vite's `define` (vite.config.ts) statically replaces the
      // import.meta.env.VITE_BUILD_ID reference below with the build's short
      // SHA. Outside a Vite build — sim/systems.ts imports this module
      // straight through tsx — import.meta.env does not exist at all, so the
      // typeof guard is load-bearing, not defensive noise.
      // ...and ?? "dev" a second time inside the guard: the uifit harness
      // DOES define import.meta.env (vite-node) without defining
      // VITE_BUILD_ID, and the footer printed the string "undefined" in
      // every menu screenshot it took.
      typeof import.meta.env !== "undefined" ? ((import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev") : "dev"
    }</div>
  </div>`;
}

/** Store/entitlement state passed down from the RevenueCat layer. */
export interface StoreState {
  /** SDK configured — i.e. native build with a key. */
  available: boolean;
  /** The `unlimited` entitlement is active. */
  unlimited: boolean;
}

function unlimitedBadgeHTML(): string {
  return `<div class="btn btn--block menu__entitlement" role="status">${icon("star", 13)}Unlimited</div>`;
}

/** The pre-purchase counterpart to the badge above, in the same shelf row.
 *  A full-size `.btn` and the only thing on the menu that pulses: it is an
 *  offer rather than a control anyone came looking for, so it has to do the
 *  finding. It has been three things — a 23px footnote inside the tier recap,
 *  a band across the demo artwork, and this — and only this one treats a
 *  purchase entry the way the rest of the screen treats a control. */
function unlockChipHTML(): string {
  return `<button class="btn btn--block menu__unlock" data-action="paywall">${icon("star", 13)}Unlock Unlimited</button>`;
}

/* #89 re-added a sandboxChipHTML here; #90 had deleted it. #90 wins: Tier S
 * has a door of its own under the tower now, and a second entry to one screen
 * on one screen is how a menu stops feeling owned. */

/* ---------------------------------------------------------------------------
 * HOW TO PLAY — the guide (game/guide.ts) as a master/detail screen.
 *
 * WHAT WAS WRONG WITH THE OLD ONE, precisely, because it is the whole reason
 * this is shaped the way it is.
 *
 * It was nine literal cards in a horizontal snap row, and on every device in
 * the matrix each card CLIPPED ITS OWN COPY. On the 640x360 budget phone card
 * 01 lost everything after "distance sets the" — mid-sentence, mid-word on some
 * rows — because `.step` carried `overflow: hidden` against a fixed-height row.
 * Nothing in CI saw it: `textclip` skips any element with child elements, and
 * every card's paragraph has a `<b>` in it. So the screen that teaches the game
 * shipped for months with its sentences cut in half, and the harness was green.
 *
 * The layout answer is the same one the Workshop and the Controls screen
 * already reached: a landscape phone has WIDTH and no height, so the axis that
 * carries a list is the vertical one INSIDE a column, not the horizontal one
 * across the screen. An index column that scrolls, a detail pane that does not.
 * A player reads one topic at a time and picks the next one deliberately, which
 * is what an index is for and what a snap row of nine cards actively fights.
 *
 * Three rules hold this together, and each of them is asserted rather than
 * hoped for:
 *
 *  - THE INDEX SCROLLS AND NOTHING ELSE DOES. `#guide-list` is on sim/uifit's
 *    scroller allowlist, on the same grounds as the Workshop's shelf: it is an
 *    unbounded list by definition — 41 topics today, more with every material.
 *  - THE DETAIL PANE DOES NOT. `.guide__body` keeps `overflow-y: auto` as a
 *    backstop so a long topic degrades to a scroll instead of a hard clip, and
 *    is deliberately NOT allowlisted, so needing it FAILS CI. That is exactly
 *    the stance `.coach__body` takes, for exactly the reason above: copy is
 *    written to the pane, and a pane that quietly swallows the tail is how the
 *    old screen got away with it.
 *  - EVERY ROW IS A TAP TARGET. The index is the only route to two thirds of
 *    the content, so its rows carry the 44px floor like the Workshop's tabs do.
 *
 * The screen is otherwise a pure function of (chapter, topic, save): main.ts
 * holds the two ids and re-renders. No local state, so a drill that returns
 * here comes back to the row it was launched from.
 * ------------------------------------------------------------------------ */

/** Art for the topics where a picture says it faster than the sentence does —
 *  and only those. A decorative tile on every row would cost the detail pane
 *  the height its copy is written to. */
function topicArtHTML(t: GuideTopic): string {
  const tile = (inner: string, label?: string): string =>
    `<span class="guide__tile">${inner}${label ? `<span class="guide__tile-lbl">${label}</span>` : ""}</span>`;
  if (t.material) {
    // The mark, then the SAME SHAPE twice — plain, then in this material. Same
    // shape on purpose: two different pieces side by side make the piece colour
    // the loudest difference in the picture, and the piece colour is the one
    // thing that is not the lesson. Held constant, the only thing that changes
    // between the two tiles is the material, which is the comparison the player
    // has to make on the belt at a glance.
    return `<div class="guide__art">
      ${tile(materialIconHTML(t.material, 24))}
      ${tile(pieceCellsHTML("T"), "Plain")}
      ${tile(pieceCellsHTML("T", 1, 0, "std", t.material), MATERIAL_SPEC[t.material].name)}
    </div>`;
  }
  if (t.id === "sizes") {
    return `<div class="guide__art">
      ${tile(pieceCellsHTML("O", 1, 0, "tiny"), "Micro")}
      ${tile(pieceCellsHTML("T", 1, 0, "std"), "Standard")}
      ${tile(pieceCellsHTML("T", 1, 0, "bulk"), "Bulk")}
    </div>`;
  }
  if (t.id === "rotate") {
    return `<div class="guide__art">${PIECE_TYPES.map(
      (p) => tile(pieceCellsHTML(p as PieceType)),
    ).join("")}</div>`;
  }
  return "";
}

/** The row's right-hand marker: what this topic OFFERS, in one glance down the
 *  column — a bay you can play, a bay you have not earned yet, or nothing. */
function topicMarkHTML(t: GuideTopic, tier: number): string {
  if (t.cta) return `<span class="guide__mark guide__mark--drill">▸</span>`;
  if (!t.drill) return "";
  return t.tier <= tier
    ? `<span class="guide__mark guide__mark--drill">▸</span>`
    : `<span class="guide__mark guide__mark--locked">T${t.tier}</span>`;
}

export function guideScreen(opts: {
  chapter: ChapterId;
  /** Selected topic. Callers that cannot know one (a fresh open) pass the
   *  chapter's first topic; this never invents a selection, so the pane and
   *  the highlighted row can never disagree. */
  topicId: string;
  /** The save, for the tier every drill gate is measured against. */
  meta: MetaState;
}): string {
  const tier = markUnlocked(opts.meta);
  // Priced for the tier being flown, not for Tier 1: since #88 the target, the
  // clock and the launch cost are all the Mark's knobs, so a catalogue built
  // once at module load told a Tier 10 player their launches cost $20.
  const topics = topicsIn(opts.chapter, tier);
  const topic = topics.find((t) => t.id === opts.topicId) ?? topics[0];

  const tabs = CHAPTERS.map((c) => {
    const n = unlockedDrills(c.id, opts.meta);
    return `<button class="workshop__tab${c.id === opts.chapter ? " workshop__tab--on" : ""}" role="tab" data-action="guide-chapter" data-chapter="${c.id}" aria-selected="${c.id === opts.chapter}">${c.name}${n ? `<b>${n}</b>` : ""}</button>`;
  }).join("");

  const rows = topics
    .map(
      (t) => `<button class="guide__row${t.id === topic.id ? " guide__row--on" : ""}" data-action="guide-topic" data-topic="${t.id}" aria-current="${t.id === topic.id}">
        <span class="guide__row-name">${t.name}</span>
        ${topicMarkHTML(t, tier)}
      </button>`,
    )
    .join("");

  // The pane's foot. Three states, and the locked one NAMES ITS TIER rather
  // than hiding: a row that says "Tier 6" is a roadmap, a row that is simply
  // absent is a surprise — the same argument the Workshop's gated cards make.
  let foot = "";
  if (topic.cta) {
    foot = `<button class="guide__drill" data-action="${topic.cta.action}">
      <span class="guide__drill-txt">
        <span class="guide__drill-kind">Start here</span>
        <span class="guide__drill-brief">${topic.cta.note}</span>
      </span>
      <span class="guide__drill-go">${topic.cta.label}</span>
    </button>`;
  } else if (topic.drill && topic.tier <= tier) {
    foot = `<button class="guide__drill" data-action="drill" data-topic="${topic.id}">
      <span class="guide__drill-txt">
        <span class="guide__drill-kind">Drill · ${topic.drill.name}</span>
        <span class="guide__drill-brief">${topic.drill.brief}</span>
      </span>
      <span class="guide__drill-go">${icon("play", 12)}Run</span>
    </button>`;
  } else if (topic.drill) {
    foot = `<div class="guide__drill guide__drill--locked">
      <span class="guide__drill-txt">
        <span class="guide__drill-kind">Drill · ${topic.drill.name}</span>
        <span class="guide__drill-brief">${topic.drill.brief}</span>
      </span>
      <span class="guide__drill-go">${drillGate(topic)}</span>
    </div>`;
  }

  return `<div class="screen neon-backdrop">
    <div class="guide">
      <div class="guide__hdr">
        <div class="guide__title">
          <div class="eyebrow">Briefing</div>
          <h2 class="display">How to Play</h2>
        </div>
        <button class="btn btn--primary guide__play" data-action="play">${icon("play")}Start Run</button>
        <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="workshop__tabs guide__tabs" role="tablist">${tabs}</div>
      <div class="guide__cols">
        <div class="guide__list" id="guide-list" role="tablist" data-scroll>${rows}</div>
        <div class="guide__pane" role="tabpanel">
          <div class="guide__pane-hdr">
            <h3 class="guide__topic">${topic.name}</h3>
            ${topic.tier > 1 ? `<span class="guide__tier">Tier ${topic.tier}</span>` : ""}
          </div>
          <div class="guide__body">${topic.body}${topicArtHTML(topic)}</div>
          ${foot}
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Two columns, not one.
 *
 * Stacked, this needed 344px with no store rows and 404px with them, against
 * the 322px a landscape phone actually offers — so it scrolled, and the store
 * buttons sat below the fold exactly where Apple requires Restore to be
 * findable. Splitting toggles from actions puts the tallest column near 210px
 * and removes the scroll rather than making it more pleasant.
 */
export function settingsScreen(
  s: Settings,
  store?: StoreState,
  /** Whether haptics can do anything on this platform (lib/platform's
   *  hapticsSupported). iOS Safari and the iOS PWA have no
   *  navigator.vibrate, so the toggle there was a switch wired to nothing —
   *  it hides instead. Defaults on so headless callers keep the full panel. */
  hapticsAvailable = true,
): string {
  return `<div class="screen neon-backdrop center">
    <div class="panel modal modal--settings pop">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 class="display" style="font-size:var(--fs-h1)">Settings</h2>
        <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="split settings__cols">
        <div class="settings__toggles">
          ${toggleHTML("sound", "Sound FX", "Launch, impact & line-clear cues", s.sound)}
          ${toggleHTML("music", "Music", "Ambient synth soundtrack", s.music)}
          ${hapticsAvailable ? toggleHTML("haptics", "Haptics", "Vibration feedback on mobile", s.haptics) : ""}
          ${
            // Only once the door has been found. Rendering it off would put the
            // secret on the one screen everybody opens, and rendering nothing
            // at all would leave the only way OUT of the mode behind the same
            // nine taps that opened it — a door with no handle on the inside.
            s.devMode
              ? toggleHTML("devMode", "Tier S", "The sandbox floor under the tower · separate board", true)
              : ""
          }
        </div>
        <div class="settings__actions">
          <button class="btn btn--secondary btn--block" data-action="controls">Controls</button>
          ${store?.available ? purchaseRowsHTML(store) : ""}
          <button class="btn btn--secondary btn--block" data-action="menu">Done</button>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * CONTROLS (canvas D1) — Settings → Controls: three input families on the
 * Workshop's tab pattern, every binding a row, keyboard and gamepad
 * rebindable with a live press-a-key capture state (main.ts drives the
 * capture; this only renders it). Bindings are read live from
 * game/bindings.ts — the same table the hints render from (D2), so a row
 * here and a hint in the coach can never disagree.
 */
export type ControlsTab = "touch" | "keyboard" | "gamepad";

export function controlsScreen(opts: {
  tab: ControlsTab;
  settings: Settings;
  /** Where the close button and Done go back to. Settings is the historical
   *  door and stays the default; the guide is the other one, and a player who
   *  opened this from a How to Play row expects to land back on that row rather
   *  than in Settings. main.ts remembers which door was used. */
  back?: "settings" | "howto";
  /** Detected gamepad id, or null — browsers hide pads until a button is
   *  pressed, and the pane says so instead of reading as broken. */
  padName: string | null;
  /** The action currently capturing a rebind, if any. */
  rebinding: BindableAction | null;
}): string {
  const tabBtn = (id: ControlsTab, label: string) =>
    `<button class="workshop__tab${opts.tab === id ? " workshop__tab--on" : ""}" role="tab" data-action="controls-tab" data-tab="${id}" aria-selected="${opts.tab === id}">${label}</button>`;

  const bindRow = (a: BindableAction, label: string): string => {
    const capturing = opts.rebinding === a;
    return `<div class="bind-row${capturing ? " bind-row--capturing" : ""}">
      <span class="bind-row__label">${ACTION_LABELS[a]}</span>
      <span class="bind-row__key">${capturing ? (opts.tab === "gamepad" ? "Press a button…" : "Press a key…") : label}</span>
      <button class="btn btn--ghost bind-row__btn" data-action="rebind" data-bind="${a}">${capturing ? "Cancel" : "Rebind"}</button>
    </div>`;
  };
  const infoRow = (label: string, value: string): string =>
    `<div class="bind-row bind-row--info">
      <span class="bind-row__label">${label}</span>
      <span class="bind-row__key">${value}</span>
    </div>`;

  const back = opts.back ?? "settings";
  let pane = "";
  if (opts.tab === "touch") {
    pane = `${infoRow("Aim & fire", "drag anywhere · release fires")}
      ${infoRow("Cancel a launch", "second finger taps ✕")}
      ${infoRow("Rotate", "⟲ / ⟳ on the rail")}
      ${infoRow("Abilities", "rail buttons · plant chips")}
      ${toggleHTML("leftHandRail", "Left-handed rail", "Mirror the button rail to the left edge", opts.settings.leftHandRail)}`;
  } else if (opts.tab === "keyboard") {
    pane = BINDABLE_ACTIONS.map((a) => bindRow(a, keyLabel(keyFor(a)))).join("");
  } else {
    pane = `${infoRow("Detected", opts.padName ?? "No gamepad — press any button on one")}
      ${infoRow("Aim & power", "left stick · deflection sets power")}
      ${BINDABLE_ACTIONS.map((a) => bindRow(a, padLabel(padFor(a)))).join("")}
      ${toggleHTML("stickAssist", "Stick aiming assist", "Smooth the stick so the arc doesn't jitter", opts.settings.stickAssist)}
      ${toggleHTML("stickPull", "Slingshot stick", "Pull the stick back to aim, the way the touch drag does", opts.settings.stickPull)}`;
  }

  return `<div class="screen neon-backdrop">
    <div class="controls">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div class="eyebrow">${back === "howto" ? "How to Play" : "Settings"}</div><h2 class="display" style="font-size:var(--fs-h1)">Controls</h2></div>
        <button class="icon-btn" data-action="${back}" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="workshop__tabs" role="tablist">
        ${tabBtn("touch", "Touch")}
        ${tabBtn("keyboard", "Keyboard")}
        ${tabBtn("gamepad", "Gamepad")}
      </div>
      <div class="controls__pane" id="controls-grid" role="tabpanel" data-scroll>${pane}</div>
      <div class="row" style="justify-content:center">
        <button class="btn btn--primary" data-action="${back}">Done</button>
        ${opts.tab === "touch" ? "" : `<button class="btn btn--ghost" data-action="controls-reset">Reset ${opts.tab}</button>`}
      </div>
    </div>
  </div>`;
}

/** Restore is always reachable (Apple requires it without a purchase first);
 *  Manage opens RevenueCat's Customer Center, which only makes sense once
 *  there's something to manage. */
function purchaseRowsHTML(store: StoreState): string {
  return `${
    store.unlimited
      ? `<button class="btn btn--secondary btn--block" data-action="customer-center">Manage Subscription</button>`
      : `<button class="btn btn--secondary btn--block" data-action="paywall">★ Unlock Unlimited</button>`
  }
  <button class="btn btn--ghost btn--block" data-action="restore" id="restore-btn">Restore Purchases</button>`;
}

/** One rendered board line. `rank` is the player's TRUE standing, carried
 *  explicitly rather than derived from array position — the end modal shows a
 *  discontiguous slice, where the last row might be #23 sitting under #5.
 *  `gapBefore` marks that jump so it reads as a jump and not as #6. */
export interface BoardRow {
  entry: ScoreEntry;
  rank: number;
  gapBefore: boolean;
}

/** Every entry, ranked by position — the standalone Leaderboard screen. */
export function fullBoard(entries: ScoreEntry[]): BoardRow[] {
  return entries.map((entry, i) => ({ entry, rank: i + 1, gapBefore: false }));
}

/** The top 5, plus the player's own row when they placed outside it.
 *
 *  Six rows is a height the end modal can guarantee at 360px; ten is not, at
 *  any column width that also leaves room for the outcome. The full board stays
 *  one tap away on the Leaderboard screen.
 *
 *  Matching is by name, which is all a score carries — so a player sharing a
 *  name with a top-5 entry is treated as already shown. That is the same
 *  assumption `highlight` has always made. */
export function endBoard(entries: ScoreEntry[], name?: string): BoardRow[] {
  const top = entries.slice(0, END_BOARD_TOP).map((entry, i) => ({
    entry, rank: i + 1, gapBefore: false,
  }));
  if (!name) return top;
  const mineAt = entries.findIndex((e) => e.name === name);
  if (mineAt < 0 || mineAt < END_BOARD_TOP) return top;
  return [
    ...top,
    { entry: entries[mineAt], rank: mineAt + 1, gapBefore: mineAt > END_BOARD_TOP },
  ];
}

export const END_BOARD_TOP = 5;

export function leaderboardRowsHTML(rows: BoardRow[], highlight?: string): string {
  if (!rows.length) {
    return `<div class="muted" style="padding:20px;text-align:center">No scores at this Tier yet — be the first!</div>`;
  }
  const medals = ["🥇", "🥈", "🥉"];
  return `<div class="lb">${rows
    .map(({ entry: e, rank, gapBefore }) => {
      const me = highlight && e.name === highlight;
      return `${gapBefore ? `<div class="lb__gap" aria-hidden="true">⋯</div>` : ""}
      <div class="lb__row${me ? " lb__row--me" : ""}">
        <span class="lb__rank">${medals[rank - 1] ?? rank}</span>
        <span class="lb__name">${e.name}</span>
        <span class="lb__lines">${e.lines} lines</span>
        <span class="lb__score">${e.score}</span>
      </div>`;
    })
    .join("")}</div>`;
}

/**
 * The standalone Leaderboard.
 *
 * TWO BOARDS once Tier S is open, and they are separate for the reason the
 * mode is safe at all: a sandbox run can start on bay 9, at Mark 10, on a
 * maxed rig nobody paid for. Mixing one of those into the Deep Run board would
 * not make it a better board — it would end it, because after the first such
 * entry no honest score could ever place. So they are two boards with one
 * shape, and the tab strip is what says so out loud rather than leaving the
 * player to discover it from a score they cannot explain.
 *
 * The strip renders ONLY when the sandbox is open. A player who has never
 * found Tier S has one board, and a tab strip with one tab in it is a
 * question mark, not a control.
 */
export function leaderboardScreen(rows: string, opts?: {
  /** Which board's rows are in `rows` (lib/api.ts's BoardId). */
  board: BoardId;
  /** The LADDER board the Deep Run tab offers. Under the tier ladder there is
   *  no single "the Deep Run board" to name — each Tier keeps its own — so the
   *  tab has to carry a Tier, and the caller is the only one that knows which
   *  (main.ts's runBoard: the run's own Mark inside a run, the Mark the next
   *  run would fly outside one). */
  tier?: number;
  /** Whether the Tier S board exists for this player. */
  sandbox: boolean;
}): string {
  const board = opts?.board ?? 1;
  const sandbox = board === BOARD_SANDBOX;
  const tier = opts?.tier ?? (isLadderBoard(board) ? board : 1);
  const tabs = opts?.sandbox
    ? `<div class="lb-tabs" role="tablist" aria-label="Leaderboard">
        ${lbTabHTML(tier, `Tier ${tier}`, board)}
        ${lbTabHTML(BOARD_SANDBOX, "Tier S", board)}
      </div>`
    : "";
  return `<div class="screen neon-backdrop center">
    <div class="panel modal pop" style="width:min(560px,94vw)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="text-align:left"><div class="eyebrow">${
          // #88: under the tier ladder "Deep Run" does not name a board on its
          // own — a Tier 10 run banks more lines against a heavier target than
          // a Tier 1 run can, so each tier keeps its own list and the heading
          // has to say which one is on screen. Tier S is the one board with a
          // name instead of a number, because it is not a rung.
          sandbox ? "Tier S · Sandbox" : `Tier ${board} · Deep Run`
        }</div>
        <h2 class="display" style="font-size:var(--fs-h1)">Leaderboard</h2></div>
        <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
      </div>
      ${tabs}
      <div id="lb-body" data-scroll>${rows}</div>
      <button class="btn btn--primary" data-action="${sandbox ? "sandbox" : "play"}">${
        sandbox ? `${icon("play")}Open Tier S` : `${icon("play")}Play`
      }</button>
    </div>
  </div>`;
}

function lbTabHTML(board: BoardId, label: string, current: BoardId): string {
  const on = board === current;
  return `<button class="lb-tab${on ? " is-on" : ""}" type="button" role="tab"
    aria-selected="${on}" data-action="lb-board" data-board="${board}">${label}</button>`;
}

/**
 * In-game HUD overlay — 1d "recycling-plant" layout, restructured around a
 * clear INFORMATION HIERARCHY. The old plant readout gave funds/target a huge
 * figure and then buried three equally-weighted small facts under it (combo,
 * launch cost, launches left), which meant the two numbers that actually decide
 * a shot — "can I still afford to shoot" and "is the cannon loaded" — read as
 * footnotes. The tiers now are:
 *
 *   1. FUNDS / TARGET + goal bar   the bay objective. Biggest thing on screen.
 *   2. LAUNCHES LEFT               how many shots the bankroll still buys.
 *      Its own column, mono, large — and it goes DANGER-RED and pulses at
 *      LOW_LAUNCH_WARN (3) or fewer, because that's the threshold where the
 *      correct play changes from "keep feeding the bay" to "this shot has to
 *      count". A number that changes your strategy deserves to change color.
 *      A Contract reuses this slot for its supply (its launch budget, or a
 *      pattern's shipment queue) and escalates one shot later, at
 *      LOW_SUPPLY_WARN (2) — see that constant for why an exact countdown
 *      warns later than an estimate.
 *   3. TIME                        equal-weight column beside it, already had
 *      its own red-pulse at 20s.
 *   4. RELOAD                      a bar under the readout tracking the launch
 *      cooldown, so "why didn't it fire" is answerable without guessing. The
 *      canvas draws the same value as a ring around the cannon muzzle (see
 *      render.ts's drawReloadRing) — that one is for mid-aim focus, this one is
 *      for peripheral vision.
 *   5. combo / launch cost / scrap demoted to the small meta line — and Deep
 *      Run only: all three are economy numbers, and a Contract has no economy.
 *   6. run mods + ship plates      the build, bottom row. A Contract shows its
 *      ability chips here and no rack (it has no upgrade tiers to show).
 *
 * `bayNum` is the 1-based bay currently playing (out of RUN_LEVELS);
 * `timeLimitSec` gates whether a Time readout renders at all (0 = no limit);
 * `timeLeftMs`/`pieceSize`/`beltPreview` seed the initial render so it matches
 * whatever main.ts's syncHud takes over from frame 2. `modIds` is the run's
 * drafted-mod pick history and `tiers` its bought ship upgrades (see
 * game/run.ts's RunState) — both rendered as chips/plates in the plant panel.
 *
 * Every button lives in one same-width column in the letterbox gutter OUTSIDE
 * the field's right wall — or, on aspect ratios with no usable side gutter, in
 * a reserved band or a horizontal bottom bar (see game/layout.ts and app.css's
 * .side-rail / [data-layout] rules). Two hydraulic pistons "driving" the
 * compactor are canvas-drawn (render.ts's drawPistons) since they track the
 * compactor's live x every frame; this file only owns the DOM chrome.
 */
/** Launches-left threshold at which the readout turns danger-red and pulses.
 *  Deep Run only — a Contract's supply escalates at LOW_SUPPLY_WARN. */
export const LOW_LAUNCH_WARN = 3;

/**
 * The same urgency, one shot later, for a Contract's supply readout — its
 * launch budget, or a pattern Contract's shipment queue (see main.ts's
 * syncHud, which picks whichever one this Contract runs on).
 *
 * Deliberately BELOW LOW_LAUNCH_WARN, because the two readouts are not the
 * same kind of number. A Deep Run's launches-left is an ESTIMATE of purchasing
 * power — floor(funds / launchCostNow) — that can fall by more than one per
 * shot when congestion moves the price, and can climb again when a line pays
 * out. Its warning needs a shot of headroom to still be actionable by the time
 * the player reacts to it. A Contract's supply is an EXACT countdown: one
 * shot, one unit, never a jump, and the player can plan against it with
 * certainty. That warning can wait until 2 without ever ambushing anyone.
 *
 * It also has to wait, because a Contract's supply starts small and this
 * number is the entire readout. The shortest pattern queue is 4 shipments
 * (contracts.ts's patternGoal floors at 2 lines = 16 cubes = 4 tetrominoes),
 * so a threshold of 3 would latch the danger state after the FIRST shipment
 * and hold it for the rest of the bay. A cue that is lit for three quarters of
 * a mode is decoration, not a warning.
 */
export const LOW_SUPPLY_WARN = 2;

/** The transport's direction cue: eight CSS-drawn chevrons marching toward the
 *  cannon (see app.css's .belt__arrows). Eight, and elements rather than the
 *  "▸ ▸ ▸ ▸" text run this replaces, because the strip is twice the track wide
 *  and loops by scrolling exactly half its own width: with equal flex cells
 *  the seam lands chevron-on-chevron at any size on any device, which a text
 *  run's advance width cannot promise. (That run was drawing from a platform
 *  fallback anyway — U+25B8 is outside the bundled JetBrains Mono's
 *  unicode-range.)
 *
 *  `--i` is the cell's index, which app.css turns into a staggered start for
 *  the pulse that runs up the strip toward the cannon. */
const BELT_ARROWS = Array.from({ length: 8 }, (_, i) => `<i style="--i:${i}"></i>`).join("");

export function hudHTML(opts: {
  /** What rides the belt: the shot AFTER the muzzle's (see game.ts's
   *  Game.beltPreview). */
  beltPreview: BeltPreview;
  target: number;
  score: number;
  /** Cost per launch this bay — shown in the plant readout together with how
   *  many launches the current funds afford (#hud-launches, live-synced).
   *  Deep Run only: the meta line that quotes it does not render in a
   *  Contract, which has no bankroll to price a launch against. */
  launchCost: number;
  bayNum: number;
  timeLimitSec: number;
  timeLeftMs: number;
  pieceSize: PieceSize;
  /** Whether this bay's run carries the Bond Breaker ability at all — shows
   *  its glowing chip in the plant's ability row (see main.ts / game.ts's
   *  useBondBreaker). Charged by CHARGES, not by the config: the stock is a
   *  consumable run resource, so a run that spent its last charge in an
   *  earlier bay no longer shows a dead trigger. */
  bondBreakerOwned: boolean;
  /** Charges left this bay, shown on the chip. */
  bondCharges: number;
  /** Whether Demolition Charges were drafted, and how many are left — same
   *  two-trigger treatment as Bond Breaker (see the ability note below). */
  demoOwned: boolean;
  /** True when this bay has the Autoloader (level.autoLaunchMs > 0). Adds a
   *  HELD trigger to the rail — the rig no longer fires on its own. */
  autoloaderOwned: boolean;
  bombCharges: number;
  /** The run's full drafted-mod pick history, in pick order — rendered as
   *  tally in the plant panel (see components.ts's runNotchTallyHTML). */
  ratchets: Ratchets;
  /** The Final Inspection clause in force on THIS bay (game/finals.ts), or
   *  null. Only ever set on a run's last bay — main.ts gates it there rather
   *  than passing RunState.final unconditionally, because the clause is banked
   *  before the bay starts and a HUD that named it early would be advertising a
   *  pressure the bay is not under. */
  final?: FinalId | null;
  /** The run's bought ship upgrade tiers — rendered as tier-pip plates
   *  (components.ts's shipPlatesHTML). Deep Run only, and not because the
   *  rack would be ugly in a Contract: main.ts's hudOpts passes `{}` there,
   *  so every plate would be permanently empty. */
  tiers: UpgradeTiers;
  /** The run's tier, for the bay banner's plate (canvas A4). Null in
   *  Contract mode, whose banner names the Contract instead. */
  tier?: number | null;
  /** The active input family (D2): the hint strip renders its bindings from
   *  this. main.ts re-patches the strip when the profile flips mid-bay. */
  profile?: InputProfile;
  /** Mount the hint strip already faded (kbd-hint--hidden). The strip is
   *  transient (see hintStripHTML), and the HUD is re-rendered wholesale on
   *  every state change — pause and back, a draft and back — so the strip's
   *  visibility has to be part of the render or every modal round-trip would
   *  resurrect a hint the player already dismissed. main.ts's
   *  armKeyHints/dismissKeyHints own the value. */
  hintsDismissed?: boolean;
  /** What the cannon is HOLDING — the transport's first queue slot (canvas
   *  A5's two-deep read: loaded full-size, next behind it). The canvas draws
   *  the same piece at the muzzle; the housing is where it reads as a queue. */
  loaded?: BeltPreview | null;
  /** Present only in CONTRACT mode. A Contract has no bankroll and no clock, so
   *  the funds/launches readout would show $0 and 0 launches forever; this
   *  swaps in the two numbers that actually govern it — lines toward the goal,
   *  and whichever supply limit the Contract runs on.
   *
   *  On a PATTERN Contract that limit is the shipment queue, and `remaining`
   *  carries the whole rest of it rather than just a count: planning against
   *  the full set is the mode, so showing only "4 left" would hide the part
   *  the player is actually reasoning about. */
  /** A GUIDE DRILL (game/drills.ts) rather than a run or a Contract.
   *
   *  A separate flag from `contract` because the two overlap only partly. A
   *  lines-shaped drill fills the `contract` block below — same goal-over-lines
   *  readout, same launch budget column, because a drill IS that bay — but the
   *  two economy drills keep the Deep Run readout (funds against a target) and
   *  pass no contract block at all. What is true of EVERY drill is what this
   *  flag governs: the bay banner names the drill instead of claiming a bay
   *  number the player is not on, the tier row goes (a drill banks nothing, so
   *  a tier deal is not a thing it can advertise), and the ship rack goes with
   *  it — a drill's rig is granted by the lesson, not built by the player. */
  drill?: { name: string } | null;
  contract?: {
    name: string;
    kind: "lines" | "pattern";
    goal: number;
    lines: number;
    launchesLeft: number;
    remaining: PieceType[];
    /** Cubes that bounced out before the compactor (Game.lostTotal). Rendered
     *  as the third readout column on a LINES Contract. The space isn't empty
     *  before this: with no third .pl-stat, .pl-funds (flex: 1 1 auto) simply
     *  grows to fill it, so a Contract currently spends that width on a longer
     *  Lines/Goal bar (app.css's .pl-funds/.pl-goal). Adding Lost costs that
     *  bar a THIRD flex item, not just a column — .pl-read's own gap (app.css)
     *  is paid twice for three items where two paid once, so the bar's real
     *  loss is the column plus that extra gap: about 36px at the tightest
     *  phone the ui-fit harness models. What's left over still beats a Deep
     *  Run: the bar ends up roughly 18px longer than a Deep Run's Funds/Target
     *  bar at the same viewport (both pay the same two-gap cost there, so the
     *  gap cancels out of THAT comparison), because LOST's column is narrower
     *  than TIME's (sim/systems.ts proves it: same 4-glyph label, a shorter
     *  value).
     *
     *  Not rendered on a pattern Contract: SPARE_SHIPMENTS is 0, so the margin
     *  is 0 on frame one and one stranded cube ends the attempt. It never even
     *  reaches 1 — cubesAvailable stops counting a cube the moment it starts
     *  blinking (lineClear.ts's markLostPieces), so objectiveUnreachable fires
     *  1.4s before lostTotal increments, and the bay is called 0.4s before
     *  that. A column that reads 0 for a whole attempt is not a readout. */
    lost: number;
    /** The bay's complications, one line (Contract.conditions). The board card
     *  states these and the bay used to forget them. */
    conditions: string;
    /** The Contract's OWN tier (Contract.tier) — the bay's tier, which stops
     *  being the player's the moment they climb past the board entry they are
     *  replaying. The row names this one, so a tier-6 Contract stays a tier-6
     *  bay on a tier-7 player's screen. */
    tier: number;
    /** Tier standing, for the row that says why this clear is worth having —
     *  or NULL when this attempt banks nothing, which is a state the row has
     *  to be able to say. main.ts passes the snapshot only while the same
     *  three conditions recordContractClear settles on still hold (unclaimed,
     *  at the current tier, under the milestone cap); a replay, an off-tier
     *  board entry, or the fresh render after a clear just advanced the tier
     *  all pass null. Rendering the snapshot regardless is how the panel came
     *  to advertise tier N+1's count and salvage on a tier-N bay that can
     *  never pay either. */
    progress: TierProgress | null;
  } | null;
  /** Whether a fullscreen toggle can do anything here (platform.ts's
   *  fullscreenSupported — false in the native shells, which are already
   *  edge-to-edge, and on iPhone Safari, which has no Fullscreen API). False
   *  renders NO fullscreen button rather than a dead one; layout.ts's
   *  RailLoadout.fullscreen keeps the rail budget in step. Defaults to true
   *  so the uifit harness renders the full browser rail. */
  fullscreenSupported?: boolean;
}): string {
  const {
    beltPreview, target, score, launchCost, bayNum, timeLimitSec, timeLeftMs,
    pieceSize, bondBreakerOwned, bondCharges, demoOwned, bombCharges, autoloaderOwned, ratchets, tiers,
    tier, loaded, contract, drill, fullscreenSupported = true,
  } = opts;
  // An empty belt is the honest render for the last shipment of a finite queue
  // — there IS no next piece, and drawing one would promise a shot that never
  // comes (see game.ts's BeltPreview.empty).
  const beltNextHTML = beltPreview.bomb
    ? beltBombHTML()
    : beltPreview.empty
      ? ""
      : beltPreview.hidden
        ? beltSealedHTML()
        : beltPieceHTML(beltPreview.type, beltPreview.quarterTurns, pieceSize, beltPreview.material);
  // The transport LIGHTS UP in the colour of what it is carrying (see
  // app.css's --belt-c): the marching arrows, the outfeed and the track's
  // inner glow all read it, so "what is coming" is legible from the belt
  // itself at a glance — which is the job the "NEXT" caption used to do
  // before the tiles grew into it on phones. Seeded here so the first paint
  // is already right; main.ts re-sets it whenever the queue advances.
  //
  // A SEALED shipment takes the neutral wash instead (see beltSealedHTML).
  // Every piece type has its own colour, so a belt glowing orange for a sealed
  // crate would name the L inside it, and the Blackout variant would be a lid
  // on a box with the answer painted down the side of it.
  const beltAccent = beltPreview.bomb
    ? "var(--danger)"
    : beltPreview.empty || beltPreview.hidden
      ? "var(--text-faint)"
      : shipmentColor(beltPreview.type, beltPreview.material);
  const beltLoadedHTML = !loaded
    ? ""
    : loaded.bomb
      ? beltBombHTML()
      : loaded.empty
        ? ""
        : beltPieceHTML(loaded.type, loaded.quarterTurns, pieceSize, loaded.material);
  // A5's size tag: the shipment class this bay runs on, said in one word at
  // the housing. Dropped at compact density (the phone rule) — the tile's own
  // cube count already carries the read there.
  const sizeTag = pieceSize === "tiny" ? "Micro" : pieceSize === "bulk" ? "Bulk" : "Std";
  const launches = Math.floor(score / Math.max(1, launchCost));
  const timeBlock =
    timeLimitSec > 0
      ? `<div class="pl-stat pl-time" id="hud-time-chip"><div class="lbl">Time</div><div class="v" id="hud-time">${formatMMSS(timeLeftMs)}</div></div>`
      : "";
  // ABILITIES (Bond Breaker, Demolition Charges) each get TWO triggers on
  // screen at once when drafted — a chip in the plant's ability row and a
  // dedicated icon button in the touch rail (the rail is the PRIMARY mobile
  // control: there's no keyboard on a touchscreen). Both share per-ability
  // classes that main.ts's syncHud updates together, so neither can drift out
  // of sync with the live charge count.
  //
  // Bond Breaker's two are HELD, not tapped: a press starts a charge meter on
  // the button and the charge is only spent if it fills (main.ts's
  // BOND_HOLD_MS says why, app.css's .bond-trigger--holding draws it). The key
  // binding stays a single press, so the hint strip's "B break bonds" is still
  // the whole truth for a keyboard.
  const bondChip = bondBreakerOwned
    ? `<button class="mod mod--bb bond-trigger" data-game="bond" id="bond-chip" aria-label="Bond Breaker — hold to shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>
        <span class="g">${icon("bond", 15)}</span><span class="nm">BOND BRK</span><span class="stk">×<span class="bond-trigger__count">${bondCharges}</span></span><span class="key">B</span>
      </button>`
    : "";
  const bondRailBtn = bondBreakerOwned
    ? `<button class="icon-btn bond-btn bond-trigger" data-game="bond" id="bond-btn" aria-label="Bond Breaker — hold to shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>${icon("bond", 20)}<span class="bond-btn__count bond-trigger__count">${bondCharges}</span></button>`
    : "";
  const demoChip = demoOwned
    ? `<button class="mod mod--demo demo-trigger" data-game="demo" id="demo-chip" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>
        <span class="g">${icon("demo", 15)}</span><span class="nm">DEMO</span><span class="stk">×<span class="demo-trigger__count">${bombCharges}</span></span><span class="key">X</span>
      </button>`
    : "";
  const demoRailBtn = demoOwned
    ? `<button class="icon-btn demo-btn demo-trigger" data-game="demo" id="demo-btn" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>${icon("demo", 20)}<span class="demo-btn__count demo-trigger__count">${bombCharges}</span></button>`
    : "";
  // Held, not tapped: pointerdown starts the burst and pointerup ends it (see
  // main.ts's onGamePointerDown). Sits at the BOTTOM of the rail, nearest a
  // right thumb at rest, because it is the only rail control meant to be held
  // through a whole compactor window rather than jabbed.
  const autoRailBtn = autoloaderOwned
    ? `<button class="icon-btn auto-btn" data-game="auto" id="auto-btn" aria-label="Autoloader — hold to fire">${icon("launcher", 17)}<span class="auto-btn__key">F</span></button>`
    : "";
  // The ship rack is a Deep Run readout. See the build row below for why a
  // Contract does not get one.
  const plates = contract || drill ? "" : shipPlatesHTML(tiers);
  // BAY BANNER — the run position, top-center of the field. Playtest feedback:
  // "Bay 1/10" as small muted text inside the plant title read as part of the
  // level name, so players didn't know they were 1 bay into a 10-bay run. The
  // banner makes the x/10 the headline and adds one pip per bay (cleared pips
  // lit, current pip amber) so progress is readable at a glance without
  // parsing any numbers. Contract mode shows the contract's name instead —
  // there is no run position to report.
  const bayBanner = drill
    ? `<div class="bay-banner bay-banner--contract" role="status">
        <span class="bay-banner__mode">Drill</span> ${drill.name}
      </div>`
    : contract
    ? `<div class="bay-banner bay-banner--contract" role="status">
        <span class="bay-banner__mode">Contract</span> ${contract.name}
      </div>`
    : `<div class="bay-banner" role="status" aria-label="Bay ${bayNum} of ${RUN_LEVELS}${tier ? `, tier ${tier}` : ""}">
        ${tier ? tierPlateHTML(tier, "banner") : ""}
        <span class="bay-banner__mode">Bay</span>
        <span class="bay-banner__n">${bayNum}<span class="bay-banner__of">/${RUN_LEVELS}</span></span>
        <span class="bay-banner__pips" aria-hidden="true">${Array.from(
          { length: RUN_LEVELS },
          (_, i) => `<i class="${i + 1 < bayNum ? "done" : i + 1 === bayNum ? "cur" : ""}"></i>`,
        ).join("")}</span>
      </div>`;
  return `<div class="hud${contract ? " hud--contract" : ""}" id="hud">
    <!-- button rail: ONE same-width column of the base buttons — fullscreen
         (browsers only: the native shells are already edge-to-edge, so no
         toggle mounts there — see fullscreenSupported above), pause, rotate
         CCW/CW — plus a slot per drafted ability (Bond Breaker,
         Demolition, Autoloader). Where it SITS is decided by the layout solver
         (game/layout.ts): in the right letterbox gutter when one is wide
         enough, in a reserved right band on near-16:9 viewports where there is
         no natural gutter, or as a horizontal strip in the bottom band when the
         column genuinely cannot fit (see app.css's [data-layout] rules). The
         solver budgets the column for the buttons ACTUALLY here (main.ts's
         hudOpts feeds railSlotsFor), which is what keeps the vertical rail on
         360dp landscape phones. The column is TOP-ANCHORED, so the base four
         keep the same screen positions whether or not a run has drafted any
         abilities — ⟲/⟳ are the third and fourth button, always, and drafting
         Bond Breaker mid-run grows the rail downward instead of sliding the
         rotate pair out from under a thumb. There's no keyboard on mobile, so
         this rail IS the touch control surface. The aim-state
         cancel ✕ is only visible mid-drag (main.ts's syncHud toggles
         .hud--aiming) and does NOT own a slot: it swaps into the pause
         button's slot (a CSS order pair — it is last in the DOM but renders
         second), so nothing below it moves under a hovering thumb; a second
         finger taps it to abort the queued launch. Rotate taps mid-drag do NOT cancel (see input.ts).
         Desktop hides the game buttons and uses Q/E + B/X instead (see the
         @media (pointer: fine) rule in app.css), per the kbd-hint strip down
         in .hud__bottom. -->
    <div class="side-rail">
      ${fullscreenSupported ? `<button class="icon-btn" id="fullscreen-btn" data-action="fullscreen" aria-label="Fullscreen">${icon("fullscreen", 22)}</button>` : ""}
      <!-- TAP pauses, HOLD restarts the bay (main.ts's startHold). The second
           half is in the accessible name because it has nowhere else to go on
           touch: the .kbd-hint strip that names it is display:none on a coarse
           pointer and aria-hidden everywhere, and this rail carries no visible
           labels. Costs no pixels on any device and is the only route an
           assistive-technology user has to a gesture that is otherwise
           undiscoverable. -->
      <button class="icon-btn" data-action="pause" aria-label="Pause — hold to restart the bay">${icon("pause", 22)}</button>
      <button class="icon-btn rotate-btn" data-game="rotl" aria-label="Rotate left">${icon("rotl", 22)}</button>
      <button class="icon-btn rotate-btn" data-game="rotr" aria-label="Rotate right">${icon("rotr", 22)}</button>
      ${bondRailBtn}
      ${demoRailBtn}
      ${autoRailBtn}
      <button class="icon-btn cancel-aim-btn" data-game="cancel" aria-label="Cancel launch">${icon("close", 22)}</button>
    </div>

    ${bayBanner}

    <!-- INFEED TRANSPORT (canvas A5, proposal A "infeed housing"): the feed
         head takes hazard stripes, the tread and its chevrons animate toward
         the cannon, and the queue reads TWO deep — the piece the cannon is
         HOLDING at the downhill (muzzle) end, the piece coming after it
         uphill, both opaque and both on top of the transport. Real queue data,
         not a mockup:
         components.ts's beltPieceHTML renders the exact shape/rotation/
         material, and the MATERIAL_SPEC colour makes cryo/slag legible before
         firing. The size tag names the bay's shipment class; compact drops it
         (A5's phone rule), and the whole transport hides under the coach card
         at compact (A6 — see app.css).

         There is no "◂ NEXT" caption any more. It sat above the track between
         the two tiles, and on a phone the tiles closed on it: the belt scales
         with the field but the caption and the tiles bottom out on their
         max() floors, so the gap between them shrank past what the words
         needed (70px of gap for 61px of label at 1280; 34px for 43px at 667)
         and the tiles painted over it. The transport says the same thing
         without words now — chevrons marching at the cannon, lit in the
         colour of the shipment they are carrying. -->
    <div class="belt" aria-label="Shipment feed" id="hud-belt" style="--belt-c:${beltAccent}">
      <span class="belt__feed" aria-hidden="true">Feed</span>
      <div class="belt__track"><div class="belt__tread"></div>
        <span class="belt__arrows" aria-hidden="true">${BELT_ARROWS}</span>
      </div>
      <div class="belt__roller belt__roller--l"><i></i></div>
      <div class="belt__roller belt__roller--r"><i></i></div>
      <div class="belt-piece belt-piece--next" id="hud-next">${beltNextHTML}</div>
      ${loaded ? `<div class="belt-piece belt-piece--loaded" id="hud-loaded">${beltLoadedHTML}</div>` : ""}
      <span class="belt__tag" aria-hidden="true">${sizeTag}</span>
    </div>

    <!-- the RECYCLING PLANT: PWR bar, the readout tiers described above, and
         the run's build (drafted mods, ship plates, abilities).

         THE CREST — the machine's intake spikes, in the DOM rather than on
         the canvas (they used to be render.ts's chute teeth) so they can
         trace the panel's REAL silhouette: along the top edge, up and over
         the raised PWR cap, down the exposed right flank — and out into the
         two bands the panel's frame fractions leave bare, the sliver against
         the field's left wall (--port) and the strip under the panel to the
         floor (--skirt), each strip stopping at its corner so the ring turns
         rather than overshoots. The canvas could never close the gap over the cap —
         the cap is DOM, painted above anything the world draws — which is
         exactly the notch this fixes. Each segment is one clip-path strip
         whose cube run is hand-authored irregular (no repeating background
         tile), and all of them share .plant__crest so the congestion states
         (main.ts's syncHud toggles .plant--congest-*), the strand warning
         (.plant--maw) and the music (--crest-beat, --crest-heat and the
         --h0..--h6 rotation, all written by syncHud) recolour, animate and
         pulse the whole ring at once.

         THE RIVETS close the corners. Every strip is its own run, phase-
         matched to nothing, so at a turn the two runs can peak together (an
         X of cubes across the corner) or recede together (a bare notch where
         the ring is supposed to turn) — the two bugs the design session was
         opened for. A cube rivet plugs each joint instead of hand-tuning
         twelve run endpoints to phase-lock in pairs. Six of them, numbered
         1-4, 6 and 7: there is deliberately no R5, because the shoulder/flank
         join is not a turn (the cap's right edge is flush with the panel's,
         so the run simply continues down the one line) and a rivet there read
         as a stray bolt. R3/R4 sit inside .pl-pwr rather than here because
         their offsets have to resolve against the CAP's box, not the
         panel's. -->
    <div class="plant">
      <i class="plant__crest plant__crest--brow" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--flank" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--port" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--skirt" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--rivet plant__crest--rivet-1" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--rivet plant__crest--rivet-2" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--rivet plant__crest--rivet-6" aria-hidden="true"></i>
      <i class="plant__crest plant__crest--rivet plant__crest--rivet-7" aria-hidden="true"></i>
      <div class="pl-pwr" id="hud-pwr">
        <i class="plant__crest plant__crest--cap" aria-hidden="true"></i>
        <i class="plant__crest plant__crest--step" aria-hidden="true"></i>
        <i class="plant__crest plant__crest--shoulder" aria-hidden="true"></i>
        <i class="plant__crest plant__crest--rivet plant__crest--rivet-3" aria-hidden="true"></i>
        <i class="plant__crest plant__crest--rivet plant__crest--rivet-4" aria-hidden="true"></i>
        <span class="lbl">PWR</span>
        <div class="pl-pwr__track"><div class="pl-pwr__fill" id="hud-power"></div></div>
        <span class="pl-pwr__val" id="hud-power-val">0%</span>
      </div>
      <div class="plant__body">
        <!-- NO TITLE ROW. "Recycling Plant" named the panel to a player who
             was already looking at it, and the bay banner across the top of
             the field carries the only naming a bay needs (tier, bay N/10,
             and in Contract mode the contract's name). The row went the way
             the bay position that used to trail the title went, and for the
             same reason: a second, quieter telling of a fact already told
             louder is the half worth dropping. What went with it — three
             decorative rivets that were the title's counterweight — was the
             row's whole remaining content, and a row of three dots is not a
             readout. Every row left in the panel is a live number. -->
        <div class="pl-read">
          ${
            contract
              ? `<div class="pl-funds">
            <div class="lbl">Lines<span class="lbl__q"> / Goal</span></div>
            <div class="v"><span id="hud-score">${contract.lines}</span> <span class="tgt">/ ${contract.goal}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="width:0%"></i></div>
          </div>
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">${contract.kind === "pattern" ? "Shipments" : "Launches"}</div>
            <div class="v" id="hud-launches">${contract.launchesLeft}</div>
          </div>
          ${
            contract.kind === "lines"
              ? `<div class="pl-stat pl-lost"><div class="lbl">Lost</div><div class="v" id="hud-lost">${contract.lost}</div></div>`
              : ""
          }`
              : `<div class="pl-funds">
            <div class="lbl">Funds<span class="lbl__q"> / Target</span></div>
            <div class="v"><span id="hud-score">$${score}</span> <span class="tgt">/ ${target}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="width:0%"></i></div>
          </div>
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">Launches</div>
            <div class="v" id="hud-launches">${launches}</div>
          </div>`
          }
          ${timeBlock}
        </div>
        <!-- Reload: fills as the launch cooldown runs down (see
             cannon.reloadRatio). Goes .ready the instant the cannon can fire
             again, which is the only state change that matters here. -->
        <div class="pl-load" id="hud-load-row">
          <span class="lbl">Reload</span>
          <div class="pl-load__track"><i id="hud-load" style="width:100%"></i></div>
        </div>
        ${
          // COMBO / LAUNCH COST / SCRAP — the small meta line, and Deep Run
          // only. Every number on it is an economy number, and a Contract has
          // no economy: no bankroll to price a launch against, no salvage
          // payout, and a combo multiplier that multiplies a score nothing
          // reads. The row used to render here regardless and the removal was
          // half-done — a PATTERN contract dropped the launch quote and kept
          // "Combo ×0 · Scrap 0" for the whole bay, a LINES contract kept all
          // three — which is three permanent zeroes on the one panel the
          // player checks mid-shot. What a Contract keeps is the reload bar
          // and its modifiers; the rest is Deep Run furniture.
          contract
            ? ""
            : `<div class="pl-meta">
          <span>Combo <b id="hud-combo">×0</b></span>
          <span class="pl-meta__sep">·</span><span class="pl-meta__launch" id="hud-launch">Launch $${launchCost}</span>
          <span class="pl-meta__sep">·</span>
          <span>Scrap <b id="hud-scrap">0</b></span>
        </div>`
        }
        ${
          // The remaining manifest gets its OWN row rather than riding the
          // meta line: the tally is the widest thing the plant can hold (six
          // piece types × "I×3"), and inline it wrapped the meta line onto a
          // second and third line — which is what pushed the panel past its
          // design box on the tightest inset device (iPhone 13 mini). A row
          // can scroll its tail horizontally; a wrapped line can only grow.
          contract?.kind === "pattern"
            ? `<div class="pl-queue"><span class="lbl">Left</span><b id="hud-queue">${queueTallyHTML(contract.remaining)}</b></div>`
            : ""
        }
        ${
          // NOTCHES — the run's ratcheted axes, one dense line, and only in
          // Deep Run: a Contract has no ratchets at all (main.ts's
          // startContract nulls `run`, and the axes live on the run), so the
          // row would be a permanent em-dash there. That is also what keeps
          // the contract grid templates honest — they name no `notch` area,
          // and an area with nothing in it costs its share of the row gap.
          //
          // Rendered on EVERY Deep Run bay including the first, where it reads
          // "—". A row that appears the moment the first notch lands would
          // shift every row above it mid-run, and the panel has the ~9px this
          // costs: measured free space inside the panel's design box is 18.6px
          // on an iPhone 13 mini, the tightest in the matrix.
          contract
            ? ""
            : `<div class="pl-notch"><span class="lbl">Notches</span><b id="hud-notches">${runNotchTallyHTML(ratchets, opts.final ?? null)}</b></div>`
        }
        ${
          // The bay's own complications — the Contract analogue of the notch
          // line above, and the same row shape for the same reason: a list
          // whose length the panel does not control belongs on a row that can
          // scroll its tail. The board card states these and the bay used to
          // forget them the moment it started.
          //
          // Rendered on EVERY Contract, so the row is at the same height on
          // every card, and neither kind can leave it empty. On a LINES
          // Contract that is budgetForTier (never below 2) plus wind and
          // tightLaunches — 2 points each, and the two complications with no
          // option-specific gate, unlike material and micro — so the notes
          // list always gets at least one entry (0 empties across 72,000
          // generated Contracts: contracts.ts's own measurement for its
          // "clean bay" fallback, which guards a future budget or gating
          // change and is not a state this row renders today). On a PATTERN
          // Contract, patternConditions is a switch whose every case,
          // default included, returns a literal string — no branch falls
          // through empty.
          //
          // NOT `.pl-mods`: that row is display:none at compact density and
          // never renders in a Contract at all. levelForContract never calls
          // applyUpgrades, so bondBreakerCharges/bombCharges stay at
          // makeBaseLevel's zero (only levelForRun's applyUpgrades raises
          // them), which leaves bondChip and demoChip empty too — and
          // hudOpts hands a Contract `tiers: {}` on top of that. Conditions
          // placed on that row would be invisible on every phone.
          contract
            ? `<div class="pl-notch"><span class="lbl">Bay</span><b id="hud-conditions">${contract.conditions}</b></div>`
            : ""
        }
        ${
          // Why this bay is worth playing. The board states the deal — tier,
          // clears needed, salvage a first clear banks — and the bay dropped
          // it. Static for the length of an attempt, which is why it is a line
          // and not a readout column.
          //
          // `salvageHTML`, not a bare `icon("salvage", 9)` + interpolated
          // number: every other salvage figure in the app goes through it
          // (screens.ts:58), and writing this one out by hand also left a
          // literal space either side of the icon — a stray text-node flex
          // item next to a `gap` that already spaces the row (app.css's
          // `.pl-tier b`). See app.css's `.pl-tier` comment for the actual
          // rendering bug this row had (align-items, not this wrapper) and
          // why its value can never overflow.
          //
          // `id="hud-tier"` exists to anchor tests, not to sync: the value is
          // static while the bay plays (above). Its one legitimate change —
          // tier progress advancing on a first clear — lands via
          // contract-end's own fresh hudHTML() render, not a live patch, so
          // main.ts still never looks the id up.
          contract && !drill
            ? `<div class="pl-tier"><span class="lbl">Tier ${contract.progress?.tier ?? contract.tier}</span><b id="hud-tier">${
                // The deal, or the honest absence of one. With a milestone
                // still to bank the row quotes the count and the salvage; with
                // nothing to bank it says PRACTICE, in the CONTRACT's own tier
                // rather than the player's — naming the player's tier beside
                // "practice" would just raise the same wrong number the row is
                // being fixed for. The row stays mounted either way: it is one
                // line whichever it says.
                contract.progress
                  ? `${contract.progress.contracts}/${contract.progress.needed}${salvageHTML(contract.progress.milestone, 9)}`
                  : "Practice"
              }</b></div>`
            : ""
        }
        ${
          // Build row: ABILITY chips first, then the ship rack. The rack is
          // seven fixed slots and all seven fit without scrolling on every
          // device (components.ts's shipPlatesHTML, and the harness's "rack"
          // assertion). The row keeps its horizontal scroll for the ability
          // chips at roomy density, where the vertical BUILD tag and two 88px
          // chips lead the row — but nothing informational hides behind it
          // any more. The ratchet chips that used to trail the rack are the
          // notch line above: they could not fit beside seven slots at any
          // legible size, and a notch behind a scroll is a notch the player
          // does not know they took.
          //
          // In a CONTRACT this row never renders at all, on any device — not
          // "the rack is gone and the chips are the whole row", a state that
          // cannot occur (see the Bay row's NOT `.pl-mods` note above).
          // Written as `plates || bondChip || demoChip` rather than
          // `contract ? "" : ...` anyway, because that condition is the real
          // reason the row disappears, checked directly instead of assumed
          // from the mode: `plates` is `""` on a Contract by construction
          // (`contract ? "" : shipPlatesHTML(tiers)`), and `bondChip`/
          // `demoChip` are always empty there too — main.ts's hudOpts derives
          // `bondBreakerOwned`/`demoOwned` from `g.bondCharges`/
          // `g.level.bombCharges`, and `levelForContract` (contracts.ts)
          // never calls `applyUpgrades`, so both sit at `makeBaseLevel`'s zero
          // default; only `levelForRun`'s `applyUpgrades` ever raises them.
          // Fixed slots earn their place in a Deep Run, where a refit lights a
          // plate exactly where the player is already looking; a Contract's
          // own level config carries no ability that could ever light this
          // row the same way, today.
          //
          // On a PHONE, Deep Run's build row hides a second, independent way:
          // the chips are hidden at compact density (the rail carries the
          // same triggers, counts included), so app.css drops the whole row
          // there rather than leave its padding behind.
          plates || bondChip || demoChip
            ? `<div class="pl-mods" id="hud-mods">
          <span class="lbl">Build</span>
          ${bondChip}
          ${demoChip}
          ${plates}
        </div>`
            : ""
        }
      </div>
    </div>

    <div class="hud__bottom">
      ${hintStripHTML(
        opts.profile ?? "keyboard",
        { bond: bondBreakerOwned, demo: demoOwned, auto: autoloaderOwned },
        opts.hintsDismissed ?? false,
      )}
    </div>
    <!-- Settle banner: shown while the bay's funding target is met and the
         field is still coming to rest (game.ts's Game.settling). Reassures the
         player that the frozen-looking cannon is intentional and their last
         shots still count. main.ts toggles .show. -->
    <div class="settle-note" id="settle-note" aria-live="polite">
      <span class="settle-note__dot"></span> Target met — letting the bay settle
    </div>
    ${dragHintHTML()}
  </div>`;
}

/**
 * The one list of input hints per non-touch family (D2): every entry is
 * rendered FROM the live bindings, never hardcoded — a rebound key changes
 * the hint. Shared by the HUD's transient strip and the pause modal's
 * reference block, so the two can never teach different controls.
 */
function hintParts(
  profile: InputProfile,
  owned: { bond: boolean; demo: boolean; auto: boolean },
): string[] {
  const kbd = (s: string) => `<span class="kbd">${s}</span>`;
  const parts: string[] = [];
  /* Each hint is wrapped as ONE element below, which is layout, not markup
     tidiness: .kbd-hint is a flex container, so every loose text node between
     two chips ("/" , " rotate") was its own anonymous flex item and got the
     container's gap injected around it. That both spelled the hints wrong
     ("Q / E rotate") and padded a full loadout's strip out to 951px, wider
     than a 900px window. Grouped, a wrap can only break BETWEEN hints. */
  const part = (inner: string) => parts.push(`<span class="kbd-hint__part">${inner}</span>`);
  if (profile === "gamepad") {
    part(`${kbd(padLabel(padFor("rotl")))}/${kbd(padLabel(padFor("rotr")))} rotate`);
    part(`${kbd("Stick")} aim + power`);
    part(`${kbd(padLabel(padFor("fire")))} fire`);
    if (owned.bond) part(`${kbd(padLabel(padFor("bond")))} break bonds`);
    if (owned.demo) part(`${kbd(padLabel(padFor("demo")))} arm charge`);
    if (owned.auto) part(`${kbd(padLabel(padFor("auto")))} hold to autofire`);
    part(`${kbd(padLabel(padFor("pause")))} pause`);
  } else {
    part(`${kbd(keyLabel(keyFor("rotl")))}/${kbd(keyLabel(keyFor("rotr")))} rotate`);
    part(`${kbd(keyLabel(keyFor("aimUp")))}/${kbd(keyLabel(keyFor("aimDown")))} aim`);
    part(`${kbd(keyLabel(keyFor("powerDown")))}/${kbd(keyLabel(keyFor("powerUp")))} power`);
    part(`${kbd(keyLabel(keyFor("fire")))} fire`);
    if (owned.bond) part(`${kbd(keyLabel(keyFor("bond")))} break bonds`);
    if (owned.demo) part(`${kbd(keyLabel(keyFor("demo")))} arm charge`);
    if (owned.auto) part(`${kbd(keyLabel(keyFor("auto")))} hold to autofire`);
    /* "click to aim", not "drag to aim", and this strip is the one place the
       change is safe to state flatly. It renders only under `pointer: fine`
       (see the block below), where the pointer IS a mouse — and the mouse is
       the device that now aims by pointing at a spot and letting the cannon
       solve the arc onto it (game/input.ts). A finger still pulls back, and a
       finger never sees this strip. */
    part("click to aim");
    /* HOLD THE PAUSE BUTTON TO RESTART THE BAY (main.ts's startHold on
       [data-action="pause"]). A gesture nobody is told about is a gesture
       nobody uses.

       PLAIN TEXT, NOT A .kbd CHIP. Every chip in this strip is a live binding
       out of game/bindings.ts — that is the whole reason this function exists
       — and "hold" is a gesture on a button, not a key anyone can rebind. A
       keycap around it would be the one lie the strip is built to make
       impossible. "click to aim" above is the same kind of hint and is written
       the same way. It is also ~49px cheaper on a strip that is width-budgeted
       (mono 12px x 4 chars + the chip's 12px padding and 4px border).

       NOT GUARDED ON `profile === "touch"`, which is where this hint was first
       drafted. The strip is `display: none` except under `@media (pointer:
       fine)` or `[data-profile="gamepad"]` (app.css) — it is hidden on COARSE
       pointers, where the rail is the control surface — so a touch-only hint
       renders into markup no touch player ever sees, while a string check on
       it goes green. The gesture is a pointerdown hold, which a mouse makes as
       readily as a thumb, so the fine-pointer strip is the one audience that
       can both read this and perform it. Touch players are told through the
       pause button's own accessible name instead (see hudHTML's .side-rail).

       NOT IN THE GAMEPAD ARM: Start is a button press, and nothing binds a
       held pad button to resetBay — a pad player restarts through the pause
       modal's own button, which pad navigation reaches (main.ts's
       onPadUiButton). */
    part("hold pause to restart");
  }
  return parts;
}

const HINT_SEP = `<span class="kbd-hint__sep">·</span>`;

/**
 * The HUD's input-hint strip (D2): the hintParts table above, joined as one
 * sentence on the field's foot. The gamepad family gets its own strip (CSS
 * shows it whenever the profile is gamepad, whatever the pointer type); touch
 * renders the keyboard strip's content — the strip itself is hidden on coarse
 * pointers, where the rail is the control surface.
 *
 * TRANSIENT, not resident. The strip is onboarding, and its retirement rule
 * is the drag hint's (D3, main.ts's armKeyHints/dismissKeyHints): shown in
 * full until the family's first shot proves the controls, re-shown once per
 * session if a bay sits 15s with no shot, and otherwise faded out — the bay
 * floor belongs to the bay. `dismissed` is the mount-time state, because the
 * HUD is re-rendered wholesale on every state change and a class main.ts
 * toggled on the old node would not survive the trip; main.ts still toggles
 * `kbd-hint--hidden` live between renders. The reference copy of these hints
 * lives on the pause modal (pauseKeysHTML), which is where a player who wants
 * them re-reads them — and which points at the Controls screen for rebinds.
 */
export function hintStripHTML(
  profile: InputProfile,
  owned: { bond: boolean; demo: boolean; auto: boolean },
  dismissed = false,
): string {
  const parts = hintParts(profile, owned);
  return `<div class="kbd-hint${dismissed ? " kbd-hint--hidden" : ""}" aria-hidden="true">${
    parts.join(`\n        ${HINT_SEP}\n        `)
  }</div>`;
}

/**
 * The pause modal's control reference — the permanent home of the hints the
 * transient strip retires from. Same hintParts table, same live bindings, so
 * the strip a first-timer saw and the card a veteran pauses into can never
 * disagree; the note under it is where "the rest" lives, pointing at the
 * Controls screen the way the design asks (rebinds, the stick settings).
 *
 * Rendered for every profile and CSS-gated exactly like the strip (fine
 * pointer, or the gamepad profile on any pointer): the pause modal is one
 * innerHTML render, and gating in markup would leave a stale block behind
 * when the profile flips mid-pause — main.ts's setProfile re-patches this
 * node by id instead, the same treatment the strip gets.
 */
export function pauseKeysHTML(
  profile: InputProfile,
  owned: { bond: boolean; demo: boolean; auto: boolean },
): string {
  const parts = hintParts(profile, owned);
  return `<div class="pause-keys" id="pause-keys">
    <div class="pause-keys__grid">${parts.join("\n      ")}</div>
    <p class="pause-keys__note muted">Rebind these under Settings → Controls.</p>
  </div>`;
}

/** First-play / idle-timeout onboarding overlay teaching the slingshot drag
 *  — a neon finger-dot presses near the cannon (left ~25% of screen,
 *  vertical center), drags back along a curve while a ghost pull-back arc
 *  grows, then releases, looping with a pause between loops. Rendered
 *  hidden by default (`drag-hint--hidden`); main.ts's armDragHint/
 *  dismissDragHint toggle that class based on the persisted
 *  settings.seenDragHint flag and a 15s once-per-session idle timer (see
 *  main.ts). Pure CSS animation — see tokens.css's --hint-* tokens and
 *  app.css's hint-dot/hint-arc keyframes. Touch-only (hidden on fine
 *  pointers via CSS), pointer-events:none throughout so it never blocks the
 *  drag-anywhere aim gesture. */
export function dragHintHTML(): string {
  return `<div class="drag-hint drag-hint--hidden" id="drag-hint" aria-hidden="true">
    <svg class="drag-hint__arc" viewBox="0 0 160 160" width="160" height="160">
      <path d="M89,77 Q52,112 49,133" />
    </svg>
    <div class="drag-hint__dot"></div>
  </div>`;
}

/**
 * INTERACTIVE COACH — the first-run tutorial (issue #23). One instruction at a
 * time over the live first bay, each advancing when the player actually
 * performs the action (detection lives in main.ts's tutorial driver — this
 * module only renders the current step). Steps carry no keyboard talk: on
 * touch the rail buttons are the controls, and desktop players get the
 * kbd-hint strip anyway.
 *
 * ONE CARD PER COMPLETABLE ACTION — this is why the deck is four steps and
 * not the playtest deck's six (aim, power, rotate, launch, row, resources).
 * Aim, power and launch are not three actions: they are one continuous drag,
 * whose only possible ending is the release that fires. Splitting that
 * gesture across three cards meant the Power card advanced mid-drag the
 * instant the pull crossed a threshold, and the Launch card either flashed
 * past unread or never appeared at all (the shoot handler jumped over it) —
 * playtest feedback: "steps 2 and 4 are skipped immediately; the release is
 * the only thing you can do." A step the player cannot dwell on teaches
 * nothing, so the drag is now taught whole, on one card, and advances only
 * when the gesture COMPLETES in a fired shot. Rotate is the one genuinely
 * separate verb (a discrete tap, doable between shots), so it keeps its card
 * — placed AFTER the first shot, where the player has a next piece to turn.
 */
export interface CoachStep {
  title: string;
  body: string;
}

/** The level's real numbers are baked into the copy so the tutorial teaches
 *  THIS bay's economy, not a stale example — and the GESTURE copy renders
 *  through the one hint table (D2, game/bindings.ts) per input family, so
 *  the coach can never tell a desktop player to tap a button that
 *  `pointer: fine` hides (which is exactly what it used to do).
 *
 *  EVERY BODY HERE IS HEIGHT-BUDGETED, and the budget is small enough to be
 *  a real constraint on the writing. The card shares the plant panel's column
 *  with the readout under a hard cap (52% of the field height — see app.css's
 *  `.hud[data-coach] .plant`), so a sentence that overruns does not push the
 *  panel: it pushes its own tail out of `.coach__body`, and the player reads
 *  a card ending mid-word. That is what the resources card did — 58px of
 *  hidden text on a 640x360 phone, with "that clears the bay" sliced through
 *  the middle — and it is the LAST card, whose last clause is the one that
 *  says how to win.
 *
 *  So the copy is trimmed to what the step cannot teach without: the economy
 *  card names the four figures and the two ways a bay ends, and the flourish
 *  it used to carry ("you'll see the red −$ where it vanished") lives on in
 *  How to Play's card 06, which has a whole card to spend on it. The harness
 *  asserts the result rather than trusting it — `.coach__body` is no longer
 *  an allowed scroller, and all four steps are fixtures (sim/uifit), so copy
 *  that outgrows the card fails CI instead of shipping half-read. */
export function coachSteps(level: {
  launchCost: number;
  scorePerLine: number;
  targetScore: number;
  penaltyPerLostPiece: number;
}, profile: InputProfile = "touch"): CoachStep[] {
  return [
    {
      title: "Aim & fire",
      body:
        profile === "touch"
          ? `<b>Pull back</b> anywhere on the field, like a slingshot — the cannon aims opposite, farther for <b>more power</b>. <b>Release to fire</b> along the dotted arc.`
          : `<b>${hintAim(profile)[0].toUpperCase()}${hintAim(profile).slice(1)}.</b> The dotted arc is exactly where the shipment flies.`,
    },
    {
      title: "Rotate",
      body: `Between shots, <b>${hintRotate(profile)}</b> to turn the next piece 90°. The glowing piece flies exactly as shown.`,
    },
    {
      title: "Complete a row",
      body: `Fill a <b>full row</b> in front of the red compactor: it vanishes and pays. Cubes <b>short of the bar</b> are lost.`,
    },
    {
      title: "Funds & Target",
      body: `Launches cost <b>$${level.launchCost}</b>; rows pay <b>$${level.scorePerLine}</b> plus <b>${scrapHTML("scrap")}</b>; lost cubes fine <b>$${level.penaltyPerLostPiece}</b>. Reach <b>$${level.targetScore}</b> before Funds or time runs out.`,
    },
  ];
}

export function coachHTML(
  step: number,
  level: {
    launchCost: number;
    scorePerLine: number;
    targetScore: number;
    penaltyPerLostPiece: number;
  },
  profile: InputProfile = "touch",
): string {
  const steps = coachSteps(level, profile);
  const s = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;
  const dots = steps
    .map((_, i) => `<i class="${i < step ? "done" : i === step ? "cur" : ""}"></i>`)
    .join("");
  return `<div class="coach" id="coach">
    <div class="coach__card">
      <div class="coach__eyebrow">Tutorial · ${Math.min(step + 1, steps.length)}/${steps.length}</div>
      <div class="coach__title">${s.title}</div>
      <p class="coach__body">${s.body}</p>
      <div class="coach__foot">
        <span class="coach__dots" aria-hidden="true">${dots}</span>
        ${
          last
            ? `<button class="btn btn--primary coach__btn" data-action="coach-done">Got it!</button>`
            : `<button class="btn btn--ghost coach__btn" data-action="coach-skip">Skip tutorial</button>`
        }
      </div>
    </div>
  </div>`;
}

/**
 * TUTORIAL FAILURE — the coach handling a lost first bay.
 *
 * A first-timer who runs the purse dry ninety seconds into their first game
 * used to get the full run-end modal: "Game Over", a leaderboard submit box, a
 * tier-progress ledger and a score breakdown reading zero. Every one of those
 * is an answer to a question they have not thought to ask yet, and the two
 * things they actually needed — what went wrong, and how to get back in — were
 * a "Play Again" button and a themed one-liner. A tutorial that can hard-fail
 * into a leaderboard is a tutorial that stops teaching at the first mistake.
 *
 * So the coach handles its own failures. Same card, same voice, same place on
 * screen as the four teaching steps — the lesson simply continues, because
 * losing a bay to an empty bankroll IS the lesson this mode is built around.
 * The run is not recorded, no score is submitted and nothing is banked: the
 * bay did not happen. (main.ts's onGameStatus is where that is enforced.)
 *
 * The copy is cause-specific and carries THIS bay's real numbers for the same
 * reason coachSteps does — a tutorial that teaches a stale example teaches the
 * player to distrust it. `broke` is deliberately the fullest explanation: with
 * the float now a tight eight launches (level.ts's economy note), it is the
 * failure a new player will actually meet, and "you ran out of money" without
 * "here is the arithmetic" is a verdict rather than a lesson.
 */
export function coachFailSteps(
  reason: LossReason | null,
  level: { launchCost: number; scorePerLine: number; targetScore: number; startingFunds: number },
): { title: string; body: string } {
  const launches = Math.floor(level.startingFunds / Math.max(1, level.launchCost));
  switch (reason) {
    case "broke":
      return {
        title: "Out of Funds",
        body: `Every launch costs <b>$${level.launchCost}</b>, so a bay opens with about <b>${launches} shots</b> in the bank — and you ran out before reaching <b>$${level.targetScore}</b>. That budget is the puzzle: a full row pays <b>$${level.scorePerLine}</b> back, so a row built in two or three shots <i>earns</i>, and cubes that miss the compactor are money gone. <b>Aim for the row, not for the pile.</b>`,
      };
    case "time":
      return {
        title: "Time's Up",
        body: `The clock ran out before your Funds reached <b>$${level.targetScore}</b>. You have more time than it feels like — line up the next shot <i>while</i> the cannon reloads, and let each full row pay you <b>$${level.scorePerLine}</b> forward.`,
      };
    case "topout":
      return {
        title: "The Pile Topped Out",
        body: `Cubes stacked to the ceiling. Only <b>complete rows</b> remove cubes from the bay, so a pile that keeps growing never comes down — spend your shots finishing the row nearest the compactor before starting a new layer.`,
      };
    default:
      return {
        title: "Bay Lost",
        body: `That bay got away. Nothing is lost — the tutorial run does not count against you. Take another go at <b>$${level.targetScore}</b>.`,
      };
  }
}

/** The failure card itself. Rendered as a modal rather than in the plant panel
 *  flow (where the teaching steps live) because the field behind it is dead and
 *  there is a decision to make: the card has to be the only thing to look at.
 *  Retry is the primary and it is a full-width target — a player who just lost
 *  their first bay should not have to hunt for the way back in. */
export function coachFailHTML(
  reason: LossReason | null,
  level: { launchCost: number; scorePerLine: number; targetScore: number; startingFunds: number },
  bayName: string,
): string {
  const s = coachFailSteps(reason, level);
  // A8: the one NEXT STEP block, explaining the chain out of the wall the
  // player just hit — Contracts pay salvage, salvage buys the Reactor, the
  // Reactor is a bigger float for THIS bay. Tier-1 numbers, stated live,
  // because the coach only ever runs on a first-tier run.
  const milestone = tierMilestoneSalvage(1);
  const reactor = installById("reactor")!;
  const nextBlock = `<div class="coach__next">
          ${nextBadgeHTML()}
          <p>Contracts have no clock and no launch cost, and each first clear banks <b>${salvageHTML(milestone)}</b> — enough for <b>${upgradeById("reactor")!.name}</b> (${salvageHTML(reactor.cost)}), a bigger float for this exact bay.</p>
        </div>`;
  return `<div class="modal-scrim" id="scrim">
    <div class="coach coach--fail">
      <div class="coach__card">
        <div class="coach__eyebrow">Tutorial · ${bayName}</div>
        <div class="coach__title">${s.title}</div>
        <p class="coach__body">${s.body}</p>
        ${nextBlock}
        <div class="coach__foot coach__foot--fail">
          <button class="btn btn--primary btn--lg btn--block" data-action="coach-retry">${icon("retry", 13)}Try this bay again</button>
          <div class="row coach__foot-row">
            <button class="btn btn--secondary" data-action="contracts">View Contracts</button>
            <button class="btn btn--ghost" data-action="coach-skip-run">Skip tutorial</button>
            <button class="btn btn--ghost" data-action="menu">Menu</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * BAY CLEARED celebration — the beat between "the money landed" and "here are
 * your cards". Plays over the settled (not frozen-mid-flight) field, on top of
 * the canvas bayclear sweep FX (see render.ts's drawBayClearFx), then main.ts
 * advances to the refit/draft after BAY_CLEAR_MS — or immediately on a tap, so
 * a player who has seen it fifty times is never held up.
 *
 * Why this exists: the bay used to end the instant funds crossed the target,
 * mid-flight, with the draft modal appearing over pieces still in the air. The
 * player never got to see the line that won it pay out. Now the bay settles
 * (game.ts's resolveWin) and then explicitly celebrates.
 */
export const BAY_CLEAR_MS = 1700;

export function bayClearScreen(opts: {
  bayNum: number;
  bayName: string;
  funds: number;
  target: number;
  lines: number;
  scrap: number;
}): string {
  return `<div class="bayclear" id="bayclear" data-action="skip-bayclear">
    <div class="bayclear__rays" aria-hidden="true"></div>
    <div class="bayclear__card">
      <div class="eyebrow">Bay ${opts.bayNum} · ${opts.bayName}</div>
      <h2 class="bayclear__title display">BAY CLEARED</h2>
      <div class="bayclear__stats">
        <div class="stat"><b style="color:var(--accent)">$${opts.funds}</b><span>banked / ${opts.target}</span></div>
        <div class="stat"><b>${opts.lines}</b><span>lines</span></div>
        <div class="stat"><b style="color:var(--warn)">${scrapHTML(opts.scrap, 22)}</b><span>scrap</span></div>
      </div>
      <p class="muted bayclear__hint">tap to continue</p>
    </div>
  </div>`;
}

/**
 * REFIT STOP — the FTL layer's shop, opened after every third bay (see
 * run.ts's isRefitBay). Seven systems, three tiers each, priced in scrap. Every
 * track is always fully visible with its whole tier ladder spelled out, which
 * is deliberately the OPPOSITE of the mod draft: a draft is a hand you were
 * dealt, a refit is a plan you commit to, so the player needs to see the
 * long-term shape of each track to plan toward one.
 *
 * THE WORKSHOP'S SHELF, and for the Workshop's reason. This screen used to run
 * two columns of one-line rows whose only copy was the track's NAME and its
 * current setting — the sentence saying what a system actually does lived in
 * `blurb` and reached the player nowhere, and the whole tier ladder lived in a
 * `title` attribute, i.e. on hover, i.e. on the devices this game does not
 * ship to. A shop where you cannot read what you are buying is not a denser
 * shop; the Workshop settled that argument for itself and this is the same
 * shop. So: one column of `.shop-card` rows, whole copy, and the shelf scrolls
 * (it is already one of the harness's allowed scrollers).
 *
 * TAPPING STAGES, UNDOCKING BUYS. Every button used to be a purchase, which
 * made a "plan you commit to" a run of irreversible taps — to compare two
 * builds you had to buy one. Now a tap queues a tier into a REFIT ORDER
 * (upgrades.ts's RefitOrder), the order is free to revise, and Undock is the
 * one commit (run.ts's buyUpgrades).
 *
 * That is also what makes the projection worth drawing. Each card carries its
 * own before → after on the track it sells, and the panel beside the shelf
 * carries the whole ship's: every number the order moves, from the same
 * levelForRun pipeline the next bay is actually built from (preview.ts), so
 * the player prices the order in the bay's own units before paying for it.
 * Same panel, same tiles and same grammar as the ratchet draft two screens
 * later — the yard and the draft are the run's two commitment screens, and
 * they should read as one thing.
 */
export function refitScreen(opts: {
  bayNum: number;
  nextBayName: string;
  scrap: number;
  tiers: UpgradeTiers;
  /** The run's Mark — Mark 1 stops offer only Reactor Output (see
   *  upgrades.ts's refitTracks for the tuning rationale). */
  mark: number;
  /** Tiers STAGED but not yet paid for. Tentative: nothing here has touched
   *  RunState.tiers or spent a point of scrap until Undock commits it. */
  order: RefitOrder;
  /** The next bay as the ship stands vs. with the whole order installed — see
   *  preview.ts. Rendered live, so this is what makes staging worth having. */
  preview: PreviewRow[];
}): string {
  const tracks = refitTracks(opts.mark);
  const staged = orderSize(opts.tiers, opts.order);
  const spend = orderCost(opts.tiers, opts.order);
  /** What is left to stage AGAINST, not what the run still owns: the order has
   *  not been paid for, so the scrap is still in the pocket — but every button
   *  on the shelf has to price itself against the queue in front of it. */
  const left = opts.scrap - spend;

  const cards = tracks.map((u) => {
    const owned = Math.min(MAX_TIER, opts.tiers[u.id] ?? 0);
    const tier = orderedTier(opts.tiers, opts.order, u.id);
    const queued = tier - owned;
    const cost = nextTierCost(tier);
    // Pips read the ORDER: owned rungs are lit, queued ones pulse, and the
    // rest are dark. The card has to show the tier the projection beside it is
    // currently drawing, which is the staged one and not the paid one.
    const pips = Array.from({ length: MAX_TIER }, (_, i) =>
      `<i class="${i < owned ? "on" : i < tier ? "queued" : ""}"></i>`,
    ).join("");
    const step = cost === null ? null : u.step(tier);
    // ONE CONTROL PER CARD, cycling — the draft's own idiom for the same
    // problem (its cards fill the hand while there is room and edit it once it
    // is full). Two controls is what the tap floor cannot afford: at 44px a
    // second button per row costs a card's worth of height across the shelf,
    // on the screen that already needs a scroller to hold seven of them.
    //
    // So the button STAGES while the track has room and takes the track back
    // once it is ordered to MAX — and it stays live when the order has spent
    // the scrap but this track has rungs queued, because a disabled button on
    // a staged track is an order the player cannot undo.
    const canStage = cost !== null && step !== null && left >= cost;
    const undo = queued > 0 && !canStage;
    const buy =
      owned === 0
        ? `<span class="shop-card__locked">Not installed — buy it in the <b>Workshop</b></span>`
        : undo
          ? `<button class="btn btn--secondary refit-card__buy refit-card__undo" data-action="unstage-upgrade" data-upgrade="${u.id}">
              <span class="refit-card__arrow">${icon("close", 10)}</span>
              <span class="refit-card__delta">Undo${queued > 1 ? ` ×${queued}` : ""}</span>
              <span class="refit-card__price">+${icon("scrap", 11)}${orderCost(opts.tiers, { [u.id]: queued })}</span>
            </button>`
          : cost === null || step === null
            ? `<span class="refit-card__max">MAX</span>`
            : `<button class="btn btn--primary refit-card__buy" data-action="stage-upgrade" data-upgrade="${u.id}"${canStage ? "" : " disabled"}>
                <span class="refit-card__arrow">${icon(step.dir, 10)}</span>
                <span class="refit-card__delta">${step.text}</span>
                <span class="refit-card__price"><span class="refit-card__tier">T${tier + 1}<span class="price__sep">·</span></span>${icon("scrap", 11)}${cost}</span>
              </button>`;
    // The track's OWN before/after — absolute on both sides, because "+2 cells"
    // is only legible next to the number it moves. Unstaged, the card states
    // what the ship carries today and nothing more.
    const state = queued > 0
      ? `<span class="refit-card__from">${u.current(owned)}</span><span class="refit-card__to-arrow">→</span><span class="refit-card__to">${u.current(tier)}</span>`
      : `<span class="refit-card__now">${u.current(owned)}</span>`;
    // The ladder still ships in `title` for where hover exists, but it is no
    // longer the only place it is written down: the card's own copy and its
    // before/after carry the tiers a player can actually reach from here.
    const ladder = u.tiers.map((t, i) => `T${i + 1} ${t}`).join(" · ");
    return `<div class="shop-card refit-card${queued > 0 ? " refit-card--staged" : ""}${owned === 0 ? " shop-card--gated" : ""}" title="${u.name} — ${ladder}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(u.id as IconName, 13)}${u.name}</div>
        <p class="shop-card__desc">${u.blurb}</p>
        <div class="refit-card__step"><span class="refit-card__pips">${pips}</span>${state}</div>
      </div>
      <div class="shop-card__foot refit-card__foot">${buy}</div>
    </div>`;
  }).join("");

  // The scrap box is the yard's pinned constraint, exactly as the build budget
  // is the Workshop's: the usual reason a button on this shelf is greyed out is
  // that the ORDER has already spent the scrap, and a running total that
  // scrolled away from the cards it disables would be the one thing this pane
  // must not do. A readout and nothing else — clearing the order is each card's
  // own button (a "clear all" here would be a second control competing for the
  // tap floor with the one the cards already carry).
  const order = `<div class="refit__order" id="refit-order">
    <span class="refit__order-label">scrap to spend</span>
    <span class="refit__order-scrap">${scrapHTML(left, 16)}</span>
    <span class="refit__order-spend${staged > 0 ? "" : " refit__order-spend--idle"}">${
      staged > 0
        ? `${staged} staged<span class="price__sep">·</span>${scrapHTML(spend, 11)}`
        : "nothing staged"
    }</span>
  </div>`;

  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--refit pop" style="width:min(940px,96vw)">
      <div class="refit__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Mark ${opts.mark} · refit stop · after bay ${opts.bayNum}</div>
          <h2 class="display">Yard &amp; Dry Dock</h2>
          <p class="muted refit__blurb" style="margin:0">The compactor rig is your ship. Stage what you want; Undock installs the lot. Next up: ${opts.nextBayName}.</p>
        </div>
        ${order}
      </div>
      <div class="refit__body">
        <div class="refit__shelf" id="refit-grid" data-scroll>
          ${cards}
          ${
            tracks.length < UPGRADES.length
              ? `<p class="muted refit__short">Tier 1 refits focus the reactor — the rest of the yard opens at Tier 2.</p>`
              : ""
          }
        </div>
        ${projectionHTML(
          "refit-preview",
          `${opts.nextBayName} — projected`,
          staged > 0 ? `+${staged} staged` : "as it stands",
          opts.preview,
          staged > 0 ? "" : "Stage a refit and this redraws with what it does to the bay.",
        )}
      </div>
      <div class="refit__foot" id="refit-foot">
        <button class="btn btn--primary btn--block" data-action="refit-done">${
          staged > 0
            ? `Install ${staged}<span class="price__sep">·</span>${scrapHTML(spend, 11)} — undock →`
            : "Undock →"
        }</button>
        <p class="refit__foot-note muted">${
          staged > 0
            ? "Nothing is paid for until you undock — undo the order and the scrap stays banked."
            : "Tap a system to stage a tier. Nothing is paid for until you undock."
        }</p>
      </div>
    </div>
  </div>`;
}

/**
 * WORKSHOP — the meta layer, reached from the main menu between runs. Spends
 * SALVAGE (banked on tier completion — see meta.ts's tierSalvage/advanceTier)
 * on permanent unlocks.
 *
 * Note what these buy: an unlock adds an OPTION (a new modifier enters the
 * draft pool, a new consumable exists, the wind gets surveyed) rather than a
 * flat stat bump. That's the design constraint that keeps a veteran's run
 * harder-won than a beginner's rather than merely bigger-numbered, while still
 * making a run that died in bay 3 worth having played.
 */
/**
 * The Workshop.
 *
 * OWNED UNLOCKS DO NOT GET A CARD. They collapse into one compact strip, and
 * that is a deliberate inversion of what this screen used to do. It is a shop:
 * what you already own is reference, what you can buy is the merchandise, and
 * giving both the same 209px card meant the screen grew as the player
 * progressed — exactly backwards, and by eleven unlocks it was four screens of
 * scrolling on a landscape phone. Collapsing owned entries makes the Workshop
 * get SHORTER the further in you are, and puts the decision you actually came
 * here to make at the top.
 *
 * ONE COLUMN OF ROWS, whole copy, and the pane scrolls. The shelf used to run
 * as many columns as the width allowed, which meant every card's description
 * was clamped to one line and ellipsised — 90 of them across the device matrix,
 * i.e. every card on every device. The columns were bought to avoid scrolling,
 * and this pane is one of the three places allowed to scroll; trading the
 * sentence for a scrollbar it already had was the wrong way round.
 */
export function workshopScreen(meta: MetaState): string {
  // Marks BEATEN. `meta.mark` verbatim, and deliberately not markUnlocked() -
  // main.ts's onBuyUnlock enforces the gate against this same field, so any
  // derivation here would risk offering a button the purchase path refuses.
  const mark = meta.mark;
  // Retired unlocks (the mod-pool shelf — see meta.ts's UnlockDef.retired)
  // are never merchandise and never reference: they do nothing, so listing
  // them anywhere would be the dishonest shelf this filter removes.
  const live = UNLOCKS.filter((u) => !u.retired);
  const owned = live.filter((u) => meta.unlocks.includes(u.id));
  const forSale = live.filter((u) => !meta.unlocks.includes(u.id))
    .sort((a, b) => a.rank - b.rank || a.cost - b.cost);

  const cards = forSale
    .map((u) => {
      const available = unlockAvailable(u, meta.unlocks, mark);
      const affordable = meta.salvage >= u.cost;
      const gates = unlockGates(u, meta.unlocks, mark);
      // B6's grammar without a tier: an option is not a rung on a track, so
      // its price is just the salvage glyph and the number.
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-unlock" data-unlock="${u.id}"${affordable ? "" : " disabled"}>${icon("salvage", 11)}${u.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      // "Permanent" on every card (playtest feedback): the Workshop and the
      // mid-run Refit both sell upgrades, and nothing on screen said which
      // purchases outlive the run. This is the one that does.
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(u.id as IconName, 13)}${u.name} <span class="shop-card__tag">Permanent</span></div>
        <p class="shop-card__desc">${u.desc}</p>
      </div>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
    })
    .join("");

  const ownedStrip = owned.length
    ? `<div class="workshop__owned">
        <span class="workshop__owned-label">✓ Owned</span>
        ${owned.map((u) => `<span class="workshop__owned-item">${u.name}</span>`).join("")}
      </div>`
    : "";

  // ---- Systems -------------------------------------------------------------
  // Installs sit ABOVE the unlock cards: a system is permanent power the player
  // keeps, an unlock is an option that may or may not be dealt, and the shop
  // should lead with the one that is guaranteed to matter. The budget readout
  // rides on the section label because the cap, not the price, is what usually
  // stops a purchase here — a player staring at 400 salvage and a greyed card
  // needs to be told it is the Mark talking.
  // A11: the ONE next-step card — the cheapest system the player can both
  // reach and afford right now carries the badge and the warm border, so the
  // shelf answers "which of these should I buy" instead of just listing.
  // The shelf carries a track until the WORKSHOP is done with it, not until it
  // is owned: tier 1 is the install, tier 2 the uprate, and tier 3 belongs to
  // the refit stop's scrap. A card that vanished the moment a track was bought
  // is what left budgetForMark with nothing to gate — 140 points of reachable
  // loadout against a budget that climbs to 770.
  const onShelf = (i: InstallDef): boolean => (meta.loadout[i.id] ?? 0) < UPRATE_MAX_TIER;
  const nextId = INSTALLS.filter(onShelf)
    .filter((i) => installAvailable(meta, i) && meta.salvage >= uprateCost(i))
    .sort((a, b) => uprateCost(a) - uprateCost(b))[0]?.id;
  const installCards = INSTALLS.filter(onShelf)
    .map((i) => {
      const def = upgradeById(i.id)!;
      const owned = meta.loadout[i.id] ?? 0;
      const next = owned + 1;
      const cost = uprateCost(i);
      const available = installAvailable(meta, i);
      const affordable = meta.salvage >= cost;
      const gates = installGates(meta, i);
      // B6: one price grammar — "T1 · <salvage> 15", and now "T2 · 15" for the
      // same track's second rung. The button says which tier it buys in the
      // same words the refit yard's buy buttons use, with the one difference
      // that matters: this purchase is salvage, that one scrap.
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-install" data-install="${i.id}"${affordable ? "" : " disabled"}>T${next}<span class="price__sep">·</span>${icon("salvage", 11)}${cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      return `<div class="shop-card${available ? "" : " shop-card--gated"}${i.id === nextId ? " shop-card--next" : ""}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(i.id as IconName, 13)}${def.name}${i.id === nextId ? nextBadgeHTML() : ""}</div>
        <p class="shop-card__desc">${def.blurb} ${
          owned === 0
            ? `Installs at tier 1; the Workshop raises it to ${UPRATE_MAX_TIER}, refit stops to ${MAX_TIER}.`
            : `Owned at tier ${owned}. Tier ${MAX_TIER} is scrap, at a refit stop.`
        }</p>
      </div>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
    })
    .join("");

  const installedStrip = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) > 0)
    .map((i) => `<span class="workshop__owned-item">${upgradeById(i.id)!.name} ${"I".repeat(Math.min(MAX_TIER, meta.loadout[i.id] ?? 0))}</span>`)
    .join("");

  // ONE SHELF. The Systems/Options tabs are gone.
  //
  // They split the shop by a distinction the player does not have: both halves
  // are salvage, spent once, kept forever. What the split actually did was
  // hide merchandise — the tab bar had to carry per-tab COUNTS precisely
  // because, in its own words, "a tab that just says Options gives a player no
  // reason to look, and the cheapest unlock they can afford is behind it". A
  // shelf that needs a badge advertising the half you cannot see is one shelf
  // too many.
  //
  // Systems lead, which is the ordering the tab bar was already asserting by
  // putting them first: a system is power you are guaranteed to keep, an
  // option changes what a run may attempt. Same order, no click.
  const shelf = installCards + cards;
  const shelfEmpty = !shelf;

  // What you already have, at the FOOT of the shelf. Both strips used to ride
  // in the fixed aside beside it, and that was a fit bug waiting for a save
  // that owned anything: the aside cannot scroll (sim/uifit asserts it, and it
  // is not on the allowlist), so on a landscape phone a Mark-3 loadout ran its
  // five installed names straight down past the pane and level with Start Run.
  // The new `workshop-owned` fixture is what caught it — the old one was
  // `newMeta()` with three numbers on it, and owned nothing.
  //
  // Reference belongs where reference can scroll, and BELOW the merchandise:
  // the shop leads with what you can buy, exactly as the owned-collapse note
  // above argues, and the answer to "what do I already have" is one flick away
  // rather than in the way.
  const haveStrips =
    (installedStrip
      ? `<div class="workshop__owned"><span class="workshop__owned-label">✓ Installed</span>${installedStrip}</div>`
      : "") + ownedStrip;

  // The FIXED column, and now ONLY the budget. What stays pinned is what
  // CONSTRAINS a purchase — the cap the Mark sets is the usual reason a card is
  // greyed out, and scrolling it away from the cards it explains is the one
  // thing this pane must not do. Everything else in here was reference, and
  // reference does not need to be pinned; it needs to be readable, which is
  // what moving it into the scroller buys.
  const aside = `<aside class="workshop__aside">
        <div class="workshop__budget-box">
          <span class="workshop__aside-label">build budget</span>
          <span class="workshop__budget">${tiersCost(meta.loadout)}<span class="price__sep">/</span>${markBudget(meta)}</span>
        </div>
      </aside>`;

  return `<div class="screen neon-backdrop">
    <div class="workshop">
      <div class="workshop__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Between runs</div>
          <h2 class="display" style="font-size:var(--fs-h1)">Workshop</h2>
          <p class="muted workshop__blurb" style="margin:0">Tier milestones pay salvage — each first-clear Contract and run win banks a share. Spend it on options you didn't have before.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="chip chip--inline">
            <div class="chip__label">Salvage</div>
            <div class="chip__value" style="color:var(--warn)">${salvageHTML(meta.salvage, 16)}</div>
          </div>
          <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
        </div>
      </div>
      <div class="workshop__meta muted">${meta.runs} run${meta.runs === 1 ? "" : "s"} logged · deepest bay ${meta.bestBay || "—"} · ${
        // A11: the meta line carries tier progress, in the same grammar the
        // menu chip and the end modals use.
        (() => {
          const p = tierProgressFor(meta);
          return `Tier ${p.tier} — Deep Run ${p.runDone ? "✓" : "○"} · Contracts ${p.contracts}/${p.needed}${p.contracts >= p.needed ? " ✓" : ""}`;
        })()
      }</div>
      <div class="workshop__body">
        ${aside}
        <div class="workshop__shop" data-scroll>${
          shelfEmpty
            ? `<p class="muted" style="margin:0">Every system your tier allows is installed. Complete this tier to open the next one.</p>`
            : `<div class="workshop__grid">${shelf}</div>`
        }${haveStrips}</div>
      </div>
      <button class="btn btn--primary btn--lg" data-action="play" style="align-self:center">${icon("play")}Start Run</button>
    </div>
  </div>`;
}

/** `fullscreen` mirrors hudHTML's fullscreenSupported: false (the native
 *  shells, iPhone Safari) mounts no fullscreen row at all — the app is
 *  already edge-to-edge there, so the button would be a dead control.
 *
 *  `profile`/`owned` feed the control-reference block (pauseKeysHTML): the
 *  pause is the one screen a keyboard or pad player reliably visits when
 *  they are lost mid-bay, which makes it the right permanent home for the
 *  hints the transient strip retires from. Touch never sees the block (same
 *  CSS gates as the strip — the rail is touch's reference). */
export function pauseModal(
  fullscreen = true,
  profile: InputProfile = "keyboard",
  owned: { bond: boolean; demo: boolean; auto: boolean } = { bond: false, demo: false, auto: false },
): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal pop">
      <div class="eyebrow">Paused</div>
      <h2 class="display">Take a breath</h2>
      <div class="row">
        <button class="btn btn--primary" data-action="resume">Resume</button>
        ${fullscreen ? `<button class="btn btn--secondary" data-action="fullscreen" id="fullscreen-btn-modal">${icon("fullscreen", 14)} <span class="fs-label">Fullscreen</span></button>` : ""}
        <button class="btn btn--secondary" data-action="restart-bay">Restart Bay</button>
        <button class="btn btn--ghost" data-action="menu">Quit</button>
      </div>
      ${pauseKeysHTML(profile, owned)}
    </div>
  </div>`;
}

/**
 * The next-bay projection grid (preview.ts's rows) — one tile per row.
 *
 * Shared by the ratchet draft and the Final Inspection rather than written
 * twice: the two screens deliberately show the SAME projection of the same
 * config pipeline, and a second copy of this markup is how the two would
 * eventually disagree about which rows a phone drops.
 */
function previewGridHTML(rows: PreviewRow[]): string {
  return rows
    .map((r) => {
      const val = r.changed
        ? `<span class="preview-stat__from">${r.from}</span><span class="preview-stat__arrow">→</span><span class="preview-stat__to">${r.to}</span>`
        : `<span class="preview-stat__to">${r.from}</span>`;
      // An unmoved context row is the one class of tile a landscape phone can
      // afford to drop (app.css, at compact density) — it is neither the frame
      // the change is read against nor the change itself. An ACTIVE row is
      // never that class: its axis has banked notches, so the pressure is live
      // whatever this selection touches (previewRows promotes it to core), and
      // the tag says why the row refuses to leave (Codex #1 / canvas A12).
      const cls = r.changed ? ` preview-stat--${r.tone}` : r.kind === "context" ? " preview-stat--context" : "";
      // Both labels ship; app.css picks one by density. A landscape phone packs
      // this grid four across, and at ~63px of interior "Shots in the bank"
      // ellipsised to "S…" — with the ACTIVE tag beside it, four of the ten
      // tiles named nothing at all.
      const txt = `<span class="preview-stat__long">${r.label}</span><span class="preview-stat__short">${r.short}</span>`;
      const label = r.active
        ? `<span class="preview-stat__labeltxt">${txt}</span><span class="preview-stat__live">ACTIVE</span>`
        : txt;
      return `<div class="preview-stat${r.active ? " preview-stat--active" : ""}${cls}">
        <div class="preview-stat__label">${label}</div>
        <div class="preview-stat__val">${val}</div>
      </div>`;
    })
    .join("");
}

/**
 * THE PROJECTION PANEL — a titled block of before/after tiles.
 *
 * Shared by the three screens that ask the player to commit to a change and
 * then show them the numbers it moves: the ratchet draft, the Final Inspection
 * and the refit yard. One panel for all three because they ask the same
 * question ("what does this do to the bay I am about to fly?"), and because a
 * second copy of this markup is how they would eventually disagree about which
 * rows a phone drops.
 *
 * aria-live on the panel itself: the projection is the ANSWER to tapping a
 * card, and a screen-reader user who tapped one gets nothing back otherwise.
 */
function projectionHTML(
  id: string,
  title: string,
  note: string,
  rows: PreviewRow[],
  /** Shown under the grid when the screen has nothing selected yet — the yard
   *  uses it, the draft does not. A refit is the one of the three where an
   *  empty selection can leave the panel holding only the bay's priced five,
   *  and a half-empty box with no explanation reads as a screen that failed to
   *  load rather than one waiting for a tap. */
  idleHint = "",
): string {
  return `<div class="projection" id="${id}" aria-live="polite">
    <div class="projection__hd">
      <span>${title}</span>
      <span class="projection__note">${note}</span>
    </div>
    <div class="preview-grid">${previewGridHTML(rows)}</div>
    ${idleHint ? `<p class="projection__idle muted">${idleHint}</p>` : ""}
  </div>`;
}

/**
 * Ratchet modal shown between bays: freezes the just-cleared field behind a
 * scrim and asks which difficulty axis hardens for the rest of the run.
 *
 * This replaced the modifier draft, and the inversion is the point. A mod was a
 * hand you were DEALT — often with an upside, and skippable. A notch is pure
 * cost, mandatory, and permanent. There is deliberately no skip button: a draft
 * you can decline has a dominant option, and the design rests on the player
 * paying for the bay they just cleared.
 *
 * The reward is implicit, and it was bought in the Workshop. A system does not
 * delete a hazard, it makes ONE specific hazard cheap for you — so the question
 * this modal really asks is "what have you prepared for?", and the axis you are
 * equipped for is the one that costs you nothing. That is why every card names
 * the exact number a notch adds: the player is pricing a choice, and a vague
 * card turns a deliberate trade into a guess.
 *
 * Mark 10 asks for TWO picks (hazards.ts's picksPerBay); `selected` holds the
 * tentative hand so far, and the modal only commits when the player confirms.
 *
 * The cards SELECT, they do not commit. A tap used to be the decision — the
 * modal closed and the next bay started — which made a screen full of prose
 * ("Every launch costs $5 more") the only thing the player had to price the
 * notch by. It did not even read as a choice: two cards, no selected state, no
 * confirm. Now a tap toggles the card and the projection under it redraws with
 * the numbers the next bay would ACTUALLY be flown at (preview.ts, off the real
 * levelForRun pipeline), and a separate confirm button is the commitment. The
 * player can try both cards, read what each does to their float and their
 * clock, and only then spend the notch.
 *
 * Still no skip. Toggling is not declining: the confirm stays disabled until
 * the Mark's full quota is selected, so the ratchet remains the mandatory price
 * of the bay just cleared. What changed is that the price is now legible before
 * it is paid, not after.
 */
export function draftScreen(opts: {
  /** The 1-based bay just cleared. The bay about to be flown is bayNum + 1 —
   *  the draft only ever sits between consecutive bays, so the screen derives
   *  it rather than being handed a second number that could disagree. Bays are
   *  named by NUMBER alone here: the run's own screens already dropped the
   *  flavor names (the menu's tower, the HUD), and on this screen the name
   *  was one more string competing with the numbers the choice is priced in. */
  bayNum: number;
  /** The run's tier (its Mark, in player-facing words) — carried on the
   *  eyebrow so the draft states which rung's pressure is being priced. */
  tier: number;
  funds: number;
  /** Overshoot above this bay's target (0 if it ended right at target) —
   *  the only part of `funds` that actually carries into the next bay's
   *  float (see run.ts's advanceRun). */
  carry: number;
  offers: HazardDef[];
  /** Every notch taken across the run so far, for the running tally. */
  ratchets: Ratchets;
  /** Axes SELECTED at this draft but not yet confirmed. Tentative: nothing here
   *  has touched RunState.ratchets, and the tally/projection show it as pending
   *  rather than banked. */
  selected: HazardId[];
  /** How many notches this Mark demands before the next bay. */
  picksNeeded: number;
  /** The next bay's numbers as they stand vs. with `selected` folded in — see
   *  preview.ts. Rendered live, so this is what makes the toggle worth having. */
  preview: PreviewRow[];
  /** Unspent scrap — shown here too (not only at refit stops) so the player can
   *  see capital accumulating between stops and plan the next refit. */
  scrap: number;
  /** Bay-CLEARS until the next refit stop (1 = clearing the next bay docks
   *  you), or null when no stop remains this run. */
  baysToRefit: number | null;
  /** True on a forced-material hand (hazards.ts's isMaterialDraft): the
   *  partner card there is capped at one seat (togglePick), so its footer must
   *  say "undo" where an ordinary card's says "double". */
  forced?: boolean;
}): string {
  const banked = totalNotches(opts.ratchets);
  const pending = opts.selected.length;
  const remaining = Math.max(0, opts.picksNeeded - pending);
  const ready = remaining === 0;
  const nextBay = opts.bayNum + 1;
  const cards = opts.offers
    .map((h) => {
      const picks = opts.selected.filter((p) => p === h.id).length;
      // An axis already ratcheted says so on the card. Taking the same notch a
      // second time is a legitimate build, but it is a different decision from
      // taking it the first time, and the card has to admit which one it is.
      // The tentative picks count toward the badge too — the card has to show
      // the notch level the projection below it is currently drawing.
      const owned = (opts.ratchets[h.id] ?? 0) + picks;
      const stack = owned > 0 ? `<span class="mod-card__stack">at ${owned}</span>` : "";
      const kind = h.kind === "content" ? "bane" : "tradeoff";
      // The kind is said by the card's GLYPH and colour, not by a word: a
      // material card wears the material's own belt icon and bane red, a
      // number card wears the axis's two-letter tally glyph and tradeoff cyan
      // — the same two vocabularies the plant panel spends a whole run
      // teaching (components.ts's one-vocabulary rule).
      const badge = h.material
        ? materialIconHTML(h.material, 15)
        : axisGlyph(h.id);
      // The pick box is the card's selection state said as a control: empty
      // square, check when picked, ×N when double-picked. aria-pressed
      // carries the same fact to a screen reader.
      const box = picks > 1
        ? `<span class="mod-card__box mod-card__box--on">×${picks}</span>`
        : picks === 1
          ? `<span class="mod-card__box mod-card__box--on">${icon("check", 11)}</span>`
          : `<span class="mod-card__box" aria-hidden="true"></span>`;
      // The footer says what the NEXT tap does, which is not the same on every
      // card: taps fill the hand while there is room and edit it once it is
      // full (hazards.ts's togglePick) — and on a forced hand the partner card
      // is capped at one seat, so a second tap there undoes rather than
      // doubles.
      const canDouble = !ready && !(opts.forced && h.kind !== "content");
      const foot = picks > 0
        ? canDouble ? "Tap again to double it" : "Tap to undo"
        : ready
          ? "Tap to swap this in"
          : "Tap to preview";
      return `<button class="mod-card mod-card--${kind}${picks > 0 ? " mod-card--picked" : ""}"
        data-action="pick-hazard" data-hazard="${h.id}" aria-pressed="${picks > 0}">
        <div class="mod-card__top">
          <span class="mod-card__ax" aria-hidden="true">${badge}</span>
          <span class="mod-card__name">${h.name}</span>
          ${stack}
          ${box}
        </div>
        <p class="mod-card__desc">${h.desc}</p>
        <div class="mod-card__pick">${foot}</div>
      </button>`;
    })
    .join("");
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(940px,96vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared · Tier ${opts.tier}</div>
      <h2 class="display">${opts.picksNeeded > 1 ? `Ratchet ${opts.picksNeeded} axes` : "Ratchet one axis"}</h2>
      ${quotaHTML(pending, opts.picksNeeded, opts.offers.length, opts.selected.map((id) => {
        const h = opts.offers.find((o) => o.id === id);
        return {
          glyph: h?.material ? materialIconHTML(h.material, 12) : axisGlyph(id),
          kind: h?.kind === "content" ? "bane" : "tradeoff",
        };
      }), "sticks for the rest of the run")}
      <div class="draft__bank">
        ${statCellHTML("reactor", "Carry", `$${opts.carry} · ended $${opts.funds}`, "var(--accent)")}
        <div class="bay-stat">${icon("up", 14)}<span class="bay-stat__txt">
          <span class="bay-stat__lbl">Notches</span>
          <span class="bay-stat__val" style="--stat-tint:var(--danger)" id="draft-notches">${banked}${pending > 0 ? `<span class="chip__pending">+${pending}</span>` : ""}</span>
        </span></div>
        ${statCellHTML("scrap", `Scrap${
          opts.baysToRefit === null
            ? ""
            : opts.baysToRefit === 1
              ? " · refit next bay"
              : ` · refit in ${opts.baysToRefit}`
        }`, String(opts.scrap), "var(--warn)")}
      </div>
      <div class="draft__body">
        <div class="draft__cards" id="draft-cards">${cards}</div>
        ${projectionHTML(
          "draft-preview",
          `Bay ${nextBay} — projected`,
          pending > 0 ? "with your selection" : "as it stands",
          opts.preview,
        )}
      </div>
      <div class="draft__confirm" id="draft-confirm">
        <button class="btn btn--primary btn--block" data-action="confirm-hazards"${ready ? "" : " disabled"}>
          ${ready
            ? `Lock it in — launch Bay ${nextBay}`
            : pending === 0
              ? opts.picksNeeded === 1 ? "Pick an axis" : `Pick ${opts.picksNeeded} axes`
              : `Pick ${remaining} more · ${pending}/${opts.picksNeeded}`}
        </button>
        <p class="draft__confirm-note muted">${
          opts.picksNeeded > 1
            ? "The capstone costs two notches a bay — there is no skip. Pick the pressures you are equipped for."
            : "Every bay costs one notch — there is no skip. Pick the pressure you are equipped for."
        }</p>
      </div>
    </div>
  </div>`;
}

/**
 * The draft's pick quota, said as SLOTS — "pick 2 of 3" as two empty boxes
 * beside the count, each box filling with the picked axis's own glyph in its
 * own kind colour as the hand fills.
 *
 * This row exists because the screen did not read as a choice. The title said
 * "Ratchet 2 axes" and the confirm said "Select 2 axes", and playtest still
 * asked whether the cards were three problems or three options — a quota
 * stated only in words looks like a headline, where an empty slot is a hole
 * the eye wants filled. It also carries the "sticks for the rest of the run"
 * warning, which replaced a whole subtitle line.
 */
function quotaHTML(
  pending: number,
  need: number,
  offered: number,
  filled: { glyph: string; kind: string }[],
  /** The stakes, in five words or so — the ratchet's "sticks for the rest of
   *  the run" against the inspection's "rides on the last bay". */
  note: string,
): string {
  const slots = Array.from({ length: need }, (_, i) => {
    const f = filled[i];
    return f
      ? `<span class="draft__slot draft__slot--filled draft__slot--${f.kind}">${f.glyph}</span>`
      : `<span class="draft__slot"></span>`;
  }).join("");
  // The count lives on the INNER slots row, not the container: main.ts's
  // toggle patch swaps #draft-quota's innerHTML, so a label on the container
  // would go stale on the first tap.
  // "Pick 2 of 2" would read as no choice at all, and at the capstone it is
  // not the truth either: two picks over two cards is a three-way choice —
  // one of each, or either card doubled (hazards.ts's togglePick). Say that.
  const ask = need < offered
    ? `Pick ${need} of ${offered}`
    : need > 1
      ? `${need} picks — split or double up`
      : `Pick ${need} of ${offered}`;
  return `<div class="draft__quota" id="draft-quota">
    <span class="draft__quota-n">${ask}</span>
    <span class="draft__slots" role="img" aria-label="${pending} of ${need} picked">${slots}</span>
    <span class="draft__quota-note muted">${note}</span>
  </div>`;
}

/**
 * FINAL INSPECTION — the run's LAST draft (game/finals.ts).
 *
 * Deliberately the same modal shell as draftScreen: same scrim, same bank
 * chips, same projection grid, same confirm. The moment in the loop is
 * identical (a bay cleared, a cost accepted, the next bay begun) and a player
 * who has read nine of these should not have to re-learn the screen on the
 * tenth. What changes is the hand and what the copy claims about it — two
 * clauses instead of N axes, ONE pick at every Tier, and no promise that the
 * cost sticks, because there is nothing left for it to stick to.
 *
 * Each card names the ship system the clause is about (FinalDef.system). That
 * is the one piece of information this screen carries that the ratchet draft
 * does not, and it is here because the inspection is the moment the Tier's
 * whole argument gets settled: a player who never connected "this Tier keeps
 * throwing weather at me" to "so buy the Launcher" is told it once, on the last
 * screen where it can still mean something.
 */
export function finalScreen(opts: {
  /** The 1-based bay just cleared — the final bay is bayNum + 1, derived for
   *  the same reason draftScreen derives it. Numbers only, no bay names. */
  bayNum: number;
  /** The run's Tier — which pair is on the table. */
  tier: number;
  funds: number;
  carry: number;
  /** The two clauses. Exactly two at every Tier (finals.ts's finalsForTier). */
  offers: FinalDef[];
  /** The clause selected but not yet accepted, or null. */
  selected: string | null;
  /** The final bay's numbers as they stand vs. with `selected` folded in. */
  preview: PreviewRow[];
  scrap: number;
}): string {
  const ready = opts.selected !== null;
  const nextBay = opts.bayNum + 1;
  const cards = opts.offers
    .map((f) => {
      const picked = opts.selected === f.id;
      const sys = upgradeById(f.system);
      const box = picked
        ? `<span class="mod-card__box mod-card__box--on">${icon("check", 11)}</span>`
        : `<span class="mod-card__box" aria-hidden="true"></span>`;
      const foot = picked
        ? "Accepted — tap to undo"
        : ready
          ? "Tap to take this one instead"
          : "Tap to preview";
      // The badge is the SHIP SYSTEM the clause examines (FinalDef.system) —
      // its icon in the corner and its name on the pill, because the
      // inspection is the moment the Tier's whole argument gets settled and a
      // player who never made the connection is told it here, once.
      return `<button class="mod-card mod-card--final${picked ? " mod-card--picked" : ""}"
        data-action="pick-final" data-final="${f.id}" aria-pressed="${picked}">
        <div class="mod-card__top">
          <span class="mod-card__ax" aria-hidden="true">${icon(f.system as IconName, 13)}</span>
          <span class="mod-card__name">${f.name}</span>
          ${box}
        </div>
        ${sys ? `<div class="mod-card__kind">${sys.name}</div>` : ""}
        <p class="mod-card__desc">${f.desc}</p>
        <div class="mod-card__pick">${foot}</div>
      </button>`;
    })
    .join("");
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(940px,96vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared · Tier ${opts.tier}</div>
      <h2 class="display">Final Inspection</h2>
      ${quotaHTML(ready ? 1 : 0, 1, opts.offers.length,
        ready ? [{ glyph: icon("check", 11), kind: "final" }] : [],
        `rides on Bay ${nextBay} — the last bay — only`)}
      <div class="draft__bank">
        ${statCellHTML("reactor", "Carry", `$${opts.carry} · ended $${opts.funds}`, "var(--accent)")}
        <div class="bay-stat">${icon("bond", 14)}<span class="bay-stat__txt">
          <span class="bay-stat__lbl">Clause</span>
          <span class="bay-stat__val" style="--stat-tint:var(--accent-2)" id="draft-notches">${ready ? "1" : "0"}/1</span>
        </span></div>
        ${statCellHTML("scrap", "Scrap · no refit left", String(opts.scrap), "var(--warn)")}
      </div>
      <div class="draft__body">
        <div class="draft__cards draft__cards--pair" id="draft-cards">${cards}</div>
        ${projectionHTML(
          "draft-preview",
          `Bay ${nextBay} — projected`,
          ready ? "with the clause" : "as it stands",
          opts.preview,
        )}
      </div>
      <div class="draft__confirm" id="draft-confirm">
        <button class="btn btn--primary btn--block" data-action="confirm-hazards"${ready ? "" : " disabled"}>
          ${ready ? `Sign it — launch Bay ${nextBay}` : "Take a clause"}
        </button>
        <p class="draft__confirm-note muted">Both clauses cost about the same. Which one costs YOU less is what your refits decided.</p>
      </div>
    </div>
  </div>`;
}

/**
 * Full-screen animated backdrop for the two "economic" losses — pure CSS
 * (app.css's .lose-fx rules), pointer-events: none, rendered inside the
 * scrim BEHIND the modal panel. "time": a giant draining clock ring with a
 * fast-spinning hand that stops at 12. "broke": a rain of tumbling $ coins.
 * Topout keeps the plain scrim — the pile hitting the ceiling is its own
 * visual. Coin spread/delays are inline per-coin (a fixed multiplicative
 * scatter, no randomness) so the rain fills the screen from frame one.
 */
function loseFxHTML(reason: LossReason): string {
  if (reason === "time") {
    return `<div class="lose-fx lose-fx--time" aria-hidden="true">
      <div class="lose-fx__vignette"></div>
      <svg class="lose-fx__clock" viewBox="0 0 100 100">
        <circle class="ring" cx="50" cy="50" r="44"/>
        <line class="hand" x1="50" y1="50" x2="50" y2="14"/>
      </svg>
    </div>`;
  }
  if (reason === "broke") {
    const coins = Array.from({ length: 16 }, (_, i) => {
      const left = (i * 137) % 100;
      const delay = ((i * 73) % 26) / 10;
      const dur = 2.2 + (i % 5) * 0.35;
      const size = 20 + (i % 3) * 9;
      return `<span class="lose-fx__coin" style="left:${left}%;font-size:${size}px;animation-duration:${dur}s;animation-delay:-${delay}s">$</span>`;
    }).join("");
    return `<div class="lose-fx lose-fx--broke" aria-hidden="true">
      <div class="lose-fx__vignette"></div>${coins}</div>`;
  }
  return "";
}

/**
 * Tier S's replacement for the tier-progress row.
 *
 * The row it replaces exists to answer "what did that run do for me". For a
 * sandbox run the honest answer is "nothing, by design", and saying it plainly
 * is the point rather than an apology: the mode is worth flying BECAUSE
 * nothing it does can cost or credit anything, and a player who is not sure of
 * that will keep treating practice as a risk.
 *
 * It still prints scrap and the refit, because those did happen inside the run
 * and are how the build read on the way out — they simply died with it, as
 * they do in every run.
 */
function sandboxEndRowHTML(
  setup: string, scrapEarned: number, tiers: UpgradeTiers, demoFoot: string,
): string {
  return `<div class="salvage-row salvage-row--sandbox">
    <div class="salvage-row__amt salvage-row__amt--sandbox">S</div>
    <div class="salvage-row__body">
      <b>Tier S — practice run</b>
      <span class="muted">${setup ? `${setup}. ` : ""}No salvage, no tier progress, no mark on the ladder. The score goes to the <b>Tier S board</b>.</span>
      <span class="muted salvage-row__foot">${scrapEarned} scrap earned · ${tiersCost(tiers)} refitted into the ship${demoFoot}</span>
    </div>
    <button class="btn btn--secondary" data-action="sandbox">Reconfigure</button>
  </div>`;
}

export function endModal(opts: {
  won: boolean;
  /** Composite final run score (run.ts's finalRunScore) — bays + lines +
   *  leftover funds, NOT the raw ending bankroll. */
  score: number;
  lines: number;
  /** Bays fully cleared (0 if the run died in bay 1) — the ×SCORE_PER_BAY
   *  term in the breakdown line. */
  baysCleared: number;
  /** Funds in hand when the run ended — the tie-breaker term. */
  funds: number;
  best: number;
  name: string;
  rows: string;
  /** Why the run ended in a loss ("topout" keeps the classic path). Unused when won. */
  reason?: LossReason | null;
  /** 1-based bay the run reached (cleared, if won+runComplete; attempted, if lost). */
  bayNum: number;
  bayName: string;
  /** True only for the bay-10 win — every other win routes to draftScreen instead. */
  runComplete: boolean;
  /** The tier this run's end just COMPLETED (meta.ts's recordRunEnd), or null
   *  when it only ticked progress. */
  tierCompleted: number | null;
  /** Salvage THIS run's end banked — the run-win milestone share, plus the
   *  completion remainder when tierCompleted fired (see meta.ts's tier
   *  milestone notes). Can be positive with tierCompleted null: a first win
   *  at the tier banks its share even while Contracts are still owed. */
  tierSalvage: number;
  /** Where the (possibly new) current tier stands after this run. */
  progress: TierProgress;
  /** The run was flown from Tier S (run.ts's RunState.sandbox). Swaps the tier
   *  progress row for the sandbox's own, and the actions for ones that lead
   *  back into the mode — a sandbox run has no next rung to offer. */
  sandbox?: boolean;
  /** What the sandbox run was configured as, for the row above ("Mark 7 · bay
   *  4 · 2 notches"). Ignored unless `sandbox`. */
  sandboxSetup?: string;
  salvageTotal: number;
  /** Scrap earned across the run and the ship it bought — so the build reads as
   *  an investment on the way out, not just a row of chips that vanished. */
  scrapEarned: number;
  /** Funds demolition charges refunded across the run (run.ts's
   *  RunState.salvagedFunds). Worded as FUNDS on the way out, never as
   *  "salvage": that word is the Workshop's permanent currency, and the two
   *  sitting on the same foot line would read as one number counted twice. */
  salvagedFunds: number;
  tiers: UpgradeTiers;
  /** The board this score posts to — the RUN's own Mark (RunState.mark), never
   *  `progress.tier`: a run that completed its tier has already advanced the
   *  Mark by the time this renders, and the score belongs to the tier it was
   *  actually flown at. */
  /** The board this run's score lands on (lib/api.ts's BoardId): the run's own
   *  Tier, or BOARD_SANDBOX for Tier S. */
  boardTier: number;
}): string {
  const title = opts.runComplete ? "Run Complete!" : opts.won ? "Level Cleared!" : "Game Over";
  // Demolition recovery, appended to whichever foot line the branch below
  // renders. Suppressed at zero rather than printed as "$0": a charge is a
  // draft pick most runs never make, so the line would be dead weight on the
  // majority of end screens — and the foot is already the densest row here.
  const demoFoot = opts.salvagedFunds > 0 ? ` · $${opts.salvagedFunds} recovered by demolition` : "";
  const eyebrow = opts.runComplete
    ? `All ${RUN_LEVELS} bays cleared`
    : opts.won
      ? "Launch Bay complete"
      : opts.reason === "broke"
        ? "Out of funds — the bay stays unpaid"
        : opts.reason === "time"
          ? "Time's up — the bay went dark"
          : opts.reason === "launches"
            ? "Out of launches — the bay is done"
            : "The compactor won this round";
  // WHY + WHAT TO TRY — playtest feedback: the themed eyebrow tells the mood
  // but not the mechanic, so a new player couldn't say whether they lost to
  // time or money, or what to change next run. One plain sentence for the
  // cause, one concrete adjustment. Only on a loss; a win explains itself.
  // Cause only, no advice. The "Try next time:" line that used to follow each
  // of these restated the rules to someone who had just spent a whole run
  // learning them, on the one screen where they are least able to act on it —
  // and it was the block pushing the score row and its breakdown down the
  // panel. Dropped rather than shortened: a tip nobody reads is not improved
  // by being briefer. The tips are gone from the table too, so this stays a
  // map of reason -> cause and cannot rot into a pair whose second half is
  // never rendered.
  const lossWhy: Record<string, string> = {
    broke: "You spent all your Funds on launches before reaching the target.",
    time: "The clock ran out before your Funds reached the target.",
    launches: "You used up every launch before hitting the goal.",
    topout: "The pile reached the ceiling.",
  };
  const why = !opts.won && opts.reason ? lossWhy[opts.reason] : null;
  const loseFx = !opts.won && opts.reason ? loseFxHTML(opts.reason) : "";
  // Three top-level regions, always emitted in this order. A tall viewport
  // grids them into ONE column, which reproduces the original reading order
  // (outcome, submit, board, actions). A short landscape viewport grids them
  // into two, with the actions moving under the outcome so the board gets the
  // full column height — see app.css's `.end` rules.
  // `end--why` marks the losses that carry the plain-language cause block, so
  // the short-viewport rules can drop the themed eyebrow — which on those runs
  // is a second, moodier statement of the same cause — without touching wins,
  // where the eyebrow is the only status line there is.
  return `<div class="modal-scrim" id="scrim">
    ${loseFx}
    <div class="panel modal end pop${why ? " end--why" : ""}">
      <div class="end__main">
      <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--danger)"}">${eyebrow}</div>
      <h2 class="display">${title}</h2>
      ${!opts.won ? `<p class="muted end__where">Made it to Bay ${opts.bayNum}/${RUN_LEVELS} — ${opts.bayName}</p>` : ""}
      ${
        why
          ? `<div class="end__why"><p>${why}</p></div>`
          : ""
      }
      <div class="stat-row">
        <div class="stat"><b style="color:var(--accent)">${opts.score}</b><span>Score</span></div>
        <div class="stat"><b>${opts.lines}</b><span>Lines</span></div>
        <div class="stat"><b style="color:var(--piece-o)">${opts.best}</b><span>Best</span></div>
      </div>
      <div class="muted end__breakdown">
        ${opts.baysCleared} bay${opts.baysCleared === 1 ? "" : "s"} ×${SCORE_PER_BAY}
        · ${opts.lines} line${opts.lines === 1 ? "" : "s"} ×${SCORE_PER_LINE}
        · $${Math.max(0, opts.funds)} left
      </div>
      <!-- AWARDS ONLY. The "Tier N progress" banner that used to sit here —
           ✓/○ pips in prose, "finish both to open Tier N+1", a foot of scrap
           and refit totals — is gone: the owner's device pass read it as a
           block nobody reads on the one screen the player wants to leave.
           What survives is NEWS — salvage this end banked — and Tier S's own
           row, which exists to say practice banks nothing. The ladder's
           standing lives where the player can act on it instead: the menu's
           Contracts button wears the tier's contract pips (menuScreen), and
           the Contracts board keeps its tier chip. -->
      ${
        opts.sandbox
          ? sandboxEndRowHTML(opts.sandboxSetup ?? "", opts.scrapEarned, opts.tiers, demoFoot)
          : opts.tierCompleted !== null
          ? `<div class="salvage-row salvage-row--tier-done">
        <div class="salvage-row__amt">${salvageHTML(`+${opts.tierSalvage}`, 16)}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.tierCompleted} complete!</b>
          <span class="muted">Run beaten and ${opts.progress.needed} Contracts cleared — Tier ${opts.progress.tier} is open. <b>${opts.salvageTotal} salvage banked</b>, yours to keep.</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
          : opts.tierSalvage > 0
            ? `<div class="salvage-row">
        <div class="salvage-row__amt">${salvageHTML(`+${opts.tierSalvage}`, 16)}</div>
        <div class="salvage-row__body">
          <b>Salvage banked</b>
          <span class="muted">First run win at Tier ${opts.progress.tier} — ${opts.salvageTotal} salvage total.</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
            : ""
      }
      ${
        // A15: a completed tier's end names what the NEXT rung actually
        // changes — truthfully. A Mark no longer scales the ladder's numbers
        // (level.ts's zeroed MARK_*_STEP), so what a tier opens is a hazard
        // axis and a bigger build budget, and that is what the line says.
        !opts.sandbox && opts.runComplete && opts.tierCompleted !== null
          ? `<p class="muted end__next">Tier ${opts.progress.tier}: ${
              (() => {
                const opened = HAZARDS.find((h) => h.mark === opts.progress.tier);
                return opened ? `${opened.name} joins the draft, and ` : "";
              })()
            }the build budget rises to ${budgetForMark(opts.progress.tier)}.</p>`
          : ""
      }
      </div>
      <div class="end__side">
        <div class="eyebrow">${opts.boardTier === BOARD_SANDBOX ? "Tier S" : `Tier ${opts.boardTier}`} board</div>
        <div class="submit-row" id="submit-row">
          <input class="name-input" id="name-input" maxlength="12" placeholder="YOUR NAME"
            value="${opts.name}" autocomplete="off" spellcheck="false" />
          <!-- Secondary, not primary (B2): the screen's one forward move is
               the restart button below — submitting a score is a sideways
               action, and two primaries made the exit compete with it. -->
          <button class="btn btn--secondary" data-action="submit-score">Submit</button>
        </div>
        <div id="lb-body" data-scroll>${opts.rows}</div>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="restart">${
          // A15: the bay-10 primary carries the tier plate (the 26px size of
          // the one component) and names the rung it flies next.
          //
          // A sandbox run's primary re-flies the SAME configuration, which is
          // what practice is: main.ts's restart routes on RunState.sandbox, so
          // this button never has to know which mode it is in.
          opts.sandbox
            ? "Fly it again"
            : opts.runComplete
              ? `${tierPlateHTML(opts.progress.tier, "button")}Run Tier ${opts.progress.tier} →`
              : "Play Again"
        }</button>
        ${
          // Back to the bench, not to the menu — the thing a player wants
          // after a practice run is almost always the next configuration, and
          // routing that through the home screen puts a tower and a nine-tap
          // door between them and it.
          opts.sandbox
            ? `<button class="btn btn--secondary" data-action="sandbox">Tier S</button>`
            : ""
        }
        <button class="btn btn--ghost" data-action="menu">Menu</button>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
 * CONTRACTS — the generated, retryable half (see game/contracts.ts).
 * ------------------------------------------------------------------------ */

/** The day's Contract board. Failure costs nothing here, so the copy leans on
 *  "pick one and try it" rather than warning the player about anything.
 *
 *  The board is three offers to COMPARE, not three paragraphs to read, so every
 *  card states the same two facts in the same two slots — the goal, then what
 *  you get to reach it — and the badge above them names which kind of supply
 *  that second slot is. The old card wrote each kind as its own sentence
 *  ("4 lines in 17 launches" beside "O×4 → 2 lines"), which put the goal in a
 *  different place on each card and made the row unscannable.
 *
 *  Everything that was identical on all three cards has moved out of them. The
 *  reward terms ("First clear counts toward Tier 1 · fail free, retry free")
 *  were repeated verbatim three times, were the widest line in each card, and
 *  wrapped to two lines to say something about the SCREEN — they join the WHY
 *  strip as one footnote, and the salvage a first clear actually banks rides on
 *  the card as a value instead, which is the part that differs once the tier's
 *  quota is full.
 *
 *  The board is also its own block rather than a borrowed layout. It used to
 *  reuse the How to Play deck's horizontal SNAP ROW, which put two of the three
 *  offers off-screen behind a sideways scroll — and a board you have to swipe to
 *  see is a board you cannot compare. (That row is gone from How to Play too
 *  now, for a related reason: see guideScreen.) Three cards fit the width they
 *  are given; nothing here scrolls in either axis. */
export function contractsScreen(opts: {
  contracts: ContractCard[];
  tier: number;
  /** Every Contract id ever cleared (meta.claimedContracts), not just today's —
   *  an id embeds its daily seed, so only today's can match today's board and
   *  the caller doesn't have to prune. Shown as a tick rather than hidden, so
   *  the board reads as progress rather than a shrinking list. */
  cleared: string[];
  /** Current tier standing, for the board header — Contracts are one of the
   *  two halves that complete a tier (meta.ts), and this screen is where the
   *  player decides whether to play one, so the count belongs here. */
  progress?: TierProgress;
  /** The cheapest installable system, for the WHY strip's target price (A9). */
  nextInstall?: { name: string; cost: number } | null;
}): string {
  // Whether a first clear still banks anything. A tier pays its milestone share
  // for only the first TIER_CONTRACTS_REQUIRED Contracts (meta.ts), so once the
  // quota is full the remaining cards are practice — and saying so on the card
  // is the one piece of reward copy that is worth per-card space.
  const paying = !opts.progress || opts.progress.contracts < opts.progress.needed;
  const cards = opts.contracts
    .map((c, i) => {
      const done = opts.cleared.includes(c.id);
      // A pattern Contract advertises its exact inventory, because the whole
      // offer is "here is what you get — can you place it?". Knowing the set
      // before you accept is the planning the mode is made of. A lines Contract
      // advertises its launch budget for the same reason: it is the only thing
      // that can run out.
      const supply =
        c.kind === "pattern"
          ? queueTallyHTML(c.queue)
          : `<b>${c.launches}</b> launches`;
      // No progress data (the prop is optional) means no claim either way — the
      // slot goes empty rather than asserting "Practice", which would be wrong
      // for a player whose tier quota is in fact still open.
      const state = done
        ? `<span class="contract-card__state contract-card__state--done">✓ Cleared</span>`
        : !opts.progress
          ? ""
          : paying
            ? `<span class="contract-card__state contract-card__state--pays">${salvageHTML(`+${opts.progress.milestone}`)}</span>`
            : `<span class="contract-card__state">Practice</span>`;
      return `<button class="contract-card${done ? " contract-card--done" : ""}" data-action="contract" data-slot="${i}">
        <span class="contract-card__top">
          <span class="contract-card__kind">${c.kind === "pattern" ? "Pattern" : "Lines"}</span>
          ${state}
        </span>
        <span class="contract-card__name">${c.name}</span>
        <span class="contract-card__ask">
          <b class="contract-card__goal">${c.goal}</b>
          <span class="contract-card__unit">line${c.goal === 1 ? "" : "s"}</span>
        </span>
        <span class="contract-card__supply">
          <span class="contract-card__supply-lbl">${c.kind === "pattern" ? "Supply" : "Budget"}</span>
          <span class="contract-card__supply-val">${supply}</span>
        </span>
        <span class="contract-card__brief">${c.brief}</span>
      </button>`;
    })
    .join("");
  // Tier standing as the menu's tier chip rather than a sentence. The line it
  // replaces ran ~120 characters, wrapped on a landscape phone, and mixed three
  // different things — the two halves, the milestone payout and the unlock
  // condition — into one run of prose. The halves are a status readout, so they
  // get the readout shape the menu already uses for them, and the payout is now
  // a value on each card.
  const tierChip = opts.progress
    ? `<div class="chip chip--tier">
        <div class="chip__label">Tier</div>
        <div class="chip__value" style="color:var(--accent)">${opts.progress.tier}</div>
        <div class="tier-chip__halves">
          <span class="${opts.progress.runDone ? "done" : ""}">${opts.progress.runDone ? "✓" : "○"} Run</span>
          <span class="${opts.progress.contracts >= opts.progress.needed ? "done" : ""}">${opts.progress.contracts >= opts.progress.needed ? "✓" : "○"} Contracts ${opts.progress.contracts}/${opts.progress.needed}</span>
        </div>
      </div>`
    : "";
  // A9's WHY strip and the terms, as one line under the board — the terms used
  // to be a third copy of themselves on each card, and the two lines were
  // answering the same question from either end ("what does this cost me" and
  // "what is it for"). The A9 half is unchanged: the tier's total in its own
  // numbers, against the price of the thing it buys next.
  const foot = opts.progress
    ? `<p class="muted contracts__foot">${nextBadgeHTML("Why")} Fail free, retry free — and ${opts.progress.needed} first clears bank ${
        salvageHTML(opts.progress.milestone * opts.progress.needed)
      }${
        opts.nextInstall
          ? `, so ${opts.nextInstall.name} (${salvageHTML(opts.nextInstall.cost)}) is waiting in the Workshop before your next run`
          : " toward the Workshop"
      }.</p>`
    : `<p class="muted contracts__foot">Fail free, retry free — a cleared Contract stays replayable.</p>`;
  return `<div class="screen neon-backdrop">
    <div class="contracts">
      <div class="contracts__hdr">
        <div class="contracts__title">
          <!-- The tier lives in the chip opposite when there is one, so the
               eyebrow does not repeat it — it only names the thing the chip
               cannot, which is that the board is regenerated every day. -->
          <div class="eyebrow">${opts.progress ? "Resets daily" : `Tier ${opts.tier} · resets daily`}</div>
          <h2 class="display">Contracts</h2>
          <p class="contracts__sub muted">No rush, do it right.</p>
        </div>
        <div class="contracts__hdr-side">
          ${tierChip}
          <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
        </div>
      </div>
      <div class="contracts__board">${cards}</div>
      ${foot}
    </div>
  </div>`;
}

/** Just the fields the board needs, so screens.ts doesn't import the generator. */
export interface ContractCard {
  id: string;
  name: string;
  kind: "lines" | "pattern";
  goal: number;
  launches: number;
  /** The exact inventory, for a pattern Contract. Empty otherwise. */
  queue: PieceType[];
  brief: string;
}

/**
 * A shipment multiset as a compact tally — `I×3 O×1`, each letter in its own
 * piece colour. Used everywhere a pattern Contract's set is stated: the card
 * (what you're accepting), the HUD (what's left), the end screen (what you
 * had). One renderer so those three can never disagree about the same set.
 *
 * Text rather than piece glyphs on purpose: at 5-8 shipments a row of little
 * shape grids reads as decoration, while a tally reads as an inventory — and
 * an inventory is the thing being planned against.
 */
export function queueTallyHTML(queue: readonly PieceType[]): string {
  if (!queue.length) return `<span class="muted">—</span>`;
  return PIECE_TYPES.filter((t) => queue.includes(t))
    .map((t) => {
      const n = queue.filter((q) => q === t).length;
      return `<span style="color:${PIECE_COLORS[t]};font-weight:700">${t}</span>×${n}`;
    })
    .join(" ");
}

/**
 * DRILL RESULT — the end of a guide drill (game/drills.ts).
 *
 * Deliberately the SMALLEST end card in the app, and deliberately not
 * contractEndModal with the payout row deleted. A Contract's end card exists to
 * settle an economy: what banked, what the tier still owes, what the salvage
 * buys next. A drill settles nothing — it banks no salvage, ticks no tier,
 * records no run — so every one of those rows would be a row saying "nothing
 * happened", which reads as a failure rather than as a lesson finishing.
 *
 * What it says instead is the only thing a drill has to: whether the lesson
 * landed, and the two ways out. The topic name is the eyebrow so the card
 * points back at the paragraph it came from — a player who has just watched a
 * row refuse to sell wants to re-read WHY, and "Cryo" over the verdict is the
 * shortest route back to it.
 */
export function drillEndModal(opts: {
  won: boolean;
  /** The drill's own name — "Cold Chain", not the topic's. */
  name: string;
  /** The guide topic it teaches, for the eyebrow and the way back. */
  topic: string;
  lines: number;
  goal: number;
  shotsUsed: number;
  /** 0 when the drill has no launch budget (the timed and economy ones). */
  launches: number;
  /** The lesson's one line, repeated: a player who just failed it is exactly
   *  the player who did not finish reading it the first time. */
  brief: string;
}): string {
  const budget = opts.launches > 0
    ? `<div class="stat"><b style="color:var(--warn)">${Math.min(opts.launches, opts.shotsUsed)}/${opts.launches}</b><span>Launches</span></div>`
    : `<div class="stat"><b style="color:var(--warn)">${opts.shotsUsed}</b><span>Launches</span></div>`;
  const stats = `<div class="stat-row">
      ${opts.goal > 0 ? `<div class="stat"><b style="color:var(--accent)">${opts.lines}/${opts.goal}</b><span>Lines</span></div>` : ""}
      ${budget}
    </div>`;
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--warn)"}">${opts.topic} · Drill</div>
        <h2 class="display">${opts.won ? "Lesson Landed" : "Run It Again"}</h2>
        <p class="muted" style="margin-top:-6px">${opts.won ? `${opts.name} cleared. Nothing was banked and nothing was spent — a drill never touches your save.` : opts.brief}</p>
        ${stats}
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="drill-retry">${icon("retry", 12)}Try Again</button>
        <button class="btn btn--ghost" data-action="drill-exit">Back to Guide</button>
      </div>
    </div>
  </div>`;
}

/**
 * End-of-Contract modal — built from the ONE end-screen skeleton (canvas A10/
 * A15): eyebrow, display title, `.stat-row`, `.salvage-row`, one
 * `.end__actions` row. These are the run-end modal's own parts, so the two
 * ways a session ends read as one family; `.end--contract` drops only the
 * geometry the run modal grids around its leaderboard column, because there
 * is no leaderboard here. The old bespoke `.ce__*` layout is gone.
 *
 * Win and loss are still genuinely different screens: on a win the outcome is
 * the headline, the payout is stated plainly in the salvage row (with the
 * price it is walking toward, when the caller knows one — A10's "state the
 * target"), and the primary action moves forward. On a loss the primary is
 * the retry, and the margin missed by is the whole feedback.
 */
export function contractEndModal(opts: {
  won: boolean;
  name: string;
  kind: "lines" | "pattern";
  lines: number;
  goal: number;
  launchesUsed: number;
  launches: number;
  /** Pattern only: the exact set the attempt was given, and how many cubes went
   *  somewhere other than a completed line. */
  queue: PieceType[];
  cubesWasted: number;
  /** Null on a loss. `firstClear` false = cleared before, so it counted for
   *  nothing new; `completedTier` non-null = this clear finished the tier and
   *  `salvage` is what that banked (see meta.ts's recordContractClear). */
  award: { firstClear: boolean; completedTier: number | null; salvage: number } | null;
  /** Where the (possibly new) current tier stands after this clear. */
  progress: TierProgress;
  salvageTotal: number;
  /** The cheapest system the player could install next, so the salvage row can
   *  name the price the payout is walking toward (A10). Null when everything
   *  reachable is installed. */
  nextInstall?: { name: string; cost: number } | null;
  /** Next unfinished card from the board this attempt came from. */
  nextContract?: { name: string } | null;
  /** All three cards on that board are now cleared. */
  boardComplete?: boolean;
  /** The attempt was launched from Tier S rather than from the daily board.
   *  Swaps the award row for one that says nothing was banked, and points both
   *  exits back at the sandbox — a practice Contract has no board to return
   *  to, and the daily board is not it. */
  sandbox?: boolean;
}): string {
  const pattern = opts.kind === "pattern";
  const supplyLabel = pattern ? "Shipments" : "Launches";
  const supplyTotal = pattern ? opts.queue.length : opts.launches;
  const stats = `<div class="stat-row">
      <div class="stat"><b style="color:var(--accent)">${opts.lines}/${opts.goal}</b><span>Lines</span></div>
      <div class="stat"><b style="color:var(--warn)">${opts.launchesUsed}/${supplyTotal}</b><span>${supplyLabel}</span></div>
      ${
        pattern
          ? `<div class="stat"><b class="stat__tally">${queueTallyHTML(opts.queue)}</b><span>Manifest</span></div>`
          : ""
      }
    </div>`;

  if (!opts.won) {
    // A pattern Contract almost never ends with an empty queue and an unmet
    // goal — it ends the moment the cubes to finish it stop existing. Saying
    // how many were lost is the whole feedback: "you were one cube short" is
    // what makes the retry a decision rather than another roll.
    const heading = pattern ? "Manifest Short" : "Out of Launches";
    const why = pattern
      ? opts.cubesWasted > 0
        ? `<b>${opts.cubesWasted}</b> cube${opts.cubesWasted === 1 ? "" : "s"} never made it into a line — with an exact manifest, that's the whole margin.`
        : "The manifest ran out before the goal did."
      : "Nothing lost — a Contract costs you nothing to retry.";
    return `<div class="modal-scrim" id="scrim">
      <div class="panel modal end end--contract pop">
        <div class="end__main">
          <div class="eyebrow" style="color:var(--danger)">${opts.name}</div>
          <h2 class="display">${heading}</h2>
          <p class="muted" style="margin-top:-6px">${why}</p>
          ${stats}
        </div>
        <div class="row end__actions">
          <button class="btn btn--primary" data-action="contract-retry">${icon("retry", 12)}Try Again</button>
          <button class="btn btn--ghost" data-action="${opts.sandbox ? "sandbox" : "contracts"}">${
            opts.sandbox ? "Tier S" : "Contract Board"
          }</button>
        </div>
      </div>
    </div>`;
  }

  // Spare launches are the only skill expression left once it's cleared, so
  // they're called out — it's what makes replaying a paid Contract interesting.
  // A pattern Contract has no spare by construction, so clearing one at all IS
  // the flourish and the copy says that instead.
  const spare = pattern ? 0 : opts.launches - opts.launchesUsed;
  const p = opts.progress;
  // A10's "state the target": salvage in hand is only meaningful against the
  // next thing it buys, so the row names it whenever the caller knows one.
  const target = opts.nextInstall
    ? ` ${opts.nextInstall.name} costs ${salvageHTML(opts.nextInstall.cost)} in the Workshop.`
    : "";
  // Three outcomes, one salvage row: the clear COMPLETED the tier (the
  // celebration), the clear ticked tier progress (say what's still missing),
  // or it was a replay (free practice, nothing moved — the quiet variant).
  const salvageRow =
    opts.sandbox
      ? `<div class="salvage-row salvage-row--sandbox">
        <div class="salvage-row__amt salvage-row__amt--sandbox">S</div>
        <div class="salvage-row__body">
          <b>Tier S — practice Contract</b>
          <span class="muted">Rolled from a seed you chose, at a tier you chose. It banks no
            salvage and logs no clear — re-roll it and fly it again.</span>
        </div>
        <button class="btn btn--secondary" data-action="sandbox">Tier S</button>
      </div>`
      : opts.award?.firstClear && opts.award.completedTier !== null
      ? `<div class="salvage-row salvage-row--tier-done">
        <div class="salvage-row__amt">${salvageHTML(`+${opts.award.salvage}`, 16)}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.award.completedTier} complete!</b>
          <span class="muted">Run beaten and ${p.needed} Contracts cleared — Tier ${p.tier} is open. <b>${opts.salvageTotal} salvage banked.</b>${target}</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
      : opts.award?.firstClear
        ? `<div class="salvage-row">
        <div class="salvage-row__amt salvage-row__amt--tier">${opts.award.salvage > 0 ? salvageHTML(`+${opts.award.salvage}`, 16) : `T${p.tier}`}</div>
        <div class="salvage-row__body">
          <b>Tier ${p.tier} · Contracts ${p.contracts}/${p.needed}</b>
          <span class="muted">${
            opts.award.salvage > 0
              ? `<b>${salvageHTML(`+${opts.award.salvage}`)} banked</b> — ${opts.salvageTotal} salvage total.`
              : ""
          } ${
            p.contracts >= p.needed
              ? `Contracts done — ${p.runDone ? "" : "beat the Deep Run to "}complete the tier (${salvageHTML(p.award)} total per tier).`
              : `${p.needed - p.contracts} more Contract${p.needed - p.contracts === 1 ? "" : "s"}${p.runDone ? "" : " and the Deep Run"} to complete the tier (${salvageHTML(p.award)} total per tier).`
          }${target}</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
        : `<div class="salvage-row salvage-row--quiet">
        <div class="salvage-row__amt">✓</div>
        <div class="salvage-row__body">
          <b>Already logged</b>
          <span class="muted">This Contract counted on your first clear. Replays are free practice.</span>
        </div>
      </div>`;

  // One primary (B2): the forward move. The ghost board link only renders
  // when the primary is routing somewhere ELSE — a primary that already goes
  // to the board does not need a quieter twin.
  const primaryIsBoard = !opts.boardComplete && !opts.nextContract;
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--success)">${opts.name} · cleared</div>
        <h2 class="display" style="color:var(--success)">Contract Complete</h2>
        <p class="muted" style="margin-top:-6px">
          ${
            pattern
              ? `${opts.goal} lines from the exact manifest — <b>nothing wasted</b>.`
              : `${opts.goal} lines delivered${spare > 0 ? ` with <b>${spare}</b> launch${spare === 1 ? "" : "es"} to spare` : ""}.`
          }
        </p>
        ${stats}
        ${salvageRow}
      </div>
      <div class="row end__actions">
        ${
          // Tier S has no board to send anyone to and nothing to award, so its
          // forward move is the bench it came from — the next configuration is
          // what a practice clear makes you want, not a daily card.
          opts.sandbox
            ? `<button class="btn btn--primary" data-action="sandbox">Tier S →</button>`
            : opts.boardComplete
              ? `<button class="btn btn--primary" data-action="workshop">Workshop →</button>`
              : opts.nextContract
                ? `<button class="btn btn--primary" data-action="contract-next">Next: ${opts.nextContract.name} →</button>`
                : `<button class="btn btn--primary" data-action="contracts">Contract Board →</button>`
        }
        <button class="btn btn--secondary" data-action="contract-retry">${icon("retry", 12)}Play Again</button>
        ${
          opts.sandbox || primaryIsBoard
            ? ""
            : `<button class="btn btn--ghost" data-action="contracts">Contract Board</button>`
        }
      </div>
    </div>
  </div>`;
}
