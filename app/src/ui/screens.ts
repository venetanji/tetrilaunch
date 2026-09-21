import { MATERIAL_SPEC, PIECE_TYPES, shipmentColor } from "../game/theme";
import type { LossReason } from "../game/game";
import { baseBayFor, CHAIN_RUNGS_MAX, payoutMult } from "../game/level";
import { RUN_LEVELS, SCORE_PER_BAY, SCORE_PER_LINE, type SealState } from "../game/run";
import type { GradeTally } from "../game/grades";
import {
  toggleHTML, pieceCellsHTML, pieceMiniHTML, formatMMSS, beltPieceHTML, beltBombHTML,
  beltSealedHTML, runNotchTallyHTML, shipPlatesHTML, materialIconHTML, axisGlyph,
  axisIconHTML, railLegendHTML,
} from "./components";
import { icon, type IconName } from "./icons";
import {
  MARK_COUNT, MAX_TIER, UPGRADES, budgetForMark, nextTierCost, orderCost, orderSize, orderedTier,
  refitShelf, tiersCost, upgradeById,
  type RefitOrder, type UpgradeDef, type UpgradeId, type UpgradeTiers,
} from "../game/upgrades";
import {
  UNLOCKS, unlockAvailable, unlockGates, UPRATE_MAX_TIER, installAvailable,
  installShelf, recommendedPurchase,
  installGates, installById, markBudget, markUnlocked, tierMilestoneSalvage,
  tierProgressFor, tierOpenedByCompleting, uprateCost, TIER_CONTRACTS_REQUIRED,
  maskLoadout, mountedIds, stowedIds, slotPrice, slotsFor, tierIncluded, rigStarted,
  FREE_TIER_LIMIT,
  SCHOOL_INSTALL, SCHOOL_LADDER, SCHOOL_STEPS, FINAL_EXAM, licenceDone, schoolProgress,
  type MetaState, type NextStepId, type Purchase, type SchoolStepKind, type TierProgress,
  type UnlockDef,
} from "../game/meta";
import { LESSON_COUNT, LICENCE_LESSON_COUNT, type Lesson } from "../game/school";
import { lessonPictogramHTML } from "./lessonart";

/** Lessons past the licence — the practice bays that stay open once Tier 1
 *  does. Derived, so the copy quoting it cannot drift from the ladder. */
import { DAILY_COUNT, FREE_DAILY_CONTRACTS, RACK_PIECE } from "../game/contracts";
import {
  CHAPTERS, drillGate, topicsIn, unlockedDrills, type ChapterId, type GuideTopic,
} from "../game/guide";
import type { Settings } from "../lib/store";
import { PAD_BACK, PAD_CONFIRM, PAD_CONTROLS } from "./padnav";
import {
  BOARD_SANDBOX, BOARD_SKYDECK, isLadderBoard, type BoardId, type ScoreEntry,
} from "../lib/api";
import type { BeltPreview } from "../game/game";
import type { Material, PieceSize, PieceType } from "../game/theme";
import {
  HAZARDS, MATERIAL_DRAFT_BAYS, picksPerBay, totalNotches,
  type HazardDef, type HazardId, type Ratchets,
} from "../game/hazards";
import type { FinalDef, FinalId } from "../game/finals";
import {
  ACTION_LABELS, BINDABLE_ACTIONS, PAUSE_ALIAS, fullscreenKeys, hintAim, hintPress, hintRotate,
  keyFor, keyLabel, padFor, padLabel, pauseKeyLabels,
  type BindableAction, type InputProfile,
} from "../game/bindings";
import type { PreviewPart, PreviewRow } from "../game/preview";

/* ---------------------------------------------------------------------------
 * TIER PLATE — one component at three sizes (canvas A1/A4/C · A15's note):
 * 58x52 in the Deep Run menu button, a 20px-tall row chip on the run-end card's
 * buttons, 11px in the bay banner. The pixel TIER label with the mono number,
 * always the same two parts, so the ladder has ONE face wherever it shows up.
 *
 * The "menu" size STACKS its two parts and the other two lay them side by side,
 * and that is decided in app.css rather than here: the markup is the same two
 * spans at every size, which is the whole of what makes this one component.
 * A badge with 52px of its own height can afford two lines; a chip sitting on a
 * button's line of type cannot, and the button size read as "TIER" over "2"
 * beside a label that already said "Run Tier 2 →" until it was laid flat.
 * ------------------------------------------------------------------------ */
export function tierPlateHTML(tier: number, size: "menu" | "button" | "banner"): string {
  // The Skydeck wears the SAME plate, not a badge of its own — it is a floor
  // of the same tower, and the ladder having one face is the whole point of
  // this component. Only the two parts' contents change, plus a tint class.
  // Tier S joined them on the same terms when it became a floor: an "S" in the
  // number slot, which is why that slot is sized in `ch` rather than by digit.
  //
  // "SKY" IS THE LABEL, NOT "SKYDECK", and the reason is the slot rather than
  // taste: .tier-plate__lbl is a fixed 4ch of Press Start 2P, which advances
  // exactly 1em per glyph — anything longer than four characters would grow the
  // plate and move the button under it, which is the device-reported bug the
  // fixed slots exist to prevent. The full name rides the accessible label,
  // where there is no width to spend.
  const sky = tier === SKYDECK_TIER;
  const sbx = tier === SANDBOX_TIER;
  // The lobby wears the plate on the same terms the roof does — it is a floor
  // of the same building, and the ladder having one face is the whole point of
  // this component. "Flight" in the 4ch label slot (the slot is why it is not
  // "School"), and the licence mark where every other floor puts a digit.
  const lic = tier === LICENCE_TIER;
  const label = lic
    ? "Flight School — the licence"
    : sky ? "Skydeck" : sbx ? "Tier S — sandbox" : `Tier ${tier}`;
  const tint = lic
    ? " tier-plate--lic"
    : sky ? " tier-plate--sky" : sbx ? " tier-plate--sbx" : "";
  return `<span class="tier-plate tier-plate--${size}${tint}" aria-label="${label}"><span class="tier-plate__lbl">${lic ? "Flight" : sky ? "Sky" : "Tier"}</span><span class="tier-plate__n">${tierPlateFace(tier)}</span></span>`;
}

/** What the plate's NUMBER SLOT shows for a floor: the digit, or the mark a
 *  special floor wears where the digit would go.
 *
 *  One function rather than an expression inside tierPlateHTML, because the
 *  slot is written from TWO places — the plate at rest (above) and main.ts's
 *  rollPlate, which rolls the old face out and the new one in while the car
 *  travels. rollPlate kept its own copy of this rule, and the copy predated the
 *  ground floor: riding down to Flight School the odometer rolled "-2" (the
 *  lobby's raw id, LICENCE_TIER) onto the plate and held it for the whole
 *  ride, then the landing swapped in the wing. Owner-reported. The face the
 *  car rolls onto is now, by construction, the face the plate lands on. */
export function tierPlateFace(tier: number): string {
  if (tier === LICENCE_TIER) return LICENCE_MARK;
  if (tier === SKYDECK_TIER) return SKY_STAR;
  if (tier === SANDBOX_TIER) return "S";
  return String(tier);
}

/** The Skydeck's mark, in the plate's number slot where every other floor puts
 *  a digit. Named because it is now worn in three places — the plate, the
 *  leaderboard's Sky tab and that board's heading (boardText) — and a floor
 *  whose identity differs between the tower and the board it files to is two
 *  floors to the player. */
export const SKY_STAR = "★";

/** The licence's mark, in the plate's number slot where every other floor puts
 *  a digit. A wing, for the school that issues it — and, like SKY_STAR, named
 *  rather than inlined so the plate, the lobby and any copy that reaches for it
 *  can never disagree about what the ground floor looks like. */
export const LICENCE_MARK = "✦";

/** The tier as running text — "Tier 7", "Tier S", "Tier SKY" — for the lines
 *  that name a tier mid-sentence (the draft eyebrow, the bay banner's
 *  accessible label) rather than wearing the plate. The special floors follow
 *  the plate's spelling ("S" in the number slot, "Sky" on the label) so a
 *  screen and its eyebrow never disagree about a floor's name: a Skydeck run
 *  is flown at Mark 10's numbers, but printing "Tier 10" here filed the day
 *  run as a ladder run — the device-reported bug this helper exists for. */
export function tierText(tier: number): string {
  if (tier === SKYDECK_TIER) return "Tier SKY";
  if (tier === SANDBOX_TIER) return "Tier S";
  // NOT "Tier ✦". The lobby is the one floor that is not a rung of the ladder
  // and does not file to a board, so naming it as a Tier would put a licence
  // lesson in the same sentence shape as a ten-bay run.
  if (tier === LICENCE_TIER) return "Flight School";
  return `Tier ${tier}`;
}

/**
 * A BOARD as running text — the leaderboard's tab, its heading and the run-end
 * modal's "… board" line all read this one function.
 *
 * It is tierText's counterpart on the other side of the wire, and it exists
 * because a BoardId is not a tier: `BOARD_SANDBOX` and `BOARD_SKYDECK` are
 * negative ids chosen so no Mark can clamp onto them (lib/api.ts), and printing
 * one raw gives "Tier -2". Each special board is named with the floor's own
 * spelling — the tower, the plate and the board agree by construction rather
 * than by three literals that have to be kept in step.
 */
export function boardText(board: BoardId): string {
  if (board === BOARD_SKYDECK) return `${tierText(SKYDECK_TIER)} ${SKY_STAR}`;
  if (board === BOARD_SANDBOX) return tierText(SANDBOX_TIER);
  return tierText(board);
}

/** A day key (lib/api.ts's BoardDay — contracts.ts's dailySeed, YYYYMMDD in
 *  UTC) as a date. ISO rather than a locale format on purpose: the board is a
 *  UTC day shared by every player on it, and "28/08" would read as a different
 *  day either side of the date line. Splits the integer rather than going
 *  through Date — the key is already a calendar day, and re-parsing it into a
 *  timestamp is where a timezone gets to move it. */
export function dayText(day: number): string {
  const y = Math.floor(day / 10000);
  const m = Math.floor(day / 100) % 100;
  const d = day % 100;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
 *
 * COLOUR LIVES ON THE CLASS, never at the call site (app.css's
 * .currency--salvage / .currency--scrap): banked green against raw amber is
 * the third axis after silhouette and paint mode, and a currency painted by
 * whichever panel happens to hold it is how the two balances ended up the
 * same hue the first time — the Workshop chip and the yard's order both
 * painted `var(--warn)` inline. These two functions are the only things that
 * may colour a currency, and sim/systems.ts pins that no caller overrides it.
 * ------------------------------------------------------------------------ */
/** Salvage: banked at tier milestones, spent in the Workshop, kept forever.
 *
 *  `earn` plays the COLLECTION beat (app.css's .currency--earn): the glyph
 *  stamps in over a ring of its own colour. Only for a figure that is
 *  ARRIVING as the player watches — a payout row, a banked milestone — never
 *  for a balance that merely happens to be on screen, which is most of them.
 *  A total that pops every time its panel re-renders teaches the animation
 *  means nothing. */
export function salvageHTML(amount: string | number = "", size = 12, earn = false): string {
  return `<span class="currency currency--salvage${earn ? " currency--earn" : ""}">${icon("salvage", size)}${amount}</span>`;
}
/** Scrap: 2/line and 10/bay, spent at the refit yard, gone when the run ends.
 *  `earn` as salvageHTML's — the bay-clear payout is the one caller. */
export function scrapHTML(amount: string | number = "", size = 12, earn = false): string {
  return `<span class="currency currency--scrap${earn ? " currency--earn" : ""}">${icon("scrap", size)}${amount}</span>`;
}

/**
 * THE ACCESSIBLE NAME FOR A PRICE-SHAPED BUTTON — both shops' one grammar.
 *
 * A shop button prints its price and nothing else (the refit card's own
 * buy-button note argues why, and the Workshop's has since B6). On screen that
 * is right: the card above the button names the system in a heading, in 13px
 * display type, with its glyph. In a screen reader it is not, because a control
 * list is read WITHOUT the card — and "T3 · 55" is the same eight characters on
 * every card at that tier, with the currency mark `aria-hidden` on top. Seven
 * tracks, one name. That is the one fact the label has to carry and the only
 * one the price does not.
 *
 * `label` is the VISIBLE string, quoted verbatim rather than spelled out as
 * "tier 3, 55 scrap": WCAG 2.5.3 asks that an accessible name contain the label
 * a sighted user can see, because a voice-input user says what is on the
 * button. The currency word is what the glyph would have said if a glyph could
 * be read aloud, and it is the one thing on this screen the two shops disagree
 * about — the yard spends scrap, the Workshop salvage.
 *
 * Not needed where the visible label already names its object: the Workshop's
 * "+1 slot" button is one per screen and says what it buys.
 */
/** THE ATTRIBUTES OF A PRICE THE PLAYER CANNOT PAY. Not `disabled`: a dead
 *  button answers a tap with nothing, and "i can tap on upgrade but 0 salvage
 *  has no feedback" (owner) is exactly that nothing. The control stays a real
 *  button, dimmed by the class, and main.ts's buy handlers answer the press
 *  with the shortfall card (salvageShortModal) instead of the purchase. The
 *  enforcement is theirs and meta.ts's — this is presentation, as the old
 *  `disabled` was. */
const shortAttrs = ' data-short="true"';

function priceAria(system: string, verb: string, label: string, currency: "scrap" | "salvage"): string {
  return `${system} — ${verb} ${label} ${currency}`;
}

/** The NEXT STEP badge (canvas A3): ONE surface ever carries it, computed by
 *  meta.ts's nextStep — this is just the chip. */
export function nextBadgeHTML(label = "Next step"): string {
  return `<span class="next-badge">${label}</span>`;
}

/** THE ALERT MINO — the same claim as the NEXT STEP chip, drawn as a 14px
 *  square with a pixel "!" instead of a word.
 *
 *  It replaces the chip on the two screens a player passes through rather than
 *  reads: the front door and the hub. The chip is 6px type in a plate wide
 *  enough to hold "Next step", and on a rail of four cards it was the widest
 *  piece of furniture on the screen — a label competing with the labels it was
 *  pointing at. A mino is the game's own unit: one cell, amber, in the corner
 *  the badge already rode. It says "here" and nothing else, which is the whole
 *  of what the chip ever said.
 *
 *  Everywhere the badge sits INSIDE prose — the coach's "Why" block, the
 *  Contract footnotes, the shop card's name row, the run-end modal — it keeps
 *  the word, because a bare square in a sentence is a typo. The rule is the
 *  surface, not the state: chips label, minos mark.
 *
 *  `aria-label` rather than the glyph's own text, because "!" is not read
 *  aloud as anything useful and the control under it is already named. */
export function alertMinoHTML(): string {
  return `<span class="alert-mino" aria-label="New">!</span>`;
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
 * FLOOR ORDER is top-down: the Skydeck, 10, 9 … 1. A tower whose ground floor
 * is not at the bottom is not a tower.
 * ------------------------------------------------------------------------ */

/**
 * THE SKYDECK — the floor above the ladder's top rung.
 *
 * Its index in the shaft. Not a Mark — MARK_COUNT is the top of the real
 * ladder — so it gets a number above every Mark and is compared by identity
 * everywhere rather than by "> 10".
 *
 * THE NAME IS THE FLOOR'S POSITION, and that is the whole of it: the top plate
 * of the shaft, amber where the ladder is cyan, with the headhouse and its
 * beacon on the roof directly above. It was called the God floor until an owner
 * pass caught the obvious problem — the game has no deities, no ascension and
 * no religious frame anywhere else in it, so the name promised a theme the
 * building does not have and read as a claim about the player rather than a
 * place in a plant. A deck at the top of a tower is the same reward with no
 * borrowed meaning, and it is the one name that also survives the shaft's
 * geometry: "SKY" is three Press Start 2P glyphs, exactly what "GOD" was, so
 * the floor plate measures byte-identically and sim/uifit's spill budget on the
 * 640x360 phone (22px car lane + number + 16px window block inside 72px of
 * content) is untouched.
 */
export const SKYDECK_TIER = MARK_COUNT + 1;

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

/**
 * THE LOBBY — Flight School, and the ground floor of the ladder (game/school.ts).
 *
 * Every other floor of this tower is opened by beating the one below it, and
 * Tier 1 had nothing below it: a first launch put the player straight into a
 * ten-bay run with a bankroll, a clock and permadeath. So the building gains
 * the floor it was always missing, and it is where a licence is earned.
 *
 * DRAWN BELOW THE SHAFT'S OWN BOX, in the plinth that was already there, and
 * NOT counted in TOWER_FLOORS — the exact arrangement the headhouse has above
 * (see SANDBOX_TIER). That is what keeps the eleven floors' height arithmetic
 * byte-identical: a twelfth rung inside the shaft would have compressed every
 * floor in the building to make room for one that is not a Mark.
 *
 * THE LIFT DOES NOT SERVE IT, for the same reason it does not serve the roof.
 * The shaft is the LADDER; the lobby is the door you come in by. Selecting it
 * parks the car at the bottom of the shaft and lights the lobby, which is what
 * a lift at ground level looks like.
 */
export const LICENCE_TIER = -2;

/** How many floors the shaft holds: the Marks, plus the Skydeck on top. Tier S
 *  is deliberately NOT counted — it is drawn above the shaft's own box, in the
 *  headhouse, and takes no height from the floors (see SANDBOX_TIER). */
export const TOWER_FLOORS = MARK_COUNT + 1;

export interface TowerState {
  /** The highest Mark the player may fly (meta.ts's markUnlocked). */
  unlocked: number;
  /** Lifetime Full Game entitlement. Absent preserves existing fixtures. */
  fullGame?: boolean;
  /** The floor the car is parked on — a Mark, SKYDECK_TIER, or SANDBOX_TIER once
   *  the beacon has been found. */
  selected: number;
  /** Whether the Skydeck is open — the whole ladder beaten AND every Mark
   *  sealed (meta.ts's skydeckOpen). Passed rather than derived from `sealed`
   *  below, because the ladder half of that rule is not in this shape and a
   *  screen that guessed at it would open the roof for a player holding ten
   *  seals and two owed Contracts. */
  skydeck: boolean;
  /** Whether Flight School has been finished (meta.ts's licenceDone). False
   *  locks every Mark in the shaft — see tierOpen, which is the one place that
   *  asks. Absent reads as licensed, so every caller that predates the ground
   *  floor renders the tower it always did.
   *
   *  A separate field from `unlocked` rather than a value of it, because the
   *  two answer different questions: `unlocked` is how far up the ladder this
   *  player has climbed, and this is whether they may be on the ladder. */
  licensed?: boolean;
  /** Whether the player owns a ship system (meta.ts's rigStarted). False locks
   *  every Mark in the shaft, exactly as `licensed` does and for the same kind
   *  of reason — see tierOpen. Absent reads as rigged, so every caller that
   *  predates the on-ramp renders the tower it always did.
   *
   *  A THIRD field rather than a value of the other two, on the same argument
   *  `licensed` makes against folding into `unlocked`: this is not how far the
   *  player has climbed, nor whether they may be on the ladder at all, but
   *  whether the ship they would fly it in exists yet. */
  rigged?: boolean;
  /** Whether the four BASICS are behind the player (meta.ts's basicsDone) —
   *  the ground floor's fourth rung, and the one that opens the Contract board
   *  and the Workshop (see menuScreen). Absent reads as done, so every caller
   *  that predates the ladder's two gates renders the menu it always did.
   *
   *  A FOURTH field rather than a value of `licensed`, on the same argument the
   *  other three make: the two answer different questions now that the shops
   *  are rungs. `licensed` is "may this save fly a Deep Run", which is the TOP
   *  of the ladder; this is "may it open the two doors that are its GATES",
   *  which is a third of the way up it. */
  basics?: boolean;
  /** Ground-floor STEPS cleared, for the lobby's own readout (meta.ts's
   *  schoolProgress). Absent reads as none.
   *
   *  THE NUMBERED RUNGS, which are the ten flights: the plate's sockets, the
   *  lobby panel and the primary's subtitle all draw the LADDER, and the ladder
   *  counts to ten. The two gates are not in it — see `gate` below, and
   *  meta.ts's header for why they carry no ordinal. */
  licenceDone?: number;
  /** Steps in the ladder (meta.ts's SCHOOL_STEPS), so the lobby can print
   *  "5 / 10" without importing a save into a fixture. Absent reads as the
   *  shipped count. */
  licenceTotal?: number;
  /** THE GATE THE LADDER IS STOPPED AT, or null when the next rung is a bay.
   *
   *  A field rather than something the count implies, and the reason is that
   *  the count cannot imply it: the gates take no ordinal, so a save four
   *  flights in is at the same number whether it owes the Contract, owes the
   *  Workshop, or owes neither and is looking at lesson 5. Three states, one
   *  number — which is exactly the shape that has to be passed rather than
   *  derived. Absent reads as "no gate owed", so every caller that predates the
   *  two rungs renders the lobby it always did. */
  gate?: SchoolStepKind | null;
  /** Whether Tier S is a floor at all (lib/store.ts's Settings.devMode, set by
   *  the beacon gesture — see lib/devmode.ts). Absent reads as off, so every
   *  caller that predates the mode renders the tower it always did. */
  sandbox?: boolean;
  /** Marks cleared in one run with no bay retry (meta.ts's sealedMarks).
   *  Absent reads as none, so every caller that predates the seal — and there
   *  are two, menuScreen's fallback tower and every uifit fixture — renders
   *  the tower it always did. */
  sealed?: number[];
  /** First-clear Contracts logged on the CURRENT tier (`unlocked`), 0-based
   *  count out of TIER_CONTRACTS_REQUIRED — meta.ts's tierProgressFor. The
   *  floors' windows read it: see floorHTML's note. Absent reads as 0, which
   *  is the honest dark for a caller with no meta to ask. */
  contracts?: number;
  /** THIS RENDER IS THE UNLOCK CEREMONY (see TOWER_RISE_FROM's note): the car
   *  rides from the ground floor to `selected`, which the caller has already
   *  set to the floor that just opened.
   *
   *  A boolean rather than the destination floor, deliberately. A second
   *  number here could disagree with `selected`, and the two disagreeing is
   *  the one failure this component cannot survive: the car would animate to
   *  one floor and rest at another, which is not a glitch but a lie about
   *  which Mark the Deep Run button is about to fly. There is nothing to
   *  disagree about if there is only one number.
   *
   *  Absent reads as no ceremony, so every caller that predates it — the
   *  fallback tower in menuScreen and every uifit fixture — renders the tower
   *  it always did, at exactly the geometry it always did. */
  celebrate?: boolean;
  /** How far into the ceremony this render already is, in ms.
   *
   *  A CEREMONY IS A TIMELINE, NOT A MOUNT. The menu's markup is rewritten
   *  wholesale on a re-render (the store's entitlement callback does it), which
   *  restarts every CSS animation in it from frame one — while the timer that
   *  tears the ceremony down is still counting from when the ride really began.
   *  A re-render two seconds in would therefore restart a four-second ride with
   *  two seconds left to run, and the player would watch the car set off and be
   *  cut off halfway up. (Codex review, PR #110.)
   *
   *  Passing the offset makes the ride RESUME instead: it becomes a negative
   *  animation-delay (app.css), so the replacement tower renders the frame the
   *  old one was showing and carries on from there. The teardown timer needs no
   *  adjustment because, as far as the animation is concerned, nothing
   *  restarted.
   *
   *  Absent or 0 is the first mount — the ceremony starting at its beginning,
   *  which is what every caller that does not re-render mid-ride ever asks
   *  for. */
  celebrateElapsed?: number;
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
  // THE ONE FLOOR NOTHING GATES. It is the door into the building, and a locked
  // front door on a first launch is the whole failure this floor exists to fix.
  // It stays open after the licence is earned too, so a lesson can be replayed.
  if (tier === LICENCE_TIER) return true;
  if (tier === SKYDECK_TIER) return state.skydeck;
  const included = tierIncluded(tier, state.fullGame !== false);
  // THE LICENCE GATES THE LADDER, and it is asked HERE rather than folded into
  // `unlocked` — meta.ts's markUnlocked is also the Mark the Workshop budgets
  // against, the Mark the guide prices its copy at and the Mark the hazard
  // ladder is read from, none of which want to be told the player has no tier
  // at all. This is the one function that answers "may the car fly this floor",
  // so this is where the answer belongs.
  //
  // ABSENT READS AS LICENSED, which is what keeps every caller that predates
  // the ground floor — menuScreen's fallback tower, every uifit fixture —
  // rendering the tower it always did.
  if (state.licensed === false) return false;
  // THE RIG NO LONGER GATES THE LADDER. It used to: a Deep Run is ten bays with
  // three refit stops, and the owner's call was that the first system is bought
  // BEFORE the first run, so an un-rigged save was refused Tier 1 and pointed at
  // the Workshop. Optional onboarding retires that forced first purchase — Tier
  // 1 is playable the moment the player skips into the hub — so `rigged` is now
  // only a soft nudge (nextStep still recommends the first system, the Upgrades
  // button still wears the badge) rather than a lock. A system-less first run
  // simply finds its refit shelves empty, which is the player's to fix when they
  // like.
  return included && tier >= 1 && tier <= state.unlocked;
}

/** True when the Tier S door is there to be opened. */
export function sandboxOpen(state: TowerState): boolean {
  return state.sandbox === true;
}

/** Where a floor sits in the shaft, counting from the roof — the car's whole
 *  position is this one number (app.css does the arithmetic from --tower-idx),
 *  so the travel animation is a single custom property to write.
 *
 *  MINUS ONE for Tier S — above the Skydeck, which is 0. The CAR never uses
 *  it: the lift does not serve the roof, and tierTowerHTML parks it at the top of the
 *  shaft and switches it off instead. What does use it is everything that needs
 *  the roof ORDERED against the ladder: towerTravelMs (how long the trip takes)
 *  and the plate roll's direction, both of which have to know that S is above
 *  Mark 10 and not, as its raw id would suggest, below Mark 1. */
export function towerIndexOf(tier: number): number {
  if (tier === SANDBOX_TIER) return -1;
  // ONE PAST THE GROUND FLOOR, and the CAR never uses it either — the lift does
  // not serve the lobby (see LICENCE_TIER). What does use it is everything that
  // needs the licence ORDERED against the ladder: towerTravelMs, and the plate
  // roll's direction, both of which have to know that the lobby is below Mark 1
  // rather than, as its raw id would suggest, above the roof.
  if (tier === LICENCE_TIER) return MARK_COUNT + 1;
  return tier === SKYDECK_TIER ? 0 : MARK_COUNT - tier + 1;
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

/* ---------------------------------------------------------------------------
 * THE UNLOCK RIDE — the one trip the car makes that nobody asked it to.
 *
 * A tier completing is the largest thing that happens outside a run, and the
 * tower is the only surface that can show it as a CLIMB rather than as a
 * number going up by one. So when the ladder moves (meta.ts's
 * pendingUnlockMark), the home screen opens with the car on the GROUND FLOOR
 * and rides it all the way to the floor that just opened.
 *
 * WHY THE GROUND FLOOR, when the car was parked one floor below the new one
 * and a real lift would move exactly one floor. Because one floor is not a
 * climb. The ride is the only moment the building's whole height is ever
 * traversed, and starting it at Tier 1 makes the trip say the thing the number
 * cannot: this is how far you have come, and it took all of that to open this
 * door. It also gives the ceremony something to GROW with — Tier 2's ride is
 * one floor and Tier 10's is nine, so the last one is visibly the longest.
 *
 * WHY THE DURATION IS NOT towerTravelMs. That function is tuned for
 * NAVIGATION: it is capped at 1.1s precisely so a pick never reads as a wait,
 * because the player asked for the car to move and wants to get on with it.
 * Nobody asked for this trip. It is a ceremony, it is allowed to take its
 * time, and a ceremony that is over in a third of a second is not one. Same
 * distance-scaled shape, three times the numbers — see towerCelebrationMs for
 * the band the total is held inside.
 * ------------------------------------------------------------------------ */

/** Where the ceremony starts: the bottom of the ladder. Not the floor the car
 *  was parked on — see the note above. */
export const TOWER_RISE_FROM = 1;

/** Doors-closed beat before the car moves. Long enough to read as the building
 *  gathering itself rather than as a dropped frame, short enough that nobody
 *  wonders whether the animation is broken. It also covers the menu's own
 *  mount: the ride must not begin in the same frame the screen appears in, or
 *  the first thing the player sees is already half over. */
export const TOWER_RISE_HOLD_MS = 450;

/** The ride: a floor-independent base plus a per-floor step. The base is what
 *  keeps Tier 2's single-floor ride from being a twitch — at towerTravelMs's
 *  rate one floor is 355ms, which is a lift arriving, not a lift ARRIVING. */
export const TOWER_RISE_BASE_MS = 900;
export const TOWER_RISE_PER_FLOOR_MS = 190;

/** Arrival: the plate igniting and the car's lamp blooming and settling. The
 *  longest phase after the ride itself, because this is the beat the whole
 *  thing exists to deliver and it must not be snatched away. */
export const TOWER_ARRIVE_MS = 1500;

/** How long the car spends travelling to `to`. */
export function towerRiseMs(to: number): number {
  const floors = Math.abs(towerIndexOf(TOWER_RISE_FROM) - towerIndexOf(to));
  return TOWER_RISE_BASE_MS + floors * TOWER_RISE_PER_FLOOR_MS;
}

/**
 * The whole ceremony, end to end — what main.ts times its teardown and its
 * music window against.
 *
 * Held inside 3–6 seconds for every floor the ladder can open, and both ends
 * of that band are load-bearing rather than taste. Under about three seconds
 * the ride does not register as an event at all: the player is still reading
 * the menu when it finishes, and it reads as a transition. Past about six it
 * stops being a celebration and becomes something to sit through, on a screen
 * whose only job is to get out of the way. Tier 2 (one floor) comes out at
 * 3.04s and the Skydeck (ten) at 4.75s, so the whole ladder fits with room
 * at both ends — sim/systems.ts pins that, because the band is invisible from
 * any one of the three constants it is made of.
 */
export function towerCelebrationMs(to: number): number {
  return TOWER_RISE_HOLD_MS + towerRiseMs(to) + TOWER_ARRIVE_MS;
}

/**
 * When the car passes `tier` on a ride to `to`, in ms from the ceremony's
 * start — or null for a floor the ride never reaches.
 *
 * This is what makes the building light up BEHIND the car instead of all at
 * once: each floor's already-lit windows flare as the car draws level with it
 * (app.css's tower-window-surge reads it as an animation-delay), so the
 * ceremony is a wave travelling up the tower rather than a car with a glow
 * around it. Floors above the destination are never lit by it, because they
 * are floors the player has not earned and the ride is not a promise.
 *
 * Linear in shaft INDEX, not in time: the car's own easing is the car's
 * business, and matching it here would mean re-stating a cubic-bezier in
 * arithmetic and keeping the two in step forever. The visible cost is that the
 * wave leads the car slightly at the ends of the trip and lags it in the
 * middle, by at most a floor — which nobody has ever noticed in a lighting
 * effect, and which no amount of matched easing would make worth the coupling.
 */
export function towerRisePassMs(to: number, tier: number): number | null {
  const from = towerIndexOf(TOWER_RISE_FROM);
  const dest = towerIndexOf(to);
  const idx = towerIndexOf(tier);
  // Off the ride: below the ground floor (nothing is) or above the floor that
  // just opened. Both ends inclusive — the ground floor is where the doors
  // close and the destination is the arrival itself.
  if (idx > from || idx < dest) return null;
  const span = from - dest;
  // A zero-floor ride cannot be produced by an unlock (the ladder always moves
  // at least one rung), but a caller that manufactures one gets the arrival
  // rather than a division by zero.
  const t = span === 0 ? 1 : (from - idx) / span;
  return Math.round(TOWER_RISE_HOLD_MS + towerRiseMs(to) * t);
}

/**
 * THE THREE STATES A MARK'S SEAL CAN BE IN — one rule, every surface.
 *
 * The tower drew two of them: a filled stamp for a sealed Mark, and a faint
 * SOCKET for everything else. That socket was doing two jobs, and the owner's
 * pass caught it doing them in one glyph — "never cleared this Tier yet" and
 * "cleared it, then broke the seal on a retry" are the same picture, so the
 * building could state the roof's bill and could not state a player's own
 * history. The middle state is the one a player actually asks about, because it
 * is the one they can do something about: the Tier is behind them, and the only
 * thing left to earn on that floor is the stamp.
 *
 * CLEARED IS `tier < state.unlocked`, which is the tower's own existing
 * arithmetic and not a second answer beside it: floorHTML lights all three
 * windows on exactly that comparison ("a beaten floor burns all three"), and
 * `unlocked` is meta.ts's markUnlocked — `mark + 1` — so a floor below it is a
 * floor whose Deep Run AND Contracts have both landed (advanceTier). Nothing is
 * added to the save and nothing is migrated; the state was already in the two
 * numbers the tower is handed.
 *
 * A TIER WHOSE BAYS ARE WON BUT WHOSE CONTRACTS ARE STILL OWED IS **AT STAKE**,
 * deliberately. It sits AT the unlock, not below it, so it reads as the socket
 * — and that is the honest picture rather than a rounding of it: the floor is
 * still the one the game is asking the player to finish, the same panel and the
 * same Contract pips are counting its clears one column away, and a struck
 * stamp there would say "done, and you lost the stamp" about a Tier that is not
 * done. The seal is not lost in that state either — recordRunEnd's seal is
 * deliberately not gated on the Tier being current, so a clean re-fly stamps it
 * whenever the player likes — which is exactly what "at stake" means.
 *
 * THE LADDER'S TOP FLOOR IS THE ONE PLACE THIS UNDER-CLAIMS, and it is worth
 * stating rather than hiding. markUnlocked SATURATES at MARK_COUNT (the bug
 * PR #134 chased through three other surfaces), so a finished ladder leaves
 * Mark 10 AT `unlocked` rather than below it, and a Mark 10 cleared messily
 * therefore draws the socket instead of the struck stamp. The tower is handed
 * no number that can separate "mark 9, Tier 10 unflown" from "mark 10, Tier 10
 * cleared", so the choice is between under-claiming and inventing state; and
 * the socket is not a lie in that state, because the seal really is unheld and
 * really is still there to be earned. A future pass that wants the strike on
 * the top floor has to be PASSED the completed Mark, not guess it.
 *
 * Null is "this floor has no seal question": the roof (meta.ts records no seal
 * for the Skydeck), the lobby, the bench, and every Mark the player may not fly
 * yet — a locked floor has a Mark question, not a seal question.
 */
export type FloorSeal = "sealed" | "broken" | "at-stake";

export function floorSealState(state: TowerState, tier: number): FloorSeal | null {
  if (tier < 1 || tier > MARK_COUNT) return null;
  if (!tierOpen(state, tier)) return null;
  if ((state.sealed ?? []).includes(tier)) return "sealed";
  return tier < state.unlocked ? "broken" : "at-stake";
}

/**
 * …and the same rule's WORDS, for every surface that states a floor's seal
 * beside its name rather than stamping it on a plate.
 *
 * One function because the tower's glyph is aria-hidden and a shape has no
 * accessible name: the destination panel's line is where the state is written
 * down, and two copies of it would drift the way the three retry doors' copy
 * drifted before sealFaceLabel was one function (see its note).
 *
 * The broken line is the only one that carries an INSTRUCTION, because it is
 * the only state with an action in it. "Sealed" is a receipt and "Seal at
 * stake" is the resting state of nine floors out of ten — a sentence there
 * would be a nag on the home screen — but a struck stamp raises exactly one
 * question, and the line answers it in the ladder's own vocabulary ("no bay
 * retry", the term the primary's seal subtitle and the retry doors already
 * use).
 */
export function floorSealLine(seal: FloorSeal): string {
  return seal === "sealed"
    ? "Sealed"
    : seal === "broken"
      ? "Seal broken — re-fly with no bay retry to seal it"
      : "Seal at stake";
}

/**
 * The floor's seal state in the RUN's vocabulary (run.ts's SealState) — which
 * is how the glyph gets picked, and the whole reason the tower and the retry
 * doors cannot come to draw two different octagons for one fact.
 *
 * The three states line up exactly once, and they line up on the SHAPE rather
 * than on the wash:
 *
 *  - sealed   → **held**: the stamp is on the tower and nothing can take it.
 *  - broken   → **spent**: the stamp is gone, and the strike is the same
 *    picture the pause card and the loss card already draw for it
 *    (.btn__seal--broken). A run spends its seal; a floor wears what is left.
 *  - at-stake → **at-stake**: unsealed, and still there to be earned.
 *
 * The two vocabularies stay separate in WORDS, because they are statements
 * about different things and run.ts's sealStateFor exists to keep that straight:
 * sealFaceLabel says "this run's seal is already broken" about the run in
 * front of the player, and floorSealLine says "Seal broken" about the floor.
 * One shape, two subjects.
 */
export function floorSealFace(seal: FloorSeal): SealState {
  return seal === "sealed" ? "held" : seal === "broken" ? "spent" : "at-stake";
}

function floorHTML(state: TowerState, tier: number): string {
  const open = tierOpen(state, tier);
  const paywalled = state.fullGame === false && tier <= MARK_COUNT
    && !tierIncluded(tier, false) && tierOpen({ ...state, fullGame: true }, tier);
  const sky = tier === SKYDECK_TIER;
  const sel = tier === state.selected;
  const cls = ["tower__floor"];
  if (sky) cls.push("tower__floor--sky");
  if (sel) cls.push("is-selected");
  if (!open) cls.push("is-locked");
  // The three squares are WINDOWS, and they are LIGHTS now, not decoration:
  // one per first-clear Contract the tier asks for (TIER_CONTRACTS_REQUIRED),
  // dark until that clear lands. A beaten floor burns all three — a tier
  // cannot be beaten without its Contracts (meta.ts's advanceTier), so the
  // building lights up floor by floor as the player climbs. The current
  // floor shows the tier's live count (TowerState.contracts), floors above
  // are dark, and the Skydeck's burn only once the whole ladder has (it has
  // no Contracts of its own to count). They used to sit at a uniform half-lit
  // opacity, which read as "on" for floors the player had not touched — the
  // owner's pass caught it — and a dark socket still does the old job: a
  // dark building is a building.
  const lit = sky
    ? (state.skydeck ? TIER_CONTRACTS_REQUIRED : 0)
    : tier < state.unlocked
      ? TIER_CONTRACTS_REQUIRED
      : tier === state.unlocked
        ? Math.min(TIER_CONTRACTS_REQUIRED, Math.max(0, state.contracts ?? 0))
        : 0;
  const windows = `<span class="tower__windows">${
    Array.from({ length: TIER_CONTRACTS_REQUIRED }, (_, i) => `<i${i < lit ? ' class="on"' : ""}></i>`).join("")
  }</span>`;
  const label = sky ? "Skydeck" : `Tier ${tier}`;
  // The current floor's windows are live information, so its accessible name
  // carries the same count — the other floors' lights are implied by
  // locked/open, which the label already states.
  const contractsNote = !sky && tier === state.unlocked
    ? ` — Contracts ${lit}/${TIER_CONTRACTS_REQUIRED}`
    : "";
  // THE ROOF'S PRICE, in words, because the stamps below it are a shape and a
  // shape has no accessible name. A locked Skydeck says exactly how many of the
  // ladder's Marks are sealed — the one number that decides whether the car
  // will go there (meta.ts's skydeckOpen), and the number a screen-reader user
  // has no other way to count. Open, it says nothing extra: the price has been
  // paid and the label is the floor's name, which is what the sim pins.
  const sealsHeld = (state.sealed ?? []).filter((m) => m >= 1 && m <= MARK_COUNT).length;
  const sealsNote = sky && !open ? ` — ${sealsHeld} of ${MARK_COUNT} Tiers sealed` : "";
  const accessNote = paywalled ? " — Full Game required" : "";
  // WHY A LADDER FLOOR IS LOCKED ON A FRESH SAVE, in the one place a locked
  // floor can say anything. Every Mark reads "locked" while the licence is
  // owed, and nothing anywhere told the player what would open it: the tower
  // shakes the floor and says nothing, and menuPlaySub's "Finish Flight School
  // first" line is unreachable for a Mark, because towerState pins the
  // selection to the lobby while unlicensed. Contracts and Workshop already say
  // "Opens after Flight School" on their own buttons; the ten floors between
  // them said nothing at all.
  // …AND THE SECOND REASON, in the same slot and by the same argument. The two
  // are ordered as they are earned (tierOpen asks the licence first), so a
  // floor never names a shop to a player who has not left school yet.
  const licenceNote = !sky && !open
    ? state.licensed === false
      ? " — Flight School first"
      : state.rigged === false
        ? " — install a system first"
        : ""
    : "";
  // THE SEAL — a Mark that fell in one unbroken run (meta.ts's sealedMarks).
  // A SHAPE stamped on the plate, never a tint: the palette is full at 13
  // swatches and sim/systems.ts fails the build below dE00 10, so there is no
  // hue left to spend — and a distinction carried by hue alone is invisible to
  // a red-green viewer anyway. It has to survive a greyscale screenshot.
  // app.css draws it.
  //
  // Never a FILLED stamp on the Skydeck. The Skydeck is not a Mark, meta.ts
  // records no seal for it, and a stamp there would be a state nothing can ever
  // produce.
  //
  // It joins the floor's accessible NAME as well, because the shape itself is
  // aria-hidden: a distinction a screen reader has no way to reach is a
  // distinction half the audience does not get.
  const isSealed = !sky && (state.sealed ?? []).includes(tier);
  // THE EMPTY SOCKET — the same stamp, unpressed, on a floor that still owes
  // one. It is what makes "all seals open the roof" legible without a sentence
  // anywhere on the menu: the building shows its own bill. Tapping the locked
  // roof flares exactly these (main.ts's pickTier adds `is-owed`), so the
  // refusal answers "which ones" in the tower the player is already reading,
  // rather than in a toast over it — the same argument .tower__floor.is-denied
  // has always made.
  //
  // ON THE ROOF TOO, and that is not the contradiction it looks like. The
  // socket there is not "the Skydeck is unsealed"; it is the floor stating what
  // it is waiting for, in the one glyph the building uses for seals. It is
  // drawn only while the roof is shut, so an open Skydeck carries no stamp of
  // any kind and the rule above still holds.
  //
  // ONLY ON FLOORS THE PLAYER MAY FLY. A Mark above the unlock has no seal
  // question yet — it has a Mark question — and ten sockets on a Mark-1 tower
  // would be a bill for a mode that player cannot see the door of.
  const owesSeal = sky ? !open : open && !isSealed;
  // THE STRUCK STAMP — the socket's middle state, on a Mark that is BEHIND the
  // player and carries no stamp (floorSealState's "broken"). The socket was
  // answering two questions with one picture until the owner's pass separated
  // them: a floor nobody has cleared and a floor whose seal a retry took look
  // identical, so the building could show the roof's bill and could not show
  // the player their own history.
  //
  // IT KEEPS `--owed` AS WELL, and that is the load-bearing half of the markup.
  // `--owed` means "this floor still owes the roof a seal" — it is what the
  // locked roof's refusal flares (main.ts's pickTier queries exactly that
  // class) and what the bill is itemised from — and a struck floor owes one
  // every bit as much as an untouched one does. `--broken` adds the second fact
  // on top: that the Tier itself is done. Two classes because there are two
  // facts, and app.css's later rule wins the wash.
  const struck = floorSealState(state, tier) === "broken";
  const seal = isSealed
    ? `<span class="tower__seal" aria-hidden="true"></span>`
    : owesSeal
      ? `<span class="tower__seal tower__seal--owed${struck ? " tower__seal--broken" : ""}" aria-hidden="true"></span>`
      : "";
  // THE CEREMONY'S TIMING, per floor and inline — the one thing about this
  // drawing that cannot be a stylesheet constant, because it depends on where
  // the floor sits in a trip whose length the ladder decides (towerRisePassMs).
  //
  // Custom properties and a class, nothing else: no width, no height, no
  // margin, nothing app.css does arithmetic with. The resting geometry of the
  // tower is byte-identical with the ceremony on and off, which is what keeps
  // sim/uifit's baseline honest about a screen it will never see mid-ride.
  const pass = state.celebrate && state.selected !== SANDBOX_TIER
    ? towerRisePassMs(state.selected, tier)
    : null;
  if (pass !== null && sel) cls.push("is-arriving");
  const rideAt = pass === null ? "" : ` style="--tower-pass:${pass}ms"`;
  return `<button class="${cls.join(" ")}" type="button" data-action="pick-tier" data-tier="${tier}"${rideAt}`
    + ` aria-pressed="${sel}"${open ? "" : ' aria-disabled="true"'}`
    + ` aria-label="${label}${open ? "" : " — locked"}${licenceNote}${accessNote}${isSealed ? " — sealed" : struck ? " — seal broken" : ""}${sealsNote}${contractsNote}">`
    + `<span class="tower__gap" aria-hidden="true"></span>`
    + `<span class="tower__n">${sky ? "SKY" : tier}</span>`
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
    aria-label="Tier S — sandbox. Any Tier, any bay, any Contract. Scores are kept on a separate board."
    >${lamps}</button>`;
}

/** THE PLATE'S OWN NAME, in the shaft's vocabulary.
 *
 *  A lift's rungs read 1-10 and SKY; the ground floor therefore reads LS, in
 *  the same pixel face at the same weight the rungs give their numbers. It used
 *  to read "SCHOOL" once the licence was earned and "3/4" while it was owed —
 *  which is the floor naming itself only after it has stopped mattering, and
 *  printing a fraction where every other plate in the building prints an
 *  identifier. The full name is spoken ONCE, on the primary button that flies
 *  it (menuPlaySub), and the count with it. */
const LICENCE_PLATE = "LS";

/**
 * THE LOBBY — Flight School, the ground floor at the foot of the shaft.
 *
 * towerHeadHTML's opposite number, and deliberately the same shape of thing: a
 * strip outside the shaft's own box that is a decoration in one state and a
 * real floor in another, so the eleven rungs inside keep every pixel of their
 * height arithmetic (see LICENCE_TIER).
 *
 * It is ALWAYS a floor, though — unlike the headhouse, which is a secret until
 * it is found. It is the door the player comes in by, so it is labelled, it is
 * in the tab order, and it is selectable from the very first launch.
 *
 * WHAT CHANGES WITH THE LICENCE IS ITS SIZE, and that is the whole of this
 * component's argument. While the licence is owed every Mark above it is locked
 * (tierOpen), so this plate is the ONLY control in the building that can be
 * pressed — and it shipped as a 22px slab, the shortest target on a screen the
 * rest of which is built to 44. So while it is the door it is drawn as one: an
 * entrance flush with the shaft, a lit awning across the top, the name on the
 * plate and one socket per lesson beside it. The moment the licence lands it
 * drops back to the quiet plinth, because a floor whose job is finished is
 * furniture; app.css hands the height it gives up straight back to the shaft.
 *
 * THE SOCKETS ARE THE BUILDING'S OWN GLYPH. A floor's three windows are its
 * first-clear Contracts (floorHTML); the ground floor's are its lessons, lit as
 * they land. That is why the count left the plate: a fraction in the body face
 * said the same thing in a vocabulary nothing else on this column speaks, and
 * the exact figure is already on the primary button's subtitle, in words.
 *
 * NINE SOCKETS, 3x3, AND THE EXAM IS THE UNLOCK.
 *
 * The grid is squared off its own length (`ceil(sqrt(n))`) and the length is
 * the LESSON list — nine — so the block is 3x3. It has been 2x2 for a
 * four-lesson licence and 4x3 for a twelve-step ladder; the arithmetic is
 * untouched and the number it is fed moved, which is exactly what it was
 * written for.
 *
 * The tenth flight does NOT get a tenth socket, and that is the owner's call
 * for the whole plate: *"9x9 and the unlock makes them all a solid block"*. A
 * tenth socket would break the square into a 4x3 with two holes in it — a
 * shape that says "unfinished" for ever, on the one floor whose finished state
 * matters. So the exam is drawn as what it does to the block rather than as
 * another cell in it: pass it and the nine close up (`--solid` drops the gap
 * and fills every cell), so the plate the player leaves school with is one
 * lit slab.
 *
 * WHICH IS ALSO WHY THE SOCKETS SURVIVE THE LICENCE. They used to vanish on
 * `is-earned` — the plate drops to a quiet plinth once its job is done, and a
 * fraction restating "9 of 9" for the rest of the save's life is a bill that has
 * been paid. A solid slab is not a fraction; it is the building's own glyph for
 * a finished floor, and it costs the same 16x16 the owed state costs.
 */
function towerLobbyHTML(state: TowerState): string {
  const total = state.licenceTotal ?? SCHOOL_STEPS;
  const done = Math.max(0, Math.min(total, state.licenceDone ?? 0));
  const earned = state.licensed !== false;
  const sel = state.selected === LICENCE_TIER;
  const cls = ["tower__base", "tower__base--floor"];
  if (sel) cls.push("is-selected");
  if (earned) cls.push("is-earned");
  // THE COUNT IS THE ACCESSIBLE NAME while the licence is owed, because it is
  // the only number on this screen that says how far from flying the player is
  // — and because the sockets that draw it are a shape, which has no name.
  // Earned, it drops to the floor's state: a finished ladder restating "9 of 9"
  // for the rest of the save's life is a bill that has been paid.
  const note = earned ? "licence earned" : `${done} of ${total} steps`;
  // THE SOCKETS ARE THE LESSONS, and the count they are drawn from is the
  // lesson list rather than the ladder's length — see the header. `done` is
  // still the ladder's numerator, so it is clamped here: a player who has
  // cleared every lesson but not the exam lights all nine and the block is
  // still not solid, which is precisely the state the exam resolves.
  const lit = Math.min(LESSON_COUNT, done);
  const cols = Math.max(1, Math.ceil(Math.sqrt(LESSON_COUNT)));
  const sockets = `<span class="tower__sockets${earned ? " tower__sockets--solid" : ""}" style="--socket-cols:${cols}" aria-hidden="true">${
    Array.from({ length: LESSON_COUNT }, (_, i) => `<i${earned || i < lit ? ' class="on"' : ""}></i>`).join("")
  }</span>`;
  return `<button class="${cls.join(" ")}" type="button"`
    + ` data-action="pick-tier" data-tier="${LICENCE_TIER}" aria-pressed="${sel}"`
    + ` aria-label="Flight School — ${note}. The licence that opens Tier 1.">`
    + (earned ? "" : `<span class="tower__awning" aria-hidden="true"></span>`)
    + `<span class="tower__base-row" aria-hidden="true">`
    + `<span class="tower__base-txt">${LICENCE_PLATE}</span>${sockets}`
    + `</span>`
    + `</button>`;
}

export function tierTowerHTML(state: TowerState): string {
  // Roof first, ground floor last.
  const floors: string[] = [];
  for (let t = SKYDECK_TIER; t >= 1; t--) floors.push(floorHTML(state, t));
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
  // THE LIFT SERVES NEITHER END OF THE BUILDING. Tier S parks the car at the
  // top of the shaft and switches the building off (above); the lobby parks it
  // at the BOTTOM and leaves the building lit, because a lift at ground level
  // is not a lift that has stopped working. Both are the same rule — the shaft
  // is the ladder, and the two floors that are not rungs of it are drawn
  // outside its box — and neither writes an index the shaft cannot hold.
  const lobby = state.selected === LICENCE_TIER;
  const idx = towerIndexOf(off ? SKYDECK_TIER : lobby ? 1 : state.selected);
  // THE CEREMONY (TowerState.celebrate). The car's RESTING position is still
  // the selected floor — `--tower-idx` is untouched — and the ride is drawn as
  // an animation that starts at the ground floor and ends at that rest, so the
  // instant it finishes there is nothing left over to unwind and no JS has to
  // land anything. Which is also why it degrades to the right thing on its own:
  // strip the animation (prefers-reduced-motion) and the car is simply already
  // where it belongs.
  //
  // Never while the lift is out of service. Tier S is not a rung, nothing
  // unlocks it, and a car riding to a floor it does not serve would contradict
  // the one rule the roof is built on.
  const rising = state.celebrate === true && !off && !lobby;
  const ride = rising
    ? `;--tower-rise-from:${towerIndexOf(TOWER_RISE_FROM)}`
      + `;--tower-rise-hold:${TOWER_RISE_HOLD_MS}ms`
      + `;--tower-rise-dur:${towerRiseMs(state.selected)}ms`
      + `;--tower-arrive-dur:${TOWER_ARRIVE_MS}ms`
      // How far in this mount already is — subtracted from every delay below
      // the shaft, so a tower re-rendered mid-ride resumes rather than restarts
      // (see TowerState.celebrateElapsed). Clamped at 0 and floored to whole
      // milliseconds: a negative offset would push the ceremony into the future
      // and desynchronise it from the timer that ends it.
      + `;--tower-rise-elapsed:${Math.max(0, Math.floor(state.celebrateElapsed ?? 0))}ms`
    : "";
  // THE GROUND FLOOR IS ONLY BIG WHILE IT IS THE DOOR (towerLobbyHTML). The
  // class is what app.css sizes the plate — and the tower's own box — off, and
  // it is keyed on the LICENCE rather than on the selection: which floor the car
  // is parked on says nothing about whether the ladder above it can be flown,
  // and the entrance has to be the entrance whether or not the player has
  // wandered up to read a locked Mark's terms.
  const entrance = state.licensed === false;
  return `<div class="tower${off ? " tower--off" : ""}${entrance ? " tower--lobby" : ""}${rising ? " tower--rising" : ""}" role="group" aria-label="Tier tower — pick the Tier to fly">
    <div class="tower__shaft" style="--tower-idx:${idx}${ride}">
      ${towerHeadHTML(state)}
      <!-- THE RUN OF FLOORS, inside the shaft's housing and separate from it,
           because at compact density this is the box that SCROLLS (app.css's
           "THE BUILDING ON A PHONE", sim/uifit/run.ts's ALLOWED_SCROLLERS) and
           two things in the shaft must not: the headhouse, drawn 19px above it
           on a negative top and clipped clean off by any overflow the shaft
           itself takes, and the shaft's own frame. The rail and the car ride
           in here with the floors — both are drawings of where the car is on
           the ladder, and a car that stayed put while its floor scrolled away
           would be pointing at nothing. -->
      <div class="tower__floors">
        <div class="tower__rail" aria-hidden="true"></div>
        <div class="tower__car" aria-hidden="true"><span></span></div>
        ${floors.join("")}
      </div>
    </div>
    <!-- THE FLIGHT SCHOOL LOBBY ONLY WHILE THE LICENCE IS OWED. Onboarding moved
         to the front door (the first-Play tutorial offer), and the hub the tower
         lives on is always licensed by the time it renders — so the ground-floor
         "LS" plinth is drawn only for the unlicensed states the fixtures still
         exercise, never on the player's tower. Off it, the shaft ends at Tier 1,
         which is the ladder's real ground floor now. -->
    ${entrance ? towerLobbyHTML(state) : ""}
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
/**
 * THE LOBBY'S RECAP — what Flight School is, in the slot a Mark's terms sit in.
 *
 * Not the four stat cells with question marks in them (unknownBayPanelHTML's
 * answer for Tier S): a "?" says the terms exist and are not known yet, and
 * here they do not exist at all. What the panel says instead is the only thing
 * a player standing in the lobby needs — how far through they are, and that
 * nothing in the building can be lost.
 *
 * No `best` either. The lobby files to no board, so a high score on it would be
 * a number about a mode that does not keep one.
 *
 * THE TRACK IS THE LADDER'S NUMBERED RUNGS — its ten flights (meta.ts's
 * SCHOOL_LADDER), one pip each, against the "N / 10" beside it. Every pip the
 * player has reached is pressable and flies its bay; a locked one stays a span,
 * so the track cannot become a way to skip the ladder.
 *
 * …ON A SCREEN WITH ROOM FOR TEN TARGETS. At compact density the row ships as
 * a plain readout instead and the primary button below it is the whole of the
 * forward action — see the `flat` track below for the measured widths and the
 * argument.
 *
 * THE TWO GATES ARE NOT PIPS. They were, for a release, and the track drew
 * twelve — which is the count the owner asked to come off every surface
 * ("everything is in 10"). They have not stopped existing: a gate SHUTS the
 * track, `gate` below says which one, and the note under it says what to do
 * about it in the same words the lobby's primary does. A pip you can press and
 * a door you must walk through are different controls, and the menu already
 * carries the doors as buttons.
 */
function licencePanelHTML(
  ladder: { done: number; total: number; gate?: SchoolStepKind | null },
  extras: string,
): string {
  const total = Math.max(1, ladder.total);
  const done = Math.max(0, Math.min(total, ladder.done));
  const owed = done < total;
  const left = total - done;
  // THE RUNGS THE PLAYER CAN PRESS are the cleared ones and the one they are
  // on. A locked rung stays a span, so the track cannot become a way to skip
  // the ladder — the same rule this track has always had, now applied to a
  // ladder whose rungs are not all bays.
  //
  // The ROUTE per rung is the rung's own kind, read off the ladder rather than
  // decided here: `pick-lesson` for a lesson, `pick-exam` for the graduation
  // flight, and the two shop rungs go through the very actions the menu's own
  // buttons carry, so there is exactly one way into each screen.
  // A GATE SHUTS THE NEXT PIP. Without this the track would offer the rung the
  // ladder is refusing — main.ts's `pick-lesson` re-asks schoolLadder and would
  // swallow the press, which is the worst of the three possible behaviours: a
  // control that looks live, is pressed, and does nothing.
  const reach = Math.min(total - 1, ladder.gate ? done - 1 : done);
  const rungs = SCHOOL_LADDER.filter((r) => r.step !== null);
  const pipClass = (rung: (typeof rungs)[number], i: number): string =>
    `lic-pip lic-pip--${rung.kind}${i < done ? " lic-pip--done" : ""}`;
  const pips = rungs.map((rung, i) => {
    const cls = pipClass(rung, i);
    if (i > reach) return `<span class="${cls}"></span>`;
    const name = rung.kind === "exam"
      ? `Fly the ${FINAL_EXAM} — Tier 1, bay 1`
      : `Fly lesson ${(rung.flight ?? 0) + 1}`;
    return `<button type="button" class="${cls} lic-pip--pick" data-action="${
      rung.kind === "exam" ? "pick-exam" : "pick-lesson"
    }" data-lesson="${rung.flight}"`
      + ` aria-label="Step ${rung.step} of ${total} — ${name}"></button>`;
  }).join("");
  // THE SAME TRACK WITH NO PICKER IN IT — the phone's copy of this row.
  //
  // A pickable pip is 44px TALL and, at compact density, 15-25px WIDE: ten
  // buttons sharing one panel row is a target a third of the tap floor wide,
  // on the screen every first-time player passes through (sim/uifit records
  // `.lic-pip 15x44` on the 640x360 budget phone and the iPhone SE 3, 22x44
  // through 25x44 on every other handset). The bar is a PROGRESS READOUT
  // first; on a phone it goes back to being only that, and the row's forward
  // action is the primary button directly underneath — whose subtitle already
  // reads "Step N of 10 · resume" in these exact words (menuPlaySub) and
  // whose press flies the rung the ladder owes. One 44x44-clearing control
  // instead of ten that cannot be one.
  //
  // BOTH TRACKS SHIP AND app.css PICKS ONE BY DENSITY, the same trade the
  // plant panel's two build labels make: a tag cannot be turned into a span
  // by a media query, and the alternative — handing this pure function a
  // viewport — would make every fixture in sim/uifit measure whatever density
  // its ONE cached string was built for.
  //
  // ONE NAME FOR THE WHOLE ROW rather than ten. The pips are a shape, and a
  // screen reader walking ten unlabelled spans learns nothing the panel's own
  // "N / M" head and this label do not already say.
  const flat = rungs.map((rung, i) => `<span class="${pipClass(rung, i)}"></span>`).join("");
  const step = Math.min(total, done + 1);
  // THE COUNT IS THE LADDER'S, on both sides of the licence. It used to be
  // dropped the moment the fourth lesson landed — the panel printed "Licence
  // earned" over a constant "5 advanced exercises remain", which was still
  // saying five at eight of nine. There is no split to describe any more: all
  // ten flights are required, in order, so the note says what the next one is
  // and how many are left behind it — and, when a GATE is what is owed, says
  // that instead, because "3 to go" under a track that refuses the next pip is
  // an explanation of nothing.
  return `<div class="panel base-bay base-bay--licence" aria-label="Flight School — ${done} of ${total} steps">
    <div class="base-bay__head">
      <div class="base-bay__best">${done} / ${total}</div>
    </div>
    <div class="lic-track lic-track--pick" role="group" aria-label="${done} of ${total} steps cleared — pick one">${pips}</div>
    <div class="lic-track lic-track--flat" role="img" aria-label="Step ${step} of ${total}">${flat}</div>
    <p class="lic-note">${
      // DERIVED, not typed, every number of it. A count spelled out in prose is
      // a count that goes stale the day a rung is added — the same rule the
      // rest of this file follows for every price it quotes.
      ladder.gate === "contract"
        ? `<b>Clear one Contract</b> to go on — it pays for your first system.`
      : ladder.gate === "workshop"
        // THE INSTRUCTION AND THE MERCHANDISE ARE ONE STRING. This said "the
        // Reactor" while the shelf it points at shows a card headed "Reactor
        // Output" (upgrades.ts) — near enough for a reader who already knows
        // the game, and two names for one purchase to the player meeting both
        // for the first time, four rungs into their first hour. The shop's
        // blurb already derives it (workshopScreen's `upgradeById(
        // SCHOOL_INSTALL)!.name`); so do the three lines that send people
        // there. SCHOOL_INSTALL is the rung's own constant, so the day the
        // school sells something else, every one of them renames itself.
        ? `<b>Install ${upgradeById(SCHOOL_INSTALL)!.name}</b> in the Workshop to go on. Lessons ${LICENCE_LESSON_COUNT + 1} to ${LESSON_COUNT} open with it.`
      : owed
        ? `<b>${total} flights open Tier 1</b>: ${LESSON_COUNT} lessons and the ${FINAL_EXAM}.`
          + ` ${left} to go, and nothing here can be lost.`
        : `The licence is earned and the ladder is finished. Every lesson can be re-flown.`
    }</p>
    <div class="base-bay__extras">${extras}</div>
  </div>`;
}

function unknownBayPanelHTML(best: number, extras: string): string {
  const cell = (name: IconName, label: string, tint: string): string =>
    statCellHTML(name, label, `<span class="bay-stat__q">?</span>`, tint);
  return `<div class="panel base-bay base-bay--unknown" aria-label="Tier S — set on the sandbox setup screen">
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

/*
 * THE DAY'S CLAUSES USED TO BE PRINTED HERE, and their absence is the feature.
 *
 * The recap panel listed them by name and bay — "Bay 4 Tight Gauge", "Bay 7
 * Cold Weld", "Bay 10 Odd Lots" — as three rows in its extras slot, so that a
 * player could plan the whole day before touching the launcher. That is a
 * different game from the one the Skydeck is: a fixed daily run, no refit yard,
 * and a schedule you fly rather than a schedule you read. Handed the names on
 * the home screen, bay 7 is arithmetic the moment bay 1 starts; discovered at
 * the stop, it is the thing that just happened to your bay.
 *
 * So the names are gone from every menu surface, and they are gone from the
 * DATA the menu is given as well as from its markup: menuScreen now takes a
 * COUNT (see its `standingClauses`), not a list, which is why nothing
 * downstream — no aria-label, no title, no tooltip — can leak one by accident.
 * The count is not a spoiler and stays public on the primary button's subtitle;
 * "three standing clauses" is the terms of the run, and which three is the run.
 *
 * WHERE THEY FIRST APPEAR: the bay-clear card, at the stop the clause arms on
 * ("Cold Chain · from Bay 4" — see bayClearScreen's standing announcement).
 * That announcement is now the reveal, and sim/systems.ts pins both halves —
 * that the menu carries no name, and that the card still does.
 */

export function baseBayPanelHTML(opts: {
  /** The floor the panel is describing — a Mark, SKYDECK_TIER, or SANDBOX_TIER. */
  tier: number;
  best: number;
  /** The entitlement chips, if this build has any. */
  extras?: string;
  /** Flight School's progress, when the lobby is the floor being described.
   *
   *  ALWAYS THE REAL COUNT, never a "still owed" flag — the panel needs the
   *  numbers on both sides of the licence (see licencePanelHTML). It was the
   *  flag, and the two in-place ride patches in main.ts passed nothing at all,
   *  so a lobby rendered at `2 / 4` was rewritten to "Licence earned" the
   *  moment the elevator moved. Absent only on callers that predate the ground
   *  floor, where it falls back to a fresh save's zero. */
  licence?: { done: number; total: number; gate?: SchoolStepKind | null };
  /** The parked floor's seal, when it has one (floorSealState) — the state in
   *  WORDS, next to the floor the tower is stamping one column over.
   *
   *  The stamp on the plate is a shape and it is aria-hidden, so until now the
   *  only place a floor's seal was written down was one aria-label; the owner's
   *  pass asked for it where the floor's other terms are read. It rides the
   *  head row the panel already has rather than a row of its own — see the
   *  .base-bay__seal note in app.css and the one at the markup below for the
   *  arithmetic, whose short version is that the eyebrow had the slack and a
   *  row of its own would have cost three times as much.
   *
   *  Absent or null draws nothing, which is what every floor with no seal
   *  question (the roof, the lobby, the bench, a locked Mark) and every caller
   *  that predates the line renders. */
  seal?: FloorSeal | null;
}): string {
  // Tier S quotes nothing, because nothing is chosen yet — see above.
  if (opts.tier === SANDBOX_TIER) return unknownBayPanelHTML(opts.best, opts.extras ?? "");
  // THE LOBBY QUOTES NOTHING EITHER, and for a sharper reason than Tier S's:
  // every cell on this panel is a Deep Run bay's terms — a funding target, a
  // launch price, a shift clock, a bond multiplier, a belt of materials — and
  // Flight School has none of them. The panel sat directly above a button
  // reading "Flight School" and described a ten-bay run with a bankroll, which
  // is the one thing the ground floor exists to stop the player meeting first.
  if (opts.tier === LICENCE_TIER) {
    return licencePanelHTML(opts.licence ?? { done: 0, total: LESSON_COUNT }, opts.extras ?? "");
  }
  const sky = opts.tier === SKYDECK_TIER;
  // The Skydeck flies the top of the ladder's bay TABLE — same ten bays, same
  // clock, same bonds — with the money curves read one rung further along
  // (level.ts's applySkydeckEconomy). So the mark is MARK_COUNT and the roof
  // flag is what makes the two money cells quote $800→$1880 and $31 · $248
  // instead of the capstone's. The panel is the only place a player sees those
  // numbers before accepting them, so it has to be the run's own.
  //
  // It is the LAST thing on this panel that is specific to the roof, now that
  // the day's clauses are no longer listed here (see the note above) — and the
  // two decisions agree rather than pulling apart: the terms of the run stay
  // public, the contents stay a surprise. A target and a shot price are terms.
  const mark = sky ? MARK_COUNT : Math.max(1, Math.min(MARK_COUNT, opts.tier));
  const bay = baseBayFor(mark, sky);
  const bonds = `×${bay.bondMult.toFixed(1)}${bay.unbreakableCapstone ? " ∞" : ""}`;
  // No "Tier N \u00b7 Base bay" line any more. It named the floor the car is
  // parked on, one column away from the tower that is showing exactly that,
  // and directly above a Deep Run button whose plate says it a third time.
  // Best is what survives: the one number on this panel that appears nowhere
  // else on the screen.
  // THE SEAL, IN WORDS, on the row that was already there — the eyebrow that
  // holds Best, which until now was one right-aligned readout with the whole
  // row to itself.
  //
  // WHAT IT COSTS, measured rather than hoped (Chromium, the uifit fleet): the
  // head row goes 7.00px -> 11.88px and the panel 103px -> 107.9px on a 360px
  // phone. That is not free, and the argument is about WHO PAYS it. The action
  // column's height is the grid row's, and the recap is `flex: none` at the
  // head of it with three buttons sharing what is left — so the 4.9px comes
  // off the buttons' slack (64.8/60.0/60.0 -> 63.2/58.4/58.4 on the 640x360
  // budget row, still 14px clear of the 44px tap floor) and NOT off the column
  // total. The tower beside it measures identically with the line and without
  // (319.84px on that row either way), which is what keeps sim/uifit's baseline
  // for the building honest about a change made to the panel. A line of its own
  // under the row would have cost a whole line-height instead, and the phone
  // block in app.css has already spent every pixel this panel had spare.
  //
  // The GLYPH is the retry doors' own (sealFaceHTML), so the picture next to
  // the floor's name and the picture on the button that spends it are the same
  // octagon in the same three states — see floorSealFace.
  const sealLine = opts.seal
    // The words are their own element because the glyph is a flex item beside
    // them: a text node cannot be ellipsised, and the ellipsis is what keeps
    // the broken state's sentence from wrapping this row (see app.css).
    ? `<p class="base-bay__seal">${sealFaceHTML(floorSealFace(opts.seal))}<span class="base-bay__sealtxt">${
      floorSealLine(opts.seal)
    }</span></p>`
    : "";
  return `<div class="panel base-bay" aria-label="Selected tier \u2014 base bay">
    <div class="base-bay__head">
      ${sealLine}
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

/**
 * THE RUN CARD'S TERMS — what an ordinary Mark's bay costs you, in one line.
 *
 * Three numbers, all of them already on the screen this replaces: the bay count
 * and the clock come off the same `baseBayFor` the recap panel's stat grid read
 * them from, and Best is the one number that panel carried which appears
 * nowhere else on the hub. The panel itself is gone from this screen — four
 * stat cells, a belt ladder and a seal sentence were a page of terms above a
 * button, on a rail that now has four cards to fit — and this is what survived
 * the cut: the two facts that describe the shape of a run, and the score to
 * beat.
 *
 * Exported because main.ts's ride patches `#menu-play-sub` in place while the
 * elevator travels (setPlaySub), and a second copy of this rule there would
 * drift from this one the first time either changed — the exact argument
 * menuPlaySub below is written around. Marks only: the lobby, the sandbox and
 * the roof have no `baseBayFor` bay of this shape and something more urgent to
 * say, so they keep menuPlaySub's sentence.
 */
export function hubRunTerms(tier: number, best: number): string {
  const bay = baseBayFor(Math.max(1, Math.min(MARK_COUNT, tier)));
  return `${bay.bays} bays · ${formatMMSS(bay.timeLimitSec * 1000)} · best ${best}`;
}

/**
 * The primary button's subtitle — ONE copy of the rule.
 *
 * It has to be a function rather than an expression inside the markup because
 * main.ts rewrites this line IN PLACE while the elevator travels (setPlaySub):
 * re-rendering the menu mid-ride would tear down the attract demo, so the ride
 * patches the two halves of the button by id. That left a second copy of the
 * three-way rule in main.ts, which agreed with this one only for as long as
 * neither changed — and the seal step is exactly the change that breaks it,
 * since it gives an ordinary ladder floor a subtitle of its own for the first
 * time. A player tapping a floor at the finished ladder would have watched the
 * objective disappear.
 *
 * `seal` is non-null only while sealing is the next step (meta.ts's nextStep),
 * which is why it selects the line rather than being read from the tower every
 * time: on nine tiers out of ten the seals are a badge, not the thing the game
 * is asking for. `tier` null is the in-flight line.
 *
 * Its `sealed` half is about the PARKED FLOOR, not the ladder — the primary
 * flies one floor, and a floor that already holds its stamp cannot be sealed
 * again however many the roof is still waiting for. See the note on the two
 * seal lines below.
 */
export interface SealPrompt {
  /** Marks the roof is still waiting for (meta.ts's unsealedMarks). */
  owed: number;
  /** The floor this button would fly already holds its seal. */
  sealed: boolean;
}

/**
 * Does the primary wear the NEXT STEP badge with the car parked on `tier`?
 *
 * The same shape as menuPlaySub and for the same reason: the ride patches this
 * button by id (main.ts's setSelectedTier), so a rule stated only inside the
 * markup would be a rule that stops applying the moment the player taps a
 * floor. The badge used to be a property of the STEP alone, which was fine
 * while every step named a screen; the seal step names a floor, and a floor
 * that already holds its stamp cannot be sealed by flying it again.
 *
 * `sealed` is about that floor. Tier S is never badged — the guide points at
 * the ladder and the sandbox is not on it — and at the seal step only a ladder
 * floor can be, since only a Mark has a seal to owe.
 *
 * `firstLaunch` is the OTHER floor of the same rule, and it lives here rather
 * than in the markup for the same reason the rest of it does: the tutorial's
 * START HERE chip is a directive, the NEXT STEP badge is a directive, and A3
 * allows exactly one on the screen at a time. The tutorial owns it until the
 * coach has been finished or skipped. Not only a fresh save's problem — How to
 * Play's "Guided Tutorial" clears seenTutorial on an arbitrarily advanced one
 * (main.ts), so the step the badge would land on can be any of them.
 */
export function menuPlayBadged(
  step: NextStepId | undefined, tier: number, sealed: boolean, firstLaunch = false,
): boolean {
  if (firstLaunch) return false;
  if (tier === SANDBOX_TIER) return false;
  // THE LICENCE STEP BADGES ONE FLOOR — the lobby, and never a Mark. The badge
  // is a directive (A3 allows exactly one on the screen), and pointing it at a
  // floor the player cannot fly yet would be a directive to press a locked
  // button.
  if (step === "licence") return tier === LICENCE_TIER;
  if (tier === LICENCE_TIER) return false;
  if (step === "run") return true;
  if (step !== "seal") return false;
  return tier >= 1 && tier <= MARK_COUNT && !sealed;
}

/**
 * The Tier that flying `tier` would OPEN, or null.
 *
 * One rule, exported, because two surfaces ask it — the menu's markup and
 * main.ts's in-place rewrite as the car travels — and a second copy would drift
 * the moment the ladder's shape moved, exactly as menuPlaySub's own note says.
 *
 * True only on the floor at the TOP of the player's ladder: a Mark already
 * beaten re-flies for the board and the seal, and opens nothing (meta.ts's
 * advanceTier moves the ladder off the current tier, never off an old one). The
 * capstone opens nothing either, and the finished ladder has its own line.
 */
export function tierOpenedBy(tier: number, state: TowerState): number | null {
  if (tier < 1 || tier >= MARK_COUNT) return null;
  if (tier !== state.unlocked) return null;
  // A RUN IS HALF THE PRICE. meta.ts's advanceTier raises the tier only when
  // the run is won AND `tierContracts >= TIER_CONTRACTS_REQUIRED`, so on a save
  // with Contracts still owed — which is every save the moment the licence
  // lands — this promised "opens Tier 2" for a win that returns
  // `completedTier: null` and leaves Tier 2 locked. The button that flies the
  // run is the wrong place to discover the other requirement, so while
  // Contracts are owed this opens nothing and the subtitle says what the run IS
  // instead. The Contract half is already stated on its own button.
  if ((state.contracts ?? 0) < TIER_CONTRACTS_REQUIRED) return null;
  return tier + 1;
}

/**
 * THE GROUND FLOOR, as a button's subtitle needs it (meta.ts's schoolLadder).
 *
 * A COUNT AND THE NEXT RUNG, because the ladder's rungs are no longer all the
 * same kind of thing: two gates sit between lesson 4 and lesson 5, and the
 * lobby's primary flies bays. A subtitle that only knew "5 of 10" could not tell the
 * player whether the thing in their way is a lesson or a purchase, which is the
 * one fact they need while standing on the floor that cannot do either.
 */
export interface SchoolPrompt {
  /** Steps cleared (meta.ts's schoolProgress). */
  done: number;
  /** Steps in the ladder (meta.ts's SCHOOL_STEPS). */
  total: number;
  /** What the ladder is asking for. Null is unreachable while this object
   *  exists at all (a finished ladder passes null for the whole prompt), and is
   *  accepted so a caller never has to invent a rung. */
  next: SchoolStepKind | null;
  /** That rung's 1-based position, for the "step N of M" the subtitles lead
   *  with — NULL at a gate, which takes no ordinal (meta.ts's SCHOOL_LADDER).
   *  The two gate branches return before this is read. */
  step: number | null;
}

/** What the primary's subtitle says when a paywalled floor is tapped and there
 *  is no store to sell it (main.ts's noteStoreUnavailable — purchases.ts's
 *  presentPaywall is a silent no-op until the SDK has configured). On the
 *  button's line rather than in a toast, because the tower is what the player
 *  is reading when they tap it. */
export const STORE_UNAVAILABLE_TEXT = "Store unavailable — try again later";

/** F5: what the Restore button says when the call comes back (main.ts's
 *  onRestore). Restore is the one store action with no UI of its own, so the
 *  button's own face is the entire report — and it had two faces for three
 *  outcomes, which meant a store that failed to answer was reported as a store
 *  that answered "nothing".
 *
 *  `null` is purchases.ts's "the store did not answer": the call threw, or the
 *  SDK never configured. Worded as a retry rather than as a verdict, because
 *  it is the only one of the three that is not news about the purchase. */
export function restoreResultText(result: boolean | null): string {
  if (result === null) return "Restore failed — try again";
  return result ? "Purchases restored" : "Nothing to restore";
}

export function menuPlaySub(
  tier: number | null, clauses: number, seal: SealPrompt | null,
  /** Flight School's progress, while the ground floor still owes a rung. Null
   *  once it is finished, and on every caller that predates it. */
  licence: SchoolPrompt | null = null,
  /** The Tier this floor's Deep Run would OPEN, when flying it is what moves
   *  the ladder. Null on a floor that opens nothing — one already beaten, the
   *  top of the ladder, the roof, the sandbox — and on every caller that
   *  predates the line. */
  opens: number | null = null,
  /** False while no system is installed — the ladder's second lock (meta.ts's
   *  rigStarted). Defaults true, so every caller that predates the on-ramp
   *  prints the line it always did. */
  rigged = true,
): string {
  if (tier === null) return "Elevator moving…";
  if (tier === SANDBOX_TIER) return "Any Tier, bay or Contract · own board";
  // THE LOBBY, and it is asked before the licence gate below because the lobby
  // is the one floor the licence does not gate — a line telling the player to
  // finish Flight School, on the Flight School button, would be a button
  // refusing to do the thing it is for.
  if (tier === LICENCE_TIER) {
    // WRITTEN TO THE BOX, AND THE BOX IS 108 PIXELS.
    //
    // `.btn__sub` is one ellipsised line on a short viewport and a two-line
    // clamp above 700px, and the Flight School row is the narrowest text column
    // on the menu — its title is the only two-word one and it carries the
    // FLIGHT badge beside it. That column used to be estimated at "~165px" and
    // these lines were budgeted in CHARACTERS against it; both numbers were
    // wrong. Measured in the harness on the 640x360 budget phone — the smallest
    // box in the matrix — `#menu-play-sub` is 108px wide on a lobby row and
    // 122px on a ladder row, and FIVE of the seven subtitles this function can
    // put there were past it: the exam at 125px, this one at 125, the Contract
    // gate at 136, the Workshop gate at 136 and the rig gate at 162. A
    // character count cannot see that, so every line below is now sized by the
    // measurement and sim/systems.ts pins the budget itself.
    //
    // PAYLOAD FIRST is what makes them fit without saying less. `.btn__sub`
    // ellipsises from the right, so the rule these lines already followed for
    // numbers ("the numbers lead, the ellipsis only eats prose") is the rule:
    // put the thing the player has to act on — the Exam, the Contract, the
    // Reactor, the count — at the head of the line and let the grammar around
    // it be what gives. The verbs went; the nouns and the figures stayed.
    if (!licence) return "Licence earned · re-fly";
    // THE SUBTITLE NAMES THE RUNG, and on two of the twelve the rung is not a
    // bay — so the primary is disabled there (menuScreen) and this line is the
    // only thing on the screen that says why. Both of those read as an
    // instruction rather than a state ("a Contract to go on", not "no Contract
    // cleared"), which is the rule the rig lock's own line already follows: a
    // subtitle under a button the player just pressed is the one place in the
    // game where an instruction is what they came for. The RUNG leads and the
    // instruction is what is left of the verb — at 136px "Clear one Contract to
    // go on" and "Install the Reactor to go on" both lost their tail, i.e. both
    // lost the half that said the run was gated at all. The Workshop line is
    // named off the shelf (baseBayPanelHTML does the same): "Reactor Output to
    // go on" is 23 characters, the widest line that fits the 105px lobby box.
    if (licence.next === "contract") return "A Contract to go on";   // 97px
    if (licence.next === "workshop") return `${upgradeById(SCHOOL_INSTALL)!.name} to go on`;
    // The graduation flight is a bay like the others to this button, and
    // nothing like them to the player: it is Tier 1's own first bay, with the
    // money, the clock and the fine live. The line names it first for that
    // reason as well as for the fit — it is the one rung whose terms are not
    // "free to fail", and "Step 10 of 10 · Final …" was an ordinal where the
    // warning should be.
    if (licence.next === "exam") return `${FINAL_EXAM} · ${licence.step} of ${licence.total}`; // 100px
    return licence.done === 0
      // "nothing to lose" was 124px and lost "to lose" — the half that says it.
      ? `${licence.total} steps · free to fail`                   // 102px
      : `Step ${licence.step} of ${licence.total} · resume`;      // 103px
  }
  // A LADDER FLOOR WITH THE LICENCE STILL OWED says what is in the way, and
  // says it on the button the player just pressed rather than in a toast over
  // it — the same argument the tower's own refusals make.
  // WRITTEN TO THE BOX — 94px of the 122px this row has on the 640x360 budget
  // phone, the narrowest box in the matrix (see the note at the top of the
  // lobby branch for how all of these were measured). "Finish Flight School ·
  // 4/10" wanted 126px and lost its denominator to the ellipsis, which is the
  // half of the line a player is actually counting. The verb goes instead: the
  // button says FLIGHT SCHOOL and is disabled, so "finish" was the one word
  // here that the control was already saying.
  if (licence) return `Flight School · ${licence.done}/${licence.total}`;
  // …AND THE SAME SENTENCE FOR THE SECOND LOCK. It names the door rather than
  // the state ("one system" and not "no systems installed"), because a
  // subtitle under a button the player just pressed is the one place in the
  // game where an instruction is what they came for. The Workshop button two
  // rows down is wearing the NEXT STEP badge while this line is showing, so
  // the word and the badge point at the same control — which is also what let
  // the sentence come down from 162px to 113 in a 122px box: "Install a system
  // in the Workshop" was ellipsising at "Install a system in the …", i.e. it
  // was spending every pixel it had on the preposition and losing the door.
  if (!rigged) return "One system · Workshop";  // 113px in a 122px box
  // THE DAY'S TERMS, in the order they bite. It used to read "All ten marks at
  // once · no mercy", which described a floor that was not playable yet and
  // promised something the mode does not do — the Skydeck flies Mark 10's
  // bays, not all ten Marks.
  //
  // "No refits" was the middle term until the yard came back (run.ts's
  // refitAfterBay), and a subtitle that still promised it would be selling the
  // one thing the mode had stopped doing. What replaced it is the term that
  // actually distinguishes the floor now that it has a yard again: the bays
  // are a rung above the ladder's last (level.ts's SKYDECK_RUNG), which is
  // what the panel beside this button is quoting in dollars. The clause count
  // stays public and the clause NAMES stay a surprise, which is why this line
  // counts them rather than listing them.
  if (tier === SKYDECK_TIER) return `Today's run · a step above Tier ${MARK_COUNT} · ${clauses} standing clauses`;
  // THE ENDGAME, STATED. With the ladder beaten there is no tier left to open
  // and the roof is the only thing still locked, so the primary stops
  // advertising the bay count and names the price instead: a Mark won with no
  // bay retried is a seal (meta.ts's recordRunEnd), and every Mark sealed
  // opens the Skydeck (skydeckOpen). Until this line the count lived only in
  // the tower's sockets and one aria-label.
  //
  // TWO LINES, because the primary flies ONE floor and the objective is a set.
  // A seal lands without moving meta.mark, so the car stays parked exactly
  // where it was — and on the floor it just sealed, "N Marks left to seal ·
  // win with no bay retried" describes a run that cannot seal anything. The
  // second line says so and hands the player back to the tower, which is the
  // control that picks a floor and already draws an empty socket on every one
  // that owes a stamp. It is deliberately not a refusal: re-flying a sealed
  // Mark for the board is a real thing to want, and this button still does it.
  if (seal) {
    const owed = `${seal.owed} Tier${seal.owed === 1 ? "" : "s"}`;
    return seal.sealed
      ? `Sealed · ${owed} still owed — pick one on the tower`
      : `${owed} left to seal · win with no bay retried`;
  }
  // THE POINT OF FLYING THIS FLOOR, said on the button that flies it. "Clear 10
  // bays in one run" is what the run IS; it has never said what the run is FOR,
  // and the ladder's whole shape — every tier flown to open the next — was
  // stated on no surface a player reads before pressing this. The tower draws
  // the floors and says nothing about why you would climb them.
  //
  // Only where it is true: a beaten floor re-flown opens nothing, and neither
  // does the top of the ladder (see the seal lines above, which are what the
  // finished ladder says instead).
  if (opens !== null) return `Clear ${RUN_LEVELS} bays · opens Tier ${opens}`;
  return `Clear ${RUN_LEVELS} bays in one run`;
}

/** The parked tier's daily Contract board, handed to the hub so its three cards
 *  are playable inline instead of behind a Contracts button. `cards` is main.ts's
 *  todaysContracts in order (so a card's index is its `data-slot`), `cleared` is
 *  the persisted claimed-id list, and `allowance` gates the daily cap the same
 *  way the full Contract board does. */
export interface HubBoard {
  cards: ContractCard[];
  cleared: string[];
  allowance?: { fullGame: boolean; remaining: number };
}

/* ---------------------------------------------------------------------------
 * THE HUB'S TWO MARKS — one vocabulary for "what a Tier is still owed".
 *
 * A Tier opens on two halves: a cleared run and three Contracts (meta.ts's
 * advanceTier). Before this pass the hub stated that twice, in two different
 * dialects — a two-row checklist inside the unlock card ("Clear a run",
 * "Clear 3 Contracts · 0/3") and, separately, three Contract chips with their
 * own cleared/pays/locked words. A player had to read both and match them up.
 *
 * So the halves get GLYPHS instead, and the same glyph appears twice: once on
 * the Unlock button, where the set of them is the legend for what the Tier is
 * waiting on, and once on the control that clears it — the seal on the run
 * card, a check in each Contract card's corner. The legend is then readable
 * without instructions, because every mark in it is already sitting on the
 * button that fills it.
 *
 * The SEAL is the tower's own octagon (the same clip-path `.tower__floor`'s
 * stamp uses), because the run is the thing the building is drawn about. The
 * CHECK is a square, which is a mino, which is what a Contract deals.
 *
 * THE SOCKET is the seal's outer ring, and it exists for the ceremony: on the
 * ready Unlock button the fill is a bright cyan-to-pink sweep, and a cyan
 * octagon on it disappears. `clip-path` clips AFTER filters and shadows, so a
 * drop-shadow or a box-shadow on the mark itself is cut away with everything
 * else outside the polygon — the ring has to be a second, larger element
 * behind it. On the dark surfaces it reads as a hairline; on the bright fill
 * it is what keeps the mark a mark. The checks make the same argument with a
 * 2px ring, which they can do with a box-shadow because a square is not
 * clipped.
 */
function sealMarkHTML(done: boolean, extra = ""): string {
  return `<span class="mark mark--seal${done ? " is-done" : ""}${extra ? ` ${extra}` : ""}"><i class="mark__pip"></i></span>`;
}
function checkMarkHTML(done: boolean, extra = ""): string {
  return `<span class="mark mark--chk${done ? " is-done" : ""}${extra ? ` ${extra}` : ""}"></span>`;
}

/** One daily Contract as a play-now CARD for the hub — the name, the reward,
 *  and a button that starts it (data-action "contract", the slot its index —
 *  the same handler the full board's cards use).
 *
 *  THE GOAL NUMBER IS OFF THE FACE. It used to be the card's headline ("6
 *  lines", in 15px accent mono) and it was the one thing on the card a player
 *  could not act on: the three cards differ by NAME, the reward is why you
 *  pick one, and the ask is the first line of the briefing you get the moment
 *  you tap. Three big numbers in a row read as a comparison the game is not
 *  offering. It stays in the accessible name, where a control list has no
 *  briefing to fall through to.
 *
 *  The button is the tap target, not the card: a card-shaped button whose
 *  corner carries a state mark and whose foot carries a reward reads as three
 *  things to press, and only one of them does anything. */
function contractCardHTML(
  card: ContractCard, slot: number, done: boolean, capped: boolean, pays: number | null,
  /** LOCKED BY THE LADDER, not by the day's allowance — a Flight School save that
   *  has not yet reached the Contract rung. Disabled the same way `capped` is, so
   *  the card cannot start the school Contract before the ladder asks for it (the
   *  old Contracts button carried this as `learningBasics ? disabled`). */
  locked = false,
  /** Practice mode: the Tier's quota is already met, so a clear pays nothing.
   *  Passed rather than derived from `pays === null` so the button's own label
   *  can say which of the two silent states it is in. */
  practice = false,
  /** THIS CARD IS ONE OF THE HALVES THE TIER IS STILL WAITING ON. Pressing the
   *  locked Unlock blinks every owed half (main.ts selects
   *  `.tierhub__actions .is-owed`), which is how that button answers "why not"
   *  — it points at the controls instead of printing a sentence. Only while a
   *  claim is actually pending: nothing is owed on a finished ladder. */
  owed = false,
  /** THE GUIDE IS POINTING AT THIS ROW (meta.ts's nextStep is "contracts").
   *  The warm border lands on every card still worth playing — clearing any of
   *  them advances the step — and `mark` is true on exactly ONE of them, the
   *  first still open, because A3 allows the screen one directive and three
   *  identical marks would be a row shouting rather than a next step. */
  next = false,
  mark = "",
): string {
  const kindLabel = card.kind === "pattern" ? "Pattern" : card.kind === "setpiece" ? "Set Piece" : "Lines";
  const unit = card.kind === "setpiece" ? "in a row" : card.goal === 1 ? "line" : "lines";
  const reward = done
    ? `<span class="tierhub__pay is-done">Cleared</span>`
    : locked
    ? `<span class="tierhub__pay is-locked">Locked</span>`
    : pays !== null
    ? `<span class="tierhub__pay">${salvageHTML(`+${pays}`, 13)}</span>`
    : `<span class="tierhub__pay is-practice">Practice</span>`;
  const shut = capped || locked;
  const label = locked ? "Locked" : done ? "Play again" : practice ? "Practice" : "Play";
  // THE PREVIEW — what the bay will deal, as the belt's own miniatures: a
  // pattern Contract's exact inventory, the one shape a set piece rigs, the
  // material a lines Contract carries, or the cleared-line mark when it
  // carries none. Rendered always, drawn only where the card has a middle
  // (app.css's roomy rail): on a phone the name, the reward and the button
  // are the whole card. No numbers on purpose — the count of shapes IS the
  // row of miniatures, and the ask stays the first line of the briefing.
  const preview = card.kind === "pattern"
    ? card.queue.map((t) => pieceMiniHTML(t, 16)).join("")
    : card.kind === "setpiece"
    ? pieceMiniHTML(RACK_PIECE, 16)
    : card.material
    ? materialIconHTML(card.material, 26)
    : icon("line", 28);
  return `<div class="tierhub__card tierhub__contract${done ? " is-done" : ""}${
    shut ? " is-shut" : ""
  }${owed ? " is-owed" : ""}">
    <span class="tierhub__contract-name">${card.name}</span>
    ${checkMarkHTML(done, "mark--corner")}
    <span class="tierhub__preview" aria-hidden="true">${preview}</span>
    ${reward}
    <button class="btn ${done || practice || locked ? "btn--secondary" : "btn--primary"} tierhub__go${
    next ? " btn--next" : ""
  }" data-action="contract" data-slot="${slot}"${
    shut ? " disabled aria-disabled=\"true\"" : ""
  } aria-label="${kindLabel} Contract, ${card.name}: ${card.goal} ${unit}${done ? ", cleared" : locked ? ", locked" : capped ? ", daily limit reached" : ""}">${
    locked ? "" : icon("play", 10)
  }${label}${mark}</button>
  </div>`;
}

/**
 * THE TIER HUB — the intermediate "play" screen, reached from the home screen's
 * Play button (main.ts's "tiers" state). It carries everything about FLYING a
 * tier: the tierlevator, the parked floor's recap, and the three loop actions
 * (the tier run, Contracts and the Workshop). Its objective banner names the one
 * thing to do to open the next Tier.
 *
 * This used to be the whole menu (`menuScreen`) — the demo/wordmark, the shelf
 * and this column all on one screen. The double-gameplay UX split it: the
 * front door (menuScreen, below) is now just Play / Tutorial / Settings / Buy,
 * and this is where Play lands. The tower's in-place ride (main.ts's
 * setSelectedTier, setPlaySub) still patches the ids below — the ride only runs
 * while this screen is mounted, so those ids only have to exist here.
 */
export function tierHubScreen(
  best: number,
  salvage = 0,
  // The Full Game purchase lives on the front door now, not the hub, so the
  // store state is no longer read here — kept in the signature to stay
  // positionally identical to menuScreen (main.ts hands both the same args).
  _store?: StoreState,
  progress?: TierProgress,
  guide?: {
    step: NextStepId;
    install: { name: string; cost: number } | null;
    firstLaunch: boolean;
    /** IS THE DIRECTIVE STILL NEWS? The alert mino marks the one control the
     *  guide is pointing at, and a mark that never goes away stops being a
     *  mark — a rail wearing the same amber square every time the player walks
     *  past it is decoration, not a directive. main.ts acknowledges a step once
     *  the player has been shown it and passes `false` from then on, which
     *  leaves the WARM BORDER on the control (the step is still the step) and
     *  takes only the square. Optional, and absent reads as fresh: every
     *  caller that predates the acknowledgement — the sim pins, the uifit
     *  fixtures — keeps showing the mark it always did. */
    fresh?: boolean;
  },
  /** Which floor the car is parked on and which floors are open. Absent only
   *  where `progress` is (a caller with no meta state at all), and the screen
   *  then falls back to a one-floor tower at Tier 1 rather than to no tower —
   *  the shaft is the menu's centre column, and a hole there is worse than a
   *  ground floor. */
  tower?: TowerState,
  /** HOW MANY standing clauses today's Skydeck run carries (game/skydeck.ts's
   *  CLAUSE_COUNT), for the primary button's subtitle when the car is parked on
   *  the roof.
   *
   *  A COUNT, and it used to be the list. The recap panel printed the clauses by
   *  name and bay, and the owner's call is that the day's schedule is something
   *  you fly rather than something you read — so the names now first reach the
   *  player on the bay-clear card at the stop each one arms on (see the note
   *  above baseBayPanelHTML). Narrowing the parameter is what makes that a
   *  property of the code rather than a promise: a screen that is never told a
   *  clause name cannot leak one into an aria-label, a title or a tooltip.
   *
   *  Passed rather than computed, for the reason every other date-derived
   *  argument on this screen is: a screen that read the clock would render
   *  differently every morning, which is fine in the app and fatal in
   *  sim/uifit. */
  standingClauses = 0,
  /** The parked tier's daily Contract board, rendered inline as three
   *  play-now cards in place of the old Contracts button (main.ts's
   *  todaysContracts + the claimed list). Absent on the fallback tower and
   *  every fixture that predates the inline board, which then simply omits the
   *  cards row. */
  board?: HubBoard,
): string {
  const twr: TowerState = tower ?? {
    unlocked: progress?.tier ?? 1,
    selected: progress?.tier ?? 1,
    skydeck: false,
    contracts: progress?.contracts ?? 0,
  };
  // The Deep Run flies the SELECTED floor, so everything on that button reads
  // off `selected` rather than off the unlocked Mark. main.ts rewrites both
  // parts in place while the car is travelling (it must not re-render the
  // menu — that would tear down the attract demo mid-animation), which is why
  // they carry ids rather than being found by shape.
  const sel = twr.selected;
  const skySel = sel === SKYDECK_TIER;
  const sbxSel = sel === SANDBOX_TIER;
  const licSel = sel === LICENCE_TIER;
  // THE LICENCE, as the button's subtitle needs it: null once earned, so every
  // line below can ask "is the licence still owed" by asking whether this is
  // there. Absent on the fallback tower and every fixture that predates the
  // ground floor, which is what keeps them rendering the menu they always did.
  const licence: SchoolPrompt | null = twr.licensed === false
    ? {
      done: twr.licenceDone ?? 0,
      total: twr.licenceTotal ?? SCHOOL_STEPS,
      // The rung the ladder is asking for: the GATE when one is owed, and
      // otherwise the flight the count lands on. Two facts, and both of them
      // have to be passed — a count alone cannot say whether a save four
      // flights in is at the Contract, at the Workshop or at lesson 5 (see
      // TowerState.gate).
      next: twr.gate ?? ((twr.licenceDone ?? 0) >= LESSON_COUNT ? "exam" : "lesson"),
      // NULL AT A GATE, because a gate has no ordinal to print — the subtitle
      // says what to do there instead of counting it (menuPlaySub).
      step: twr.gate ? null : Math.min(twr.licenceTotal ?? SCHOOL_STEPS, (twr.licenceDone ?? 0) + 1),
    }
    : null;
  // THE FOURTH RUNG IS WHAT OPENS THE TWO SHOPS, not the whole ladder — they
  // are the two GATES on it, so a door that stayed shut until the licence
  // landed would be a door the ladder cannot get past. Absent reads as done,
  // which is what keeps every caller that predates the two gates
  // rendering the menu it always did.
  const learningBasics = twr.basics === false;
  // …AND THE WORKSHOP WAITS ONE RUNG LONGER THAN THE BOARD DOES. The two shops
  // are the ladder's two GATES and they are in an order: the Contract rung
  // comes first, and its single clear is what pays for the one card on the
  // school's shelf (meta.ts's SCHOOL_LADDER; recordContractClear banks exactly
  // the shelf's price). schoolLadder enforces that order with a running
  // `reached` flag — the first rung that is not done shuts every rung after it
  // — so the ladder's Workshop rung is shut until the Contract is cleared.
  //
  // This button was not. Both doors opened together on the fourth basic, so a
  // player who had just landed lesson 4 could walk into a shop the ladder had
  // not reached, and meet one card they could not afford — while the primary
  // two buttons above them said "Clear one Contract to go on". One ladder, two
  // answers, and the menu's was the laxer.
  //
  // `gate === "contract"` is exactly "the ladder is stopped at the Contract
  // rung" (TowerState.gate — passed rather than derived, because the gates take
  // no ordinal and the count cannot imply which one is owed), and the
  // `rigged === false` half is the ladder's own escape hatch, stated the same
  // way it states it: a rung that is DONE stays open whatever happened before
  // it, and a save that already owns a system has cleared this one.
  const workshopShut = learningBasics
    || (twr.gate === "contract" && twr.rigged === false);
  // …AND THE TWO RUNGS THAT ARE NOT BAYS DISABLE THE PRIMARY, on the same
  // argument the rig lock makes for the Deep Run's: the primary is not a
  // chooser, it is THE action, and an enabled action that does nothing is the
  // worst control on the screen. Its subtitle carries the instruction
  // (menuPlaySub) and the badge is already on the button that performs it.
  const lobbyShops = licence !== null
    && (licence.next === "contract" || licence.next === "workshop");
  // THE SECOND LOCK, and it disables the primary the way the licence disables
  // the other two. A button that shakes its head is what the tower's floors do
  // — they are a chooser, and refusing a pick is information. The primary is
  // not a chooser: it is THE action, and an enabled action that does nothing is
  // the worst control on the screen. Its subtitle carries the reason
  // (menuPlaySub), so the disabled state is never mute.
  //
  // Asked of tierOpen rather than of `rigged` directly, because "may this floor
  // fly" has exactly one owner and this button flies the parked floor.
  const playLocked = !tierOpen(twr, sel) || (licSel && lobbyShops);
  // THE SEAL STEP RIDES THE PRIMARY, because a seal is flown and not bought
  // (meta.ts's nextStep). It is the run's badge under another name, so it
  // lights the same button — what changes is the subtitle, which is the only
  // place on this screen that says how many Marks the roof is still waiting
  // for in words. The count comes off the tower's own list rather than a new
  // parameter: the building already draws a socket per owed Mark, and two
  // sources for one number is how they end up disagreeing.
  //
  // …EXCEPT ON A FLOOR THAT IS ALREADY SEALED. The badge is a claim about the
  // button under it, and this button flies the PARKED floor. A seal lands
  // without moving meta.mark, so nothing dislodges the pick when the floor the
  // car is on becomes sealed, and the badge went on promising a seal that run
  // could not land. (Codex P2, #140.) The claim goes rather than the parking:
  // the tower is the chooser, and menuPlaySub's second line sends the player
  // there instead of quietly driving them there.
  const sealStep = guide?.step === "seal";
  const sealsOwed = MARK_COUNT - (twr.sealed ?? []).filter((m) => m >= 1 && m <= MARK_COUNT).length;
  const selSealed = (twr.sealed ?? []).includes(sel);
  // ONE DIRECTIVE ON THE SCREEN (A3), and on first launch it is the tutorial's.
  // The demo panel's START HERE chip and the computed NEXT STEP badge are the
  // same claim in the same amber — two of them at once is the screen naming two
  // "one next steps", which is what a fresh save showed: START HERE on the demo
  // and NEXT STEP on Contracts, since a fresh save's step IS Contracts
  // (meta.ts's nextStep). The step badge is not cancelled, only deferred: it
  // takes over the moment the tutorial chip goes, with nothing else changed.
  const firstLaunch = guide?.firstLaunch === true;
  const contractsNext = !firstLaunch && guide?.step === "contracts";
  const workshopNext = !firstLaunch && guide?.step === "workshop";
  const badged = menuPlayBadged(guide?.step, sel, selSealed, firstLaunch);
  // THE OBJECTIVE ROW — the one thing this screen exists to say, sharing its
  // row with the two ways off the screen (the leaderboard, and Back).
  //
  // On the ladder that thing is a CLAIM, so it is a button rather than a
  // headline: the Unlock legend below. Only the states with no Tier left to
  // open — the roof, a finished ladder — fall back to a line of text, because
  // in those there is nothing to press.
  const unlockedMark = twr.unlocked;
  const runDone = progress?.runDone === true;
  const contractsHave = Math.min(progress?.contracts ?? 0, progress?.needed ?? TIER_CONTRACTS_REQUIRED);
  const contractsNeed = progress?.needed ?? TIER_CONTRACTS_REQUIRED;
  const contractsDone = contractsHave >= contractsNeed;
  // THE TOP TIER'S CLAIM USED TO BE UNPRESSABLE, and this is the fix.
  //
  // The old derivation was `unlocked < MARK_COUNT ? unlocked + 1 : null`, and
  // it hid the whole unlock card at the top of the ladder. But meta.ts's
  // tierReady allows a claim while `mark < MARK_COUNT`, and at that point
  // markUnlocked — which is what `twr.unlocked` is — already reads MARK_COUNT.
  // So the last claim on the ladder, the one that closes it and opens the seal
  // phase, rendered no button at all: both halves landed, nextStep returned
  // "unlock", and the screen the badge points at had nowhere to put it.
  //
  // WHY THE TOP IS ASKED OF THE GUIDE AND NOT OF THE COUNT. `markUnlocked` is
  // `min(MARK_COUNT, mark + 1)`, so a save at mark 9 (the top tier in
  // progress) and a save at mark 10 (the ladder finished) hand this screen the
  // SAME number, and the halves cannot break the tie either — a post-ladder run
  // still ticks tierRunDone and a post-ladder Contract still ticks
  // tierContracts, they just no longer open anything. The one input that knows
  // the difference is the step, because nextStep asks tierUnlockReady, which
  // asks `mark < MARK_COUNT` directly. So below the top the legend renders
  // always (locked or ready, as before); AT the top it renders exactly when the
  // claim is live. A hidden-but-pressable state is the bug; a claim shown one
  // visit early is not worth a new field on the tower to buy.
  const ladderTop = unlockedMark >= MARK_COUNT;
  const claimStep = guide?.step === "unlock";
  const claimable = unlockedMark >= 1 && (!ladderTop || claimStep);
  const unlockReady = claimable && runDone && contractsDone;
  // WHAT THE CLAIM OPENS, in its own words. Below the top it is the next rung;
  // at the top there is no Tier 11 — the Mark it advances is what opens the
  // Skydeck (meta.ts's skydeckOpen), so the button says that instead of
  // counting to a floor the building does not have.
  const claimTitle = ladderTop ? "Open the Skydeck" : `Unlock Tier ${unlockedMark + 1}`;
  // The sub is the legend in words, for the reader who cannot see the marks:
  // which half is done, and how many Contracts of how many.
  const claimSub =
    `${runDone ? "Run cleared" : "Clear a run"} · Contracts ${contractsHave}/${contractsNeed}`;
  // THE PLAIN OBJECTIVE, for the two states with no claim on offer — minus the
  // branch the legend now owns.
  const hubObjTitle = licence !== null
    ? "Finish Flight School"
    : sealsOwed > 0
    ? "Seal every Tier"
    : "Every Tier cleared";
  // ONE CONDITION FOR BOTH LINES. The sub used to branch on the STEP while the
  // title branched on the count, so the two could disagree: the seal step drew
  // "Seal every Tier" over "Seal every Tier from the Skydeck" (the title again,
  // with a preposition that named the wrong place), and a fully sealed save
  // still offered to seal what it had cleared. Branching both on `sealsOwed`
  // makes the sub the title's second half — what to DO about it — in every
  // state the objective renders.
  const hubObjSub = licence !== null
    ? "Clear the lessons to open Tier 1"
    : sealsOwed > 0
    ? "Win a Tier with no bay retried to seal it"
    : "Fly any Tier, or the Skydeck";
  // THE ONE DIRECTIVE, AS A MARK. `fresh` is main.ts's acknowledgement — once
  // the player has been shown a step the square goes and the warm border
  // stays (see the guide argument's own note). Absent reads as fresh.
  const stepFresh = guide?.fresh !== false;
  const mino = (on: boolean): string => (on && stepFresh ? alertMinoHTML() : "");
  const unlockNext = !firstLaunch && guide?.step === "unlock";
  // THE LEGEND — one seal for the run, three checks for the Contracts, in the
  // same glyphs the controls below wear (see sealMarkHTML's note). It is the
  // whole of what the Unlock button used to say in a two-row checklist.
  const legend = `<span class="tierhub__legend" aria-hidden="true">${
    sealMarkHTML(runDone)
  }${
    Array.from({ length: contractsNeed }, (_, i) => checkMarkHTML(i < contractsHave)).join("")
  }</span>`;
  // THE CEREMONY — ten pixel sparkles at fixed positions, twinkling out of
  // phase. Authored as a list rather than generated from a seed because they
  // are a COMPOSITION: they sit in the gaps between the title, the sub and the
  // legend, and a random scatter puts half of them under the type. The delays
  // are the index times a tenth of the 2.4s cycle, so no two ever flash
  // together and the button never looks like it is blinking.
  const SPARKS: ReadonlyArray<readonly [number, number, boolean]> = [
    [8, 22, false], [22, 70, true], [38, 18, true], [47, 62, false], [58, 30, true],
    [71, 74, false], [84, 20, true], [93, 58, false], [30, 45, true], [64, 48, true],
  ];
  const sparks = unlockReady
    ? SPARKS.map(([x, y, dot], i) =>
      `<i class="tierhub__spark${dot ? " tierhub__spark--dot" : ""}" style="left:${x}%;top:${y}%;animation-delay:${
        (i * 0.24).toFixed(2)
      }s"></i>`).join("")
    : "";
  // PRESSABLE WHILE LOCKED, and that is the point. A disabled Unlock answers
  // "why not" with nothing; this one is a real button that main.ts blinks the
  // owed halves of (data-ready says which face it is wearing, so the handler
  // does not have to read a class list). The ready face is the primary, wrapped
  // in the ceremony ring.
  const unlockBtn = `<button class="btn ${
    unlockReady ? "btn--primary" : "btn--secondary"
  } tierhub__unlock-btn${unlockReady ? " is-ceremony" : ""}${
    unlockNext ? " btn--next" : ""
  }" data-action="claim-tier" data-ready="${unlockReady}" aria-label="${claimTitle} — ${claimSub}">${sparks}<span class="btn__txt"><span>${
    claimTitle
  }</span><span class="btn__sub">${claimSub}</span></span>${legend}${
    // THE MARK GOES INSIDE the control it names on the locked face, and on the
    // wrapper below on the ready one — main.ts's acknowledgement walks from the
    // pressed control outwards looking for it, and both places are on that walk.
    unlockReady ? "" : mino(unlockNext)
  }</button>`;
  // The halo is a WRAPPER, not a border: the conic ring has to sit outside the
  // button's own edge (3px of padding, pulled back by an equal negative margin
  // so the row's arithmetic is unchanged), and the mark rides the wrapper's
  // corner rather than the button's so the ring never cuts it. It carries
  // `.tierhub__card` for the acknowledgement walk — see the CSS.
  const unlockCard = unlockReady
    ? `<div class="tierhub__halo tierhub__card">${unlockBtn}${mino(unlockNext)}</div>`
    : unlockBtn;
  const objective = claimable
    ? unlockCard
    : `<div class="tierhub__lead-txt"><span class="tierhub__obj-ttl">${hubObjTitle}</span><span class="tierhub__obj-sub">${hubObjSub}</span></div>`;
  // THE RUN CARD'S SECOND LINE — the terms of the floor the car is parked on,
  // on the ordinary Marks, and menuPlaySub's own sentence everywhere it has
  // something more urgent to say (a locked floor's reason, the lobby's rung,
  // the seal count, the roof, the sandbox). The terms replaced "Clear 10 bays ·
  // opens Tier N" because the legend one row up now states exactly what this
  // run opens, twice over — in words and in the seal glyph sitting on this very
  // card — and a card that repeats the row above it is a card saying nothing.
  const playSub = menuPlaySub(
    sel, standingClauses, sealStep ? { owed: sealsOwed, sealed: selSealed } : null, licence,
    tierOpenedBy(sel, twr), twr.rigged !== false,
  );
  // Every case menuPlaySub has a SENTENCE for keeps it: the lobby and the
  // sandbox (which are not bays of this shape at all), a licence still owed,
  // the seal count, the roof, and the on-ramp's rig nudge. What is left is the
  // branch the terms replace — "Clear 10 bays · opens Tier N".
  const ordinaryFloor = sel >= 1 && sel <= MARK_COUNT
    && licence === null && !sealStep && twr.rigged !== false;
  const runSub = ordinaryFloor ? hubRunTerms(sel, best) : playSub;
  const runTitle = licSel ? "Flight School" : sbxSel ? "Sandbox" : skySel ? "Skydeck" : "New Run";
  const runLabel = licSel ? "Start lesson" : sbxSel ? "Open Sandbox" : skySel ? "Fly the Skydeck" : "Start new run";
  // THE EARN ROW — the parked tier's Contracts, playable inline. A won Contract
  // pays the tier's milestone share while the quota is open (contractsHave <
  // contractsNeed) and nothing after; the daily allowance caps the uncleared
  // ones for a trial save. Each card's slot is its index in the board main.ts
  // handed us, which is todaysContracts' own order, so the tap starts the right
  // Contract. Absent when no board was passed.
  const earnPays = contractsHave < contractsNeed ? (progress?.milestone ?? null) : null;
  // …and the whole row is LOCKED while Flight School is still on its basics, the
  // same gate the old Contracts button carried (`learningBasics ? disabled`):
  // the school's one card cannot start before the ladder reaches its Contract
  // rung, and `canStartContract` gates the day's allowance, not the ladder.
  const cardOpen = (c: ContractCard): boolean =>
    !board!.cleared.includes(c.id)
    && !learningBasics
    && !(board!.allowance?.fullGame === false && (board!.allowance.remaining ?? 0) <= 0);
  // The ONE mark on the row is the first card a tap can still act on — see
  // contractCardHTML's `mark`. -1 when the row has none, which is a row that
  // cannot advance the step and so has nothing to point at.
  const markSlot = board ? board.cards.findIndex(cardOpen) : -1;
  const earnRow = board && board.cards.length > 0
    ? `<div class="tierhub__cards" role="group" aria-label="Today's Contracts">${
      board.cards.map((c, i) => {
        const done = board.cleared.includes(c.id);
        const capped = !done && board.allowance?.fullGame === false
          && (board.allowance.remaining ?? 0) <= 0;
        return contractCardHTML(
          c, i, done, capped, done ? null : earnPays, learningBasics && !done,
          earnPays === null, claimable && !contractsDone && !done,
          contractsNext && cardOpen(c),
          contractsNext && i === markSlot ? mino(true) : "",
        );
      }).join("")
    }</div>`
    : "";
  return `<div class="screen neon-backdrop">
    <div class="menu split menu--hub">
      <!-- TWO COLUMNS: the tierlevator on the LEFT, every control on the RIGHT.
           The demo and the wordmark belong to the front door (menuScreen); this
           screen is reached by pressing Play there, so it opens on the ladder
           and the loop rather than on the pitch. -->
      ${tierTowerHTML(twr)}
      <!-- THE RAIL IS THE TOWER'S HEIGHT, exactly — four rows, and the
           Contracts row takes whatever slack the other three leave (app.css).
           The two columns are one picture: a building, and the four things you
           can do with the floor the car is parked on. -->
      <div class="menu__actions tierhub__actions">
        <!-- 1. THE OBJECTIVE, and the two ways off this screen. Back is the
             LAST thing in the row rather than the first: the claim is what the
             player came for, and a rail that opens with an exit reads as a
             dialog. -->
        <div class="tierhub__obj">
          ${objective}
          <button class="icon-btn tierhub__lead" data-action="leaderboard" aria-label="Leaderboard">${icon("leaderboard", 18)}</button>
          <button class="icon-btn tierhub__back" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
        </div>
        <!-- 2. THE RUN. A PANEL, not a button: the plate, the terms and the
             seal glyph are readouts, and the one thing that starts a run is
             the button inside it. The ride (main.ts's setSelectedTier) still
             patches the title and the subtitle by id while the car travels. -->
        <div class="tierhub__card tierhub__run${sbxSel ? " is-sbx" : ""}${
          claimable && !runDone ? " is-owed" : ""
        }">
          ${tierPlateHTML(sel, "menu")}
          <span class="tierhub__card-txt">
            <span class="tierhub__card-ttl" id="menu-play-ttl">${runTitle}</span>
            <span class="tierhub__card-sub" id="menu-play-sub">${runSub}</span>
          </span>
          <button class="btn ${
            unlockReady ? "btn--secondary" : "btn--primary"
          } tierhub__go tierhub__go--run${badged ? " btn--next" : ""}" data-action="play" id="menu-play"${
            playLocked ? " disabled aria-disabled=\"true\"" : ""
          }>${icon("play", 10)}${runLabel}${mino(badged)}</button>
          ${sealMarkHTML(runDone, "mark--corner")}
        </div>
        <!-- 3. THE CONTRACTS, three cards, each a tap away from the bay it
             deals. The row grows into whatever the rail has left, so the cards
             are the one thing on this screen that gets bigger on a tablet. -->
        ${earnRow}
        <!-- 4. THE WORKSHOP, the run card's twin: the same panel, the same
             title/readout stack, the same button on the right. Its readout is
             the bank, because what a shop is worth knowing about from outside
             is what you can afford in it. -->
        <div class="tierhub__card tierhub__shop">
          ${icon("workshop", 22)}
          <span class="tierhub__card-txt">
            <span class="tierhub__card-ttl">Workshop</span>
            <span class="tierhub__bank">${salvageHTML(salvage, 16)}</span>
          </span>
          <button class="btn btn--secondary tierhub__go tierhub__go--shop${
            workshopNext ? " btn--next" : ""
          }" data-action="workshop"${
            workshopShut ? " disabled aria-disabled=\"true\"" : ""
          } aria-label="Workshop · ${
            // THE RUNG IN THE WAY, verbatim — the same sentence the shut
            // button's subtitle used to print on its face. The face has no
            // room for it any more (the card's readout is the bank, and the
            // button is a 44px label beside it), and a control list read
            // without the card is exactly where "why not" has to survive.
            learningBasics
              ? `Opens after lesson ${LICENCE_LESSON_COUNT}`
              : workshopShut
              ? "Opens after one Contract"
              : "Buy upgrades"
          }">${icon("workshop", 12)}Buy upgrades${mino(workshopNext)}</button>
        </div>
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

/**
 * THE FRONT DOOR — the streamlined home screen. Four things and no more: the
 * self-playing demo as the pitch, and the four actions a player opens the app
 * to reach — Play (which leads to the tier hub, tierHubScreen), the tutorial,
 * Settings and the Full Game purchase. Everything about FLYING a tier — the
 * tierlevator, the recap, Contracts and the Workshop — moved to the hub Play
 * opens, so this screen never has to hold four numbers in the player's head.
 *
 * The signature is the tier hub's, positionally: main.ts and the sim/uifit
 * fixtures hand both screens the same arguments, and the home simply ignores
 * the ones it no longer needs (the underscore-prefixed params). The demo panel
 * keeps class `menu__demo` because syncAttract mounts the attract bay by that
 * selector while the "menu" state is up (main.ts), exactly as before.
 */
export function menuScreen(
  _best: number,
  _salvage = 0,
  store?: StoreState,
  _progress?: TierProgress,
  guide?: {
    step: NextStepId;
    install: { name: string; cost: number } | null;
    firstLaunch: boolean;
    /** IS THE DIRECTIVE STILL NEWS? The alert mino marks the one control the
     *  guide is pointing at, and a mark that never goes away stops being a
     *  mark — a rail wearing the same amber square every time the player walks
     *  past it is decoration, not a directive. main.ts acknowledges a step once
     *  the player has been shown it and passes `false` from then on, which
     *  leaves the WARM BORDER on the control (the step is still the step) and
     *  takes only the square. Optional, and absent reads as fresh: every
     *  caller that predates the acknowledgement — the sim pins, the uifit
     *  fixtures — keeps showing the mark it always did. */
    fresh?: boolean;
  },
  _tower?: TowerState,
  _standingClauses = 0,
): string {
  // ONE DIRECTIVE ON THE SCREEN (A3): on first launch it is the tutorial's,
  // and Play is the door it is offered behind. Every other next step lives on
  // the hub, on the button that actually performs it — so Play here never
  // carries a badge, and the front door shows at most the one mark.
  //
  // A MINO, not the "Start here" chip (alertMinoHTML). The front door and the
  // hub are the two screens a player walks through rather than reads, and they
  // now use the same mark for the same claim; the chip keeps the surfaces where
  // the badge sits inside prose. The subtitle under Play already says the
  // words the chip was saying ("Start with the tutorial"), one line down and in
  // a face meant for reading.
  const firstLaunch = guide?.firstLaunch === true;
  // Acknowledgement takes the square and leaves the warm border, exactly as on
  // the hub — see the guide argument's `fresh` note in tierHubScreen.
  const firstMark = firstLaunch && guide?.fresh !== false;
  return `<div class="screen neon-backdrop">
    <div class="menu split menu--home">
      <!-- TWO COLUMNS, mirroring the hub (screens.ts's tierHubScreen): the demo
           panel on the LEFT as the visual centrepiece, the four actions as a
           calm rail on the RIGHT, vertically centred against the taller demo.
           Home and the hub read as one system this way — the same split grid,
           the same right-hand action rail. It collapses to one column (demo
           over buttons) in portrait, on the split's own aspect query. -->
      <div class="menu__brand">
        <!-- The demo (game/attract.ts drives the canvas) with the wordmark and
             its description sitting in it. main.ts adds the is-live class only
             once the canvas is actually being drawn into; while it is, the
             paragraph is the canvas's text alternative, and on reduced motion
             (or without a 2D context) it is shown on screen. The brand block now
             wraps ONLY the demo — it is the demo's own column, and the width
             equation (--brand-cap, app.css) still solves against it — while the
             action rail is its sibling in the grid. -->
        <div class="menu__demo">
          <canvas class="menu__demo-canvas" aria-hidden="true"></canvas>
          <h1 class="menu__title display neon-text brand-gradient" aria-label="Tetrilaunch"><span>TETRI</span><span>LAUNCH</span></h1>
          <p class="menu__sub">Load the cannon, arc your tetrominoes across the bay, and feed
          full rows into the compactor before it sweeps them away — across a 10-bay gauntlet
          where every cleared bay ratchets one difficulty axis of your choosing.</p>
        </div>
      </div>
      <!-- The four front-door actions, plainly worded, as the right-hand rail.
           Play is the primary and leads to the tier hub; the tutorial follows
           the fresh-save face (Tutorial with a Start here chip, or How to Play);
           then the Full Game entry (a badge once owned) and Settings. -->
      <div class="menu__nav menu__home-actions">
        <button class="btn btn--primary btn--lg btn--block btn--menu menu__play${firstLaunch ? " btn--next" : ""}" data-action="tiers">${
          icon("play")
        }<span class="btn__txt"><span>Play</span><span class="btn__sub">${
          // Play carries the one first-launch directive now, because Play is
          // the door the tutorial is offered behind (main.ts's tutorial-offer).
          firstLaunch ? "Start with the tutorial" : "Fly the Tiers"
        }</span></span>${firstMark ? alertMinoHTML() : ""}</button>
        <button class="btn btn--secondary btn--block" data-action="howto">${
          icon("howto")
        }How to Play</button>
        ${
          store?.unlimited ? unlimitedBadgeHTML()
          : store?.available ? unlockChipHTML()
          : ""
        }
        <button class="btn btn--ghost btn--block" data-action="settings">${icon("settings")}Settings</button>
      </div>
    </div>
    <div class="build-tag" aria-hidden="true">${
      typeof import.meta.env !== "undefined" ? ((import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev") : "dev"
    }</div>
  </div>`;
}

/**
 * THE FIRST-PLAY TUTORIAL OFFER (main.ts's "tutorial-offer" state).
 *
 * Onboarding is optional: the first time a player presses Play on the front
 * door, this asks whether to walk through Flight School or drop straight into
 * the game. Skip is the ghost button, not a scold — the lessons are short and
 * How to Play keeps them for later — and Start Flight School is the primary,
 * because a first-timer who wants teaching should not have to hunt for it. It
 * is named for the mode it starts, the same words the guide's own card uses
 * (game/guide.ts's "tutorial" article), rather than for the offer. Either answer marks the tutorial seen (so this never returns) and lands
 * the player in the tier hub with Tier 1 open (meta.ts's completeOnboarding).
 */
export function tutorialOfferModal(): string {
  return `<div class="screen neon-backdrop">
    <div class="offer">
      <div class="offer__card">
        <div class="eyebrow">First flight</div>
        <h2 class="display neon-text brand-gradient offer__ttl">Learn the ropes?</h2>
        <p class="offer__sub">Flight School is a few short lessons — load the cannon, arc a
        piece across the bay, clear a row. Skip straight to playing if you'd rather; it's
        always in How to Play.</p>
        <div class="offer__actions">
          <button class="btn btn--primary btn--lg btn--block" data-action="offer-tutorial">${icon("howto")}Start Flight School</button>
          <button class="btn btn--ghost btn--block" data-action="offer-skip">Skip — just play</button>
        </div>
      </div>
    </div>
  </div>`;
}

/** Store/entitlement state passed down from the RevenueCat layer. */
export interface StoreState {
  /** SDK configured — i.e. native build with a key. */
  available: boolean;
  /** The `unlimited` entitlement is active. */
  unlimited: boolean;
  /** Native store receipts can be restored; web identity is persisted locally. */
  restorable?: boolean;
  /** Social-login identity (lib/auth.ts) that keys purchases to a durable
   *  RevenueCat id. `providers` says which sign-in buttons can work on THIS
   *  platform, so the screen never offers one that fails on tap. */
  account?: {
    available: boolean;
    ready: boolean;
    label: string | null;
    providers: { google: boolean; apple: boolean };
    /** The last account action's failure, worded for the player (main.ts's
     *  accountError) — drawn as a line on the screen, so a deletion that did
     *  not complete is never a silent return to the signed-in face. */
    error?: string | null;
    /** F6: WHY there is no sign-in on offer (lib/auth.ts's AuthUnavailable).
     *  "a build with no client ids" and "the sign-in chunk did not load" are
     *  different facts and only one of them is worth a retry button. */
    unavailable?: "not-configured" | "init-failed" | null;
  };
}

/** What the account screen says under a deletion that did not go through —
 *  the Worker refused, the network dropped, the fresh provider token never
 *  came. NOT shown when the player closed the provider's sheet themselves
 *  (auth.ts's isUserCancelled): they know. */
export const ACCOUNT_DELETE_FAILED_TEXT = "Deletion didn't complete — try again";

/** F4: the same line for the other two presses on this panel, which were
 *  silent — a failed signIn() or signOut() was a console.warn and a mute
 *  return, which on screen is a button that did nothing.
 *
 *  A SENTENCE EACH, not one shared "Something went wrong": the panel carries
 *  three controls and a player has to be able to tell which of them the line
 *  is about. Sign-in invites the retry the buttons still offer; sign-out does
 *  not, because there is nothing useful to re-send — the identity is local and
 *  auth.ts clears it either way, so the honest line states the fact and stops.
 *
 *  Sign-in's line is NOT shown when the player closed the provider's sheet
 *  themselves (auth.ts's isUserCancelled): they know. Sign-out has no sheet to
 *  close, so it has no such case. */
export const ACCOUNT_SIGN_IN_FAILED_TEXT = "Sign-in didn't complete — try again";
export const ACCOUNT_SIGN_OUT_FAILED_TEXT = "Sign-out didn't complete";

function unlimitedBadgeHTML(): string {
  return `<div class="btn btn--block menu__entitlement" role="status">${icon("star", 13)}Full Game</div>`;
}

/** The pre-purchase counterpart to the badge above, in the same shelf row.
 *  A full-size `.btn` and the only thing on the menu that pulses: it is an
 *  offer rather than a control anyone came looking for, so it has to do the
 *  finding. It has been three things — a 23px footnote inside the tier recap,
 *  a band across the demo artwork, and this — and only this one treats a
 *  purchase entry the way the rest of the screen treats a control. */
function unlockChipHTML(): string {
  return `<button class="btn btn--block menu__unlock" data-action="paywall">${icon("star", 13)}Buy Full Game</button>`;
}

/* #89 re-added a sandboxChipHTML here; #90 had deleted it. #90 wins: Tier S
 * has a door of its own under the tower now, and a second entry to one screen
 * on one screen is how a menu stops feeling owned. */

/* ---------------------------------------------------------------------------
 * THE FULL GAME PREVIEW — what the entitlement opens, before the store is asked
 * for money.
 *
 * Every "Buy Full Game" in the game used to go straight to RevenueCat's own
 * sheet: the menu chip, the Settings row, the tap on a paywalled tower floor.
 * That sheet is configured in a dashboard and knows nothing about this game — it
 * can print a price and a title and no more — so the entire pitch for seven
 * Tiers, six materials and an unmetered Contract board was the four words on
 * the button that opened it. A player who had never seen past Tier 3 was being
 * asked to buy a thing nobody had shown them.
 *
 * So this sits in front of it, and it makes exactly two claims:
 *
 *  1. THE DEMO IS THE PITCH. The left half is game/attract.ts running
 *     PREVIEW_BAY — a real Tier 7 bay with slag on the belt and a demolition
 *     rack answering it — through the same Game, the same physics and the same
 *     renderer the bay itself uses. It is the menu's demo pointed at a floor
 *     the player does not own yet, and it can no more misrepresent the game
 *     than the game can. See attract.ts's PREVIEW_BAY for every choice in it.
 *
 *  2. THE LIST IS ARITHMETIC, NOT COPYWRITING. Each of the three lines is read
 *     off the constant that decides it — meta.ts's FREE_TIER_LIMIT and
 *     MARK_COUNT, the hazards.ts rows whose Mark opens past the free ladder,
 *     contracts.ts's FREE_DAILY_CONTRACTS. A hand-typed "7 more Tiers" is a
 *     promise that goes quietly wrong the day the free trial is lengthened, and
 *     a wrong promise on the screen that takes the money is the worst place in
 *     the app to have one. sim/systems.ts pins all three against their sources.
 *
 * NO MARKETING ADJECTIVES, deliberately, and that is the house voice rather
 * than restraint: this game's surfaces state quantities (docs/COPY_AUDIT.md's
 * terminology contract, and every draft card in hazards.ts). "Seven more floors
 * of increasingly intense action" would be the one screen in the build that
 * sounds like someone else wrote it.
 * ------------------------------------------------------------------------ */

/** Joins a list the way a sentence does — commas between, "and" before the
 *  last, no serial comma. The list this serves is the six material names, and
 *  the clause it sits in ends "…join the draft": a comma before that final
 *  "and" reads as a second clause starting rather than a list finishing. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The materials the paid half of the ladder puts on the belt, in ladder order.
 *
 * Read off HAZARDS by the Mark each axis OPENS at rather than from a list typed
 * here, because that is the same table the draft deals from: an axis moved a
 * rung up or down the ladder moves in this sentence with it, and a seventh
 * material added at Mark 10 appears here the day it is added.
 *
 * Named from theme.ts's MATERIAL_SPEC rather than from the hazard's own card
 * title, which is "Cryo Contract" — the card names a DEAL being struck, and
 * this line is naming the substance that arrives.
 */
export function previewMaterials(): string[] {
  return HAZARDS
    .filter((h) => h.mark > FREE_TIER_LIMIT && h.material !== undefined)
    .map((h) => MATERIAL_SPEC[h.material as keyof typeof MATERIAL_SPEC].name);
}

/** The sheet's three lines, each as its icon and its sentence. Exported so the
 *  pins can read the sentences without parsing them back out of the markup. */
export function previewLines(): { icon: IconName; text: string }[] {
  return [
    {
      // The ladder itself: how much of the tower is behind the entitlement.
      icon: "up",
      text: `Tiers ${FREE_TIER_LIMIT + 1}–${MARK_COUNT} and the Skydeck above them.`,
    },
    {
      // What those Tiers put on the belt. The material-only draft bays are
      // named because they are the difference between "a material may turn up"
      // and "three bays a run deal nothing else".
      icon: "notch",
      // The COUNT of material-only bays rather than which ones: "bays 2, 5 and
      // 8" spends a third of the sentence on numbers a player cannot act on
      // before they own the thing, and the claim being made is how OFTEN the
      // draft is nothing but materials.
      text: `${andList(previewMaterials())} join the draft, and `
        + `${MATERIAL_DRAFT_BAYS.length} bays a run deal nothing else.`,
    },
    {
      // The board. The one line here that is about a LIMIT being removed rather
      // than content being added, which is why it names the number it replaces.
      icon: "contracts",
      text: `Unlimited Contracts a day, instead of ${FREE_DAILY_CONTRACTS}.`,
    },
  ];
}

export interface PreviewOpts {
  /** A status line printed under the buttons. Today the store's own "not
   *  available" answer, written by main.ts when the primary is pressed against
   *  an unconfigured SDK — the same refusal the tower's own floor tap gives,
   *  moved to the button the player actually pressed. Null prints nothing, and
   *  nothing is the ordinary state. */
  note?: string | null;
}

/**
 * The sheet. Two columns on a landscape device, stacked in portrait — the same
 * `.split` primitive and the same `max-aspect-ratio: 1/1` rule the menu uses,
 * because "is there width for two columns" is one question this app should only
 * answer once (app.css's note at the menu's own stacking query).
 *
 * The demo panel keeps its paragraph in the DOM whether or not the demo is
 * running, for the reason menuScreen keeps its own: main.ts adds `is-live` only
 * once the canvas is actually being drawn into, so on reduced motion or without
 * a 2D context the paragraph is what is shown, and while the demo IS live the
 * paragraph is the canvas's text alternative. A bare canvas has no accessible
 * name at all.
 */
export function previewScreen(opts: PreviewOpts = {}): string {
  const rows = previewLines()
    .map((r) => `<li class="fullgame__row">${icon(r.icon, 16)}<span>${r.text}</span></li>`)
    .join("");
  return `<div class="screen neon-backdrop">
    <div class="fullgame">
      <div class="fullgame__hd">
        <div>
          <div class="eyebrow">Full Game</div>
          <h2 class="display fullgame__title">${MARK_COUNT - FREE_TIER_LIMIT} more floors</h2>
        </div>
        <button class="icon-btn" data-action="preview-back" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="split fullgame__body">
        <div class="fullgame__demo">
          <canvas class="fullgame__demo-canvas" aria-hidden="true"></canvas>
          <p class="fullgame__alt">A bay from deep in the ladder, playing itself — the same
          cannon, the same press and the same physics, with the cargo and the systems these
          floors open.</p>
        </div>
        <div class="fullgame__side">
          <ul class="fullgame__list">${rows}</ul>
          <div class="fullgame__actions">
            <button class="btn btn--primary btn--block" data-action="preview-buy">${icon("star", 13)}Buy Full Game</button>
            <button class="btn btn--ghost btn--block" data-action="preview-back">Not now</button>
          </div>
          ${opts.note ? `<p class="fullgame__note" role="status">${opts.note}</p>` : ""}
        </div>
      </div>
    </div>
  </div>`;
}

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
  /** Whether a fullscreen control can do anything here (lib/platform's
   *  fullscreenSupported — false in the native shells and on iPhone Safari,
   *  which have no working Fullscreen API). False renders NO row rather than a
   *  dead switch, the same rule Haptics and Scanlines follow. Defaults off:
   *  a caller that does not know cannot promise fullscreen works. */
  fullscreenAvailable = false,
  /** The window's CURRENT fullscreen state (lib/platform's isFullscreen), not a
   *  saved setting. This row is a LIVE mirror — the app always starts windowed
   *  and nothing is persisted — so it reflects the real state, including a
   *  fullscreen entered by the shell's F11. main.ts keeps it in sync on
   *  fullscreenchange (syncFullscreenControls). */
  fullscreenOn = false,
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
          ${toggleHTML("scanlines", "Scanlines", "CRT comb over the whole screen · starts off on touch", s.scanlines)}
          ${
            // A LIVE mirror of the window state, not a Settings field — the app
            // always starts windowed and nothing persists (main.ts's onToggle
            // special-cases this key: it calls toggleFullscreen and writes no
            // setting). Hidden where the API can do nothing (native shells,
            // iPhone Safari), the same no-dead-switch rule as the rows above.
            // On desktop this is the ONLY fullscreen control besides F11 — the
            // HUD/pause buttons are web-only now (platform.ts's
            // fullscreenButtonShown).
            fullscreenAvailable
              ? toggleHTML("fullscreen", "Fullscreen", "Fill the screen", fullscreenOn)
              : ""
          }
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
          ${
            // Signed-in beats available: a player whose identity was persisted
            // by a build with sign-in configured must keep the door to Sign
            // Out / Delete Account even in a build without it.
            store?.account && (store.account.available || store.account.label)
              ? `<button class="btn btn--secondary btn--block" data-action="account">${
                store.account.label ? "Player Account" : "Sign In"
              }</button>` : ""}
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

/** What each tab is CALLED, as opposed to what it is keyed by.
 *
 *  The strip has always drawn these; the reset button under it interpolated
 *  `opts.tab` instead — the same lowercase string that rides `data-tab` — so a
 *  player sitting on the tab labelled "Keyboard" was offered "Reset keyboard",
 *  an internal identifier rendered as player-facing copy. One table, read by
 *  both, is the fix that cannot come apart again. */
const CONTROLS_TAB_LABELS: Record<ControlsTab, string> = {
  touch: "Touch",
  keyboard: "Keyboard",
  gamepad: "Gamepad",
};

/**
 * Every screen Controls can be opened FROM, named by the `data-action` that
 * returns to it — the string is the door in both directions, so the Back
 * button this renders and the B press main.ts routes through it (padBackTarget)
 * are the same click.
 *
 * Two doors were enough while a pointer was the only way in: Settings and the
 * guide's Controls row. The pad's fixed Controls button (padnav.ts's
 * PAD_CONTROLS) opens the screen from wherever the player is standing, and a
 * shortcut that dumped them back in Settings afterwards would move them
 * somewhere they never asked to go — so the door list is now every menu the
 * shortcut may be pressed on (main.ts's PAD_CONTROLS_DOORS holds that half).
 */
export type ControlsDoor =
  | "settings" | "howto" | "menu" | "leaderboard" | "workshop" | "contracts" | "sandbox";

/** What the eyebrow calls each door — the screen's own name as the player
 *  reads it on the way in, so the header says where Done will land. */
const CONTROLS_DOOR_LABELS: Record<ControlsDoor, string> = {
  settings: "Settings",
  howto: "How to Play",
  menu: "Main Menu",
  leaderboard: "Leaderboard",
  workshop: "Workshop",
  contracts: "Contracts",
  sandbox: "Tier S",
};

export function controlsScreen(opts: {
  tab: ControlsTab;
  settings: Settings;
  /** Where the close button and Done go back to. Settings is the historical
   *  door and stays the default; the guide is the other one, and a player who
   *  opened this from a How to Play row expects to land back on that row rather
   *  than in Settings. main.ts remembers which door was used. */
  back?: ControlsDoor;
  /** Detected gamepad id, or null — browsers hide pads until a button is
   *  pressed, and the pane says so instead of reading as broken. */
  padName: string | null;
  /** A pad IS connected and the browser could not fit it to the standard
   *  mapping (gamepad.ts's nonStandardPad). Optional and false by default:
   *  the overwhelming case is a pad the browser knows, and a screen rendered
   *  without the fact should say nothing rather than warn on a guess. */
  padNonStandard?: boolean;
  /** The action currently capturing a rebind, if any. */
  rebinding: BindableAction | null;
}): string {
  const tabBtn = (id: ControlsTab) =>
    `<button class="workshop__tab${opts.tab === id ? " workshop__tab--on" : ""}" role="tab" data-action="controls-tab" data-tab="${id}" aria-selected="${opts.tab === id}">${CONTROLS_TAB_LABELS[id]}</button>`;

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
    // The mouse rides this tab — keyboard and mouse are one fine-pointer
    // family (the strip, the coach and app.css all draw that line).
    //
    // THESE TWO ROWS DESCRIBE THE MODE THAT IS ON, the way the gamepad tab's
    // aim row already does. They used to state the default and leave the
    // alternate to the toggle's description, on the argument that nothing
    // re-rendered the pane when a toggle flipped — and that compromise does
    // not survive contact with this pair either: "scroll" and "right-click"
    // are not two flavours of one control, they are the two jobs SWAPPING, so
    // a pane stating the default flatly contradicted the switch sitting under
    // it the moment a player used it (found in review). main.ts re-renders
    // this screen when wheelRotates flips, so the rows can afford to be true
    // rather than merely default.
    pane = `${infoRow("Mouse aim", "click where it should land")}
      ${infoRow("Arc height", opts.settings.wheelRotates
        ? "hold right-click and drag · up is steeper"
        : "scroll · up comes down steeper")}
      ${infoRow("Mouse rotate", opts.settings.wheelRotates
        ? "scroll ⟳ · wheel press ⟲"
        : "right-click ⟳ · wheel press ⟲")}
      ${BINDABLE_ACTIONS.map((a) => bindRow(a, keyLabel(keyFor(a)))).join("")}
      ${
        // ESCAPE, UNDER THE PAUSE ROW IT IS NOT. Info rows, not bind rows:
        // Escape is a fixed alias (bindings.ts's PAUSE_ALIAS) and the
        // fullscreen keys are the desktop shell's own, read before the page
        // sees them — a Rebind button on either would offer a rebind nothing
        // could honour. The Escape row states what it does in every shell:
        // pause, and in fullscreen leave that first (which pauses too,
        // main.ts's onFullscreenChange). It goes when a swap has given Escape
        // to another action, whose own row then names it.
        pauseKeyLabels().length > 1
          ? infoRow(keyLabel(PAUSE_ALIAS), "also pauses · leaves fullscreen first")
          : ""
      }
      ${fullscreenKeys().length ? infoRow("Fullscreen", fullscreenKeys().join(" · ")) : ""}
      ${/* The description says what the switch DOES, now that the two rows
            above say what is currently true. "hold right-click" without
            "mid-aim": in this mode a fresh right press anchors the arc-height
            drag on its own (game/input.ts's onDown), because the wheel has
            taken rotation and there is nothing else for that button to do —
            the old wording described a chord the player had to build on top of
            a held aim, which is not the gesture the toggle offers. */""}
      ${toggleHTML("wheelRotates", "Wheel rotates", "Scroll turns the shipment instead; arc height moves to holding right-click and dragging up/down", opts.settings.wheelRotates)}
      ${
        // THE POINTER, HANDED BACK (store.ts's systemCursor, styles/cursors.css).
        //
        // HERE AND NOT ON THE SETTINGS SCREEN, which is where it was first
        // written. Two reasons, one of them measured. It BELONGS here: this is
        // the fine-pointer family's pane by its own comment above, it is the
        // one screen in the app that talks about a mouse, and the switch above
        // it is the app's other mouse-behaviour switch. And the Settings pane
        // has no room — its toggle column is not on sim/uifit's scroll
        // allowlist, and a fourth row there overflowed .panel on nine of the
        // nineteen devices (37px on an iPhone SE 3), which is 18 new
        // violations for a row those devices have no cursor to spend it on.
        // #controls-grid is allowlisted and already carries a taller pane.
        toggleHTML("systemCursor", "System Pointer", "Draw the OS cursor instead of the game's, at whatever size and colour you have set it to", opts.settings.systemCursor)
      }`;
  } else {
    // THE MENU BUTTONS ARE INFO ROWS, not bind rows, because they are not
    // bindings: ui/padnav.ts fixes them at their standard-mapping indices and
    // no rebind can move them (a player who could rebind the D-pad out of a
    // menu could strand themselves in one). They are stated here anyway —
    // this is the screen a player opens to learn what their pad does, and the
    // gestures that carry them through every OTHER screen would otherwise be
    // written down nowhere. The second row is the way back to this screen
    // itself, which is what a player who has just made a mess of the table
    // below needs most.
    // THE MAPPING IS A FACT ABOUT THE DEVICE, and it belongs next to its name.
    // Every button index in game/gamepad.ts is a standard-mapping index and
    // every label on this screen is read off that promise, so when the browser
    // reports a non-standard pad the rows below are labelling the wrong
    // physical buttons — fire may be a shoulder, rotate may be a trigger, and
    // nothing said so. One line, on the screen that already holds the remedy:
    // the table underneath is rebindable press-by-press, so this is a pointer
    // at a fix the player can make rather than an apology.
    //
    // NOT IN THE HUD, on purpose. A permanent badge over a live bay is a
    // penalty for owning an unusual controller, and it would be up during the
    // one activity where nothing can be done about it. It is shown where a
    // player goes when the buttons feel wrong, which is this tab.
    const mappingNote = opts.padNonStandard
      ? `<p class="muted">This pad isn't a standard mapping, so the buttons named below may not be the ones it has. Rebind any that are wrong.</p>`
      : "";
    pane = `${mappingNote}${infoRow("Detected", opts.padName ?? "No gamepad — press any button on one")}
      ${infoRow("Aim & power", opts.settings.stickSling
        // THE ROW DESCRIBES THE MODE THAT IS ON, not the default. The sibling
        // keyboard tab states its default and lets the toggle's description
        // carry the alternate, because nothing re-rendered that pane when a
        // toggle flipped — a compromise its own comment records. It does not
        // survive contact with THIS pair: "centre holds" and "release lets the
        // pull go" are not two flavours of one control, they are opposite
        // answers to "what happens when I let go", and a row asserting the
        // wrong one flatly contradicts the toggle sitting under it (found in
        // review). main.ts re-renders this screen when stickSling flips, so
        // the row can afford to be true instead of merely default.
        ? "left stick · pull back to aim · release lets go"
        : "left stick · ↕ angle · ↔ power · centre holds")}
      ${infoRow("Menus", `D-pad move · ${padLabel(PAD_CONFIRM)} select · ${padLabel(PAD_BACK)} back`)}
      ${infoRow("Open Controls", `${padLabel(PAD_CONTROLS)} · from any menu`)}
      ${BINDABLE_ACTIONS.map((a) => bindRow(a, padLabel(padFor(a)))).join("")}
      ${/* NAMES ITS SCOPE rather than switching with the mode, because its
            scope does not change: the assist only ever smoothed the SLINGSHOT's
            stick (gamepad.ts), and the dials need none — stickRate starts every
            rate from zero at the deadzone's edge, so there is no jitter to
            damp. Unqualified, this row offered a dial player a control that
            does nothing whatever they did with it. Said out loud, it is true in
            both modes and needs no re-render to stay true. */""}
      ${toggleHTML("stickAssist", "Stick aiming assist", "Smooth the slingshot stick so the arc doesn't jitter", opts.settings.stickAssist)}
      ${toggleHTML("stickSling", "Slingshot stick", "Pull the stick back to aim, the way the touch drag does — release lets the pull go", opts.settings.stickSling)}`;
  }

  return `<div class="screen neon-backdrop">
    <div class="controls">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div class="eyebrow">${CONTROLS_DOOR_LABELS[back]}</div><h2 class="display" style="font-size:var(--fs-h1)">Controls</h2></div>
        <button class="icon-btn" data-action="${back}" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="workshop__tabs" role="tablist">
        ${tabBtn("touch")}
        ${tabBtn("keyboard")}
        ${tabBtn("gamepad")}
      </div>
      <div class="controls__pane" id="controls-grid" role="tabpanel" data-scroll>${pane}</div>
      <div class="row" style="justify-content:center">
        <button class="btn btn--primary" data-action="${back}">Done</button>
        ${opts.tab === "touch" ? "" : `<button class="btn btn--ghost" data-action="controls-reset">Reset ${CONTROLS_TAB_LABELS[opts.tab]}</button>`}
      </div>
    </div>
  </div>`;
}

/** Restore is always reachable without a purchase first. A lifetime purchase
 *  has no renewal or cancellation controls, so owned state is status text. */
function purchaseRowsHTML(store: StoreState): string {
  return `${
    store.unlimited
      ? `<div class="btn btn--secondary btn--block settings__store-status" role="status">★ Full Game owned</div>`
      : `<button class="btn btn--secondary btn--block" data-action="paywall">★ Buy Full Game</button>`
  }
  ${store.restorable === false ? "" : `<button class="btn btn--ghost btn--block" data-action="restore" id="restore-btn">Restore Purchases</button>`}`;
}

function accountText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function accountScreen(
  account: NonNullable<StoreState["account"]>,
  /** StoreState.restorable — a build whose store receipts can be restored, i.e.
   *  a native one (main.ts's `isNative`). It decides one sentence here and one
   *  in the deletion notice, because it is the same fact both of them turn on:
   *  whether this build has a Restore Purchases button at all.
   *
   *  Defaults to the WEB build, which is what this screen described before the
   *  branch existed — so a caller that predates it renders exactly what it
   *  always did. */
  restorable = false,
): string {
  const body = account.label
    ? `<p class="muted">Signed in as</p><p class="display account__name">${accountText(account.label)}</p>
       <button class="btn btn--secondary btn--block" data-action="account-signout">Sign Out</button>
       <button class="btn btn--ghost btn--block" data-action="account-delete">Delete Account</button>`
    : !account.available
      // F6: TWO CAUSES, TWO SENTENCES, AND ONLY ONE OF THEM DEAD-ENDS.
      //
      // "not configured in this build" was the whole of this branch, and on
      // the web it is where the tier gate sends a signed-out player who just
      // pressed Buy Full Game. When the sign-in chunk fails to load — a
      // dropped connection, most often — that sentence tells them the app
      // cannot do this at all, which is false, and leaves them on a screen
      // with nothing on it to press. A build genuinely shipped without client
      // ids keeps the original line, because for that player it IS permanent
      // and a retry button would be a lie in the other direction.
      ? account.unavailable === "init-failed"
        ? `<p class="muted">Sign-in couldn't start — check your connection and try again.</p>
           <button class="btn btn--secondary btn--block" data-action="account-retry">Try Again</button>`
        : `<p class="muted">Account sign-in is not configured in this build.</p>`
      // WHAT SIGNING IN BUYS, per build. On the web the identity is the
      // purchase's only anchor, so the instruction is about ORDER — sign in
      // first, then buy, or the purchase lands on an anonymous customer. In the
      // app stores the receipt is the anchor and Restore Purchases already
      // covers the store account that paid; what the identity adds there is
      // recovery ACROSS accounts and platforms. Telling an iPhone player to
      // sign in "before buying on the web" named a store their build does not
      // use and a route it cannot take.
      // The BUTTONS are not part of the branch — only the sentence above them
      // is. They are what the screen is for in either build, and a guest who
      // cannot see them cannot sign in at all.
      : `${
        restorable
          ? `<p class="muted">Sign in so Full Game can be recovered on another device — including one signed in to a different store account.</p>`
          : `<p class="muted">Sign in before buying on the web so Full Game can be recovered on another device.</p>`
      }
         ${account.providers.google ? `<button class="btn btn--secondary btn--block" data-action="account-google">Continue with Google</button>` : ""}
         ${account.providers.apple ? `<button class="btn btn--secondary btn--block" data-action="account-apple">Continue with Apple</button>` : ""}`;
  return `<div class="screen neon-backdrop center">
    <div class="panel modal pop account">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 class="display" style="font-size:var(--fs-h1)">Player Account</h2>
        <button class="icon-btn" data-action="settings" aria-label="Back">${icon("close", 18)}</button>
      </div>
      ${body}
      ${account.error ? `<p class="account__error" role="alert">${accountText(account.error)}</p>` : ""}
    </div>
  </div>`;
}

/**
 * THE ACCOUNT-DELETION CONFIRMATION — the seal notice's panel, asked of the
 * other irreversible press in the meta.
 *
 * It replaces a `window.confirm`, which was the one dialog in the game drawn by
 * the browser rather than by the game: no neon, no pad focus, no reading of the
 * pause card's own rules about which answer a stray press lands on — and on the
 * native shells a system alert over a fullscreen canvas, which is precisely the
 * moment a player is least able to tell what they just agreed to.
 *
 * TWO PARAGRAPHS, AND THE SECOND IS THE POINT, exactly as sealBreakModal argues:
 * the first says what goes, the second says what does NOT. What deletion
 * actually removes is the purchase-RECOVERY identity — the RevenueCat customer
 * named by `${provider}:${sub}` (docs/AUTH.md) — and nothing else. The purchase
 * itself belongs to the store account that made it and Restore finds it again;
 * the save is local and is not part of the account at all. Without that
 * sentence the panel reads as "delete your purchase and your progress", which
 * is false in both halves and would stop a player exercising a control the
 * store rules require to be reachable.
 *
 * KEEPING THE ACCOUNT IS THE PRIMARY, for the reason the seal notice states:
 * padnav's focusInitial lands a pad on `.btn--primary`, and the button a stray
 * press finds must never be the one that spends something permanent.
 */
export function accountDeleteModal(
  /** StoreState.restorable, exactly as accountScreen takes it — see there. */
  restorable = false,
): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal account-note pop">
      <div class="eyebrow" style="color:var(--danger)">Account</div>
      <h2 class="display">Delete this player account?</h2>
      <p class="account-note__body">This removes the <b>purchase-recovery identity</b> — the
      customer record your Google or Apple sign-in names at RevenueCat — and the sign-in stored
      on this device. It cannot be undone, and signing in again creates a new, empty one.
      You'll be asked to sign in again to confirm it's you.</p>
      <p class="account-note__body">${
        // THE SECOND HALF IS BUILD-SPECIFIC, and it has to be: the web build
        // renders no Restore Purchases button at all (purchaseRowsHTML, off
        // StoreState.restorable), so pointing a browser at it was pointing at
        // something that is not on the screen. Worse, it was the wrong route as
        // well as an absent one — in a browser a purchase is found by signing
        // in with the identity that made it (public/support.html says exactly
        // that), and that identity is the thing this panel deletes. So the web
        // panel states the mechanism instead of promising the button, and lets
        // the player draw the conclusion the promise was hiding.
        restorable
          ? `<b>Your Full Game purchase is not deleted.</b> It stays with
      the Apple, Google or web store account that bought it, and <b>Restore Purchases</b> finds
      it again.`
          : `<b>Your Full Game purchase is not deleted.</b> It stays with the store account that
      paid. In a browser, though, it is found by <b>signing in</b> with the identity that bought
      it: the one this removes.`
      } Your progress is untouched — salvage, unlocks, seals and best scores are
      saved on this device and were never part of the account.</p>
      <div class="row">
        <button class="btn btn--primary" data-action="account-delete-back">Keep Account</button>
        <button class="btn btn--secondary btn--danger" data-action="account-delete-go"
          aria-label="Delete Account — removes the purchase-recovery identity, and cannot be undone"
        >Delete Account</button>
      </div>
    </div>
  </div>`;
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

/** What an EMPTY board says. The roof's is a day rather than a rung, so it
 *  cannot borrow the ladder's sentence: "no scores at this Tier" on the
 *  Skydeck's board is the same leak tierText exists for, one screen along. */
export function emptyBoardText(board: BoardId): string {
  return board === BOARD_SKYDECK
    ? "No scores on today's board yet — be the first!"
    : "No scores at this Tier yet — be the first!";
}

/** What the board says when it could not be fetched (lib/api.ts's
 *  fetchLeaderboard returning null). Its own line, because "No scores at this
 *  Tier yet" over a board that has plenty is the board lying. */
export const BOARD_UNAVAILABLE_TEXT = "Couldn't load the board";

/** What the end card's submit row says when the post did not go through
 *  (main.ts's onSubmitScore) — over a Submit button that still works, because
 *  a score that never landed is one the player can still send. */
export const SUBMIT_FAILED_TEXT = "Couldn't submit — check your connection";

export function leaderboardRowsHTML(
  /** NULL when the board could not be fetched — drawn as its own line, never
   *  as the empty board's. */
  rows: BoardRow[] | null,
  highlight?: string,
  /** Which board these rows are from — only read when there are none. Defaults
   *  to a Tier's wording, which is what every caller that predates the daily
   *  board meant. */
  board: BoardId = 1,
): string {
  if (rows === null) {
    return `<div class="muted lb__unavailable" role="status" style="padding:20px;text-align:center">${BOARD_UNAVAILABLE_TEXT}</div>`;
  }
  if (!rows.length) {
    return `<div class="muted" style="padding:20px;text-align:center">${emptyBoardText(board)}</div>`;
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
 * MORE THAN ONE BOARD, and they are separate for the reason each extra mode is
 * safe at all. A sandbox run can start on bay 9, at Mark 10, on a maxed rig
 * nobody paid for; mixing one of those into the Deep Run board would not make
 * it a better board — it would end it, because after the first such entry no
 * honest score could ever place. The Skydeck is the opposite failure at the
 * same seam: it flies Mark 10's bays a rung further along under three standing
 * clauses (game/skydeck.ts), so filing it on Tier 10 ranked a harder run
 * against an easier one on the easier one's terms. So they are boards with one
 * shape, and the tab strip is what says so out loud rather than leaving the
 * player to discover it from a score they cannot explain.
 *
 * A tab renders ONLY for a board that player has: a strip with one tab in it is
 * a question mark, not a control, and a board for a mode you cannot fly is
 * worse than none.
 *
 * THE SKY TAB IS A DAY, not a list. Its heading carries the date it is showing
 * because a daily board with no date on it is a board whose contents change for
 * no visible reason overnight. Only TODAY is browsable — yesterday's rows are
 * still in the table and reachable by key, but a history control would need a
 * second axis on this screen (a date picker beside a tab strip on a 360px
 * phone) to serve a board nobody can still post to. The day's run is a thing
 * you fly today; the board follows it.
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
  /** Whether the roof's board does (meta.ts's skydeckOpen — the same gate as
   *  the floor itself, so the board arrives with the mode). */
  skydeck?: boolean;
  /** WHICH DAY of the Skydeck board is on screen (lib/api.ts's BoardDay).
   *  Ignored on every other board, which has no day. */
  day?: number;
}): string {
  const board = opts?.board ?? 1;
  const sandbox = board === BOARD_SANDBOX;
  const sky = board === BOARD_SKYDECK;
  const tier = opts?.tier ?? (isLadderBoard(board) ? board : 1);
  const tabs = opts?.sandbox || opts?.skydeck
    ? `<div class="lb-tabs" role="tablist" aria-label="Leaderboard">
        ${lbTabHTML(tier, tierText(tier), board)}
        ${opts?.skydeck ? lbTabHTML(BOARD_SKYDECK, boardText(BOARD_SKYDECK), board) : ""}
        ${opts?.sandbox ? lbTabHTML(BOARD_SANDBOX, boardText(BOARD_SANDBOX), board) : ""}
      </div>`
    : "";
  return `<div class="screen neon-backdrop center">
    <div class="panel modal pop" style="width:min(560px,94vw)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="text-align:left"><div class="eyebrow">${
          // #88: under the tier ladder "Deep Run" does not name a board on its
          // own — a Tier 10 run banks more lines against a heavier target than
          // a Tier 1 run can, so each tier keeps its own list and the heading
          // has to say which one is on screen. Tier S and the Skydeck are the
          // boards with a name instead of a number, because neither is a rung —
          // and the roof's second half is the DAY rather than the mode, since
          // that is the half that changes under the player.
          sky
            ? `${boardText(board)} · ${dayText(opts?.day ?? 0)}`
            : sandbox ? "Tier S · Sandbox" : `${boardText(board)} · New Run`
        }</div>
        <h2 class="display" style="font-size:var(--fs-h1)">Leaderboard</h2></div>
        <button class="icon-btn" data-action="tiers" aria-label="Back">${icon("close", 18)}</button>
      </div>
      ${tabs}
      <div id="lb-body" data-scroll>${rows}</div>
      <!-- PLAY FLIES THE BOARD YOU ARE READING. It used to fire a bare "play"
           action, which flies whichever floor the tower's car is parked on — so a
           player who had dropped down to Tier 2 for a practice run, then opened
           the leaderboard and read Tier 7's list, pressed Play under those
           scores and launched Tier 2. The board on screen is a choice the
           player just made with the tab strip; the button carries it, and
           main.ts parks the car on it (through the same tierOpen gate the
           tower's own pick uses) before it launches.

           The roof rides along, because a floor is a floor: the Skydeck's tab
           hands back the roof's sentinel and Play flies the daily. Tier S is
           the exception and not a tier at all — its button opens the bench
           (the sandbox SETUP screen), so it carries no floor to fly. -->
      <button class="btn btn--primary" data-action="${sandbox ? "sandbox" : "play"}"${
        sandbox ? "" : ` data-tier="${sky ? SKYDECK_TIER : tier}"`
      }>${
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
 * The clock's two thresholds, in ms.
 *
 * The first is not new — the TIME readout has turned danger-red at twenty
 * seconds since it was built; it was a bare literal inside main.ts's syncHud.
 * It lives here now because it is the same KIND of number as the two beside it
 * (the point at which the correct play changes) and because the audio cue keys
 * off exactly the same crossing the colour does. One threshold, two senses.
 *
 * The second is half the first, and it is where the BEAT halves: twenty seconds
 * of even ticking is a state, and a state does not escalate. Ten is short
 * enough that a doubled beat reads as the end approaching rather than as a new
 * tempo.
 */
export const LOW_TIME_WARN_MS = 20_000;
export const FINAL_TIME_WARN_MS = 10_000;

/**
 * THE CLOCK'S FIRST RUNG (R4), one whole minute out, and it exists because the
 * Deep Run's countdown changed size rather than because the game changed.
 *
 * On the rail the clock was an 11px figure among three of them, and colouring
 * it early would have been the panel's loudest thing saying something that is
 * not yet urgent. Beside the funds figure it is a headline number the eye is
 * already on, and at that size the reading a player wants at 0:59 is "the last
 * minute has started" — which is a plan change (stop banking, spend the
 * bankroll) rather than an emergency.
 *
 * A MINUTE, and not the 90 or 45 either side of it, because a bay's clock is
 * 150s (level.ts) — 60 is the last round number that leaves more than a third
 * of the bay to act in, and it is the number the player is already counting in
 * their head. LOW_TIME_WARN_MS then keeps the pulse and the tick for the last
 * twenty seconds ON TOP of this, so the escalation is colour, then movement,
 * then tempo, and no rung repeats the one below it.
 */
export const CLOCK_ALARM_MS = 60_000;

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

/* ---------------------------------------------------------------------------
 * THE DIAL COLLAPSE — the readout that crunches when the bay is lost.
 *
 * Playtest finding: a player who loses to the clock and a player who loses to
 * the bankroll watch the same thing happen — the field freezes and a modal
 * arrives — and afterwards could not say which of the two dials had emptied.
 * The end modal names the cause in words (see endModal's `lossWhy`), but it
 * says it on a screen that has replaced the instrument the player was supposed
 * to be reading, so the lesson lands nowhere near the thing it is about. The
 * collapse says it on the dial itself, one beat before the modal: the number
 * that ran out flickers, drains to danger red and is crushed flat where it
 * stands (app.css's `dial-collapse` keyframes).
 *
 * Only the two ECONOMIC losses take it. A topout is already its own picture —
 * the pile is touching the ceiling, in the middle of the screen, and there is
 * no dial to point at; "launches" and "pieces" are supply verdicts whose
 * readout has been counting down in plain sight and which the same modal
 * explains. Both halves of that split are the same rule the full-screen
 * `loseFxHTML` backdrop already follows, and the two are designed to land
 * together: the backdrop is the mood, this is the evidence.
 * ------------------------------------------------------------------------ */

/** Which plant readout the collapse plays on. */
export type DialCollapse = "time" | "funds";

/**
 * How long the crunch runs, mirroring app.css's `--dial-collapse` token. Held
 * in TypeScript as well as in the stylesheet because main.ts times the modal
 * hold below against it and cannot read a CSS custom property that is only
 * ever resolved on an element it has not mounted yet. sim/systems.ts reads
 * both and fails if they drift apart — same treatment the chute's world
 * geometry gets against the plant panel's CSS fractions.
 */
export const DIAL_COLLAPSE_MS = 820;

/**
 * How long the run-end scrim is held back so the collapse plays in the clear.
 *
 * It has to be held: `.modal-scrim` is a 72%-opaque wash with a 4px backdrop
 * blur over it (app.css), so a readout animating underneath one is a smear at
 * roughly a quarter contrast — the collapse would technically be playing and
 * would teach nobody anything. Holding is also why the modal is PATCHED in
 * beside the HUD rather than re-rendered with it (main.ts's mountEndScrim):
 * a second full render would restart the crunch from frame one just as the
 * scrim began to fade over it.
 *
 * Shorter than DIAL_COLLAPSE_MS on purpose. The animation spends its last
 * third settling — the number is already crushed and red by ~65% — so the
 * scrim's own 220ms fade (--dur) can start over the tail without covering
 * anything the player still needs to see, and the run-end screen arrives
 * while the evidence is still under it rather than a full second later. A
 * loss screen that makes you wait is a loss screen you learn to skip.
 */
export const DIAL_COLLAPSE_HOLD_MS = 640;

/**
 * Reason -> readout. Pure, and deliberately asked to prove the readout EXISTS
 * rather than assuming the mode: `hudHTML` swaps the whole `.pl-read` row for
 * a Contract's Lines/Goal + supply columns and drops the clock entirely when
 * the bay has no time limit, so a mapping that went straight from "broke" to
 * `.pl-funds` would crush a Contract's line count — a number that did not run
 * out and cannot — the first time a Contract ever reported that reason.
 */
export function collapsingDial(
  reason: LossReason | null | undefined,
  readouts: {
    /** A Funds/Target column is on the panel (Deep Run readout, not a Contract's). */
    funds: boolean;
    /** The bay runs on a clock, so a Time column rendered at all. */
    clock: boolean;
  },
): DialCollapse | null {
  if (reason === "time") return readouts.clock ? "time" : null;
  if (reason === "broke") return readouts.funds ? "funds" : null;
  return null;
}

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

/** The ⏸ rail button's name on a run that MAY restart a bay — the base the
 *  seal's price is dashed onto (sealNameWith), and the half that disappears on
 *  a Skydeck run. A constant because the button's name is now built two ways
 *  and the gesture is named in exactly one of them. */
export const PAUSE_HOLD_NAME = "Pause — hold to restart the bay";

/* ---------------------------------------------------------------------------
 * THE CHAIN LADDER (R3 "Chainline") — the combo streak, drawn as a ladder to
 * the bay's own ceiling instead of said as "Combo ×3".
 *
 * WHY A LADDER AND NOT A NUMBER. "×3" is a fact about the past; the thing a
 * player is actually deciding is whether the NEXT crush is worth waiting for a
 * cleaner shot, and the multiplier alone never quoted that. The ladder draws
 * the rungs already earned, outlines the one the next crush lights, and prices
 * it in dollars beside a star that is the bay's promise — a full chain. Every
 * part of it answers "what does the next row pay", which is the question the
 * old meta line was standing in front of.
 *
 * HOW MANY RUNGS IS THE BAY'S QUESTION, NOT THIS FILE'S (level.ts's
 * chainRungsFor). It was a flat twelve, defended here as a width verdict and
 * as being "comfortably past any streak a real bay produces" — and that second
 * clause was the bug written down as a virtue. A Mark 1 bay 9 crosses its
 * target on the EIGHTH crush; the row drew twelve, so a third of it was
 * promising a streak the bay could not physically contain. Reported from play,
 * with four rungs still dark one crush from the end. Across the whole 10x10
 * ladder the real answer is 6 to 10.
 *
 * The width argument survives as a CEILING rather than as the count
 * (CHAIN_RUNGS_MAX), and it was measured again while this changed: on the
 * tightest row in sim/uifit's matrix — the iPhone 13 mini, not the iPhone X
 * this comment used to name — twelve rungs are 7.3px wide on a 9px height,
 * already the tick this file said twelve was chosen to avoid. A derived 6-10 is
 * WIDER per rung than what shipped, so the fix costs the row nothing and
 * returns some of its legibility.
 * ------------------------------------------------------------------------ */

/** Everything the ladder is a pure function of. */
export type ChainState = {
  /** Crushes in the current streak (game.ts's Game.combo). */
  combo: number;
  /** Index into level.pileTiers of the congestion in force, or -1 for a clean
   *  bay — the same read syncHud already makes for the congest classes. */
  tierIdx: number;
  /** What the capped multiplier is while congested (PileTier.payMult). Unread
   *  on a clean bay. */
  capMult: number;
  /** This bay's base line payout (level.scorePerLine); 0 to quote nothing. */
  scorePerLine: number;
  /** The bay was finished with a perfect chain (game.ts's Game.fullChain). */
  full: boolean;
  /** How many rungs this bay's ladder has — the most crushes it can chain
   *  before it ends (level.ts's chainRungsFor). Part of the state rather than a
   *  constant here because it is a fact about the bay's economy, not about the
   *  row's typography. */
  rungs: number;
};

/** The ladder as a bay opens: nothing crushed, nothing congested, and no price
 *  to quote. What a caller that has no game behind it renders — see hudHTML's
 *  `chain` option. */
export const CHAIN_AT_REST: ChainState = {
  combo: 0, tierIdx: -1, capMult: 1, scorePerLine: 0, full: false,
  // A caller with no bay behind it has no economy to solve, so it gets the
  // longest ladder the row can draw — which is also the worst case for anything
  // measuring the row's geometry, and those are exactly the callers that use
  // this constant.
  rungs: CHAIN_RUNGS_MAX,
};

/**
 * The ladder, in whatever state the caller's numbers put it.
 *
 * PURE, and shared by the mount render below and main.ts's syncHud, which is
 * the whole reason it is a function: the panel's mount state has to be spelled
 * the same way the next live patch will spell it, or that write is a mechanism
 * change rather than a value change (the same rule the three bar fills' inline
 * `transform:scaleX(1)` follows). syncHud rewrites the row through this same
 * call, and only when its state actually moves — see its chainShown cache.
 *
 * `scorePerLine` of 0 means "this caller cannot quote a price" (a fixture
 * measuring the row's geometry, a surface with no bay behind it), and the label
 * goes empty rather than advertising "$0" — a price of nothing is a worse lie
 * than no price at all.
 */
export function chainLadderHTML(state: ChainState): string {
  const { combo, tierIdx, capMult, scorePerLine, full } = state;
  const total = Math.max(1, Math.round(state.rungs));
  const congested = tierIdx >= 0 && !full;
  // WHAT EACH RUNG SAYS. On a full chain every rung is gold — the bay is over
  // and the ladder is the trophy. Congested, every rung is dark behind the gate
  // line: the streak is not merely stalled, it is CAPPED, and a half-lit ladder
  // would read as "still going". Otherwise it is the streak itself, plus one
  // outlined rung showing exactly which crush the price beside it is for.
  const lit = full ? total : congested ? 0 : Math.min(combo, total);
  const next = full || congested ? -1 : lit + 1;
  const rungs = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const cls = n <= lit ? " is-lit" : n === next ? " is-next" : "";
    return `<i class="pl-chain__rung${cls}"></i>`;
  }).join("");
  // THE PRICE, and it is the point of the row. Clean: what the NEXT crush's
  // line fetches, quoted through the same payoutMult the payout itself runs
  // through, so the readout cannot drift from the till. Congested: the CEILING
  // the tier holds the streak under, which is the congestion tax's one
  // invisible half made visible (the other three — money, clock, reload — are
  // all already on screen).
  const money = full || scorePerLine <= 0
    ? 0
    : congested
      ? Math.round(scorePerLine * capMult)
      : Math.round(scorePerLine * payoutMult(combo + 1, null));
  const mod = full
    ? " pl-chain--full"
    : congested
      ? ` pl-chain--congest pl-chain--congest-${Math.min(tierIdx, 1)}`
      : "";
  // THE PAYOUT LEADS (R4). The word "Chain" was 8px pixel type naming a row
  // whose rungs already say what it is, and it sat where the row's one figure
  // should have been; the figure moves to the front and the label goes.
  //
  // THE UNIT IS A GLYPH, not a word. `line` (icons.ts) before the money says
  // "per cleared line" without borrowing the "x" this row's own subject — the
  // combo multiplier — already speaks in, and it hands the rung run back the
  // ~35px "x LINE" cost. Muted, like every other readout's mark.
  //
  // "NEXT" AND "CAP" ARE NOT SPELLED any more, and that is a deliberate trade
  // rather than an omission: which of the two a quote is, is already stated
  // twice over in the same row — congestion drops the GATE across the rungs and
  // recolours the whole row amber or red (app.css's .pl-chain--congest), where
  // a clean bay outlines the one rung the price is for. The reading survives in
  // full for anything that cannot see colour: `title` carries the sentence.
  //
  // FULL CHAIN KEEPS ITS WORDS, in the pixel face at the size the label used to
  // be. It is not a price — there is no next line to sell, the bay is over —
  // so hanging the `line` unit off it would read as "per line: full chain", and
  // ten mono characters at the money's size would take the rungs' width for a
  // string that is not a figure at all.
  //
  // A CALLER THAT CANNOT QUOTE still renders the empty money box rather than
  // nothing, and its 5ch reservation with it. The row's geometry is then the
  // same whether or not there is a price in it, which is the whole of the
  // digit-stable argument applied one step further out: a ladder that mounted
  // narrow and widened the moment the first price arrived would move the rungs
  // under the player's eye on the first crush of the bay.
  const val = full
    ? `<span class="pl-chain__word" id="hud-chain-val">Full chain</span>`
    : money <= 0
      ? `<span class="pl-chain__money" id="hud-chain-val"></span>`
      : `<span class="pl-chain__unitico" aria-hidden="true">${icon("line", 14)}</span>` +
        `<span class="pl-chain__money" id="hud-chain-val">$${money}</span>`;
  const title = full
    ? "Full chain — every crush in this bay in one streak"
    : money <= 0
      ? "Chain"
      : congested
        ? `Congested: a cleared line is capped at $${money}`
        : `The next crush pays $${money} a line`;
  return `<div class="pl-chain${mod}" id="hud-chain">
            <span class="pl-chain__val" title="${title}">${val}</span>
            <div class="pl-chain__rungs" aria-hidden="true">${rungs}<b class="pl-chain__gate"></b></div>
            <span class="pl-chain__star" aria-hidden="true">${icon("star", 11)}</span>
          </div>`;
}

export function hudHTML(opts: {
  /** What rides the belt: the shot AFTER the muzzle's (see game.ts's
   *  Game.beltPreview). */
  beltPreview: BeltPreview;
  target: number;
  score: number;
  /** Cost per launch this bay — quoted on the stat rail's launches row, right
   *  beside how many launches the current funds afford (#hud-launches,
   *  live-synced). Deep Run only: the rail that quotes it does not render in a
   *  Contract, which has no bankroll to price a launch against. */
  launchCost: number;
  /** THE CHAIN LADDER'S WHOLE STATE (chainLadderHTML), Deep Run only for the
   *  same reason the ladder is — a Contract's clear pays no money, so there is
   *  no streak to price.
   *
   *  THE LIVE STATE, not a rest state, and that is the point of passing it at
   *  all. This panel is re-rendered wholesale mid-bay — the pause card, the
   *  draft and the refit yard all mount it behind them, and syncHud does not
   *  run while any of them is up — so a ladder that always mounted empty would
   *  wipe a nine-crush streak the moment a player pressed ⏸, and would replace
   *  the gold full-chain with a blank row on the bay-clear card that is
   *  supposed to be celebrating it. The mount has to be spelled the way the
   *  next live patch will spell it; here that means BEING it.
   *
   *  Optional, like `seal` and `slots` above it: a caller with no game behind
   *  it (a fixture measuring the row at rest) gets CHAIN_AT_REST, which draws
   *  an empty ladder and quotes no price — "$0" is a worse lie than silence. */
  chain?: ChainState;
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
  /** Whether this bay carries the Thaw Lance, and how many charges are left —
   *  the same two-trigger treatment as the two above.
   *
   *  Charged by CHARGES like Bond Breaker rather than by the config like Demo,
   *  and the difference is a MODE rather than a preference: a Skydeck run's
   *  lance never resupplies (run.ts's advanceRun), so a rig that spent its last
   *  charge in bay 4 has no lance for bays 5 to 10 and must not be shown a live
   *  trigger for one. A ladder run reads the same field refilled. */
  thawOwned: boolean;
  thawCharges: number;
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
  /** How many SLOTS the rig's rack has (game/meta.ts's slotsFor) — the width
   *  the row draws, filled with the mounted systems and then with open boxes.
   *
   *  A FLOOR rather than a count: `shipPlatesHTML` draws every mounted system
   *  whatever this says and only the trailing open slots come from it, so the
   *  worst a wrong value here can do is draw one empty box too few. Defaulted
   *  and optional for that reason, and because the two surfaces that pass no
   *  rack at all — a Contract and a Drill — have no rig to have slots. */
  slots?: number;
  /** The run's tier, for the bay banner's plate (canvas A4). Null in
   *  Contract mode, whose banner names the Contract instead. */
  tier?: number | null;
  /** The active input family (D2). The HUD renders no hint text of its own any
   *  more — see the .hud__bottom removal below — so nothing in here reads it
   *  today; it stays on the options because the field IS the profile the HUD
   *  was rendered for, and every surface that grew a hint has needed to know
   *  that. Kept optional and unread rather than deleted and re-added.
   *
   *  There is no `hintsDismissed` beside it any longer: it existed to mount the
   *  key-hint strip already faded across a modal round-trip, and there is no
   *  strip to fade. */
  profile?: InputProfile;
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
   *  it — a drill's rig is granted by the lesson, not built by the player.
   *
   *  A FLIGHT SCHOOL LESSON TAKES THE SAME FLAG, because all three of those are
   *  true of it too, and only `kind` differs — the banner has to say which of
   *  the two authored bays this is, since one is optional practice reached from
   *  How to Play and the other is the licence. Defaults to "Drill", so every
   *  caller that predates the ladder reads exactly as it did. */
  drill?: { name: string; kind?: "Drill" | "Lesson" } | null;
  /** THE GRADUATION FLIGHT (meta.ts's GRADUATION_FLIGHT).
   *
   *  It is a real Tier 1 bay 1 flown with the player's rig, so it keeps the
   *  tier plate, the full readout and the ship rack — everything the `drill`
   *  flag above would take away. What it is NOT is a run, and the banner said
   *  otherwise: "TIER 1 · BAY 1/10" over a ten-pip progress strip, on a flight
   *  with no bay 2 to walk to (owner screenshot). So the banner names the exam
   *  and drops the strip, and nothing else about the bay moves. */
  exam?: boolean;
  /** THE BAY'S OWN ONE-LINE ASK, on a bay that renders the Deep Run readout and
   *  has something to state there.
   *
   *  It takes the row a Deep Run fills with its ratchet tally and a Contract
   *  fills with its complications — the same row shape for the same reason,
   *  a list whose length the panel does not control. A post-Workshop Flight
   *  School lesson is judged on BOTH a teaching goal and a funding target
   *  (game.ts's objectiveMet), and the funding half already owns the headline
   *  figure, so this is where the teaching half is stated and kept live.
   *
   *  Wins over the notch tally when both could render, which costs nothing: a
   *  lesson has no ratchets, so the row it displaces would read "0 —". */
  bayGoal?: { label: string; value: string } | null;
  /** The run's seal state and flown Mark (run.ts's sealStateFor), for the ⏸
   *  button's accessible name — the hold restarts the bay, so its name is
   *  where that gesture's price belongs. Absent on every bay with no seal
   *  question (a Contract, a drill, Tier S, the Skydeck) and on every caller
   *  that predates it, which renders the name it always had. */
  seal?: { state: SealState; mark: number } | null;
  /** Whether this run may hand a bay back at all (run.ts's bayRetryable).
   *
   *  False ONLY on the Skydeck, which is permadeath: the ⏸ hold then loses the
   *  half of its accessible name that names the gesture, and the hint strip
   *  loses the line that teaches it (hintParts). A name that offers a gesture
   *  main.ts refuses is worse than no name — an assistive-technology user has
   *  nothing else to read, so it is the ONE description they would get, and it
   *  would be wrong. */
  restart?: boolean;
  contract?: {
    name: string;
    kind: "lines" | "pattern" | "setpiece";
    goal: number;
    lines: number;
    /** Label for the numerator; lessons may count a timing grade or streak, and
     *  a SET PIECE Contract counts its best run of timed crushes. */
    goalLabel?: string;
    /** Flight School shows this once the streak has been introduced. */
    showCombo?: boolean;
    /** Lesson bays use the cannon's reload ring instead of duplicating it. */
    hideReload?: boolean;
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
  /** Why the bay just ended, on the renders that FOLLOW a loss — null for the
   *  whole of a bay that is still being played. The HUD is re-rendered
   *  wholesale on the way into the run-end screen (main.ts's renderOverlay),
   *  so the dial collapse cannot be a class dropped on a live element: it has
   *  to be part of the markup that render emits, or it would be thrown away by
   *  the very transition that is supposed to trigger it. See collapsingDial. */
  lossReason?: LossReason | null;
}): string {
  const {
    beltPreview, target, score, launchCost, bayNum, timeLimitSec, timeLeftMs,
    pieceSize, bondBreakerOwned, bondCharges, demoOwned, bombCharges, autoloaderOwned, ratchets, tiers,
    thawOwned, thawCharges, tier, loaded, contract, drill, fullscreenSupported = true,
    slots = 0, exam = false, bayGoal = null,
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
  // Which dial (if either) this render is the wake for. Asked with the two
  // facts that decide whether the readout is even on the panel, which are
  // exactly the two conditions the branches below render against — so the hook
  // class cannot land on a column this call did not emit.
  const collapse = collapsingDial(opts.lossReason, {
    funds: !contract,
    clock: timeLimitSec > 0,
  });
  // THE CLOCK, IN TWO SHAPES, because the readout it sits in is now two
  // different readouts. A Contract keeps the stacked label-over-value column
  // it always had, beside Lines/Goal and the supply count; a Deep Run's clock
  // is one row of the vertical STAT RAIL (an icon and a figure) that replaced
  // that block. Same id, same danger class, same dial-collapse hook in both —
  // main.ts and collapsingDial cannot tell them apart, and must not have to.
  //
  // `pl-time` before `dial-collapse` in both class lists, deliberately:
  // sim/systems.ts anchors the collapse hook on the readout's OWN class so the
  // cue can never be proved against the wrong column, and it reads them in
  // that order.
  const timeCollapse = collapse === "time" ? " dial-collapse" : "";
  const timeBlock =
    timeLimitSec > 0
      ? `<div class="pl-stat pl-time${timeCollapse}" id="hud-time-chip"><div class="lbl">Time</div><div class="v" id="hud-time">${formatMMSS(timeLeftMs)}</div></div>`
      : "";
  // THE DEEP RUN'S CLOCK LEFT THE RAIL (R4) and sits beside the funds figure,
  // right-aligned against that column's own edge. The two numbers a player
  // trades against each other — money made, seconds left — end up on one line,
  // and the clock is sized off the headline figure rather than off the rail's
  // three small ones, which is what it is actually read against.
  //
  // `pl-time` STAYS in the class list, before `dial-collapse`, for the reason
  // the block below states: sim/systems.ts anchors the collapse hook on the
  // readout's own class, and syncHud's `.pl-stat--danger` toggle finds the same
  // id in both shapes. `pl-timebig` is what the R4 sizing keys off.
  //
  // THE ALARM IS PART OF THE MOUNT, not only of the patch. syncHud toggles
  // `is-low` every frame, and a mount that always spelled the clock calm would
  // make the first sync after a re-render a MECHANISM change rather than a
  // value change — the same rule the three bar fills' inline `scaleX` follow.
  // It matters here in particular because this panel is re-rendered wholesale
  // mid-bay (the pause card, the draft, the refit yard) and syncHud does not
  // run while any of them is up: unmounted calm, the clock would come back from
  // a pause white with 20 seconds on it.
  const timeLow = timeLeftMs < CLOCK_ALARM_MS ? " is-low" : "";
  // THE PRICE'S CONGESTION CLASS IS PART OF THE MOUNT TOO, for the reason the
  // chain ladder is handed its live state rather than a resting one: this panel
  // is re-rendered WHOLESALE mid-bay — the pause card, the draft and the refit
  // yard all mount it behind them — and syncHud does not run while any of them
  // is up. Spelled calm at mount, a congested bay's price would go white the
  // moment a player pressed pause and stay white behind the card, which is the
  // one place they are actually reading it to decide whether to spend.
  //
  // Derived from the SAME fact syncHud derives it from: `chain.tierIdx` is the
  // index of the PileTier in force (main.ts's chainState reads it off
  // `g.pileTier` exactly as the launch-price branch does), so the two cannot
  // disagree. A caller with no bay behind it hands CHAIN_AT_REST's -1 and gets
  // no class, which is the honest reading of "no congestion known".
  const quoteIdx = opts.chain?.tierIdx ?? -1;
  const quoteTier = quoteIdx >= 1
    ? " pl-stat__quote--danger"
    : quoteIdx === 0
      ? " pl-stat__quote--warn"
      : "";
  const timeRow =
    timeLimitSec > 0
      ? `<div class="pl-timebig pl-time${timeLow}${timeCollapse}" id="hud-time-chip">${icon("clock", 22)}<span class="v" id="hud-time">${formatMMSS(timeLeftMs)}</span></div>`
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
        <span class="g">${icon("bond", 15)}</span><span class="nm">BOND BRK</span><span class="stk">×<span class="bond-trigger__count">${bondCharges}</span></span><span class="key">${keyLabel(keyFor("bond"))}</span>
      </button>`
    : "";
  const bondRailBtn = bondBreakerOwned
    ? `<button class="icon-btn bond-btn bond-trigger" data-game="bond" id="bond-btn" aria-label="Bond Breaker — hold to shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>${icon("bond", 20)}${railLegendHTML("bond")}<span class="bond-btn__count bond-trigger__count">${bondCharges}</span></button>`
    : "";
  const demoChip = demoOwned
    ? `<button class="mod mod--demo demo-trigger" data-game="demo" id="demo-chip" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>
        <span class="g">${icon("demo", 15)}</span><span class="nm">DEMO</span><span class="stk">×<span class="demo-trigger__count">${bombCharges}</span></span><span class="key">${keyLabel(keyFor("demo"))}</span>
      </button>`
    : "";
  const demoRailBtn = demoOwned
    ? `<button class="icon-btn demo-btn demo-trigger" data-game="demo" id="demo-btn" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>${icon("demo", 20)}${railLegendHTML("demo")}<span class="demo-btn__count demo-trigger__count">${bombCharges}</span></button>`
    : "";
  // The lance's pair. TAPPED, like Demolition and unlike Bond Breaker: it aims
  // itself, costs no launch and renews every bay on the ladder, so there is
  // nothing a hold-to-confirm meter would be protecting. The accessible name
  // says which cube it takes, because that is the whole skill of the control —
  // a player who does not know the lance melts what the BAR is about to reach
  // will fire it at the wrong moment and read the charge as wasted.
  const thawChip = thawOwned
    ? `<button class="mod mod--thaw thaw-trigger" data-game="thaw" id="thaw-chip" aria-label="Thaw Lance — thaw the frozen cube the press is about to reach"${thawCharges <= 0 ? " disabled" : ""}>
        <span class="g">${icon("thaw", 15)}</span><span class="nm">THAW</span><span class="stk">×<span class="thaw-trigger__count">${thawCharges}</span></span><span class="key">${keyLabel(keyFor("thaw"))}</span>
      </button>`
    : "";
  const thawRailBtn = thawOwned
    ? `<button class="icon-btn thaw-btn thaw-trigger" data-game="thaw" id="thaw-btn" aria-label="Thaw Lance — thaw the frozen cube the press is about to reach"${thawCharges <= 0 ? " disabled" : ""}>${icon("thaw", 20)}${railLegendHTML("thaw")}<span class="thaw-btn__count thaw-trigger__count">${thawCharges}</span></button>`
    : "";
  // Held, not tapped: pointerdown starts the burst and pointerup ends it (see
  // main.ts's onGamePointerDown). Sits at the BOTTOM of the rail, nearest a
  // right thumb at rest, because it is the only rail control meant to be held
  // through a whole compactor window rather than jabbed.
  const autoRailBtn = autoloaderOwned
    ? `<button class="icon-btn auto-btn" data-game="auto" id="auto-btn" aria-label="Autoloader — hold to fire">${icon("launcher", 17)}${railLegendHTML("auto")}</button>`
    : "";
  // The ship rack is a Deep Run readout. See the build row below for why a
  // Contract does not get one.
  const plates = contract || drill ? "" : shipPlatesHTML(tiers, slots);
  // BAY BANNER — the run position, top-center of the field. Playtest feedback:
  // "Bay 1/10" as small muted text inside the plant title read as part of the
  // level name, so players didn't know they were 1 bay into a 10-bay run. The
  // banner makes the x/10 the headline and adds one pip per bay (cleared pips
  // lit, current pip amber) so progress is readable at a glance without
  // parsing any numbers. Contract mode shows the contract's name instead —
  // there is no run position to report.
  const bayBanner = drill
    ? `<div class="bay-banner bay-banner--contract" role="status">
        <span class="bay-banner__mode">${drill.kind ?? "Drill"}</span> ${drill.name}
      </div>`
    : exam
    ? // THE EXAM WEARS THE TIER PLATE AND NOTHING ELSE OFF THE RUN'S BANNER.
      // The plate is the true half of what the old banner claimed — this really
      // is Tier 1's bay 1, built by the run's own pipeline — and the "1/10"
      // with its ten pips is the false half: there is no bay 2 on this flight,
      // so a progress strip nine tenths empty was promising a run the player is
      // not on. The mode word carries the ladder's name and the title the one
      // thing left to say about the flight.
      `<div class="bay-banner bay-banner--contract" role="status"
        aria-label="Flight School, Final Exam — Tier 1, bay 1">
        ${tier ? tierPlateHTML(tier, "banner") : ""}
        <span class="bay-banner__mode">Flight School</span> ${FINAL_EXAM}
      </div>`
    : contract
    ? `<div class="bay-banner bay-banner--contract" role="status">
        <span class="bay-banner__mode">Contract</span> ${contract.name}
      </div>`
    : `<div class="bay-banner" role="status" aria-label="Bay ${bayNum} of ${RUN_LEVELS}${tier ? `, ${tier === SKYDECK_TIER ? "Skydeck" : tierText(tier)}` : ""}">
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

         THE SAME RAIL ON EVERY POINTER. Desktop used to shed the game buttons
         entirely (an @media (pointer: fine) rule hid all but fullscreen and
         pause) and put the controls in a text strip along the foot of the
         field instead, on the argument that a keyboard already covers Q/E and
         B/X/C. It cost the desktop build the whole action surface: the strip
         named controls that had no control on screen, so a mouse player could
         READ "Q/E rotate" and had nothing to click, and the two platforms grew
         two different shapes for the same game. The buttons are back for
         everyone, and each one now carries its own keycap and pad mark
         (components.ts's railLegendHTML) — one object saying what it does, what
         key does it, and what pad button does it. The cancel ✕ stays
         touch-only: a mouse mid-drag has no second finger to abort with, and
         the fine pointer does not drag to aim at all (it clicks a spot). -->
    <div class="side-rail">
      ${fullscreenSupported ? `<button class="icon-btn" id="fullscreen-btn" data-action="fullscreen" aria-label="Fullscreen">${icon("fullscreen", 22)}</button>` : ""}
      <!-- TAP pauses, HOLD restarts the bay (main.ts's startHold). The second
           half is in the accessible name because it has nowhere else to go: the
           legend below says which KEY and which pad button reach this control,
           which is not the same fact as "a long press does something else", and
           the only surface that spells the gesture out (the pause card's
           reference block) is behind the very button being described. Costs no
           pixels on any device and is the only route an assistive-technology
           user has to a gesture that is otherwise undiscoverable. -->
      <!-- …and the seal's price rides that same name when there is one, in the
           SAME words the two buttons wear (sealFaceLabel). NO GLYPH here, and
           that is a decision rather than an omission: this is a 22px icon
           button on a live field, the rail is width-budgeted (sim/uifit's
           rail assertion), and a cost readout painted over a bay in flight is the
           mistake the hint strip's own note describes from the other side.
           The hold is also the one door of the three that cannot be pressed by
           accident — it is a deliberate gesture with its own meter — and it is
           confirmed by the same panel every other door is (requestBayRetry),
           so the press is never charged unannounced. What the label buys is
           the half that has nowhere else to go: an assistive-technology user
           gets the cost before the gesture, exactly as they get the gesture
           itself. -->
      <!-- …and the price is DASHED on, exactly as the two buttons dash it on,
           not folded in as a relative clause. This read ", which " for one
           release: "breaks this run's seal" happens to parse after a relative
           pronoun, so the at-stake name looked right and the other two came out
           as "hold to restart the bay, which this run's seal is already
           broken". Since this name is the ONLY cost explanation an
           assistive-technology user of an icon-only control ever gets, a
           malformed one is not a typo — it is the explanation failing. The
           label carries its own subject now and every door joins it the same
           way (sealNameWith). (Codex review, PR #144.) -->
      <!-- …and on a run that may not hand a bay back at all (run.ts's
           bayRetryable — the Skydeck, which is permadeath) the name loses the
           gesture along with its price, because main.ts refuses the hold there.
           This name is the ONLY description an assistive-technology user of an
           icon-only control ever gets, so a name that offers a gesture nothing
           performs is not a smaller version of this label — it is the label
           being wrong, to the one audience that cannot check. -->
      <button class="icon-btn" data-action="pause" aria-label="${
        (opts.restart ?? true)
          ? (opts.seal
            ? sealNameWith(PAUSE_HOLD_NAME, opts.seal.state, opts.seal.mark)
            : PAUSE_HOLD_NAME)
          : "Pause"
      }">${icon("pause", 22)}${railLegendHTML("pause")}</button>
      <button class="icon-btn rotate-btn" data-game="rotl" aria-label="Rotate left">${icon("rotl", 22)}${railLegendHTML("rotl")}</button>
      <button class="icon-btn rotate-btn" data-game="rotr" aria-label="Rotate right">${icon("rotr", 22)}${railLegendHTML("rotr")}</button>
      ${bondRailBtn}
      ${demoRailBtn}
      ${thawRailBtn}
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
        <!-- THE READOUT, and it is TWO readouts sharing one row class.

             A CONTRACT keeps the three-column shape the panel has always had:
             Lines/Goal taking the leftover width, then equal fixed columns for
             the supply count and (on a lines bay) Lost, each a label stacked
             over its value.

             A DEEP RUN is the R3 "Chainline" redesign. The left column is the
             funds block plus the CHAIN LADDER (chainLadderHTML above); the
             right is a vertical STAT RAIL — launches with the shot's live
             price, the clock, scrap — three icon-and-figure rows behind a
             hairline. The two shapes exist because the two bays are answering
             different questions: a Contract is counting DOWN a supply against
             a line goal, where a column heading per number is the clearest
             thing on the panel, while a Deep Run is running an ECONOMY, where
             the rail's job is to stay out of the way of the two things that
             actually move a decision — the money and the streak. -->
        <div class="pl-read">
          ${
            contract
              ? `<div class="pl-funds">
            <div class="lbl">${contract.goalLabel ?? "Lines"}<span class="lbl__q"> / Goal</span></div>
            <div class="v"><span id="hud-score">${contract.lines}</span> <span class="tgt">/ ${contract.goal}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="transform:scaleX(0)"></i></div>
          </div>
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">${contract.kind === "pattern" ? "Shipments" : "Launches"}</div>
            <div class="v" id="hud-launches">${contract.launchesLeft}</div>
          </div>
          ${
            // LOST RIDES BOTH BUDGETED KINDS. On a lines Contract it is the
            // launch budget quietly draining; on a SET PIECE it is the harsher
            // reading of the same number — a lost cube breaks the streak
            // outright (game.ts's chargeLostCubes), so this column is the one
            // place the player can watch the thing that ends their run. Only
            // the pattern bay is excluded, for the reason argued on `lost`.
            contract.kind === "pattern"
              ? ""
              : `<div class="pl-stat pl-lost"><div class="lbl">Lost</div><div class="v" id="hud-lost">${contract.lost}</div></div>`
          }
          ${timeBlock}`
              : `<div class="pl-funds${collapse === "funds" ? " dial-collapse" : ""}">
            <div class="lbl">Funds<span class="lbl__q"> / Target</span></div>
            <!-- THE FIGURE AND THE CLOCK SHARE A ROW (R4), and the figure's two
                 halves STACK inside it. Side by side the pair's worst case is
                 "$18420 / 21000" at headline size, and that plus a clock is
                 wider than this column has ever been — the panel is a fixed
                 fraction of the field, so there is no width to go and find.
                 Stacked, the pair's box is the WIDER of its two lines rather
                 than their sum, which is what makes the ch-unit reservations in
                 app.css's digit-stable block affordable and what makes the
                 clock's right edge genuinely fixed across a bay. -->
            <div class="pl-fundsrow">
              <div class="v"><span id="hud-score">$${score}</span> <span class="tgt">/ ${target}</span></div>
              ${timeRow}
            </div>
            <div class="pl-goal"><i id="hud-goal" style="transform:scaleX(0)"></i></div>
          </div>
          <div class="pl-rail">
            <div class="pl-stat pl-stat--rail pl-launches" id="hud-launches-chip">
              ${icon("crosshair", 12)}<span class="v" id="hud-launches">${launches}</span>
            </div>
            <!-- THE SHOT'S PRICE IS A ROW OF ITS OWN (R4). It was an 8px
                 footnote hung off the launches figure, joined to it by an
                 at-sign — the number that decides whether the next shot is
                 affordable, at the bottom of the panel's type scale. At the
                 rail's own size it wears "levy", the price-tag glyph the draft
                 already deals the launch-cost axis by, so the row and the axis
                 that raises it share one mark.

                 It keeps id="hud-launch" and the warn/danger escalation the old
                 meta line's span carried, in the same amber and red, in the
                 same order, as the rows lighting the bay floor beneath it
                 (render.ts's drawCongestionRows) — with a blink whose RATE
                 carries the tier as well (app.css's congestion-blink block).
                 No box: the row is structurally the launches row with a
                 different mark, and the mark takes the figure's tier colour so
                 the two cannot disagree about how bad the shot has got. -->
            <div class="pl-stat pl-stat--rail pl-cost">
              ${icon("levy", 12)}<span class="v${quoteTier}" id="hud-launch">$${launchCost}</span>
            </div>
            <!-- SCRAP takes the currency's own glyph (icons.ts's "scrap"), not
                 a second drawing of the same pocket: the yard and the workshop
                 already price things in it, and a currency with two faces is
                 the confusion that set exists to have fixed. -->
            <div class="pl-stat pl-stat--rail pl-scrap">${icon("scrap", 12)}<span class="v" id="hud-scrap">0</span></div>
          </div>`
          }
        </div>
        ${
          // THE CHAIN LADDER, on its own row spanning the panel rather than
          // inside the funds column the mock drew it in — and the reason is a
          // measurement, not a preference.
          //
          // The mock is 500px wide. The narrowest NOTCHED panel this app ships
          // to (iPhone X, 812x375 with 44px insets either side) gives the plant
          // 229px of content, and the readout spends most of that on the funds
          // figure and the stat rail beside it. Inside the funds column the row
          // has ~148px to hold a pixel label, a star, a "Next $1080" quote —
          // all three unbreakable — and twelve rungs, which leaves the rungs
          // 45px: under 4px each, TALLER than they are wide. That is a run of
          // tick marks, which is the dot-counter this readout exists to
          // replace. Full width the same row hands the rungs ~126px, so each
          // is about 7.5px on a 6px height and the ladder reads as a ladder at
          // roughly the proportions the mock actually drew.
          //
          // It still lands directly UNDER the goal bar on screen: `.pl-read` is
          // `align-items: flex-end` and the goal bar is the last thing in the
          // funds column, so the two are adjacent exactly as designed — the row
          // simply runs on under the rail as well, which is also the honest
          // picture (the streak prices every line, not just the ones the funds
          // column happens to be over).
          contract && !contract.showCombo ? "" : chainLadderHTML(opts.chain ?? CHAIN_AT_REST)
        }
        <!-- Reload: fills as the launch cooldown runs down (see
             cannon.reloadRatio). Goes .ready the instant the cannon can fire
             again, which is the only state change that matters here.

             THE FILL IS A TRANSFORM, not a width, and so are the PWR meter's
             and the goal bar's. All three are full-width elements scaled about
             their left edge, which is what lets the one readout on this panel
             that genuinely moves every frame move without asking the layout
             engine for anything. See app.css's "THE THREE BAR FILLS" and
             main.ts's syncHud; the inline value here is the starting state the
             first frame of the bay shows, before syncHud has run at all, and
             it has to be spelled the same way syncHud will spell it or the
             first write would be a mechanism change rather than a value
             change. -->
        ${
          // Reload — a CONTRACT's row now, and only a Contract's.
          //
          // "What a Contract keeps is the reload bar and its modifiers" was
          // already the doctrine when the meta line went; this finishes the
          // sentence from the other end. render.ts's drawReloadRing
          // (render.ts:588) draws the SAME value as a ring around the muzzle,
          // and the two views were justified as "the ring is what you read
          // mid-aim with your eyes on the cannon, this is what you catch in
          // peripheral vision while looking at the pile". That argument holds
          // for a Contract, whose panel is otherwise four quiet rows. It does
          // not hold for the R3 readout above: the chain ladder and the stat
          // rail are what peripheral vision is now spending itself on, and a
          // duplicate of a number already drawn on the cannon is the cheapest
          // row on the panel to give them.
          //
          // A Contract has no ladder to lose it to — no bankroll, no payout,
          // no streak worth money — so nothing there is competing for the
          // glance, and the bar keeps its .ready flip, its will-change
          // promotion and its inline mount state unchanged.
          contract && !contract.hideReload
            ? `<div class="pl-load" id="hud-load-row">
          <span class="lbl">Reload</span>
          <div class="pl-load__track"><i id="hud-load" style="transform:scaleX(1)"></i></div>
        </div>`
            : ""
        }
        <!-- NO META LINE. .pl-meta was "Combo ×0 · Launch $20 · Scrap 0",
             Deep Run only, and every one of its three numbers is now somewhere
             it can be read without being parsed: the combo is the chain ladder
             above, the launch price is the quote riding the launches figure on
             the rail, and scrap is a rail row wearing the currency's own glyph.
             A row of three labelled figures in 8px pixel type, on the panel a
             player checks mid-shot, was the least legible way to say any of
             them. -->
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
          //
          // MARK, TOTAL, THEN THE LIST (R4). The word "Notches" is the `notch`
          // mark now, and the figure beside it is what the tally adds up to —
          // which is the whole point of putting it there: the list is the row
          // this panel cannot promise to show whole (ten axes and a clause
          // overflow the scroller on a phone), so the count it can no longer
          // be counted for is stated once, in front, where the tail cannot
          // take it. The list stays as the EXPLANATION of that figure.
          //
          // `totalNotches` is hazards.ts's; sandbox.ts's `ratchetTotal`, which
          // the draft's own notch stat uses, is the same sum over the same
          // object — sim/systems.ts pins the two equal so this row and the
          // draft's can never quote different numbers for one run.
          //
          // A CLEAN RUN IS NOT AN ALARM. The mark and the total wear the
          // draft's red, which is right for a bill and wrong for a zero, so at
          // zero the row drops to the faint text colour. Colour only: the row's
          // geometry is identical either way, which is what keeps the first
          // notch of a run from shifting every row above this one.
          contract
            ? ""
            : bayGoal
            ? `<div class="pl-notch"><span class="lbl">${bayGoal.label}</span><b id="hud-conditions">${bayGoal.value}</b></div>`
            : (() => {
                const banked = totalNotches(ratchets);
                return `<div class="pl-notch${banked ? "" : " pl-notch--clean"}"><span class="lbl">${
                  icon("notch", 16)
                }</span><span class="pl-notch__total" id="hud-notch-total">${banked}</span><b id="hud-notches">${
                  runNotchTallyHTML(ratchets, opts.final ?? null)
                }</b></div>`;
              })()
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
          plates || bondChip || demoChip || thawChip
            ? `<div class="pl-mods" id="hud-mods">
          <span class="lbl">Build</span>
          ${bondChip}
          ${demoChip}
          ${thawChip}
          ${plates}
        </div>`
            : ""
        }
      </div>
    </div>

    <!-- NO HINT LAYER. .hud__bottom was a full-bleed layer holding one thing:
         the key-hint strip along the foot of the field, which named the
         keyboard's controls to a desktop player. The rail carries the controls
         AND their keycaps now, and the owner's read of what was left is the one
         that settles it — the HUD is not where shortcuts belong. The complete
         scheme, both input families, including the parts no button anywhere
         carries (the aim keys, the stick, the mouse's wheel and buttons, the
         hold that restarts the bay), is on the pause card: one keypress away,
         at rest, with room to be read, instead of painted across a live bay
         (pauseKeysHTML). -->
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
  owned: { bond: boolean; demo: boolean; thaw: boolean; auto: boolean },
  /** Whether the run may hand a bay back at all (run.ts's bayRetryable). False
   *  only on the Skydeck, which is permadeath — the hold-to-restart line below
   *  is then teaching a gesture main.ts refuses, and D2's whole rule is that a
   *  hint renders from what the game will actually do. */
  restart = true,
  /** settings.wheelRotates — the Controls screen's "Wheel rotates" switch.
   *
   *  THE CARD USED TO TEACH ONE SCHEME AND THE TOGGLE SAT UNDER IT OFFERING
   *  THE OTHER (found in review). "scroll for arc height" and "right ⟳" are
   *  only true with the switch OFF; with it on the wheel turns the shipment
   *  and arc height moves to the right-button drag, so a player who flipped it
   *  read a card describing a game they were no longer playing — on the one
   *  surface this file's own header calls the last place control instructions
   *  live. Defaults false, the switch's own default, so every caller that
   *  predates the argument renders exactly what it rendered before. */
  wheelRotates = false,
): string[] {
  const kbd = (s: string) => `<span class="kbd">${s}</span>`;
  const parts: string[] = [];
  /* Each hint is wrapped as ONE element below, which is layout, not markup
     tidiness: .pause-keys__grid is a flex container, so every loose text node
     between two chips ("/" , " rotate") would be its own anonymous flex item
     and take the container's gap around it — which both spells the hints wrong
     ("Q / E rotate") and pads the block out by width it does not need. Grouped,
     a wrap can only break BETWEEN hints. The class name still says `kbd-hint__`
     because the parts are the same parts; only the surface that lays them out
     went away. */
  const part = (inner: string) => parts.push(`<span class="kbd-hint__part">${inner}</span>`);
  if (profile === "gamepad") {
    part(`${kbd(padLabel(padFor("rotl")))}/${kbd(padLabel(padFor("rotr")))} rotate`);
    // The rate-dial default (gamepad.ts): vertical trims the angle,
    // horizontal the power, centred holds. The slingshot opt-in changes what
    // the stick MEANS but not that it aims, so the hint stays true either way.
    // A STICK HAS NO BUTTON, so this line is the only place in the game the
    // pad's aim scheme is written down at all.
    part(`${kbd("Stick")} ↕ angle · ↔ power`);
    part(`${kbd(padLabel(padFor("fire")))} fire`);
    if (owned.bond) part(`${kbd(padLabel(padFor("bond")))} break bonds`);
    if (owned.demo) part(`${kbd(padLabel(padFor("demo")))} arm charge`);
    if (owned.thaw) part(`${kbd(padLabel(padFor("thaw")))} thaw`);
    if (owned.auto) part(`${kbd(padLabel(padFor("auto")))} hold to autofire`);
    part(`${kbd(padLabel(padFor("pause")))} pause`);
    /* THE MENU GESTURES (ui/padnav.ts): the D-pad moves focus, A activates,
       B backs out, and Back opens Controls from any menu. Named here because
       a pad player's whole route through the game runs on them and nothing
       else on screen says so — the pause modal a player is reading this card
       on is itself being driven by them.

       THE CARD IS ALSO THE ONE HINT SURFACE THAT APPEARS ON A MENU, which is
       where these gestures apply. They used to be guarded off the field strip
       for that reason (and because four more hints wrapped it into the plant
       panel); with the strip gone the guard has nothing left to exclude.

       THE CHIPS ARE FIXED INDICES, not bindings.ts lookups — the one place
       this table's "every chip is a live binding" rule is deliberately
       relaxed, because these buttons are the opposite of live: they are the
       conventions no rebind may touch, and padLabel names the physical
       button. A chip here cannot go stale, which is what the rule protects. */
    part(`${kbd("D-pad")} move`);
    part(`${kbd(padLabel(PAD_CONFIRM))} select`);
    part(`${kbd(padLabel(PAD_BACK))} back`);
    part(`${kbd(padLabel(PAD_CONTROLS))} opens Controls`);
  } else {
    part(`${kbd(keyLabel(keyFor("rotl")))}/${kbd(keyLabel(keyFor("rotr")))} rotate`);
    // Aim, power and fire are the SHOT, and the shot has no button in this game
    // on any device — a finger pulls the field back, a mouse points at a spot,
    // and these keys are the third way to say the same thing. Nothing on the
    // rail can carry them, so this card is where they live.
    part(`${kbd(keyLabel(keyFor("aimUp")))}/${kbd(keyLabel(keyFor("aimDown")))} aim`);
    part(`${kbd(keyLabel(keyFor("powerDown")))}/${kbd(keyLabel(keyFor("powerUp")))} power`);
    part(`${kbd(keyLabel(keyFor("fire")))} fire`);
    if (owned.bond) part(`${kbd(keyLabel(keyFor("bond")))} break bonds`);
    if (owned.demo) part(`${kbd(keyLabel(keyFor("demo")))} arm charge`);
    // ONE WORD, and the shortest true one on the card's ability run. "thaw" is
    // what the verb is; which cube it takes is on the button's own accessible
    // name and in the guide, where a sentence fits.
    if (owned.thaw) part(`${kbd(keyLabel(keyFor("thaw")))} thaw`);
    if (owned.auto) part(`${kbd(keyLabel(keyFor("auto")))} hold to autofire`);
    /* THE PAUSE KEYS, plural: the rebindable one (P by default) and Escape,
       which bindings.ts keeps as a fixed alias and which pauses on every
       shell — directly where the page sees it, and through the fullscreen
       exit it causes where a browser or the desktop shell consumes it
       (main.ts's onFullscreenChange). The alias chip is the keyboard arm's
       one relaxation of "every chip is a live binding", on the pad arm's own
       terms: a key no rebind may touch cannot go stale. It is dropped from
       the card the moment a swap hands Escape to another action. */
    part(`${pauseKeyLabels().map(kbd).join("/")} pause`);
    /* The desktop shell's fullscreen keys (F11; ⌃⌘F leads on a Mac), which
       exist nowhere the player can otherwise read them — the shell handles
       them before the page sees the keydown. Empty in a browser and on the
       native shells, where the line is not rendered (lib/platform's
       shellFullscreenKeys). Fixed chips, same relaxation as the alias. */
    if (fullscreenKeys().length) part(`${fullscreenKeys().map(kbd).join("/")} fullscreen`);
    /* "click to aim", not "drag to aim", and this strip is the one place the
       change is safe to state flatly. It renders only under `pointer: fine`
       (see the block below), where the pointer IS a mouse — and the mouse is
       the device that now aims by pointing at a spot and letting the cannon
       solve the arc onto it (game/input.ts). A finger still pulls back, and a
       finger never sees this strip. */
    part("click to aim");
    /* The rest of the mouse scheme (game/input.ts), plain for the same
       no-keycap reason as "click to aim": the wheel and the mouse buttons are
       not rebindable keys, and a chip around them would claim they are.

       TWO SCHEMES, AND THE CARD STATES THE ONE THAT IS ON. The switch swaps
       the wheel and the right button's jobs wholesale — it is not a flavour of
       one control — so both lines change together, which is also why they stay
       two parts rather than becoming one long sentence: the grid wraps between
       parts, and the pair has to survive a narrow card in either mode. */
    if (wheelRotates) {
      part("scroll ⟳ · wheel-press ⟲");
      part("hold right + drag for arc height");
    } else {
      part("scroll for arc height");
      part("right ⟳ · wheel-press ⟲");
    }
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
    if (restart) part("hold pause to restart");
  }
  return parts;
}

/* NO hintStripHTML, AND NO `full` FLAG ON hintParts.
 *
 * There were two renderers of that table and they wanted different subsets, so
 * hintParts took a flag: the pause card asked for everything, the HUD's strip
 * for a lean set that would fit the foot of a live field. The strip is gone —
 * the rail carries every control it can, on the control itself, and the owner's
 * verdict on the remainder is that the HUD is not where shortcuts belong — so
 * there is one caller, it always wants everything, and a parameter with one
 * value at every call site is a parameter that only makes the table look
 * conditional. HINT_SEP went with it: the card lays its parts out in a grid and
 * never needed the strip's interpuncts.
 *
 * The consequence worth stating plainly, because it is the point rather than a
 * side effect: EVERY control instruction in this game is now either printed on
 * the control (the rail's legends, components.ts's railLegendHTML) or on the
 * pause card. There is no third place, so there is no third place to go stale.
 */

/**
 * The pause modal's control reference — the one home of the input scheme.
 * Renders from hintParts, so it cannot disagree with the rail's legends about a
 * binding: both read game/bindings.ts. The note under it is where "the rest"
 * lives, pointing at the Controls screen the way the design asks (rebinds, the
 * stick settings).
 *
 * Rendered for every profile and CSS-gated on the pointer (fine, or the gamepad
 * profile on any pointer — touch pauses into the same modal and its controls
 * are the rail): the pause modal is one innerHTML render, and gating in markup
 * would leave a stale block behind when the profile flips mid-pause, so
 * main.ts's setProfile re-patches this node by id instead.
 */
export function pauseKeysHTML(
  profile: InputProfile,
  owned: { bond: boolean; demo: boolean; thaw: boolean; auto: boolean },
  /** run.ts's bayRetryable — see hintParts. */
  restart = true,
  /** settings.wheelRotates — see hintParts. main.ts passes it from the live
   *  settings on both doors that mount this block (the pause render and
   *  relabelHintSurfaces' in-place patch), so flipping the switch and pausing
   *  cannot show a card for the other scheme. */
  wheelRotates = false,
): string {
  const parts = hintParts(profile, owned, restart, wheelRotates);
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
 * module only renders the current step). Steps carry no keyboard talk beyond
 * what the one hint table hands them (coachSteps renders hintAim/hintRotate per
 * profile): the rail is the control surface on every device now and each of its
 * buttons wears its own keycap and pad mark, so a card spelling the same keys
 * out again would be repeating the machine back to the player.
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
  /* The pad's route to this button. While the game is live every pad face
     button is spoken for except B, so B presses the card's button (main.ts's
     onPadUiButton) — and a control a pad cannot see is a control a pad-only
     player cannot use, so the button wears the chip. RAW B (padnav's
     PAD_BACK), not a bindings.ts lookup: this is the menu-layer convention,
     deliberately outside the rebindable gameplay table — see padnav.ts. */
  const padKey = profile === "gamepad"
    ? `<span class="kbd coach__padkey">${padLabel(PAD_BACK)}</span>`
    : "";
  return `<div class="coach" id="coach">
    <div class="coach__card">
      <div class="coach__eyebrow">Tutorial · ${Math.min(step + 1, steps.length)}/${steps.length}</div>
      <div class="coach__title">${s.title}</div>
      <p class="coach__body">${s.body}</p>
      <div class="coach__foot">
        <span class="coach__dots" aria-hidden="true">${dots}</span>
        ${
          last
            ? `<button class="btn btn--primary coach__btn" data-action="coach-done">${padKey}Got it!</button>`
            : `<button class="btn btn--ghost coach__btn" data-action="coach-skip">${padKey}Skip tutorial</button>`
        }
      </div>
    </div>
  </div>`;
}

/**
 * A FLIGHT SCHOOL CARD (game/school.ts's LessonCard).
 *
 * Deliberately the coach's own markup rather than a component of its own: every
 * rule in app.css that makes a card share the plant panel's column without
 * pushing it — the height cap, the aiming fade, the pointer-events release —
 * is written against `.coach`, and a second class would need all of them again
 * and would drift from them the first time one moved.
 *
 * THE DECK RIDES WITH THE LIVE BAY. It is HUD content, not a modal: completing
 * the first prompted action swaps in the next card, and a correct row gives it
 * visible acknowledgement. The plant's complications row keeps the target on
 * screen after the player hides the tip.
 *
 * ONE BUTTON. main.ts routes the pad's B to a single `.coach__btn` while the
 * bay is live, because every other face button is spoken for by gameplay — so a
 * second button here would leave a pad-only player unable to advance at all.
 * Leaving the ladder is the pause modal's job, which is a real pad-navigable
 * screen.
 */
export function lessonCardHTML(
  /** THE WHOLE LESSON, not the two fields the card prints.
   *
   *  It used to be structurally typed down to `{ name, cards }`, which was
   *  honest about what the card read and became wrong the moment the card grew
   *  a picture: the pictogram is drawn out of `wall`, `wallMaterial` and
   *  `sequence` (ui/lessonart.ts), i.e. out of the bay's own geometry, and a
   *  narrowed type would have forced the art to be passed in beside the lesson
   *  by whichever caller happened to remember to. Every call site already hands
   *  over a real LESSONS entry. */
  lesson: Lesson,
  /** Where this bay sits on the GROUND FLOOR's ladder, 1-based (meta.ts's
   *  schoolStepOfFlight) — not its index in LESSONS. The eyebrow prints a
   *  position out of the ladder's ten flights, so a lesson
   *  index would have the deck counting a different ladder from the plate, the
   *  lobby panel and the result card. */
  step: number,
  card: number,
  total: number,
  profile: InputProfile = "touch",
): string {
  const i = Math.max(0, Math.min(card, lesson.cards.length - 1));
  const c = lesson.cards[i];
  // `input: "aim"` PREFIXES the card with the live device's firing gesture; it
  // does not replace the card. It used to replace it, and that cost twice: the
  // authored body was dead copy nothing could render, and the sentence that
  // survived named the gap's width — a number authored in school.ts, next to
  // the wall profile that produces it — from inside the UI layer, where a
  // reshaped bay could not reach it. The gesture is the part this file knows
  // (it is per-profile); what to point the arc at stays with the lesson.
  // THE GESTURE COMES FROM THE ONE HINT TABLE (bindings.ts), never from the
  // card. A card is prefixed with the live device's verb for the action it is
  // teaching, and says the rest itself.
  //
  // `rotate` was the hole. Its card typed "the glowing ⟲ / ⟳ buttons" — the
  // touch rail's glyphs — and a keyboard player reads Q / E on the buttons in
  // front of them while a pad player reads LB / RB, so the one card in the
  // ladder that names a control by sight named it wrongly on two profiles out
  // of three. It is also the card whose whole subject is finding two buttons in
  // a rail of seven.
  const gesture = c.input === "aim"
    ? profile === "touch"
      // TIGHTENED with the deck (school.ts's copy budget). Eighteen words of
      // prefix in front of a seven-word card is a prefix that has become the
      // card, and the two clauses cut ("on the field", and the em-dashed aside
      // in the middle of the gesture) are both things the picture and the PWR
      // readout say better than a sentence does.
      ? `<b>Pull back</b> like a slingshot, then <b>release</b> — farther is more power.`
      : `<b>${hintAim(profile)[0].toUpperCase()}${hintAim(profile).slice(1)}.</b>`
    : c.input === "rotate"
      ? `<b>${hintRotate(profile)[0].toUpperCase()}${hintRotate(profile).slice(1)}</b> to turn the next shipment 90°.`
      : "";
  const body = gesture ? `${gesture} ${c.body}` : c.body;
  const last = i >= lesson.cards.length - 1;
  const dots = lesson.cards
    .map((_, n) => `<i class="${n < i ? "done" : n === i ? "cur" : ""}"></i>`)
    .join("");
  // The pad's route to this button, on the same terms coachHTML states: while
  // the game is live every pad face button is spoken for except B.
  const padKey = profile === "gamepad"
    ? `<span class="kbd coach__padkey">${padLabel(PAD_BACK)}</span>`
    : "";
  // THE PICTOGRAM, and it goes ABOVE the title rather than beside the body.
  //
  // The card is a column in a column: it shares the plant panel's width, which
  // is 47% of the field, so a strip beside the copy would leave both of them
  // under half a phone-width. Above, it gets the full box and the reading order
  // is picture -> title -> instruction, which is the order the owner's note
  // asks for — the exercise is recognised before a word of it is read.
  //
  // Drawn from the LESSON, not from the card's strings: everything in it comes
  // out of the same `wall` / `wallMaterial` / `sequence` the bay is built from
  // (ui/lessonart.ts), so it cannot describe a board the player is not looking
  // at. The card index goes with it because a board can hold more than one gap
  // and the deck's order is what says which one this card means.
  const art = lessonPictogramHTML(lesson, i);
  return `<div class="coach" id="coach" aria-live="polite">
    <div class="coach__card">
      <div class="coach__eyebrow">Flight School · ${step}/${total}</div>
      <div class="lart__strip">${art}</div>
      <div class="coach__title">${c.title}</div>
      <p class="coach__body">${body}</p>
      <div class="coach__foot">
        <span class="coach__dots" aria-hidden="true">${dots}</span>
        <button class="btn btn--primary coach__btn" data-action="coach-done">${padKey}${
          last ? "Hide tip" : "Next"
        }</button>
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
            <button class="btn btn--ghost" data-action="coach-skip-run">Skip tutorial</button>
            <button class="btn btn--ghost" data-action="menu">Quit</button>
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
  /** What the THIRD stat says on a Skydeck run (game/skydeck.ts), in place of
   *  the scrap payout.
   *
   *  It takes that slot rather than adding a block, and the reason is height:
   *  this card is centred in a fixed viewport with no scroller, and on the
   *  640x360 phone it is already within ~70px of the edge. A fourth row for the
   *  clause pushed the whole layout past the bottom of that device (measured —
   *  sim/uifit caught the HUD's auto button at y 404 in a 360px viewport). The
   *  slot it replaces is the honest one to take: a Skydeck run earns no scrap
   *  at all, so what stood there was a permanent 0.
   *
   *  It belongs on THIS card rather than on the draft that follows, and that is
   *  the projection's fault: the draft's "as it stands" column is already built
   *  from the bay the clause applies to (run.ts's levelForRun), so by the time
   *  the player reads those numbers the clause has silently moved them. This is
   *  the one screen between the bay that earned it and the numbers it changes.
   *
   *  Absent on every ladder run, so every caller that predates the mode renders
   *  the card it always did. */
  slot?: { value: string; label: string };
  /** What the card says instead of the bare "Continue".
   *
   *  One caller passes it: the GRADUATION FLIGHT (meta.ts's schoolLadder, rung
   *  12), which is a Tier 1 bay 1 and therefore earns this card rather than a
   *  lesson's — and is also the one clear in the game that opens a floor. The
   *  hint line is where that goes: the card's three stats are the bay's own
   *  numbers and none of them can carry it, and a fourth block would push the
   *  layout past the bottom of a 640x360 phone (see `slot` above). Absent
   *  everywhere else, which is every bay of every run. */
  hint?: string;
}): string {
  const slot = opts.slot;
  return `<div class="bayclear" id="bayclear" data-action="skip-bayclear">
    <div class="bayclear__rays" aria-hidden="true"></div>
    <div class="bayclear__card">
      <div class="eyebrow">Bay ${opts.bayNum} · ${opts.bayName}</div>
      <h2 class="bayclear__title display">BAY CLEARED</h2>
      <div class="bayclear__stats">
        <div class="stat"><b style="color:var(--accent)">$${opts.funds}</b><span>banked / ${opts.target}</span></div>
        <!-- THE UNIT MARK on the bare count. Both cells beside it lead with
             one — a "$" on the banked figure, the scrap glyph on the payout —
             so this was the one figure on the card with nothing saying what it
             counts but a 10px word under it. Same "line" mark the chain row
             quotes a price per, which is the number this one is the total of.

             The 18 is a FALLBACK, not the drawn size: app.css sizes this mark
             at 0.62em of the figure beside it so it follows the compact tier's
             28px -> 20px step, and a CSS width beats the presentation attribute
             the helper writes. 18 is what 0.62em comes to at the roomy size, so
             the attribute and the rule agree about the common case. -->
        <div class="stat"><b class="stat__unit">${icon("line", 18)}${opts.lines}</b><span>lines</span></div>
        ${slot
          ? `<div class="stat stat--clause"><b style="color:var(--accent-2)">${slot.value}</b><span>${slot.label}</span></div>`
          : `<div class="stat"><b>${scrapHTML(opts.scrap, 22, true)}</b><span>scrap</span></div>`}
      </div>
      <!-- ONE NEUTRAL WORD, not a gesture (D7). This line read "tap to
           continue" on every device, including the ones with no touchscreen —
           the copy audit's own example of an instruction naming a control the
           player does not have. It is the one hint in the app that does NOT go
           through bindings.ts's verb table, and the reason is the dismissal
           itself: the whole card is the target (data-action="skip-bayclear"
           above), it times out on its own after BAY_CLEAR_MS, and every
           family's press lands the same way — so there is no control here to
           name. "Continue" is true of all three and shorter than any of them. -->
      <p class="muted bayclear__hint">${opts.hint ?? "Continue"}</p>
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
  // MOUNTED SYSTEMS ONLY (upgrades.ts's refitShelf). A yard raises what the
  // ship carries; a card for a track that is not aboard was a price this shop
  // cannot take, pointing at a different shop.
  const tracks = refitShelf(opts.tiers, opts.mark);
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
    // ONE CONTROL PER CARD, cycling — the draft's own idiom for the same
    // problem (its cards fill the hand while there is room and edit it once it
    // is full). Two controls is what the tap floor cannot afford: at 44px a
    // second button per row costs a card's worth of height across the shelf,
    // on the screen that already needs a scroller to hold all of them.
    //
    // So the button STAGES while the track has room and takes the track back
    // once it is ordered to MAX — and it stays live when the order has spent
    // the scrap but this track has rungs queued, because a disabled button on
    // a staged track is an order the player cannot undo.
    const canStage = cost !== null && left >= cost;
    const undo = queued > 0 && !canStage;
    // NO TIER-0 CARD. There used to be one — "Not aboard — buy or mount it in
    // the Workshop", covering both an unbought track and a stowed one — and the
    // shelf is filtered above so that neither reaches this map any more. The
    // sentence was true and it was still the wrong card: a refit stop that
    // spends three cards of its shelf naming a shop the player cannot reach
    // from here is a shop advertising somewhere else. Both fixes still exist,
    // they are just not the yard's to offer.
    const buy =
      undo
        // The one button on the shelf that keeps a word, and the price rule
        // below is what sanctions it: "Undo" names the STATE this control is
        // in, it does not describe what a rung does. The figure beside it is a
        // REFUND, and a bare "+90" on a shelf of prices reads as a cost.
        ? `<button class="btn btn--secondary refit-card__buy refit-card__undo" data-action="unstage-upgrade" data-upgrade="${u.id}"
            aria-label="${
              // Same rule as the stage button, one word different: this
              // figure is a refund, so the name says so where the button
              // only has room for a plus sign.
              priceAria(
                u.name,
                `Undo${queued > 1 ? ` ×${queued}` : ""},`,
                `refunds +${orderCost(opts.tiers, { [u.id]: queued })}`,
                "scrap",
              )
            }">
            <span class="refit-card__arrow">${icon("close", 10)}</span>
            <span class="refit-card__delta">Undo${queued > 1 ? ` ×${queued}` : ""}</span>
            <span class="refit-card__price">+${icon("scrap", 11)}${orderCost(opts.tiers, { [u.id]: queued })}</span>
          </button>`
        : cost === null
          ? `<span class="refit-card__max">MAX</span>`
          // THE PRICE, AND NOTHING ELSE. This button used to carry a
          // direction arrow and the rung's effect prose beside the price, and
          // the prose is unbounded copy on a bounded rail: the Demolition
          // Rack's capstone says "+2 charges, resupply, a wider blast and a
          // better rate", the Impact Cushion's "a deeper liner, and no launch
          // sets one off inside it". Ellipsised at every width the app ships
          // — so it taught nothing — and it still took the price track with
          // it, which is what collapsed the card's description column to one
          // word per line (app.css's .refit-card note has the widths).
          //
          // What the rung DOES is the projection's job, in the bay's own
          // numbers rather than in a phrase: staging is free and reversible,
          // so a tap is how you read the effect, and it reads it in the units
          // the purchase will actually be flown in. The button states the one
          // fact the panel beside it cannot — the tier it buys and what that
          // costs — in the Workshop's price grammar exactly ("T2 · <cur> 15",
          // one glyph apart).
          : `<button class="btn btn--primary refit-card__buy" data-action="stage-upgrade" data-upgrade="${u.id}"
              aria-label="${priceAria(u.name, "stage", `T${tier + 1} · ${cost}`, "scrap")}"${canStage ? "" : " disabled"}>
              <span class="refit-card__price">T${tier + 1}<span class="price__sep">·</span>${icon("scrap", 11)}${cost}</span>
            </button>`;
    // The track's OWN before/after — absolute on both sides, because a delta is
    // only legible next to the number it moves. It is now the ONE place a
    // single track's change is stated in that track's own units: the button
    // above prices the rung and the projection beside the shelf prices the
    // whole order in the bay's units, and neither answers "what does THIS one
    // do to THIS system". Unstaged, the card states what the ship carries today
    // and nothing more.
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

  // NO INLINE WIDTH, unlike its draft siblings: the yard is the one modal whose
  // width is DENSITY-DEPENDENT (app.css's `.modal--refit` pair — the roomy
  // shelf needs two 460px+ card tracks, which a 940px box cannot hold), and an
  // inline `style` beats every stylesheet rule including that one.
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--refit pop">
      <div class="refit__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Tier ${opts.mark} · refit stop · after bay ${opts.bayNum}</div>
          <h2 class="display refit__title">${icon("refit", 18)}Yard &amp; Dry Dock</h2>
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
          // THE PANEL EXPLAINS THE PURCHASE HERE, and only here: the belt's
          // material breakdown and the moved count — see previewGridHTML's
          // `explains`. This is the screen whose buttons stopped describing
          // themselves.
          true,
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
            // NAMES THE PANEL, now that the buttons no longer describe
            // themselves: a price says what a rung costs and the projection
            // says what it does, so the sentence that teaches the screen has to
            // join the two. Staging is free, which is what makes "tap it and
            // look" a fair instruction rather than a dare.
            : "Tap a system to stage a tier — the projection redraws with what it does. Nothing is paid for until you undock."
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
 * The Workshop — EVERY SYSTEM AS A PLATE, GROUPED BY STATE, and one detail
 * panel beside them (docs/workshop-redesign-plan.md, Option A3).
 *
 * WHAT THIS REPLACED, and why the shape changed rather than the copy. The shop
 * was one scrolling column of `.shop-card` rows: rack at the top, then a card
 * per system carrying `def.blurb` plus a boilerplate ownership sentence, then
 * the option cards, then two reference strips. Measured on the stocked save,
 * that pane showed 444px of 1191 at Steam Deck size and 226 of 880 on a 915x412
 * phone — i.e. the player read a fifth of the shop at a time, through a window
 * squeezed between a header and two buttons. The owner's report is exact: "its
 * height is not enough because of the stuff above and below it".
 *
 * THE SCROLLER WAS NOT THE BUG; THE CARD WAS. A card is ~120px and there are
 * twelve things to sell, so any list of cards is taller than any landscape
 * phone. A PLATE is 44px square — the tap floor, and the size this screen
 * already used for the rack — so the same twelve fit in four rows of a 372px
 * column with room to spare. What the card carried that the plate cannot is the
 * copy, and that copy moves to the DETAIL, where it is read one system at a
 * time instead of twelve at once.
 *
 * AND THE COPY GOT BETTER BY MOVING. The cards never said what a tier DOES —
 * `UpgradeDef.tiers` has carried the per-rung delta since the refit yard was
 * written, and this screen printed none of it, only `blurb` and a sentence of
 * boilerplate repeated on every card ("Installs at tier 1; the Workshop raises
 * it to 2…"). The owner asked for "the stats that an upgrade gets me"; the
 * ladder in the detail is those three strings, and the boilerplate is deleted
 * because the ladder shows the same fact as a shape.
 *
 * GROUPED BY STATE, WHICH IS THE OTHER HALF OF THE ASK. A2's named tiles were
 * "not clear what's mounted/stowed at a glance"; here a plate's ROW is its
 * state — rack, shed, shelf, options — so "what am I flying" is answered by
 * position before anything is read. That also carries the states the palette
 * may not: red/green is not a distinction this game draws (DESIGN.md), so every
 * state lands on a row, a badge shape or a word, never on a hue alone.
 *
 * ONE PRESS, ONE MEANING. A plate SELECTS; it no longer mounts. Mount/stow is a
 * button in the detail. The old plate did both jobs at once — it was the only
 * control for a system and it toggled the rack — which made the rack the only
 * row you could not browse without changing your loadout.
 *
 * BOTH PANELS, ONE HEIGHT, AND THE RACK IS THE ONLY SCROLLER (the owner's two
 * review constraints). The arithmetic for "no scrolling with any combination"
 * is at .workshop__rack in app.css: it holds at every roomy/regular size and on
 * 412-tall phones, and fails only on the 360-tall rows of the device matrix,
 * where three rows of 44px plates fit and four do not. The panel keeps
 * [data-scroll] for exactly those, and nothing else on the screen scrolls.
 */
/** The plates the panel draws, in the order it draws them: the rack row, then
 *  the shed, the shelf and the options. ONE function, because the default
 *  selection, the rendered rows and main.ts's fallback have to agree about what
 *  "the first plate" is — three copies of this order is how a screen ends up
 *  selecting something it did not draw. */
function workshopPlateOrder(meta: MetaState): string[] {
  if (!licenceDone(meta)) return [SCHOOL_INSTALL];
  return [
    ...mountedIds(meta),
    ...stowedIds(meta),
    ...installShelf().filter((i) => (meta.loadout[i.id] ?? 0) === 0).map((i) => i.id),
    ...workshopOptions(meta).map((u) => u.id),
  ];
}

/** The live options, owned first — the fourth row, and the same order in the
 *  row and in the plate order above. Retired unlocks are never merchandise and
 *  never reference (meta.ts's UnlockDef.retired), so they are absent. */
function workshopOptions(meta: MetaState): UnlockDef[] {
  const live = UNLOCKS.filter((u) => !u.retired);
  const owned = live.filter((u) => meta.unlocks.includes(u.id));
  const forSale = live.filter((u) => !meta.unlocks.includes(u.id))
    .sort((a, b) => a.rank - b.rank || a.cost - b.cost);
  return [...owned, ...forSale];
}

/**
 * THE RACK PANEL — every system as a 44px plate, grouped by the state it is in.
 *
 * Its own function rather than a closure inside workshopScreen, and that split
 * is worth the few re-derived lines it costs: this panel and the detail beside
 * it are the two halves of the screen the owner reviewed, they are edited
 * independently, and nothing they share is state — `mountedIds`, `slotsFor` and
 * `recommendedPurchase` are pure functions of the save, so asking each of them
 * twice cannot produce two answers. What the two halves must agree on is the
 * SELECTION, and they agree by both resolving it through workshopSelection.
 */
function workshopRack(
  meta: MetaState,
  /** The plate to draw as selected, ALREADY RESOLVED by workshopScreen. Passed
   *  rather than re-derived: resolving it here as well meant walking
   *  workshopPlateOrder and recommendedPurchase three times per render (once
   *  per half, once in the caller) for an answer that must be the same all
   *  three times anyway — and a screen that computes its selection twice is one
   *  edit away from computing it two different ways. */
  sel: string | null,
  /** meta.ts's recommendedPurchase, resolved once by workshopScreen for the
   *  same reason: the badge on a plate and the chip in the detail are one
   *  decision, so they read one value. */
  rec: Purchase | null,
  /** The live input family (D2) — a plate says what to DO to it, and what that
   *  is depends on the device (bindings.ts's hintPress). */
  profile: InputProfile,
): string {
  /* ---- THE SCHOOL'S PANEL -------------------------------------------------
   * ONE PLATE, and everything else is not merely disabled but ABSENT.
   *
   * The Workshop is the ground floor's second GATE (meta.ts's schoolLadder) and
   * the owner's call for it is exact: "hide all other purchases after the first
   * contract, just leave the reactor as the only one available to buy". The
   * argument is the one this file already makes for retired unlocks — a shelf
   * that lists what cannot be bought is a dishonest shelf — sharpened by the
   * wallet: the Contract gate pays exactly one milestone (15), which is exactly
   * the Reactor, so every other plate would be a price the player cannot meet,
   * on a screen whose whole job right now is one purchase.
   *
   * WHAT IS HIDDEN: every other install, both live unlocks, the rack and shed
   * rows and the +1 slot. The rack is the sharpest of those — it is a decision
   * about which systems fly, and the player owns none yet — and the header line
   * goes with it, because a slot count and a build budget are two numbers about
   * a rig that does not exist. The detail's mount button goes for the same
   * reason (workshopDetail's mountBtn).
   *
   * AND IT STAYS ONE PLATE FOR THE WHOLE SCHOOL, not just until the Reactor is
   * bought: the ladder is a sequence with ONE live step, and a panel that grew
   * back between lessons 5 and 6 would put a second decision beside the one the
   * ladder is asking for. After graduation the daily board can pay for the rest.
   * -------------------------------------------------------------------- */
  const school = !licenceDone(meta);
  // Marks BEATEN. `meta.mark` verbatim, and deliberately not markUnlocked() —
  // main.ts's onBuyUnlock enforces the gate against this same field, so any
  // derivation here would risk offering a plate the purchase path refuses.
  const mark = meta.mark;
  const nextId = rec && rec.kind !== "slot" ? rec.id : null;
  const slots = slotsFor(meta);
  const aboard = mountedIds(meta);
  const shed = stowedIds(meta);
  const nextSlot = slotPrice(slots);
  // The tooltip names the press in the DEVICE'S own word (D2) rather than
  // saying "tap" to a mouse: this string is a `title`, so a fine pointer
  // hovering it is very nearly the only way anyone reads it.
  const press = hintPress(profile);

  /* ---- THE PLATES ---------------------------------------------------------
   * 44 square, the existing .rack-slot, one per system, and every system is in
   * exactly one row. What the plate carries:
   *
   *   position  rack / shed / shelf / options — the state, read before anything
   *   pips      the tier, lit for what is owned (.ship-plate__pips)
   *   badge     lock (Mark-gated), play (recommended), stow (in the shed),
   *             check (an owned option) — a SHAPE in the corner, because the
   *             plate has no room for a word and hue is not a carrier here
   *   outline   .rack-slot--sel plus aria-pressed, for the one being read
   *
   * BADGE PRIORITY is lock, then play, then stow, and neither collision can
   * mislead. A gated system is never recommended (recommendedPurchase filters
   * on installAvailable), so lock and play cannot both apply. A STOWED system
   * can be recommended — an uprate of something in the shed — and there the
   * play badge wins, because the shed ROW it is sitting in is already saying
   * "stowed" louder than a 14px corner mark can.
   *
   * THE LOCK IS ABOUT MERCHANDISE, NOT ABOUT THE SHIP, and that is the fix this
   * note exists for (found in review). `gated` used to be "installAvailable is
   * false and installGates has a reason", which is TRUE of a system you already
   * own whose NEXT tier is over the Mark's build budget — so a Mark-1 rig
   * carrying 205 of its 220 points drew padlocks on the Bay Extension and the
   * Press Hydraulics it was flying, dimmed, under titles reading "Aboard"; in
   * the shed row the lock even displaced the stow badge. A lock on a plate has
   * to mean "you cannot have this", and a system aboard your ship is the one
   * thing that cannot mean. Owned systems are never dimmed and never locked
   * here; the budget that refuses their next rung is explained in words where
   * there is room for words — the detail's foot, via installGates.
   * -------------------------------------------------------------------- */
  const plate = (id: string, where: "rack" | "shed" | "shelf"): string => {
    const def = upgradeById(id)!;
    const inst = installById(id);
    const tier = Math.min(MAX_TIER, meta.loadout[id as keyof UpgradeTiers] ?? 0);
    const owned = tier > 0;
    const gated = !owned && inst !== undefined
      && !installAvailable(meta, inst) && installGates(meta, inst).length > 0;
    const pips = Array.from({ length: MAX_TIER }, (_, i) =>
      `<i class="${i < tier ? "on" : ""}"></i>`).join("");
    const badge = gated
      ? `<span class="rack-slot__badge">${icon("lock", 9)}</span>`
      : id === nextId
        ? `<span class="rack-slot__badge rack-slot__badge--next">${icon("play", 9)}</span>`
        : where === "shed"
          // 9px like the other three: the badge box is 13px with a 1px border,
          // so 10 was the one glyph touching its own frame.
          ? `<span class="rack-slot__badge rack-slot__badge--shed">${icon("stow", 9)}</span>`
          : "";
    // The LOOK follows the data for ownership and the ROW for stowage, which is
    // the one combination that survives the school: there the Reactor sits in
    // the shelf row after it is bought, and a plate drawn dim because of its row
    // would be telling the player they do not own the thing they just paid for.
    const state = where === "shed" ? "In the shed"
      : owned ? "Aboard"
        : gated ? `Locked — needs ${installGates(meta, inst!).join(" · ")}`
          : "On the shelf";
    return `<button class="rack-slot${
      where === "shed" ? " rack-slot--shed" : owned ? "" : " rack-slot--unowned"
    }${gated ? " rack-slot--gated" : ""}${id === sel ? " rack-slot--sel" : ""}"
      data-action="select-system" data-select="${id}"${id === sel ? ` data-pad-initial aria-pressed="true"` : ` aria-pressed="false"`}
      title="${def.name} — ${owned ? `tier ${tier}` : "not installed"}. ${state}; ${press} to select."
      aria-label="${def.name}, ${owned ? `tier ${tier}` : "not installed"}, ${state.toLowerCase()}">
      <span class="rack-slot__g">${icon(id as IconName, 15)}</span>
      <span class="ship-plate__pips">${pips}</span>${badge}
    </button>`;
  };

  // AN OPTION HAS NO TIERS, so its plate spends the pip row on the PRICE
  // instead — the one number that decides whether it is merchandise or
  // reference today. An owned option keeps the cyan plate and wears a check,
  // which is the same "you have this" the rack row says by position.
  const optPlate = (u: UnlockDef): string => {
    const owned = meta.unlocks.includes(u.id);
    const gated = !owned && !unlockAvailable(u, meta.unlocks, mark);
    return `<button class="rack-slot${owned ? "" : " rack-slot--unowned"}${
      gated ? " rack-slot--gated" : ""}${u.id === sel ? " rack-slot--sel" : ""}"
      data-action="select-system" data-select="${u.id}"${u.id === sel ? ` data-pad-initial aria-pressed="true"` : ` aria-pressed="false"`}
      title="${u.name} — permanent option. ${
        owned ? "Owned" : gated ? `Locked — needs ${unlockGates(u, meta.unlocks, mark).join(" · ")}` : `For sale at ${u.cost} salvage`
      }; ${press} to select."
      aria-label="${u.name}, permanent option, ${
        owned ? "owned" : gated ? `locked, needs ${unlockGates(u, meta.unlocks, mark).join(", ")}` : `for sale at ${u.cost} salvage`
      }">
      <span class="rack-slot__g">${icon(u.id as IconName, 15)}</span>${
        owned
          ? `<span class="rack-slot__badge rack-slot__badge--owned">${icon("check", 9)}</span>`
          : `<small class="rack-slot__price">${icon("salvage", 8)}${u.cost}</small>`
      }
    </button>`;
  };

  // An OPEN slot is room, drawn at the size of the thing that would fill it. A
  // span rather than a button: there is no system here to select, so a control
  // would be a target that does nothing.
  const openSlots = `<span class="rack-slot rack-slot--open" aria-hidden="true"></span>`
    .repeat(Math.max(0, slots - aboard.length));
  // THE +1 SLOT IS A PLATE NOW, not a header button, and that is what makes the
  // rack row honest: the thing you buy sits in the row it widens, at the size of
  // the plate it will hold, after the open slots it adds to. It is also where a
  // `slot` recommendation can finally be pointed at — the badge used to name no
  // control at all on this screen.
  const slotPlateHTML = nextSlot === null
    ? `<span class="rack__full">every slot bought</span>`
    : `<button class="rack-slot rack-slot--unowned rack-slot--plus${nextSlot !== null && meta.salvage < nextSlot ? " rack-slot--short" : ""}"
      data-action="buy-slot"${meta.salvage >= nextSlot ? "" : shortAttrs}
      title="One more rack slot — ${nextSlot} salvage; ${press} to buy."
      aria-label="${priceAria("Rack slot", "buy for", String(nextSlot), "salvage")}${
        meta.salvage >= nextSlot ? "" : " — not enough salvage"}">+1<small>${
        icon("salvage", 8)}${nextSlot}</small>${
        rec?.kind === "slot" ? `<span class="rack-slot__badge rack-slot__badge--next">${icon("play", 9)}</span>` : ""
      }</button>`;

  /** One group row: a fixed-width label and a wrapping row of plates. Rows are
   *  ruled off from each other by the dashed line the shed already used, which
   *  is the whole visual grammar this panel needs — four bands, one meaning
   *  each, no colour asked to carry any of it. */
  const group = (label: string, plates: string): string =>
    `<div class="rack__group"><span class="rack__group-label">${label}</span>
      <div class="rack__plates">${plates}</div></div>`;

  const shelfIds = installShelf().filter((i) => (meta.loadout[i.id] ?? 0) === 0).map((i) => i.id);
  const options = workshopOptions(meta);
  /* THE HEADER IS OUTSIDE THE SCROLLER, and the rows region is the scroller.
   * It read as one scrolling column until review: `.rack__hdr` was an ordinary
   * flex child of the pane, so on the 360-tall rows — the only devices where
   * this panel scrolls at all — the slot count and the build budget scrolled
   * away with the plates, which is exactly what the comment beside them claims
   * cannot happen and what the Workshop's own aside note has argued against
   * since the aside existed: the cap is the usual reason a purchase is refused,
   * so scrolling it away from the merchandise it explains is the one thing this
   * pane must not do. Splitting the scroller off is better than `position:
   * sticky` here because the allowlist can then name the region that actually
   * moves (`.rack__rows`), instead of naming a pane whose header only LOOKS
   * pinned. */
  const rackPanel = school
    // The school's one plate, in the one row it can be in. No header line: see
    // the school note above.
    ? `<section class="workshop__rack">
      <div class="rack__rows" data-scroll>${group("shelf", plate(SCHOOL_INSTALL, "shelf"))}</div>
    </section>`
    : `<section class="workshop__rack">
      <div class="rack__hdr">
        <span class="rack__label">systems</span>
        <span class="rack__count">${aboard.length}<span class="price__sep">/</span>${slots} slots<span class="price__sep">·</span>${
          // THE POINTS ABOARD, beside the budget's own readout and deliberately
          // a different number from it. The budget counts what is OWNED, which
          // is right — a tier you paid for is spent whether or not it undocks —
          // but at the top of the ladder a rig can own 550 points and fly 220 of
          // them, and a screen that only ever printed the first number would be
          // describing a rig nobody flies. This is the one the bay meets.
          tiersCost(maskLoadout(meta.loadout, aboard))
        } pts aboard</span>
        <!-- THE BUILD BUDGET, moved out of the deleted aside and into the one
             header that is always on screen. It is the usual reason a purchase
             is refused — a player staring at 400 salvage and a dead button needs
             to be told it is the Mark talking — and the detail beside this panel
             spells the same gate out in full when a system is actually barred
             (installGates).
             AND IT SAYS ITS OWN NAME, in the visible text. It shipped for one
             review as a bare "135/440" with the words in a title and an
             aria-label, on the mockup's authority; both of those are wrong for
             the job. A title attribute reaches a hovering mouse and nothing
             else, and
             an aria-label on a generic span is ignored by assistive tech — so
             the two numbers most likely to refuse a purchase were unlabelled
             for every reader on every device. The header line has the room at
             every width in the matrix (the count ends near the middle of the
             panel even on the narrowest phone); this costs it nothing. -->
        <span class="workshop__budget" title="Every tier you own costs points against the Mark's cap">build budget ${
          tiersCost(meta.loadout)}<span class="price__sep">/</span>${markBudget(meta)}</span>
      </div>
      <div class="rack__rows" data-scroll>
        ${group("rack", aboard.map((id) => plate(id, "rack")).join("") + openSlots + slotPlateHTML)}
        ${shed.length ? group("shed", shed.map((id) => plate(id, "shed")).join("")) : ""}
        ${shelfIds.length ? group("shelf", shelfIds.map((id) => plate(id, "shelf")).join("")) : ""}
        ${options.length ? group("options", options.map(optPlate).join("")) : ""}
      </div>
    </section>`;

  return rackPanel;
}

/**
 * THE DETAIL — the other half of the body, and the only place on this screen
 * that spends height on words. Paired with workshopRack above; see its header
 * for why the two are separate functions rather than one.
 */
function workshopDetail(
  meta: MetaState,
  /** Resolved by workshopScreen — see workshopRack's parameter note. */
  sel: string | null,
  rec: Purchase | null,
): string {
  const school = !licenceDone(meta);
  const mark = meta.mark;
  const nextId = rec && rec.kind !== "slot" ? rec.id : null;
  const slots = slotsFor(meta);
  const aboard = mountedIds(meta);

  /* ---- WHAT THE PANEL SHOWS -----------------------------------------------
   * THE LADDER IS THE POINT. `UpgradeDef.tiers` is three strings saying what
   * each rung gives ("+6% muzzle speed · 20% wind cancelled"), and until now
   * this shop rendered none of them — the refit yard did, which meant the
   * numbers a player needed to decide what to buy were only visible in the
   * shop that sells the OTHER currency. Three rows, marked: a check on what is
   * owned, a play on the rung the button below would buy, and the T3 row always
   * ending in "refit stop · scrap".
   *
   * THAT LAST ROW IS THE OWNER'S OTHER ASK — "it's only 2 purchasable upgrades
   * in the workshop, and the third one is run only, need to also clarify this".
   * The ladder answers it structurally (T3 is drawn, greyed, with the place it
   * is bought written on the end of its own row) and the footnote answers it in
   * a sentence. Both, because the row is what a player glancing at a system
   * sees and the sentence is what a player wondering about the shop reads.
   * -------------------------------------------------------------------- */
  const FOOTNOTE =
    "Tiers 1–2 are bought here with salvage. Tier 3 is fitted at a refit stop, for scrap.";

  const ladderRow = (def: UpgradeDef, i: number, owned: number, buyable: boolean): string => {
    const t = i + 1;
    const isOwned = t <= owned;
    const isNext = t === owned + 1 && t <= UPRATE_MAX_TIER && buyable;
    const isRun = t > UPRATE_MAX_TIER;
    const mark_ = isOwned ? icon("check", 12) : isNext ? icon("play", 10) : "";
    const end = isOwned
      ? `<span class="ladder__end ladder__end--owned">owned</span>`
      : isRun
        // THE WORDS CARRY IT, not the amber: "refit stop · scrap" is the whole
        // statement, and the colour is the scrap currency's own (--warn, the
        // same one .currency--scrap wears) so the tag matches the shop it names.
        ? `<span class="ladder__end ladder__end--run">refit stop<span class="price__sep">·</span>${icon("scrap", 9)}scrap</span>`
        : "";
    return `<div class="ladder__row${
      isOwned ? " ladder__row--owned" : isNext ? " ladder__row--next" : isRun ? " ladder__row--run" : ""
    }" title="Tier ${t} — ${def.tiers[i]}"><span class="ladder__mark">${mark_}</span><span class="ladder__t">T${t}</span><span class="ladder__stat">${
      def.tiers[i]}</span>${end}</div>`;
  };

  const systemDetail = (id: string): string => {
    const def = upgradeById(id)!;
    const inst = installById(id)!;
    const owned = Math.min(MAX_TIER, meta.loadout[id as keyof UpgradeTiers] ?? 0);
    const next = owned + 1;
    const cost = uprateCost(inst);
    const available = installAvailable(meta, inst);
    const gates = installGates(meta, inst);
    const onBoard = aboard.includes(id as UpgradeId);
    const rackFull = aboard.length >= slots;
    // Nothing in the detail is dimmed for a gated system: this is the one place
    // the gate is EXPLAINED, so the explanation has to be legible.
    const tag = owned === 0 ? ""
      : onBoard
        ? `<span class="shop-card__tag">aboard</span>`
        : `<span class="shop-card__tag shop-card__tag--shed">in the shed</span>`;
    // B6's price grammar, unchanged: "T2 · <salvage> 15" says which tier it buys
    // in the same words the refit yard uses, with the one difference that
    // matters — this purchase is salvage, that one scrap.
    const buy = owned >= UPRATE_MAX_TIER
      ? `<span class="shop-card__tag">Workshop max</span>`
      : available
        ? `<button class="btn btn--primary${meta.salvage >= cost ? "" : " is-short"}" data-action="buy-install" data-install="${id}"
            aria-label="${priceAria(def.name, owned === 0 ? "install" : "uprate to", `T${next} · ${cost}`, "salvage")}${
              meta.salvage >= cost ? "" : " — not enough salvage"}"${
              meta.salvage >= cost ? "" : shortAttrs}>T${next}<span class="price__sep">·</span>${icon("salvage", 11)}${cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
    // MOUNT IS A BUTTON NOW, and it is the only control that used to be the
    // plate. A full rack REFUSES a mount (meta.ts's toggleMount will not evict
    // anything the player did not choose), so the button goes dark with the
    // remedy in its title rather than tapping to nothing.
    // NO MOUNT CONTROL MID-SCHOOL, and it is the same call the rack row is
    // absent under: which systems fly is a decision about a rig the player is
    // still one purchase away from having, and the school's flights are flown
    // with the Reactor the ladder just sold them (school.ts's levelForLesson
    // applies the loadout). A Stow button here would let a player at step 6
    // take the system back out of the ship the next lesson is built around.
    const mountBtn = owned === 0 || school ? ""
      : `<button class="btn btn--secondary" data-action="mount" data-mount="${id}"${
          !onBoard && rackFull ? " disabled" : ""}
          title="${onBoard
            ? `Stow ${def.name} — it keeps every tier you paid for, it just doesn't undock.`
            : rackFull
              ? `The rack is full — stow a system first, or buy a slot.`
              : `Mount ${def.name} so the next run undocks with it.`}">${onBoard ? "Stow" : "Mount"}</button>`;
    return `<div class="shop-card workshop__detail">
      <div class="workshop__detail-hdr">
        <div class="shop-card__name">${icon(id as IconName, 13)}${def.name}${
          id === nextId ? nextBadgeHTML() : ""}</div>
        ${tag}
      </div>
      <p class="shop-card__desc workshop__detail-blurb">${def.blurb}</p>
      <div class="ladder">${
        [0, 1, 2].map((i) => ladderRow(def, i, owned, available)).join("")}</div>
      <p class="workshop__note">${FOOTNOTE}</p>${
        // HONEST COPY FOR A SYSTEM THAT CANNOT MOUNT YET, restored (found in
        // review). A full rack does not refuse the sale — meta.ts's buyInstall
        // takes the salvage and the system lands in the shed — so nothing here
        // is disabled and, without this line, nothing on the screen would tell
        // the player their new system is not going to undock with them. It was
        // one clause of the per-card boilerplate the ladder replaced, and it is
        // the one clause the ladder does NOT say: the rungs are about the
        // system, this is about the ship. A second note rather than a longer
        // footnote, because it is true of one purchase and not of the shop.
        owned === 0 && rackFull
          ? `<p class="workshop__note workshop__note--warn">The rack is full — this one waits in the shed until you free a slot or buy one.</p>`
          : ""
      }
      <div class="workshop__detail-foot">${mountBtn}${buy}</div>
    </div>`;
  };

  const optionDetail = (u: UnlockDef): string => {
    const owned = meta.unlocks.includes(u.id);
    const available = unlockAvailable(u, meta.unlocks, mark);
    const gates = unlockGates(u, meta.unlocks, mark);
    // An option is not a rung on a track, so its price is just the salvage
    // glyph and the number — and "Permanent" is the tag, because the Workshop
    // and the mid-run Refit both sell upgrades and nothing else on screen says
    // which purchases outlive the run (playtest feedback).
    const buy = owned
      ? `<span class="shop-card__tag">✓ Owned</span>`
      : available
        ? `<button class="btn btn--primary${meta.salvage >= u.cost ? "" : " is-short"}" data-action="buy-unlock" data-unlock="${u.id}"
            aria-label="${priceAria(u.name, "unlock for", String(u.cost), "salvage")}${
              meta.salvage >= u.cost ? "" : " — not enough salvage"}"${
              meta.salvage >= u.cost ? "" : shortAttrs}>${icon("salvage", 11)}${u.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
    return `<div class="shop-card workshop__detail">
      <div class="workshop__detail-hdr">
        <div class="shop-card__name">${icon(u.id as IconName, 13)}${u.name}</div>
        <span class="shop-card__tag">Permanent</span>
      </div>
      <p class="shop-card__desc workshop__detail-blurb">${u.desc}</p>
      <p class="workshop__note">An option is bought once and changes what a run may attempt. It has no tiers.</p>
      <div class="workshop__detail-foot">${buy}</div>
    </div>`;
  };

  const selUnlock = sel === null ? undefined : UNLOCKS.find((u) => u.id === sel);
  const detail = sel === null ? "" : selUnlock ? optionDetail(selUnlock) : systemDetail(sel);

  return detail;
}

/**
 * WHAT THE SCREEN OPENS ON — the recommendation if there is one, else the first
 * plate in the panel.
 *
 * Exported because main.ts holds the selection across re-renders (a purchase
 * must not move it) and therefore has to resolve the default ONCE, on the way
 * in. Same function both sides, so the screen can never open on a plate the
 * state layer does not think is selected.
 *
 * A `slot` recommendation resolves to no system, and that is correct rather
 * than a gap: the answer is the +1 plate, which wears the badge itself. The
 * fallback then takes the first plate, which is the rack's first system — the
 * thing the player is most likely to be here about.
 */
export function workshopDefaultSelection(meta: MetaState): string | null {
  const order = workshopPlateOrder(meta);
  const rec = recommendedPurchase(meta);
  if (rec && rec.kind !== "slot" && rec.id && order.includes(rec.id)) return rec.id;
  return order[0] ?? null;
}

/** Does this save's Workshop actually draw a plate for `id`?
 *
 *  Exported for main.ts's onSelectSystem, which must refuse an id the panel
 *  does not draw rather than store it: the screen would fall back on its own,
 *  but then `workshopSelected` and the rendered `aria-pressed` plate would be
 *  two different systems — the drift the shared resolver below exists to
 *  prevent, re-introduced one layer up. (Found in review: the handler's comment
 *  claimed this check and the code did not make it.) */
export function workshopHasPlate(meta: MetaState, id: string): boolean {
  return workshopPlateOrder(meta).includes(id);
}

/** The plate the panel and the detail must agree on: the caller's, when the
 *  panel still draws it, and the default otherwise. One function, because
 *  fixtures, pins and main.ts all address the screen by id and a stale one must
 *  resolve the same way for every caller. */
function workshopSelection(meta: MetaState, selected: string | null): string | null {
  return selected !== null && workshopHasPlate(meta, selected)
    ? selected
    : workshopDefaultSelection(meta);
}

export function workshopScreen(
  meta: MetaState,
  /** The live input family (D2) — a plate says what to DO to it, and what that
   *  is depends on the device (bindings.ts's hintPress). Defaults to touch,
   *  which is what every caller said before the verb was a table. */
  profile: InputProfile = "touch",
  /** The plate whose ladder the detail is drawing (main.ts's
   *  workshopSelected). Null — and anything no longer on the panel — falls back
   *  to workshopDefaultSelection, so a fixture or a pin can address any system
   *  directly and a stale id cannot render an empty detail. */
  selected: string | null = null,
): string {
  // Mid-school this screen is one plate and a blurb; the argument for that, and
  // the list of what it hides, is at workshopRack's own `school` branch.
  const school = !licenceDone(meta);
  // THE WORKSHOP'S RUNG IS DONE AND THE LADDER HAS MOVED ON. The one state in
  // which this screen is a step the player has just COMPLETED rather than a
  // shop they are browsing — and the state that had no way out of it. See the
  // primary at the foot of this file.
  const schoolGo = school && rigStarted(meta);

  // ONE RESOLUTION PER RENDER, for both halves. The selection and the
  // recommendation are each a pure function of the save, so re-deriving them in
  // the two panels could not disagree today — but it is two more places to edit
  // and three walks of the plate order per render, and the whole reason the
  // panel and the detail are separate functions is that they are edited apart.
  const sel = workshopSelection(meta, selected);
  const rec = recommendedPurchase(meta);

  const rackPanel = workshopRack(meta, sel, rec, profile);
  const detail = workshopDetail(meta, sel, rec);

  return `<div class="screen neon-backdrop">
    <div class="workshop">
      <div class="workshop__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Between runs</div>
          <h2 class="display" style="font-size:var(--fs-h1)">Workshop</h2>
          <p class="muted workshop__blurb" style="margin:0">${
            // THREE STATES, and the school owns two of them. The standing blurb
            // explains the FAUCET, which is the sentence a player wants once
            // they have a shelf to compare; the player on this gate has one
            // plate and no idea what buying it does, and the player who has just
            // bought it needs to know the ladder moved. Named off the ladder
            // itself, the same predicate the panel above is filtered by, so the
            // promise here and the merchandise cannot drift.
            school
              ? rigStarted(meta)
                ? `${upgradeById(SCHOOL_INSTALL)!.name} is installed and lessons ${LICENCE_LESSON_COUNT + 1} to ${LESSON_COUNT} are open — carry on below. A system is permanent: bought once, flown in every bay after.`
                : `One system, and it is the last thing between you and lessons ${LICENCE_LESSON_COUNT + 1} to ${LESSON_COUNT}. A system is permanent — bought once, flown in every run after — so nothing here is spent twice.`
              : rigStarted(meta)
                ? "Tier milestones pay salvage — each first-clear Contract and run win banks a share. Spend it on options you didn't have before."
                : "Install your first system. Every system is permanent: bought once, flown in every run after."
          }</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="chip chip--inline">
            <div class="chip__label">Salvage</div>
            <div class="chip__value">${salvageHTML(meta.salvage, 16)}</div>
          </div>
          <button class="icon-btn" data-action="tiers" aria-label="Back">${icon("close", 18)}</button>
        </div>
      </div>
      <div class="workshop__meta muted">${
        // A11: the meta line carries tier progress, in the same grammar the menu
        // chip and the end modals use — EXCEPT during school, where every term
        // of it is a claim about a tier the player cannot fly yet.
        school
          ? `Flight School · step ${schoolProgress(meta)} of ${SCHOOL_STEPS}`
          : `${meta.runs} run${meta.runs === 1 ? "" : "s"} logged · deepest bay ${meta.bestBay || "—"} · ${
            (() => {
              const p = tierProgressFor(meta);
              return `Tier ${p.tier} — Run ${p.runDone ? "✓" : "○"} · Contracts ${p.contracts}/${p.needed}${p.contracts >= p.needed ? " ✓" : ""}`;
            })()
          }`
      }</div>
      <div class="workshop__body">
        ${rackPanel}
        ${detail}
      </div>
      ${
        // THE FOOT IS GONE, and the one door that survives is the school's.
        // It held Contracts and Start Run: the first opened the standalone
        // Contract board this branch retired (a tier's Contracts are on the
        // hub, and the shortfall card below offers them where the want is
        // created), the second duplicated the hub's own run card one tap away
        // through the ✕. Both cost a 44px row on a phone whose shelf was
        // already scrolling for it (owner). The school's rung is the one state
        // where this screen is a step just COMPLETED rather than a shop, and
        // a completed rung has to say what comes next: same door as the
        // lobby's — the play action flies the parked floor, which mid-school
        // main.ts resolves to the next flight the ladder owes.
        schoolGo
          ? `<div class="row workshop__go">
        <button class="btn btn--primary btn--lg btn--next" data-action="play">${icon("play")}Continue Flight School →</button>
      </div>`
          : ""
      }
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
/**
 * THE BAY-RETRY BUTTON'S FACE — one rule, every door.
 *
 * Three surfaces can start a bay retry (main.ts's requestBayRetry): the
 * game-over card's Retry Bay, the pause modal's Restart Bay, and the held ⏸.
 * The first got this treatment when it shipped and the second did not, so the
 * pause modal spent a release asking for the same irreversible thing with a
 * bare label — the cost visible from one door and invisible from another,
 * which is worse than invisible from both because it teaches the player that
 * the plain button is the safe one. (Owner playtest, screenshot.)
 *
 * So the face is written ONCE and both buttons call it. Not a second copy
 * tuned to the pause modal: two copies is how the end card ends up saying
 * "breaks this run's seal" while the pause modal says something almost like
 * it, and a player who reads both learns to trust neither.
 *
 * WHAT EACH STATE DRAWS is argued in full at the .btn__seal rules in app.css
 * and at run.ts's sealStateFor; the short version is that the shape says
 * whether a stamp exists and the wash says whether it is in danger.
 */
export function sealFaceHTML(seal: SealState): string {
  return `<span class="btn__seal${
    seal === "at-stake" ? "" : seal === "held" ? " btn__seal--held" : " btn__seal--broken"
  }" aria-hidden="true"></span>`;
}

/** …and the same rule's words, for the accessible name of whichever control is
 *  wearing the glyph. Separate from the markup above because the two buttons
 *  put it in different places (one appends to a label naming a bay, the other
 *  labels the whole control), and because the ⏸ hold takes the words WITHOUT
 *  the glyph — see hudHTML.
 *
 *  EVERY STATE IS A STANDALONE CLAUSE, and that is a rule rather than a
 *  coincidence of phrasing. The three lines are glued onto three different
 *  prefixes, so the only composition that can work at all three doors is one
 *  that treats the label as a sentence in its own right — join with a dash and
 *  read it.
 *
 *  It shipped otherwise for one release. "breaks this run's seal" is a bare
 *  predicate, which reads fine after a button name that supplies the subject
 *  ("Retry Bay 7 — breaks this run's seal") and ALSO reads fine after a
 *  relative pronoun — so the rail glued its own name on with ", which " and
 *  looked correct in the one state anybody checked. The other two are full
 *  clauses, and "hold to restart the bay, which this run's seal is already
 *  broken" is what that assumption actually produces. (Codex review, PR #144.)
 *
 *  So at-stake carries its subject too. "retrying" is very slightly redundant
 *  after a button called Retry Bay, and that is the cheaper of the two costs:
 *  a label that only parses next to certain prefixes is a label that will be
 *  mis-glued again by the next door somebody adds.
 *
 *  `mark` is only ever spoken in the "held" line, which is a statement about
 *  THAT FLOOR's stamp rather than about this run — the distinction sealStateFor
 *  exists to keep straight. */
export function sealFaceLabel(seal: SealState, mark: number): string {
  return seal === "at-stake"
    ? "retrying breaks this run's seal"
    : seal === "held"
      ? `Tier ${mark} is already sealed, so this costs nothing`
      : "this run's seal is already broken";
}

/** The one way a door may glue the price onto its own name: a dash, and the
 *  clause. Stated as a function so "the composition rule" is a thing the sim
 *  can check rather than three string literals that agree today. */
export function sealNameWith(name: string, seal: SealState, mark: number): string {
  return `${name} — ${sealFaceLabel(seal, mark)}`;
}

/* ---------------------------------------------------------------------------
 * QUITTING A LIVE RUN — the pause card's one irreversible door.
 *
 * Every other exit from a run settles it first: bay 10 wins it, a loss files
 * it, and both land on the run-end card with the score already banked. Quit
 * does none of that (main.ts's finishRun is never reached), so the run's score,
 * its bay record and its place in the lifetime count all go — and until now it
 * went on ONE tap of a ghost button sitting beside Resume.
 *
 * THE IDIOM IS ARM-THEN-CONFIRM, NOT A SECOND MODAL. Quit is already ON a
 * modal; stacking a panel over the pause card would be a dialog in front of a
 * dialog, and the seal notice — the app's other confirmation — earned its own
 * panel precisely because it interrupts a press made from the FIELD. Here the
 * player is already stopped and reading a card, so the cheaper affordance is
 * the honest one: the first press makes the button say what it does, the
 * second press does it.
 *
 * WHAT THE ARMED STATE CHANGES IS THE WORDS, not just a colour: the face
 * relabels, the accessible name gains the consequence, and a line under the row
 * names what is lost. A ring that only reddened would be unreadable to the
 * quarter of players who cannot separate #ff2d55 from #7b8290, and invisible to
 * anyone on a screen reader.
 *
 * BOTH FACES SHIP IN THE MARKUP and app.css stacks them in one grid cell, so
 * the button is as wide armed as idle — the same "a card does not change shape
 * when it is tapped" rule the draft's pick box follows. A four-button row that
 * reflowed under the player's thumb would move Restart Bay onto the press that
 * was aimed at Quit.
 * ------------------------------------------------------------------------ */

/** The armed face's words, and the idle face's. Two doors draw them —
 *  pauseModal renders the card, and main.ts patches the MOUNTED card in place
 *  when the first press arms it (a re-render would replay `.pop` and drop the
 *  focus a pad is holding on the button being armed) — so they are written once
 *  here, the same split and the same reason as sealFaceHTML/sealFaceLabel.
 *
 *  The idle name says a confirmation is coming, because a screen-reader player
 *  who presses Quit and hears nothing has been told the button is broken. The
 *  armed name says the price, as a standalone clause after the dash — the
 *  composition rule sealNameWith exists to hold. */
export function quitArmLabel(armed: boolean, bayNum: number): string {
  return armed
    ? `Quit anyway — bay ${bayNum} ends here and this run files nothing`
    : "Quit — ends this run, and asks once more first";
}

/** The line the armed card puts under the button row.
 *
 *  It names the loss in the two currencies the player can check for themselves
 *  afterwards: the bays behind them, and the record a finished run leaves. The
 *  second sentence is the half worth printing — the same shape the seal notice
 *  uses, where the first sentence says what goes and the second says what does
 *  not. A quit and a loss are NOT the same outcome, and a player who thinks
 *  they are will quit runs they should have flown into the ground.
 *
 *  `role="alert"` rather than a live region that is always mounted: the node is
 *  inserted at the moment of arming, which is the announcement pattern that
 *  works without depending on a hidden region having been registered first. */
export function quitArmNoteHTML(bayNum: number): string {
  return `<p class="pause__quit-note" role="alert">Quitting drops bay ${bayNum} and everything`
    + ` behind it — carry, scrap and every notch this run took. Nothing files: play it out and`
    + ` even a loss banks the score and the bay record.</p>`;
}

export function pauseModal(
  fullscreen = true,
  profile: InputProfile = "keyboard",
  owned: { bond: boolean; demo: boolean; thaw: boolean; auto: boolean }
    = { bond: false, demo: false, thaw: false, auto: false },
  /** The run's seal state and the Mark it is flying (run.ts's sealStateFor) —
   *  the SAME read requestBayRetry gates its confirmation on, so this button's
   *  face and the panel that press opens can never disagree.
   *
   *  Absent means "no seal question here", which is the honest answer for Tier
   *  S, the Skydeck, a Contract, a drill, and for every caller that predates
   *  this argument. Restart Bay then renders exactly as it always did. */
  seal?: { state: SealState; mark: number },
  /** The quit gate (run.ts's quitLosesProgress), and where it currently sits.
   *
   *  Absent means "this exit costs nothing", which is the honest answer for
   *  bay 1, for Tier S, for a Contract, for a drill, and for every caller that
   *  predates this argument — Quit then renders as the plain one-press ghost
   *  button it always was, wired straight to the menu. Present means the run
   *  has bays behind it, and the button takes two presses. */
  quit?: { armed: boolean; bayNum: number },
  /** Whether this run may hand a bay back at all (run.ts's bayRetryable).
   *
   *  False ONLY on the Skydeck, whose bays are the day's single seeded attempt.
   *  The button is REMOVED rather than disabled, which is the idiom the run-end
   *  card already set for this exact refusal (main.ts's `retryBay` is
   *  `undefined` there, not a dead control) and the one the rest of this file
   *  follows for a mode that lacks a thing: Tier S drops the tier row, a drill
   *  drops the ship rack, a Contract drops the launch-cost line. A greyed
   *  Restart Bay with a tooltip would be four buttons of chrome explaining a
   *  feature the mode does not have, on the one card a player opens to leave.
   *
   *  Defaults true so every caller that predates the argument — and every
   *  ladder run, Contract, drill and bench run — is unmoved. */
  restart = true,
  /** Whether the retry this card offers is the whole RUN rather than the bay
   *  (run.ts's retryIsWholeRun) — true only on the first bay of a ladder run.
   *
   *  Defaults false, so every caller that predates the argument draws the
   *  Restart Bay it always did. */
  runRetry = false,
  /** settings.wheelRotates — see hintParts. Threaded rather than read from a
   *  module-level settings handle because this file renders from arguments
   *  only; main.ts owns the settings and passes them at both doors. */
  wheelRotates = false,
): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal pop">
      <div class="eyebrow">Paused</div>
      <h2 class="display">Take a breath</h2>
      <div class="row">
        <button class="btn btn--primary" data-action="resume">Resume</button>
        ${fullscreen ? `<button class="btn btn--secondary" data-action="fullscreen" id="fullscreen-btn-modal">${icon("fullscreen", 14)} <span class="fs-label">Fullscreen</span></button>` : ""}
        <!-- RESTART BAY WEARS THE SAME FACE THE LOSS CARD'S RETRY DOES. It is
             the same action through a different door, and until now it was the
             only door that charged the seal without showing it (owner playtest
             screenshot). The glyph comes from sealFaceHTML so there is one rule
             rather than two that drift; the label carries the words, because
             the glyph is aria-hidden and a cost only half the audience can read
             is a cost half the audience is not told about. -->
        <!-- …EXCEPT ON BAY 1, WHERE THE BAY AND THE RUN ARE THE SAME THING
             and only one of them was free (owner playtest: "on the first bay
             there's no point in retrying by breaking the seal"). The argument
             is run.ts's retryIsWholeRun; the short version is that a bay-1
             restart charges the run's seal to hand back a bay with nothing
             behind it, while Quit → Start Run hands back the same offer with
             the seal intact. So the card offers the free door instead, wearing
             the loss card's name for it — one wording for one action, the same
             rule sealFaceHTML follows for the priced one.

             NO GLYPH AND NO PRICE IN THE NAME, because nothing is charged: the
             action is "restart", which main.ts routes to a brand-new run
             without ever reaching requestBayRetry's confirmation. A seal face
             on a free press is the thing that teaches players to stop reading
             seal faces.

             THE HOLD KEEPS ITS OWN MEANING and the reference block below keeps
             teaching it. It is not the workaround for a control removed here —
             it hands back THIS seed, which no button on this card does — and
             it quotes its own price at the moment of the press. -->
        ${
          restart
            ? runRetry
              ? `<button class="btn btn--secondary" data-action="restart">Retry Run</button>`
              : `<button class="btn btn--secondary" data-action="restart-bay"${
                seal ? ` aria-label="${sealNameWith("Restart Bay", seal.state, seal.mark)}"` : ""
              }>${seal ? sealFaceHTML(seal.state) : ""}Restart Bay</button>`
            : ""
        }
        ${
          // A GATED QUIT DOES NOT CARRY THE MENU ACTION AT ALL — it is
          // `quit-run`, which main.ts routes through the arming check before it
          // ever reaches the menu. Not a flag on `menu`: eight other buttons in
          // this file are that action, and a gate that has to ask which screen
          // it is on is a gate one new back button quietly walks around. The
          // ungated card keeps the old wiring exactly, so a Contract's pause
          // still leaves on one press.
          quit
            ? `<button class="btn btn--ghost btn--quit" data-action="quit-run"
          data-armed="${quit.armed}" aria-label="${quitArmLabel(quit.armed, quit.bayNum)}"
        ><span class="btn__quit-face">Quit</span><span class="btn__quit-face btn__quit-face--armed">Quit anyway</span></button>`
            : `<button class="btn btn--ghost" data-action="menu">Quit</button>`
        }
      </div>
      ${quit?.armed ? quitArmNoteHTML(quit.bayNum) : ""}
      ${pauseKeysHTML(profile, owned, restart, wheelRotates)}
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
 *
 * `explains` — this panel is the screen's ONLY account of what the player is
 * about to buy, which is true of the yard and of nothing else. It turns on the
 * belt tile's per-material breakdown here and the moved count on the header
 * below.
 *
 * The split is a real one and not a fit budget in disguise. A draft and a Final
 * Inspection both put the change in words on the card the player is holding —
 * the material's own name and glyph included — so on those screens a breakdown
 * and a tally restate what has already been said. The yard's cards say what a
 * system IS and its buttons say what a rung COSTS; nothing on it says what the
 * belt is made of, and that is exactly what decides between a Demolition Rack
 * and a Thaw Lance.
 *
 * Neither is free, which is why the screen that does not need them does not pay
 * for them: the list costs the belt tile a line (34px on the 1269x663 draft,
 * whose body fits with nothing to spare) and the count wraps this header onto a
 * second line (8px, everywhere the title is already at its width).
 */
function previewGridHTML(rows: PreviewRow[], explains: boolean): string {
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
      // A row that is a SUM carries its own breakdown (preview.ts's
      // PreviewPart), as a wrapping list INSIDE its own tile. Deliberately not
      // a spanning tile: `grid-column: 1 / -1` cannot share a grid row with
      // anything, so it costs a whole row wherever it lands — measured at +78px
      // on the 800x600 draft, five times what the list itself is. Wrapped
      // inside the tile it costs only the lines it needs, on the row the belt
      // tile already sat in.
      const parts = explains && r.parts?.length ? previewMixHTML(r.parts) : "";
      return `<div class="preview-stat${r.active ? " preview-stat--active" : ""}${cls}${parts ? " preview-stat--mix" : ""}">
        <div class="preview-stat__label">${label}</div>
        <div class="preview-stat__val">${val}</div>
        ${parts}
      </div>`;
    })
    .join("");
}

/**
 * THE BELT'S COMPOSITION, as one dense line per material inside the belt tile.
 *
 * GLYPH, NOT NAME. The mark is the material's own belt icon (components.ts's
 * materialIconHTML, which carries the name as its aria-label), on the
 * one-vocabulary rule that governs every other surface that names a material:
 * the mark a player learns watching the belt is the mark they read here. Six
 * names spelled out would be two more wrapped lines on the panel that overflows
 * first, and would say nothing the glyph does not.
 *
 * A notch tally rides beside the glyph in the plant panel's grammar ("×2" —
 * components.ts's runNotchTallyHTML) whenever the caller supplied the run's
 * banked ratchets. The refit yard deliberately does not (main.ts's refitHTML),
 * so the yard's list is shares and the draft's is shares with the bill beside
 * them.
 */
function previewMixHTML(parts: PreviewPart[]): string {
  return `<ul class="preview-mix">${parts.map((p) => {
    const pct = p.changed
      ? `<span class="preview-stat__from">${p.from}</span><span class="preview-stat__arrow">→</span><span class="preview-stat__to">${p.to}</span>`
      : `<span class="preview-stat__to">${p.from}</span>`;
    return `<li class="preview-mix__m${p.changed ? ` preview-mix__m--${p.tone}` : ""}">
      ${materialIconHTML(p.id, 13)}${p.notches > 0 ? `<span class="preview-mix__notch">×${p.notches}</span>` : ""}
      <span class="preview-mix__pct">${pct}</span>
    </li>`;
  }).join("")}</ul>`;
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
  /** This panel is the screen's only account of the change — see
   *  previewGridHTML's `explains`. The yard passes it; nothing else does. */
  explains = false,
): string {
  // HOW MANY NUMBERS MOVED, on the header the panel already has.
  //
  // The tiles have always coloured the change (app.css's .preview-stat--worse /
  // --better), but a moved tile is only a highlight once you have found it, and
  // this grid runs to seventeen rows on a fully staged order. Now that the
  // yard's buttons carry a price rather than a description, this panel IS the
  // answer to "what does that buy" — so it says up front that it has one, and
  // how much of it. Absent when nothing moved: a permanent "0 moved" would be
  // chrome, and the idle hint below is what an untouched panel says instead.
  const moved = explains ? rows.filter((r) => r.changed).length : 0;
  return `<div class="projection" id="${id}" aria-live="polite">
    <div class="projection__hd">
      <span>${title}</span>
      <span class="projection__note">${
        // INSIDE the note rather than beside it. This header is a flex row in
        // which only the note carries `min-width: 0`, so a third item makes the
        // TITLE the one that has to give — and the title has no floor, so it
        // wraps. Riding in the note the count shares the note's own budget and
        // is the last thing an ellipsis reaches, which is the right order: the
        // count is the fact and the note is the caption.
        moved ? `<b class="projection__moved">${moved} moved</b> · ` : ""
      }${note}</span>
    </div>
    <div class="preview-grid">${previewGridHTML(rows, explains)}</div>
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
  /** The Mark the run is actually flying, which `tier` above is NOT: on the
   *  Skydeck that field carries the roof's sentinel so the eyebrow can name the
   *  floor. The cards price themselves off this — the cost and time axes enter
   *  their ladder at ladderStart(mark) (hazards.ts) — so a card quoted off the
   *  sentinel would name a price no bay charges. */
  mark: number;
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
  /** The Skydeck's standing-clause tally (game/skydeck.ts), which now rides the
   *  NOTCHES cell instead of taking the scrap one.
   *
   *  It took the scrap cell while the roof had no yard: the number there could
   *  only ever be 0, so the slot was free and the tally was the honest thing to
   *  put in it. The yard is back (run.ts's refitAfterBay) and scrap is a live
   *  decision again — how much is banked, and how many clears until it can be
   *  spent — so the cell it borrowed has an owner again.
   *
   *  It joins the notch tally rather than adding a fourth cell, because the two
   *  are the same fact: the bank row's three cells are MONEY carried, PRESSURE
   *  carried, CAPITAL banked, and a standing clause is pressure carried for the
   *  rest of the run in exactly the way a notch is. One is authored and one is
   *  dealt, which is why they are two numbers in one cell rather than a sum. A
   *  fourth cell was the alternative and it does not fit: the row is three
   *  columns wide on the 640x360 phone (sim/uifit), the same budget the
   *  bay-clear card's fourth row already failed.
   *
   *  Absent on every ladder run, where the cell is the plain notch count it has
   *  always been. */
  standing?: { active: number; total: number; nextBay: number | null };
  /** True on a forced-material hand (hazards.ts's isMaterialDraft): the
   *  partner card there is capped at one seat (togglePick), so its footer must
   *  say "undo" where an ordinary card's says "double". */
  forced?: boolean;
  /** The live input family (D2), for the card footers' verb. Optional and
   *  touch by default, which is what this screen said in every state before
   *  the verb came off bindings.ts — so a caller that has no profile to hand
   *  (a fixture, a pin) renders exactly the card it always did. */
  profile?: InputProfile;
}): string {
  const banked = totalNotches(opts.ratchets);
  const pending = opts.selected.length;
  const remaining = Math.max(0, opts.picksNeeded - pending);
  const ready = remaining === 0;
  const nextBay = opts.bayNum + 1;
  // THE FOOTER'S VERB, once for the whole hand (D7, bindings.ts's hintPress).
  // Capitalised here the way the coach capitalises hintAim, because on this
  // card the verb starts the line.
  const press = hintPress(opts.profile ?? "touch");
  const Press = `${press[0].toUpperCase()}${press.slice(1)}`;
  const cards = opts.offers
    .map((h) => {
      const picks = opts.selected.filter((p) => p === h.id).length;
      // An axis already ratcheted says so on the card. Taking the same notch a
      // second time is a legitimate build, but it is a different decision from
      // taking it the first time, and the card has to admit which one it is.
      // The tentative picks count toward the badge too — the card has to show
      // the notch level the projection below it is currently drawing.
      const owned = (opts.ratchets[h.id] ?? 0) + picks;
      // The level is an icon and a number (the same up-triangle the bank's
      // Notches cell wears), not an "at N" word badge. It rides the card's
      // FOOTER, not its title row — see the __foot note below.
      const stack = owned > 0
        ? `<span class="mod-card__lvl" aria-label="notched at ${owned}">${icon("up", 9)}${owned}</span>`
        : "";
      const kind = h.kind === "content" ? "bane" : "tradeoff";
      // The kind is said by the card's GLYPH and colour, not by a word: a
      // material card wears the material's own belt icon and bane red, a
      // number card its axis's icon and tradeoff cyan (components.ts's
      // axisIconHTML — every axis a hand can deal has a real mark now, and
      // the two-letter tally code is strictly that helper's fallback).
      const badge = axisIconHTML(h, 15);
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
        ? canDouble ? `${Press} again for 2x` : `${Press} to undo`
        : ready
          ? `${Press} to swap this in`
          : `${Press} to preview`;
      // The level badge and the pick box ride the FOOTER, right-aligned beside
      // the verb line — not the title row. In the title row they were
      // three flex items competing for one line, and the name is the item that
      // lost: on a 792x360 phone, where the two cards sit side by side, the
      // forced-material hand rendered "Volatile Contract" as "Volatile Contrac"
      // (a player's report). The badge and the box are ~50px of furniture; the
      // footer already had that width spare, because the verb line is the
      // shortest one on the card — even in its longest form, which is a pad's
      // "Press A to swap this in" (measured: that state adds no violation the
      // touch state does not already carry — see sim/uifit/fixtures.ts's note
      // above `draft`). So the name now gets the card's whole width
      // and the state cluster gets a column nothing else wants, and — the part
      // that matters for a screen whose cards toggle — the geometry is the same
      // in every state: the box is always present (empty when unpicked), so a
      // card does not change shape when it is tapped.
      return `<button class="mod-card mod-card--${kind}${picks > 0 ? " mod-card--picked" : ""}"
        data-action="pick-hazard" data-hazard="${h.id}" aria-pressed="${picks > 0}">
        <div class="mod-card__top">
          <span class="mod-card__ax" aria-hidden="true">${badge}</span>
          <span class="mod-card__name">${h.name}</span>
        </div>
        <p class="mod-card__desc">${h.desc(opts.mark)}</p>
        <div class="mod-card__foot">
          <span class="mod-card__pick">${foot}</span>
          <span class="mod-card__state">${stack}${box}</span>
        </div>
      </button>`;
    })
    .join("");
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(940px,96vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared · ${tierText(opts.tier)}</div>
      <h2 class="display">${opts.picksNeeded > 1 ? `Ratchet ${opts.picksNeeded} axes` : "Ratchet one axis"}</h2>
      ${quotaHTML(pending, opts.picksNeeded, opts.offers.length, opts.selected.map((id) => {
        // Resolved against the whole table, not just the dealt hand: a pick is
        // always from the hand in play, but the slot's glyph should survive a
        // caller (a fixture, a stale save) whose selection outruns its offer.
        const h = opts.offers.find((o) => o.id === id) ?? HAZARDS.find((o) => o.id === id);
        return {
          glyph: h ? axisIconHTML(h, 11) : axisGlyph(id),
          kind: h?.kind === "content" ? "bane" : "tradeoff",
        };
      }), "sticks for the rest of the run")}
      <div class="draft__bank">
        ${statCellHTML("reactor", "Carry", `$${opts.carry} · ended $${opts.funds}`, "var(--accent)")}
        <!-- THE NOTCH MARK, not the up-arrow. Its two siblings on this row are
             glyph-led (statCellHTML deals "reactor" for Carry and "scrap" for
             Scrap), and the arrow was the odd one: it says "worse", which is
             the same thing every card on this screen says, where the row's job
             is to say WHAT is being counted. It is the same mark and the same
             figure the plant panel's tally now leads with, so the bill a player
             signs here and the bill they read mid-bay are one reading. -->
        <div class="bay-stat">${icon("notch", 14)}<span class="bay-stat__txt">
          <span class="bay-stat__lbl">${
            // THE WORD THE GLYPH IS NOT ALREADY SAYING. This label used to read
            // "Notches · clause Bay 10" — 23 characters of 6px pixel face, and
            // at the compact tier (where the label sits beside the value, not
            // over it) the chip has about 91px for it against the ~146px that
            // string wants. So it wrapped to two lines and took the width out
            // of the value, which arrived as "6+1 · 2" with the clause
            // standing ellipsised off the end. The label was eating the figure
            // it labels.
            //
            // What comes off is "Notches", and it comes off because the cell
            // already leads with the NOTCH MARK (icon("notch") above) — the
            // same mark the plant panel's tally leads with mid-bay. The word
            // was the glyph again in letters. The bay number goes with it for
            // the same reason: this modal's projection header, four rows down,
            // is titled "Bay N — projected". What is left is the one fact
            // nothing else on the screen carries, and the singular/plural is
            // load-bearing — "Clause" is the next stop's one standing clause,
            // "Clauses" is a run with no next stop left to arm.
            opts.standing
              ? opts.standing.nextBay === null ? "Clauses" : "Clause"
              : "Notches"
          }</span>
          <span class="bay-stat__val" style="--stat-tint:var(--danger)" id="draft-notches">${banked}${pending > 0 ? `<span class="chip__pending">+${pending}</span>` : ""}${
            opts.standing ? ` · ${opts.standing.active}/${opts.standing.total}` : ""
          }</span>
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
  /** The live input family (D2), for the card footers' verb. Optional and
   *  touch by default, which is what this screen said in every state before
   *  the verb came off bindings.ts — so a caller that has no profile to hand
   *  (a fixture, a pin) renders exactly the card it always did. */
  profile?: InputProfile;
}): string {
  const ready = opts.selected !== null;
  const nextBay = opts.bayNum + 1;
  // Same verb, same reason, same shell as the ratchet card above (D7).
  const press = hintPress(opts.profile ?? "touch");
  const Press = `${press[0].toUpperCase()}${press.slice(1)}`;
  const cards = opts.offers
    .map((f) => {
      const picked = opts.selected === f.id;
      const sys = upgradeById(f.system);
      const box = picked
        ? `<span class="mod-card__box mod-card__box--on">${icon("check", 11)}</span>`
        : `<span class="mod-card__box" aria-hidden="true"></span>`;
      const foot = picked
        ? `Accepted — ${press} to undo`
        : ready
          ? `${Press} to take this one instead`
          : `${Press} to preview`;
      // The badge is the SHIP SYSTEM the clause examines (FinalDef.system) —
      // its icon in the corner and its name on the pill, because the
      // inspection is the moment the Tier's whole argument gets settled and a
      // player who never made the connection is told it here, once.
      //
      // Same shell as the ratchet card, footer included: the pick box sits
      // bottom-right beside the verb line so the clause name has the
      // card's whole width. The clause names are shorter than the materials'
      // ("Bled Hydraulics" is the longest in FINALS), but these two cards are
      // ALWAYS side by side (draft__cards--pair) rather than only on a short
      // viewport, so the row they share is the narrower one. And divergence
      // would cost the deliberate sameness of the two screens, which is worth
      // more than either card's own best arrangement (see this function's note).
      return `<button class="mod-card mod-card--final${picked ? " mod-card--picked" : ""}"
        data-action="pick-final" data-final="${f.id}" aria-pressed="${picked}">
        <div class="mod-card__top">
          <span class="mod-card__ax" aria-hidden="true">${icon(f.system as IconName, 13)}</span>
          <span class="mod-card__name">${f.name}</span>
        </div>
        ${sys ? `<div class="mod-card__kind">${sys.name}</div>` : ""}
        <p class="mod-card__desc">${f.desc}</p>
        <div class="mod-card__foot">
          <span class="mod-card__pick">${foot}</span>
          <span class="mod-card__state">${box}</span>
        </div>
      </button>`;
    })
    .join("");
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(940px,96vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared · ${tierText(opts.tier)}</div>
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

/**
 * What completing `tier` OPENED, as the clause both end cards drop into the
 * same sentence.
 *
 * The floor comes from meta.ts (tierOpenedByCompleting) rather than from the
 * progress snapshot each card already holds, because that snapshot is
 * markUnlocked read AFTER the update and markUnlocked saturates — completing
 * the last tier printed "Tier 10 is open" about the floor the player had just
 * spent the tier flying, which is how an owner came to report a finished
 * ladder as "all completed but not unlocked".
 *
 * The null branch is not a hole to fill with silence. The ladder ending is
 * genuinely the biggest thing that happens on the save, and what is still open
 * there is two things the player CAN act on: the Workshop shelf, which the
 * tier-10 Contract loop keeps paying toward, and the seals the Skydeck asks
 * for (meta.ts's skydeckOpen). Naming them is the difference between an
 * endgame and a screen that has run out of things to say.
 */
function tierOpenedClause(tier: number): string {
  const opened = tierOpenedByCompleting(tier);
  return opened !== null
    ? `Tier ${opened} is open`
    // One dash, not two: the caller has already spent the sentence's dash on
    // "cleared — ", so the second half is a sentence of its own.
    : "the ladder is finished. Contracts still pay, and what's left is a maxed rig and every Tier sealed";
}

/**
 * The end card's timing clause — "6 excellent · 4 good", or nothing at all.
 *
 * Exported so sim/systems.ts can pin the copy without rendering a whole modal,
 * which is the same treatment every other piece of generated end-card text
 * gets here: a clause that appears on one screen and is checked on none is a
 * clause that goes stale silently.
 *
 * EMPTY WHEN NEITHER BAND WAS EARNED, and that is the editorial decision rather
 * than a null guard. The clause's job is to tell a player that a better row
 * exists and that they got some; a run that got none is being shown a game-over
 * screen, and "0 excellent · 0 good" on it is a scold. The callout in the bay
 * (theme.ts's GRADE_CALLOUT) is where that player meets the mechanic, in the
 * moment they can still act on it.
 */
export function gradeBreakdownClause(grades?: GradeTally): string {
  if (!grades) return "";
  const parts: string[] = [];
  if (grades.excellent > 0) parts.push(`${grades.excellent} excellent`);
  if (grades.good > 0) parts.push(`${grades.good} good`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
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
  /** Funds volatile detonations took for the live cargo they destroyed across
   *  the run (run.ts's RunState.volatileLosses). Worded as FUNDS for the same
   *  reason salvagedFunds is, and printed in the breakdown row rather than on
   *  the sandbox foot beside it — see the `volatileFoot` note below. */
  volatileLosses: number;
  /** Funds the Incinerator saved across the run (run.ts's
   *  RunState.incineratedFunds). Worded as FUNDS for the same reason its two
   *  neighbours are, and printed in the same breakdown row — it is the only
   *  ship system on the shelf whose whole effect is invisible while the bay is
   *  being played, so this line is where the purchase gets settled up. */
  incineratedFunds: number;
  /** Rows the run sold at each TIMING GRADE (run.ts's RunState.grades). Optional
   *  so every caller that predates the mechanic — the uifit fixtures included —
   *  renders exactly the card it rendered before, with no clause at all. */
  grades?: GradeTally;
  tiers: UpgradeTiers;
  /** The board this score posts to — the RUN's own Mark (RunState.mark), never
   *  `progress.tier`: a run that completed its tier has already advanced the
   *  Mark by the time this renders, and the score belongs to the tier it was
   *  actually flown at. */
  /** The board this run's score lands on (lib/api.ts's BoardId): the run's own
   *  Tier, BOARD_SANDBOX for Tier S, or BOARD_SKYDECK for the roof. */
  boardTier: number;
  /** The day half of that key on the Skydeck's board (lib/api.ts's BoardDay),
   *  absent on every board that has no day. */
  boardDay?: number;
  /** TODAY'S CONTRACT BOARD, as the end card needs to know it: how many of the
   *  three are still uncleared.
   *
   *  Absent means "no board to speak of" and the route is not drawn — which is
   *  what every caller that predates it gets, uifit fixtures included. */
  contracts?: { remaining: number };
  /** THE LOOP'S ONE NEXT STEP (meta.ts's nextStep), which on a completed run is
   *  what the MAIN BUTTON does — the owner's rule verbatim: "the main button
   *  brings to the next logical step". A Tier 2 first win used to put "Run Tier
   *  2 →" on the primary while the tier still owed three Contracts, i.e. the
   *  loudest control on the card pointed at the half of the tier that was
   *  already done.
   *
   *  It used to arrive as `contracts.next`, a boolean saying only whether the
   *  step happened to be Contracts. The step id itself is passed now because
   *  the card has to route three ways, and because a boolean derived from
   *  nextStep at the call site is a second copy of the rule that can drift from
   *  the home screen's badge — the whole reason both surfaces ask meta.ts.
   *
   *  Absent leaves the card exactly as it was before the rule: the run's own
   *  primary, no re-route. Every caller that predates it, fixtures included,
   *  keeps the card it always drew. */
  step?: NextStepId;
  /** The bay the run died in can be handed back (main.ts's retryBay). Drawn on
   *  a ladder run only — Tier S has its bench one tap away and the Skydeck is
   *  the day's single attempt, which is the whole of what the mode sells.
   *
   *  `seal` is run.ts's SealState — the SAME read requestBayRetry gates its
   *  confirmation on, so the button's face and the panel that press opens can
   *  never disagree. It selects between three states of the button rather than
   *  switching a warning on and off, and that is the change playtest asked
   *  for: the button "should hold the mark of whether the seal has been broken
   *  or not". Absence is not a state a player can read — a button with nothing
   *  on it looks like a button nobody finished — so every answer is drawn.
   *
   *  THE GLYPH MEANS WHAT IT MEANS ON THE TOWER: a stamp is a seal you hold, a
   *  struck stamp is one that is gone. The WASH carries the other axis, which
   *  is whether anything is at risk right now.
   *
   *   - at-stake: the stamp, in the danger wash, over a line saying a retry
   *     breaks it. This press costs something.
   *   - spent: the same stamp struck through and muted, over a line saying so.
   *     This run's seal is already gone and further retries are free, which is
   *     a thing worth being able to read at a glance rather than remember.
   *   - held: the stamp again, solid but muted — you HOLD this Mark's stamp
   *     and no press on this screen can take it (run.ts's sealStateFor; found
   *     in review, codex PR #135). Solid rather than struck because nothing is
   *     gone, muted rather than danger because nothing is at risk. Its line is
   *     the one that has to be worded most carefully: it is a fact about the
   *     MARK, and must not be read as this run having sealed anything. */
  retryBay?: {
    seal: SealState;
    /** The MARK being flown — named by the "held" line, which is a statement
     *  about that floor's stamp rather than about this run. Passed rather than
     *  read off `boardTier`: those two agree on every ladder run today, and
     *  leaning on that would make this copy quietly wrong the first time they
     *  stop agreeing. */
    mark: number;
  };
  /** Whether the retry this card's primary offers is the whole RUN rather
   *  than the bay (run.ts's retryIsWholeRun) — true only on the first bay of
   *  a ladder run, where the bay and the run are the same deal and only one
   *  of them was free. Drops Retry Bay and its seal line, exactly as
   *  pauseModal's `runRetry` drops Restart Bay: a seal-priced button beside
   *  a free one that hands back the same bay is a price for nothing.
   *
   *  Defaults false, so every caller that predates the argument draws the
   *  card it always did. */
  runRetry?: boolean;
}): string {
  // TWO TITLES, NOT THREE. `won` and `runComplete` are the SAME fact at the one
  // caller that renders this card — main.ts passes `this.state === "won"` to
  // both, because a Deep Run is won by clearing its last bay and by nothing
  // else — so the middle branch named a state the app cannot produce. It said
  // "Level Cleared!", which is also the wrong noun (the unit is a Bay), over a
  // card whose stats are a whole run's. Dead copy that is also wrong copy is
  // not worth a branch, and the bay's own celebration already exists one screen
  // earlier: bayClearScreen, which says BAY CLEARED.
  const title = opts.runComplete ? "Run Complete!" : "Game Over";
  // The bay retry, minus bay 1 (see `runRetry`). Resolved once, because the
  // seal line and the button below both read it and must agree.
  const retryBay = opts.runRetry ? undefined : opts.retryBay;
  /* ------------------------------------------------------------------------
   * WHAT THE MAIN BUTTON DOES — the owner's rule, applied to the one card that
   * was breaking it: "the main button brings to the next logical step".
   *
   * A completed run is the moment the loop asks its question, and until now the
   * card answered it with the thing the player had JUST finished. The report is
   * exact: a first Tier 2 win, all ten bays cleared, +15 salvage banked — and
   * "RUN TIER 2 →" on the primary, with Contracts a secondary beside it, while
   * the tier's three Contracts were the entire remaining cost of completing
   * that tier. The screen's loudest control pointed at the half already paid.
   *
   * So the primary IS meta.ts's nextStep, taken off the same rule the home
   * screen badges and never re-derived here. Three answers reach this card:
   *
   *  - contracts -> the board, with what the TIER still owes on the face.
   *  - workshop  -> the shelf (the salvage row's own Workshop button then
   *                 stands down; see `showRowWorkshop`).
   *  - run/seal  -> the run, which is what the card always did. A seal is flown
   *                 and not bought, so it rides the run button exactly as it
   *                 rides the menu's primary.
   *
   * ONLY ON A COMPLETED LADDER RUN. A LOSS keeps today's primary and that is a
   * hard rule rather than an omission: padnav's focusInitial lands the pad on
   * `.btn--primary`, the loss card's other buttons can spend the run's seal,
   * and the mode's own answer to a loss is another run (the long note on Retry
   * Bay below argues all three). Tier S has no next rung to offer at all.
   * --------------------------------------------------------------------- */
  // What the TIER still owes, which is the count that makes Contracts the step
  // — not `contracts.remaining`, which is how many of TODAY'S cards are
  // unclaimed. The tier's quota is what the menu's pips draw and what nextStep
  // actually reads, and a primary quoting the other number would be the two
  // surfaces disagreeing about the same debt.
  const contractsOwed = Math.max(0, opts.progress.needed - opts.progress.contracts);
  // …but the ROUTE still needs a card behind it. A tier can owe Contracts while
  // today's board is fully claimed, and a primary that opens a board of three
  // ticks is a main button that leads nowhere. That card falls through to the
  // run, which is the other half of the same tier and always flyable.
  const stepRoute: "contracts" | "workshop" | "run" =
    !opts.sandbox && opts.runComplete
      ? opts.step === "contracts" && contractsOwed > 0 && (opts.contracts?.remaining ?? 0) > 0
        ? "contracts"
        : opts.step === "workshop"
          ? "workshop"
          : "run"
      : "run";
  // THE CARDS BEHIND THE TOWER DOOR ARE THE STEP: today's board still has an
  // uncleared card and meta.ts's nextStep says Contracts. What the retired
  // secondary Contracts button used to be badged on, moved to the ghost that
  // now opens the screen the cards are on.
  const contractsNext = opts.step === "contracts" && (opts.contracts?.remaining ?? 0) > 0;
  // The salvage row's Workshop button, kept unless the primary has become that
  // same door. Two Workshop buttons on one card is the card arguing with
  // itself, and the one that goes is the quieter one.
  const showRowWorkshop = stepRoute !== "workshop";
  // "Run Tier N →" — the primary's face when the run IS the step, and a
  // secondary on the two cards where it is not. It never leaves the card: a
  // player who has just cleared a tier's run may want to re-fly it for a
  // better board or a clean seal, and the step is a recommendation rather than
  // a gate. One string, so the two slots cannot drift apart.
  const runFace = `${tierPlateHTML(opts.progress.tier, "button")}Run Tier ${opts.progress.tier} →`;
  // THE PRIMARY, resolved as ONE action/face pair rather than as two ternaries
  // inside the markup. The button carries a data-action now instead of always
  // being `restart`, and a face that can disagree with the door it opens is
  // precisely the bug this change exists to remove.
  //
  // The COUNT on the Contracts face is what the TIER still owes, which is the
  // same figure the hub's unlock checklist draws (tierProgressFor) — the two
  // doors into the same board must not name two different numbers. It is not
  // `contracts.remaining`: that is how many of TODAY'S three cards are still
  // unclaimed, which answers "is there anything behind this door" (the route
  // guard above) and not "how much of the tier is left to pay".
  //
  // No NEXT STEP badge on it. The badge is a directive pointing at a control
  // that is not the main one (A3 allows exactly one on a screen); a primary
  // that IS the step is already the loudest thing on the card, and badging it
  // would be the screen saying the same thing twice.
  const primary: { action: string; face: string } =
    stepRoute === "contracts"
      // ON THE HUB, not the standalone board: a tier's Contracts are three
      // cards on the hub's rail now, and the board screen is the Skydeck's and
      // the school's alone (main.ts's "contracts" action refuses a tier).
      ? { action: "tiers", face: `${icon("contracts")}Contracts · ${contractsOwed} to go` }
      : stepRoute === "workshop"
        ? { action: "workshop", face: `${icon("workshop")}Workshop` }
        : {
          action: "restart",
          // A15: the bay-10 primary carries the tier plate (the button size of
          // the one component — a row chip, not the menu's stacked badge) and
          // names the rung it flies next.
          //
          // A sandbox run's primary re-flies the SAME configuration, which is
          // what practice is: main.ts's restart routes on RunState.sandbox, so
          // this button never has to know which mode it is in.
          //
          // "Retry Run" rather than "Play Again" on a loss with the bay retry
          // beside it: the two are now a PAIR and the pair only reads if both
          // halves say what they hand back. It stays the primary on a loss, and
          // that is a decision rather than an inheritance — see the retry button
          // below, and the step note above for why no loss is ever re-routed.
          face: opts.sandbox
            ? "Fly it again"
            : opts.runComplete
              ? runFace
              : opts.retryBay
                ? "Retry Run"
                : "Play Again",
        };
  // Demolition recovery, appended to whichever foot line the branch below
  // renders. Suppressed at zero rather than printed as "$0": a charge is a
  // draft pick most runs never make, so the line would be dead weight on the
  // majority of end screens — and the foot is already the densest row here.
  const demoFoot = opts.salvagedFunds > 0 ? ` · $${opts.salvagedFunds} recovered by demolition` : "";
  // What volatile took, on the run's own tally row. Suppressed at zero for the
  // same reason demoFoot is — most runs never ratchet the axis, and the
  // breakdown is not a place to print a $0 for a hazard the player never met.
  //
  // IN THE BREAKDOWN, not on demoFoot's line, and the difference matters. That
  // foot renders on Tier S runs only (sandboxEndRowHTML is the sole caller), so
  // a charge parked there would be invisible on every ladder run — which is the
  // whole of what this readout is for. A cost the player is never shown reads
  // exactly the way it read to the sim before it was billed: as free pile
  // relief (lineClear.ts's volatileLossFor). The breakdown is already the row
  // that reconciles the run's money, and this belongs beside "$N left".
  const volatileFoot = opts.volatileLosses > 0
    ? ` · $${opts.volatileLosses} lost to detonations` : "";
  // What the hood saved, beside what the bay lost, and suppressed at zero on
  // the same rule as its two neighbours. It sits AFTER volatileFoot rather than
  // before it because the order is the order the money moved: the bill first,
  // then what was taken off it. "saved by the Incinerator" and not "burned" —
  // the number is money that stayed in the bankroll, and the breakdown row's
  // whole job is reconciling the bankroll.
  const incinFoot = opts.incineratedFunds > 0
    ? ` · $${opts.incineratedFunds} saved by the Incinerator` : "";
  // HOW THE ROWS WERE SOLD (grades.ts), on the breakdown row that already
  // reconciles the run rather than as a fifth stat tile.
  //
  // The breakdown is the honest home for it: every other clause there is "what
  // the run produced and what it cost", and a timing tally is the same kind of
  // fact read one level down — WHY the money came out the way it did. A stat
  // tile would have made it a headline beside Score and Lines, and the grade is
  // not a score, it is the reason the score is what it is.
  //
  // Only the two bands that pay a PREMIUM are named, and only when a run earned
  // some. A run that swept everything is not told it swept everything: the
  // clause exists to teach that a better row is available, and printing
  // "0 excellent" on the losing screen is a scold rather than a lesson.
  const gradeFoot = gradeBreakdownClause(opts.grades);
  // ...and the same removal on the eyebrow, which had the same dead middle
  // branch ("Launch Bay complete"). What is left is one win line and the four
  // losses, which is exactly the set of endings this card can be handed.
  const eyebrow = opts.runComplete
    ? `All ${RUN_LEVELS} bays cleared`
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
        · $${Math.max(0, opts.funds)} left${gradeFoot}${volatileFoot}${incinFoot}
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
        <div class="salvage-row__amt">${salvageHTML(`+${opts.tierSalvage}`, 16, true)}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.tierCompleted} complete!</b>
          <span class="muted">Run beaten and ${opts.progress.needed} Contracts cleared — ${
            // The same saturation question the Contract card asks, answered in
            // the same place — see tierOpenedClause. Either half of a tier can
            // be the one that lands second, so both cards can be the one that
            // announces the ladder's last rung.
            tierOpenedClause(opts.tierCompleted)
          }. <b>${opts.salvageTotal} salvage banked</b>, yours to keep.</span>
        </div>
        ${showRowWorkshop ? `<button class="btn btn--secondary" data-action="workshop">Workshop</button>` : ""}
      </div>`
          : opts.tierSalvage > 0
            ? `<div class="salvage-row">
        <div class="salvage-row__amt">${salvageHTML(`+${opts.tierSalvage}`, 16, true)}</div>
        <div class="salvage-row__body">
          <b>Salvage banked</b>
          <span class="muted">First run win at Tier ${opts.progress.tier} — ${opts.salvageTotal} salvage total.</span>
        </div>
        ${showRowWorkshop ? `<button class="btn btn--secondary" data-action="workshop">Workshop</button>` : ""}
      </div>`
            : ""
      }
      ${
        // A15: a completed tier's end names what the NEXT rung actually
        // changes — truthfully. A Mark no longer scales the ladder's numbers
        // (level.ts's zeroed MARK_*_STEP), so what a tier opens is a hazard
        // axis and a bigger build budget, and that is what the line says.
        //
        // AND ONLY WHEN THERE IS A NEXT RUNG. Completing the last tier opens
        // no floor, so this promised a hazard axis Mark 10 does not have and a
        // budget rise that had already happened — the same saturation the
        // salvage row above just stopped printing.
        !opts.sandbox && opts.runComplete && opts.tierCompleted !== null
          && tierOpenedByCompleting(opts.tierCompleted) !== null
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
        <div class="eyebrow">${boardText(opts.boardTier)} board${
          // The day, on the one board that has one — this modal is where a
          // Skydeck score is actually filed, and it files under the day the run
          // was DEALT rather than the day it landed (lib/api.ts's BoardDay).
          opts.boardTier === BOARD_SKYDECK && opts.boardDay
            ? ` · ${dayText(opts.boardDay)}`
            : ""
        }</div>
        <div class="submit-row" id="submit-row">
          <!-- THE PLACEHOLDER IS NOT A LABEL: it is gone the moment anything is
               typed, and a screen reader announces an unlabelled text box as
               "edit text". This is the one text input in the game, so the one
               place that omission could happen — and Enter submits it, wired in
               main.ts's onKeydown, because a one-field form where Enter does
               nothing is a form that reads as broken. -->
          <input class="name-input" id="name-input" maxlength="12" placeholder="YOUR NAME"
            aria-label="Your name for the leaderboard"
            value="${opts.name}" autocomplete="off" spellcheck="false"
            enterkeyhint="done" autocapitalize="characters" inputmode="text" />
          <!-- Secondary, not primary (B2): the screen's one forward move is
               the restart button below — submitting a score is a sideways
               action, and two primaries made the exit compete with it. -->
          <button class="btn btn--secondary" data-action="submit-score">Submit</button>
        </div>
        <!-- Hidden until a post fails (main.ts's onSubmitScore) — so it adds no
             height to the card the fixtures measure, and no line until there
             is something to say. -->
        <p class="muted end__submit-note" id="submit-note" role="alert" hidden></p>
        <div id="lb-body" data-scroll>${opts.rows}</div>
      </div>
      <div class="row end__actions">
        ${
          // THE PRICE OF THE MERCY, spelled out over the button that charges
          // it. The glyph on that button is the tower's own seal with a bar
          // through it, and a glyph is not a sentence — this is the sentence,
          // and it is the half that says the thing a player most needs to hear:
          // the seal is what breaks, NOT the tier. A player who thinks a retry
          // costs them the tier will quit a run they could still win.
          //
          // INSIDE the row, as a full-width flex item that pushes the buttons
          // onto the next line, rather than as a sibling above it. The landscape
          // grid places .end__actions by AREA (app.css: "main side" / "actions
          // side"), so a paragraph beside it is an unplaced grid child and lands
          // in an implicit row under the whole panel — which is where this line
          // first rendered, three inches below the button it prices.
          //
          // BOTH STATES, like the button under it. It used to be drawn only
          // while the seal was on the table, on the argument that a warning
          // outliving its cost is a line people learn to stop reading — which
          // is true of a WARNING and not of a READOUT. The second line is not
          // the first one repeated; it is the opposite news, and it is news the
          // player can act on: the price has been paid, and every further retry
          // in this run is free.
          // THREE READINGS, one per state. The "held" line is a fact about the
          // MARK — its stamp is on the tower and this screen cannot take it —
          // and is worded so it cannot be read as this RUN having sealed
          // something: a re-fly seals nothing until it is won clean, and the
          // player is looking at a loss.
          retryBay
            ? retryBay.seal === "at-stake"
              ? `<p class="muted end__seal">Retrying a bay breaks this run's seal. Tier ${opts.progress.tier} still opens — the seal is a record, not a reward.</p>`
              : retryBay.seal === "held"
                ? `<p class="muted end__seal">Tier ${retryBay.mark} is already sealed — its stamp stays on the tower whatever this run does, so retrying a bay costs nothing.</p>`
                : `<p class="muted end__seal">This run's seal is already broken — retrying a bay costs nothing now.</p>`
            : ""
        }
        <button class="btn btn--primary" data-action="${primary.action}">${primary.face}</button>
        ${
          // THE RUN, DEMOTED BUT NEVER DROPPED. On the two cards where the step
          // is a shop rather than a flight, "Run Tier N →" moves down one rank
          // and stays on the screen: a player who has just cleared the tier's
          // run may well want it again for a better board or a clean seal, and
          // the step is a recommendation, not a gate. Same string in both slots
          // (`runFace`), so the promoted and the demoted face cannot drift.
          stepRoute !== "run"
            ? `<button class="btn btn--secondary" data-action="restart">${runFace}</button>`
            : ""
        }
        ${
          // RETRY BAY — the forgiving half, and deliberately NOT the primary.
          //
          // Three reasons, in the order they decided it. (1) The Deep Run is
          // the permadeath exam (docs/DESIGN.md); the mode's own answer to a
          // loss is another run, and the retry is a mercy offered beside it
          // rather than the default the screen assumes. (2) padnav's
          // focusInitial lands a pad on `.btn--primary`, so whichever button
          // wears it is what a stray A after a loss presses — and this is the
          // only button on the screen that can spend something permanent. A
          // mis-press must never cost the seal. (3) The fresh start keeps the
          // slot "Play Again" already held, so no player's muscle memory is
          // repurposed into a cost they did not ask for.
          //
          // It sits FIRST after the primary all the same: it is the thing that
          // hands back the bay they just lost, and burying it under Menu would
          // be hiding the feature this row exists to add.
          //
          // BOTH SEAL STATES ARE DRAWN, and the glyph means the same thing on
          // this button that it means on the tower: a stamp is a seal you have,
          // a struck stamp is one that is gone. It used to wear the struck
          // stamp while the seal was still INTACT — the glyph was predicting
          // the press rather than reporting the run — and then nothing at all
          // once the seal was actually spent, which is the one state a player
          // most wants to be able to read back.
          //
          // THE GLYPH AND THE WORDS BOTH COME FROM sealFaceHTML/sealFaceLabel
          // now, which is where the pause modal's Restart Bay gets them too.
          // They were written here and nowhere else for one release, and the
          // pause modal went out with a bare button as a result — so the rule
          // moved out to be shared rather than being copied to the second
          // caller. Nothing about this button's face changed in the move.
          //
          // …AND NOT ON BAY 1 (`runRetry`), where it would sit beside Retry
          // Run charging the seal for the same re-deal that button hands back
          // free. The pause card already refuses the same pair; the argument
          // is run.ts's retryIsWholeRun.
          retryBay
            ? `<button class="btn btn--secondary" data-action="retry-bay"
              aria-label="${
                sealNameWith(`Retry Bay ${opts.bayNum}`, retryBay.seal, retryBay.mark)
              }"
            >${sealFaceHTML(retryBay.seal)}Retry Bay</button>`
            : ""
        }
        ${
          // Back to the bench, not to the menu — the thing a player wants
          // after a practice run is almost always the next configuration, and
          // routing that through the home screen puts a tower and a nine-tap
          // door between them and it.
          opts.sandbox
            ? `<button class="btn btn--secondary" data-action="sandbox">Tier S</button>`
            : ""
        }
        ${
          // THE CONTRACTS ROUTE (playtest feedback: the end card is where a
          // player decides what to do next, and the only thing it offered was
          // the run again or the menu).
          //
          // Drawn when today's board still has an uncleared card, which is the
          // honest reading of "there is something here to do" — a board of
          // three ticks is a door onto free practice, and the end of a run is
          // not where to advertise that.
          //
          // The BADGE is meta.ts's nextStep and nothing else, so the rule that
          // exactly one surface carries it holds across the screen boundary
          // too: the badge appears here only when the loop's one next step
          // really is Contracts, which is precisely when the tier still owes
          // them and salvage cannot yet buy anything. When salvage CAN buy
          // something the Workshop is the next step, and it already has a
          // button on this modal — the primary itself on a completed run, or
          // the salvage row that just paid out on every other card. Two badges
          // on one card would be the screen arguing with itself.
          //
          // …and NOT when the primary has already become this door (see
          // `stepRoute`): two Contracts buttons on one card is the card arguing
          // with itself about which of them to press.
          // THE SECONDARY CONTRACTS DOOR IS GONE with the board it opened: the
          // ghost below already lands on the hub, where the cards are, and two
          // buttons to one screen is the row arguing with itself.
          ""
        }
        <!-- Back to the tier hub (not the front door): the tierlevator's unlock
             ceremony rides there, and the loop continues from it. Named the way
             every other door to it is — the lesson cards' "the tower" — but bare,
             because this row already carries up to three siblings and the
             preposition wrapped it onto a second line on a 640x360 window
             (sim/uifit). The contract card's twin keeps "To the tower": one
             button in a shorter row, with the room for it. -->
        ${
          // …and it carries the step's badge when the cards behind it are the
          // step — the secondary Contracts button used to, and the hub's cards
          // are behind this door now. Never beside a Contracts primary, which
          // is the same door and is not drawn twice.
          stepRoute === "contracts"
            ? ""
            : `<button class="btn btn--ghost${contractsNext ? " btn--next" : ""}" data-action="tiers">Tower${
              contractsNext ? nextBadgeHTML() : ""
            }</button>`
        }
      </div>
    </div>
  </div>`;
}

/**
 * THE SEAL-BREAK NOTICE — said once, ever, and then never again.
 *
 * A bay retry has always cost the run's seal (meta.ts's recordRunEnd) and has
 * always cost it SILENTLY: the pause modal's Restart Bay, the held pause
 * button and now the game-over card's Retry Bay all hand the bay back without
 * mentioning that the stamp on the tower floor has just gone. That was
 * survivable while the seal was decoration. It is not survivable now that the
 * seals are the Skydeck's key (meta.ts's skydeckOpen) — a cost that opens a
 * door has to be quoted before it is charged.
 *
 * ONE PANEL, ONCE, ON A WATERMARK (MetaState.sealBreakSeen), rather than a
 * confirmation every time. A dialog in front of a retry is a toll: the player
 * who has understood the trade pays it on every restart for the rest of their
 * life with the game, and the tenth one is read by nobody. What survives after
 * this panel is the glyph on the button and the line above it (endModal), which
 * is the right permanent weight for a cost the player now knows.
 *
 * THE SECOND PARAGRAPH IS THE WHOLE POINT. The first says what breaks; the
 * second says what does NOT, and it is the half a player will otherwise get
 * wrong. A retried run still counts, still banks its salvage share, still ticks
 * the tier — the seal is a record of HOW a Mark fell, not a condition on
 * whether it fell. Without that sentence the panel reads as "restarting forfeits
 * your tier", and a player who believes that will abandon runs they could win.
 */
export function sealBreakModal(opts: {
  /** The 1-based bay about to be handed back. */
  bayNum: number;
  /** The MARK being flown (RunState.mark) — whose stamp is on the table. Not
   *  the player's high-water tier: a re-fly of Mark 3 puts Mark 3's seal at
   *  stake and nothing else, and naming the wrong floor here is naming the
   *  wrong cost. */
  mark: number;
  /** The tier this run can still open (meta.ts's tierOpenableBy), or null when
   *  it can open none — a re-fly of a beaten Mark, or a run at the top of a
   *  finished ladder. The promise is only made where it is true; see the
   *  branch below for what is said instead. */
  tier: number | null;
  /** Marks sealed so far, out of the ladder — the price of the roof, stated in
   *  the same numbers the tower draws. */
  sealed: number;
  /** Draw the LONG form: the paragraph that teaches what a seal is and what
   *  the whole set opens (meta.ts's sealBreakSeen, once per save).
   *
   *  The watermark used to decide whether this panel appeared at all. It does
   *  not any more — the confirmation is asked every time the seal is genuinely
   *  at stake — so what is left for it to gate is the LESSON, which is the only
   *  part that is worth exactly one reading. Every later confirmation drops
   *  that paragraph and keeps the decision. */
  explain: boolean;
}): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal seal-note pop">
      <div class="eyebrow" style="color:var(--danger)">Seal</div>
      <h2 class="display">Retrying breaks the seal</h2>
      ${
        // ONE TITLE FOR BOTH FORMS. The short panel is a confirmation and a
        // question ("Break Mark 4's seal?") would read more naturally on it —
        // but the panel is doing the same job both times, the buttons under it
        // already ask the question, and two titles is two strings to keep true
        // of the same moment.
        opts.explain
          ? `<p class="seal-note__body">A Tier is <b>sealed</b> when you clear all ${RUN_LEVELS} of its bays
      in one run without retrying a single one. The tower stamps that floor, and the
      <b>Skydeck opens when all ${MARK_COUNT} Tiers carry a stamp</b> — ${opts.sealed} of ${MARK_COUNT} so far.</p>`
          : ""
      }
      <p class="seal-note__body">Retry bay ${opts.bayNum} and <b>Tier ${opts.mark}</b> cannot be
      sealed by this run. ${
        // THE PROMISE, ONLY WHERE IT IS TRUE. On the frontier the thing a
        // player most fears losing is the tier, so the tier is named. On a
        // re-fly of a beaten Mark — or at the top of a finished ladder — there
        // is no tier to open, and naming one would be a lie told to reassure.
        // What is true on every run is the rest of the sentence, so that is
        // what the fallback keeps: the run is not wasted, only the stamp is.
        opts.tier !== null
          ? `<b>Tier ${opts.tier} still opens.</b> The run counts, the salvage banks, and the`
          : `<b>Everything else this run can earn, it still earns</b> — the run counts and its`
            + ` salvage banks. The`
      }
      seal can be taken on any later run — including a re-fly of a Tier you have
      already beaten.</p>
      <!-- KEEPING THE SEAL IS THE PRIMARY, on the same reasoning the run-end
           card's own row uses: padnav's focusInitial lands a pad on the
           primary button, and the button a stray press finds must never be
           the one that spends something permanent. It is also the honest
           default for a panel the player did not ask to see — they pressed a
           retry, they are being told what it costs, and the answer the panel
           assumes should be the reversible one. -->
      <div class="row">
        <button class="btn btn--primary" data-action="seal-break-back">Keep the seal</button>
        <!-- The fourth name that speaks the price, and it goes through the same
             rule as the other three. It was a hand-written copy of the at-stake
             words, which is precisely the drift this feature moved the face out
             to prevent: the moment those words gained a subject, this button
             would have been the one still saying the old ones. The panel only
             ever opens on an at-stake seal (requestBayRetry), so the state is
             a constant here rather than a prop. -->
        <button class="btn btn--secondary" data-action="seal-break-go"
          aria-label="${sealNameWith(`Retry Bay ${opts.bayNum}`, "at-stake", opts.mark)}"
        ><span class="btn__seal" aria-hidden="true"></span>Retry Bay</button>
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
  /** True while this board is the ON-RAMP's step — licensed, nothing installed
   *  (meta.ts's rigStarted), so one clear buys the system that opens the Deep
   *  Run. Absent on every caller that predates the on-ramp. */
  firstSystem?: boolean;
  /** True while this is the SCHOOL's board — one fixed card, the first gate of the
   *  ground floor (contracts.ts's schoolBoard). It changes what the header is
   *  for: on every other board the eyebrow dates the offer and the footnote
   *  prices a tier's quota, because the player already knows what a Contract
   *  is. Here they do not, and the two things they need are what this mode is
   *  (no clock, no launch cost, free to fail) and what the one card pays for.
   *  Absent on every caller that predates the ladder. */
  school?: boolean;
  /** The board's floor, when it is not one of the ladder's — "Skydeck".
   *
   *  A NAME rather than a flag, and passed rather than derived from `tier`, for
   *  the reason every other cross-module label on this screen is: the sentinel
   *  belongs to the tower (SKYDECK_TIER) and the tier number belongs to the
   *  generator (contracts.ts's SKYDECK_CONTRACT_TIER), and a screen that
   *  compared one against the other would be a third place those two have to
   *  agree. The eyebrow is the only thing it changes — a board that is not on
   *  the ladder cannot say "Tier N", and saying nothing at all would leave the
   *  player no way to tell the roof's board from the tier-10 one. */
  floor?: string;
  /** One allowance across every Tier for this UTC day. Full Game owners have
   * no cap; already-cleared cards remain replayable after it reaches zero.
   *
   * `store` is StoreState.available (main.ts's purchasesReady): whether the
   * offer below can be opened at all. It gates the spent state's unlock door on
   * the same fact the menu's unlock chip and the tower's paywalled floors are
   * gated on — presentPaywall returns SILENTLY while the SDK is unconfigured
   * (no key in this build, configure failed, first launch offline), so a door
   * rendered without it answers the tap with nothing whatever. */
  allowance?: { fullGame: boolean; remaining: number; store?: boolean };
}): string {
  // Whether a first clear still banks anything. A tier pays its milestone share
  // for only the first TIER_CONTRACTS_REQUIRED Contracts (meta.ts), so once the
  // quota is full the remaining cards are practice — and saying so on the card
  // is the one piece of reward copy that is worth per-card space.
  const paying = !opts.progress || opts.progress.contracts < opts.progress.needed;
  const cards = opts.contracts
    .map((c, i) => {
      const done = opts.cleared.includes(c.id);
      const capped = !done && opts.allowance?.fullGame === false && opts.allowance.remaining <= 0;
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
      // A CAPPED CARD LOOKS CAPPED (owner report). It carried `disabled` and an
      // aria-label and nothing else: the whole state announced to a screen
      // reader and none of it to anyone else. The cards kept their live border,
      // still lit it on hover, and answered a tap with silence — which is the
      // one thing a control must never do. `disabled` is right and stays (a tap
      // must not start a Contract the day's allowance cannot pay for); what was
      // missing is that the eye can see it.
      //
      // THE DIM IS INLINE because this stylesheet's Contracts section belongs to
      // another change this round, and it is app.css's OWN disabled recipe
      // rather than a new look — the same `grayscale(0.7) brightness(0.6)` the
      // shop card's buy button, the refit card's and the rack header's all use
      // (app.css). The border is pinned back to `--line-strong` in the same
      // declaration, because `.contract-card:hover` lights it to `--accent` and
      // a hover that still says "press me" is the defect in miniature. The
      // `--capped` class is the hook the stylesheet should take this over with.
      const cappedFace = capped
        ? ` contract-card--capped" style="filter:grayscale(0.7) brightness(0.6);cursor:default;border-color:var(--line-strong)`
        : "";
      return `<button class="contract-card${done ? " contract-card--done" : ""}${cappedFace}" data-action="contract" data-slot="${i}"${capped ? ' disabled aria-label="Daily Contract limit reached"' : ""}>
        <span class="contract-card__top">
          <span class="contract-card__kind">${
            c.kind === "pattern" ? "Pattern" : c.kind === "setpiece" ? "Set Piece" : "Lines"
          }</span>
          ${state}
        </span>
        <span class="contract-card__name">${c.name}</span>
        <span class="contract-card__ask">
          <b class="contract-card__goal">${c.goal}</b>
          <!-- THE UNIT IS THE KIND'S OWN. A set piece's number is a run of
               timed crushes, not a row count, and a card that said "3 lines"
               over a Contract that can be cleared with three rows out of
               fourteen would be advertising the wrong exam. -->
          <span class="contract-card__unit">${
            c.kind === "setpiece"
              ? "timed in a row"
              : `line${c.goal === 1 ? "" : "s"}`
          }</span>
        </span>
        <span class="contract-card__supply">
          <span class="contract-card__supply-lbl">${c.kind === "pattern" ? "Supply" : "Budget"}</span>
          <span class="contract-card__supply-val">${supply}</span>
        </span>
        <!-- THE STAMP TAKES THE TERMS LINE. A capped card's bay conditions are
             a description of a flight that cannot be flown today, and this is
             the card's one full-width run — the only slot on it with room for
             the sentence that explains why the card is grey. -->
        <span class="contract-card__brief">${capped ? "Daily limit reached" : c.brief}</span>
      </button>`;
    })
    .join("");
  // Tier standing as the menu's tier chip rather than a sentence. The line it
  // replaces ran ~120 characters, wrapped on a landscape phone, and mixed three
  // different things — the two halves, the milestone payout and the unlock
  // condition — into one run of prose. The halves are a status readout, so they
  // get the readout shape the menu already uses for them, and the payout is now
  // a value on each card.
  // NO TIER CHIP ON THE SCHOOL'S BOARD. Every term of it is a claim about a
  // tier — "○ Run", "○ Contracts 0/3" — and the school's board is one card
  // whose clear moves a rung, not a quota. A player at step 5 reading "0/3"
  // learns that they owe three of these, which is exactly wrong.
  const tierChip = opts.progress && !opts.school
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
  // …AND NO DAILY ALLOWANCE LINE EITHER, for a reason that is arithmetic rather
  // than tone: the school's card carries a fixed seed rather than the day's, so
  // its id never matches today's prefix and clearing it spends none of a free
  // account's three (contracts.ts's claimedContractsOnDay). A line counting an
  // allowance this board cannot spend would be a limit invented for the one
  // player who has not yet met the mode.
  // SPENT IS ITS OWN STATE, not "0 of 3 left". A count of zero is a readout; a
  // player who has just been refused a card needs the two things the readout
  // cannot say — when the board comes back, and what lifts the limit.
  //
  // "TODAY" IS NOT A TIME. The allowance is counted by the UTC day
  // (meta.ts's claimedContractsOnDay, off the same daily seed the board is
  // generated from), so for most of the world "today" ends at some hour of the
  // afternoon or the following morning. The spent line says which midnight it
  // means — and only the spent line does, because that is the one state where
  // a player is waiting for it.
  const spent = !!opts.allowance && !opts.school
    && !opts.allowance.fullGame && opts.allowance.remaining <= 0;
  const allowance = opts.allowance && !opts.school
    ? opts.allowance.fullGame
      ? `<b>Full Game · unlimited Contracts</b>`
      : `<b>${opts.allowance.remaining} of ${DAILY_COUNT} Contract clears left today</b>`
    : "";
  // THE DOOR OUT OF THE REFUSAL. Every other gate in the game answers a locked
  // thing it can sell with the offer itself — the tower's earned-but-unentitled
  // floors, the sandbox's tier chips — and this screen answered with disabled
  // cards and nothing else. It is the spent state's alone: a board with clears
  // left is refusing nothing, and an offer there would be an advertisement on a
  // screen the player came to play.
  const unlockDoor = spent && opts.allowance?.store
    ? `<button class="btn btn--ghost" data-action="paywall">${icon("star", 11)}Buy Full Game</button>`
    : "";
  // …AND IT LEADS (owner report). It was a bold TAIL on the salvage sentence —
  // the strip answering "what is this board for" first and "why can it not be
  // played" fourth, on the one visit where the second question is the only one
  // the player has. A refusal that arrives after two clauses of reward copy is
  // a refusal the player finds by reading to the end of a line they have no
  // reason to read.
  //
  // So the spent board's strip is this sentence and nothing else. The WHY copy
  // it replaces is advice about a clear that cannot be banked until midnight,
  // and it is not dropped for length but because it is not true today; the
  // count it replaces ("0 of 3 left") is a readout where the player needs the
  // two facts a readout cannot carry — when the board comes back, and what
  // lifts the limit.
  //
  // A FULL STOP RATHER THAN THE STRIP'S USUAL "·": the door is a 44px button
  // sitting in the run of text (the tap-target floor — never the thing to
  // shrink), and a mid-sentence separator lands hard against its border.
  // Measured on the 640x360 budget phone, where the strip is tightest.
  const spentFoot = `<p class="muted contracts__foot"><b>Daily limit reached</b> — resets at 00:00 UTC.${
    unlockDoor ? ` ${unlockDoor} for unlimited Contracts` : ""
  }</p>`;
  // THE BOARD SAYS WHAT IT IS FOR, and on the on-ramp what it is for is one
  // purchase rather than a tier's quota. Three clears banking 45 toward a shelf
  // is the right answer for a player with a rig; the player who has none is
  // being asked to clear ONE card, and the number that matters to them is the
  // 15 it pays and the door that 15 opens. Quoted off the same milestone the
  // cards print, so the two halves of the promise are one number.
  // THE SCHOOL'S FOOTNOTE — the mode explained, then the purchase it funds.
  // It is deliberately the longest strip this screen draws: it is the only one
  // written for a player who has never seen a Contract, and it is on screen
  // exactly once per save. Every number in it is live (the card's own goal and
  // budget are on the card; the milestone and the price are the same two
  // figures the on-ramp strip quotes), so nothing here can promise a payout the
  // ladder does not make.
  const foot = spent
    ? spentFoot
    : opts.school && opts.progress
    ? `<p class="muted contracts__foot">${nextBadgeHTML("Why")} A <b>Contract</b> is a bay with
        <b>no clock and no launch cost</b> — fail it as often as you like, nothing is spent.
        Clear this one and it banks ${salvageHTML(opts.progress.milestone)}${
        opts.nextInstall
          ? `, which is exactly what ${opts.nextInstall.name} costs (${salvageHTML(opts.nextInstall.cost)})`
          : ", which is exactly what your first system costs"
      } in the Workshop — the next step of Flight School.</p>`
    : opts.progress && opts.firstSystem
    ? `<p class="muted contracts__foot">${nextBadgeHTML("Why")} One first clear banks ${
        salvageHTML(opts.progress.milestone)
      }${
        opts.nextInstall
          ? ` — enough for ${opts.nextInstall.name} (${salvageHTML(opts.nextInstall.cost)})`
          : " — enough for your first system"
      }. Fail free, retry free.${
        allowance ? ` ${allowance}.` : ""
      }</p>`
    : opts.progress
    ? `<p class="muted contracts__foot">${nextBadgeHTML("Why")} Fail free, retry free — and ${opts.progress.needed} first clears bank ${
        salvageHTML(opts.progress.milestone * opts.progress.needed)
      }${
        opts.nextInstall
          ? `, so ${opts.nextInstall.name} (${salvageHTML(opts.nextInstall.cost)}) is waiting in the Workshop before your next run`
          : " toward the Workshop"
      }.${allowance ? ` ${allowance}.` : ""}</p>`
    : `<p class="muted contracts__foot">Fail free, retry free — a cleared Contract stays replayable.${allowance ? ` ${allowance}.` : ""}</p>`;
  return `<div class="screen neon-backdrop">
    <div class="contracts">
      <div class="contracts__hdr">
        <div class="contracts__title">
          <!-- The tier lives in the chip opposite when there is one, so the
               eyebrow does not repeat it — it only names the thing the chip
               cannot, which is that the board is regenerated every day. -->
          <div class="eyebrow">${
            // THE SCHOOL'S BOARD DOES NOT RESET, and saying it does would be
            // the one wrong thing this eyebrow could say: the card is a fixed
            // seed (contracts.ts's SCHOOL_CONTRACT_SEED), it is the same card
            // tomorrow, and a player who fails it and comes back must not think
            // they have lost their chance at it.
            // …AND IT CARRIES NO STEP NUMBER, because it is a GATE rather than
            // a numbered rung (meta.ts's SCHOOL_LADDER). It said "step 5" while
            // the ladder counted twelve; the ladder counts its ten flights now,
            // so a number here would be counting a different one. What the
            // player needs is where they are, which is between the basics and
            // the rest of the school.
            opts.school
              ? `Flight School · between lessons ${LICENCE_LESSON_COUNT} and ${LICENCE_LESSON_COUNT + 1}`
              : opts.floor
                ? `${opts.floor} · resets daily`
                : opts.progress ? "Resets daily" : `Tier ${opts.tier} · resets daily`
          }</div>
          <h2 class="display">Contracts</h2>
          <p class="contracts__sub muted">${
            opts.school ? "One job. No clock, no cost, no way to lose it." : "No rush, do it right."
          }</p>
        </div>
        <div class="contracts__hdr-side">
          ${tierChip}
          <button class="icon-btn" data-action="tiers" aria-label="Back">${icon("close", 18)}</button>
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
  kind: "lines" | "pattern" | "setpiece";
  /** What the card ASKS FOR, in the units its kind states: lines for the two
   *  line-counting kinds, and consecutive TIMED crushes on a set piece
   *  (contracts.ts's setpiecePasses). */
  goal: number;
  launches: number;
  /** The exact inventory, for a pattern Contract. Empty otherwise. */
  queue: PieceType[];
  /** The special material a lines Contract's belt carries, for the hub card's
   *  preview strip (contractCardHTML). Optional because the older callers of
   *  this shape (the standalone board's fixtures) never carried it. */
  material?: Material | null;
  brief: string;
}

/**
 * A shipment multiset as a compact tally — a MINIATURE of each shape left, with
 * the count beside it. Used everywhere a pattern Contract's set is stated: the
 * card (what you're accepting), the HUD (what's left), the end screen (what you
 * had). One renderer so those three can never disagree about the same set.
 *
 * IT USED TO BE LETTERS — `I×3 O×1`, each glyph in its own piece colour — on
 * the argument that at 5-8 shipments a row of little shape grids reads as
 * decoration while a tally reads as an inventory. Two things retired that:
 *
 *   The letter is not the piece. "I", "S" and "Z" are names a player learns
 *   from somewhere else; the SHAPE is what they are about to be handed and what
 *   they are planning a fit for. A manifest that has to be translated back into
 *   silhouettes before it can be planned against is doing half the job — and
 *   the translation is exactly the work the row exists to save.
 *
 *   And the row it lives on could not carry a letter anyway. The plant panel's
 *   manifest row drew at the shared shell's 6px floor, which is five pixels of
 *   cap, on a phone; the R5 pass raised the two rows beside it to 9-13px and
 *   left this one the smallest type on the panel (the owner's report, off
 *   staging). A miniature answers that in a way type cannot: it is legible at a
 *   size a letterform is not — colour plus silhouette across a 2x4 grid whose
 *   cell is 6.5px on the tightest row in the matrix, where a letter had five
 *   pixels of cap — and it costs that row less width than the letter-plus-"×n"
 *   it replaces.
 *
 * The count rides the miniature's own baseline (its floor), so a pair reads as
 * one item and a row of them reads as an inventory — which was the old
 * comment's point, and is still the point. `PIECE_TYPES` order, only the types
 * still owed, and an em-dash when nothing is (the Contract is over, and a row
 * of nothing at all would read as a rendering fault).
 *
 * Sizing is the CALLER'S, in em: app.css's MANIFEST TALLY section draws the
 * miniature one em tall, so the HUD's 13px figure, the board card's --fs-sm and
 * the end card's 15px each get a mini matching their own digits without this
 * function knowing about any of them.
 */
export function queueTallyHTML(queue: readonly PieceType[]): string {
  if (!queue.length) return `<span class="muted">—</span>`;
  return PIECE_TYPES.filter((t) => queue.includes(t))
    .map((t) => {
      const n = queue.filter((q) => q === t).length;
      // A SPAN, not a `<b>`, even though the count is a figure and every other
      // figure on the plant panel is one. `.pl-queue b` — the row's own value
      // rule — matches any `<b>` DESCENDANT, so a nested one silently
      // inherited the row's scroller declarations and its optical drop, which
      // lifted every count 0.195em off the baseline its miniature stands on
      // and hung it through the row's own clip. Those declarations belong to
      // the row's value; this is content inside it.
      return `<span class="queue-mini">${pieceMiniHTML(t)}`
        + `<span class="queue-mini__n">${n}</span></span>`;
    })
    // `<wbr>` between pairs, not a space: two inline-flex boxes with nothing
    // between them give the line NO break opportunity, and the board card's
    // supply line is a narrow column that has always wrapped — a seven-piece
    // manifest with no break in it leaves the card rather than taking a second
    // line. A space would also break, and would also cost a space's width on
    // every join, which is width the plant panel's row does not have (app.css's
    // MANIFEST TALLY section has the measurement). `<wbr>` is zero-width,
    // announces nothing, and leaves the whole gap to CSS, where the two gaps
    // that group a pair can be set against each other.
    .join("<wbr>");
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
        <p class="muted end__lede">${opts.won ? `${opts.name} cleared. Nothing was banked and nothing was spent — a drill never touches your save.` : opts.brief}</p>
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
 * THE RATCHET, ON FIRST ENCOUNTER (main.ts's draft state).
 *
 * The draft is the run's one mandatory commitment screen and the mechanic the
 * whole Deep Run is built around, and a player meets it ninety seconds into
 * their first run with two cards, a pair of numbers and no statement of the
 * rule. The cards themselves cannot carry it: each one has to say what ITS axis
 * costs, in one line, under time pressure — "you must take one, it is permanent
 * for the rest of the run, and the reward is that you chose which" is a
 * different sentence and there has never been anywhere to put it.
 *
 * Shown ONCE, ever (meta.ts's seenDraft), over the draft it describes, on the
 * same terms the Contract board's intro is shown over the board.
 */
export function draftIntroModal(opts: {
  /** Axes this hand deals. */
  offered: number;
  /** Notches this bay demands (hazards.ts's picksPerBay). */
  picks: number;
}): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--warn)">Bay cleared · the ratchet</div>
        <h2 class="display">Pick your poison</h2>
        <p class="muted end__lede">
          Every bay you clear deals <b>${opts.offered} difficulty axes</b>, and you must take
          ${opts.picks === 1 ? "a notch on <b>one</b>" : `<b>${opts.picks}</b> notches`}.
          It sticks for the <b>rest of the run</b>, and each further notch on the same axis
          costs more than the last.
        </p>
        <p class="muted">
          A notch is <b>pure cost</b> — there is no upside to find. The reward is that the
          axis you are equipped for is the one you can afford to take.
        </p>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="draft-intro-done">Got it</button>
      </div>
    </div>
  </div>`;
}

/**
 * THE REFIT YARD, ON FIRST ARRIVAL (main.ts's refit state).
 *
 * The other half of the same gap. Scrap is the one currency that DIES with the
 * run, so banking it is never a strategy — and a first-time player, holding a
 * number they have watched climb for three bays, does the thing every other
 * game has taught them to do with a currency and saves it.
 */
export function refitIntroModal(opts: {
  /** Scrap in hand right now. */
  scrap: number;
  /** Refit stops a run gets. */
  stops: number;
}): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--accent)">The refit yard</div>
        <h2 class="display">Spend it all</h2>
        <p class="muted end__lede">
          <b>${opts.stops} times a run</b> the bay ends here instead of at the next one.
          Scrap buys rungs of the systems you brought, and everything you buy lasts the
          <b>whole run</b>.
        </p>
        <p class="muted">
          Scrap is the <b>run's</b> currency, and it is <b>gone when the run ends</b>, win or
          lose. Banking it is not a strategy — spending it is.
        </p>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="refit-intro-done">Got it</button>
      </div>
    </div>
  </div>`;
}

/**
 * THE CONTRACT BOARD, ON FIRST OPENING (main.ts's contracts state).
 *
 * The board is where a Tier is actually COMPLETED — half of it is a Deep Run
 * clear and the other half is first-clear Contracts — and it introduced itself
 * nowhere. A player arriving from a freshly opened Tier 1 met three cards, a
 * daily seed and a salvage figure, with no statement of what any of it was for
 * or that failing here costs nothing.
 *
 * Shown ONCE, over the board it describes, and the numbers come from the same
 * tables the board's own cards read so the card and the board cannot disagree
 * about what a clear is worth.
 *
 * A modal over the screen rather than a state of its own: main.ts's padNavRoot
 * already scopes pad focus to a `.modal-scrim` when one is present, so this
 * takes the pad without any routing of its own.
 */
export function contractsIntroModal(opts: {
  /** Contracts a tier asks for (meta.ts's TIER_CONTRACTS_REQUIRED). */
  needed: number;
  /** Contracts the day deals. */
  daily: number;
  /** Salvage a first clear pays. */
  milestone: number;
  /** Whether the board below holds a PATTERN card — passed rather than assumed,
   *  even though a tier board always deals exactly one (contracts.ts's
   *  PATTERN_SLOT converts a fixed slot rather than adding a fourth). The card
   *  makes a claim about the three Contracts behind it and the honest source
   *  for that claim is the three Contracts, not a constant this file re-reads.
   *
   *  It exists because the sentence it branches was false about one of the
   *  three: a pattern Contract carries `launches: 0` and an exact `queue`
   *  instead, so "what limits you is a launch budget" described two of the
   *  cards on the board and contradicted the third — the one whose whole offer
   *  is the inventory. The guide's own Contracts topic already says both
   *  halves; this card is where a player meets them. */
  pattern: boolean;
}): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--accent)">The Contract Board</div>
        <h2 class="display">Free to fail</h2>
        <p class="muted end__lede">
          <b>${opts.daily} a day</b>, from a shared seed — everyone gets the same three.
          <b>No clock and no bankroll</b>: what limits you is a launch budget${
            opts.pattern
              ? ` — except the <b>pattern</b> card, which hands you an exact set of shipments instead`
              : ""
          }. A lost attempt costs nothing and you can retry as often as you like.
        </p>
        <p class="muted">
          A <b>first clear</b> pays ${salvageHTML(opts.milestone, 11)} and ticks the tier.
          Clear <b>${opts.needed}</b> of them and win the Tier's run, and the next Tier opens.
        </p>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="contracts-intro-done">Got it</button>
      </div>
    </div>
  </div>`;
}

/**
 * THE PURCHASE THAT EXPLAINS ITSELF — offered once, at the moment a system is
 * first installed in the Workshop (main.ts's onBuyInstall).
 *
 * The bays already existed: drills.ts carries a `sys-<id>` practice bay per
 * track, flown at max tier so the lesson is the difference the system makes
 * rather than a tier-1 nudge nobody could feel in one bay. What was missing was
 * anyone OFFERING one. A player had to know the bay existed, know it lived
 * behind How to Play, and go and find it — which is the same failure the guide
 * itself was built to fix, one screen further in.
 *
 * A prompt rather than a redirect, because a purchase is not a request to leave
 * the shop: a player mid-spend usually has a second thing to buy. Declining is
 * an answer and is remembered (meta.ts's systemDrillsSeen records the OFFER),
 * so the shop never asks twice about the same track.
 */
export function systemDrillOfferModal(opts: {
  /** The system just installed. */
  name: string;
  /** Its practice bay's name and one-line brief (drills.ts's DrillSpec). */
  drill: string;
  brief: string;
}): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--success)">Installed · ${opts.name}</div>
        <h2 class="display">Try it?</h2>
        <p class="muted end__lede">${opts.brief}</p>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="sys-drill-go">${opts.drill} →</button>
        <button class="btn btn--ghost" data-action="sys-drill-skip">Not now</button>
      </div>
    </div>
  </div>`;
}

/**
 * THE SHORTFALL CARD — the Workshop's answer to a price the player cannot pay.
 *
 * Over the shop, on the end-card skeleton the drill offer uses. It says the
 * three things a refused purchase has to say: what it costs, how short the
 * player is, and WHERE SALVAGE COMES FROM — with the day's open Contracts as
 * pressable rows, because Contracts are what pay it and the shop is the
 * screen that creates the want (this replaced the foot's Contracts door, which
 * opened the retired standalone board). A run row when the tier's run still
 * pays; when nothing on this tier pays any more, it says so and offers the
 * next Tier's run instead of a board of free practice.
 *
 * `cards` are today's Contracts that would actually bank something on a tap —
 * open, uncleared, inside the day's allowance, quota not yet met — in the
 * board's own slot order, so `data-slot` is what main.ts's "contract" action
 * already reads.
 */
export function salvageShortModal(opts: {
  /** What was pressed, and its price. */
  name: string;
  cost: number;
  /** The bank. */
  have: number;
  /** Today's Contracts that still pay, in board order. */
  cards: { slot: number; name: string; pays: number }[];
  /** What the tier's run banks on a win, or null once it has. */
  runPays: number | null;
}): string {
  const short = Math.max(0, opts.cost - opts.have);
  const cards = opts.cards.length
    ? `<div class="ws-short__cards" role="group" aria-label="Today's Contracts">${
      opts.cards.map((c) =>
        `<button class="btn btn--secondary ws-short__card" data-action="contract" data-slot="${c.slot}" aria-label="Play ${c.name}, pays ${c.pays} salvage">
          <span class="ws-short__name">${c.name}</span>
          <span class="ws-short__pay">${salvageHTML(`+${c.pays}`, 12)}</span>
          ${icon("play", 10)}
        </button>`).join("")
    }</div>`
    : "";
  const earn = opts.cards.length
    ? `Clear a Contract to bank ${salvageHTML(`+${opts.cards[0].pays}`)}.`
    : opts.runPays !== null
      ? `Win the run to bank ${salvageHTML(`+${opts.runPays}`)}.`
      : "This Tier has paid out — the next Tier's Contracts and run pay again.";
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop ws-short">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--warn)">Workshop · ${salvageHTML(opts.have, 12)}</div>
        <h2 class="display">Not enough salvage</h2>
        <p class="muted end__lede">${opts.name} costs ${salvageHTML(opts.cost)} — ${short} short. ${earn}</p>
        ${cards}
      </div>
      <div class="row end__actions">
        ${opts.runPays !== null && !opts.cards.length
          ? `<button class="btn btn--primary" data-action="play">${icon("play", 10)}Start new run</button>`
          : ""}
        <button class="btn btn--ghost" data-action="ws-short-close">Not now</button>
      </div>
    </div>
  </div>`;
}

/**
 * End-of-lesson modal (game/school.ts) — drillEndModal's sibling, on the same
 * end-screen skeleton every other way out of a bay uses.
 *
 * What it does that a drill's does not is CARRY THE LADDER: a cleared lesson
 * offers the next one as its primary, because the whole difference between
 * Flight School and the guide's drills is that this is a sequence with an end
 * that opens something. A failed one offers the same lesson again, and the
 * brief is repeated over it for the reason drillEndModal repeats its own — a
 * player who just failed it is exactly the player who did not finish reading it.
 *
 * The last lesson's primary says so, and its subtitle is the only place in the
 * app that gets to announce the licence.
 */
export function lessonEndModal(opts: {
  won: boolean;
  /** The lesson's name. */
  name: string;
  /** Where this bay sits on the ground floor's LADDER, 1-based (meta.ts's
   *  schoolStepOfFlight) — the same number the card riding the bay printed. */
  step: number;
  total: number;
  /** The pass condition, repeated on a failure. */
  brief: string;
  lines: number;
  shotsUsed: number;
  /** 0 when the lesson hands out unlimited shipments, which every lesson now
   *  does — money is the budget above the Workshop. Kept as a parameter because
   *  the modal is also the shape a budgeted teaching bay would use. */
  launches: number;
  /** WHERE THE BANKROLL ENDED, on the lessons that have one (school.ts's
   *  `floatShots`). Null on lessons 1-4 and on every caller that predates the
   *  economy.
   *
   *  The card had two stats — rows and shots — on a bay that is now won on rows
   *  AND money, so a player who lost it to a broke bankroll read a result that
   *  never mentioned the thing that ended them. Both halves of the win
   *  condition, on the card that reports it. */
  funds?: { score: number; target: number } | null;
  /** What the ladder asks for NEXT, once this win is recorded — the card's
   *  "what's next" and the destination of its primary (meta.ts's
   *  schoolNextStep). Null once the ground floor is finished.
   *
   *  IT REPLACED A PAIR OF FLAGS (`licence`, `courseComplete`) that between
   *  them tried to answer the same question from the lesson's own position, and
   *  could not once two of the ladder's rungs stopped being bays: clearing
   *  lesson 4 no longer opens Tier 1, it opens the Contract board, and nothing
   *  the lesson knows about itself can say that. The ladder says it. */
  next: SchoolStepKind | null;
  /** True when this win FINISHED the ladder, for the first time — the one-time
   *  graduation copy. Never true on a replay. */
  courseComplete?: boolean;
  /** True when this lesson is the ladder's last LESSON, whether or not the win
   *  was the graduating one.
   *
   *  SPLIT FROM `courseComplete` because the two answer different questions and
   *  one flag answering both sent the player in a circle: on a finished save,
   *  replaying and winning lesson 9 is not a graduation, so `courseComplete`
   *  was false, so the primary read "Next lesson →" — and `lesson-next` clamps
   *  the index back to the last rung and restarts the lesson just completed,
   *  every time, for ever. The COPY belongs to the graduation; the forward
   *  ACTION belongs to the position. */
  lastLesson?: boolean;
}): string {
  const budget = opts.launches > 0
    ? `<div class="stat"><b style="color:var(--warn)">${Math.min(opts.launches, opts.shotsUsed)}/${opts.launches}</b><span>Launches</span></div>`
    : `<div class="stat"><b style="color:var(--warn)">${opts.shotsUsed}</b><span>Launches</span></div>`;
  // THE MONEY HALF, where there is one — and it wears the colour of whether it
  // landed, because on these bays it is a pass condition rather than a score.
  const money = opts.funds
    ? `<div class="stat"><b style="color:${
      opts.funds.score >= opts.funds.target ? "var(--success)" : "var(--warn)"
    }">$${opts.funds.score}<span class="price__sep">/</span>${opts.funds.target}</b><span>Funds</span></div>`
    : "";
  const stats = `<div class="stat-row">
      <div class="stat"><b style="color:var(--accent)">${opts.lines}</b><span>Lines</span></div>
      ${money}
      ${budget}
    </div>`;
  // THE TITLE IS THE LADDER'S, not the lesson's. "Licence Earned" used to land
  // on lesson 4 because lesson 4 was the licence; it is step 4 of ten now,
  // and the thing it earns is a Contract board.
  const opens = opts.won && (opts.next === "contract" || opts.next === "workshop");
  const title = opts.won
    ? (opts.courseComplete ? "Training Complete" : opens ? "Step Cleared" : "Lesson Landed")
    : "Run It Again";
  const blurb = opts.won
    ? (opts.courseComplete
      ? `Every Flight School exercise is cleared. Re-fly any of them whenever you want.`
      // WHAT ACTUALLY OPENED, named off the ladder. The two shop rungs are the
      // only ones where finishing a bay hands the player a different SCREEN,
      // and they are the two the old copy could not describe: it promised Tier
      // 1 on lesson 4 (the on-ramp had already made that false) and said
      // nothing at all on lesson 9.
      : opts.next === "contract"
        ? `That is the four basics. <b>The Contract board is open</b> — clear one card and it pays for your first system.`
      : opts.next === "workshop"
        ? `<b>Salvage banked.</b> Spend it in the Workshop on your first system — it opens the rest of the school.`
      : opts.next === "exam"
        // …AND THE CLOCK IS WHAT "FOR REAL" WAS HIDING. Every lesson bay is
        // built with `timeLimitSec = 0` on both branches of levelForLesson —
        // "one pressure at a time is the premise of the whole ladder, and the
        // clock is not taught until the exam" — while the graduation flight
        // goes through levelForRun (run.ts's levelForGraduation) and therefore
        // opens on Tier 1's own timeLimitFor(1). A player who has just flown
        // nine untimed bays has no reason to read "for real" as "and now there
        // is a clock", and meeting it for the first time under the one flight
        // on the ladder that can be failed is the worst place to learn it.
        //
        // THE SENTENCE IS CATCHING UP WITH THE BAYS, not changing them: no
        // lesson's timer moves, and the exam's is the run's own.
        ? `${opts.name} cleared — every lesson is behind you. <b>One flight left: the ${FINAL_EXAM}</b> — Tier 1, bay 1, for real, and the first bay with a <b>clock</b> running on it.`
      : opts.lastLesson
        // The top rung, re-flown. Not a graduation, and not silent about why
        // the button says "To the tower" instead of "Next lesson".
        ? `${opts.name} cleared — the last lesson. Pick another from the track below the school.`
      : `${opts.name} cleared.`)
    : opts.brief;
  // ONE primary, and it is the way FORWARD wherever there is one. A cleared
  // lesson that offered "Try again" first would be pointing at the thing the
  // player has just finished doing — and where forward is a SCREEN rather than
  // the next bay, the primary is that screen's own door, so the hand-off the
  // ladder just made is the button under the sentence that announced it.
  //
  // AND THE EXAM IS A BAY, so it is reached from here like any other rung:
  // "bay 10 should happen just after 9, no need to go out to the screen and
  // back in" (owner). The button is the same `lesson-next` the other rungs
  // use — main.ts asks the ladder what comes after the bay just flown and
  // starts the graduation flight when that is the answer — so this card does
  // not need to know it is the ninth; it needs to know what is next.
  const forward = opts.won && opts.next === "contract"
    ? `<button class="btn btn--primary" data-action="tiers">${icon("contracts", 12)}To the tower →</button>`
    : opts.won && opts.next === "workshop"
      ? `<button class="btn btn--primary" data-action="workshop">${icon("workshop", 12)}Workshop →</button>`
    : opts.won && opts.next === "exam"
      ? `<button class="btn btn--primary btn--next" data-action="lesson-next">${FINAL_EXAM} →</button>`
      : null;
  // `lastLesson` and not `courseComplete`: there is no next LESSON from the top
  // rung whether or not this particular win was the graduating one. What there
  // may be is the exam, and `forward` above has already claimed the primary
  // when the ladder still owes it; this is the finished save's replay, where
  // the way out is the tower.
  const done = opts.courseComplete || opts.lastLesson;
  const primary = forward ?? (opts.won
    ? (done
      ? `<button class="btn btn--primary" data-action="lesson-exit">To the tower →</button>`
      : `<button class="btn btn--primary" data-action="lesson-next">Next lesson →</button>`)
    : `<button class="btn btn--primary" data-action="lesson-retry">${icon("retry", 12)}Try Again</button>`);
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--warn)"}">Flight School · ${opts.step}/${opts.total}</div>
        <h2 class="display">${title}</h2>
        <p class="muted end__lede">${blurb}</p>
        ${stats}
      </div>
      <div class="row end__actions">
        ${primary}
        ${
          // NO SECOND BUTTON WHEN THE PRIMARY IS ALREADY THE EXIT. On a
          // course-complete win the primary reads "To the tower →" and this
          // ghost read "Back to the tower" — two buttons side by side, same
          // `lesson-exit`, differently worded, on the one card in the app that
          // is supposed to be a moment. A pad-navigable row of two identical
          // destinations is also one more focus stop for nothing.
          //
          // A hand-off to a SHOP keeps it, though, and that is not the same
          // case: the primary goes somewhere else, so the tower is still worth
          // one quiet button.
          opts.won && done && !forward
            ? ""
            : `<button class="btn btn--ghost" data-action="lesson-exit">${
              opts.won ? "Back to the tower" : "Leave school"
            }</button>`
        }
      </div>
    </div>
  </div>`;
}

/**
 * THE GRADUATION FLIGHT'S FAILURE — the ground floor's tenth and last step, handed
 * back.
 *
 * NOT a lesson card, because the bay is not a lesson: it is Tier 1 bay 1 with
 * the money, the clock and the fine live (run.ts's levelForGraduation), and a
 * card headed "Run It Again" over a Lines/Launches pair would report a teaching
 * bay's two numbers about a bay that has four. And not the run-end card either,
 * because there is no run: no score to file, no board to post to, no bays
 * cleared, and — the one that matters — no SEAL. A seal is a record of how a
 * Mark fell (meta.ts's sealedMarks) and this flight is not a Mark, so the
 * retry here costs nothing and must not be dressed as though it does.
 *
 * What it is instead is the tutorial's own bay-1 failure card
 * (coachFailHTML) minus the one block that has gone stale by this point in the
 * ladder: that card's NEXT STEP paragraph tells the player to clear a Contract
 * and buy a Reactor, which are the two gates and are behind them. The
 * DIAGNOSIS is shared rather than re-written (coachFailSteps reads the loss
 * reason against the bay's own numbers), because "why did that bay end" has one
 * right answer and two copies of it would drift.
 */
export function examFailHTML(
  reason: LossReason | null,
  level: { launchCost: number; scorePerLine: number; targetScore: number; startingFunds: number },
  step: number,
  total: number,
): string {
  const s = coachFailSteps(reason, level);
  // NAMED, NOT NUMBERED-AND-NAMED. The eyebrow used to carry the bay's own
  // title beside the step, which on this one flight is "Tier 1 bay 1" — a true
  // description of the bay and the wrong name for the FLIGHT. One name for it
  // everywhere (meta.ts's FINAL_EXAM), and the bay's terms are what the
  // diagnosis below is already made of.
  return `<div class="modal-scrim" id="scrim">
    <div class="coach coach--fail">
      <div class="coach__card">
        <div class="coach__eyebrow">Flight School · ${step}/${total} · ${FINAL_EXAM}</div>
        <div class="coach__title">${s.title}</div>
        <p class="coach__body">${s.body}</p>
        <div class="coach__foot coach__foot--fail">
          <button class="btn btn--primary btn--lg btn--block" data-action="exam-retry">${icon("retry", 13)}Fly it again</button>
          <div class="row coach__foot-row">
            <!-- THE BAY IS FREE TO RETRY AND SO IS EVERYTHING ELSE ON THIS
                 FLOOR: nothing on the ground floor can be lost, and the two
                 exits say so by being ordinary. Re-flying a lesson is a real
                 answer to failing the exam — the advanced five are where the
                 fine, the streak and the congestion tax were taught — so the
                 tower is the second door rather than the only one. -->
            <button class="btn btn--ghost" data-action="lesson-exit">Back to the tower</button>
          </div>
        </div>
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
  kind: "lines" | "pattern" | "setpiece";
  /** The numerator the bay was judged on: rows cleared on the two line-counting
   *  kinds, and the best run of consecutive timed crushes on a set piece
   *  (game.ts's bestTimedStreak). */
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
  /** This clear has just funded the ON-RAMP's purchase: still no system
   *  installed, and the salvage now covers one (meta.ts's nextStep answering
   *  "workshop"). It takes the primary, because this is the hand-off the whole
   *  re-ordering turns on — the card that sends the player to another Contract
   *  here is the card that leaves them wondering what the salvage was for. */
  firstSystem?: boolean;
  /** The attempt came off the SCHOOL's board — the ground floor's first gate
   *  (contracts.ts's schoolBoard). It swaps the award row, and only that row:
   *  the ladder's own is `Tier 1 · Contracts 1/3`, which tells a player who has
   *  just cleared the one card their floor deals that they owe three of them
   *  and a Deep Run. The settlement is not wrong — the clear really did tick a
   *  tier-1 half and bank its milestone — but the card reporting a quota to
   *  somebody who cannot see the board it belongs to is. Same precedent as
   *  `sandbox` and `skydeck` above: a clear whose meaning is not the ladder's
   *  gets a row that says what it IS. */
  school?: boolean;
  /** The attempt was launched from Tier S rather than from the daily board.
   *  Swaps the award row for one that says nothing was banked, and points both
   *  exits back at the sandbox — a practice Contract has no board to return
   *  to, and the daily board is not it. */
  sandbox?: boolean;
  /** The attempt came off the SKYDECK's board (contracts.ts's
   *  SKYDECK_CONTRACT_TIER), which is not a tier.
   *
   *  Same shape as `sandbox` above and for the same reason, which is the
   *  precedent this file already set: a mode whose clear banks nothing gets a
   *  row that SAYS so, rather than borrowing the ladder's. Without it a first
   *  roof clear arrives here with `award.firstClear` true and takes the ladder
   *  branch below — captioning a clear that moved nothing as "Tier 10 ·
   *  Contracts 0/3" with three more owed and a Deep Run to fly. The settlement
   *  was never wrong (recordContractClear banks and ticks nothing off the
   *  ladder); the card was. It is the third time in this repo that the
   *  celebration has outrun the state it was celebrating.
   *
   *  It differs from `sandbox` in exactly one way, and the difference is real:
   *  a Tier S Contract has no board to go back to, and a Skydeck one does. So
   *  the exits are untouched here. */
  skydeck?: boolean;
}): string {
  const pattern = opts.kind === "pattern";
  const setpiece = opts.kind === "setpiece";
  const supplyLabel = pattern ? "Shipments" : "Launches";
  const supplyTotal = pattern ? opts.queue.length : opts.launches;
  const stats = `<div class="stat-row">
      <div class="stat"><b style="color:var(--accent)">${opts.lines}/${opts.goal}</b><span>${
    // The stat has to name what it counted. "Lines" over a set piece's 2/3
    // would read as two rows out of three, when what it says is that the
    // longest run of timed crushes was two and the card asked for three.
    setpiece ? "Best streak" : "Lines"
  }</span></div>
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
      : setpiece
        // NAMES WHAT BROKE IT, not what the streak reached — the stat row above
        // already prints the run's length, and a card that said it twice would
        // spend its one sentence agreeing with the number beside it. A player
        // who ran out of launches on a set piece knows how far they got; what
        // they need is the rule that kept resetting them.
        ? "A row the press had to grind, or a cube short of the zone, starts the count over. A shot that closes nothing does not."
        : "Nothing lost — a Contract costs you nothing to retry.";
    return `<div class="modal-scrim" id="scrim">
      <div class="panel modal end end--contract pop">
        <div class="end__main">
          <div class="eyebrow" style="color:var(--danger)">${opts.name}</div>
          <h2 class="display">${heading}</h2>
          <p class="muted end__lede">${why}</p>
          ${stats}
        </div>
        <div class="row end__actions">
          <button class="btn btn--primary" data-action="contract-retry">${icon("retry", 12)}Try Again</button>
          <button class="btn btn--ghost" data-action="${opts.sandbox ? "sandbox" : opts.skydeck ? "contracts" : "tiers"}">${
            opts.sandbox ? "Tier S" : opts.skydeck ? "Contract Board" : "Tower"
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
      : opts.skydeck
      // THE ROOF'S OWN WIN, ahead of every award branch below rather than
      // folded into one of them. All three of those read `progress`, which is
      // markUnlocked's tier — a number this clear cannot move and therefore
      // cannot honestly caption. The quiet "Already logged" replay row is no
      // safer: its one claim is that the Contract "counted on your first
      // clear", and off the ladder it never counted for anything.
      //
      // So the roof gets one row for both the first clear and every replay,
      // because on this floor there is no difference between them worth
      // drawing — nothing banked either time. It reuses `--quiet`'s styling
      // (nothing moved, so nothing shouts) and the tower's own ★, which is the
      // face the plate already wears for this floor.
      ? `<div class="salvage-row salvage-row--quiet">
        <div class="salvage-row__amt">★</div>
        <div class="salvage-row__body">
          <b>Skydeck · logged</b>
          <span class="muted">The roof's board is not a rung, so this clear banks nothing and
            moves no quota — the ladder is already behind you. It is on the day's record, and
            it stays replayable.</span>
        </div>
      </div>`
      : opts.school
      // THE LADDER'S ROW. It states the two facts the ground floor's fifth rung
      // actually settles — what banked, and what that buys next door — and
      // deliberately no quota: the school's board is one card, so "1 of 3"
      // would be a bill for two Contracts this player has no way to be dealt.
      ? `<div class="salvage-row">
        <div class="salvage-row__amt salvage-row__amt--tier">${salvageHTML(`+${opts.award?.salvage ?? 0}`, 16, true)}</div>
        <div class="salvage-row__body">
          <b>Flight School · Contract cleared</b>
          <span class="muted">${
            opts.nextInstall
              ? `That is exactly what ${opts.nextInstall.name} costs (${salvageHTML(opts.nextInstall.cost)}).`
              : `That is exactly what your first system costs.`
          } Install it in the Workshop — it opens the rest of the school.</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
      : opts.award?.firstClear && opts.award.completedTier !== null
      ? `<div class="salvage-row salvage-row--tier-done">
        <div class="salvage-row__amt">${salvageHTML(`+${opts.award.salvage}`, 16, true)}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.award.completedTier} complete!</b>
          <span class="muted">Run beaten and ${p.needed} Contracts cleared — ${
            // NOT `p.tier`. That is markUnlocked read after the update, and it
            // saturates: on the last rung it named the floor the player had
            // just finished flying as the one that had opened, which is how
            // "all completed but not unlocked" gets reported.
            tierOpenedClause(opts.award.completedTier)
          }. <b>${opts.salvageTotal} salvage banked.</b>${target}</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
      : opts.award?.firstClear
        ? `<div class="salvage-row">
        <div class="salvage-row__amt salvage-row__amt--tier">${opts.award.salvage > 0 ? salvageHTML(`+${opts.award.salvage}`, 16, true) : `T${p.tier}`}</div>
        <div class="salvage-row__body">
          <b>Tier ${p.tier} · Contracts ${p.contracts}/${p.needed}</b>
          <span class="muted">${
            opts.award.salvage > 0
              ? `<b>${salvageHTML(`+${opts.award.salvage}`)} banked</b> — ${opts.salvageTotal} salvage total.`
              : ""
          } ${
            p.contracts >= p.needed
              ? `Contracts done — ${p.runDone ? "" : "beat the run to "}complete the tier (${salvageHTML(p.award)} total per tier).`
              : `${p.needed - p.contracts} more Contract${p.needed - p.contracts === 1 ? "" : "s"}${p.runDone ? "" : " and the run"} to complete the tier (${salvageHTML(p.award)} total per tier).`
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
  const primaryIsBoard = !opts.firstSystem && !opts.boardComplete && !opts.nextContract;
  // WHERE "THE BOARD" IS. The Skydeck keeps its own Contract screen, but a
  // tier's Contracts live inline on the hub now (tierHubScreen's earn row), so a
  // tier clear hands the player back to the hub rather than to a screen the tier
  // no longer has.
  const boardAction = opts.skydeck ? "contracts" : "tiers";
  const boardLabel = opts.skydeck ? "Contract Board" : "To the tower";
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--success)">${opts.name} · cleared</div>
        <h2 class="display" style="color:var(--success)">Contract Complete</h2>
        <p class="muted end__lede">
          ${
            pattern
              ? `${opts.goal} lines from the exact manifest — <b>nothing wasted</b>.`
              // A SET PIECE DELIVERED NO LINE COUNT worth celebrating — it can
              // be cleared on three rows of a fourteen-row bay — so the win
              // names the run instead. The spare-launch flourish still applies:
              // it is the same skill expression on the same budget, and on this
              // kind it says something sharper, which is that the streak came
              // together without needing the misses the card allowed for.
              : setpiece
                ? `<b>${opts.goal}</b> rows in a row, every one of them timed${spare > 0 ? `, with <b>${spare}</b> launch${spare === 1 ? "" : "es"} unspent` : ""}.`
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
            // AHEAD OF THE BOARD, because the board is no longer the forward
            // move: the clear that pays for the first system is the moment the
            // on-ramp hands over to the shop, and the next card would be a
            // detour past the thing that opens the Deep Run.
            : opts.firstSystem
              ? `<button class="btn btn--primary" data-action="workshop">Install your first system →</button>`
            : opts.boardComplete
              ? `<button class="btn btn--primary" data-action="workshop">Workshop →</button>`
              : opts.nextContract
                ? `<button class="btn btn--primary" data-action="contract-next">Next: ${opts.nextContract.name} →</button>`
                : `<button class="btn btn--primary" data-action="${boardAction}">${boardLabel} →</button>`
        }
        <button class="btn btn--secondary" data-action="contract-retry">${icon("retry", 12)}Play Again</button>
        ${
          opts.sandbox || primaryIsBoard
            ? ""
            : `<button class="btn btn--ghost" data-action="${boardAction}">${boardLabel}</button>`
        }
      </div>
    </div>
  </div>`;
}
