/**
 * Render-facing effect events. Game.ts spawns these (and prunes them once
 * stale) as gameplay happens — line clears, bomb blasts — but never draws
 * them; that's render.ts's job. `t0` is the wall-clock `now` passed into
 * Game.update the step the event spawned, so a renderer can animate progress
 * as `now - t0` without Game needing to know anything about how it's drawn.
 */
import type { ClearGrade } from "./grades";

/** How far a "−$" penalty toast SINKS from where it spawned, over its life
 *  (render.ts's drawPenaltyFx). It lives here rather than in render.ts because
 *  a spawner has to be able to clear an obstacle for the toast's whole travel,
 *  not just for the pixel it starts on — see game.ts's chute penalty, which
 *  spawns above the plant panel's lip and would otherwise sink behind it. */
export const PENALTY_SINK_PX = 34;

/** The amber a demolition charge burns in: the colour render.ts has always
 *  stroked the shockwave ring with, named here because game.ts now stamps it
 *  onto the event. A charge going off has a colour whether or not a renderer
 *  is attached, and the ring and the wreckage it throws must be the same fire
 *  — two literals would drift the moment one of them was retuned. */
export const BLAST_AMBER = "#ffb347";

export type FxEvent =
  | { kind: "shatter"; x: number; y: number; color: string; t0: number }
  /** A line clear selling. `grade` is the clear's headline TIMING GRADE
   *  (grades.ts, lineClear.ts's headlineGrade) — the callout the player reads
   *  the shot by, drawn over the "+$" in the same toast rather than as a second
   *  effect, because the money and the verdict on how it was earned are one
   *  event and a second floater would race the first. Null where there is
   *  nothing to announce, which no in-game clear produces and every hand-built
   *  fixture does. */
  | {
    kind: "payout"; x: number; y: number; amount: number;
    grade: ClearGrade | null;
    /** The headline row's band was LOWERED because the bay was congested
     *  (grades.ts's CONGESTION_GRADE_CAP). Drawn as a tag under the money —
     *  the band shown is the one that was paid, so without this the player
     *  reads a perfectly threaded row as SWEPT and learns nothing about why.
     *  False for a row that was already at or under the cap. */
    congested: boolean;
    t0: number;
  }
  | { kind: "rowflash"; y: number; x0: number; x1: number; t0: number }
  | {
    kind: "explosion"; x: number; y: number; r: number;
    /**
     * WHAT WENT OFF, IN ITS OWN COLOUR — and, by being present at all, the
     * statement that something was DESTROYED here.
     *
     * render.ts's debris layer keys on exactly this. A blast that names a
     * colour sprays pixel wreckage in it: the material's hazard hue for a
     * volatile pop, the cargo's own colour for a shipment the intake ate,
     * BLAST_AMBER for a demolition charge. A blast that names none is a
     * SHOCKWAVE — a Bond Breaker discharge, a Thaw Lance strike — pressure
     * with no wreckage behind it, and it throws nothing, exactly as it did
     * before the debris layer existed.
     *
     * That is the whole reason this is optional rather than defaulted. The two
     * shockwaves are the widest rings the game draws (a Bond Breaker's is
     * CELL * 3.2), so a default would have put the biggest spray in the game
     * on the two events with the least to show for themselves — on top of the
     * dozens of `snap` puffs a discharge already spawns.
     */
    color?: string;
    t0: number;
  }
  /** Salvage refund from a demolition charge (see game.ts's detonate): the
   *  funds a blast paid back, rising from the blast center. Visually distinct
   *  from `payout` (which is a LINE selling) so the player can tell the two
   *  income sources apart at a glance — that legibility is the whole point of
   *  making bombs refund in the first place. */
  | { kind: "salvage"; x: number; y: number; amount: number; t0: number }
  /** Funds LOST to cargo that dropped out short of the compactor (see
   *  game.ts's lost-piece step): "−$amount" sinking from where the cubes
   *  blinked away. The expense twin of `payout` — income rises green, a
   *  penalty sinks red — so the two money verbs read apart at a glance. The
   *  blink alone was tried first and read as cubes merely despawning; the
   *  player learned the penalty existed from the end screen, which is the
   *  worst place to learn a rule. */
  | { kind: "penalty"; x: number; y: number; amount: number; t0: number }
  /** Bay cleared: a full-field sweep + burst, spawned once when the settle
   *  window resolves into a win (see game.ts's resolveWin). The DOM banner in
   *  ui/screens.ts plays over the top of it. */
  | { kind: "bayclear"; x: number; y: number; t0: number }
  /** ONE joint letting go, at the seam's midpoint — a stress snap on a hard
   *  landing, a joint the compactor crushed apart, or one seam of a Bond
   *  Breaker discharge (see pieces.ts's updateBreakableJoints /
   *  breakJointsInBand and game.ts's useBondBreaker, which all report what
   *  they tore). A deliberately tiny `shatter`: the pile losing rigidity is a
   *  rule the player has to learn from the field, and before this it was
   *  reported by nothing at all — the only evidence was that the stack behaved
   *  differently a second later. Small and short because a busy pile snaps
   *  many seams at once and this must read as texture, not as an event. */
  | { kind: "snap"; x: number; y: number; color: string; t0: number }
  /** One destroyed cube's wreckage, in that cube's own color (see game.ts's
   *  detonate and resolveVolatile). The blast ring says something went off;
   *  this says WHAT it took, which matters most for a volatile pop, where the
   *  answer is cargo the player had already landed. Bigger and fewer than
   *  `shatter`'s shards: a cube that came apart in chunks, not one that
   *  vaporized. */
  | { kind: "chunk"; x: number; y: number; color: string; t0: number };

/** How long (ms) each event kind stays alive before Game prunes it. */
export const FX_TTL: Record<FxEvent["kind"], number> = {
  shatter: 700,
  payout: 1100,
  rowflash: 450,
  /** 600ms of this is the SHOCKWAVE — the ring, the flash and the orbiting
   *  sparks, which keep their own EXPLOSION_RING_MS clock in render.ts so they
   *  look exactly as they always did. The rest is the debris outliving the
   *  bang it came out of, which is the entire difference between a blast that
   *  pops and one that throws: the embers have to still be falling after the
   *  ring has gone, or the eye reads the whole thing as a single frame's
   *  flicker. 900 is where the last ember lands roughly two cells below a
   *  cell-scale blast (see render.ts's DEBRIS_BANDS gravity) — long enough to
   *  watch, short enough that a chain of pops does not leave a standing haze. */
  explosion: 900,
  salvage: 1100,
  penalty: 1100,
  bayclear: 1400,
  snap: 500,
  chunk: 800,
};
