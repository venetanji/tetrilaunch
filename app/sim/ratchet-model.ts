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
 * that `--marks` means something — makeBaseLevel(bay, mark) moves the Mark's
 * opening terms (targetScore, startingFunds, launchCost, timeLimitSec) and the
 * bond ramp, but deals none of the Mark's hazards, so a sweep that only passes
 * the mark through to the base level is comparing two price lists rather than
 * two difficulties.
 */
import { hazardsForMark, picksPerBay, type Ratchets } from "../src/game/hazards";

/**
 * `(B-1) x picksPerBay` notches, round-robin over the NUMBER axes the Mark
 * deals, in ladder order (cost, time, wind, sweeper).
 *
 * Content axes are excluded because the bots own no answer to a material — none
 * of them ever fires a demolition charge, which is slag's only exit — so
 * including them would measure "bots cannot play slag" rather than the ladder.
 *
 * THIS IS A REAL BLIND SPOT, not just a modelling convenience, and it is worth
 * naming because it sits exactly where a Tier-10 run actually gets hard. An
 * earlier version of this note also justified the exclusion with "every hand
 * holds at least two number axes, so content is always dodgeable", and that has
 * not been true since MATERIAL_DRAFT_BAYS: three bays a run deal a hand the
 * player cannot answer with a number. So a `spread` sweep is pricing a run that
 * no player flies — it reads the ladder's NUMBERS at a Mark and says nothing
 * about its MATERIALS. Measured on the same rig and bay, the gap is the whole
 * result: Tier 10 bay 5 takes 83% of bays with the number axes alone and 8-17%
 * once the materials a run would really be carrying are on the belt, every loss
 * to bankruptcy. Read a `--ratchets spread` number as an upper bound.
 *
 * The slid Fibonacci ladders are what this exists to price, and the slide is
 * hazards.ts's ladderStart — floor((mark-1)/2), one rung per TWO Marks, not
 * per Mark. The per-Mark slide this model was first written against is the one
 * marks.ts rejected with it: it measured every Mark from 5 up at 0% run-clear,
 * because a linear build budget cannot answer an exponential table entered at
 * exponential heights.
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
