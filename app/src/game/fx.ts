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
    grade: ClearGrade | null; t0: number;
  }
  | { kind: "rowflash"; y: number; x0: number; x1: number; t0: number }
  | { kind: "explosion"; x: number; y: number; r: number; t0: number }
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
  explosion: 600,
  salvage: 1100,
  penalty: 1100,
  bayclear: 1400,
  snap: 500,
  chunk: 800,
};
