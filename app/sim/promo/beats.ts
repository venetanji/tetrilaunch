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
import { MARK_COUNT, SCHOOL_STEPS, SLOT_CAP, type MetaState } from "../../src/game/meta";
import { MAX_TIER, newTiers } from "../../src/game/upgrades";
import { SKYDECK_TIER } from "../../src/ui/screens";

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
  /**
   * PROMO-ONLY ENRICHMENT of a "clear" event: which shipment's cubes closed
   * it, that shipment's piece type, and where its cubes sat in lineClear.ts's
   * own wall/floor-anchored row/slot grid (row 0 = the floor, slot 0 = flush
   * against the wall — see events.ts's rowOf/slotOf). Stamped by
   * events.ts's stampClosingPiece, which is the only place that still has the
   * cubes: lineClear.ts removes them from the field before Game fires
   * anything, so the stock onLineClear payload (a line count and a grade)
   * carries neither. Undefined for every event a plain g.update(t) produced
   * without going through stampClosingPiece (e.g. a kind other than "clear").
   */
  closingType?: string;
  closingShipment?: number;
  closingRows?: number[];
  closingSlots?: number[];
  /** Did the closing shipment's cubes sit within the bottom-right corner
   *  (rows 0-1, slots 0-2 — events.ts's CORNER_MAX_ROW/CORNER_MAX_SLOT)? */
  bottomRight?: boolean;
}

/** The precision beat's decisive moment, precisely: a two-row clear the LAST
 *  shipment closed with a T or S piece (the two shapes whose own footprint is
 *  exactly two rows tall — theme.ts's PIECE_SHAPES), sitting in the
 *  bottom-right corner when it went (rows 0-1, slots 0-2 — see events.ts's
 *  stampClosingPiece). Does NOT require the piece's own footprint to span
 *  both cleared rows: a joint can break on landing (pieces.ts's breakable
 *  joints) and scatter a shipment's four cubes across a row on their own, and
 *  a piece closing ONE row of a double the press's own grind completed on the
 *  same step (lineClear.ts's settleZoneCubes) is still, honestly, a T or S
 *  piece that closed a double in the corner — measured (scratch seed sweep):
 *  requiring the full footprint made an already-rare event nearly
 *  unreachable inside a beat's own seed search. */
export function isCornerDouble(e: PromoEvent): boolean {
  return e.kind === "clear" && e.lines === 2 && !!e.bottomRight
    && (e.closingType === "T" || e.closingType === "S");
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

/**
 * THE PAGE'S FIXED "NOW" — every capture runs on this instant, in UTC.
 *
 * Three screens are dated, and all three would otherwise render something
 * different on a different day or a different machine's timezone:
 * contracts.ts's dailySeed deals the Contract board from `new Date()`,
 * skydeck.ts's skydeckSeed/skydeckRulesFor do the same for the Skydeck's
 * rules, and attract.ts:353 seeds the front door's demo bay with Date.now().
 * run.ts's clock shim serves Date from here plus the virtual clock's elapsed
 * ms, and the browser context is pinned to UTC so the local-time getters
 * those seeds are built from agree everywhere.
 *
 * The date itself is arbitrary but NOT free to change: a different epoch
 * deals a different Contract board and a different Skydeck, so every store
 * shot would have to be re-photographed and re-approved. 2026-03-14 is a
 * Saturday, which is the ordinary weekday case for the daily board.
 */
export const PROMO_EPOCH = Date.UTC(2026, 2, 14, 12, 0, 0);

/** The seed the page's Math.random is replaced with (run.ts's clock shim).
 *  Unseeded Math.random survives in contracts.ts's `rng` defaults, which a
 *  Contract briefing reaches through ui/sandbox-screen.ts. */
export const PROMO_RNG_SEED = 0x7e7a1a17;

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
    // 20260117 is the seed the beat was ORIGINALLY tuned on (an excellent
    // single). The owner's spec is stricter — a T or S double, closed in the
    // bottom-right corner (isCornerDouble) — and it is RARE with this
    // bot/config, and node's own guess at a seed does not carry over: a
    // node-side sweep (scratchpad, not committed) walked ~1200 seeds from
    // 20260117 and found a handful of T/S doubles in the corner, but NONE of
    // them reproduced in Chromium — node and the browser WILL diverge by the
    // ~2000th step a corner double this late in a bay needs (run.ts's
    // header: "after a few hundred steps of a chaotic pile"). The seed below
    // (20260899) is the one an in-BROWSER sweep found instead — the 783rd
    // seed tried from 20260117, `npx tsx sim/promo/run.ts --beat=precision
    // --seeds=1500` — verified: a T piece closes the double at 37.68s, row 1
    // slot 0 (flush against the wall). Set as `from` so it is tried first,
    // per every other beat's own convention, with enough count that a
    // Chromium version this seed does NOT reproduce on still has somewhere
    // to walk to; `--seeds=N` raises it further for a one-off search.
    seedSearch: { from: 20260899, count: 60, criterion: "done" },
    card: "IT TAKES SKILL.",
    phases: [{
      kind: "bay",
      config: { tier: 3, seed: 20260899, tiers: { bonds: 1 }, funds: 900 },
      // The `excellent` policy holds each shot for the press's 100ms window
      // (grades.ts) — still the most accurate pilot in sim/, and the one an
      // "IT TAKES SKILL" card should be flown by. It was never aimed at a
      // corner or a shape; isCornerDouble is a property of the seed (the
      // piece sequence and the pile it builds), which is what the search
      // below walks for.
      bot: { preset: "aim", strategy: "excellent", seed: 14 },
      maxSec: 45,
      tailSec: 1.6,
      leadSec: 8,
      done: (_st, ev) => ev.some(isCornerDouble),
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
  | { kind: "state"; state: string; warmSec: number; waitFor?: string }
  /**
   * A screen reached by PRESSING THE APP'S OWN BUTTON, named by the
   * `data-action` main.ts routes on rather than by any class name.
   *
   * Two reasons it exists beside "state". The first is correctness: several
   * screens do work on the way in that `setState` alone skips — the
   * leaderboard's entry calls `openBoard`, which is what fetches the rows, so
   * a setState-only leaderboard shot read "No scores at this Tier yet — be
   * the first!" at every store size. The second is the hub rebuild (#223):
   * `data-action` is the App's router key, so a scene written against it
   * survives a redesign that moves every class and every wrapper around it.
   *
   * `from` is the state the button is on (the front door for most of them),
   * and `waitFor` is a selector the screen's own asynchronous content lands
   * in — polled before the shot, so a network answer can never arrive half a
   * frame after the shutter.
   */
  | {
      kind: "action"; action: string; attrs?: Record<string, string>;
      from?: string; warmSec: number; waitFor?: string;
    }
  /** THE TOWER with the car parked on a floor, through the App's own
   *  pickTier. Since #223 the tower lives on the hub ("tiers"), not on the
   *  front door, so `from` names the state to render first — pickTier is a
   *  no-op on a screen with no `.tower__shaft`, and the shot would quietly
   *  photograph the front door instead. */
  | { kind: "tower"; tier: number; warmSec: number; from?: string }
  | {
      kind: "bay"; config: BayConfig; bot: BotSpec; warmSec: number;
      /** Capture on this condition rather than at warmSec. */
      until?: (st: PromoStatus, ev: PromoEvent[]) => boolean;
      /** Frames after `until` before the shot, e.g. for a row flash to bloom. */
      settleFrames?: number;
      /** Hold the aim arc on screen for the shot. */
      aiming?: boolean;
      /** One scripted hand (hands.ts) before the shot, on `fireWhen` — the
       *  abilities a pilot will not pull on its own. The shot then lands
       *  `settleFrames` later, with the effect drawn rather than just armed. */
      fire?: ScriptedAction["action"];
      fireWhen?: (st: PromoStatus, ev: PromoEvent[]) => boolean;
    };

export interface SceneDef {
  id: string;
  /** "menu" scenes use the menu/boards CSS size, "game" scenes the gameplay one. */
  family: "menu" | "game";
  show: SceneShow;
  /**
   * THE SETUP this scene is photographed on — the save the page boots with,
   * over STORE_META. "Different setups" is most of what a store listing is:
   * the same Workshop screen on a starting rig and on a full one are two
   * different screenshots, and only one of them sells the game.
   */
  setup?: keyof typeof SETUPS;
  /** Only these store sizes, when set. The seven screens a listing actually
   *  needs carry no restriction and are shot at every size; the extra setups
   *  are pinned to the reference sizes so the matrix stays a few minutes
   *  rather than half an hour. */
  only?: string[];
  /** One line for the manifest and the runbook: what this shot is FOR. */
  note?: string;
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

/* ---------------------------------------------------------------------------
 * THE SETUPS — the saves the store screens are photographed on.
 * ------------------------------------------------------------------------- */

/**
 * A save per story the listing tells, each stated as the difference from
 * STORE_META so the one place the "already taught, audio off, licence
 * earned" baseline lives stays STORE_META.
 *
 * `fresh` is the exception and is built from nothing: it is the save a new
 * install has, which is the whole point of it — the front door of a game
 * nobody has played yet draws the Flight School ladder, not the tower, and
 * that is a screenshot in its own right (and the one every "first run" bug
 * report is about).
 */
/** EVERY SYSTEM OWNED at the Workshop's own ceiling. Tiers 1-2 are what the
 *  shop sells (upgrades.ts: tier 3 is fitted at a refit stop, for scrap), so 2
 *  is "everything bought" as the Workshop can show it; the bays below fly
 *  MAX_TIER, the in-run ceiling, so the plant panel shows a built rig. */
export const FULL_LOADOUT: MetaState["loadout"] = {
  bay: 2, launcher: 2, hydraulics: 2, magazine: 2, reactor: 2,
  bonds: 2, demolition: 2, thaw: 2, cushion: 2, incinerator: 2,
};

/* ---------------------------------------------------------------------------
 * THE RIGS THE STORE BAYS FLY — one per rung, not one for all of them.
 *
 * The first pass gave every bay every track at MAX_TIER, and the owner's read
 * of that set is the one this replaces: "show a progression of systems, not
 * all full, something believable from an in game tier that is shown". So each
 * bay now flies a rig a player at THAT BAY'S TIER could actually be holding,
 * and the rack (components.ts's shipPlatesHTML draws a plate per track with
 * tier > 0, three pips each) grows shot by shot: four plates at Tier 2, ten at
 * Tier 8, with the pips filling in behind them.
 *
 * TWO RULES MAKE A RIG BELIEVABLE, and both are the game's own arithmetic:
 *
 *  1. THE BUILD BUDGET. A permanent loadout costs `tiersCost` and may spend
 *     `budgetForMark(mark)` = 110 x mark (upgrades.ts). Every rig below is
 *     priced under the budget of the tier its HUD prints — the Tier 2 bay's
 *     185 against 220, the Tier 8 bay's 425 against 880 — so a player at that
 *     rung could have bought it.
 *
 *  2. THE THIRD PIP IS NOT FOR SALE. The Workshop sells to UPRATE_MAX_TIER
 *     (meta.ts) = 2; tier 3 is fitted at a REFIT STOP, in-run, for scrap, and
 *     the stops open after bays 3, 6 and 9 (run.ts's isRefitBay). Every store
 *     bay launches at bay 1, so no track on it may show three pips — a maxed
 *     rack on bay 1 is a save-file edit, and it reads as one. The single
 *     exception is `hazard-run`, which is flown at `bay: 5` precisely so it
 *     CAN show the top rung: one refit stop is behind it, and the four
 *     ratchet notches it carries are themselves four between-bay drafts, so
 *     bay 1 was never an honest number for that shot.
 *
 * The happy side effect is that the unlit third pip does the listing a favour:
 * every rack in the set says there is something left to buy.
 * ------------------------------------------------------------------------- */

/** Tier 2, 4 slots (SLOT_BASE), 185/220 spent. The stock-adjacent rig. */
export const RIG_T2: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 1,
};
/** Tier 3, 5 slots, 240/330. The Cushion is the fifth thing bought, and it is
 *  the one the owner asked to be visible. */
export const RIG_T3: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 2, cushion: 1,
};
/** Tier 5, 6 slots, 295/550. */
export const RIG_T5: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 2, cushion: 2, reactor: 1,
};
/** Tier 6, 7 slots, 350/660 — the Bond Emitter build. */
export const RIG_T6_BOND: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 2, reactor: 2, bonds: 2, cushion: 1,
};
/** Tier 6, 7 slots, 350/660 — the cryo answer: the Lance and the Incinerator
 *  instead of the Emitter, which is the same money spent a different way and
 *  the reason two Tier 6 shots are worth having. */
export const RIG_T6_CRYO: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 2, cushion: 2, thaw: 2, incinerator: 1,
};
/** Tier 7, 8 slots, 405/770 — Demolition at the tier the blast beat needs. */
export const RIG_T7_DEMO: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 2, reactor: 2,
  demolition: 2, cushion: 2, bonds: 1,
};
/** Tier 8, 9 slots, 425/880 — nine tracks aboard and one still in the shed. */
export const RIG_T8: UpgradeTiers = {
  ...newTiers(), bay: 2, launcher: 2, hydraulics: 2, magazine: 2, reactor: 2,
  cushion: 2, incinerator: 2, thaw: 1, bonds: 1,
};
/** Tier 8 at BAY 5, the set's ceiling: ten plates, 480/880 of permanent
 *  budget, plus the two rungs (bay and launcher to MAX_TIER, 110 scrap) the
 *  bay-3 refit stop pays for. The only rack in the set with a full pip row,
 *  and the only bay flown past bay 1 to earn it. */
export const RIG_T8_REFIT: UpgradeTiers = {
  ...newTiers(), bay: MAX_TIER, launcher: MAX_TIER, hydraulics: 2, magazine: 2, reactor: 2,
  cushion: 2, demolition: 2, thaw: 2, bonds: 1, incinerator: 1,
};

export const SETUPS: Record<string, Partial<MetaState>> = {
  /** Mid-ladder, the listing's default: a Mark in hand, floors sealed. */
  ladder: {},
  /** A brand new install. Deliberately NOT spread over STORE_META. */
  fresh: {
    mark: 0, salvage: 0, runs: 0, bestBay: 0, licence: 0, sealedMarks: [],
    tierContracts: 0, seenContractBoard: false, seenDraft: false, seenRefit: false,
    loadout: { bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0,
      bonds: 0, demolition: 0, thaw: 0, cushion: 0, incinerator: 0 },
  },
  /** Contracts in flight: a board with work logged against it and the salvage
   *  a few clears earn, so the screen shows a ledger rather than an invitation. */
  contracts: { tierContracts: 6, salvage: 6_240, runs: 74, bestBay: 10, mark: 6 },
  /** A full rig: every system owned at tier 2, every slot bought. The Workshop
   *  screen's widest case, and the one that reads as a game with depth. */
  rigged: {
    mark: 9, salvage: 2_360, runs: 118, bestBay: 10, slots: SLOT_CAP,
    unlocks: ["survey", "scrap-cache"],
    loadout: FULL_LOADOUT,
  },
  /** THE SEALED TOWER — every Mark beaten and sealed, which is the Skydeck's
   *  key (meta.ts's skydeckOpen: mark >= MARK_COUNT and nothing unsealed). The
   *  front door then draws the roof above the tenth floor. */
  sealed: {
    mark: MARK_COUNT, sealedMarks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    celebratedMark: MARK_COUNT, skydeckCelebrated: true, sealBreakSeen: true,
    salvage: 4_100, runs: 143, bestBay: 10, slots: SLOT_CAP,
    unlocks: ["survey", "scrap-cache"],
    // The same full rig as `rigged`: a save that sealed every Mark owns
    // every system, and the hub is photographed on this save.
    loadout: FULL_LOADOUT,
  },
};

/** The size a scene is pinned to when it is a SETUP STUDY rather than one of
 *  the seven screens a listing needs — Play's 16:9 and Steam's 1080p, the two
 *  the owner crops everything else from. */
const REFERENCE_SIZES = ["2400x1350", "1920x1080"];

export const SCENES: SceneDef[] = [
  /* --- THE EVERY-SIZE SET, gameplay first (the owner's 1.0.6 note: "too
   *     many UI shots, not enough gameplay"). Ten scenes — Apple caps a slot
   *     at ten — numbered in this order so the listing opens on a bay. --- */
  {
    id: "mid-bay-launch", family: "game",
    show: {
      // Funds well under the Tier 3 target (1152): this is the ONE shot whose
      // subject is the aim arc, so it has to be allowed to run long enough to
      // build a pile worth aiming at, and at 900 the bay banked its target
      // before it had one (834/1152 at 8s, 12 cubes, most of the field black).
      kind: "bay", config: { tier: 3, seed: 20260401, tiers: RIG_T3, funds: 400 },
      bot: { preset: "aim", strategy: "excellent", seed: 31 }, warmSec: 30, aiming: true,
      // A pile to aim at, and the cannon reloaded — the arc is only drawn
      // off cooldown.
      until: (st) => st.elapsedMs > 16_000 && st.cubes >= 22 && st.ready,
    },
    note: "a launch being aimed: the trajectory arc over a working pile",
  },
  {
    id: "line-clear", family: "game",
    show: {
      kind: "bay", config: { tier: 2, seed: 20260402, tiers: RIG_T2, funds: 900 },
      bot: { preset: "aim", strategy: "excellent", seed: 32 }, warmSec: 30,
      // On the GRADE STAMP (events.ts's onStamp), not the clear: the SWEPT /
      // EXCELLENT stamp and its payout are what "a row paying" looks like,
      // and they land well after the engine's "clear" — 7, 14, 26 and 38
      // frames after the clear all caught the lit row and no stamp on the
      // phone rows.
      until: (_st, ev) => ev.some((e) => e.kind === "stamp"), settleFrames: 6,
    },
    note: "the moment a row pays",
  },
  {
    // A BOMB GOING OFF, on the `improvise` beat's configuration (cryo and
    // volatile on the belt, the Demolition track at 2 for the charge) with
    // a fatter till so the pile the charge lands in is a real one. The hand
    // is hands.ts's fireBomb, cued exactly as the beat cues it; the shutter
    // waits for the engine's own "explosion" event and then ten frames so
    // the 900ms bloom (fx.ts) is drawn mid-flare rather than merely armed.
    id: "blast", family: "game",
    show: {
      kind: "bay",
      config: {
        tier: 7, seed: 20260107, tiers: RIG_T7_DEMO,
        // Under Tier 7's target: a till at or above the target is a bay WON on
        // the first settle (measured: funds 1500 -> "won" at 2.2s, 1 cube).
        // RE-TUNED for the tier-appropriate rig (RIG_T7_DEMO). At FULL_RIG and
        // funds 1000 the bay held; at bay-track 2 the field is narrower, rows
        // close sooner, and the bay was WON at 29.6s with the pile still at 17
        // cubes — the charge never had a pile to go off in. Half the till
        // leaves the target out of reach for the whole 45s window.
        ratchets: { cryo: 2, volatile: 2 }, funds: 500,
      },
      bot: { preset: "demo", strategy: "lance", seed: 13 }, warmSec: 45,
      fire: "bomb",
      // PILE_FOR_BOMB is sized for the beat's wider FULL-rig bay; this one is
      // two bay-tiers narrower and tops out lower, so the cue is the pile this
      // field can actually hold (measured: 17 at the win).
      fireWhen: (st) => st.bombs > 0 && st.cubes >= 16 && st.elapsedMs > 5000,
      // THE BOMB'S explosion, not any: volatile cargo on this belt pops on its
      // own, and the first probe shuttered on one of those with the charge
      // still in the air (no bloom in frame).
      until: (_st, ev) => ev.some((e) => e.kind === "explosion" && e.explosion === "bomb"),
      // ~4 polled ticks + these + the quiesce frame ≈ 150-180ms into the ring
      // (render.ts's EXPLOSION_RING_MS 600): three-quarters radius, still
      // bright, the flash's tail just going.
      settleFrames: 4,
    },
    note: "a Demolition charge going off in a live pile",
  },
  {
    // THE BAY TIPPED INTO CONGESTION: the `slip` beat's configuration (wind
    // and slag, the impatient spray with a deliberate slip every third shot)
    // flown until the engine reports congestion tier 1 — more than
    // PILE_TIERS[0].cubes live cubes — which is when syncHud turns the plant
    // crest's spark red (.plant--congest-danger) and the launch price on the
    // panel is taxed.
    id: "congestion", family: "game",
    show: {
      kind: "bay",
      config: { tier: 5, seed: 20260105, tiers: RIG_T5, ratchets: { wind: 2, slag: 1 }, funds: 1_200 },
      bot: { preset: "impatient", seed: 5, slip: { every: 3, deg: 12, power: 5 } }, warmSec: 60,
      until: (_st, ev) => ev.some((e) => e.kind === "congestion" && (e.tier ?? 0) >= 2),
      settleFrames: 8,
    },
    note: "a congested bay: the pile past the first tier, the crest red",
  },
  {
    id: "bond-chain", family: "game",
    show: {
      kind: "bay",
      config: { tier: 6, seed: 20260300, material: "rebar", tiers: RIG_T6_BOND, funds: 900 },
      bot: { preset: "impatient", seed: 21 }, warmSec: 14,
      fire: "bond", fireWhen: (st) => st.elapsedMs > 8000 && st.cubes >= 16,
      settleFrames: 6,
    },
    note: "the Bond Breaker shattering a rebar pile",
  },
  {
    // FROZEN CARGO AND THE THAW LANCE: every shipment cryo (sandbox.ts's
    // material "cryo"), the Thaw track at 2 for the charges, the lance pulled
    // on a settled pile (fireThaw needs a cold cryo cube ahead of the press)
    // and the shutter on the engine's own "cryoShatter" — the struck cube
    // breaking under the press — with a few frames so the shatter is drawn.
    id: "cryo-thaw", family: "game",
    show: {
      kind: "bay",
      config: { tier: 6, seed: 20260106, material: "cryo", tiers: RIG_T6_CRYO, funds: 1_200 },
      bot: { preset: "impatient", seed: 61 }, warmSec: 50,
      fire: "thaw", fireWhen: (st) => st.thaw > 0 && st.elapsedMs > 7000 && st.cubes >= 14,
      until: (_st, ev) => ev.some((e) => e.kind === "cryoShatter"),
      settleFrames: 6,
    },
    note: "frozen cargo, and the Thaw Lance breaking it",
  },
  {
    id: "materials-bay", family: "game",
    show: {
      kind: "bay", config: { tier: 8, seed: 20260408, material: "all", tiers: RIG_T8, ratchets: { wind: 2 }, funds: 1_200 },
      bot: { preset: "patient", seed: 38 }, warmSec: 30,
      // Enough shipments down that several materials are in the pile, with
      // the belt still loaded behind the cannon.
      until: (st) => st.elapsedMs > 10_000 && st.cubes >= 16,
    },
    note: "every cargo material on the belt and in the pile",
  },
  {
    id: "hazard-run", family: "game",
    show: {
      kind: "bay",
      config: { tier: 8, bay: 5, seed: 20260818, tiers: RIG_T8_REFIT, ratchets: { wind: 2, time: 1, sweeper: 1 }, material: "all", funds: 1_200 },
      bot: { preset: "impatient", seed: 81 }, warmSec: 24,
      until: (st) => st.elapsedMs > 18_000 && st.cubes >= 24,
    },
    note: "a Tier 8 bay under wind, a tighter clock and a sweeper",
  },
  {
    // THE #223 HUB on a save that earned the roof: every Mark sealed is the
    // Skydeck's key (meta.ts's skydeckOpen), the car riding to screens.ts's
    // SKYDECK_TIER, the run / Contract / Workshop cards below. The tower
    // lives on the hub ("tiers") since #223, hence `from`.
    id: "tier-hub", family: "menu", setup: "sealed",
    show: { kind: "tower", tier: SKYDECK_TIER, warmSec: 3, from: "tiers" },
    note: "the #223 hub: the tower sealed to the roof, the car on the Skydeck, the run / Contract / Workshop cards",
  },
  {
    id: "menu", family: "menu", show: { kind: "menu", warmSec: 7 },
    note: "the front door: the wordmark, the play plate and the attract bay",
  },

  /* --- the reference-size studies: the boards and the other saves, for the
   *     Play 16:9 and Steam 1080p rows only --- */
  {
    id: "workshop", family: "menu", setup: "rigged", only: REFERENCE_SIZES,
    show: { kind: "state", state: "workshop", warmSec: 0.5 },
    note: "the rig shop with every system owned",
  },
  {
    id: "contracts", family: "menu", setup: "contracts", only: REFERENCE_SIZES,
    show: { kind: "state", state: "contracts", warmSec: 0.5 },
    note: "the Contract board with work logged against it",
  },
  {
    // Through the App's own button, not setState: the entry is what fetches
    // the board (main.ts's `case "leaderboard"` → openBoard → refreshBoard),
    // and `waitFor` holds the shutter until a row exists. The button is on
    // the hub ("tiers") since #223.
    id: "leaderboard", family: "menu", only: REFERENCE_SIZES,
    show: { kind: "action", action: "leaderboard", from: "tiers", warmSec: 1, waitFor: ".lb__row" },
    note: "the all-time board, rows fetched",
  },
  {
    // A BAY UNDER PRESSURE, on the `loss` beat's own configuration, flown by
    // the pilot that stands every shipment on end — the shutter goes BEFORE
    // its ending, on a cube count, so this is a tall bay and not a lost one.
    id: "stacked-bay", family: "game", only: REFERENCE_SIZES,
    show: {
      kind: "bay",
      config: { tier: 9, seed: 20260109, funds: 600, ratchets: { sweeper: 2, wind: 2 } },
      bot: { preset: "lob-tall", seed: 9 }, warmSec: 60,
      until: (st) => st.cubes >= 30,
    },
    note: "a tall, loaded bay: the pile a run is fighting to keep down",
  },
  {
    id: "menu-fresh", family: "menu", setup: "fresh", only: REFERENCE_SIZES,
    show: { kind: "menu", warmSec: 7 },
    note: "the front door of a brand-new install: the Flight School ladder",
  },
  {
    id: "workshop-full", family: "menu", setup: "rigged", only: REFERENCE_SIZES,
    show: { kind: "state", state: "workshop", warmSec: 0.5 },
    note: "the Workshop with every system owned and every slot bought",
  },
];

/** A store size: the PNG the store wants, and the CSS viewport x DPR that
 *  produces it exactly. */
export interface StoreSize {
  store: "play" | "appstore" | "steam";
  /** The row's IDENTITY: what `--store-size=` names and what a scene's `only`
   *  list is written against. Stays the raw pixel size, because that is the
   *  one name for a slot that cannot drift. */
  label: string;
  /**
   * WHERE THE PNGs LAND, under <out>/store/<store>/, when it should not simply
   * be `label` — a relative path, so a `/` nests.
   *
   * The App Store rows use it to file themselves the way the uploader thinks:
   * `iPhone/6.9-inch-2868x1320-required` rather than a bare `2868x1320`. App
   * Store Connect's own upload page is a list of DEVICE CLASSES ("iPhone 6.9
   * inch Display"), not of resolutions, so a folder tree that names the device
   * and the inches is a tree the owner can drag straight onto it without
   * reading a pixel size off anything (the 1.0.6 owner note: "organized by
   * ipad/iphone and size so i can just drag and drop them without having to
   * read the resolutions"). The resolution stays on the tail because two slots
   * of the same inches exist and only the number tells them apart.
   */
  dir?: string;
  px: { w: number; h: number };
  /** CSS viewport per scene family; the DPR is px / css. */
  css: { menu: { w: number; h: number }; game: { w: number; h: number } };
  /** Only these scenes, when set (the feature graphic and the portrait rows). */
  only?: string[];
  note?: string;
}

/**
 * THE SIZES, and the rule every row obeys: px = css x dpr EXACTLY, on both
 * axes, with an integer css viewport — captureScene asserts it, because a
 * fractional viewport is a half-pixel of layout the shipped app never has.
 *
 * Play's 16:9 recipe is docs/PLAY.md's: 960x540 @2.5 for menu and boards (the
 * phone-landscape layout the menu was designed around), 1280x720 @1.875 for
 * gameplay. Play also wants TABLET screenshots for the tablet listings, which
 * are 16:10 rather than 16:9 and are their own layout solve (layout.ts letter-
 * boxes the field, the rails do not) — hence rows of their own rather than an
 * upscale of the phone shot.
 *
 * Apple's are the current App Store Connect LANDSCAPE requirements: the 6.9"
 * and 6.5" iPhone rows are the two the listing requires, 6.7" and 5.5" are
 * accepted sizes older listings still ask for, and the two iPad rows are 13"
 * and 12.9". docs/ios.md names the device classes only, so the pixel sizes are
 * stated here. The iPhone rows are rendered at the device's REAL CSS points
 * @3 (956x440 for the 6.9", the uifit harness's "iPhone 16 Pro Max" row), so
 * the shot is the PHONE layout — a half-size @2 render of the same pixels is
 * a 1434x660 viewport, which is a tablet-class layout solve and not what the
 * phone shows (the 1.0.6 owner review caught the Workshop and hub in their
 * wide forms). The 4.7"/4"/3.5" rows are @2 because those phones are; the
 * iPad rows are @2 because iPads are.
 *
 * Steam's screenshot size is 1920x1080 (docs/steam-store-and-achievements-plan.md,
 * "Images — produce at Steam's exact dimensions"; five minimum, real
 * gameplay). Its capsules are ARTWORK — a logo over art, not a screenshot —
 * so only the main capsule's frame is rendered here, as a SOURCE to compose
 * over; the rest come from app/resources/ through scripts/store-graphics.mjs.
 *
 * The portrait row exists for completeness: the game is landscape-only and a
 * portrait viewport renders the rotate guard, so it is not a store shot.
 */
export const STORE_SIZES: StoreSize[] = [
  /* --- Google Play --- */
  {
    store: "play", label: "2400x1350", px: { w: 2400, h: 1350 },
    css: { menu: { w: 960, h: 540 }, game: { w: 1280, h: 720 } },
    note: "phone 16:9 — the listing's main row",
  },
  {
    store: "play", label: "1920x1200", px: { w: 1920, h: 1200 },
    css: { menu: { w: 960, h: 600 }, game: { w: 960, h: 600 } },
    note: "7\" tablet (16:10)",
  },
  {
    store: "play", label: "2560x1600", px: { w: 2560, h: 1600 },
    css: { menu: { w: 1280, h: 800 }, game: { w: 1280, h: 800 } },
    note: "10\" tablet (16:10)",
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

  /* --- App Store --- */
  {
    store: "appstore", label: "2868x1320", dir: "iPhone/6.9-inch-2868x1320-required", px: { w: 2868, h: 1320 },
    css: { menu: { w: 956, h: 440 }, game: { w: 956, h: 440 } },
    note: "iPhone 6.9\" — required",
  },
  {
    store: "appstore", label: "2796x1290", dir: "iPhone/6.7-inch-2796x1290", px: { w: 2796, h: 1290 },
    css: { menu: { w: 932, h: 430 }, game: { w: 932, h: 430 } },
    note: "iPhone 6.7\"",
  },
  {
    store: "appstore", label: "2688x1242", dir: "iPhone/6.5-inch-2688x1242-required", px: { w: 2688, h: 1242 },
    css: { menu: { w: 896, h: 414 }, game: { w: 896, h: 414 } },
    note: "iPhone 6.5\" — required",
  },
  {
    store: "appstore", label: "2208x1242", dir: "iPhone/5.5-inch-2208x1242", px: { w: 2208, h: 1242 },
    css: { menu: { w: 736, h: 414 }, game: { w: 736, h: 414 } },
    note: "iPhone 5.5\" — older listings only",
  },
  // THE OTHER FIVE iPHONE SLOTS App Store Connect offers. Optional: Apple
  // scales the 6.9" set into any slot left empty, so these exist for a
  // listing that wants each slot photographed at its own layout rather than
  // a down-scale — and the three small rows are the only store shots taken
  // at a PHONE viewport (667x375, 568x320, 480x320 CSS), which is where the
  // layout solver's tight modes show.
  {
    store: "appstore", label: "2622x1206", dir: "iPhone/6.3-inch-2622x1206", px: { w: 2622, h: 1206 },
    css: { menu: { w: 874, h: 402 }, game: { w: 874, h: 402 } },
    note: "iPhone 6.3\" (6.1\"/6.3\" slot)",
  },
  {
    store: "appstore", label: "2532x1170", dir: "iPhone/6.1-inch-2532x1170", px: { w: 2532, h: 1170 },
    css: { menu: { w: 844, h: 390 }, game: { w: 844, h: 390 } },
    note: "iPhone 6.1\" (5.4\"/5.8\"/6.1\" slot)",
  },
  {
    store: "appstore", label: "1334x750", dir: "iPhone/4.7-inch-1334x750", px: { w: 1334, h: 750 },
    css: { menu: { w: 667, h: 375 }, game: { w: 667, h: 375 } },
    note: "iPhone 4.7\"",
  },
  {
    store: "appstore", label: "1136x640", dir: "iPhone/4-inch-1136x640", px: { w: 1136, h: 640 },
    css: { menu: { w: 568, h: 320 }, game: { w: 568, h: 320 } },
    note: "iPhone 4\"",
  },
  {
    store: "appstore", label: "960x640", dir: "iPhone/3.5-inch-960x640", px: { w: 960, h: 640 },
    css: { menu: { w: 480, h: 320 }, game: { w: 480, h: 320 } },
    note: "iPhone 3.5\" (3:2)",
  },
  {
    store: "appstore", label: "2752x2064", dir: "iPad/13-inch-2752x2064-required", px: { w: 2752, h: 2064 },
    css: { menu: { w: 1376, h: 1032 }, game: { w: 1376, h: 1032 } },
    note: "iPad 13\" — required",
  },
  {
    store: "appstore", label: "2732x2048", dir: "iPad/12.9-inch-2732x2048", px: { w: 2732, h: 2048 },
    css: { menu: { w: 1366, h: 1024 }, game: { w: 1366, h: 1024 } },
    note: "iPad 12.9\"",
  },
  // THE OTHER THREE iPAD SLOTS, optional for the same reason as the extra
  // iPhone rows. 2048x1536 is 4:3 — the squarest viewport any store shot is
  // taken at, and the one that shows what the layout solver does with a
  // field that cannot fill the width.
  {
    store: "appstore", label: "2420x1668", dir: "iPad/11-inch-2420x1668", px: { w: 2420, h: 1668 },
    css: { menu: { w: 1210, h: 834 }, game: { w: 1210, h: 834 } },
    note: "iPad 11\" (8.3\"/11\" slot)",
  },
  {
    store: "appstore", label: "2224x1668", dir: "iPad/10.5-inch-2224x1668", px: { w: 2224, h: 1668 },
    css: { menu: { w: 1112, h: 834 }, game: { w: 1112, h: 834 } },
    note: "iPad 10.5\"",
  },
  {
    store: "appstore", label: "2048x1536", dir: "iPad/9.7-inch-2048x1536", px: { w: 2048, h: 1536 },
    css: { menu: { w: 1024, h: 768 }, game: { w: 1024, h: 768 } },
    note: "iPad 9.7\" (4:3)",
  },

  /* --- Steam --- */
  {
    store: "steam", label: "1920x1080", px: { w: 1920, h: 1080 },
    // The one row whose two families differ in DPR rather than in viewport:
    // 1080p is exactly 2x the menu's 960x540 and exactly 1.5x gameplay's
    // 1280x720, which is the field's own size (render.ts's WORLD).
    css: { menu: { w: 960, h: 540 }, game: { w: 1280, h: 720 } },
    note: "Steam screenshots — five minimum, real gameplay",
  },
  {
    store: "steam", label: "616x353", px: { w: 616, h: 353 },
    css: { menu: { w: 616, h: 353 }, game: { w: 616, h: 353 } },
    only: ["menu"],
    note: "main capsule FRAME only — the shipped capsule is artwork with the logo over it; compose from this, do not upload it raw",
  },
];

