import type { Page } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installCaptureCssClock } from './css-clock';

type Driver = { page: Page; shot(attempts?: number, waitMs?: number): Promise<Buffer>; tick(frames: number): Promise<unknown> };
/** Real native screenshots, deliberately slow host work, no mocked browser clock. */
export async function verifyCaptureCssClock(driver: Driver, out: string): Promise<void> {
  const read = () => driver.page.evaluate(() => document.getAnimations().filter(a => ['belt-arrows', 'belt-tread', 'belt-roll'].includes((a as CSSAnimation).animationName)).map(a => {
    const el = (a.effect as KeyframeEffect).target as Element;
    const style = getComputedStyle(el);
    return { name: (a as CSSAnimation).animationName, time: Number(a.currentTime), transform: style.transform, background: style.backgroundPositionX };
  }));
  await driver.shot();
  const oldBefore = await read();
  await new Promise(resolve => setTimeout(resolve, 350));
  await driver.shot();
  const oldAfter = await read();
  const oldDrift = oldAfter.some((a, i) => Math.abs(a.time - oldBefore[i].time) > 50 || a.transform !== oldBefore[i].transform || a.background !== oldBefore[i].background);
  await driver.page.evaluate(installCaptureCssClock);
  await driver.shot();
  const fixedBefore = await read();
  const gameBefore = await driver.page.evaluate(() => { const s = window.__promo.snapshot(0).status; return { clock: window.__clock.now(), steps: s.steps, elapsedMs: s.elapsedMs, timeLeftMs: s.timeLeftMs }; });
  await new Promise(resolve => setTimeout(resolve, 350));
  await driver.shot();
  const fixedAfter = await read();
  const gameAfter = await driver.page.evaluate(() => { const s = window.__promo.snapshot(0).status; return { clock: window.__clock.now(), steps: s.steps, elapsedMs: s.elapsedMs, timeLeftMs: s.timeLeftMs }; });
  const stable = fixedAfter.length > 0 && fixedAfter.every((a, i) => Math.abs(a.time - fixedBefore[i].time) < 0.01 && a.transform === fixedBefore[i].transform && a.background === fixedBefore[i].background);
  const base = await read();
  await driver.tick(108);
  await driver.shot();
  const at108 = await read();
  await driver.tick(234);
  await driver.shot();
  const at342 = await read();
  const ticks = at108.every((a, i) => Math.abs(a.time - base[i].time - 900) < 0.01) && at342.every((a, i) => Math.abs(a.time - base[i].time - 2850) < 0.01);
  // Authored negative delays are not folded into currentTime by the controller.
  await driver.page.evaluate(() => {
    const style = document.createElement('style'); style.id = 'clock-fixture-style';
    style.textContent = '@keyframes clock-fixture { from { transform:translateX(0px) } to { transform:translateX(100px) } } .clock-fixture { position:fixed;left:-9999px;animation:clock-fixture 1000ms linear infinite;animation-delay:-250ms } .clock-transition { position:fixed;left:-9999px;opacity:0;transition:opacity 1000ms linear 100ms }';
    document.head.append(style);
    const a = document.createElement('div'); a.className = 'clock-fixture'; a.id = 'clock-fixture'; document.body.append(a);
    const t = document.createElement('div'); t.className = 'clock-transition'; t.id = 'clock-transition'; document.body.append(t);
    getComputedStyle(t).opacity; t.style.opacity = '1'; getComputedStyle(t).opacity;
  });
  // The native shot boundary must discover animations created after the tick.
  await driver.shot();
  const newlyCreatedBefore = await driver.page.evaluate(() => window.__captureCssClock!.snapshot().filter(a => a.target.includes('clock-')));
  await new Promise(resolve => setTimeout(resolve, 350));
  await driver.shot();
  const newlyCreatedAfter = await driver.page.evaluate(() => window.__captureCssClock!.snapshot().filter(a => a.target.includes('clock-')));
  await driver.tick(60);
  await driver.shot();
  const fixture = await driver.page.evaluate(() => {
    const a = document.querySelector('#clock-fixture')!;
    const t = document.querySelector('#clock-transition')!;
    return { x: new DOMMatrix(getComputedStyle(a).transform).m41, opacity: Number(getComputedStyle(t).opacity), animations: window.__captureCssClock!.snapshot().filter(a => a.target.includes('clock-')) };
  });
  await driver.page.evaluate(() => {
    const old = document.querySelector('#clock-fixture')!; old.replaceWith(old.cloneNode(true));
  });
  await driver.shot();
  await driver.tick(30);
  const replacement = await driver.page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#clock-fixture')!).transform).m41);
  const validation = { baselineDriftObserved: oldDrift, heldClockStable: stable, gameClockHeldThroughPaintAndDelay: JSON.stringify(gameBefore) === JSON.stringify(gameAfter), authoredCycles: ticks,
    negativeDelay: Math.abs(fixture.x - 75) < 0.1, newTransition: Math.abs(fixture.opacity - 0.4) < 0.01,
    replacementStartsAtCreation: Math.abs(replacement - 50) < 0.1,
    betweenTickAndShotStable: JSON.stringify(newlyCreatedBefore) === JSON.stringify(newlyCreatedAfter) };
  await writeFile(resolve(out, 'css-clock-regression.json'), JSON.stringify({ compositor: 'real-time native rAF; explicit JS/CSS video clocks; no CDP virtual time', oldBefore, oldAfter, fixedBefore, fixedAfter, gameBefore, gameAfter, base, at108, at342, newlyCreatedBefore, newlyCreatedAfter, fixture, replacement, validation }, null, 2));
  await driver.page.evaluate(() => { document.querySelector('#clock-fixture')?.remove(); document.querySelector('#clock-transition')?.remove(); document.querySelector('#clock-fixture-style')?.remove(); });
  console.log('CSS clock RED/GREEN evidence', JSON.stringify(validation));
  if (!Object.values(validation).every(Boolean)) throw new Error('CSS capture clock regression failed; inspect evidence before full recapture');
}
