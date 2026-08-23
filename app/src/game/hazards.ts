import type { LevelConfig, MaterialMix } from "./level";
import { WIND_GUST_FRACTION } from "./level";

/**
 * HAZARDS — the axis ratchet that replaced the modifier draft.
 *
 * Why this exists at all is measured, not asserted. level.ts's calibration note
 * records three sweeps over MARK_TARGET_STEP returning byte-identical win rates,
 * a clock cut to 35% still giving 3/3 wins, and compactor-speed scaling pinned
 * at 0 for being actively harmful. A fully-kitted rig trivializes the ladder, so
 * no multiplier on the ladder's own numbers produces a graded response.
 *
 * The conclusion the design drew: stop scaling what a bay demands behind the
 * player's back, and hand them the knob instead. Before every bay the player
 * ratchets ONE difficulty axis one notch, and it stays ratcheted for the rest of
 * the run. By bay 10 they have authored their own curve.
 *
 * Three properties make this different from the mod draft it replaces:
 *
 *  - **It is mandatory and unrewarded.** A mod was a hand you were dealt, often
 *    with an upside. A notch is pure cost. The reward is implicit and comes from
 *    the Workshop: a system does not DELETE a hazard, it makes one specific
 *    hazard cheap for you. Own the Launcher and crosswind is the notch you can
 *    afford. So the draft asks "what have you prepared for?" and the poison you
 *    are equipped for costs you nothing.
 *  - **The hand is small.** Two cards per draft, not three (see hazardOffers):
 *    with the purse now the binding constraint (level.ts's economy note), every
 *    notch is a real fork, and a third card only invited the least-bad shrug.
 *  - **Marks add axes rather than steepen them.** Higher Marks do not make the
 *    ratchet bigger; they put more kinds of pressure on the table. A Mark is a
 *    statement about which hazards and systems exist, and nothing else — which
 *    is why level.ts's MARK_TARGET_STEP is 0 (the ladder's OWN per-bay target
 *    ramp, TARGET_PER_BAY, is a different thing: it is the baseline climb every
 *    run faces, not a knob a Mark moves).
 *  - **Content axes are the same object as number axes.** Slag is not a
 *    scheduled probability the ladder inflicts any more; it is a notch the
 *    player took instead of a harder number. That swap is only attractive once
 *    the material's counter is installed, which is the incentive the Workshop
 *    sells.
 *
 * Notch sizes are a first guess, sized by arithmetic against the curve they
 * replace. This is the single most likely thing in the design to need a play
 * pass — see the spec's open calls.
 */

/** Every axis that can be ratcheted. Ordered by the Mark that opens it. */
export type HazardId =
  | "target" | "cost" | "time"
  | "wind" | "sweeper"
  | "slag" | "cryo" | "rebar" | "volatile" | "tar" | "magnetic";

/** How far each axis has been ratcheted this run. Absent = never taken. */
export type Ratchets = Partial<Record<HazardId, number>>;

export interface HazardDef {
  id: HazardId;
  name: string;
  /** Card copy naming the exact change ONE notch makes. The player is choosing
   *  a cost, so the number has to be on the card — a vague card turns a
   *  deliberate trade into a guess. */
  desc: string;
  /** The Mark being FLOWN at which this axis first appears in the offer.
   *  Deliberately not "Marks beaten" like meta.ts's requiresMark: the run knows
   *  its own Mark (RunState.mark), and comparing the two against different
   *  bases is exactly the off-by-one the install gates already had to document. */
  mark: number;
  /** "number" axes raise what the bay demands; "content" axes put a material on
   *  the belt. Split so the draft can promise the player at most one new
   *  material per bay — three content cards at once is not a choice, it is a
   *  pile-on, and the material axes all read alike at a glance. */
  kind: "number" | "content";
  /** The material this axis schedules, for content axes. The id doubles as the
   *  Material name, the same id-is-the-name convention the icons use. */
  material?: Exclude<keyof MaterialMix, never>;
  /** Mutates `cfg` for `notches` (>= 1) notches taken. Never called at 0. */
  apply(cfg: LevelConfig, notches: number): void;
}

/** One notch on each of the base axes. Named rather than inlined because the
 *  spec's whole pacing argument is stated in these numbers, and a play pass
 *  will edit them first. */
/** RETIRED — Quota Raise is no longer dealt (see RETIRED_AXES). The constant
 *  and the notch it sizes stay so a `target` ratchet already recorded on a run
 *  still resolves to the number it was taken at, but nothing in a new run can
 *  reach it: the quota's growth lives in level.ts's TARGET_PER_BAY now. */
export const TARGET_NOTCH = 300;
/**
 * ESCALATING LADDERS — what the nth notch on the cost and time axes costs.
 *
 * These two axes used to be linear (a flat +$5 and a flat -5s however many
 * notches deep you already were), and linear is the wrong shape for a ratchet
 * the player takes one notch at a time. Under a flat step the tenth notch is
 * the same decision as the first, so the axis a player opened early is the axis
 * they keep taking — it never stops being the cheapest card on the table, and
 * the draft quietly collapses into one axis repeated.
 *
 * Fibonacci fixes that without needing a cap: every notch is affordable
 * relative to the one before it and brutal relative to the one before THAT, so
 * an axis prices itself out of the draft on its own and the player is pushed to
 * spread. It also starts gentler than the flat step it replaces (notch 1 is -1s
 * and +$1 where both used to be 5), which matters because the FIRST notch is
 * taken by a player who has no idea yet what a notch feels like — the same
 * reasoning that took TIME_NOTCH from 20 to 5, carried the rest of the way.
 *
 * The two ladders are deliberately OFFSET by one — time runs 1,2,3,5,8,13 and
 * money runs 1,1,2,3,5,8. Money is the axis with an in-run answer (the reactor
 * track, a good line rate, a fat carry), so it is allowed to lag; the clock has
 * no such answer, so it leads.
 *
 * Past the table's end the recurrence simply continues (see notchTotal), so
 * neither ladder has an edge a Mark-10 run taking two notches a bay can fall
 * off.
 */
export const TIME_LADDER = [1, 2, 3, 5, 8, 13] as const;
export const COST_LADDER = [1, 1, 2, 3, 5, 8] as const;

/**
 * Cumulative cost of `n` notches on a ladder — the sum of its first n rungs,
 * continuing the Fibonacci recurrence past the table rather than clamping.
 *
 * Cumulative rather than "the nth rung" because apply() is called ONCE with the
 * total notch count (see applyRatchets), not once per notch: a run three
 * notches into the cost axis has paid rungs 1, 2 and 3, and the config has to
 * reflect all three.
 *
 * `startAt` advances where the ladder BEGINS, and it is how the Mark makes the
 * same choice cost more. Every run used to open on rung 0 whatever it had
 * beaten, so a Mark-3 pilot's first Shift Cut took the same 1s a first-timer's
 * did and the ratchet asked an easier question the further you got — exactly
 * backwards. The slide fixes that, and because the whole ladder slides rather
 * than being scaled, the SHAPE of the decision is preserved: still Fibonacci,
 * still steeply worse per notch, just never as cheap again.
 *
 * How FAR it slides is ladderStart below — one rung per TWO Marks, not per
 * Mark. See its measurement note: the full-Mark slide entered the Fibonacci
 * table at exponential heights against a build budget that grows linearly,
 * and sim/marks.ts measured every Mark from 5 up as 0% run-clear under it.
 */
export function notchTotal(ladder: readonly number[], n: number, startAt = 0): number {
  const rung = (i: number): number => {
    if (i < ladder.length) return ladder[i];
    let prev = ladder[ladder.length - 2];
    let last = ladder[ladder.length - 1];
    for (let k = ladder.length; k <= i; k++) {
      const next = prev + last;
      prev = last;
      last = next;
    }
    return last;
  };
  let total = 0;
  for (let i = 0; i < n; i++) total += rung(startAt + i);
  return total;
}

/**
 * Where the cost/time ladders BEGIN for a run flying `mark` — one rung per
 * TWO Marks beaten, not one per Mark.
 *
 * MEASURED, not asserted (sim/marks.ts --ratchets spread, 3 seeds, bays
 * 1/4/7/10, aim bot, one forced notch per cleared bay round-robin over the
 * Mark's number axes): at startAt = mark - 1 every Mark from 5 upward was
 * 0% run-clear — per-bay win rates fell to 17% by Mark 9 — and the
 * arithmetic says why. The Fibonacci ladders were priced for rung-0 entry;
 * entering at mark - 1 re-prices a run's FIRST decision at its
 * tenth-decision price while the build budget (upgrades.ts's budgetForMark)
 * grows only linearly. At Mark 10 the first Shift Cut cost rung 9 = 89s —
 * an instant 45s clock floor, the exact "lose button" the floor note below
 * says an axis must never be — and bay 10's round-robin toll reached
 * $923/launch on a $200 float.
 *
 * At (mark - 1) / 2 the first notch's price grows LINEARLY with the Mark
 * (1,1,2,2,3,3,5,5,8,8 seconds across Marks 1-10), matching the linear
 * budget, while a run's own repeats still climb the full Fibonacci from
 * there — "never as cheap again" survives, the exponential wall does not.
 */
export function ladderStart(mark: number): number {
  return Math.max(0, Math.floor((Math.floor(mark) - 1) / 2));
}

/** The FIRST rung of each ladder — what one notch costs a player who has never
 *  taken that axis before. Kept as named constants because card copy and docs
 *  quote them, but neither axis is linear any more. */
export const COST_NOTCH = COST_LADDER[0];
export const TIME_NOTCH = TIME_LADDER[0];

/** Crosswind per notch. Sized against makeBaseLevel's bay ramp (0.03 at
 *  bay 4, +0.02/bay): one notch is roughly a bay and a half of the weather
 *  the ladder rolls in on its own. Halved from 0.06 IN STEP with the
 *  2026-08-22 halving of that ramp — the notch is priced RELATIVE to the
 *  ladder's own weather, so halving the ladder alone would have silently
 *  doubled what a Crosswind card costs in relative terms. The card copy
 *  interpolates this constant, so it stays honest on its own. */
export const WIND_NOTCH = 0.03;

/** Sweeper: the press runs this much faster per notch and the bay loses one
 *  open cell. Both halves matter — speed alone was measured HARMFUL (it pushes
 *  pieces out before they settle, and the lost-piece penalty drains the
 *  bankroll erratically), so it is paired with the tighter bay that makes the
 *  faster sweep a real deadline rather than a bankruptcy tax. */
export const SWEEP_NOTCH = 0.08;
export const OPEN_CELL_NOTCH = 1;

/** A material's per-shipment rate at one notch, and what each further notch
 *  adds. Two notches on slag is a slag-heavy bay by choice — which is the point,
 *  since the player only takes it when Demolition is aboard. */
export const MATERIAL_BASE = 0.07;
export const MATERIAL_NOTCH = 0.05;
/** No single material may pass this, however many notches are stacked on it. */
export const MATERIAL_CAP = 0.32;

/** And no COMBINATION may pass this. The per-material cap alone is not a rail:
 *  six content axes at 0.32 sum to 1.92, and the roll is a cumulative walk — so
 *  past 1.0 the last materials in the order can never come up at all while the
 *  first ones silently swallow the whole belt. Worse, "every shipment is a
 *  hazard" is not a hard bay, it is an unplayable one: the player needs cargo
 *  to build rows out of.
 *
 *  0.55 leaves a clear majority of shipments standard at maximum ratchet. When
 *  the sum would exceed it the mix is scaled DOWN proportionally rather than
 *  clipped per material, so the player's relative emphasis survives — a run
 *  that ratcheted slag three times and cryo once still faces mostly slag. */
export const MIX_TOTAL_CAP = 0.55;

/** The rate a content axis schedules at `notches` notches. */
export function materialRate(notches: number): number {
  if (notches <= 0) return 0;
  return Math.min(MATERIAL_CAP, MATERIAL_BASE + MATERIAL_NOTCH * (notches - 1));
}

/**
 * A content axis's apply is entirely mechanical — it writes its own rate into
 * the mix and nothing else. Written once here rather than nine times inline so
 * a new material is one table row instead of a copied closure.
 */
function contentAxis(
  id: HazardId,
  name: string,
  desc: string,
  mark: number,
  material: keyof MaterialMix,
): HazardDef {
  return {
    id, name, desc, mark, kind: "content", material,
    apply(cfg, notches) {
      cfg.materialMix = { ...cfg.materialMix, [material]: materialRate(notches) };
    },
  };
}

/**
 * The ladder. Every Mark from 1 to 9 opens exactly one new axis except Mark 1,
 * which opens the base numbers together — a first rung offering one card is not
 * a draft. Of those, Quota Raise is retired from the offer (RETIRED_AXES), so
 * Mark 1 deals a two-card hand of Fuel Levy and Shift Cut: the ladder's own
 * quota ramp is not something a card sells any more. Mark 10 adds no axis and
 * instead offers TWO ratchets per bay; see offersFor.
 *
 * Marks 4-9 are the six materials — cryo first and slag deliberately third
 * (see the note at the material rows). Four of them had only a line of design
 * each (DESIGN.md's material table) until phase 3 built them. Their counters
 * are ship systems, not axes — see upgrades.ts.
 */
export const HAZARDS: HazardDef[] = [
  {
    id: "target",
    name: "Quota Raise",
    desc: `Every bay's funding target rises by $${TARGET_NOTCH}.`,
    mark: 1,
    kind: "number",
    // Retired from the draft (RETIRED_AXES) but deliberately still applied:
    // the quota ramp is the ladder's own job now (level.ts's TARGET_PER_BAY),
    // and an axis that stopped applying would silently rewrite the difficulty
    // of any run that had already banked a notch on it.
    apply: (cfg, n) => { cfg.targetScore += TARGET_NOTCH * n; },
  },
  {
    id: "cost",
    name: "Fuel Levy",
    // The card quotes the FIRST rung and warns that it steepens — an
    // escalating axis whose card reads the same at every depth is a trap.
    desc: `Every launch costs more — ${COST_LADDER[0]} at the first levy, steeply more at each one after.`,
    mark: 1,
    kind: "number",
    apply: (cfg, n) => { cfg.launchCost += notchTotal(COST_LADDER, n, ladderStart(cfg.mark)); },
  },
  {
    id: "time",
    name: "Shift Cut",
    desc: `Every bay's clock loses time — ${TIME_LADDER[0]}s at the first cut, steeply more at each one after.`,
    mark: 1,
    kind: "number",
    // Floored well above zero: an axis that can reach an unplayable bay is not a
    // difficulty knob, it is a lose button, and the player picking it has no way
    // to know which notch was the last survivable one. The floor matters more
    // under Fibonacci than under a flat step — the ladder reaches it in far
    // fewer notches.
    apply: (cfg, n) => {
      cfg.timeLimitSec = Math.max(45, cfg.timeLimitSec - notchTotal(TIME_LADDER, n, ladderStart(cfg.mark)));
    },
  },
  {
    id: "wind",
    name: "Crosswind",
    desc: `The bay's prevailing wind cap rises by ${WIND_NOTCH}, and gusts with it.`,
    mark: 2,
    kind: "number",
    apply: (cfg, n) => {
      cfg.windMax += WIND_NOTCH * n;
      // Gust rides on windMax by the same fraction makeBaseLevel uses, or a
      // ratcheted bay would get a stiff average with the texture of a calm one.
      cfg.windGust = cfg.windMax * WIND_GUST_FRACTION;
    },
  },
  {
    id: "sweeper",
    name: "Sweeper Detail",
    desc: `The press runs ${Math.round(SWEEP_NOTCH * 100)}% faster and the bay gives up ${OPEN_CELL_NOTCH} open cell.`,
    mark: 3,
    kind: "number",
    apply: (cfg, n) => {
      cfg.compactorSpeed *= 1 + SWEEP_NOTCH * n;
      // Never below the line width the press is checking for, or the bay cannot
      // physically hold a sellable row and no amount of play fixes it.
      //
      // The floor is minLineCells + 1, not minLineCells: compactor.ts derives
      // leftX from openCells and rightX from minLineCells, so at equality the
      // two stops are the same X and the press has zero travel. It then never
      // moves again while still counting a stroke every other step — measured
      // 0px of travel and 300 strokes in 600 steps. Reachable on a stock rig at
      // four notches (12 - 1*4 = 8 = minLineCells), which is a Deep Run that
      // simply stops working, so the floor has to leave one cell of stroke.
      cfg.compactorOpenCells = Math.max(
        cfg.compactorMinLineCells + 1,
        cfg.compactorOpenCells - OPEN_CELL_NOTCH * n,
      );
    },
  },
  // Cryo and rebar lead the material rungs, slag comes AFTER them (playtest
  // call, 2026-08-08): slag is the one material with no passive counter — a
  // dead cube leaves the field by Demolition or not at all, so a bay that
  // ratchets it with an empty bomb rack is quietly unwinnable. Cryo thaws and
  // rebar merely refuses to split; both are survivable bare-handed, so they
  // are the introduction and slag waits two rungs for the player's rack to be
  // real. It is also always DODGEABLE, which is the second half of the answer:
  // one content card per ordinary hand, hands never thinner than two axes — and
  // on the MATERIAL_DRAFT_BAYS, where the hand is materials only and the dodge
  // is deliberately gone, slag may fill a seat but never the last one, so a
  // forced pick is never forced to be the material with no passive counter.
  contentAxis("cryo", "Cryo Contract", "Frozen shipments arrive; press one cold and it shatters.", 4, "cryo"),
  contentAxis("rebar", "Rebar Contract", "Rebar shipments never come apart — what lands is what you keep.", 5, "rebar"),
  contentAxis("slag", "Slag Contract", "Dead cubes ride the belt — they fill a slot and never count.", 6, "slag"),
  contentAxis("volatile", "Volatile Contract", "Volatile shipments detonate on a hard landing, taking neighbours.", 7, "volatile"),
  contentAxis("tar", "Tar Contract", "Tar welds to whatever it touches, and Bond Breakers will not split it.", 8, "tar"),
  contentAxis("magnetic", "Magnetic Contract", "Magnetic shipments snap themselves square against their neighbours.", 9, "magnetic"),
];

export function hazardById(id: string): HazardDef | undefined {
  return HAZARDS.find((h) => h.id === id);
}

/** How many notches the player must take before each bay. Mark 10 is the
 *  capstone rung: it adds no new axis, and instead asks for two. */
export const CAPSTONE_MARK = 10;
export function picksPerBay(mark: number): number {
  return mark >= CAPSTONE_MARK ? 2 : 1;
}

/**
 * Toggle one axis in a draft's TENTATIVE hand (screens.ts's draftScreen selects
 * before it commits; main.ts's onPickHazard is the only caller).
 *
 * One rule, read in two halves: **a tap fills the hand while there is room, and
 * edits it once it is full.** At the one-pick draft every rung below Mark 10
 * deals, that collapses to the radio group a player expects — tapping the other
 * card switches to it, tapping the selected one clears it. At the capstone's
 * two-pick draft the same rule stacks: tapping one card twice is how a double
 * notch on a single axis is asked for, which is a real build and one the card's
 * "at N" badge already knows how to show.
 *
 * What matters either way is that every tap moves the hand — a full hand never
 * silently swallows one — and that any hand is reachable without a reset
 * button. A removal drops the LAST notch of that axis, so a hand of A,B,A falls
 * back to A,B instead of reordering itself between two taps that both said A.
 *
 * Returns a new array; never mutates `picks`.
 */
export function togglePick(picks: HazardId[], axis: HazardId, need: number): HazardId[] {
  if (picks.length < need) return [...picks, axis];
  const cut = picks.lastIndexOf(axis);
  if (cut >= 0) return picks.filter((_, i) => i !== cut);
  // A full hand of other axes still has to move. At one pick that is a straight
  // swap; past one, the oldest notch is the one that gives way.
  return need === 1 ? [axis] : [...picks.slice(1), axis];
}

/** Axes the draft is NOT allowed to deal.
 *
 *  "target" is the only member, and it is a deliberate retirement rather than a
 *  deletion. The quota now climbs on its own, every bay, via level.ts's
 *  TARGET_PER_BAY — so a card that sold the player MORE of that climb was
 *  asking them to opt into the ladder they were already on, which is not a
 *  choice, it is a tax with a card frame around it. The ladder's own ramp is
 *  the honest home for that pressure.
 *
 *  The HazardDef stays in HAZARDS rather than being deleted, and applyRatchets
 *  still applies it: a run (or a saved leaderboard entry, or a replayed seed)
 *  that already banked a `target` notch has to keep resolving to the same
 *  numbers, and the axis badge in components.ts's AXIS_GLYPHS has to keep
 *  finding its glyph. Retiring it from the OFFER is the whole change. */
const RETIRED_AXES: ReadonlySet<HazardId> = new Set<HazardId>(["target"]);

/** Every axis the draft may deal at `mark`, in ladder order. */
export function hazardsForMark(mark: number): HazardDef[] {
  return HAZARDS.filter((h) => h.mark <= mark && !RETIRED_AXES.has(h.id));
}

/**
 * Bays after which the draft deals MATERIALS ONLY — a hand with no number axis
 * in it, so the pick has to be a material.
 *
 * "Materials only" is exact where the Mark has TWO OR MORE materials: every card
 * is a material and the pick cannot avoid one. Where it has exactly one — Mark 4,
 * cryo alone — the hand is that material plus the run's hardest active axis, so
 * the player CAN still take the number and dodge. That is the design (a hand of
 * one card is not a draft), not an oversight, and it means these bays force a
 * material from Mark 5 onward and merely offer one at Mark 4.
 *
 * Named by the bay the player just CLEARED, 1-based, the way a player counts
 * them. The rest of the ladder is deliberately dodgeable: one content card per
 * hand, never two, so a run can reach bay 10 having taken no material at all.
 * That is a fine promise for a first run and a bad one for a fifth — it lets
 * the half of the content the materials ARE go permanently unseen, and it makes
 * every ship system that answers a material a purchase with nothing to answer.
 *
 * These three bays take the dodge away, and they sit ONE BAY BEFORE EACH SHOP.
 * Refits land after bays 3, 6 and 9 (run.ts's isRefitBay), so a material forced
 * here is carried for exactly one bay and then the counter is on sale: the
 * player meets the problem, plays a bay against it, and walks straight into the
 * shop that answers it. That is the whole reason the schedule is what it is.
 *
 * The uniformity is the point, and it is easy to lose. Moving the middle one to
 * bay 6 — the shop bay itself — makes its material carry for THREE bays before
 * a refit opens, which is a different and much harder ask than the other two
 * wearing the same clothes. `sim/systems.ts` pins the property rather than the
 * numbers: every forced bay is followed by a refit within one bay.
 */
export const MATERIAL_DRAFT_BAYS: readonly number[] = [2, 5, 8];

/** True when the draft dealt after clearing `levelIndex` (0-based) is one of
 *  the materials-only hands. */
export function isMaterialDraft(levelIndex: number): boolean {
  return MATERIAL_DRAFT_BAYS.includes(levelIndex + 1);
}

/**
 * The axis this run has leaned on hardest — the partner a materials-only hand
 * uses when the Mark has only ONE material to offer.
 *
 * A hand of one card is not a draft, so the single material needs a companion,
 * and the companion has to be something the player already chose to live with:
 * offering a fresh axis beside a forced material would be two new problems at
 * once. Ties break toward the LATER rung, which is the harder one — the point
 * is to name the thing the run is already committed to, and at equal notches
 * the later axis is the bigger commitment.
 *
 * Falls back to the hardest non-content axis on offer when the run has ratcheted
 * nothing yet (reachable only if this fires on bay 1, which MATERIAL_DRAFT_BAYS
 * does not do — kept because a null hand would be a crash and a dull hand is
 * not).
 */
function hardestActive(pool: HazardDef[], ratchets: Ratchets): HazardDef | null {
  const numbers = pool.filter((h) => h.kind !== "content");
  if (numbers.length === 0) return null;
  let best: HazardDef | null = null;
  let bestCount = 0;
  for (const h of numbers) {
    const n = ratchets[h.id] ?? 0;
    if (n > 0 && n >= bestCount) {
      best = h;
      bestCount = n;
    }
  }
  return best ?? numbers[numbers.length - 1];
}

/**
 * The axes offered before bay `levelIndex` of a run.
 *
 * Deterministic in the run seed, so a bay replayed from the same save deals the
 * same table — the ratchet is a choice under pressure, not a reroll to fish in.
 *
 * The hand is deliberately SMALL — two cards. A three-card hand invited a
 * "pick the least-bad" shrug; two cards is a real fork, and with the purse now
 * tight enough that every notch hurts, the fork is the decision the bay-clear
 * moment is about.
 *
 * Two rules shape the hand rather than dealing straight from the pool:
 *
 *  - **At most one content axis per offer** — on an ORDINARY bay. The material
 *    axes all read alike ("a new substance on the belt") and three at once is
 *    not a choice between kinds of pressure, it is a pile-on with a coat of
 *    paint. MATERIAL_DRAFT_BAYS suspends this rule on three bays, deliberately,
 *    and is the only thing that may.
 *  - **The offer is never smaller than the number of picks.** At Mark 10 that
 *    means at least two cards, or the capstone would silently hand the player
 *    the same axis twice.
 *
 * Returns every eligible axis when the pool is small, which is intentional: at
 * the bottom of the ladder the ratchet IS the whole table, and hiding one of
 * the few open axes would only make the choice arbitrary.
 */
export function hazardOffers(
  seed: number,
  levelIndex: number,
  mark: number,
  count = 2,
  /** The run's ratchets so far. Only read on a materials-only hand, and only to
   *  pick the partner when there is a single material — see hardestActive. The
   *  offer is otherwise deliberately NOT a function of the run's state. */
  ratchets: Ratchets = {},
): HazardDef[] {
  const pool = hazardsForMark(mark);
  const want = Math.max(count, picksPerBay(mark));

  if (isMaterialDraft(levelIndex)) {
    const forced = materialHand(pool, want, seed, levelIndex, ratchets);
    // Marks 1-3 have no material to force. Falling through to the ordinary
    // draft is the only honest answer there: a hand cannot be materials-only
    // when there are no materials, and an empty offer reads as a bug.
    if (forced) return forced;
  }

  if (pool.length <= want) return pool;

  const rng = mulberry32((seed ^ ((levelIndex + 1) * 0x85ebca6b)) >>> 0);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const picked: HazardDef[] = [];
  let tookContent = false;
  for (const h of shuffled) {
    if (picked.length >= want) break;
    if (h.kind === "content") {
      if (tookContent) continue;
      tookContent = true;
    }
    picked.push(h);
  }
  // The one-content rule can starve a hand at a high Mark, where content axes
  // outnumber numbers. Backfill in ladder order rather than leaving a short
  // offer, since a short offer is indistinguishable to the player from a bug.
  if (picked.length < want) {
    for (const h of shuffled) {
      if (picked.length >= want) break;
      if (!picked.includes(h)) picked.push(h);
    }
  }
  return picked.sort((a, b) => HAZARDS.indexOf(a) - HAZARDS.indexOf(b));
}

/**
 * A materials-only hand, or null when this Mark has no material yet.
 *
 * Two materials where the Mark has two or more, so the pick is a choice between
 * them rather than a single card the player taps to get past. One material plus
 * the run's hardest active axis where it has only one (see hardestActive).
 *
 * SLAG IS NEVER BOTH CARDS. It is the one material with no passive counter — a
 * dead cube leaves the field by Demolition or not at all — which is why the
 * ladder puts it two rungs after cryo and rebar and why the ordinary draft
 * guarantees it is dodgeable. Forcing a material is the point here; forcing
 * THAT material, on a rack that may be empty, is a bay that cannot be won by
 * playing well. So slag may fill one seat and never the last one.
 */
function materialHand(
  pool: HazardDef[],
  want: number,
  seed: number,
  levelIndex: number,
  ratchets: Ratchets,
): HazardDef[] | null {
  const materials = pool.filter((h) => h.kind === "content");
  if (materials.length === 0) return null;

  if (materials.length === 1) {
    const partner = hardestActive(pool, ratchets);
    const hand = partner ? [materials[0], partner] : [materials[0]];
    return hand.sort((a, b) => HAZARDS.indexOf(a) - HAZARDS.indexOf(b));
  }

  // Same seeded stream shape as the ordinary draft, so a bay's hand stays a
  // function of (run seed, bay, Mark) and a restarted run deals it again.
  const rng = mulberry32((seed ^ ((levelIndex + 1) * 0x9e3779b9)) >>> 0);
  const shuffled = [...materials];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // `shuffled` holds DISTINCT axes, so a hand of two can never be slag twice —
  // there used to be a guard here swapping slag out of an all-slag hand, and it
  // could not fire: 120,000 generated forced hands produced none. It is gone
  // rather than kept as reassurance, because an unreachable guard reads as a
  // protection that is being relied on.
  //
  // What IS true, and is not a guard: slag can be one of the two cards, and at
  // the capstone Mark picksPerBay is 2 against a hand of 2, so a capstone player
  // takes both — slag included. That is a real edge of this feature rather than
  // a bug in it, and sim/systems.ts pins it so it cannot change unnoticed.
  return shuffled.slice(0, want).sort((a, b) => HAZARDS.indexOf(a) - HAZARDS.indexOf(b));
}

/**
 * Apply a run's ratchets on top of a base LevelConfig, without mutating `base`.
 *
 * Unknown ids are ignored, so a save written before an axis was renamed still
 * loads. Applied in HAZARDS order rather than pick order — unlike the mods this
 * replaced, no two axes touch the same field, so order cannot change the
 * result, and a fixed order means a run's difficulty is a function of WHICH
 * notches were taken rather than of the sequence they arrived in.
 */
export function applyRatchets(base: LevelConfig, ratchets: Ratchets): LevelConfig {
  const cfg: LevelConfig = {
    ...base,
    pieceSequence: base.pieceSequence ? [...base.pieceSequence] : null,
    materialMix: { ...base.materialMix },
    // Copied for the same reason materialMix is: applyRatchets promises not to
    // mutate `base`, and a shared array would leak an edit back into it.
    pileTiers: base.pileTiers.map((t) => ({ ...t })),
  };
  for (const h of HAZARDS) {
    const n = ratchets[h.id] ?? 0;
    if (n > 0) h.apply(cfg, n);
  }
  const total = Object.values(cfg.materialMix).reduce((a, b) => a + b, 0);
  if (total > MIX_TOTAL_CAP) {
    const scale = MIX_TOTAL_CAP / total;
    for (const key of Object.keys(cfg.materialMix) as (keyof typeof cfg.materialMix)[]) {
      cfg.materialMix[key] *= scale;
    }
  }
  return cfg;
}

/** Total notches taken this run — the one number that says how hard the player
 *  made their own run, for the end screen and the leaderboard. */
export function totalNotches(ratchets: Ratchets): number {
  return Object.values(ratchets).reduce((a: number, b) => a + (b ?? 0), 0);
}

/** Seeded PRNG, duplicated from mods.ts rather than imported: the two draws
 *  must not share a stream, or the axis offered before bay 3 would correlate
 *  with whatever the mod pool happened to deal there. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
