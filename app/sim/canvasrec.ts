/**
 * A RECORDING 2D CONTEXT — what a frame ASKS the rasteriser to do, counted in
 * node.
 *
 * sim/renderperf answers "what does a frame cost" and needs a real browser to
 * do it, because node has no rasteriser. This answers the other half — "what
 * COMMANDS does the frame issue" — and needs no rasteriser at all, which is
 * why it can live inside `npm test` and run on every change.
 *
 * Deliberately thin. It records method names and property writes and nothing
 * else; it is not a canvas, cannot say what a frame looks like, and is not
 * trying to. sim/renderperf --snapshot owns the pixels.
 *
 * Extracted from sim/systems.ts's draw-sequence block when the blast-debris
 * pins became its second caller. Two copies of a context stub is two stubs
 * that drift, and a pin measuring a slightly different context from the one
 * beside it is worse than no pin: both would still pass.
 */

/** One recording: what happened on a context since it was last reset. */
export interface Rec {
  calls: string[];
  sets: [string, unknown][];
  /** Arguments, for the methods named in makeRecCtx's `trace` list only.
   *  Off by default: a frame issues hundreds of calls and keeping every
   *  argument list would make the common pins allocate for nothing. */
  args: [string, unknown[]][];
}

export function newRec(): Rec {
  return { calls: [], sets: [], args: [] };
}

/** Empty a recording in place, so a caller can re-paint into the same one. */
export function resetRec(rec: Rec): void {
  rec.calls.length = 0;
  rec.sets.length = 0;
  rec.args.length = 0;
}

/** How many times `name` was called in this recording. */
export function callCount(rec: Rec, name: string): number {
  let n = 0;
  for (const c of rec.calls) if (c === name) n += 1;
  return n;
}

/** How many times `prop` was assigned in this recording. */
export function setCount(rec: Rec, prop: string): number {
  let n = 0;
  for (const [k] of rec.sets) if (k === prop) n += 1;
  return n;
}

/** Every value `prop` was assigned, in order. */
export function setValues(rec: Rec, prop: string): unknown[] {
  const out: unknown[] = [];
  for (const [k, v] of rec.sets) if (k === prop) out.push(v);
  return out;
}

const METHODS = [
  "save", "restore", "translate", "rotate", "scale", "transform", "setTransform",
  "resetTransform", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo",
  "rect", "roundRect", "quadraticCurveTo", "bezierCurveTo", "ellipse",
  "fill", "stroke", "clip", "fillRect", "strokeRect", "clearRect",
  "fillText", "strokeText", "drawImage", "putImageData", "setLineDash",
];

const PROPS = [
  "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "miterLimit",
  "globalAlpha", "globalCompositeOperation", "shadowBlur", "shadowColor",
  "shadowOffsetX", "shadowOffsetY", "font", "textAlign", "textBaseline",
  "filter", "imageSmoothingEnabled", "imageSmoothingQuality", "lineDashOffset",
];

/** A context object that records into `rec` and draws nothing. `trace` names
 *  the methods whose ARGUMENTS are kept as well as their names. */
export function makeRecCtx(
  canvas: unknown,
  rec: Rec,
  trace: readonly string[] = [],
): Record<string, unknown> {
  const traced = new Set(trace);
  const ctx: Record<string, unknown> = { canvas };
  const method = (name: string, ret?: () => unknown): void => {
    const keep = traced.has(name);
    ctx[name] = (...args: unknown[]) => {
      rec.calls.push(name);
      if (keep) rec.args.push([name, args]);
      return ret?.();
    };
  };
  for (const m of METHODS) method(m);
  method("measureText", () => ({ width: 10 }));
  // A gradient is an object the caller keeps and feeds stops to; anything less
  // and the first createLinearGradient in the frame throws.
  const gradient = { addColorStop: () => {} };
  method("createLinearGradient", () => gradient);
  method("createRadialGradient", () => gradient);
  method("createConicGradient", () => gradient);
  method("createPattern", () => null);
  // render.ts's trimToInk reads its bake back to find the ink. All-zero alpha
  // means "no ink anywhere", which sends it down its own early return — the
  // same path a context that refused getImageData takes, and documented there
  // as always correct. What these pins count is the calls AROUND the sprites.
  ctx.getImageData = (...args: unknown[]) => {
    rec.calls.push("getImageData");
    const w = (args[2] as number) || 1;
    const h = (args[3] as number) || 1;
    return { data: new Uint8ClampedArray(w * h * 4) };
  };
  for (const p of PROPS) {
    let held: unknown;
    Object.defineProperty(ctx, p, {
      get: () => held,
      set: (v: unknown) => { held = v; rec.sets.push([p, v]); },
    });
  }
  return ctx;
}

/** What installBrowserStubs handed back, so a caller can put the globals back. */
export interface BrowserStubs {
  restore: () => void;
}

/**
 * THE REDUCED-MOTION ANSWER, held module-wide and read LIVE.
 *
 * render.ts memoises its MediaQueryList on first read — deliberately, so that
 * a player who flips the preference mid-run is honoured without a matchMedia
 * call inside the draw loop. That memo survives every later installBrowserStubs
 * call in the same process, so a per-install boolean would be read once and
 * then ignored for the rest of the run.
 *
 * A module-level flag behind a getter is what a real MediaQueryList IS: one
 * object whose `matches` tracks the OS. Flipping this flag is therefore not a
 * test cheat, it is the exact event render.ts's memo was built to survive, and
 * a pin that flips it is checking the documented behaviour rather than working
 * around it.
 */
let reducedMotionFlag = false;

/** Flip the preference the stubbed matchMedia reports, live. */
export function setReducedMotion(on: boolean): void {
  reducedMotionFlag = on;
}

/**
 * Stand up the handful of browser globals render.ts touches, so a frame can be
 * "drawn" in node.
 *
 * `reducedMotion` seeds the matchMedia stub, which is the only way to reach
 * render.ts's prefers-reduced-motion path headlessly; setReducedMotion flips it
 * afterwards, live, for a pin that needs both answers in one process.
 */
export function installBrowserStubs(reducedMotion = false): BrowserStubs {
  reducedMotionFlag = reducedMotion;
  const glob = globalThis as unknown as Record<string, unknown>;
  const prevDoc = glob.document;
  const prevWin = glob.window;
  const prevPath = glob.Path2D;
  // Every offscreen bake goes through document.createElement("canvas"); those
  // get their own recorder, so a sprite bake's commands never land in a count
  // being asserted about the live frame.
  glob.document = {
    createElement: () => {
      const off: Record<string, unknown> = { width: 0, height: 0 };
      const offRec = newRec();
      off.getContext = () => makeRecCtx(off, offRec);
      return off;
    },
  };
  glob.window = {
    matchMedia: () => ({ get matches(): boolean { return reducedMotionFlag; } }),
  };
  glob.Path2D = class { constructor(_d?: string) { void _d; } };
  return {
    restore: () => {
      glob.document = prevDoc;
      glob.window = prevWin;
      glob.Path2D = prevPath;
    },
  };
}
