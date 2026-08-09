/**
 * Render-facing effect events. Game.ts spawns these (and prunes them once
 * stale) as gameplay happens — line clears, bomb blasts — but never draws
 * them; that's render.ts's job. `t0` is the wall-clock `now` passed into
 * Game.update the step the event spawned, so a renderer can animate progress
 * as `now - t0` without Game needing to know anything about how it's drawn.
 */
export type FxEvent =
  | { kind: "shatter"; x: number; y: number; color: string; t0: number }
  | { kind: "payout"; x: number; y: number; amount: number; t0: number }
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
  | { kind: "bayclear"; x: number; y: number; t0: number };

/** How long (ms) each event kind stays alive before Game prunes it. */
export const FX_TTL: Record<FxEvent["kind"], number> = {
  shatter: 700,
  payout: 1100,
  rowflash: 450,
  explosion: 600,
  salvage: 1100,
  penalty: 1100,
  bayclear: 1400,
};
