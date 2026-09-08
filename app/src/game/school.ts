import { applyBayDials, CONGESTED, type BayDials } from "./drills";
import { EXCELLENT_WINDOW_MS, GRADE_PAY } from "./grades";
import {
  makeBaseLevel, penaltyPerLostPieceFor, PILE_TIERS,
  type LandingCell, type LessonGoal, type LevelConfig,
} from "./level";
import { ORIENTATIONS, type Cell } from "./tiling";
import type { PieceSize, PieceType } from "./theme";

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

/** Shots the bankroll lesson's float buys before a single row is sold — the
 *  runway a beginner gets to miss with. Twelve against a Deep Run bay's eight
 *  (level.ts's LAUNCH_BUDGET_SHOTS): the bay is teaching that shots cost money,
 *  not testing whether you can afford them yet.
 *
 *  DECLARED ABOVE THE LADDER because the bankroll card quotes it. It used to
 *  sit beside levelForLesson, which spends it, and the card said "about twelve
 *  shots" in words — the one figure in the whole deck a bay could change
 *  without the card noticing. A const read from the temporal dead zone throws
 *  at module load, so this order is load-bearing rather than tidy. */
const BANKROLL_FLOAT_SHOTS = 12;
/** Rows of PROFIT the lesson asks for on top of that float. Three, because
 *  three is enough to feel the loop — spend, clear, bank — and eleven is a bay
 *  rather than a lesson. */
const BANKROLL_ROWS = 3;

/**
 * THE LADDER. Order is the curriculum; the array index is the licence
 * progress a save records.
 */
/**
 * THE COPY BUDGET, and why it is this small.
 *
 * The ladder shipped with cards that were correct, complete and unread. The
 * owner's verdict after playing it was that people do not read text as much —
 * a card that is four lines of prose over a live bay is competing with the bay
 * and losing, and every word past the instruction is a word spent while the
 * player is looking somewhere else.
 *
 * So a card is now:
 *
 *   ONE INSTRUCTION, at most twelve words, with the one thing the player must
 *   DO in <b>. The eye finds the bold run without reading the sentence, which
 *   is the whole point of putting it there.
 *
 *   ONE RULE LINE, at most ten words, and only when the card teaches a rule the
 *   instruction cannot carry — a price, a definition, a consequence.
 *
 * Anything the picture can say, the picture says instead: the board, the gap,
 * the shape that fits it and the arc into it are all drawn from these same
 * fields (ui/lessonart.ts's lessonPictogramHTML), so a sentence no longer has
 * to describe geometry the card is already showing. "The notch is two wide and
 * two deep, and the square fills it exactly" is a drawing, not a sentence.
 *
 * sim/systems.ts counts the words and the sentences, so a card cannot creep
 * back; sim/uifit measures the rendered height of the result.
 */
export const LESSONS: Lesson[] = [
  {
    id: "close-the-row",
    name: "Close the Row",
    brief: "One flat shipment fills the four-wide gap.",
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
        // THE GAP'S WIDTH IS IN THE PICTURE NOW. The strip above this sentence
        // draws TRENCH's four empty columns as a dashed, pulsing target — which
        // is where the number was authored and is a better place to read it
        // than a word in the middle of the one sentence a first-time player
        // reads before their first shot. What is left is the verb and the
        // thing the verb points at.
        body: `<b>Land</b> the shipment in the gap.`,
      },
      {
        title: "The press pays",
        // THE ZONE IS DEFINED HERE AND NOWHERE ELSE. Lessons 4, 7 and 8 all
        // spend the word; this is the one card that says what it means, which
        // is why a rule line survives the budget cut on a card whose
        // instruction would otherwise stand alone.
        body: `<b>Fill</b> a row in the zone and the press sells it.`
          + ` The <b>zone</b> is the floor beyond the bar.`,
      },
    ],
  },
  {
    id: "two-at-once",
    name: "Two at Once",
    brief: "One square drops in and closes two rows.",
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
        title: "Two rows",
        body: `<b>Drop</b> the square into the two-deep notch.`
          + ` Rows closed on one stroke sell together.`,
      },
      {
        title: "Reload",
        // NAMES THE RING, NOT A PANEL ROW. The plant panel's Reload track is
        // suppressed in every lesson bay (main.ts's hideReload) and the
        // cannon's own muzzle ring is the whole HUD for this state
        // (render.ts's drawReloadRing: amber while loading, aim-cyan the
        // instant it is fireable). The card pointed at the panel anyway.
        body: `<b>Line up</b> the next shot while the cannon reloads.`
          + ` The ring around it turns cyan when it is ready.`,
      },
    ],
  },
  {
    id: "four-in-the-well",
    name: "Four in the Well",
    brief: "Stand the shipment on its end. Four rows.",
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
        // The gesture prefix supplies the VERB in the live device's own words
        // and the rail lights the two buttons (Lesson.spotlight), so the bold
        // run here is the STATE the shipment has to be in rather than a second
        // instruction competing with the prefix.
        body: `Only an <b>upright</b> shipment enters a one-column well.`,
      },
      {
        title: "Four rows",
        // A PAYOFF CARD, and it is the one shape of card with no verb in it:
        // there is nothing left to do, so the bold run is the payout.
        body: `<b>One shipment, four rows</b> — the clear cascades.`,
      },
    ],
  },
  {
    id: "lob-or-skim",
    name: "Lob or Skim",
    brief: "A gap at each end. Take both.",
    conditions: "Two gaps · two arcs",
    reveal: REVEAL.placement,
    lines: 2,
    launches: 0,
    wall: ENDS,
    wallMaterial: "gold",
    sequence: ["O"],
    // TWO CARDS, TWO GAPS, IN THAT ORDER. The pictogram picks its target by
    // card index, far end first (ui/lessonart.ts's targetRun), so the deck's
    // order is what decides which gap each card's arc is drawn into. Swapping
    // these two swaps the pictures with them.
    cards: [
      {
        title: "The lob",
        body: `<b>Arc high</b> over the pile into the far gap.`
          + ` Slow, and it almost never spills.`,
      },
      {
        title: "The skim",
        body: `<b>Fire flat</b> across the top into the near gap.`
          + ` More reach, but it can bounce out of the zone.`,
      },
    ],
  },
  {
    id: "time-the-row",
    name: "Time the Row",
    brief: "Close two rows just before the bar sweeps them.",
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
        title: "A row's price",
        body: `<b>Beat</b> the press to a row and it pays more.`
          + ` Ground flat by the bar it is SWEPT, ×${GRADE_PAY.swept}.`,
      },
      {
        title: "Wait for it",
        body: `<b>Hold</b> the shot until the bar is coming in.`
          + ` GOOD pays ×${GRADE_PAY.good}; inside ${EXCELLENT_WINDOW_MS}ms, EXCELLENT ×${GRADE_PAY.excellent}.`,
      },
    ],
  },
  {
    id: "the-bankroll",
    name: "The Bankroll",
    brief: "Launches cost money now. Reach the target.",
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
        title: "Funds",
        body: `<b>Reach</b> the target and the bay ends.`
          + ` One number is your wallet and your score.`,
      },
      {
        title: "Shots cost",
        // THE FLOAT IS THE LIVE ONE. This said "about twelve shots" in words,
        // which made it the only figure in the deck a bay could change without
        // the card noticing — BANKROLL_FLOAT_SHOTS is what levelForLesson
        // actually spends, so it is what the card actually quotes.
        body: `<b>Spend few shots</b> per row — that is the whole game.`
          + ` You open on ${BANKROLL_FLOAT_SHOTS} shots of float.`,
      },
    ],
  },
  {
    id: "the-streak",
    name: "The Streak",
    brief: "Rows closed back to back pay more. Reach three.",
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
        body: `<b>Keep closing rows</b> and each one pays more.`
          + ` Every stroke that clears a row advances the streak.`,
      },
      {
        title: "Breaking it",
        body: `<b>Protect</b> the streak: cargo short of the zone breaks it.`
          + ` So does letting the bay clutter up.`,
      },
    ],
  },
  {
    id: "lost-cargo",
    name: "Lost Cargo",
    brief: "No scaffold, and spills cost money. Clear two rows.",
    conditions: "Live fine · ordinary belt",
    reveal: REVEAL.lost,
    lines: 2,
    launches: 16,
    fine: true,
    // NO WALL AND NO SEQUENCE — the first bay of the licence that deals the
    // ordinary seeded 7-bag onto an empty floor, which is what the tenth bay of
    // this player's first Deep Run will look like. A lesson about the cost of a
    // miss cannot be flown on a board that catches everything.
    //
    // It is also what the pictogram keys off: no wall means there is no gap to
    // draw an arc into, so the picture is the MISS instead — a cube stopping
    // short of the bar under a red −$ (ui/lessonart.ts).
    cards: [
      {
        title: "Cargo is lost",
        // WITH THE PRICE ON IT. The bay that exists to teach the fine was the
        // one surface that would not name it — the guide's own line does
        // (guide.ts's `lost`), and a rule you meet without its number is a rule
        // you cannot plan against.
        body: `A cube <b>short of the zone</b> costs $${penaltyPerLostPieceFor(0, 1)}.`
          + ` Billed per cube; a red −$ marks the spot.`,
      },
      {
        title: "Reach, then fit",
        body: `<b>Ask</b> if the shot reaches the zone before it fits.`
          + ` No gold here: what you land is what you have.`,
      },
    ],
  },
  {
    id: "clutter",
    name: "Clutter",
    brief: `Past ${PILE_TIERS[0].cubes} loose cubes every shot is taxed. Clear two rows.`,
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
    // can actually be dug out of, and the missing `wallMaterial` is also what
    // tells the pictogram to draw the crowded floor rather than a target gap.
    wall: CONGESTED,
    cards: [
      {
        title: "A taxed bay",
        // EVERY FIGURE DERIVED, including the reload's. It read "the reload
        // runs long" between two interpolated numbers — the one term on the
        // card that could not go stale because it said nothing.
        body: `Past <b>${PILE_TIERS[0].cubes} loose cubes</b> every launch costs ×${PILE_TIERS[0].costMult}.`
          + ` Reload ×${PILE_TIERS[0].reloadMult}, and a row pays ${Math.round(PILE_TIERS[0].payMult * 100)}%.`,
      },
      {
        title: "Stopping is free",
        body: `<b>Stop firing</b> into a bay you have lost.`
          + ` The tax is on the shot, never the pile.`,
      },
    ],
  },
];

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

/** The GRADUATION FLIGHT's seed — the ladder's tenth flight (meta.ts's
 *  GRADUATION_FLIGHT), on the same fixed idiom every lesson uses and for the
 *  sharper version of the same reason. That bay deals an ordinary seeded 7-bag
 *  onto an empty floor with a live clock and a live bankroll, so it is the one
 *  flight on the ladder whose difficulty a reroll could genuinely change — and
 *  an exam you can reroll until it is easy is not an exam. One index past the
 *  last lesson, so the ten flights hold ten distinct seeds. */
export function graduationSeed(): number {
  return lessonSeed(LESSONS.length);
}

/**
 * WHERE THIS BAY'S SHIPMENT GOES — the cells the renderer paints a landing
 * target on (LevelConfig.landingTarget, render.ts's drawLandingTarget).
 *
 * DERIVED FROM THE BAY, NOT AUTHORED BESIDE IT. The gap and the shape that
 * fills it are already written down twice — the profile's zero columns and the
 * belt's one-entry `sequence` — and a hand-typed third copy is a hint that
 * points at the old gap the first time a profile moves. That is not a
 * hypothetical: the well went from four deep to two and the streak bay's notch
 * slid two columns down the field, both after the lesson they belong to
 * shipped.
 *
 * THE FIT. A profile's gap is a RUN of zero-height columns (school.ts's
 * profiles all keep it that way, and sim/systems.ts pins that the shortest
 * column is zero), so the answer is the dealt shipment stood in the orientation
 * whose width is the run's width, bottom-anchored on the floor. Every set piece
 * on the ladder is an exact fit by construction — that is what "the gap narrows
 * from four columns to two to one" means — so an exact width match is what this
 * asks for, and a run with no orientation that width yields NO TARGET AT ALL
 * rather than a nearest guess. A hint in the wrong column is worse than none:
 * the player trusts it and then cannot understand why the row did not sell.
 *
 * Ties (a shape with two orientations the same width) take the SHORTEST, which
 * is the flattest way to fill the run and therefore the one that closes a row
 * with the least left standing. No shipped lesson has one — I and O between
 * them have three orientations and no two share a width — but the rule has to
 * be stated for the ladder to be extendable.
 *
 * Coordinates are the wall-outward slot pair `standingWall` uses, so `col`
 * grows LEFTWARD while a shape's own x grows rightward: the run's far end is
 * where a shape's x = 0 lands, hence `(end - 1) - x`. Invisible on I and O,
 * which are the only shapes the ladder deals and both mirror-symmetric, and
 * wrong for an S or a J the day one is authored.
 */
function landingTargetFor(
  wall: readonly number[],
  sequence: readonly PieceType[] | null,
  size: PieceSize,
): LandingCell[] | null {
  const type = sequence?.[0];
  if (!type || wall.length === 0) return null;

  const orientations = ORIENTATIONS[size][type];
  const cells: LandingCell[] = [];
  for (let k = 0; k < wall.length;) {
    if (wall[k] !== 0) { k += 1; continue; }
    let end = k;
    while (end < wall.length && wall[end] === 0) end += 1;
    const width = end - k;

    let fit: Cell[] | null = null;
    let fitHeight = Infinity;
    for (const cand of orientations) {
      const w = Math.max(...cand.map(([x]) => x)) + 1;
      const h = Math.max(...cand.map(([, y]) => y)) + 1;
      if (w === width && h < fitHeight) { fit = cand; fitHeight = h; }
    }
    // No orientation is exactly this wide: the bay's own shipment cannot fill
    // its own gap, so there is nothing honest to point at anywhere on it.
    if (!fit) return null;

    // Normalized cells run top row first (tiling.ts's `normalize`), and the
    // shipment lands on the floor, so the shape's last row is board row 0.
    for (const [x, y] of fit) cells.push({ col: (end - 1) - x, row: (fitHeight - 1) - y });
    k = end;
  }
  return cells.length > 0 ? cells : null;
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

  // THE LANDING TARGET, read off the bay the dials just finished writing rather
  // than off the lesson that asked for it. `standingWall`, `pieceSequence` and
  // `pieceSize` are what the bay will actually build, deal and throw, so a
  // future dial that rewrote any of them cannot leave the hint describing the
  // lesson's intent instead of the bay's behaviour.
  //
  // SCAFFOLDED BAYS ONLY, and it is the same condition boardResets is set from
  // two blocks up, for the same reason: the gold is what makes the gap an
  // authored answer that will still be there on the next attempt. Lost Cargo
  // and Clutter deal an ordinary board — there is no authored place for a
  // shipment to go on either, so pointing at one would be a lie about the bay
  // they are teaching.
  cfg.landingTarget = cfg.boardResets
    ? landingTargetFor(cfg.standingWall, cfg.pieceSequence, cfg.pieceSize)
    : null;

  return cfg;
}
