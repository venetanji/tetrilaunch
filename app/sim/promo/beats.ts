/**
 * PROMO BEATS — what each shot of the trailer IS, stated once.
 *
 * Shared by both halves of the harness: harness.ts (the page, which builds
 * the bots and launches the bays) and run.ts (node, which drives the clock and
 * decides when a beat is over). The preroll (preroll.ts) also flies the same
 * bay with the same bot — in the page, un-filmed — to find a seed or an event
 * time before a frame is spent on it. That is why everything here is plain
 * data plus pure functions over a status snapshot: the same definition has to
 * mean the same bay in three places.
 *
 * Nothing here imports the DOM or node. bots.ts, aim-strategies.ts and
 * counters.ts are browser-safe (they import only src/game and matter-js),
 * which is what lets the sim's own pilots fly the shipped App.
 */
import type { Bot } from "../bots";
import { ADAPTIVE_BOTS, aimBot, BOTS } from "../bots";
import { STRATEGIES, strategyPilot } from "../aim-strategies";
import { thawHands } from "../counters";
import type { UpgradeTiers } from "../../src/game/upgrades";
import type { Ratchets } from "../../src/game/hazards";
import type { SandboxMaterial } from "../../src/game/sandbox";
import type { GradeTally } from "../../src/game/grades";
import { SCHOOL_STEPS, type MetaState } from "../../src/game/meta";

/** A Tier S launch, exactly the fields game/sandbox.ts's SandboxState carries
 *  for a bay target. `bay` defaults to 1. */
export interface BayConfig {
  tier: number;
  bay?: number;
  seed: number;
  tiers?: Partial<UpgradeTiers>;
  ratchets?: Ratchets;
  material?: SandboxMaterial;
  /**
   * Funds to open the bay with, written onto the Game after launch.
   *
   * A Tier S bay launches COLD — carry 0, so a stock rig has ~100 in the till,
   * four launches, and the first press sweep does not pay until ~10s in. A
   * pilot flown like that fires four shots and waits, which is honest play
   * and an empty shot. The trailer wants a bay mid-run, and this is the one
   * number that makes it one. The HUD shows whatever is set.
   */
  funds?: number;
}

/**
 * Which sim pilot flies the beat.
 *
 * `preset` is a bots.ts name (`aim`, `patient`, `demo`, `impatient`, or one of
 * the fixed-aim presets); `strategy` layers an aim-strategies.ts policy over
 * an adaptive preset through strategyPilot, which is how the sweeps compose
 * them too. There is no bot called "flush" anywhere in sim/ — the closest
 * thing to "the most accurate strategy" is the `excellent` policy (it holds
 * for the press's timing window) over the plain `aim` search, and that is
 * what `plan` flies.
 */
export interface BotSpec {
  preset: string;
  strategy?: string;
  seed: number;
  /** counters.ts's thawHands — pull the lance whenever it would do anything. */
  thaw?: boolean;
  /** bondHands through strategyPilot. Off by default: a Bond Breaker firing
   *  in the middle of a beat about something else is noise. */
  bond?: boolean;
  /**
   * A DELIBERATE ACCURACY HANDICAP: every `every`-th shot leaves the muzzle
   * `deg` degrees flatter and `power` faster than the search chose, so it
   * slams into the stack it was meant to sit on. The `slip` beat's whole
   * subject. Applied at the shoot call rather than in the search so the arc
   * on screen is the honest one right up to the trigger.
   */
  slip?: { every: number; deg: number; power: number };
}

/** What run.ts polls out of the page once per frame. */
export interface PromoStatus {
  state: string;
  hasGame: boolean;
  status: string | null;
  /** The cannon is off cooldown — the aim arc is drawn, a shot can leave. */
  ready: boolean;
  lossReason: string | null;
  timeLeftMs: number | null;
  elapsedMs: number;
  cubes: number;
  lines: number;
  score: number;
  target: number;
  bombs: number;
  thaw: number;
  /** Physics steps the wrapped update() has run — should track frames 1:1. */
  steps: number;
}

export interface PromoEvent {
  /** performance.now() in the page when it fired. */
  t: number;
  kind:
    | "shoot" | "clear" | "stamp" | "explosion" | "status" | "loss" | "buzzer"
    | "bayclear" | "congestion" | "thaw" | "bond" | "settle" | "cryoShatter"
    | "pieceLost" | "cushion" | "scripted";
  lines?: number;
  grades?: GradeTally;
  /** The best grade in a clear's tally (grades.ts order). */
  grade?: string;
  explosion?: string;
  status?: string;
  reason?: string | null;
  tier?: number;
  tiers?: number;
  action?: string;
}

/**
 * THE FRAME DELTA the page clock and the preroll both advance by: one 60Hz
 * frame plus 2^-36 ms (~1.5e-11).
 *
 * The nudge is for main.ts's fixed-step accumulator. It steps while
 * `acc >= STEP`, and the delta it sees is `now - last` — the difference of
 * two accumulated sums, which in binary floating point can come out one ulp
 * under 1000/60 (measured: 50 - 33.333333333333336 = 16.666666666666664).
 * That frame steps zero times and the next steps twice, with both steps
 * handed the same `now`; the preroll, which has no accumulator, steps once
 * per frame regardless — and the two bays part ways from there. A delta that
 * is always at least one ulp over STEP steps exactly once per frame, and the
 * residual (1.5e-11 a frame) never reaches a second step. Both sides add the
 * same number from zero, so their `now` sequences are bit-for-bit the same.
 */
export const PROMO_DT = 1000 / 60 + 2 ** -36;

const GRADE_ORDER = ["excellent", "good", "swept", "lucky"] as const;
export function bestGrade(t: GradeTally): string {
  for (const g of GRADE_ORDER) if (t[g] > 0) return g;
  return "none";
}

/* ---------------------------------------------------------------------------
 * BOTS
 * ------------------------------------------------------------------------- */

/** Wrap a pilot so every `every`-th shot goes in flat and hot. See BotSpec.slip. */
function slipped(base: Bot, h: NonNullable<BotSpec["slip"]>): Bot {
  let n = 0;
  return {
    name: `${base.name}+slip`,
    act(g, now) {
      const orig = g.shoot;
      // Own-property shadow over the prototype method for the duration of
      // one act(); deleted after, so nothing else ever sees the handicap.
      (g as { shoot: typeof orig }).shoot = function (this: typeof g, t: number, auto?: boolean) {
        n += 1;
        if (n % h.every === 0) {
          g.cannon.angle -= (h.deg * Math.PI) / 180;
          g.cannon.power = Math.min(g.cannon.speedMax, g.cannon.power + h.power);
          g.updateTrajectory();
        }
        return orig.call(this, t, auto);
      };
      try {
        base.act(g, now);
      } finally {
        delete (g as Partial<{ shoot: typeof orig }>).shoot;
      }
    },
  };
}

export function makeBot(spec: BotSpec): Bot {
  let bot: Bot;
  if (spec.strategy) {
    const strategy = STRATEGIES[spec.strategy];
    if (!strategy) throw new Error(`unknown strategy "${spec.strategy}"`);
    const opts = ADAPTIVE_BOTS[spec.preset];
    if (!opts) throw new Error(`strategy pilots need an adaptive preset, not "${spec.preset}"`);
    bot = strategyPilot(strategy, { bot: opts, bond: spec.bond ?? false })(spec.seed);
  } else if (ADAPTIVE_BOTS[spec.preset]) {
    bot = aimBot(spec.seed, ADAPTIVE_BOTS[spec.preset]);
  } else {
    const make = BOTS[spec.preset];
    if (!make) throw new Error(`unknown bot "${spec.preset}"`);
    bot = make(spec.seed);
  }
  if (spec.thaw) bot = thawHands(bot);
  if (spec.slip) bot = slipped(bot, spec.slip);
  return bot;
}

/* ---------------------------------------------------------------------------
 * BEATS
 * ------------------------------------------------------------------------- */

/** A scripted action the harness fires itself when the bot will not. */
export interface ScriptedAction {
  action: "bomb" | "thaw" | "bond";
  /** Fire once, the first frame this is true. */
  when(st: PromoStatus, ev: PromoEvent[]): boolean;
}

export interface BayPhase {
  kind: "bay";
  config: BayConfig;
  bot: BotSpec | null;
  /** Hard stop, in bay seconds from launch, if `done` never fires. */
  maxSec: number;
  /**
   * Fly this many bay seconds un-filmed before the first frame: the press
   * sweeps on a ~10s cadence and a pile takes a few shots to exist, so a beat
   * that opened on the launch would spend its whole length on an empty floor.
   */
  skipSec?: number;
  /** Frames kept after `done` fires, so the event it fired on can be read. */
  tailSec: number;
  done(st: PromoStatus, ev: PromoEvent[]): boolean;
  scripted?: ScriptedAction[];
  /**
   * Skip capture until this many bay seconds before the phase's end event.
   * The end time comes from preroll.ts flying the same bay headlessly first.
   * A phase without it captures from the launch.
   */
  leadSec?: number;
}

export interface DomPhase {
  kind: "dom";
  /** What to put on screen. */
  show:
    | { fixture: string }
    | { state: string; meta?: Partial<MetaState> }
    | { ride: number; from: number; meta?: Partial<MetaState> }
    | { pausedOver: { fixture: string; config: BayConfig; bot: BotSpec; warmSec: number } };
  holdSec: number;
}

export type Phase = BayPhase | DomPhase;

export interface BeatDef {
  id: string;
  card: string;
  phases: Phase[];
  /**
   * Walk seeds from `from` (the configured seed first) until preroll.ts's
   * criterion holds: "done" — the first bay phase's own end condition fires
   * inside maxSec; "lucky" — the last clear is graded lucky at the buzzer.
   * Every event-driven beat carries one, because the seed a beat was tuned
   * on in node can play out differently in the browser (preroll.ts's header),
   * and a beat whose event never comes is a beat with nothing to cut to.
   */
  seedSearch?: { from: number; count: number; criterion: "done" | "lucky" };
}

const clears = (ev: PromoEvent[]): PromoEvent[] => ev.filter((e) => e.kind === "clear");

/**
 * WHY EVERY BAY OPENS WITH FUNDS AND A LEAD-IN. Measured with preroll.ts: a
 * cold Tier S bay holds ~100 (four launches) and the press's first paying
 * sweep lands at ~10.5s, so a beat filmed from the launch is an empty floor
 * and a waiting cannon. `funds` keeps the pilot firing (well under the target,
 * or the bay settles and WINS on the spot); `leadSec` opens the window just
 * before the event the beat is about; `skipSec` is the fallback when there is
 * no event to lead into.
 */
const PILE_FOR_BOMB = 20;

export const BEATS: Record<string, BeatDef> = {
  plan: {
    id: "plan",
    seedSearch: { from: 20260101, count: 12, criterion: "done" },
    card: "YOU HAVE A PLAN.",
    phases: [{
      kind: "bay",
      config: { tier: 1, seed: 20260101, funds: 450 },
      // The congestion-aware search: the honest pilot, which holds when the
      // bay is too full to fire into. Its rows pay at ~28s on this seed.
      bot: { preset: "patient", seed: 7 },
      maxSec: 40,
      tailSec: 1.2,
      leadSec: 9,
      done: (_st, ev) => clears(ev).length >= 2,
    }],
  },
  precision: {
    id: "precision",
    seedSearch: { from: 20260117, count: 24, criterion: "done" },
    card: "IT TAKES SKILL.",
    phases: [{
      kind: "bay",
      config: { tier: 3, seed: 20260117, tiers: { bonds: 1 }, funds: 900 },
      // The `excellent` policy holds each shot for the press's 100ms window
      // (grades.ts). On this seed its stamp lands at ~33.5s. A two-row clear
      // was in the brief as well; the sim's pilots almost never produce one
      // alongside an excellent stamp inside a beat, so the stamp alone ends it
      // and a two-row clear is a bonus when it happens.
      bot: { preset: "aim", strategy: "excellent", seed: 14 },
      maxSec: 45,
      tailSec: 1.4,
      leadSec: 8,
      done: (_st, ev) => ev.some((e) => e.kind === "stamp" && e.grade === "excellent"),
    }],
  },
  slip: {
    id: "slip",
    seedSearch: { from: 20260105, count: 12, criterion: "done" },
    card: "IT WON'T ALWAYS WORK.",
    phases: [{
      kind: "bay",
      // Crosswind at two notches and slag riding the belt, set straight onto
      // the run's ratchet table (sandbox.ts's sandboxRunFor copies it) rather
      // than through the screen, which only offers the axes the ladder deals
      // at Mark 5 — slag enters at Mark 6.
      config: { tier: 5, seed: 20260105, ratchets: { wind: 2, slag: 1 }, funds: 900 },
      bot: { preset: "impatient", seed: 5, slip: { every: 3, deg: 12, power: 5 } },
      maxSec: 20,
      tailSec: 1.5,
      leadSec: 7,
      done: (_st, ev) => ev.some((e) => e.kind === "congestion" && (e.tier ?? 0) >= 1),
    }],
  },
  improvise: {
    id: "improvise",
    seedSearch: { from: 20260107, count: 12, criterion: "done" },
    card: "FORTUNE FAVOURS THE BRAVE.",
    phases: [{
      kind: "bay",
      config: {
        tier: 7, seed: 20260107,
        tiers: { demolition: 2, thaw: 1 },
        ratchets: { cryo: 2, volatile: 2 },
        funds: 900,
      },
      // The lance policy strikes cryo with shipments and pulls the lance for
      // the cube the press is about to reach; the demo preset's charge hands
      // only bomb DEAD cargo (bots.ts's bestBlastSite reads slag alone), and
      // this belt carries none — so the bomb is scripted below (hands.ts).
      bot: { preset: "demo", strategy: "lance", seed: 13 },
      maxSec: 34,
      tailSec: 1.5,
      leadSec: 11,
      scripted: [
        {
          action: "bomb",
          when: (st, ev) => st.bombs > 0 && st.cubes >= PILE_FOR_BOMB
            && st.elapsedMs > 5000 && !ev.some((e) => e.kind === "scripted" && e.action === "bomb"),
        },
        {
          action: "thaw",
          when: (st, ev) => st.thaw > 0 && st.elapsedMs > 9000
            && !ev.some((e) => e.kind === "thaw"),
        },
      ],
      // The blast, then a sweep that pays: a clear AFTER the bomb went off.
      done: (_st, ev) => {
        const b = ev.findIndex((e) => e.kind === "explosion" && e.explosion === "bomb");
        return b >= 0 && ev.slice(b + 1).some((e) => e.kind === "clear");
      },
    }],
  },
  luck: {
    id: "luck",
    card: "…OR THE LUCKY.",
    seedSearch: { from: 20260200, count: 40, criterion: "lucky" },
    phases: [{
      kind: "bay",
      // The clock ratcheted three notches shorter so the bay ends on the
      // buzzer rather than on the target or the till; the plain aim search,
      // whose rows the press sweeps shut — the grades that read "lucky"
      // (grades.ts). preroll.ts walks seeds from `seedSearch.from` for one
      // whose last clear is lucky within LUCK_WINDOW_MS of the buzzer.
      config: { tier: 6, seed: 20260200, funds: 450, ratchets: { time: 3 } },
      bot: { preset: "aim", seed: 3 },
      maxSec: 200,
      tailSec: 2.5,
      leadSec: 10,
      done: (_st, ev) => ev.some((e) => e.kind === "buzzer"),
    }],
  },
  loss: {
    id: "loss",
    seedSearch: { from: 20260109, count: 12, criterion: "done" },
    card: "",
    phases: [{
      kind: "bay",
      // Mark 9 with the press and the wind notched up, flown by the pilot that
      // stands every shipment on end: a tall, fragile pile the sweeps keep
      // taking pieces out of until the till runs dry (~90s on this seed).
      config: { tier: 9, seed: 20260109, funds: 600, ratchets: { sweeper: 2, wind: 2 } },
      bot: { preset: "lob-tall", seed: 9 },
      maxSec: 130,
      tailSec: 3.5,
      leadSec: 8,
      done: (_st, ev) => ev.some((e) => e.kind === "loss"),
    }],
  },
  climb: {
    id: "climb",
    card: "RETRY. RETRY. RETRY.",
    phases: [
      { kind: "dom", show: { fixture: "menu-seals-live" }, holdSec: 2.5 },
      {
        kind: "dom",
        show: {
          pausedOver: {
            fixture: "contract-end",
            config: { tier: 3, seed: 20260113, funds: 700 },
            bot: { preset: "aim", seed: 4 },
            warmSec: 7,
          },
        },
        holdSec: 2.5,
      },
      {
        kind: "dom",
        show: {
          state: "workshop",
          meta: {
            salvage: 240, runs: 52, bestBay: 10, mark: 6,
            loadout: {
              bay: 1, launcher: 1, hydraulics: 1, magazine: 1, reactor: 2,
              bonds: 0, demolition: 2, thaw: 0, cushion: 0, incinerator: 0,
            },
          },
        },
        holdSec: 2.5,
      },
      { kind: "dom", show: { ride: 7, from: 3, meta: { mark: 6, sealedMarks: [1, 2] } }, holdSec: 3.5 },
    ],
  },
};

/**
 * MATERIALS — the problem, then the answer, from DESIGN.md's materials table:
 * slag answers with Demolition, cryo with the Thaw Lance, rebar with the Bond
 * Breaker, volatile with soft landings (the Impact Cushion's liner). Each is
 * two launches: the same belt on a stock rig, then on the rig that answers it.
 */
const MAT_TIER = 6;
const MAT_SEC = 2.5;
const MAT_FUNDS = 900;
interface MaterialHalf {
  bot: BotSpec;
  /** Bay seconds before the window opens — placed on the event the half is
   *  about (measured with preroll.ts: the first sweep at ~10.5s, cryo
   *  shattering under the press at ~5.7s, and so on). */
  skipSec: number;
  tiers?: Partial<UpgradeTiers>;
  scripted?: ScriptedAction[];
}
function materialBeat(
  material: "slag" | "cryo" | "volatile" | "rebar",
  problem: MaterialHalf, answer: MaterialHalf,
): BeatDef {
  const half = (h: MaterialHalf): BayPhase => ({
    kind: "bay",
    config: { tier: MAT_TIER, seed: 20260300, material, funds: MAT_FUNDS, tiers: h.tiers },
    bot: h.bot,
    maxSec: h.skipSec + MAT_SEC, tailSec: 0, skipSec: h.skipSec,
    done: () => false,
    scripted: h.scripted,
  });
  return { id: `materials-${material}`, card: "", phases: [half(problem), half(answer)] };
}

const SPRAY: BotSpec = { preset: "impatient", seed: 21 };
const once = (kind: PromoEvent["kind"], ev: PromoEvent[]): boolean => !ev.some((e) => e.kind === kind);

// Slag fills slots and never counts: the first sweep at ~10.5s pays nothing
// and the bay tips into congestion at 10.9s. The demo hands bomb dead cargo
// on their own (bots.ts's bestBlastSite) — first charge at ~4.1s.
BEATS["materials-slag"] = materialBeat("slag",
  { bot: SPRAY, skipSec: 8.5 },
  { bot: { preset: "demo", seed: 22 }, skipSec: 3.2, tiers: { demolition: 2 } },
);
// Cryo pressed cold shatters the row (~5.7s on this seed); the lance hands
// pull the Thaw Lance on the first frozen cube at rest (~1.4s).
BEATS["materials-cryo"] = materialBeat("cryo",
  { bot: SPRAY, skipSec: 4.6 },
  { bot: { preset: "aim", strategy: "strike", seed: 23, thaw: true }, skipSec: 0.8, tiers: { thaw: 2 } },
);
// Volatile goes off on a hard landing (first at ~1.4s under a flat, hot
// spray); the cushion policy lobs it into the liner, which absorbs at ~0.9s.
BEATS["materials-volatile"] = materialBeat("volatile",
  { bot: { ...SPRAY, slip: { every: 2, deg: 14, power: 6 } }, skipSec: 0.9 },
  { bot: { preset: "aim", strategy: "cushion", seed: 24 }, skipSec: 0.5, tiers: { cushion: 2 } },
);
// Rebar never breaks and the press labours against it (the sweep at ~10.8s);
// the Bond Breaker, scripted onto a settled pile at 8s, frees the press.
BEATS["materials-rebar"] = materialBeat("rebar",
  { bot: SPRAY, skipSec: 8.5 },
  {
    bot: SPRAY, skipSec: 7.2, tiers: { bonds: 2 },
    scripted: [{
      action: "bond",
      when: (st, ev) => st.elapsedMs > 8000 && st.cubes >= 16 && once("scripted", ev),
    }],
  },
);

export const BEAT_ORDER = [
  "plan", "precision", "slip", "improvise", "luck", "loss", "climb",
  "materials-slag", "materials-cryo", "materials-volatile", "materials-rebar",
];

/* ---------------------------------------------------------------------------
 * STORE SCENES
 * ------------------------------------------------------------------------- */

export type SceneShow =
  | { kind: "menu"; warmSec: number }
  | { kind: "state"; state: string; warmSec: number }
  | {
      kind: "bay"; config: BayConfig; bot: BotSpec; warmSec: number;
      /** Capture on this condition rather than at warmSec. */
      until?: (st: PromoStatus, ev: PromoEvent[]) => boolean;
      /** Frames after `until` before the shot, e.g. for a row flash to bloom. */
      settleFrames?: number;
      /** Hold the aim arc on screen for the shot. */
      aiming?: boolean;
    };

export interface SceneDef {
  id: string;
  /** "menu" scenes use the menu/boards CSS size, "game" scenes the gameplay one. */
  family: "menu" | "game";
  show: SceneShow;
}

/** The tower state every store scene boots with: licence earned, a Mark in
 *  hand, two floors sealed, a Contract logged. */
export const STORE_META: Partial<MetaState> = {
  mark: 4, salvage: 1_480, runs: 37, bestBay: 8, sealedMarks: [1, 2], tierContracts: 1,
  // Flight School finished: without it the menu, Workshop and Contracts all
  // render their lesson-ladder copy rather than the game.
  licence: SCHOOL_STEPS,
  seenContractBoard: true, seenDraft: true, seenRefit: true,
  loadout: {
    bay: 1, launcher: 1, hydraulics: 0, magazine: 1, reactor: 1,
    bonds: 1, demolition: 0, thaw: 0, cushion: 0, incinerator: 0,
  },
};

export const SCENES: SceneDef[] = [
  { id: "menu", family: "menu", show: { kind: "menu", warmSec: 7 } },
  {
    id: "aim-arc", family: "game",
    show: {
      kind: "bay", config: { tier: 3, seed: 20260401, tiers: { bonds: 1 }, funds: 900 },
      bot: { preset: "aim", strategy: "excellent", seed: 31 }, warmSec: 20, aiming: true,
      // A pile to aim at, and the cannon reloaded — the arc is only drawn
      // off cooldown.
      until: (st) => st.elapsedMs > 8000 && st.cubes >= 12 && st.ready,
    },
  },
  {
    id: "line-clear", family: "game",
    show: {
      kind: "bay", config: { tier: 2, seed: 20260402, funds: 900 },
      bot: { preset: "aim", strategy: "excellent", seed: 32 }, warmSec: 30,
      until: (_st, ev) => ev.some((e) => e.kind === "clear"), settleFrames: 7,
    },
  },
  { id: "workshop", family: "menu", show: { kind: "state", state: "workshop", warmSec: 0.5 } },
  { id: "contracts", family: "menu", show: { kind: "state", state: "contracts", warmSec: 0.5 } },
  { id: "leaderboard", family: "menu", show: { kind: "state", state: "leaderboard", warmSec: 1 } },
  {
    id: "materials-bay", family: "game",
    show: {
      kind: "bay", config: { tier: 8, seed: 20260408, material: "all", ratchets: { wind: 2 }, funds: 900 },
      bot: { preset: "patient", seed: 38 }, warmSec: 12,
    },
  },
];

/** A store size: the PNG the store wants, and the CSS viewport x DPR that
 *  produces it exactly. */
export interface StoreSize {
  store: "play" | "appstore";
  /** Directory name under <out>/store/<store>/. */
  label: string;
  px: { w: number; h: number };
  /** CSS viewport per scene family; the DPR is px / css. */
  css: { menu: { w: number; h: number }; game: { w: number; h: number } };
  /** Only these scenes, when set (the feature graphic and the portrait rows). */
  only?: string[];
  note?: string;
}

/**
 * Play's 16:9 recipe is docs/PLAY.md's: 960x540 @2.5 for menu and boards
 * (the phone-landscape layout the menu was designed around), 1280x720 @1.875
 * for gameplay. Apple's sizes are the current App Store Connect landscape
 * requirements as of this writing (docs/ios.md names only the two device
 * classes, not pixel sizes): iPhone 6.9" 2868x1320, 6.5" 2688x1242, iPad 13"
 * 2752x2064. Each is rendered at half size @2.
 */
export const STORE_SIZES: StoreSize[] = [
  {
    store: "play", label: "2400x1350", px: { w: 2400, h: 1350 },
    css: { menu: { w: 960, h: 540 }, game: { w: 1280, h: 720 } },
  },
  {
    store: "play", label: "1024x500", px: { w: 1024, h: 500 },
    css: { menu: { w: 1024, h: 500 }, game: { w: 1024, h: 500 } },
    only: ["menu"], note: "feature graphic slot; a raw menu render, not artwork",
  },
  {
    store: "play", label: "1350x2400-portrait", px: { w: 1350, h: 2400 },
    css: { menu: { w: 540, h: 960 }, game: { w: 540, h: 960 } },
    only: ["menu"],
    note: "the game is landscape-only: a portrait viewport renders the rotate guard, so this row is not a meaningful store shot",
  },
  {
    store: "appstore", label: "2868x1320", px: { w: 2868, h: 1320 },
    css: { menu: { w: 1434, h: 660 }, game: { w: 1434, h: 660 } },
  },
  {
    store: "appstore", label: "2688x1242", px: { w: 2688, h: 1242 },
    css: { menu: { w: 1344, h: 621 }, game: { w: 1344, h: 621 } },
  },
  {
    store: "appstore", label: "2752x2064", px: { w: 2752, h: 2064 },
    css: { menu: { w: 1376, h: 1032 }, game: { w: 1376, h: 1032 } },
  },
];
