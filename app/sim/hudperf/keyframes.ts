#!/usr/bin/env npx tsx
/**
 * IDLE-KEYFRAME CENSUS — "an idle bay spends 99.8% of its style recalculation
 * on running keyframes; WHICH keyframes, and what does each one cost?"
 *
 *   npx tsx sim/hudperf/keyframes.ts               # census + leave-one-out
 *   npx tsx sim/hudperf/keyframes.ts --frames 900
 *   npx tsx sim/hudperf/keyframes.ts --census      # the roll call only, no arms
 *
 * WHY THIS EXISTS. sim/hudperf/run.ts's third arm stills EVERY animation at
 * once and reports the total: RecalcStyle 289.9ms against 0.6ms over 600 idle
 * frames. That number says the whole category is worth chasing and says nothing
 * about where inside it to aim, which is the only question left — "turn off all
 * the motion" is not a design anyone is going to ship.
 *
 * This harness splits that one number by animation. It rolls the running
 * animations on an idle bay, then measures each one LEAVE-ONE-OUT: still that
 * animation alone, leave every other one running, and read the difference off
 * Chromium's RecalcStyleDuration. An arm's number is what the game would get
 * back by making that one animation free.
 *
 * WHY LEAVE-ONE-OUT AND NOT ADD-ONE-IN. Style recalculation is not additive
 * across animations — Blink recalculates a dirty element once, however many
 * animations dirtied it, so two animations on the same element share a bill and
 * neither is worth its solo cost. Leave-one-out measures the MARGINAL saving,
 * which is the quantity a change actually banks. Add-one-in against a fully
 * stilled page would measure the solo cost, and the two only agree when no
 * element carries more than one animation. The crest cubes carry two each.
 *
 * WHAT TRANSFERS TO A PHONE. Ratios and the ranking, not the milliseconds —
 * headless Chromium rasterises in software on a desktop CPU, the caveat
 * sim/renderperf and sim/hudperf both carry. A keyframe that is 40% of the
 * desktop's idle recalc is the one to aim at on the device; its 0.2ms is not
 * the device's 0.2ms.
 *
 * COMPOSITED vs MAIN-THREAD is reported alongside and is a SEPARATE claim from
 * the measurement. `transform` and `opacity` can run on the compositor and cost
 * the main thread nothing per frame; everything else — clip-path, box-shadow,
 * background-position, filter — is recalculated and repainted on the main
 * thread every frame it changes. The classification is read off the keyframes'
 * own declarations; the cost is read off the counter. Where they disagree, the
 * counter wins and the disagreement is the finding.
 */
import { createServer } from "vite";
import * as playwright from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..", "..");

const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const FRAMES = parseInt(opt("frames") ?? "600", 10);
const CENSUS_ONLY = argv.includes("--census");
/**
 * How many times each arm is measured. THREE IS THE FLOOR, not a default worth
 * lowering, and the reason is on the record: the first version of this harness
 * ran every arm once and printed six confidently-ranked rows. Re-running it
 * moved `belt-arrow-pulse` from 25% to 14% and sent `pulse-danger` from +18.0ms
 * to **-14.5ms** — a row that had read as the fourth-biggest win in the table
 * came back negative. Only the top row survived.
 *
 * That is the same trap the design doc records for the device: a block-design
 * A/B there said box-shadow was worth +15fps and interleaving said +2.3. One
 * pass over the arms is a block design, whatever it is measuring.
 */
const REPEATS = parseInt(opt("repeats") ?? "3", 10);

/**
 * The properties Blink can hand to the compositor, so an animation touching
 * only these costs the main thread nothing per frame. Kept deliberately short:
 * `filter` is animatable on the compositor in principle but a drop-shadow's
 * blur is re-rastered whatever thread owns it, so counting it as free would
 * flatter exactly the animation this census exists to find.
 */
const COMPOSITED = new Set(["transform", "opacity"]);

type Running = {
  name: string;
  /** How many elements are running it right now. */
  targets: number;
  /** A readable pointer at one of them. */
  sample: string;
  /** Properties the @keyframes rule declares, deduped. */
  props: string[];
  composited: boolean;
};

const server = await createServer({
  configFile: resolve(APP_ROOT, "vite.config.ts"),
  root: APP_ROOT,
  server: { host: "127.0.0.1" },
  logLevel: "warn",
});
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) {
  console.error("✗ the app dev server reported no local URL");
  await server.close();
  process.exit(1);
}

const browser = await playwright.chromium.launch();
// The same landscape phone box every other harness here measures in.
const page = await browser.newPage({
  viewport: { width: 900, height: 420 },
  deviceScaleFactor: 2,
});
page.on("pageerror", (err) => console.error("✗ page error:", err.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate("document.fonts.ready");
await page.waitForFunction("window.__tl !== undefined", null, { timeout: 20_000 });
await page.addScriptTag({ url: "/sim/hudperf/probe.ts", type: "module" });
await page.waitForFunction("window.__hudperf !== undefined", null, { timeout: 20_000 });

const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const styleMs = async (): Promise<number> => {
  const m = await cdp.send("Performance.getMetrics");
  const hit = m.metrics.find((x) => x.name === "RecalcStyleDuration");
  return (hit?.value ?? 0) * 1000;
};

await page.evaluate("window.__hudperf.start()");

/**
 * The browser half, installed once and driven per arm.
 *
 * Stilling ONE animation needs the elements running it, and a selector will not
 * do — `.tower__floor` runs different animations on different floors, and the
 * crest's seven cubes each run a private `cube-*` alongside a shared jiggle.
 * So the arm STAMPS the elements it means (`data-kf-off`) and stills them by
 * attribute, which is exact and reverses cleanly.
 *
 * `animation: none` on an element running two animations kills both, which is
 * why an element carrying more than one is reported: its arms overlap and the
 * report has to say so rather than let two rows be added together.
 */
await page.evaluate(`
window.__kf = {
  sheet: null,
  roll() {
    const out = new Map();
    for (const a of document.getAnimations()) {
      const name = a.animationName;
      // Transitions have no animationName and are not this census's subject.
      if (!name) continue;
      const el = a.effect && a.effect.target;
      if (!el || !(el instanceof Element)) continue;
      let e = out.get(name);
      if (!e) { e = { name, targets: 0, sample: '', els: [] }; out.set(name, e); }
      e.targets++;
      e.els.push(el);
      if (!e.sample) {
        const cls = String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
        e.sample = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
      }
    }
    // How many animations each element carries — an element with two has its
    // cost shared, and both of its arms will read low.
    const per = new Map();
    for (const e of out.values()) for (const el of e.els) per.set(el, (per.get(el) || 0) + 1);
    for (const e of out.values()) e.shared = e.els.some(el => per.get(el) > 1);
    return [...out.values()].map(e => ({ name: e.name, targets: e.targets, sample: e.sample, shared: e.shared }));
  },
  // Properties each @keyframes rule declares, read off the live stylesheets.
  props() {
    const out = {};
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch { continue; }
      for (const r of rules || []) {
        if (r.type !== CSSRule.KEYFRAMES_RULE) continue;
        const set = new Set();
        for (const kf of r.cssRules) for (const p of kf.style) set.add(p);
        out[r.name] = [...set];
      }
    }
    return out;
  },
  off(names) {
    this.on();
    const want = new Set(names);
    for (const a of document.getAnimations()) {
      const n = a.animationName;
      if (!n || !want.has(n)) continue;
      const el = a.effect && a.effect.target;
      if (el instanceof Element) el.setAttribute('data-kf-off', '');
    }
    this.sheet = document.createElement('style');
    this.sheet.textContent = '[data-kf-off], [data-kf-off]::before, [data-kf-off]::after { animation: none !important; }';
    document.head.appendChild(this.sheet);
  },
  on() {
    if (this.sheet) { this.sheet.remove(); this.sheet = null; }
    for (const el of document.querySelectorAll('[data-kf-off]')) el.removeAttribute('data-kf-off');
  },
  // Spin for N frames so the counter has a window to fill.
  async spin(frames) {
    await new Promise(res => {
      let i = 0;
      const tick = () => (++i >= frames ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  },
};
`);

/** Put the page on a fresh idle bay and let it settle. */
const freshIdle = async (): Promise<void> => {
  await page.evaluate(
    `window.__hudperf.prepare(${JSON.stringify({ frames: FRAMES, fire: false, still: false, fresh: true })})`,
  );
  if (CONGEST) await congestDress();
};

/**
 * --congest: measure the bay DRESSED as congest-danger, because that state is
 * where the crest turns on its most expensive layers (the ::before glint sweep
 * exists only there, and pixel-sparkle runs 8.75x faster) and it is exactly the
 * moment a real bay is also paying peak physics and canvas cost — the frames a
 * phone actually drops.
 *
 * Dressed, not driven: syncHud re-derives .plant--congest-* from the live
 * pileTier every frame, so a class forced onto the plant is stripped within a
 * frame, and building a genuinely congested pile headlessly would measure the
 * pile. Instead a harness-only class replays the state's own rules, CLONED off
 * the live stylesheets with the selector rewritten — every rule that mentions
 * .plant--congest-danger, verbatim, so the dressed bay runs exactly the
 * animation set the real state runs (the faster cube-* churn and crest-rattle
 * that the danger state restates per strip included — the first version of
 * this dress hand-copied two pseudo rules and priced the sweep against a
 * lighter workload than the one claimed). The palette declarations come along
 * and are inert to a style-recalc counter; drift is impossible because there
 * is nothing to keep in step.
 */
const CONGEST = argv.includes("--congest");
const congestDress = async (): Promise<void> => {
  await page.evaluate(`
    if (!document.getElementById('kf-congest-sheet')) {
      const cloned = [];
      for (const ss of document.styleSheets) {
        let rules; try { rules = ss.cssRules; } catch { continue; }
        for (const r of rules || []) {
          if (r instanceof CSSStyleRule && r.selectorText.includes('.plant--congest-danger')) {
            cloned.push(r.cssText.replaceAll('.plant--congest-danger', '.kf-congest'));
          }
        }
      }
      if (!cloned.length) throw new Error('no .plant--congest-danger rules found to clone');
      const s = document.createElement('style');
      s.id = 'kf-congest-sheet';
      s.textContent = cloned.join('\\n');
      document.head.appendChild(s);
    }
    document.querySelector('.plant')?.classList.add('kf-congest');
  `);
};

await freshIdle();

const props = (await page.evaluate("window.__kf.props()")) as Record<string, string[]>;
const rolled = (await page.evaluate("window.__kf.roll()")) as {
  name: string;
  targets: number;
  sample: string;
  shared: boolean;
}[];

const running: (Running & { shared: boolean })[] = rolled
  .map((r) => {
    const p = props[r.name] ?? [];
    return {
      ...r,
      props: p,
      composited: p.length > 0 && p.every((x) => COMPOSITED.has(x)),
    };
  })
  .sort((a, b) => b.targets - a.targets || a.name.localeCompare(b.name));

console.log(`# Tetrilaunch idle-keyframe census${CONGEST ? " — dressed as congest-danger" : ""}\n`);
console.log(
  `frames=${FRAMES} per arm, engine=chromium(headless), 900x420 @2x. ` +
    `Milliseconds are a desktop CPU's; the RANKING is what transfers to a phone.\n`,
);

console.log("## What is running on an idle bay\n");
if (!running.length) {
  console.log("_Nothing. An idle bay runs no keyframes at all._\n");
} else {
  const totalTargets = running.reduce((a, r) => a + r.targets, 0);
  console.log(
    `${running.length} animation(s) across ${totalTargets} element(s).\n`,
  );
  console.log("| animation | elements | thread | properties | sample |");
  console.log("|---|---|---|---|---|");
  for (const r of running) {
    console.log(
      `| \`${r.name}\`${r.shared ? " ◇" : ""} | ${r.targets} | ` +
        `${r.composited ? "compositor" : "**main**"} | ` +
        `${r.props.map((p) => `\`${p}\``).join(", ") || "_(no rule found)_"} | ` +
        `\`${r.sample}\` |`,
    );
  }
  if (running.some((r) => r.shared)) {
    console.log(
      `\n◇ shares at least one element with another animation, so its arm below ` +
        `reads LOW: stilling it leaves the element dirty for the other one, and ` +
        `two such rows must never be added together.`,
    );
  }
  console.log();
}

if (CENSUS_ONLY || !running.length) {
  await page.evaluate("window.__hudperf.teardown()");
  await browser.close();
  await server.close();
  process.exit(0);
}

/**
 * One arm: still `names`, spin, and read the counter.
 *
 * EVERY ARM STARTS FROM A FRESH BAY, for the reason run.ts's attribution arm
 * documents at length — an arm inheriting a congested pile is measuring
 * `pulse-danger` on the readouts and calling it something else.
 */
const arm = async (names: string[]): Promise<number> => {
  await freshIdle();
  if (names.length) await page.evaluate(`window.__kf.off(${JSON.stringify(names)})`);
  // Frames for the engine to tear the stilled animations down, so the window
  // measures the stilled page and not the act of stilling it.
  await page.evaluate("window.__kf.spin(30)");
  const before = await styleMs();
  await page.evaluate(`window.__kf.spin(${FRAMES})`);
  const after = await styleMs();
  await page.evaluate("window.__kf.on()");
  return after - before;
};

const allNames = running.map((r) => r.name);

/**
 * INTERLEAVED, not one pass per arm. Every arm is measured once per round and
 * the rounds rotate, so whatever drifts across a session — JIT warmup, the
 * machine's other load, the page's own accumulated state — lands on all of them
 * instead of on whichever arm happened to run while it was drifting. The device
 * half of this investigation learned the same lesson the expensive way; see the
 * REPEATS note above.
 */
const samples = new Map<string, number[]>();
const key = (names: string[]): string => (names.length ? names.join("+") : "(baseline)");
/**
 * TWO BASELINE SLOTS PER ROUND, and the second one is the whole point.
 *
 * `(control)` stills nothing, exactly like `(baseline)`. Its difference from
 * the baseline in the same round is therefore a measurement of ZERO taken by
 * this harness's own method — an A/A test. That difference is the noise floor,
 * and it is the only honest one available: asserting a floor, or estimating it
 * from the spread of a single arm, both let a drifting machine masquerade as a
 * result.
 */
const CONTROL = "(control)";
const plan: { k: string; names: string[] }[] = [
  { k: "(baseline)", names: [] },
  { k: CONTROL, names: [] },
  { k: key(allNames), names: allNames },
  ...running.map((r) => ({ k: key([r.name]), names: [r.name] })),
];
/**
 * THE ORDER ROTATES BETWEEN ROUNDS, it is not merely repeated. A fixed order
 * would give every arm a fixed position inside the round, and drift that is
 * monotonic WITHIN a round — JIT tiers kicking in, a thermal ramp, another
 * process's load — would then land on the same arms every time. Pairing against
 * a baseline that always ran first cannot cancel that, and a control that
 * always ran second cannot measure it at the ninth slot. Rotating by one slot
 * per round walks every arm through different positions, so position effects
 * land in the paired differences as noise the medians damp — and land in the
 * control's own zeros, where the noise floor can see them.
 */
for (let round = 0; round < REPEATS; round++) {
  for (let i = 0; i < plan.length; i++) {
    const slot = plan[(i + round) % plan.length];
    const ms = await arm(slot.names);
    samples.set(slot.k, [...(samples.get(slot.k) ?? []), ms]);
  }
}

/** Median, because one warm round should not drag an arm's whole figure. */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * PAIRED, not median-minus-median. Each round is measured on one machine state,
 * so `baseline[r] - arm[r]` cancels whatever that round was drifting through;
 * taking the medians first and subtracting them throws the pairing away and
 * leaves the drift in the answer. This is the same reason the device half of
 * this investigation interleaves its conditions every 400ms instead of running
 * them in blocks — interleaving only pays if the arithmetic uses the pairs.
 */
const bs = samples.get("(baseline)")!;
const paired = (k: string): number[] => samples.get(k)!.map((v, i) => bs[i] - v);
const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

const baseline = median(bs);
const floor = median(samples.get(key(allNames))!);
const prize = median(paired(key(allNames)));

console.log("## The window this is measured against\n");
console.log(
  `RecalcStyle over ${FRAMES} idle frames, ${REPEATS} interleaved rounds: ` +
    `**${baseline.toFixed(1)}ms** median with every animation running, ` +
    `**${floor.toFixed(1)}ms** with all ${allNames.length} stilled. The whole prize is ` +
    `**${prize.toFixed(1)}ms** (${(prize / FRAMES).toFixed(3)}ms/frame) as a paired ` +
    `median, and every row below is a share of it.\n`,
);

/**
 * THE NOISE FLOOR, measured rather than asserted: the largest zero this method
 * reported when it was measuring a zero. A row inside that band is not a small
 * win, it is the harness's resolution.
 */
const nulls = paired(CONTROL);
const noise = Math.max(...nulls.map(Math.abs));

const rows = running
  .map((r) => {
    const d = paired(key([r.name]));
    return { name: r.name, saved: median(d), spread: spread(d), r };
  })
  .sort((a, b) => b.saved - a.saved);

console.log("## What each one costs, leave-one-out\n");
console.log("| animation | thread | elements | saved | share | verdict |");
console.log("|---|---|---|---|---|---|");
for (const row of rows) {
  const pct = prize > 0 ? (row.saved / prize) * 100 : 0;
  const real = row.saved > noise;
  console.log(
    `| \`${row.name}\`${row.r.shared ? " ◇" : ""} | ` +
      `${row.r.composited ? "compositor" : "**main**"} | ${row.r.targets} | ` +
      `${row.saved.toFixed(1)}ms | ${real ? `${pct.toFixed(0)}%` : "—"} | ` +
      `${real ? "**real**" : "under the noise floor"} |`,
  );
}
console.log(
  `\nThe noise floor is **${noise.toFixed(1)}ms**, and it is measured, not asserted: ` +
    `the \`${CONTROL}\` arm stills nothing at all, so its paired difference from the ` +
    `baseline is this harness measuring a zero. Over ${REPEATS} rounds those zeros ` +
    `came out ${nulls.map((n) => n.toFixed(1)).join(", ")}ms. A row inside that band ` +
    `is not a small win — it is the resolution — and its share is left blank rather ` +
    `than printed as a number someone could quote.\n`,
);

// Only rows that cleared the noise floor get to vote on anything below. Summing
// the ones that did not would let six coin flips decide which thread the frame
// is spent on, which is the failure this harness's REPEATS note exists to
// prevent.
const real = rows.filter((r) => r.saved > noise);

// The one number a reader should leave with, and the honest caveat on it: the
// shares do not sum to 100% and are not supposed to, because animations sharing
// an element share a bill.
const sum = real.reduce((a, r) => a + r.saved, 0);
console.log(
  `The rows sum to ${sum.toFixed(1)}ms against a prize of ${prize.toFixed(1)}ms ` +
    `(${prize > 0 ? ((sum / prize) * 100).toFixed(0) : "0"}%). ` +
    (sum < prize * 0.9
      ? `They fall SHORT because elements carrying two animations stay dirty when ` +
        `either one alone is stilled — the missing share is only recoverable by ` +
        `stilling both, which is what the all-stilled floor above measures.`
      : `They exceed the prize where one element's recalculation is claimed by ` +
        `more than one arm.`) +
    `\n`,
);

const mainThread = real.filter((r) => !r.r.composited);
const compositor = real.filter((r) => r.r.composited);
const mainSaved = mainThread.reduce((a, r) => a + r.saved, 0);
const compSaved = compositor.reduce((a, r) => a + r.saved, 0);
console.log("## Compositor or main thread\n");
console.log(
  `The ${mainThread.length} main-thread animation(s) account for ${mainSaved.toFixed(1)}ms ` +
    `of the measured saving; the ${compositor.length} compositor-only one(s) account for ` +
    `${compSaved.toFixed(1)}ms.\n`,
);
console.log(
  compSaved > mainSaved * 0.5
    ? `A transform/opacity animation costing this much is the finding, not the ` +
      `noise: "composited" describes the PAINT, and Blink still ticks the ` +
      `animation and recalculates the element's style on the main thread every ` +
      `frame whatever property it lands on. Moving a keyframe onto transform ` +
      `does not make it free here; REMOVING it, or running it on fewer elements, ` +
      `is what this counter would notice.\n`
    : `The saving tracks the main-thread animations, which is what the property ` +
      `classification predicts.\n`,
);

await page.evaluate("window.__hudperf.teardown()");
await browser.close();
await server.close();
