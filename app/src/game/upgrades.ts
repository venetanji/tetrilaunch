import {
  DEMO_BLAST_MULT, DEMO_RESUPPLY_LINES, DEMO_SALVAGE_MULT, type LevelConfig,
} from "./level";
import { VOLATILE_TRIGGER_SPEED } from "./lineClear";

/**
 * SHIP UPGRADES — the FTL layer of the run.
 *
 * The compactor rig IS the ship: it starts at a fixed stock size and gets
 * refitted with scrap earned in-run. Seven systems, three tiers each, bought at
 * REFIT STOPS (after bays 3, 6 and 9 — see run.ts's isRefitBay). Upgrades are
 * PERMANENT for the run and are re-applied onto a fresh base level every bay,
 * exactly like drafted mods.
 *
 * How this differs from mods.ts, and why both exist:
 *  - A MOD is a contract you're OFFERED (one of three, every bay, seeded). It
 *    is usually a trade-off, it can be a bane, and you don't choose which three
 *    you see. Mods are the run's texture — what hand you were dealt.
 *  - An UPGRADE is capital you CHOSE to spend, from a menu that's always fully
 *    visible, with a known price. Upgrades are the build — what you decided to
 *    become. Nothing here is a downside; the cost is the opportunity cost of
 *    the scrap.
 *
 * Order of application matters and is fixed in run.ts's levelForRun: upgrades
 * first, then mods. So a mod's multiplier compounds ON TOP of the ship's
 * refit (e.g. Overclock's ×1.5 compactor speed multiplies the hydraulics-
 * boosted speed), which is the intended reading — the contract applies to
 * whatever ship you're flying.
 */
export type UpgradeId =
  | "bay" | "launcher" | "hydraulics" | "magazine" | "reactor" | "bonds" | "demolition"
  | "thaw" | "cushion";

export const MAX_TIER = 3;

/**
 * Thaw Lance charges per tier, PER BAY on the ladder.
 *
 * Sized against the belt, not against a feel, and the sizing is the reason the
 * unit is a bay rather than a run. hazards.ts puts cryo's first notch at
 * MATERIAL_BASE (0.07 of the belt) and belt.ts caps the belt at one special in
 * three, so a cryo run meets frozen shipments in EVERY bay, forever — 3-4 of
 * them a bay at one notch. Cryo is not an emergency, it is a TAX, and a
 * once-a-run answer to a per-bay tax is not an answer. That is this track's one
 * real disagreement with the Bond Emitter it sits beside, whose charge IS an
 * emergency reset and is therefore rightly a run-long magazine of three.
 *
 * THREE A TIER, AND THE PROPOSAL SAID TWO. The proposal's own belt arithmetic
 * is what overruled it: one notch puts "3-4 frozen cubes a bay" on the floor,
 * and a rung that covers half of them covers nothing. Measured at Tier 5 bay 5,
 * 48 paired seeds, against a 46/48 clean control and 29/48 at cryo:1:
 *
 *            2 / 4 / 6 a tier      3 / 6 / 9 a tier
 *   tier 1   29/48  (+0)           35/48  (+6)
 *   tier 2   38/48                 42/48
 *   tier 3   42/48                 43/48
 *
 * At two a tier the FIRST RUNG BUYS NOTHING — 29/48 against an un-lanced
 * 29/48, and upgrades.ts's own refit-projection note is about exactly that
 * failure ("a shop where a purchase projects nothing teaches that the purchase
 * does nothing"). At three it buys six bay-wins, and every rung above it still
 * pays: shots fall 33.3 → 32.6 → 28.0 → 26.9 against the clean bay's 25.6, and
 * ending funds climb $776 → $962 → $1149 → $1201 against its $1260. A ladder
 * that converges on the control without reaching it is the shape hazards.ts
 * asks a counter to have — the hazard survives it.
 *
 * (An earlier 24-seed pass read the first rung as actively HARMFUL, 15/24
 * against 17/24. It is flat, not harmful; that comparison was two wins wide on
 * a sample whose standard error is two. The findings doc's own rule applies —
 * no number read at 24 seeds where a 48-seed one exists.)
 *
 * WHERE IT STOPS, stated because it is the number a play pass will want to
 * raise. At three notches of cryo (17% of the belt) on a late bay, 48 paired
 * seeds: 21/48 un-lanced, 34/48 with the lance MAXED, against a 45/48 clean
 * control. So the capstone buys back a little over half of what a three-notch
 * stack costs and leaves the bay eleven wins short of a clean one; at 24 seeds
 * the lower two tiers stay inside the noise there (10/24 and 9/24 against
 * 9/24). The lance therefore scales PARTIALLY into a cryo build and never
 * erases one, which is the shape it should have — it is an answer to the
 * FORCED first notch (hazards.ts's MATERIAL_DRAFT_BAYS, from Mark 5), and a
 * player who pours every notch into cryo has bought a problem no system on the
 * shelf is sized to undo. If a cryo BUILD should be survivable, this constant
 * is the wrong lever and the material's rate is the right one.
 *
 * (This is the one place the shipped system reads STRONGER than the prototype
 * that priced it: counters.ts's rig thawed the first eligible cube in the field
 * list, and the real lance takes the cube the press is about to reach — a
 * strictly better target, and worth more the more cryo there is to choose
 * between. The proposal's "buys back two, inside the noise" was an honest
 * reading of a naive rig.)
 */
export const THAW_CHARGES_PER_TIER = 3;

/**
 * The Impact Cushion's ladder: how deep the liner runs and how soft it lands.
 *
 * A liner at the DEEP END of the bay, so the two numbers are not one knob split
 * in two — `cells` is how much of the floor is protected and `mult` is how hard
 * a shot the protected part will take. A tier buys both, and the sizing of each
 * comes from a different measurement.
 *
 * DEPTH, from where volatile actually goes off. Instrumented over 24 bays at
 * Tier 7 bay 10 with the belt at the volatile cap, across three pilot profiles
 * — 41,393 volatile first-contacts, of which 731 cleared the stock trigger.
 * The ones that DETONATE are far more tightly clustered than arrivals in
 * general, because a detonating arrival is a hard shot and a hard shot carries
 * deep:
 *
 *   depth from wall (cells)   p25    median   p75    p90    max
 *   all first-contacts        2.19   4.49     6.66   8.45   16.61
 *   detonating ones           3.81   5.24     6.37   7.34    9.10
 *
 * so a liner N cells deep covers this share of detonations: 4 cells 27%,
 * 6 cells 69%, 8 cells 98%, 10 cells 100%. The three rungs are placed on that
 * curve — a quarter, two thirds, effectively all of it — and the top rung is
 * `compactorMinLineCells` (8) rather than the round 10 the data would also
 * allow, because that is the landmark it should be: THE LINER COVERS THE SLOTS
 * A LINE IS MADE IN. Past it a cushion is protecting cargo that is not yet
 * being sold, and the 2% of detonations beyond the line zone are the deep,
 * hardest shots this system is not meant to make free.
 *
 * SOFTNESS, from the arrival distribution lineClear.ts's VOLATILE_TRIGGER_SPEED
 * was placed against: "first-contact relative speed runs 17.3 to 30.8", median
 * 19.5 on the softest lob and 25.5 at full power, threshold 22. Softening a
 * blow by a factor and raising the threshold by that factor are the same
 * arithmetic on the same comparison, so:
 *
 *   x1.15 -> 25.3, a hair under the full-power MEDIAN: inside the liner, a hard
 *            shot becomes a coin flip instead of a detonation.
 *   x1.30 -> 28.6, inside the top decile of the range.
 *   x1.40 -> 30.8, the measured MAXIMUM: inside the liner, no launch the cannon
 *            can produce sets a cube off ON ARRIVAL.
 *
 * The capstone stops exactly at the top of the range and not past it, and
 * pairing it with a liner that stops at the line zone is what keeps it a
 * counter rather than a delete button. hazards.ts's rule is that a system makes
 * one hazard cheap for you, it does not erase it — and after a maxed cushion
 * volatile still detonates when something lands hard ON it (the neighbour case,
 * which is the material's whole identity), still detonates outside the liner,
 * and still bills the bay for every live cube it takes.
 */
export const CUSHION_TIERS = [
  { cells: 4, mult: 1.15 },
  { cells: 6, mult: 1.30 },
  { cells: 8, mult: 1.40 },
] as const;

/** The trigger speed a cushion tier produces inside its liner on a stock bay.
 *  Derived so the shop copy, the guide and the docs quote the constants rather
 *  than a number typed beside them. Tier 0 is the bare threshold. */
export function cushionThreshold(tier: number): number {
  const t = Math.max(0, Math.min(CUSHION_TIERS.length, Math.floor(tier)));
  return VOLATILE_TRIGGER_SPEED * (t === 0 ? 1 : CUSHION_TIERS[t - 1].mult);
}

/** Scrap cost to go from tier t-1 to tier t, for every track. One shared
 *  ladder rather than per-track pricing: the tracks are meant to be balanced
 *  against each other by EFFECT, and a shared price keeps "which system do I
 *  want" the whole decision instead of "which is cheapest". See level.ts's
 *  SCRAP_PER_LINE note for how this ladder is sized against a run's income. */
export const TIER_COSTS = [20, 35, 55] as const;

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** 2-3 char plate glyph for the compact HUD/refit chip. */
  glyph: string;
  /** One-line "what system is this" for the refit card header. */
  blurb: string;
  /** Per-tier effect copy, index 0 = tier 1. The refit card no longer prints
   *  the whole ladder (three lines x six cards overflowed a landscape phone by
   *  145px), so this now feeds the card's `title` for hover and stays the one
   *  place the ladder is written down. */
  tiers: [string, string, string];
  /** What the ship HAS on this track at `tier`, in absolute terms (tier 0 =
   *  stock). The card used to show only deltas, which meant a player could see
   *  "+2 open cells" without ever being told the bay was 12 to begin with. */
  current(tier: number): string;
  /** The step from `tier` to `tier + 1`, for the buy button: which way the
   *  number moves and by how much. `dir` is the direction of the NUMBER, not a
   *  judgement — a shorter cooldown is an improvement that reads "down". Never
   *  called at MAX_TIER, where there is no next step to describe. */
  step(tier: number): { dir: "up" | "down"; text: string };
  /** Mutate `cfg` for a track sitting at `tier` (1..MAX_TIER). Never called
   *  with tier 0 — applyUpgrades skips unbought tracks entirely, so each
   *  implementation can assume it has work to do. */
  apply(cfg: LevelConfig, tier: number): void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "bay",
    name: "Bay Extension",
    glyph: "BAY",
    blurb: "Widens the compaction zone at the open stop — more room to land in, longer lines to sell.",
    tiers: [
      "+2 open cells (14) · +4 cubes before congestion",
      "+4 open cells (16) · +8 cubes before congestion",
      "+6 open cells (18) · +12 cubes before congestion",
    ],
    // 12 is makeBaseLevel's stock width and, now that Wide Bay is gone, the
    // only thing that moves it is this track — so the reading is exact rather
    // than an estimate that a draft could silently invalidate.
    current: (t) => `${12 + 2 * t} open cells`,
    step: () => ({ dir: "up", text: "+2 cells" }),
    apply(cfg, tier) {
      // 12 stock -> 14/16/18. This is the "extend to 18" lever, now EARNED
      // capital instead of a random Wide Bay offer: a wide bay is the standard
      // answer to a bay whose stack keeps topping out, so it should be
      // something you can decide to build toward.
      cfg.compactorOpenCells = Math.min(18, cfg.compactorOpenCells + 2 * tier);
      // The congestion tax's counter, and the reason it is a SYSTEM rather
      // than a difficulty setting. level.ts ships pileAllowance as an
      // explicit upgrade seam — "a player who invests here buys back the right
      // to fire into a fuller bay" — and nothing set it: the field was read by
      // game.ts's pileTier and swept by sim/pile.ts, but every real level got 0
      // and no purchase could move it, so the tax had no answer you could buy.
      //
      // It belongs on THIS track and not its own. A wider compaction zone
      // literally is more room for loose cargo to sit in without being in the
      // way, so the allowance is the same purchase read a second way rather
      // than a second purchase; and pricing congestion relief separately would
      // sell the player a way to opt out of the mechanic instead of a way to
      // play further into it. +4 a tier against thresholds of 32 and 48 moves
      // the first tax from four lines' worth of clutter to just under six at
      // tier 3 — later, never absent.
      cfg.pileAllowance += 4 * tier;
    },
  },
  {
    id: "launcher",
    name: "Launcher Coils",
    glyph: "LCH",
    blurb: "More muzzle energy and a lateral stabilizer — reach the back of the bay, and fight the weather.",
    tiers: [
      "+6% muzzle speed · 20% wind cancelled",
      "+12% muzzle speed · 40% wind cancelled",
      "+18% muzzle speed · 60% wind cancelled",
    ],
    current: (t) => (t === 0 ? "stock coils" : `+${6 * t}% speed · ${20 * t}% wind`),
    step: () => ({ dir: "up", text: "+6% power" }),
    apply(cfg, tier) {
      // The wind counter. A stock launcher at max power lands at x~1228 (see
      // cannon.ts's SPEED_MAX note); a strong steady headwind can pull that
      // back far enough that the deep slots are simply unreachable, which is
      // the "sometimes impossible unless you extend to 18" complaint. Coils
      // attack it from both sides: more speed to throw through the wind, and
      // a stabilizer that cancels part of the wind outright.
      cfg.launchPower *= 1 + 0.06 * tier;
      cfg.windAssist = Math.min(0.85, cfg.windAssist + 0.2 * tier);
    },
  },
  {
    id: "hydraulics",
    name: "Press Hydraulics",
    glyph: "HYD",
    blurb: "A harder, faster press — squares up a messy pile into sellable rows instead of leaving it wedged.",
    tiers: [
      "×1.6 settle assist · +8% stroke speed",
      "×2.2 settle assist · +16% stroke speed",
      "×2.8 settle assist · +24% stroke speed",
    ],
    current: (t) => (t === 0 ? "stock press" : `×${(1 + 0.6 * t).toFixed(1)} assist · +${8 * t}% stroke`),
    step: () => ({ dir: "up", text: "+0.6 assist" }),
    apply(cfg, tier) {
      // Settle assist is what converts "nearly a line" into a payout (see
      // lineClear.ts's settleZoneCubes) — the direct upgrade for a build that
      // lands a lot of loose cubes, i.e. the tiny/Autoloader line. Stroke
      // speed rides along so a refitted press also gets MORE chances per bay,
      // not just better ones.
      cfg.settleAssist *= 1 + 0.6 * tier;
      cfg.compactorSpeed *= 1 + 0.08 * tier;
    },
  },
  {
    id: "magazine",
    name: "Loader Magazine",
    glyph: "MAG",
    blurb: "Faster reload — more shots inside the same clock.",
    tiers: ["−15% cooldown", "−30% cooldown", "−45% cooldown"],
    current: (t) => (t === 0 ? "stock reload" : `−${15 * t}% cooldown`),
    // The one track whose number falls. The arrow reports the number, so this
    // reads "down" even though a shorter cooldown is the improvement.
    step: () => ({ dir: "down", text: "−15% reload" }),
    apply(cfg, tier) {
      cfg.cooldownMs = Math.max(120, Math.round(cfg.cooldownMs * (1 - 0.15 * tier)));
    },
  },
  {
    id: "reactor",
    name: "Reactor Output",
    glyph: "RCT",
    blurb: "A bigger float every bay and a better rate per line — the economy track.",
    tiers: [
      "+$60 float · +$15 per line",
      "+$120 float · +$30 per line",
      "+$180 float · +$45 per line",
    ],
    current: (t) => (t === 0 ? "stock reactor" : `+$${60 * t} float · +$${15 * t}/line`),
    step: () => ({ dir: "up", text: "+$60 float" }),
    apply(cfg, tier) {
      cfg.startingFunds += 60 * tier;
      cfg.scorePerLine += 15 * tier;
    },
  },
  {
    id: "bonds",
    name: "Bond Emitter",
    glyph: "BND",
    blurb: "Ships ONE Bond Breaker charge for the whole run — shatter the field flat, once, where it counts most.",
    tiers: [
      "+1 charge per run",
      "+2 charges per run · S/Z bonds 30% weaker",
      "+3 charges per run · S/Z bonds 50% weaker",
    ],
    current: (t) => {
      if (t === 0) return "no charges";
      const charges = `${t} charge${t === 1 ? "" : "s"} for the run`;
      return t >= 2 ? `${charges} · S/Z ${t >= 3 ? 50 : 30}% weaker` : charges;
    },
    step: () => ({ dir: "up", text: "+1 charge" }),
    apply(cfg, tier) {
      // Bond Breakers are the compaction answer for any build whose pieces
      // don't flatten their own pile — most of all the light tiny build, whose
      // cubes are too light for weight alone to square off the layers below
      // (see pieces.ts's SIZE_SPEC).
      //
      // This is the emitter's grant onto a SINGLE config, and it is the whole
      // story only outside a Deep Run. In a run the charges are consumable and
      // the magazine belongs to the run rather than the bay, so run.ts's
      // levelForRun overwrites this with RunState.bondCharges — what is
      // actually left — right after applyUpgrades returns. The rule that turns
      // a tier into charges lives once, in run.ts's bondChargesFor, and this
      // line is the same rule at the config layer: one charge per tier.
      cfg.bondBreakerCharges += tier;
      // SEAM SPLITTER — tiers 2 and 3 also stamp WEAKER bonds onto S and Z at
      // launch (level.ts's weakBondTypes/weakBondMult; pieces.ts's
      // createTetrisPiece does the stamping). S and Z are the shapes that tip,
      // wedge and strand cubes, so weakening exactly their seams turns the
      // worst deliveries into loose, compactable cargo without touching the
      // shapes that already land well. Hosted HERE, at tiers 2-3, so it is a
      // refit decision on the track whose whole identity is bond control —
      // with the charges now a rare per-run magazine, this passive is what
      // the higher tiers newly pay for. 0.7 then 0.5: tier 2 makes a bad S/Z
      // landing shed its worst seam, tier 3 makes shattering their norm.
      if (tier >= 2) {
        cfg.weakBondTypes = ["S", "Z"];
        cfg.weakBondMult = tier >= 3 ? 0.5 : 0.7;
      }
    },
  },
  {
    id: "demolition",
    name: "Demolition Rack",
    glyph: "DEM",
    blurb: "Demolition charges every bay — sell a dead pile back for cash.",
    tiers: [
      "+2 charges per bay",
      "+4 charges per bay",
      `+6 per bay · +1 every ${DEMO_RESUPPLY_LINES} lines · ×${DEMO_BLAST_MULT} blast · ×${DEMO_SALVAGE_MULT} salvage`,
    ],
    current: (t) => (t === 0
      ? "no charges"
      : t >= MAX_TIER
        ? `+${2 * t}/bay · +1 per ${DEMO_RESUPPLY_LINES} lines · ×${DEMO_BLAST_MULT} blast`
        : `+${2 * t} charges/bay`),
    step: (t) => (t + 1 >= MAX_TIER
      ? { dir: "up", text: "+2 charges, resupply, a wider blast and a better rate" }
      : { dir: "up", text: "+2 charges" }),
    apply(cfg, tier) {
      // Twice the old size, and deliberately more generous than the bond
      // track: a bomb is a SALVAGE tool (it refunds what it vaporizes) rather
      // than a field-flattening reset, so it can afford to be the abundant
      // consumable now that Bond Breakers are the rare one. A charge you can
      // PLAN for beats a charge you might be dealt — demolition is slag's
      // only clean answer, and leaving that answer to a draft shuffle meant a
      // player who had paid for it went whole runs without one.
      cfg.bombCharges += 2 * tier;
      // The capstone is a CHANGE IN KIND, not another +2, and it moves three
      // numbers rather than one — see level.ts's DEMO_BLAST_MULT note for the
      // sizing and the playtest behind each.
      //
      // The resupply line came first and answers "what happens when a bay
      // out-lasts six charges": at two or three notches of slag, or under the
      // Tier 6 Slag Wall clause, a seventh dead shipment arrives with nothing
      // left to answer it. Metering the return on LINES makes the loop circular
      // on purpose — bomb the slag, close the row, get the charge back — so the
      // tier pays out for charges spent unblocking rather than hoarded.
      //
      // The other two answer the case a full rack still lost: a Tier-10 bay deep
      // in slag and tar, where the problem was never the number of charges but
      // what one charge DOES and what it returns. A wider blast cuts through a
      // welded crust instead of chipping at it (tar's joints are the one bond
      // nothing else in the game can break), and a better rate keeps a
      // line-sized salvage worth the shots it costs at a $30 launch. Neither
      // will rescue a bay that is already buried, and neither should.
      if (tier >= MAX_TIER) {
        cfg.bombResupplyLines = DEMO_RESUPPLY_LINES;
        cfg.bombBlastMult *= DEMO_BLAST_MULT;
        cfg.salvagePerCube = Math.round(cfg.salvagePerCube * DEMO_SALVAGE_MULT);
      }
    },
  },
  {
    id: "thaw",
    name: "Thaw Lance",
    glyph: "THW",
    blurb: "Thaw charges every bay — melt the frozen cube the press is about to reach.",
    tiers: [
      `+${THAW_CHARGES_PER_TIER} charges per bay`,
      `+${THAW_CHARGES_PER_TIER * 2} charges per bay`,
      `+${THAW_CHARGES_PER_TIER * 3} per bay — a cryo-heavy build, and still not a Cold Chain final`,
    ],
    current: (t) => (t === 0 ? "no charges" : `+${THAW_CHARGES_PER_TIER * t} charges/bay`),
    step: () => ({ dir: "up", text: `+${THAW_CHARGES_PER_TIER} charges` }),
    apply(cfg, tier) {
      // The config-layer half of the same rule run.ts's thawChargesFor states
      // for a run — one grant, `THAW_CHARGES_PER_TIER` a tier — exactly as the
      // Bond Emitter's `+= tier` line mirrors bondChargesFor. In a RUN this is
      // then overwritten by levelForRun with what the run actually has left,
      // because the two modes disagree about resupply (a ladder run's rack is
      // refilled at every bay boundary, a Skydeck run's never is). Outside a
      // run — a single bay flown headlessly — this line is the whole story.
      //
      // NOTHING ELSE. No passive rides the higher tiers, which is the
      // difference between this track and the Bond Emitter's Seam Splitter, and
      // it is deliberate rather than unfinished: the emitter's charges are RARE
      // (three for ten bays), so its tiers 2-3 needed something else to be
      // paying for. Charges that renew every bay are already a ladder — the
      // measurement above prices each rung on its own — and a passive bolted on
      // top would make the tier buy two things and price neither.
      cfg.thawCharges += THAW_CHARGES_PER_TIER * tier;
    },
  },
  {
    id: "cushion",
    name: "Impact Cushion",
    glyph: "CSH",
    blurb: "A shock liner across the deep slots — volatile lands there without going off.",
    tiers: [
      `${CUSHION_TIERS[0].cells} cells of liner · sets off at ${cushionThreshold(1).toFixed(0)} instead of ${VOLATILE_TRIGGER_SPEED}`,
      `${CUSHION_TIERS[1].cells} cells · ${cushionThreshold(2).toFixed(0)}`,
      `${CUSHION_TIERS[2].cells} cells — the whole line zone · ${cushionThreshold(3).toFixed(0)}, above any launch`,
    ],
    current: (t) => (t === 0
      ? "bare floor"
      : `${CUSHION_TIERS[t - 1].cells} cells lined · sets off at ${cushionThreshold(t).toFixed(0)}`),
    step: (t) => (t + 1 >= MAX_TIER
      ? { dir: "up", text: "a deeper liner, and no launch sets one off inside it" }
      : { dir: "up", text: "a deeper liner and a softer landing" }),
    apply(cfg, tier) {
      if (tier <= 0) return;
      const rung = CUSHION_TIERS[Math.min(CUSHION_TIERS.length, tier) - 1];
      cfg.cushionCells = rung.cells;
      // ASSIGNED, not multiplied onto what is there. Nothing else writes these
      // two fields — finals.ts's Hair Trigger drives volatileTriggerMult, which
      // is the field-wide seam and stays separate on purpose (see the config
      // field's own note) — so a tier states the liner the rig has rather than
      // compounding with a liner nobody sold. The two meet at the collision
      // side, in lineClear.ts's cushionedTrigger, which is also where the floor
      // that stops a maxed cushion walking past Hair Trigger lives.
      cfg.cushionMult = rung.mult;
    },
  },
];

export type UpgradeTiers = Record<UpgradeId, number>;

export function newTiers(): UpgradeTiers {
  return {
    bay: 0, launcher: 0, hydraulics: 0, magazine: 0, reactor: 0, bonds: 0, demolition: 0,
    thaw: 0, cushion: 0,
  };
}

/**
 * Which tracks a REFIT stop offers at `mark`.
 *
 * Mark 1 offers ONLY Reactor Output. Tier 1 is the tier the game teaches its
 * economy on, and the reactor IS the economy track — the tuning assumes its
 * three tiers get built across the run's three stops (playtest call,
 * 2026-08-09: a stock rig can't reliably finish the Mark-1 run without
 * them). A first-run player shown seven systems spreads thin scrap across all
 * of them and builds none; one card makes the stop a purchase instead of a
 * dilemma, and pairs with the Workshop on-ramp (meta.ts's INSTALLS — the
 * 15-salvage Reactor install is what makes the card raisable at all, since
 * refits refuse tier-0 tracks; see run.ts's buyUpgrade). The full menu opens
 * at Mark 2, where the player has both the scrap income and the context to
 * spend it.
 */
export function refitTracks(mark: number): UpgradeDef[] {
  return mark <= 1 ? UPGRADES.filter((u) => u.id === "reactor") : UPGRADES;
}

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/** Scrap cost of the NEXT tier of `id` given the tier already owned, or null
 *  when the track is already maxed (the refit UI renders that as "MAX"). */
export function nextTierCost(tier: number): number | null {
  return tier >= MAX_TIER ? null : TIER_COSTS[tier];
}

/**
 * Apply every bought upgrade tier onto `cfg`, in place. Tracks at tier 0 are
 * skipped entirely. Unknown keys in a `tiers` object are ignored (same
 * forward-compatibility stance as mods.ts's applyMods — a future build can
 * rename a track without corrupting an in-flight run's saved state).
 */
export function applyUpgrades(cfg: LevelConfig, tiers: UpgradeTiers): void {
  for (const def of UPGRADES) {
    const tier = tiers[def.id] ?? 0;
    if (tier > 0) def.apply(cfg, Math.min(MAX_TIER, tier));
  }
}

/**
 * Ladder cost of a set of tiers. Serves two masters, which is why it isn't
 * named for either: in-run it's the scrap sunk into the ship (shown on the
 * refit/end screens so a build reads as an investment rather than a list of
 * chips), and out of run it's the BUILD BUDGET a permanent loadout spends
 * (see budgetForMark).
 */
export function tiersCost(tiers: UpgradeTiers): number {
  let total = 0;
  for (const def of UPGRADES) {
    const tier = Math.min(MAX_TIER, tiers[def.id] ?? 0);
    for (let t = 0; t < tier; t++) total += TIER_COSTS[t];
  }
  return total;
}

/* ---------------------------------------------------------------------------
 * THE REFIT ORDER — what the yard has been asked to install, before a single
 * point of scrap has changed hands.
 *
 * A refit stop used to spend on the tap: every button was a purchase, and a
 * player who wanted to compare two builds had to buy one of them to see it.
 * That is the opposite of what this stop is for. The whole reason the yard
 * shows every track at once with its ladder spelled out — see refitScreen's
 * note, and the draft it contrasts itself with — is that a refit is a PLAN,
 * and a plan you cannot revise before committing is just a run of irreversible
 * taps.
 *
 * So the yard now STAGES tiers into an order and Undock is the one commit (see
 * run.ts's buyUpgrades). This type is that order: extra tiers per track, on top
 * of whatever the ship already carries. Absent or 0 means nothing is queued
 * there, so an empty object is an empty yard ticket and `{}` is always legal.
 * ------------------------------------------------------------------------- */
export type RefitOrder = Partial<Record<UpgradeId, number>>;

/** The tier a track would sit at with the order installed. Clamped, so an
 *  order hand-edited past the ladder's top reads as MAX rather than as a
 *  fourth tier nothing implements. */
export function orderedTier(tiers: UpgradeTiers, order: RefitOrder, id: UpgradeId): number {
  return Math.min(MAX_TIER, (tiers[id] ?? 0) + Math.max(0, Math.floor(order[id] ?? 0)));
}

/** Every track's tier with the order installed — the loadout the yard's
 *  projection is drawn against (see main.ts's refitHTML). */
export function orderedTiers(tiers: UpgradeTiers, order: RefitOrder): UpgradeTiers {
  const out = { ...tiers };
  for (const def of UPGRADES) out[def.id] = orderedTier(tiers, order, def.id);
  return out;
}

/** Rungs queued across every track — what the Undock button counts. Derived
 *  from the clamped tiers rather than from the order's own numbers, so a
 *  stale entry on a maxed track cannot inflate the count. */
export function orderSize(tiers: UpgradeTiers, order: RefitOrder): number {
  let n = 0;
  for (const def of UPGRADES) {
    n += orderedTier(tiers, order, def.id) - Math.min(MAX_TIER, tiers[def.id] ?? 0);
  }
  return n;
}

/** Scrap the whole order costs. Priced as the DIFFERENCE between two ladder
 *  costs rather than by re-walking TIER_COSTS here: one ladder, priced in one
 *  place, so the yard's running total can never disagree with what the commit
 *  actually deducts. */
export function orderCost(tiers: UpgradeTiers, order: RefitOrder): number {
  return tiersCost(orderedTiers(tiers, order)) - tiersCost(tiers);
}

/**
 * The RUNGS an order installs, in the order run.ts's buyUpgrades installs
 * them: which track, the tier each rung climbs FROM, and what that rung costs.
 *
 * Exists so the commit and anything that has to narrate the commit read the
 * same sequence off one function. main.ts's onRefitDone is the caller that
 * makes it worth having: telemetry records a `scrapBefore` per rung, and
 * reconstructing "the balance before each of six purchases" from a batch
 * needs the rungs in installation order with their individual prices — which
 * is exactly what buyUpgrades walks, and exactly the thing that would rot if
 * it were walked twice.
 *
 * Clamped and price-terminated, so it enumerates only rungs that exist. It
 * does NOT validate the order (buyUpgrades does that, strictly, before
 * spending anything) — an order that climbs past the ladder simply has fewer
 * rungs here than its numbers claim.
 */
export function orderRungs(
  tiers: UpgradeTiers,
  order: RefitOrder,
): { id: UpgradeId; from: number; cost: number }[] {
  const rungs: { id: UpgradeId; from: number; cost: number }[] = [];
  for (const def of UPGRADES) {
    const start = Math.min(MAX_TIER, tiers[def.id] ?? 0);
    const want = Math.max(0, Math.floor(order[def.id] ?? 0));
    for (let i = 0; i < want; i++) {
      const cost = nextTierCost(start + i);
      if (cost === null) break;
      rungs.push({ id: def.id, from: start + i, cost });
    }
  }
  return rungs;
}

/**
 * Queue one more tier of `id`, or null when the yard cannot take it: the system
 * is not aboard (tier 0 — a refit RAISES, it never installs; see run.ts's
 * buyUpgrade), the track is already ordered to MAX, or the extra rung does not
 * fit what is left of `scrap`.
 *
 * Affordability is checked against the WHOLE order, not against this rung
 * alone. That is the difference a staged yard makes: with one purchase per tap
 * the scrap was already gone by the time the next button rendered, and here it
 * is not — so the button's disabled state has to price the queue behind it.
 */
export function stageTier(
  tiers: UpgradeTiers,
  order: RefitOrder,
  id: UpgradeId,
  scrap: number,
): RefitOrder | null {
  if ((tiers[id] ?? 0) <= 0) return null;
  if (nextTierCost(orderedTier(tiers, order, id)) === null) return null;
  const next: RefitOrder = { ...order, [id]: Math.max(0, Math.floor(order[id] ?? 0)) + 1 };
  if (orderCost(tiers, next) > scrap) return null;
  return next;
}

/**
 * Take a track's queued rungs back off the order — ALL of them, not the last
 * one, and that is the trap it avoids rather than a shortcut.
 *
 * The yard sells one control per card (the tap floor leaves room for one, and
 * the draft's cards already settled that a single cycling button beats two).
 * So the card's button stages while there is room and undoes once the track is
 * ordered to MAX — and a one-rung undo there would leave a track oscillating
 * between its top two tiers with no way back down to what the ship carries.
 * Taking the whole track back is the escape, in one tap, from any staged state.
 */
export function clearTrack(order: RefitOrder, id: UpgradeId): RefitOrder {
  if (Math.max(0, Math.floor(order[id] ?? 0)) === 0) return order;
  const next = { ...order };
  delete next[id];
  return next;
}

/* ---------------------------------------------------------------------------
 * BUILD BUDGET — the permanent, out-of-run layer (see docs/DESIGN.md).
 *
 * A Mark grants a fixed number of ladder points, spent freely across the seven
 * tracks. This is deliberately a budget on the TOTAL rather than a cap on each
 * track's tier, and the difference is the whole point: a per-track cap
 * normalizes the MAXIMUM rig, not the actual one, so two players at the same
 * Mark can sit far apart on power with the gap being nothing but grind time —
 * which is exactly what a subscription that sells throughput would then be
 * selling. Budgeting the total makes every rig at a Mark equal in power and
 * different in shape, which is the FTL reading and the honest one for a
 * leaderboard.
 * ------------------------------------------------------------------------- */

/** Ladder cost of every track maxed: 8 tracks x (20+35+55) = 880. Derived, not
 *  typed in, so re-pricing TIER_COSTS or adding a system can't leave a stale
 *  constant behind — and the eighth track this note used to anticipate (the
 *  Thaw Lance) arrived and moved it from 770 without a line changing here.
 *
 *  THAT MOVE IS THE DESIGN, not a side effect to be frozen out. budgetForMark
 *  is defined as "one system's money at Mark 1, a fully-kitted rig at Mark 10";
 *  pinning the total while the roster grows would quietly break the second half
 *  of that promise, leaving Mark 10 one track short of everything. Every Mark's
 *  allowance therefore rose by an eighth (Mark 1 77 → 88, Mark 5 385 → 440,
 *  Mark 10 770 → 880). MEASURED rather than assumed harmless: the winnability
 *  sweep's Tier-5 `material` rig is the same six tracks at tier 2 (330 pts) at
 *  both budgets, because the Workshop's own ceiling — not the allowance — is
 *  what binds there, so the counter table below is paired against an unchanged
 *  control. See meta.ts's installAvailable for the relationship that survives
 *  the move exactly. */
export const FULL_BUILD_COST = UPGRADES.length * TIER_COSTS.reduce((a, b) => a + b, 0);

/** Marks in the ladder. Placeholder that rhymes with RUN_LEVELS; the real
 *  number depends on how long a Mark takes to beat (see docs/DESIGN.md's open
 *  questions). */
export const MARK_COUNT = 10;

/**
 * Ladder points available at `mark` (1-based). Linear from one-system money at
 * Mark 1 to a fully-kitted rig at MARK_COUNT — the arc from "you can afford one
 * system" to "you can afford everything" IS the progression.
 *
 * FIRST PASS, uncalibrated. The criterion this has to satisfy (docs/DESIGN.md):
 * a rig built with the full Mark-N budget, played at the sim bot's competence,
 * should fall JUST SHORT of the Mark N target — if it can't clear at any skill
 * the Mark is impossible, and if it clears while played badly the Mark is free.
 * Tune against sim/sweep.ts, not by feel.
 */
export function budgetForMark(mark: number): number {
  const m = Math.max(1, Math.min(MARK_COUNT, Math.floor(mark)));
  return Math.round((FULL_BUILD_COST * m) / MARK_COUNT);
}

/** True when `tiers` is a legal loadout at `mark` — i.e. it fits the budget and
 *  no track exceeds MAX_TIER. Validated rather than trusted because the loadout
 *  round-trips through localStorage, where anyone can edit it. */
export function loadoutLegal(tiers: UpgradeTiers, mark: number): boolean {
  for (const def of UPGRADES) {
    const tier = tiers[def.id] ?? 0;
    if (tier < 0 || tier > MAX_TIER || !Number.isInteger(tier)) return false;
  }
  return tiersCost(tiers) <= budgetForMark(mark);
}

/** Buy one tier of `id` against the budget, or null when it can't be bought —
 *  maxed, or the next tier doesn't fit what's left. Mirrors run.ts's
 *  buyUpgrade so the loadout screen and the refit screen can render a disabled
 *  card from the same rule instead of each re-deriving affordability. */
export function buyLoadoutTier(
  tiers: UpgradeTiers,
  id: UpgradeId,
  mark: number,
): UpgradeTiers | null {
  const tier = tiers[id] ?? 0;
  const cost = nextTierCost(tier);
  if (cost === null) return null;
  const next = { ...tiers, [id]: tier + 1 };
  if (tiersCost(next) > budgetForMark(mark)) return null;
  return next;
}
