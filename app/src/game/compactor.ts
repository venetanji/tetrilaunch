import Matter from "matter-js";
import { WORLD, CELL, WALL_INNER } from "./engine";
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

  update(): void {
    let x = this.body.position.x + this.speed * this.dir;
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
  }
}
