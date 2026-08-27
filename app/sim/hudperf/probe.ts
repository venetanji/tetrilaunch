/**
 * HUD-WRITE PROBE (browser half) — what does syncHud actually write to the DOM,
 * frame by frame?
 *
 * Injected into the SHIPPING page (index.html, the real main.ts) by run.ts, and
 * it drives the real App through the dev-only `window.__tl` handle. Nothing is
 * reimplemented here: the census below is the writes the game itself performs
 * while it plays.
 *
 * WHY MUTATION COUNTS RATHER THAN FRAME TIMES. This runs in a headless desktop
 * Chromium with a software rasteriser, so its milliseconds are not a phone's —
 * the same trap sim/renderperf's header warns about. What DOES transfer is the
 * count of DOM mutations the loop performs per frame, because that is the input
 * to the phone's style/layout/paint bill rather than a measurement of it. The
 * device evidence (docs/superpowers/specs/2026-08-27-background-layer-split-design.md)
 * put ~33fps of a CPH2573 frame in the HUD's per-frame repaint; the repaint is
 * caused by these mutations and by nothing else, so driving them to zero on
 * frames where nothing changed is the fix stated in units that survive the trip
 * between machines.
 *
 * THE OBSERVER CALLBACK HAS TO ACCUMULATE. A MutationObserver delivers its
 * queue to the callback as a microtask, so a later `takeRecords()` from a rAF
 * returns an empty array and the whole census reads zero. That mistake cost an
 * afternoon; the callback here concatenates and the rAF drains what it
 * collected, plus whatever `takeRecords()` still holds for the current
 * checkpoint.
 */

/** One node's share of a census window, keyed `<label> <kind>`. */
export type MutationTally = [string, number][];

export interface CensusOptions {
  /** Frames to observe (after the warm-up below). */
  frames: number;
  /** Fire whenever the cannon is loaded, which is what makes the reload bar,
   *  the belt and the economy readouts move. `false` measures an IDLE bay —
   *  the condition the "no state change writes nothing" pin is about. */
  fire: boolean;
  /** Still every CSS animation and transition on the page for the window.
   *
   *  An ATTRIBUTION arm, not a proposal. Once syncHud stops writing on quiet
   *  frames, whatever style recalculation is left is not syncHud's — the HUD
   *  is full of running keyframes (the crest's jiggle and sparks, the belt's
   *  chevrons, the danger pulses) and each of those recalculates style every
   *  frame whether or not a single byte of DOM changed. This arm says how much
   *  of the remainder that is, so the next measurement is aimed at the right
   *  thing. Nothing here proposes shipping with animations off; the game's
   *  reduced-motion story is a separate and deliberate one (app.css). */
  still?: boolean;
  /**
   * Restart the bay before the window, so this arm begins where a fresh bay
   * begins rather than where the last arm left off.
   *
   * REQUIRED OF ANY ARM WHOSE NUMBER IS COMPARED WITH ANOTHER'S, and the
   * attribution arm is the reason it exists. It used to run third, on the bay
   * the LIVE arm had just spent: seven shots fired, funds drained toward the
   * broke loss, the pile congested enough to put `.plant--congest-*` on the
   * panel and `.pl-stat--danger` on the launches chip — and those danger
   * classes carry `animation: pulse-danger`, which is the very thing the arm
   * claims to be measuring the absence of. So the arm was comparing a quiet
   * fresh bay against a loud spent one and attributing the whole gap to
   * `animation: none`. The probe's own freshness() already had to restart the
   * bay for the same reason and that should have been the tell.
   *
   * Every arm reports the state it actually started from (see `start` on the
   * result) so the comparison can be checked rather than trusted.
   */
  fresh?: boolean;
}

/**
 * What a census arm was looking at when it began counting.
 *
 * Everything here either changes what syncHud writes or changes which CSS
 * animations are running, which are the two things an arm-to-arm comparison
 * has to hold equal. Recorded per arm and asserted across the arms that are
 * compared, because "I restarted the bay" is an intention and this is the
 * evidence.
 */
export interface StartState {
  /** The App's screen. Anything but "playing" means syncHud is not running at
   *  all, which no arm can afford to discover halfway through. */
  state: string;
  score: number;
  shots: number;
  /** The panel's own state classes — congestion tier, maw, loaded material. */
  plant: string;
  /** The funds block's, which is where `.pl-stat--danger` (a running
   *  `pulse-danger`) and `.dial-collapse` land. */
  funds: string;
  /** The launches chip's, same reason. */
  launches: string;
  /** A run-end scrim over the bay is a whole second screen of animation. */
  scrim: boolean;
}

export interface CensusResult {
  frames: number;
  /** Mutation records observed anywhere under #overlay across the window. */
  mutations: number;
  /** Frames carrying at least one mutation. */
  dirtyFrames: number;
  /** Whole seconds the window spanned, so a 1Hz readout's share can be
   *  separated from a per-frame one's. */
  seconds: number;
  perNode: MutationTally;
  /** Every inline-style property name syncHud was seen to leave on a HUD node
   *  during the window, deduplicated. The split's whole rule is readable off
   *  this list: a per-frame write may name `transform` or `opacity`, which
   *  composite, and must never name a property the layout engine has to
   *  re-solve. Custom properties are included under their own names. */
  styleProps: string[];
  /** Frames on which the reload fill's inline style changed at all, and frames
   *  on which the cannon was actually mid-reload. The first over the second is
   *  "does the bar still move every frame it is supposed to". */
  loadMoved: number;
  loadReloading: number;
  shots: number;
  /** Where this arm started, for comparing arms against each other. */
  start: StartState;
}

export interface FreshnessResult {
  /** Frames between writing a new funds figure onto the Game and the readout
   *  showing it. 1 is "the very next frame"; anything higher is staleness. */
  framesToShow: number;
  shown: string | null;
}

interface HudProbeApi {
  /** Boot the page out of the menu and into a bay, once, before any arm runs.
   *
   *  Every arm restarts the bay for itself now, so this is no longer where the
   *  measured state comes from. It stays for two reasons: it makes the very
   *  first `startGame()` — the menu-to-playing one, the only transition that
   *  also mounts the HUD from nothing — happen OUTSIDE every arm's window, so
   *  all three arms' restarts are the same kind of restart; and a page that
   *  cannot reach "playing" at all fails here rather than halfway through a
   *  census. */
  start(): Promise<void>;
  /** Put the page into the condition an arm measures — a fresh bay, animations
   *  stilled — and settle it. Separate from `census` so the node half can read
   *  Chromium's counters AROUND the measurement window alone: a restart is a
   *  whole overlay rewrite and 60 frames of settling, and stilling the page is
   *  a full style recalc, so doing either inside the bracket would bill the arm
   *  for its own setup and flatten every ratio in the report. */
  prepare(opts: CensusOptions): Promise<void>;
  census(opts: CensusOptions): Promise<CensusResult>;
  /** Undo whatever `prepare` installed. */
  teardown(): Promise<void>;
  freshness(): Promise<FreshnessResult>;
}

declare global {
  interface Window {
    __hudperf: HudProbeApi;
    /** main.ts's dev-only handle on the live App. Deliberately loose: this
     *  probe reaches past `private` on purpose, and typing it properly would
     *  mean exporting the App class for a harness's benefit. */
    __tl: {
      state: string;
      overlay: HTMLElement;
      game: {
        score: number;
        shotsFired: number;
        paused: boolean;
        cannon: { reloadRatio(now: number): number };
        aimAt(t: { x: number; y: number }): number;
        shoot(now: number): boolean;
      } | null;
      startGame(): void;
      finishTutorial(): void;
    };
  }
}

/** rAF, once. */
const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

/** Wait n frames. Used as a warm-up: a freshly mounted HUD churns for a few
 *  frames (the coach's data-coach hook, the drag hint's entrance) and none of
 *  that is the steady state under test. */
async function settle(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await frame();
}

/** A short, stable name for a mutated node — its own id if it has one, else the
 *  nearest ancestor id plus this node's tag and first class. Ids are what the
 *  census is read by, since syncHud addresses everything by id. */
function label(n: Node): string {
  let el: Element | null = n.nodeType === 1 ? (n as Element) : n.parentElement;
  if (!el) return "?";
  const parts: string[] = [];
  for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/)[0]
        : "";
    parts.unshift(el.id ? "#" + el.id : el.tagName.toLowerCase() + cls);
    if (el.id) break;
  }
  return parts.join(">");
}

/**
 * Put the app on a fresh bay with the full panel showing, and let it settle.
 *
 * THE COACH HAS TO GO, and not as a convenience. A first-ever bay runs the
 * tutorial, and `.hud[data-coach="0"]` hides the reload row and the launches
 * chip outright (app.css's coach reveal) — so a census taken there would be
 * counting writes into a `display: none` subtree, which costs the layout engine
 * nothing and would flatter every number in the table. Every bay after the
 * player's first shows the full panel, and that is the panel the device
 * measurement was taken against.
 *
 * The 60-frame settle is the second half: a freshly mounted HUD churns for a
 * few frames (the coach hook coming off, the drag hint's entrance) and none of
 * that is the steady state under test.
 */
async function freshBay(): Promise<void> {
  const tl = window.__tl;
  tl.startGame();
  tl.finishTutorial();
  await settle(60);
}

/** The state an arm is about to measure from — see StartState. */
function readStart(): StartState {
  const tl = window.__tl;
  // getAttribute rather than `.className`: the crest ornaments under `.plant`
  // are `<i>` today but the panel has picked up inline SVG before, and an SVG
  // element's `className` is an SVGAnimatedString whose toString() is
  // "[object SVGAnimatedString]" — a value that compares equal across two arms
  // no matter what the classes actually are, which is the one failure mode a
  // pin built on this comparison must not have.
  const cls = (sel: string): string =>
    tl.overlay.querySelector(sel)?.getAttribute("class")?.trim() ?? "";
  return {
    state: tl.state,
    score: tl.game?.score ?? -1,
    shots: tl.game?.shotsFired ?? -1,
    plant: cls(".plant"),
    funds: cls(".pl-funds"),
    launches: cls("#hud-launches-chip"),
    scrim: tl.overlay.querySelector(".modal-scrim") !== null,
  };
}

/** The stylesheet the `still` arm installs, held so teardown can drop it. */
let stiller: HTMLStyleElement | null = null;

const api: HudProbeApi = {
  async start(): Promise<void> {
    await freshBay();
  },

  async prepare(opts: CensusOptions): Promise<void> {
    if (opts.fresh) await freshBay();
    if (opts.still) {
      // Idempotent: a second stiller left over from a skipped teardown would
      // still still the page, so the arm would pass while the report quietly
      // stopped describing what it ran.
      stiller?.remove();
      stiller = document.createElement("style");
      stiller.textContent = `*, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }`;
      document.head.appendChild(stiller);
      // Frames for the engine to tear the running animations down AND for the
      // full-page style recalc that installing this rule costs to land, so the
      // window measures the stilled page rather than the act of stilling it.
      await settle(30);
    }
  },

  async teardown(): Promise<void> {
    stiller?.remove();
    stiller = null;
    await settle(2);
  },

  async census(opts: CensusOptions): Promise<CensusResult> {
    const tl = window.__tl;
    const overlay = tl.overlay;
    const tally = new Map<string, number>();
    const styleProps = new Set<string>();

    // Read once the page is in whatever condition this arm is measuring, and
    // before a single frame is counted.
    const start = readStart();

    let pending: MutationRecord[] = [];
    const obs = new MutationObserver((recs) => {
      pending = pending.concat(recs);
    });
    obs.observe(overlay, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    let mutations = 0;
    let dirtyFrames = 0;
    let loadMoved = 0;
    let loadReloading = 0;
    // The fill is addressed by id and read through its INLINE style, which is
    // the thing syncHud writes — `width` before this branch, `transform`
    // after. Reading the cssText covers both without the probe having to know
    // which mechanism is in force.
    const loadFill = overlay.querySelector<HTMLElement>("#hud-load");
    let lastLoad = loadFill?.style.cssText ?? "";
    const t0 = performance.now();

    for (let i = 0; i < opts.frames; i++) {
      await frame();
      const recs = pending.concat(obs.takeRecords());
      pending = [];
      mutations += recs.length;
      if (recs.length) dirtyFrames++;
      for (const r of recs) {
        const kind = r.type === "attributes" ? `attr:${r.attributeName}` : r.type;
        const key = `${label(r.target)} ${kind}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
        if (r.type === "attributes" && r.attributeName === "style") {
          const s = (r.target as HTMLElement).style;
          for (let p = 0; p < s.length; p++) styleProps.add(s.item(p));
        }
      }
      const g = tl.game;
      if (g) {
        const ratio = g.cannon.reloadRatio(performance.now());
        if (ratio < 1) loadReloading++;
        if (opts.fire && ratio >= 1) {
          // A spread of targets across the bay rather than one, so the pile
          // grows the way a played bay's does and the economy readouts get
          // something to change about.
          g.aimAt({ x: 640 + (i % 9) * 45, y: 560 - (i % 5) * 30 });
          g.shoot(performance.now());
        }
      }
      const now = loadFill?.style.cssText ?? "";
      if (now !== lastLoad) loadMoved++;
      lastLoad = now;
    }
    obs.disconnect();

    return {
      frames: opts.frames,
      mutations,
      dirtyFrames,
      seconds: (performance.now() - t0) / 1000,
      perNode: [...tally.entries()].sort((a, b) => b[1] - a[1]),
      styleProps: [...styleProps].sort(),
      loadMoved,
      loadReloading,
      shots: tl.game?.shotsFired ?? 0,
      start,
    };
  },

  async freshness(): Promise<FreshnessResult> {
    const tl = window.__tl;
    // ALWAYS A FRESH BAY, on the same rule the census arms follow: the live arm
    // fires whenever the cannon is loaded and banks nothing, so it can leave
    // the bay broke — and a bay that has ended stops running syncHud at all,
    // which would read as a staleness this pin is not about. Unconditional
    // rather than `if (state !== "playing")`, because a bay that is still
    // technically playing but nearly spent is the same confound in a quieter
    // form, and because it leaves the order of the arms above free to change.
    await freshBay();
    const g = tl.game;
    // Re-queried after the possible restart above, since that rewrote the
    // overlay and the old node is detached.
    const el = tl.overlay.querySelector<HTMLElement>("#hud-score");
    if (!g || !el) return { framesToShow: -1, shown: null };
    // A funds figure nothing else in the bay can produce, so the readout
    // cannot be showing it already by coincidence.
    const paid = 987654;
    g.score = paid;
    const want = "$" + paid;
    for (let i = 1; i <= 16; i++) {
      await frame();
      if (el.textContent === want) return { framesToShow: i, shown: el.textContent };
    }
    return { framesToShow: 99, shown: el.textContent };
  },
};

window.__hudperf = api;
