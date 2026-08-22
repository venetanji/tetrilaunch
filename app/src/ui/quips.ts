/**
 * QUIPS — the game's playful voice. One-liners the launch crew mutters at the
 * moments a bay produces on its own: a fresh bay opening, cargo tumbling out
 * the wrong side, a multi-line payout, the bankroll getting thin, the settle
 * window after the target lands.
 *
 * The discipline that keeps this from becoming noise:
 *
 *  - FLAVOR ONLY, never information. Anything a player needs to act on lives
 *    in the plant readout, the settle note, or the end modal's plain-language
 *    cause block — all of which playtests pushed TOWARD clarity, not away from
 *    it. Because a quip carries no rule, it can be rate-limited, skipped
 *    during the tutorial, and hidden from screen readers at zero cost.
 *  - RATE-LIMITED at the caller (main.ts's showQuip): one line every several
 *    seconds at most, so a bad streak of lost cargo reads as one joke, not a
 *    chat log scrolling over the field.
 *  - NO IMMEDIATE REPEATS: each moment remembers its last line, so two lost
 *    shipments in a row never yell the same thing twice. True variety needs
 *    only that much bookkeeping — a full shuffle bag would be over-engineering
 *    for pools this size.
 */

/** The gameplay beats that have a voice. Kept deliberately coarse — a pool per
 *  fine-grained event (per material, per bay, per mod) would spread the
 *  writing thin and make every pool repeat sooner. */
export type QuipMoment =
  | "bayStart"
  | "pieceLost"
  | "bigClear"
  | "lowLaunches"
  | "lowTime"
  | "settle"
  | "pause";

/** How long a quip stays up (ms). Shorter than the settle note's whole window
 *  — a joke overstaying its welcome stops being one. */
export const QUIP_SHOW_MS = 2600;

/** Minimum gap between non-milestone quips (ms). Sized so that even a rough
 *  bay produces a remark, not a monologue — at ~9s the ceiling is roughly one
 *  line per two or three shots. Milestone moments (bay start, the settle
 *  window) bypass it via showQuip's `force`: they happen once a bay, so they
 *  can't spam by construction. */
export const QUIP_GAP_MS = 9000;

const POOLS: Record<QuipMoment, readonly string[]> = {
  bayStart: [
    "Try to stack them nicely… or not.",
    "Fresh bay, fresh bankroll. What could go wrong?",
    "The cannon's warm. The cargo's nervous.",
    "Physics is on your side. Officially.",
    "Today's forecast: raining tetrominoes.",
  ],
  // The lost-cargo lines mourn the SHIPMENT, not the fine — the red −$ toast
  // (fx.ts's `penalty`) already states the cost, and a Contract prices a lost
  // cube at $0, so money talk here would be wrong half the time.
  pieceLost: [
    "NOOO! Not my luggage!",
    "That shipment had a family!",
    "Gone. Like your deposit.",
    "We don't talk about that one.",
    "The void thanks you for your donation.",
  ],
  bigClear: [
    "Now THAT'S how you ship cargo!",
    "The compactor sheds a proud tear.",
    "Textbook. Frame it. Ship it.",
    "Somewhere, a logistics manager just gasped.",
  ],
  lowLaunches: [
    "Keep calm and launch on.",
    "Make this one count. No pressure.",
    "The bankroll would like a word.",
  ],
  lowTime: [
    "No pressure. Okay, some pressure.",
    "Launch now, apologize later.",
    "The clock is not your friend anymore.",
  ],
  settle: [
    "Have faith in your compactor.",
    "You did your part. The big red bar does the rest.",
    "Target met. Cue the crunch.",
  ],
  pause: [
    "Keep calm and launch on.",
    "The cargo will wait. Probably.",
    "The compactor never truly rests.",
  ],
};

/** Last index served per pool, so back-to-back picks never repeat. */
const lastPick: Partial<Record<QuipMoment, number>> = {};

/** A random line for the moment, never the same one twice in a row. */
export function pickQuip(moment: QuipMoment): string {
  const pool = POOLS[moment];
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastPick[moment]) i = (i + 1) % pool.length;
  lastPick[moment] = i;
  return pool[i];
}
