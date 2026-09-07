import { applyBayDials, CONGESTED, type BayDials } from "./drills";
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

/**
 * THE WORDS THE LADDER USES, and it uses only these.
 *
 * Nine bays teaching one machine will invent four names for it unless the
 * names are written down, and a beginner has no way to tell a synonym from a
 * second mechanic. Every one below is the term the rest of the game already
 * uses — guide.ts, screens.ts, drills.ts — so a player who leaves school and
 * opens the guide reads the same nouns.
 *
 *   shipment    what the cannon fires. Never "the piece", never "the bar".
 *   the bar     the red compactor face. The ONLY bar on screen: the plant
 *               panel's reload track is hidden in every lesson bay (main.ts
 *               passes hideReload), so nothing else may be called one.
 *   the press   the machine, and what it does. One advance of it is a
 *               STROKE — never a "crush", which is what it was called on one
 *               card and nowhere else.
 *   the zone    the floor BEYOND the bar, where a row can still be pressed
 *               against the far wall. Defined once, on lesson 1's second
 *               card, because lessons 4, 7 and 8 all spend it.
 *   short of the zone
 *               cargo that landed where the bar can no longer reach it. The
 *               single phrase for that event: "short of the bar", "misses the
 *               zone" and "drops short of the zone" were three wordings of it
 *               across four cards, and guide.ts's own line is this one.
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
  /** PREFIX this card with the live input profile's verb for an action, out of
   *  the one hint table (bindings.ts's hintAim / hintRotate).
   *
   *  Two cards need it and they are the two that name a CONTROL: the opening
   *  card, because where to put a shipment is not useful until you know how
   *  your device launches one, and the rotate card, which typed the touch
   *  rail's ⟲ / ⟳ glyphs and so pointed a keyboard player at buttons wearing
   *  Q and E and a pad player at LB / RB. The card supplies what the gesture
   *  cannot know — what to point it at. */
  input?: "aim" | "rotate";
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
  /** + placement practice; reload feedback stays on the cannon itself. */
  placement: 1,
  /** + the timing grade's callout over the payout. */
  grade: 2,
  /** + Funds / Target and the launch quote. */
  funds: 3,
  /** + the Combo readout. */
  combo: 4,
  /** + the launch budget and the Lost counter, which arrive together on the
   *  one lesson that has both.
   *
   *  NOT EARLIER, and the reason is that there was nothing to show. The set
   *  pieces hand out unlimited shipments — a "nothing to lose" bay cannot also
   *  be counting down — and hudOpts maps an unlimited budget to 0, so a stage
   *  that turned the block on before a budget existed put a permanent
   *  "LAUNCHES 0" on the panel: a readout that says the player is out of shots
   *  while they keep firing. Seen on device. The budget is a real number for
   *  the first time on Lost Cargo, which is where it now appears. */
  lost: 5,
  /** Everything, which is what every bay outside Flight School shows. */
  all: 6,
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
  /** What the live goal numerator counts. Defaults to Lines. */
  goalLabel?: string;
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
  /** A rail control to SPOTLIGHT for this lesson's bay — main.ts publishes it as
   *  `data-hilite` and app.css pulses the buttons.
   *
   *  The rail is seven near-identical buttons and a first-timer scanning it
   *  mid-bay has no reason to know which two a card means by "⟲ / ⟳". The
   *  retired four-card coach already had this spotlight and nothing drove it any
   *  more; it belongs to whichever lesson actually needs the control. Scoped to
   *  the lesson, not to the ladder: a highlight that never turns off is chrome
   *  rather than teaching. */
  spotlight?: "rotate";
}

/* ---------------------------------------------------------------------------
 * THE STANDING PILES.
 *
 * EIGHT COLUMNS, NEVER MORE, and that is a physical constraint rather than a
 * convention: eight is compactorMinLineCells, the press's full-advance stop, so
 * a ninth column stands in the bar's path and gets bulldozed on the first
 * stroke. drills.ts's profiles keep the same rule for the same reason.
 *
 * THE FIRST THREE ARE THE SAME IDEA AT THREE WIDTHS, and the narrowing is the
 * whole progression: the gap an exercise leaves you shrinks from four columns
 * to two to one, and the shipment that fills it goes from a flat I you only
 * have to land, to an O you have to place, to an I you have to turn on its end
 * and thread. Aim, then placement, then rotation.
 *
 * THE GAP IS INTERIOR ON ALL THREE — gold on both sides of it, never at an
 * edge. An edge gap is open on one side, so a piece that overshoots slides away
 * into the bay and the exercise silently becomes a different one. Walls on both
 * sides make a near-miss land visibly wrong instead of vanishing, which is the
 * feedback a first-time player is actually here for.
 *
 * ENDS IS THE FOURTH, AND IT BREAKS THAT RULE ON PURPOSE — a gap at each edge,
 * open on one side each. It is the exception because it is the one lesson whose
 * SUBJECT is the two arcs, and an interior gap cannot state the difference: a
 * lob and a skim are told apart by what stands between the cannon and the
 * landing, so the exercise needs one gap behind the pile and one in front of
 * it. The overshoot the rule protects against is exactly what the skim card
 * warns about ("it can bounce back out of the zone"), so on this bay a piece
 * sliding away is the lesson landing rather than the exercise dissolving — and
 * it is the only lesson that keeps two attempts alive (boardResetAttempts) so a
 * correct first square is not swept by a wrong second one.
 *
 * Every profile keeps its gap columns at ZERO, which is what guarantees no row
 * is already complete when the bay opens (contracts.ts's salvageProfile makes
 * the same promise the same way).
 * ------------------------------------------------------------------------- */

/** One row, one flat I. A four-column trench, one cube deep. */
const TRENCH: number[] = [1, 1, 0, 0, 0, 0, 1, 1];

/** Two rows, one O. A two-column notch, two cubes deep — the square drops in
 *  whole and closes both rows on the same stroke. */
const NOTCH: number[] = [2, 2, 2, 0, 0, 2, 2, 2];

/** Four rows, one upended I — and the depth is the whole trick.
 *
 *  It was four deep, which is the shape a tetris has always been played into
 *  and, as lesson three, the hardest shot in the game: a 4-tall piece threaded
 *  down a 4-deep slot. Two deep pays exactly the same four rows and asks for
 *  almost nothing, because the clear CASCADES — the I closes rows 0-1, they go,
 *  its top two cubes fall into the channel the clear just emptied onto gold that
 *  persisted, and close them again. Measured through the real clear check: at
 *  depth 2 the bay reports clears of [2,2], at depth 3 [3,1], at depth 4 [4].
 *  Four rows every time.
 *
 *  So the lesson keeps its name, its payoff and its subject — a flat I still
 *  cannot enter a one-column channel, so rotation is still the thing being
 *  taught — and loses only the precision. */
const WELL: number[] = [2, 2, 2, 0, 2, 2, 2, 2];

/** ONE ROW, ONE SQUARE. A two-column notch a single cube deep — the O drops in
 *  whole and closes the bottom row, leaving its top half standing where the
 *  board takes it back before the next shot.
 *
 *  The economy lesson's board. It used to be TRENCH and an I, which made five
 *  of the nine lessons deal the same piece; measured against the I on the same
 *  bay and the same goal, this is better on every pilot — the calibration bot
 *  goes 83%/18 shots to 100%/8, and a fixed-arc lob goes from never finishing
 *  to 100%/9. A smaller shipment also suits what the bay is teaching: every
 *  launch is money, so the exercise should be about spending few of them. */
const PAIR: number[] = [1, 1, 1, 0, 0, 1, 1, 1];

/** TWO ROWS, ONE SQUARE, at the other end of the field from Two at Once's.
 *  Same exercise the second lesson set, which is the point on a bay whose goal
 *  is three in a row: the shot is already known, so the lesson is the streak
 *  rather than the placement.
 *
 *  SHIFTED rather than reused, because a board byte-identical to lesson 2's is
 *  a re-run and reads as one. Slots 4-5 measured identical to lesson 2's slots
 *  3-4 for the aiming bot (8 shots) and better for a fixed-arc lob (8 against
 *  9), so the move costs nothing. */
const PAIR_DEEP: number[] = [2, 2, 2, 2, 0, 0, 2, 2];

/** A gap at each END, gold in the middle: the board that needs both shots.
 *
 *  Slot 0 is the column nearest the wall, so the far gap is on the RIGHT —
 *  behind a two-tall pile, which is a lob — and the near one on the LEFT, open
 *  to the cannon, which is a flat skim. One square fills each. Neither alone
 *  closes anything (measured: 0 lines for either gap on its own, 2 for both), so
 *  the lesson cannot be passed with one kind of shot, which is the only reason
 *  it exists. */
const ENDS: number[] = [0, 0, 2, 2, 2, 2, 0, 0];

/**
 * THE LADDER. Order is the curriculum; the array index is the licence
 * progress a save records.
 */
export const LESSONS: Lesson[] = [
  {
    id: "close-the-row",
    name: "Close the Row",
    brief: "One shipment closes it. The bay is already set — drop it into the gap.",
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
        // `input` PREFIXES this with the live device's firing gesture rather
        // than replacing it (screens.ts's lessonCardHTML), so the sentence
        // below is the one thing the gesture cannot know: what to point at.
        // It used to be replaced outright, which made this string dead copy
        // and put the gap's width — an authored number, two lines above — in
        // a template literal in the UI layer.
        input: "aim",
        body: `Put the dotted arc through the <b>four-wide gap</b>.`,
      },
      {
        title: "The press pays",
        body: `A row sells when the <b>red bar</b> reaches it. The floor beyond the bar is the`
          + ` <b>zone</b> — cargo <b>short of the zone</b> never counts. The gold stays put, so`
          + ` shoot again.`,
      },
    ],
  },
  {
    id: "two-at-once",
    name: "Two at Once",
    brief: "The gap is two wide and two deep. One square fills it, and two rows go together.",
    conditions: "One square · two rows at once",
    reveal: REVEAL.placement,
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
        // NAMES THE RING, NOT A PANEL ROW. The plant panel's Reload track is
        // suppressed in every lesson bay (main.ts's hideReload) and the
        // cannon's own muzzle ring is the whole HUD for this state
        // (render.ts's drawReloadRing: amber while loading, aim-cyan the
        // instant it is fireable). The card pointed at the panel anyway.
        body: `The cannon takes a moment to reload — the <b>ring around it</b> fills, then turns`
          + ` cyan. <b>Line the next shot up while you wait</b>; that habit buys more time than`
          + ` any upgrade.`,
      },
    ],
  },
  {
    id: "four-in-the-well",
    name: "Four in the Well",
    brief: "One column open. Stand the shipment on its end and drop it in.",
    conditions: "Rotate · four rows",
    reveal: REVEAL.placement,
    // FOUR ROWS, CUMULATIVE, because they arrive as two clears rather than one
    // — the cascade WELL's note describes. `atOnce` would be asking for the
    // 4-deep well back.
    lines: 4,
    launches: 0,
    wall: WELL,
    wallMaterial: "gold",
    sequence: ["I"],
    // The rail is seven near-identical buttons and this is the one lesson that
    // needs two of them by name.
    spotlight: "rotate",
    cards: [
      {
        title: "Turn it upright",
        input: "rotate",
        // The gesture prefix already names the two controls in the live device's
        // own words, and the rail lights them (Lesson.spotlight), so the card
        // only has to say WHY.
        body: `The well is <b>one column wide</b> and the shipment arrives flat, so it only`
          + ` goes in <b>on its end</b>.`,
      },
      {
        title: "Four rows, one drop",
        body: `Upright it fills the channel, the bottom rows sell, and what is left drops in`
          + ` and sells them again. <b>Four rows from one shipment.</b>`,
      },
    ],
  },
  {
    id: "lob-or-skim",
    name: "Lob or Skim",
    brief: "A gap at each end. One is behind the pile, one is in front — take both.",
    conditions: "Two gaps · two arcs",
    reveal: REVEAL.placement,
    lines: 2,
    launches: 0,
    wall: ENDS,
    wallMaterial: "gold",
    sequence: ["O"],
    cards: [
      {
        title: "The lob",
        body: `The <b>far</b> gap sits behind the pile. Only a <b>high, soft arc</b> drops into`
          + ` it — slow, and the shot that almost never spills.`,
      },
      {
        title: "The skim",
        body: `The <b>near</b> gap takes a <b>flat, fast</b> one straight across the top. More`
          + ` reach, and it can <b>bounce back out of the zone</b>. Fill both and the rows sell`
          + ` together.`,
      },
    ],
  },
  {
    id: "time-the-row",
    name: "Time the Row",
    brief: "Close two rows on a stroke that was already running. Beat the press, don't wait for it.",
    conditions: `Land 2 GOOD rows · up to ×${GRADE_PAY.excellent}`,
    goalLabel: "GOOD rows",
    reveal: REVEAL.grade,
    lines: 0,
    // GOOD, NOT EXCELLENT. Excellent is a 100ms window and asking for two of
    // them made this the hardest bay on the ladder — harder than anything a
    // Tier 1 run contains. GOOD is the wide one ("land while the bar is coming
    // in and let that sweep finish it"), and because the bands are ORDERED an
    // excellent row counts toward it for free (game.ts's objectiveMet), so the
    // player who nails the tight window is rewarded rather than required to.
    goal: { kind: "grade", grade: "good", count: 2 },
    launches: 0,
    wall: TRENCH,
    wallMaterial: "gold",
    sequence: ["I"],
    cards: [
      {
        title: "A row has a price",
        body: `Every row is graded on <b>when</b> it closed. Beat the press to it and it pays`
          + ` more; let the press grind it flat and it is <b>SWEPT</b>, ×${GRADE_PAY.swept}.`,
      },
      {
        title: "Wait for the bar",
        body: `So do not fire the moment you can. <b>Hold the shot until the bar is coming in</b>,`
          + ` then land in front of it: <b>GOOD</b>, ×${GRADE_PAY.good}. Inside`
          + ` ${EXCELLENT_WINDOW_MS}ms it is <b>EXCELLENT</b>, ×${GRADE_PAY.excellent}. Two timed rows passes.`,
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
    wall: PAIR,
    wallMaterial: "gold",
    sequence: ["O"],
    cards: [
      {
        title: "Funds are the score",
        body: `One number is your wallet <b>and</b> your score. Launches cost; rows pay. The bay`
          + ` ends the moment funds cross the target.`,
      },
      {
        title: "Shots are the puzzle",
        body: `You open on about <b>twelve shots</b> of float. A row built in two shots earns and`
          + ` a row built in six does not — that budget is the whole game.`,
      },
    ],
  },
  {
    id: "the-streak",
    name: "The Streak",
    brief: "Rows closed back to back pay more each time. Get the streak to three.",
    conditions: "Combo ×3",
    goalLabel: "Best combo",
    reveal: REVEAL.combo,
    lines: 0,
    goal: { kind: "combo", to: 3 },
    launches: 0,
    wall: PAIR_DEEP,
    wallMaterial: "gold",
    sequence: ["O"],
    cards: [
      {
        title: "Combo",
        body: `Each <b>stroke</b> that clears a row advances the streak, and the streak multiplies`
          + ` what the next one pays. Keep closing rows and the same play earns more.`,
      },
      {
        title: "Losing cargo breaks it",
        body: `<b>A cube lost short of the zone takes the streak with it</b> — and so does letting`
          + ` the bay clutter up. The skim risks a streak; the lob protects one.`,
      },
    ],
  },
  {
    id: "lost-cargo",
    name: "Lost Cargo",
    brief: "No scaffolding now, and cubes short of the zone are fined. Clear 2 rows.",
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
        // WITH THE PRICE ON IT. The bay that exists to teach the fine was the
        // one surface that would not name it — the guide's own line does
        // (guide.ts's `lost`), and a rule you meet without its number is a rule
        // you cannot plan against.
        body: `A cube that drops <b>short of the zone</b>, or bounces back out of it, blinks away`
          + ` and costs you <b>$${penaltyPerLostPieceFor(0, 1)}</b> — a red −$ marks the spot.`
          + ` Billed per cube.`,
      },
      {
        title: "Reach, then fit",
        body: `Ask <b>does this reach the zone</b> before asking does this fit`
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
    // drills.ts's CONGESTED profile, SHARED rather than re-drawn: it is sized
    // against PILE_TIERS[0].cubes so the bay opens ALREADY taxed, and a second
    // copy of that arithmetic would drift the first time the knee moved. This
    // comment used to sit above a hand-typed copy of the same eight numbers,
    // which is the drift it was written to prevent; drills.ts exports the
    // profile now. Standard, not gold — a congestion lesson needs a pile that
    // can actually be dug out of.
    wall: CONGESTED,
    cards: [
      {
        title: "A full bay is priced",
        // EVERY FIGURE DERIVED, including the reload's. It read "the reload
        // runs long" between two interpolated numbers — the one term on the
        // card that could not go stale because it said nothing.
        body: `Past <b>${PILE_TIERS[0].cubes} loose cubes</b> every launch costs`
          + ` <b>×${PILE_TIERS[0].costMult}</b>, the reload <b>×${PILE_TIERS[0].reloadMult}</b>,`
          + ` and a row pays only <b>${Math.round(PILE_TIERS[0].payMult * 100)}%</b>.`,
      },
      {
        title: "Stopping is free",
        // The longest card in the ladder, and measured the tightest: at its
        // full length the body scrolled inside `.coach__body` on a 360px-tall
        // viewport, which is the one failure the copy budget exists to catch.
        body: `The tax is on the <b>shot</b>, never the pile — letting the press work is free.`
          + ` Firing into a bay you have lost is the trap.`,
      },
    ],
  },
];

/** Shots the bankroll lesson's float buys before a single row is sold — the
 *  runway a beginner gets to miss with. Twelve against a Deep Run bay's eight
 *  (level.ts's LAUNCH_BUDGET_SHOTS): the bay is teaching that shots cost money,
 *  not testing whether you can afford them yet. */
const BANKROLL_FLOAT_SHOTS = 12;
/** Rows of PROFIT the lesson asks for on top of that float. Three, because
 *  three is enough to feel the loop — spend, clear, bank — and eleven is a bay
 *  rather than a lesson. */
const BANKROLL_ROWS = 3;

/** Cubes in one shipment. Every piece in PIECE_SHAPES is a tetromino, and the
 *  fined lessons' float is sized so that the worst possible bay — every cube of
 *  every launch spilled — is still billable to the last dollar. */
const CUBES_PER_SHIPMENT = 4;

/** Lessons in the ladder — the count a completed licence has to reach. */
export const LESSON_COUNT = LESSONS.length;

/** The short licence: aim, placement, rotation and arc choice. Everything
 * after this is advanced practice, available from the School once Tier 1 is
 * open instead of standing between a new player and the real game. */
export const LICENCE_LESSON_COUNT = 4;

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
    // ...but SIZED FOR A LESSON, not for a bay. Inherited whole, this asked for
    // Tier 1 bay 1's own numbers — $1080 off a $160 float, which is eleven rows
    // and a bay you can go broke in twice over on the way. Measured, a pilot
    // that never aims went broke on ten seeds of twelve without ever reaching
    // a quarter of it.
    //
    // Both numbers are DERIVED from the bay's own rates rather than typed, so
    // the lesson still teaches Tier 1's real economy — the same launch price
    // and the same line payout — over a runway and a finish line a first bankroll
    // can actually cross.
    cfg.startingFunds = BANKROLL_FLOAT_SHOTS * cfg.launchCost;
    cfg.targetScore = cfg.startingFunds + BANKROLL_ROWS * cfg.scorePerLine;
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

  // ...AND A FINE NEEDS A WALLET TO COME OUT OF, which the branch above just
  // set to zero.
  //
  // game.ts bills a spill as `Math.min(this.score, owed)` and spawns the "−$"
  // toast only `if (deducted > 0)`, so on a $0 float the charge is a no-op and
  // the toast never draws. Measured on the shipped bay: the `middle` bot lost
  // SIXTY-FOUR cubes across Lost Cargo's sixteen launches, was billed $0, and
  // saw zero toasts — while a bot that cleared a row first spilled one cube and
  // got its "−$1" immediately. The lesson demonstrated its own subject only to
  // the player who had already stopped needing it, and its card promises the
  // opposite in as many words ("fines you — a red −$ marks the spot. Billed per
  // cube"). fx.ts's `penalty` note is the argument for why the toast, not the
  // end screen, has to be where this is learned.
  //
  // So a fined lesson opens with exactly enough money to be billed for every
  // cube the bay can physically lose — its whole launch budget, four cubes a
  // shipment — and not a dollar of it is a budget: the price of a shot is still
  // zero here and the target is still unreachable, so nothing about this bay
  // can be lost to money. It buys one thing, which is that the debit is real
  // from the first spill instead of the first clear.
  if (lesson.fine && !lesson.economy) {
    // Every cube the bay can put in the air: one shipment per launch, plus the
    // standing pile — Clutter's wall is STANDARD, not gold, so the press can
    // shove it out of the zone like anything else.
    const loseable = cfg.launchBudget * CUBES_PER_SHIPMENT
      + (lesson.wall ?? []).reduce((a, b) => a + b, 0);
    cfg.startingFunds = loseable * cfg.penaltyPerLostPiece;
  }

  cfg.lessonGoal = lesson.goal ?? null;

  // THE STAGE THAT SAYS THE GRADE ARRIVES IS THE STAGE THAT MAKES IT ARRIVE.
  // REVEAL.grade has always been documented as "+ the timing grade's callout
  // over the payout" and had no mechanism behind it: the callout is an FX
  // field, not a `.pl-` block, so app.css's hide-list could never reach it.
  cfg.gradeCallout = lesson.reveal >= REVEAL.grade;

  // A SCAFFOLDED BAY HAS NO PILE (level.ts's boardResets). The gold says where
  // the answer goes and the belt deals the shape that fits it; a second
  // shipment lying on top of that is not the exercise that was authored, and —
  // measured, driving the lob bot at the ladder — it is what buried the well
  // under fifteen rows of stray cargo in a bay with no launch limit to fail out
  // of. Keyed off the scaffolding rather than a flag of its own, because the
  // two are the same statement: a bay whose board is drawn for it is a bay that
  // has to be able to get its board back.
  cfg.boardResets = lesson.wallMaterial === "gold";
  // LOB OR SKIM IS THE ONE CUMULATIVE EXERCISE — its answer is two squares
  // standing at once — so it keeps a second attempt alive and gets a longer
  // stroke budget with it. A stroke is ~4.3s, so three of them is about
  // thirteen seconds: enough for a deliberate second shot, and still an end.
  //
  // Everywhere else the board comes back after ONE stroke, whether or not
  // anything has been fired since (level.ts's boardResetStrokes). That is the
  // property the ladder is built on and did not have: every lesson but this one
  // is a single shot at an authored board, so the board the player aims at has
  // to be the authored one every time — not the authored one plus whatever
  // their last miss left lying across it.
  const cumulative = lesson.id === "lob-or-skim";
  cfg.boardResetAttempts = cumulative ? 2 : 1;
  // Eight strokes is ~34 seconds — long, deliberately. On the cumulative bay a
  // landed square is HALF THE ANSWER rather than debris, so the budget is there
  // to stop an abandoned attempt lingering, not to hurry the player; the
  // superseded clause still takes it the moment a third shipment lands.
  cfg.boardResetStrokes = cumulative ? 8 : 1;

  applyBayDials(cfg, lesson);
  return cfg;
}
