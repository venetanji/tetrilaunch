import { applyBayDials, type BayDials } from "./drills";
import { EXCELLENT_WINDOW_MS, GRADE_PAY } from "./grades";
import {
  makeBaseLevel, penaltyPerLostPieceFor, PILE_TIERS, type LessonGoal, type LevelConfig,
} from "./level";

/**
 * FLIGHT SCHOOL — the licence, and the ground floor of the tower.
 *
 * WHAT THIS REPLACES
 *
 * A four-card coach riding a live Deep Run bay 1 (ui/screens.ts's coachSteps).
 * Its problem was never the writing; it was the brief. Four cards had to carry
 * aim, rotate, the row and the whole bay economy over a RANDOMLY DEALT bay, and
 * the card's own notes record what that cost: the panel is bottom-anchored
 * under a hard height cap, the economy blocks want ~121px against a card that
 * is 127px on its own, so the last card hands over Funds, Target, Time, Notches
 * and Build in one go at the moment it leaves. Everything after that — the
 * timing grade, the streak, the spill fine, the congestion tax — was met by
 * ambush, inside the one mode that can be lost.
 *
 * So the teaching is a LADDER now, not a deck: one bay per idea, in an order,
 * with the HUD block that idea needs arriving on the bay that earns it.
 *
 * WHY THE PIECES ARE AUTHORED
 *
 * A random deal cannot be a lesson. "Close this row" is a different exercise
 * every time the bag reshuffles, and the first one a new player meets decides
 * whether they think the game is fair. Every bay below is a SET PIECE: a
 * standing pile that is already most of a row, and a belt that deals one shape
 * forever (BayDials.sequence cycles). The first three are single-shot — the
 * board arrives set, and one correctly aimed shipment finishes it.
 *
 * WHY THE SCAFFOLDING IS GOLD
 *
 * theme.ts's `gold` fills a slot like any other cube and then declines to leave
 * (MATERIAL_SPEC.persists). So the row closes, grades, pays — and rebuilds
 * itself. A missed shot costs a reload instead of a restart, which is what lets
 * a one-shot exercise be attempted twenty times without a menu in between. It
 * is also why these bays need no retry button of their own.
 *
 * WHAT ARRIVES LAST, AND WHY
 *
 * Nothing that can punish the player exists until it has been taught. Lessons 1
 * through 7 run with the spill fine at zero, exactly as drills.ts's stripping
 * does and for the reason stated there. Lesson 8 is the first bay that can lose
 * you money and the first with a random deal; lesson 9 is congestion, which is
 * last because it is a tax on a mistake the player has to be capable of making
 * before it means anything.
 */

/** A card in a lesson's deck.
 *
 *  ONE PAD-ROUTED BUTTON PER CARD, always — main.ts routes B (padnav's
 *  PAD_BACK) to a single `.coach__btn` selector while the bay is live, because
 *  every other face button is spoken for by gameplay. A card with two buttons
 *  would leave a pad-only player unable to advance at all, so a lesson's only
 *  exit is the pause modal. */
export interface LessonCard {
  title: string;
  /** Height-budgeted, the same discipline coachSteps is held to: the card
   *  shares the plant panel's column under a hard cap, so a sentence that
   *  overruns pushes its own tail out of `.coach__body` rather than pushing the
   *  panel. sim/uifit asserts it; sim/systems.ts counts the characters. */
  body: string;
}

/**
 * How much of the readout this lesson's bay shows.
 *
 * The stages are CUMULATIVE and they are the reveal's whole vocabulary: main.ts
 * stamps the number onto the HUD as `data-reveal` and app.css hides every block
 * above it. Ordered so each one is turned on by the bay that gives it something
 * to say — RELOAD means nothing until a second shot has been waited for, and
 * COMBO means nothing until two rows have closed in a row.
 *
 * Named rather than numbered at the call site so the ladder can be reordered
 * without renumbering nine bays and a stylesheet.
 */
export const REVEAL = {
  /** PWR only. Power is part of the one drag gesture lesson 1 teaches, and it
   *  is the number that moves while the player pulls. */
  aim: 0,
  /** + Reload. */
  reload: 1,
  /** + Launches — the shipment budget. */
  launches: 2,
  /** + the timing grade's callout over the payout. */
  grade: 3,
  /** + Funds / Target and the launch quote. */
  funds: 4,
  /** + the Combo readout. */
  combo: 5,
  /** + the Lost counter. */
  lost: 6,
  /** Everything, which is what every bay outside Flight School shows. */
  all: 7,
} as const;

export type RevealStage = (typeof REVEAL)[keyof typeof REVEAL];

export interface Lesson extends BayDials {
  /** Stable id — the save's licence progress is a COUNT, but the result card,
   *  the seed and the guide all key off this. */
  id: string;
  /** Card title, and the bay's name while you are in it. */
  name: string;
  /** The pass condition in one sentence, for the lesson card and the result. */
  brief: string;
  /** The same at HUD length, for the plant panel's one-line complications row.
   *  Split from `brief` for the reason DrillSpec splits its own. */
  conditions: string;
  /** The deck, in order. */
  cards: LessonCard[];
  /** How much readout this bay shows. */
  reveal: RevealStage;
  /** Rows to clear, when that is the whole condition. 0 when `goal` states it
   *  instead, or when the bay is won on funds. */
  lines: number;
  /** The pass condition the two ordinary ones cannot express (level.ts's
   *  LessonGoal). Null when `lines` or the funding target is the condition. */
  goal?: LessonGoal;
  /** Shipments the bay hands out. 0 means unlimited, which is what the lessons
   *  that are about repetition want. */
  launches: number;
  /** Keep the bankroll, the launch price and the funding target — the Deep Run
   *  economy, which two lessons are ABOUT and the other seven strip. */
  economy?: boolean;
  /** Keep the spill fine, at Tier 1's price. Lesson 8 and nothing before it. */
  fine?: boolean;
}

/* ---------------------------------------------------------------------------
 * THE STANDING PILES.
 *
 * EIGHT COLUMNS, NEVER MORE, and that is a physical constraint rather than a
 * convention: eight is compactorMinLineCells, the press's full-advance stop, so
 * a ninth column stands in the bar's path and gets bulldozed on the first
 * stroke. drills.ts's profiles keep the same rule for the same reason.
 *
 * All three below are the SAME IDEA at three widths, and the narrowing is the
 * whole progression: the gap an exercise leaves you shrinks from four columns
 * to two to one, and the shipment that fills it goes from a flat I you only
 * have to land, to an O you have to place, to an I you have to turn on its end
 * and thread. Aim, then placement, then rotation and precision together.
 *
 * THE GAP IS ALWAYS INTERIOR — gold on both sides of it, never at an edge. An
 * edge gap is open on one side, so a piece that overshoots slides away into the
 * bay and the exercise silently becomes a different one. Walls on both sides
 * make a near-miss land visibly wrong instead of vanishing, which is the
 * feedback a first-time player is actually here for.
 *
 * Every profile keeps its gap columns at ZERO, which is what guarantees no row
 * is already complete when the bay opens (contracts.ts's salvageProfile makes
 * the same promise the same way).
 * ------------------------------------------------------------------------- */

/** One row, one flat I. A four-column trench, one cube deep. */
const TRENCH: number[] = [1, 1, 0, 0, 0, 0, 1, 1];

/** Two rows, one O. A two-column notch, two cubes deep — the square drops in
 *  whole and closes both rows on the same crush. */
const NOTCH: number[] = [2, 2, 2, 0, 0, 2, 2, 2];

/** Four rows, one upended I. The well: one column wide, four deep, which is
 *  the shape the tetris has always been played into. */
const WELL: number[] = [4, 4, 4, 0, 4, 4, 4, 4];

/**
 * THE LADDER. Order is the curriculum; the array index is the licence
 * progress a save records.
 */
export const LESSONS: Lesson[] = [
  {
    id: "close-the-row",
    name: "Close the Row",
    brief: "One shipment closes it. The bay is already set — put the bar in the gap.",
    conditions: "One shot · gap is four wide",
    reveal: REVEAL.aim,
    lines: 1,
    launches: 0,
    wall: TRENCH,
    wallMaterial: "gold",
    // A flat I is PIECE_SHAPES.I unrotated, so this lesson needs no rotation at
    // all — which is the point of putting it first. Rotation is lesson 3's job,
    // introduced by a gap that cannot be filled without it.
    sequence: ["I"],
    cards: [
      {
        title: "Aim & fire",
        body: `The bay is set: <b>one shipment</b> closes the bottom row. Aim the dotted arc`
          + ` into the four-wide gap and let go.`,
      },
      {
        title: "The press pays",
        body: `A row sells when the red bar reaches it — that is why cargo <b>short of the bar</b>`
          + ` never counts. The gold stays put, so take the shot again.`,
      },
    ],
  },
  {
    id: "two-at-once",
    name: "Two at Once",
    brief: "The gap is two wide and two deep. One square fills it, and two rows go together.",
    conditions: "One square · two rows at once",
    reveal: REVEAL.reload,
    lines: 0,
    goal: { kind: "atOnce", lines: 2 },
    launches: 0,
    wall: NOTCH,
    wallMaterial: "gold",
    sequence: ["O"],
    cards: [
      {
        title: "Two rows, one shot",
        body: `The notch is <b>two wide and two deep</b>, and the square fills it exactly.`
          + ` Rows closed on the same stroke sell together.`,
      },
      {
        title: "Reload",
        body: `The cannon takes a moment to reload — the bar under the readout. <b>Line the next`
          + ` shot up while it fills</b>; that habit buys more time than any upgrade.`,
      },
    ],
  },
  {
    id: "four-in-the-well",
    name: "Four in the Well",
    brief: "One column open, four deep. Turn the shipment on its end and thread it.",
    conditions: "Rotate · four rows at once",
    reveal: REVEAL.launches,
    lines: 0,
    goal: { kind: "atOnce", lines: 4 },
    launches: 0,
    wall: WELL,
    wallMaterial: "gold",
    sequence: ["I"],
    cards: [
      {
        title: "Turn it upright",
        body: `The well is <b>one column wide</b>. The shipment arrives flat, so turn it`
          + ` <b>90°</b> with the ⟲ / ⟳ rail before you fire.`,
      },
      {
        title: "Four at once",
        body: `Upright, it fills all four rows and they sell in one stroke. Nothing in the`
          + ` bay pays better than a well you kept open.`,
      },
    ],
  },
  {
    id: "lob-or-skim",
    name: "Lob or Skim",
    brief: "Two ways into the same gap. Learn what each one costs before it matters.",
    conditions: "Two arcs · same gap",
    reveal: REVEAL.launches,
    lines: 3,
    launches: 0,
    wall: TRENCH,
    wallMaterial: "gold",
    sequence: ["I"],
    cards: [
      {
        title: "The lob",
        body: `A <b>high, soft arc</b> drops in steeply and lands where you put it. It is slow,`
          + ` and it is the shot that almost never spills.`,
      },
      {
        title: "The skim",
        body: `A <b>flat, fast arc</b> skims the top of the pile — far more reach, and it can`
          + ` <b>bounce back out</b> of the zone. Worth it when the clock is the thing you are short of.`,
      },
    ],
  },
  {
    id: "time-the-row",
    name: "Time the Row",
    brief: `Close two rows inside ${EXCELLENT_WINDOW_MS}ms of the shipment settling. That is EXCELLENT.`,
    conditions: `2 × EXCELLENT · ×${GRADE_PAY.excellent}`,
    reveal: REVEAL.grade,
    lines: 0,
    goal: { kind: "grade", grade: "excellent", count: 2 },
    launches: 0,
    wall: TRENCH,
    wallMaterial: "gold",
    sequence: ["I"],
    cards: [
      {
        title: "A row has a price",
        body: `Every row is graded on <b>when</b> it closed. Land into a stroke already running:`
          + ` <b>EXCELLENT</b>, ×${GRADE_PAY.excellent}. Ground flat by the press: <b>SWEPT</b>, ×1.`,
      },
      {
        title: "Wait for the bar",
        body: `So do not fire the moment you can. <b>Hold the shot until the bar is coming in</b>,`
          + ` then put the piece in front of it. Two EXCELLENT rows and this bay is yours.`,
      },
    ],
  },
  {
    id: "the-bankroll",
    name: "The Bankroll",
    brief: "Now it costs money. Reach the target before the funds run out.",
    conditions: "Bay 1's money · no clock",
    reveal: REVEAL.funds,
    lines: 0,
    launches: 0,
    economy: true,
    wall: TRENCH,
    wallMaterial: "gold",
    sequence: ["I"],
    cards: [
      {
        title: "Funds are the score",
        body: `One number is your wallet <b>and</b> your score. Launches cost; rows pay. The bay`
          + ` ends the moment funds cross the target.`,
      },
      {
        title: "Shots are the puzzle",
        body: `You open on about <b>eight shots</b> of float. A row built in two shots earns and`
          + ` a row built in six does not — that budget is the whole game.`,
      },
    ],
  },
  {
    id: "the-streak",
    name: "The Streak",
    brief: "Rows closed back to back pay more each time. Get the streak to three.",
    conditions: "Combo ×3",
    reveal: REVEAL.combo,
    lines: 0,
    goal: { kind: "combo", to: 3 },
    launches: 0,
    wall: TRENCH,
    wallMaterial: "gold",
    sequence: ["I"],
    cards: [
      {
        title: "Combo",
        body: `Each crush that clears a row advances the <b>streak</b>, and the streak multiplies`
          + ` what the next one pays. Keep closing rows and the same play earns more.`,
      },
      {
        title: "It breaks",
        body: `A stroke that clears nothing ends it, and so does letting the bay fill up. The`
          + ` skim is the shot that risks a streak; the lob is the shot that protects one.`,
      },
    ],
  },
  {
    id: "lost-cargo",
    name: "Lost Cargo",
    brief: "No scaffolding now, and cubes that miss the zone are fined. Clear 2 rows.",
    conditions: "Live fine · ordinary belt",
    reveal: REVEAL.lost,
    lines: 2,
    launches: 16,
    fine: true,
    // NO WALL AND NO SEQUENCE — the first bay of the licence that deals the
    // ordinary seeded 7-bag onto an empty floor, which is what the tenth bay of
    // this player's first Deep Run will look like. A lesson about the cost of a
    // miss cannot be flown on a board that catches everything.
    cards: [
      {
        title: "Cargo can be lost",
        body: `A cube that drops <b>short of the zone</b>, or bounces back out of it, blinks away`
          + ` and <b>fines you</b> — a red −$ marks the spot. Billed per cube.`,
      },
      {
        title: "Reach, then fit",
        body: `So the question is always <b>does this reach the zone</b> before it is does this fit`
          + ` the row. This bay has no gold in it: what you land is what you have.`,
      },
    ],
  },
  {
    id: "clutter",
    name: "Clutter",
    brief: `Past ${PILE_TIERS[0].cubes} loose cubes the bay taxes every shot. Clear 2 rows anyway.`,
    conditions: "Opens past the first rung",
    reveal: REVEAL.all,
    lines: 2,
    launches: 22,
    fine: true,
    // drills.ts's CONGESTED profile, deliberately shared rather than re-drawn:
    // it is sized against PILE_TIERS[0].cubes so the bay opens ALREADY taxed,
    // and a second copy of that arithmetic would drift the first time the knee
    // moved. Standard, not gold — a congestion lesson needs a pile that can
    // actually be dug out of.
    wall: [7, 7, 1, 0, 1, 7, 7, 7],
    cards: [
      {
        title: "A full bay is priced",
        body: `Past <b>${PILE_TIERS[0].cubes} loose cubes</b> every launch costs`
          + ` <b>×${PILE_TIERS[0].costMult}</b>, the reload runs long, and a row pays only`
          + ` <b>${Math.round(PILE_TIERS[0].payMult * 100)}%</b>.`,
      },
      {
        title: "Stopping is free",
        body: `The tax is on the <b>shot</b>, never on the pile — so letting the press work costs`
          + ` you nothing. Firing into a bay you have lost control of is the trap.`,
      },
    ],
  },
];

/** Lessons in the ladder — the count a completed licence has to reach. */
export const LESSON_COUNT = LESSONS.length;

export function lessonAt(index: number): Lesson | null {
  return LESSONS[index] ?? null;
}

export function lessonById(id: string): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}

/** A lesson's seed, derived from its index.
 *
 *  FIXED, like drills.ts's drillSeed and for the same reason: a lesson you can
 *  only half-repeat is not a lesson. Eight of the nine are fully authored and
 *  would not notice, but "Lost Cargo" deals a real 7-bag and this is what makes
 *  its deal the same one every attempt. */
export function lessonSeed(index: number): number {
  return 0x5c400 + index;
}

/**
 * Build the bay for one lesson.
 *
 * Starts from `makeBaseLevel(0)` — bay 1 of the ladder, the calmest bay the
 * game knows how to make — and writes exactly the dials the lesson needs
 * through the same applyBayDials every drill goes through. Deliberately NOT
 * built from scratch, for the reason levelForDrill states: a teaching bay has
 * to be the same physics, the same press and the same joints a real bay ships,
 * or it teaches a game the player does not own.
 */
export function levelForLesson(lesson: Lesson): LevelConfig {
  const cfg = makeBaseLevel(0);
  cfg.name = lesson.name;

  if (lesson.economy) {
    // The bankroll bay, kept whole: the launch price, the float and the target
    // ARE the lesson. The clock still goes — one pressure at a time is the
    // premise of the whole ladder, and the clock is not taught here.
    cfg.timeLimitSec = 0;
    cfg.objectiveLines = 0;
    cfg.launchBudget = 0;
  } else {
    // The Contract stripping (contracts.ts's levelForContract), for the reason
    // stated there: nothing is spent, so nothing needs to be earned back.
    cfg.launchCost = 0;
    cfg.startingFunds = 0;
    cfg.targetScore = Number.MAX_SAFE_INTEGER;
    cfg.timeLimitSec = 0;
    cfg.objectiveLines = lesson.lines;
    cfg.launchBudget = lesson.launches;
  }

  // THE FINE IS OFF UNTIL LESSON 8 SAYS OTHERWISE, and on it is Tier 1's own
  // price rather than a number invented here — a licence bay is a Tier 1 bay by
  // construction, and the ramp's bottom rung is what the player's first real
  // run will charge them (level.ts's penaltyPerLostPieceFor).
  cfg.penaltyPerLostPiece = lesson.fine ? penaltyPerLostPieceFor(0, 1) : 0;

  cfg.lessonGoal = lesson.goal ?? null;

  applyBayDials(cfg, lesson);
  return cfg;
}
