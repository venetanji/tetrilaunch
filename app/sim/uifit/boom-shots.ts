/**
 * Eyeball rig for the BLAST DEBRIS (render.ts's drawExplosionDebris). Boots a
 * Vite page, plays a real bay until it has a pile, then paints the same settled
 * field over and over at hand-picked points on one blast's clock — a filmstrip
 * of a detonation, on the field it actually happens on.
 *
 *   npx tsx sim/uifit/boom-shots.ts [outDir]
 *   npm run sim:boom
 *
 * Not part of `npm test`: it proves nothing on its own, it makes pictures. The
 * assertable half — the frame cap, the settle, the frame-rate independence, the
 * reduced-motion cut — is pinned headlessly in sim/systems.ts. What cannot be
 * pinned there is whether a blast looks REWARDING, and this is what that
 * question gets asked with.
 *
 * THE EVENTS ARE HAND-BUILT rather than played into existence, and that is the
 * point of the rig. Waiting for a bot to chain three volatile pops is a search
 * problem with a random answer; stating the blast puts the same explosion at
 * the same millisecond in every run, so two runs of this rig differ only by
 * what changed in render.ts. Every one of them is spelled exactly as game.ts
 * spells it (grep `kind: "explosion"` there) — same radii, same colours.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "boom");

/** Where on a 900ms blast the filmstrip stops. Front-loaded: the first third
 *  is the whole bang (flash, sparks, shrapnel leaving), and the back half is
 *  embers falling, which changes slowly enough that two frames describe it. */
const FRAMES_MS = [40, 110, 220, 380, 600, 820];

interface Shot {
  name: string;
  /** Blasts, as (x, y, r, color, offset-from-the-strip's-t0). The offset is
   *  what makes a chain a chain: the same events, staggered. */
  blasts: [number, number, number, string, number][];
}

/** r = CELL * 2.4 for a charge, VOLATILE_BLAST_CELLS * CELL * 1.4 = 89.6 for a
 *  volatile pop, CHUTE_BLAST_R = 34 for cargo the intake ate. */
const VOLATILE = "#d4ff3a";
const AMBER = "#ffb347";

const SHOTS: Shot[] = [
  {
    name: "volatile-single",
    blasts: [[820, 560, 89.6, VOLATILE, 0]],
  },
  {
    // A chain on a volatile-heavy belt: one pop razes its neighbours, they land
    // hard, and four blasts are live inside a fifth of a second. This is the
    // frame the DEBRIS_FRAME_CAP exists for — 4 x 56 = 224 particles wanted.
    name: "volatile-chain",
    blasts: [
      [760, 600, 89.6, VOLATILE, 0],
      [880, 560, 89.6, VOLATILE, 70],
      [700, 500, 89.6, VOLATILE, 150],
      [900, 660, 89.6, VOLATILE, 210],
    ],
  },
  {
    name: "demolition-charge",
    blasts: [[820, 580, 96, AMBER, 0]],
  },
  {
    // The intake taking a whole shipment at once: one blast per cube, along the
    // plant's roof, each in its own cargo's colour.
    name: "chute-shred",
    blasts: [
      [180, 379, 34, "#00f0ff", 0],
      [230, 379, 34, "#00f0ff", 20],
      [280, 379, 34, "#00f0ff", 40],
      [330, 379, 34, "#00f0ff", 60],
    ],
  },
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
  // module loaded.
  for (const reduced of [false, true]) {
    const ctxt = await browser.newContext({
      viewport: { width: 1280, height: 760 },
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    const page = await ctxt.newPage();
    await page.goto(url);

    for (const shot of SHOTS) {
      // Reduced motion has one thing to show and it is the same at every t.
      if (reduced && shot.name !== "volatile-single") continue;
      for (const at of FRAMES_MS) {
        await page.evaluate(async ({ src, sim, blasts, at }) => {
          const [{ makeBaseLevel }, { applyRatchets }, { Game }, { render }, { BOTS }] =
            await Promise.all([
              import(/* @vite-ignore */ `${src}/level.ts`),
              import(/* @vite-ignore */ `${src}/hazards.ts`),
              import(/* @vite-ignore */ `${src}/game.ts`),
              import(/* @vite-ignore */ `${src}/render.ts`),
              import(/* @vite-ignore */ `${sim}/bots.ts`),
            ]);
          const level = applyRatchets(makeBaseLevel(9, 7), { volatile: 6 });
          // FLOWN, on a fixed seed, so the debris is photographed over a pile
          // a real bay produced rather than over an empty field.
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

          const t0 = now;
          const effects = blasts.map(([x, y, r, color, delay]) => ({
            kind: "explosion" as const, x, y, r, color, t0: t0 + delay,
          }));

          document.body.innerHTML = '<canvas id="shot"></canvas>';
          const c = document.getElementById("shot") as HTMLCanvasElement;
          c.width = 1280; c.height = 760;
          c.style.width = "1280px"; c.style.height = "760px";
          render(c.getContext("2d")!, 1280, 760, 1, {
            cubes: g.cubes, constraints: g.constraints, compactor: g.compactor,
            cannon: g.cannon, trajectory: g.trajectory, now: t0 + at, aiming: true,
            effects, level: g.level, nextIsBomb: g.nextIsBomb, bombs: g.bombs,
            windNow: g.windNow, windAverage: null, reload: 1, settling: false,
            strandWarning: false, alpha: 1,
          });
        }, { src, sim, blasts: shot.blasts, at });
        const tag = reduced ? `${shot.name}-reduced` : shot.name;
        await page.screenshot({ path: resolve(OUT, `${tag}-${String(at).padStart(3, "0")}ms.png`) });
      }
    }
    await ctxt.close();
  }

  await browser.close();
  await server.close();
  console.log(`wrote ${OUT}`);
}

main();
