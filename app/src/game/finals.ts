import type { LevelConfig } from "./level";
import { WIND_GUST_FRACTION } from "./level";
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
 *    them — hazards.ts's ladder opens exactly one new axis per Tier, and
 *    upgrades.ts sells exactly the system that makes it cheap. The Final
 *    Inspection is that pairing asked as a question: Tier 1 taught the money
 *    axes and sold you the Reactor, so Tier 1's final bay is about money.
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
 * WHERE THE NUMBERS CAME FROM, and what is still open.
 *
 * Two instruments, because neither sees the whole bay. Both were run from
 * throwaway probes (deleted; re-derivable from this note) that built bay 10 at
 * each clause's OWN Tier against that Tier's full build budget — which matters:
 * at Tier 10 level.ts sends the bay's joints to Infinity, so a clause priced on
 * a Mark-1 bay is priced on a bay that does not exist.
 *
 *  1. THE LINE MODEL — contracts.ts's own launch budget (CUBES_PER_LINE over
 *     cubes a launch delivers times PLANNING_EFFICIENCY, discounted by
 *     MATERIAL_WASTE), converted to "extra lines the bay demands". Exact for
 *     money, cargo size, line width and the material mix. Blind to physics.
 *  2. THE aim BOT — 8 seeds a cell. The only thing that prices the press, the
 *     weather and the bay's shape. Blind to every ABILITY: sim/README.md says
 *     the bots never fire a Bond Breaker or a demolition charge.
 *
 *              modelled (extra lines)      aim bot (win% / lines)
 *   T1  Rush Order    +7.6   Rate Cut +7.7      75 / 15.3    75 / 12.9
 *   T2  Head Gale       —    Tail Gale   —      75 / 13.5    75 /  7.9
 *   T3  Double Shift    —    Tight Gauge —     100 /  9.1   100 / 11.9
 *   T4  Cold Chain    +1.1   Ice Wall  +0.8      0 /  3.3     0 /  6.1
 *   T5  Rebar Run     +1.2   Cold Weld   —      75 / 10.3    88 / 15.5
 *   T6  Slag Run      +1.5   Slag Wall +0.6      0 /  0.8     0 /  1.1
 *   T7  Powder Run    +3.2   Hair Trig +1.2     63 /  8.9    88 / 12.0
 *   T8  Tar Run       +0.8   Fouled Bay+0.5     25 /  5.4     0 /  8.9
 *   T9  Bled Hyd        —    Haulage   +2.6     50 / 10.3    25 / 13.3
 *   T10 Dead Weight   +1.3   Short Meas+1.2      0 /  2.4    88 / 10.5
 *
 * Read the two columns together and most pairs sit within a seed of each other
 * on whichever instrument can see them. THREE THINGS ARE STILL OPEN, and they
 * are named here rather than smoothed over:
 *
 *  - **The material Tiers cannot be judged by the bot, at all.** Measured
 *    directly: ONE notch of slag or cryo at the ratchet ladder's own gentlest
 *    rate (hazards.ts's materialRate(1) = 0.07 — a rate the shipped game deals
 *    routinely) takes the aim bot from 100% to 0%. The bot cannot strike a cryo
 *    cube on purpose and cannot fire the charge that is slag's only exit, so a
 *    0% on those rows is a fact about the harness. Every material rate below is
 *    therefore set against the LADDER's scale instead — none exceeds what
 *    materialRate reaches at six notches, and the two heaviest (slag, volatile)
 *    sit well under it. These are the rows a device playtest has to settle.
 *  - **Tier 10's pair splits between the instruments**, and the split is the
 *    design rather than a fault: pentominoes are cheap per cube and brutal to
 *    place on an unbreakable field, dominoes the exact reverse. The model has
 *    them level (+1.3 / +1.2) and the bot has them 88 points apart, because a
 *    badly-landed pentomino at this Tier is answered by a Bond Breaker and the
 *    bot never fires one. Measured control: the bot places pentominoes fine at
 *    Tier 1 and Tier 9 (83%, against 100% for standard) and only collapses at
 *    Tier 10, which is exactly where the Infinity bonds are. Watch this pair
 *    first.
 *  - **The bot's cadence is not a human's.** level.ts's congestion note records
 *    the same limit being learned the hard way: a census bot holds roughly twice
 *    the standing pile a human's slower, aimed cadence does, and deterrence
 *    questions are the sim's documented blind spot. Fouled Bay is priced in
 *    exactly that currency.
 *
 * So: first-pass numbers, in the same sense hazards.ts means it of its own
 * notch sizes, with the derivation attached so a play pass can move them
 * knowingly rather than by feel.
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
  | "dead-weight" | "short-measure";

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
 * Bay 10 opens at targetScore $1700, pays scorePerLine $190 and prices a launch
 * at $25, against a $200 float plus at most run.ts's $150 carry. At the
 * measured ~2.9 launches per line (contracts.ts's PLANNING_EFFICIENCY) a line
 * grosses $190 and costs $72.50 to make, so it nets $117.50 and the bay needs
 * (1700 - 350) / 117.50 = 11.5 lines. Price both clauses in that unit — extra
 * lines the bay demands — across the rigs that actually arrive at bay 10
 * (measured with sim/_finalprobe.ts, the throwaway that produced this table):
 *
 *              stock      Reactor 2    Reactor 3
 *   baseline   11.5       8.3          7.2
 *   Rush Order +6.4       +5.1         +4.6
 *   Rate Cut   +7.7       +5.0         +4.1
 *
 * The two CROSS, and where they cross is the whole design. A flat raise costs a
 * fixed amount of revenue, so its price in lines FALLS as your rate rises; a
 * percentage cut costs a share of everything you earn, so its price falls too,
 * but faster. Below the crossing the flat raise is the cheaper poison, above it
 * the percentage is — and the crossing is parked at the mid-track Reactor,
 * which is what a bay-10 rig typically carries. So the clause a player should
 * take is a direct readout of how good their rate actually is, which is the
 * question the Reactor track has been asking them all run.
 *
 * $750 rather than the $1000 this was first sketched at, for that reason alone:
 * at $1000 Rush Order costs +8.5 lines on a stock rig and +6.1 on a maxed
 * Reactor, against Rate Cut's +7.7 and +4.1 — the percentage wins at EVERY rig,
 * the crossing falls off the bottom of the table, and a pair with a right
 * answer is not a pair. $750 puts the crossing back inside the range real rigs
 * occupy. Re-run sim/_finalprobe.ts if scorePerLine, the launch price or the
 * Reactor track ever move; this number is only meaningful relative to them.
 * ------------------------------------------------------------------------- */

/** Quota added by Rush Order. Named because the card copy interpolates it and
 *  the arithmetic above quotes it. */
export const RUSH_ORDER_QUOTA = 800;
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
 * MATERIAL RATES ARE NOT CAPPED HERE, and that is deliberate rather than an
 * oversight of hazards.ts's MIX_TOTAL_CAP. That cap exists because the ratchet
 * mix is a CUMULATIVE walk over six axes that can each be taken many times, and
 * past a total of 1.0 the later materials can never come up at all while the
 * earlier ones swallow the whole belt. An inspection writes ONE material at ONE
 * rate on ONE bay, so neither failure is reachable — but the other half of that
 * note still binds ("every shipment is a hazard is not a hard bay, it is an
 * unplayable one"), and no rate below goes past 0.45. sim/systems.ts pins the
 * total under 0.75 on the worst arrival it can construct.
 * ------------------------------------------------------------------------- */

/** The salvage pile a wall clause opens the bay holding, as pieces.ts's column
 *  profile: cells filled in slot column k, counted up from the floor, k from
 *  the wall outward.
 *
 *  Fifteen cubes, uneven, with one column left EMPTY. The gap is the point —
 *  it is the shaft the player can still shoot into, and without it the wall is
 *  a flat lid that says "these rows are gone" rather than a pile that says
 *  "dig". Uneven for the same reason contracts.ts's salvageProfile is: a wall
 *  that reads as someone else's abandoned work is a puzzle, and a rectangle is
 *  a wall.
 *
 *  Fifteen also matters to congestion. level.ts's PILE_TIERS taxes a launch
 *  once the field holds more than 32 live cubes, and a standing wall counts —
 *  so a bay that opens on this pile opens roughly half way to the first knee,
 *  and every launch all bay is priced closer to it. That is a real second cost
 *  the card does not have to state, and Bay Extension's pileAllowance is
 *  exactly what buys it back. */
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
      // Three times the gust, and this is what makes the pair EQUAL rather than
      // merely opposite. Measured, the raw tailwind is the milder half: the aim
      // bot re-solves its angle against the live reading every shot and took an
      // 80% win rate against the headwind's 60%, because a following wind
      // pushes toward the wall the player is already aiming at. What a tailwind
      // actually costs is the NEAR half of the bay — a minimum-power placement
      // lands 226px deeper than aimed — and the gust is what stops that being
      // trimmable: the bias you can hold for, the noise you cannot.
      //
      // 3x takes the stationary spread from ~10.6% of windMax to ~32%, i.e.
      // roughly a cell of scatter per shot at bay 10's cap. The stabilizer is
      // the only thing that answers it (game.ts's windNow applies windAssist to
      // the LIVE wind, gust included), which is the half of the Launcher track
      // the headwind clause does not ask about.
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
      cfg.compactorOpenCells = Math.max(
        cfg.compactorMinLineCells + 1,
        cfg.compactorOpenCells - TIGHT_GAUGE_CELLS,
      );
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
    desc: "22% of the belt arrives frozen. Every frozen cube owes you a strike before it counts for anything.",
    tier: 4,
    system: "bay",
    apply: (cfg) => { cfg.materialMix = { ...cfg.materialMix, cryo: 0.22 }; },
  },
  {
    id: "ice-wall",
    name: "Ice Wall",
    desc: "The bay opens on 11 cubes of frozen salvage nobody thawed, and 16% of the belt arrives the same way.",
    tier: 4,
    system: "bay",
    apply: (cfg) => {
      // Written rather than appended: an inspection is the only thing that puts
      // a wall in a Deep Run bay, so there is never an existing profile to
      // merge with, and a merge would make the clause's size a function of
      // something the card cannot state.
      cfg.standingWall = [...SALVAGE_PROFILE];
      cfg.standingWallMaterial = "cryo";
      cfg.materialMix = { ...cfg.materialMix, cryo: 0.16 };
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
    desc: "32% of the belt is rebar. What lands is what you keep — nothing but a Bond Breaker will split it.",
    tier: 5,
    system: "bonds",
    apply: (cfg) => { cfg.materialMix = { ...cfg.materialMix, rebar: 0.32 }; },
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
    apply: (cfg) => { cfg.jointBreakStretch = Infinity; },
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
    desc: "17% of the belt is dead metal. It fills a slot, it never counts, and only a charge moves it.",
    tier: 6,
    system: "demolition",
    apply: (cfg) => { cfg.materialMix = { ...cfg.materialMix, slag: 0.17 }; },
  },
  {
    id: "slag-wall",
    name: "Slag Wall",
    desc: "The bay opens on 11 cubes of somebody else's slag, stacked against the wall, and 8% of the belt adds to it.",
    tier: 6,
    system: "demolition",
    apply: (cfg) => {
      cfg.standingWall = [...SALVAGE_PROFILE];
      cfg.standingWallMaterial = "slag";
      cfg.materialMix = { ...cfg.materialMix, slag: 0.08 };
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
    desc: "27% of the belt is volatile. Land one hard and it takes its neighbours with it.",
    tier: 7,
    system: "bay",
    apply: (cfg) => { cfg.materialMix = { ...cfg.materialMix, volatile: 0.27 }; },
  },
  {
    id: "hair-trigger",
    name: "Hair Trigger",
    desc: "20% of the belt is volatile, primed 15% finer — at this setting only the softest lob will not set it off.",
    tier: 7,
    system: "bay",
    apply: (cfg) => {
      cfg.materialMix = { ...cfg.materialMix, volatile: 0.2 };
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
    desc: "18% of the belt is tar. It welds to whatever it touches and a Bond Breaker will not split it.",
    tier: 8,
    system: "demolition",
    apply: (cfg) => { cfg.materialMix = { ...cfg.materialMix, tar: 0.18 }; },
  },
  {
    id: "fouled-bay",
    name: "Fouled Bay",
    desc: `1 shipment in 8 is tar, and the yard books a fused pile as clutter: congestion bites ${FOULED_ALLOWANCE} cubes earlier all shift.`,
    tier: 8,
    system: "demolition",
    apply: (cfg) => {
      cfg.materialMix = { ...cfg.materialMix, tar: 0.12 };
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
    // records runs of 41-67s against limits of 150s+) and strokes were never
    // the binding constraint. A clause nobody pays is not half of a fork.
    apply: (cfg) => { cfg.penaltyPerLostPiece = Math.round(cfg.penaltyPerLostPiece * 3); },
  },

  // -- Tier 10 · Bond Emitter (what the cargo is) ------------------------
  //
  // The capstone opens no axis of its own — it asks for two notches a bay and
  // sends bay 10's bonds to Infinity (level.ts's UNBREAKABLE_MARK), which makes
  // the Bond Breaker the only shatter in the bay. So its inspection is about
  // the cargo itself, at the two extremes pieces.ts's SIZE_SPEC describes, with
  // the standard shipment — the thing every run is built around — taken away.
  //
  // Both are the Bond Emitter's exam, and ECONOMY.md already says why for one
  // of them: a light shipment "lands on top of a mess without ever fixing it —
  // so a micro build has to buy its compaction some other way, which is what
  // makes Bond Breakers a build requirement rather than a nice-to-have". The
  // other end needs the same charge for the opposite reason: at this Tier a
  // pentomino that lands wrong is a rigid five-cube block that nothing on the
  // field can break up.
  //
  // PRICED, because the naive version of this clause is wildly lopsided. Cube
  // count per launch is 2 / 4 / 5, and launches are what a bay actually spends,
  // so bulk at a flat price is a BENEFIT (0.8x the launches per line) and tiny
  // at a flat price is a catastrophe (2x). The retired size mods priced exactly
  // this — micro at 0.6x launch cost, bulk at 1.5x — and these two carry the
  // same correction, tuned so both land near +3 lines on the bay's demand
  // (sim/_finalprobe.ts). What is left after the money is equalised is the
  // PHYSICAL difference, which is the half worth choosing between and the half
  // no arithmetic here can see.
  {
    id: "dead-weight",
    name: "Dead Weight",
    desc: "Every shipment is a 5-cube pentomino at 50% more a launch. Dense, rigid — and on this bay nothing comes apart on its own.",
    tier: 10,
    system: "bonds",
    apply: (cfg) => {
      cfg.pieceSize = "bulk";
      // The retired Bulk Shipments mod's own launch price, restored. A
      // pentomino delivers five cubes where a tetromino delivers four, so at a
      // flat price this clause would be a straight DISCOUNT on the bay's line
      // demand (contracts.ts's budget model reads it as -2.6 lines) and the
      // card would be selling a favour. x1.5 is the number the retired mod
      // already balanced that against.
      cfg.launchCost = Math.round(cfg.launchCost * 1.5);
    },
  },
  {
    id: "short-measure",
    name: "Short Measure",
    desc: "Every shipment is a 2-cube domino at 40% off a launch. Cheap and precise, half the cargo a shot — and far too light to square up anything you land it on.",
    tier: 10,
    system: "bonds",
    apply: (cfg) => {
      cfg.pieceSize = "tiny";
      // The retired Micro Shipments mod's own launch price, restored, and for
      // the mirror-image reason to its partner's: two cubes a launch instead of
      // four roughly doubles the launches a row costs, and at a flat price the
      // budget model reads that as +23 lines — not a clause, a wall. x0.6 is
      // what the retired mod already priced the trade at. Floored at $1: a free
      // launch removes the bay's whole operating constraint (level.ts's economy
      // note — the purse IS the pressure), and no clause may hand that back as
      // a side effect of a discount it gave for another reason.
      cfg.launchCost = Math.max(1, Math.round(cfg.launchCost * 0.6));
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
 *  must still resolve to a playable bay rather than throwing on the last one. */
export function applyFinal(cfg: LevelConfig, id: FinalId | null): void {
  if (!id) return;
  finalById(id)?.apply(cfg);
}
