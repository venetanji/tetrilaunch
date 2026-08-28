import { HAZARDS, type HazardId, type Ratchets } from "./hazards";
import { mixTotal, MATERIAL_ROLL_ORDER } from "./belt";
import type { LevelConfig } from "./level";
import { SIZE_SPEC } from "./pieces";
import { MATERIAL_SPEC, type Material } from "./theme";

/**
 * NEXT-BAY PROJECTION — the numbers the ratchet screen shows changing.
 *
 * The bay-clear draft asks the player to buy a permanent difficulty notch with
 * nothing but a card's prose to price it by ("Every launch costs $5 more"), and
 * prose is the wrong unit: what the player is actually deciding is whether the
 * NEXT bay is still winnable, and that question is answered by the next bay's
 * config, not by the delta on a card. So the draft now selects rather than
 * commits, and this module turns "the bay you would be flying" into a row of
 * before/after numbers underneath the cards.
 *
 * Both configs come from run.ts's levelForRun — the real pipeline (base ladder
 * -> ship upgrades -> ratchets -> carry), run twice: once on the run as it
 * stands, once on the run with the tentative picks folded in. Nothing here
 * re-derives a notch's effect, which is the point: a projection that models the
 * numbers separately from the game would eventually lie, and a lying projection
 * is worse than no projection at all.
 */

export type PreviewTone = "worse" | "better" | "same";

/**
 * ONE LINE INSIDE A ROW that is a SUM rather than a measurement.
 *
 * The belt is the only such row today: "33% of shipments carry a material" is
 * the number that prices the bay, and it is also six numbers added together.
 * Which six was readable nowhere on this panel — the total said how much
 * special cargo, never which — and the answer a player needs before pricing a
 * demolition rack against a thaw lance is exactly that split.
 *
 * A part is NOT a row. It never becomes a tile of its own: the argument that
 * kept the belt to one row (a Tier 10 material clause moving six tiles at once
 * is two extra rows on the screen that overflows first) is about the GRID, and
 * it still stands. The parts ride inside the one tile that already prices the
 * belt, as a dense list — the tile count does not change.
 */
export interface PreviewPart {
  /** The material this line is for. A Material id, because the surface drawing
   *  it uses the belt's own glyph for the mark (ui/components' materialIconHTML)
   *  — the mark a player learns on the belt is the mark they read here. */
  id: Exclude<Material, "standard">;
  label: string;
  from: string;
  to: string;
  changed: boolean;
  tone: PreviewTone;
  /** BANKED notches on this material's own ratchet axis — the axis id and the
   *  material id are the same string (hazards.ts's contentAxis). Read from
   *  previewRows' `tally`, not from `banked`, so a caller can quote the bill
   *  without pinning rows ACTIVE; 0 when neither was passed. */
  notches: number;
}

export interface PreviewRow {
  id: string;
  label: string;
  /** Formatted value as the bay stands today. */
  from: string;
  /** Formatted value with the tentative picks applied. */
  to: string;
  /** `from` and `to` differ AS DISPLAYED — a change too small to show is not a
   *  change the player can read, and rendering "12 → 12" with a highlight on it
   *  reads as a bug. */
  changed: boolean;
  /** Which way the change moves the player, for colour. "same" when unchanged. */
  tone: PreviewTone;
  /** "core" — one of the numbers a bay is priced by, on screen whatever is
   *  selected. "context" — an axis that is in play but that this selection does
   *  not touch. A moved row is always shown; an unmoved CONTEXT row is what a
   *  landscape phone drops first (app.css hides it at compact density), because
   *  it is the only class of row that is neither the frame nor the answer. */
  kind: "core" | "context";
  /** The label a DENSE grid uses. A landscape phone packs the projection four
   *  tiles across, ~63px of interior each; "Shots in the bank" does not survive
   *  that, and a tile labelled "S…" names nothing. Same row, fewer words. */
  short: string;
  /** The axis behind this row has BANKED notches on the run — the pressure is
   *  live whatever the current selection does. An active row is promoted to
   *  "core" (it is part of the frame the change is read against, so no filter
   *  and no compact rule may drop it) and the draft flags it ACTIVE. This is
   *  Codex point #1: a banked Sweeper Detail used to vanish from the
   *  projection whenever the current pick didn't move press speed, so the
   *  player priced the next bay against numbers that hid its live pressure. */
  active: boolean;
  /** The row's own breakdown, for a row whose value is a SUM — see PreviewPart.
   *  Absent on every row that is a single measurement, which is all of them but
   *  the belt. */
  parts?: PreviewPart[];
}

const money = (v: number): string => `$${Math.round(v)}`;
const int = (v: number): string => String(Math.round(v));
const rate = (v: number): string => `${Math.round(v * 100)}%`;
const clock = (sec: number): string => {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

interface Field {
  id: string;
  label: string;
  /** Dense-grid label — see PreviewRow.short. Defaults to `label`, which is
   *  right for anything already short enough to read at four across. */
  short?: string;
  read(cfg: LevelConfig): number;
  fmt(v: number): string;
  /** True when a bigger number is worse news for the player. Drives colour
   *  only — a notch is never good, but "the clock got shorter" and "the target
   *  got bigger" move in opposite directions numerically. */
  higherIsWorse: boolean;
  /** Overrides higherIsWorse where the number is not ORDERED — a bearing, say,
   *  where both directions are worse than the middle and neither is worse than
   *  the other. Without it the shared rule has to call one of a Final
   *  Inspection's two wind clauses an improvement, which is exactly the lie
   *  the projection exists to prevent. */
  toneFor?(from: number, to: number): PreviewTone;
  /** Shown even when the selection doesn't touch it: the four numbers a bay is
   *  priced by are the frame the change is read against, so they never vanish. */
  always?: boolean;
  /** For the rest: shown when the axis is already in play at this bay, so a
   *  player can see the crosswind they are already flying before deciding to
   *  ratchet it. Anything else appears the moment a pick touches it. */
  showWhen?(baseVal: number): boolean;
  /** The ratchet axis (or axes — the belt row answers for every content axis
   *  at once) whose notches make this row's pressure LIVE. A row whose axis
   *  has banked notches never leaves the projection and is flagged active —
   *  see PreviewRow.active. */
  axis?: HazardId | readonly HazardId[];
  /** The row's breakdown, for a row that is a SUM of named things — see
   *  PreviewPart. Only the belt has one. */
  parts?(base: LevelConfig, next: LevelConfig, tally: Ratchets): PreviewPart[];
}

const FIELDS: Field[] = [
  { id: "target", label: "Funding target", short: "Target", read: (c) => c.targetScore, fmt: money, higherIsWorse: true, always: true },
  { id: "float", label: "Opening float", short: "Float", read: (c) => c.startingFunds, fmt: money, higherIsWorse: false, always: true },
  { id: "cost", label: "Launch cost", short: "Launch", read: (c) => c.launchCost, fmt: money, higherIsWorse: true, always: true },
  // Derived, and deliberately the headline the economy note argues in: a bay
  // opens with N shots in the bank. It is the one row where the levy's $5 and
  // the float's carry meet, so it moves when EITHER does.
  {
    id: "shots",
    label: "Shots in the bank",
    short: "Shots",
    read: (c) => (c.launchCost > 0 ? Math.floor(c.startingFunds / c.launchCost) : 0),
    fmt: int,
    higherIsWorse: false,
    always: true,
  },
  { id: "clock", label: "Shift clock", short: "Clock", read: (c) => c.timeLimitSec, fmt: clock, higherIsWorse: false, always: true },
  // What a row SELLS for. Not `always`, deliberately: it is flat on every
  // ordinary bay and no ratchet axis touches it, so a permanent tile would be
  // one more thing for a landscape phone to pack four across for nothing. It
  // appears the moment something moves it — which today is exactly one thing,
  // the Tier 1 inspection's Rate Cut (finals.ts), and that clause is invisible
  // without it.
  { id: "pay", label: "Line payout", short: "Per line", read: (c) => c.scorePerLine, fmt: money, higherIsWorse: false },
  // WHICH WAY the wind blows, as opposed to how hard (the `wind` row below).
  // A locked bay reads the same windMax as a rolled one, so the two clauses of
  // the Tier 2 inspection would project as identical bays without this — the
  // one case where showing nothing would be an outright lie rather than a
  // dropped detail.
  {
    id: "bearing",
    label: "Prevailing wind",
    short: "Bearing",
    read: (c) => (c.windMax === 0 ? 0 : c.windLock ?? 0),
    fmt: (v) => (v < -0.005 ? "full against" : v > 0.005 ? "full behind" : "rolled"),
    // Unordered: a pinned gale is worse than a rolled one in BOTH directions,
    // and neither direction is worse than the other — that is the whole point
    // of the pair.
    higherIsWorse: true,
    toneFor: (a, b) => (Math.abs(b) > Math.abs(a) ? "worse" : Math.abs(b) < Math.abs(a) ? "better" : "same"),
  },
  {
    id: "wind", label: "Crosswind", short: "Wind", read: (c) => c.windMax, fmt: (v) => v.toFixed(2),
    higherIsWorse: true, showWhen: (v) => v > 0.005, axis: "wind",
  },
  {
    id: "sweeper", label: "Press speed", short: "Press", read: (c) => c.compactorSpeed, fmt: (v) => `${v.toFixed(2)}×`,
    higherIsWorse: true, axis: "sweeper",
  },
  {
    // Unit in the LABEL, not the value: "11 cells → 10 cells" is the one row
    // wide enough to wrap its tile onto a second line at phone widths, and one
    // taller tile costs a whole row of the grid.
    id: "cells", label: "Press gap (cells)", short: "Gap (cells)", read: (c) => c.compactorOpenCells, fmt: (v) => `${Math.round(v)}`,
    higherIsWorse: false, axis: "sweeper",
  },
  // ---------------------------------------------------------------------
  // The rows below exist for the Final Inspection (finals.ts). None of them is
  // `always`: no ratchet axis touches any of these fields, so on an ordinary
  // draft every one of them is flat and a permanent tile would be one more
  // thing for a landscape phone to pack four across for nothing. They appear
  // the moment a clause moves them — which is the only time they mean
  // anything, and the one time their absence would be a lie rather than a
  // dropped detail. sim/systems.ts pins that every clause moves at least one
  // projected number, so a new clause with no row here fails the harness
  // instead of shipping invisible.
  // ---------------------------------------------------------------------
  {
    // Labelled PER CUBE because that is what game.ts actually charges —
    // `lost = lostCubes.length`, so a spilled tetromino is billed four times
    // over — and the field's name (penaltyPerLostPiece) says otherwise. A tile
    // that quotes $43 and bills $172 teaches the wrong number.
    id: "spill", label: "Spill fine (per cube)", short: "Spill",
    read: (c) => c.penaltyPerLostPiece, fmt: money, higherIsWorse: true,
  },
  {
    id: "line", label: "Line length", short: "Row",
    read: (c) => c.compactorMinLineCells, fmt: (v) => `${Math.round(v)} cells`, higherIsWorse: true,
  },
  {
    // CONGESTION HEADROOM — how much loose cargo the bay tolerates before the
    // launch tax bites (game.ts reads `n > tier.cubes + pileAllowance`, so this
    // slides every threshold together).
    //
    // Added because two clauses moved it with nothing on this screen to show
    // for it: Fouled Bay buys half its cost in congestion, and Tight Gauge
    // falls back to it when the sweeper floor refuses the cells. A projection
    // is the one screen built to price the clause, so an effect it cannot show
    // is an effect the player signs blind — and the harness's own "every clause
    // moves a projected number" check reads these rows, so an unshown field is
    // also an unpinned one.
    //
    // Printed as the tax's own first threshold rather than as the raw offset,
    // because the offset is meaningless without the number it moves: PILE_TIERS
    // is what the player meets, and "42 cubes" is the sentence the bay speaks.
    // Guarded on the tiers existing at all — the mechanic ships enabled, but the
    // field is designed to be switchable and a row reading "NaN cubes" on a bay
    // with no tiers would be worse than no row.
    id: "congestion", label: "Congestion at", short: "Clutter",
    read: (c) => (c.pileTiers.length ? c.pileTiers[0].cubes + c.pileAllowance : NaN),
    fmt: (v) => (Number.isNaN(v) ? "off" : `${Math.round(v)} cubes`),
    higherIsWorse: false,
    showWhen: (v) => !Number.isNaN(v),
  },
  {
    id: "assist", label: "Press assist", short: "Assist",
    read: (c) => c.settleAssist, fmt: (v) => `×${v.toFixed(2)}`, higherIsWorse: false,
  },
  {
    // Infinity is a real value here, not a guard: level.ts sends the capstone
    // bay's bonds unbreakable, and printing "×Infinity" would read as a bug
    // where the word is the actual promise the bay is making.
    id: "bonds", label: "Bond strength", short: "Bonds",
    read: (c) => c.jointBreakStretch,
    fmt: (v) => (Number.isFinite(v) ? `×${v.toFixed(1)}` : "unbreakable"),
    // STRONGER bonds are worse news, however the word reads. level.ts calls
    // this ramp "the core difficulty ramp" and BOND_MARK_STEP names it as the
    // axis Mark difficulty is made of — a shipment that will not come apart
    // cannot settle into the gap it landed over. The direction the player buys
    // is the opposite one: the Bond Emitter's Seam Splitter WEAKENS S and Z
    // (upgrades.ts's weakBondMult, 0.7 then 0.5). Cold Weld is the only clause
    // that moves this row, and it is one of a mandatory pair of costs, so
    // false here painted it as the free half of the choice.
    higherIsWorse: true,
  },
  {
    // Stated in CUBES rather than in the size class's name, because cubes per
    // launch is the number the decision actually turns on — it is what sets
    // how many launches a row costs, and the bay's purse is spent in launches.
    id: "size", label: "Shipment size", short: "Cargo",
    read: (c) => SIZE_SPEC[c.pieceSize].cubes,
    fmt: (v) => `${Math.round(v)} cubes`,
    // Unordered, like the wind's bearing: the standard shipment is the middle
    // the whole run is built around, and BOTH extremes are the clause. Neither
    // 2 nor 5 is an improvement on 4.
    higherIsWorse: true,
    toneFor: (a, b) => (a === b ? "same" : "worse"),
  },
  {
    id: "wall", label: "Salvage in bay", short: "Salvage",
    read: (c) => c.standingWall.reduce((a, b) => a + Math.max(0, Math.floor(b)), 0),
    fmt: (v) => `${Math.round(v)} cubes`, higherIsWorse: true,
  },
  {
    id: "prime", label: "Volatile priming", short: "Priming",
    read: (c) => c.volatileTriggerMult, fmt: (v) => `${Math.round(v * 100)}%`, higherIsWorse: false,
  },
  // ---------------------------------------------------------------------
  // THE SHIP'S OWN SPEC (upgrades.ts) — the rows the REFIT YARD moves.
  //
  // The yard draws this same projection against a staged order (screens.ts's
  // refitScreen), and without these rows three of its seven tracks — Launcher
  // Coils, Loader Magazine, Demolition Rack — moved nothing on it at all. A
  // projection that goes blank on a purchase teaches the player that the
  // purchase does nothing, which is worse than showing no projection.
  //
  // None of them is `always` and none carries a showWhen, so they cost the
  // ratchet draft and the Final Inspection exactly nothing: no ratchet axis
  // touches any of these fields, and the one clause that does (Cold Weld,
  // which stands the Seam Splitter down) is a clause the seams row exists to
  // stop signing blind.
  // ---------------------------------------------------------------------
  {
    id: "power", label: "Muzzle power", short: "Power",
    read: (c) => c.launchPower, fmt: (v) => `${Math.round(v * 100)}%`, higherIsWorse: false,
  },
  {
    // The stabilizer, not the weather: how much of whatever the bay is blowing
    // the coils cancel outright (level.ts's windAssist).
    id: "stabilizer", label: "Wind stabilizer", short: "Wind cut",
    read: (c) => c.windAssist, fmt: rate, higherIsWorse: false,
  },
  {
    id: "reload", label: "Reload", short: "Reload",
    read: (c) => c.cooldownMs, fmt: (v) => `${(v / 1000).toFixed(2)}s`, higherIsWorse: true,
  },
  {
    // What is actually LEFT in the magazine, not what the tier grants: run.ts's
    // levelForRun overwrites the config's charges with RunState.bondCharges, so
    // a refit projects the delta the emitter issues on top of what the run has
    // already spent — which is the number the player is buying.
    id: "breakers", label: "Bond breakers", short: "Breakers",
    read: (c) => c.bondBreakerCharges, fmt: int, higherIsWorse: false,
  },
  {
    // THE SEAM SPLITTER (upgrades.ts, bonds tiers 2-3): S and Z ship with
    // weakened joints. Read as "how much weaker", because weakBondMult is a
    // multiplier that falls as the passive gets stronger and a bare 0.70 reads
    // backwards. Guarded on the type list, since a mult with nothing to apply
    // to is not a passive the ship has.
    id: "seams", label: "S/Z seams", short: "Seams",
    read: (c) => (c.weakBondTypes.length ? c.weakBondMult : 1),
    fmt: (v) => (v >= 1 ? "stock" : `${Math.round((1 - v) * 100)}% weaker`),
    higherIsWorse: true,
  },
  {
    id: "bombs", label: "Demolition charges", short: "Charges",
    read: (c) => c.bombCharges, fmt: int, higherIsWorse: false,
  },
  {
    // What is LEFT in the rack, for the same reason the Bond Breaker row reads
    // the magazine rather than the grant: levelForRun overwrites the config's
    // charges with RunState.thawCharges, so a refit projects the delta the
    // rung issues on top of what the bay already spent. That distinction has
    // one more consequence here than it does there — on the Skydeck the lance
    // never resupplies (run.ts's advanceRun), so this row is the only place a
    // player can see what a rung actually adds to a magazine that is not
    // coming back. There is no yard on the Skydeck today, which makes the row
    // a promise the mode cannot yet call in rather than a claim it disagrees
    // with.
    id: "thaw", label: "Thaw charges", short: "Thaw",
    read: (c) => c.thawCharges, fmt: int, higherIsWorse: false,
  },
  {
    // THE LINER'S DEPTH, not its softening, and one row rather than two. The
    // cushion ladders on both (upgrades.ts's CUSHION_TIERS) and every rung
    // moves both, so a second row would be a second copy of the same purchase
    // — and depth is the half a player can look at the bay and check. The
    // softening is quoted where a number belongs to a rule rather than to a
    // projection: the shop card and the guide both print the speed it takes to
    // set a cube off inside the liner.
    //
    // Cells, because that is the unit the config field is in and the unit the
    // rest of the bay's geometry is quoted in. Zero prints as "bare floor" so
    // an unbought track reads as a state rather than as a measurement of
    // nothing.
    id: "cushion", label: "Cushion liner", short: "Liner",
    read: (c) => c.cushionCells,
    fmt: (v) => (v > 0 ? `${Math.round(v)} cells` : "bare floor"),
    higherIsWorse: false,
  },
  {
    // THE HOOD'S RATE, printed as a percentage off rather than as the raw
    // share, because "50% off" is the sentence the shop card, the guide and
    // this tile all speak and a bare 0.5 would be the one number in the yard a
    // player has to convert.
    //
    // This row exists for a reason the others do not have to argue: the
    // Incinerator is the ONLY track whose effect never shows up in the bay
    // while it is being played. A liner is drawn on the floor, a lance counts
    // down in the rail, a reactor is in the float — the hood is the absence of
    // a charge, which looks exactly like not having been charged. The yard is
    // therefore the only place before the end card where the purchase can be
    // read at all, and upgrades.ts's own refit note is the standard it has to
    // meet: "a shop where a purchase projects nothing teaches that the purchase
    // does nothing".
    //
    // Zero prints as a state, not as "0%", for the same reason the liner's does.
    id: "incinerator", label: "Incinerator relief", short: "Flue",
    read: (c) => c.incineratorRelief,
    fmt: (v) => (v > 0 ? `${Math.round(v * 100)}% off` : "no hood"),
    higherIsWorse: false,
  },
  {
    // The Demolition Rack's capstone is a CHANGE IN KIND rather than more
    // charges, so a projection that only counted charges would show its third
    // tier buying the same +2 the second one did. Three rows, because it moves
    // three numbers: the resupply line, the blast and the rate.
    id: "resupply", label: "Charge resupply", short: "Resupply",
    read: (c) => c.bombResupplyLines,
    fmt: (v) => (v > 0 ? `+1 / ${Math.round(v)} lines` : "none"),
    higherIsWorse: false,
  },
  {
    id: "blast", label: "Blast radius", short: "Blast",
    read: (c) => c.bombBlastMult,
    fmt: (v) => (v > 1 ? `×${v.toFixed(2).replace(/0$/, "")}` : "stock"),
    higherIsWorse: false,
  },
  {
    // Quoted per CUBE, the unit detonate actually pays in — a charge's worth
    // depends on how much it caught, and a per-blast figure would be inventing
    // an average the bay never promised.
    id: "salvage", label: "Salvage per cube", short: "Salvage",
    read: (c) => c.salvagePerCube,
    fmt: (v) => `$${Math.round(v)}`,
    higherIsWorse: false,
  },
  // THE BELT, as ONE tile. This used to be six — a row per content axis — and
  // a Tier 10 material clause moved all six at once: two extra rows of tiles
  // on the screen that overflows first (the owner's device pass). The
  // projection prices the BAY, and belt.ts's ceiling made the TOTAL the number
  // that prices it: past the ceiling, notches recompose the belt rather than
  // thicken it, and total density is what waste and congestion actually
  // charge.
  //
  // WHICH materials make it up is this row's own `parts` — a line each, inside
  // the one tile. That used to be the cards' business ("the card the player is
  // holding names its material"), i.e. it was answered nowhere on the panel,
  // and it is the half of the belt this row cannot do without: past belt.ts's
  // ceiling every further notch moves the SPLIT and leaves this total exactly
  // where it was, so a tile printing only the total goes quiet on the pressure
  // it exists to price. The six-tiles argument above is untouched — a part is
  // not a tile, and the grid still gets one item for the belt.
  {
    id: "belt",
    label: "Special cargo on the belt",
    short: "Belt",
    read: (c) => mixTotal(c.materialMix),
    fmt: rate,
    higherIsWorse: true,
    showWhen: (v) => v > 0.005,
    // Live whenever ANY content axis has banked notches — the belt row is
    // every material row's heir, so it inherits all of their axes.
    axis: HAZARDS.filter((h) => h.material).map((h) => h.id),
    // EVERY MATERIAL THE BAY KNOWS, and only those: a share on either side of
    // the comparison, or a banked notch on its own axis. A zero line for a
    // material the run has never met would be five sixths of this list on an
    // ordinary bay, on the panel that overflows first. MATERIAL_ROLL_ORDER
    // rather than a fresh order, so the list reads in the belt's own sequence.
    parts: (base, next, tally) => {
      const parts: PreviewPart[] = [];
      for (const id of MATERIAL_ROLL_ORDER) {
        const a = base.materialMix?.[id] ?? 0;
        const b = next.materialMix?.[id] ?? 0;
        const notches = tally[id] ?? 0;
        if (a <= 0.005 && b <= 0.005 && notches <= 0) continue;
        const from = rate(a);
        const to = rate(b);
        const changed = from !== to;
        parts.push({
          id,
          label: MATERIAL_SPEC[id].name,
          from,
          to,
          changed,
          // More of a material is worse news, which is the judgement the TOTAL
          // above already makes for all six of them at once — not a second one
          // invented here. Magnetic is the material that helps and it is still
          // a notch the player spent a pick on.
          tone: !changed ? "same" : b > a ? "worse" : "better",
          notches,
        });
      }
      return parts;
    },
  },
];

/**
 * The projection rows for a tentative selection: `base` is the next bay as the
 * run stands, `next` is that same bay with the picks folded in. Pass the same
 * config twice and every row comes back unchanged, which is exactly what an
 * empty selection should look like.
 *
 * `banked` is the run's RATCHETS AS THEY STAND (before the tentative picks):
 * any axis with a banked notch is a live pressure on the next bay whatever the
 * current selection touches, so its rows stay on the projection, flagged
 * active and promoted to core (the frame, not droppable context). Defaults to
 * none so callers without a run — the same config twice, a bare comparison —
 * keep the old behaviour exactly.
 *
 * `tally` is the run's notches FOR QUOTING, and it is a second parameter rather
 * than a second use of `banked` because the two do different things. `banked`
 * PROMOTES: an axis with notches pins its rows core and active, beyond the
 * compact grid's reach. That is right on a draft, where the decision is the
 * pressure, and wrong in the yard, where four unmoved pressure tiles push the
 * rows the ORDER moved off the bottom of a landscape phone (main.ts's refitHTML
 * has the measurement). The yard still wants the COUNTS — a belt breakdown that
 * says a bay is 12% slag without saying the player took slag twice is half a
 * sentence — so it passes them here and leaves `banked` empty. Defaults to
 * `banked`, so a caller that wants both gets both from one argument and nothing
 * that exists today changes.
 */
export function previewRows(
  base: LevelConfig,
  next: LevelConfig,
  banked: Ratchets = {},
  tally: Ratchets = banked,
): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const f of FIELDS) {
    const a = f.read(base);
    const b = f.read(next);
    const from = f.fmt(a);
    const to = f.fmt(b);
    const changed = from !== to;
    const axes: readonly HazardId[] =
      f.axis === undefined ? [] : typeof f.axis === "string" ? [f.axis] : f.axis;
    const active = axes.some((x) => (banked[x] ?? 0) > 0);
    if (!changed && !active && !f.always && !(f.showWhen?.(a) ?? false)) continue;
    rows.push({
      id: f.id,
      label: f.label,
      short: f.short ?? f.label,
      from,
      to,
      changed,
      tone: !changed
        ? "same"
        : f.toneFor
          ? f.toneFor(a, b)
          : (b > a) === f.higherIsWorse ? "worse" : "better",
      kind: f.always || active ? "core" : "context",
      active,
      ...(f.parts ? { parts: f.parts(base, next, tally) } : {}),
    });
  }
  return rows;
}
