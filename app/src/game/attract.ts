// ATTRACT DEMO — the little self-playing game on the main menu.
//
// It is the actual game: the same Game class, the same physics, the same
// renderer, driven by an autopilot (autopilot.ts) instead of a thumb, drawn
// into a small canvas that takes no input. Nothing here is a mock-up or a
// recorded loop, which is the point — a canned animation would drift away from
// what the game looks like the first time anyone retunes a piece colour or the
// compactor's stroke, and it could never show a real line clear paying out.
//
// It replaces the paragraph of prose that used to describe the game on the
// menu. See ui/screens.ts's menuScreen: that copy still ships, as the demo's
// text alternative for screen readers and as what is actually shown when the
// demo can't or shouldn't run (reduced motion, no 2D context).
import { Game } from "./game";
import { makeBaseLevel, type LevelConfig } from "./level";
import { fitViewport, render } from "./render";
import { createAutopilot, type Autopilot } from "./autopilot";

/** Physics step (ms) — engine.ts's fixed 60Hz, same as main.ts's STEP. */
const STEP = 1000 / 60;

/** Longest real elapsed time (ms) fed into the fixed-step accumulator in one
 *  frame. A backgrounded tab or a slow first paint hands rAF a huge delta, and
 *  without this the demo would try to catch up hundreds of steps in one frame
 *  — a visible hitch in service of simulating time nobody watched. */
const MAX_FRAME_MS = 100;

/** Steps simulated in one blocking burst at mount (and on every recycle)
 *  before the first frame is drawn, so the demo opens on a bay with cargo in
 *  it rather than an empty box the viewer watches fill up.
 *
 *  3s, and the ceiling is the burst's cost rather than how it looks: measured
 *  on a dev machine a 3s warm-up is ~7ms of physics, 5s is ~18ms — the field
 *  is filling as it runs, so the cost climbs faster than the duration. A frame
 *  budget is 16ms, and this lands on the frame the menu is already being built
 *  on and again on each recycle, so the cheap end of "long enough to have
 *  landed a couple of shipments" is the right end. */
const WARMUP_STEPS = Math.round(3000 / STEP);

/**
 * Recycle bounds — when the current bay is torn down and replaced with a fresh
 * seed. The pile is the cost: Matter's per-step work scales with the bodies in
 * the world, and a demo bay accumulates cargo faster than the autopilot clears
 * it (about 11 shipments to 2.5 completed lines per 10s), so an unbounded
 * demo's cost climbs the whole time the menu is open — measured, from 0.13ms
 * per step at 10s to 1.0ms at 60s and still rising at 90s. On the MENU, of all
 * places, which is where a phone would otherwise be idle.
 *
 * Cubes are the primary bound and the clock is a backstop, rather than the
 * other way around, because cube count is what the cost actually tracks — and
 * bounding the real quantity means a bay that plays cleanly gets to run
 * longer instead of being cut at the same mark as a messy one.
 *
 * The cap is set high (measured over 12 seeds: a mean 58s cycle carrying ~15
 * line clears, 0.39ms per step, against 38s/8 clears/0.29ms at 90 cubes)
 * because a SHORT cycle is worse than it looks. The opening of a bay is its
 * dullest stretch — nothing completes a row until a couple of shipments have
 * landed across the zone — so recycling early doesn't just show less, it
 * spends a larger share of the viewer's time on the empty part. In the browser
 * this costs about 1.1ms of a 16.7ms frame, physics and render together.
 */
const MAX_CUBES = 110;
const CYCLE_MS = 90_000;

/** Fade-in (ms) covering a recycle, so a new bay reads as a cut rather than
 *  the pile teleporting away. */
const FADE_MS = 450;

/** Hard cap on the demo's backing-store scale. The play field uses up to 2;
 *  this is a decorative panel a fraction of the size, and 1.5 is the point
 *  past which nobody can tell on a canvas this small. */
const MAX_DPR = 1.5;

/**
 * The bay the demo plays: bay 1's ladder entry with every FAILURE and every
 * ENDING taken out of it.
 *
 * A demo that can be lost is a demo that spends part of its life showing a
 * modal, and one that can be WON is worse — winning opens the settle window
 * (game.ts's resolveWin), which locks the cannon for several seconds and reads
 * on screen as the game having crashed. So: no clock, launches are free, the
 * funding target is out of reach, and the loop is recycled on this module's own
 * terms instead (see CYCLE_MS / the topout check in step()).
 *
 * Free launches also remove the only other way this ends — the broke-loss
 * countdown can't start while funds cover a shot, and at zero cost they always
 * do (game.ts's broke branch).
 */
function demoLevel(): LevelConfig {
  const base = makeBaseLevel(0);
  return {
    ...base,
    timeLimitSec: 0,
    launchCost: 0,
    // Out of reach rather than merely high: `score` still climbs on every
    // payout, and a target the demo could stumble into after ten minutes on
    // the menu is a bug that only ever shows up for the one player who leaves
    // it there. A billion is ~10 million line clears away and still an
    // ordinary number for everything downstream to do arithmetic on.
    targetScore: 1e9,
    // Everything else — the 900ms fire cooldown included — is bay 1 exactly.
    // The cooldown in particular was worth trying to shorten and is worth
    // leaving alone: measured over 5 seeds x 90s, dropping it to 700ms took
    // the autopilot from 27 lines and 6% of its cargo wasted to 17 lines and
    // 38%. A shipment fired that fast arrives before the previous one has
    // settled, and lands on a pile still moving — so the "livelier" demo is
    // one that spends its time scattering cargo out of the bay and flashing
    // penalty numbers, which is neither livelier nor what the game is.
  };
}

interface Cycle {
  game: Game;
  pilot: Autopilot;
  /** Demo-local clock (ms), advanced one STEP per simulated step rather than
   *  read off rAF. Everything time-based downstream — the fire cooldown, FX
   *  lifetimes, the lost-cube blink — is stamped against this, so a frame the
   *  browser never delivered can't age them. */
  clock: number;
  /** clock value at which this bay is recycled. */
  endsAt: number;
  /** clock value the current fade-in finishes at. */
  fadeUntil: number;
}

export class AttractDemo {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cycle: Cycle | null = null;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private dpr = 1;
  /** CSS px size the backing store was last sized for. */
  private cssW = 0;
  private cssH = 0;
  private observer: ResizeObserver | null = null;
  /** Bumped per recycle and mixed into each bay's seed, so consecutive bays
   *  don't replay one another. */
  private cycleIndex = 0;

  /**
   * Point the demo at a canvas, starting it if it isn't already running.
   * Returns false when the demo declines to run at all — the caller shows the
   * descriptive copy instead.
   *
   * Safe to call on every menu render: the overlay rewrites its innerHTML
   * wholesale (main.ts's renderOverlay), so the canvas is a NEW element each
   * time even though the demo behind it should carry on. Re-pointing at the new
   * element keeps the bay running rather than restarting it every time
   * something unrelated re-renders the menu.
   */
  mount(canvas: HTMLCanvasElement): boolean {
    const ctx = this.allowed() ? canvas.getContext("2d") : null;
    if (!ctx) {
      // Also covers the preference being turned ON while the demo is up: the
      // caller drops `is-live`, which hides the canvas, and a demo left
      // running behind a hidden canvas would keep a physics world stepping
      // for nobody.
      this.stop();
      return false;
    }

    if (this.canvas !== canvas) {
      this.detachObserver();
      this.canvas = canvas;
      this.ctx = ctx;
      // Force a resize on the next frame — a fresh element's backing store is
      // 300x150 regardless of what the old one measured.
      this.cssW = 0;
      this.cssH = 0;
      this.attachObserver();
    }

    if (!this.cycle) this.cycle = this.newCycle();
    if (!this.raf) {
      this.lastFrame = performance.now();
      this.acc = 0;
      document.addEventListener("visibilitychange", this.onVisibility);
      this.raf = requestAnimationFrame(this.frame);
    }
    return true;
  }

  /** Stop the loop and drop the simulation. Called when the menu goes away and
   *  on teardown — a physics world nobody is looking at is pure battery. */
  stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.detachObserver();
    this.cycle?.game.destroy();
    this.cycle = null;
    this.canvas = null;
    this.ctx = null;
  }

  /**
   * Whether the demo should run here at all. Reduced motion is the whole test:
   * a looping animation is exactly what that preference is about, and the
   * paragraph it replaced is a complete answer for anyone who has set it (same
   * treatment the rest of the app's motion gets — see app.css's
   * prefers-reduced-motion blocks).
   */
  private allowed(): boolean {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    return !mq?.matches;
  }

  private newCycle(): Cycle {
    // Wall-clock seeded, deliberately: everything else in the game is seeded
    // for reproducibility, but a demo that opens on the identical deal every
    // time the menu is visited is the one thing this must not do.
    this.cycleIndex += 1;
    const seed = (Date.now() ^ (this.cycleIndex * 0x9e3779b9)) >>> 0;
    const game = new Game(demoLevel(), {}, seed);
    const cycle: Cycle = {
      game,
      pilot: createAutopilot(seed),
      clock: 0,
      endsAt: CYCLE_MS,
      fadeUntil: 0,
    };
    for (let i = 0; i < WARMUP_STEPS; i++) this.step(cycle);
    // Fade measured from the END of the warmup, so the cut is covered by the
    // pile the viewer is actually about to see.
    cycle.fadeUntil = cycle.clock + FADE_MS;
    return cycle;
  }

  /** One fixed physics step: autopilot first (it fires through the same
   *  Game.shoot the player's thumb does), then the world. */
  private step(cycle: Cycle): void {
    cycle.clock += STEP;
    cycle.pilot.act(cycle.game, cycle.clock);
    cycle.game.update(cycle.clock);
  }

  private frame = (ts: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const cycle = this.cycle;
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!cycle || !ctx || !canvas) return;

    const dt = Math.min(ts - this.lastFrame, MAX_FRAME_MS);
    this.lastFrame = ts;
    this.acc += dt;
    let stepped = false;
    while (this.acc >= STEP) {
      this.step(cycle);
      this.acc -= STEP;
      stepped = true;
    }
    // Once per DRAWN frame, matching main.ts's loop: game.update() no longer
    // recomputes the dotted arc per step, so nothing else would keep it
    // tracking the wind between shots. Inert at this bay's dead calm — the
    // autopilot already refreshes it when it aims — but the demo should not be
    // the one place that silently depends on the bay staying windless.
    if (stepped) cycle.game.updateTrajectory();

    // Recycle once the pile has grown past what a menu should be spending on
    // it, on the backstop clock, or the moment the bay ends under its own
    // rules. That last one is a topout in practice — the autopilot keeps the
    // stack low enough that it's rare (0 in 24 measured cycles) and the demo
    // level removes every other ending — but a demo frozen behind a lost bay
    // would be the worst thing on the screen, so it is handled rather than
    // argued away.
    if (
      cycle.game.cubes.length > MAX_CUBES ||
      cycle.clock >= cycle.endsAt ||
      cycle.game.status !== "playing"
    ) {
      cycle.game.destroy();
      this.cycle = this.newCycle();
      return;
    }

    this.draw(canvas, ctx, cycle);
  };

  private draw(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, cycle: Cycle): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return; // laid out to nothing (hidden tab, mid-relayout)
    if (w !== this.cssW || h !== this.cssH) {
      this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      this.cssW = w;
      this.cssH = h;
      canvas.width = Math.max(1, Math.floor(w * this.dpr));
      canvas.height = Math.max(1, Math.floor(h * this.dpr));
    }

    const g = cycle.game;
    // The same renderer the play field uses, drawing the same scene — only the
    // viewport differs: a decorative panel gets no control-rail band reserved
    // out of it and no notch inset applied (see render.ts's fitViewport).
    render(ctx, w, h, this.dpr, {
      cubes: g.cubes,
      constraints: g.constraints,
      compactor: g.compactor,
      cannon: g.cannon,
      trajectory: g.trajectory,
      now: cycle.clock,
      aiming: false,
      effects: g.effects,
      level: g.level,
      nextIsBomb: g.nextIsBomb,
      bombs: g.bombs,
      windNow: g.windNow,
      // The gauge's ghost marker is a Weather Survey readout (main.ts) and this
      // bay is dead calm anyway — nothing to reveal.
      windAverage: null,
      reload: g.cannon.reloadRatio(cycle.clock),
      settling: g.settling,
      strandWarning: g.strandWarning,
      // The demo runs the same accumulator main.ts's loop does (see frame
      // above), so it interpolates on the same terms — and it should, because
      // the menu is the FIRST thing a 120Hz panel draws. A demo stuttering at
      // 60Hz behind a game that no longer does would advertise the opposite of
      // what the change bought.
      alpha: this.acc / STEP,
    }, fitViewport(w, h));

    if (cycle.clock < cycle.fadeUntil) {
      const t = (cycle.fadeUntil - cycle.clock) / FADE_MS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(4, 4, 10, ${t.toFixed(3)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  /** A hidden tab stops delivering rAF anyway; this drops the accumulated
   *  backlog on the way back so the first visible frame doesn't fast-forward
   *  through the time the tab spent in the background. */
  private onVisibility = (): void => {
    if (!document.hidden) {
      this.lastFrame = performance.now();
      this.acc = 0;
    }
  };

  private attachObserver(): void {
    // Only to catch the case the draw loop can't: the canvas being resized
    // while the demo is paused between frames. Sizing itself happens in draw()
    // off clientWidth/clientHeight, which is authoritative either way.
    if (typeof ResizeObserver === "undefined" || !this.canvas) return;
    this.observer = new ResizeObserver(() => {
      this.cssW = 0;
      this.cssH = 0;
    });
    this.observer.observe(this.canvas);
  }

  private detachObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
