import Matter from "matter-js";
import { WORLD } from "./engine";
import type { LevelConfig } from "./level";

/**
 * Kinematic sweep bar. Ports main.py's Compactor: a bar covering the BOTTOM
 * portion of the field (so pieces can be lofted over its top onto the right
 * floor). It marches from center toward the right margin, then snaps back.
 * Pieces caught to its left decay; full rows to its right get cleared.
 */
export class Compactor {
  body: Matter.Body;
  width = 26;
  height = Math.round(WORLD.height * 0.5); // bottom half — arc over the top
  speed: number;
  margin: number;
  private startX = WORLD.width / 2;
  readonly yCenter: number;

  constructor(world: Matter.World, level: LevelConfig) {
    this.speed = level.compactorSpeed;
    this.margin = level.compactorMargin;
    this.yCenter = WORLD.height - this.height / 2;
    this.body = Matter.Bodies.rectangle(
      this.startX,
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

  update(): void {
    if (this.body.position.x < WORLD.width - this.margin) {
      Matter.Body.setPosition(this.body, {
        x: this.body.position.x + this.speed,
        y: this.yCenter,
      });
    } else {
      Matter.Body.setPosition(this.body, { x: this.startX, y: this.yCenter });
    }
  }

  reset(): void {
    Matter.Body.setPosition(this.body, { x: this.startX, y: this.yCenter });
  }
}
