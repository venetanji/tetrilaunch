import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const cachedChromium = resolve(homedir(), '.cache/ms-playwright/chromium-1194/chrome-linux/chrome');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  ?? (existsSync(cachedChromium) ? cachedChromium : undefined);

// Exercise the shipped Tier S discovery gate while serving source through Vite.
process.env.NODE_ENV = 'production';
const server = await createServer({
  root,
  mode: 'native',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  plugins: [{
    name: 'achievement-browser-test-instance',
    enforce: 'pre',
    transform(source, id) {
      if (id !== resolve(root, 'src/main.ts')) return;
      const boot = 'new App(document.getElementById("app")!);';
      assert(source.includes(boot), 'the test must expose the real App boot');
      return source.replace(boot, `window.__achievementApp = ${boot}`);
    },
  }],
});

let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath });

  async function withApp(name, exercise, initialMeta = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin)) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"scores":[]}',
    }));
    await page.addInitScript((meta) => {
      localStorage.setItem('tetrilaunch.settings', JSON.stringify({
        sound: false, music: false, haptics: false,
        seenTutorial: true, seenDragHint: true, devMode: false,
      }));
      localStorage.setItem('tetrilaunch.meta', JSON.stringify({ licence: 100, ...meta }));
      window.__achievementUnlocks = [];
      window.steam = {
        unlockAchievement: async id => {
          window.__achievementUnlocks.push(id);
          return true;
        },
      };
      // Keep actual Game instances stationary while invoking their registered events.
      window.requestAnimationFrame = () => 0;
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    }, initialMeta);
    try {
      await page.goto(origin);
      await page.waitForFunction(() => window.__achievementApp);
      await page.evaluate(async () => {
        window.__achievementModules = {
          run: await import('/src/game/run.ts'),
          meta: await import('/src/game/meta.ts'),
          grades: await import('/src/game/grades.ts'),
          contracts: await import('/src/game/contracts.ts'),
        };
        window.__achievementStartRun = flags => {
          const app = window.__achievementApp;
          app.run = { ...window.__achievementModules.run.newRun(12345), ...flags };
          app.contract = null;
          app.drill = null;
          app.lesson = null;
          app.startLevel();
        };
      });
      await exercise(page);
      assert.deepEqual(errors, [], `${name}: browser runtime errors`);
      console.log(`PASS: ${name}`);
    } finally {
      await context.close();
    }
  }

  const waitForUnlocks = (page, ids) => page.waitForFunction(
    expected => expected.every(id => window.__achievementUnlocks.includes(id)), ids,
  );
  const clearAchievements = ['TRIPLE_CLEAR', 'QUAD_CLEAR', 'ALL_CLEAR'];

  await withApp('startup backfills proven tiers and a real tier claim synchronizes immediately', async page => {
    await waitForUnlocks(page, ['TIER_1_UNLOCKED', 'TIER_2_UNLOCKED', 'TIER_3_UNLOCKED', 'TIER_4_UNLOCKED']);
    await page.evaluate(() => {
      const app = window.__achievementApp;
      app.meta = { ...app.meta, tierRunDone: true, tierContracts: 3 };
      app.setState('tiers');
      const button = app.overlay.querySelector('[data-action="claim-tier"]');
      if (!button) throw new Error('the tier hub did not render its Unlock button');
      button.click();
    });
    await waitForUnlocks(page, ['TIER_5_UNLOCKED']);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tetrilaunch.meta')));
    assert.equal(saved.mark, 4);
    assert(saved.achievements.includes('TIER_5_UNLOCKED'));
  }, { mark: 3 });

  await withApp('registered Deep Run clear callbacks award triple, quad and empty-board achievements', async page => {
    const first = await page.evaluate(() => {
      window.__achievementStartRun({});
      const app = window.__achievementApp;
      if (app.game.cubes.length !== 0) throw new Error('the starting bay must have an empty pile');
      app.game.events.onLineClear(3, window.__achievementModules.grades.newGradeTally());
      return app.meta.achievements;
    });
    assert(first.includes('TRIPLE_CLEAR'));
    assert(first.includes('ALL_CLEAR'));
    assert(!first.includes('QUAD_CLEAR'));
    await waitForUnlocks(page, ['TRIPLE_CLEAR', 'ALL_CLEAR']);
    await page.evaluate(() => {
      const app = window.__achievementApp;
      app.game.events.onLineClear(4, window.__achievementModules.grades.newGradeTally());
    });
    await waitForUnlocks(page, clearAchievements);
  });

  await withApp('congestion survives relief, a bay restart and the next bay and prevents Clean Run', async page => {
    const result = await page.evaluate(() => {
      window.__achievementStartRun({});
      const app = window.__achievementApp;
      app.game.events.onCongestion(1, 2);
      app.game.events.onCongestion(0, 2);
      const afterRelief = app.run.congestionSeen;
      app.resetBay();
      const afterRestart = app.run.congestionSeen;
      app.run = window.__achievementModules.run.advanceRun(app.run, 100, 100, 0, 0);
      app.startLevel();
      const afterNextBay = app.run.congestionSeen;
      app.run = { ...app.run, levelIndex: window.__achievementModules.run.RUN_LEVELS - 1 };
      app.startLevel();
      app.finishRun(true);
      return { afterRelief, afterRestart, afterNextBay,
        achievements: app.meta.achievements, unlocks: window.__achievementUnlocks };
    });
    assert.equal(result.afterRelief, true);
    assert.equal(result.afterRestart, true);
    assert.equal(result.afterNextBay, true);
    assert(!result.achievements.includes('CLEAN_RUN'));
    assert(!result.unlocks.includes('CLEAN_RUN'));
  });

  await withApp('a completed run with no congestion awards Clean Run through finishRun', async page => {
    await page.evaluate(() => {
      window.__achievementStartRun({ levelIndex: window.__achievementModules.run.RUN_LEVELS - 1 });
      window.__achievementApp.finishRun(true);
    });
    await waitForUnlocks(page, ['CLEAN_RUN']);
    assert(await page.evaluate(() => window.__achievementApp.meta.achievements.includes('CLEAN_RUN')));
  });

  for (const mode of ['sandbox run', 'sandbox contract', 'training drill', 'Flight School lesson', 'school contract']) {
    await withApp(`${mode} clear callbacks exclude gameplay achievements`, async page => {
      const result = await page.evaluate(async (selected) => {
        const app = window.__achievementApp;
        const { contracts, grades } = window.__achievementModules;
        if (selected === 'sandbox run') window.__achievementStartRun({ sandbox: true });
        else if (selected === 'sandbox contract') app.startContract(contracts.dailyContracts(1)[0], true);
        else if (selected === 'training drill') {
          const guide = await import('/src/game/guide.ts');
          app.startDrill(guide.topicById('aim'));
        }
        else if (selected === 'Flight School lesson') app.startLesson(0);
        else app.startContract(contracts.schoolContract());
        app.game.events.onLineClear(4, grades.newGradeTally());
        return { achievements: app.meta.achievements, unlocks: window.__achievementUnlocks };
      }, mode);
      for (const id of clearAchievements) {
        assert(!result.achievements.includes(id), `${mode} persisted ${id}`);
        assert(!result.unlocks.includes(id), `${mode} sent ${id} to Steam`);
      }
    });
  }

  await withApp('restarting a paused Tier S Contract preserves practice and excludes achievements and progression', async page => {
    const result = await page.evaluate(() => {
      const app = window.__achievementApp;
      const { contracts, grades } = window.__achievementModules;
      const progress = meta => ({ salvage: meta.salvage, mark: meta.mark,
        tierContracts: meta.tierContracts, claimedContracts: meta.claimedContracts });
      const before = progress(app.meta);
      app.startContract(contracts.dailyContracts(1)[0], true);
      app.pause();
      app.restartBay();
      const practice = app.sandboxContract;
      app.game.events.onLineClear(4, grades.newGradeTally());
      app.game.events.onStatus('won');
      return { practice, before, after: progress(app.meta), achievements: app.meta.achievements,
        saved: JSON.parse(localStorage.getItem('tetrilaunch.meta')).achievements,
        unlocks: window.__achievementUnlocks };
    });
    assert.equal(result.practice, true, 'a restarted Tier S Contract must stay practice');
    assert.deepEqual(result.after, result.before, 'a practice win must not claim or pay a daily Contract');
    for (const id of [...clearAchievements, 'FIRST_CONTRACT']) {
      assert(!result.achievements.includes(id), `restarted Tier S Contract earned ${id}`);
      assert(!result.saved.includes(id), `restarted Tier S Contract persisted ${id}`);
      assert(!result.unlocks.includes(id), `restarted Tier S Contract sent ${id} to Steam`);
    }
  });

  await withApp('a real daily Contract clear callback qualifies for gameplay achievements', async page => {
    await page.evaluate(() => {
      const app = window.__achievementApp;
      const { contracts, grades } = window.__achievementModules;
      app.startContract(contracts.dailyContracts(1)[0]);
      if (!app.contract || app.sandboxContract) throw new Error('the daily Contract did not start');
      app.game.events.onLineClear(4, grades.newGradeTally());
    });
    await waitForUnlocks(page, clearAchievements);
  });

  await withApp('nine real beacon clicks persist Tier S discovery and synchronize its achievement', async page => {
    const result = await page.evaluate(() => {
      const app = window.__achievementApp;
      app.setState('tiers');
      const beacon = app.overlay.querySelector('[data-action="tower-beacon"]');
      if (!beacon) throw new Error('the shipped closed Tier S beacon did not render');
      for (let i = 0; i < 9; i++) beacon.click();
      return { discovered: app.settings.devMode,
        persisted: JSON.parse(localStorage.getItem('tetrilaunch.settings')).devMode };
    });
    assert.equal(result.discovered, true);
    assert.equal(result.persisted, true);
    await waitForUnlocks(page, ['SECRET_TIER_S']);
  });

  console.log('Steam achievement browser integration passed; all Steam unlocks and API responses were local stubs.');
} finally {
  await browser?.close();
  await server.close();
}
