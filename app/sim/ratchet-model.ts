/**
 * The ratchet stack a Mark-M run is carrying by the time it reaches bay B.
 *
 * SIM-ONLY, and deliberately not in src/game. In the real game ratchets are
 * DRAFTED — the player picks an axis between bays — so there is no canonical
 * "the ratchets at bay 5". This is a model of an average run, and a model is
 * exactly the kind of thing that must not leak into the game's own rules.
 *
 * It lives in its own file because two sims need it and a difficulty model
 * copied into two places is how a sweep ends up describing a game that no
 * longer exists. marks.ts prices the Mark ladder with it; pile.ts uses it so
 * that `--marks` means something — makeBaseLevel(bay, mark) sets `cfg.mark` and
 * NOTHING else, so a sweep that only passes the mark through to the base level
 * is comparing a level with itself.
 */
import { hazardsForMark, picksPerBay, type Ratchets } from "../src/game/hazards";

/**
 * `(B-1) x picksPerBay` notches, round-robin over the NUMBER axes the Mark
 * deals, in ladder order (cost, time, wind, sweeper).
 *
 * Content axes are excluded because every hand holds at least two number axes
 * (hazards.ts), so content is always dodgeable — and because the bots own no
 * answer to a material, so including them would measure "bots cannot play
 * slag" rather than the ladder.
 *
 * The slid Fibonacci ladders (notchTotal's startAt = mark - 1) are what this
 * exists to price: at Mark M the first cost/time notch lands M-1 rungs up.
 */
export function spreadRatchets(mark: number, bay: number): Ratchets {
  const axes = hazardsForMark(mark).filter((h) => h.kind === "number").map((h) => h.id);
  const picks = (bay - 1) * picksPerBay(mark);
  const out: Ratchets = {};
  for (let k = 0; k < picks; k++) {
    const id = axes[k % axes.length];
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}
