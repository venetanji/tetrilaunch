import { HAZARDS, MATERIAL_CAP, materialRate, type HazardId } from "./hazards";
import { MATERIAL_GAP } from "./belt";
import {
  makeBaseLevel, penaltyPerLostPieceFor, PILE_TIERS, TIER_COUNT, type LevelConfig,
} from "./level";
import { VOLATILE_BLAST_CELLS } from "./lineClear";
import {
  markUnlocked, SLOT_BASE, SLOT_CAP, SLOT_PRICES, TIER_CONTRACTS_REQUIRED, type MetaState,
} from "./meta";
import { SIZE_SPEC } from "./pieces";
import { REFIT_EVERY, RUN_LEVELS } from "./run";
import { CLAUSE_COUNT, CLAUSE_STOPS } from "./skydeck";
import { MATERIAL_SPEC, type Material } from "./theme";
import { MARK_COUNT, MAX_TIER, UPGRADES, type UpgradeId } from "./upgrades";
import { DRILLS, type DrillSpec } from "./drills";

/**
 * THE GUIDE — every rule the game plays by, as data.
 *
 * WHY THIS FILE EXISTS
 *
 * How to Play used to be nine hand-written cards in ui/screens.ts, and the
 * problem with them was not the layout (though see app.css's GUIDE section for
 * that): it was that they were a SAMPLE. The app ships six materials, eleven
 * ratchet axes, seven ship systems with three tiers each, two ability
 * consumables, three currencies, a congestion tax and two modes — and the
 * briefing covered the cannon, the compactor and the bankroll. Everything a
 * player meets from Tier 2 onward was taught by being hit with it.
 *
 * Sampling was the only thing nine static cards COULD do, because they were
 * copy rather than a catalogue. This is the catalogue: one row per thing a
 * player has to know, and the screen renders whatever is in it. Adding a
 * material means adding a row here, exactly as adding one means adding a row to
 * hazards.ts — and a mechanic that ships without a row is a visible hole in the
 * guide rather than an invisible one in the copy.
 *
 * WHERE THE WORDS COME FROM
 *
 * Nowhere new, wherever there is already a home. A ship system's line is
 * upgrades.ts's `blurb`, an axis's line is its HazardDef `desc`, a number is
 * read off the FLOWN Mark's bay 1 (buildTopics' `lv`) or the constant that
 * defines it. The repo's rule is that a
 * system's copy lives in exactly one place; a guide that paraphrased those
 * tables would be a second place, and the two would drift the first time a
 * price moved.
 *
 * What IS written here is the half no other surface has a home for: how you
 * PLAY against the thing. A hazard card has to state its cost in one line
 * because the player is picking it under time pressure; the guide is where
 * "cryo needs a second shot, so land it early" belongs, and it has never had
 * anywhere else to live.
 *
 * TIERS
 *
 * `tier` is the tier at which a topic becomes real — the same number, on the
 * same base, that hazards.ts's HazardDef.mark uses: the tier being FLOWN, which
 * is meta.ts's markUnlocked and one above the player's best clear. Topics past
 * it still LIST (a locked row that names its tier is a roadmap; a hidden one is
 * a surprise), but their drill will not launch: a bay teaching a material two
 * tiers before the ship can answer it teaches the wrong lesson.
 */

export type ChapterId = "basics" | "economy" | "cargo" | "pressure" | "rig" | "modes";

export interface Chapter {
  id: ChapterId;
  /** Tab label. One word wherever possible — six of these share a phone's
   *  width, and a two-word tab is what forces the row to wrap. */
  name: string;
  /** One line under the list, saying what the chapter is for. */
  blurb: string;
}

export const CHAPTERS: Chapter[] = [
  { id: "basics", name: "Basics", blurb: "The cannon, the press, and the row." },
  { id: "economy", name: "Money", blurb: "What a bay costs and what it pays." },
  { id: "cargo", name: "Cargo", blurb: "What ships on the belt, and what it does when it lands." },
  { id: "pressure", name: "Hazards", blurb: "The difficulty you choose for yourself." },
  { id: "rig", name: "The Rig", blurb: "The compactor is your ship. This is what you can bolt to it." },
  { id: "modes", name: "Modes", blurb: "Where a run is flown, and how a tier is won." },
];

export interface GuideTopic {
  id: string;
  chapter: ChapterId;
  /** Row title. */
  name: string;
  /** The row's one-line summary — what it is, in the list. */
  summary: string;
  /** The detail pane's copy. Written to the pane's cap, the same discipline
   *  screens.ts's coachSteps is held to: this pane does not scroll, so copy
   *  that outgrows it is a defect and sim/uifit fails on it. Two short
   *  paragraphs at the very most; `<b>` for the numbers that decide a play. */
  body: string;
  /** Tier at which the topic becomes real (see the header). 1 = from the
   *  first bay of the first run. */
  tier: number;
  /** The material this topic IS, for the row's glyph — the same mark the belt
   *  and the shop use (ui/components' materialIconHTML). */
  material?: Material;
  /** The upgrade track this topic IS, for the row's icon. */
  system?: UpgradeId;
  /** The ratchet axis this topic IS. Its `desc` is the summary, so the axis
   *  card and this row can never disagree about what a notch costs. */
  axis?: HazardId;
  /** The drill that teaches it by making the player do it, if there is one.
   *  Reference topics — the currencies, the tier ladder, the two modes — have
   *  none, and say so rather than launching a bay that would demonstrate
   *  nothing. */
  drill?: DrillSpec;
  /** A topic whose "drill" is somewhere the app already goes — the Guided
   *  Tutorial is a coached Deep Run, not a mock bay, so it carries the menu's
   *  own action rather than a DrillSpec. Mutually exclusive with `drill`, and
   *  never tier-gated: these are the doors a first-time player needs open. */
  cta?: { action: string; label: string; note: string };
}

/** A hazard axis's own card copy, so the guide quotes rather than paraphrases. */
function axisDesc(id: HazardId): string {
  return HAZARDS.find((h) => h.id === id)?.desc ?? "";
}
function axisName(id: HazardId): string {
  return HAZARDS.find((h) => h.id === id)?.name ?? id;
}
function axisTier(id: HazardId): number {
  return HAZARDS.find((h) => h.id === id)?.mark ?? 1;
}

/** The percentage a content axis ships its material at, one notch in — the
 *  number a material topic is honest to quote, since one notch is what the
 *  player will actually have taken the first time they meet it. */
const FIRST_NOTCH_PCT = Math.round(materialRate(1) * 100);

/**
 * One topic per ship system, generated from UPGRADES.
 *
 * Generated rather than written out because the eight tracks already carry
 * their own name, blurb and per-tier copy, and a hand-written guide row for
 * each would be seven more places for a re-priced tier to go stale. The tier
 * gate is the INSTALL's gate (meta.ts's INSTALLS), stated in the same
 * tier-numbering the Workshop's locked cards use.
 */
function systemTopics(): GuideTopic[] {
  // requiresMark counts tiers BEATEN; the tier being flown is one above, which
  // is the number every other gate in the app prints. Imported as a literal map
  // rather than from meta.ts to keep this module's imports acyclic — meta.ts
  // imports upgrades.ts, and the guide imports both.
  const gate: Record<UpgradeId, number> = {
    reactor: 1, launcher: 1, magazine: 1, bay: 2, hydraulics: 2, bonds: 3, demolition: 2,
    // The Thaw Lance opens at the tier that opens the axis it answers, which is
    // the same rule every other row here follows and the reason cryo's material
    // topic below can point at it (meta.ts's INSTALLS states the gate).
    thaw: 4,
    // Same rule: volatile opens at Mark 7 (hazards.ts), so its counter's guide
    // row opens with the tier that opens the axis.
    cushion: 7,
    // THE ONE ROW THAT IS NOT GATED ON AN AXIS, because the Incinerator does
    // not answer one: it discounts the two bills every material can run up
    // (a spilled shipment and a detonation), so there is no single axis whose
    // arrival is the right moment to open it. Tier 5 instead, which is the
    // rung MATERIAL_DRAFT_BAYS stops being dodgeable (hazards.ts) — the first
    // tier at which a player is guaranteed cargo they may have to write off.
    incinerator: 5,
  };
  // Sorted by the tier that opens each system, ties keeping the UPGRADES order
  // — so the chapter reads as the ladder the player will actually buy it in
  // rather than as the order the tracks happen to be declared.
  const order = [...UPGRADES].sort((a, b) => (gate[a.id] ?? 1) - (gate[b.id] ?? 1));
  return order.map((u) => ({
    id: `sys-${u.id}`,
    chapter: "rig" as ChapterId,
    name: u.name,
    summary: u.blurb,
    body:
      `${u.blurb}<br><b>Tier 1</b> ${u.tiers[0]}. <b>Tier ${MAX_TIER}</b> ${u.tiers[MAX_TIER - 1]}.`
      + ` Tiers 1-2 are Workshop purchases — salvage, once, yours forever, on the Mark's`
      + ` build budget; the rest up to tier ${MAX_TIER} is scrap at a refit stop, for the run.`,
    tier: gate[u.id] ?? 1,
    system: u.id,
    drill: DRILLS[`sys-${u.id}`],
  }));
}

/** One topic per material, in ladder order (the tier that opens its axis).
 *  Takes the Mark's bay 1 for the same reason buildTopics does: slag's copy
 *  quotes the demolition refund, which is a per-bay number. */
function materialTopics(lv: LevelConfig): GuideTopic[] {
  const spec: Array<{ m: Exclude<Material, "standard">; axis: HazardId; body: string }> = [
    {
      m: "cryo", axis: "cryo",
      // 249 plain characters against the 250 a material pane holds
      // (sim/systems.ts's COPY BUDGET). The lance earned its clause by taking
      // the sentence that used to end this paragraph — "land it early and low,
      // then thaw it on the way past" — because the two say the same thing and
      // only one of them names the system that does it.
      body: `Ice arrives <b>unstruck</b>: the row will not sell until something hits it`
        + ` hard, and its own landing never counts. Cryo costs a second shipment — or one`
        + ` <b>Thaw Lance</b> charge, which takes the cube the press is about to reach.`
        + ` Pressed cold, it shatters the row.`,
    },
    {
      m: "rebar", axis: "rebar",
      body: `Nothing breaks rebar, so <b>what lands is what you keep</b> — aim it whole and`
        + ` flat. The press cannot crush a bar either: it <b>labours</b> while bar stock`
        + ` stands in its path. A <b>Bond Breaker</b> splits it, and the press runs free.`,
    },
    {
      m: "slag", axis: "slag",
      body: `Dead cargo. A slag cube fills a slot and can <b>never</b> count, so a row holding`
        + ` one will not sell until it leaves the bay. Nothing passive removes it — a`
        + ` <b>Demolition Rack</b> charge is the answer, and refunds`
        + ` <b>$${lv.salvagePerCube}</b> a cube.`,
    },
    {
      m: "volatile", axis: "volatile",
      // "Aimed into a dead pile, it is a free demolition charge" used to close
      // this, and it was true — measurably so, which was the problem. The bay
      // pays for the live cargo a blast destroys now (lineClear.ts's
      // volatileLossFor), and the line that taught the old reading is the one
      // the player would have carried into the bay that bills them for it.
      // The cushion earned its clause the way the Thaw Lance earned cryo's:
      // by naming the system that does what the sentence was already telling
      // the player to do. 235 plain characters against the pane's 250, which
      // the copy-budget pin in sim/systems.ts counts.
      //
      // LANDING, not "shot", and the word is doing work: the liner insures an
      // arrival and nothing else (lineClear.ts's volatileBlast). A cube already
      // lying in a lined slot still goes off when cargo lands hard on top of
      // it, so a sentence that let the slots read as safe ground would be
      // teaching the player a rule the bay does not have.
      body: `A hard landing detonates it, taking every cube within`
        + ` <b>${VOLATILE_BLAST_CELLS} cells</b>, and every live cube it takes is billed`
        + ` <b>$${lv.volatileLoss}</b>. The trigger is impact SPEED: lob it soft, or land it on an`
        + ` <b>Impact Cushion</b> — the deep slots it lines take a much harder LANDING.`,
    },
    {
      m: "tar", axis: "tar",
      body: `Tar welds to whatever it touches, and <b>a Bond Breaker will not split it</b>.`
        + ` It still counts for lines, so it is not dead cargo — it is a decision you cannot`
        + ` take back. Put it in a row you are closing now, never in a pile you meant to`
        + ` flatten later.`,
    },
    {
      m: "magnetic", axis: "magnetic",
      body: `The one material that <b>helps</b>. A magnetic cube snaps itself square onto the`
        + ` slot grid as it settles, so a near-miss that would have wedged the pile becomes a`
        + ` clean fill. Take the notch when the alternative is a number you cannot pay.`,
    },
  ];
  return spec.map((s) => ({
    id: `mat-${s.m}`,
    chapter: "cargo" as ChapterId,
    name: MATERIAL_SPEC[s.m].name,
    summary: axisDesc(s.axis),
    body: s.body,
    tier: axisTier(s.axis),
    material: s.m,
    drill: DRILLS[`mat-${s.m}`],
  }));
}

/**
 * THE CATALOGUE.
 *
 * Order inside a chapter is teaching order, not alphabetical: a reader who
 * starts at the top of Basics and walks down has been told things in the order
 * they need them. Across chapters it is the order the player MEETS them —
 * which is why Cargo's six materials sit in their ladder order and not in the
 * order theme.ts happens to declare them.
 */
/**
 * The catalogue, built for ONE Mark.
 *
 * This was a module-level const over LEVEL_1 — the ladder's first bay at Mark
 * 1 — which was correct for exactly as long as a Mark did not change what a
 * bay costs. #88's tier ladder ended that: targetScoreFor, timeLimitFor and
 * launchCostFor all take the Mark now, so a const built at load time told a
 * Tier 10 player that launches cost $20 and the clock is 180s, when their bay
 * charges $30 and runs 144s. A guide that quotes the wrong bay is worse than
 * one that quotes none: it is read as authority, and it is the screen a player
 * opens precisely because they do not yet know the numbers.
 *
 * Memoised per Mark rather than rebuilt per render — the screen re-renders on
 * every chapter tap, and this is ~40 template literals.
 */
const CATALOGUE = new Map<number, GuideTopic[]>();

export function guideTopics(mark = 1): GuideTopic[] {
  const m = Math.max(1, Math.floor(mark));
  const hit = CATALOGUE.get(m);
  if (hit) return hit;
  const built = buildTopics(m);
  CATALOGUE.set(m, built);
  return built;
}

function buildTopics(mark: number): GuideTopic[] {
  // Bay 1 of the Mark being flown. Every money and clock figure below reads off
  // THIS, so the guide describes the bay the player's next launch opens.
  const lv = makeBaseLevel(0, mark);
  return [
  /* ---- BASICS ---------------------------------------------------------- */
  {
    id: "tutorial", chapter: "basics", tier: 1,
    name: "Guided Tutorial",
    summary: "A coached first bay — four cards, one per action, as you do it.",
    body: `A real Deep Run bay with a coach riding along: four cards, each one waiting until`
      + ` you have actually done the thing it describes. It runs on bay 1 and hands the bay`
      + ` back rather than ending the run if you lose, so there is nothing to be careful about.`
      + ` Start here if you have never fired the cannon.`,
    cta: {
      action: "tutorial",
      label: "Start tutorial",
      note: "Replays the coached bay from the beginning.",
    },
  },
  {
    id: "aim", chapter: "basics", tier: 1,
    name: "Aim & fire",
    summary: "Touch pulls back like a slingshot; a mouse points at the spot.",
    /* BOTH SCHEMES, because this page is not profile-aware. Every other
       instruction in the game renders per input family through bindings.ts's
       hint table, but the guide is a reference the player reads between bays —
       often on a different device from the one they last played on, and always
       with time to read a second sentence. Rendering only the current device's
       half would leave the other half undocumented anywhere. */
    body: `<b>On touch, pull back anywhere on the field.</b> The cannon aims <b>opposite</b> your drag —`
      + ` the further you pull, the harder it goes. A second finger on the <b>✕</b> cancels a drag.`
      + ` <b>With a mouse, hold over the spot you want.</b> The cannon solves the gentlest arc through it,`
      + ` so the meter reads how close to your limit that spot is. <b>Scroll</b> to arc over a stack.`,
    drill: DRILLS.aim,
  },
  {
    id: "rotate", chapter: "basics", tier: 1,
    name: "Rotate",
    summary: "Shipments turn in 90° steps, before they fly.",
    body: `The glowing shipment at the muzzle is the orientation that will fly, and the`
      + ` <b>⟲ / ⟳</b> rail buttons turn it in <b>90°</b> steps. Rotating is free — the cost is`
      + ` the clock, so turn while the cannon reloads.`,
    drill: DRILLS.rotate,
  },
  {
    id: "bonds", chapter: "basics", tier: 1,
    name: "Joints & shattering",
    summary: "Shipments are cubes held by joints — hard hits break them apart.",
    body: `A shipment is not a solid shape: it is cubes held together by <b>joints</b> that come apart`
      + ` when a landing stretches them too far. Deeper bays ship stiffer joints, so a hit that`
      + ` shattered a bay-1 delivery holds together in bay 8.`
      + ` Breaking is not always a loss — <b>loose cubes settle flatter</b> and pack into rows far more`
      + ` easily than a whole piece wedged on a corner.`,
    drill: DRILLS.bonds,
  },
  {
    id: "controls", chapter: "basics", tier: 1,
    name: "Controls",
    summary: "Touch, keyboard and gamepad — every binding rebindable.",
    body: `Drag anywhere to aim on touch; on desktop the cannon has keys and a pad has sticks,`
      + ` and <b>every binding is rebindable</b>.`
      + ` The rail down the side of the field carries rotate and whichever abilities your rig`
      + ` is carrying, and it can be <b>mirrored to the left edge</b> for a left-handed grip.`,
    cta: {
      action: "controls",
      label: "Open Controls",
      note: "Every binding, plus the left-handed rail.",
    },
  },
  {
    id: "row", chapter: "basics", tier: 1,
    name: "Complete a row",
    summary: "A row clears only when every slot is filled by a settled, squared-up cube.",
    body: `A row pays when <b>every one of its ${lv.compactorMinLineCells} slots</b> holds a cube that has`
      + ` settled and squared up on the grid. Nearly-aligned is not aligned — which is what the press`
      + ` is for: its stroke grinds close cubes onto the slots and closes rows you could not close by hand.`
      + ` Cargo that stops <b>short of the compactor</b> never counts, and in a Deep Run it fines you.`,
    drill: DRILLS.row,
  },
  {
    id: "compactor", chapter: "basics", tier: 1,
    name: "The compactor",
    summary: "The red bar sweeps in, presses the pile against the wall, and clears full rows.",
    body: `The red bar ping-pongs between its open stop and its full-advance stop, pressing`
      + ` everything in the zone against the right wall. Each stroke shatters joints, grinds`
      + ` near-aligned cubes square, and clears whatever that completed. It is also <b>your`
      + ` ship</b> — every refit you buy is a change to this bar.`,
    drill: DRILLS.compactor,
  },
  {
    id: "topout", chapter: "basics", tier: 1,
    name: "Topping out",
    summary: "Only completed rows remove cubes. A pile that only grows ends the bay.",
    body: `Nothing else takes cubes out of the bay. A pile that climbs to the ceiling ends the bay`
      + ` on the spot, and no amount of bankroll buys it back.`
      + ` The answer is never "one more layer": finish the row nearest the press before starting`
      + ` a new one, and spend a <b>demolition charge</b> on junk that can no longer close anything.`,
    drill: DRILLS.topout,
  },

  /* ---- MONEY ----------------------------------------------------------- */
  {
    id: "funds", chapter: "economy", tier: 1,
    name: "Funds & the target",
    summary: `Launches cost $${lv.launchCost}, rows pay $${lv.scorePerLine}, and the total IS the bay's target.`,
    body: `Funds are the one number that is both your wallet and your score.`
      + ` A launch costs <b>$${lv.launchCost}</b>, a full row pays <b>$${lv.scorePerLine}</b>,`
      + ` and the bay ends the moment your funds cross its target — <b>$${lv.targetScore}</b> in bay 1.`
      + ` A bay opens on <b>$${lv.startingFunds}</b>, i.e. about`
      + ` <b>${Math.floor(lv.startingFunds / lv.launchCost)} shots</b>, so a row built in two or`
      + ` three shots earns and a row built in six does not. That budget is the puzzle.`,
    drill: DRILLS.funds,
  },
  {
    id: "lost", chapter: "economy", tier: 1,
    name: "Lost cargo",
    summary: `Cubes that never reach the press are fined $${lv.penaltyPerLostPiece} each.`,
    // THE INCINERATOR EARNED ITS CLAUSE HERE the way the cushion earned one in
    // volatile's topic: this is the pane that teaches the fine, so it is the
    // pane that owes the player the fact that the fine can be bought down. Room
    // was made by tightening the tier-price sentence rather than by dropping
    // it — the pane is capped at 370 plain characters (sim/systems.ts's COPY
    // BUDGET) and every number below is still in it.
    body: `A cube that drops short of the zone, or bounces back out of it, blinks away and costs you`
      + ` <b>$${lv.penaltyPerLostPiece}</b> — a red −$ marks the spot. Billed <b>per cube</b>`
      + ` (a standard shipment is ${SIZE_SPEC.std.cubes}), and the tier sets the price:`
      + ` $${penaltyPerLostPieceFor(0, 1)} at Tier 1,`
      + ` $${penaltyPerLostPieceFor(0, TIER_COUNT)} and climbing at Tier ${TIER_COUNT}.`
      + ` An <b>Incinerator</b> cuts it for cargo destroyed above the power bar.`
      + ` Otherwise: does this reach the zone, before does it fit the row.`,
  },
  {
    id: "clock", chapter: "economy", tier: 1,
    name: "The clock",
    summary: `Deep Run bays run on a countdown — ${lv.timeLimitSec}s in bay 1. Contracts have none.`,
    body: `A Deep Run bay gives you <b>${lv.timeLimitSec} seconds</b> in bay 1, and the readout goes red`
      + ` and pulses in the last 20.`
      + ` Time pressure is what makes aiming a skill rather than a puzzle you can grind — so it is`
      + ` the exam's, and Contracts deliberately have <b>no clock at all</b>.`
      + ` The habit that buys the most time is lining up the next shot <i>while</i> the cannon reloads.`,
    drill: DRILLS.clock,
  },
  {
    id: "scrap", chapter: "economy", tier: 1,
    name: "Scrap",
    summary: `Earned per line and per bay, spent on the ship at a refit stop. Dies with the run.`,
    body: `Scrap is the RUN's currency: <b>${lv.scrapPerLine} a line</b> and`
      + ` <b>${lv.scrapPerBay} a bay</b>, spent at the refit stops after bays`
      + ` ${Array.from({ length: Math.floor(RUN_LEVELS / REFIT_EVERY) }, (_, i) => (i + 1) * REFIT_EVERY).join(", ")}`
      + ` on whatever rungs your permanent loadout stops short of, up to tier ${MAX_TIER}`
      + ` of the systems you own.`
      + ` It is gone when the run ends, win or lose — banking scrap is not a strategy, spending it is.`,
  },
  {
    id: "salvage", chapter: "economy", tier: 1,
    name: "Salvage",
    summary: "Paid at tier milestones, spent in the Workshop, kept forever.",
    body: `Salvage is the only currency that outlives a run. Paid at <b>tier milestones</b> —`
      + ` each first-clear Contract, and the tier's first run win — and spent in the Workshop`
      + ` on permanent installs, plus a permanent <b>tier 2</b> of an installed system`
      + ` (tier ${MAX_TIER} stays the yard's).`
      + ` It buys <b>which systems exist</b>, never the build budget itself — and never your Tier:`
      + ` a Tier is won, not bought.`,
  },
  {
    id: "congestion", chapter: "economy", tier: 1,
    name: "Congestion",
    summary: `Past ${PILE_TIERS[0].cubes} loose cubes the bay taxes every shot and every payout.`,
    body: `Firing into a bay that is already full is priced, in three places at once. Past`
      + ` <b>${PILE_TIERS[0].cubes} loose cubes</b> launches cost <b>×${PILE_TIERS[0].costMult}</b>,`
      + ` the reload runs <b>×${PILE_TIERS[0].reloadMult}</b> longer and a cleared row pays only`
      + ` <b>${Math.round(PILE_TIERS[0].payMult * 100)}%</b>; past <b>${PILE_TIERS[1].cubes}</b> it is`
      + ` <b>×${PILE_TIERS[1].costMult}</b>, <b>×${PILE_TIERS[1].reloadMult}</b> and`
      + ` <b>${Math.round(PILE_TIERS[1].payMult * 100)}%</b>.`
      + ` The bay floor lights up as you cross each rung. <b>Bay Extension</b> is what buys the`
      + ` allowance back.`,
    drill: DRILLS.congestion,
  },

  /* ---- CARGO ----------------------------------------------------------- */
  {
    id: "sizes", chapter: "cargo", tier: 1,
    name: "Shipment sizes",
    summary: "Micro dominoes, standard tetrominoes, bulk pentominoes — weight and rigidity change with the shape.",
    body: `<b>Micro</b> (${SIZE_SPEC.tiny.cubes} cubes) are precise, and too light to square up`
      + ` the pile beneath them. <b>Bulk</b> (${SIZE_SPEC.bulk.cubes} cubes) land heavy enough to`
      + ` press the layers below flat, and are <b>×${SIZE_SPEC.bulk.breakMult}</b> harder to`
      + ` shatter. Size is the bay's, not a per-shot choice.`,
    drill: DRILLS.sizes,
  },
  ...materialTopics(lv),

  /* ---- HAZARDS --------------------------------------------------------- */
  {
    id: "ratchet", chapter: "pressure", tier: 1,
    name: "The axis ratchet",
    summary: "Clear a bay, then ratchet one difficulty axis — permanently, for the rest of the run.",
    body: `Every bay you clear deals a hand of <b>two axes</b>, and you must take a notch on`
      + ` one. It sticks for the rest of the run, and each further notch on the same axis costs`
      + ` more than the last. A notch is <b>pure cost</b> — the reward is that the axis you are`
      + ` equipped for is the one you can afford. At tier <b>${MARK_COUNT}</b> the draft asks`
      + ` for two.`,
  },
  {
    id: "axis-cost", chapter: "pressure", tier: axisTier("cost"),
    name: axisName("cost"), summary: axisDesc("cost"), axis: "cost",
    body: `${axisDesc("cost")}<br>The ladder is Fibonacci, so the fourth levy hurts far more than four`
      + ` first ones — and it starts further up the ladder the higher the tier you are flying.`
      + ` <b>Reactor Output</b> is the answer that exists inside a run: a bigger float and a better rate`
      + ` per line both pay the levy back.`,
  },
  {
    id: "axis-time", chapter: "pressure", tier: axisTier("time"),
    name: axisName("time"), summary: axisDesc("time"), axis: "time",
    body: `${axisDesc("time")}<br>Its ladder runs one rung ahead of the fuel levy's, deliberately:`
      + ` money has an in-run answer and the clock does not.`
      + ` The floor is <b>45s</b>, so the axis can never reach an unplayable bay.`
      + ` <b>Loader Magazine</b> is the nearest thing to a counter — a shorter reload is more shots`
      + ` inside the same clock.`,
  },
  {
    id: "axis-wind", chapter: "pressure", tier: axisTier("wind"),
    name: axisName("wind"), summary: axisDesc("wind"), axis: "wind",
    body: `${axisDesc("wind")}<br>Each bay rolls a steady <b>average</b> and gusts gently around`
      + ` it, so it is a bias to learn rather than a coin flip. <b>Launcher Coils</b> answer it`
      + ` from both sides — more muzzle speed, and a stabilizer that cancels part of the wind`
      + ` outright.`,
    drill: DRILLS["axis-wind"],
  },
  {
    id: "axis-sweeper", chapter: "pressure", tier: axisTier("sweeper"),
    name: axisName("sweeper"), summary: axisDesc("sweeper"), axis: "sweeper",
    body: `${axisDesc("sweeper")}<br>Two costs in one notch: less room to land in, and less time between`
      + ` strokes to use it. It is the axis that punishes a slow, tidy player hardest.`
      + ` <b>Bay Extension</b> buys the cells straight back, and <b>Press Hydraulics</b> turns the extra`
      + ` strokes from a threat into more chances to close a row.`,
    drill: DRILLS["axis-sweeper"],
  },
  {
    id: "materials-axis", chapter: "pressure", tier: 4,
    name: "Material axes",
    summary: `Six of the axes put a MATERIAL on the belt instead of raising a number.`,
    body: `From tier 4 the draft deals content: a notch ships <b>${FIRST_NOTCH_PCT}%</b>`
      + ` of a material instead of raising a number, up to`
      + ` <b>${Math.round(MATERIAL_CAP * 100)}%</b> stacked.`
      + ` The belt caps at <b>one in ${MATERIAL_GAP + 1}</b> — every material is followed by`
      + ` <b>${MATERIAL_GAP} plain ones</b> — so notches past that decide <b>which</b>, not how many.`
      + ` An ordinary hand deals at most one material; the bay before each refit deals materials only.`,
  },
  {
    id: "final", chapter: "pressure", tier: 1,
    name: "Final Inspection",
    summary: "The last draft is not a ratchet — it is two clauses on bay 10, and you take one.",
    body: `A permanent notch taken one bay before permanence expires is not a decision, so the`
      + ` <b>last</b> draft deals something else: two clauses on the final bay, one of which you`
      + ` must accept. The pair is <b>your tier's own exam</b>. Both cost about the same, and`
      + ` which is cheaper depends entirely on the ship you built.`,
  },

  /* ---- THE RIG --------------------------------------------------------- */
  {
    id: "refit", chapter: "rig", tier: 1,
    name: "Refit stops",
    summary: `After bays ${Array.from({ length: Math.floor(RUN_LEVELS / REFIT_EVERY) }, (_, i) => (i + 1) * REFIT_EVERY).join(", ")} you dock and spend scrap on the ship.`,
    body: `Three times a run the bay ends at a <b>refit yard</b> instead of straight into the next bay.`
      + ` Scrap buys whatever rungs your permanent loadout stops short of, up to tier ${MAX_TIER} —`
      + ` tiers 1 and 2 of a system are Workshop purchases, made with salvage, between runs.`
      + ` Everything bought here lasts the whole run and stacks with whatever the tier's build budget`
      + ` let you launch with.`,
  },
  {
    id: "slots", chapter: "rig", tier: 1,
    name: "Rack slots",
    summary: `A rig undocks with ${SLOT_BASE} systems aboard. Salvage buys room for more.`,
    // Every number quoted, never restated: the ladder is SLOT_PRICES read out,
    // and the roster size is UPGRADES.length, so a re-price or an eleventh
    // system moves this topic without anybody remembering it exists.
    // Every number quoted, never restated: the ladder is SLOT_PRICES read out
    // and the top is SLOT_CAP, so a re-price or an eleventh system moves this
    // topic without anybody remembering it exists. Kept short because the pane
    // caps a topic's body — see sim/systems.ts's guide-length pins.
    body: `Owning a system and <b>flying</b> it are different things. The rack holds`
      + ` <b>${SLOT_BASE}</b>; only what is in it undocks, and the rest waits in the`
      + ` <b>shed</b>, keeping every tier you paid for. Set it in the Workshop, free, before`
      + ` any run. The ${SLOT_CAP - SLOT_BASE} slots up to <b>${SLOT_CAP}</b> cost`
      + ` ${SLOT_PRICES.join(", ")} salvage — dearer as each buys less. A refit stop can only`
      + ` raise what is aboard.`,
  },
  ...systemTopics(),
  {
    id: "demolition-charge", chapter: "rig", tier: 2,
    name: "Demolition charges",
    summary: `Costs a full launch fee, and every cube vaporized refunds $${lv.salvagePerCube}.`,
    body: `A charge is <b>armed</b>, then fired by your next launch instead of the loaded`
      + ` shipment. It costs a full launch fee, and every cube vaporized refunds`
      + ` <b>$${lv.salvagePerCube}</b> — it pays for itself from three cubes.`
      + ` Blowing up a junk pile that can never close a row`
      + ` is a <b>positive-value play</b>; blowing up a row you were two cubes from closing is`
      + ` not. It is also slag's only clean answer.`,
    drill: DRILLS["demolition-charge"],
  },
  {
    id: "bondbreaker", chapter: "rig", tier: 3,
    name: "Bond Breaker",
    summary: "Shatters every joint on the field at once. A run-long consumable, not a per-bay refill.",
    body: `One charge shatters <b>every joint in the bay</b> into loose cubes, which settle`
      + ` flatter and pack into rows far more easily — the answer to a pile that has stopped`
      + ` cooperating, and the only thing that splits <b>rebar</b>.`
      + ` Charges come from the <b>Bond Emitter</b> and are a magazine for the WHOLE RUN: one`
      + ` spent in bay 3 is gone in bay 4. The trigger is <b>held</b>, not tapped.`,
    drill: DRILLS.bondbreaker,
  },

  /* ---- MODES ----------------------------------------------------------- */
  {
    id: "deeprun", chapter: "modes", tier: 1,
    name: "Deep Run",
    summary: `${RUN_LEVELS} bays, permadeath, a clock and a bankroll. The exam.`,
    body: `<b>${RUN_LEVELS} bays</b> of rising targets and stiffer joints, run end to end.`
      + ` Each bay has its own funding target and countdown; go broke or run the clock out and the run`
      + ` ends there — there are no lives.`
      + ` Between bays you ratchet an axis, and three times you refit. It is the only mode that`
      + ` posts to the leaderboard, and the only one that can raise your tier.`,
  },
  {
    id: "contracts", chapter: "modes", tier: 1,
    name: "Contracts",
    summary: "One bay, no clock, no launch cost. Failing costs nothing and you can retry forever.",
    body: `Three a day, from a shared daily seed, so everyone gets the same three. No clock and`
      + ` no bankroll — what limits you is a <b>launch budget</b>. One of the three is a`
      + ` <b>pattern</b> Contract: you are handed the exact inventory that tiles the goal, so`
      + ` every cube must end up in a completed row. Contracts are where a new material is safe`
      + ` to learn.`,
  },
  {
    // THE SEAL, at tier 1, and that is a deliberate departure from the rule the
    // Skydeck topic below states. The roof's topic is gated because a door the
    // player cannot see is not worth teaching; the seal is the opposite — it is
    // earned from the very first Mark, it is drawn on the tower from the first
    // menu (the empty sockets), and it is spent by a button on the pause modal
    // that a first-session player will press. A rule you can lose before you
    // are told about it belongs at the bottom of the catalogue.
    id: "seals", chapter: "modes", tier: 1,
    name: "Seals",
    summary: "Clear a Mark without retrying a bay and its floor is stamped. All ten stamps open the Skydeck.",
    body: `A Mark is <b>sealed</b> when you clear all ${RUN_LEVELS} of its bays in one run without`
      + ` retrying a single one. The tower stamps that floor; empty sockets are the seals still`
      + ` owed. Retrying a bay costs this run its seal and <b>nothing else</b> — the run counts, the`
      + ` salvage banks, the tier opens — and any later run can take it, a beaten Mark included.`
      + ` All <b>${MARK_COUNT}</b> seals open the Skydeck.`,
  },
  {
    // The roof, and the last thing in the catalogue to open — gated at the top
    // of the ladder because that is exactly when the floor does (screens.ts's
    // tierOpen). A topic about a door the player cannot see would teach them
    // the game is bigger than it looks and then stop.
    id: "skydeck", chapter: "modes", tier: MARK_COUNT,
    name: "The Skydeck",
    summary: "The day's fixed run, flown on the rig you brought. No yard, and the clauses are written for you.",
    body: `The floor above the ladder, open once you have beaten it and`
      + ` <b>sealed every Mark</b> (see Seals). One run a day, dealt from the date,`
      + ` so everyone flies the same one. <b>No refit stops</b>, and <b>one notch a bay</b>`
      + ` instead of the capstone's two. In their place the day writes`
      + ` <b>${CLAUSE_COUNT} standing clauses</b>,`
      + ` arming at bays ${CLAUSE_STOPS.map((c) => c.fromBay).join(", ")} and riding every bay after.`,
  },
  {
    id: "tiers", chapter: "modes", tier: 1,
    name: "Tiers & the build budget",
    summary: `A tier is won by one Deep Run clear plus ${TIER_CONTRACTS_REQUIRED} first-clear Contracts.`,
    body: `A tier completes when you have cleared its Deep Run <b>and</b>`
      + ` <b>${TIER_CONTRACTS_REQUIRED}</b> of its Contracts for the first time. It pays a`
      + ` salvage milestone, opens the next tier, and hands you a larger <b>build budget</b>.`
      + ` Nothing purchasable raises a tier — which is what keeps "cleared tier 7" worth the`
      + ` same for everyone.`,
  },
  ];
}

/** The Mark-1 catalogue. Ids, chapters and tier gates do not vary by Mark, so
 *  this is what the coverage tests and the default topic id read — never what
 *  the screen prints, which goes through guideTopics(markUnlocked(meta)). */
export const GUIDE_TOPICS: GuideTopic[] = guideTopics(1);

export function topicById(id: string, mark = 1): GuideTopic | undefined {
  return guideTopics(mark).find((t) => t.id === id);
}

/** Every topic in a chapter, in catalogue order, priced for `mark`. */
export function topicsIn(chapter: ChapterId, mark = 1): GuideTopic[] {
  return guideTopics(mark).filter((t) => t.chapter === chapter);
}

/**
 * Is this topic's drill playable on this save?
 *
 * The gate is the tier being FLOWN (meta.ts's markUnlocked), against the same
 * base HazardDef.mark uses — so the drill for a material opens on exactly the
 * tier whose draft can deal it, never earlier. A topic with no drill is never
 * "unlocked": there is nothing to unlock, and the pane says so instead.
 */
export function drillUnlocked(topic: GuideTopic, meta: MetaState): boolean {
  if (!topic.drill) return false;
  return topic.tier <= markUnlocked(meta);
}

/** The tier a locked drill is waiting for, in the tier-numbering every other
 *  gate in the app prints (meta.ts's installGates). */
export function drillGate(topic: GuideTopic): string {
  return `Tier ${topic.tier}`;
}

/** Playable things in a chapter right now — the count on its tab. Counts the
 *  CTA rows too: from the reader's side "the Guided Tutorial" and "the Cold
 *  Chain drill" are the same offer, a bay this screen can put them in, and a
 *  tab that undercounted itself would hide the one row a new player needs. */
export function unlockedDrills(chapter: ChapterId, meta: MetaState): number {
  return topicsIn(chapter).filter((t) => t.cta || drillUnlocked(t, meta)).length;
}

/** Topics in a chapter that HAVE a drill, unlocked or not. */
export function drillCount(chapter: ChapterId): number {
  return topicsIn(chapter).filter((t) => t.drill).length;
}
