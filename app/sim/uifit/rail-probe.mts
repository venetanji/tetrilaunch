/**
 * WHAT THE TIER HUB'S RAIL ACTUALLY MEASURES, per device row — the fact the
 * Contract-preview container query in app.css sits between.
 *
 * Not part of the fleet run: it answers a question the fleet cannot, because
 * uifit reports VIOLATIONS and a preview that is simply absent breaks no
 * assertion. That is how `min-height: 360px` shipped missing the Pixel 7 pair
 * by 0.25px — every row was green, and the largest hole in the fleet was
 * invisible to the harness watching it.
 *
 * Run it when the rail's geometry changes or a device row is added:
 *   npx tsx sim/uifit/rail-probe.mts
 * then re-read the margin pin in sim/systems.ts against the numbers it prints.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { resolve } from "node:path";
import { DEVICES } from "./devices";

const HERE = new URL(".", import.meta.url).pathname;
const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
await server.listen();
const base = server.resolvedUrls!.local[0];
const browser = await chromium.launch();
const rows: string[] = [];
for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr });
  await page.goto(`${base}harness.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!(window as any).__uifit);
  await page.evaluate(([id, insets]) => (window as any).__uifit.render(id, insets), ["hub", d.insets] as any);
  const r = await page.evaluate(() => {
    const rail = document.querySelector(".tierhub__actions") as HTMLElement | null;
    const prev = document.querySelector(".tierhub__preview") as HTMLElement | null;
    const h = rail ? rail.getBoundingClientRect().height : -1;
    const shown = prev ? getComputedStyle(prev).display !== "none" && prev.getBoundingClientRect().height > 0 : false;
    const ph = prev ? prev.getBoundingClientRect().height : 0;
    return { h, shown, ph };
  });
  rows.push(`${r.h.toFixed(2).padStart(8)}  preview=${r.shown ? "YES" : "NO "}  ${r.ph.toFixed(0).padStart(4)}px  ${d.name}`);
  await page.close();
}
rows.sort((a, b) => parseFloat(a) - parseFloat(b));
console.log("  rail-h  preview  prev-h  device");
for (const r of rows) console.log(r);
await browser.close();
await server.close();
