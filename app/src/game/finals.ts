import type { LevelConfig } from "./level";
import { WIND_GUST_FRACTION } from "./level";
import { MIX_TOTAL_CAP, MATERIAL_NOTCH } from "./hazards";
import type { UpgradeId } from "./upgrades";
import { MARK_COUNT } from "./upgrades";

/**
 * FINAL INSPECTION — the last choice of a run, and the only one that is not a
 * ratchet.
 *
 * Every other bay-clear deals the axis draft (hazards.ts): pick a notch, it
 * sticks for the rest of the run. That contract stops meaning anything at the
 * last draft, because there IS no rest of the run — one bay is left. A notch
 * taken before bay 10 is a notch taken FOR bay 10 and nothing else, so the
 * ratchet's whole shape (cheap now, ruinous by the tenth repeat) is spent on a
 * decision that will never repeat. The player is being asked to price a
 * permanent commitment one bay before permanence expires.
 *
 * So the last draft deals something else: two clauses attached to the final
 * bay, one of which the player must accept. Three properties define them.
 *
 *  - **They are the Tier's own exam.** A Tier (a Mark, in the code's older
 *    word) is a statement about which hazards exist and which systems answer
 *    them — each Tier from 2 to 9 opens exactly one new axis on hazards.ts's
 *    ladder, and upgrades.ts sells exactly the system that makes it cheap. The
 *    two ends are special: Tier 1 opens the base number axes together, dealing
 *    Fuel Levy and Shift Cut (Quota Raise is in RETIRED_AXES), and Tier 10
 *    opens no new axis at all, asking two notches a bay instead (picksPerBay).
 *    The Final Inspection is that pairing asked as a question: Tier 1 taught
 *    the money axes and sold you the Reactor, so Tier 1's final bay is about
 *    money.
 *    Tier 2 taught the wind and sold you the Launcher, so Tier 2's is weather.
 *    A player arriving at bay 10 has spent a whole run being told what this
 *    Tier is about; the inspection is where that gets marked.
 *
 *  - **Both clauses are equally bad, and bad DIFFERENTLY.** This is the part
 *    that makes it a choice rather than a toll. Each pair costs about the same
 *    measured in the only unit the bay actually spends — extra lines it has to
 *    sell to make its quota — but the two costs land on different halves of the
 *    same system, so which one is cheaper depends on the ship the player
 *    actually built. A fat Reactor shrugs at a rate cut and bleeds against a
 *    raised quota; a thin one is the other way round. Neither card is ever the
 *    obvious pick, and the right pick is legible from the rig.
 *
 *  - **Neither can be dodged, and neither is a lose button.** The hand is
 *    exactly two and the player takes exactly one, at every Tier — including
 *    the capstone, where the ordinary draft asks for two notches (hazards.ts's
 *    picksPerBay). Two clauses are mutually exclusive readings of the same
 *    inspection; taking both is not a harder run, it is a nonsense one. And
 *    every clause below is floored the way hazards.ts's Shift Cut is floored,
 *    for the same stated reason: an axis that can reach an unplayable bay is
 *    not a difficulty knob, it is a lose button — and this one fires on the
 *    run's last bay, where a dead bay costs the entire run rather than a notch.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE NUMBERS CAME FROM — and what the instruments can and cannot say.
 *
 * Two of them, and the second one turned out to measure one thing only. Both
 * were run from throwaway probes (deleted; re-derivable from this note) that
 * built bay 10 at each clause's OWN Tier against that Tier's full build budget
 * — which matters: at Tier 10 level.ts sends the bay's joints to Infinity, so a
 * clause priced on a Mark-1 bay is priced on a bay that does not exist.
 *
 *  1. THE LINE MODEL — contracts.ts's own launch budget (CUBES_PER_LINE over
 *     cubes a launch delivers times PLANNING_EFFICIENCY, discounted by
 *     MATERIAL_WASTE), converted to "extra lines the bay demands". Exact for
 *     money, cargo size, line width and the material mix. Blind to physics.
 *  2. THE aim BOT — 20 seeds a cell, against that Tier's own no-clause
 *     baseline. See below for what it actually prices.
 *
 * WHAT THE BOT MEASURED (20 seeds, win-rate delta against the Tier's baseline):
 *
 *   T1  Rush Order   -5   Rate Cut     -5      T6  Slag Run   -65  Slag Wall -65
 *   T2  Head Gale    -5   Tail Gale   +15      T7  Powder Run   0  Hair Trig +20
 *   T3  Double Shift -5   Tight Gauge +20      T8  Tar Run    -50  Fouled    -55
 *   T4  Cold Chain  -70   Ice Wall    -65      T9  Bled Hyd    -5  Haulage   -10
 *   T5  Rebar Run   +10   Cold Weld   -15      T10 Dead Weight -45  Short Ms +30
 *
 * (The T10 row reads the RETIRED size pair — Dead Weight and Short Measure,
 * the domino/pentomino fork. The capstone now deals the full-belt cargo pair
 * below, which the bot has not flown; the Tier 10 section says why the size
 * fork was retired and what can honestly be said about its replacement.)
 *
 * Six clauses read at or ABOVE the bay they are supposed to make harder. That
 * looks like six broken cards, and it is not: sorted by what each clause takes
 * away, all twenty fall into three groups with no exceptions.
 *
 *  - **Take away CUBES THAT CAN REACH A LINE** — every material clause, plus
 *    Cold Weld (no loose cubes to fill gaps) and the retired Dead Weight (a
 *    rigid pentomino on an unbreakable bay cannot be worked into a row). The
 *    bot collapses: -15 to -70.
 *  - **Take away MONEY** — Rush Order, Rate Cut, Haulage Bond, Bled Hydraulics.
 *    A small, consistent -5 to -10: the bot stops firing when it is broke, so
 *    it feels this directly and proportionately.
 *  - **Take away GOOD PLACEMENTS** — Tight Gauge, Tail Gale, Rebar Run, Hair
 *    Trigger, Powder Run, the retired Short Measure. Free, or better than free.
 *
 * The third group is the finding. The bot does not plan a row: it solves an
 * angle and fires on every cooldown, so a clause that shrinks the space of GOOD
 * placements costs it nothing, while a clause that shrinks the space of legal
 * ones sometimes helps. Tight Gauge is the proof — a narrower bay moved its
 * conversion from 4.30 shots per line to 2.87, because a nearer open stop packs
 * the pile tighter, which is the metric the bot is implicitly optimising.
 *
 * So the 20-seed table is NOT evidence that those six clauses are free. It is a
 * measurement of the harness: this bot prices cubes-into-lines and money, and
 * is blind to placement quality by construction. It is also not evidence that
 * they are costs — nothing here, and nothing in the repo, measures how hard a
 * bay is to PLAN. That is the gap a device playtest fills, and it is the gap
 * these six clauses live in.
 *
 * Two consequences are already written into the numbers below:
 *
 *  - **Material rates are set against the LADDER, not the bot.** One notch of
 *    slag or cryo at hazards.ts's own gentlest rate (materialRate(1) = 0.07, a
 *    rate the shipped game deals routinely) takes the bot from 100% to 0%. A
 *    0% row says nothing about the number. So no rate below exceeds what
 *    materialRate reaches at six notches, and the two with the heaviest waste
 *    weights sit well under it.
 *  - **The bot's cadence is not a human's**, the same limit level.ts's
 *    congestion note records learning the hard way. Fouled Bay is priced in
 *    exactly that currency.
 *
 * First-pass numbers, then, in the same sense hazards.ts means it of its own
 * notch sizes — with the derivation attached, and with the instrument's blind
 * spot named rather than mistaken for a result.
 */

export type FinalId =
  | "rush-order" | "rate-cut"
  | "head-gale" | "tail-gale"
  | "double-shift" | "tight-gauge"
  | "cold-chain" | "ice-wall"
  | "rebar-run" | "cold-weld"
  | "slag-run" | "slag-wall"
  | "powder-run" | "hair-trigger"
  | "tar-run" | "fouled-bay"
  | "bled-hydraulics" | "haulage-bond"
  | "odd-lots" | "full-rebar";

export interface FinalDef {
  id: FinalId;
  /** Two words, like every hazard card. */
  name: string;
  /** The clause, with its exact number in it. Same rule the HazardDefs follow:
   *  the player is accepting a cost sight-unseen on the run's last bay, so a
   *  card that describes the SHAPE of the cost without its size turns a
   *  deliberate trade into a guess. */
  desc: string;
  /** The Tier this pair is the exam for. */
  tier: number;
  /** The ship system the exam is about — the one that Tier's hazard taught the
   *  player to buy (upgrades.ts). Read by the UI to name it on the card, so a
   *  player who never made the connection is told it once, at the moment it
   *  finally matters. */
  system: UpgradeId;
  /** This clause states the WHOLE belt: nothing standard ships, the mix sums
   *  to exactly 1, and apply() carries its own no-refund floors (every
   *  material at least what the run arrived with). applyFinal's MIX_TOTAL_CAP
   *  re-cap stands down for it — that cap exists to stop a partial-belt
   *  clause overfilling a belt that still owes the player standard cargo, and
   *  a full-belt clause has none to owe. sim/systems.ts holds the pair to
   *  this contract on every arrival it can construct. Capstone-only by
   *  design: taking the standard shipment away entirely is the one cost that
   *  must never be dealt before the ladder's last exam. */
  fullBelt?: true;
  /** Mutate the final bay's config. Called at most once per run, on a config
   *  that already carries the ship's upgrades and the run's ratchets (see
   *  run.ts's levelForRun) — so a multiplier here compounds on the rig the
   *  player actually built, which is the same reading a Contract's multipliers
   *  take. */
  apply(cfg: LevelConfig): void;
}

/* ---------------------------------------------------------------------------
 * TIER 1 — REACTOR OUTPUT. The books.
 *
 * The money Tier: hazards.ts opens Fuel Levy and Shift Cut at Mark 1, and
 * upgrades.ts's refitTracks sells ONLY the Reactor at Mark 1 because "tier 1 is
 * the tier the game teaches its economy on". So the exam is the quota, read
 * from its two sides — the Reactor pays a float AND a rate, and these two
 * clauses attack one each.
 *
 * SIZED, not guessed, and the sizing is the interesting part.
 *
 * Tier 1's bay 10 opens at targetScore $1500, pays scorePerLine $190 and prices
 * a launch at $20, against a $160 float (eight shots — LAUNCH_BUDGET_SHOTS x
 * launchCostFor) plus at most run.ts's $150 carry. At the measured ~2.9
 * launches per line (contracts.ts's PLANNING_EFFICIENCY) a line grosses $190
 * and costs $58 to make, so it nets $132 and the bay needs
 * (1500 - 310) / 132 = 9.0 lines. Price both clauses in that unit — extra lines
 * the bay demands — across the rigs that actually arrive at bay 10 (the Reactor
 * pays +$60 float and +$15 a line per tier, and a clause's apply runs AFTER the
 * ship's upgrades, so the rate cut bites the boosted rate):
 *
 *              stock      Reactor 2    Reactor 3
 *   baseline    9.0        6.6          5.7
 *   Rush Order +5.7       +4.6         +4.2
 *   Rate Cut   +3.6       +2.5         +2.1
 *
 * The mechanism the pair is built on is unchanged. A flat raise costs a fixed
 * amount of revenue, so its price in lines FALLS as your rate rises; a
 * percentage cut costs a share of everything you earn, so its price falls too,
 * but faster. Where the two cross, the flat raise is the cheaper poison below
 * and the percentage above, and the clause a player should take is a direct
 * readout of how good their rate actually is — the question the Reactor track
 * has been asking them all run. That is what the pair is FOR.
 *
 * BUT THERE IS NO CROSSING ON THE SHIPPED BAY, and re-deriving both bays says
 * there never was one in shipped code — this is a sizing bug that predates the
 * tier ladder, not something #88 took away. The pair was sized on the PRE-#88
 * bay, measured with sim/_finalprobe.ts (a throwaway, deleted) against the flat
 * $1700 / $190 / $25 / $200 bay the tier ladder replaced: there a line netted
 * $117.50, the bay needed 11.5 lines, and the table read baseline 11.5 / 8.3 /
 * 7.2, Rush Order +6.4 / +5.1 / +4.6, Rate Cut +7.7 / +5.0 / +4.1 — crossing at
 * the mid-track Reactor, which is what a bay-10 rig typically carries. But that
 * Rate Cut row only reproduces at a 25% cut, which on that bay gives 7.66 /
 * 4.96 / 4.10. RATE_CUT is 0.2 and has been 0.2 in every revision since the
 * constant was first committed, and at 0.2 the same bay reads +5.5 / +3.5 /
 * +2.9 against Rush Order's +6.4 / +5.1 / +4.6 — the percentage cheaper at
 * EVERY rig, so no crossing on the old bay either. The crossing is an artifact
 * of a rate the game has never run.
 *
 * What #88 changed is the size of the gap, not its sign. Tier 1's cheaper shot
 * lifts every rig's net per line and its lighter quota cuts the baseline line
 * count; Rate Cut, being a share of the lines the bay sells, is shrunk by both,
 * where a flat $750 only feels the first — so the old bay's spread of 0.9 / 1.5
 * / 1.7 lines becomes about 2.1 at every rig in the table above. The flat raise
 * is the dearer poison at EVERY rig, and was before the ladder landed too, so
 * the pair has a right answer. TODO: re-size it — and re-derive at each Tier's
 * own bay 10, since the ladder moves the bay under it now — before this pair is
 * described as crossing again. Note which way: Rush Order is the DEARER clause
 * everywhere, so a crossing needs it CHEAPER than Rate Cut on a thin rig and
 * dearer on a fat one — on Tier 1's table above, a quota worth less than Rate
 * Cut's +3.6 lines cost a stock rig (3.6 x $132 net ≈ $475) and more than its
 * +2.1 cost a maxed Reactor (2.1 x $177 ≈ $370), i.e. roughly $370-$475, far
 * under anything RUSH_ORDER_QUOTA has shipped at. Deepening RATE_CUT is the
 * other lever — 0.3 puts a crossing between stock and Reactor 2 on this bay.
 * Both are line-model arithmetic; neither has been played.
 *
 * $750 rather than the $1000 this was first sketched at, for that same reason:
 * at $1000 Rush Order cost +8.5 lines on a stock rig and +6.1 on a maxed
 * Reactor, against Rate Cut's +7.7 and +4.1 — the percentage won at EVERY rig,
 * the crossing fell off the bottom of the table, and a pair with a right answer
 * is not a pair. Those Rate Cut figures are the 25% column again, and only at
 * 25% did $750 put the crossing back inside the range real rigs occupied on
 * that bay. At the shipped 0.2, where the same bay's Rate Cut column is +5.5 /
 * +3.5 / +2.9, cutting $1000 to $750 narrowed the percentage's lead from about
 * 3 lines at every rig to 0.9-1.7 and never closed it. The $1000 verdict holds
 * at either rate; the claim that $750 fixed it holds only at 25%. Re-derive if
 * scorePerLine, the launch price or the Reactor track move; this number is only
 * meaningful relative to them.
 * ------------------------------------------------------------------------- */

/** Quota added by Rush Order. Named because the card copy interpolates it and
 *  the arithmetic above quotes it. (This shipped as 800 for a while — a slip,
 *  never a re-sizing: the sizing note above and its original table were always
 *  computed at $750, which on that pre-#88 bay was +6.4 stock = 750/117.5. The
 *  note that $800 slid the crossing off the mid-track Reactor is true only of
 *  the 25% column that crossing lives in; at the shipped RATE_CUT of 0.2
 *  neither $750 nor $800 crosses at any rig on that bay. On Tier 1's shipped
 *  bay the same $750 is +5.7 = 750/132 — and, as the note above records, there
 *  is no crossing there either, and never has been.) */
export const RUSH_ORDER_QUOTA = 750;
/** Share of each line's payout Rate Cut withholds. */
export const RATE_CUT = 0.2;

/* ---------------------------------------------------------------------------
 * TIER 2 — LAUNCHER COILS. The weather.
 *
 * Tier 2 opens Crosswind and the full refit menu, and the Launcher is the
 * sanctioned answer to weather: more muzzle speed to throw through it, plus a
 * stabilizer that cancels part of it outright (upgrades.ts). Every ordinary bay
 * ROLLS its prevailing wind uniformly in [-windMax, +windMax], so the average
 * bay blows at half the cap and its direction is the seed's business. The
 * inspection takes both of those away: the wind is pinned at the cap, and the
 * player picks the sign.
 *
 * MEASURED (a throwaway probe over the real Game, bay 10, windLock ±1 against
 * calm, one shipment fired per cell of the table, landing x of its furthest
 * cube):
 *
 *                        stock coils            Launcher tier 3
 *   deep  35°, full      1260 -> 1210 / 1253    1149 -> 1243 / 1162
 *   lob   45°, full      1258 ->  821 / 1242    1239 -> 1250 / 1152
 *   soft  35°, min        559 ->  388 /  785     621 ->  549 /  733
 *
 * Two readings, and they are the whole design of this pair:
 *
 *  - A HEADWIND takes the DEEP end away from a high arc — a 45° lob loses 437px
 *    of reach on stock coils, a third of the bay — while a flat, fast shot
 *    punches through almost untouched (-50px). It is answered by BOTH halves of
 *    the Launcher: the stabilizer cancels it and the coils throw through it.
 *  - A TAILWIND takes the NEAR end away. A minimum-power placement lands 226px
 *    deeper than it was aimed, so nothing can be set down short and everything
 *    is shoved toward the wall and the press. Only the stabilizer answers it —
 *    the coils make it WORSE, because cannon.ts scales speedMin as well as
 *    speedMax, so a maxed Launcher's gentlest shot is 18% faster and drops even
 *    further from where it was aimed.
 *
 * Same magnitude, opposite sign, and the ship answers them asymmetrically: a
 * player who bought the coils for reach should take the headwind and a player
 * who bought them for the stabilizer can take either. Neither is a lose button —
 * the deep slots stay reachable at full power under a full headwind (1210px
 * against a min-line stop at 960px).
 * ------------------------------------------------------------------------- */

/** Tier 3 — SWEEPER DETAIL, split back into the two halves the notch fuses.
 *
 *  hazards.ts's Sweeper Detail moves press speed and bay width together, and
 *  says why: speed alone measured HARMFUL (it pushes pieces out before they
 *  settle and the lost-piece penalty drains the bankroll erratically), so it is
 *  paired with the tighter bay that makes the faster sweep a real deadline. The
 *  inspection has the opposite job — it wants a fork, not a balanced notch — so
 *  it deals the two halves as separate cards, each answered by a different
 *  track: the press by Press Hydraulics, the room by Bay Extension.
 *
 *  The narrowing is stated as a SUBTRACTION rather than an absolute width for
 *  exactly the reason Bay Extension exists: a clause that squeezed every bay to
 *  the same number of cells would delete the track's whole purchase, where -2
 *  leaves a refitted bay wider than a stock one was to begin with. It is
 *  floored at minLineCells + 1 for compactor.ts's stated reason — at equality
 *  the two stops are the same X and the press has zero travel. */
export const DOUBLE_SHIFT_SPEED = 2;
export const TIGHT_GAUGE_CELLS = 2;
/** What one cell the sweeper floor refuses is worth in congestion headroom
 *  instead — one Bay Extension tier's grant (upgrades.ts adds +4 a tier), so a
 *  clause the floor blocks outright undoes a whole tier of the track it
 *  names rather than fizzling. */
const TIGHT_GAUGE_ALLOWANCE_PER_CELL = 4;

/* ---------------------------------------------------------------------------
 * TIERS 4-9 — THE MATERIALS, and the one rule that shapes all six pairs.
 *
 * Every Tier from 4 up opens one material axis (hazards.ts's ladder), so the
 * obvious exam is "a lot of that material" — and that is exactly ONE of each
 * pair, never both. A pair of two rates at two sizes is not a choice, it is a
 * slider with a card frame around it.
 *
 * So each of these pairs is TWO POLES of the property the material is about,
 * with the comfortable middle taken away — the same shape as the wind fork,
 * generalised. Rebar is the clearest case: the material's whole identity is
 * "this does not come apart", so its inspection is a flood of cargo that never
 * breaks against a bay where everything breaks. Both are bad, in opposite
 * directions, and the middle — cargo that breaks when you want it to — is the
 * thing the player has spent the run learning to work with.
 *
 * MATERIAL RATES ARE RE-CAPPED AFTER THE CLAUSE LANDS — see applyFinal at the
 * bottom of this file. The first draft of this header argued the opposite
 * ("an inspection writes ONE material at ONE rate on ONE bay, so the failure
 * is not reachable"), and the worst arrival a run can actually construct
 * proved it wrong: every notch poured into the materials the clause does NOT
 * write left the mix already at hazards.ts's MIX_TOTAL_CAP when the clause
 * arrived, and Powder Run pushed the belt to 0.78. applyFinal now re-caps to
 * MIX_TOTAL_CAP, holding the clause's own material at the rate its card
 * quotes and taking the reduction out of the ratcheted ones; sim/systems.ts
 * pins the total at the cap on that same worst arrival. The other half of
 * hazards.ts's note still binds here too ("every shipment is a hazard is not
 * a hard bay, it is an unplayable one"): no rate below goes past 0.45.
 * ------------------------------------------------------------------------- */

/** The salvage pile a wall clause opens the bay holding, as pieces.ts's column
 *  profile: cells filled in slot column k, counted up from the floor, k from
 *  the wall outward.
 *
 *  Eleven cubes, uneven, with two columns left EMPTY. The gaps are the point —
 *  they are the shafts the player can still shoot into, and without them the
 *  wall is a flat lid that says "these rows are gone" rather than a pile that
 *  says "dig". Uneven for the same reason contracts.ts's salvageProfile is: a
 *  wall that reads as someone else's abandoned work is a puzzle, and a
 *  rectangle is a wall.
 *
 *  Eleven also matters to congestion. level.ts's PILE_TIERS taxes a launch
 *  once the field holds more than 32 live cubes, and a standing wall counts —
 *  so a bay that opens on this pile opens about a third of the way to the
 *  first knee, and every launch all bay is priced closer to it. That is a real
 *  second cost the card does not have to state, and Bay Extension's
 *  pileAllowance is exactly what buys it back. */
const SALVAGE_PROFILE: readonly number[] = [2, 2, 2, 0, 2, 2, 1, 0];

/** Cubes Fouled Bay pulls off every congestion knee (level.ts's PILE_TIERS,
 *  which sit at 32 and 48 live cubes on the field).
 *
 *  12 is sized against the thing it is the mirror of: Bay Extension buys +4 per
 *  tier, so this clause is worth three tiers of that track in the other
 *  direction, and a rig that maxed the Bay walks into the final bay with the
 *  knees back where they started. Deliberately a number the card can quote,
 *  because congestion is the one pressure a player can otherwise only discover
 *  by paying it. */
const FOULED_ALLOWANCE = 12;

/**
 * Schedule `rate` of `material` on the belt — as a FLOOR, never as an
 * assignment.
 *
 * Found in review. Every one of these clauses used to write its rate straight
 * in, and a run that had ratcheted the SAME material deeper than the clause
 * asks for then had its ratchet partly refunded by the card that was supposed
 * to cost it something. Reproduced on arrivals a run can actually reach: at
 * six cryo notches a Tier-4 bay enters the inspection at 0.32, and Cold Chain
 * — whose apply does nothing else — took it to 0.22. The mandatory final cost
 * made the bay strictly easier. Slag Run 0.32 -> 0.17, Tar Run 0.32 -> 0.18
 * and Hair Trigger 0.32 -> 0.20 all did the same.
 *
 * A floor is the right shape rather than a sum: the clause states the belt a
 * bay of this Tier is flown with, and a run that already chose worse keeps
 * what it chose. Adding instead would double-charge the axis the player
 * ratcheted, which is the opposite error and a harder one to see coming.
 *
 * A floor ALONE is not enough, though, and the harness found the other half:
 * materialRate saturates at MATERIAL_CAP (0.32) by the sixth notch, so a run
 * that ratcheted its way there met a clause that simply did nothing — the
 * refund became a no-op, which is the same failure wearing a different coat.
 * A mandatory cost that can be pre-paid by the player's own earlier choices is
 * not a cost.
 *
 * So the rule is BOTH: at least the rate on the card, and always at least one
 * ratchet notch worse than the bay arrived. MATERIAL_CAP is a rail on the
 * RATCHET — "however many notches are stacked on it" — and a clause is not a
 * notch, so passing it here is in keeping rather than a loophole; FINAL_CAP
 * keeps the single material sane, and applyFinal's re-cap still holds the belt
 * as a whole to MIX_TOTAL_CAP.
 *
 * THE CARD COPY SAYS "AT LEAST", because the rule above means the number on it
 * is a floor and not a quantity. An earlier version of this note argued the
 * bare number was still honest, on the grounds that the draft's own material
 * row prints the resulting rate — but the card is what the player reads while
 * deciding, and "8% of the belt" is a promise about the bay they are being
 * sold. A run carrying two Slag notches meets Slag Wall's 8% card and gets a
 * belt at 12%: not the rate quoted, and worse in the direction that matters.
 * Naming it a floor costs two words and makes the card true on every arrival.
 * sim/systems.ts pins this: a clause whose delivered rate can exceed its own
 * clean-bay rate must say so on its face.
 */
/**
 * The most of one material a SCHEDULED clause may leave on the belt, ratchet
 * included.
 *
 * THE WHOLE BELT, down from a flat 0.4 — and both halves of that are
 * MIX_TOTAL_CAP's move. With the total ceiling now at one shipment in three
 * (hazards.ts, belt.ts), 0.4 would have let a scheduled clause alone exceed
 * the belt: applyFinal's re-cap would zero every ratcheted material to make
 * room and the final bay would still land ABOVE the ceiling, which is the one
 * place belt.ts's spacing rule stops applying — so a bay never asked to be
 * dense would have been the only ratcheted one that could deal three
 * materials in a row.
 *
 * Held EQUAL to the belt rather than a hair under it because of the invariant
 * sim/systems.ts pins: no ratchet may silently eat a clause. hazards.ts's
 * MATERIAL_CAP is 0.32, so a run that poured six notches into one material
 * arrives at a Final already there — and a clause capped below that has nothing
 * left to add, making a MANDATORY cost the player chose over another one cost
 * nothing at all. At the ceiling it still has the last sliver, which is small
 * but real, and it is the honest amount: the belt is full.
 *
 * A clause is still not a notch. What it buys over one is reaching the top in a
 * single step instead of six, and reaching it on a material the run never
 * ratcheted — the ceiling bounds how MUCH, never which.
 *
 * The capstone's FULL-BELT pair reads it differently, and one of the two not
 * at all. Odd Lots states the whole belt (total 1 — belt.ts's authored case,
 * where the spacing rule deliberately stands down) and uses this as its
 * PER-MATERIAL ceiling, so the cargo that can never count (slag — theme.ts's
 * countsForLines) stays a minority of a belt with no standard majority left
 * to dilute it. Full Rebar is the one deliberate exception and does not read
 * it: rebar counts for lines and refuses only to SPLIT, so a belt of it stays
 * playable — the Full Rebar Contract (contracts.ts) and the mat-rebar drill
 * already ship exactly that belt at rate 1.
 */
export const FINAL_MATERIAL_CAP = MIX_TOTAL_CAP;
function schedule(
  cfg: LevelConfig,
  material: keyof LevelConfig["materialMix"],
  rate: number,
): void {
  const had = cfg.materialMix[material] ?? 0;
  const bumped = Math.min(FINAL_MATERIAL_CAP, had + MATERIAL_NOTCH);
  cfg.materialMix = { ...cfg.materialMix, [material]: Math.max(rate, bumped) };
}

export const FINALS: FinalDef[] = [
  // -- Tier 1 · Reactor Output -------------------------------------------
  {
    id: "rush-order",
    name: "Rush Order",
    desc: `The bay's funding target rises by $${RUSH_ORDER_QUOTA}. Same rate, more of it.`,
    tier: 1,
    system: "reactor",
    apply: (cfg) => { cfg.targetScore += RUSH_ORDER_QUOTA; },
  },
  {
    id: "rate-cut",
    name: "Rate Cut",
    desc: `Every line pays ${Math.round(RATE_CUT * 100)}% less. Same target, worse money.`,
    tier: 1,
    system: "reactor",
    // Rounded, not floored: scorePerLine is quoted to the player as a whole
    // dollar figure everywhere it appears (the HUD, preview.ts's projection),
    // and a rate carrying cents would print one number and pay another.
    apply: (cfg) => { cfg.scorePerLine = Math.round(cfg.scorePerLine * (1 - RATE_CUT)); },
  },

  // -- Tier 2 · Launcher Coils -------------------------------------------
  {
    id: "head-gale",
    name: "Head Gale",
    desc: "A dead-steady gale straight into the muzzle, pinned at the bay's cap all shift. No roll, no gust, no let-up.",
    tier: 2,
    system: "launcher",
    apply: (cfg) => {
      cfg.windLock = -1;
      // Gustless, and that is the half that makes this the FAIR one. A headwind
      // is a bias, and a bias is trimmable: hold for it once and every shot
      // after it lands where you aimed. What the clause takes is REACH, not
      // predictability — the probe measured a 45-degree lob losing 437px of it
      // on stock coils while a flat, fast shot lost 50. So it is the clause a
      // player answers by buying muzzle speed, and by giving up the high arc.
      cfg.windGust = 0;
    },
  },
  {
    id: "tail-gale",
    name: "Tail Gale",
    desc: "A gale dead astern, pinned at the bay's cap and gusting three times as hard. Nothing lands short, and nothing lands twice in the same place.",
    tier: 2,
    system: "launcher",
    apply: (cfg) => {
      cfg.windLock = 1;
      // Three times the gust, and it is a DESIGN judgement rather than a
      // measured equaliser — the distinction matters, because this comment
      // used to claim the second thing on the strength of an 8-seed reading
      // that a 20-seed one does not support (the pair went 75/75 at eight
      // seeds and 70/90 at twenty). The bot cannot arbitrate this clause at
      // all: a tailwind's cost is that nothing can be set down SHORT, and a
      // bot that always aims deep never wanted to. See the header's third
      // group.
      //
      // What stands on its own is the mechanism. A bias is trimmable — hold
      // for it once and every shot after lands where you aimed — so a pinned
      // tailwind alone mostly relocates the bay rather than shrinking it. The
      // gust is what makes it a cost: measured, a minimum-power placement
      // already lands 226px deeper than aimed, and 3x takes the stationary
      // spread from ~10.6% of windMax to ~32%, about a cell of scatter a shot
      // at bay 10's cap. The bias you can hold for; the noise you cannot.
      //
      // The stabilizer is the only thing that answers it (game.ts's windNow
      // applies windAssist to the LIVE wind, gust included), which is the half
      // of the Launcher track the headwind clause does not ask about.
      cfg.windGust = cfg.windMax * WIND_GUST_FRACTION * 3;
    },
  },

  // -- Tier 3 · Bay Extension / Press Hydraulics -------------------------
  {
    id: "double-shift",
    name: "Double Shift",
    desc: `The press runs at ${DOUBLE_SHIFT_SPEED}× speed. Half the window to land in, twice the strokes to sell into.`,
    tier: 3,
    system: "hydraulics",
    apply: (cfg) => { cfg.compactorSpeed *= DOUBLE_SHIFT_SPEED; },
  },
  {
    id: "tight-gauge",
    name: "Tight Gauge",
    desc: `The bay gives up ${TIGHT_GAUGE_CELLS} open cells. Same line to fill, less room to build it in.`,
    tier: 3,
    system: "bay",
    apply: (cfg) => {
      // The floor is compactor.ts's, not a choice: at openCells ==
      // minLineCells the press has zero travel and never moves again, so a
      // cell of stroke has to survive (hazards.ts's Sweeper note measured
      // exactly that — 0px of travel, 300 strokes in 600 steps).
      //
      // What the floor must NOT do is silently eat the clause. Found in
      // review: a run that has taken three Sweeper notches arrives at the
      // floor already, and Tight Gauge — a MANDATORY cost the player picked
      // over Double Shift — then changed nothing at all. Reproduced at
      // sweeper x3 and deeper on Tier 3, and Sweeper is offered often enough
      // to get there (seed 0 deals it at five of the first eight drafts).
      //
      // So whatever the floor refuses is taken out of the Bay track's OTHER
      // half instead. Bay Extension sells room and congestion headroom as one
      // purchase (upgrades.ts: "the same purchase read a second way"), which
      // is what makes the substitution honest rather than a consolation
      // prize — the clause still costs exactly the system it names. Sized at
      // one Bay tier's worth of allowance per cell the floor kept back, so a
      // fully blocked clause is a whole tier of the track undone.
      const floor = cfg.compactorMinLineCells + 1;
      const took = Math.max(0, Math.min(TIGHT_GAUGE_CELLS, cfg.compactorOpenCells - floor));
      cfg.compactorOpenCells -= took;
      // Negative is meaningful and intended: game.ts reads
      // `n > tier.cubes + pileAllowance`, so below zero the tax simply bites
      // earlier than stock, the same direction Fouled Bay pushes it.
      cfg.pileAllowance -= TIGHT_GAUGE_ALLOWANCE_PER_CELL * (TIGHT_GAUGE_CELLS - took);
    },
  },

  // -- Tier 4 · Bay Extension (where the ice waits) ----------------------
  //
  // Cryo's rule is that a cube counts for nothing until something fast hits it
  // while it is at rest, and that the press SHATTERS one that reaches the bar
  // still cold — taking its row's neighbours with it (lineClear.ts's
  // shatterColdCryo). So the material's real question is "where does the ice
  // wait": every frozen cube is cargo you have to park somewhere out of the
  // bar's reach until you can spend a shot on it, and room is what you park it
  // in. Hence the Bay.
  {
    id: "cold-chain",
    name: "Cold Chain",
    desc: "At least 22% of the belt arrives frozen. Every frozen cube owes you a strike before it counts for anything.",
    tier: 4,
    system: "bay",
    apply: (cfg) => { schedule(cfg, "cryo", 0.22); },
  },
  {
    id: "ice-wall",
    name: "Ice Wall",
    desc: "The bay opens on 11 cubes of frozen salvage nobody thawed, and at least 16% of the belt arrives the same way.",
    tier: 4,
    system: "bay",
    apply: (cfg) => {
      // Written rather than appended: an inspection is the only thing that puts
      // a wall in a Deep Run bay, so there is never an existing profile to
      // merge with, and a merge would make the clause's size a function of
      // something the card cannot state.
      cfg.standingWall = [...SALVAGE_PROFILE];
      cfg.standingWallMaterial = "cryo";
      schedule(cfg, "cryo", 0.16);
    },
  },

  // -- Tier 5 · Bond Emitter (does cargo come apart) ---------------------
  //
  // Rebar is the material that refuses to split, and a Bond Breaker is
  // deliberately the ONLY thing that splits it (theme.ts's MATERIAL_SPEC:
  // "that is what gives the Bond Emitter track a job that isn't cosmetic").
  // Two poles, then: a bay where nothing comes apart, and a bay where
  // everything does.
  {
    id: "rebar-run",
    name: "Rebar Run",
    desc: "At least 32% of the belt is rebar. What lands is what you keep — nothing but a Bond Breaker will split it.",
    tier: 5,
    system: "bonds",
    apply: (cfg) => { schedule(cfg, "rebar", 0.32); },
  },
  {
    id: "cold-weld",
    name: "Cold Weld",
    desc: "Nothing on this field comes apart on its own — no landing and no press stroke will break a shipment. Only a Bond Breaker will.",
    tier: 5,
    system: "bonds",
    // Infinity is the same value level.ts already gives the capstone bay
    // (UNBREAKABLE_MARK), reached one Tier at a time instead of all at once,
    // and lineClear.ts's breakJointsInBand already exempts it — the rebar rule.
    // A Bond Breaker still splits it (game.ts's useBondBreaker breaks every
    // joint that is not a tar weld, whatever its stretch), which is exactly
    // what makes this the Bond Emitter's exam rather than a wall.
    apply: (cfg) => {
      cfg.jointBreakStretch = Infinity;
      // …and the Seam Splitter has to be stood down for the bay, or the clause
      // is a lie on a rig that bought it. pieces.ts deliberately restates a
      // FINITE base (WEAK_BOND_UNBREAKABLE_BASE) for a weakened type when the
      // bay's own stretch is not finite — Infinity x 0.7 is still Infinity, so
      // without that fallback the passive would do nothing on an unbreakable
      // bay. That fallback is right where the unbreakable format is something
      // the LADDER imposed (level.ts's UNBREAKABLE_MARK): the player never
      // chose it, and the passive they paid for should survive it.
      //
      // Here it is backwards. This bay is unbreakable because the player read a
      // card that says "nothing comes apart on its own" and signed it, and the
      // projection prints "unbreakable" on the strength of that. Leaving the
      // stamp up would ship an S and a Z that split on landing at a threshold
      // of 1.54 — more fragile than anything else in the bay — while the card
      // and the tile both claim otherwise. A passive that sleeps for one
      // accepted bay is a smaller cost than a card that does not mean what it
      // says, and the Bond Emitter still answers this clause the way the Tier
      // is about: with a charge.
      cfg.weakBondTypes = [];
      cfg.weakBondMult = 1;
    },
  },

  // -- Tier 6 · Demolition Rack (where the dead metal is) ----------------
  //
  // Slag is the one material with no passive counter — a dead cube leaves the
  // field by Demolition or not at all (hazards.ts says so twice, and orders its
  // own ladder around it). Two poles of where that dead metal comes from: down
  // the belt, or already in the bay when you get there.
  {
    id: "slag-run",
    name: "Slag Run",
    desc: "At least 17% of the belt is dead metal. It fills a slot, it never counts, and only a charge moves it.",
    tier: 6,
    system: "demolition",
    apply: (cfg) => { schedule(cfg, "slag", 0.17); },
  },
  {
    id: "slag-wall",
    name: "Slag Wall",
    desc: "The bay opens on 11 cubes of somebody else's slag, stacked against the wall, and at least 8% of the belt adds to it.",
    tier: 6,
    system: "demolition",
    apply: (cfg) => {
      cfg.standingWall = [...SALVAGE_PROFILE];
      cfg.standingWallMaterial = "slag";
      schedule(cfg, "slag", 0.08);
    },
  },

  // -- Tier 7 · Bay Extension (how hard you may land it) -----------------
  //
  // Volatile goes off above a landing speed, and lineClear.ts measured where:
  // first-contact speeds run 17.3 to 30.8 across everything the cannon can do,
  // and the stock threshold of 22 sits between the two halves of the power
  // dial, so a lob survives and a hard shot does not. Its cost also lands on
  // cubes that were ALREADY safely down, which is what makes it scale with how
  // full the bay is — so room is the answer, and the two poles are "how often
  // does it arrive" against "how gently must it land".
  {
    id: "powder-run",
    name: "Powder Run",
    desc: "At least 27% of the belt is volatile. Land one hard and it takes its neighbours with it.",
    tier: 7,
    system: "bay",
    apply: (cfg) => { schedule(cfg, "volatile", 0.27); },
  },
  {
    id: "hair-trigger",
    name: "Hair Trigger",
    desc: "At least 20% of the belt is volatile, primed 15% finer — at this setting only the softest lob will not set it off.",
    tier: 7,
    system: "bay",
    apply: (cfg) => {
      schedule(cfg, "volatile", 0.2);
      // 0.85 of the stock 22 is 18.7, just above the 17.3 floor of every
      // launch the cannon can produce — so a minimum-power lob still survives
      // and everything above it does not. Below ~0.79 the floor is crossed and
      // the material stops being something the player can land at all, which
      // would make it a lose button rather than a demand for restraint.
      cfg.volatileTriggerMult = 0.85;
    },
  },

  // -- Tier 8 · Demolition Rack (how much of the pile fuses) -------------
  //
  // Tar is the joint that cannot be broken at all — not by stretch, and not by
  // a Bond Breaker. lineClear.ts names avoidance as the real answer and
  // Demolition as the expensive one, since vaporizing a cube takes its welds
  // with it. Both clauses attack the same thing from opposite ends: what it
  // takes to close a row. One fouls the cargo, the other lengthens the row.
  {
    id: "tar-run",
    name: "Tar Run",
    desc: "At least 18% of the belt is tar. It welds to whatever it touches and a Bond Breaker will not split it.",
    tier: 8,
    system: "demolition",
    apply: (cfg) => { schedule(cfg, "tar", 0.18); },
  },
  {
    id: "fouled-bay",
    name: "Fouled Bay",
    // 12%, said as 12% — the sibling clause's grammar. This used to read
    // "1 shipment in 8", which is 12.5% against a schedule floored at 0.12:
    // the one card in the module whose quoted floor the bay didn't deliver.
    desc: `At least 12% of the belt is tar, and the yard books a fused pile as clutter: congestion bites ${FOULED_ALLOWANCE} cubes earlier all shift.`,
    tier: 8,
    system: "demolition",
    apply: (cfg) => {
      schedule(cfg, "tar", 0.12);
      // NEGATIVE allowance — the same seam Bay Extension buys in the other
      // direction (game.ts reads `n > tier.cubes + pileAllowance`, so a
      // negative number pulls every knee toward the player). Tar is the reason
      // it is the right cost here: a fused pile is exactly clutter that cannot
      // be cleared by playing well, and the only thing that removes it is a
      // demolition charge — which also drops the cube count that is being
      // taxed. One purchase, both halves.
      cfg.pileAllowance -= FOULED_ALLOWANCE;
    },
  },

  // -- Tier 9 · Press Hydraulics (who squares the pile up) ---------------
  //
  // Tier 9 opens MAGNETIC, and magnetic is the one material that HELPS: it
  // snaps itself square onto the slot grid as it settles, which is the press's
  // own job done by the cargo. So this Tier's exam is not the material — a
  // flood of a boon is a gift, not an inspection — it is the SYSTEM the
  // material impersonates. Press Hydraulics sells two things, settle assist and
  // stroke speed, and these two clauses take one each: a press that no longer
  // squares anything, or a press that squares as well as ever and comes round
  // less than half as often.
  {
    id: "bled-hydraulics",
    name: "Bled Hydraulics",
    desc: "The press barely squares anything up: settle assist runs at 35%. A near-miss mostly stays a near-miss.",
    tier: 9,
    system: "hydraulics",
    apply: (cfg) => { cfg.settleAssist *= 0.35; },
  },
  {
    id: "haulage-bond",
    name: "Haulage Bond",
    desc: "The yard bills spillage at 3× tonight. Every shipment the press shoves out of the bay costs treble.",
    tier: 9,
    system: "hydraulics",
    // The press's OTHER output, and the one a slack press produces most of: a
    // pile that will not square up is a pile that gets shoved past the open
    // stop, where lineClear.ts's markLostPieces decays it for
    // penaltyPerLostPiece. So this is the same system read from its
    // consequences instead of its settings, and a stronger assist is what buys
    // it back.
    //
    // It replaced a slow-press clause that MEASURED FREE: at a quarter speed
    // the aim bot still cleared 14.5 lines against a 12.5-line baseline and
    // won every seed, because a bay finishes in well under its clock (level.ts
    // records runs of 41-67s against pre-ladder limits of 150s+; the shipped
    // clock is 180s at Tier 1 down to 144s at Tier 10, still twice the longest
    // run measured) and strokes were never the binding constraint. A clause
    // nobody pays is not half of a fork.
    apply: (cfg) => { cfg.penaltyPerLostPiece = Math.round(cfg.penaltyPerLostPiece * 3); },
  },

  // -- Tier 10 · Bond Emitter (what the cargo is) ------------------------
  //
  // The capstone opens no axis of its own — it asks for two notches a bay and
  // sends bay 10's bonds to Infinity (level.ts's UNBREAKABLE_MARK), which makes
  // the Bond Breaker the only shatter in the bay. So its inspection is about
  // the cargo itself, with the standard shipment — the thing every run is
  // built around — taken away. Nothing standard ships past the final gate.
  //
  // BOTH CLAUSES LEAVE THE SHIPMENT SIZE ALONE, and that is the design change
  // this pair replaced its predecessor over. The retired fork dealt the two
  // ends of pieces.ts's SIZE_SPEC — every shipment a domino at 0.6x a launch,
  // or a pentomino at 1.5x — and once the money was equalised (which those
  // launch multipliers existed to do), what remained was an exam about the
  // cannon's unit economics: launches per line, priced per cube. Nine Tiers
  // of ladder teach nothing about that. What they teach, one axis at a time,
  // is the material catalogue — and the capstone's own format (the
  // unbreakable bay) is rebar's rule written over the whole field. So the
  // exam is the cargo at its two poles, with the comfortable middle — a belt
  // that is mostly standard — taken away:
  //
  //  - ODD LOTS is the whole ladder at once. All six materials, nothing
  //    standard: every shipment arrives demanding the answer some Tier spent
  //    ten bays teaching — strike the cryo, charge the slag, lob the
  //    volatile, dodge the tar, split the rebar, welcome the magnetic. No
  //    single demand is deep (each sits near a sixth of the belt, held under
  //    FINAL_MATERIAL_CAP on every arrival); the cost is that they never
  //    stop coming, which is the one shape of hard no single Tier could deal.
  //  - FULL REBAR is the capstone made literal, one material deep. The bay's
  //    joints are already Infinity; now the cargo is the material that rule
  //    belongs to, so what lands is what you keep, everywhere — and the Seam
  //    Splitter's carve-out (pieces.ts keeps weakened types finite on a
  //    ladder-imposed unbreakable bay) is gone with it, because rebar's
  //    rigidity outranks the passive by that file's own rule. One row
  //    misbuilt is one row owed to the Bond Breaker magazine, which is
  //    exactly the "spend it where it counts most" exam level.ts says the
  //    capstone is.
  //
  // Both are the Bond Emitter's exam — on this bay a charge is the only thing
  // that unmakes a mistake, whichever card is signed. UNMEASURED by the aim
  // bot, said plainly rather than implied: the header's three groups show a
  // material flood collapses it (-45 to -70) while a placement demand reads
  // free, so it can rank neither pole against the other — Odd Lots would read
  // as its slag share and Full Rebar as nothing at all. What CAN be stated is
  // sizing against the ladder: Odd Lots holds every material at or under
  // rates the ratchet already deals routinely, and Full Rebar's belt is the
  // Full Rebar Contract's own rate-1 belt (contracts.ts) flown on the bay
  // whose format already matches it. Which pole is cheaper is legible from
  // the rig — a Demolition/Bay ship eats Odd Lots' variety, a deep Bond
  // Emitter magazine eats Full Rebar's rigidity — and only a device playtest
  // can say more.
  {
    id: "odd-lots",
    name: "Odd Lots",
    desc: "Nothing standard ships tonight. The belt is all six special materials at once — and whatever the run already ratcheted runs deeper still.",
    tier: 10,
    system: "bonds",
    fullBelt: true,
    apply: (cfg) => {
      // Equal top-up, floored at the arrival: every material rises above what
      // the run walked in with (schedule()'s two rules — no refund, and no
      // pre-paying a mandatory cost — hold on every axis at once), and the
      // belt lands at exactly 1, so nothing standard ships. The top-up
      // respects FINAL_MATERIAL_CAP per material so it cannot pile the
      // remainder onto a deep-ratcheted axis: without the ceiling, a
      // slag-only arrival put slag at 0.43 of the belt — dead cargo at a
      // depth no card priced. Overflow past a capped material re-spreads to
      // the rest, and six materials at the 1/3 ceiling hold 2.0 of belt, so
      // the fill always lands at 1; MATERIAL_CAP (0.32) keeps every arrival
      // under the ceiling, so every material still strictly rises.
      const keys = Object.keys(cfg.materialMix) as Array<keyof LevelConfig["materialMix"]>;
      const mix = { ...cfg.materialMix };
      let leftover = 1 - keys.reduce((a, k) => a + mix[k], 0);
      let pool = keys.filter((k) => mix[k] < FINAL_MATERIAL_CAP);
      while (leftover > 1e-9 && pool.length) {
        const share = leftover / pool.length;
        leftover = 0;
        for (const k of pool) {
          const took = Math.min(share, FINAL_MATERIAL_CAP - mix[k]);
          mix[k] += took;
          leftover += share - took;
        }
        pool = pool.filter((k) => mix[k] < FINAL_MATERIAL_CAP - 1e-9);
      }
      cfg.materialMix = mix;
    },
  },
  {
    id: "full-rebar",
    name: "Full Rebar",
    desc: "Every standard shipment arrives as rebar. Nothing you land comes apart on its own — a Bond Breaker charge is the only thing that will split it.",
    tier: 10,
    system: "bonds",
    fullBelt: true,
    apply: (cfg) => {
      // The standard share and no more: a ratcheted material keeps exactly
      // its arrived rate. Converting those to rebar too would refund the
      // run's own notches with the easiest cargo in the bay (rebar counts on
      // landing; cryo owes a strike first, slag never counts at all) — the
      // same bug schedule() exists to keep out, wearing the opposite coat.
      // hazards.ts holds the arrived mix to MIX_TOTAL_CAP, so rebar is never
      // handed less than the belt's majority remainder.
      const keys = Object.keys(cfg.materialMix) as Array<keyof LevelConfig["materialMix"]>;
      const others = keys.reduce((a, k) => a + (k === "rebar" ? 0 : cfg.materialMix[k]), 0);
      cfg.materialMix = { ...cfg.materialMix, rebar: Math.max(0, 1 - others) };
    },
  },
];

/** The pair dealt at the last draft of a run flying `tier`.
 *
 *  Clamped into the ladder at both ends rather than returning an empty hand: an
 *  offer of nothing reads to the player as a bug, and the top of the ladder is
 *  the honest answer for a Tier above it — sim/systems.ts pins that every Tier
 *  from 1 to MARK_COUNT deals exactly two, so a gap in the table fails there
 *  rather than at a player's last bay. */
export function finalsForTier(tier: number): FinalDef[] {
  const t = Math.max(1, Math.min(MARK_COUNT, Math.floor(tier)));
  const pair = FINALS.filter((f) => f.tier === t);
  return pair.length ? pair : FINALS.filter((f) => f.tier === highestTier());
}

/** The deepest Tier the table actually carries — derived so a half-filled table
 *  degrades to its own top rung instead of to a hardcoded number that a new
 *  pair would leave stale. */
function highestTier(): number {
  return FINALS.reduce((m, f) => Math.max(m, f.tier), 1);
}

export function finalById(id: string): FinalDef | undefined {
  return FINALS.find((f) => f.id === id);
}

/** Apply the accepted clause to the final bay's config, in place.
 *
 *  Unknown and null ids are no-ops, for the same forward-compatibility reason
 *  applyRatchets ignores unknown axes: a run in flight when a clause is renamed
 *  must still resolve to a playable bay rather than throwing on the last one.
 *
 *  Then the belt is RE-CAPPED, and that is not housekeeping — it closes a hole
 *  this module opened. hazards.ts enforces MIX_TOTAL_CAP inside applyRatchets
 *  and returns; run.ts's levelForRun calls this AFTERWARDS, so a material
 *  clause lands on a belt that is already at the cap and pushes straight
 *  through it. Measured on the worst arrival a run can actually construct —
 *  every notch poured into the materials the clause does NOT write, so the mix
 *  is already full when the clause arrives — Powder Run reached 0.78 of the
 *  belt. hazards.ts says exactly what that is: "every shipment is a hazard is
 *  not a hard bay, it is an unplayable one".
 *
 *  The scaling holds the CLAUSE'S OWN material at the rate its card quotes and
 *  takes the reduction out of the ratcheted ones. That asymmetry is deliberate
 *  and it is the whole reason this is not just a second call to the same
 *  helper: FinalDef.desc prints its rate as a promise the player accepted one
 *  screen ago, and scaling it would make the card lie about the bay it just
 *  sold them. A ratcheted material has no such promise attached — the ladder
 *  already reserves the right to scale it, and does. */
export function applyFinal(cfg: LevelConfig, id: FinalId | null): void {
  if (!id) return;
  const def = finalById(id);
  if (!def) return;
  const before = { ...cfg.materialMix };
  def.apply(cfg);

  // A full-belt clause states the whole belt itself: nothing standard ships,
  // its apply carries the no-refund floors, and the mix deliberately sums to
  // exactly 1. The re-cap below exists to keep a partial-belt clause from
  // overfilling a belt that still owes the player standard cargo; here there
  // is none to owe, and scaling would break the card's promise instead of
  // keeping it. sim/systems.ts holds these clauses to their own contract.
  if (def.fullBelt) return;

  const keys = Object.keys(cfg.materialMix) as Array<keyof typeof cfg.materialMix>;
  const total = keys.reduce((a, k) => a + cfg.materialMix[k], 0);
  if (total <= MIX_TOTAL_CAP) return;
  // What the clause itself raised is held; everything else absorbs the cut.
  const held = keys.filter((k) => cfg.materialMix[k] > before[k]);
  const heldSum = held.reduce((a, k) => a + cfg.materialMix[k], 0);
  const rest = keys.filter((k) => !held.includes(k));
  const restSum = rest.reduce((a, k) => a + cfg.materialMix[k], 0);
  // Room left for the ratcheted materials once the clause has taken its share.
  // Floored at 0 for the degenerate case of a scheduled clause that alone
  // exceeds the cap. No shipped one does: the largest scheduled rate, Rebar
  // Run's 0.32, lands a hair under the 1/3 ceiling and leaves the ratcheted
  // materials a sliver rather than nothing. (The full-belt pair exceeds it by
  // design and returned above this re-cap entirely.) A future scheduled
  // clause that did exceed it would clear the belt rather than go negative.
  const room = Math.max(0, MIX_TOTAL_CAP - heldSum);
  const scale = restSum > 0 ? room / restSum : 0;
  for (const k of rest) cfg.materialMix[k] *= scale;
}
