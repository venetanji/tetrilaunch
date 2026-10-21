import { Game } from '../app/src/game/game';
import { levelForGraduation } from '../app/src/game/run';
import { LESSON_COUNT, lessonAt, lessonSeed, levelForLesson } from '../app/src/game/school';
import { stockTiers } from '../app/src/game/upgrades';

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
    const loadout = stockTiers();
    return new Game(lesson ? levelForLesson(lesson, loadout) : levelForGraduation(loadout), {},
      lesson ? lessonSeed(this.#index) : 0x54455452);
  }
  step(now: number): void {
    if (!this.#complete && !this.#game.paused) this.#game.update(now);
  }
  pause(paused: boolean): void {
    // Resume resets the frame accumulator, so alpha zero must hold the paused transform.
    if (this.#game.paused && !paused && !this.#complete) this.#game.collapseStepWindow();
    this.#game.paused = paused || this.#complete;
  }
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
