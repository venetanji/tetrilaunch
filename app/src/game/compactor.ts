import Matter from "matter-js";
import { WORLD, CELL, WALL_INNER, markPrevStep } from "./engine";
import type { LevelConfig } from "./level";

/**
 * Kinematic sweep bar. A bar covering the BOTTOM portion of the field (so pieces
 * can be lofted over its top onto the right floor). It presses forward to the
 * compactorMinLineCells (minimum full line) stop and then opens back up to the
 * compactorOpenCells (fully open) stop at the same pace — a ping-pong stroke,
 * same speed both ways, that never teleports. The forward stroke is when a full
 * row is crushed and cleared; the retreat lets more pieces fall into the
 * widening zone. Pieces that bounce all the way back out toward the launcher
 * decay; nothing is deleted just for the bar passing over it.
 */
/** The stock stroke span in cells — makeBaseLevel's 12 open minus 8 min-line. */
const STOCK_SPAN_CELLS = 4;

/**
 * The speed the bar actually travels at, normalised so the ROUND TRIP takes the
 * same time at any bay width.
 *
 * `compactorOpenCells` used to set two unrelated things at once: how much room
 * the player has to land in, and how long a cycle takes. Bay Extension T3 took
 * the cycle from 4.4s to 11.1s — measured — so a card advertising "more room to
 * land in" was also handing over a compactor 2.5x slower, against a fixed bay
 * clock. Worse, playtest telemetry shows a player fires about once per stroke
 * and waits out the rest, so a longer window buys no extra shots; it only
 * spaces them further apart.
 *
 * Scaling speed with the span separates the two: width is width, and pace stays
 * whatever `compactorSpeed` says it is. Hydraulics still multiplies this — its
 * "+8% stroke speed" now genuinely means a faster press instead of partially
 * cancelling a self-inflicted slowdown.
 */
export function compactorSpeedFor(level: LevelConfig): number {
  const span = Math.max(1, level.compactorOpenCells - level.compactorMinLineCells);
  return level.compactorSpeed * (span / STOCK_SPAN_CELLS);
}

/* ---------------------------------------------------------------------------
 * THE PRESS LABOURS AGAINST BAR STOCK
 *
 * A rigid material's card (hazards.ts's Rebar Contract) promises one cost —
 * "what lands is what you keep" — and theme.ts spells it out as "a bad landing
 * cannot be squeezed, shoved or shattered into a better one." The SHATTERING
 * half was enforced (pieces.ts stamps Infinity, and lineClear.ts's
 * breakJointsInBand exempts the press). The SQUEEZING half was not, and this
 * bar is why: it is a kinematic body moved by setPosition, so it advances at
 * exactly the same pace through a welded steel cage as through empty air.
 *
 * Measured, that made the whole axis free. On paired seeds at three Tiers, a
 * belt one third rebar landed inside noise of a CLEAN belt at every notch count
 * — 45/48 against 45/48 at Tier 8 bay 10, 43-47/48 against 44/48 at Tier 10 bay
 * 5 — where one notch of cryo costs seventeen bay-wins and slag costs forty.
 * `hazards.ts` states the rule a ratchet axis lives by ("It is mandatory and
 * unrewarded. A notch is pure cost"), and rebar was the second axis after
 * volatile to be quietly breaking it. See §8 of
 * design/balance/winnability-sweep-findings.md.
 *
 * So the bar now pays for what it is pushing. Cost per still-bonded rigid cube
 * caught in front of the face, as a share of the press's pace:
 *
 *   drag = 1 / (1 + RIGID_PRESS_DRAG * n)
 *
 * A reciprocal rather than a subtraction, deliberately, and it is the whole
 * reason this is a difficulty knob rather than a lose button: it is strictly
 * positive for every n, so no amount of bar stock can ever stop the press dead.
 * hazards.ts makes the same argument for Shift Cut's floor — "an axis that can
 * reach an unplayable bay is not a difficulty knob, it is a lose button, and the
 * player picking it has no way to know which notch was the last survivable one."
 * It is also naturally proportional: one notch of rebar puts a rigid shipment in
 * front of the bar occasionally, six notches put one there most strokes, so the
 * axis scales with the belt without the constant knowing anything about the mix.
 *
 * And the exit is the one the fiction already sells (theme.ts: "The answer is
 * the Bond Emitter: a Bond Breaker charge is the one thing that splits it").
 * A charge empties the joint list, the cubes it freed stop counting here on the
 * very next step, and the press runs free again. Before this the emitter's only
 * job on a rebar belt was slumping the pile.
 * ------------------------------------------------------------------------- */

/**
 * What one still-bonded rigid cube in the bar's path costs the press, in the
 * denominator above. MEASURED — see the findings doc's §8 ladder, which flew
 * 0.10 / 0.20 / 0.35 against the same paired seeds and reports what each buys.
 */
export const RIGID_PRESS_DRAG = 0.2;

/**
 * How many cubes the drag will count. A cap, not a floor, and it is what keeps
 * a late bay from becoming a different game than an early one: past a point the
 * bar is labouring and more bar stock behind the first row changes nothing the
 * player can act on. Eight is two shipments' worth — the most rigid cargo the
 * belt's own spacing rule (belt.ts's MATERIAL_GAP) can put in front of the face
 * inside a couple of strokes.
 */
export const RIGID_PRESS_DRAG_CAP = 8;

/** The share of its pace the press keeps with `n` rigid cubes in its path. */
export function rigidPressDrag(n: number): number {
  return 1 / (1 + RIGID_PRESS_DRAG * Math.min(Math.max(0, n), RIGID_PRESS_DRAG_CAP));
}

export class Compactor {
  body: Matter.Body;
  width: number;
  height: number;
  speed: number;
  /** +1 = advancing right (applying pressure), -1 = retreating left. */
  dir: 1 | -1 = 1;
  /** Completed PRESS strokes — incremented when the bar reaches its full
   *  advance, i.e. once per crushing pass. This is the unit a Contract is
   *  budgeted in (level.ts's strokeBudget): counting presses rather than round
   *  trips means the count ticks at the moment the player can see something
   *  happen, which is what makes "3 strokes left" readable. */
  strokes = 0;
  /** Body-center X at the open/left stop (zone = compactorOpenCells). */
  readonly leftX: number;
  /** Body-center X at the full-advance/right stop (zone = compactorMinLineCells). */
  readonly rightX: number;
  readonly yCenter: number;

  constructor(world: Matter.World, level: LevelConfig) {
    this.speed = compactorSpeedFor(level);
    this.width = level.compactorWidth;
    this.height = Math.round(WORLD.height * level.compactorHeightFrac);
    this.leftX = WALL_INNER - level.compactorOpenCells * CELL - this.width / 2;
    this.rightX = WALL_INNER - level.compactorMinLineCells * CELL - this.width / 2;
    this.yCenter = WORLD.height - this.height / 2;
    this.body = Matter.Bodies.rectangle(
      this.leftX,
      this.yCenter,
      this.width,
      this.height,
      { isStatic: true, friction: 0.8, restitution: 0.2, label: "compactor" },
    );
    Matter.Composite.add(world, this.body);
  }

  /**
   * The leftmost x a cube can settle at and still be reachable — the boundary
   * cargo is STRANDED across.
   *
   * Derived from the bar itself: leftX is its body-centre at the fully-retreated
   * stop, so a cube flush against its face there sits at the closest-to-the-
   * launcher position the zone will ever reach. The face never gets further
   * left than that, so anything left of this can never be compacted or counted
   * for a line.
   *
   * Lives here rather than at each of its three readers (lineClear's
   * markLostPieces decays across it, game.ts warns on it, chute.ts sizes its
   * maw to it) because all three have to agree on it exactly: a warning drawn
   * against one number and a penalty charged against another is a game lying
   * about its own rules.
   */
  get strandCutoffX(): number {
    return this.leftX + this.width / 2 - CELL / 2;
  }

  get x(): number {
    return this.body.position.x;
  }
  get top(): number {
    return this.yCenter - this.height / 2;
  }
  /** True while pressing the pile toward the wall (the crushing stroke). */
  get pressing(): boolean {
    return this.dir === 1;
  }

  /** One full round trip (retreat to open + press back to full advance), in
   *  physics steps — used to size the broke-loss grace window on a real
   *  compactor cadence instead of a hardcoded guess. */
  get cycleSteps(): number {
    return ((this.rightX - this.leftX) * 2) / this.speed;
  }

  /** Where in the stroke the bar is: 0 at the open stop, 1 at full advance.
   *  Pure observer, used by playtest telemetry (lib/telemetry.ts) to ask what
   *  the compactor was doing when the player chose to fire. Combined with
   *  `dir` it is the full phase — 0.5 rising and 0.5 falling are the same
   *  position but opposite halves of the cycle, and the player treats them
   *  very differently: one is a closing window, the other an opening one. */
  get phase(): number {
    const span = this.rightX - this.leftX;
    return span > 0 ? (this.x - this.leftX) / span : 0;
  }

  /**
   * Advance the bar one step.
   *
   * `drag` is the share of its speed the press keeps on this step — 1 is a bar
   * running free, and anything below it is a bar LABOURING. Only the game
   * computes it (Game.rigidPressDrag, off the field's still-bonded rigid
   * cargo); every other caller presses at full pace by omitting it, which is
   * the right default for a field that has nothing rigid in it.
   *
   * It scales the TRAVEL, never the stops or the stroke count: a dragged stroke
   * is a slow stroke, not a short one, so the bar still reaches full advance
   * and still counts (`strokes`) — a Contract budgeted in strokes must not be
   * quietly refunded or robbed by what happens to be lying in the bay.
   */
  update(drag = 1): void {
    // Retreat is free. The bar is not crushing anything on the way back, and a
    // press that opened slowly would take the drag out of the player's landing
    // window instead of out of its own crushing pace — the wrong half.
    const pace = this.dir === 1 ? this.speed * drag : this.speed;
    let x = this.body.position.x + pace * this.dir;
    if (x >= this.rightX) {
      x = this.rightX;
      // Count the press only on the step it actually completes — the bar sits
      // pinned at rightX for one step before reversing, and dir is still +1
      // here, so this fires exactly once per stroke.
      if (this.dir === 1) this.strokes += 1;
      this.dir = -1;
    } else if (x <= this.leftX) {
      x = this.leftX;
      this.dir = 1;
    }
    Matter.Body.setPosition(this.body, { x, y: this.yCenter });
  }

  reset(): void {
    this.dir = 1;
    this.strokes = 0;
    Matter.Body.setPosition(this.body, { x: this.leftX, y: this.yCenter });
    // A reset is the one move this bar makes that it does not TRAVEL, so it
    // opts out of being drawn as travel (engine.ts's markPrevStep). Without
    // this the first frame of the new bay lerps the bar from wherever the last
    // one left it — and because main.ts zeroes its accumulator on the same
    // beat, that frame draws at alpha 0, i.e. at the OLD position exactly.
    markPrevStep(this.body);
  }
}
