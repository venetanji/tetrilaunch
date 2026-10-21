import assert from 'node:assert/strict';
import { DemoSession } from '../demo/session';
import { aimBot } from '../app/sim/bots';
const session = new DemoSession();
const bot = aimBot(1);
let now = 0;
for (let step = 0; step < 60 * 120 && session.game.status === 'playing'; step++) {
  now += 1000 / 60;
  bot.act(session.game, now);
  session.step(now);
}
assert.equal(session.game.status, 'won', 'First authored lesson must complete through real launches and physics');
assert.ok(session.game.shotsFired > 0);
assert.ok(session.game.linesTotal > 0);
assert.equal(session.advance(), true);
assert.equal(session.index, 1);
console.log(`Demo real first-lesson completion: ${Math.round(now / 1000)}s simulated.`);
session.destroy();
