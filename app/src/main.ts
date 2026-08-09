import "./styles/app.css";
import { Game, type GameStatus } from "./game/game";
import { makeBaseLevel } from "./game/level";
import {
  newRun, advanceRun, levelForRun, finalRunScore, isRefitBay, baysUntilRefit, buyUpgrade,
  RUN_LEVELS, type RunState,
} from "./game/run";
import {
  hazardOffers, hazardById, picksPerBay, HAZARDS,
  type HazardDef, type HazardId, type Ratchets,
} from "./game/hazards";

/** A run's ratchets flattened to "axis:notches" for telemetry, in ladder order
 *  so two runs with the same build produce byte-identical strings. */
function axisNotchList(ratchets: Ratchets): string[] {
  return HAZARDS
    .filter((h) => (ratchets[h.id] ?? 0) > 0)
    .map((h) => `${h.id}:${ratchets[h.id]}`);
}
import { MAX_TIER, nextTierCost, type UpgradeId, type UpgradeTiers } from "./game/upgrades";
import {
  buyInstall, markUnlocked, recordContractClear, recordRunEnd, safeLoadout,
  tierProgressFor, unlockAvailable, unlockById, type MetaState, type TierResult,
} from "./game/meta";
import {
  dailyContracts, levelForContract, type Contract,
} from "./game/contracts";
import { render } from "./game/render";
import { AttractDemo } from "./game/attract";
import * as telemetry from "./lib/telemetry";
import { computeLayout } from "./game/layout";

import { InputController } from "./game/input";
import { beltPieceHTML, beltBombHTML, formatMMSS } from "./ui/components";
import * as S from "./ui/screens";
import { fetchLeaderboard, submitScore, type ScoreEntry } from "./lib/api";
import { compactorSpeedFor } from "./game/compactor";
import {
  loadSettings, saveSettings, loadName, saveName, loadBest, saveBest,
  loadMeta, saveMeta, type Settings,
} from "./lib/store";
import {
  lockLandscape, isPortrait, tapHaptic, successHaptic, impactHaptic,
  autoEnterFullscreenForRun, toggleFullscreen, isFullscreen, fullscreenSupported,
  applySafeAreaInsets, purgeNativeServiceWorker,
} from "./lib/platform";
import {
  initPurchases, purchasesReady, isUnlimited, onUnlimitedChange,
  presentPaywall, presentCustomerCenter, restorePurchases,
} from "./lib/purchases";
import {
  unlockAudio, setAudioEnabled, playFx, playImpact, playLineClear, playBondBreak,
  playMusic, playStinger, stopStinger, suspendAudio, resumeAudio,
} from "./lib/audio";

type AppState =
  | "splash" | "menu" | "howto" | "settings" | "leaderboard" | "workshop"
  | "playing" | "bayclear" | "refit" | "draft" | "paused" | "won" | "lost"
  | "contracts" | "contract-end";

const STEP = 1000 / 60;
/** Most physics steps one rendered frame may run to catch the simulation up
 *  to wall-clock time — see the loop() accumulator for why this is capped. */
const MAX_CATCHUP_STEPS = 4;

class App {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private guard: HTMLElement;

  private state: AppState = "splash";
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
  /** Persistent meta-progression state (salvage + unlocks — see game/meta.ts).
   *  Loaded once at boot and written back on every purchase/run end. */
  private meta: MetaState = loadMeta();
  /** Which half of the Workshop shop is showing. Lives here, not in the DOM:
   *  renderOverlay() rewrites overlay.innerHTML wholesale and both purchase
   *  handlers call it, so a :checked-sibling or :target tab would snap back to
   *  Systems on every buy (and :target would push history entries besides). */
  private workshopTab: S.ShopTab = "systems";
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
  /** Rising-edge latch for the reload-ready cue (see syncHud). */
  private reloadWasReady = true;
  /** What the Contract just finished did to tier progress — whether this
   *  attempt was the first clear, and whether it completed the tier (see
   *  meta.ts's recordContractClear). Null until one resolves. */
  private contractAward: (TierResult & { firstClear: boolean }) | null = null;

  private dpr = 1;
  private last = 0;
  private acc = 0;
  /** Composite "type:quarterTurns:bomb:pieceCubes" key so the HUD preview
   *  refreshes on rotation, bomb telegraph, or a piece-size mutator too. */
  private lastNext: string | null = null;
  private cachedBoard: ScoreEntry[] = [];
  private submitted = false;

  /** Finger-drag onboarding hint (see ui/screens.ts's dragHintHTML) — a 15s
   *  once-per-session idle timer, armed at each bay start. */
  private dragHintTimer: number | null = null;
  private dragHintShownThisSession = false;

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

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <canvas id="game"></canvas>
      <div id="overlay"></div>
      <div class="rotate-guard" id="rotate-guard">
        <div class="phone"></div>
        <div class="eyebrow">Rotate your device</div>
        <p class="muted">Tetrilaunch plays in landscape.</p>
      </div>`;
    this.canvas = root.querySelector("#game")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.overlay = root.querySelector("#overlay")!;
    this.guard = root.querySelector("#rotate-guard")!;

    this.input = new InputController(this.canvas, () => this.game);

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
    this.onResize();

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
    this.state = s;
    this.syncMusic(s);
    this.renderOverlay();
    this.overlay.style.pointerEvents = s === "playing" ? "none" : "auto";
  }

  /**
   * One track per context, switched from the single choke point every screen
   * change already passes through. playMusic() ignores a repeat of what's
   * already playing, so paused/draft/refit keep the bay's bed running rather
   * than restarting it every time a modal opens.
   *
   * Contracts and the Deep Run get different beds because they are different
   * modes, not different levels — the run is the long haul, a Contract is a
   * short retryable challenge.
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
        playMusic(this.contract ? "contracts" : "deep-run");
        return;

      // Pausing drops to the lounge bed: the driving track under a paused game
      // reads as pressure while nothing is happening.
      case "paused":
        stopStinger();
        playMusic("menu");
        return;

      // Everything out-of-run shares the menu bed.
      default:
        stopStinger();
        playMusic("menu");
    }
  }

  /** Shared hudHTML() input for every state that renders the HUD — keeps the
   *  bay/time/next-piece fields consistent across playing/paused/draft/end. */
  private hudOpts(g: Game): Parameters<typeof S.hudHTML>[0] {
    return {
      beltPreview: g.beltPreview,
      target: g.target,
      score: g.score,
      launchCost: g.level.launchCost,
      bayNum: (this.run?.levelIndex ?? 0) + 1,
      timeLimitSec: g.level.timeLimitSec,
      timeLeftMs: g.timeLeftMs,
      pieceSize: g.level.pieceSize,
      bondBreakerOwned: g.level.bondBreakerCharges > 0,
      autoloaderOwned: g.level.autoLaunchMs > 0,
      bondCharges: g.bondCharges,
      demoOwned: g.level.bombCharges > 0,
      bombCharges: g.bombCharges,
      ratchets: this.run?.ratchets ?? {},
      tiers: this.run?.tiers ?? ({} as UpgradeTiers),
      contract: this.contract
        ? {
            name: this.contract.name,
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

  private renderOverlay(): void {
    const g = this.game;
    switch (this.state) {
      case "splash": this.overlay.innerHTML = S.splashScreen(); break;
      case "menu":
        this.overlay.innerHTML = S.menuScreen(
          loadBest(), this.meta.salvage, this.storeState(), tierProgressFor(this.meta),
        );
        break;
      case "workshop": this.overlay.innerHTML = S.workshopScreen(this.meta, this.workshopTab); break;
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
            });
        }
        break;
      case "howto": this.overlay.innerHTML = S.howtoScreen(); break;
      case "settings":
        this.overlay.innerHTML = S.settingsScreen(this.settings, this.storeState());
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
            this.mountCoach(S.coachHTML(this.tutorialStep, g.level));
          }
          this.lastNext = null;
          this.syncCoachReveal();
        }
        break;
      case "paused":
        if (g) this.overlay.innerHTML = S.hudHTML(this.hudOpts(g)) + S.pauseModal();
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
        if (g && this.run) {
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.refitScreen({
              // levelIndex has already been stepped past the cleared bay by
              // afterBayClear, so it IS the just-cleared bay's 1-based number,
              // and makeBaseLevel(levelIndex) is the bay about to be played.
              bayNum: this.run.levelIndex,
              nextBayName: makeBaseLevel(this.run.levelIndex).name,
              scrap: this.run.scrap,
              tiers: this.run.tiers,
            });
        }
        break;
      case "draft":
        if (g && this.run) {
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.draftScreen({
              // Same already-advanced levelIndex as the refit screen above.
              bayNum: this.run.levelIndex,
              bayName: g.level.name,
              nextBayName: makeBaseLevel(this.run.levelIndex).name,
              funds: g.score,
              // Read the carry the RUN actually recorded rather than
              // recomputing it, so what's displayed can't drift from what the
              // next bay's float is really getting (see advanceRun).
              carry: this.run.carry,
              offers: this.pendingOffers,
              ratchets: this.run.ratchets,
              picked: this.pendingPicks,
              picksNeeded: picksPerBay(this.run.mark),
              scrap: this.run.scrap,
              // Bay-CLEARS until the next refit stop, counting the bay about to
              // be played; 1 means "clear this one and you dock". Null late in a
              // run when no stop remains.
              baysToRefit: baysUntilRefit(this.run.levelIndex),
            });
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

  /** Reflects fullscreen availability/state onto every fullscreen control
   *  currently mounted (the HUD icon button and/or the pause modal's row —
   *  renderOverlay() recreates both from scratch on every state change, so
   *  this needs to re-run each time, not just once at startup). Hides the
   *  control entirely on platforms without a Fullscreen API at all (e.g.
   *  iPhone Safari in-browser) instead of showing a button that can never
   *  do anything. */
  private syncFullscreenButtons(): void {
    const supported = fullscreenSupported();
    const fs = isFullscreen();
    this.overlay.querySelectorAll<HTMLElement>('[data-action="fullscreen"]').forEach((btn) => {
      btn.classList.toggle("fs-hidden", !supported);
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
    // Gutters actually available OUTSIDE the field on each axis — what the rail
    // positions against. In "snug" this is the reserved band, in "wide"/"tall"
    // the natural letterbox gutter; either way the rail reads one number and
    // never has to know which mode produced it.
    rs.setProperty("--gutter-r", `${Math.max(0, w - l.ox - l.fw)}px`);
    rs.setProperty("--gutter-b", `${Math.max(0, h - l.oy - l.fh)}px`);
    rs.setProperty("--rail-btn", `${l.railSize}px`);
    document.documentElement.dataset.layout = l.mode;

    const mobile = "ontouchstart" in window || w < 900;
    this.guard.classList.toggle("show", isPortrait() && mobile);
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
    this.setState("playing");
    this.armDragHint();
  }

  /** Shows the finger-drag onboarding hint immediately on a brand-new
   *  player's very first bay (persisted via settings.seenDragHint);
   *  otherwise arms it as a once-per-session fallback if 15s pass at this
   *  bay's start with no shot fired. */
  private armDragHint(): void {
    if (this.dragHintTimer !== null) { window.clearTimeout(this.dragHintTimer); this.dragHintTimer = null; }
    if (!this.settings.seenDragHint) {
      this.overlay.querySelector("#drag-hint")?.classList.remove("drag-hint--hidden");
    } else if (!this.dragHintShownThisSession) {
      this.dragHintTimer = window.setTimeout(() => {
        this.dragHintShownThisSession = true;
        this.overlay.querySelector("#drag-hint")?.classList.remove("drag-hint--hidden");
      }, 15_000);
    }
  }

  /** Hides the drag hint for good once a real shot fires, and marks it seen. */
  private dismissDragHint(): void {
    if (this.dragHintTimer !== null) { window.clearTimeout(this.dragHintTimer); this.dragHintTimer = null; }
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
    this.mountCoach(S.coachHTML(to, g.level));
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
    this.run = null;
    this.contract = c;
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
        this.pendingOffers = hazardOffers(
          this.run.seed, this.run.levelIndex, this.run.mark,
        );
        this.pendingPicks = [];
        this.setState("bayclear");
        this.bayClearTimer = window.setTimeout(() => this.afterBayClear(), S.BAY_CLEAR_MS);
      } else {
        // Bay 10 cleared: the run is complete.
        this.finishRun(true);
      }
    } else if (s === "lost") {
      void impactHaptic();
      this.showSettleNote(false);
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
    );
    // isRefitBay takes the just-CLEARED bay's index, which advanceRun has
    // already stepped past — hence the -1.
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

  /** Refit stop: buy one tier of a system with the run's scrap. Re-renders the
   *  refit screen in place so the newly-revealed next-tier price is visible
   *  immediately. A rejected purchase (maxed, or unaffordable) is a silent
   *  no-op — the button was already disabled, so this is belt-and-braces. */
  private onBuyUpgrade(id: string): void {
    if (this.state !== "refit" || !this.run) return;
    const tier = this.run.tiers[id as UpgradeId] ?? 0;
    const cost = nextTierCost(tier);
    if (cost === null) return;
    const next = buyUpgrade(this.run, id as UpgradeId, cost, MAX_TIER);
    if (!next) return;
    telemetry.refit(this.run.levelIndex + 1, this.run.scrap, id);
    this.run = next;
    void successHaptic();
    this.refreshRefit();
  }

  /** Re-render the refit stop's card grid and scrap chip IN PLACE after a
   *  purchase, rather than calling renderOverlay(). A full re-render recreates
   *  the `.panel.modal.pop` node, replaying its entrance animation on every
   *  buy — so a player working through three purchases watches the whole modal
   *  fly in three times. Same reasoning (and same idiom) as renderBoardRows
   *  patching #lb-body instead of re-rendering the leaderboard modal. */
  private refreshRefit(): void {
    if (!this.run) return;
    const grid = this.overlay.querySelector("#refit-grid");
    const scrap = this.overlay.querySelector("#refit-scrap");
    if (!grid || !scrap) return;
    // Render the screen to a detached container and lift just the two live
    // regions out of it — keeps one source of truth for the card markup
    // (screens.ts's refitScreen) instead of a second copy that could drift.
    const tmp = document.createElement("div");
    tmp.innerHTML = S.refitScreen({
      bayNum: this.run.levelIndex,
      nextBayName: makeBaseLevel(this.run.levelIndex).name,
      scrap: this.run.scrap,
      tiers: this.run.tiers,
    });
    const freshGrid = tmp.querySelector("#refit-grid");
    const freshScrap = tmp.querySelector("#refit-scrap");
    if (freshGrid) grid.innerHTML = freshGrid.innerHTML;
    if (freshScrap) scrap.textContent = freshScrap.textContent;
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
  private onShopTab(tab: string): void {
    if (tab !== "systems" && tab !== "options") return;
    if (tab === this.workshopTab) return;
    this.workshopTab = tab;
    this.renderOverlay();
  }

  /** "pick-hazard": bank one ratchet notch, and start the next bay once the
   *  Mark's full quota of picks is in. The bay itself was already banked into
   *  the run by afterBayClear (so a refit stop could spend its scrap), so this
   *  ONLY records the choice — it must not call advanceRun again or the run
   *  would skip a bay.
   *
   *  There is no skip. The ratchet is the price of the bay just cleared, and a
   *  draft you can decline is a draft with a dominant option. */
  private onPickHazard(id: string): void {
    if (!this.run || this.state !== "draft") return;
    if (!hazardById(id)) return;
    // Only from the hand actually dealt — a stale or hand-edited data-hazard
    // must not let a player ratchet an axis their Mark has not opened.
    if (!this.pendingOffers.some((h) => h.id === id)) return;
    this.pendingPicks = [...this.pendingPicks, id as HazardId];
    if (this.pendingPicks.length < picksPerBay(this.run.mark)) {
      this.renderOverlay();
      return;
    }
    const ratchets = { ...this.run.ratchets };
    for (const axis of this.pendingPicks) ratchets[axis] = (ratchets[axis] ?? 0) + 1;
    this.run = { ...this.run, ratchets };
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

    if (g) {
      render(this.ctx, window.innerWidth, window.innerHeight, this.dpr, {
        cubes: g.cubes, compactor: g.compactor, cannon: g.cannon,
        trajectory: g.trajectory, now, aiming: g.aiming,
        effects: g.effects, level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
        windNow: g.windNow,
        // The bay's steady prevailing wind is only revealed with the Weather
        // Survey unlock (see game/meta.ts) — otherwise null and the gauge
        // shows only the live reading, as before.
        windAverage: this.meta.unlocks.includes("survey") ? g.windAverage : null,
        reload: g.cannon.reloadRatio(now),
        settling: g.settling,
      });
    } else {
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
    // In a Contract these two slots hold lines and launches instead of funds
    // and launches (see screens.ts's hudHTML): a Contract has no bankroll, so
    // the funds readout would sit at $0 with 0 launches for the whole bay.
    if (this.contract) {
      const pattern = this.contract.kind === "pattern";
      const supply = pattern ? g.piecesLeft : g.launchesLeft;
      set("#hud-score", String(g.linesTotal));
      set("#hud-launches", String(supply === Infinity ? 0 : supply));
      this.overlay
        .querySelector("#hud-launches-chip")
        ?.classList.toggle("pl-stat--danger", supply <= 2);
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
    set("#hud-combo", "×" + g.combo);
    set("#hud-scrap", String(g.scrapEarned));

    // LAUNCHES LEFT — tier 2 of the plant readout (see screens.ts's hudHTML).
    // It turns danger-red and pulses at LOW_LAUNCH_WARN or fewer, because that
    // is the exact point where the right play changes from "keep feeding the
    // bay" to "this shot has to count". Computed from funds, so it also drops
    // when a mod raises launchCost — the warning tracks affordability, not a
    // separate ammo counter.
    if (!this.contract) {
      const launches = Math.floor(g.score / Math.max(1, g.level.launchCost));
      set("#hud-launches", String(launches));
      this.overlay
        .querySelector("#hud-launches-chip")
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
    const powerPct = Math.round(g.cannon.powerRatio * 100);
    const power = this.overlay.querySelector<HTMLElement>("#hud-power");
    if (power) power.style.width = powerPct + "%";
    set("#hud-power-val", powerPct + "%");

    // RELOAD bar — same value the canvas draws as a ring around the muzzle
    // (render.ts's drawReloadRing). Two views of one number on purpose: the
    // ring is what you read mid-aim with your eyes on the cannon, this is what
    // you catch in peripheral vision while looking at the pile.
    const reload = g.cannon.reloadRatio(performance.now());
    const load = this.overlay.querySelector<HTMLElement>("#hud-load");
    if (load) load.style.width = Math.round(reload * 100) + "%";
    const ready = reload >= 1;
    this.overlay.querySelector("#hud-load-row")?.classList.toggle("ready", ready);
    // Audible on the RISING edge only. syncHud runs every frame, so testing
    // `ready` alone would retrigger ~60x/sec for as long as the player takes to
    // aim — which, per the telemetry note in cannon.ts, is most of the time.
    if (ready && !this.reloadWasReady) playFx("reloadReady", { gain: 0.5 });
    this.reloadWasReady = ready;

    if (g.timeLeftMs !== Infinity) {
      set("#hud-time", formatMMSS(g.timeLeftMs));
      this.overlay.querySelector("#hud-time-chip")?.classList.toggle("pl-stat--danger", g.timeLeftMs < 20_000);
    }

    // NEXT preview rides the conveyor belt (top-left) — the shot that fires
    // AFTER the muzzle's (see game.ts's beltPreview), just the colored piece
    // grid, no label/type text (see components.ts's beltPieceHTML).
    const bp = g.beltPreview;
    const nextKey = `${bp.type}:${bp.quarterTurns}:${bp.bomb ? 1 : 0}:${bp.empty ? 1 : 0}:${g.level.pieceSize}:${bp.material}`;
    if (this.lastNext !== nextKey) {
      const next = this.overlay.querySelector("#hud-next");
      if (next) {
        next.innerHTML = bp.bomb
          ? beltBombHTML()
          : bp.empty
            ? ""
            : beltPieceHTML(bp.type, bp.quarterTurns, g.level.pieceSize, bp.material);
      }
      this.lastNext = nextKey;
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
    if (e.key === "Escape") {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    }
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
      // Pointer taps already acted on pointerdown (see onGamePointerDown);
      // only keyboard activation (click with detail 0) still lands here.
      if (e.detail === 0) this.onGameAction(gameAct);
      return;
    }

    const action = el.getAttribute("data-action");
    if (!action) return;
    void tapHaptic();
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
      case "leaderboard": this.refreshBoard(); this.setState("leaderboard"); break;
      case "workshop": this.workshopTab = "systems"; this.setState("workshop"); break;
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
      case "menu": this.contract = null; this.setState("menu"); break;
      case "pause": this.pause(); break;
      case "resume": this.resume(); break;
      case "fullscreen": void toggleFullscreen().then(() => this.syncFullscreenButtons()); break;
      case "restart": this.startGame(); break;
      case "restart-bay": this.restartBay(); break;
      case "submit-score": void this.onSubmitScore(); break;
      case "paywall": void this.onPaywall(); break;
      case "customer-center": void presentCustomerCenter(); break;
      case "restore": void this.onRestore(); break;
      case "pick-hazard":
        this.onPickHazard(el.getAttribute("data-hazard") ?? "");
        break;
      // Tap-through for the bay-clear celebration — a player who has seen it
      // before shouldn't have to wait out the animation.
      case "skip-bayclear": this.afterBayClear(); break;
      case "buy-upgrade": this.onBuyUpgrade(el.getAttribute("data-upgrade") ?? ""); break;
      case "refit-done": if (this.state === "refit") this.setState("draft"); break;
      case "buy-unlock": this.onBuyUnlock(el.getAttribute("data-unlock") ?? ""); break;
      case "buy-install": this.onBuyInstall(el.getAttribute("data-install") ?? ""); break;
      case "shop-tab": this.onShopTab(el.getAttribute("data-tab") ?? ""); break;
    }
  };

  /** In-game [data-game] buttons act on pointerdown, not click: browsers
   *  only synthesize click for the PRIMARY pointer, so while a finger
   *  holds the slingshot drag a second finger's tap on rotate/✕ never
   *  produces a click at all. Firing on press also feels snappier for
   *  game controls. onClick keeps keyboard activation working (a
   *  keyboard "click" has detail 0 and no preceding pointerdown). */
  private onGamePointerDown = (e: PointerEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-game]");
    if (!el || (el as HTMLButtonElement).disabled) return;
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
    this.onGameAction(act);
  };

  /** Ends an Autoloader burst on release, on the window rather than the button
   *  so a thumb that drifts off mid-hold cannot leave the trigger stuck down. */
  private onGlobalPointerUp = (e: PointerEvent): void => {
    if (this.autoPointerId === null || e.pointerId !== this.autoPointerId) return;
    this.autoPointerId = null;
    this.game?.setAutoHeld(false);
  };

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
    if (a === "rotl") { g.cannon.rotateLeft(); g.updateTrajectory(); }
    else if (a === "rotr") { g.cannon.rotateRight(); g.updateTrajectory(); }
    else if (a === "bond") g.useBondBreaker(performance.now());
    else if (a === "demo") { if (g.armBomb()) { telemetry.ability("bomb-arm", g.elapsedMs); void tapHaptic(); } }
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
    void tapHaptic();
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
