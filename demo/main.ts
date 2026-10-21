import './style.css';
import { DemoSession, DEMO_LESSONS } from './session';
import { InputController } from '../app/src/game/input';
import { render, renderScale } from '../app/src/game/render';
import { goalReadout } from './hud';
import { STEP_MS } from '../app/src/game/grades';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = document.querySelector('canvas')!;
const context = canvas.getContext('2d')!;
const session = new DemoSession();
const result = element('result');
const next = element<HTMLButtonElement>('continue');
const pause = element<HTMLButtonElement>('pause');
let ready = false;
let shownStatus = '';
let lastFrame = performance.now();
let accumulator = 0;
let raf = 0;
// Keyboard shortcuts belong to the play field, not a focused link/button.
canvas.addEventListener('pointerdown', () => canvas.focus(), { capture: true });
const input = new InputController(canvas, () => ready && result.hidden && !session.game.paused
  ? session.game : null, undefined, undefined,
  () => document.activeElement === canvas || document.activeElement === document.body);

function describe(): void {
  const lesson = session.lesson;
  element('progress').textContent = lesson ? `FLIGHT SCHOOL · ${session.index + 1} / ${DEMO_LESSONS}` : 'FINAL DEMO BAY · TIER 1 / BAY 1';
  element('title').textContent = lesson?.name ?? 'Your first shift';
  element('brief').textContent = lesson?.brief ?? 'Meet the funding target before the shift ends. This is the only campaign bay in the demo.';
  element('notes').replaceChildren();
  for (const card of lesson?.cards ?? [{ title: 'Make it count', body: 'Launch shipments into the press, clear rows and earn the target funds. Watch the clock and your launch costs.' }]) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${card.title}. `;
    const body = document.createElement('span');
    // Authored lesson copy, not URL or user HTML.
    body.innerHTML = card.body;
    p.append(strong, body);
    element('notes').append(p);
  }
  element('retry').textContent = lesson ? 'Retry lesson' : 'Retry bay';
}
function showResult(title: string, body: string, action: string): void {
  input.cancelAim();
  session.pause(true);
  element('result-title').textContent = title;
  element('result-body').textContent = body;
  next.textContent = action;
  result.hidden = false;
  next.focus();
}
function revealPlayArea(): void {
  element('play-area').scrollIntoView({ block: 'nearest' });
}
function play(): void {
  ready = true;
  result.hidden = true;
  session.pause(false);
  input.wake();
  pause.textContent = 'Pause';
  shownStatus = '';
  accumulator = 0;
  lastFrame = performance.now();
  describe();
  canvas.focus({ preventScroll: true });
  revealPlayArea();
}
next.addEventListener('click', () => {
  if (!ready) { play(); return; }
  if (session.complete) session.restart();
  else if (session.game.status === 'won') {
    session.advance();
    if (session.complete) {
      showResult('Demo complete', 'You finished Flight School and the first Tier-1 bay. Explore the full game in the apps. Check the store availability page for current listings.', 'Play demo again');
      return;
    }
  } else if (session.game.status === 'lost') session.retry();
  play();
});
function togglePause(): void {
  if (!ready || !result.hidden || session.game.status !== 'playing') return;
  input.cancelAim();
  session.pause(!session.game.paused);
  if (!session.game.paused) input.wake();
  pause.textContent = session.game.paused ? 'Resume' : 'Pause';
  accumulator = 0;
  lastFrame = performance.now();
  if (!session.game.paused) revealPlayArea();
}
pause.addEventListener('click', togglePause);
element('retry').addEventListener('click', () => {
  if (session.complete) return;
  input.cancelAim(); session.retry(); play();
});
element('restart').addEventListener('click', () => { input.cancelAim(); session.restart(); play(); });
element('fire').addEventListener('click', () => {
  if (ready && result.hidden) session.game.shoot(performance.now());
});
for (const [id, right] of [['rotate-left', false], ['rotate-right', true]] as const) {
  const button = element(id);
  const rotate = (): void => {
    const game = session.game;
    if (!ready || !result.hidden || game.paused || game.status !== 'playing') return;
    if (right) game.cannon.rotateRight(); else game.cannon.rotateLeft();
    game.updateTrajectory();
  };
  // Secondary touches have pointer events but no compatibility click.
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    rotate();
  });
  button.addEventListener('click', event => {
    if (event.detail === 0) rotate();
  });
}
window.addEventListener('keydown', event => {
  if ((event.key.toLowerCase() === 'p' || event.key === 'Escape') && !event.repeat) togglePause();
  // Keep focus inside the end/start dialog while its background is unavailable.
  if (!result.hidden && event.key === 'Tab') {
    const targets = [...result.querySelectorAll<HTMLElement>('button,a')];
    const index = targets.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    targets[(index + (event.shiftKey ? targets.length - 1 : 1)) % targets.length].focus();
  }
});
function suspend(): void {
  input.cancelAim();
  if (ready && result.hidden) { session.pause(true); pause.textContent = 'Resume'; }
  accumulator = 0;
  lastFrame = performance.now();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('blur', suspend);
window.addEventListener('pagehide', suspend);
function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const game = session.game;
  const dt = Math.min(100, Math.max(0, now - lastFrame));
  lastFrame = now;
  if (ready && result.hidden && !game.paused) {
    accumulator += dt;
    while (accumulator >= STEP_MS) {
      session.step(now);
      accumulator -= STEP_MS;
    }
    game.updateTrajectory();
  } else accumulator = 0;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = renderScale(devicePixelRatio || 1, w, h);
  const width = Math.round(w * dpr), height = Math.round(h * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  render(context, w, h, dpr, {
    cubes: game.cubes, constraints: game.constraints, compactor: game.compactor,
    cannon: game.cannon, trajectory: game.trajectory, now, aiming: game.aiming,
    effects: game.effects, level: game.level, nextIsBomb: game.nextIsBomb,
    bombs: game.bombs, reload: game.cannon.reloadRatio(now), settling: game.settling,
    strandWarning: game.strandWarning, bayOver: game.status !== 'playing', alpha: game.paused ? 1 : accumulator / STEP_MS,
  });
  const funds = game.level.launchCost > 0 ? ` · Funds $${Math.floor(game.score)} / $${game.target}` : '';
  const time = Number.isFinite(game.timeLeftMs) ? ` · ${Math.ceil(game.timeLeftMs / 1000)}s` : '';
  element('stats').textContent = `Shots ${game.shotsFired} · Rotation ${((Math.round(game.cannon.pieceRotation * 180 / Math.PI) % 360) + 360) % 360}° · ${goalReadout(game, session.lesson)}${funds}${time}${game.paused && ready ? ' · Paused' : ''}`;
  if (ready && result.hidden && game.status !== 'playing' && shownStatus !== game.status) {
    shownStatus = game.status;
    showResult(game.status === 'won' ? 'Bay cleared' : 'Try another launch plan',
      game.status === 'won' ? (session.lesson ? 'Lesson complete. Ready for the next challenge?' : 'You cleared the final bay in this demo.') : 'No progress is lost beyond this bay. Retry with the same layout and piece sequence.',
      game.status === 'won' ? (session.lesson ? 'Continue' : 'Finish demo') : 'Retry');
  }
}
describe();
showResult('Welcome to Flight School', 'Learn the real Tetrilaunch controls in nine tutorial lessons, then play one Tier-1 bay. This limited demo has no shop, account or saved progress.', 'Start demo');
raf = requestAnimationFrame(frame);
// Teardown for a genuinely discarded document; bfcache navigation only pauses.
window.addEventListener('pagehide', event => {
  if (!event.persisted) { cancelAnimationFrame(raf); input.destroy(); session.destroy(); }
});
