// Scratch: what does a pull-back actually PRODUCE, in a real browser, on the
// panels the full-power pull-room bug was reported and diagnosed on?
//
// The acceptance criteria for that fix are stated in CSS px on named viewports
// (docs/superpowers/specs/2026-08-28-full-power-pull-needs-offscreen-room.md),
// and the only honest way to answer them is to inject the pointer sequence and
// read the HUD the player reads. This drives the real app through vite (DEV, so
// window.__tl is exposed), starts a bay, and swipes horizontally from the
// cannon's own screen position, printing #hud-power-val and whether the release
// counted as a shot.
//
// Everything about the geometry is asked of the PAGE — vite serves the source
// modules, so render.ts's computeViewport and cannon.ts's DRAG_MAX are
// importable in the browser. A harness that modelled the layout instead of
// reading it would be measuring its own arithmetic.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx tsx sim/_scratch-pullpower.ts
import { createServer } from "vite";
import { chromium, type Page, type CDPSession } from "playwright";

const VIEWPORTS: [number, number, string][] = [
  [854, 384, "OnePlus 7T landscape — the reporting device"],
  [1280, 720, "exact 16:9 — zero letterbox"],
  [1269, 663, "desktop"],
];

/** The 7T's live-glass edge: its touch driver reports nothing left of this. */
const DEAD_BAND_CSS_X = 95;

/** Browser-side geometry: the viewport transform and the drag span. */
async function geometry(page: Page): Promise<{ scale: number; cannonX: number; cannonY: number; span: number }> {
  return page.evaluate(async () => {
    // The specifiers are dev-server URLs, not paths tsc can resolve, so they
    // go through a dynamic-import factory.
    const load = new Function("s", "return import(s)") as (s: string) => Promise<any>;
    const render = await load("/src/game/render.ts");
    const cannon = await load("/src/game/cannon.ts");
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const vp = render.computeViewport(r.width, r.height);
    return {
      scale: vp.scale,
      cannonX: r.left + vp.ox + cannon.CANNON.x * vp.scale,
      cannonY: r.top + vp.oy + cannon.CANNON.y * vp.scale,
      span: cannon.DRAG_MAX,
    };
  });
}

async function startBay(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__tl, null, { timeout: 30000 });
  await page.evaluate(() => (window as any).__tl.startGame());
  await page.waitForFunction(() => (window as any).__tl?.game?.status === "playing", null, { timeout: 30000 });
  await page.evaluate(() => {
    const app = (window as any).__tl;
    app.dismissDragHint?.();
    app.dismissKeyHints?.();
  });
  await page.waitForTimeout(200);
}

async function swipe(
  page: Page,
  client: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<{ pct: number; fired: boolean }> {
  const before = await page.evaluate(() => (window as any).__tl.game.cannon.pieceIndex);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
    });
  }
  const live = (await page.evaluate(() => document.querySelector("#hud-power-val")?.textContent)) ?? "0%";
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(70);
  const after = await page.evaluate(() => (window as any).__tl.game.cannon.pieceIndex);
  // A fired shot changes the field; rebuild so every probe starts identical.
  await page.evaluate(() => (window as any).__tl.startGame());
  await page.waitForFunction(() => (window as any).__tl?.game?.status === "playing");
  await page.waitForTimeout(90);
  return { pct: parseInt(live, 10), fired: after !== before };
}

async function main(): Promise<void> {
  const server = await createServer({ root: process.cwd(), server: { port: 5199 } });
  await server.listen();
  const browser = await chromium.launch();
  for (const [w, h, name] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const page = await ctx.newPage();
    const client = await ctx.newCDPSession(page);
    await page.goto("http://localhost:5199/", { waitUntil: "networkidle" });
    await startBay(page);
    const g = await geometry(page);
    const cannon = { x: g.cannonX, y: g.cannonY };
    const fullEnd = g.cannonX - g.span * g.scale;
    console.log(`\n=== ${w}x${h}  ${name} ===`);
    console.log(
      `scale ${g.scale.toFixed(4)}   cannon at CSS x=${g.cannonX.toFixed(1)}   ` +
        `span ${g.span} world px = ${(g.span * g.scale).toFixed(1)} CSS px   ` +
        `full pull ends at CSS x=${fullEnd.toFixed(1)}`,
    );

    console.log("\n  the ramp, from the cannon:");
    console.log("    end CSS x | gesture CSS px | world px |  power | fired");
    for (const end of [150, 130, 120, 110, 100, 90, 70, 40, 10]) {
      if (end >= cannon.x) continue;
      const { pct, fired } = await swipe(page, client, cannon, { x: end, y: cannon.y });
      const gesture = cannon.x - end;
      console.log(
        `    ${String(end).padStart(9)} | ${gesture.toFixed(1).padStart(14)} | ` +
          `${(gesture / g.scale).toFixed(1).padStart(8)} | ${String(pct + "%").padStart(6)} | ${fired}`,
      );
    }

    // CRITERION: full power without leaving live glass / the playfield.
    const target = w === 854 ? DEAD_BAND_CSS_X + 5 : Math.max(1, Math.round(fullEnd));
    const crit = await swipe(page, client, cannon, { x: target, y: cannon.y });
    console.log(
      `\n  CRITERION full power: pull from the cannon ending at CSS x=${target} -> ` +
        `${crit.pct}% ${crit.pct >= 100 ? "PASS" : "FAIL"}` +
        (w === 854 ? `  (the 7T's live glass starts at CSS x=${DEAD_BAND_CSS_X})` : "  (playfield left edge is CSS x=0)"),
    );

    // CRITERION: a sub-threshold nudge still refuses to fire.
    for (const nudge of [8, 16, 24]) {
      const m = await swipe(page, client, cannon, { x: cannon.x - nudge, y: cannon.y });
      console.log(
        `  CRITERION misfire: a ${String(nudge).padStart(2)} CSS px nudge -> ` +
          `${String(m.pct + "%").padStart(4)}, fired=${m.fired} ${m.fired ? "FAIL" : "PASS"}`,
      );
    }

    // CRITERION: a mid-screen drag ramps 0 -> 100 with no discontinuity.
    const mid = { x: Math.round(w * 0.62), y: cannon.y };
    const seq: number[] = [];
    for (let d = 0; d <= g.span * g.scale + 20; d += Math.max(4, Math.round(g.span * g.scale / 12))) {
      const r = await swipe(page, client, mid, { x: mid.x - d, y: mid.y });
      seq.push(r.pct);
    }
    let biggest = 0;
    let monotone = true;
    for (let i = 1; i < seq.length; i++) {
      biggest = Math.max(biggest, seq[i] - seq[i - 1]);
      if (seq[i] < seq[i - 1]) monotone = false;
    }
    console.log(
      `  CRITERION mid-screen ramp from CSS x=${mid.x}: ${seq.join(" -> ")} ` +
        `(monotone=${monotone}, biggest step ${biggest}pp) ${monotone && seq[seq.length - 1] >= 100 ? "PASS" : "FAIL"}`,
    );
    await ctx.close();
  }
  await browser.close();
  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
