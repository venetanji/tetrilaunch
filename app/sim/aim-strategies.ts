/**
 * AIMING STRATEGIES — the instrument change `winnability.ts`'s pessimism ledger
 * has been asking for by name.
 *
 * ---------------------------------------------------------------------------
 * WHY A SYSTEM CAN BE MISPRICED BY A PILOT
 *
 * Three of the ship's systems are not passive. What they are worth depends on a
 * DECISION, and the harness has, until now, had exactly one aiming policy —
 * `bots.ts`'s `aim`, which reads the pile's gaps, re-solves against the wind,
 * and does nothing else. Measured against it:
 *
 *  - **THE IMPACT CUSHION** priced at 56 / 63 / 59 wins of 96 across its three
 *    rungs (`design/balance/winnability-sweep-findings.md` §5b-ter) — not
 *    monotone, and the findings say outright why: the liner is *insurance on a
 *    landing*, and *"no bot lobs a volatile shipment on purpose"*. The number
 *    is a fact about the pilot.
 *  - **THE THAW LANCE** priced against a pilot that *"cannot strike cryo with a
 *    shipment at all"* (§7), so it could not separate "cryo needs a system"
 *    from "cryo needs the counter-play the game already has".
 *  - **THE INCINERATOR** (in flight) is almost entirely an aiming decision —
 *    put the cargo up where it burns instead of down where it costs. See the
 *    stub at the bottom of this file.
 *
 * So a strategy is a first-class, named, swappable thing here, exactly as a
 * DRAFT policy already is in `draft-space.ts`, and for the same reason: the
 * sweep prints which one produced a row, so "unwinnable" and "worth 20 points"
 * are claims about a stated player rather than about the harness's defaults.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE, AND WHAT IT DELIBERATELY REFUSES
 *
 * A strategy is THREE OPTIONAL HOOKS over the pilot the harness already has.
 * It is not a new bot, and that is the whole design:
 *
 *   abilities(g, now) -> spent?   fire the consumables (outside the cooldown)
 *   target(g, now, base) -> where to land this shipment (null = keep base)
 *   select(g, now, pool, shot) -> which arc gets it there (null = keep base)
 *
 * Every hook may return null/false, and a strategy with no hooks at all is
 * `NAIVE` — which is not a placeholder but the CONTROL ARM, and it is on the
 * identical code path through `aimBot`, not a re-implementation of it. That
 * identity is what makes a three-arm table honest: the difference between the
 * "system + naive" row and the "system + aware" row is the strategy and
 * literally nothing else, and `sim/systems.ts` pins it both ways (naive is
 * indistinguishable from no strategy; a strategy that does something IS
 * distinguishable, so the pin is not vacuous).
 *
 * WHAT A STRATEGY MAY NOT DO. It picks from the candidates `aimCandidates`
 * flew — it does not run a second aim search. `bots.ts`'s `solveAim` note says
 * why in one line ("two copies of an aim search is also how a harness ends up
 * describing a cannon that no longer exists"), and there is a sharper reason
 * here: two arms of one table must be flying the same cannon, or the row
 * measures the search grid. The pool it is handed is the BAR-CLEAR pool, so a
 * strategy also cannot select its way into the compactor.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STILL PESSIMISTIC — the ledger these strategies do NOT close
 *
 * They read the field every shot, but they still have no lookahead, no model of
 * what the next shipment will be beyond the one the belt has already shown, and
 * no plan spanning more than the shot in hand. A human plays a bay; these play
 * a shot. Every number they produce stays a floor.
 */
import type { Game } from "../src/game/game";
import { CELL, WALL_INNER } from "../src/game/engine";
import { cushionedTrigger, nextColdCryo, VOLATILE_TRIGGER_SPEED }
  from "../src/game/lineClear";
import type { Cube } from "../src/game/pieces";
import {
  aimBot, pieceHalfWidthPx, type AimCandidate, type Bot,
} from "./bots";
import { bondHands } from "./counters";

/* ---------------------------------------------------------------------------
 * THE INTERFACE
 * ------------------------------------------------------------------------- */

/**
 * Where a shot is meant to land, in the vocabulary the gap reader already
 * speaks (`bots.ts`'s GapTarget) plus one field a strategy needs.
 */
export interface ShotTarget {
  /** World x to aim the landing at. */
  x: number;
  /** Slot index in the fixed `compactorMinLineCells` grid, or -1 for "nothing
   *  to remember" — handed straight to the gap reader's pending-slot memory, so
   *  a strategy's own target participates in it exactly as a gap does. */
  slot: number;
  /**
   * Landing error (px) this shot will still accept before the aim search's
   * patience rule holds fire. Absent = `bots.ts`'s AIM_PATIENCE_TOL (one cell).
   *
   * A strategy needs this because patience was written for a bot aiming at the
   * flattest part of an empty bay, where one cell is a generous tolerance. A
   * shot aimed at a specific frozen cube, or into a liner four cells deep, is
   * aiming at a place the wind may simply not allow within a cell — and a bot
   * that then held fire every cooldown would report the strategy as a way to go
   * broke rather than as a way to play.
   */
  tol?: number;
}

/** A named aiming policy. Every hook is optional; see the header. */
export interface AimStrategy {
  /** Printed on every row this strategy produced. */
  name: string;
  /**
   * Spend the run's consumables. Called on EVERY tick, before the pilot acts
   * and outside its cooldown-and-funds gate — which is where
   * `counters.ts`'s `bondHands`/`thawHands` fire theirs, and the only place a
   * charge that does not cost a launch can honestly be compared against them.
   *
   * Return true to spend the tick (the pilot does not act). The Thaw Lance and
   * the Bond Breaker both return false: by design neither consumes the launch,
   * so claiming the tick would be charging the player for something the game
   * does not charge them for.
   */
  abilities?(g: Game, now: number): boolean;
  /** Re-aim this shipment. `base` is the gap reader's own answer; return null
   *  to keep it. */
  target?(g: Game, now: number, base: ShotTarget): ShotTarget | null;
  /** Re-rank the arcs. `pool` is what the search flew (bar-clear where any arc
   *  clears the bar); return null to keep the baseline's nearest/steepest pick. */
  select?(
    g: Game, now: number, pool: readonly AimCandidate[], shot: ShotTarget,
  ): AimCandidate | null;
}

/**
 * A strategy is BUILT PER RUN, and the reason is `draft-space.ts`'s POLICY
 * SPECS note verbatim: a policy object that carries state across runs makes
 * identical seeds stop reproducing, and makes a paired comparison stop being
 * paired. These strategies are stateless today and the spec still exists,
 * because the first one that keeps a counter would otherwise silently break
 * both properties — and a harness finds that out months later, in a table.
 */
export interface AimStrategySpec {
  name: string;
  build(runSeed: number): AimStrategy;
}

/**
 * A PLAY: the draft policy that builds a run and the aiming policy that flies
 * it, named as one thing.
 *
 * This is what "a build declares the strategy that plays it" means. Both halves
 * are `build(runSeed)` factories, so a driver holds a play and calls both — it
 * never has to know that one of them is about hazards and the other about arcs.
 */
export interface PlaySpec {
  name: string;
  /** Left as a structural type rather than importing `DraftPolicySpec`: this
   *  file is imported BY `bots.ts` (type-only) and a value dependency on the
   *  draft space would drag the whole winnability harness into every bot. */
  draft: { name: string; build(runSeed: number): unknown };
  strategy: AimStrategySpec;
}

/* ---------------------------------------------------------------------------
 * WIRING — how a strategy becomes a pilot
 * ------------------------------------------------------------------------- */

/**
 * Wrap a bot with a strategy's ABILITY hook.
 *
 * The same shape as `counters.ts`'s `bondHands` and `thawHands`, and placed the
 * same way — outermost, on every tick — because that is what the systems it is
 * being compared against get. A strategy whose abilities only fired when the
 * cannon was off cooldown and the funds covered a launch would be a strictly
 * worse player than `thawHands`, and the arms table would read that handicap as
 * the strategy's verdict.
 */
export function strategyHands(strategy: AimStrategy, base: Bot): Bot {
  if (!strategy.abilities) return base;
  return {
    name: base.name,
    act(g, now) {
      if (strategy.abilities!(g, now)) return;
      base.act(g, now);
    },
  };
}

export interface PilotOpts {
  /** Fire demolition charges (`bots.ts`'s `demo`). Default true — the
   *  winnability pilot's own default, so a strategy arm and a combo row are the
   *  same pilot plus a policy. */
  demolish?: boolean;
  /** Fire Bond Breakers (`counters.ts`'s `bondHands`). Default true, same
   *  reason. */
  bond?: boolean;
}

/**
 * The pilot for a strategy: a `(seed) => Bot` factory, which is the shape every
 * driver here already takes (`DeepRunOpts.bot`, `BOTS`'s presets).
 *
 * Composition order is the one every existing wrapper uses and it matters:
 * abilities outermost (they are not behind the cooldown), then Bond Breakers,
 * then the aim bot that holds the two aim hooks.
 */
export function strategyPilot(
  spec: AimStrategySpec, opts: PilotOpts = {},
): (seed: number) => Bot {
  const { demolish = true, bond = true } = opts;
  return (seed) => {
    const strategy = spec.build(seed);
    const base = aimBot(seed, { demolish, strategy });
    return strategyHands(strategy, bond ? bondHands(base) : base);
  };
}

/* ---------------------------------------------------------------------------
 * SHARED READING — the slot grid, stated once
 * ------------------------------------------------------------------------- */

/**
 * Slot index of a world x, on the wall-anchored grid `lineClear.ts` makes lines
 * on and `bots.ts`'s gap reader targets against.
 *
 * The identity that ties this to the system it is used to play around:
 * `slotCenterX(k) === cushionEdgeX(k) - CELL/2`, so slot k lies inside a liner
 * of `cells` exactly when `k < cells`. `sim/systems.ts` pins both halves —
 * without them "aim into the liner" would be a claim about arithmetic written
 * twice and checked never.
 */
export function slotOf(x: number): number {
  return Math.round((WALL_INNER - CELL / 2 - x) / CELL);
}

/** Centre x of slot `k`. */
export function slotCenterX(k: number): number {
  return WALL_INNER - CELL / 2 - k * CELL;
}

/** True when slot `k` sits inside a liner `cells` deep. */
export function slotIsLined(k: number, cells: number): boolean {
  return cells > 0 && k >= 0 && k < cells;
}

/** Cubes the compactor can actually reach and act on — the same three
 *  exclusions `nextColdCryo` makes (below the bar's top, not stranded, not
 *  blinking out), read here for the pile-shape questions the strategies ask.
 *  Deliberately NOT re-testing "at rest": that rule's threshold is private to
 *  `lineClear.ts`, and a copy of it here is a copy that drifts. Where a
 *  strategy needs the rest test it asks `nextColdCryo` for the answer instead
 *  of re-deriving the question. */
function inPlay(g: Game, c: Cube): boolean {
  if (c.blinkStart !== null) return false;
  const b = c.body;
  if (b.position.y < g.compactor.top) return false;
  return b.position.x >= g.compactor.strandCutoffX;
}

/* ---------------------------------------------------------------------------
 * 1. THE CONTROL ARM
 * ------------------------------------------------------------------------- */

/**
 * No hooks. The pilot `bots.ts` has always flown, named so a table can print it
 * beside the others.
 *
 * It is deliberately an OBJECT rather than `undefined`: an arm labelled "naive"
 * has to be a thing the harness built and can name, or the control row is
 * "whatever the default happened to be on the day", which is the failure mode
 * every paired comparison in this directory exists to avoid.
 */
export const naiveStrategy: AimStrategySpec = {
  name: "naive",
  build: () => ({ name: "naive" }),
};

/* ---------------------------------------------------------------------------
 * 2. LANCE-AWARE — the cryo player §7 asked for
 *
 * Two rules, and they divide one job between the two tools cryo actually has:
 *
 *  A. THE SHIPMENT STRIKES THE FAR CUBE. `strikeCryo`'s design is that cryo
 *     "costs a shipment: land it, then spend a second shot hitting it", and no
 *     bot in this harness has ever spent that second shot — the gap reader aims
 *     at the emptiest slot, which is by construction not where a frozen cube is
 *     lying. So this strategy aims at one on purpose.
 *  B. THE LANCE TAKES THE NEAR CUBE. `game.ts`'s useThawLance already picks its
 *     own target (`nextColdCryo` — the cube the press is about to reach) and
 *     says why: "The lance buys back the shot for the cube you ran out of time
 *     on, never the whole material." `counters.ts`'s `thawHands` pulls that
 *     trigger the instant it will do anything, which is a rule with no notion
 *     of running out of time — it spends a charge on a cube six slots from the
 *     bar that a shipment could have struck for free.
 *
 * So: the lance is held for cubes inside LANCE_URGENT_CELLS of the advancing
 * face, and the shipment is sent at the nearest cube OUTSIDE that band. The two
 * tools never contend for the same cube, and the charge is only ever spent on
 * the one a shipment cannot reach in time.
 *
 * HOW THE SECOND TARGET IS FOUND, and it is the reason this strategy owns no
 * rules of its own: `nextColdCryo` is a pure function of a cube list, so asking
 * it again with the urgent cube removed returns the next one with EVERY
 * exclusion the game applies (stranded, above the bar's reach, still moving)
 * intact. Re-deriving those here would be three private rules copied into a
 * harness, and the first one to change would change them silently.
 * ------------------------------------------------------------------------- */

/**
 * How close to the compactor's advancing face a frozen cube has to be before
 * the lance is worth a charge, in cells.
 *
 * Three. A shipment's flight is ~1.5-2.5s (`bots.ts`'s AIM_PENDING_MS is 2200)
 * and the bar crosses roughly a cell a second at stock trim, so a cube three
 * cells out is about the last one a shot fired NOW can still reach before the
 * press does. Inside that band the shipment cannot get there and the charge is
 * the only tool; outside it, the shipment is free and the charge is not.
 */
export const LANCE_URGENT_CELLS = 3;

/**
 * Clock (ms) under which the lance stops being rationed.
 *
 * Same argument as `bots.ts`'s AIM_PATIENCE_DEADLINE_MS and the same number:
 * discipline is a way of spending a resource better, and a resource unspent
 * when the bay ends was spent on nothing. The rack renews next bay
 * (`run.ts`'s thawChargesFor), so hoarding past the whistle is pure loss.
 */
export const LANCE_DUMP_MS = 30_000;

function lanceAware(): AimStrategy {
  return {
    name: "lance",

    abilities(g, now) {
      if (g.thawCharges <= 0) return false;
      const urgent = nextColdCryo(g.cubes, g.compactor);
      if (!urgent) return false;
      const face = g.compactor.x + g.compactor.width / 2;
      const closeIn = urgent.body.position.x - face <= LANCE_URGENT_CELLS * CELL;
      const endgame = g.level.timeLimitSec > 0 && g.timeLeftMs < LANCE_DUMP_MS;
      if (!closeIn && !endgame) return false;
      g.useThawLance(now);
      // NEVER claims the tick: the lance does not consume a launch, and
      // `thawHands` — the arm this is measured against — does not claim it
      // either. Returning true here would price the lance at one shipment.
      return false;
    },

    target(g, _now, base) {
      // A cryo shipment must not be sent at a frozen cube: `strikeCryo` refuses
      // to thaw a cube that is not already at rest, so the arriving cube stays
      // frozen too and the bay is one cube worse off. A volatile one must not
      // either, for the more obvious reason.
      const loaded = g.cannon.currentMaterial;
      if (loaded === "cryo" || loaded === "volatile") return null;

      const urgent = nextColdCryo(g.cubes, g.compactor);
      if (!urgent) return null;
      const face = g.compactor.x + g.compactor.width / 2;
      const closeIn = urgent.body.position.x - face <= LANCE_URGENT_CELLS * CELL;
      // Inside the band the lance has it; ask the same function for the next
      // one out. Outside it, the urgent cube IS the shipment's job.
      const mark = closeIn
        ? nextColdCryo(g.cubes.filter((c) => c !== urgent), g.compactor)
        : urgent;
      if (!mark) return null;

      const x = mark.body.position.x;
      const slot = slotOf(x);
      if (slot < 0 || slot >= g.level.compactorMinLineCells) return null;
      // Wider than a gap shot's tolerance because the target is a CUBE, not a
      // slot: `strikeCryo` only needs the impact, and a landing half a cell off
      // still lands on it. Tighter than the blast tolerance `demo` uses,
      // because there is no radius here at all.
      return { x, slot, tol: base.tol ?? CELL };
    },
  };
}

export const lanceStrategy: AimStrategySpec = { name: "lance", build: lanceAware };

/* ---------------------------------------------------------------------------
 * 3. CUSHION-AWARE — the pilot the findings say the cushion needs
 *
 * `winnability.ts`'s §5b-ter closes with the clearest open item in the
 * document: the liner "asks for play — land the shipment soft in the liner,
 * then close the row before something lands on it — and this pilot cannot make
 * that play". Both halves of that sentence are a rule here.
 *
 *  A. LAND IT SOFT, AND LAND IT IN THE LINER. When the loaded shipment is
 *     volatile and the rig carries a liner, the target is pulled to the lined
 *     slots and the arc is chosen for the SLOWEST arrival rather than the
 *     nearest landing. The threshold it is aiming under is the game's own —
 *     `cushionedTrigger(clause, liner) * VOLATILE_TRIGGER_SPEED`, which is what
 *     `volatileBlast` will actually compare against, floor and all.
 *  B. DO NOT LAND ON WHAT YOU JUST SAVED. The same section says what a rung
 *     really buys: "the liner converts an arrival detonation into a later one,
 *     in a bay that is fuller by the time it goes off". So a NON-volatile
 *     shipment refuses to land on a slot whose top cube is an intact volatile
 *     one — that landing is precisely the deferred bomb going off, and it is a
 *     landing the player chooses.
 *
 * INERT WITHOUT THE SYSTEM, on purpose. Both rules read `g.level.cushionCells`
 * and do nothing at zero. That makes the fourth row of the arms table — no
 * system, aware pilot — a control that must come back indistinguishable from
 * naive, and if it ever does not, the strategy is buying something the cushion
 * did not sell.
 * ------------------------------------------------------------------------- */

/**
 * How much of the liner's headroom a volatile landing aims to leave unused.
 *
 * The arc estimate is a per-step segment length taken at the compactor's top
 * (`bots.ts`'s estimateImpactSpeed), the real impact is a two-body relative
 * speed at whatever height the pile actually is, and the wind between the
 * decision and the landing is a drunk walk. 0.9 is one part in ten of margin
 * against all three — enough that the strategy prefers a genuinely soft arc
 * over one sitting on the threshold, and not so much that at tier 1 (25.3
 * against a 17.3 floor) nothing qualifies at all.
 */
export const CUSHION_SOFT_MARGIN = 0.9;

/** Landing tolerance for a shot aimed into the liner. Wider than the gap
 *  shot's one cell (`AIM_PATIENCE_TOL`) because the liner is four to eight
 *  cells wide: anywhere inside it is the right place, so holding fire over a
 *  half-cell drift would be refusing the shot the system is sold for. */
export const CUSHION_AIM_TOL = CELL * 2;

/** The trigger speed a volatile arrival meets inside this bay's liner — the
 *  same product `volatileBlast` forms, through the same floor function, so the
 *  strategy is aiming under the number the game will actually test. */
export function linerTriggerSpeed(g: Game): number {
  return VOLATILE_TRIGGER_SPEED
    * cushionedTrigger(g.level.volatileTriggerMult, g.level.cushionMult);
}

/** Slot indices whose TOP cube is an intact volatile one — the deferred bombs.
 *  "Top" is within a cell of the highest cube in the slot, which is what a
 *  landing there would strike. */
function bombedSlots(g: Game): Set<number> {
  const numSlots = g.level.compactorMinLineCells;
  const topY = new Array<number>(numSlots).fill(Number.POSITIVE_INFINITY);
  for (const c of g.cubes) {
    if (!inPlay(g, c)) continue;
    const k = slotOf(c.body.position.x);
    if (k < 0 || k >= numSlots) continue;
    if (c.body.position.y < topY[k]) topY[k] = c.body.position.y;
  }
  const out = new Set<number>();
  for (const c of g.cubes) {
    if (c.material !== "volatile" || !inPlay(g, c)) continue;
    const k = slotOf(c.body.position.x);
    if (k < 0 || k >= numSlots) continue;
    if (c.body.position.y - topY[k] <= CELL) out.add(k);
  }
  return out;
}

function cushionAware(): AimStrategy {
  return {
    name: "cushion",

    target(g, _now, base) {
      const cells = g.level.cushionCells;
      if (cells <= 0) return null;
      const numSlots = g.level.compactorMinLineCells;
      const halfWidthPx = pieceHalfWidthPx(g.cannon.currentType, g.level.pieceSize);
      const widthCells = Math.max(1, Math.round((2 * halfWidthPx) / CELL));

      if (g.cannon.currentMaterial === "volatile") {
        // RULE A. Into the liner, and as deep into it as the shipment's own
        // footprint fits — the deepest lined window is the one furthest from
        // the bar, so a cube parked there has the longest life before anything
        // presses it. The window is clamped to the liner rather than centred on
        // it: a liner four cells deep and a bulk pentomino four cells wide have
        // exactly one legal window between them.
        const last = Math.min(cells, numSlots) - widthCells;
        const start = Math.max(0, last);
        const centre = start + (widthCells - 1) / 2;
        return { x: slotCenterX(centre), slot: start, tol: CUSHION_AIM_TOL };
      }

      // RULE B. Anything else refuses the slots holding an intact volatile
      // cube at the top of their stack. Only the chosen window is re-checked —
      // the gap reader has already picked the best place to land, and this
      // strategy's job is to veto one specific kind of bad landing, not to
      // re-run the search with a different objective.
      const bombs = bombedSlots(g);
      if (bombs.size === 0 || base.slot < 0) return null;
      const overlaps = (s: number): boolean => {
        for (let k = 0; k < widthCells; k++) if (bombs.has(s + k)) return true;
        return false;
      };
      if (!overlaps(base.slot)) return null;
      // Nearest clean window to the one the gap reader wanted, scanning
      // outward, wall side first on a tie (the gap reader's own tie-break).
      const lastStart = Math.max(0, numSlots - widthCells);
      for (let d = 1; d <= lastStart; d++) {
        for (const s of [base.slot - d, base.slot + d]) {
          if (s < 0 || s > lastStart || overlaps(s)) continue;
          const centre = s + (widthCells - 1) / 2;
          return { x: slotCenterX(centre), slot: s, tol: base.tol };
        }
      }
      // Every window holds a bomb. Nothing to say — take the gap read and let
      // the blast happen, which is what the bay has become.
      return null;
    },

    select(g, _now, pool, shot) {
      if (g.level.cushionCells <= 0) return null;
      if (g.cannon.currentMaterial !== "volatile") return null;
      const tol = shot.tol ?? CUSHION_AIM_TOL;
      const want = linerTriggerSpeed(g) * CUSHION_SOFT_MARGIN;
      // Among the arcs that land where this shot is meant to go, the softest.
      // Ties broken toward the steeper arc, which is the baseline's own
      // tie-break and the reason it exists: a flat, fast arrival scatters the
      // pile it lands on, and scattering a pile that contains volatile cubes is
      // the exact event this strategy is trying not to cause.
      let best: AimCandidate | null = null;
      for (const c of pool) {
        if (c.err > tol) continue;
        if (!best || c.impact < best.impact
          || (c.impact === best.impact && c.deg > best.deg)) best = c;
      }
      // Nothing lands in the liner at all this shot — hand it back to the
      // baseline rather than fire a soft arc at somewhere else entirely.
      if (!best) return null;
      // A soft arc that still clears the trigger is not a cushion play; it is
      // the same detonation with extra steps. Taking it anyway would let the
      // arms table credit the strategy for shots that were never insured.
      // Below the threshold it is the play; above it, the baseline's nearest
      // landing is the better of two bad options.
      return best.impact <= want ? best : null;
    },
  };
}

export const cushionStrategy: AimStrategySpec = { name: "cushion", build: cushionAware };

/* ---------------------------------------------------------------------------
 * 4. INCINERATOR-AWARE — NOT IMPLEMENTED, and deliberately not stubbed silent
 *
 * The Incinerator (cubes destroyed in the sky region above the field top take a
 * reduced loss penalty, 25/50/75% by tier) is being built on its own branch and
 * is not on `staging`. Basing a strategy on it here would either measure a
 * system this branch cannot see, or — far worse — ship a strategy that quietly
 * behaves like `naive` and lets an arms table report the Incinerator as worth
 * nothing, which is precisely the mispricing this whole file exists to end.
 *
 * So it THROWS. A missing instrument that fails loudly costs one command; a
 * missing instrument that returns plausible numbers costs a design decision.
 *
 * WHEN THE TRACK LANDS, the hooks it needs are already here and no interface
 * change is expected for the aiming half:
 *  - `select` is the main one — the sky region is a band of world y, every
 *    candidate in the pool has flown its arc, and "does this arc put the cargo
 *    over the field top where it can burn" is a question about that arc. A
 *    strategy may re-probe a candidate (set `g.cannon.angle/power`, call
 *    `g.updateTrajectory()`, read `g.trajectory`) for anything the summary
 *    fields do not carry.
 *  - `abilities` is the other — a demolition charge fired at cargo that is
 *    still ABOVE the field top is the cheapest sky kill available, and that is
 *    a decision about timing, which is what `abilities` is for.
 * The one thing that may need a field is a target ABOVE the floor: `ShotTarget`
 * is a landing x today. Add `y` there rather than inventing a second target
 * type, and leave the baseline ignoring it.
 * ------------------------------------------------------------------------- */
export function incineratorAware(): AimStrategy {
  throw new Error(
    "incinerator-aware strategy is not implemented: the Incinerator track is not on"
    + " staging yet (see claude/incinerator-system). Follow-up: implement `select`"
    + " against the sky band and add a third arm to sim/strategy-arms.ts.",
  );
}

/* ---------------------------------------------------------------------------
 * THE REGISTRY
 * ------------------------------------------------------------------------- */

/** Every strategy a CLI can name. `incinerator` is absent on purpose — see
 *  above; a name in this table is a promise that a sweep under it means
 *  something. */
export const STRATEGIES: Record<string, AimStrategySpec> = {
  naive: naiveStrategy,
  lance: lanceStrategy,
  cushion: cushionStrategy,
};

/** Pair a draft policy with the strategy that flies it. */
export function playSpec(
  draft: PlaySpec["draft"], strategy: AimStrategySpec,
): PlaySpec {
  return { name: `${draft.name}/${strategy.name}`, draft, strategy };
}
