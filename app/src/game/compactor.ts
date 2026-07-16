import Matter from "matter-js";
import { WORLD } from "./engine";
import type { LevelConfig } from "./level";

/**
 * Kinematic sweep bar. A bar covering the BOTTOM portion of the field (so pieces
 * can be lofted over its top onto the right floor). It sweeps back and forth
 * between center and the right margin: the rightward (forward) stroke presses
 * the pile against the wall — that is when a full row is crushed and cleared —
 * and the leftward stroke retreats to let more pieces fall. Pieces that bounce
 * all the way back out toward the launcher decay; nothing is deleted just for
 * the bar passing over it.
 */
export class Compactor {
  body: Matter.Body;
  width = 26;
  height = Math.round(WORLD.height * 0.5); // bottom half — arc over the top
  speed: number;
  margin: number;
  /** +1 = advancing right (applying pressure), -1 = retreating left. */
  dir: 1 | -1 = 1;
  readonly leftX = WORLD.width / 2;
  readonly yCenter: number;

  constructor(world: Matter.World, level: LevelConfig) {
    this.speed = level.compactorSpeed;
    this.margin = level.compactorMargin;
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
  get rightX(): number {
    return WORLD.width - this.margin;
  }
  get top(): number {
    return this.yCenter - this.height / 2;
  }
  /** True while pressing the pile toward the wall (the crushing stroke). */
  get pressing(): boolean {
    return this.dir === 1;
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
