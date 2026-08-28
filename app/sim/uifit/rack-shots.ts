/**
 * Eyeball rig for the BUILD RACK. Boots the UI-fit harness (real app.css, real
 * hudHTML, real layout vars) and shoots the plant panel at every slot count
 * that matters, on the densities and window sizes the rack's two allowances are
 * measured against.
 *
 *   npx tsx sim/uifit/rack-shots.ts [outDir]
 *
 * Not part of `npm test`: it proves nothing on its own, it just makes pictures
 * — the same standing as crest-shots.ts beside it.
 *
 * WHY IT EXISTS. The plate's size is a budget divided by the rack's own slot
 * count, held between two caps (app.css's --plate-w). Every one of those terms
 * is a number the harness cannot have an opinion about: a rack that leaves a
 * third of its row unspent FITS, and a plate at any aspect at all clears the
 * `badge` floor as long as it is wide enough for its mark. Both defects this
 * rule has had were reported by a player looking at the screen, and both were
 * settled by looking at it here — so the looking is a tool rather than a
 * one-off. The printed table is the other half: plate box, aspect, mark, and
 * the row and PANEL heights, which is where an over-generous cap shows up as
 * the plant panel growing upward over the play area.
 *
 * `hud-lance` is the fixture because it is the row at its busiest — the BUILD
 * tag and three ability chips beside the rack — and the plate count is edited
 * in the page afterwards, since the two fixtures only carry four slots and ten.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOT_BASE, SLOT_CAP } from "../../src/game/meta";
import type { Insets } from "../../src/game/layout";
import type {} from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? resolve(HERE, "..", "results", "rack");

const NONE = { left: 0, right: 0, top: 0, bottom: 0 };

/** Two phones and three windows, chosen for what each one BINDS rather than for
 *  coverage — sim/uifit/devices.ts is the matrix, this is the sample.
 *
 *  - pixel7     the roomiest compact row: 120px of it went unspent under a flat
 *               plate width, and it is the density the seven-slot report came
 *               from.
 *  - 13mini     the tightest compact row in the fleet (209px), where nine and
 *               ten slots still come in under the square cap.
 *  - win1269    the desktop shell's default window minus its titlebar.
 *  - laptop1280 the authored box, so the numbers here are the reference ones.
 *  - desk1920   the top of the magnified range, where an uncapped plate does
 *               its worst.
 */
const DEVICES = [
  { name: "pixel7", w: 915, h: 412, dpr: 2, fine: false, insets: NONE },
  { name: "13mini", w: 780, h: 360, dpr: 2, fine: false, insets: { left: 50, right: 50, top: 0, bottom: 21 } },
  { name: "win1269", w: 1269, h: 663, dpr: 1, fine: true, insets: NONE },
  { name: "laptop1280", w: 1280, h: 720, dpr: 1, fine: true, insets: NONE },
  { name: "desk1920", w: 1920, h: 1080, dpr: 1, fine: true, insets: NONE },
];

/** The rig as it undocks, the rig the report came from, and the cap. */
const COUNTS = [SLOT_BASE, 7, SLOT_CAP];

await mkdir(OUT, { recursive: true });
const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("the harness dev server reported no local URL");
const browser = await chromium.launch();

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr,
    isMobile: !d.fine, hasTouch: !d.fine,
  });
  // tsx's keepNames wrapper travels into the page with any function serialised
  // by toString(); defining it as identity is the standard workaround.
  await ctx.addInitScript(() => {
    (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
  });
  const page = await ctx.newPage();
  await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__uifit);
  await page.evaluate(async () => { await document.fonts.ready; });

  for (const n of COUNTS) {
    await page.evaluate(
      ([id, insets, fp]) => window.__uifit.render(id as string, insets as Insets, fp as boolean),
      ["hud-lance", d.insets, d.fine] as [string, Insets, boolean],
    );
    // Edit the rack to the count under test. `--rack-slots` is what the
    // stylesheet divides by (components.ts's shipPlatesHTML writes it), so it
    // has to move with the boxes or the picture is of a rule nothing renders.
    await page.evaluate((count) => {
      const rack = document.querySelector(".ship-rack") as HTMLElement;
      const seed = Array.from(rack.children) as HTMLElement[];
      while (rack.children.length > count) rack.lastElementChild!.remove();
      while (rack.children.length < count) {
        rack.appendChild(seed[rack.children.length % seed.length].cloneNode(true));
      }
      rack.style.setProperty("--rack-slots", String(count));
    }, n);
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    const m = await page.evaluate(() => {
      const plate = document.querySelector(".ship-plate")!.getBoundingClientRect();
      const mods = document.querySelector(".pl-mods") as HTMLElement;
      const rack = document.querySelector(".ship-rack") as HTMLElement;
      return {
        w: plate.width, h: plate.height,
        mark: parseFloat(getComputedStyle(document.querySelector(".ship-plate__g")!).fontSize),
        row: mods.clientHeight,
        panel: (document.querySelector(".plant") as HTMLElement).getBoundingClientRect().height,
        // Negative is air. Positive means a slot is behind the row's scroll,
        // which is sim/uifit's `rack` assertion going red.
        spare: mods.getBoundingClientRect().left + mods.clientWidth - rack.getBoundingClientRect().right,
      };
    });
    console.log(
      `${d.name.padEnd(11)} n=${String(n).padEnd(3)} ` +
      `plate ${m.w.toFixed(1)}x${m.h.toFixed(1)} (ar ${(m.w / m.h).toFixed(2)})  ` +
      `mark ${m.mark.toFixed(1)}  row ${m.row.toFixed(0)}  panel ${m.panel.toFixed(0)}  ` +
      `spare ${m.spare.toFixed(1)}`);
    const el = await page.$(".plant");
    await el!.screenshot({ path: `${OUT}/${d.name}-${n}.png` });
  }
  await ctx.close();
}
await browser.close();
await server.close();
console.log(`\nwrote ${DEVICES.length * COUNTS.length} shots to ${OUT}`);
