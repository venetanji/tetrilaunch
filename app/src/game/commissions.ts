import type { RunState } from "./run";
import { hazardsForMark } from "./hazards";
import { MARK_COUNT, tiersCost } from "./upgrades";

/**
 * COMMISSIONS — clauses a Deep Run can be flown under, and the second half of
 * what makes a cleared Tier worth returning to.
 *
 * A commission is not a badge for something you happened to do. It is a
 * CLAUSE the whole run is flown under — bare-handed, every material on the
 * belt, nothing over the wall — checked once at run end against what the run
 * actually did (run.ts's RunStats). See docs/LONGEVITY.md for the argument;
 * three rules carry the design and all three live here.
 *
 * ---------------------------------------------------------------------------
 * 1. A CLAIM IS A (CLAUSE, TIER) PAIR, NOT A CLAUSE.
 *
 * `bare-hands@3` and `bare-hands@7` are different achievements. This is the
 * whole reason the ladder panel exists: a clause claimed once, anywhere, would
 * make the highest Tier strictly dominate — satisfy it at Tier 9 and every
 * lower Tier is dead content again, which is the exact hole replay was built
 * to fill. Paired, "Bare Hands" is ten separate things to go and do, and a
 * cleared Tier keeps a job forever.
 *
 * ---------------------------------------------------------------------------
 * 2. EVERY CLAUSE REQUIRES THE RUN TO BE WON.
 *
 * Stated once, applied to all of them (see `earnedCommissions`), rather than
 * repeated in nine `check` bodies where one could be forgotten. Without it
 * half the pool is satisfied by losing bay 1: a run that never fires a
 * demolition charge because it died before it could is not Cold Store, and a
 * run that lost two cubes because it only took nine shots is not Tight Ship.
 * "Beat the Tier while ..." is the sentence every card reads, so it is the
 * sentence the code enforces.
 *
 * ---------------------------------------------------------------------------
 * 3. A CLAUSE CAN ONLY BE FLOWN AT A TIER THAT CAN POSE IT.
 *
 * `minTier` is a POSSIBILITY floor, not a difficulty rating. Full Manifest
 * asks for every content axis the Tier offers, and Mark 1-3 offer none
 * (hazards.ts opens cryo at Mark 4), so at those Tiers the clause is vacuous
 * rather than hard — it would claim itself on any won run. Salvage Yard wants
 * demolition charges to exist. A clause below its floor is not offered, not
 * checked, and not claimable.
 *
 * The thresholds below are a FIRST PASS. They are the most likely thing in
 * this file to move after a play session and the cheapest thing to move, which
 * is why each one is a named constant with its derivation written beside it
 * rather than a literal inside a `check`.
 */

export type CommissionId =
  | "bare-hands"
  | "tight-ship"
  | "cold-store"
  | "deep-pockets"
  | "sharpshooter"
  | "iron-column"
  | "clockwork"
  | "salvage-yard"
  | "full-manifest";

/** Everything a clause is allowed to look at, assembled once at run end.
 *
 *  `run` is the run's own state — ratchets, tiers, salvagedFunds, stats — and
 *  the four loose fields are the ones that only exist at the moment the last
 *  bay stops, because that bay never goes through advanceRun: its lines, its
 *  ending funds, its target, and whether it won. A clause that wanted to read
 *  `run.linesTotal` alone would be short exactly the deciding bay. */
export interface CommissionCtx {
  run: RunState;
  /** True only when the run cleared all RUN_LEVELS bays. */
  won: boolean;
  /** Lines cleared across the WHOLE run, last bay included. */
  lines: number;
  /** Funds in hand when the run ended (Game.score). */
  funds: number;
  /** The last bay's funding target (Game.target) — `funds - target` is the
   *  overshoot Deep Pockets is priced in, and quoting the raw ending funds
   *  instead would make the clause easier every Tier as targets climb. */
  target: number;
}

export interface CommissionDef {
  id: CommissionId;
  /** Two words, like every hazard and inspection card. */
  name: string;
  /** The clause with its exact number in it. Same rule hazards.ts's cards
   *  follow, for the same reason: the player is committing a whole run to
   *  this, so a card that describes the shape of the clause without its size
   *  turns a deliberate attempt into a guess. */
  desc: string;
  /** Lowest Tier that can actually POSE this clause — see rule 3 above. */
  minTier: number;
  /** Checked only on a won run at a Tier at or above `minTier`. */
  check(ctx: CommissionCtx): boolean;
}

/* -------------------------------------------------------------------------
 * THRESHOLDS
 * ---------------------------------------------------------------------- */

/** Cubes Tight Ship allows over the wall across the WHOLE run.
 *
 *  Sized off the measured baseline in game.ts's congestion note: an ordinary
 *  bay throws about 0.11 lost cubes per shot, and a full ten-bay run fires on
 *  the order of 320 shots (contracts.ts's PLANNING_EFFICIENCY: ~2.9 launches a
 *  line, ~11 lines a bay), so a clean run already sheds roughly 35. Twelve is
 *  about a third of that — a real squeeze reachable by placing shots rather
 *  than by luck, and well clear of the 1.06-per-shot figure that same note
 *  records for a bay played badly. */
export const TIGHT_SHIP_CUBES = 12;

/**
 * Overshoot above the last bay's target that Deep Pockets asks for.
 *
 * THE BAY STOPS TAKING LAUNCHES THE MOMENT YOU CROSS, which is what makes this
 * a clause rather than a threshold. game.ts's settle gate closes the cannon on
 * `score >= target` and only lets what is already in the air land, so the
 * overshoot is not something a player accumulates — it is entirely the size of
 * the ONE crush that crossed the line.
 *
 * That turns the clause into a specific play: hold the bay under its target
 * while building a multi-row stack, then close it in a single stroke. Bay 10
 * pays scorePerLine $190 at every Tier (level.ts's ramp is per-bay and the
 * Mark does not scale it), so a four-row crush pays 4 x 190 = $760 at a bare
 * combo, and three rows clear it on any streak past the first
 * (3 x 190 x 1.25 = $712 — game.ts's payoutMult). $600 is therefore "a
 * deliberate multi-line at the buzzer", and $400 would have been "a lucky
 * double".
 *
 * The card has to say that, and says it: a clause whose number is reachable
 * only by a play the copy does not mention is a clause the player fails
 * without ever learning what it wanted.
 */
export const DEEP_POCKETS_OVERSHOOT = 600;

/** Launches per cleared line Sharpshooter allows, run-wide.
 *
 *  contracts.ts's PLANNING_EFFICIENCY prices a line at ~2.9 launches and the
 *  whole Contract budget model is built on that number, so 2.5 is a stated
 *  fraction of a measured figure rather than a guess: about 14% better than
 *  the game's own assumption about how well a line gets built. */
export const SHARPSHOOTER_PER_LINE = 2.5;

/** Seconds Clockwork demands be left on the clock at the end of EVERY bay.
 *
 *  Deliberately the same 45 as hazards.ts's Shift Cut floor, and for a related
 *  reason: 45s is the margin the design already decided a bay must never drop
 *  below, so a clause asking you to keep it is asking you to never once be in
 *  the territory the ratchet is forbidden from creating. */
export const CLOCKWORK_MARGIN_SEC = 45;

/** Notches Iron Column wants on a single axis.
 *
 *  Below Mark 10 the draft deals one pick per bay across nine drafts
 *  (hazards.ts's picksPerBay), so five on one axis is over half the run's
 *  entire ratchet spend committed to one kind of pain. On the time ladder that
 *  is 1+2+3+5+8 = 19 seconds off every bay; on the cost ladder, +$12 a launch.
 *  Four was the first number and it was too cheap — nine picks make four on
 *  one axis something a player does by accident. */
export const IRON_COLUMN_NOTCHES = 5;

/** Funds Salvage Yard wants refunded by demolition charge across the run.
 *
 *  At level.ts's salvagePerCube of $8, $600 is 75 cubes vaporized — on the
 *  order of a dozen well-placed charges. That is a run played AS a salvage
 *  economy rather than one that happened to blow up a junk pile, which is the
 *  clause's whole point and the Scrapper rig's audition (docs/LONGEVITY.md). */
export const SALVAGE_YARD_FUNDS = 600;

/** The Tier at which the last content axis opens (hazards.ts: magnetic, Mark
 *  9). Not used as a floor — Full Manifest scales with the Tier — but named
 *  because sim/systems.ts ties the clause's own floor to the FIRST content
 *  axis and wants the other end of that range to be a fact rather than a 9
 *  typed into a test. */
export const LAST_CONTENT_MARK = 9;

/* -------------------------------------------------------------------------
 * THE POOL
 * ---------------------------------------------------------------------- */

export const COMMISSIONS: CommissionDef[] = [
  {
    id: "bare-hands",
    name: "Bare Hands",
    desc: "Clear the Tier on a stock rig — nothing installed from the build budget, nothing bought at a refit stop.",
    minTier: 1,
    // tiersCost reads the run's LIVE tiers, which start at the permanent
    // loadout and are raised by refits (run.ts's buyUpgrade), so one call
    // covers both halves of "bought nothing". A run that flew a loadout and
    // never refitted is not bare-handed.
    check: (c) => tiersCost(c.run.tiers) === 0,
  },
  {
    id: "tight-ship",
    name: "Tight Ship",
    desc: `Clear the Tier having lost at most ${TIGHT_SHIP_CUBES} cubes over the wall, all ten bays combined.`,
    minTier: 1,
    check: (c) => c.run.stats.lostCubes <= TIGHT_SHIP_CUBES,
  },
  {
    id: "cold-store",
    name: "Cold Store",
    desc: "Clear the Tier without firing a single demolition charge or Bond Breaker.",
    minTier: 1,
    check: (c) => c.run.stats.bombsFired === 0 && c.run.stats.bondsUsed === 0,
  },
  {
    id: "deep-pockets",
    name: "Deep Pockets",
    desc: `Close the last bay $${DEEP_POCKETS_OVERSHOOT} past its target in ONE crush — the cannon locks the moment you cross, so the overshoot is whatever that final stroke was worth.`,
    minTier: 1,
    check: (c) => c.funds - c.target >= DEEP_POCKETS_OVERSHOOT,
  },
  {
    id: "sharpshooter",
    name: "Sharpshooter",
    desc: `Clear the Tier at ${SHARPSHOOTER_PER_LINE} launches per line or better, run-wide.`,
    minTier: 2,
    // Guarded on lines rather than on shots: a run with no lines cannot have
    // won, but the guard is cheap and it keeps the ratio from being 0/0 in a
    // speculative preview of a run in progress.
    check: (c) => c.lines > 0 && c.run.stats.shots <= c.lines * SHARPSHOOTER_PER_LINE,
  },
  {
    id: "iron-column",
    name: "Iron Column",
    desc: `Clear the Tier with ${IRON_COLUMN_NOTCHES} or more notches ratcheted onto one single axis.`,
    minTier: 2,
    check: (c) =>
      Object.values(c.run.ratchets).some((n) => (n ?? 0) >= IRON_COLUMN_NOTCHES),
  },
  {
    id: "clockwork",
    name: "Clockwork",
    desc: `Clear the Tier never finishing a bay with under ${CLOCKWORK_MARGIN_SEC}s left on the shift clock.`,
    minTier: 3,
    // tightestSec is a running MINIMUM seeded at Infinity, so a run whose bays
    // all ran clockless passes — correctly: there was no clock to be tight on.
    check: (c) => c.run.stats.tightestSec >= CLOCKWORK_MARGIN_SEC,
  },
  {
    id: "salvage-yard",
    name: "Salvage Yard",
    desc: `Clear the Tier having refunded $${SALVAGE_YARD_FUNDS} or more by demolition charge.`,
    // Mark 3 rather than 1: demolition is an installed system, and the build
    // budget at Mark 1 (66 points) will not carry it alongside the economy
    // track the first Tiers are tuned to need.
    minTier: 3,
    check: (c) => c.run.salvagedFunds >= SALVAGE_YARD_FUNDS,
  },
  {
    id: "full-manifest",
    name: "Full Manifest",
    // The clause SCALES with the Tier, which is why the copy names the rule
    // rather than a count: at Tier 4 it is one axis, at Tier 9 it is six, and
    // both are the same sentence. A per-count clause would need six cards.
    desc: "Clear the Tier having ratcheted EVERY material axis the Tier offers — the whole manifest on the belt.",
    // The first content axis opens at Mark 4 (hazards.ts's cryo). Below that
    // the clause has an empty set to satisfy and would claim itself on any
    // won run, which is rule 3's exact failure mode.
    //
    // ACHIEVABILITY is the thing this clause had to be checked for and the
    // only one in the pool that did, because it is the only clause whose
    // satisfaction depends on what the game DEALS rather than on how the
    // player plays. It was 18% at Mark 9 — a lottery, not an achievement, and
    // worse, one the player could fly eight bays under before losing to the
    // shuffle. That is fixed in the DRAFT (hazards.ts's FRESH MATERIALS note),
    // where it was a progression bug in its own right; the clause is now
    // reachable in 88% of Mark-9 deals and 97-100% everywhere else, which is
    // "mostly on you, occasionally the deal says no" rather than a coin flip.
    minTier: 4,
    check: (c) => {
      const content = hazardsForMark(c.run.mark).filter((h) => h.kind === "content");
      return content.length > 0 && content.every((h) => (c.run.ratchets[h.id] ?? 0) >= 1);
    },
  },
];

export function commissionById(id: string): CommissionDef | undefined {
  return COMMISSIONS.find((c) => c.id === id);
}

/** The clauses a run at `tier` may be flown under, in pool order. */
export function commissionsForTier(tier: number): CommissionDef[] {
  const t = clampTier(tier);
  return COMMISSIONS.filter((c) => c.minTier <= t);
}

/** How many clauses `tier` can pose — the denominator the ladder panel shows
 *  ("3/7"), stated once so the panel and the sim can't disagree about it. */
export function commissionCountFor(tier: number): number {
  return commissionsForTier(tier).length;
}

/* -------------------------------------------------------------------------
 * CLAIM IDS
 *
 * `clause@tier`, and the format is load-bearing rather than cosmetic: it is
 * what meta.ts stores forever, so it has to survive a clause being renamed
 * (it won't be — the id is not the name) and a Tier ceiling moving. Parsed
 * defensively for the same reason store.ts re-validates every list it loads:
 * a corrupt entry must be ignorable, never throw inside the award path.
 * ---------------------------------------------------------------------- */

export function claimId(id: CommissionId, tier: number): string {
  return `${id}@${clampTier(tier)}`;
}

export interface ParsedClaim {
  id: CommissionId;
  tier: number;
}

/** The inverse of claimId, or null for anything this build doesn't recognise —
 *  a retired clause, a hand-edited save, a Tier past the ladder. */
export function parseClaim(raw: string): ParsedClaim | null {
  const at = raw.lastIndexOf("@");
  if (at <= 0) return null;
  const def = commissionById(raw.slice(0, at));
  if (!def) return null;
  const tier = Number(raw.slice(at + 1));
  if (!Number.isInteger(tier) || tier < def.minTier || tier > MARK_COUNT) return null;
  return { id: def.id, tier };
}

/**
 * Every clause a finished run satisfies, at the Tier it was flown at.
 *
 * The one place rule 2 is applied: a lost run earns nothing, whatever its
 * numbers say. Returns ids rather than claim strings because the caller
 * (meta.ts's recordRunEnd) needs the Tier anyway to decide whether the claim
 * is a milestone, and handing it two encodings of the same fact is how the
 * two drift.
 */
export function earnedCommissions(ctx: CommissionCtx): CommissionId[] {
  if (!ctx.won) return [];
  return commissionsForTier(ctx.run.mark)
    .filter((def) => def.check(ctx))
    .map((def) => def.id);
}

/** Claims already banked at `tier`, in pool order — the ladder panel's tick
 *  row. Unrecognised entries are dropped rather than counted. */
export function claimedAtTier(claims: readonly string[], tier: number): CommissionId[] {
  const t = clampTier(tier);
  const have = new Set(
    claims.map(parseClaim).filter((p): p is ParsedClaim => !!p && p.tier === t).map((p) => p.id),
  );
  return commissionsForTier(t).filter((d) => have.has(d.id)).map((d) => d.id);
}

function clampTier(tier: number): number {
  return Math.max(1, Math.min(MARK_COUNT, Math.floor(tier)));
}
