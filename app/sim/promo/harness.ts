/**
 * PROMO HARNESS (browser half) — the shipped App, driven from outside.
 *
 * Importing src/main.ts boots the real App into #app exactly as index.html
 * does. Under `vite dev` main.ts hands its instance to the page as
 * window.__tl (import.meta.env.DEV), and that instance's own entry points —
 * launchSandbox, setState, pickTier — are what this file drives. Nothing here
 * builds a Game of its own: a bay the App did not construct would be a bay
 * the trailer does not show.
 *
 * The three things layered on top of the App, all from outside it:
 *
 *  1. A SIM PILOT on the bay. The App's loop calls game.update(now) once per
 *     physics step; wrapping that method runs bot.act(game, now) first, which
 *     is the same order sim/runner.ts's runBay uses. The pilot is one of
 *     sim/bots.ts's own, composed through beats.ts's makeBot.
 *  2. AN EVENT LOG (events.ts) over the App's callbacks, so run.ts can stamp
 *     line clears, blasts, the buzzer and the loss onto frame indices.
 *  3. SCRIPTED HANDS for the two abilities the pilots will not pull in a
 *     beat's configuration — a charge into a live pile (bots.ts only bombs
 *     dead cargo) and a lance on cue. Both go through Game's own armBomb /
 *     shoot / useThawLance, never around them.
 *
 * Time is not touched here. run.ts owns the clock: Chromium's virtual time
 * policy (CDP Emulation) for timers, Date, performance.now and the
 * stylesheet's transitions, plus a requestAnimationFrame shim installed before
 * the page loads, flushed once per captured frame — because the compositor's
 * BeginFrame that drives real rAF stays on the wall clock under virtual time
 * (measured: five callbacks in sixty 16.7ms budgets), and the App's loop is
 * an rAF loop.
 */
import "../../src/main";
import type { Bot } from "../bots";
import { SCREENS } from "../uifit/fixtures";
import type { Game } from "../../src/game/game";
import type { SandboxState } from "../../src/game/sandbox";
import { newTiers } from "../../src/game/upgrades";
import type { MetaState } from "../../src/game/meta";
import { BEATS, makeBot, type BayConfig, type BayPhase, type BotSpec, type PromoEvent, type PromoStatus } from "./beats";
import { recordEvents } from "./events";
import { HANDS, statusOf } from "./hands";
import { buildBay, doneAtMs, findDoneSeed, findLuckySeed, flyBay, type FlightLog, type LuckResult } from "./preroll";

/** The App members this harness reaches for. They are `private` in main.ts,
 *  which TypeScript enforces and the runtime does not — the same door the
 *  DEV-only __tl handle was cut for. Kept to a named list so a rename in
 *  main.ts fails here at the one place it is spelled. */
interface TlApp {
  state: string;
  game: Game | null;
  sandbox: SandboxState;
  meta: MetaState;
  overlay: HTMLElement;
  /** The fixed-step loop's clock: the last rAF timestamp and the unspent
   *  remainder. Zeroed with the page clock at launch so the bay's first step
   *  is at t = 1000/fps exactly, as it is in the preroll. */
  last: number;
  acc: number;
  launchSandbox(): void;
  pickTier(tier: number): void;
  setState(s: string): void;
  fullGame(): boolean;
  renderOverlay(): void;
  syncAttract(): void;
}

function app(): TlApp {
  const tl = (window as unknown as { __tl?: TlApp }).__tl;
  if (!tl) throw new Error("window.__tl is not set — is this a vite dev serve of the app?");
  return tl;
}

const events: PromoEvent[] = [];
let steps = 0;
let pilot: Bot | null = null;
let hooked: Game | null = null;

const now = (): number => performance.now();

/** Wrap the current bay: events, the step counter, and the pilot. Idempotent
 *  per Game instance. */
function hook(g: Game): void {
  if (hooked === g) return;
  hooked = g;
  steps = 0;
  recordEvents(g, now, (e) => events.push(e));
  const update = g.update.bind(g);
  (g as { update: Game["update"] }).update = (t: number) => {
    steps += 1;
    if (pilot && g.status === "playing") pilot.act(g, t);
    update(t);
  };
}

function status(): PromoStatus {
  const a = app();
  return statusOf(a.game, a.state, steps, now());
}

/** One scripted hand, through hands.ts, logged as a `scripted` event. */
function hand(action: keyof typeof HANDS): boolean {
  const g = app().game;
  if (!g) return false;
  const ok = HANDS[action](g, now());
  if (ok) events.push({ t: now(), kind: "scripted", action });
  return ok;
}

export interface PromoApi {
  ready(): boolean;
  fonts(): Promise<void>;
  /** Hide the desktop-only key strip and the build stamp; force the paid
   *  floors open (the ride into them is a beat). */
  prep(): void;
  patchMeta(patch: Partial<MetaState>): void;
  launchBay(cfg: BayConfig, bot: BotSpec | null): void;
  attachBot(bot: BotSpec | null): string | null;
  dismissCoach(): boolean;
  snapshot(cursor: number): { status: PromoStatus; events: PromoEvent[]; cursor: number };
  fixture(id: string): void;
  setState(s: string): void;
  pickTier(tier: number): void;
  setAiming(on: boolean): void;
  fireBomb(): boolean;
  fireThaw(): boolean;
  fireBond(): boolean;
  /**
   * THE PREROLL, IN THIS ENGINE. preroll.ts's headless flights, run inside
   * the page so their arithmetic is Chromium's: node's V8 and the browser's
   * disagree in the last bit of enough transcendental results that two
   * identical bays part ways after a few hundred steps of a chaotic pile.
   * Same seed, same pilot, same code — only where it runs.
   */
  fly(cfg: BayConfig, bot: BotSpec | null, maxSec: number): FlightLog;
  /** The preroll's own builders, for a lockstep twin of the App's bay. */
  __buildBay: typeof buildBay;
  __makeBot: typeof makeBot;
  prerollPhase(beatId: string, phase: number, config: BayConfig): { at: number | null; log: FlightLog };
  findLuckySeed(beatId: string, phase: number, from: number, count: number): (Omit<LuckResult, "log"> & { log: FlightLog }) | null;
  findDoneSeed(beatId: string, phase: number, from: number, count: number): ReturnType<typeof findDoneSeed>;
}

function bayPhase(beatId: string, phase: number): BayPhase {
  const p = BEATS[beatId]?.phases[phase];
  if (!p || p.kind !== "bay") throw new Error(`${beatId}[${phase}] is not a bay phase`);
  return p;
}

declare global {
  interface Window {
    __promo: PromoApi;
  }
}

const api: PromoApi = {
  ready: () => !!(window as unknown as { __tl?: unknown }).__tl,

  async fonts() {
    // The same forced fetch uifit's runner does: fonts.ready alone resolves
    // before a lazily-loaded face has been asked for.
    const faces = [
      '12px "Press Start 2P"',
      '500 12px "Rajdhani"', '700 12px "Rajdhani"',
      '700 12px "Orbitron"', '900 12px "Orbitron"',
      '400 12px "JetBrains Mono"', '700 12px "JetBrains Mono"', '800 12px "JetBrains Mono"',
    ];
    await Promise.all(faces.map((f) => document.fonts.load(f, "TETRILAUNCH 0123456789$")));
    await document.fonts.ready;
  },

  prep() {
    const style = document.createElement("style");
    style.id = "promo-chrome";
    // .kbd-hint is the desktop-only key strip docs/PLAY.md says to hide for a
    // capture; .build-tag is the git-sha stamp in the corner, debug decoration
    // (see sim/uifit/run.ts's DECORATIVE list) that has no place in a trailer.
    style.textContent = `.kbd-hint, .build-tag { display: none !important; }`;
    document.head.appendChild(style);
    // An own property shadows the prototype's fullGame(): the tower draws the
    // paid floors open, and the elevator can ride into them.
    app().fullGame = () => true;
  },

  patchMeta(patch) {
    const a = app();
    a.meta = { ...a.meta, ...patch };
  },

  launchBay(cfg, bot) {
    const a = app();
    const s = a.sandbox;
    s.tier = cfg.tier;
    s.seed = cfg.seed;
    s.target = { kind: "bay", bay: cfg.bay ?? 1 };
    s.tiers = { ...newTiers(), ...(cfg.tiers ?? {}) };
    s.ratchets = { ...(cfg.ratchets ?? {}) };
    s.material = cfg.material ?? "mix";
    s.final = null;
    events.length = 0;
    pilot = bot ? makeBot(bot) : null;
    // Bay time starts at zero: run.ts's page clock, if installed, resets, and
    // the App's loop forgets whatever remainder the menu left it with.
    (window as unknown as { __clock?: { reset(): void } }).__clock?.reset();
    a.launchSandbox();
    if (!a.game) throw new Error("launchSandbox left no game");
    a.last = performance.now();
    a.acc = 0;
    if (cfg.funds !== undefined) a.game.score = cfg.funds;
    hook(a.game);
  },

  attachBot(bot) {
    const g = app().game;
    if (!g) return null;
    hook(g);
    pilot = bot ? makeBot(bot) : null;
    return pilot ? pilot.name : null;
  },

  dismissCoach() {
    // docs/PLAY.md's recipe: whichever teaching card is up, press its button.
    const btn = document.querySelector<HTMLElement>(
      '[data-action="coach-done"], [data-action="coach-skip"]',
    );
    if (!btn) return false;
    btn.click();
    return true;
  },

  snapshot(cursor) {
    return { status: status(), events: events.slice(cursor), cursor: events.length };
  },

  fixture(id) {
    const make = SCREENS[id];
    if (!make) throw new Error(`unknown uifit fixture "${id}"`);
    const a = app();
    a.overlay.innerHTML = make();
    // The fixture's menu carries a demo canvas; the App's own mount puts the
    // attract loop on it, so the hold is a live menu rather than a still.
    try { a.syncAttract(); } catch { /* not a menu fixture */ }
  },

  setState: (s) => app().setState(s),
  pickTier: (tier) => app().pickTier(tier),

  setAiming(on) {
    const g = app().game;
    if (!g) return;
    g.aiming = on;
    g.updateTrajectory();
  },

  fireBomb: () => hand("bomb"),
  fireThaw: () => hand("thaw"),
  fireBond: () => hand("bond"),

  fly: (cfg, bot, maxSec) => flyBay(cfg, bot, maxSec),
  __buildBay: buildBay,
  __makeBot: makeBot,
  prerollPhase: (beatId, phase, config) => doneAtMs({ ...bayPhase(beatId, phase), config }),
  findLuckySeed: (beatId, phase, from, count) => findLuckySeed(bayPhase(beatId, phase), from, count),
  findDoneSeed: (beatId, phase, from, count) => findDoneSeed(bayPhase(beatId, phase), from, count),
};

window.__promo = api;
