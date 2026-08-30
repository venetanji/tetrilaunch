/**
 * Eyeball rig for CRYO — the frozen cube's face (render.ts's drawFrost) and the
 * Thaw Lance's cue (render.ts's drawThawFx). Boots a Vite page, flies a real
 * cryo-heavy bay until it has a pile, then paints that settled field over and
 * over at hand-picked points on one lance charge's clock.
 *
 *   npx tsx sim/uifit/thaw-shots.ts [outDir]
 *   npm run sim:thaw
 *
 * Not part of `npm test`: it proves nothing on its own, it makes pictures. The
 * assertable half — the cue's reach, that it settles, that reduced motion keeps
 * a cue and drops only the travel, the frost's stroke arithmetic — is pinned
 * headlessly in sim/systems.ts. What cannot be pinned there is whether a frozen
 * cube is VISIBLE and whether a thaw is NOTICEABLE, which is the whole of what
 * the owner reported, and this is what those two questions get asked with.
 *
 * THE CHARGE IS FIRED, not hand-built. boom-shots.ts spells its blasts out
 * because waiting for a bot to chain three volatile pops is a search problem
 * with a random answer; a lance has no such problem — it aims itself
 * (lineClear.ts's nextColdCryo), so calling Game.useThawLance on a seeded bay
 * puts the same cue on the same cube every run, spelled by the system under
 * test rather than by a copy of it here that could drift.
 *
 * TWO METRICS, because "not very visible" is a claim about a screen and not
 * about a canvas: 1280x760 at dpr 1 is the desk, and 844x390 at dpr 3 is a
 * phone held sideways — the size the frost is actually read at, and the scale
 * the sprite bake clamps at (render.ts's spritePxScale ceiling of 3).
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "thaw");

/** Where on the lance's clock the filmstrip stops, in ms from the charge.
 *  Front-loaded like boom-shots': the bloom and the star are the first third,
 *  and the back half is the frost plume settling. -1 is the frame BEFORE the
 *  charge — the bay of frozen cargo the cue has to be noticed against. */
const FRAMES_MS = [-1, 40, 120, 260, 460, 700];

interface Metric {
  name: string;
  css: [number, number];
  dpr: number;
}

/** The desk and the phone. The phone is 844x390 at dpr 3 — the same numbers
 *  sim/renderperf takes for its phone pass, and the DPR the cube sprites bake
 *  at their clamped ceiling under. */
const METRICS: Metric[] = [
  { name: "desk", css: [1280, 760], dpr: 1 },
  { name: "phone", css: [844, 390], dpr: 3 },
];

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";
  const browser = await chromium.launch();

  const src = `/@fs${resolve(HERE, "..", "..", "src", "game")}`;
  const sim = `/@fs${resolve(HERE, "..")}`;

  // Reduced motion is a whole second CONTEXT, not a flag flipped mid-page:
  // render.ts makes its MediaQueryList once and keeps it, so the honest way to
  // photograph the preference is a browser that was told about it before the
  // module loaded. Same reasoning, same shape, as boom-shots.ts.
  for (const reduced of [false, true]) {
    for (const metric of METRICS) {
      // The preference has one thing to show and the desk shows it best.
      if (reduced && metric.name !== "desk") continue;
      const ctxt = await browser.newContext({
        viewport: { width: metric.css[0], height: metric.css[1] },
        deviceScaleFactor: metric.dpr,
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const page = await ctxt.newPage();
      await page.goto(url);

      for (const at of FRAMES_MS) {
        const frozen = await page.evaluate(async ({ src, sim, at, css, dpr }) => {
          const [{ makeBaseLevel }, { applyRatchets }, { Game }, { render }, { shipmentColor }, { BOTS }] =
            await Promise.all([
              import(/* @vite-ignore */ `${src}/level.ts`),
              import(/* @vite-ignore */ `${src}/hazards.ts`),
              import(/* @vite-ignore */ `${src}/game.ts`),
              import(/* @vite-ignore */ `${src}/render.ts`),
              import(/* @vite-ignore */ `${src}/theme.ts`),
              import(/* @vite-ignore */ `${sim}/bots.ts`),
            ]);
          // A cryo-heavy bay, FLOWN on a fixed seed, so the frost is
          // photographed on cargo a real bay produced and at the density a
          // ratcheted cryo run actually reaches.
          const level = applyRatchets(makeBaseLevel(9, 7), { cryo: 6 });
          const g = new Game(level, {}, 7);
          const bot = BOTS.demo(7);
          let now = 0;
          for (let i = 0; i < 1100 && g.status === "playing"; i++) {
            now += 1000 / 60;
            bot.act(g, now);
            g.update(now);
          }
          g.aiming = true;
          g.updateTrajectory();

          // The lance needs stock and a target. The stock is a field the run
          // would have granted; the target is whatever the bay landed — and if
          // the seed happened to strike everything, a deterministic handful of
          // settled cubes are re-frozen so the strip always has its subject.
          g.thawCharges = 4;
          let cold = g.cubes.filter(
            (c: { material: string; struck: boolean }) => c.material === "cryo" && !c.struck,
          ).length;
          if (cold < 3) {
            for (let i = 0; i < g.cubes.length && cold < 6; i += 4) {
              const cube = g.cubes[i];
              if (cube.material !== "standard") continue;
              cube.material = "cryo";
              cube.struck = false;
              cube.color = shipmentColor(cube.type, "cryo");
              cold += 1;
            }
          }

          const t0 = now;
          if (at >= 0) g.useThawLance(t0);

          document.body.innerHTML = '<canvas id="shot"></canvas>';
          const c = document.getElementById("shot") as HTMLCanvasElement;
          c.width = css[0] * dpr; c.height = css[1] * dpr;
          c.style.width = `${css[0]}px`; c.style.height = `${css[1]}px`;
          render(c.getContext("2d")!, css[0], css[1], dpr, {
            cubes: g.cubes, constraints: g.constraints, compactor: g.compactor,
            cannon: g.cannon, trajectory: g.trajectory, now: t0 + Math.max(0, at),
            aiming: true, effects: g.effects, level: g.level,
            nextIsBomb: g.nextIsBomb, bombs: g.bombs, windNow: g.windNow,
            windAverage: null, reload: 1, settling: false, strandWarning: false,
            alpha: 1,
          });
          return cold;
        }, { src, sim, at, css: metric.css, dpr: metric.dpr });

        const tag = [metric.name, reduced ? "reduced" : null].filter(Boolean).join("-");
        const when = at < 0 ? "pre" : `${String(at).padStart(3, "0")}ms`;
        await page.screenshot({ path: resolve(OUT, `${tag}-${when}.png`) });
        if (at === FRAMES_MS[0]) console.log(`${tag}: ${frozen} frozen cubes in the bay`);
      }
      await ctxt.close();
    }
  }

  await browser.close();
  await server.close();
  console.log(`wrote ${OUT}`);
}

main();
