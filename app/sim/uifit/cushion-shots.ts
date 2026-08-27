/**
 * Eyeball rig for the Impact Cushion's liner. Boots a Vite page, builds a real
 * bay at each cushion tier, plays it far enough to have a pile, and shoots the
 * FIELD — which is canvas, and therefore the one surface the `uifit` harness
 * cannot see (it measures DOM boxes).
 *
 *   npx tsx sim/uifit/cushion-shots.ts [outDir]
 *
 * Not part of `npm test`: it proves nothing on its own, it just makes pictures.
 * What it is FOR is the claim `lineClear.ts`'s volatileBlast makes in a comment
 * — that the liner's edge is hard "because the player has to be able to look at
 * the bay and know whether a slot is lined". A rig that renders it is how that
 * sentence stays honest.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "cushion");

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(url);

  // Vite's root is this directory (vite.config.ts), so the app's modules sit
  // outside it and are served under /@fs/<abs path> rather than /src/**.
  const src = `/@fs${resolve(HERE, "..", "..", "src", "game")}`;
  const sim = `/@fs${resolve(HERE, "..")}`;
  for (const tier of [0, 1, 2, 3]) {
    await page.evaluate(async ({ t, src, sim }) => {
      const [{ makeBaseLevel }, { applyRatchets }, up, { Game }, { render }, { BOTS }] =
        await Promise.all([
          import(/* @vite-ignore */ `${src}/level.ts`),
          import(/* @vite-ignore */ `${src}/hazards.ts`),
          import(/* @vite-ignore */ `${src}/upgrades.ts`),
          import(/* @vite-ignore */ `${src}/game.ts`),
          import(/* @vite-ignore */ `${src}/render.ts`),
          import(/* @vite-ignore */ `${sim}/bots.ts`),
        ]);
      const cfg = makeBaseLevel(9, 7);
      up.applyUpgrades(cfg, { ...up.newTiers(), cushion: t });
      const level = applyRatchets(cfg, { volatile: 6 });
      // FLOWN, not just stepped: an empty bay shows the liner and not what it
      // is for. The same `demo` pilot the tables above are measured with, on
      // the same seed, so the pile in the picture is a pile the sweep produced.
      const g = new Game(level, {}, 7);
      const bot = BOTS.demo(7);
      let now = 0;
      for (let i = 0; i < 1100 && g.status === "playing"; i++) {
        now += 1000 / 60;
        bot.act(g, now);
        g.update(now);
      }
      document.body.innerHTML = '<canvas id="shot"></canvas>';
      const c = document.getElementById("shot") as HTMLCanvasElement;
      c.width = 1280; c.height = 760;
      c.style.width = "1280px"; c.style.height = "760px";
      render(c.getContext("2d")!, 1280, 760, 1, {
        cubes: g.cubes, constraints: g.constraints, compactor: g.compactor, cannon: g.cannon,
        trajectory: g.trajectory, now, aiming: false,
        effects: g.effects, level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
        windNow: g.windNow, windAverage: null, reload: 1, settling: false,
        strandWarning: false, alpha: 1,
      });
    }, { t: tier, src, sim });
    await page.screenshot({ path: resolve(OUT, `cushion-t${tier}.png`) });
  }

  await browser.close();
  await server.close();
  console.log(`wrote ${OUT}`);
}

main();
