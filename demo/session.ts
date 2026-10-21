import { Game } from '../app/src/game/game';
import { makeBaseLevel } from '../app/src/game/level';
import { LESSON_COUNT, lessonAt, lessonSeed, levelForLesson } from '../app/src/game/school';

// This is an in-memory sampler, not a RunState. No URL, save, account or
// caller-supplied bay can extend its boundary into the campaign.
export const DEMO_LESSONS = LESSON_COUNT;
export class DemoSession {
  #index = 0;
  #complete = false;
  #game = this.createGame();
  get index(): number { return this.#index; }
  get complete(): boolean { return this.#complete; }
  get game(): Game { return this.#game; }
  get lesson() { return this.#index < DEMO_LESSONS ? lessonAt(this.#index) : null; }
  private createGame(): Game {
    const lesson = this.lesson;
    return new Game(lesson ? levelForLesson(lesson) : makeBaseLevel(0, 1), {},
      lesson ? lessonSeed(this.#index) : 0x54455452);
  }
  step(now: number): void {
    if (!this.#complete && !this.#game.paused) this.#game.update(now);
  }
  pause(paused: boolean): void { this.#game.paused = paused || this.#complete; }
  advance(): boolean {
    if (this.#complete || this.#game.status !== 'won') return false;
    if (this.#index === DEMO_LESSONS) {
      this.#complete = true;
      this.#game.paused = true;
    } else {
      this.#game.destroy();
      this.#index++;
      this.#game = this.createGame();
    }
    return true;
  }
  retry(): void {
    if (this.#complete) return;
    this.#game.destroy();
    this.#game = this.createGame();
  }
  restart(): void {
    this.#game.destroy();
    this.#index = 0;
    this.#complete = false;
    this.#game = this.createGame();
  }
  destroy(): void { this.#game.destroy(); }
}
