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
import { bayMusic, RUN_LEVELS, type BayTrack } from "./run";
import { MARK_COUNT } from "./upgrades";
import {
  MATERIAL_SPEC, PIECE_TYPES, type Material, type PieceSize, type PieceType,
} from "./theme";

/**
 * THE SKYDECK'S OWN BOARD — one rung above the ladder, and the only board that
 * is not a Mark.
 *
 * A Contract tier IS the Mark it is generated against everywhere else
 * (contractMaterialsFor), and markUnlocked saturates at MARK_COUNT, so the
 * ladder can never produce this number. That is exactly what makes it usable as
 * the roof's key: the Skydeck is a floor, not a rung (skydeck.ts), and its
 * board has to be addressable by the same (seed, tier, slot) function every
 * other board is or it stops being reproducible, shareable and cacheable.
 *
 * The consequences of it being off the ladder are all the right ones and none
 * of them needed new code:
 *
 *  - meta.ts's recordContractClear banks a milestone share only when
 *    `contract.tier === markUnlocked(meta)`, which this never equals. So a
 *    Skydeck Contract pays no salvage and ticks no tier — the same rule the
 *    Skydeck run already keeps (skydeckRunFor grants no scrap), for the same
 *    reason: the ladder is finished, and a mode that only ever accumulates is
 *    a number pretending to be a decision.
 *  - Contract ids embed the tier, so the roof's board never collides with the
 *    tier-10 board in `claimedContracts`. A player can still clear their
 *    tier-10 quota by parking the car back on the ladder.
 *
 * screens.ts's SKYDECK_TIER is the same integer, arrived at independently as a
 * tower sentinel; sim/systems.ts pins that the two agree, because a UI floor
 * that addressed a different board than the generator deals would be a screen
 * showing someone else's Contracts.
 */
export const SKYDECK_CONTRACT_TIER = MARK_COUNT + 1;

/** True for the roof's board. A predicate rather than `=== SKYDECK_CONTRACT_TIER`
 *  at four call sites, because every one of them is asking the same design
 *  question — "is this the floor that ships pentominoes" — and a comparison
 *  repeated is a comparison that gets one of its copies wrong. */
export function isSkydeckBoard(tier: number): boolean {
  return Math.floor(tier) >= SKYDECK_CONTRACT_TIER;
}

/**
 * The line width a PENTOMINO pattern Contract is played at, and the whole
 * reason bulk cargo is finally dealable at all.
 *
 * A zero-waste inventory makes the goal a `goal` x `lineCells` rectangle
 * (tiling.ts), and no set of 5-cube pieces fills an area that is not a multiple
 * of 5. At the bay's own 8-cell line that is true only when the goal is itself a
 * multiple of 5 — a 40-cube, 8-shipment monster or nothing, which is why
 * patternSize refused bulk outright and said "it becomes available the day a
 * wider line does". Ten is that day: `goal * 10` divides by 5 at EVERY goal, so
 * the divisibility loop in patternGoal never has to move a Wide Gauge goal, and
 * the tier's own ladder decides the size of the puzzle instead of arithmetic.
 *
 * Divisibility is necessary and not sufficient — an area that counts right can
 * still tile nothing (the [I,O,J,J] bug was exactly that) — so it was measured
 * against the shipped shape table rather than argued from the arithmetic.
 * PENTA_SHAPES holds seven genuine pentominoes fitted to a 4x4 box with no
 * straight I-pentomino among them (theme.ts says why), and over 30 seeds per
 * goal at four distinct shapes, tilingQueue found a tiling for goals 2, 3, 4, 5
 * and 6 on all 30 — and `tilesRegion`, the independent checker, agreed with
 * every one. At 8 cells only goal 5 tiles at all.
 *
 * It also fits the bay it will be played in without touching the ladder: the
 * press opens at compactorOpenCells = 12 and closes to 8, so ten is a width the
 * compaction zone already passes through. levelForContract writes it as the
 * bay's min-line stop, which leaves the press two cells of travel — narrower
 * than stock, wider than the floor levelForContract enforces, and strictly more
 * cubes a row than any other Contract in the game asks for.
 */
export const PENTOMINO_LINE_CELLS = 10;

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

/**
 * How many Contracts a day's board deals.
 *
 * Lives up here, ahead of the bed window, because the window is exactly this
 * wide: the size of the board and the stretch of the soundtrack it walks are
 * the same number, and a fourth card would have to move CONTRACT_BED_TOP_BASE
 * with it. See PATTERN_SLOT for what the count means to the board itself.
 */
export const DAILY_COUNT = 3;

/**
 * The deepest bay a board's bed window may START at — the last anchor whose
 * DAILY_COUNT-wide window still lands inside the beds that exist. At ten bays
 * and a three-card board that is bay 8, which is why tiers 8, 9 and 10 all deal
 * bays 8, 9 and 10: past there the window cannot walk without running off the
 * end of the ladder.
 *
 * Clamping the BASE rather than each slot is the load-bearing half. Clamping
 * per slot would deal the closer twice on a tier-9 board and three times on a
 * tier-10 one, which throws away the reason the beds are indexed at all — three
 * cards that never sound like each other.
 */
export const CONTRACT_BED_TOP_BASE = RUN_LEVELS - DAILY_COUNT + 1;

/**
 * Which bay's bed Contract `slot` borrows on a tier-`tier` board.
 *
 * The board's three cards walk a window of consecutive bays anchored at the
 * tier they were generated for: window base = min(tier, CONTRACT_BED_TOP_BASE),
 * and the slot index walks up from there. Tier 2 deals bays 2, 3 and 4; tier 3
 * deals 3, 4 and 5.
 *
 * The tier is the anchor because a Contract tier IS the Mark it is generated
 * against (see contractMaterialsFor) — it is the one number on the card that
 * already means depth. A fixed slot table sent every board back to bays 1-3, so
 * a tier-7 Contract carrying Mark 7's materials played the bed a new player
 * hears in their first minute; walking the window makes the board sound like the
 * depth it is asking to be played at.
 *
 * Indexed rather than rolled, exactly as the fixed table was: the day's three
 * Contracts always sound different FROM EACH OTHER, a Contract you retry sounds
 * the same as it did, and the one next to it never sounds like it.
 *
 * The last step goes through run.ts's bayMusic rather than naming a role
 * directly, because the window is over BAYS and not over songs — a bay on loan
 * from an earlier bay's bed while its own is written has to reach Contracts too,
 * or the two halves of the game disagree about what bay 4 sounds like.
 */
export function contractSlotBed(tier: number, slot: number): BayTrack {
  // Clamped at both ends: bayMusic would clamp a base below 1 for us, but into a
  // window whose first two slots are the SAME bed, which is the one thing the
  // indexing exists to prevent.
  const base = Math.min(Math.max(1, Math.floor(tier)), CONTRACT_BED_TOP_BASE);
  // bayMusic indexes bays from 0; `base` is a bay number.
  return bayMusic(base - 1 + (slot % DAILY_COUNT));
}

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
 *
 *     This rule was written before anything could satisfy it — the pentomino
 *     was removed from the pool in the same pass that added it. The SKYDECK
 *     BOARD is what finally does (see SKYDECK_CONTRACT_TIER and patternSize),
 *     and it reaches this bed by the rule as written rather than by a floor
 *     check: nothing below knows the roof exists, it only knows what is on the
 *     belt. The cost is that the roof's three cards all sound like each other,
 *     where the slot window exists to keep a board's three apart — and that is
 *     the right trade on exactly this floor, because there the belt IS the
 *     board's identity, which is the claim rule 2 already makes.
 *  3. **The slot's bed in the tier's window** — see contractSlotBed.
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
  return contractSlotBed(c.tier, c.slot);
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
 *  - "wide"    10-cell lines, and PENTOMINOES. The roof's variant, and the
 *              only one that changes the cargo as well as the rule — the two
 *              are one decision, not two, and patternSize explains why.
 */
export type ContractVariant =
  | "plain" | "single" | "short" | "rebar" | "salvage" | "blind" | "guided" | "wide";

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
  /** The payload this variant FORCES, or null to let patternSize roll one.
   *
   *  Only "wide" sets it, and it has to: a pentomino inventory is exact only
   *  where `goal * lineCells` divides by 5, so the cargo and the width are one
   *  decision. A variant that carried the width and left the payload to a roll
   *  would deal an untileable region two thirds of the time — see patternGoal's
   *  divisibility loop, which would silently walk the goal somewhere else
   *  instead of failing. */
  size: PieceSize | null;
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
 *
 * WIDE GAUGE is the one rung that is not a Mark, because the floor it belongs
 * to is not one either (SKYDECK_CONTRACT_TIER). It is also the only variant the
 * board never rolls AGAINST anything: on the roof the pattern slot is dealt
 * Wide Gauge every day, the way the Skydeck run's clauses are dealt rather than
 * drafted (skydeck.ts). A floor whose whole premise is "nobody tunes this to
 * their taste" does not then offer a menu.
 */
export const VARIANTS: VariantSpec[] = [
  { id: "plain", name: "Standard", tier: 1, material: null, lineCells: null, size: null, goalBonus: 0, oneShape: false, salvage: false, blind: false },
  { id: "single", name: "Single Stock", tier: 3, material: null, lineCells: null, size: null, goalBonus: 1, oneShape: true, salvage: false, blind: false },
  { id: "short", name: "Narrow Gauge", tier: 4, material: null, lineCells: 6, size: null, goalBonus: 0, oneShape: false, salvage: false, blind: false },
  { id: "rebar", name: "Full Rebar", tier: 5, material: "rebar", lineCells: null, size: null, goalBonus: -1, oneShape: false, salvage: false, blind: false },
  { id: "salvage", name: "Part Load", tier: 6, material: null, lineCells: null, size: null, goalBonus: 0, oneShape: false, salvage: true, blind: false },
  { id: "blind", name: "Blackout", tier: 7, material: null, lineCells: null, size: null, goalBonus: 0, oneShape: false, salvage: false, blind: true },
  { id: "guided", name: "Guided", tier: 9, material: "magnetic", lineCells: null, size: null, goalBonus: 1, oneShape: false, salvage: false, blind: false },
  // goalBonus 0 — the shared ladder, unmodified, which at this tier is 4 rows.
  // That is 40 cubes in 8 pentomino shipments, and the number was MEASURED
  // rather than chosen. The obvious pick was -1: 3 rows of 10 is 30 cubes in 6
  // shipments, one notch under the ladder's hardest tetromino pattern (tier 9,
  // 32 cubes in 8), and it reads like the cautious first cut of a new variant.
  //
  // It is unshippable, and for a reason nothing about difficulty would have
  // caught: a 3x10 rectangle has almost no distinct pentomino tilings. Over 30
  // seeds, tilingQueue at four shapes produced FOUR distinct inventories — a
  // "daily" board that deals the same puzzle every third day forever. At 4 rows
  // the same sweep produced 24 of 30 distinct, which is the ladder's own figure
  // (tier-9 Standard: 27 of 30). Region area is what buys a generated board its
  // variety, and 30 cells is simply below the knee.
  //
  // The cost is paid where a Contract can afford it. The share of RANDOM
  // arrival orders finishable by straight drops runs 24.7% here against the
  // tier-9 tetromino pattern's 57.5% — but a player is never handed a random
  // order (dealPatternQueue proves one before the bay opens), retrying is free,
  // and packing badly is the exam on this floor rather than the accident.
  { id: "wide", name: "Wide Gauge", tier: SKYDECK_CONTRACT_TIER, material: null, lineCells: PENTOMINO_LINE_CELLS, size: "bulk", goalBonus: 0, oneShape: false, salvage: false, blind: false },
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
  /** The complications alone — what the bay imposes, with nothing the plant
   *  panel already states beside it. `brief` is this plus whatever the CARD
   *  needs and the panel does not: on a pattern Contract, the shipment count
   *  (the panel has it as a readout column and as a manifest row). Split so the
   *  HUD does not have to do string surgery on a generated sentence, and so the
   *  card cannot change when the panel does. */
  conditions: string;
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

/** A lines Contract's complications. "clean bay" rather than an empty string
 *  is a guard, not a live case: budgetForTier never returns below 2, wind and
 *  tightLaunches cost 2 each and carry no option-specific `continue` gate
 *  (material and micro do), and maxComplications is always at least 1 — so
 *  one of the two ungated options is always both affordable and roomed for.
 *  Measured at 0 "clean bay" results across 72,000 generated lines Contracts
 *  (tiers 1-12, 3000 seeds each, both daily lines slots). Kept so the plant
 *  panel's conditions row can never collapse to nothing if a future budget or
 *  gating change opens a path to zero complications. */
function linesConditions(notes: readonly string[], cargo?: string): string {
  // `cargo` leads, because it is not a complication the budget bought — it is
  // what the floor ships, so it is true of the bay before any roll happens.
  // Passed in rather than pushed onto `notes` by the caller so it cannot spend
  // one of maxComplications' slots: a standing property that crowded out a
  // rolled one would make the roof's cards LESS varied than the ladder's.
  const all = cargo ? [cargo, ...notes] : notes;
  return all.length ? all.join(" · ") : "clean bay";
}

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
 * Pentominoes were removed from the LADDER's pool on playtest feedback: they
 * pack visibly worse than tetrominoes, so a bulk Contract read as a dice roll
 * rather than a puzzle — the exact failure a Contract must not have. Bulk was
 * also a Deep Run draft choice (mods.ts), where the player OPTS INTO it for its
 * payout; a Contract deals it to you, which is a different, worse offer.
 *
 * THAT RULE STILL STANDS, AND IT IS A RULE ABOUT THE LADDER. Tiers 1 through
 * MARK_COUNT ship no pentomino, and sim/systems.ts pins it at every one of
 * them. What changed is that the game grew a floor that is not a tier: the
 * SKYDECK board (SKYDECK_CONTRACT_TIER), whose audience has beaten all ten
 * Marks and sealed every one of them to get the door open (meta.ts's
 * skydeckOpen). The objection above is an ON-RAMP objection — "deals it to
 * you", "reads as a dice roll" — and both halves of it dissolve on a floor
 * where nothing is an on-ramp and packing badly is the exam rather than the
 * accident. The roof's Contracts are dealt for the same reason its clauses are
 * (skydeck.ts): it is the one place in the game nobody tunes to their own
 * taste.
 *
 * The dice-roll half is also answered mechanically and not only rhetorically.
 * A Contract is a dice roll when the model that budgets it cannot see what it
 * is budgeting, and two things now close that gap: SIZE_EFFICIENCY prices a
 * pentomino's worse packing from a measurement on a lines Contract, and Wide
 * Gauge gives a pattern Contract a width at which the exact inventory is
 * PROVEN to tile (PENTOMINO_LINE_CELLS). Neither existed when the removal was
 * argued.
 *
 * A material is priceable where a worse-packing shape was not: a shape changes
 * the geometry of every landing in a way the closed-form model can't see,
 * while a countable material is a per-shipment risk with a per-cube cost. The
 * model: a material shipment arrives at `materialRate`, and MATERIAL_WASTE
 * says what fraction of such a shipment's cubes the budget assumes are lost
 * beyond the standard PLANNING_EFFICIENCY waste. The budget then simply prices
 * fired cubes at the reduced effective efficiency — same closed form, one more
 * factor, still provable in sim/systems.ts. SIZE_EFFICIENCY is that same trick
 * applied to the shape, and what makes it possible now is that the number was
 * measured instead of assumed.
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
 * How much of PLANNING_EFFICIENCY a payload size actually delivers — the factor
 * that lets the closed-form budget price a SHAPE, which is the thing it could
 * not do when bulk was removed.
 *
 * MEASURED, on a bay-10 Contract bay stripped exactly the way levelForContract
 * strips one (no clock, no launch cost, no fine, clean belt), 40 launches a bay
 * across 12 seeds a condition, reading the ratio the budget is priced on:
 * cubes landing in a completed line, over cubes fired.
 *
 *     bot       std     bulk    bulk/std
 *     aim       0.738   0.620   0.841
 *     lob-flat  0.554   0.610   1.101
 *
 * Two things in that table are worth stating out loud. First, the pentomino is
 * NOT uniformly worse: the fixed-arc bot does better with it, because a bulk
 * shipment lands at 1.35x cube density and 1.6x joint strength (pieces.ts's
 * SIZE_SPEC) and its weight squares the pile under it — which is worth more to
 * a bot that cannot aim than the packing costs it. Second, the aiming bot
 * loses 16%, and that is the number a budget has to believe, because the
 * player it models is the one who can actually place a piece and is therefore
 * the one the extra cube gets in the way of.
 *
 * So bulk is set to 0.85 — the worse of the two ratios, rounded toward the
 * pessimistic side, which is the same asymmetry argument PLANNING_EFFICIENCY
 * itself is set on: a low number is a slightly dull Contract, a high one is an
 * unwinnable one. tiny measured 0.717/0.683 against std's 0.738/0.554 — the
 * same or better per cube — so it stays at 1, and std is 1 by definition. Those
 * two being 1 is what makes this table a provable NO-OP for every ladder tier;
 * sim/systems.ts pins that too.
 */
export const SIZE_EFFICIENCY: Record<PieceSize, number> = {
  tiny: 1, std: 1, bulk: 0.85,
};

/**
 * The share of launched cubes the budget model assumes reach a completed line,
 * for a belt carrying `material` at `rate`, shipping `size` payloads. The
 * material-free std case is exactly PLANNING_EFFICIENCY. Exported so
 * sim/systems.ts asserts feasibility against the same model the generator
 * priced with — the whole guarantee is that these are one formula, not two
 * copies.
 */
export function contractEfficiency(
  material: ContractMaterial | null,
  rate: number,
  size: PieceSize = "std",
): number {
  const waste = material ? MATERIAL_WASTE[material] : 0;
  return PLANNING_EFFICIENCY * SIZE_EFFICIENCY[size] * (1 - rate * waste);
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
 * Bulk is no longer absent, and the condition this note set is exactly the one
 * that was met. It read: "Pentominoes tile a 10-wide line at every goal from 2
 * to 6, but at the 8-wide line every tier actually ships, `goal * 8` divides by
 * 5 only at goal 5 — a 40-cube, 8-shipment monster or nothing. It becomes
 * available the day a wider line does." Wide Gauge is that wider line
 * (PENTOMINO_LINE_CELLS), so bulk arrives WITH it and only with it: a variant
 * carries the payload rather than this roll, which is why VariantSpec.size
 * exists. Nothing on the ladder sets it, so no tier's roll can reach bulk —
 * the removal stands where it was argued, and is lifted only on the floor that
 * is not a tier (see the CONTRACT MATERIALS note above for why that floor is
 * different).
 *
 * The forced size is checked BEFORE the two inert-variant returns below, not
 * after. Wide Gauge is neither oneShape nor blind, so ordering makes no
 * difference today — it is written this way because the alternative is a
 * variant that quietly ships tetrominoes on a 10-wide line, which is a legal
 * tiling and a completely different Contract from the one on the card.
 */
function patternSize(tier: number, rng: () => number, spec: VariantSpec): PieceSize {
  if (spec.size) return spec.size;
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
  // One shape means one shape, whatever the tier's variety dial says.
  const variety = spec.oneShape ? 1 : patternVariety(tier);

  // A salvage wall is arithmetic, not geometry: salvageProfile guarantees the
  // empty area divides by the payload, and nothing more. About one profile in
  // five leaves a region no set of tetrominoes tiles, and proving that takes
  // the full search — measured at 1.8 SECONDS for one dailyContracts() call,
  // on a function main.ts calls on every render of the Contracts screen.
  //
  // So walls are PROBED, cheaply, and a failing one is replaced rather than
  // argued with. A hundredth of the budget is plenty to find a tiling that
  // EXISTS — the whole point is to stop paying for disproof, and paying more
  // per probe buys only a slower way to give up (see SALVAGE_PROBE_NODES).
  for (let attempt = 0; spec.salvage && attempt < SALVAGE_WALL_ATTEMPTS; attempt++) {
    const wall = salvageProfile(goal, lineCells, cubes, rng);
    const walled = tilingQueue(
      goal, lineCells, patternPool(tier), rng, variety, size, wall, SALVAGE_PROBE_NODES,
    );
    if (walled) return { queue: canonical(walled, rng), standing: wall };
  }

  if (!spec.salvage) {
    const tiled = tilingQueue(goal, lineCells, patternPool(tier), rng, variety, size);
    if (tiled) return { queue: canonical(tiled, rng), standing: [] };
  }

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
 * How many candidate walls a salvage Contract may try, and the node ceiling
 * each probe gets. The two do NOT trade off against each other the way the
 * first cut of this assumed, and the difference is worth writing down.
 *
 * A probe's budget is spent on DISPROOF. A wall that tiles is found almost
 * immediately — half of all salvage Contracts generate in about a millisecond —
 * so raising the ceiling buys nothing except a longer wait before an untileable
 * profile is abandoned. Measured over 1000 Contracts across tiers 6-9, dropping
 * the ceiling from 20,000 nodes to 2,000 and spending the difference on more
 * candidate walls made wall retention BETTER (2.9% lost -> 1.8%) and the worst
 * generation 9x cheaper (1101ms -> 124ms). More nodes was strictly worse on
 * both counts: a fixed number of attempts sat longer on a bad profile instead
 * of drawing another one.
 *
 * These are also the numbers that keep the whole probe loop cheaper than a
 * single unbounded solve, which is the promise patternInventory's note makes
 * and sim/systems.ts now enforces — see the budget check there. Note the real cost
 * is ATTEMPTS x EXACT_ATTEMPTS x PROBE_NODES: tilingQueue re-runs its own
 * search up to EXACT_ATTEMPTS times chasing a shipment-type count, and each of
 * those runs gets the full ceiling. Six walls at 20,000 was 720,000 nodes
 * against the 1,200,000 of the unbounded call it replaced — a third off, where
 * the note claimed an order of magnitude.
 */
export const SALVAGE_WALL_ATTEMPTS = 10;
export const SALVAGE_PROBE_NODES = 2_000;

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
  // The roof DEALS its exam rather than rolling one, the same way skydeck.ts
  // deals the standing clauses instead of drafting them, and for the reason
  // stated there: a floor whose seed is the day's is only a shared board if
  // every player on it flew the same thing. Wide Gauge is also the only variant
  // whose inventory is provably exact — a rolled Standard on this floor would
  // be tetrominoes at the 8-wide line, i.e. an ordinary tier-9 Contract wearing
  // the Skydeck's name, and the pentomino would never appear at all.
  let spec = forced
    ? variantSpec(forced)
    : isSkydeckBoard(tier)
      ? variantSpec("wide")
      : pool[Math.floor(rng() * pool.length)];
  const lineCells = spec.lineCells ?? lineCellsForTier(tier);
  const size = patternSize(tier, rng, spec);
  const goal = patternGoal(tier, lineCells, size, spec.goalBonus);
  let { queue, standing } = patternInventory(spec, goal, tier, lineCells, rng, size);
  // A salvage Contract that could not get a wall is NOT a salvage Contract. It
  // used to keep the variant and its brief anyway, so the card read "0 cubes
  // already down" over an ordinary empty bay — a variant that silently became
  // another variant while still charging the player a rung of the ladder for
  // it. If the wall did not survive, the Contract presents as what it actually
  // is.
  if (spec.salvage && standing.reduce((a, h) => a + h, 0) === 0) {
    spec = variantSpec("plain");
    standing = [];
  }
  const shapes = new Set(queue).size;
  const material = spec.material;
  const conditions = patternConditions(spec, queue, shapes, size, standing);
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
    brief: `${queue.length} shipments · ${conditions}`,
    conditions,
  };
}

/**
 * The complications a pattern variant imposes — the tail of the card's brief,
 * and verbatim what the plant panel shows. Every variant has to say the thing
 * that makes it different, because a player who cannot restate a Contract in
 * their own words before firing has been handed a surprise rather than a
 * puzzle.
 *
 * No case may name the shipment count. generatePatternContract prefixes it
 * once for the card, and the panel states it as its own column and again on
 * the manifest row — a case that added it back would say it twice on the card
 * and a third time in the bay.
 */
function patternConditions(
  spec: VariantSpec, queue: readonly PieceType[], shapes: number,
  size: PieceSize, standing: readonly number[],
): string {
  // Std calls out the SHAPE count, because that (not the shipment count) is what
  // makes one tetromino pattern harder than another. Tiny has exactly one shape
  // by construction, so "1 shape" there would read as a bug rather than a
  // difficulty — it names the payload instead.
  //
  // Bulk needs BOTH. The shape count still grades the puzzle (seven distinct
  // pentominoes, unlike the domino's one), and the payload still has to be
  // named, because a player reading "4 shapes" on the roof has no other way to
  // learn that the four are five cubes each — and five-cube cargo is the single
  // biggest thing about the bay they are accepting.
  const shapeWord = `${shapes} shape${shapes === 1 ? "" : "s"}`;
  const cargo = size === "tiny"
    ? "dominoes"
    : size === "bulk"
      ? `pentominoes, ${shapeWord}`
      : shapeWord;
  switch (spec.id) {
    case "single":
      // Never names the TYPE on a domino belt: every domino is the same tile,
      // so "all L" would describe a distinction that does not exist on the
      // field. patternSize keeps this variant on tetrominoes, and this is the
      // second lock on the same door.
      return size === "tiny"
        ? `${cargo}, no waste`
        : `all ${queue[0] ?? "I"}, no waste`;
    case "short":
      return `${spec.lineCells}-cell lines, no waste`;
    case "rebar":
      return `rebar, nothing shatters, no waste`;
    case "salvage":
      return `${standing.reduce((a, h) => a + h, 0)} cubes already down, no waste`;
    case "blind":
      return `${cargo}, no preview, no waste`;
    case "guided":
      return `magnetic, self-squaring, no waste`;
    case "wide":
      // Width first, because it is the thing that is different about this bay
      // and the thing the inventory is sized to. `cargo` supplies "pentominoes"
      // on its own here — the size branch above is what names it, so this case
      // never has to, and cannot end up saying it twice if the cargo wording
      // ever changes.
      return `${spec.lineCells}-cell lines, ${cargo}, no waste`;
    default:
      return `${cargo}, no waste`;
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

  // THE ROOF'S STANDING CARGO. Not a complication and not a roll: the Skydeck
  // board ships pentominoes the way the Skydeck run flies without refits — it
  // is what the floor IS, so it costs no difficulty budget and cannot fail to
  // appear. Set before the complication loop because two of the four options
  // gate on the payload (micro and material both read `pieceSize`), and a cargo
  // decided afterwards would let the roll contradict the floor.
  let pieceSize: PieceSize = isSkydeckBoard(tier) ? "bulk" : "std";
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
    //
    // Micro still refuses any payload that is not std, which is now what keeps
    // it off the roof: a Skydeck card is a pentomino card, and a complication
    // that swapped the cargo for dominoes would delete the floor's whole
    // identity to spend two budget points.
    if (opt.id === "micro" && (pieceSize !== "std" || material !== null)) continue;
    // MATERIAL refuses a payload SMALLER than standard, where it used to refuse
    // anything that was not standard — and the change is a provable no-op on
    // every ladder tier, because below the roof the only thing that can move
    // pieceSize is micro and the two predicates are then the same one.
    //
    // Written as a cube comparison rather than as `!== "tiny"` because that is
    // what the argument above actually says: it is a DOMINO argument on both
    // counts, and both counts are about the cube count. A domino belt doubles
    // the shipments under one mix, and a domino halves the cubes a priced
    // shipment carries. A pentomino moves both the other way, and MATERIAL_WASTE
    // is a FRACTION of a shipment's cubes, so contractEfficiency prices it
    // correctly at any size at or above standard. Refusing here would leave the
    // roof — the deepest board in the game — as the one board that never ships
    // a material.
    if (opt.id === "material" && SIZE_SPEC[pieceSize].cubes < SIZE_SPEC.std.cubes) continue;
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
    goal, SIZE_SPEC[pieceSize].cubes, slack,
    contractEfficiency(material, materialRate, pieceSize),
  );
  // The payload is named on the card only where it is not the default one. A
  // domino card already says "micro dominoes" as a complication note it paid
  // for; a pentomino card says it here, because nothing bought it.
  const conditions = linesConditions(
    notes, pieceSize === "bulk" ? "pentomino shipments" : undefined,
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
    brief: conditions,
    conditions,
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

/**
 * Which daily slot is the pattern Contract. Fixed rather than rolled so the
 * board always offers one of each flavour — a player who wants the planning
 * puzzle can find it every day, and one who doesn't still has two launch-budget
 * Contracts. It CONVERTS a slot rather than adding a fourth: the daily count is
 * what Unlimited sells (docs/DESIGN.md), so quietly raising it would be a
 * monetization change wearing a content change's clothes.
 */
export const PATTERN_SLOT = 2;

/**
 * The day's board, MEMOISED.
 *
 * A Contract is a pure function of (seed, tier, slot), which made this look free
 * to call — and main.ts calls it on every render of the Contracts screen, and
 * again when a card is tapped. It is not free: a salvage variant probes candidate
 * walls against the tiling solver, and a board carrying one was measured at 590ms
 * even after that probing was bounded. Recomputing it per render spends that on
 * every repaint of a screen whose content cannot have changed.
 *
 * Keyed on exactly the inputs, so the cache can never serve the wrong board: a
 * date rollover changes the seed and therefore the key. The map is bounded
 * because the key space a session touches is — one tier, a handful of seeds.
 */
const DAILY_CACHE = new Map<string, Contract[]>();

export function dailyContracts(tier: number, seed = dailySeed()): Contract[] {
  const key = `${seed}:${tier}`;
  const hit = DAILY_CACHE.get(key);
  if (hit) return hit;
  const board = Array.from({ length: DAILY_COUNT }, (_, i) => generateContract(seed, tier, i));
  DAILY_CACHE.set(key, board);
  return board;
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
  //
  // The spill fine's TIER RAMP (level.ts's penaltyPerLostPieceFor) deliberately
  // stops here rather than being re-derived off the Contract's own tier. A
  // Contract has a tier, so it COULD ramp — but it has no bankroll to drain, no
  // launch price and no funding target, so a fine has nothing to be measured
  // against and nothing to take away. What a Contract asks for is the pattern,
  // and the answer to a spilled cube is already the harshest one the mode has:
  // a launch budget with one fewer shipment left in it.
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
