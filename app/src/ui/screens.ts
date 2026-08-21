import { PIECE_COLORS, PIECE_TYPES } from "../game/theme";
import type { LossReason } from "../game/game";
import { LEVEL_1 } from "../game/level";
import { RUN_LEVELS, SCORE_PER_BAY, SCORE_PER_LINE } from "../game/run";
import {
  toggleHTML, pieceCellsHTML, formatMMSS, beltPieceHTML, beltBombHTML, runRatchetsHTML, shipPlatesHTML,
} from "./components";
import { icon, type IconName } from "./icons";
import {
  MAX_TIER, UPGRADES, nextTierCost, refitTracks, tiersCost, upgradeById, type UpgradeTiers,
} from "../game/upgrades";
import {
  UNLOCKS, unlockAvailable, unlockGates, INSTALLS, installAvailable, installGates,
  markBudget, type MetaState, type TierProgress,
} from "../game/meta";
import type { Settings } from "../lib/store";
import type { ScoreEntry } from "../lib/api";
import type { BeltPreview } from "../game/game";
import type { PieceSize, PieceType } from "../game/theme";
import {
  totalNotches, type HazardDef, type HazardId, type Ratchets,
} from "../game/hazards";
import type { PreviewRow } from "../game/preview";

/** The portrait rotate guard. The markup lives here rather than inline in
 *  main.ts's boot HTML so the uifit harness renders the exact DOM the app
 *  shows — this was the one screen with zero fit coverage on any viewport.
 *  main.ts mounts it hidden and toggles `.show`; going portrait mid-bay also
 *  pauses the game (see onResize). */
export function rotateGuardHTML(): string {
  return `<div class="rotate-guard" id="rotate-guard">
    <div class="phone"></div>
    <div class="eyebrow">Rotate your device</div>
    <p class="muted">Tetrilaunch plays in landscape.</p>
  </div>`;
}

export function splashScreen(): string {
  // No tagline. "Physics Cannon Puzzle" undersold and mis-sold the game — it
  // reads as a physics sandbox, not a bay you have to bank a target out of —
  // and it was the same phrase on both screens, so it goes from both.
  return `<div class="screen neon-backdrop">
    <div class="splash">
      <h1 class="display neon-text brand-gradient">TETRILAUNCH</h1>
      <div class="loader"></div>
    </div>
  </div>`;
}

/** `store` is absent on web and on native builds without a RevenueCat key —
 *  the store entry point hides itself rather than offering a dead button. */
export function menuScreen(
  best: number,
  salvage = 0,
  store?: StoreState,
  progress?: TierProgress,
): string {
  // The tier chip answers "where am I on the ladder and what's left" from the
  // homepage (playtest call, 2026-08-08): the tier being flown, and the two
  // halves that complete it — the Deep Run and the Contracts — as live ticks.
  const tierChip = progress
    ? `<div class="chip chip--tier">
        <div class="chip__label">Tier</div>
        <div class="chip__value" style="color:var(--accent)">${progress.tier}</div>
        <div class="tier-chip__halves">
          <span class="${progress.runDone ? "done" : ""}">${progress.runDone ? "✓" : "○"} Run</span>
          <span class="${progress.contracts >= progress.needed ? "done" : ""}">${progress.contracts >= progress.needed ? "✓" : "○"} Contracts ${progress.contracts}/${progress.needed}</span>
        </div>
      </div>`
    : "";
  return `<div class="screen neon-backdrop">
    <div class="menu split">
      <div class="menu__brand">
        <!-- The demo (game/attract.ts drives the canvas), the wordmark sitting
             in it, and the paragraph both replaced.

             The title lives INSIDE the demo box on purpose: the panel is a
             live bay with no HUD over it, so its top-left corner is the one
             place a real screenshot would have chrome and the mini-field
             doesn't. Split across two lines there because the wordmark is
             sharing the frame with the play area rather than owning a headline
             of its own — the SPANS only stack while the demo is live (see
             app.css), so the reduced-motion fallback still reads as one word.

             The copy under it stays in the DOM either way: main.ts adds the
             is-live class only once the demo is actually running, and while it
             is, the paragraph is the canvas's text alternative — a screen
             reader still gets the description, and anyone on reduced motion
             (or without a 2D context) gets it on screen. -->
        <div class="menu__demo">
          <canvas class="menu__demo-canvas" aria-hidden="true"></canvas>
          <h1 class="menu__title display neon-text brand-gradient" aria-label="Tetrilaunch"><span>TETRI</span><span>LAUNCH</span></h1>
          <p class="menu__sub">Load the cannon, arc your tetrominoes across the bay, and feed
          full rows into the compactor before it sweeps them away — across a 10-bay gauntlet
          where every cleared bay ratchets one difficulty axis of your choosing.</p>
        </div>
        <div class="menu__status" aria-label="Player progress">
          ${tierChip}
          <div class="chip menu__stat">
            <div class="chip__label">Best</div>
            <div class="chip__value" style="color:var(--accent)">${best}</div>
          </div>
          <div class="chip menu__stat">
            <div class="chip__label">Salvage</div>
            <div class="chip__value" style="color:var(--warn)">♻ ${salvage}</div>
          </div>
          ${store?.unlimited ? unlimitedBadgeHTML() : ""}
          ${store?.available && !store.unlimited ? unlockChipHTML() : ""}
        </div>
      </div>
      <div class="menu__actions">
        <!-- Plain-language subtitles under the thematic names (playtest
             feedback: "Deep Run", "Contracts" and "Workshop" mean nothing to
             a new player until each is explained — keep the flavour, add one
             plain line saying what the button actually does). -->
        <button class="btn btn--primary btn--lg btn--block btn--menu" data-action="play">${icon("play")}<span class="btn__txt">Deep Run<span class="btn__sub">Clear ${RUN_LEVELS} bays in one run</span></span></button>
        <button class="btn btn--secondary btn--block btn--menu" data-action="contracts">${icon("contracts")}<span class="btn__txt">Contracts<span class="btn__sub">Short challenges · retry freely</span></span></button>
        <button class="btn btn--secondary btn--block btn--menu" data-action="workshop">${icon("workshop")}<span class="btn__txt">Workshop<span class="btn__sub">Spend Salvage on permanent unlocks</span></span></button>
        <button class="btn btn--secondary btn--block" data-action="howto">${icon("howto")}How to Play</button>
        <button class="btn btn--secondary btn--block" data-action="leaderboard">${icon("leaderboard")}Leaderboard</button>
        <!-- The Unlimited upsell is NOT a seventh button here. This column gets
             325px on a landscape phone and six buttons need 290 — a seventh
             needs 330 and overflowed the viewport, but only for players who
             hadn't bought, which is exactly who the menu has to look right for.
             It lives in the brand column's chip row instead (unlockChipHTML),
             the same slot the ★ UNLIMITED badge takes once owned, so this
             column is six buttons at every entitlement state. -->
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
  return `<div class="chip menu__entitlement">
    <div class="chip__value" style="color:var(--warn, #ffe500)">★ UNLIMITED</div>
  </div>`;
}

/** The pre-purchase counterpart to the badge above, in the same chip row — a
 *  button shaped like a chip so it reads as part of that status strip rather
 *  than as a seventh menu action. See the note in menuScreen's action column
 *  for why it isn't one. */
function unlockChipHTML(): string {
  return `<button class="chip chip--cta" data-action="paywall">
    <div class="chip__value">★ Unlock Unlimited</div>
  </button>`;
}

export function howtoScreen(): string {
  const steps = [
    ["01", "Aim & charge", `<b>Pull back</b> like a slingshot — the shot fires <b>opposite</b> your drag, and <b>distance sets the power</b>. Release to fire. On desktop use <span class="kbd">W</span><span class="kbd">S</span> to aim, <span class="kbd">A</span><span class="kbd">D</span> for power.`],
    ["02", "Rotate the piece", `Pieces turn in crisp <b>90° steps</b> — tap <span class="kbd">Q</span><span class="kbd">E</span> or the <span class="kbd">⟲</span>/<span class="kbd">⟳</span> buttons. The glowing piece at the cannon shows the exact orientation before you fire; the conveyor belt carries the piece coming <b>after</b> it.`],
    ["03", "Watch the arc", `The dotted parabola previews exactly where the piece flies. Pieces are joined by breakable joints — hard hits shatter them.`],
    ["04", "Fill the rows", `Land enough cubes in a row on the right of the compactor to complete a full straight line.`],
    ["05", "The compactor", `The red bar sweeps right, <b>shattering pieces into loose cubes</b> and compacting them. Cubes only vanish when they form a complete line — so don't let the stack reach the top.`],
    ["06", "Mind the bankroll", `Every launch costs <b>$${LEVEL_1.launchCost}</b>, and a full line pays out <b>$${LEVEL_1.scorePerLine}</b>. Cargo that drops out short of the compactor is <b>fined $${LEVEL_1.penaltyPerLostPiece} a cube</b> — a red −$ marks the spot. Reach <b>$${LEVEL_1.targetScore}</b> before the bankroll runs dry <b>or the clock hits zero</b>. Watch the <b>Launches</b> readout — it turns red at ${LOW_LAUNCH_WARN} or fewer, and that's when a shot has to count.`],
    ["07", "Three currencies", `<b>Funds ($)</b> pay for launches and are the bay's own target. <b>Scrap (♻)</b> is earned per line and spent on your ship at refit stops. <b>Salvage</b> is banked at tier milestones — each first-clear Contract and your first run win at a tier pays a share — and buys permanent unlocks in the Workshop.`],
    ["08", "Refit the rig", `The compactor is your ship. After bays <b>3, 6 and 9</b> you dock and spend scrap on six systems — a <b>wider bay</b>, <b>launcher coils</b> (more power and a wind stabilizer), <b>hydraulics</b>, <b>magazine</b>, <b>reactor</b>, <b>bond emitter</b>. Three tiers each; they last the whole run.`],
    ["09", "Run the gauntlet", `Ten bays deep, each with a rising target and stiffer joints. Clear one and <b>ratchet a difficulty axis</b> — you pick which of the two on offer, and it sticks for the rest of the run. The axis you are equipped for is the one that costs you nothing. Go broke or run out the clock and the run ends there.`],
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
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn--primary btn--lg" data-action="play">▶ Start Run</button>
        <button class="btn btn--secondary btn--lg" data-action="tutorial">Guided Tutorial</button>
      </div>
    </div>
  </div>`;
}

/**
 * Two columns, not one.
 *
 * Stacked, this needed 344px with no store rows and 404px with them, against
 * the 322px a landscape phone actually offers — so it scrolled, and the store
 * buttons sat below the fold exactly where Apple requires Restore to be
 * findable. Splitting toggles from actions puts the tallest column near 210px
 * and removes the scroll rather than making it more pleasant.
 */
export function settingsScreen(s: Settings, store?: StoreState): string {
  return `<div class="screen neon-backdrop center">
    <div class="panel modal modal--settings pop">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 class="display" style="font-size:var(--fs-h1)">Settings</h2>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>
      <div class="split settings__cols">
        <div class="settings__toggles">
          ${toggleHTML("sound", "Sound FX", "Launch, impact & line-clear cues", s.sound)}
          ${toggleHTML("music", "Music", "Ambient synth soundtrack", s.music)}
          ${toggleHTML("haptics", "Haptics", "Vibration feedback on mobile", s.haptics)}
        </div>
        <div class="settings__actions">
          ${store?.available ? purchaseRowsHTML(store) : ""}
          <button class="btn btn--secondary btn--block" data-action="menu">Done</button>
        </div>
      </div>
    </div>
  </div>`;
}

/** Restore is always reachable (Apple requires it without a purchase first);
 *  Manage opens RevenueCat's Customer Center, which only makes sense once
 *  there's something to manage. */
function purchaseRowsHTML(store: StoreState): string {
  return `${
    store.unlimited
      ? `<button class="btn btn--secondary btn--block" data-action="customer-center">Manage Subscription</button>`
      : `<button class="btn btn--secondary btn--block" data-action="paywall">★ Unlock Unlimited</button>`
  }
  <button class="btn btn--ghost btn--block" data-action="restore" id="restore-btn">Restore Purchases</button>`;
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
      <div id="lb-body" data-scroll>${rows}</div>
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
  /** Whether this bay's run carries the Bond Breaker ability at all — shows
   *  its glowing chip in the plant's ability row (see main.ts / game.ts's
   *  useBondBreaker). Charged by CHARGES, not by the config: the stock is a
   *  consumable run resource, so a run that spent its last charge in an
   *  earlier bay no longer shows a dead trigger. */
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
   *  chips in the plant panel (see components.ts's runRatchetsHTML). */
  ratchets: Ratchets;
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
    pieceSize, bondBreakerOwned, bondCharges, demoOwned, bombCharges, autoloaderOwned, ratchets, tiers,
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
  // BAY BANNER — the run position, top-center of the field. Playtest feedback:
  // "Bay 1/10" as small muted text inside the plant title read as part of the
  // level name, so players didn't know they were 1 bay into a 10-bay run. The
  // banner makes the x/10 the headline and adds one pip per bay (cleared pips
  // lit, current pip amber) so progress is readable at a glance without
  // parsing any numbers. Contract mode shows the contract's name instead —
  // there is no run position to report.
  const bayBanner = contract
    ? `<div class="bay-banner bay-banner--contract" role="status">
        <span class="bay-banner__mode">Contract</span> ${contract.name}
      </div>`
    : `<div class="bay-banner" role="status" aria-label="Bay ${bayNum} of ${RUN_LEVELS}">
        <span class="bay-banner__mode">Bay</span>
        <span class="bay-banner__n">${bayNum}<span class="bay-banner__of">/${RUN_LEVELS}</span></span>
        <span class="bay-banner__pips" aria-hidden="true">${Array.from(
          { length: RUN_LEVELS },
          (_, i) => `<i class="${i + 1 < bayNum ? "done" : i + 1 === bayNum ? "cur" : ""}"></i>`,
        ).join("")}</span>
      </div>`;
  return `<div class="hud" id="hud">
    <!-- button rail: ONE same-width column of four base buttons — fullscreen,
         pause, rotate CCW/CW — plus a slot per drafted ability (Bond Breaker,
         Demolition, Autoloader). Where it SITS is decided by the layout solver
         (game/layout.ts): centered in the right letterbox gutter when one is
         wide enough, in a reserved right band on near-16:9 viewports where
         there is no natural gutter, or as a horizontal strip in the bottom
         band when the column genuinely cannot fit (see app.css's [data-layout]
         rules). The solver budgets the column for the buttons ACTUALLY here
         (main.ts's hudOpts feeds railSlotsFor), which is what keeps the
         vertical rail on 360dp landscape phones. There's no keyboard on
         mobile, so this rail IS the touch control surface. The aim-state
         cancel ✕ is only visible mid-drag (main.ts's syncHud toggles
         .hud--aiming) and does NOT own a slot: it swaps into the pause
         button's slot (a CSS order pair — it is last in the DOM but renders
         second), so the column's count and every other button's position hold
         steady under a hovering thumb; a second finger taps it to abort the
         queued launch. Rotate taps mid-drag do NOT cancel (see input.ts).
         Desktop hides the game buttons and uses Q/E + B/X instead (see the
         @media (pointer: fine) rule in app.css), per the kbd-hint strip down
         in .hud__bottom. -->
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

    ${bayBanner}

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
            contract ? contract.name : `Bay ${bayNum}/${RUN_LEVELS}`
          }</span></div>
          <div class="plant__rivets"><i></i><i></i><i></i></div>
        </div>
        <div class="pl-read">
          ${
            contract
              ? `<div class="pl-funds">
            <div class="lbl">Lines<span class="lbl__q"> / Goal</span></div>
            <div class="v"><span id="hud-score">${contract.lines}</span> <span class="tgt">/ ${contract.goal}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="width:0%"></i></div>
          </div>
          <div class="pl-stat pl-launches" id="hud-launches-chip">
            <div class="lbl">${contract.kind === "pattern" ? "Shipments" : "Launches"}</div>
            <div class="v" id="hud-launches">${contract.launchesLeft}</div>
          </div>`
              : `<div class="pl-funds">
            <div class="lbl">Funds<span class="lbl__q"> / Target</span></div>
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
          ${runRatchetsHTML(ratchets)}
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
 * INTERACTIVE COACH — the first-run tutorial (issue #23). One instruction at a
 * time over the live first bay, each advancing when the player actually
 * performs the action (detection lives in main.ts's tutorial driver — this
 * module only renders the current step). Steps carry no keyboard talk: on
 * touch the rail buttons are the controls, and desktop players get the
 * kbd-hint strip anyway.
 *
 * ONE CARD PER COMPLETABLE ACTION — this is why the deck is four steps and
 * not the playtest deck's six (aim, power, rotate, launch, row, resources).
 * Aim, power and launch are not three actions: they are one continuous drag,
 * whose only possible ending is the release that fires. Splitting that
 * gesture across three cards meant the Power card advanced mid-drag the
 * instant the pull crossed a threshold, and the Launch card either flashed
 * past unread or never appeared at all (the shoot handler jumped over it) —
 * playtest feedback: "steps 2 and 4 are skipped immediately; the release is
 * the only thing you can do." A step the player cannot dwell on teaches
 * nothing, so the drag is now taught whole, on one card, and advances only
 * when the gesture COMPLETES in a fired shot. Rotate is the one genuinely
 * separate verb (a discrete tap, doable between shots), so it keeps its card
 * — placed AFTER the first shot, where the player has a next piece to turn.
 */
export interface CoachStep {
  title: string;
  body: string;
}

/** The level's real numbers are baked into the copy so the tutorial teaches
 *  THIS bay's economy, not a stale example. */
export function coachSteps(level: {
  launchCost: number;
  scorePerLine: number;
  targetScore: number;
  penaltyPerLostPiece: number;
}): CoachStep[] {
  return [
    {
      title: "Aim & fire",
      body: `Touch the field and <b>pull back</b> — the cannon aims opposite your drag, like a slingshot. Pull farther for <b>more power</b>, follow the dotted arc, and <b>release to fire</b>!`,
    },
    {
      title: "Rotate",
      body: `Between shots, tap <b>⟲ / ⟳</b> on the right to turn the next piece in 90° steps. The glowing piece at the cannon shows the exact orientation it will fly in.`,
    },
    {
      title: "Complete a row",
      body: `Land cubes in front of the red compactor until they fill a <b>full row</b> — full rows vanish and pay you. Cubes that fall <b>short of the bar</b> blink away and are lost. Keep launching!`,
    },
    {
      title: "Funds & Target",
      body: `Each launch costs <b>$${level.launchCost} Funds</b>; each full row pays <b>$${level.scorePerLine}</b> back plus <b>♻ scrap</b> for upgrades. Dropped cargo isn't free either — every lost cube <b>fines you $${level.penaltyPerLostPiece}</b> (you'll see the red −$ where it vanished). Reach <b>$${level.targetScore}</b> before Funds or the clock run out — that clears the bay.`,
    },
  ];
}

export function coachHTML(
  step: number,
  level: {
    launchCost: number;
    scorePerLine: number;
    targetScore: number;
    penaltyPerLostPiece: number;
  },
): string {
  const steps = coachSteps(level);
  const s = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;
  const dots = steps
    .map((_, i) => `<i class="${i < step ? "done" : i === step ? "cur" : ""}"></i>`)
    .join("");
  return `<div class="coach" id="coach">
    <div class="coach__card">
      <div class="coach__eyebrow">Tutorial · ${Math.min(step + 1, steps.length)}/${steps.length}</div>
      <div class="coach__title">${s.title}</div>
      <p class="coach__body">${s.body}</p>
      <div class="coach__foot">
        <span class="coach__dots" aria-hidden="true">${dots}</span>
        ${
          last
            ? `<button class="btn btn--primary coach__btn" data-action="coach-done">Got it!</button>`
            : `<button class="btn btn--ghost coach__btn" data-action="coach-skip">Skip tutorial</button>`
        }
      </div>
    </div>
  </div>`;
}

/**
 * TUTORIAL FAILURE — the coach handling a lost first bay.
 *
 * A first-timer who runs the purse dry ninety seconds into their first game
 * used to get the full run-end modal: "Game Over", a leaderboard submit box, a
 * tier-progress ledger and a score breakdown reading zero. Every one of those
 * is an answer to a question they have not thought to ask yet, and the two
 * things they actually needed — what went wrong, and how to get back in — were
 * a "Play Again" button and a themed one-liner. A tutorial that can hard-fail
 * into a leaderboard is a tutorial that stops teaching at the first mistake.
 *
 * So the coach handles its own failures. Same card, same voice, same place on
 * screen as the four teaching steps — the lesson simply continues, because
 * losing a bay to an empty bankroll IS the lesson this mode is built around.
 * The run is not recorded, no score is submitted and nothing is banked: the
 * bay did not happen. (main.ts's onGameStatus is where that is enforced.)
 *
 * The copy is cause-specific and carries THIS bay's real numbers for the same
 * reason coachSteps does — a tutorial that teaches a stale example teaches the
 * player to distrust it. `broke` is deliberately the fullest explanation: with
 * the float now a tight eight launches (level.ts's economy note), it is the
 * failure a new player will actually meet, and "you ran out of money" without
 * "here is the arithmetic" is a verdict rather than a lesson.
 */
export function coachFailSteps(
  reason: LossReason | null,
  level: { launchCost: number; scorePerLine: number; targetScore: number; startingFunds: number },
): { title: string; body: string } {
  const launches = Math.floor(level.startingFunds / Math.max(1, level.launchCost));
  switch (reason) {
    case "broke":
      return {
        title: "Out of Funds",
        body: `Every launch costs <b>$${level.launchCost}</b>, so a bay opens with about <b>${launches} shots</b> in the bank — and you ran out before reaching <b>$${level.targetScore}</b>. That budget is the puzzle: a full row pays <b>$${level.scorePerLine}</b> back, so a row built in two or three shots <i>earns</i>, and cubes that miss the compactor are money gone. <b>Aim for the row, not for the pile.</b>`,
      };
    case "time":
      return {
        title: "Time's Up",
        body: `The clock ran out before your Funds reached <b>$${level.targetScore}</b>. You have more time than it feels like — line up the next shot <i>while</i> the cannon reloads, and let each full row pay you <b>$${level.scorePerLine}</b> forward.`,
      };
    case "topout":
      return {
        title: "The Pile Topped Out",
        body: `Cubes stacked to the ceiling. Only <b>complete rows</b> remove cubes from the bay, so a pile that keeps growing never comes down — spend your shots finishing the row nearest the compactor before starting a new layer.`,
      };
    default:
      return {
        title: "Bay Lost",
        body: `That bay got away. Nothing is lost — the tutorial run does not count against you. Take another go at <b>$${level.targetScore}</b>.`,
      };
  }
}

/** The failure card itself. Rendered as a modal rather than in the plant panel
 *  flow (where the teaching steps live) because the field behind it is dead and
 *  there is a decision to make: the card has to be the only thing to look at.
 *  Retry is the primary and it is a full-width target — a player who just lost
 *  their first bay should not have to hunt for the way back in. */
export function coachFailHTML(
  reason: LossReason | null,
  level: { launchCost: number; scorePerLine: number; targetScore: number; startingFunds: number },
  bayName: string,
): string {
  const s = coachFailSteps(reason, level);
  return `<div class="modal-scrim" id="scrim">
    <div class="coach coach--fail">
      <div class="coach__card">
        <div class="coach__eyebrow">Tutorial · ${bayName}</div>
        <div class="coach__title">${s.title}</div>
        <p class="coach__body">${s.body}</p>
        <div class="coach__foot coach__foot--fail">
          <button class="btn btn--primary btn--lg btn--block" data-action="coach-retry">↻ Try this bay again</button>
          <div class="row coach__foot-row">
            <button class="btn btn--ghost" data-action="coach-skip-run">Skip tutorial</button>
            <button class="btn btn--ghost" data-action="menu">Menu</button>
          </div>
        </div>
      </div>
    </div>
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
  /** The run's Mark — Mark 1 stops offer only Reactor Output (see
   *  upgrades.ts's refitTracks for the tuning rationale). */
  mark: number;
}): string {
  const tracks = refitTracks(opts.mark);
  const cards = tracks.map((u) => {
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
    // Tier 0 is NOT INSTALLED, and refit cannot install (run.ts's buyUpgrade
    // refuses it): a system is bought once, with salvage, in the Workshop. The
    // card used to price tier 0 like any other rung, which after that rule
    // landed meant a live 20-scrap button that tapped to nothing.
    const btn =
      tier === 0
        ? `<span class="refit-card__locked">Not installed · Workshop</span>`
        : cost === null || step === null
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
          <p class="muted" style="margin:0"><span class="refit__hint">The compactor rig is your ship. Spend scrap; it lasts the run. </span>Next up: ${opts.nextBayName}.</p>
        </div>
        <div class="chip refit__scrap">
          <div class="chip__label">Scrap</div>
          <div class="chip__value" style="color:var(--warn)" id="refit-scrap">♻ ${opts.scrap}</div>
        </div>
      </div>
      <div class="refit__grid" id="refit-grid" data-scroll>${cards}</div>
      ${
        tracks.length < UPGRADES.length
          ? `<p class="muted" style="margin:0;font-size:var(--fs-sm)">Tier 1 refits focus the reactor — the rest of the yard opens at Tier 2.</p>`
          : ""
      }
      <button class="btn btn--primary" data-action="refit-done">Undock →</button>
    </div>
  </div>`;
}

/**
 * WORKSHOP — the meta layer, reached from the main menu between runs. Spends
 * SALVAGE (banked on tier completion — see meta.ts's tierSalvage/advanceTier)
 * on permanent unlocks.
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
/** Which half of the shop is showing. Systems and Options are two lists of the
 *  same kind of decision, and at 792x360 both at once is 689px of cards in a
 *  189px window — see the spec's measurement table. */
export type ShopTab = "systems" | "options";

export function workshopScreen(meta: MetaState, tab: ShopTab = "systems"): string {
  // Marks BEATEN. `meta.mark` verbatim, and deliberately not markUnlocked() -
  // main.ts's onBuyUnlock enforces the gate against this same field, so any
  // derivation here would risk offering a button the purchase path refuses.
  const mark = meta.mark;
  // Retired unlocks (the mod-pool shelf — see meta.ts's UnlockDef.retired)
  // are never merchandise and never reference: they do nothing, so listing
  // them anywhere would be the dishonest shelf this filter removes.
  const live = UNLOCKS.filter((u) => !u.retired);
  const owned = live.filter((u) => meta.unlocks.includes(u.id));
  const forSale = live.filter((u) => !meta.unlocks.includes(u.id))
    .sort((a, b) => a.rank - b.rank || a.cost - b.cost);

  const cards = forSale
    .map((u) => {
      const available = unlockAvailable(u, meta.unlocks, mark);
      const affordable = meta.salvage >= u.cost;
      const gates = unlockGates(u, meta.unlocks, mark);
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-unlock" data-unlock="${u.id}"${affordable ? "" : " disabled"}>♻ ${u.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      // "Permanent" on every card (playtest feedback): the Workshop and the
      // mid-run Refit both sell upgrades, and nothing on screen said which
      // purchases outlive the run. This is the one that does.
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(u.id as IconName, 13)}${u.name} <span class="shop-card__tag">Permanent</span></div>
        <p class="shop-card__desc">${u.desc}</p>
      </div>
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

  // ---- Systems -------------------------------------------------------------
  // Installs sit ABOVE the unlock cards: a system is permanent power the player
  // keeps, an unlock is an option that may or may not be dealt, and the shop
  // should lead with the one that is guaranteed to matter. The budget readout
  // rides on the section label because the cap, not the price, is what usually
  // stops a purchase here — a player staring at 400 salvage and a greyed card
  // needs to be told it is the Mark talking.
  const installCards = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) === 0)
    .map((i) => {
      const def = upgradeById(i.id)!;
      const available = installAvailable(meta, i);
      const affordable = meta.salvage >= i.cost;
      const gates = installGates(meta, i);
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-install" data-install="${i.id}"${affordable ? "" : " disabled"}>♻ ${i.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      return `<div class="shop-card${available ? "" : " shop-card--gated"}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(i.id as IconName, 13)}${def.name}</div>
        <p class="shop-card__desc">${def.blurb} Installs at tier 1; refit stops raise it.</p>
      </div>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
    })
    .join("");

  const installedStrip = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) > 0)
    .map((i) => `<span class="workshop__owned-item">${upgradeById(i.id)!.name} ${"I".repeat(Math.min(MAX_TIER, meta.loadout[i.id] ?? 0))}</span>`)
    .join("");

  // The counts are what let the hidden half advertise itself. A tab that just
  // says "Options" gives a player no reason to look, and the cheapest unlock
  // they can afford is behind it.
  const systemsBuyable = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) === 0 &&
    installAvailable(meta, i) && meta.salvage >= i.cost).length;
  const optionsBuyable = forSale.filter((u) => unlockAvailable(u, meta.unlocks, mark) &&
    meta.salvage >= u.cost).length;

  const tabBtn = (id: ShopTab, label: string, n: number) =>
    `<button class="workshop__tab${tab === id ? " workshop__tab--on" : ""}" role="tab" data-action="shop-tab" data-tab="${id}" aria-selected="${tab === id}">${label}${n ? ` <b>${n}</b>` : ""}</button>`;

  // The bar is a SIBLING of .workshop__shop, never a child: app.css makes
  // .workshop__shop the scroller on short viewports, so a bar inside it
  // scrolls away exactly when the player needs it.
  const tabBar = `<div class="workshop__tabs" role="tablist">
        ${tabBtn("systems", "Systems", systemsBuyable)}
        ${tabBtn("options", "Options", optionsBuyable)}
        ${tab === "systems"
          ? `<span class="workshop__budget">build budget ${tiersCost(meta.loadout)}/${markBudget(meta)}</span>`
          : ""}
      </div>`;

  // Each strip belongs to its own pane. Left above the shop they would show the
  // Installed list while the player is shopping for Options, and both would eat
  // fixed chrome off the only scroller.
  const pane = tab === "systems"
    ? `${installedStrip
          ? `<div class="workshop__owned"><span class="workshop__owned-label">✓ Installed</span>${installedStrip}</div>`
          : ""}
       ${installCards
          ? `<div class="workshop__grid">${installCards}</div>`
          : `<p class="muted" style="margin:0">Every system your tier allows is installed. Complete this tier to open the next one.</p>`}`
    : `${ownedStrip}
       ${done
          ? `<p class="muted" style="margin:0">Every option unlocked. Salvage now rides along for the next thing built.</p>`
          : `<div class="workshop__grid">${cards}</div>`}`;

  return `<div class="screen neon-backdrop">
    <div class="workshop">
      <div class="workshop__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Between runs</div>
          <h2 class="display" style="font-size:var(--fs-h1)">Workshop</h2>
          <p class="muted workshop__blurb" style="margin:0">Tier milestones pay salvage — each first-clear Contract and run win banks a share. Spend it on options you didn't have before.</p>
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
      ${tabBar}
      <div class="workshop__shop" role="tabpanel" data-scroll>${pane}</div>
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
 * Ratchet modal shown between bays: freezes the just-cleared field behind a
 * scrim and asks which difficulty axis hardens for the rest of the run.
 *
 * This replaced the modifier draft, and the inversion is the point. A mod was a
 * hand you were DEALT — often with an upside, and skippable. A notch is pure
 * cost, mandatory, and permanent. There is deliberately no skip button: a draft
 * you can decline has a dominant option, and the design rests on the player
 * paying for the bay they just cleared.
 *
 * The reward is implicit, and it was bought in the Workshop. A system does not
 * delete a hazard, it makes ONE specific hazard cheap for you — so the question
 * this modal really asks is "what have you prepared for?", and the axis you are
 * equipped for is the one that costs you nothing. That is why every card names
 * the exact number a notch adds: the player is pricing a choice, and a vague
 * card turns a deliberate trade into a guess.
 *
 * Mark 10 asks for TWO picks (hazards.ts's picksPerBay); `selected` holds the
 * tentative hand so far, and the modal only commits when the player confirms.
 *
 * The cards SELECT, they do not commit. A tap used to be the decision — the
 * modal closed and the next bay started — which made a screen full of prose
 * ("Every launch costs $5 more") the only thing the player had to price the
 * notch by. It did not even read as a choice: two cards, no selected state, no
 * confirm. Now a tap toggles the card and the projection under it redraws with
 * the numbers the next bay would ACTUALLY be flown at (preview.ts, off the real
 * levelForRun pipeline), and a separate confirm button is the commitment. The
 * player can try both cards, read what each does to their float and their
 * clock, and only then spend the notch.
 *
 * Still no skip. Toggling is not declining: the confirm stays disabled until
 * the Mark's full quota is selected, so the ratchet remains the mandatory price
 * of the bay just cleared. What changed is that the price is now legible before
 * it is paid, not after.
 */
export function draftScreen(opts: {
  bayNum: number;
  bayName: string;
  /** The run's tier (its Mark, in player-facing words) — carried on the
   *  eyebrow so the draft states which rung's pressure is being priced. */
  tier: number;
  nextBayName: string;
  funds: number;
  /** Overshoot above this bay's target (0 if it ended right at target) —
   *  the only part of `funds` that actually carries into the next bay's
   *  float (see run.ts's advanceRun). */
  carry: number;
  offers: HazardDef[];
  /** Every notch taken across the run so far, for the running tally. */
  ratchets: Ratchets;
  /** Axes SELECTED at this draft but not yet confirmed. Tentative: nothing here
   *  has touched RunState.ratchets, and the tally/projection show it as pending
   *  rather than banked. */
  selected: HazardId[];
  /** How many notches this Mark demands before the next bay. */
  picksNeeded: number;
  /** The next bay's numbers as they stand vs. with `selected` folded in — see
   *  preview.ts. Rendered live, so this is what makes the toggle worth having. */
  preview: PreviewRow[];
  /** Unspent scrap — shown here too (not only at refit stops) so the player can
   *  see capital accumulating between stops and plan the next refit. */
  scrap: number;
  /** Bay-CLEARS until the next refit stop (1 = clearing the next bay docks
   *  you), or null when no stop remains this run. */
  baysToRefit: number | null;
}): string {
  const banked = totalNotches(opts.ratchets);
  const pending = opts.selected.length;
  const remaining = Math.max(0, opts.picksNeeded - pending);
  const ready = remaining === 0;
  const cards = opts.offers
    .map((h) => {
      const picks = opts.selected.filter((p) => p === h.id).length;
      // An axis already ratcheted says so on the card. Taking the same notch a
      // second time is a legitimate build, but it is a different decision from
      // taking it the first time, and the card has to admit which one it is.
      // The tentative picks count toward the badge too — the card has to show
      // the notch level the projection below it is currently drawing.
      const owned = (opts.ratchets[h.id] ?? 0) + picks;
      const stack = owned > 0 ? ` <span class="mod-card__stack">at ${owned}</span>` : "";
      const kind = h.kind === "content" ? "bane" : "tradeoff";
      // The card's own footer says what the NEXT tap does, which is not the
      // same on every card: taps fill the hand while there is room and edit it
      // once it is full (hazards.ts's togglePick). Without it a selected card
      // in a one-pick draft looks like a dead end, and the capstone's
      // double-notch tap is invisible.
      const mark = `<span class="mod-card__mark">✓</span> Selected${picks > 1 ? ` ×${picks}` : ""}`;
      const foot = picks > 0
        ? ready ? `${mark} — tap to undo` : `${mark} — tap to double`
        : ready
          ? "Tap to swap this in"
          : "Tap to preview";
      return `<button class="mod-card mod-card--${kind}${picks > 0 ? " mod-card--picked" : ""}"
        data-action="pick-hazard" data-hazard="${h.id}" aria-pressed="${picks > 0}">
        <div class="mod-card__kind">${h.kind === "content" ? "material" : "pressure"}${stack}</div>
        <div class="mod-card__name">${h.name}</div>
        <p class="mod-card__desc">${h.desc}</p>
        <div class="mod-card__pick">${foot}</div>
      </button>`;
    })
    .join("");
  const stats = opts.preview
    .map((r) => {
      const val = r.changed
        ? `<span class="preview-stat__from">${r.from}</span><span class="preview-stat__arrow">→</span><span class="preview-stat__to">${r.to}</span>`
        : `<span class="preview-stat__to">${r.from}</span>`;
      // An unmoved context row is the one class of tile a landscape phone can
      // afford to drop (app.css, at compact density) — it is neither the frame
      // the change is read against nor the change itself. An ACTIVE row is
      // never that class: its axis has banked notches, so the pressure is live
      // whatever this selection touches (previewRows promotes it to core), and
      // the tag says why the row refuses to leave (Codex #1 / canvas A12).
      const cls = r.changed ? ` preview-stat--${r.tone}` : r.kind === "context" ? " preview-stat--context" : "";
      const label = r.active
        ? `<span class="preview-stat__labeltxt">${r.label}</span><span class="preview-stat__live">ACTIVE</span>`
        : r.label;
      return `<div class="preview-stat${r.active ? " preview-stat--active" : ""}${cls}">
        <div class="preview-stat__label">${label}</div>
        <div class="preview-stat__val">${val}</div>
      </div>`;
    })
    .join("");
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(940px,96vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared — ${opts.bayName} · Tier ${opts.tier}</div>
      <h2 class="display">${opts.picksNeeded > 1 ? `Ratchet ${opts.picksNeeded} axes` : "Ratchet one axis"}</h2>
      <p class="muted" style="margin-top:-8px">Next up: ${opts.nextBayName} — this sticks for the rest of the run.</p>
      <div class="draft__bank">
        <div class="chip chip--accent" style="flex-direction:row;align-items:center;gap:10px">
          <div class="chip__label">Ended $${opts.funds} — carries</div>
          <div class="chip__value">$${opts.carry}</div>
        </div>
        <div class="chip" style="flex-direction:row;align-items:center;gap:10px">
          <div class="chip__label">Notches taken</div>
          <div class="chip__value" id="draft-notches">${banked}${pending > 0 ? `<span class="chip__pending">+${pending}</span>` : ""}</div>
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
      <div class="draft__body">
        <div class="draft__cards" id="draft-cards">${cards}</div>
        <!-- aria-live: the projection is the ANSWER to tapping a card, and a
             screen-reader user who tapped one gets nothing back otherwise. -->
        <div class="draft__preview" id="draft-preview" aria-live="polite">
          <div class="draft__preview-hd">
            <span>${opts.nextBayName} — projected</span>
            <span class="draft__preview-note">${pending > 0 ? "with your selection" : "as it stands"}</span>
          </div>
          <div class="preview-grid">${stats}</div>
        </div>
      </div>
      <div class="draft__confirm" id="draft-confirm">
        <button class="btn btn--primary btn--block" data-action="confirm-hazards"${ready ? "" : " disabled"}>
          ${ready ? `Lock it in — launch ${opts.nextBayName}` : remaining === 1 ? "Select an axis" : `Select ${remaining} axes`}
        </button>
        <p class="draft__confirm-note muted">${
          opts.picksNeeded > 1
            ? "The capstone costs two notches a bay — there is no skip. Pick the pressures you are equipped for."
            : "Every bay costs one notch — there is no skip. Pick the pressure you are equipped for."
        }</p>
      </div>
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
  /** The tier this run's end just COMPLETED (meta.ts's recordRunEnd), or null
   *  when it only ticked progress. */
  tierCompleted: number | null;
  /** Salvage THIS run's end banked — the run-win milestone share, plus the
   *  completion remainder when tierCompleted fired (see meta.ts's tier
   *  milestone notes). Can be positive with tierCompleted null: a first win
   *  at the tier banks its share even while Contracts are still owed. */
  tierSalvage: number;
  /** Where the (possibly new) current tier stands after this run. */
  progress: TierProgress;
  salvageTotal: number;
  /** Scrap earned across the run and the ship it bought — so the build reads as
   *  an investment on the way out, not just a row of chips that vanished. */
  scrapEarned: number;
  tiers: UpgradeTiers;
}): string {
  const title = opts.runComplete ? "Run Complete!" : opts.won ? "Level Cleared!" : "Game Over";
  const eyebrow = opts.runComplete
    ? `All ${RUN_LEVELS} bays cleared`
    : opts.won
      ? "Launch Bay complete"
      : opts.reason === "broke"
        ? "Out of funds — the bay stays unpaid"
        : opts.reason === "time"
          ? "Time's up — the bay went dark"
          : opts.reason === "launches"
            ? "Out of launches — the bay is done"
            : "The compactor won this round";
  // WHY + WHAT TO TRY — playtest feedback: the themed eyebrow tells the mood
  // but not the mechanic, so a new player couldn't say whether they lost to
  // time or money, or what to change next run. One plain sentence for the
  // cause, one concrete adjustment. Only on a loss; a win explains itself.
  const lossWhy: Record<string, [string, string]> = {
    broke: [
      "You spent all your Funds on launches before reaching the target.",
      "Complete more lines with fewer launches — every full row pays Funds back.",
    ],
    time: [
      "The clock ran out before your Funds reached the target.",
      "Line up your next shot while the cannon reloads, and let full rows pay you forward.",
    ],
    launches: [
      "You used up every launch before hitting the goal.",
      "Make each shot part of a row — stray cubes are launches spent for nothing.",
    ],
    topout: [
      "The pile reached the ceiling.",
      "Clear full rows to keep the stack low — only complete lines remove cubes.",
    ],
  };
  const why = !opts.won && opts.reason ? lossWhy[opts.reason] : null;
  const loseFx = !opts.won && opts.reason ? loseFxHTML(opts.reason) : "";
  // Three top-level regions, always emitted in this order. A tall viewport
  // grids them into ONE column, which reproduces the original reading order
  // (outcome, submit, board, actions). A short landscape viewport grids them
  // into two, with the actions moving under the outcome so the board gets the
  // full column height — see app.css's `.end` rules.
  // `end--why` marks the losses that carry the plain-language cause block, so
  // the short-viewport rules can drop the themed eyebrow — which on those runs
  // is a second, moodier statement of the same cause — without touching wins,
  // where the eyebrow is the only status line there is.
  return `<div class="modal-scrim" id="scrim">
    ${loseFx}
    <div class="panel modal end pop${why ? " end--why" : ""}">
      <div class="end__main">
      <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--danger)"}">${eyebrow}</div>
      <h2 class="display">${title}</h2>
      ${!opts.won ? `<p class="muted" style="margin-top:-8px">Made it to Bay ${opts.bayNum}/${RUN_LEVELS} — ${opts.bayName}</p>` : ""}
      ${
        why
          ? `<div class="end__why"><p>${why[0]}</p><p class="end__tip"><b>Try next time:</b> ${why[1]}</p></div>`
          : ""
      }
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
      <!-- Tier progress. Deliberately prominent on a LOSS too: the run ending
           is not the end of the progression, and the player should see what
           the ladder still asks of them — or what this end just banked —
           before they see the leaderboard. Salvage arrives per MILESTONE
           (meta.ts): a first at-tier win banks its share on the spot, so the
           progress row can carry a payout line without a completion. -->
      ${
        opts.tierCompleted !== null
          ? `<div class="salvage-row salvage-row--tier-done">
        <div class="salvage-row__amt">♻ +${opts.tierSalvage}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.tierCompleted} complete!</b>
          <span class="muted">Run beaten and ${opts.progress.needed} Contracts cleared — Tier ${opts.progress.tier} is open. <b>${opts.salvageTotal} salvage banked</b>, yours to keep.</span>
          <span class="muted salvage-row__foot">${opts.scrapEarned} scrap earned · ${tiersCost(opts.tiers)} refitted into the ship</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
          : `<div class="salvage-row">
        <div class="salvage-row__amt salvage-row__amt--tier">${opts.tierSalvage > 0 ? `♻ +${opts.tierSalvage}` : `T${opts.progress.tier}`}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.progress.tier} progress</b>
          <span class="muted">${opts.tierSalvage > 0 ? `<b>♻ +${opts.tierSalvage} banked</b> for beating the run at this tier. ` : ""}${opts.progress.runDone ? "✓" : "○"} Deep Run beaten · ${opts.progress.contracts >= opts.progress.needed ? "✓" : "○"} Contracts ${opts.progress.contracts}/${opts.progress.needed} — finish both to open Tier ${opts.progress.tier + 1} (♻ ${opts.progress.award} total per tier).</span>
          <span class="muted salvage-row__foot">${opts.scrapEarned} scrap earned · ${tiersCost(opts.tiers)} refitted into the ship · ${opts.salvageTotal} salvage banked</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
      }
      </div>
      <div class="end__side">
        <div class="submit-row" id="submit-row">
          <input class="name-input" id="name-input" maxlength="12" placeholder="YOUR NAME"
            value="${opts.name}" autocomplete="off" spellcheck="false" />
          <button class="btn btn--primary" data-action="submit-score">Submit</button>
        </div>
        <div id="lb-body" data-scroll>${opts.rows}</div>
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
  /** Current tier standing, for the board header — Contracts are one of the
   *  two halves that complete a tier (meta.ts), and this screen is where the
   *  player decides whether to play one, so the count belongs here. */
  progress?: TierProgress;
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
      // Each card states the full deal up front (playtest feedback): the
      // objective, the supply limit, the reward, and that retrying is free —
      // so accepting one is never a leap into unexplained terms.
      const reward = done
        ? `<p class="contract-card__reward contract-card__reward--done">✓ Cleared — counted toward its tier · replay for practice</p>`
        : `<p class="contract-card__reward">First clear counts toward Tier ${opts.tier} · fail free, retry free</p>`;
      return `<button class="panel step contract-card${done ? " contract-card--done" : ""}" data-action="contract" data-slot="${i}">
        <div class="step__n">${done ? "✓" : String(i + 1).padStart(2, "0")}</div>
        <b>${c.name}</b>
        ${ask}
        ${reward}
        <p class="muted" style="font-size:12px">${c.brief}</p>
      </button>`;
    })
    .join("");
  // The tier status is its OWN line in the body font, not part of the pixel
  // eyebrow: with the progress suffix inline, the eyebrow ran to ~90 letter-
  // spaced glyphs, wrapped on a landscape phone, and dropped an orphaned
  // "♻ 60" straight into the Contracts heading (seen on device, 2026-08-09).
  // Copy states the MILESTONE economy — each first clear banks its share now
  // (meta.ts's tierMilestoneSalvage); completion is what opens the next tier.
  const status = opts.progress
    ? `<p class="muted" style="margin:0">
        <b style="color:var(--accent)">Contracts ${opts.progress.contracts}/${opts.progress.needed}${opts.progress.contracts >= opts.progress.needed ? " ✓" : ""}</b>
        · <b>Deep Run ${opts.progress.runDone ? "✓" : "○"}</b>
        — each first clear banks <b style="color:var(--warn)">♻ ${opts.progress.milestone}</b>; finish both halves to open Tier ${opts.progress.tier + 1}.
      </p>`
    : "";
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
      ${status}
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
  /** Null on a loss. `firstClear` false = cleared before, so it counted for
   *  nothing new; `completedTier` non-null = this clear finished the tier and
   *  `salvage` is what that banked (see meta.ts's recordContractClear). */
  award: { firstClear: boolean; completedTier: number | null; salvage: number } | null;
  /** Where the (possibly new) current tier stands after this clear. */
  progress: TierProgress;
  salvageTotal: number;
  /** Next unfinished card from the board this attempt came from. */
  nextContract?: { name: string } | null;
  /** All three cards on that board are now cleared. */
  boardComplete?: boolean;
}): string {
  const pattern = opts.kind === "pattern";
  const supplyLabel = pattern ? "Shipments" : "Launches";
  const supplyTotal = pattern ? opts.queue.length : opts.launches;
  const stats = `
    <div class="ce__stats">
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
      <div class="panel modal modal--contract-end pop">
        <div class="eyebrow" style="color:var(--danger)">${opts.name}</div>
        <h2 class="display">${heading}</h2>
        <p class="muted" style="margin:2px 0 0">${why}</p>
        <div class="ce__cols">${stats}</div>
        <div class="ce__btns">
          <button class="btn btn--primary btn--lg btn--block" data-action="contract-retry">↻ Try Again</button>
          <button class="btn btn--secondary btn--block" data-action="contracts">Contract Board</button>
        </div>
      </div>
    </div>`;
  }

  // Spare launches are the only skill expression left once it's cleared, so
  // they're called out — it's what makes replaying a paid Contract interesting.
  // A pattern Contract has no spare by construction, so clearing one at all IS
  // the flourish and the copy says that instead.
  const spare = pattern ? 0 : opts.launches - opts.launchesUsed;
  // Three outcomes, three chips: the clear COMPLETED the tier (the salvage
  // moment — celebrate it), the clear ticked tier progress (say what's still
  // missing), or it was a replay (free practice, nothing moved).
  const p = opts.progress;
  const reward =
    opts.award?.firstClear && opts.award.completedTier !== null
      ? `<div class="chip" style="border-color:var(--success);gap:2px;padding:12px 14px">
         <div class="chip__label" style="color:var(--success)">Tier ${opts.award.completedTier} complete!</div>
         <div class="chip__value" style="color:var(--warn);font-size:var(--fs-h2)">♻ +${opts.award.salvage}</div>
         <div class="muted" style="font-size:var(--fs-sm)">${opts.salvageTotal} banked · Tier ${p.tier} is open · spend it in the Workshop</div>
       </div>`
      : opts.award?.firstClear
        ? `<div class="chip" style="border-color:var(--accent);gap:2px;padding:12px 14px">
         <div class="chip__label" style="color:var(--accent)">Tier ${p.tier} · Contracts ${p.contracts}/${p.needed}</div>
         ${
           opts.award.salvage > 0
             ? `<div class="chip__value" style="color:var(--warn)">♻ +${opts.award.salvage}</div>
         <div class="muted" style="font-size:var(--fs-sm)">Milestone banked — ${opts.salvageTotal} salvage total, spend it in the Workshop.</div>`
             : ""
         }
         <div class="muted" style="font-size:var(--fs-sm)">${
           p.contracts >= p.needed
             ? `Contracts done — ${p.runDone ? "" : "beat the Deep Run to "}complete the tier (♻ ${p.award} total per tier).`
             : `${p.needed - p.contracts} more Contract${p.needed - p.contracts === 1 ? "" : "s"}${p.runDone ? "" : " and the Deep Run"} to complete the tier (♻ ${p.award} total per tier).`
         }</div>
       </div>`
        : `<div class="chip" style="gap:2px;padding:12px 14px">
         <div class="chip__label">Already logged</div>
         <div class="muted" style="font-size:var(--fs-sm)">This Contract counted on your first clear. Replays are free practice.</div>
       </div>`;

  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--contract-end pop">
      <div class="eyebrow" style="color:var(--success)">${opts.name} · cleared</div>
      <h2 class="display neon-text" style="color:var(--success)">
        ✓ Contract Complete
      </h2>
      <p class="muted" style="margin:2px 0 0">
        ${
          pattern
            ? `${opts.goal} lines from the exact manifest — <b>nothing wasted</b>.`
            : `${opts.goal} lines delivered${spare > 0 ? ` with <b>${spare}</b> launch${spare === 1 ? "" : "es"} to spare` : ""}.`
        }
      </p>
      <div class="ce__cols">${stats}<div class="ce__reward">${reward}</div></div>
      <div class="ce__btns">
        ${
          opts.boardComplete
            ? `<button class="btn btn--primary btn--lg btn--block" data-action="workshop">Workshop →</button>`
            : opts.nextContract
              ? `<button class="btn btn--primary btn--lg btn--block" data-action="contract-next">Next: ${opts.nextContract.name} →</button>`
              : `<button class="btn btn--primary btn--lg btn--block" data-action="contracts">Contract Board →</button>`
        }
        <button class="btn btn--secondary btn--block" data-action="contracts">Contract Board</button>
        <button class="btn btn--secondary btn--block" data-action="contract-retry">↻ Play Again</button>
      </div>
    </div>
  </div>`;
}
