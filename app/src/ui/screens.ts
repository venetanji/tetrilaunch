import { PIECE_COLORS, PIECE_TYPES } from "../game/theme";
import type { LossReason } from "../game/game";
import { LEVEL_1 } from "../game/level";
import { SCORE_PER_BAY, SCORE_PER_LINE } from "../game/run";
import {
  toggleHTML, pieceCellsHTML, formatMMSS, beltPieceHTML, beltBombHTML, runModsHTML, shipPlatesHTML,
} from "./components";
import { icon, type IconName } from "./icons";
import {
  MAX_TIER, UPGRADES, nextTierCost, tiersCost, type UpgradeTiers,
} from "../game/upgrades";
import {
  UNLOCKS, unlockAvailable, unlockGates, SALVAGE_PER_BAY, SALVAGE_PER_2_LINES,
  SALVAGE_RUN_COMPLETE_BONUS, SALVAGE_FLOOR, type MetaState,
} from "../game/meta";
import type { Settings } from "../lib/store";
import type { ScoreEntry } from "../lib/api";
import type { BeltPreview } from "../game/game";
import type { PieceSize, PieceType } from "../game/theme";
import type { ModDef } from "../game/mods";

export function splashScreen(): string {
  return `<div class="screen neon-backdrop">
    <div class="splash">
      <div class="eyebrow">Physics Cannon Puzzle</div>
      <h1 class="display neon-text brand-gradient">TETRILAUNCH</h1>
      <div class="loader"></div>
    </div>
  </div>`;
}

/** `store` is absent on web and on native builds without a RevenueCat key —
 *  the store entry point hides itself rather than offering a dead button. */
export function menuScreen(best: number, salvage = 0, store?: StoreState): string {
  return `<div class="screen neon-backdrop">
    <div class="menu">
      <div class="menu__brand">
        <div class="eyebrow">Physics Cannon Puzzle</div>
        <h1 class="menu__title display neon-text brand-gradient">TETRILAUNCH</h1>
        <p class="menu__sub">Load the cannon, arc your tetrominoes across the bay, and feed
        full rows into the compactor before it sweeps them away — across a 10-bay gauntlet
        run that drafts stranger modifiers onto your bankroll every stop.</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div class="chip" style="flex-direction:row;align-items:center;gap:10px">
            <div class="chip__label">Best</div>
            <div class="chip__value" style="color:var(--accent)">${best}</div>
          </div>
          <div class="chip" style="flex-direction:row;align-items:center;gap:10px">
            <div class="chip__label">Salvage</div>
            <div class="chip__value" style="color:var(--warn)">♻ ${salvage}</div>
          </div>
          ${store?.unlimited ? unlimitedBadgeHTML() : ""}
        </div>
      </div>
      <div class="menu__actions">
        <button class="btn btn--primary btn--lg btn--block" data-action="play">${icon("play")}Deep Run</button>
        <button class="btn btn--secondary btn--block" data-action="contracts">${icon("contracts")}Contracts</button>
        <button class="btn btn--secondary btn--block" data-action="workshop">${icon("workshop")}Workshop</button>
        <button class="btn btn--secondary btn--block" data-action="howto">${icon("howto")}How to Play</button>
        <button class="btn btn--secondary btn--block" data-action="leaderboard">${icon("leaderboard")}Leaderboard</button>
        ${
          store?.available && !store.unlimited
            ? `<button class="btn btn--secondary btn--block" data-action="paywall">${icon("star")}Unlock Unlimited</button>`
            : ""
        }
        <button class="btn btn--ghost btn--block" data-action="settings">${icon("settings")}Settings</button>
      </div>
    </div>
  </div>`;
}

/** Store/entitlement state passed down from the RevenueCat layer. */
export interface StoreState {
  /** SDK configured — i.e. native build with a key. */
  available: boolean;
  /** The `unlimited` entitlement is active. */
  unlimited: boolean;
}

function unlimitedBadgeHTML(): string {
  return `<div class="chip" style="flex-direction:row;align-items:center;gap:8px;max-width:190px">
    <div class="chip__value" style="color:var(--warn, #ffe500)">★ UNLIMITED</div>
  </div>`;
}

export function howtoScreen(): string {
  const steps = [
    ["01", "Aim & charge", `<b>Pull back</b> like a slingshot — the shot fires <b>opposite</b> your drag, and <b>distance sets the power</b>. Release to fire. On desktop use <span class="kbd">W</span><span class="kbd">S</span> to aim, <span class="kbd">A</span><span class="kbd">D</span> for power.`],
    ["02", "Rotate the piece", `Pieces turn in crisp <b>90° steps</b> — tap <span class="kbd">Q</span><span class="kbd">E</span> or the <span class="kbd">⟲</span>/<span class="kbd">⟳</span> buttons. The glowing piece at the cannon shows the exact orientation before you fire; the conveyor belt carries the piece coming <b>after</b> it.`],
    ["03", "Watch the arc", `The dotted parabola previews exactly where the piece flies. Pieces are joined by breakable joints — hard hits shatter them.`],
    ["04", "Fill the rows", `Land enough cubes in a row on the right of the compactor to complete a full straight line.`],
    ["05", "The compactor", `The red bar sweeps right, <b>shattering pieces into loose cubes</b> and compacting them. Cubes only vanish when they form a complete line — so don't let the stack reach the top.`],
    ["06", "Mind the bankroll", `Every launch costs <b>$${LEVEL_1.launchCost}</b>, and a full line pays out <b>$${LEVEL_1.scorePerLine}</b>. Reach <b>$${LEVEL_1.targetScore}</b> before the bankroll runs dry <b>or the clock hits zero</b>. Watch the <b>Launches</b> readout — it turns red at ${LOW_LAUNCH_WARN} or fewer, and that's when a shot has to count.`],
    ["07", "Three currencies", `<b>Funds ($)</b> pay for launches and are the bay's own target. <b>Scrap (♻)</b> is earned per line and spent on your ship at refit stops. <b>Salvage</b> is paid out at the end of <b>every</b> run — win or lose — and buys permanent unlocks in the Workshop.`],
    ["08", "Refit the rig", `The compactor is your ship. After bays <b>3, 6 and 9</b> you dock and spend scrap on six systems — a <b>wider bay</b>, <b>launcher coils</b> (more power and a wind stabilizer), <b>hydraulics</b>, <b>magazine</b>, <b>reactor</b>, <b>bond emitter</b>. Three tiers each; they last the whole run.`],
    ["09", "Run the gauntlet", `Ten bays deep, each with a rising target, a tighter clock and stiffer joints. Clear one and <b>draft a modifier</b> from three — it stacks for the rest of the run. Shipments come in three sizes: <b>micro</b> dominoes are cheap and precise but too light to press the pile flat, <b>bulk</b> pentominoes are rigid and heavy, and standard tetrominoes sit between. Go broke or run out the clock and the run ends there.`],
  ];
  return `<div class="screen neon-backdrop">
    <div class="howto">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div class="eyebrow">Briefing</div><h2 class="display" style="font-size:var(--fs-h1)">How to Play</h2></div>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>
      <div class="howto__grid">
        ${steps
          .map(
            ([n, t, p]) =>
              `<div class="panel step"><div class="step__n">${n}</div><b>${t}</b><p>${p}</p></div>`,
          )
          .join("")}
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px">
        ${PIECE_TYPES.map(
          (t) =>
            `<div class="panel" style="padding:8px;width:56px;height:56px">${pieceCellsHTML(
              t as PieceType,
            )}</div>`,
        ).join("")}
      </div>
      <button class="btn btn--primary btn--lg" data-action="play" style="align-self:center">▶ Start Run</button>
    </div>
  </div>`;
}

export function settingsScreen(s: Settings, store?: StoreState): string {
  return `<div class="screen neon-backdrop center">
    <div class="panel modal pop">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 class="display" style="font-size:var(--fs-h1)">Settings</h2>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>
      ${toggleHTML("sound", "Sound FX", "Launch, impact & line-clear cues", s.sound)}
      ${toggleHTML("music", "Music", "Ambient synth soundtrack", s.music)}
      ${toggleHTML("haptics", "Haptics", "Vibration feedback on mobile", s.haptics)}
      ${store?.available ? purchaseRowsHTML(store) : ""}
      <button class="btn btn--secondary" data-action="menu">Done</button>
    </div>
  </div>`;
}

/** Restore is always reachable (Apple requires it without a purchase first);
 *  Manage opens RevenueCat's Customer Center, which only makes sense once
 *  there's something to manage. */
function purchaseRowsHTML(store: StoreState): string {
  return `<div style="display:flex;gap:8px;flex-wrap:wrap">
    ${
      store.unlimited
        ? `<button class="btn btn--secondary" style="flex:1" data-action="customer-center">Manage Subscription</button>`
        : `<button class="btn btn--secondary" style="flex:1" data-action="paywall">★ Unlock Unlimited</button>`
    }
    <button class="btn btn--ghost" style="flex:1" data-action="restore" id="restore-btn">Restore Purchases</button>
  </div>`;
}

/** One rendered board line. `rank` is the player's TRUE standing, carried
 *  explicitly rather than derived from array position — the end modal shows a
 *  discontiguous slice, where the last row might be #23 sitting under #5.
 *  `gapBefore` marks that jump so it reads as a jump and not as #6. */
export interface BoardRow {
  entry: ScoreEntry;
  rank: number;
  gapBefore: boolean;
}

/** Every entry, ranked by position — the standalone Leaderboard screen. */
export function fullBoard(entries: ScoreEntry[]): BoardRow[] {
  return entries.map((entry, i) => ({ entry, rank: i + 1, gapBefore: false }));
}

/** The top 5, plus the player's own row when they placed outside it.
 *
 *  Six rows is a height the end modal can guarantee at 360px; ten is not, at
 *  any column width that also leaves room for the outcome. The full board stays
 *  one tap away on the Leaderboard screen.
 *
 *  Matching is by name, which is all a score carries — so a player sharing a
 *  name with a top-5 entry is treated as already shown. That is the same
 *  assumption `highlight` has always made. */
export function endBoard(entries: ScoreEntry[], name?: string): BoardRow[] {
  const top = entries.slice(0, END_BOARD_TOP).map((entry, i) => ({
    entry, rank: i + 1, gapBefore: false,
  }));
  if (!name) return top;
  const mineAt = entries.findIndex((e) => e.name === name);
  if (mineAt < 0 || mineAt < END_BOARD_TOP) return top;
  return [
    ...top,
    { entry: entries[mineAt], rank: mineAt + 1, gapBefore: mineAt > END_BOARD_TOP },
  ];
}

export const END_BOARD_TOP = 5;

export function leaderboardRowsHTML(rows: BoardRow[], highlight?: string): string {
  if (!rows.length) {
    return `<div class="muted" style="padding:20px;text-align:center">No scores yet — be the first!</div>`;
  }
  const medals = ["🥇", "🥈", "🥉"];
  return `<div class="lb">${rows
    .map(({ entry: e, rank, gapBefore }) => {
      const me = highlight && e.name === highlight;
      return `${gapBefore ? `<div class="lb__gap" aria-hidden="true">⋯</div>` : ""}
      <div class="lb__row${me ? " lb__row--me" : ""}">
        <span class="lb__rank">${medals[rank - 1] ?? rank}</span>
        <span class="lb__name">${e.name}</span>
        <span class="lb__lines">${e.lines} lines</span>
        <span class="lb__score">${e.score}</span>
      </div>`;
    })
    .join("")}</div>`;
}

export function leaderboardScreen(rows: string): string {
  return `<div class="screen neon-backdrop center">
    <div class="panel modal pop" style="width:min(560px,94vw)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="text-align:left"><div class="eyebrow">Launch Bay</div>
        <h2 class="display" style="font-size:var(--fs-h1)">Leaderboard</h2></div>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>
      <div id="lb-body">${rows}</div>
      <button class="btn btn--primary" data-action="play">▶ Play</button>
    </div>
  </div>`;
}

/**
 * In-game HUD overlay — 1d "recycling-plant" layout, restructured around a
 * clear INFORMATION HIERARCHY. The old plant readout gave funds/target a huge
 * figure and then buried three equally-weighted small facts under it (combo,
 * launch cost, launches left), which meant the two numbers that actually decide
 * a shot — "can I still afford to shoot" and "is the cannon loaded" — read as
 * footnotes. The tiers now are:
 *
 *   1. FUNDS / TARGET + goal bar   the bay objective. Biggest thing on screen.
 *   2. LAUNCHES LEFT               how many shots the bankroll still buys.
 *      Its own column, mono, large — and it goes DANGER-RED and pulses at
 *      LOW_LAUNCH_WARN (3) or fewer, because that's the threshold where the
 *      correct play changes from "keep feeding the bay" to "this shot has to
 *      count". A number that changes your strategy deserves to change color.
 *   3. TIME                        equal-weight column beside it, already had
 *      its own red-pulse at 20s.
 *   4. RELOAD                      a bar under the readout tracking the launch
 *      cooldown, so "why didn't it fire" is answerable without guessing. The
 *      canvas draws the same value as a ring around the cannon muzzle (see
 *      render.ts's drawReloadRing) — that one is for mid-aim focus, this one is
 *      for peripheral vision.
 *   5. combo / launch cost         demoted to the small meta line.
 *   6. run mods + ship plates      the build, bottom row.
 *
 * `bayNum` is the 1-based bay currently playing (out of RUN_LEVELS);
 * `timeLimitSec` gates whether a Time readout renders at all (0 = no limit);
 * `timeLeftMs`/`pieceSize`/`beltPreview` seed the initial render so it matches
 * whatever main.ts's syncHud takes over from frame 2. `modIds` is the run's
 * drafted-mod pick history and `tiers` its bought ship upgrades (see
 * game/run.ts's RunState) — both rendered as chips/plates in the plant panel.
 *
 * Every button lives in one same-width column in the letterbox gutter OUTSIDE
 * the field's right wall — or, on aspect ratios with no usable side gutter, in
 * a reserved band or a horizontal bottom bar (see game/layout.ts and app.css's
 * .side-rail / [data-layout] rules). Two hydraulic pistons "driving" the
 * compactor are canvas-drawn (render.ts's drawPistons) since they track the
 * compactor's live x every frame; this file only owns the DOM chrome.
 */
/** Launches-left threshold at which the readout turns danger-red and pulses. */
export const LOW_LAUNCH_WARN = 3;

export function hudHTML(opts: {
  /** What rides the belt: the shot AFTER the muzzle's (see game.ts's
   *  Game.beltPreview). */
  beltPreview: BeltPreview;
  target: number;
  score: number;
  /** Cost per launch this bay — shown in the plant readout together with how
   *  many launches the current funds afford (#hud-launches, live-synced). */
  launchCost: number;
  bayNum: number;
  timeLimitSec: number;
  timeLeftMs: number;
  pieceSize: PieceSize;
  /** Whether this bay's run has the Bond Breaker ability drafted — shows its
   *  glowing chip in the plant's ability row (see main.ts / game.ts's
   *  useBondBreaker). */
  bondBreakerOwned: boolean;
  /** Charges left this bay, shown on the chip. */
  bondCharges: number;
  /** Whether Demolition Charges were drafted, and how many are left — same
   *  two-trigger treatment as Bond Breaker (see the ability note below). */
  demoOwned: boolean;
  /** True when this bay has the Autoloader (level.autoLaunchMs > 0). Adds a
   *  HELD trigger to the rail — the rig no longer fires on its own. */
  autoloaderOwned: boolean;
  bombCharges: number;
  /** The run's full drafted-mod pick history, in pick order — rendered as
   *  chips in the plant panel (see components.ts's runModsHTML). */
  modIds: string[];
  /** The run's bought ship upgrade tiers — rendered as tier-pip plates
   *  (components.ts's shipPlatesHTML). */
  tiers: UpgradeTiers;
  /** Present only in CONTRACT mode. A Contract has no bankroll and no clock, so
   *  the funds/launches readout would show $0 and 0 launches forever; this
   *  swaps in the two numbers that actually govern it — lines toward the goal,
   *  and whichever supply limit the Contract runs on.
   *
   *  On a PATTERN Contract that limit is the shipment queue, and `remaining`
   *  carries the whole rest of it rather than just a count: planning against
   *  the full set is the mode, so showing only "4 left" would hide the part
   *  the player is actually reasoning about. */
  contract?: {
    name: string;
    kind: "lines" | "pattern";
    goal: number;
    lines: number;
    launchesLeft: number;
    remaining: PieceType[];
  } | null;
}): string {
  const {
    beltPreview, target, score, launchCost, bayNum, timeLimitSec, timeLeftMs,
    pieceSize, bondBreakerOwned, bondCharges, demoOwned, bombCharges, autoloaderOwned, modIds, tiers,
    contract,
  } = opts;
  // An empty belt is the honest render for the last shipment of a finite queue
  // — there IS no next piece, and drawing one would promise a shot that never
  // comes (see game.ts's BeltPreview.empty).
  const beltNextHTML = beltPreview.bomb
    ? beltBombHTML()
    : beltPreview.empty
      ? ""
      : beltPieceHTML(beltPreview.type, beltPreview.quarterTurns, pieceSize);
  const launches = Math.floor(score / Math.max(1, launchCost));
  const timeBlock =
    timeLimitSec > 0
      ? `<div class="pl-stat pl-time" id="hud-time-chip"><div class="lbl">Time</div><div class="v" id="hud-time">${formatMMSS(timeLeftMs)}</div></div>`
      : "";
  // ABILITIES (Bond Breaker, Demolition Charges) each get TWO triggers on
  // screen at once when drafted — a chip in the plant's ability row and a
  // dedicated icon button in the touch rail (the rail is the PRIMARY mobile
  // control: there's no keyboard on a touchscreen). Both share per-ability
  // classes that main.ts's syncHud updates together, so neither can drift out
  // of sync with the live charge count.
  const bondChip = bondBreakerOwned
    ? `<button class="mod mod--bb bond-trigger" data-game="bond" id="bond-chip" aria-label="Bond Breaker — shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>
        <span class="g">⚡</span><span class="nm">BOND BRK</span><span class="stk">×<span class="bond-trigger__count">${bondCharges}</span></span><span class="key">B</span>
      </button>`
    : "";
  const bondRailBtn = bondBreakerOwned
    ? `<button class="icon-btn bond-btn bond-trigger" data-game="bond" id="bond-btn" aria-label="Bond Breaker — shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>⚡<span class="bond-btn__count bond-trigger__count">${bondCharges}</span></button>`
    : "";
  const demoChip = demoOwned
    ? `<button class="mod mod--demo demo-trigger" data-game="demo" id="demo-chip" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>
        <span class="g">💥</span><span class="nm">DEMO</span><span class="stk">×<span class="demo-trigger__count">${bombCharges}</span></span><span class="key">X</span>
      </button>`
    : "";
  const demoRailBtn = demoOwned
    ? `<button class="icon-btn demo-btn demo-trigger" data-game="demo" id="demo-btn" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>💥<span class="demo-btn__count demo-trigger__count">${bombCharges}</span></button>`
    : "";
  // Held, not tapped: pointerdown starts the burst and pointerup ends it (see
  // main.ts's onGamePointerDown). Sits at the BOTTOM of the rail, nearest a
  // right thumb at rest, because it is the only rail control meant to be held
  // through a whole compactor window rather than jabbed.
  const autoRailBtn = autoloaderOwned
    ? `<button class="icon-btn auto-btn" data-game="auto" id="auto-btn" aria-label="Autoloader — hold to fire">${icon("launcher", 17)}<span class="auto-btn__key">F</span></button>`
    : "";
  const plates = shipPlatesHTML(tiers);
  return `<div class="hud" id="hud">
    <!-- button rail: ONE same-width column of at most seven buttons —
         fullscreen, pause, rotate CCW/CW, Bond Breaker + Demolition (if
         drafted), and the aim-state cancel ✕. Where it SITS is decided by the
         layout solver (game/layout.ts): centered in the right letterbox gutter
         when one is wide enough, in a reserved right band on near-16:9
         viewports where there is no natural gutter, or as a horizontal strip in
         the bottom band on tablet-ish aspects (see app.css's [data-layout]
         rules). There's no keyboard on mobile, so this rail IS the touch
         control surface. The ✕ is only visible mid-drag (main.ts's syncHud
         toggles .hud--aiming) but its slot is always reserved so appearing
         never shifts the other buttons under a hovering thumb; a second finger
         taps it to abort the queued launch. Rotate taps mid-drag do NOT cancel
         (see input.ts). Desktop hides the game buttons and uses Q/E + B/X
         instead (see the @media (pointer: fine) rule in app.css), per the
         kbd-hint strip down in .hud__bottom. -->
    <div class="side-rail">
      <button class="icon-btn" id="fullscreen-btn" data-action="fullscreen" aria-label="Fullscreen">⛶</button>
      <button class="icon-btn" data-action="pause" aria-label="Pause">⏸</button>
      <button class="icon-btn rotate-btn" data-game="rotl" aria-label="Rotate left">⟲</button>
      <button class="icon-btn rotate-btn" data-game="rotr" aria-label="Rotate right">⟳</button>
      ${bondRailBtn}
      ${demoRailBtn}
      ${autoRailBtn}
      <button class="icon-btn cancel-aim-btn" data-game="cancel" aria-label="Cancel launch">✕</button>
    </div>

    <!-- conveyor belt: the piece that fires AFTER the loaded one rides in
         from the top-left and feeds the cannon (see components.ts's
         beltPieceHTML/beltBombHTML — the real queued piece's shape/colors,
         not a mockup stand-in). -->
    <div class="belt" aria-label="Next piece">
      <div class="belt__track"><div class="belt__tread"></div><span class="belt__arrows">▸ ▸ ▸ ▸</span></div>
      <div class="belt__roller belt__roller--l"></div>
      <div class="belt__roller belt__roller--r"></div>
      <span class="belt__lbl">◂ NEXT</span>
      <div class="belt-piece" id="hud-next">${beltNextHTML}</div>
    </div>

    <!-- the RECYCLING PLANT: PWR bar, the readout tiers described above, and
         the run's build (drafted mods, ship plates, abilities). -->
    <div class="plant">
      <div class="pl-pwr"><span class="lbl">PWR</span>
        <div class="pl-pwr__track"><div class="pl-pwr__fill" id="hud-power"></div></div>
        <span class="pl-pwr__val" id="hud-power-val">0%</span>
      </div>
      <div class="plant__body">
        <div class="plant__hdr">
          <div class="plant__title"><b>◊</b> Recycling Plant <span class="plant__bay">· ${
            contract ? contract.name : `Bay ${bayNum}/10`
          }</span></div>
          <div class="plant__rivets"><i></i><i></i><i></i></div>
        </div>
        <div class="pl-read">
          ${
            contract
              ? `<div class="pl-funds">
            <div class="lbl">Lines / Goal</div>
            <div class="v"><span id="hud-score">${contract.lines}</span> <span class="tgt">/ ${contract.goal}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="width:0%"></i></div>
          </div>
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">${contract.kind === "pattern" ? "Shipments" : "Launches"}</div>
            <div class="v" id="hud-launches">${contract.launchesLeft}</div>
          </div>`
              : `<div class="pl-funds">
            <div class="lbl">Funds / Target</div>
            <div class="v"><span id="hud-score">$${score}</span> <span class="tgt">/ ${target}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="width:0%"></i></div>
          </div>
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">Launches</div>
            <div class="v" id="hud-launches">${launches}</div>
          </div>`
          }
          ${timeBlock}
        </div>
        <!-- Reload: fills as the launch cooldown runs down (see
             cannon.reloadRatio). Goes .ready the instant the cannon can fire
             again, which is the only state change that matters here. -->
        <div class="pl-load" id="hud-load-row">
          <span class="lbl">Reload</span>
          <div class="pl-load__track"><i id="hud-load" style="width:100%"></i></div>
        </div>
        <div class="pl-meta">
          <span>Combo <b id="hud-combo">×0</b></span>
          <span class="pl-meta__sep">·</span>
          ${
            contract?.kind === "pattern"
              ? `<span>Left <b id="hud-queue">${queueTallyHTML(contract.remaining)}</b></span>`
              : `<span>Launch $${launchCost}</span>`
          }
          <span class="pl-meta__sep">·</span>
          <span>Scrap <b id="hud-scrap">0</b></span>
        </div>
        <!-- Build row: ABILITY chips first, then ship plates, then passive mods.
             The row scrolls horizontally (a full run drafts more than fits), so
             whatever is last gets cut off first — and the ability chips are the
             only TAPPABLE things in here. Leading with them keeps the controls
             reachable however long the build gets; a passive mod scrolling out
             of view costs nothing but a glance. -->
        <div class="pl-mods" id="hud-mods">
          <span class="lbl">Build</span>
          ${bondChip}
          ${demoChip}
          ${plates}
          ${runModsHTML(modIds)}
        </div>
      </div>
    </div>

    <div class="hud__bottom">
      <div class="kbd-hint" aria-hidden="true">
        <span class="kbd">Q</span>/<span class="kbd">E</span> rotate
        <span class="kbd-hint__sep">·</span>
        <span class="kbd">W</span>/<span class="kbd">S</span> aim
        <span class="kbd-hint__sep">·</span>
        <span class="kbd">A</span>/<span class="kbd">D</span> power
        <span class="kbd-hint__sep">·</span>
        <span class="kbd">Space</span> fire
        ${bondBreakerOwned ? '<span class="kbd-hint__sep">·</span><span class="kbd">B</span> break bonds' : ""}
        ${demoOwned ? '<span class="kbd-hint__sep">·</span><span class="kbd">X</span> arm charge' : ""}
        ${autoloaderOwned ? '<span class="kbd-hint__sep">·</span><span class="kbd">F</span> hold to autofire' : ""}
        <span class="kbd-hint__sep">·</span>
        drag to aim
      </div>
    </div>
    <!-- Settle banner: shown while the bay's funding target is met and the
         field is still coming to rest (game.ts's Game.settling). Reassures the
         player that the frozen-looking cannon is intentional and their last
         shots still count. main.ts toggles .show. -->
    <div class="settle-note" id="settle-note" aria-live="polite">
      <span class="settle-note__dot"></span> Target met — letting the bay settle
    </div>
    ${dragHintHTML()}
  </div>`;
}

/** First-play / idle-timeout onboarding overlay teaching the slingshot drag
 *  — a neon finger-dot presses near the cannon (left ~25% of screen,
 *  vertical center), drags back along a curve while a ghost pull-back arc
 *  grows, then releases, looping with a pause between loops. Rendered
 *  hidden by default (`drag-hint--hidden`); main.ts's armDragHint/
 *  dismissDragHint toggle that class based on the persisted
 *  settings.seenDragHint flag and a 15s once-per-session idle timer (see
 *  main.ts). Pure CSS animation — see tokens.css's --hint-* tokens and
 *  app.css's hint-dot/hint-arc keyframes. Touch-only (hidden on fine
 *  pointers via CSS), pointer-events:none throughout so it never blocks the
 *  drag-anywhere aim gesture. */
export function dragHintHTML(): string {
  return `<div class="drag-hint drag-hint--hidden" id="drag-hint" aria-hidden="true">
    <svg class="drag-hint__arc" viewBox="0 0 160 160" width="160" height="160">
      <path d="M89,77 Q52,112 49,133" />
    </svg>
    <div class="drag-hint__dot"></div>
  </div>`;
}

/**
 * BAY CLEARED celebration — the beat between "the money landed" and "here are
 * your cards". Plays over the settled (not frozen-mid-flight) field, on top of
 * the canvas bayclear sweep FX (see render.ts's drawBayClearFx), then main.ts
 * advances to the refit/draft after BAY_CLEAR_MS — or immediately on a tap, so
 * a player who has seen it fifty times is never held up.
 *
 * Why this exists: the bay used to end the instant funds crossed the target,
 * mid-flight, with the draft modal appearing over pieces still in the air. The
 * player never got to see the line that won it pay out. Now the bay settles
 * (game.ts's resolveWin) and then explicitly celebrates.
 */
export const BAY_CLEAR_MS = 1700;

export function bayClearScreen(opts: {
  bayNum: number;
  bayName: string;
  funds: number;
  target: number;
  lines: number;
  scrap: number;
}): string {
  return `<div class="bayclear" id="bayclear" data-action="skip-bayclear">
    <div class="bayclear__rays" aria-hidden="true"></div>
    <div class="bayclear__card">
      <div class="eyebrow">Bay ${opts.bayNum} · ${opts.bayName}</div>
      <h2 class="bayclear__title display">BAY CLEARED</h2>
      <div class="bayclear__stats">
        <div class="stat"><b style="color:var(--accent)">$${opts.funds}</b><span>banked / ${opts.target}</span></div>
        <div class="stat"><b>${opts.lines}</b><span>lines</span></div>
        <div class="stat"><b style="color:var(--warn)">♻ ${opts.scrap}</b><span>scrap</span></div>
      </div>
      <p class="muted bayclear__hint">tap to continue</p>
    </div>
  </div>`;
}

/**
 * REFIT STOP — the FTL layer's shop, opened after every third bay (see
 * run.ts's isRefitBay). Six systems, three tiers each, priced in scrap. Every
 * track is always fully visible with its whole tier ladder spelled out, which
 * is deliberately the OPPOSITE of the mod draft: a draft is a hand you were
 * dealt, a refit is a plan you commit to, so the player needs to see the
 * long-term shape of each track to plan toward one.
 *
 * Cards stay mounted after a purchase (main.ts re-renders in place) so buying
 * tier 1 and immediately seeing tier 2's price is one continuous read.
 */
export function refitScreen(opts: {
  bayNum: number;
  nextBayName: string;
  scrap: number;
  tiers: UpgradeTiers;
}): string {
  const cards = UPGRADES.map((u) => {
    const tier = Math.min(MAX_TIER, opts.tiers[u.id] ?? 0);
    const cost = nextTierCost(tier);
    const affordable = cost !== null && opts.scrap >= cost;
    const pips = Array.from({ length: MAX_TIER }, (_, i) =>
      `<i class="${i < tier ? "on" : ""}"></i>`,
    ).join("");
    // The button carries the whole purchase: which way the number moves, by how
    // much, and what it costs. Previously it said only "♻ 120", so the price
    // was on the button and the thing being bought was three lines above it.
    const step = cost === null ? null : u.step(tier);
    const btn =
      cost === null || step === null
        ? `<span class="refit-card__max">MAX</span>`
        : `<button class="btn btn--primary refit-card__buy" data-action="buy-upgrade" data-upgrade="${u.id}"${affordable ? "" : " disabled"}>
            <span class="refit-card__arrow refit-card__arrow--${step.dir}">${icon(step.dir, 10)}</span>
            <span class="refit-card__delta">${step.text}</span>
            <span class="refit-card__price">♻ ${cost}</span>
          </button>`;
    // One line, and it states what the ship HAS rather than what a purchase
    // would add. The full three-line ladder cost 43px per card and six of them
    // overflowed the grid by 145px on a 360px-tall phone; two of those lines
    // described purchases the player could not make yet. The pips carry
    // progress, the button carries the change, and the ladder survives in
    // `title` for where hover exists.
    const now = `<div class="refit-card__now">${u.current(tier)}</div>`;
    const ladder = u.tiers.map((t, i) => `T${i + 1} ${t}`).join(" · ");
    return `<div class="refit-card${tier > 0 ? " refit-card--owned" : ""}" title="${u.name} — ${ladder}">
      <div class="refit-card__hdr">
        <span class="refit-card__glyph">${icon(u.id as IconName, 15)}</span>
        <span class="refit-card__name">${u.name}</span>
        <span class="refit-card__pips">${pips}</span>
      </div>
      <p class="refit-card__blurb">${u.blurb}</p>
      <div class="refit-card__tiers">${now}</div>
      <div class="refit-card__foot">${btn}</div>
    </div>`;
  }).join("");

  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--refit pop" style="width:min(900px,96vw)">
      <div class="refit__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Refit stop · after bay ${opts.bayNum}</div>
          <h2 class="display">Yard &amp; Dry Dock</h2>
          <p class="muted" style="margin:0">The compactor rig is your ship. Spend scrap; it lasts the run. Next up: ${opts.nextBayName}.</p>
        </div>
        <div class="chip refit__scrap">
          <div class="chip__label">Scrap</div>
          <div class="chip__value" style="color:var(--warn)" id="refit-scrap">♻ ${opts.scrap}</div>
        </div>
      </div>
      <div class="refit__grid" id="refit-grid">${cards}</div>
      <button class="btn btn--primary" data-action="refit-done">Undock →</button>
    </div>
  </div>`;
}

/**
 * WORKSHOP — the meta layer, reached from the main menu between runs. Spends
 * SALVAGE (earned by every finished run, won or lost — see meta.ts's
 * salvageForRun) on permanent unlocks.
 *
 * Note what these buy: an unlock adds an OPTION (a new modifier enters the
 * draft pool, a new consumable exists, the wind gets surveyed) rather than a
 * flat stat bump. That's the design constraint that keeps a veteran's run
 * harder-won than a beginner's rather than merely bigger-numbered, while still
 * making a run that died in bay 3 worth having played.
 */
/**
 * The Workshop.
 *
 * OWNED UNLOCKS DO NOT GET A CARD. They collapse into one compact strip, and
 * that is a deliberate inversion of what this screen used to do. It is a shop:
 * what you already own is reference, what you can buy is the merchandise, and
 * giving both the same 209px card meant the screen grew as the player
 * progressed — exactly backwards, and by eleven unlocks it was four screens of
 * scrolling on a landscape phone. Collapsing owned entries makes the Workshop
 * get SHORTER the further in you are, and puts the decision you actually came
 * here to make at the top.
 */
export function workshopScreen(meta: MetaState): string {
  // Marks BEATEN. `meta.mark` verbatim, and deliberately not markUnlocked() -
  // main.ts's onBuyUnlock enforces the gate against this same field, so any
  // derivation here would risk offering a button the purchase path refuses.
  const mark = meta.mark;
  const owned = UNLOCKS.filter((u) => meta.unlocks.includes(u.id));
  const forSale = UNLOCKS.filter((u) => !meta.unlocks.includes(u.id))
    .sort((a, b) => a.rank - b.rank || a.cost - b.cost);

  const cards = forSale
    .map((u) => {
      const available = unlockAvailable(u, meta.unlocks, mark);
      const affordable = meta.salvage >= u.cost;
      const gates = unlockGates(u, meta.unlocks, mark);
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-unlock" data-unlock="${u.id}"${affordable ? "" : " disabled"}>♻ ${u.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__name">${u.name}</div>
      <p class="shop-card__desc">${u.desc}</p>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
    })
    .join("");

  const ownedStrip = owned.length
    ? `<div class="workshop__owned">
        <span class="workshop__owned-label">✓ Owned</span>
        ${owned.map((u) => `<span class="workshop__owned-item">${u.name}</span>`).join("")}
      </div>`
    : "";

  const done = !forSale.length;

  return `<div class="screen screen--fit neon-backdrop">
    <div class="workshop">
      <div class="workshop__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Between runs</div>
          <h2 class="display" style="font-size:var(--fs-h1)">Workshop</h2>
          <p class="muted workshop__blurb" style="margin:0">Every run pays salvage — even the ones that end badly. Spend it on options you didn't have before.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="chip" style="flex-direction:row;align-items:center;gap:10px">
            <div class="chip__label">Salvage</div>
            <div class="chip__value" style="color:var(--warn)">♻ ${meta.salvage}</div>
          </div>
          <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
        </div>
      </div>
      <div class="workshop__meta muted">${meta.runs} run${meta.runs === 1 ? "" : "s"} logged · deepest bay ${meta.bestBay || "—"}</div>
      ${ownedStrip}
      ${done
        ? `<p class="muted" style="margin:0">Every option unlocked. Salvage now rides along for the next thing built.</p>`
        : `<div class="workshop__grid">${cards}</div>`}
      <button class="btn btn--primary btn--lg" data-action="play" style="align-self:center">${icon("play")}Start Run</button>
    </div>
  </div>`;
}

export function pauseModal(): string {
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal pop">
      <div class="eyebrow">Paused</div>
      <h2 class="display">Take a breath</h2>
      <div class="row">
        <button class="btn btn--primary" data-action="resume">Resume</button>
        <button class="btn btn--secondary" data-action="fullscreen" id="fullscreen-btn-modal">⛶ <span class="fs-label">Fullscreen</span></button>
        <button class="btn btn--secondary" data-action="restart-bay">Restart Bay</button>
        <button class="btn btn--ghost" data-action="menu">Quit</button>
      </div>
    </div>
  </div>`;
}

/**
 * Draft modal shown between bays: freezes the just-cleared field behind a
 * scrim and offers a choice of 2 modifiers — 3 once the player has cleared
 * DRAFT_THIRD_SLOT_CONTRACTS dailies (meta.ts's draftSlots), and fewer late in
 * a run once the non-stackable pool thins out. Render whatever `offers` holds.
 *
 * The heading says "modifier", not "contract". It used to say the latter, which
 * was harmless flavour until Contracts became an actual mode — at which point a
 * draft card titled "Choose your contract" sitting above copy that reads "Clear
 * 5 Contracts" was naming two unrelated things the same way. Picking
 * a card or skipping both hand off to main.ts's "pick-mod"/"skip-mod"
 * actions, which advance the run and start the next bay.
 */
export function draftScreen(opts: {
  bayNum: number;
  bayName: string;
  nextBayName: string;
  funds: number;
  /** Overshoot above this bay's target (0 if it ended right at target) —
   *  the only part of `funds` that actually carries into the next bay's
   *  float (see run.ts's advanceRun). */
  carry: number;
  offers: ModDef[];
  owned: ModDef[];
  /** Unspent scrap — shown here too (not only at refit stops) so the player can
   *  see capital accumulating between stops and plan the next refit. */
  scrap: number;
  /** Bay-CLEARS until the next refit stop (1 = clearing the next bay docks
   *  you), or null when no stop remains this run. */
  baysToRefit: number | null;
  /** Daily Contracts cleared, and how many earn the third draft card. Drawn as
   *  an empty slot rather than left out: two cards with no explanation reads as
   *  the game having run out of modifiers, which is what actually happens late
   *  in a run — the locked slot says this one is earnable. Omit to draw no
   *  slot at all (the late-run case, where the pool really is exhausted). */
  contractsCleared?: number;
  contractsForThirdSlot?: number;
}): string {
  const cards = opts.offers
    .map(
      (m) => `<button class="mod-card mod-card--${m.kind}" data-action="pick-mod" data-mod="${m.id}">
        <div class="mod-card__kind">${m.kind}</div>
        <div class="mod-card__name">${m.name}</div>
        <p class="mod-card__desc">${m.desc}</p>
      </button>`,
    )
    .join("");
  // The locked third slot, shown only while it is still earnable AND the pool
  // could actually fill it — a run that has exhausted its modifiers is short of
  // cards for a different reason, and promising a third one there would lie.
  const need = opts.contractsForThirdSlot ?? 0;
  const have = opts.contractsCleared ?? 0;
  const lockedSlot = need > 0 && have < need && opts.offers.length >= 2
    ? `<div class="mod-card mod-card--locked">
        <div class="mod-card__kind">locked</div>
        <div class="mod-card__name">Third pick</div>
        <p class="mod-card__desc">Clear ${need} Contracts to draft from three. ${have}/${need} done.</p>
      </div>`
    : "";
  const ownedRow = opts.owned.length
    ? `<div class="run-mods"><span>Run modifiers:</span>${opts.owned
        .map((m) => `<span class="run-mods__chip">${m.name}</span>`)
        .join("")}</div>`
    : "";
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(760px,94vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared — ${opts.bayName}</div>
      <h2 class="display">Choose a modifier</h2>
      <p class="muted" style="margin-top:-8px">Next up: ${opts.nextBayName}</p>
      <div class="draft__bank">
        <div class="chip chip--accent" style="flex-direction:row;align-items:center;gap:10px">
          <div class="chip__label">Ended $${opts.funds} — carries</div>
          <div class="chip__value">$${opts.carry}</div>
        </div>
        <div class="chip" style="flex-direction:row;align-items:center;gap:10px">
          <div class="chip__label">Scrap${
            opts.baysToRefit === null
              ? ""
              : opts.baysToRefit === 1
                ? " — refit next bay"
                : ` — refit in ${opts.baysToRefit} bays`
          }</div>
          <div class="chip__value" style="color:var(--warn)">♻ ${opts.scrap}</div>
        </div>
      </div>
      <div class="draft__cards">${cards ? cards + lockedSlot : `<p class="muted">No modifiers left to draft — onward.</p>`}</div>
      ${ownedRow}
      <button class="btn btn--ghost" data-action="skip-mod">Skip — no modifier</button>
    </div>
  </div>`;
}

/**
 * Full-screen animated backdrop for the two "economic" losses — pure CSS
 * (app.css's .lose-fx rules), pointer-events: none, rendered inside the
 * scrim BEHIND the modal panel. "time": a giant draining clock ring with a
 * fast-spinning hand that stops at 12. "broke": a rain of tumbling $ coins.
 * Topout keeps the plain scrim — the pile hitting the ceiling is its own
 * visual. Coin spread/delays are inline per-coin (a fixed multiplicative
 * scatter, no randomness) so the rain fills the screen from frame one.
 */
function loseFxHTML(reason: LossReason): string {
  if (reason === "time") {
    return `<div class="lose-fx lose-fx--time" aria-hidden="true">
      <div class="lose-fx__vignette"></div>
      <svg class="lose-fx__clock" viewBox="0 0 100 100">
        <circle class="ring" cx="50" cy="50" r="44"/>
        <line class="hand" x1="50" y1="50" x2="50" y2="14"/>
      </svg>
    </div>`;
  }
  if (reason === "broke") {
    const coins = Array.from({ length: 16 }, (_, i) => {
      const left = (i * 137) % 100;
      const delay = ((i * 73) % 26) / 10;
      const dur = 2.2 + (i % 5) * 0.35;
      const size = 20 + (i % 3) * 9;
      return `<span class="lose-fx__coin" style="left:${left}%;font-size:${size}px;animation-duration:${dur}s;animation-delay:-${delay}s">$</span>`;
    }).join("");
    return `<div class="lose-fx lose-fx--broke" aria-hidden="true">
      <div class="lose-fx__vignette"></div>${coins}</div>`;
  }
  return "";
}

export function endModal(opts: {
  won: boolean;
  /** Composite final run score (run.ts's finalRunScore) — bays + lines +
   *  leftover funds, NOT the raw ending bankroll. */
  score: number;
  lines: number;
  /** Bays fully cleared (0 if the run died in bay 1) — the ×SCORE_PER_BAY
   *  term in the breakdown line. */
  baysCleared: number;
  /** Funds in hand when the run ended — the tie-breaker term. */
  funds: number;
  best: number;
  name: string;
  rows: string;
  /** Why the run ended in a loss ("topout" keeps the classic path). Unused when won. */
  reason?: LossReason | null;
  /** 1-based bay the run reached (cleared, if won+runComplete; attempted, if lost). */
  bayNum: number;
  bayName: string;
  /** True only for the bay-10 win — every other win routes to draftScreen instead. */
  runComplete: boolean;
  /** Salvage this run just paid out (meta.ts's salvageForRun) and the player's
   *  new total. Shown on EVERY end, including a loss — the whole point of the
   *  meta layer is that a failed run still ships something back. */
  salvageEarned: number;
  salvageTotal: number;
  /** Scrap earned across the run and the ship it bought — so the build reads as
   *  an investment on the way out, not just a row of chips that vanished. */
  scrapEarned: number;
  tiers: UpgradeTiers;
}): string {
  const title = opts.runComplete ? "Run Complete!" : opts.won ? "Level Cleared!" : "Game Over";
  const eyebrow = opts.runComplete
    ? "All 10 bays cleared"
    : opts.won
      ? "Launch Bay complete"
      : opts.reason === "broke"
        ? "Out of funds — the bay stays unpaid"
        : opts.reason === "time"
          ? "Time's up — the bay went dark"
          : opts.reason === "launches"
            ? "Out of launches — the bay is done"
            : "The compactor won this round";
  const loseFx = !opts.won && opts.reason ? loseFxHTML(opts.reason) : "";
  // Three top-level regions, always emitted in this order. A tall viewport
  // grids them into ONE column, which reproduces the original reading order
  // (outcome, submit, board, actions). A short landscape viewport grids them
  // into two, with the actions moving under the outcome so the board gets the
  // full column height — see app.css's `.end` rules.
  return `<div class="modal-scrim" id="scrim">
    ${loseFx}
    <div class="panel modal end pop">
      <div class="end__main">
      <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--danger)"}">${eyebrow}</div>
      <h2 class="display">${title}</h2>
      ${!opts.won ? `<p class="muted" style="margin-top:-8px">Made it to Bay ${opts.bayNum} — ${opts.bayName}</p>` : ""}
      <div class="stat-row">
        <div class="stat"><b style="color:var(--accent)">${opts.score}</b><span>Score</span></div>
        <div class="stat"><b>${opts.lines}</b><span>Lines</span></div>
        <div class="stat"><b style="color:var(--piece-o)">${opts.best}</b><span>Best</span></div>
      </div>
      <div class="muted" style="text-align:center;font-size:12px;margin-top:-8px">
        ${opts.baysCleared} bay${opts.baysCleared === 1 ? "" : "s"} ×${SCORE_PER_BAY}
        · ${opts.lines} line${opts.lines === 1 ? "" : "s"} ×${SCORE_PER_LINE}
        · $${Math.max(0, opts.funds)} left
      </div>
      <!-- Salvage payout. Deliberately prominent on a LOSS too: the run ending
           is not the end of the progression, and the player should see the
           consolation — and the door to spending it — before they see the
           leaderboard. The breakdown restates meta.ts's formula term by term so
           the reward never reads as an arbitrary number. -->
      <div class="salvage-row">
        <div class="salvage-row__amt">♻ +${opts.salvageEarned}</div>
        <div class="salvage-row__body">
          <b>Salvage recovered</b>
          <span class="muted">${SALVAGE_FLOOR} base · ${opts.baysCleared}×${SALVAGE_PER_BAY} bays · ${Math.floor(opts.lines / 2)}×${SALVAGE_PER_2_LINES} lines${opts.runComplete ? ` · +${SALVAGE_RUN_COMPLETE_BONUS} full run` : ""} → <b>${opts.salvageTotal} banked</b></span>
          <span class="muted">${opts.scrapEarned} scrap earned · ${tiersCost(opts.tiers)} refitted into the ship</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>
      </div>
      <div class="end__side">
        <div class="submit-row" id="submit-row">
          <input class="name-input" id="name-input" maxlength="12" placeholder="YOUR NAME"
            value="${opts.name}" autocomplete="off" spellcheck="false" />
          <button class="btn btn--primary" data-action="submit-score">Submit</button>
        </div>
        <div id="lb-body">${opts.rows}</div>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="restart">Play Again</button>
        <button class="btn btn--ghost" data-action="menu">Menu</button>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
 * CONTRACTS — the generated, retryable half (see game/contracts.ts).
 * ------------------------------------------------------------------------ */

/** The day's Contract board. Failure costs nothing here, so the copy leans on
 *  "pick one and try it" rather than warning the player about anything. */
export function contractsScreen(opts: {
  contracts: ContractCard[];
  tier: number;
  /** Every Contract id ever cleared (meta.claimedContracts), not just today's —
   *  an id embeds its daily seed, so only today's can match today's board and
   *  the caller doesn't have to prune. Shown as a tick rather than hidden, so
   *  the board reads as progress rather than a shrinking list. */
  cleared: string[];
}): string {
  const cards = opts.contracts
    .map((c, i) => {
      const done = opts.cleared.includes(c.id);
      // A pattern Contract advertises its exact inventory, because the whole
      // offer is "here is what you get — can you place it?". Knowing the set
      // before you accept is the planning the mode is made of.
      const ask =
        c.kind === "pattern"
          ? `<p>${queueTallyHTML(c.queue)} <b>→ ${c.goal}</b> lines</p>`
          : `<p><b>${c.goal}</b> lines in <b>${c.launches}</b> launches</p>`;
      return `<button class="panel step contract-card${done ? " contract-card--done" : ""}" data-action="contract" data-slot="${i}">
        <div class="step__n">${done ? "✓" : String(i + 1).padStart(2, "0")}</div>
        <b>${c.name}</b>
        ${ask}
        <p class="muted" style="font-size:12px">${c.brief}</p>
      </button>`;
    })
    .join("");
  return `<div class="screen neon-backdrop">
    <div class="howto">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="eyebrow">Tier ${opts.tier} · resets daily</div>
          <h2 class="display" style="font-size:var(--fs-h1)">Contracts</h2>
        </div>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>
      <p class="muted" style="margin:0">
        No clock, no launch costs — your supply of shipments is the only budget.
        Fail as many times as you like; nothing is lost.
      </p>
      <div class="howto__grid">${cards}</div>
    </div>
  </div>`;
}

/** Just the fields the board needs, so screens.ts doesn't import the generator. */
export interface ContractCard {
  id: string;
  name: string;
  kind: "lines" | "pattern";
  goal: number;
  launches: number;
  /** The exact inventory, for a pattern Contract. Empty otherwise. */
  queue: PieceType[];
  brief: string;
}

/**
 * A shipment multiset as a compact tally — `I×3 O×1`, each letter in its own
 * piece colour. Used everywhere a pattern Contract's set is stated: the card
 * (what you're accepting), the HUD (what's left), the end screen (what you
 * had). One renderer so those three can never disagree about the same set.
 *
 * Text rather than piece glyphs on purpose: at 5-8 shipments a row of little
 * shape grids reads as decoration, while a tally reads as an inventory — and
 * an inventory is the thing being planned against.
 */
export function queueTallyHTML(queue: readonly PieceType[]): string {
  if (!queue.length) return `<span class="muted">—</span>`;
  return PIECE_TYPES.filter((t) => queue.includes(t))
    .map((t) => {
      const n = queue.filter((q) => q === t).length;
      return `<span style="color:${PIECE_COLORS[t]};font-weight:700">${t}</span>×${n}`;
    })
    .join(" ");
}

/**
 * End-of-Contract modal.
 *
 * Win and loss are genuinely different screens, not one screen with a recoloured
 * label. The earlier version differed only by a small eyebrow while the big
 * heading showed the Contract's NAME — which carries no outcome — and offered
 * "Try Again" as the primary action on a bay the player had just WON. Winning
 * read like failing.
 *
 * So on a win the outcome is the headline, the payout is stated plainly (the
 * player should never have to go to the Workshop to find out whether a clear
 * counted), and the primary action moves forward to the board. Replaying stays
 * available, worded as "Play Again" — it is practice, not another attempt.
 */
export function contractEndModal(opts: {
  won: boolean;
  name: string;
  kind: "lines" | "pattern";
  lines: number;
  goal: number;
  launchesUsed: number;
  launches: number;
  /** Pattern only: the exact set the attempt was given, and how many cubes went
   *  somewhere other than a completed line. */
  queue: PieceType[];
  cubesWasted: number;
  /** Null on a loss. `firstClear` false = cleared before, so it paid nothing. */
  award: { salvage: number; firstClear: boolean } | null;
  salvageTotal: number;
}): string {
  const pattern = opts.kind === "pattern";
  const supplyLabel = pattern ? "Shipments" : "Launches";
  const supplyTotal = pattern ? opts.queue.length : opts.launches;
  const stats = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 14px">
      <div class="chip" style="flex-direction:row;gap:10px">
        <div class="chip__label">Lines</div>
        <div class="chip__value" style="color:var(--accent)">${opts.lines}/${opts.goal}</div>
      </div>
      <div class="chip" style="flex-direction:row;gap:10px">
        <div class="chip__label">${supplyLabel}</div>
        <div class="chip__value" style="color:var(--warn)">${opts.launchesUsed}/${supplyTotal}</div>
      </div>
      ${
        pattern
          ? `<div class="chip" style="flex-direction:row;gap:10px">
        <div class="chip__label">Manifest</div>
        <div class="chip__value" style="font-size:var(--fs-sm)">${queueTallyHTML(opts.queue)}</div>
      </div>`
          : ""
      }
    </div>`;

  if (!opts.won) {
    // A pattern Contract almost never ends with an empty queue and an unmet
    // goal — it ends the moment the cubes to finish it stop existing. Saying
    // how many were lost is the whole feedback: "you were one cube short" is
    // what makes the retry a decision rather than another roll.
    const heading = pattern ? "Manifest short" : "Out of launches";
    const why = pattern
      ? opts.cubesWasted > 0
        ? `<b>${opts.cubesWasted}</b> cube${opts.cubesWasted === 1 ? "" : "s"} never made it into a line — with an exact manifest, that's the whole margin.`
        : "The manifest ran out before the goal did."
      : "Nothing lost — a Contract costs you nothing to retry.";
    return `<div class="modal-scrim" id="scrim">
      <div class="panel modal pop" style="width:min(460px,94vw)">
        <div class="eyebrow" style="color:var(--danger)">${opts.name}</div>
        <h2 class="display" style="font-size:var(--fs-h1)">${heading}</h2>
        <p class="muted" style="margin:2px 0 0">${why}</p>
        ${stats}
        <button class="btn btn--primary btn--lg btn--block" data-action="contract-retry">↻ Try Again</button>
        <button class="btn btn--secondary btn--block" data-action="contracts">Contract Board</button>
      </div>
    </div>`;
  }

  // Spare launches are the only skill expression left once it's cleared, so
  // they're called out — it's what makes replaying a paid Contract interesting.
  // A pattern Contract has no spare by construction, so clearing one at all IS
  // the flourish and the copy says that instead.
  const spare = pattern ? 0 : opts.launches - opts.launchesUsed;
  const reward = opts.award?.firstClear
    ? `<div class="chip" style="border-color:var(--success);gap:2px;padding:12px 14px">
         <div class="chip__label" style="color:var(--success)">Salvage banked</div>
         <div class="chip__value" style="color:var(--warn);font-size:var(--fs-h2)">♻ +${opts.award.salvage}</div>
         <div class="muted" style="font-size:var(--fs-sm)">${opts.salvageTotal} total · spend it in the Workshop</div>
       </div>`
    : `<div class="chip" style="gap:2px;padding:12px 14px">
         <div class="chip__label">Already paid</div>
         <div class="muted" style="font-size:var(--fs-sm)">This Contract paid its salvage on your first clear. Replays are free practice.</div>
       </div>`;

  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal pop" style="width:min(460px,94vw)">
      <div class="eyebrow" style="color:var(--success)">${opts.name} · cleared</div>
      <h2 class="display neon-text" style="font-size:var(--fs-h1);color:var(--success)">
        ✓ Contract Complete
      </h2>
      <p class="muted" style="margin:2px 0 0">
        ${
          pattern
            ? `${opts.goal} lines from the exact manifest — <b>nothing wasted</b>.`
            : `${opts.goal} lines delivered${spare > 0 ? ` with <b>${spare}</b> launch${spare === 1 ? "" : "es"} to spare` : ""}.`
        }
      </p>
      ${stats}
      <div style="margin:0 0 14px">${reward}</div>
      <button class="btn btn--primary btn--lg btn--block" data-action="contracts">Contract Board →</button>
      <button class="btn btn--secondary btn--block" data-action="contract-retry">↻ Play Again</button>
    </div>
  </div>`;
}
