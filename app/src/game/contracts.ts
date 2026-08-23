/**
 * CONTRACTS — the short, repeatable, generated half of the game.
 *
 * Deep Run is the exam: ten bays, permadeath, a clock and a bankroll. A Contract
 * is the opposite by design (docs/DESIGN.md): one bay, no clock, no launch cost,
 * failure costs nothing, and you can retry it forever. It is meant to be the
 * easy, positive, replayable half — a puzzle you return to, not a thing that can
 * beat you.
 *
 * What replaces time and money pressure is the LAUNCH BUDGET: a Contract gives
 * you N launches to hit the goal. Firing is still free — you just have a finite
 * number of shipments to do it with.
 *
 * This used to be a budget of compactor PRESS STROKES, which was wrong twice
 * over. Strokes elapse on a wall clock whether or not you fire, so the budget
 * was a hidden timer — you could lose a Contract by thinking, in the one mode
 * whose whole premise is that it can't rush you. And because strokes pass at a
 * fixed rate, a slower player got fewer shots inside the same budget, so the
 * identical Contract was harder for them. Measured aim time on device is 1446ms
 * against a 900ms cooldown, so that penalty landed on real players.
 *
 * Launches have neither problem: the budget is spent only by acting, and it is
 * worth exactly the same to a fast player and a slow one. It is also checkable
 * in closed form, which is what makes the feasibility guarantee below possible.
 *
 * Generated rather than authored. A hand-built map is a content treadmill nobody
 * on this project has time to feed, so a Contract is seed + template + a
 * DIFFICULTY BUDGET: every element carries a weighted cost and the generator
 * spends a scalar derived from the tier. That is what separates this from
 * randomness — difficulty is a number we spend, not an accident of the roll.
 */
import { buildOrder } from "./buildable";
import { HAZARDS } from "./hazards";
import { makeBaseLevel, NO_MATERIALS, WIND_GUST_FRACTION, type LevelConfig } from "./level";
import { SIZE_SPEC } from "./pieces";
import { tilingQueue } from "./tiling";
import type { BayTrack } from "./run";
import {
  MATERIAL_SPEC, PIECE_TYPES, type Material, type PieceSize, type PieceType,
} from "./theme";

/**
 * What a Contract can play under: one of the Deep Run's beds, borrowed, or the
 * rare special that belongs to no bay. Contracts have no theme of their own by
 * design — see contractBed.
 */
export type ContractBed = "contract-rare" | BayTrack;

/** How often a Contract draws the special instead of its usual bed. Low on
 *  purpose: at one in twenty it stays something that HAPPENS to you. Raise it
 *  much and it stops being a surprise and becomes a fourth Contract theme that
 *  shows up two thirds less often than the others, which is just inconsistent. */
export const CONTRACT_RARE_CHANCE = 0.05;

/** The usual bed per daily slot — Contracts 1, 2 and 3 borrow the run's first
 *  three. Indexed by slot rather than rolled, so the day's three Contracts
 *  always sound different FROM EACH OTHER; a Contract you retry sounds the same
 *  as it did, and the one next to it never sounds like it. */
const SLOT_BEDS: readonly BayTrack[] = ["bay-1", "bay-2", "bay-3"];

/**
 * The bed a Contract plays under, in precedence order:
 *
 *  1. **The special**, on a CONTRACT_RARE_CHANCE roll. It beats everything
 *     below — a rare thing that yields to a rule is not rare, it is
 *     conditional, and would never be heard on a pentomino Contract at all.
 *  2. **Bay 5's bed when the belt carries pentominoes.** That track is written
 *     in 5/4 and a pentomino is five cubes. It outranks the slot bed because it
 *     is about what you are LAUNCHING rather than which card you tapped, and
 *     the whole point is that it lines up.
 *  3. **The slot's bed** — Contract 1, 2 or 3 takes bay 1, 2 or 3's.
 *
 * `rng` defaults to Math.random — UNSEEDED, deliberately, the same call this
 * file already makes for a pattern Contract's queue order. The roll belongs to
 * the ATTEMPT, not to the Contract: main.ts rolls once in startContract and
 * holds the result, so retrying can surprise you twice, and so the state
 * machine's music sync — which runs on every screen change — cannot re-roll the
 * special every time the pause modal opens.
 */
export function contractBed(c: Contract, rng: () => number = Math.random): ContractBed {
  if (rng() < CONTRACT_RARE_CHANCE) return "contract-rare";
  // "bulk" is the five-cube shipment; see pieces.ts's SIZE_SPEC.
  if (c.pieceSize === "bulk") return "bay-5";
  return SLOT_BEDS[c.slot % SLOT_BEDS.length];
}

/**
 * Objectives a Contract can ask for. Deliberately small: every one of these has
 * to be legible in a single line of HUD copy, and a Contract the player can't
 * restate in their own words is a bad Contract.
 *
 *  - "lines"   — clear N lines, you have M launches. A budgeted version of what
 *                Deep Run asks for.
 *  - "pattern" — here is the EXACT set of shipments that tiles the goal, land
 *                them. No launch budget, because the queue is the budget; the
 *                piece queue stops being a random stream and becomes a designed
 *                object, which turns the bay into a planning problem instead of
 *                a physics grind. Deep Run can't copy this — its queue has to
 *                stay random for its own reasons.
 */
export type ObjectiveKind = "lines" | "pattern";

/** Materials a Contract may ship. Slag is excluded STRUCTURALLY, not by policy:
 *  a slag cube can never count toward a line (theme.ts's countsForLines), so no
 *  launch budget priced on "cubes that can reach a row" can be honest about it.
 *  Every other material is countable, which is what makes it priceable — see
 *  MATERIAL_WASTE below. */
export type ContractMaterial = Exclude<Material, "standard" | "slag">;

/* -------------------------------------------------------------------------
 * PATTERN VARIANTS — what makes one zero-waste bay different from another.
 *
 * A pattern Contract's difficulty used to have exactly two dials: how many
 * lines, and how many different shapes. Both scale the same activity, so the
 * whole mode read as one puzzle at seven sizes. A VARIANT changes the RULE
 * instead — what a landed shipment does, how wide a line is, what the bay opens
 * with, what you are allowed to see — which is the difference between more of a
 * thing and another thing.
 *
 * Every one of them has to survive the two proofs a pattern Contract rests on
 * (see tiling.ts and buildable.ts): the inventory packs the goal region, and the
 * order it is dealt in can be assembled under gravity. That is the constraint
 * that decides which of these are possible at all, and it is why the list is
 * short — "the belt is on fire" is not a variant, it is an excuse.
 *
 *  - "plain"   the original. Clean belt, 8-cell lines, full preview.
 *  - "single"  one shipment type for the whole bay, and a longer goal. Reads as
 *              the easiest card on the board and is not: eight L pieces packing
 *              four rows is a real packing problem, where eight L pieces mixed
 *              with I and O is mostly bookkeeping.
 *  - "short"   6-cell lines. A narrower row is a different tiling problem, not a
 *              smaller one — nothing about an 8-wide solution carries over, and
 *              the horizontal I that solves everything at 8 no longer fits a row
 *              on its own.
 *  - "rebar"   the whole belt is rebar, so nothing shatters. This is the variant
 *              that makes the mode HONEST: the card promises the exact set that
 *              tiles the goal, and everywhere else the compactor then dissolves
 *              every piece you land, so the promise is a metaphor. Here what
 *              lands is what you keep (pieces.ts's rigid note), which makes
 *              buildable.ts's model the literal rule of the bay rather than a
 *              conservative proxy for it.
 *  - "salvage" the bay opens with a wall already standing in it, and the queue
 *              is exactly the cubes that finish the rows around it. The opening
 *              board becomes the puzzle instead of the empty bay.
 *  - "blind"   the set is on the card; the NEXT preview is dark. Turns a
 *              lookahead puzzle into a risk-management one — the only variant
 *              that makes the proven deal invisible again, which is the point.
 *  - "guided"  a magnetic belt. Magnetic snaps a cube onto its slot as it
 *              settles, so the physics stops fighting the plan and what is left
 *              is planning alone. The gentlest thing on this list, and it lands
 *              at the TOP of the ladder anyway — see variantsFor.
 */
export type ContractVariant =
  | "plain" | "single" | "short" | "rebar" | "salvage" | "blind" | "guided";

export interface VariantSpec {
  id: ContractVariant;
  /** Shown on the card, above the brief. */
  name: string;
  /** The tier this variant first appears on. */
  tier: number;
  /** The material the belt carries, or null for a clean one. */
  material: ContractMaterial | null;
  /** Cells a line spans, or null to use the bay's own width. */
  lineCells: number | null;
  /** Lines added to the shared goal ladder. */
  goalBonus: number;
  /** Force the inventory to a single shipment type. */
  oneShape: boolean;
  /** Open the bay with a wall already standing. */
  salvage: boolean;
  /** Hide the NEXT preview. */
  blind: boolean;
}

/**
 * The variant ladder, one rung per tier from 3 — the same shape as hazards.ts's
 * Mark ladder, and for the same reason: a tier that adds nothing is a tier the
 * player has no reason to reach.
 *
 * The two MATERIAL variants sit on their material's own rung, not where their
 * difficulty would put them. That is docs/DESIGN.md's "Contracts teach what Deep
 * Run tests" and it costs something real here: `guided` is the gentlest variant
 * on the list and would make a lovely tier-2 on-ramp, but magnetic is Mark 9's
 * hazard, and a Contract that spends it at tier 2 has spoiled Mark 9's reveal to
 * save a new player four minutes. Rebar is Mark 5's, so `rebar` is tier 5's.
 */
export const VARIANTS: VariantSpec[] = [
  { id: "plain", name: "Standard", tier: 1, material: null, lineCells: null, goalBonus: 0, oneShape: false, salvage: false, blind: false },
  { id: "single", name: "Single Stock", tier: 3, material: null, lineCells: null, goalBonus: 1, oneShape: true, salvage: false, blind: false },
  { id: "short", name: "Narrow Gauge", tier: 4, material: null, lineCells: 6, goalBonus: 0, oneShape: false, salvage: false, blind: false },
  { id: "rebar", name: "Full Rebar", tier: 5, material: "rebar", lineCells: null, goalBonus: -1, oneShape: false, salvage: false, blind: false },
  { id: "salvage", name: "Part Load", tier: 6, material: null, lineCells: null, goalBonus: 0, oneShape: false, salvage: true, blind: false },
  { id: "blind", name: "Blackout", tier: 7, material: null, lineCells: null, goalBonus: 0, oneShape: false, salvage: false, blind: true },
  { id: "guided", name: "Guided", tier: 9, material: "magnetic", lineCells: null, goalBonus: 1, oneShape: false, salvage: false, blind: false },
];

export function variantSpec(id: ContractVariant): VariantSpec {
  return VARIANTS.find((v) => v.id === id) ?? VARIANTS[0];
}

/** Variants a tier-`tier` board may draw. Always non-empty — "plain" is tier 1. */
export function variantsFor(tier: number): VariantSpec[] {
  return VARIANTS.filter((v) => v.tier <= Math.max(1, Math.floor(tier)));
}

export interface Contract {
  /** Stable id — the daily seed plus its slot, so a Contract can be recorded,
   *  compared across players and re-generated identically. */
  id: string;
  /** Which of the day's DAILY_COUNT slots this is, 0-based. Baked into `id`
   *  too, but carried as a number because reading it back out of a string is
   *  how an id format change becomes a silent behaviour change — and the slot
   *  decides real things: PATTERN_SLOT, and which bed it plays (contractBed). */
  slot: number;
  seed: number;
  tier: number;
  name: string;
  kind: ObjectiveKind;
  /** Lines required. */
  goal: number;
  /** Launches allowed, for a "lines" Contract. Derived from the goal via the
   *  feasibility model in `launchesFor`, never rolled — see the note there.
   *  0 on a "pattern" Contract, which is limited by its queue instead. */
  launches: number;
  /** The exact shipment inventory of a "pattern" Contract, in canonical order
   *  (the SET, which is what the card advertises and what the id reproduces).
   *  The ORDER it is played in is re-rolled per attempt — see levelForContract.
   *  Empty on a "lines" Contract. */
  queue: PieceType[];
  pieceSize: PieceSize;
  /** The special material this Contract's belt carries, or null for a clean
   *  one. Lines Contracts only — a pattern queue is an exact tiling, and a
   *  material that changes what a landed cube does would un-prove it. */
  material: ContractMaterial | null;
  /** Per-shipment probability of `material`; 0 when material is null. */
  materialRate: number;
  /** Lateral wind cap, 0 for a calm bay. */
  windMax: number;
  /** Which pattern variant this is; "plain" on every lines Contract. */
  variant: ContractVariant;
  /** Cells a line spans in this Contract's bay. Carried on the Contract rather
   *  than re-derived, because the inventory is sized to it EXACTLY and a second
   *  derivation that drifted would be an unwinnable Contract rather than a
   *  slightly-off one. */
  lineCells: number;
  /** The salvage wall the bay opens with: cells already standing in column x,
   *  counted up from the floor, indexed from the wall outward (the same index
   *  lineClear.ts's slot k uses). Empty on every other Contract. */
  standing: number[];
  /** One-line brief shown on the card. */
  brief: string;
}

/* -------------------------------------------------------------------------
 * Seeded RNG. Contracts must regenerate identically from an id alone —
 * the daily set is the same for every player, and a per-Contract board is
 * meaningless if the bay differs between them.
 * ---------------------------------------------------------------------- */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. `sort(() => rng() - 0.5)` is not a shuffle — it's biased, and
 *  its bias depends on the engine's sort implementation, which would make a
 *  "daily" Contract differ between browsers. */
function shuffleSeeded<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Difficulty budget for a tier. Tier 1 buys a plain calm bay; higher tiers can
 * afford complications. Linear and small on purpose — the budget's job is to
 * keep a tier's Contracts comparable to each other, not to be a second
 * progression curve.
 */
export function budgetForTier(tier: number): number {
  return 2 + Math.max(0, Math.floor(tier) - 1) * 2;
}

/** Cost of each complication, in difficulty-budget points. */
const COST = { wind: 2, micro: 2, material: 2, tightLaunches: 2 } as const;

/**
 * Bay names — flavour only, and deliberately none of them a RULE.
 *
 * "Salvage Lot", "Night Shift" and "Short Haul" are gone. Each named a thing a
 * variant now actually does, so a card could read "Salvage Lot · Blackout" and
 * promise a wall the bay does not open with. A name that reads as a mechanic is
 * worse than a dull one: the player checks the card to learn the rules, and this
 * line is the one part of it that means nothing.
 *
 * So the test for anything added here is that it names a PLACE or a JOB and
 * could not be mistaken for a rule — no material words (rebar, cryo, magnetic,
 * slag, tar, volatile), nothing about width, preview, waste or what is already
 * standing in the bay.
 */
const NAMES = [
  "Backlog Clearance", "Overflow Dock", "Quota Run", "Scrap Line",
  "Holding Bay", "Transfer Yard", "Freight Ramp", "Sorting Floor",
] as const;

/* -------------------------------------------------------------------------
 * FEASIBILITY
 *
 * An impossible Contract is the single worst thing this generator can emit, so
 * the budget is derived from the goal rather than rolled beside it.
 *
 * A clearable line spans the compaction zone at full advance —
 * `compactorMinLineCells` = 8 cubes. So the cubes a goal requires is
 * `goal * 8`, and the cubes a launch delivers is `SIZE_SPEC[size].cubes`. What
 * separates those two numbers is how much of what you fire actually ends up in
 * a completed line: cubes are lost off the wrong side, and whatever is left in
 * a part-built row when the bay ends is waste.
 *
 * The measured value, from the OnePlus 12 playtest session (67 shots, 23 lines,
 * std pieces): 23*8 / 67*4 = 0.687.
 *
 * PLANNING_EFFICIENCY is deliberately set BELOW that. The measurement is one
 * session, on one device, at one piece size, by one player — and the cost of
 * being wrong is asymmetric. Too generous a budget makes a Contract slightly
 * dull; too tight makes it unwinnable, which for "the easy, positive,
 * replayable half" is fatal. It should be revisited per piece size once the
 * sweep telemetry lands (docs/superpowers/specs/2026-07-30-sweep-telemetry-design.md).
 * ---------------------------------------------------------------------- */

/** Cubes needed to span the compaction zone at full advance — one line. Kept
 *  in sync with level.ts's compactorMinLineCells by a test in sim/systems.ts. */
export const CUBES_PER_LINE = 8;

/** Share of launched cubes that reach a completed line. Conservative; see above. */
export const PLANNING_EFFICIENCY = 0.6;

/** Headroom over the bare feasibility floor. The asymmetry argument on
 *  PLANNING_EFFICIENCY still decides which way to lean — a Contract is meant
 *  to be winnable on a decent attempt, not a perfect one — but the 2026-08
 *  balance playtest measured the old 1.25 as too forgiving on device: lines
 *  Contracts cleared with the budget never once in doubt, which is dull, not
 *  easy. 1.15 trims roughly 8% of launches off every "lines" Contract while
 *  staying above 1.0, so the feasibility guarantee is untouched in kind, only
 *  in generosity. Pay was deliberately NOT the knob: staging's salvage economy
 *  is flat per tier and the 15-salvage milestone is the on-ramp install
 *  (2026-08-09 deadlock), so difficulty moves here, where it is provable. */
const SLACK = 1.15;
/** The "tight launch budget" complication's headroom. At the old 1.05, ceil
 *  rounding often made it indistinguishable from the standard budget — a
 *  complication the player pays difficulty points for has to be feelable.
 *  1.02 is meaningfully tight while still clearing the feasibility floor. */
const SLACK_TIGHT = 1.02;

/* -------------------------------------------------------------------------
 * CONTRACT MATERIALS — the budget model that finally lets a material into a
 * Contract, which docs/DESIGN.md deferred ("materials arrive there when the
 * budget model accounts for them") and which replaced the bulk-pentomino
 * complication outright.
 *
 * Pentominoes were removed on playtest feedback: they pack visibly worse than
 * tetrominoes, so a bulk Contract read as a dice roll rather than a puzzle —
 * the exact failure a Contract must not have. Bulk remains a Deep Run draft
 * choice (mods.ts), where the player OPTS INTO it for its payout; a Contract
 * deals it to you, which is a different, worse offer.
 *
 * A material is priceable where a worse-packing shape is not: a shape changes
 * the geometry of every landing in a way the closed-form model can't see,
 * while a countable material is a per-shipment risk with a per-cube cost. The
 * model: a material shipment arrives at `materialRate`, and MATERIAL_WASTE
 * says what fraction of such a shipment's cubes the budget assumes are lost
 * beyond the standard PLANNING_EFFICIENCY waste. The budget then simply prices
 * fired cubes at the reduced effective efficiency — same closed form, one more
 * factor, still provable in sim/systems.ts.
 * ---------------------------------------------------------------------- */

/**
 * Assumed EXTRA waste per material shipment, as a fraction of its cubes, on
 * top of the standard-efficiency model. Deliberately pessimistic — the
 * asymmetry argument on PLANNING_EFFICIENCY applies with more force here,
 * since these numbers are modeled rather than measured.
 *
 *  - cryo     0.5: pressed cold it shatters and can take its row's alignment
 *             with it; sequencing mistakes cost about half the shipment.
 *  - rebar    0.35: every cube still counts, but a bad landing can't be
 *             shattered into a better one, so more cubes strand in shapes a
 *             row can't use.
 *  - volatile 1.0: the only material that destroys cubes ALREADY DOWN, so a
 *             hard landing can cost more than the shipment itself. Priced at a
 *             full shipment per occurrence.
 *  - tar      0.6: a weld in the wrong place strands its whole cluster, and a
 *             Bond Breaker won't undo it.
 *  - magnetic 0: it snaps the row square FOR you. It appears here as a
 *             complication anyway because Contracts are where a material is
 *             safe to learn (docs/DESIGN.md), and Mark 9's Deep Run will deal
 *             it — but it costs the budget nothing extra.
 */
export const MATERIAL_WASTE: Record<ContractMaterial, number> = {
  cryo: 0.5, rebar: 0.35, volatile: 1.0, tar: 0.6, magnetic: 0,
};

/** Per-shipment material rate a Contract ships: noticeable from the first one
 *  (a rate the player can't feel is a brief that lies), climbing gently with
 *  tiers past the material's introduction, capped where hazards.ts caps a
 *  single Deep Run axis. */
export const CONTRACT_MATERIAL_BASE = 0.15;
export const CONTRACT_MATERIAL_PER_TIER = 0.03;
export const CONTRACT_MATERIAL_CAP = 0.3;

/**
 * Materials a Contract at `tier` may draw, in ladder order. Derived from
 * hazards.ts's ladder rather than re-declared: a Contract tier IS the Mark
 * being flown (meta.ts's markUnlocked gates both halves together), and
 * "Contracts teach what Deep Run tests" only holds if the two read the same
 * schedule. The countsForLines filter is what structurally excludes slag —
 * see ContractMaterial.
 */
export function contractMaterialsFor(tier: number): ContractMaterial[] {
  return HAZARDS.filter(
    (h) => h.kind === "content" && h.material !== undefined
      && MATERIAL_SPEC[h.material].countsForLines && h.mark <= tier,
  ).map((h) => h.material as ContractMaterial);
}

/** The tier at which `m` first appears in Contracts — its hazard's rung. */
export function contractMaterialTier(m: ContractMaterial): number {
  return HAZARDS.find((h) => h.kind === "content" && h.material === m)?.mark ?? Infinity;
}

/** Rate for `m` in a tier-`tier` Contract. */
export function contractMaterialRate(m: ContractMaterial, tier: number): number {
  const past = Math.max(0, tier - contractMaterialTier(m));
  return Math.min(
    CONTRACT_MATERIAL_CAP,
    CONTRACT_MATERIAL_BASE + CONTRACT_MATERIAL_PER_TIER * past,
  );
}

/**
 * The share of launched cubes the budget model assumes reach a completed line,
 * for a belt carrying `material` at `rate`. The material-free case is exactly
 * PLANNING_EFFICIENCY. Exported so sim/systems.ts asserts feasibility against
 * the same model the generator priced with — the whole guarantee is that these
 * are one formula, not two copies.
 */
export function contractEfficiency(material: ContractMaterial | null, rate: number): number {
  const waste = material ? MATERIAL_WASTE[material] : 0;
  return PLANNING_EFFICIENCY * (1 - rate * waste);
}

/**
 * Launches required for `goal` lines of `size` pieces, at `slack` headroom and
 * `efficiency` (contractEfficiency's output — PLANNING_EFFICIENCY for a clean
 * belt). Exported so sim/systems.ts asserts against the same function the
 * generator uses — a feasibility guarantee that re-derives the number
 * independently would only prove the two copies agree.
 */
export function launchesFor(
  goal: number,
  cubesPerPiece: number,
  slack: number,
  efficiency: number = PLANNING_EFFICIENCY,
): number {
  const cubesNeeded = goal * CUBES_PER_LINE;
  const cubesPerLaunch = cubesPerPiece * efficiency;
  return Math.max(3, Math.ceil((cubesNeeded / cubesPerLaunch) * slack));
}

/* -------------------------------------------------------------------------
 * PATTERN CONTRACTS — exact-inventory puzzles.
 *
 * The queue is precisely the cubes the goal needs and not one more. One
 * shipment off the side, or one shatter that strands a cube, and the attempt
 * is over (game.ts's objectiveUnreachable calls it the moment it becomes true,
 * rather than letting a dead bay run on).
 *
 * That is a demanding ask and the number says so: measured efficiency — the
 * share of launched cubes reaching a completed line — is 0.62 in the browser
 * and 0.69 on device, so about a third of fired cubes currently go nowhere.
 * Zero waste asks for roughly 1.5x better than anyone has yet played. It is
 * taken with that on the table because retrying costs nothing and takes
 * seconds; if it turns out merely tedious rather than satisfying, the fix is
 * SPARE_SHIPMENTS below, not a nudge to the physics tolerances.
 *
 * This used to claim the game needed no tiling proof, on the grounds that
 * pieces don't keep their shape — the compactor shatters whatever it presses
 * (pieces.ts's breakJointsInBand) and lineClear.ts fills rows slot by slot from
 * LOOSE cubes, so geometry could never make an exact set impossible.
 *
 * That was wrong, and it shipped Contracts nobody could win. Shattering lets a
 * piece's cubes separate; it does not move a cube sideways under an overhang,
 * and it certainly doesn't conjure one to fill a hole. Zero waste means every
 * launched cube has to land inside a completed row, which makes the goal a
 * `goal` x `lineCells` rectangle — and a set that tiles no such rectangle is
 * unwinnable however it shatters. The generator emitted [I, O, J, J] for two
 * lines and [I, I, I, T, S, Z] for three; neither tiles.
 *
 * So the inventory is now built FROM a tiling (tiling.ts) rather than rolled
 * and hoped over, and sim/systems.ts re-checks every generated queue with an
 * independent solver.
 * ---------------------------------------------------------------------- */

/**
 * Spare shipments granted above the exact requirement. 0 is the design: the
 * inventory is exactly the cubes needed. This is the single constant the spec
 * names as the fix if playtesting says zero waste is unfun — one spare piece
 * is a change of tolerance the player can feel, where loosening the physics
 * would quietly change every other mode too.
 */
export const SPARE_SHIPMENTS = 0;

/**
 * Which piece types a tier is ALLOWED to draw from. I and O settle flat and
 * pack cleanly; L and J need a rotation thought through; S, Z and T tip, wedge
 * and strand cubes.
 *
 * This is now the softer half of the ladder — it bounds which shapes can turn
 * up, while `patternVariety` decides how many different ones a single Contract
 * mixes. Pool alone was a poor difficulty axis: it scaled per-shipment delivery
 * risk, which a pattern Contract already punishes hardest, rather than the
 * planning the mode is actually about.
 */
function patternPool(tier: number): PieceType[] {
  if (tier <= 2) return ["I", "O"];
  if (tier <= 5) return ["I", "O", "L", "J"];
  return [...PIECE_TYPES];
}

/**
 * How many DIFFERENT shipment types one Contract mixes — the real difficulty
 * ladder here. Four O shipments making two rows is a puzzle you can see whole;
 * the same two rows out of four different shapes has to be planned, because
 * each shape constrains where the next can go. That scales the thinking rather
 * than the delivery risk, which is the right axis for a planning mode.
 *
 * A ceiling, not a quota: tiling.ts prefers a queue that spends it but will
 * settle for one shape fewer rather than fail (see EXACT_ATTEMPTS there).
 */
/** How often a pattern Contract ships dominoes instead of tetrominoes, and the
 *  tier from which they can appear at all. Roughly one board slot in three, so
 *  a day's board mixes the two rather than committing to either — and never at
 *  tier 1, where the player is still learning what "no waste" costs. */
export const TINY_PATTERN_CHANCE = 0.34;
export const TINY_PATTERN_MIN_TIER = 2;

function patternVariety(tier: number): number {
  return 1 + Math.min(3, Math.floor((Math.max(1, tier) - 1) / 2));
}

/**
 * Lines a pattern Contract asks for. Lower than a "lines" Contract's goal and
 * it climbs far more slowly, because zero waste makes every additional line a
 * multiplicative risk rather than an additive one: a 4-line pattern needs 32
 * consecutive cubes placed perfectly, not 4 independent tries at 8.
 *
 * Nudged up when the region's area doesn't divide by 4. A queue is exact only
 * if `goal * lineCells` is a whole number of std tetrominoes, and it is also a
 * precondition for tiling at all — no set of 4-cube pieces fills an area that
 * isn't a multiple of 4. At today's 8-cell line every goal qualifies; this
 * exists so a narrower line (mods.ts's Short Lines takes it to 6, and level.ts
 * calls it a tunable seam) can't silently produce a Contract that is short a
 * cube by arithmetic.
 */
function patternGoal(
  tier: number, lineCells: number, size: PieceSize, bonus = 0,
): number {
  // Floored at 2 after the bonus: "rebar" spends a NEGATIVE bonus, because
  // nothing shattering makes every line strictly harder than the same line
  // elsewhere, and a one-line zero-waste Contract is a formality rather than a
  // puzzle.
  let goal = Math.max(2, 2 + Math.min(2, Math.floor((Math.max(1, tier) - 1) / 3)) + bonus);
  // Tiny scales on the SHARED goal ladder and gets no bonus on top of it.
  // pieceCells returns one fixed domino whatever the type, so a domino
  // Contract has exactly one distinct shape and patternVariety has nothing to
  // grade — but the doubling is already inherent, because half-size shipments
  // means twice as many of them for the same goal (a goal of 4 is 8 tetrominoes
  // or 16 dominoes). Stacking an extra goal bonus on that compounded it to 24
  // perfect placements at tier 9, which against a measured 23% Contract clear
  // rate is a lottery rather than a puzzle.
  while ((goal * lineCells) % SIZE_SPEC[size].cubes !== 0) goal++;
  return goal;
}

/**
 * The payload size a pattern Contract ships.
 *
 * Tiny appears as a MIXED VARIANT at any tier rather than as a difficulty step,
 * because a domino Contract is not harder than a tetromino one — it is a
 * different test. Std is planning plus delivery; tiny is delivery alone, and
 * the telemetry says delivery is where Contracts actually fail (26 of 35 losses
 * were "ran out of pieces", not a queue nobody could arrange).
 *
 * Bulk is deliberately absent. Pentominoes tile a 10-wide line at every goal
 * from 2 to 6, but at the 8-wide line every tier actually ships, `goal * 8`
 * divides by 5 only at goal 5 — a 40-cube, 8-shipment monster or nothing. It
 * becomes available the day a wider line does.
 */
function patternSize(tier: number, rng: () => number, spec: VariantSpec): PieceSize {
  // Two variants are INERT on a domino belt, because pieceCells returns one
  // fixed domino whatever the type (pieces.ts):
  //
  //   Single Stock  promises one shipment type all bay. Every domino bay is
  //                 already one shipment type, so the promise is free — and the
  //                 card said "all L" about twelve identical dominoes, naming a
  //                 distinction the player cannot see anywhere on the field.
  //   Blackout      hides the NEXT preview. Every domino preview is the same
  //                 tile, so there is no information in it to hide; the variant
  //                 costs the player nothing and teaches nothing.
  //
  // Both would still be dealt, still be named on the card, and still spend a
  // rung of the ladder while doing nothing. A variant that can roll into a
  // no-op is worse than one that does not exist, so these two ship tetrominoes
  // and the tiny roll belongs to the variants it actually changes.
  if (spec.oneShape || spec.blind) return "std";
  return rng() < TINY_PATTERN_CHANCE && tier >= TINY_PATTERN_MIN_TIER ? "tiny" : "std";
}

/**
 * Cells a line spans in the bay this Contract will actually be played in.
 *
 * Read from the level rather than assumed to be CUBES_PER_LINE, because the
 * inventory is sized to it exactly and a wrong value is an unwinnable Contract
 * rather than a slightly-off one. Mirrors levelForContract's own tier clamp so
 * the two can never disagree.
 *
 * A row can CLEAR wider than this — the zone grows to compactorOpenCells as the
 * bar retreats, and lineClear.ts requires whatever the zone is at that moment.
 * The inventory can't be planned around that: a wider row eats more cubes than
 * a zero-waste budget has, so building one costs the player a later line. The
 * minimum is the only width guaranteed to be on offer every single sweep, which
 * makes it the only width an exact inventory can be sized to.
 */
function lineCellsForTier(tier: number): number {
  return makeBaseLevel(Math.min(9, tier)).compactorMinLineCells;
}

/**
 * The salvage wall a "salvage" Contract opens on: how many cells of each column
 * are already standing, counted up from the floor and indexed from the wall out.
 *
 * Three properties have to hold together, and the construction is chosen so all
 * three are true by shape rather than by check-and-retry:
 *
 *  1. NOTHING FLOATS. A column profile is bottom-anchored by definition, so
 *     every standing cube rests on the floor or on another one.
 *  2. NO ROW IS ALREADY COMPLETE. One column is pinned to zero, so no row of
 *     the region is full — otherwise the bay would clear a line on its first
 *     frame and hand the player a line they did not earn.
 *  3. THE REMAINDER IS TILEABLE ARITHMETIC. What is left has to be a whole
 *     number of shipments, so the standing cube count is trimmed until the empty
 *     area divides by the payload size. Trimming (rather than re-rolling) is
 *     what keeps this a closed-form construction with no failure branch.
 *
 * Heights are capped one below the goal so no column is a full stack: a wall
 * that reaches the top of the region leaves a well nothing can be dropped into.
 */
function salvageProfile(
  goal: number, lineCells: number, cubes: number, rng: () => number,
): number[] {
  const gap = Math.floor(rng() * lineCells);
  const cap = Math.max(1, goal - 1);
  const standing = Array.from({ length: lineCells }, (_, x) =>
    (x === gap ? 0 : Math.floor(rng() * (cap + 1))));

  // Trim from the tallest columns until the empty area is a whole number of
  // shipments. Tallest first so the wall stays ragged instead of flattening.
  let empty = goal * lineCells - standing.reduce((a, h) => a + h, 0);
  while (empty % cubes !== 0) {
    let tallest = 0;
    for (let x = 1; x < lineCells; x++) if (standing[x] > standing[tallest]) tallest = x;
    if (standing[tallest] === 0) break; // nothing left to trim; empty is the whole region
    standing[tallest] -= 1;
    empty += 1;
  }
  return standing;
}

/**
 * How many shipments a variant's inventory holds, and the wall it is sized
 * around. Split out because the two are decided together: a salvage wall eats
 * cubes the queue then does not have to supply, and getting that backwards is
 * the one arithmetic error that produces an unwinnable Contract.
 */
function patternInventory(
  spec: VariantSpec, goal: number, tier: number, lineCells: number,
  rng: () => number, size: PieceSize,
): { queue: PieceType[]; standing: number[] } {
  const cubes = SIZE_SPEC[size].cubes;
  const standing = spec.salvage ? salvageProfile(goal, lineCells, cubes, rng) : [];
  // One shape means one shape, whatever the tier's variety dial says.
  const variety = spec.oneShape ? 1 : patternVariety(tier);
  const tiled = tilingQueue(goal, lineCells, patternPool(tier), rng, variety, size, standing);
  if (tiled) return { queue: canonical(tiled, rng), standing };

  // The fallback, and it is deliberately a RETREAT TO PLAIN rather than a pile
  // of I pieces. The old all-I fallback was safe only because it assumed an
  // 8-wide line: four horizontal I pieces tile a row of 8 and tile nothing at
  // all at 6, so on a "short" Contract the safety net was itself the bug. An
  // empty wall on the bay's own width is a shape tilingQueue has never failed
  // on, and a dull Contract beats an impossible one.
  const plain = tilingQueue(goal, lineCells, patternPool(tier), rng, variety, size);
  return { queue: canonical(plain ?? [], rng), standing: [] };
}

/**
 * The inventory as the CARD states it: any spares, then sorted.
 *
 * The order is canonical so the card, the id and any leaderboard all describe
 * the same set the same way. What the player actually receives is a proven
 * order re-rolled per attempt — see dealPatternQueue.
 */
function canonical(queue: PieceType[], rng: () => number): PieceType[] {
  for (let i = 0; i < SPARE_SHIPMENTS; i++) {
    if (queue.length > 0) queue.push(queue[Math.floor(rng() * queue.length)]);
  }
  return queue.sort((a, b) => PIECE_TYPES.indexOf(a) - PIECE_TYPES.indexOf(b));
}

function generatePatternContract(
  seed: number, tier: number, slot: number, forced?: ContractVariant,
): Contract {
  const rng = mulberry32(seed + slot * 7919);
  const pool = variantsFor(tier);
  const spec = forced ? variantSpec(forced) : pool[Math.floor(rng() * pool.length)];
  const lineCells = spec.lineCells ?? lineCellsForTier(tier);
  const size = patternSize(tier, rng, spec);
  const goal = patternGoal(tier, lineCells, size, spec.goalBonus);
  const { queue, standing } = patternInventory(spec, goal, tier, lineCells, rng, size);
  const shapes = new Set(queue).size;
  const material = spec.material;
  return {
    id: `${seed}-${tier}-${slot}`,
    slot,
    seed: seed + slot * 7919,
    tier,
    name: NAMES[(seed + slot * 3) % NAMES.length],
    kind: "pattern",
    goal,
    launches: 0,
    queue,
    pieceSize: size,
    // A pattern belt still carries only materials that cannot un-prove the
    // tiling, which is a narrower rule than "clean" but the same rule. Cryo,
    // volatile and tar all change what a landed cube IS — dead until struck,
    // gone with its neighbours, welded where it fell — so an exact inventory
    // stops being exact. Rebar and magnetic change only how a piece SETTLES:
    // rebar refuses to come apart, magnetic squares itself onto its slot.
    // Every cube still counts, and counts in the cell the tiling put it in.
    material,
    materialRate: material ? 1 : 0,
    // Never any wind, at any tier. A zero-waste objective plus a lateral force
    // the player can't fully cancel is not a puzzle, it's a dice roll — so the
    // difficulty budget has nothing to spend here either.
    windMax: 0,
    variant: spec.id,
    lineCells,
    standing,
    brief: patternBrief(spec, queue, shapes, size, standing),
  };
}

/**
 * The one line on the card. Every variant has to say the thing that makes it
 * different, because a player who cannot restate a Contract in their own words
 * before firing has been handed a surprise rather than a puzzle.
 */
function patternBrief(
  spec: VariantSpec, queue: readonly PieceType[], shapes: number,
  size: PieceSize, standing: readonly number[],
): string {
  const n = `${queue.length} shipments`;
  // Std calls out the SHAPE count, because that (not the shipment count) is what
  // makes one tetromino pattern harder than another. Tiny has exactly one shape
  // by construction, so "1 shape" there would read as a bug rather than a
  // difficulty — it names the payload instead.
  const cargo = size === "tiny"
    ? "dominoes"
    : `${shapes} shape${shapes === 1 ? "" : "s"}`;
  switch (spec.id) {
    case "single":
      // Never names the TYPE on a domino belt: every domino is the same tile,
      // so "all L" would describe a distinction that does not exist on the
      // field. patternSize keeps this variant on tetrominoes, and this is the
      // second lock on the same door.
      return size === "tiny"
        ? `${n} · ${cargo}, no waste`
        : `${n} · all ${queue[0] ?? "I"}, no waste`;
    case "short":
      return `${n} · ${spec.lineCells}-cell lines, no waste`;
    case "rebar":
      return `${n} · rebar, nothing shatters, no waste`;
    case "salvage":
      return `${n} · ${standing.reduce((a, h) => a + h, 0)} cubes already down, no waste`;
    case "blind":
      return `${n} · ${cargo}, no preview, no waste`;
    case "guided":
      return `${n} · magnetic, self-squaring, no waste`;
    default:
      return `${n} · ${cargo}, no waste`;
  }
}

/**
 * One Contract from the day's board.
 *
 * `variant` forces the pattern slot to a specific variant instead of rolling
 * one. Only the dev sandbox passes it (ui/sandbox.ts) — a board that let the
 * player choose would stop being a daily board, which is the whole basis of a
 * per-Contract leaderboard. It is a parameter rather than a separate exported
 * generator so the sandbox exercises the SHIPPING path with one argument
 * changed, instead of a parallel one that could quietly diverge from it.
 */
export function generateContract(
  seed: number, tier: number, slot = 0, variant?: ContractVariant,
): Contract {
  if (variant) return generatePatternContract(seed, tier, slot, variant);
  if (slot % DAILY_COUNT === PATTERN_SLOT) return generatePatternContract(seed, tier, slot);
  const rng = mulberry32(seed + slot * 7919);
  let budget = budgetForTier(tier);

  // 3-5 base lines, deepened by tier. The tier bonus used to cap at 3 (topping
  // out at tier 6); the same playtest that trimmed SLACK found the top tiers
  // coasting on goals they had outgrown, so tiers 8+ now ask up to one line
  // deeper. Low tiers are untouched — below the cap the ramp is identical.
  const goal = 3 + Math.floor(rng() * 3) + Math.min(4, Math.floor(tier / 2));

  let pieceSize: PieceSize = "std";
  let windMax = 0;
  let slack = SLACK;
  let material: ContractMaterial | null = null;
  let materialRate = 0;
  const notes: string[] = [];

  // Wind scales with tier rather than rolling free. A first-tier Contract
  // drawing the same crosswind as bay 8 of a Deep Run is exactly the "unfair,
  // and you could see it coming" failure the weather rework existed to remove.
  // Halved with the Deep Run ladder (2026-08-22, level.ts's BALANCE KNOBS
  // note): the ceiling is bay 10's windMax (0.15), so no Contract is ever
  // windier than the windiest bay the run itself deals.
  const windCap = Math.min(0.15, 0.025 + Math.max(0, tier - 1) * 0.015);

  // Which materials this tier's Contracts may ship — empty until the hazard
  // ladder's first countable material rung (cryo, Mark 4). Empty is the whole
  // low-tier story: a new player's Contracts stay clean-belt puzzles.
  const materialPool = contractMaterialsFor(tier);

  // `note` is a thunk because the material note names WHICH material the
  // apply() drew — a Contract that says "special shipments" without saying
  // which is a brief the player can't plan against.
  const options: { id: keyof typeof COST; apply: () => void; note: () => string }[] = [
    {
      id: "material",
      // Lean toward the ladder's newest rung: "Mark N's Contracts introduce
      // the material Mark N's Deep Run will throw at you" (docs/DESIGN.md) only
      // happens if the fresh material actually turns up on the board.
      apply: () => {
        const m = rng() < 0.5
          ? materialPool[materialPool.length - 1]
          : materialPool[Math.floor(rng() * materialPool.length)];
        material = m;
        materialRate = contractMaterialRate(m, tier);
      },
      note: () => `${MATERIAL_SPEC[material!].name.toLowerCase()} shipments`,
    },
    { id: "wind", apply: () => { windMax = windCap * (0.6 + rng() * 0.4); }, note: () => "crosswind" },
    { id: "tightLaunches", apply: () => { slack = SLACK_TIGHT; }, note: () => "tight launch budget" },
    // Micro is generated but rare: playtesting found the 2-cube payload tedious
    // rather than merely weak (see docs/DESIGN.md), so it stays in the pool as a
    // known-rough option instead of being a third of every draw.
    { id: "micro", apply: () => { pieceSize = "tiny"; }, note: () => "micro dominoes" },
  ];

  // The budget gates WHICH complications are affordable; this caps HOW MANY.
  // Without it the generator spends the budget exhaustively, so every Contract
  // above a threshold carries every complication and the whole tier collapses
  // into one bay wearing different names. Variety is the point of generating.
  const maxComplications = Math.min(3, 1 + Math.floor(tier / 3));

  // Each slot in a day leads with a DIFFERENT axis, so the three Contracts on
  // offer are three different problems rather than three rolls of one die. With
  // only four complications in the pool, independent rolls converge hard at
  // higher tiers — every Contract ends up carrying nearly the same set. Leading
  // with a rotated axis makes the daily set read as curated, which is also just
  // a better offer: pick the challenge you feel like, not the least-bad roll.
  const LEAD: (keyof typeof COST)[][] = [["wind"], ["material", "micro", "tightLaunches"]];
  const lead = LEAD[slot % LEAD.length];
  const ordered = [
    ...options.filter((o) => lead.includes(o.id)),
    ...shuffleSeeded(options.filter((o) => !lead.includes(o.id)), rng),
  ];

  for (const opt of ordered) {
    if (notes.length >= maxComplications) break;
    if (COST[opt.id] > budget) continue;
    // No countable material exists below the ladder's first material rung.
    if (opt.id === "material" && materialPool.length === 0) continue;
    // Material and micro are one slot, both ways round: the budget prices a
    // material's waste per STD shipment, and the cannon's size-normalized roll
    // (cannon.ts's rollMaterial) would double a domino belt's rate under the
    // same mix. One twist per card is also just a more legible offer.
    if (opt.id === "micro" && (pieceSize !== "std" || material !== null)) continue;
    if (opt.id === "material" && pieceSize !== "std") continue;
    // Micro stays rare even when it leads — see the note on the option itself.
    if (opt.id === "micro" && !lead.includes("micro")) continue;
    if (opt.id === "micro" && rng() > 0.4) continue;
    budget -= COST[opt.id];
    opt.apply();
    notes.push(opt.note());
  }

  // Computed AFTER the complication loop: piece size decides how many cubes a
  // launch delivers and the material decides how many of them the model expects
  // to strand, so a budget fixed before it would be wrong for every Contract
  // that drew micro or a material.
  const launches = launchesFor(
    goal, SIZE_SPEC[pieceSize].cubes, slack, contractEfficiency(material, materialRate),
  );

  return {
    id: `${seed}-${tier}-${slot}`,
    slot,
    seed: seed + slot * 7919,
    tier,
    name: NAMES[(seed + slot * 3) % NAMES.length],
    kind: "lines",
    goal,
    launches,
    queue: [],
    pieceSize,
    material,
    materialRate,
    windMax,
    // A lines Contract has no variant axis — its difficulty comes from the
    // complication budget above, and it has no exact inventory to vary the
    // rules of. "plain" and the bay's own width, so every consumer can read
    // these fields without branching on `kind` first.
    variant: "plain",
    lineCells: lineCellsForTier(tier),
    standing: [],
    brief: notes.length ? notes.join(" · ") : "clean bay",
  };
}

/**
 * The day's Contracts. Every player gets the same set from the same date, which
 * is what makes a per-Contract leaderboard mean anything and what makes the
 * daily a shared thing to talk about rather than a private shuffle.
 */
export function dailySeed(d = new Date()): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export const DAILY_COUNT = 3;

/**
 * Which daily slot is the pattern Contract. Fixed rather than rolled so the
 * board always offers one of each flavour — a player who wants the planning
 * puzzle can find it every day, and one who doesn't still has two launch-budget
 * Contracts. It CONVERTS a slot rather than adding a fourth: the daily count is
 * what Unlimited sells (docs/DESIGN.md), so quietly raising it would be a
 * monetization change wearing a content change's clothes.
 */
export const PATTERN_SLOT = 2;

export function dailyContracts(tier: number, seed = dailySeed()): Contract[] {
  return Array.from({ length: DAILY_COUNT }, (_, i) => generateContract(seed, tier, i));
}

/**
 * The order a pattern Contract's shipments actually arrive in.
 *
 * The SET is seeded and shared — every player gets the same day's inventory,
 * which is what the card advertises and what makes a per-Contract board mean
 * anything. The ORDER is re-rolled per attempt, and deliberately not seeded:
 * if it were, one unlucky permutation would make that Contract permanently
 * unwinnable for everyone who drew it, and free retries would hand back the
 * identical bad order forever.
 *
 * Re-rolling fixes permanence. It does not fix the roll, and that turned out to
 * matter: `tilingQueue` proves the inventory PACKS the goal rectangle, but a
 * packing says nothing about assembling it one shipment at a time under gravity,
 * with rows clearing the instant they fill. The tier-5 board on 2026-08-22 dealt
 * [I, I, L, L, L, J] for three lines — a set that packs, and whose canonical
 * order cannot be built by landing each shipment where it falls. 18 of its 60
 * orders are like that. A player who draws one is being asked for something that
 * does not exist, and the mode whose whole premise is that it can't beat you
 * beats them.
 *
 * So the deal is now PROVEN rather than rolled. buildable.ts searches for an
 * order and its placements together, which is what makes this affordable at bay
 * start — re-shuffling and re-checking pays for the same opening once per
 * candidate, while one search pays for it once. The randomization inside that
 * search is what preserves the property re-rolling was for: repeated attempts
 * get genuinely different orders, all of them finishable.
 *
 * Three tiers, strongest first:
 *
 *   drop — an order finishable landing every shipment straight down. Preferred
 *          because it is the one a player can REASON about: no shot has to be
 *          threaded into a pocket, so the queue looks as winnable as it is.
 *   tuck — an order finishable if a shipment may come to rest anywhere it fits
 *          with something under it. Still provably winnable, and honest about
 *          this bay: shipments arrive on an arc, tumble, shatter on the press
 *          and get shoved sideways by the bar, all of which reach places a
 *          straight drop never does. Some inventories (anything S/Z-heavy) have
 *          no drop order at all, and refusing to deal them would silently
 *          delete a third of the high-tier board.
 *   any  — a plain shuffle, if neither search finds anything inside its budget.
 *          Unreachable for the inventories the generator emits (sim/patterns.ts
 *          measures this), and here because the alternative to an awkward
 *          Contract is a crash.
 */
export function dealPatternQueue(
  c: Contract, lineCells: number, rng: () => number,
): PieceType[] {
  return buildOrder(c.queue, lineCells, rng, c.pieceSize, "drop", c.standing)
    ?? buildOrder(c.queue, lineCells, rng, c.pieceSize, "tuck", c.standing)
    ?? shuffleSeeded(c.queue, rng);
}

/**
 * The playable level for a Contract. Built off the standard ladder so a bay
 * still looks and feels like Tetrilaunch, then stripped of the two pressures
 * Contracts deliberately don't have:
 *
 *   launchCost 0   — no bankroll, so firing is never a spending decision, and
 *                    the broke-loss can't trigger (score >= 0 always holds).
 *   timeLimitSec 0 — no clock. A puzzle you can be rushed out of isn't one.
 *
 * targetScore is set unreachably high rather than to 0: the funds path must
 * never be what ends a Contract, and a 0 target would win the bay on the first
 * frame. objectiveLines is the real win condition (see game.ts's objectiveMet).
 *
 * `rng` orders a pattern Contract's queue and defaults to Math.random — i.e.
 * UNSEEDED, deliberately, which is the one place a Contract is not reproducible
 * from its id. See dealPatternQueue for why the order is re-rolled per attempt
 * and, since the [I, I, L, L, L, J] board, PROVEN finishable rather than merely
 * shuffled. Re-rolling costs a determinism the leaderboard doesn't need — the
 * SET is the challenge, and everyone gets the same one.
 */
export function levelForContract(c: Contract, rng: () => number = Math.random): LevelConfig {
  const cfg = makeBaseLevel(Math.min(9, c.tier));
  cfg.id = 1;
  cfg.name = c.name;
  cfg.launchCost = 0;
  cfg.timeLimitSec = 0;
  cfg.targetScore = Number.MAX_SAFE_INTEGER;
  cfg.objectiveLines = c.goal;
  cfg.pieceSize = c.pieceSize;
  cfg.windMax = c.windMax;
  // The SAME fraction Deep Run bays are sized with (level.ts) — this used to
  // be a hardcoded 0.025 that silently forked from WIND_GUST_FRACTION the
  // moment the fraction was retuned; importing the constant makes that fork
  // impossible.
  cfg.windGust = c.windMax * WIND_GUST_FRACTION;
  // The two limits are alternatives, never both: a pattern bay is bounded by
  // its queue and a lines bay by its launch budget, and a bay carrying both
  // would be counting the same limit twice under two names.
  if (c.kind === "pattern") {
    // The bay's line width comes from the CONTRACT, not the ladder: a "short"
    // Contract's inventory is sized to a 6-cell row and a bay still asking for
    // 8 would be an inventory two cubes short of every line. Written before the
    // deal, because the deal is proven against this width.
    cfg.compactorMinLineCells = c.lineCells;
    // The press must keep a cell of travel or it stops moving entirely — the
    // same floor hazards.ts's sweeper axis respects, for the same reason.
    cfg.compactorOpenCells = Math.max(c.lineCells + 1, cfg.compactorOpenCells);
    cfg.launchBudget = 0;
    cfg.pieceQueue = dealPatternQueue(c, cfg.compactorMinLineCells, rng);
    cfg.standingWall = [...c.standing];
    cfg.hideNextPreview = variantSpec(c.variant).blind;
  } else {
    cfg.launchBudget = c.launches;
    cfg.pieceQueue = null;
  }
  // Nothing is spent, so nothing needs to be earned back.
  cfg.startingFunds = 0;
  cfg.penaltyPerLostPiece = 0;
  // The belt carries EXACTLY what the Contract priced: the base mix is zeroed
  // rather than inherited (inheriting a clean mix is only true by accident —
  // makeBaseLevel defaults to Mark 1, below every hazard's rung), then the
  // Contract's own material is written in at the rate its launch budget was
  // computed against.
  //
  // This remains a feasibility guarantee, not a taste call. `launchesFor` now
  // prices the material's expected extra waste (MATERIAL_WASTE, via
  // contractEfficiency), which is what finally honors docs/DESIGN.md's "in
  // both pools" — but only for materials whose cubes CAN count. Slag can't
  // (ContractMaterial excludes it structurally).
  //
  // A PATTERN Contract's belt is the same field at rate 1 rather than a
  // probability, because a variant that ships rebar ships rebar — a per-shipment
  // roll would make "nothing shatters" true of most of the bay, which is a
  // different and much worse promise than the card's. Only rebar and magnetic
  // are eligible there; see generatePatternContract's note on why the other
  // four would un-prove the tiling.
  cfg.materialMix = { ...NO_MATERIALS };
  if (c.material) cfg.materialMix[c.material] = c.materialRate;
  return cfg;
}
