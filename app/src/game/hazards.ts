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

/** One notch on each of the three base axes. Named rather than inlined because
 *  the spec's whole pacing argument is stated in these numbers, and a play
 *  pass will edit them first. */
/** Quota Raise is PER-BAY rather than flat: the ladder's own target already
 *  climbs by level.ts's TARGET_PER_BAY every bay, so a flat notch shrinks
 *  against it. A notch adds TARGET_NOTCH to every bay's demand, per bay —
 *  the one card that buys MORE of the ladder itself. */
export const TARGET_NOTCH = 120;
export const COST_NOTCH = 5;
/** A gentle notch: at 20s the clock was a trap card (three notches quietly
 *  halved the bay), so the player never took it — which made it dead weight
 *  in the hand. 5s is a pick you can actually afford. */
export const TIME_NOTCH = 5;

/** Crosswind per notch. Sized against makeBaseLevel's old bay ramp (0.06 at
 *  bay 4, +0.04/bay): one notch is roughly a bay and a half of the weather the
 *  ladder used to roll in on its own. */
export const WIND_NOTCH = 0.06;

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
 * which opens the three base numbers together — a first rung offering one card
 * is not a draft. Mark 10 adds no axis and instead offers TWO ratchets per bay;
 * see offersFor.
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
    desc: `Every bay's funding target rises by $${TARGET_NOTCH} per bay.`,
    mark: 1,
    kind: "number",
    apply: (cfg, n) => { cfg.targetScore += TARGET_NOTCH * n * cfg.id; },
  },
  {
    id: "cost",
    name: "Fuel Levy",
    desc: `Every launch costs $${COST_NOTCH} more.`,
    mark: 1,
    kind: "number",
    apply: (cfg, n) => { cfg.launchCost += COST_NOTCH * n; },
  },
  {
    id: "time",
    name: "Shift Cut",
    desc: `Every bay's clock loses ${TIME_NOTCH}s.`,
    mark: 1,
    kind: "number",
    // Floored well above zero: an axis that can reach an unplayable bay is not a
    // difficulty knob, it is a lose button, and the player picking it has no way
    // to know which notch was the last survivable one.
    apply: (cfg, n) => { cfg.timeLimitSec = Math.max(45, cfg.timeLimitSec - TIME_NOTCH * n); },
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
  // real. It is also always DODGEABLE (one content card per hand, hands never
  // thinner than two number axes), which is the second half of the answer.
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

/** Every axis on offer at `mark`, in ladder order. */
export function hazardsForMark(mark: number): HazardDef[] {
  return HAZARDS.filter((h) => h.mark <= mark);
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
 *  - **At most one content axis per offer.** The material axes all read alike
 *    ("a new substance on the belt") and three of them at once is not a choice
 *    between different kinds of pressure, it is a pile-on with a coat of paint.
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
): HazardDef[] {
  const pool = hazardsForMark(mark);
  const want = Math.max(count, picksPerBay(mark));
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
