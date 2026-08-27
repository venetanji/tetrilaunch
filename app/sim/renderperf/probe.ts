/**
 * DRAW-CALL CENSUS — what a frame ASKS the rasteriser to do, counted exactly.
 *
 * The background-split spec (docs/superpowers/specs/2026-08-27-background-layer-
 * split-design.md) ended by refuting its own premise and naming the survivor:
 * ~20fps of the CPH2573's frame is raster, the background blit's share of it is
 * zero, and what is left is "many small draws, not one big one". It then listed
 * three things nobody had measured — overdraw between stacked cubes, per-draw
 * state change, and whether the sprite cache is being hit or silently re-baking.
 *
 * A millisecond timer cannot answer any of the three. This can, and its answers
 * are the ones that TRAVEL: a draw call issued in headless Chromium is the same
 * draw call issued on the phone, and a texture switch avoided here is one
 * avoided there, whatever the two machines' milliseconds say about it.
 *
 * WHY WRAP THE CONTEXT RATHER THAN INSTRUMENT render.ts. The counters would
 * otherwise have to ship inside the module under test — either as dead code in
 * the app bundle or as a build flag that makes the measured renderer a
 * different renderer from the shipped one. Wrapping CanvasRenderingContext2D's
 * prototype from the harness leaves render.ts byte-identical to what the player
 * runs. It is the same technique the spec used on device (it wrapped drawImage
 * over CDP to identify the background blit), so a probe run here and a probe
 * run on the phone are reading the same instrument.
 *
 * Instrumentation is OFF unless a probe is running, and probe frames are never
 * the timed frames — every number in the sweep comes from an unwrapped context.
 */

/** One counter bundle: what happened between `start()` and `stop()`. */
export interface DrawCensus {
  /** Method-call counts, keyed by method name (only non-zero keys survive). */
  calls: Record<string, number>;
  /** Property assignments, keyed by property name. */
  sets: Record<string, number>;
  /**
   * Property assignments that wrote the value the context ALREADY held. These
   * are pure waste on any backend that validates or diffs state, and they are
   * the cheapest thing in this file to fix, so they are counted separately
   * rather than folded into `sets`.
   */
  redundantSets: Record<string, number>;
  /** save() calls; restore() is in `calls` and the two should balance. */
  maxSaveDepth: number;
  /**
   * drawImage source switches: calls whose source object differs from the
   * previous call's. Every switch hands the rasteriser a different backing
   * store to bind and breaks whatever batch it was accumulating, so this — not
   * the raw call count — is the number that says how many separate pieces of
   * work 150 cube stamps actually become. `drawImageSources` is how many
   * distinct source objects the frame touched at all.
   *
   * WHAT THIS COUNTER FOUND, AND THE ONE EXPERIMENT LEFT TO RUN. On the
   * `mixed` scene at 146 cubes (844x390, dpr 3) a frame makes 181.8 drawImage
   * calls across 35 distinct source canvases with 63.2 switches. Packing every
   * baked cube face into ONE atlas canvas and stamping cells out of it with the
   * 9-argument form takes that to 11 sources and 11.9 switches — a 5.3x cut,
   * and precisely the "many small draws, not one big one" conversion the
   * background-split spec's device work ended by asking for.
   *
   * It was built, measured, and NOT shipped, for two reasons that belong
   * together. It bought nothing here: interleaved against the unchanged
   * renderer over four rounds it moved p50 by −1% to +1%, which is noise, and
   * that is expected — headless Chromium rasterises in software, where a
   * texture bind costs nothing and the frame is bound by fill. And it is not
   * free: a sub-rect stamp of a face inset in a larger surface resamples
   * differently from a whole-canvas stamp of the same pixels, worth 0.005% of
   * channel samples by at most 3/255 at N=300 (a whole-surface 9-argument draw
   * is byte-identical, so the atlas, not the argument count, is the cause).
   *
   * So the atlas is a change with a real pixel cost and no demonstrated
   * benefit on any machine reachable from here — which is exactly the shape of
   * thing this repo does not merge on faith. The machine that could settle it
   * is the CPH2573, where the canvas is GPU-rastered and a bind is a real
   * batch break. Run --probe there for the switch counts, then A/B the atlas
   * with the interleaving `blitAb` uses; if 63 binds a frame turn out to
   * matter, the numbers above say what to expect.
   */
  drawImageSwitches: number;
  drawImageSources: number;
  /**
   * Device pixels covered by drawImage destination quads, summed with no
   * regard for overlap — the frame's blended-fill BILL. Computed through the
   * live CTM (getTransform's determinant) so a world-unit stamp is counted in
   * the device pixels it actually lands on.
   */
  drawImageDeviceArea: number;
  /**
   * The share of `drawImageDeviceArea` that is a FULL-CANVAS COVER — a 3-arg
   * blit to 0,0 from a source the size of the destination. That is the
   * background layer and nothing else, and it has to be separable because the
   * spec already measured its cost at zero: leaving 2.96 MP of proven-free
   * opaque fill inside the sprite pass's bill would make every overdraw ratio
   * below a statement about the background instead of about the cargo.
   *
   * The identification is the spec's own, so a probe here and the CDP probe on
   * the CPH2573 are picking out the same call.
   */
  fullCanvasBlitArea: number;
  fullCanvasBlits: number;
  /**
   * Canvas elements created while the probe was running. A steady-state frame
   * must create ZERO: every sprite bake makes at least one (makeSpriteCanvas)
   * and a trimmed one makes two (trimToInk's crop). Any non-zero number here is
   * the sprite cache silently re-baking inside the frame loop, which is open
   * question (3) from the spec answered with a single integer.
   */
  canvasesCreated: number;
  /** Frames the census covers, so callers can divide. */
  frames: number;
}

const EMPTY = (): DrawCensus => ({
  calls: {}, sets: {}, redundantSets: {},
  maxSaveDepth: 0, drawImageSwitches: 0, drawImageSources: 0,
  drawImageDeviceArea: 0, fullCanvasBlitArea: 0, fullCanvasBlits: 0,
  canvasesCreated: 0, frames: 0,
});

/** Methods worth counting. Deliberately explicit rather than "everything on the
 *  prototype": the list is what a reader has to scan in the output, and a
 *  hundred rows of zeroes is not a measurement, it is a haystack. */
const METHODS = [
  "save", "restore", "translate", "rotate", "scale", "transform", "setTransform", "resetTransform",
  "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo", "rect", "roundRect",
  "quadraticCurveTo", "bezierCurveTo", "ellipse",
  "fill", "stroke", "clip", "fillRect", "strokeRect", "clearRect",
  "fillText", "strokeText", "measureText",
  "drawImage", "putImageData", "getImageData",
  "createLinearGradient", "createRadialGradient", "createPattern", "createConicGradient",
] as const;

/** Properties worth counting. Every one of these is rasteriser state that a
 *  draw call inherits, which is why an assignment is not free even though it
 *  looks like one. */
const PROPS = [
  "fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "miterLimit",
  "globalAlpha", "globalCompositeOperation", "shadowBlur", "shadowColor",
  "shadowOffsetX", "shadowOffsetY", "font", "textAlign", "textBaseline",
  "filter", "imageSmoothingEnabled", "imageSmoothingQuality", "lineDashOffset",
] as const;

let live: DrawCensus | null = null;
/**
 * When set and true-returning, the full-canvas background blit is DROPPED
 * instead of drawn — wrong pixels, right cost, which is the only way to price a
 * draw that cannot simply be moved elsewhere.
 *
 * This is the CPH2573 probe from the background-split spec, reproduced here so
 * the two machines can be asked the same question. The spec had to interleave
 * its conditions every 400ms because it was measuring a live game whose draw
 * counts swing 30% between adjacent seconds; this harness draws a frozen scene
 * from a fixed clock, so it can interleave every FRAME and the two conditions
 * cannot drift apart at all.
 */
let blitSkipper: (() => boolean) | null = null;
let installed = false;
let saveDepth = 0;
let lastSource: unknown = null;
const sources = new Set<unknown>();

function bump(bag: Record<string, number>, key: string): void {
  bag[key] = (bag[key] ?? 0) + 1;
}

/**
 * Wrap the prototype once, for the life of the page.
 *
 * Once rather than per-probe because un-wrapping and re-wrapping would leave
 * the timed sweep running against a context whose prototype has been rewritten
 * a different number of times than the one the previous run used — a difference
 * the JIT can see even when the wrappers are inert. The wrappers check one
 * module-level nullable and return; `live === null` is the shipped path.
 */
function install(): void {
  if (installed) return;
  installed = true;
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;

  for (const name of METHODS) {
    const original = proto[name] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof original !== "function") continue;
    proto[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]): unknown {
      if (blitSkipper && name === "drawImage" && args.length === 3 &&
          args[1] === 0 && args[2] === 0) {
        const s = args[0] as { width?: number; height?: number };
        if (s.width === this.canvas.width && s.height === this.canvas.height && blitSkipper()) {
          return undefined;
        }
      }
      if (live) {
        bump(live.calls, name);
        if (name === "save") { saveDepth += 1; if (saveDepth > live.maxSaveDepth) live.maxSaveDepth = saveDepth; }
        else if (name === "restore") saveDepth = Math.max(0, saveDepth - 1);
        else if (name === "drawImage") {
          const src = args[0];
          if (src !== lastSource) { live.drawImageSwitches += 1; lastSource = src; }
          sources.add(src);
          // Destination extent, in the argument shape the caller used: the
          // 3-arg form takes the source's natural size, the 5- and 9-arg forms
          // name it. Converted to DEVICE px through the live CTM, because a
          // world-unit stamp and a device-unit one are the same call and very
          // different amounts of fill.
          let dw: number, dh: number;
          if (args.length >= 9) { dw = args[7] as number; dh = args[8] as number; }
          else if (args.length >= 5) { dw = args[3] as number; dh = args[4] as number; }
          else {
            const s = src as { width?: number; height?: number };
            dw = s.width ?? 0; dh = s.height ?? 0;
          }
          const m = this.getTransform();
          const area = Math.abs(dw * dh * (m.a * m.d - m.b * m.c));
          live.drawImageDeviceArea += area;
          const s = src as { width?: number; height?: number };
          if (args.length === 3 && args[1] === 0 && args[2] === 0 &&
              s.width === this.canvas.width && s.height === this.canvas.height) {
            live.fullCanvasBlitArea += area;
            live.fullCanvasBlits += 1;
          }
        }
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  for (const name of PROPS) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc?.set || !desc.get) continue;
    const { get, set } = desc;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: desc.enumerable,
      get,
      set(this: CanvasRenderingContext2D, value: unknown) {
        if (live) {
          bump(live.sets, name);
          // Identity, not deep equality: a gradient re-assigned is a different
          // object and genuinely new state, while a colour string re-assigned
          // is the same string and genuinely is not. `get` before `set` is what
          // makes this honest — canvas normalises what it stores ("#fff" comes
          // back "#ffffff"), so a naive "did the source literal change" test
          // would under-count redundant writes rather than over-count them.
          if (get.call(this) === value) bump(live.redundantSets, name);
        }
        set.call(this, value);
      },
    });
  }

  // Canvas creation is the sprite cache's own tell. document.createElement is
  // the one door makeSpriteCanvas and trimToInk both go through.
  const createElement = document.createElement.bind(document);
  document.createElement = function (tag: string, opts?: ElementCreationOptions): HTMLElement {
    if (live && typeof tag === "string" && tag.toLowerCase() === "canvas") live.canvasesCreated += 1;
    return createElement(tag, opts);
  } as typeof document.createElement;
}

/**
 * Arm (or disarm, with null) the background-blit skipper. The wrappers are
 * installed on first use and left in place, so arming costs one assignment and
 * the frames it governs are otherwise ordinary frames.
 */
export function setBlitSkipper(fn: (() => boolean) | null): void {
  install();
  blitSkipper = fn;
}

/** Begin counting. Everything drawn until `stop()` lands in one census. */
export function startCensus(): void {
  install();
  live = EMPTY();
  saveDepth = 0;
  lastSource = null;
  sources.clear();
}

/** End counting and hand back what happened, per frame. */
export function stopCensus(frames: number): DrawCensus {
  const out = live ?? EMPTY();
  live = null;
  out.frames = frames;
  out.drawImageSources = sources.size;
  sources.clear();
  return out;
}

/** Total method calls in a census — the headline "draw commands per frame". */
export function totalCalls(c: DrawCensus): number {
  return Object.values(c.calls).reduce((s, n) => s + n, 0);
}

/** Total property assignments — the headline "state changes per frame". */
export function totalSets(c: DrawCensus): number {
  return Object.values(c.sets).reduce((s, n) => s + n, 0);
}
