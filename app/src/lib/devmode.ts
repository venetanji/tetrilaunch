/**
 * TIER S — the gesture that opens the sandbox, and the line between the MODE
 * and the developer CHEATS.
 *
 * There are two different things in this repo wearing the word "sandbox", and
 * keeping them apart is the whole reason this module exists:
 *
 *   1. THE MODE (this file). A floor under the tower that launches any Mark,
 *      any bay, any Contract variant, any rig, any belt, pre-ratcheted to
 *      taste. It ships in every build. It cannot pay salvage, cannot advance
 *      the ladder, and files its scores on a board of its own (lib/api.ts's
 *      BOARD_SANDBOX) — so nothing it does can be mistaken for something
 *      earned, which is exactly what makes it safe to hand to a player.
 *
 *   2. THE CHEATS (lib/sandbox.ts's SANDBOX). Buttons that rewrite the SAVE:
 *      set the Mark, grant salvage, unlock everything, wipe. Those stay behind
 *      the build-mode gate they have always had, they still carry the marker
 *      string scripts/verify-store-bundle.mjs greps for, and no gesture opens
 *      them. A shippable bundle has the mode and not the cheats.
 *
 * WHY A GESTURE AT ALL.
 *
 * lib/sandbox.ts argues — correctly, for what it was gating — that a hidden
 * entry protects nothing when a build flag already removes the code. That
 * argument does not carry here, because this door is not protecting anything:
 * every build HAS Tier S, and the gesture is not a lock. It is a threshold.
 * The mode is a lot of screen for a player who has flown three bays, and a
 * seventh way into the game on the main menu is the last thing that menu
 * needs (see the note in menuScreen's action column, where a seventh button
 * pushed Settings off a 360dp phone). Nine taps on the beacon is a thing you
 * only do on purpose, which is the right size of commitment for a mode that
 * hands you the whole ladder at once.
 *
 * It is also REVERSIBLE by the same gesture, and mirrored by a Settings toggle
 * once found. A door with no handle on the inside is a trap.
 */

/** Taps on the headhouse beacon that open (or close) Tier S. */
export const DEV_TAPS_REQUIRED = 9;

/**
 * How long a tap stays "in a row" with the next one.
 *
 * "Nine times in a row" has to mean something a finger can actually perform,
 * and the failure it must not have is a counter that quietly holds at 6 from
 * yesterday and completes on three taps today. 1400ms is comfortably above a
 * deliberate tapping cadence (~250-400ms) with room for a fumble, and far
 * below "I came back to this screen later".
 */
export const DEV_TAP_WINDOW_MS = 1400;

/** Taps after which the beacon starts visibly responding — see the note on
 *  `progress`. Half the run, so the hint arrives to someone who is already
 *  tapping deliberately and never to someone who double-tapped the roof. */
export const DEV_TAP_HINT_AT = 4;

export interface TapResult {
  /** Taps in the current streak, 1..DEV_TAPS_REQUIRED. */
  count: number;
  /** 0 until DEV_TAP_HINT_AT, then 0..1 across the remaining taps.
   *
   *  The beacon is the ONLY feedback this gesture gets, and it needs some:
   *  eight taps that do nothing at all are indistinguishable from a dead
   *  control, and the ninth then arrives as a non-sequitur. Lighting the lamp
   *  progressively from the halfway mark says "something is counting" to
   *  someone already committed, without advertising the door to someone who
   *  brushed it. */
  progress: number;
  /** True on the tap that completes the run. The caller flips the mode. */
  complete: boolean;
}

/**
 * The consecutive-tap counter behind the beacon.
 *
 * Pure and time-injected (`now` is passed in, never read) so sim/systems.ts can
 * test the window without a clock, and so a paused tab cannot complete a run
 * of taps it did not receive.
 */
export class TapStreak {
  private count = 0;
  private last = -Infinity;

  constructor(
    private readonly required = DEV_TAPS_REQUIRED,
    private readonly windowMs = DEV_TAP_WINDOW_MS,
  ) {}

  /** Register one tap. Returns where the streak now stands. */
  press(now: number): TapResult {
    this.count = now - this.last <= this.windowMs ? this.count + 1 : 1;
    this.last = now;
    const complete = this.count >= this.required;
    // Reset ON completion, not after it: the gesture toggles, so the tenth tap
    // has to start a fresh run rather than re-completing the ninth.
    if (complete) this.reset();
    return {
      count: complete ? this.required : this.count,
      progress: progressFor(complete ? this.required : this.count, this.required),
      complete,
    };
  }

  reset(): void {
    this.count = 0;
    this.last = -Infinity;
  }
}

function progressFor(count: number, required: number): number {
  if (count < DEV_TAP_HINT_AT) return 0;
  const span = Math.max(1, required - DEV_TAP_HINT_AT);
  return Math.min(1, (count - DEV_TAP_HINT_AT) / span);
}
