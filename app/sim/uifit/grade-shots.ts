/**
 * Eyeball rig for the TIMING CALLOUT (src/game/grades.ts, theme.ts's
 * GRADE_CALLOUT, render.ts's drawPayoutFx). Boots a Vite page, plays a real
 * bay until it has a pile, then draws the payout toast at each of the four
 * bands over it and shoots the FIELD — which is canvas, and therefore the one
 * surface `uifit` cannot see (it measures DOM boxes).
 *
 *   npx tsx sim/uifit/grade-shots.ts [outDir]
 *
 * Not part of `npm test`: it proves nothing on its own, it just makes pictures.
 * What it is FOR is the claim `grades.ts` rests on — *a grade the player cannot
 * see is a rule they cannot learn* — plus the two things only a picture settles:
 * that the word is legible over a busy pile at the size it is drawn, and that
 * it reads as a rider on the money rather than as a second floater racing it.
 *
 * The pile is a PLAYED pile, on the same `demo` pilot and seed the tables in
 * design/balance/timed-clears.md are measured with, for cushion-shots.ts's
 * reason: an empty bay shows the toast and not what it sits on.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "grades");

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(url);

  const src = `/@fs${resolve(HERE, "..", "..", "src", "game")}`;
  const sim = `/@fs${resolve(HERE, "..")}`;
  for (const grade of ["excellent", "good", "swept", "lucky"]) {
    await page.evaluate(async ({ g: band, src, sim }) => {
      const [{ makeBaseLevel }, up, { Game }, { render }, { BOTS }, gr] =
        await Promise.all([
          import(/* @vite-ignore */ `${src}/level.ts`),
          import(/* @vite-ignore */ `${src}/upgrades.ts`),
          import(/* @vite-ignore */ `${src}/game.ts`),
          import(/* @vite-ignore */ `${src}/render.ts`),
          import(/* @vite-ignore */ `${sim}/bots.ts`),
          import(/* @vite-ignore */ `${src}/grades.ts`),
        ]);
      const cfg = makeBaseLevel(4, 10);
      up.applyUpgrades(cfg, { ...up.newTiers(), hydraulics: 2, bay: 1 });
      const g = new Game(cfg, {}, 7);
      const bot = BOTS.demo(7);
      let now = 0;
      for (let i = 0; i < 900 && g.status === "playing"; i++) {
        now += 1000 / 60;
        bot.act(g, now);
        g.update(now);
      }
      // The toast the bay would have spawned, priced at THIS band off the bay's
      // own rate — so the picture shows the real money beside the real word
      // rather than a placeholder pair.
      g.effects.length = 0;
      g.effects.push({
        kind: "payout",
        x: 780,
        y: 430,
        amount: gr.gradedLinePay(g.level.scorePerLine, band),
        grade: band,
        // Mid-life: past the 80ms fade-in, well short of the fade-out, which is
        // the frame a player actually reads.
        t0: now - 400,
      });
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
    }, { g: grade, src, sim });
    await page.screenshot({ path: resolve(OUT, `callout-${grade}.png`) });
  }

  await browser.close();
  await server.close();
  console.log(`wrote ${OUT}`);
}

main();
