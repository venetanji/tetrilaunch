/**
 * Eyeball rig for the crest. Boots the UI-fit harness (real app.css, real
 * hudHTML, real layout vars) and shoots the plant panel across everything that
 * moves its colour — --crest-heat (the music's slow half), the --h0..--h6
 * rotation (one step per launch), and the loaded material's re-anchored ramp —
 * so the whole colour path can be checked without a soundtrack or a gesture.
 *
 *   npx tsx sim/uifit/crest-shots.ts [outDir]
 *
 * Not part of `npm test`: it proves nothing on its own, it just makes pictures.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MATERIAL_ROLL_ORDER } from "../../src/game/belt";
import { shipmentAura } from "../../src/game/theme";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "crest");

const HEATS = [0, 0.25, 0.5, 0.75, 1];
const STEPS = [0, 2, 4];
const STATES: Array<[string, string]> = [
  ["calm", ""],
  ["warn", "plant--congest-warn"],
  ["danger", "plant--congest-danger"],
  ["maw", "plant--maw"],
];
/** The six specials, straight off the belt's own roll order so a seventh
 *  material is shot here the day it is added. Each gets two pictures — calm,
 *  and under tier-2 congestion — because that pair is the hierarchy the CSS
 *  has to get right: the metal goes to the tier, the embers stay with the
 *  cargo. */
const MATERIALS = MATERIAL_ROLL_ORDER;

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error("vite did not report a local url");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__uifit);

  const screens: string[] = await page.evaluate(() => window.__uifit.screens);
  const id = screens.find((s) => /^hud$/.test(s)) ?? screens.find((s) => s.startsWith("hud"));
  if (!id) throw new Error(`no hud screen among: ${screens.join(", ")}`);
  console.log(`screen: ${id}`);

  await page.evaluate(
    (s) => window.__uifit.render(s, { top: 0, right: 0, bottom: 0, left: 0 }),
    id,
  );
  await page.waitForTimeout(300);

  // The crest hangs OUTSIDE .plant on every side (negative offsets into the
  // frame bands), so clip a padded box rather than shooting the element.
  const box = await page.locator(".plant").boundingBox();
  if (!box) throw new Error(".plant did not lay out");
  const pad = 34;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };

  // Freeze the cube churn and the sparks so a shot is reproducible; the thing
  // under test here is colour, and a running clip-path animation just makes
  // two otherwise identical shots differ.
  await page.addStyleTag({ content: `.plant__crest, .plant__crest::before, .plant__crest::after { animation: none !important; }` });

  const drive = async (heat: number, step: number, stateClass: string, mat: string | null = null) => {
    await page.evaluate(
      ({ heat, step, stateClass, mat }) => {
        const plant = document.querySelector<HTMLElement>(".plant");
        if (!plant) throw new Error("no .plant");
        plant.className = ["plant", stateClass, mat ? "plant--mat" : ""].filter(Boolean).join(" ");
        if (mat) plant.style.setProperty("--crest-mat", mat);
        else plant.style.removeProperty("--crest-mat");
        plant.style.setProperty("--crest-heat", String(heat));
        plant.style.setProperty("--crest-beat", "0");
        for (let i = 0; i < 7; i++) {
          plant.style.setProperty(`--h${i}`, `var(--ramp-${(i + step) % 7})`);
        }
      },
      { heat, step, stateClass, mat },
    );
  };

  for (const [name, cls] of STATES) {
    for (const heat of HEATS) {
      await drive(heat, 0, cls);
      await page.screenshot({ path: resolve(OUT, `${name}-heat-${heat}.png`), clip });
    }
    for (const step of STEPS) {
      await drive(0.85, step, cls);
      await page.screenshot({ path: resolve(OUT, `${name}-step-${step}.png`), clip });
    }
  }

  // The loaded material's ring, calm and congested. shipmentAura rather than
  // the raw spec colour, exactly as syncHud writes it — the whole point of
  // these two shots is that slag and tar are still visible on a dark border.
  for (const mat of MATERIALS) {
    const anchor = shipmentAura("I", mat);
    await drive(0.85, 0, "", anchor);
    await page.screenshot({ path: resolve(OUT, `mat-${mat}.png`), clip });
    await drive(0.85, 0, "plant--congest-danger", anchor);
    await page.screenshot({ path: resolve(OUT, `mat-${mat}-danger.png`), clip });
  }

  // The same thing for the loaded material's run: the four re-anchored rungs
  // and the embers they throw, resolved rather than eyeballed. The embers are
  // the half the shots above CANNOT show — .plant__crest::after rests at
  // opacity 0 and the rig freezes its animation to keep shots reproducible —
  // so this is the only place a wrong ember colour is visible at all.
  for (const mat of MATERIALS) {
    const rungs = await page.evaluate((anchor) => {
      const plant = document.querySelector<HTMLElement>(".plant")!;
      plant.className = "plant plant--mat";
      plant.style.setProperty("--crest-mat", anchor);
      const cs = getComputedStyle(plant);
      const brow = document.querySelector<HTMLElement>(".plant__crest--brow")!;
      const bs = getComputedStyle(brow, "::after");
      return {
        cells: [3, 4, 5, 6].map((i) => cs.getPropertyValue(`--cell-${i}`).trim()),
        embers: ["hot", "a", "b", "c"].map((k) => bs.getPropertyValue(`--ember-${k}`).trim()),
      };
    }, shipmentAura("I", mat));
    console.log(`${mat.padEnd(9)} ${shipmentAura("I", mat)}  cells ${rungs.cells.join(" ")}`);
    console.log(`${"".padEnd(9)} ${"".padEnd(7)}  embers ${rungs.embers.join(" ")}`);
  }

  // What the ramp actually resolves to, so a wrong colour can be read as a
  // number instead of guessed at from a thumbnail.
  // No inner named functions in here: tsx compiles with esbuild's keepNames on,
  // which wraps them in a `__name` helper that does not exist in the page.
  const sampled = await page.evaluate(() => {
    const plant = document.querySelector<HTMLElement>(".plant")!;
    plant.className = "plant";
    const idx = [0, 1, 2, 3, 4, 5, 6];
    plant.style.setProperty("--crest-heat", "0");
    const cold = idx.map((i) => getComputedStyle(plant).getPropertyValue(`--ramp-${i}`).trim());
    plant.style.setProperty("--crest-heat", "1");
    const hot = idx.map((i) => getComputedStyle(plant).getPropertyValue(`--ramp-${i}`).trim());
    const brow = document.querySelector<HTMLElement>(".plant__crest--brow");
    return {
      cold,
      hot,
      browBg: brow ? getComputedStyle(brow).backgroundImage.slice(0, 220) : "(missing)",
      // The pixel sparks: must resolve to the compactor's own red.
      browSparks: brow ? getComputedStyle(brow, "::after").backgroundImage.slice(0, 200) : "(missing)",
      rivets: document.querySelectorAll(".plant__crest--rivet").length,
      strips: document.querySelectorAll(".plant__crest").length,
    };
  });
  console.log(JSON.stringify(sampled, null, 2));

  await browser.close();
  await server.close();
  console.log(`shots -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
