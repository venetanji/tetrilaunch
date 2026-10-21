import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
assert.ok(existsSync('demo/session.ts'), 'A separate capped demo session must exist');
const { DemoSession, DEMO_LESSONS } = await import('../demo/session');
const { Game } = await import('../app/src/game/game');
const session = new DemoSession();
assert.ok(session.game instanceof Game, 'Reuse the real physics engine');
assert.equal(DEMO_LESSONS, 9);
assert.equal(session.index, 0);
assert.equal(session.advance(), false, 'Cannot skip an unfinished lesson');
assert.equal(session.game.shoot(0), true);
const before = session.game.cubes.at(-1)!.body.position.y;
for (let i = 1; i <= 10; i++) session.step(i * 1000 / 60);
assert.notEqual(session.game.cubes.at(-1)!.body.position.y, before, 'Real physics moves the shot');
session.pause(true);
const time = session.game.elapsedMs;
session.step(200);
assert.equal(session.game.elapsedMs, time);
assert.equal(session.game.shoot(200), false);
session.pause(false);
const originalLevel = session.game.level;
session.retry();
assert.equal(session.index, 0);
assert.deepEqual(session.game.level, originalLevel);
assert.equal(session.game.shotsFired, 0);
for (let index = 0; index <= DEMO_LESSONS; index++) {
  assert.equal(session.index, index);
  if (index === DEMO_LESSONS) {
    assert.equal(session.game.level.id, 1);
    assert.equal(session.game.level.mark, 1);
    assert.equal(session.game.level.timeLimitSec, 180);
  }
  session.game.status = 'lost';
  assert.equal(session.advance(), false, 'Losing cannot advance');
  session.game.status = 'won';
  assert.equal(session.advance(), true);
}
assert.equal(session.complete, true);
assert.equal(session.index, DEMO_LESSONS, 'Never constructs the second Tier-1 bay');
assert.equal(session.advance(), false);
assert.equal(session.game.shoot(10000), false);
session.restart();
assert.equal(session.complete, false);
assert.equal(session.index, 0);
assert.equal(session.game.status, 'playing');
session.destroy();
console.log('Demo session: real physics, pause, losses, School + one bay cap and restart passed.');

test('Demo lessons fly the stock rig on the same authored configs as the full game', async () => {
  const { stockTiers } = await import('../app/src/game/upgrades');
  const { levelForLesson } = await import('../app/src/game/school');
  const demo = new DemoSession();
  try {
    for (let index = 0; index < DEMO_LESSONS; index++) {
      assert.deepEqual(demo.game.level, levelForLesson(demo.lesson!, stockTiers()), `Lesson ${index + 1} must use the stock rig`);
      demo.game.status = 'won';
      demo.advance();
    }
  } finally { demo.destroy(); }
});

test('The capped final bay uses the canonical graduation config with the stock rig', async () => {
  const { stockTiers } = await import('../app/src/game/upgrades');
  const { levelForGraduation } = await import('../app/src/game/run');
  const demo = new DemoSession();
  try {
    for (let index = 0; index < DEMO_LESSONS; index++) {
      demo.game.status = 'won';
      demo.advance();
    }
    assert.deepEqual(demo.game.level, levelForGraduation(stockTiers()));
  } finally { demo.destroy(); }
});

test('Resume draws moving cargo and the compactor at the paused transform even at alpha zero', async () => {
  const { lerpX, lerpY, lerpAngle } = await import('../app/src/game/engine');
  const demo = new DemoSession();
  try {
    assert.equal(demo.game.shoot(0), true);
    demo.step(1000 / 60);
    const bodies = [demo.game.cubes.at(-1)!.body, demo.game.compactor.body];
    const transform = (body: typeof bodies[number], alpha: number) =>
      [lerpX(body, alpha), lerpY(body, alpha), lerpAngle(body, alpha)];
    for (const body of bodies) assert.notDeepEqual(transform(body, 0), transform(body, 1), 'The regression requires a moving body');
    demo.pause(true);
    const paused = bodies.map(body => transform(body, 1));
    demo.pause(false);
    assert.deepEqual(bodies.map(body => transform(body, 0)), paused, 'The first resumed frame must not rewind one physics step');
  } finally { demo.destroy(); }
});
