import "./styles/app.css";
import { Game, type GameStatus } from "./game/game";
import { makeBaseLevel } from "./game/level";
import {
  newRun, advanceRun, levelForRun, finalRunScore, isRefitBay, isFinalDraft, baysUntilRefit,
  buyUpgrades, bayMusic, RUN_LEVELS, type RunState,
} from "./game/run";
import { finalsForTier, type FinalDef, type FinalId } from "./game/finals";
import {
  hazardOffers, hazardById, picksPerBay, togglePick, HAZARDS,
  type HazardDef, type HazardId, type Ratchets,
} from "./game/hazards";
import { previewRows } from "./game/preview";

/** A run's ratchets with a draft's tentative picks folded in — the map the
 *  next-bay projection is drawn from, and the same map onPickHazard's confirm
 *  banks. Written once so the preview can never disagree with what confirming
 *  actually does. */
function withPicks(ratchets: Ratchets, picks: HazardId[]): Ratchets {
  const out: Ratchets = { ...ratchets };
  for (const id of picks) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/** A run's ratchets flattened to "axis:notches" for telemetry, in ladder order
 *  so two runs with the same build produce byte-identical strings. */
function axisNotchList(ratchets: Ratchets): string[] {
  return HAZARDS
    .filter((h) => (ratchets[h.id] ?? 0) > 0)
    .map((h) => `${h.id}:${ratchets[h.id]}`);
}
import {
  MAX_TIER, clearTrack, newTiers, orderRungs, orderSize, refitTracks, stageTier, upgradeById,
  type RefitOrder, type UpgradeId, type UpgradeTiers,
} from "./game/upgrades";
import {
  INSTALLS, UNLOCKS, buyInstall, contractClaimed, installAvailable, markUnlocked, newMeta, nextStep,
  recordContractClear, recordRunEnd, safeLoadout, tierProgressFor, unlockAvailable,
  unlockById, TIER_CONTRACTS_REQUIRED, type MetaState, type TierResult,
} from "./game/meta";
import {
  dailyContracts, generateContract, levelForContract, contractBed, variantSpec,
  PATTERN_SLOT, type Contract, type ContractBed, type ContractVariant,
} from "./game/contracts";
import { SANDBOX } from "./lib/sandbox";
import { maxedTiers, newSandbox, type SandboxState } from "./game/sandbox";
import { sandboxScreen } from "./ui/sandbox-screen";
import { render } from "./game/render";
import { shipmentColor } from "./game/theme";
import { AttractDemo } from "./game/attract";
import * as telemetry from "./lib/telemetry";
import {
  computeLayout,
  getRailSlots,
  RAIL_GAP,
  RAIL_SLOTS_BASE,
  railSlotsFor,
  setRailSlots,
} from "./game/layout";

import { InputController } from "./game/input";
import { MIN_FIRE_RATIO } from "./game/cannon";
import {
  actionForKey, resetKeyBindings, resetPadBindings, setKeyBinding, setPadBinding,
  type BindableAction, type InputProfile,
} from "./game/bindings";
import { GamepadPoller } from "./game/gamepad";
import { setRailSide } from "./game/layout";
import { beltPieceHTML, beltBombHTML, beltSealedHTML, formatMMSS } from "./ui/components";
import * as S from "./ui/screens";
import { fetchLeaderboard, submitScore, type ScoreEntry } from "./lib/api";
import { compactorSpeedFor } from "./game/compactor";
import {
  loadSettings, saveSettings, loadName, saveName, loadBest, saveBest,
  loadMeta, saveMeta, loadBaysPlayed, bumpBaysPlayed, type Settings,
} from "./lib/store";
import {
  lockLandscape, isPortrait, tapHaptic, successHaptic, impactHaptic, readyHaptic,
  hapticsSupported,
  autoEnterFullscreenForRun, toggleFullscreen, isFullscreen, fullscreenSupported,
  applySafeAreaInsets, purgeNativeServiceWorker,
} from "./lib/platform";
import {
  initPurchases, purchasesReady, isUnlimited, onUnlimitedChange,
  presentPaywall, presentCustomerCenter, restorePurchases,
} from "./lib/purchases";
import {
  unlockAudio, setAudioEnabled, playFx, playImpact, playLineClear, playBondBreak,
  playExplosion, playUiClick, playUiConfirm,
  playMusic, playStinger, stopStinger, setCongestion, suspendAudio, resumeAudio, musicLevel,
} from "./lib/audio";

type AppState =
  | "splash" | "menu" | "howto" | "settings" | "controls" | "leaderboard" | "workshop"
  | "playing" | "bayclear" | "refit" | "draft" | "paused" | "won" | "lost"
  | "contracts" | "contract-end" | "coach-fail"
  // Developer sandbox. Present in the union unconditionally — a state name is
  // free, and a conditional type would mean every switch below needed a second
  // shape. Reaching it is what is gated (see SANDBOX).
  | "sandbox";

const STEP = 1000 / 60;
/** Most physics steps one rendered frame may run to catch the simulation up
 *  to wall-clock time — see the loop() accumulator for why this is capped.
 *
 *  2, down from 4: profiled at a full bay (OnePlus 12, 2026-08-09), one step
 *  costs ~7.6ms, so a 4-step frame is ~30ms of physics before a pixel is
 *  drawn — deep enough that the catch-up itself keeps missing vsync and the
 *  loop LATCHES in multi-step frames until the pile shrinks. At 2 the worst
 *  frame owes ~15ms of physics: a device that falls behind dilates time a
 *  little sooner, but its frames stay short enough to recover next vsync,
 *  which reads as smooth-but-briefly-slow instead of stuttering. */
const MAX_CATCHUP_STEPS = 2;

/**
 * States whose overlay covers the canvas outright, so the field behind it is
 * not worth drawing — see the loop()'s render gate.
 *
 * Membership is a fact about the MARKUP, not a preference: every screen listed
 * here renders a `.screen.neon-backdrop` (ui/screens.ts), which is
 * `position: absolute; inset: 0` over a background that bottoms out at an
 * opaque `var(--bg)` (styles/tokens.css). Nothing behind one of them reaches a
 * pixel.
 *
 * The modal states are deliberately NOT here. `.modal-scrim` is
 * `rgba(4,4,10,0.72)` over a `backdrop-filter: blur(4px)` (styles/app.css), so
 * the bay really is visible through a pause card, a draft or a run-end panel,
 * and skipping the draw there would empty the canvas behind them.
 */
const COVERS_CANVAS = new Set<AppState>([
  "splash", "menu", "howto", "settings", "controls",
  "leaderboard", "workshop", "contracts", "sandbox",
]);

/** How long the misfire guide stays up. One pass of the corrective animation
 *  (app.css's --hint-correct-dur) plus a beat to read the end pose. The
 *  onboarding loop runs 3400ms and repeats forever, which is right for an
 *  invitation and wrong for an answer to something the player just did. */
const MISFIRE_GUIDE_MS = 1750;
/** Matches --hint-show-dur (tokens.css's --dur-slow), the hint's own fade. */
const MISFIRE_GUIDE_FADE_MS = 260;
/** Quiet window between guides. A player fumbling repeatedly is fighting their
 *  grip, not failing to understand the gesture; replaying the lesson on every
 *  one of those turns an explanation into nagging. The sound still fires each
 *  time — that is the part that says "nothing was launched". */
const MISFIRE_GUIDE_MIN_GAP_MS = 4000;

/** How long a pointer must stay pressed on a Bond Breaker trigger before the
 *  charge is actually spent (see startBondHold).
 *
 *  A Bond Breaker is the run's rarest consumable — one stock granted once for
 *  the whole ten-bay run, not a per-bay refill (run.ts's bondChargesFor) — and
 *  both of its triggers sit on the same glass a thumb is already dragging the
 *  slingshot across. A tap was enough to spend one, so a graze was too: a
 *  finger reaching for ⟲ and missing, or a hand resting on the bezel, could
 *  burn the charge the player was saving for bay 9. This is the same accident
 *  input.ts's MIN_FIRE_RATIO gate exists for, answered the same way — the
 *  press has to say it meant it.
 *
 *  1000ms is long enough that no graze survives it and short enough that a
 *  deliberate press does not feel like a wait. Published to CSS as
 *  `--bond-hold` when the hold starts, so the charge meter on the button and
 *  the timer that spends the charge are the same number and cannot drift. */
const BOND_HOLD_MS = 1000;
/** How far a held thumb may wander outside its trigger before the hold is read
 *  as "moved off it" and cancelled. A press on a rail button is made with the
 *  fat part of a thumb and wobbles by a few px while it sits there; sliding
 *  deliberately away is the escape hatch, and 24px (~4mm) separates the two. */
const BOND_HOLD_SLOP = 24;

class App {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private guard: HTMLElement;

  private state: AppState = "splash";
  /** Developer sandbox settings. Constructed unconditionally (it is a plain
   *  object) but only ever READ behind SANDBOX — see lib/sandbox.ts. */
  private sandbox: SandboxState = newSandbox();
  private game: Game | null = null;
  /** The self-playing demo on the main menu (game/attract.ts). Owns its own
   *  Game, canvas and rAF loop, and only exists while the menu is up — see
   *  syncAttract. */
  private attract = new AttractDemo();
  private input: InputController;
  private settings: Settings = loadSettings();

  /** The current roguelite run (seed, level index, carried surplus, drafted
   *  mods). Null only before the first "Play" — startGame() creates it. */
  private run: RunState | null = null;
  /** The difficulty axes on offer in the between-bay draft (hazards.ts). */
  private pendingOffers: HazardDef[] = [];
  /** Axes taken at THIS draft, before it closes. Mark 10 asks for two, so a
   *  pick is banked here rather than applied straight to the run — otherwise
   *  the first pick would re-render the modal with the second offer already
   *  ratcheted, and a player who changed their mind mid-draft could not tell
   *  which half of the choice had landed. */
  private pendingPicks: HazardId[] = [];
  /** The two Final Inspection clauses on offer at the run's LAST draft
   *  (finals.ts), or empty at every other draft. Non-empty is what puts the
   *  draft into inspection mode — the two drafts share a state and a modal
   *  shell but not a hand, and a single flag would have to agree with the hand
   *  it describes. */
  private pendingFinals: FinalDef[] = [];
  /** The clause SELECTED at the inspection and not yet accepted. One id, never
   *  a list: the two clauses are mutually exclusive readings of the same
   *  inspection, so the hand is exactly one at every Tier — including the
   *  capstone, where the ordinary draft asks for two notches. */
  private pendingFinal: FinalId | null = null;
  /** Tiers STAGED at the refit stop and not yet paid for (upgrades.ts's
   *  RefitOrder). Nothing here has touched RunState.tiers or spent a point of
   *  scrap: Undock is the single commit (run.ts's buyUpgrades), which is what
   *  lets the yard redraw the next bay's projected numbers under a whole build
   *  before the player buys any of it. Same contract as pendingPicks two
   *  screens later. Cleared on entering the stop and on committing. */
  private refitOrder: RefitOrder = {};
  /** Persistent meta-progression state (salvage + unlocks — see game/meta.ts).
   *  Loaded once at boot and written back on every purchase/run end. */
  private meta: MetaState = loadMeta();
  /** Which half of the Workshop shop is showing. Lives here, not in the DOM:
   *  renderOverlay() rewrites overlay.innerHTML wholesale and both purchase
   *  handlers call it, so a :checked-sibling or :target tab would snap back to
   *  Systems on every buy (and :target would push history entries besides). */
  /** What the run that just ended did to tier progress, held so the end modal
   *  can show it without recomputing (and so re-rendering the modal — e.g.
   *  after the leaderboard fetch lands — can't award a completion twice). */
  private lastTier: TierResult | null = null;
  /** Timer that auto-advances the bay-clear celebration; cleared if the player
   *  taps through it first. */
  private bayClearTimer: number | null = null;

  /** The Contract being played, or null in Deep Run. Its presence is what puts
   *  the whole app in Contract mode: no run advances, no salvage is paid, and
   *  a loss costs nothing (see onGameStatus). */
  private contract: Contract | null = null;
  /** How congested the bay is, 0 (clean) to 1 (worst tier), as reported by
   *  game.ts's onCongestion. Held here rather than only pushed to the mixer
   *  because the cue has to be MUTED off-screen and restored on the way back:
   *  onCongestion fires on crossings only, so a bay paused while congested and
   *  then resumed would come back silent until the pile happened to move. */
  private congestion = 0;
  /** The crest's beat (see syncHud): the music envelope currently painted
   *  onto the plant as --crest-beat, its running peak (for normalisation, so
   *  a quiet bed pulses as visibly as a loud one), and the last value
   *  actually written — style writes are skipped while the quantised value
   *  holds still. */
  private crestBeat = 0;
  private crestPeak = 0.05;
  private crestBeatShown = -1;
  /** Cached once: the beat is decoration in motion, so it is never driven
   *  under prefers-reduced-motion — the same call the crest's jiggle and
   *  spark animations make in app.css. */
  private motionMQ = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  /** The bed THIS Contract attempt drew (contracts.ts's contractBed), held for
   *  the life of the attempt instead of re-derived. syncMusic runs on every
   *  state change, so deriving it there would re-roll the 5% special each time
   *  the pause modal opened — and a bed that changes when you pause is worse
   *  than never getting the special at all. Non-null exactly while `contract`
   *  is, which is what lets syncMusic read the two as one. */
  private contractMusic: ContractBed | null = null;
  /** Forward route prepared when a Contract resolves, from that tier's board. */
  private nextContract: Contract | null = null;
  private contractBoardComplete = false;
  /** Rising-edge latch for the reload-ready cue (see syncHud). */
  private reloadWasReady = true;
  /** What the Contract just finished did to tier progress — whether this
   *  attempt was the first clear, and whether it completed the tier (see
   *  meta.ts's recordContractClear). Null until one resolves. */
  private contractAward: (TierResult & { firstClear: boolean }) | null = null;

  private dpr = 1;
  private last = 0;
  private acc = 0;
  /** Composite render key so the HUD's queue tiles refresh on rotation, bomb
   *  telegraph, or a piece-size mutator too — plus the identity half alone,
   *  which gates the arrival animation (see syncHud's queue block). */
  private lastNext: string | null = null;
  private lastNextId: string | null = null;
  private cachedBoard: ScoreEntry[] = [];
  private submitted = false;

  /** Finger-drag onboarding hint (see ui/screens.ts's dragHintHTML) — a 15s
   *  once-per-session idle timer, armed at each bay start. */
  private dragHintTimer: number | null = null;
  private dragHintShownThisSession = false;
  /** Timer clearing the misfire guide after its single play (see
   *  showMisfireGuide). Separate from dragHintTimer, which ARMS the onboarding
   *  loop — one schedules a start, the other an end, and sharing a handle would
   *  let a misfire cancel a pending onboarding hint. */
  private misfireGuideTimer: number | null = null;
  /** performance.now() of the last misfire guide, for its rate limit. */
  private lastMisfireGuide = -Infinity;

  /** INTERACTIVE COACH (issue #23) — current step of the first-run tutorial,
   *  or null when it isn't running. Runs on bay 1 of a Deep Run until
   *  settings.seenTutorial is set (finish or skip); each step advances when
   *  the player COMPLETES the taught action (a fired shot, a rotate tap, a
   *  cleared row — never a mid-gesture threshold), detected in syncCoach plus
   *  the onShoot/onLineClear callbacks. Step order matches screens.ts's
   *  coachSteps: fire, rotate, row, resources. */
  private tutorialStep: number | null = null;
  /** cannon.quarterTurns baseline captured on entering the rotate step, so
   *  "the player rotated" means a change from HERE, not from bay start. */
  private tutorialTurns = 0;

  /** Unsubscribe for the RevenueCat entitlement listener. */
  private offUnlimitedChange: (() => void) | null = null;

  /** Pointer currently holding the Autoloader trigger, or null. Tracked by id
   *  because the release can land anywhere — a thumb that slides off the button
   *  still has to stop the burst, so the listener is on window, not the
   *  button. */
  private autoPointerId: number | null = null;

  /** The Bond Breaker press currently being held down, or null (see
   *  BOND_HOLD_MS / startBondHold). `el` is the trigger being held — either of
   *  the ability's two — so only the button under the finger animates; `rect`
   *  is that button's box captured at press time, which is what the drift
   *  check measures against (nothing in the HUD moves mid-press, so measuring
   *  once is enough and keeps the move handler off getBoundingClientRect). */
  private bondHold:
    | { pointerId: number; el: HTMLElement; rect: DOMRect; timer: number }
    | null = null;

  /** The active input family (canvas D2), set by the LAST INPUT SEEN — a
   *  touch, a keypress, or gamepad activity. Every hint surface renders from
   *  it (the strip, the coach), so hints can never name a control the
   *  profile hides. Published as <html data-profile>. */
  private profile: InputProfile = "touch";
  /** Gamepad poller (canvas D1) — driven once per rendered frame from loop(). */
  private pad: GamepadPoller;
  /** Controls screen state: which tab, and which action is capturing a
   *  rebind (null = none). */
  private controlsTab: S.ControlsTab = "touch";
  private rebinding: BindableAction | null = null;
  /** Lifetime bays started (canvas D3) — past three, the finger-drag hint
   *  retires for good. Persisted; cached here so the hot path never reads
   *  localStorage. */
  private baysPlayed = loadBaysPlayed();

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <canvas id="game"></canvas>
      <div id="overlay"></div>
      ${S.rotateGuardHTML()}`;
    this.canvas = root.querySelector("#game")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.overlay = root.querySelector("#overlay")!;
    this.guard = root.querySelector("#rotate-guard")!;

    this.input = new InputController(this.canvas, () => this.game, this.onMisfire);

    this.overlay.addEventListener("click", this.onClick);
    this.overlay.addEventListener("pointerdown", this.onGamePointerDown);
    this.overlay.addEventListener("keydown", this.onKeydown);
    window.addEventListener("keydown", this.onGlobalKey);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    // iOS WKWebView: env(safe-area-inset-*) is not reliably populated at
    // first paint, and no `resize` necessarily follows once it is — the
    // visualViewport events plus a couple of settle re-measures make sure the
    // layout solver eventually sees the real insets instead of keeping
    // boot-time zeros forever (which parked the button rail on the field).
    window.visualViewport?.addEventListener("resize", this.onResize);
    window.setTimeout(this.onResize, 250);
    window.setTimeout(this.onResize, 1000);
    window.addEventListener("pointerdown", () => { unlockAudio(); this.syncAudioSettings(); },
      { once: true });
    window.addEventListener("pointerup", this.onGlobalPointerUp);
    window.addEventListener("pointercancel", this.onGlobalPointerUp);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) suspendAudio(); else resumeAudio();
    });
    window.addEventListener("pagehide", () => this.destroy());
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", this.onFullscreenChange);

    lockLandscape();
    // Before the first solve: the boot screens carry no abilities, so the rail
    // budget is the base buttons (two on fine-pointer devices, where the
    // CSS hides the game buttons; one fewer wherever no fullscreen toggle
    // mounts — the native shells, iPhone Safari). Without this the solver's
    // conservative default (a full seven-slot draft) could pick the
    // bottom-strip layout on a 360dp phone that the real rail fits fine.
    setRailSlots(railSlotsFor({
      bond: false, demo: false, auto: false,
      finePointer: this.finePointer(), fullscreen: fullscreenSupported(),
    }));
    // The rail's edge (Controls → left-handed rail) has to be set before the
    // first solve too — snug mode reserves the band on the rail's side.
    this.applyRailSide(false);
    // The starting input family: fine pointer means keyboard+mouse until an
    // input says otherwise (D2 — the profile follows the last input seen).
    this.setProfile(this.finePointer() ? "keyboard" : "touch");
    this.onResize();

    // Profile detection: the LAST input seen wins. Touch contact flips to
    // touch; any mouse/pen contact or keypress flips to keyboard; gamepad
    // activity flips in the poller's onActivity hook.
    window.addEventListener(
      "pointerdown",
      (e) => this.setProfile(e.pointerType === "touch" ? "touch" : "keyboard"),
      { capture: true },
    );

    this.pad = new GamepadPoller({
      game: () => this.game,
      playing: () => this.state === "playing",
      onActivity: () => this.setProfile("gamepad"),
      onPause: () => {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
      },
      onCapture: (button) => {
        if (this.state !== "controls" || this.controlsTab !== "gamepad" || !this.rebinding) {
          return false;
        }
        setPadBinding(this.rebinding, button);
        this.rebinding = null;
        this.renderOverlay();
        return true;
      },
      assist: () => this.settings.stickAssist,
    });

    // Fire-and-forget: nothing downstream waits on it, and on web it is a
    // no-op. See platform.ts — a native shell updated from an older build is
    // still pinned to that build's service-worker precache until this runs.
    void purgeNativeServiceWorker();

    // Store setup is fire-and-forget: it resolves after the splash on a cold
    // start, so re-render if the player is sitting on a screen that shows
    // store UI. Entitlement changes (renewal, expiry, a purchase on another
    // device) land on the same path.
    const restoreScreen = (): void => {
      if (this.state === "menu" || this.state === "settings") this.renderOverlay();
    };
    void initPurchases().then(restoreScreen);
    this.offUnlimitedChange = onUnlimitedChange(restoreScreen);

    this.setState("splash");
    window.setTimeout(() => {
      if (this.state === "splash") this.setState("menu");
    }, 1600);

    this.last = performance.now();
    requestAnimationFrame(this.loop);

    // Dev-only: exposes the App instance so Playwright can drive the
    // draft/end screens directly (pick-mod/skip-mod/restart etc.) without
    // having to play a full bay every time. Stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__tl = this;

    // Playtest recorder console handle. Deliberately NOT DEV-gated: a playtest
    // sitting should be possible against a preview or production build, since
    // that's what a player actually experiences. Recording still has to be
    // switched on by hand and nothing ever leaves the device — see
    // lib/telemetry.ts's privacy note.
    (window as unknown as Record<string, unknown>).__playtest = {
      on: (label?: string) => {
        telemetry.enable(true);
        if (label) telemetry.setLabel(label);
        return "recording ON — play some runs, then __playtest.download()";
      },
      off: () => { telemetry.enable(false); return "recording OFF"; },
      status: () => ({ recording: telemetry.recording(), ...telemetry.summary() }),
      download: () => telemetry.download(),
      json: () => telemetry.exportJSON(),
      clear: () => { telemetry.clear(); return "cleared"; },
    };
  }

  private destroy(): void {
    this.input.destroy();
    this.game?.destroy();
    this.attract.stop();
    this.clearBondHold();
    if (this.dragHintTimer !== null) window.clearTimeout(this.dragHintTimer);
    if (this.bayClearTimer !== null) window.clearTimeout(this.bayClearTimer);
    this.offUnlimitedChange?.();
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", this.onFullscreenChange);
  }

  // ---------------- state / rendering ----------------
  private setState(s: AppState): void {
    // Leaving play drops the Autoloader trigger: the rail button is about to
    // be replaced by a modal, so its pointerup will never arrive and the burst
    // would resume the moment play did.
    if (s !== "playing") this.releaseAutoTrigger();
    // Same reasoning for a Bond Breaker mid-hold: the trigger is about to be
    // replaced, so nothing would ever cancel the countdown, and it would spend
    // the charge into a paused bay a second after the player left it.
    this.clearBondHold();
    // The congestion cue belongs to the bay being PLAYED. Muted for every other
    // screen and restored on the way back in, so it cannot leak into a pause
    // modal, a draft or the menu — and cannot go missing after one.
    setCongestion(s === "playing" ? this.congestion : 0);
    // A rebind capture cannot outlive the Controls screen — a keypress on the
    // menu must never silently rebind Fire.
    if (s !== "controls") this.rebinding = null;
    this.state = s;
    this.syncMusic(s);
    this.renderOverlay();
    this.overlay.style.pointerEvents = s === "playing" ? "none" : "auto";
  }

  /**
   * One bed per context, switched from the single choke point every screen
   * change already passes through. playMusic() ignores a repeat of what's
   * already playing, so walking between the out-of-run screens keeps the one
   * lounge bed running instead of restarting it at every menu.
   *
   * The Deep Run gets a LADDER rather than one bed (run.ts's bayMusic): it is a
   * ten-bay arc, and the score should travel with it instead of looping a
   * single track across the whole thing. A Contract borrows one of those beds
   * per attempt, picked at startContract (contracts.ts's contractBed) and read
   * from `contractMusic` here — never re-derived, because this method runs on
   * every screen change and the pick has a random element.
   */
  private syncMusic(s: AppState): void {
    switch (s) {
      // Clearing a bay stops the bed and rings out over silence. Which
      // celebration you get is the run's own milestone logic: isRefitBay is
      // true on bays 3, 6 and 9 — the ones that open the shop — so the bigger
      // refit theme marks a checkpoint and the shorter one marks a bay.
      case "bayclear":
        playStinger(this.run && isRefitBay(this.run.levelIndex) ? "refit" : "bayClear");
        return;

      // …and keeps ringing across the refit and the hazard draft, which follow
      // within 1.7s. Deliberately NOT a music change: swapping in another
      // stinger here cut the celebration off a second and a half in and read as
      // a second, unexplained cue on the screen change. The player picks a
      // hazard in whatever silence is left once the sting ends.
      case "refit": case "draft": return;

      case "lost": case "contract-end": playStinger("gameOver"); return;
      case "won": playStinger("gameOver2"); return;

      case "playing":
        stopStinger();
        playMusic(this.contractMusic ?? bayMusic(this.run?.levelIndex ?? 0));
        return;

      // Pausing drops to the lounge bed: the driving track under a paused game
      // reads as pressure while nothing is happening.
      //
      // A tutorial failure gets the SAME treatment, and pointedly not "lost"'s
      // game-over sting: the run has not ended, the bay is about to be handed
      // straight back, and a funeral cue would tell the player the opposite of
      // what the card in front of them says.
      case "paused":
      case "coach-fail":
        stopStinger();
        playMusic("menu");
        return;

      // Everything out-of-run shares the menu bed.
      default:
        stopStinger();
        playMusic("menu");
    }
  }

  /** Turn a congestion tier into a cue level. Normalised against the bay's own
   *  ladder rather than a hardcoded 2, so adding a third rung re-spaces the cue
   *  instead of pinning the new worst tier alongside the old one. */
  private setCongestion(tier: number, tiers: number): void {
    this.congestion = tiers > 0 ? Math.min(1, Math.max(0, tier / tiers)) : 0;
    if (this.state === "playing") setCongestion(this.congestion);
  }

  private finePointer(): boolean {
    return window.matchMedia?.("(pointer: fine)").matches ?? false;
  }

  /** Flip the input family (D2) and refresh every surface that renders from
   *  it: the <html data-profile> hook, the HUD's hint strip, and the coach's
   *  current card — all patched in place, because a profile flip mid-bay
   *  must not re-mount the HUD the per-frame sync is patching. */
  private setProfile(p: InputProfile): void {
    const changed = this.profile !== p;
    this.profile = p;
    document.documentElement.dataset.profile = p;
    if (!changed) return;
    const g = this.game;
    if (!g) return;
    const strip = this.overlay.querySelector(".kbd-hint");
    if (strip) {
      strip.outerHTML = S.hintStripHTML(p, {
        bond: g.bondCharges > 0,
        demo: g.level.bombCharges > 0,
        auto: g.level.autoLaunchMs > 0,
      });
    }
    if (this.tutorialStep !== null && this.state === "playing") {
      this.mountCoach(S.coachHTML(this.tutorialStep, g.level, p));
    }
  }

  /** The left-handed rail (Controls → touch): the solver reserves its snug
   *  band on the chosen side (layout.ts setRailSide) and the CSS mirrors the
   *  column off <html data-rail-side>. */
  private applyRailSide(resize = true): void {
    const side = this.settings.leftHandRail ? "left" : "right";
    setRailSide(side);
    document.documentElement.dataset.railSide = side;
    if (resize) this.onResize();
  }

  /** Rail slot budget, latched per run. Abilities only ARRIVE at drafts, but
   *  their rail triggers can also VANISH mid-bay (a spent-down Bond Breaker
   *  stock hides its button, see hudOpts's bondBreakerOwned), and letting the
   *  budget shrink then would let the layout MODE flip — a field resize in the
   *  middle of play. Latching to the run's high-water mark keeps the geometry
   *  stable; a new run (or contract) resets it. */
  private railKey: object | null = null;
  private railSlotsLatch = RAIL_SLOTS_BASE;

  /** Back at the menu there is no rail, so the budget returns to the base
   *  buttons — a heavily drafted run must not keep pricing the menu's attract
   *  field after it ended. */
  private resetRailBudget(): void {
    this.railKey = null;
    this.railSlotsLatch = RAIL_SLOTS_BASE;
    const slots = railSlotsFor({
      bond: false, demo: false, auto: false,
      finePointer: this.finePointer(), fullscreen: fullscreenSupported(),
    });
    if (slots !== getRailSlots()) {
      setRailSlots(slots);
      this.onResize();
    }
  }

  /** Shared hudHTML() input for every state that renders the HUD — keeps the
   *  bay/time/next-piece fields consistent across playing/paused/draft/end.
   *  Also the one choke point where the rail's button set is decided, so it
   *  feeds the layout solver's slot budget (see railSlotsLatch above) as a
   *  side effect — every mount of the HUD re-solves with the real loadout. */
  private hudOpts(g: Game): Parameters<typeof S.hudHTML>[0] {
    const slots = railSlotsFor({
      bond: g.bondCharges > 0,
      demo: g.level.bombCharges > 0,
      auto: g.level.autoLaunchMs > 0,
      finePointer: this.finePointer(),
      fullscreen: fullscreenSupported(),
    });
    const key: object = this.run ?? g;
    if (key !== this.railKey) {
      this.railKey = key;
      this.railSlotsLatch = slots;
    } else {
      this.railSlotsLatch = Math.max(this.railSlotsLatch, slots);
    }
    if (this.railSlotsLatch !== getRailSlots()) {
      setRailSlots(this.railSlotsLatch);
      this.onResize();
    }
    return {
      beltPreview: g.beltPreview,
      // The transport's first queue slot (canvas A5): what the cannon is
      // holding, at its live rotation — a bomb tile while one is armed,
      // because that is what the next trigger pull actually fires.
      loaded: {
        bomb: g.bombArmed,
        type: g.cannon.currentType,
        quarterTurns: g.cannon.quarterTurns,
        empty: false,
        // Never hidden, even on a Blackout Contract. That variant darkens what
        // is COMING, not what is loaded — a bay that hides the piece in the
        // muzzle is not asking the player to manage risk, it is asking them to
        // guess (see game.ts's beltPreview).
        hidden: false,
        material: g.cannon.currentMaterial,
      },
      tier: this.run?.mark ?? null,
      profile: this.profile,
      target: g.target,
      score: g.score,
      // launchCostNow, not level.launchCost: under a congestion tier the shot
      // is priced above the bay's base rate (level.ts's PILE_TIERS), and the
      // whole mechanic depends on the player seeing the price BEFORE they fire.
      // A surcharge you only discover from a faster-falling bankroll teaches
      // nothing except that the game is cheating.
      launchCost: g.launchCostNow,
      bayNum: (this.run?.levelIndex ?? 0) + 1,
      timeLimitSec: g.level.timeLimitSec,
      timeLeftMs: g.timeLeftMs,
      pieceSize: g.level.pieceSize,
      // Owned == charges in hand: the Bond Breaker stock is a consumable run
      // resource now (see startLevel), so a spent-down stock hides the trigger
      // rather than leaving a dead button on the rail.
      bondBreakerOwned: g.bondCharges > 0,
      autoloaderOwned: g.level.autoLaunchMs > 0,
      bondCharges: g.bondCharges,
      demoOwned: g.level.bombCharges > 0,
      bombCharges: g.bombCharges,
      ratchets: this.run?.ratchets ?? {},
      // Only on the bay the clause actually applies to (run.ts's levelForRun
      // guards the same boundary): it is banked at the draft BEFORE that bay,
      // and a HUD that named it any earlier would be advertising a pressure
      // the bay on screen is not under.
      final: this.run && this.run.levelIndex === RUN_LEVELS - 1 ? this.run.final : null,
      tiers: this.run?.tiers ?? ({} as UpgradeTiers),
      // False in the native shells and on iPhone Safari — no fullscreen
      // button is rendered there at all (see screens.ts / platform.ts).
      fullscreenSupported: fullscreenSupported(),
      contract: this.contract
        ? {
            // The bay name and, when the Contract is a variant, what makes it
            // one. On the card the variant is a heading; in the plant readout
            // there is room for one line, so the two are joined — a player who
            // paused mid-bay has to be able to see WHICH rules they are under
            // without leaving the bay to re-read the card.
            name: this.contract.variant === "plain"
              ? this.contract.name
              : `${this.contract.name} · ${variantSpec(this.contract.variant).name}`,
            kind: this.contract.kind,
            goal: this.contract.goal,
            lines: g.linesTotal,
            // Whichever supply this Contract runs on — its shipment queue or
            // its launch budget. Exactly one of the two is finite (see
            // contracts.ts's levelForContract).
            launchesLeft:
              this.contract.kind === "pattern"
                ? g.piecesLeft
                : g.launchesLeft === Infinity
                  ? 0
                  : g.launchesLeft,
            remaining: g.piecesRemaining,
            // Cubes off the deck. On a lines Contract this is the launch
            // budget quietly draining — launchesFor priced the bay against
            // PLANNING_EFFICIENCY, and every cube lost is that margin being
            // spent. The panel renders it on lines Contracts only; see
            // screens.ts's hudHTML for why a pattern bay cannot use it.
            lost: g.lostTotal,
            conditions: this.contract.conditions,
            tier: this.contract.tier,
            // Only while THIS attempt would still bank the milestone the row
            // quotes — the same three-way gate recordContractClear settles on
            // (unclaimed, at the current tier, under the cap). The meta this
            // reads moves underneath the panel: recordContractClear advances
            // the tier BEFORE contract-end mounts its fresh HUD, so a clear
            // that completed a tier left the row advertising tier N+1's count
            // and salvage on a bay that is still tier N, and Play Again
            // re-rendered that same wrong deal on every replay. Null here
            // makes the row say Practice instead (screens.ts).
            progress: (() => {
              const p = tierProgressFor(this.meta);
              const banks =
                !contractClaimed(this.meta, this.contract.id) &&
                this.contract.tier === p.tier &&
                p.contracts < TIER_CONTRACTS_REQUIRED;
              return banks ? p : null;
            })(),
          }
        : null,
    };
  }

  /** The day's Contracts at the player's current tier. Tier tracks the Mark
   *  ladder, so clearing a Mark opens harder Contracts — the loop's other half
   *  (see docs/DESIGN.md). */
  private todaysContracts(): Contract[] {
    return dailyContracts(markUnlocked(this.meta));
  }

  private storeState(): S.StoreState {
    return { available: purchasesReady(), unlimited: isUnlimited() };
  }

  /** The cheapest system the player could install next — what the contract
   *  end's salvage row names as the price the payout is walking toward
   *  (canvas A10). Null once everything the tier allows is installed. */
  private nextInstall(): { name: string; cost: number } | null {
    const next = INSTALLS
      .filter((i) => installAvailable(this.meta, i))
      .sort((a, b) => a.cost - b.cost)[0];
    return next ? { name: upgradeById(next.id)!.name, cost: next.cost } : null;
  }

  private renderOverlay(): void {
    const g = this.game;
    switch (this.state) {
      case "splash": this.overlay.innerHTML = S.splashScreen(); break;
      case "menu":
        this.resetRailBudget();
        this.overlay.innerHTML = S.menuScreen(
          loadBest(), this.meta.salvage, this.storeState(), tierProgressFor(this.meta),
          // The first-session system (canvas A2/A3): the one computed NEXT
          // STEP, the live numbers for the subtitles, and the Guided
          // Tutorial entry until the coach has been finished or skipped.
          {
            step: nextStep(this.meta),
            install: this.nextInstall(),
            firstLaunch: !this.settings.seenTutorial,
          },
          SANDBOX,
        );
        break;
      case "workshop": this.overlay.innerHTML = S.workshopScreen(this.meta); break;
      // Guarded even here. Nothing can reach this state in a shippable build
      // (see onClick's sandbox cases), but a render path that would draw the
      // screen anyway is the kind of thing a later refactor turns back on by
      // accident, and the whole point of the gate is that it holds without
      // anyone having to remember it.
      case "sandbox":
        this.overlay.innerHTML = SANDBOX ? sandboxScreen(this.sandbox, this.meta) : "";
        break;
      case "contracts":
        this.overlay.innerHTML = S.contractsScreen({
          contracts: this.todaysContracts(),
          tier: markUnlocked(this.meta),
          // The PERSISTED clear list, not a session one. A Contract id embeds
          // the daily seed and tier, so today's board only ever matches today's
          // clears and the ticks reset themselves at the rollover — while a
          // tick that lived in memory vanished on any reload, which is exactly
          // when the player comes back to see what they'd already done.
          cleared: this.meta.claimedContracts,
          progress: tierProgressFor(this.meta),
          nextInstall: this.nextInstall(),
        });
        break;
      case "contract-end":
        if (g && this.contract) {
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.contractEndModal({
              won: g.status === "won",
              name: this.contract.name,
              kind: this.contract.kind,
              lines: g.linesTotal,
              goal: this.contract.goal,
              launchesUsed:
                this.contract.kind === "pattern"
                  ? g.shotsFired
                  : Math.min(this.contract.launches, g.shotsFired),
              launches: this.contract.launches,
              queue: this.contract.queue,
              // Cubes short of what the remaining lines still need — the exact
              // margin the attempt missed by, which is the one number worth
              // reading off a failed pattern bay.
              cubesWasted: Math.max(0, g.cubesRequired - g.cubesAvailable),
              award: this.contractAward
                ? {
                    firstClear: this.contractAward.firstClear,
                    completedTier: this.contractAward.completedTier,
                    salvage: this.contractAward.salvage,
                  }
                : null,
              progress: tierProgressFor(this.meta),
              salvageTotal: this.meta.salvage,
              nextInstall: this.nextInstall(),
              nextContract: this.nextContract ? { name: this.nextContract.name } : null,
              boardComplete: this.contractBoardComplete,
            });
        }
        break;
      case "howto": this.overlay.innerHTML = S.howtoScreen(); break;
      case "settings":
        this.overlay.innerHTML = S.settingsScreen(this.settings, this.storeState(), hapticsSupported());
        break;
      case "controls":
        this.overlay.innerHTML = S.controlsScreen({
          tab: this.controlsTab,
          settings: this.settings,
          padName: this.pad.detected(),
          rebinding: this.rebinding,
        });
        break;
      case "leaderboard":
        this.overlay.innerHTML = S.leaderboardScreen(
          S.leaderboardRowsHTML(S.fullBoard(this.cachedBoard)),
        );
        break;
      case "playing":
        if (g) {
          this.overlay.innerHTML = S.hudHTML(this.hudOpts(g));
          // Mounted separately rather than concatenated: the card belongs
          // INSIDE the plant panel's column (see mountCoach), which a sibling
          // string appended after the HUD cannot express.
          if (this.tutorialStep !== null) {
            this.mountCoach(S.coachHTML(this.tutorialStep, g.level, this.profile));
          }
          this.lastNext = null;
          this.lastNextId = null;
          this.syncCoachReveal();
        }
        break;
      case "paused":
        if (g) this.overlay.innerHTML = S.hudHTML(this.hudOpts(g)) + S.pauseModal(fullscreenSupported());
        break;
      case "bayclear":
        if (g && this.run) {
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.bayClearScreen({
              bayNum: this.run.levelIndex + 1,
              bayName: g.level.name,
              funds: g.score,
              target: g.target,
              lines: g.linesTotal,
              scrap: g.scrapEarned + g.level.scrapPerBay,
            });
        }
        break;
      case "refit":
        if (g && this.run) this.overlay.innerHTML = S.hudHTML(this.hudOpts(g)) + this.refitHTML();
        break;
      case "draft":
        if (g && this.run) this.overlay.innerHTML = S.hudHTML(this.hudOpts(g)) + this.draftHTML(g);
        break;
      // The tutorial handling its own failure. The HUD stays behind the card
      // on purpose: the numbers the card is explaining (Funds, Target, the
      // clock) are right there to be pointed at, which a run-end modal that
      // replaces the whole screen cannot do.
      case "coach-fail":
        if (g) {
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.coachFailHTML(g.lossReason, g.level, g.level.name);
        }
        break;
      case "won":
      case "lost":
        if (g && this.run) {
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.endModal({
              won: this.state === "won",
              score: this.finalScore(g, this.state === "won"),
              lines: this.run.linesTotal + g.linesTotal,
              baysCleared: this.run.levelIndex + (this.state === "won" ? 1 : 0),
              funds: g.score,
              best: loadBest(),
              name: loadName(),
              rows: S.leaderboardRowsHTML(
                S.endBoard(this.cachedBoard, loadName() || undefined),
                loadName() || undefined,
              ),
              reason: g.lossReason,
              bayNum: this.run.levelIndex + 1,
              bayName: g.level.name,
              runComplete: this.state === "won",
              // Post-run tier state: completion (if this run finished the
              // tier) plus where the tier stands now — the modal's payout row
              // became a progress row when salvage moved to tier completion.
              tierCompleted: this.lastTier?.completedTier ?? null,
              tierSalvage: this.lastTier?.salvage ?? 0,
              progress: tierProgressFor(this.meta),
              salvageTotal: this.meta.salvage,
              scrapEarned: this.run.scrapEarned + g.scrapEarned,
              // Banked bays plus the one still on screen. The current bay has
              // not been through advanceRun — and on a loss never will be — so
              // it has to be added here, exactly as scrapEarned above.
              salvagedFunds: this.run.salvagedFunds + g.salvagedFunds,
              tiers: this.run.tiers,
            });
        }
        break;
    }
    this.syncFullscreenButtons();
    this.syncAttract();
  }

  /**
   * Points the menu's attract demo (game/attract.ts) at the canvas this render
   * just created, or stops it when the menu isn't on screen.
   *
   * Run from renderOverlay rather than setState because the menu re-renders
   * for reasons that aren't state changes at all (a store entitlement
   * resolving, a Workshop purchase returning here), and each one replaces the
   * canvas element the demo was drawing into. AttractDemo.mount keeps the bay
   * running across the swap; only leaving the menu tears it down.
   *
   * Also called from onResize, for the portrait rotate-guard: it is opaque and
   * covers the entire app, so a phone held upright would otherwise sit there
   * simulating a physics world behind a "Rotate your device" card.
   *
   * `is-live` is added optimistically and taken back if the demo declines
   * (reduced motion, no 2D context) — the class is what hides the description
   * paragraph the demo replaces, so it must never outlive a demo that isn't
   * actually drawing. Added BEFORE mount() because it is also what gives the
   * canvas its box: measured while still `display: none`, the demo would size
   * its backing store to nothing.
   */
  private syncAttract(): void {
    const covered = this.guard.classList.contains("show");
    const host = this.state === "menu" && !covered
      ? this.overlay.querySelector<HTMLElement>(".menu__demo")
      : null;
    if (!host) {
      this.attract.stop();
      return;
    }
    const canvas = host.querySelector("canvas");
    host.classList.add("is-live");
    if (!canvas || !this.attract.mount(canvas)) host.classList.remove("is-live");
  }

  /** Reflects fullscreen STATE onto every fullscreen control currently
   *  mounted (the HUD icon button and/or the pause modal's row —
   *  renderOverlay() recreates both from scratch on every state change, so
   *  this needs to re-run each time, not just once at startup). Availability
   *  is decided earlier than this: where no Fullscreen API can do anything
   *  (the native shells, iPhone Safari), screens.ts renders no control at
   *  all — see platform.ts's fullscreenSupported — so there is nothing here
   *  to hide, only labels to keep honest. */
  private syncFullscreenButtons(): void {
    const fs = isFullscreen();
    this.overlay.querySelectorAll<HTMLElement>('[data-action="fullscreen"]').forEach((btn) => {
      btn.setAttribute("aria-label", fs ? "Exit fullscreen" : "Fullscreen");
      const label = btn.querySelector<HTMLElement>(".fs-label");
      if (label) label.textContent = fs ? "Exit Fullscreen" : "Fullscreen";
    });
  }

  private onFullscreenChange = (): void => {
    this.syncFullscreenButtons();
  };

  private onResize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);

    // Safe-area insets first: the layout solver subtracts them from the usable
    // box, so they have to be current before computeLayout runs. Measured from
    // real CSS env() values (see lib/platform's applySafeAreaInsets) rather
    // than guessed per-device.
    applySafeAreaInsets();

    // Publish the solved layout (see game/layout.ts) to CSS: the letterboxed
    // field rect the canvas actually draws in, the rail's button size, and the
    // layout MODE as a `data-layout` attribute on <html>. The DOM HUD chrome
    // (plant panel, conveyor belt, side rail, kbd-hint) anchors to the FIELD at
    // any window aspect rather than drifting with the viewport edges, and the
    // rail's placement rules key off the mode — see app.css's --field-*/--fpx
    // and [data-layout] consumers.
    const l = computeLayout(w, h);
    const rs = document.documentElement.style;
    rs.setProperty("--field-x", `${l.ox}px`);
    rs.setProperty("--field-y", `${l.oy}px`);
    rs.setProperty("--field-w", `${l.fw}px`);
    rs.setProperty("--field-h", `${l.fh}px`);
    // The same world->CSS scale as --fpx, UNITLESS, for the rules that need it
    // as a multiplier rather than as a length. --fpx is px-valued (it is one
    // world pixel), and CSS has no way to divide a length back down to a bare
    // number — so a `transform: scale()` that has to track the field, like the
    // drag hint's pull-back arc, cannot be written from --fpx alone.
    rs.setProperty("--fscale", String(l.scale));
    // Gutters actually available OUTSIDE the field on each axis — what the rail
    // positions against. In "snug" this is the reserved band, in "wide"/"tall"
    // the natural letterbox gutter; either way the rail reads one number and
    // never has to know which mode produced it.
    rs.setProperty("--gutter-r", `${Math.max(0, w - l.ox - l.fw)}px`);
    rs.setProperty("--gutter-l", `${Math.max(0, l.ox)}px`);
    rs.setProperty("--gutter-b", `${Math.max(0, h - l.oy - l.fh)}px`);
    rs.setProperty("--rail-btn", `${l.railSize}px`);
    // The gap the solver budgeted the column with — the CSS reads it back so
    // the rendered stack matches the fit prediction exactly.
    rs.setProperty("--rail-gap", `${RAIL_GAP}px`);
    document.documentElement.dataset.layout = l.mode;
    // `data-density` is the solver's one channel into the stylesheet's
    // structural switches (see game/layout.ts's Density). The continuous
    // uiScale behind it is deliberately NOT published as a custom property:
    // no rule ever consumed one (the responsive plan's "tokens as functions
    // of --ui-scale" task never landed), and publishing a channel nothing
    // reads claimed a mechanism the CSS does not have. Publish it again the
    // day a rule actually reads it.
    document.documentElement.dataset.density = l.density;

    const mobile = "ontouchstart" in window || w < 900;
    const covered = isPortrait() && mobile;
    this.guard.classList.toggle("show", covered);
    // The guard is opaque and covers the whole app, and it used to cover a bay
    // that KEPT RUNNING — physics stepping, the shift clock draining — behind a
    // card the player can neither see through nor reach past, so a rotation
    // (or a system overlay that resizes to portrait) could lose the run blind.
    // Going portrait mid-bay is a pause, exactly as if ⏸ had been tapped;
    // rotating back lands on the pause modal and resuming is the player's own
    // tap, never an ambush back into live physics.
    if (covered && this.state === "playing") this.pause();
    // The guard just went up or came down — the demo follows it (see
    // syncAttract). Cheap when nothing changed: mount() is a no-op once it's
    // already running against this canvas.
    this.syncAttract();
  };

  // ---------------- game lifecycle ----------------
  /** "Play"/"Play Again": starts a brand-new 10-bay run. Called synchronously
   *  from the Play/Start button's click handler (see onClick) — that's the
   *  one user gesture this auto-requests fullscreen from; browsers ignore
   *  fullscreen requests made outside a direct user-activation event, and
   *  every later transition (draft advance, bay restart) reuses whatever
   *  fullscreen state this call already established. */
  private startGame(): void {
    void autoEnterFullscreenForRun();
    // The run gets a SNAPSHOT of the player's unlocks (see run.ts's
    // RunState.unlocks): a Workshop purchase made mid-run can't retroactively
    // change this run's draft pool, and the run never has to reach back into
    // localStorage.
    const startingScrap = this.meta.unlocks.includes("scrap-cache") ? 30 : 0;
    this.run = newRun(
      Date.now() >>> 0,
      this.meta.unlocks,
      startingScrap,
      safeLoadout(this.meta),
      markUnlocked(this.meta),
    );
    this.contract = null;
    this.contractMusic = null;
    this.submitted = false;
    this.lastTier = null;
    telemetry.startRun(this.run.mark, this.run.tiers, this.run.unlocks);
    this.startLevel();
  }

  /** (Re)starts the Game for the run's current levelIndex. Level 1 plays at
   *  the base level's startingFunds; every later bay's LevelConfig already
   *  has startingFunds bumped by the carried surplus (see run.ts's
   *  levelForRun) — so the Game itself needs no run-awareness at all. */
  private startLevel(): void {
    if (!this.run) return;
    this.game?.destroy();
    this.congestion = 0;
    // levelForRun already seeds the bay's Bond Breaker charges from the run's
    // remaining magazine (RunState.bondCharges) — a consumable, not a per-bay
    // refill — so the config arrives complete and nothing is patched here.
    const cfg = levelForRun(this.run);
    this.game = new Game(cfg, {
      onShoot: (info) => {
        telemetry.shot(info); void tapHaptic(); playFx("shoot"); this.dismissDragHint(); this.coachOnShoot();
      },
      onLineClear: (n) => {
        telemetry.lineClear(n, this.game?.elapsedMs ?? 0);
        void successHaptic(); playLineClear(n); this.flashGoal(); this.coachOnLineClear();
      },
      onPieceLost: () => { void impactHaptic(); playFx("pieceLost"); },
      onBondBreak: () => {
        telemetry.ability("bond", this.game?.elapsedMs ?? 0); void impactHaptic(); playBondBreak();
      },
      onSettleStart: () => { void successHaptic(); playFx("settleStart"); this.showSettleNote(true); },
      onImpact: (strength) => playImpact(strength),
      onCryoShatter: () => playFx("cryoShatter"),
      onExplosion: (kind) => { void impactHaptic(); playExplosion(kind); },
      onBombArmed: (armed) => playFx("bombArm", { rate: armed ? 1 : 0.85 }),
      onCongestion: (tier, tiers) => this.setCongestion(tier, tiers),
      onStatus: (s) => this.onGameStatus(s),
    }, this.run.seed);
    telemetry.startBay({
      bay: this.run.levelIndex + 1,
      mark: this.run.mark,
      seed: this.run.seed,
      mode: "run",
      target: cfg.targetScore,
      timeLimitSec: cfg.timeLimitSec,
      cooldownMs: cfg.cooldownMs,
      launchCost: cfg.launchCost,
      scorePerLine: cfg.scorePerLine,
      compactorSpeed: compactorSpeedFor(cfg),
      compactorOpenCells: cfg.compactorOpenCells,
      compactorMinLineCells: cfg.compactorMinLineCells,
      tiers: this.run.tiers,
      notches: axisNotchList(this.run.ratchets),
      pieceSize: cfg.pieceSize,
    });
    // The coach runs on the FIRST bay of a Deep Run until it has been finished
    // or skipped once — set before setState so renderOverlay("playing") mounts
    // it with the HUD. A restart of bay 1 mid-tutorial starts it over, which
    // is the honest reset (the steps not yet performed weren't learned).
    this.tutorialStep =
      this.run.levelIndex === 0 && !this.settings.seenTutorial ? 0 : null;
    this.baysPlayed = bumpBaysPlayed();
    this.setState("playing");
    this.armDragHint();
  }

  /** Shows the finger-drag onboarding hint immediately on a brand-new
   *  player's very first bay (persisted via settings.seenDragHint);
   *  otherwise arms it as a once-per-session fallback if 15s pass at this
   *  bay's start with no shot fired. */
  private armDragHint(): void {
    if (this.dragHintTimer !== null) { window.clearTimeout(this.dragHintTimer); this.dragHintTimer = null; }
    // Back to the onboarding anchor. The misfire guide borrows this element and
    // leaves it pinned to wherever the last fumble was, which is nowhere in
    // particular by the time a new bay opens.
    this.overlay.querySelector("#drag-hint")?.classList.remove("drag-hint--at");
    // D3: past the first three bays the hint retires for good — the gesture
    // is learned, the rail is the control surface, and a looping finger over
    // a veteran's bay is chrome pretending to teach. (The counter is bumped
    // at bay start, so bays 1-3 still get the first-play and idle paths.)
    if (this.baysPlayed > 3) return;
    if (!this.settings.seenDragHint) {
      this.overlay.querySelector("#drag-hint")?.classList.remove("drag-hint--hidden");
    } else if (!this.dragHintShownThisSession) {
      this.dragHintTimer = window.setTimeout(() => {
        this.dragHintShownThisSession = true;
        this.overlay.querySelector("#drag-hint")?.classList.remove("drag-hint--hidden");
      }, 15_000);
    }
  }

  /**
   * A release that never pulled hard enough to count (cannon.ts's
   * MIN_FIRE_RATIO). Nothing was fired and nothing was spent — this is purely
   * the telling.
   *
   * Two layers, because they answer different questions and a player needs both
   * at different moments. The SOUND always plays: it answers "did anything
   * happen", which is the question a fumbled tap raises every single time, and
   * it costs nothing to answer. pieceLost pitched up and quiet, so the ear
   * files it under "cargo didn't make it" rather than under a new alarm.
   *
   * The GUIDE answers "what should I have done", and that one goes stale fast —
   * a player fumbling three times in four seconds is not failing to understand
   * the gesture, they are fighting their grip, and re-teaching them mid-fumble
   * is nagging. Hence the rate limit, and hence it stands down entirely while
   * the onboarding hint is already on screen showing the same thing.
   */
  private onMisfire = (clientX: number, clientY: number): void => {
    playFx("pieceLost", { rate: 1.5, gain: 0.42 });
    this.showMisfireGuide(clientX, clientY);
  };

  /**
   * Replay the finger-drag hint AT THE THUMB, as a correction rather than an
   * invitation.
   *
   * The same element and the same keyframes as the onboarding loop — its dot
   * already travels down and left, which is the gesture — repositioned and run
   * once. `drag-hint--at` is what switches its anchor from the fixed
   * field-relative one to the release point; the CLAMPING lives in the
   * stylesheet with the rest of that arithmetic, because the reason it exists
   * (the gesture reaches below its anchor and the plant panel is down there) is
   * already written down at --hint-clear, and splitting the two would let one
   * drift without the other.
   */
  private showMisfireGuide(clientX: number, clientY: number): void {
    const hint = this.overlay.querySelector<HTMLElement>("#drag-hint");
    if (!hint) return;
    // The onboarding loop is already demonstrating this. Two copies of one
    // lesson, one of them jumping to the thumb, reads as a glitch.
    if (!hint.classList.contains("drag-hint--hidden")) return;
    const now = performance.now();
    if (now - this.lastMisfireGuide < MISFIRE_GUIDE_MIN_GAP_MS) return;
    this.lastMisfireGuide = now;

    if (this.misfireGuideTimer !== null) window.clearTimeout(this.misfireGuideTimer);
    const at = this.fitGuideToField(hint, clientX, clientY);
    hint.style.setProperty("--hint-ax", `${at.x}px`);
    hint.style.setProperty("--hint-ay", `${at.y}px`);
    hint.classList.add("drag-hint--at");
    hint.classList.remove("drag-hint--hidden");
    // RESTART the keyframes, or this guide plays exactly once per page load.
    // `drag-hint--at` overrides duration/iteration-count/fill-mode but NOT
    // animation-name, so it re-parameterises the same hint-dot/hint-arc
    // animations rather than starting new ones. At iteration-count 1 with
    // fill-mode forwards, the first misfire runs them to their finished state
    // and they STAY there — re-adding the class on the second misfire changes
    // nothing, and the player gets an anchored, invisible box holding the last
    // keyframe (dot released, arc faded). Toggling the class cannot fix it for
    // the same reason: the animation is the same one throughout.
    //
    // cancel() then play() is the restart that works on a CSS animation whose
    // name never changed. Ordered after the class flip so the animations are
    // already carrying the --at timing, and after --hidden is dropped so they
    // are not still play-state: paused. Guarded because the reduced-motion
    // rule sets `animation: none`, where this correctly finds nothing to run.
    if (typeof hint.getAnimations === "function") {
      for (const anim of hint.getAnimations({ subtree: true })) {
        anim.cancel();
        anim.play();
      }
    }
    this.misfireGuideTimer = window.setTimeout(() => {
      this.misfireGuideTimer = null;
      hint.classList.add("drag-hint--hidden");
      // Held until the fade finishes: dropping --at at the same moment would
      // teleport the box back to its onboarding anchor mid-fade, so the last
      // thing the player sees is the guide sliding across the bay.
      window.setTimeout(() => hint.classList.remove("drag-hint--at"), MISFIRE_GUIDE_FADE_MS);
    }, MISFIRE_GUIDE_MS);
  }

  /**
   * Nudge the guide's anchor until the whole gesture is somewhere the player
   * can actually watch it.
   *
   * Two obstacles, and only one of them is unconditional. HORIZONTALLY the
   * field's edges always bound it — the pull travels left, so a thumb near the
   * left wall would drag the dot off the world. VERTICALLY only the plant panel
   * blocks, and only where the panel IS: it is opaque and sits above the canvas
   * (z-index 6), so a gesture drawn beneath it is a gesture nobody sees — but
   * the panel covers the bottom-LEFT, and a fumble out over the bay has clear
   * air under it. An earlier version clamped vertically without checking, and
   * hauled every right-hand fumble a couple of hundred px up the screen to
   * dodge a panel it was never over.
   *
   * The panel is MEASURED, not derived from its frame fractions, which is what
   * makes the tutorial's taller panel (and a Contract's shorter one) need no
   * special case at all — each is simply a different rect.
   *
   * The gesture's own dimensions come back out of the stylesheet (--hint-reach,
   * --hint-pull-x), so this and the animation cannot disagree about how far the
   * finger travels. Both are registered as <length> in app.css precisely so
   * they read back as numbers.
   */
  private fitGuideToField(hint: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
    const cs = getComputedStyle(hint);
    const num = (prop: string, fallback: number): number => {
      const v = parseFloat(cs.getPropertyValue(prop));
      return Number.isFinite(v) ? v : fallback;
    };
    // The box is 160px square and centred on its anchor (app.css's negative
    // margins), so the anchor sits HALF in from each edge of it.
    const HALF = 80;
    const reach = num("--hint-reach", 146);
    const pullX = num("--hint-pull-x", -35); // negative — the pull goes left
    const root = getComputedStyle(document.documentElement);
    const fx = parseFloat(root.getPropertyValue("--field-x")) || 0;
    const fy = parseFloat(root.getPropertyValue("--field-y")) || 0;
    const fw = parseFloat(root.getPropertyValue("--field-w")) || window.innerWidth;

    // Horizontal: the dot starts a little right of the anchor and travels
    // pullX left of that. Keep both ends on the field, with a little air.
    const PAD = 20;
    const minX = fx + PAD - pullX;
    const maxX = fx + fw - PAD;
    const x = Math.max(minX, Math.min(maxX, clientX));

    let y = Math.max(fy + 8, clientY);
    const plant = this.overlay.querySelector(".plant")?.getBoundingClientRect();
    if (plant && plant.height > 0) {
      // Does the gesture pass over the panel at all? Its span runs from the
      // dot's furthest reach left to a little right of the anchor.
      const gestureLeft = x + pullX - PAD;
      const gestureRight = x + PAD;
      if (gestureRight > plant.left && gestureLeft < plant.right) {
        // Same bound the onboarding anchor takes: the dot's deepest point
        // (box top + reach) must land above the panel, plus a little daylight.
        y = Math.min(y, plant.top - reach + HALF - 8);
      }
    }
    return { x, y: Math.max(fy + 8, y) };
  }

  /** Hides the drag hint for good once a real shot fires, and marks it seen. */
  private dismissDragHint(): void {
    if (this.dragHintTimer !== null) { window.clearTimeout(this.dragHintTimer); this.dragHintTimer = null; }
    // A real shot retires the misfire guide too. The --at anchor is NOT cleared
    // here: the element is mid-fade, and moving it back to the onboarding
    // anchor in the same frame would send the guide sliding across the bay on
    // its way out. armDragHint clears it instead, which is the moment the
    // anchor next has to be right.
    if (this.misfireGuideTimer !== null) {
      window.clearTimeout(this.misfireGuideTimer);
      this.misfireGuideTimer = null;
    }
    this.overlay.querySelector("#drag-hint")?.classList.add("drag-hint--hidden");
    if (!this.settings.seenDragHint) {
      this.settings.seenDragHint = true;
      saveSettings(this.settings);
    }
  }

  // ---------------- interactive coach (first-run tutorial, issue #23) -------
  /** Move the coach forward to step `to` (never backward — actions can arrive
   *  out of order, e.g. a shot fired straight from the aim step skips rotate
   *  rather than un-teaching it). */
  private coachAdvance(to: number): void {
    const g = this.game;
    if (this.tutorialStep === null || g === null || to <= this.tutorialStep) return;
    this.tutorialStep = to;
    // Entering the rotate step: rotation counts from here, not from bay start,
    // so a rotate tapped earlier can't satisfy the step retroactively. Safe to
    // snapshot even though the step is entered from a shot: onShoot fires
    // AFTER markShot resets the fresh piece's rotation, so the baseline read
    // here is the new piece's, and only a real ⟲/⟳ tap can move it.
    if (to === 1) this.tutorialTurns = g.cannon.quarterTurns;
    this.mountCoach(S.coachHTML(to, g.level, this.profile));
    this.syncCoachReveal();
  }

  /** Puts the coach card in the plant panel's FLOW, as its first child.
   *
   *  Not a layer over the panel: the card and the readout share the bottom-left
   *  rect, and an absolutely-positioned card sliced whatever the current step
   *  had just revealed — at step 4 the Funds figure ran y 213..258 against a
   *  card starting at 239, i.e. a big cyan number cut through the middle. Two
   *  boxes cannot overlap if they are siblings in the same column, so they are.
   *  This is also what lets the panel grow upward when card + readout exceed
   *  the mockup footprint (.plant is bottom-anchored, height auto).
   *
   *  renderOverlay emits the card AFTER the HUD string (it cannot nest it
   *  there without threading markup through hudHTML), so the freshly-parsed
   *  node gets moved in here; coachAdvance's later swaps replace it in place
   *  and keep the position. */
  private mountCoach(html: string): void {
    const plant = this.overlay.querySelector(".plant");
    const existing = this.overlay.querySelector("#coach");
    if (existing) {
      existing.outerHTML = html;
      return;
    }
    if (plant) plant.insertAdjacentHTML("afterbegin", html);
    else this.overlay.insertAdjacentHTML("beforeend", html);
  }

  /** Publishes the coach's step onto the HUD as `data-coach`, which is what
   *  drives the plant panel's PROGRESSIVE REVEAL (see app.css's
   *  `.hud[data-coach]` rules): a first-time player meets the readout one
   *  block at a time — Reload/Launches once the first shot is away (step 1),
   *  and the economy tier (title, Funds/Target, Time, the meta row, Build)
   *  when the card leaves and its space in the panel comes back. See the CSS
   *  for why that last tier waits for dismissal rather than landing on the
   *  step that explains it.
   *
   *  An ATTRIBUTE rather than a re-render: the plant's readouts are patched
   *  per-frame by syncHud against live element ids, so rebuilding the HUD on
   *  every step would fight that. CSS hides; nothing about the HUD's markup
   *  or its sync path changes. Absent attribute = full HUD, which is what
   *  every non-tutorial run (and every run after finishTutorial) gets. */
  private syncCoachReveal(): void {
    const hud = this.overlay.querySelector<HTMLElement>("#hud");
    if (!hud) return;
    if (this.tutorialStep === null) delete hud.dataset.coach;
    else hud.dataset.coach = String(this.tutorialStep);
  }

  /** Per-frame step detection (called from syncHud, so it reads the same live
   *  game state the HUD does). Only the rotate step advances from here — a
   *  ⟲/⟳ tap has no event of its own, so it's read off the cannon. The aim
   *  step deliberately does NOT advance on live drag state any more: it waits
   *  for coachOnShoot, i.e. the gesture COMPLETING. Advancing on mid-drag
   *  thresholds is what made the old deck's Power and Launch cards flash past
   *  unread — see coachSteps' one-card-per-completable-action note. */
  private syncCoach(g: Game): void {
    if (this.tutorialStep === 1 && g.cannon.quarterTurns !== this.tutorialTurns) {
      this.coachAdvance(2);
    }
  }

  /** The first completed shot finishes the aim/power/release card — unless
   *  the shot just loaded an O. The O is the one rotation-invariant piece, so
   *  mounting the rotate card over it would demonstrate that the button does
   *  nothing (playtest, 2026-08-09: "the rotate example ends up on a
   *  square"). Staying on the fire card one more shot costs little — the
   *  7-bag deals at most one O per seven shipments. */
  private coachOnShoot(): void {
    if (this.tutorialStep !== 0) return;
    if (this.game?.cannon.currentType === "O") return;
    this.coachAdvance(1);
  }

  /** A cleared row finishes the row step — and the rotate step too, if the
   *  player got there without ever tapping ⟲/⟳: a completed line is proof the
   *  lesson's GOAL is understood, and holding the card hostage to one specific
   *  input would stall the coach for a player who is already succeeding. */
  private coachOnLineClear(): void {
    if (this.tutorialStep === 1 || this.tutorialStep === 2) this.coachAdvance(3);
  }

  /** Finish or skip: drop the coach and persist the seen-flag so it never
   *  auto-runs again (the How to Play screen can replay it on demand). */
  private finishTutorial(): void {
    this.tutorialStep = null;
    this.overlay.querySelector("#coach")?.remove();
    // Skipping is a request for the full HUD, not a stripped one — the reveal
    // is a teaching aid, so it ends when the teaching does, however it ended.
    this.syncCoachReveal();
    if (!this.settings.seenTutorial) {
      this.settings.seenTutorial = true;
      saveSettings(this.settings);
    }
  }

  /** Composite leaderboard/best score for the run that just ended (`won` =
   *  the bay-10 clear; every other end is a loss). Bays cleared and lines
   *  weigh far more than the funds in hand — see run.ts's finalRunScore. */
  private finalScore(g: Game, won: boolean): number {
    const cleared = (this.run?.levelIndex ?? 0) + (won ? 1 : 0);
    return finalRunScore(cleared, (this.run?.linesTotal ?? 0) + g.linesTotal, g.score);
  }

  /**
   * Begin a Contract. Deliberately a separate path from startGame(): a Contract
   * has no RunState at all — no carried funds, no drafted mods, no refit stops,
   * nothing to advance — so routing it through the run machinery would mean
   * guarding every one of those with "unless it's a contract". Clearing
   * this.run is what keeps the two modes from bleeding into each other.
   */
  private startContract(c: Contract): void {
    this.game?.destroy();
    this.congestion = 0;
    this.run = null;
    this.contract = c;
    // Rolled here, once, because this is the start of an ATTEMPT — a retry is
    // a fresh roll (see contractBed), a pause is not.
    this.contractMusic = contractBed(c);
    this.nextContract = null;
    this.contractBoardComplete = false;
    // No coach in Contract mode — it teaches the Deep Run economy, and half
    // its steps (funds, target) don't exist here.
    this.tutorialStep = null;
    const cfg = levelForContract(c);
    this.game = new Game(cfg, {
      onShoot: (info) => {
        telemetry.shot(info); void tapHaptic(); playFx("shoot"); this.dismissDragHint();
      },
      onLineClear: (n) => {
        telemetry.lineClear(n, this.game?.elapsedMs ?? 0);
        void successHaptic(); playLineClear(n); this.flashGoal();
      },
      onPieceLost: () => { void impactHaptic(); playFx("pieceLost"); },
      onBondBreak: () => {
        telemetry.ability("bond", this.game?.elapsedMs ?? 0); void impactHaptic(); playBondBreak();
      },
      onSettleStart: () => { void successHaptic(); playFx("settleStart"); this.showSettleNote(true); },
      onImpact: (strength) => playImpact(strength),
      onCryoShatter: () => playFx("cryoShatter"),
      onExplosion: (kind) => { void impactHaptic(); playExplosion(kind); },
      onBombArmed: (armed) => playFx("bombArm", { rate: armed ? 1 : 0.85 }),
      onCongestion: (tier, tiers) => this.setCongestion(tier, tiers),
      onStatus: (s) => this.onGameStatus(s),
    }, c.seed);
    telemetry.startRun(0, {} as UpgradeTiers, []);
    telemetry.startBay({
      bay: 1, mark: c.tier, seed: c.seed, mode: "contract",
      target: cfg.objectiveLines,
      timeLimitSec: 0, cooldownMs: cfg.cooldownMs, launchCost: 0,
      scorePerLine: cfg.scorePerLine, tiers: {} as UpgradeTiers,
      compactorSpeed: compactorSpeedFor(cfg),
      compactorOpenCells: cfg.compactorOpenCells,
      compactorMinLineCells: cfg.compactorMinLineCells,
      notches: [c.brief], pieceSize: cfg.pieceSize,
    });
    this.baysPlayed = bumpBaysPlayed();
    this.setState("playing");
    this.armDragHint();
  }

  private onGameStatus(s: GameStatus): void {
    const g = this.game;
    if (!g) return;
    // CONTRACT: no run to advance, no salvage, no leaderboard. A loss here is
    // free by design — the whole point of the mode is that you can retry it.
    if (this.contract) {
      if (s !== "won" && s !== "lost") return;
      telemetry.endBay({
        result: s, reason: g.lossReason, secs: g.elapsedMs / 1000,
        // This call fires for both Contract kinds, but the HUD only has a
        // "Lost" column (screens.ts's hudHTML) on a "lines" one — see
        // BayRecord.lostPieces for what the field actually counts.
        lines: g.linesTotal, lostPieces: g.lostTotal, endScore: g.score,
      });
      telemetry.endRun(s === "won", 0);
      if (s === "won") {
        void successHaptic();
        // Log ONCE per Contract, ever — meta.claimedContracts is both the
        // once-ever gate and what ticks the board. A first clear at the
        // current tier advances tier progress, and may complete the tier —
        // which is the only event that pays salvage now (see meta.ts's
        // recordContractClear/advanceTier).
        const result = recordContractClear(this.meta, this.contract);
        if (result.firstClear) {
          this.meta = result.meta;
          saveMeta(this.meta);
        }
        const board = dailyContracts(this.contract.tier);
        const remaining = board.filter((c) => !this.meta.claimedContracts.includes(c.id));
        this.contractBoardComplete = remaining.length === 0;
        this.nextContract = remaining.find((c) => c.id !== this.contract?.id) ?? null;
        this.contractAward = result;
      } else {
        void impactHaptic();
        this.contractAward = null;
      }
      this.showSettleNote(false);
      this.setState("contract-end");
      return;
    }
    if (!this.run) return;
    if (s === "won" || s === "lost") {
      telemetry.endBay({
        result: s,
        reason: g.lossReason,
        secs: g.elapsedMs / 1000,
        lines: g.linesTotal,
        lostPieces: g.lostTotal,
        endScore: g.score,
      });
    }
    if (s === "won") {
      void successHaptic();
      this.showSettleNote(false);
      if (this.run.levelIndex < RUN_LEVELS - 1) {
        // Mid-run clear: CELEBRATE first, then draft. The Game is deliberately
        // NOT destroyed here — status "won" makes update() a no-op, so the rAF
        // loop keeps re-rendering the settled field (and its bayclear sweep FX)
        // behind the banner until startLevel() tears it down.
        // The offer is a function of the run seed, the bay and the Mark — NOT of
        // what the player owns. A hazard draft asks what you are prepared for,
        // so the table has to be the same whatever you brought to it.
        //
        // The ratchets are the one exception and a narrow one: they are read
        // only on a materials-only bay, and only to name the axis the run has
        // already committed to when there is a single material to pair with it
        // (hazards.ts's hardestActive). That is still not "what you own" — it
        // is what you have already chosen to suffer, which is exactly what the
        // rule above is protecting.
        //
        // Unless this is the LAST draft, which deals the Final Inspection
        // instead (finals.ts): two clauses on the final bay, one of which the
        // player accepts. A ratchet taken here would be a permanent commitment
        // one bay before permanence expires, which is the whole reason the last
        // draft deals something else.
        if (isFinalDraft(this.run.levelIndex)) {
          this.pendingFinals = finalsForTier(this.run.mark);
          this.pendingOffers = [];
        } else {
          this.pendingFinals = [];
          this.pendingOffers = hazardOffers(
            this.run.seed, this.run.levelIndex, this.run.mark, undefined, this.run.ratchets,
          );
        }
        this.pendingPicks = [];
        this.pendingFinal = null;
        this.setState("bayclear");
        this.bayClearTimer = window.setTimeout(() => this.afterBayClear(), S.BAY_CLEAR_MS);
      } else {
        // Bay 10 cleared: the run is complete.
        this.finishRun(true);
      }
    } else if (s === "lost") {
      void impactHaptic();
      this.showSettleNote(false);
      // A loss WHILE THE COACH IS RUNNING is a teaching moment, not a run end.
      // The tutorial explains what happened and offers the bay back (see
      // screens.ts's coachFailHTML) — deliberately BEFORE finishRun, so none
      // of its bookkeeping happens: no recordRunEnd (a fumbled tutorial must
      // not spend the player's run count or their tier progress), no saveBest,
      // no leaderboard submit on a run that scored nothing. The bay telemetry
      // above is already recorded, which is the half worth keeping.
      if (this.tutorialStep !== null) {
        this.setState("coach-fail");
        return;
      }
      this.finishRun(false);
    }
  }

  /** Toggles the "target met — settling" HUD note (see screens.ts's
   *  .settle-note). Patched in place rather than via a full renderOverlay so it
   *  can't restart the plant panel's entrance animation mid-bay. */
  private showSettleNote(on: boolean): void {
    this.overlay.querySelector("#settle-note")?.classList.toggle("show", on);
  }

  /** End of the bay-clear celebration: bank the bay into the run, then route to
   *  a REFIT stop if this clear earned one (every REFIT_EVERY-th bay — see
   *  run.ts's isRefitBay), otherwise straight to the modifier draft. Both paths
   *  end at the draft, so the refit is an extra stop rather than a replacement:
   *  ship upgrades and drafted contracts are different decisions and the player
   *  makes both. Idempotent — a tap-through and the timer both land here. */
  private afterBayClear(): void {
    if (this.bayClearTimer !== null) {
      window.clearTimeout(this.bayClearTimer);
      this.bayClearTimer = null;
    }
    if (this.state !== "bayclear") return;
    const g = this.game;
    if (!g || !this.run) return;
    // Bank the cleared bay NOW (not at draft-dismiss time) so the refit screen
    // can spend the scrap this bay just earned. advanceRun also steps
    // levelIndex, so everything downstream — the draft's "next bay" name, the
    // refit's bay counter — reads the same post-clear run state.
    this.run = advanceRun(
      this.run,
      g.score,
      g.target,
      g.linesTotal,
      g.scrapEarned + g.level.scrapPerBay,
      [],
      // What the bay ENDED with: Bond Breakers are the run's consumable, so
      // whatever this bay did not spend is what the next one opens with.
      g.bondCharges,
      g.salvagedFunds,
    );
    // isRefitBay takes the just-CLEARED bay's index, which advanceRun has
    // already stepped past — hence the -1.
    // A fresh yard ticket every stop: an order is tentative by construction, so
    // one that survived a bay would be scrap queued against a rig and a bankroll
    // that have both moved since.
    this.refitOrder = {};
    this.setState(isRefitBay(this.run.levelIndex - 1) ? "refit" : "draft");
  }

  /** Common run-end path for both a bay-10 win and any loss: record the run
   *  against tier progress (meta.ts's recordRunEnd — a WON run is one of the
   *  two halves of tier completion, and completion is the only salvage
   *  source), persist meta + best, refresh the board, show the end modal. */
  private finishRun(won: boolean): void {
    const g = this.game;
    if (!g || !this.run) return;
    const result = recordRunEnd(this.meta, this.run.mark, won, this.run.levelIndex + 1);
    this.lastTier = result;
    this.meta = result.meta;
    telemetry.endRun(won, result.salvage);
    saveMeta(this.meta);
    saveBest(this.finalScore(g, won));
    this.refreshBoard();
    this.setState(won ? "won" : "lost");
  }

  /** The refit stop's markup. Built here rather than inline in renderOverlay
   *  because refreshRefit renders it a second time, into a detached container,
   *  to lift the live regions out — two call sites, one set of options. Same
   *  idiom as draftHTML. */
  private refitHTML(): string {
    const run = this.run!;
    // The order as the yard would actually install it. buyUpgrades is the same
    // call Undock makes, so the projection is drawn against the run the player
    // will really be flying rather than against a second model of the purchase
    // — including the Bond Emitter's magazine delta, which lives in the commit
    // and not in the tier table. A refused order (impossible from the staging
    // rules, possible from a hand-edited attribute) projects as no change,
    // which is exactly what it would buy.
    const installed = buyUpgrades(run, this.refitOrder, MAX_TIER) ?? run;
    return S.refitScreen({
      // levelIndex has already been stepped past the cleared bay by
      // afterBayClear, so it IS the just-cleared bay's 1-based number, and
      // makeBaseLevel(levelIndex) is the bay about to be played.
      bayNum: run.levelIndex,
      nextBayName: makeBaseLevel(run.levelIndex).name,
      scrap: run.scrap,
      tiers: run.tiers,
      mark: run.mark,
      order: this.refitOrder,
      // Both sides come from levelForRun — the real pipeline the bay is built
      // from. The notch this bay's draft will add is deliberately not modelled:
      // it has not been offered yet, and folding a guess into both sides would
      // price the order against a bay nobody has chosen.
      //
      // NO BANKED RATCHETS, unlike the draft. Passing them pins every axis the
      // run carries as ACTIVE, which promotes it to "core" and puts it beyond
      // the compact grid's reach — and on a landscape phone four unmoved
      // pressure tiles were a whole row, pushing the rows the ORDER moved off
      // the bottom of the panel. On the draft that pin is right, because there
      // the decision IS the pressure (preview.ts's `active`, Codex #1); here
      // the decision is the ship, and a projection that crowds out its own
      // answer with context has failed at the job it exists for. Left as
      // ordinary context rows they still show wherever there is height for
      // them and drop only at compact density, which is the existing rule
      // doing exactly what it was written for.
      preview: previewRows(levelForRun(run), levelForRun(installed)),
    });
  }

  /** Refit stop: STAGE one tier of a system into the order. Nothing is bought
   *  here — the tiers live in `refitOrder` until "refit-done" commits the lot,
   *  which is what lets the yard redraw the next bay's projected numbers under
   *  a whole build before a point of scrap is spent.
   *
   *  The staging rules themselves live in upgrades.ts's stageTier, next to the
   *  ladder they price against and where the sim can reach them. A rejected
   *  stage (not installed, maxed, or more than the order can still afford) is a
   *  silent no-op — the button was already disabled, so this is the gate rather
   *  than the feedback. */
  private onStageUpgrade(id: string): void {
    if (this.state !== "refit" || !this.run) return;
    // Only tracks this Mark's refit actually offers (upgrades.ts's
    // refitTracks) — the screen never renders the others, so this is
    // belt-and-braces against a stale or hand-edited data-upgrade.
    if (!refitTracks(this.run.mark).some((u) => u.id === id)) return;
    const next = stageTier(this.run.tiers, this.refitOrder, id as UpgradeId, this.run.scrap);
    if (!next) return;
    this.refitOrder = next;
    void successHaptic();
    this.refreshRefit();
  }

  /** Refit stop: take a track's staged tiers back off the order — the second
   *  half of the card's one cycling button (upgrades.ts's clearTrack, which is
   *  where the all-not-one rule and its reasoning live). */
  private onUnstageUpgrade(id: string): void {
    if (this.state !== "refit" || !this.run) return;
    const next = clearTrack(this.refitOrder, id as UpgradeId);
    if (next === this.refitOrder) return;
    this.refitOrder = next;
    this.refreshRefit();
  }

  /** "refit-done": INSTALL the whole order, then undock into the draft.
   *
   *  The one commit of the stop (run.ts's buyUpgrades), and all-or-nothing: an
   *  order the run cannot actually pay for leaves the scrap banked rather than
   *  part-installing a build the player never saw projected. An empty order is
   *  the ordinary case — plenty of stops are worth walking past — so it undocks
   *  without touching the run at all. */
  private onRefitDone(): void {
    if (this.state !== "refit" || !this.run) return;
    const before = this.run;
    if (orderSize(before.tiers, this.refitOrder) > 0) {
      const next = buyUpgrades(before, this.refitOrder, MAX_TIER);
      if (next) {
        // One event per rung, each carrying the balance BEFORE that rung.
        // telemetry.ts stores the field as `scrapBefore`, and a yard that buys
        // six rungs at once must not report the post-batch balance for all six
        // — that is what makes refit affordability readable after the fact ("at
        // what balance did they stop buying?"), and a flat final figure answers
        // it wrong for every event including a single-rung order.
        //
        // The sequence is upgrades.ts's orderRungs, which is the same walk
        // buyUpgrades installs by, so the reconstruction cannot drift from the
        // purchase: subtracting each rung's price in turn lands exactly on
        // next.scrap.
        let scrap = before.scrap;
        for (const rung of orderRungs(before.tiers, this.refitOrder)) {
          telemetry.refit(before.levelIndex + 1, scrap, rung.id);
          scrap -= rung.cost;
        }
        this.run = next;
        void successHaptic();
      }
    }
    this.refitOrder = {};
    this.setState("draft");
  }

  /** Re-render the refit stop's live regions IN PLACE after a stage, rather
   *  than calling renderOverlay(). A full re-render recreates the
   *  `.panel.modal.pop` node, replaying its entrance animation on every tap —
   *  so a player assembling a three-tier order watches the whole modal fly in
   *  three times. Same reasoning (and same idiom) as refreshDraft and
   *  renderBoardRows patching their own live regions. */
  private refreshRefit(): void {
    if (!this.run || this.state !== "refit") return;
    // The innerHTML patch destroys the node keyboard focus is sitting on —
    // here that is the button the player just tapped, so a keyboard or D-pad
    // flow lost its place on every staged tier (D4, and the same fix
    // refreshDraft carries).
    const active = document.activeElement as HTMLElement | null;
    const btn = active?.closest("[data-upgrade]") as HTMLElement | null;
    const focusSel = btn
      ? `[data-action="${btn.getAttribute("data-action")}"][data-upgrade="${btn.getAttribute("data-upgrade")}"]`
      : active?.closest('[data-action="refit-done"]')
        ? '[data-action="refit-done"]'
        : null;
    // Render the screen to a detached container and lift the live regions out
    // — keeps one source of truth for the markup (screens.ts's refitScreen)
    // instead of a second copy that could drift.
    const tmp = document.createElement("div");
    tmp.innerHTML = this.refitHTML();
    for (const id of ["#refit-grid", "#refit-order", "#refit-preview", "#refit-foot"]) {
      const live = this.overlay.querySelector(id);
      const fresh = tmp.querySelector(id);
      // innerHTML, not textContent: every one of these regions carries drawn
      // glyphs (screens.ts's scrapHTML, the tier icons), and copying their text
      // alone would leave bare figures behind.
      if (live && fresh) live.innerHTML = fresh.innerHTML;
    }
    // The staged button can vanish (a track that just hit MAX loses it), so
    // fall back to the card's undo before giving up on focus entirely.
    const back = focusSel
      ? this.overlay.querySelector<HTMLElement>(focusSel)
        ?? (btn ? this.overlay.querySelector<HTMLElement>(`[data-upgrade="${btn.getAttribute("data-upgrade")}"]`) : null)
      : null;
    back?.focus();
  }

  /** Workshop: buy a permanent unlock with salvage. */
  private onBuyUnlock(id: string): void {
    const def = unlockById(id);
    if (!def) return;
    if (this.meta.unlocks.includes(id)) return;
    // Marks BEATEN, not the Mark attemptable — a capstone gated on Mark 3 must
    // need three clears, not two clears and permission to try the third. This
    // is the purchase path, so it is where the gate has to actually hold: the
    // Workshop's disabled button is presentation, this is enforcement.
    if (!unlockAvailable(def, this.meta.unlocks, this.meta.mark)) return;
    if (this.meta.salvage < def.cost) return;
    this.meta = {
      ...this.meta,
      salvage: this.meta.salvage - def.cost,
      unlocks: [...this.meta.unlocks, id],
    };
    saveMeta(this.meta);
    void successHaptic();
    this.renderOverlay();
  }

  /** Workshop: install a ship system with salvage.
   *
   *  Every refusal — gated Mark, already installed, unaffordable, over the
   *  Mark's build budget — lives in meta.ts's buyInstall, so a click the shop
   *  should not have offered is a no-op here rather than a second copy of the
   *  rules that could disagree with the first. */
  private onBuyInstall(id: string): void {
    const next = buyInstall(this.meta, id as UpgradeId);
    if (!next) return;
    this.meta = next;
    saveMeta(this.meta);
    void successHaptic();
    this.renderOverlay();
  }

  /** Workshop: switch shop halves. Anything other than the two known ids is
   *  ignored rather than defaulted, so a stale attribute cannot silently park
   *  the player on Systems forever. */

  /** "pick-hazard": TOGGLE one axis in the tentative hand. Nothing is banked
   *  here — the picks live in `pendingPicks` until "confirm-hazards" commits
   *  them, which is what lets the modal redraw the next bay's projected numbers
   *  under each candidate before the player spends the notch.
   *
   *  The toggle rules themselves live in hazards.ts's togglePick, next to the
   *  picksPerBay quota they depend on and where the sim can reach them.
   *
   *  There is still no skip: confirming is gated on a full hand (see
   *  onConfirmHazards), so the ratchet remains the mandatory price of the bay
   *  just cleared. */
  private onPickHazard(id: string): void {
    if (!this.run || this.state !== "draft") return;
    if (!hazardById(id)) return;
    // Only from the hand actually dealt — a stale or hand-edited data-hazard
    // must not let a player ratchet an axis their Mark has not opened.
    if (!this.pendingOffers.some((h) => h.id === id)) return;
    this.pendingPicks = togglePick(this.pendingPicks, id as HazardId, picksPerBay(this.run.mark));
    this.refreshDraft();
  }

  /** "pick-final": SELECT one Final Inspection clause, or clear it by tapping
   *  the one already selected.
   *
   *  A plain radio group rather than hazards.ts's togglePick, because the hand
   *  is exactly one at every Tier and the two clauses are alternatives rather
   *  than a hand being filled — there is no "double this one" reading of an
   *  inspection to preserve. Nothing is banked until "confirm-hazards", the
   *  same contract the ratchet draft keeps, which is what lets the projection
   *  redraw the final bay under each clause before the player commits. */
  private onPickFinal(id: string): void {
    if (!this.run || this.state !== "draft") return;
    // Only from the hand actually dealt — a hand-edited data-final attribute
    // must not let a player accept another Tier's clause.
    if (!this.pendingFinals.some((f) => f.id === id)) return;
    this.pendingFinal = this.pendingFinal === id ? null : (id as FinalId);
    this.refreshDraft();
  }

  /** The bay-clear ratchet modal's markup. Built here rather than inline in
   *  renderOverlay because refreshDraft renders it a second time, into a
   *  detached container, to lift the live regions out — two call sites, one
   *  set of options. */
  private draftHTML(g: Game): string {
    const run = this.run!;
    if (this.pendingFinals.length) return this.finalHTML(g, run);
    return S.draftScreen({
      // levelIndex has already been stepped past the cleared bay by
      // afterBayClear, so it IS the just-cleared bay's 1-based number, and
      // makeBaseLevel(levelIndex) is the bay about to be played.
      bayNum: run.levelIndex,
      bayName: g.level.name,
      tier: run.mark,
      nextBayName: makeBaseLevel(run.levelIndex).name,
      funds: g.score,
      // Read the carry the RUN actually recorded rather than recomputing it, so
      // what's displayed can't drift from what the next bay's float is really
      // getting (see advanceRun).
      carry: run.carry,
      offers: this.pendingOffers,
      ratchets: run.ratchets,
      selected: this.pendingPicks,
      picksNeeded: picksPerBay(run.mark),
      // Both sides of the projection come from levelForRun, so what the player
      // reads here is the config the bay is actually built from — run.ts stays
      // the single source of a bay's numbers, and a notch's effect is never
      // modelled twice.
      preview: previewRows(
        levelForRun(run),
        levelForRun({ ...run, ratchets: withPicks(run.ratchets, this.pendingPicks) }),
        // The BANKED ratchets, not the tentative hand: an axis with notches
        // already on the run is live pressure on the next bay whatever this
        // draft selects, so its rows stay on the projection flagged ACTIVE.
        run.ratchets,
      ),
      scrap: run.scrap,
      // Bay-CLEARS until the next refit stop, counting the bay about to be
      // played; 1 means "clear this one and you dock". Null late in a run when
      // no stop remains.
      baysToRefit: baysUntilRefit(run.levelIndex),
    });
  }

  /** The Final Inspection modal's markup — the last draft of a run (finals.ts).
   *
   *  Shares refreshDraft and the confirm action with the ratchet draft rather
   *  than growing a second app state: it is the same moment in the loop (a bay
   *  cleared, a cost accepted, the next bay begun) with a different hand, and a
   *  parallel state would have meant a parallel copy of the focus-restoring
   *  live-region patch below. */
  private finalHTML(g: Game, run: RunState): string {
    return S.finalScreen({
      bayNum: run.levelIndex,
      bayName: g.level.name,
      tier: run.mark,
      nextBayName: makeBaseLevel(run.levelIndex).name,
      funds: g.score,
      carry: run.carry,
      offers: this.pendingFinals,
      selected: this.pendingFinal,
      // Both sides come from levelForRun, so the projection is drawn from the
      // config the final bay is actually built from — the same rule the ratchet
      // draft follows, and the reason a clause's effect is never modelled twice.
      preview: previewRows(
        levelForRun(run),
        levelForRun({ ...run, final: this.pendingFinal }),
        run.ratchets,
      ),
      scrap: run.scrap,
    });
  }

  /** Re-render the draft's live regions IN PLACE on every toggle — the cards,
   *  the projection, the confirm button and the notch tally — rather than
   *  calling renderOverlay(). A full re-render recreates `.modal-scrim` and
   *  `.panel.modal.pop`, so their fade and entrance animations replay on every
   *  tap: the whole screen flashes, which is exactly the feedback the
   *  projection is trying to give with a 220ms pop on the tiles that MOVED.
   *  Same idiom as refreshRefit and renderBoardRows — render the screen to a
   *  detached container and lift the live regions out, so screens.ts stays the
   *  one source of the markup. */
  private refreshDraft(): void {
    if (!this.run || this.state !== "draft") return;
    const g = this.game;
    if (!g) return;
    // The innerHTML patch destroys the node keyboard focus is sitting on —
    // mid-draft that is the card the player just toggled, so a keyboard (or
    // D-pad) flow lost its place on every single choice. Remember which
    // control held focus and put it back on the fresh copy (D4).
    const active = document.activeElement as HTMLElement | null;
    // Both hands' cards, since the inspection reuses this patch (finalHTML).
    const card = active?.closest("[data-hazard]") ?? active?.closest("[data-final]");
    const attr = card?.hasAttribute("data-hazard") ? "data-hazard" : "data-final";
    const focusSel = card
      ? `[${attr}="${card.getAttribute(attr)}"]`
      : active?.closest('[data-action="confirm-hazards"]')
        ? '[data-action="confirm-hazards"]'
        : null;
    const tmp = document.createElement("div");
    tmp.innerHTML = this.draftHTML(g);
    for (const id of ["#draft-cards", "#draft-preview", "#draft-confirm", "#draft-notches"]) {
      const live = this.overlay.querySelector(id);
      const fresh = tmp.querySelector(id);
      if (live && fresh) live.innerHTML = fresh.innerHTML;
    }
    if (focusSel) this.overlay.querySelector<HTMLElement>(focusSel)?.focus();
  }

  /** "confirm-hazards": bank the tentative hand onto the run and fly the next
   *  bay. The bay itself was already banked into the run by afterBayClear (so a
   *  refit stop could spend its scrap), so this ONLY records the choice — it
   *  must not call advanceRun again or the run would skip a bay.
   *
   *  Re-checks the quota rather than trusting the button's disabled state: the
   *  gate is what makes the ratchet mandatory, and a gate that lives only in
   *  the markup is not a gate. */
  private onConfirmHazards(): void {
    if (!this.run || this.state !== "draft") return;
    // The Final Inspection banks a clause instead of notches. Gated on a chosen
    // clause for the same reason the ratchet is gated on a full hand: the pick
    // is the mandatory price of the bay just cleared, and a gate that lives
    // only in the markup is not a gate.
    if (this.pendingFinals.length) {
      if (!this.pendingFinal) return;
      this.run = { ...this.run, final: this.pendingFinal };
      this.pendingFinals = [];
      this.pendingFinal = null;
      this.startLevel();
      return;
    }
    if (this.pendingPicks.length < picksPerBay(this.run.mark)) return;
    this.run = { ...this.run, ratchets: withPicks(this.run.ratchets, this.pendingPicks) };
    this.pendingPicks = [];
    this.startLevel();
  }

  private pause(): void {
    if (this.state !== "playing" || !this.game) return;
    this.game.paused = true;
    this.setState("paused");
  }
  private resume(): void {
    if (this.state !== "paused" || !this.game) return;
    this.game.paused = false;
    this.last = performance.now();
    this.acc = 0;
    this.setState("playing");
  }

  /** Pause modal's "Restart Bay": re-enters the *current* bay from scratch —
   *  unlike startGame()/"restart", this leaves `this.run` untouched, so
   *  startLevel() rebuilds the Game from the same un-advanced levelIndex,
   *  keeping the run's carried surplus and drafted mods exactly as they were
   *  at this bay's entry. */
  /** Replay the bay the tutorial just lost. Distinct from restartBay only in
   *  the state it will accept: restartBay is the pause-menu path, this one is
   *  the failure card's, and neither should fire from the other's screen. */
  private coachRetry(): void {
    if (this.state !== "coach-fail" || !this.run) return;
    this.startLevel();
    this.last = performance.now();
    this.acc = 0;
  }

  private restartBay(): void {
    if (this.state !== "paused") return;
    // Restarting a Contract re-generates the same bay from its seed, which is
    // the whole point of the mode — retry the identical puzzle, not a reroll.
    if (this.contract) {
      this.startContract(this.contract);
      this.last = performance.now();
      this.acc = 0;
      return;
    }
    if (!this.run) return;
    this.startLevel();
    this.last = performance.now();
    this.acc = 0;
  }

  /** Patches the currently-mounted #lb-body in place (no full overlay
   *  re-render). Used both here and by onSubmitScore — a full renderOverlay()
   *  after the fetch resolves would recreate the whole `.panel.modal.pop`
   *  node a second time, replaying its entrance animation on top of the one
   *  that already played when the screen first opened with cached/empty
   *  data. On localhost that race is invisible (near-zero latency hides it),
   *  but on a real device's network it reads as "the leaderboard shows
   *  twice" — the modal visibly pops in, then pops in again a moment later
   *  once the fetch lands. */
  private renderBoardRows(highlight?: string): void {
    const body = this.overlay.querySelector("#lb-body");
    if (!body) return;
    // Both the standalone screen and the end modal render into #lb-body, so the
    // slice is chosen by state rather than inferred from `highlight`: the screen
    // lists everyone, the modal shows the top 5 plus the player's own row, which
    // is what keeps it inside a 360px landscape viewport without scrolling.
    const rows = this.state === "leaderboard"
      ? S.fullBoard(this.cachedBoard)
      : S.endBoard(this.cachedBoard, highlight);
    body.innerHTML = S.leaderboardRowsHTML(rows, highlight);
  }

  private async refreshBoard(): Promise<void> {
    // The D1 board is the single RUN board for now — level is always 1
    // regardless of which bay the run ended on.
    this.cachedBoard = await fetchLeaderboard(1, 10);
    // won/lost highlight the player's own just-played name; the standalone
    // leaderboard screen doesn't (matches renderOverlay's existing per-state
    // leaderboardRowsHTML args).
    this.renderBoardRows(this.state === "leaderboard" ? undefined : loadName() || undefined);
  }

  // ---------------- main loop ----------------
  private loop = (now: number): void => {
    // The Gamepad API is a state snapshot, not events — poll once per frame,
    // in every state: the Controls screen needs the Detected chip and rebind
    // capture, and Start has to pause/resume from anywhere.
    this.pad.poll(now);
    const g = this.game;
    if (g && this.state === "playing" && !g.paused) {
      this.acc += now - this.last;
      // Cap the catch-up backlog. The old cap (250ms of debt) let a device
      // that missed one frame owe up to 15 physics steps the next — each
      // frame slower than the last, the classic fixed-step death spiral, and
      // exactly what froze the game on older phones. Bounding the debt to a
      // few steps means a device that can't hold 60Hz plays in brief
      // slow-motion under load and recovers, instead of spiralling.
      if (this.acc > STEP * MAX_CATCHUP_STEPS) this.acc = STEP * MAX_CATCHUP_STEPS;
      let stepped = false;
      while (this.acc >= STEP) {
        g.update(now);
        telemetry.sampleFunds(g.score, g.elapsedMs);
        this.acc -= STEP;
        stepped = true;
      }
      // The dotted arc tracks the wind, which only drifts inside update() —
      // refresh it once per DRAWN frame rather than once per physics step
      // (game.ts no longer recomputes it per step; aim changes refresh it
      // through input.ts, and the sim bots refresh it themselves).
      if (stepped) g.updateTrajectory();
      this.syncHud(g);
    }
    this.last = now;

    // Not while a screen is covering the canvas. `game` is never nulled — a
    // finished run's bay is still here — so without this the app re-painted a
    // field nobody can see, every frame, for as long as the player reads a
    // menu.
    //
    // On the menu that was also actively harmful, which is why this started
    // there: the menu is when the attract demo draws, and render.ts's sprite
    // and background-layer caches each hold ONE viewport, so two canvases at
    // different scales alternating every frame would flush and re-bake both —
    // the whole glow-blur cost those caches exist to remove, paid twice a
    // frame, on the one screen that should be idle.
    //
    // The rest of COVERS_CANVAS is the same waste without that second effect,
    // and it is not small: sim/renderperf puts a full bay's frame at ~22ms of
    // drawing, and the Workshop, the Contracts board and the leaderboard are
    // exactly the screens a player sits on. Every one of them was paying it
    // to paint pixels that an opaque `.screen.neon-backdrop` covers.
    if (g && !COVERS_CANVAS.has(this.state)) {
      render(this.ctx, window.innerWidth, window.innerHeight, this.dpr, {
        cubes: g.cubes, constraints: g.constraints, compactor: g.compactor, cannon: g.cannon,
        trajectory: g.trajectory, now, aiming: g.aiming,
        effects: g.effects, level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
        windNow: g.windNow,
        // The bay's steady prevailing wind is only revealed with the Weather
        // Survey unlock (see game/meta.ts) — otherwise null and the gauge
        // shows only the live reading, as before.
        windAverage: this.meta.unlocks.includes("survey") ? g.windAverage : null,
        reload: g.cannon.reloadRatio(now),
        settling: g.settling,
        strandWarning: g.trajectoryStrands,
      });
    } else if (!g) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    requestAnimationFrame(this.loop);
  };

  private flashGoal(): void {
    const el = this.overlay.querySelector<HTMLElement>("#hud-goal");
    if (el) { el.style.filter = "brightness(1.8)"; setTimeout(() => (el.style.filter = ""), 180); }
  }

  private syncHud(g: Game): void {
    const set = (id: string, v: string) => {
      const el = this.overlay.querySelector(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    // The plant's crest (app.css's .plant__crest — the spike ring around the
    // panel and its PWR cap) speaks in two states the HUD already trusts,
    // toggled here so they survive every renderOverlay remount:
    //  - the congestion tier, the SAME pileTier read the Launch price below
    //    and render.ts's floor rows use — floor, price and machine move on
    //    one rule. In both modes, not just Deep Run: a Contract bay congests
    //    the same way even though it prices no launches.
    //  - the strand warning (game.ts's trajectoryStrands), which is what the
    //    canvas teeth wore before the crest took the spikes over — the crest
    //    turns maw-red for exactly the frames drawChute heats the mouth.
    const plant = this.overlay.querySelector<HTMLElement>(".plant");
    if (plant) {
      const crestTier = g.pileTier ? g.level.pileTiers.indexOf(g.pileTier) : -1;
      plant.classList.toggle("plant--congest-warn", crestTier === 0);
      plant.classList.toggle("plant--congest-danger", crestTier >= 1);
      plant.classList.toggle("plant--maw", g.trajectoryStrands);
      // THE BEAT — the crest breathes with the soundtrack (app.css's
      // --crest-beat brightness). musicLevel is the raw RMS off the audio
      // graph's tap; everything that makes it read as a PULSE happens here:
      // normalised against its own decaying peak (so every bed uses the full
      // range regardless of mastering), scaled up as the bay congests (the
      // machine beats harder, on top of the tier recolour), and shaped by a
      // fast-rise/slow-fall follower so hits snap and decays trail. Written
      // only on real change at a 1/40 quantum — the style write is the only
      // cost, so silence and steady passages cost nothing. Never driven
      // under reduced motion; the var stays 0 and the CSS line is inert.
      if (!this.motionMQ?.matches) {
        const raw = musicLevel();
        this.crestPeak = Math.max(raw, this.crestPeak * 0.998, 0.02);
        const target = (raw / this.crestPeak) * (0.55 + 0.45 * this.congestion);
        this.crestBeat += (target - this.crestBeat) * (target > this.crestBeat ? 0.5 : 0.12);
        const q = Math.round(this.crestBeat * 40) / 40;
        if (q !== this.crestBeatShown) {
          this.crestBeatShown = q;
          plant.style.setProperty("--crest-beat", String(q));
        }
      }
    }
    // In a Contract these two slots hold lines and launches instead of funds
    // and launches (see screens.ts's hudHTML): a Contract has no bankroll, so
    // the funds readout would sit at $0 with 0 launches for the whole bay.
    if (this.contract) {
      const pattern = this.contract.kind === "pattern";
      const supply = pattern ? g.piecesLeft : g.launchesLeft;
      set("#hud-score", String(g.linesTotal));
      set("#hud-launches", String(supply === Infinity ? 0 : supply));
      // Gated on `pattern`, matching #hud-queue's and #hud-time's own gates
      // below: a pattern Contract has no #hud-lost element (screens.ts's
      // hudHTML), and gating explicitly — rather than trusting `set`'s
      // silent no-op on a missing node — keeps a typo'd selector or a
      // markup regression from reading as "pattern bay, nothing to do
      // here". The other two Contract rows (conditions, tier progress) are
      // rendered by hudHTML and never patched here.
      if (!pattern) set("#hud-lost", String(g.lostTotal));
      // The same urgency treatment the Deep Run readout gets below, one shot
      // later: a Contract's supply is an exact countdown rather than an
      // estimate of what the bankroll still buys, and it starts small. See
      // screens.ts's LOW_SUPPLY_WARN for why the two thresholds differ.
      this.overlay
        .querySelector("#hud-launches-chip")
        ?.classList.toggle("pl-stat--danger", supply <= S.LOW_SUPPLY_WARN);
      // The remaining manifest, re-rendered only when it actually changes —
      // it's HTML (colored per piece type), so this can't go through `set`.
      if (pattern) {
        const tally = this.overlay.querySelector<HTMLElement>("#hud-queue");
        const html = S.queueTallyHTML(g.piecesRemaining);
        if (tally && tally.innerHTML !== html) tally.innerHTML = html;
      }
    } else {
      set("#hud-score", "$" + g.score);
    }
    // LAUNCHES LEFT — tier 2 of the plant readout (see screens.ts's hudHTML).
    // It turns danger-red and pulses at LOW_LAUNCH_WARN or fewer, because that
    // is the exact point where the right play changes from "keep feeding the
    // bay" to "this shot has to count". Computed from funds, so it also drops
    // when a mod raises launchCost — the warning tracks affordability, not a
    // separate ammo counter — and, for the same reason, when congestion raises
    // the price of the next shot (level.ts's PILE_TIERS). That is the readout
    // doing exactly its job: a bay you have filled up really does hold fewer
    // shots than the same bankroll bought a minute ago, and the number falling
    // as the pile grows is the clearest statement of the rule the HUD can make.
    if (!this.contract) {
      // The meta line's three economy numbers, patched in the same Deep-Run-only
      // branch that owns the readout above them: a Contract renders no meta line
      // at all, so writing them there would be writing into nothing.
      set("#hud-combo", "×" + g.combo);
      set("#hud-scrap", String(g.scrapEarned));
      const launches = Math.floor(g.score / Math.max(1, g.launchCostNow));
      set("#hud-launches", String(launches));
      // The QUOTED price, live. Congestion moves launchCostNow while the bay
      // is running, and this readout is rendered once with the rest of the
      // HUD — so without patching it here the plant would keep advertising the
      // price the bay opened at while charging the congested one. The colour
      // is the same three-step the bay floor is lit in (render.ts's congestion
      // rows): list price plain, first tier amber, second red.
      const tierIdx = g.pileTier ? g.level.pileTiers.indexOf(g.pileTier) : -1;
      const launchEl = this.overlay.querySelector("#hud-launch");
      if (launchEl) {
        launchEl.textContent = `Launch $${g.launchCostNow}`;
        launchEl.classList.toggle("pl-meta__launch--warn", tierIdx === 0);
        launchEl.classList.toggle("pl-meta__launch--danger", tierIdx >= 1);
      }
      this.overlay
        .querySelector("#hud-launches-chip")
        ?.classList.toggle("pl-stat--danger", launches <= S.LOW_LAUNCH_WARN);
      // B7: the funds block joins the one urgency treatment at the same
      // threshold — the goal bar is the biggest funds surface on screen, and
      // it stayed serenely cyan while the number beside it flashed.
      this.overlay
        .querySelector(".pl-funds")
        ?.classList.toggle("pl-stat--danger", launches <= S.LOW_LAUNCH_WARN);
    }

    // objectiveProgress reads whichever win condition this bay is running, so
    // the bar works for a Contract's line goal and a Deep Run's funds target
    // without the HUD needing to know which mode it's in.
    const goal = this.overlay.querySelector<HTMLElement>("#hud-goal");
    if (goal) goal.style.width = Math.min(100, g.objectiveProgress * 100) + "%";
    // Aim-state ✕ (see screens.ts's .cancel-aim-btn): shown only mid-drag.
    // Also drives the tutorial's aim-through fade — see app.css's Aim-through
    // block, which is scoped to .hud--aiming[data-coach].
    this.overlay.querySelector("#hud")?.classList.toggle("hud--aiming", g.aiming);
    // The LIVE gesture's ratio while a drag is in progress, the cannon's only
    // when there isn't one. They differ in exactly the case that matters: a tap
    // (or a sub-4px wobble) never reaches aimFromDrag, so the cannon still
    // holds the PREVIOUS shot's power — the meter would sit at 80% advertising
    // a launch the release is not going to make. Reading the gesture makes the
    // readout agree with the gate, and drops it to 0 the instant a finger lands.
    const liveRatio = this.input.liveDragRatio;
    const ratio = liveRatio ?? g.cannon.powerRatio;
    const powerPct = Math.round(ratio * 100);
    const power = this.overlay.querySelector<HTMLElement>("#hud-power");
    if (power) power.style.width = powerPct + "%";
    set("#hud-power-val", powerPct + "%");
    // Below the floor, mid-drag: the pull as it stands would be discarded as an
    // accidental touch. Shown WHILE the finger is down, which is the only time
    // it can still be acted on — the post-release cue is a consolation prize by
    // comparison. Scoped to a live drag so a freshly loaded cannon sitting at
    // its minimum doesn't wear a warning about a gesture nobody is making.
    this.overlay.querySelector("#hud-pwr")?.classList.toggle(
      "pl-pwr--weak", liveRatio !== null && liveRatio < MIN_FIRE_RATIO,
    );

    // RELOAD bar — same value the canvas draws as a ring around the muzzle
    // (render.ts's drawReloadRing). Two views of one number on purpose: the
    // ring is what you read mid-aim with your eyes on the cannon, this is what
    // you catch in peripheral vision while looking at the pile.
    const reload = g.cannon.reloadRatio(performance.now());
    const load = this.overlay.querySelector<HTMLElement>("#hud-load");
    if (load) load.style.width = Math.round(reload * 100) + "%";
    const ready = reload >= 1;
    this.overlay.querySelector("#hud-load-row")?.classList.toggle("ready", ready);
    // Audible AND felt, on the RISING edge only. syncHud runs every frame, so
    // testing `ready` alone would retrigger ~60x/sec for as long as the player
    // takes to aim — which, per the telemetry note in cannon.ts, is most of the
    // time. The haptic matters more than the sound here: the whole point of the
    // cue is that it reaches a player whose eyes are on the pile, and phones
    // get played muted. It is deliberately the lightest one in the game
    // (platform.ts's readyHaptic) precisely because it repeats every cycle.
    if (ready && !this.reloadWasReady) {
      playFx("reloadReady", { gain: 0.5 });
      void readyHaptic();
    }
    this.reloadWasReady = ready;

    if (g.timeLeftMs !== Infinity) {
      set("#hud-time", formatMMSS(g.timeLeftMs));
      this.overlay.querySelector("#hud-time-chip")?.classList.toggle("pl-stat--danger", g.timeLeftMs < 20_000);
    }

    // The transport's two-deep queue (canvas A5): the piece the cannon is
    // HOLDING at the muzzle end (a bomb tile while one is armed — that is
    // what the next trigger pull fires) and the piece coming AFTER it behind
    // (game.ts's beltPreview). The identity key gates the ~180ms load
    // animation separately from the render key: a rotate tap re-renders the
    // held tile at its new orientation but must not replay the arrival slide.
    const bp = g.beltPreview;
    const idKey = [
      g.cannon.currentType, g.bombArmed ? 1 : 0, g.cannon.currentMaterial,
      bp.type, bp.bomb ? 1 : 0, bp.empty ? 1 : 0, bp.hidden ? 1 : 0, bp.material,
      g.level.pieceSize,
    ].join(":");
    const nextKey = `${idKey}|${g.cannon.quarterTurns}:${bp.quarterTurns}`;
    if (this.lastNext !== nextKey) {
      const arrived = this.lastNextId !== idKey;
      const next = this.overlay.querySelector<HTMLElement>("#hud-next");
      if (next) {
        next.innerHTML = bp.bomb
          ? beltBombHTML()
          : bp.empty
            ? ""
            : bp.hidden
              ? beltSealedHTML()
              : beltPieceHTML(bp.type, bp.quarterTurns, g.level.pieceSize, bp.material);
        next.classList.toggle("belt-piece--still", !arrived);
      }
      const held = this.overlay.querySelector<HTMLElement>("#hud-loaded");
      if (held) {
        held.innerHTML = g.bombArmed
          ? beltBombHTML()
          : beltPieceHTML(g.cannon.currentType, g.cannon.quarterTurns, g.level.pieceSize, g.cannon.currentMaterial);
        held.classList.toggle("belt-piece--still", !arrived);
      }
      // The transport LIGHTS UP in the colour of what it is bringing (see
      // app.css's --belt-c): chevrons, outfeed and the bed's inner wash all
      // read it. Set here rather than on its own timer so the colour changes
      // on exactly the frame the tile above it does — a belt glowing for a
      // shipment that already fired would be worse than no colour at all.
      // Same source as the tile's own cubes (theme.ts's shipmentColor), so
      // cryo reads cold and slag reads dead on the machine as well as the
      // cargo.
      //
      // A SEALED shipment lights the transport in the neutral wash, not its
      // cargo's colour. Every piece type has its own colour, so a belt glowing
      // orange for a sealed crate would name the L inside it and the Blackout
      // variant would be over — the crate would be a lid on a box with the
      // answer painted down the side of it.
      this.overlay.querySelector<HTMLElement>("#hud-belt")?.style.setProperty(
        "--belt-c",
        bp.bomb
          ? "var(--danger)"
          : bp.empty || bp.hidden
            ? "var(--text-faint)"
            : shipmentColor(bp.type, bp.material),
      );
      this.lastNext = nextKey;
      this.lastNextId = idKey;
    }
    // Each ABILITY has TWO triggers on screen at once when drafted — the plant
    // chip and the touch-rail button (see screens.ts's hudHTML) — kept in sync
    // together via shared classes instead of hardcoded ids per trigger.
    this.syncAbility("bond", g.bondCharges, false);
    this.syncAbility("demo", g.bombCharges, g.bombArmed);

    if (this.tutorialStep !== null) this.syncCoach(g);
  }

  /** Sync one ability's pair of triggers: disable both at zero charges, write
   *  the live count into both badges, and mark both `armed` when the ability is
   *  currently armed (only Demolition Charges use that — the armed state is what
   *  tells the player their next launch will fire a bomb, and it has to be
   *  unmistakable since it changes what the trigger pull does). */
  private syncAbility(name: string, charges: number, armed: boolean): void {
    this.overlay.querySelectorAll<HTMLButtonElement>(`.${name}-trigger`).forEach((b) => {
      b.disabled = charges <= 0 && !armed;
      b.classList.toggle("armed", armed);
    });
    this.overlay.querySelectorAll(`.${name}-trigger__count`).forEach((c) => {
      c.textContent = String(charges);
    });
  }

  // ---------------- events ----------------
  private onGlobalKey = (e: KeyboardEvent): void => {
    // A live keyboard rebind capture eats the next keypress whole (Escape
    // cancels rather than binding — a pause key you can't type would strand
    // the player).
    if (this.state === "controls" && this.controlsTab === "keyboard" && this.rebinding) {
      e.preventDefault();
      if (e.key !== "Escape") setKeyBinding(this.rebinding, e.key);
      this.rebinding = null;
      this.renderOverlay();
      return;
    }
    this.setProfile("keyboard");
    // The pause binding, from the rebindable table (Escape by default).
    if (actionForKey(e.key) === "pause") {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    }
    // Keyboard shortcut into the sandbox from anywhere, for iterating on it
    // under `vite dev` without walking back to the menu each time.
    if (SANDBOX && e.key === "~") this.setState("sandbox");
  };

  private onKeydown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement;
    if ((e.key === "Enter" || e.key === " ") && t.getAttribute("role") === "switch") {
      e.preventDefault();
      t.click();
    }
  };

  private onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action],[data-game],[data-toggle]");
    if (!el) return;

    const toggle = el.getAttribute("data-toggle");
    if (toggle) { this.onToggle(toggle, el); return; }

    const gameAct = el.getAttribute("data-game");
    if (gameAct) {
      // Pointer taps already acted on pointerdown (see onGamePointerDown); only
      // keyboard activation may act again here.
      //
      // `detail === 0` alone was NOT that test. The click a browser synthesizes
      // after a TOUCH tap also carries detail 0 (verified in Chromium: the tap
      // produces `pointerdown pointerType=touch` then `click pointerType=touch,
      // detail 0`), so every rail press on a phone ran its action twice — one
      // tap on ⟲ turned the piece 180°, not 90°. What separates the two is
      // `pointerType`: a real keyboard activation has none. Mouse clicks carry
      // "mouse" and detail 1, and are excluded either way.
      if (e.detail === 0 && !(e as PointerEvent).pointerType) this.onGameAction(gameAct);
      return;
    }

    const action = el.getAttribute("data-action");
    if (!action) return;
    // Pointer presses already got their haptic and sound at pointerdown
    // (pressFeedback); only a keyboard activation — a click with no pointer
    // behind it, the same test as the data-game branch above — sounds here.
    // Primary buttons blip, everything else ticks: the committing action
    // (play, buy, undock, confirm) says so to the ear as well as the eye, and
    // the variant class is the rule, so a new screen gets the right sound by
    // styling its buttons honestly.
    if (e.detail === 0 && !(e as PointerEvent).pointerType) this.actionFeedback(el);
    switch (action) {
      case "play": this.startGame(); break;
      case "howto": this.setState("howto"); break;
      // How to Play's "Guided Tutorial": replay the interactive coach on a
      // fresh run, even for a player who already finished or skipped it.
      case "tutorial":
        this.settings.seenTutorial = false;
        saveSettings(this.settings);
        this.startGame();
        break;
      case "coach-done":
      case "coach-skip":
        this.finishTutorial();
        break;
      case "settings": this.setState("settings"); break;
      case "controls": this.setState("controls"); break;
      case "controls-tab": {
        const tab = el.getAttribute("data-tab");
        if (tab === "touch" || tab === "keyboard" || tab === "gamepad") {
          this.controlsTab = tab;
          this.rebinding = null;
          this.renderOverlay();
        }
        break;
      }
      // Toggle a rebind capture on/off for one action row. The capture itself
      // lands in onGlobalKey (keyboard) or the gamepad poller's onCapture.
      case "rebind": {
        const bind = el.getAttribute("data-bind") as BindableAction | null;
        this.rebinding = bind && this.rebinding !== bind ? bind : null;
        this.renderOverlay();
        break;
      }
      case "controls-reset":
        if (this.controlsTab === "keyboard") resetKeyBindings();
        else if (this.controlsTab === "gamepad") resetPadBindings();
        this.rebinding = null;
        this.renderOverlay();
        break;
      case "leaderboard": this.refreshBoard(); this.setState("leaderboard"); break;
      case "workshop": this.setState("workshop"); break;
      case "contracts": this.setState("contracts"); break;
      case "contract": {
        const slot = Number(el.getAttribute("data-slot") ?? "0");
        const c = this.todaysContracts()[slot];
        if (c) this.startContract(c);
        break;
      }
      case "contract-retry":
        if (this.contract) this.startContract(this.contract);
        break;
      case "contract-next":
        if (this.nextContract) this.startContract(this.nextContract);
        else this.setState("contracts");
        break;
      case "menu": this.contract = null; this.contractMusic = null; this.setState("menu"); break;
      case "pause": this.pause(); break;
      case "resume": this.resume(); break;
      case "fullscreen": void toggleFullscreen().then(() => this.syncFullscreenButtons()); break;
      case "restart": this.startGame(); break;
      case "restart-bay": this.restartBay(); break;
      // Retry from the tutorial's failure card. startLevel rebuilds this bay
      // from the run (which never advanced, so its seed, funds and Bond
      // Breaker stock are untouched) and re-arms the coach at step 0 — the
      // honest reset, since the steps that were never performed were never
      // learned.
      case "coach-retry": this.coachRetry(); break;
      // "Skip tutorial" from the failure card: drop the coach for good, then
      // hand the bay back anyway. A player who is done being taught still
      // wants the bay they just lost, not the main menu.
      case "coach-skip-run":
        this.finishTutorial();
        this.coachRetry();
        break;
      case "submit-score": void this.onSubmitScore(); break;
      case "paywall": void this.onPaywall(); break;
      case "customer-center": void presentCustomerCenter(); break;
      case "restore": void this.onRestore(); break;
      case "pick-hazard":
        this.onPickHazard(el.getAttribute("data-hazard") ?? "");
        break;
      case "pick-final":
        this.onPickFinal(el.getAttribute("data-final") ?? "");
        break;
      case "confirm-hazards": this.onConfirmHazards(); break;
      // Tap-through for the bay-clear celebration — a player who has seen it
      // before shouldn't have to wait out the animation.
      case "skip-bayclear": this.afterBayClear(); break;
      case "stage-upgrade": this.onStageUpgrade(el.getAttribute("data-upgrade") ?? ""); break;
      case "unstage-upgrade": this.onUnstageUpgrade(el.getAttribute("data-upgrade") ?? ""); break;
      case "refit-done": this.onRefitDone(); break;
      case "buy-unlock": this.onBuyUnlock(el.getAttribute("data-unlock") ?? ""); break;
      case "buy-install": this.onBuyInstall(el.getAttribute("data-install") ?? ""); break;
      // Only reachable in a build that rendered the button (see menuScreen),
      // and guarded again here so the state is unreachable even if some other
      // path ever emits this action.
      case "sandbox": if (SANDBOX) this.setState("sandbox"); break;
      default:
        // Every sandbox action funnels through one guarded call rather than a
        // case each, so there is exactly ONE place a shippable build has to
        // fold away — and if the fold ever stops happening, this returns before
        // touching anything rather than half-executing a cheat.
        if (SANDBOX && action.startsWith("sbx-")) this.onSandboxAction(action, el);
        break;
    }
  };

  /**
   * The sandbox's whole control surface. Only reached behind SANDBOX.
   *
   * Every branch either edits `this.sandbox` and re-renders, or edits the SAVE
   * and re-renders. The save-editing ones are deliberately blunt and
   * deliberately explicit — a developer who taps "Mark := tier" has said what
   * they want to happen to their own save, and a sandbox that tried to be
   * careful about it would just be a slower way to reach the same state.
   */
  private onSandboxAction(action: string, el: HTMLElement): void {
    switch (action) {
      case "sbx-tier": {
        this.sandbox.tier = Number(el.getAttribute("data-tier") ?? "1");
        // Selecting a tier below the current variant's rung would leave the
        // panel pointing at something it cannot generate. Fall back to the
        // variant every tier has rather than silently generating a different
        // one than the highlighted button claims.
        const t = this.sandbox.target;
        if (t.kind === "pattern" && variantSpec(t.variant).tier > this.sandbox.tier) {
          this.sandbox.target = { kind: "pattern", variant: "plain" };
        }
        break;
      }
      case "sbx-variant":
        this.sandbox.target = {
          kind: "pattern",
          variant: (el.getAttribute("data-variant") ?? "plain") as ContractVariant,
        };
        break;
      case "sbx-target": {
        const v = el.getAttribute("data-target") ?? "lines";
        this.sandbox.target = v.startsWith("bay")
          ? { kind: "bay", bay: Number(v.slice(3)) }
          : { kind: "lines" };
        break;
      }
      case "sbx-rig": {
        // Cycles 0 -> 1 -> ... -> MAX_TIER -> 0. One button per track beats a
        // stepper pair on a phone, and wrapping means no track can get stuck at
        // a tier the thumb can't walk back from.
        const id = (el.getAttribute("data-track") ?? "") as UpgradeId;
        if (id in this.sandbox.tiers) {
          this.sandbox.tiers[id] = ((this.sandbox.tiers[id] ?? 0) + 1) % (MAX_TIER + 1);
        }
        break;
      }
      case "sbx-rig-max": this.sandbox.tiers = maxedTiers(); break;
      case "sbx-rig-none": this.sandbox.tiers = newTiers(); break;
      case "sbx-reseed":
        // Walks the space of what one variant produces at one tier, which is
        // the thing a device session is actually for. Wrapped well inside 2^31
        // so the seeded generators keep their uint32 arithmetic.
        this.sandbox.seed = (this.sandbox.seed + 1) % 1_000_000_007;
        break;
      case "sbx-grant-mark":
        this.meta = { ...this.meta, mark: Math.max(0, this.sandbox.tier - 1) };
        saveMeta(this.meta);
        break;
      case "sbx-grant-salvage":
        this.meta = { ...this.meta, salvage: this.meta.salvage + 1000 };
        saveMeta(this.meta);
        break;
      case "sbx-unlock-all":
        this.meta = {
          ...this.meta,
          unlocks: UNLOCKS.map((u) => u.id),
          loadout: maxedTiers(),
        };
        saveMeta(this.meta);
        break;
      case "sbx-wipe":
        this.meta = newMeta();
        saveMeta(this.meta);
        break;
      case "sbx-launch":
        this.launchSandbox();
        return; // startContract/startLevel render for us
      default:
        return;
    }
    this.renderOverlay();
  }

  /**
   * Launch whatever the sandbox is set to.
   *
   * Both paths go through the SHIPPING entry points — startContract and the run
   * machinery — with the inputs changed and nothing else. A sandbox that built
   * its own Game would be testing a bay the real game never constructs, which is
   * the one thing a device-testing tool must not do.
   */
  private launchSandbox(): void {
    const t = this.sandbox.target;
    if (t.kind === "bay") {
      // A real run, fast-forwarded to the chosen bay. levelIndex is the only
      // thing moved: hazards stay un-ratcheted because the draft did not
      // happen, and carry stays 0 because no earlier bay was played. Both are
      // the honest state for "bay 7, cold" — which is the bay worth testing.
      this.game?.destroy();
      this.contract = null;
      this.submitted = false;
      this.lastTier = null;
      this.run = {
        ...newRun(Date.now() >>> 0, this.meta.unlocks, 0, this.sandbox.tiers, this.sandbox.tier),
        levelIndex: Math.max(0, Math.min(RUN_LEVELS - 1, t.bay - 1)),
      };
      telemetry.startRun(this.run.mark, this.run.tiers, this.run.unlocks);
      this.startLevel();
      return;
    }
    this.startContract(
      t.kind === "pattern"
        ? generateContract(this.sandbox.seed, this.sandbox.tier, PATTERN_SLOT, t.variant)
        : generateContract(this.sandbox.seed, this.sandbox.tier, 0),
    );
  }

  /** In-game [data-game] buttons act on pointerdown, not click: browsers
   *  only synthesize click for the PRIMARY pointer, so while a finger
   *  holds the slingshot drag a second finger's tap on rotate/✕ never
   *  produces a click at all. Firing on press also feels snappier for
   *  game controls. onClick keeps keyboard activation working (a
   *  keyboard "click" has detail 0 and no preceding pointerdown). */
  /** Haptic + tick (or the confirm blip on a primary button) for one screen
   *  button, shared by the press path and the keyboard path below. */
  private actionFeedback(el: HTMLElement): void {
    void tapHaptic();
    if (el.classList.contains("btn--primary")) playUiConfirm();
    else playUiClick();
  }

  /** Press-time feedback for screen buttons. The ACTION still runs on click —
   *  browsers dispatch click on RELEASE, and feedback played there trails the
   *  finger by the whole duration of the press, which is exactly what read as
   *  "the sound lags the button". The sound belongs to the press; the
   *  semantics stay on the click, so a press that slides off a button costs a
   *  tick and nothing else. Toggles are deliberately not here: onToggle
   *  orders its sound after the settings sync so that switching Sound off
   *  clicks into silence, and that property needs the flipped state. */
  private pressFeedback(e: PointerEvent): void {
    if (e.button !== 0) return; // a right/middle press produces no click
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || (el as HTMLButtonElement).disabled) return;
    this.actionFeedback(el);
  }

  private onGamePointerDown = (e: PointerEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-game]");
    if (!el) {
      this.pressFeedback(e);
      return;
    }
    if ((el as HTMLButtonElement).disabled) return;
    // No focus steal / compatibility mouse events for game controls; the
    // primary pointer's synthesized click is skipped via onClick's
    // detail check, so pressing can't double-fire.
    e.preventDefault();
    const act = el.getAttribute("data-game")!;
    // The one HELD control on the rail: press starts the burst, and release
    // (anywhere — see onGlobalPointerUp) ends it.
    if (act === "auto") {
      this.autoPointerId = e.pointerId;
      this.game?.setAutoHeld(true);
      void tapHaptic();
      return;
    }
    // The one HELD-TO-CONFIRM control: a press starts a charge meter and the
    // charge is only spent if it fills (see BOND_HOLD_MS / startBondHold).
    // Every pointer type, mouse included — the meter filling under the cursor
    // is the affordance, and a mouse that fired instantly would flash it for
    // nothing. Desktop's fast path is the B key, which stays a single press.
    if (act === "bond") {
      this.startBondHold(el, e.pointerId);
      return;
    }
    this.onGameAction(act);
  };

  /** Ends an Autoloader burst — and cancels an unfinished Bond Breaker hold —
   *  on release, on the window rather than the button so a thumb that drifts
   *  off mid-hold cannot leave either trigger stuck down. Bound to
   *  pointercancel too: a gesture the browser takes over (a system edge swipe)
   *  must not leave a charge counting down behind a UI the player left. */
  private onGlobalPointerUp = (e: PointerEvent): void => {
    if (this.bondHold && e.pointerId === this.bondHold.pointerId) this.clearBondHold();
    if (this.autoPointerId === null || e.pointerId !== this.autoPointerId) return;
    this.autoPointerId = null;
    this.game?.setAutoHeld(false);
  };

  /** Starts the Bond Breaker's hold-to-confirm on one of its two triggers.
   *
   *  The charge is spent WHEN THE METER FILLS, not on the release after it:
   *  the fill reaching the top is the moment the player is watching for, so
   *  the field-wide shatter (and onBondBreak's thump + sound) lands with it
   *  rather than waiting for a lift they have no reason to make. Releasing
   *  early — or sliding the thumb off, see onBondHoldMove — drains the meter
   *  and spends nothing.
   *
   *  Keyboard and gamepad deliberately do NOT hold: `B` and the pad button
   *  fire on press, as does a keyboard activation of the button itself
   *  (onClick's detail-0 branch). The accident this guards against is a thumb
   *  grazing glass, which those devices cannot have — the same line input.ts
   *  draws when it exempts the mouse from the misfire gate — and a hold
   *  requirement on the keyboard path would only take the instant, one-key
   *  route away from the players relying on it. */
  private startBondHold(el: HTMLElement, pointerId: number): void {
    this.clearBondHold();
    // One number for the meter and the timer (see BOND_HOLD_MS).
    el.style.setProperty("--bond-hold", `${BOND_HOLD_MS}ms`);
    el.classList.add("bond-trigger--holding");
    this.bondHold = {
      pointerId,
      el,
      rect: el.getBoundingClientRect(),
      timer: window.setTimeout(() => {
        this.clearBondHold();
        this.onGameAction("bond");
      }, BOND_HOLD_MS),
    };
    window.addEventListener("pointermove", this.onBondHoldMove);
    // The press is worth confirming on its own, before anything has happened
    // yet: it is what tells a thumb that the hold has STARTED and is being
    // counted. onGameAction's own tap follows a second later if it completes.
    void tapHaptic();
  }

  /** Cancels the hold when the finger leaves the trigger it started on. A hold
   *  the player can back out of by sliding away is the same escape hatch
   *  input.ts gives a misfired drag — "nothing happened" has to be reachable
   *  once the finger is already down. */
  private onBondHoldMove = (e: PointerEvent): void => {
    const h = this.bondHold;
    if (!h || e.pointerId !== h.pointerId) return;
    const r = h.rect;
    if (
      e.clientX < r.left - BOND_HOLD_SLOP ||
      e.clientX > r.right + BOND_HOLD_SLOP ||
      e.clientY < r.top - BOND_HOLD_SLOP ||
      e.clientY > r.bottom + BOND_HOLD_SLOP
    ) {
      this.clearBondHold();
    }
  };

  /** Tears a hold down — the timer, the button's meter and the move listener.
   *  Called on release, on drift, the instant the hold completes, and whenever
   *  play stops (setState), since a modal replacing the rail means the
   *  pointerup that would have ended it is never coming. Idempotent. */
  private clearBondHold(): void {
    const h = this.bondHold;
    if (!h) return;
    window.clearTimeout(h.timer);
    // Dropping the class ends the fill animation, and the base rule's
    // transition drains the meter back down instead of blinking it away — an
    // abandoned hold should visibly UNWIND, not just stop existing.
    h.el.classList.remove("bond-trigger--holding");
    this.bondHold = null;
    window.removeEventListener("pointermove", this.onBondHoldMove);
  }

  /** Drops the Autoloader trigger unconditionally — used whenever the game
   *  leaves "playing" (pause, win, loss, menu), since no pointerup is coming
   *  for a button that just stopped existing. */
  private releaseAutoTrigger(): void {
    this.autoPointerId = null;
    this.game?.setAutoHeld(false);
  }

  private onGameAction(a: string): void {
    const g = this.game;
    if (!g || this.state !== "playing") return;
    // Every rail press buzzes, here rather than at either call site. The rail
    // moved to pointerdown (see onGamePointerDown) and onClick returns early
    // for [data-game], so the tap that used to come from onClick's dispatcher
    // stopped arriving: on a touch device the entire in-game control surface —
    // rotate, Bond Breaker, cancel — went silent, and only the Autoloader hold
    // and a SUCCESSFUL bomb arm still fired one. A press is worth confirming
    // even when its effect is invisible, so this is unconditional for every
    // press that lands (a disabled trigger never reaches here —
    // onGamePointerDown drops it), and the arm's own tap goes. Bond Breaker
    // reaches this only once its hold COMPLETES, so its tap lands on the
    // shatter rather than on the press that started counting (which got its
    // own, in startBondHold).
    void tapHaptic();
    if (a === "rotl") { g.cannon.rotateLeft(); g.updateTrajectory(); }
    else if (a === "rotr") { g.cannon.rotateRight(); g.updateTrajectory(); }
    else if (a === "bond") g.useBondBreaker(performance.now());
    else if (a === "demo") { if (g.armBomb()) telemetry.ability("bomb-arm", g.elapsedMs); }
    else if (a === "cancel") this.input.cancelAim();
  }

  /** Music reacts to the toggle immediately rather than at the next screen —
   *  someone switching it off mid-run means "now". */
  private syncAudioSettings(): void {
    setAudioEnabled({ sound: this.settings.sound, music: this.settings.music });
  }

  private onToggle(key: string, el: HTMLElement): void {
    const cur = el.getAttribute("aria-checked") === "true";
    const next = !cur;
    el.setAttribute("aria-checked", String(next));
    (this.settings as unknown as Record<string, boolean>)[key] = next;
    saveSettings(this.settings);
    this.syncAudioSettings();
    // The rail mirror re-solves the layout on the spot; stickAssist is read
    // live by the gamepad poller and needs nothing here.
    if (key === "leftHandRail") this.applyRailSide();
    void tapHaptic();
    // After syncAudioSettings on purpose: switching Sound OFF clicks into
    // silence (playFx already gates on the new state) and switching it ON
    // clicks audibly — the click doubles as proof the toggle took effect.
    playUiClick(next ? 1.08 : 0.92);
  }

  /** The paywall itself is native UI configured in the RevenueCat dashboard —
   *  the re-render comes from the entitlement listener, so there's nothing to
   *  do here but celebrate. */
  private async onPaywall(): Promise<void> {
    if (await presentPaywall()) void successHaptic();
  }

  /** Restore is the one store action with no UI of its own, so it has to say
   *  something itself — a silent no-op reads as a broken button. */
  private async onRestore(): Promise<void> {
    const btn = this.overlay.querySelector<HTMLButtonElement>("#restore-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Restoring…"; }
    const restored = await restorePurchases();
    if (restored) void successHaptic();
    // Reset the button unconditionally.
    //
    // This used to return early on success and let the entitlement listener
    // re-render the panel. That only works when the entitlement actually
    // CHANGES: setUnlimited() short-circuits when the value is unchanged, so
    // restoring while already entitled — a player tapping Restore to check,
    // which is the common case — fired no listener, re-rendered nothing, and
    // left the button disabled on "Restoring…" permanently. Verified on device
    // against RevenueCat's Test Store: restorePurchases() resolved in 10ms with
    // the entitlement active while the button hung for as long as it was
    // watched.
    //
    // When the listener DOES fire it replaces the panel, so this node is
    // detached by then and the write below is a harmless no-op.
    if (btn) {
      btn.disabled = false;
      btn.textContent = restored ? "Purchases restored" : "Nothing to restore";
    }
  }

  private async onSubmitScore(): Promise<void> {
    const g = this.game;
    if (!g || this.submitted) return;
    const input = this.overlay.querySelector<HTMLInputElement>("#name-input");
    const name = (input?.value || loadName() || "ACE").toUpperCase().slice(0, 12);
    saveName(name);
    this.submitted = true;
    const row = this.overlay.querySelector("#submit-row");
    row?.classList.add("done");
    const lines = (this.run?.linesTotal ?? 0) + g.linesTotal;
    const res = await submitScore(name, this.finalScore(g, this.state === "won"), 1, lines);
    this.cachedBoard = res?.scores ?? (await fetchLeaderboard(1, 10));
    this.renderBoardRows(name);
    void successHaptic();
  }
}

new App(document.getElementById("app")!);
