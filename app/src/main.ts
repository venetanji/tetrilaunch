import "./styles/app.css";
import { Game, type GameStatus } from "./game/game";
import { makeBaseLevel } from "./game/level";
import { newRun, advanceRun, levelForRun, RUN_LEVELS, type RunState } from "./game/run";
import { draftOffers, modById, type ModDef } from "./game/mods";
import { render } from "./game/render";
import { InputController } from "./game/input";
import { nextPreviewHTML, bombNextHTML, formatMMSS } from "./ui/components";
import * as S from "./ui/screens";
import { fetchLeaderboard, submitScore, type ScoreEntry } from "./lib/api";
import {
  loadSettings, saveSettings, loadName, saveName, loadBest, saveBest, type Settings,
} from "./lib/store";
import {
  lockLandscape, isPortrait, enterFullscreen, tapHaptic, successHaptic, impactHaptic,
} from "./lib/platform";

type AppState =
  | "splash" | "menu" | "howto" | "settings" | "leaderboard"
  | "playing" | "draft" | "paused" | "won" | "lost";

const STEP = 1000 / 60;

class App {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlay: HTMLElement;
  private guard: HTMLElement;

  private state: AppState = "splash";
  private game: Game | null = null;
  private input: InputController;
  private settings: Settings = loadSettings();

  /** The current roguelite run (seed, level index, bankroll, drafted mods).
   *  Null only before the first "Play" — startGame() creates it. */
  private run: RunState | null = null;
  /** The 3 (or fewer, late in a run) modifier cards on offer in the draft modal. */
  private pendingOffers: ModDef[] = [];

  private dpr = 1;
  private last = 0;
  private acc = 0;
  /** Composite "type:quarterTurns:bomb:pieceCubes" key so the HUD preview
   *  refreshes on rotation, bomb telegraph, or a piece-size mutator too. */
  private lastNext: string | null = null;
  private cachedBoard: ScoreEntry[] = [];
  private submitted = false;

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
    this.overlay.addEventListener("keydown", this.onKeydown);
    window.addEventListener("keydown", this.onGlobalKey);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    window.addEventListener("pagehide", () => this.destroy());

    lockLandscape();
    this.onResize();
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
  }

  private destroy(): void {
    this.input.destroy();
    this.game?.destroy();
  }

  // ---------------- state / rendering ----------------
  private setState(s: AppState): void {
    this.state = s;
    this.renderOverlay();
    this.overlay.style.pointerEvents = s === "playing" ? "none" : "auto";
  }

  /** Shared hudHTML() input for every state that renders the HUD — keeps the
   *  bay/time/next-piece fields consistent across playing/paused/draft/end. */
  private hudOpts(g: Game): Parameters<typeof S.hudHTML>[0] {
    return {
      cannon: g.cannon,
      target: g.target,
      score: g.score,
      launchCost: g.level.launchCost,
      bayNum: (this.run?.levelIndex ?? 0) + 1,
      timeLimitSec: g.level.timeLimitSec,
      timeLeftMs: g.timeLeftMs,
      pieceCubes: g.level.pieceCubes,
      nextIsBomb: g.nextIsBomb,
    };
  }

  private renderOverlay(): void {
    const g = this.game;
    switch (this.state) {
      case "splash": this.overlay.innerHTML = S.splashScreen(); break;
      case "menu": this.overlay.innerHTML = S.menuScreen(loadBest()); break;
      case "howto": this.overlay.innerHTML = S.howtoScreen(); break;
      case "settings": this.overlay.innerHTML = S.settingsScreen(this.settings); break;
      case "leaderboard":
        this.overlay.innerHTML = S.leaderboardScreen(S.leaderboardRowsHTML(this.cachedBoard));
        break;
      case "playing":
        if (g) { this.overlay.innerHTML = S.hudHTML(this.hudOpts(g)); this.lastNext = null; }
        break;
      case "paused":
        if (g) this.overlay.innerHTML = S.hudHTML(this.hudOpts(g)) + S.pauseModal();
        break;
      case "draft":
        if (g && this.run) {
          const owned = this.run.modIds
            .map(modById)
            .filter((m): m is ModDef => m != null);
          this.overlay.innerHTML =
            S.hudHTML(this.hudOpts(g)) +
            S.draftScreen({
              bayNum: this.run.levelIndex + 1,
              bayName: g.level.name,
              nextBayName: makeBaseLevel(this.run.levelIndex + 1).name,
              funds: g.score,
              offers: this.pendingOffers,
              owned,
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
              score: g.score,
              lines: this.run.linesTotal + g.linesTotal,
              best: loadBest(),
              name: loadName(), rows: S.leaderboardRowsHTML(this.cachedBoard, loadName() || undefined),
              reason: g.lossReason,
              bayNum: this.run.levelIndex + 1,
              bayName: g.level.name,
              runComplete: this.state === "won",
            });
        }
        break;
    }
  }

  private onResize = (): void => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    const mobile = "ontouchstart" in window || w < 900;
    this.guard.classList.toggle("show", isPortrait() && mobile);
  };

  // ---------------- game lifecycle ----------------
  /** "Play"/"Play Again": starts a brand-new 10-bay run. */
  private startGame(): void {
    this.run = newRun(Date.now() >>> 0);
    this.submitted = false;
    this.startLevel();
  }

  /** (Re)starts the Game for the run's current levelIndex. Level 1 plays at
   *  the base level's startingFunds; every later bay's LevelConfig already
   *  has startingFunds overridden to the carried bankroll (see run.ts's
   *  levelForRun) — so the Game itself needs no run-awareness at all. */
  private startLevel(): void {
    if (!this.run) return;
    this.game?.destroy();
    this.game = new Game(levelForRun(this.run), {
      onShoot: () => { void tapHaptic(); },
      onLineClear: () => { void successHaptic(); this.flashGoal(); },
      onPieceLost: () => { void impactHaptic(); },
      onStatus: (s) => this.onGameStatus(s),
    });
    this.setState("playing");
    void enterFullscreen();
  }

  private onGameStatus(s: GameStatus): void {
    const g = this.game;
    if (!g || !this.run) return;
    if (s === "won") {
      void successHaptic();
      if (this.run.levelIndex < RUN_LEVELS - 1) {
        // Mid-run clear: draft a modifier over the frozen field. The Game
        // is deliberately NOT destroyed here — status "won" makes update()
        // a no-op, so the rAF loop just keeps re-rendering its last frame
        // behind the draft scrim until startLevel() tears it down.
        this.pendingOffers = draftOffers(this.run.seed, this.run.levelIndex, this.run.modIds);
        this.setState("draft");
      } else {
        // Bay 10 cleared: the run is complete.
        saveBest(g.score);
        this.refreshBoard();
        this.setState("won");
      }
    } else if (s === "lost") {
      void impactHaptic();
      saveBest(g.score);
      this.refreshBoard();
      this.setState("lost");
    }
  }

  /** "pick-mod"/"skip-mod": advance the run past the just-cleared bay and
   *  start the next one. `modId` is null for a skip. */
  private advanceAfterDraft(modId: string | null): void {
    const g = this.game;
    if (!g || !this.run) return;
    this.run = advanceRun(this.run, g.score, g.linesTotal, modId);
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

  private async refreshBoard(): Promise<void> {
    // The D1 board is the single RUN board for now — level is always 1
    // regardless of which bay the run ended on.
    this.cachedBoard = await fetchLeaderboard(1, 10);
    if (["leaderboard", "won", "lost"].includes(this.state)) this.renderOverlay();
  }

  // ---------------- main loop ----------------
  private loop = (now: number): void => {
    const g = this.game;
    if (g && this.state === "playing" && !g.paused) {
      let dt = now - this.last;
      if (dt > 250) dt = 250;
      this.acc += dt;
      while (this.acc >= STEP) {
        g.update(now);
        this.acc -= STEP;
      }
      this.syncHud(g);
    }
    this.last = now;

    if (g) {
      render(this.ctx, window.innerWidth, window.innerHeight, this.dpr, {
        cubes: g.cubes, compactor: g.compactor, cannon: g.cannon,
        trajectory: g.trajectory, now, aiming: g.aiming,
        effects: g.effects, level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
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
    set("#hud-score", "$" + g.score);
    set("#hud-combo", "×" + g.combo);
    const goal = this.overlay.querySelector<HTMLElement>("#hud-goal");
    if (goal) goal.style.width = Math.min(100, (g.score / g.target) * 100) + "%";
    const power = this.overlay.querySelector<HTMLElement>("#hud-power");
    if (power) power.style.width = Math.round(g.cannon.powerRatio * 100) + "%";

    if (g.timeLeftMs !== Infinity) {
      set("#hud-time", formatMMSS(g.timeLeftMs));
      this.overlay.querySelector("#hud-time-chip")?.classList.toggle("chip--danger", g.timeLeftMs < 20_000);
    }

    const nextKey = `${g.cannon.currentType}:${g.cannon.quarterTurns}:${g.nextIsBomb ? 1 : 0}:${g.level.pieceCubes}`;
    if (this.lastNext !== nextKey) {
      const next = this.overlay.querySelector("#hud-next");
      if (next) {
        next.innerHTML = g.nextIsBomb
          ? bombNextHTML()
          : nextPreviewHTML(g.cannon.currentType, g.cannon.quarterTurns, g.level.pieceCubes);
      }
      this.lastNext = nextKey;
    }
    const shoot = this.overlay.querySelector<HTMLButtonElement>("#shoot-btn");
    if (shoot) shoot.disabled = !g.cannon.canShoot(performance.now()) || g.score < g.level.launchCost;
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
    if (gameAct) { this.onGameAction(gameAct); return; }

    const action = el.getAttribute("data-action");
    if (!action) return;
    void tapHaptic();
    switch (action) {
      case "play": this.startGame(); break;
      case "howto": this.setState("howto"); break;
      case "settings": this.setState("settings"); break;
      case "leaderboard": this.refreshBoard(); this.setState("leaderboard"); break;
      case "menu": this.setState("menu"); break;
      case "pause": this.pause(); break;
      case "resume": this.resume(); break;
      case "restart": this.startGame(); break;
      case "submit-score": void this.onSubmitScore(); break;
      case "pick-mod":
        if (this.state === "draft") this.advanceAfterDraft(el.getAttribute("data-mod"));
        break;
      case "skip-mod":
        if (this.state === "draft") this.advanceAfterDraft(null);
        break;
    }
  };

  private onGameAction(a: string): void {
    const g = this.game;
    if (!g || this.state !== "playing") return;
    if (a === "shoot") g.shoot(performance.now());
    else if (a === "rotl") { g.cannon.rotateLeft(); g.updateTrajectory(); }
    else if (a === "rotr") { g.cannon.rotateRight(); g.updateTrajectory(); }
  }

  private onToggle(key: string, el: HTMLElement): void {
    const cur = el.getAttribute("aria-checked") === "true";
    const next = !cur;
    el.setAttribute("aria-checked", String(next));
    (this.settings as unknown as Record<string, boolean>)[key] = next;
    saveSettings(this.settings);
    void tapHaptic();
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
    const res = await submitScore(name, g.score, 1, lines);
    this.cachedBoard = res?.scores ?? (await fetchLeaderboard(1, 10));
    const body = this.overlay.querySelector("#lb-body");
    if (body) body.innerHTML = S.leaderboardRowsHTML(this.cachedBoard, name);
    void successHaptic();
  }
}

new App(document.getElementById("app")!);
