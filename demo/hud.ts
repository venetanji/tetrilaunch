import type { Game } from '../app/src/game/game';
import type { Lesson } from '../app/src/game/school';

export function goalReadout(game: Game, lesson: Lesson | null): string {
  const goal = game.level.lessonGoal;
  if (goal) {
    const target = goal.kind === 'atOnce' ? goal.lines : goal.kind === 'grade' ? goal.count : goal.to;
    const live = goal.kind === 'combo' ? ` · Live combo ×${game.combo}`
      : goal.kind === 'timedStreak' ? ` · Live streak ${game.timedStreak}` : '';
    return `${lesson?.goalLabel ?? 'Goal'} ${game.objectiveCurrent} / ${target}${live}`;
  }
  if (game.level.objectiveLines > 0) return `Rows ${game.linesTotal} / ${game.level.objectiveLines}`;
  return `Rows ${game.linesTotal} · Live combo ×${game.combo}`;
}
