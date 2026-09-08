/**
 * Eyeball rig for the LANDING TARGET (render.ts's drawLandingTarget,
 * school.ts's landingTargetFor). Boots a Vite page, opens each of the licence's
 * four lesson bays for real, and shoots the FIELD — which is canvas, and
 * therefore the one surface `uifit` cannot see, since uifit measures DOM boxes.
 *
 *   npx tsx sim/uifit/lesson-shots.ts [outDir]
 *
 * Not part of `npm test`: it proves nothing on its own, it just makes pictures.
 * sim/systems.ts owns the assertions — which cells, when they clear, when they
 * come back. What only a picture can settle is the pair of questions the pins
 * cannot ask: is the box legible at a phone's field scale, and is it quiet
 * enough that the eye still goes to the cargo first.
 *
 * PHONE VIEWPORTS, NOT A DESKTOP ONE, and the whole point of the rig is that
 * they are the real ones: two rows out of sim/uifit/devices.ts, shot through
 * render.ts's own renderScale policy (a compact viewport is rasterised at a
 * LOWER backing ratio than its dpr — a hint that only reads at dpr 3 is a hint
 * that does not read on the device it was drawn for) and composited by the
 * browser at the device's real pixel ratio.
 *
 * THREE STATES PER BAY, because the hint's whole design is a life cycle:
 *
 *   open     the bay as it opens. This is the frame the owner asked for.
 *   flight   a shipment mid-air over the gap — the hint dimmed under it, which
 *            is the frame that says whether "subordinate to the cargo" is true.
 *   filled   the authored shipment seated in the gap. The hint must be GONE:
 *            a target still drawn over a filled gap is an instruction to do
 *            something the player has already done.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVICES } from "./devices";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "lessons");

/** The licence's four bays — school.ts's LICENCE_LESSON_COUNT — which are the
 *  ones a first-time player meets and the four the hint was asked for. */
const LESSON_INDICES = [0, 1, 2, 3];

/** The narrowest inset-free row and the narrowest notched one, which between
 *  them bracket every handset the app ships to. */
const ROWS = ["iOS · iPhone SE 3", "iOS · iPhone 13 mini"];

type Phase = "open" | "flight" | "filled";
const PHASES: Phase[] = ["open", "flight", "filled"];

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";
  const browser = await chromium.launch();

  const src = `/@fs${resolve(HERE, "..", "..", "src", "game")}`;

  for (const rowName of ROWS) {
    const dev = DEVICES.find((d) => d.name === rowName);
    if (!dev) throw new Error(`no device row named ${rowName}`);
    const page = await browser.newPage({
      viewport: { width: dev.w, height: dev.h },
      deviceScaleFactor: dev.dpr,
    });
    await page.goto(url);

    for (const index of LESSON_INDICES) {
      for (const phase of PHASES) {
        const id = await page.evaluate(async (a) => {
          const [lvl, school, { Game }, rnd, eng, pieces] = await Promise.all([
            import(/* @vite-ignore */ `${a.src}/layout.ts`),
            import(/* @vite-ignore */ `${a.src}/school.ts`),
            import(/* @vite-ignore */ `${a.src}/game.ts`),
            import(/* @vite-ignore */ `${a.src}/render.ts`),
            import(/* @vite-ignore */ `${a.src}/engine.ts`),
            import(/* @vite-ignore */ `${a.src}/pieces.ts`),
          ]);
          lvl.setSafeAreaInsets(a.insets);

          const lesson = school.LESSONS[a.index];
          const cfg = school.levelForLesson(lesson);
          const g = new Game(cfg, {}, school.lessonSeed(a.index));
          let now = 0;
          // Long enough for the gold to be standing and completely still, so
          // "open" is the frame the bay actually opens on rather than a
          // scaffold mid-drop. Stepped inline rather than through a named
          // helper: a `const` arrow inside page.evaluate is transpiled with
          // esbuild's keepNames shim, whose `__name` does not exist in the page.
          for (let i = 0; i < 120; i++) { now += 1000 / 60; g.update(now); }

          // THE AUTHORED ANSWER, LAUNCHED RATHER THAN CONJURED. The target's
          // own cells give the centre to put a real shipment on, through the
          // same createTetrisPiece every launch goes through — so the picture
          // shows the cargo the bay deals, welded and coloured as it will be,
          // rather than a hand-built stand-in that could look right while the
          // real thing does not.
          const target: Array<{ col: number; row: number }> = cfg.landingTarget ?? [];
          if (target.length > 0 && a.phase !== "open") {
            const cols = new Set(target.map((t) => t.col)).size;
            const rows = new Set(target.map((t) => t.row)).size;
            // Upright when the gap is taller than it is wide — the well, and
            // the one lesson whose answer is a rotation.
            const angle = rows > cols ? Math.PI / 2 : 0;
            const lift = a.phase === "flight" ? eng.CELL * 5 : 0;
            const fall = a.phase === "flight" ? 9 : 0;
            // Lob or Skim's answer is one square in EACH end gap, so a piece
            // goes into every contiguous column run rather than one per bay.
            const runs: Array<Array<{ col: number; row: number }>> = [];
            for (const t of [...target].sort((p, q) => p.col - q.col)) {
              const last = runs[runs.length - 1];
              if (last && t.col <= last[last.length - 1].col + 1) last.push(t);
              else runs.push([t]);
            }
            for (const run of runs) {
              const rx = run.reduce(
                (s, t) => s + eng.WALL_INNER - eng.CELL / 2 - t.col * eng.CELL, 0) / run.length;
              const ry = run.reduce(
                (s, t) => s + eng.WORLD.height - eng.CELL / 2 - t.row * eng.CELL, 0) / run.length;
              const piece = pieces.createTetrisPiece(
                g.phys.world, rx, ry - lift, angle, { x: 0, y: fall },
                lesson.sequence?.[0] ?? "I", cfg.jointStiffness, cfg.pieceSize,
                cfg.jointBreakStretch,
              );
              g.cubes.push(...piece.cubes);
              g.constraints.push(...piece.constraints);
            }
            if (a.phase === "filled") {
              for (let i = 0; i < 30; i++) { now += 1000 / 60; g.update(now); }
            }
          }

          document.body.style.margin = "0";
          document.body.innerHTML = '<canvas id="shot"></canvas>';
          const cv = document.getElementById("shot") as HTMLCanvasElement;
          // THE APP'S OWN SIZING POLICY, not the raw dpr: a compact viewport is
          // rasterised at a lower backing ratio (render.ts's renderScale), and
          // a cue that only survives at dpr 3 has not been checked on a phone.
          const ratio = rnd.renderScale(a.dpr, a.w, a.h);
          cv.style.width = `${a.w}px`;
          cv.style.height = `${a.h}px`;
          cv.style.display = "block";
          cv.width = Math.round(a.w * ratio);
          cv.height = Math.round(a.h * ratio);
          rnd.render(cv.getContext("2d", { alpha: false })!, a.w, a.h, ratio, {
            cubes: g.cubes, constraints: g.constraints, compactor: g.compactor,
            cannon: g.cannon, trajectory: g.trajectory, now, aiming: false,
            effects: g.effects, level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
            windNow: g.windNow, windAverage: null, reload: 1, settling: g.settling,
            bayOver: g.status !== "playing",
            strandWarning: false, alpha: 1,
          });
          return lesson.id;
        }, {
          src, index, phase, w: dev.w, h: dev.h, dpr: dev.dpr, insets: dev.insets,
        });

        const slug = rowName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        await page.screenshot({
          path: resolve(OUT, `${index + 1}-${id}-${phase}-${slug}.png`),
        });
      }
    }
    await page.close();
  }

  await browser.close();
  await server.close();
  console.log(`wrote ${OUT}`);
}

main();
