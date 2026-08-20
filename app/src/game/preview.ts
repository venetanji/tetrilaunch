import { HAZARDS } from "./hazards";
import type { LevelConfig } from "./level";

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
  read(cfg: LevelConfig): number;
  fmt(v: number): string;
  /** True when a bigger number is worse news for the player. Drives colour
   *  only — a notch is never good, but "the clock got shorter" and "the target
   *  got bigger" move in opposite directions numerically. */
  higherIsWorse: boolean;
  /** Shown even when the selection doesn't touch it: the four numbers a bay is
   *  priced by are the frame the change is read against, so they never vanish. */
  always?: boolean;
  /** For the rest: shown when the axis is already in play at this bay, so a
   *  player can see the crosswind they are already flying before deciding to
   *  ratchet it. Anything else appears the moment a pick touches it. */
  showWhen?(baseVal: number): boolean;
}

const FIELDS: Field[] = [
  { id: "target", label: "Funding target", read: (c) => c.targetScore, fmt: money, higherIsWorse: true, always: true },
  { id: "float", label: "Opening float", read: (c) => c.startingFunds, fmt: money, higherIsWorse: false, always: true },
  { id: "cost", label: "Launch cost", read: (c) => c.launchCost, fmt: money, higherIsWorse: true, always: true },
  // Derived, and deliberately the headline the economy note argues in: a bay
  // opens with N shots in the bank. It is the one row where the levy's $5 and
  // the float's carry meet, so it moves when EITHER does.
  {
    id: "shots",
    label: "Shots in the bank",
    read: (c) => (c.launchCost > 0 ? Math.floor(c.startingFunds / c.launchCost) : 0),
    fmt: int,
    higherIsWorse: false,
    always: true,
  },
  { id: "clock", label: "Shift clock", read: (c) => c.timeLimitSec, fmt: clock, higherIsWorse: false, always: true },
  {
    id: "wind", label: "Crosswind", read: (c) => c.windMax, fmt: (v) => v.toFixed(2),
    higherIsWorse: true, showWhen: (v) => v > 0.005,
  },
  {
    id: "sweeper", label: "Press speed", read: (c) => c.compactorSpeed, fmt: (v) => `${v.toFixed(2)}×`,
    higherIsWorse: true,
  },
  {
    id: "cells", label: "Press gap", read: (c) => c.compactorOpenCells, fmt: (v) => `${Math.round(v)} cells`,
    higherIsWorse: false,
  },
  // The content axes, in ladder order, labelled off their own HazardDef so a
  // new material is still one table row in hazards.ts and nothing here.
  ...HAZARDS.filter((h) => h.material).map((h): Field => ({
    id: `mat:${h.material}`,
    label: `${h.name.replace(/ Contract$/, "")} on the belt`,
    read: (c) => c.materialMix[h.material!] ?? 0,
    fmt: rate,
    higherIsWorse: true,
    showWhen: (v) => v > 0.005,
  })),
];

/**
 * The projection rows for a tentative selection: `base` is the next bay as the
 * run stands, `next` is that same bay with the picks folded in. Pass the same
 * config twice and every row comes back unchanged, which is exactly what an
 * empty selection should look like.
 */
export function previewRows(base: LevelConfig, next: LevelConfig): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const f of FIELDS) {
    const a = f.read(base);
    const b = f.read(next);
    const from = f.fmt(a);
    const to = f.fmt(b);
    const changed = from !== to;
    if (!changed && !f.always && !(f.showWhen?.(a) ?? false)) continue;
    rows.push({
      id: f.id,
      label: f.label,
      from,
      to,
      changed,
      tone: !changed ? "same" : (b > a) === f.higherIsWorse ? "worse" : "better",
    });
  }
  return rows;
}
