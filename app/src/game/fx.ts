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
  | { kind: "explosion"; x: number; y: number; r: number; t0: number };

/** How long (ms) each event kind stays alive before Game prunes it. */
export const FX_TTL: Record<FxEvent["kind"], number> = {
  shatter: 700,
  payout: 1100,
  rowflash: 450,
  explosion: 600,
};
