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
export class Compactor {
  body: Matter.Body;
  width: number;
  height: number;
  speed: number;
  /** +1 = advancing right (applying pressure), -1 = retreating left. */
  dir: 1 | -1 = 1;
  /** Body-center X at the open/left stop (zone = compactorOpenCells). */
  readonly leftX: number;
  /** Body-center X at the full-advance/right stop (zone = compactorMinLineCells). */
  readonly rightX: number;
  readonly yCenter: number;

  constructor(world: Matter.World, level: LevelConfig) {
    this.speed = level.compactorSpeed;
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

  update(): void {
    let x = this.body.position.x + this.speed * this.dir;
    if (x >= this.rightX) {
      x = this.rightX;
      this.dir = -1;
    } else if (x <= this.leftX) {
      x = this.leftX;
      this.dir = 1;
    }
    Matter.Body.setPosition(this.body, { x, y: this.yCenter });
  }

  reset(): void {
    this.dir = 1;
    Matter.Body.setPosition(this.body, { x: this.leftX, y: this.yCenter });
  }
}
