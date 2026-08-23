import { PIECE_COLORS, PIECE_TYPES, shipmentColor } from "../game/theme";
import type { LossReason } from "../game/game";
import { LEVEL_1 } from "../game/level";
import { RUN_LEVELS, SCORE_PER_BAY, SCORE_PER_LINE } from "../game/run";
import {
  toggleHTML, pieceCellsHTML, formatMMSS, beltPieceHTML, beltBombHTML, beltSealedHTML,
  runNotchTallyHTML, shipPlatesHTML,
} from "./components";
import { icon, type IconName } from "./icons";
import {
  MAX_TIER, UPGRADES, budgetForMark, nextTierCost, refitTracks, tiersCost, upgradeById,
  type UpgradeTiers,
} from "../game/upgrades";
import {
  UNLOCKS, unlockAvailable, unlockGates, INSTALLS, installAvailable, installGates,
  installById, markBudget, tierMilestoneSalvage, tierProgressFor,
  type MetaState, type NextStepId, type TierProgress,
} from "../game/meta";
import { DAILY_COUNT } from "../game/contracts";
import type { Settings } from "../lib/store";
import type { ScoreEntry } from "../lib/api";
import type { BeltPreview } from "../game/game";
import type { PieceSize, PieceType } from "../game/theme";
import {
  HAZARDS, totalNotches, type HazardDef, type HazardId, type Ratchets,
} from "../game/hazards";
import {
  ACTION_LABELS, BINDABLE_ACTIONS, hintAim, hintRotate, keyFor, keyLabel, padFor, padLabel,
  type BindableAction, type InputProfile,
} from "../game/bindings";
import type { PreviewRow } from "../game/preview";

/* ---------------------------------------------------------------------------
 * TIER PLATE — one component at three sizes (canvas A1/A4/C · A15's note):
 * 58x52 in the Deep Run menu button, 26px on the run-end primary, 11px in the
 * bay banner. The pixel TIER label with the mono number, always the same two
 * parts, so the ladder has ONE face wherever it shows up.
 * ------------------------------------------------------------------------ */
export function tierPlateHTML(tier: number, size: "menu" | "button" | "banner"): string {
  return `<span class="tier-plate tier-plate--${size}" aria-label="Tier ${tier}"><span class="tier-plate__lbl">Tier</span><span class="tier-plate__n">${tier}</span></span>`;
}

/* ---------------------------------------------------------------------------
 * THE TWO CURRENCIES. Both used to print as the ♻ character — the same emoji
 * for scrap and for salvage, side by side on the refit chip and the workshop
 * chip and on both shops' price buttons. That is not a styling slip: the whole
 * point of the pair is that one dies with the run and the other never does, and
 * a shared glyph says the opposite. Every amount now goes through one of these
 * two, so a number cannot reach the screen without saying which pocket it comes
 * out of, and the glyph is drawn (icons.ts) rather than typed — the ♻ emoji
 * could not take the warm colour these readouts wear, and its metrics moved per
 * platform.
 *
 * inline-flex (see .currency) so the same call works in a chip, on a button
 * and mid sentence, and so the glyph can never wrap away from its number.
 * ------------------------------------------------------------------------ */
/** Salvage: banked at tier milestones, spent in the Workshop, kept forever. */
export function salvageHTML(amount: string | number = "", size = 12): string {
  return `<span class="currency">${icon("salvage", size)}${amount}</span>`;
}
/** Scrap: 2/line and 10/bay, spent at the refit yard, gone when the run ends. */
export function scrapHTML(amount: string | number = "", size = 12): string {
  return `<span class="currency">${icon("scrap", size)}${amount}</span>`;
}

/** The NEXT STEP badge (canvas A3): ONE surface ever carries it, computed by
 *  meta.ts's nextStep — this is just the chip. */
export function nextBadgeHTML(label = "Next step"): string {
  return `<span class="next-badge">${label}</span>`;
}

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
 *  the store entry point hides itself rather than offering a dead button.
 *  `guide` carries the first-session system (canvas A2/A3): which action
 *  holds the ONE NEXT STEP badge, the live numbers the subtitles state the
 *  offer in, and whether the Guided Tutorial entry is still owed. */
export function menuScreen(
  best: number,
  salvage = 0,
  store?: StoreState,
  progress?: TierProgress,
  guide?: {
    step: NextStepId;
    install: { name: string; cost: number } | null;
    firstLaunch: boolean;
  },
  /** True only in a build that compiled the developer sandbox in (see
   *  lib/sandbox.ts). Adds a plainly visible entry button.
   *
   *  Plainly visible, and that is on purpose. A hidden gesture would be
   *  protecting against something the build gate already prevents — the whole
   *  screen is absent from every shippable bundle, and
   *  scripts/verify-store-bundle.mjs fails the build if it is not. What a
   *  secret entry WOULD reliably do is make the tool hard to find on a phone,
   *  fight the menu's own decoration (the wordmark is pointer-events: none by
   *  design), and be untestable. So: a button. */
  sandbox = false,
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
            <div class="chip__value" style="color:var(--warn)">${salvageHTML(salvage, 16)}</div>
          </div>
          ${store?.unlimited ? unlimitedBadgeHTML() : ""}
          ${store?.available && !store.unlimited ? unlockChipHTML() : ""}
          ${sandbox ? sandboxChipHTML() : ""}
        </div>
      </div>
      <div class="menu__actions">
        <!-- Plain-language subtitles under the thematic names (playtest
             feedback: "Deep Run", "Contracts" and "Workshop" mean nothing to
             a new player until each is explained). The subtitles state the
             offer in LIVE numbers (A3), the Deep Run button carries the tier
             plate (A1 — the plate takes the icon slot), and exactly one
             button ever wears the NEXT STEP badge (meta.ts's nextStep). -->
        <button class="btn btn--primary btn--lg btn--block btn--menu${guide?.step === "run" ? " btn--next" : ""}" data-action="play">${
          progress ? tierPlateHTML(progress.tier, "menu") : icon("play")
        }<span class="btn__txt">Deep Run<span class="btn__sub">Clear ${RUN_LEVELS} bays${progress ? ` at Tier ${progress.tier}` : ""} in one run</span></span>${guide?.step === "run" ? nextBadgeHTML() : ""}</button>
        <button class="btn btn--secondary btn--block btn--menu${guide?.step === "contracts" ? " btn--next" : ""}" data-action="contracts">${icon("contracts")}<span class="btn__txt">Contracts<span class="btn__sub">${
          // Numbers lead (A3): at compact the sub is one ellipsized line, so
          // the live figures must sit before the prose that can afford to go.
          progress
            ? `${DAILY_COUNT} today · ${salvageHTML(progress.milestone, 10)} each · no clock, no launch cost`
            : "Short challenges · retry freely"
        }</span></span>${guide?.step === "contracts" ? nextBadgeHTML() : ""}</button>
        <button class="btn btn--secondary btn--block btn--menu${guide?.step === "workshop" ? " btn--next" : ""}" data-action="workshop">${icon("workshop")}<span class="btn__txt">Workshop<span class="btn__sub">${
          guide
            ? guide.install
              ? salvage >= guide.install.cost
                ? `${salvageHTML(salvage, 10)} — ${guide.install.name} costs ${salvageHTML(guide.install.cost, 10)}`
                : `${salvageHTML(salvage, 10)} — Contracts pay salvage`
              : `${salvageHTML(salvage, 10)} banked`
            : "Spend Salvage on permanent unlocks"
        }</span></span>${guide?.step === "workshop" ? nextBadgeHTML() : ""}</button>
        ${
          // A2: on first launch the Guided Tutorial takes How to Play's slot,
          // badged START HERE — it supersedes the manual for a player who has
          // never fired a shot, and the column stays six rows at every
          // density (a seventh row overflows a 360dp phone by 70px). Once the
          // coach is finished or skipped the entry disappears and How to Play
          // returns, keeping the guided replay.
          guide?.firstLaunch
            ? `<button class="btn btn--secondary btn--block btn--menu btn--next" data-action="tutorial">${icon("howto")}<span class="btn__txt">Guided Tutorial<span class="btn__sub">Learn the cannon in one bay</span></span>${nextBadgeHTML("Start here")}</button>`
            : `<button class="btn btn--secondary btn--block" data-action="howto">${icon("howto")}How to Play</button>`
        }
        <button class="btn btn--secondary btn--block" data-action="leaderboard">${icon("leaderboard")}Leaderboard</button>
        <!-- Nothing is a seventh button here — not the Unlimited upsell, and not
             the developer sandbox. This column gets 325px on a landscape phone
             and six buttons need 290; a seventh needs 330 and overflows the
             viewport, which costs the LAST row rather than its own — the
             sandbox build put Settings off the bottom of a 360dp phone exactly
             this way. Both extra entries live in the brand column's chip row
             instead (unlockChipHTML / sandboxChipHTML), which wraps, so this
             column is six buttons in every build and at every entitlement
             state. -->
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

/** The pre-purchase counterpart to the badge above, in the same chip row.
 *  A real `.btn` (B1: a chip is a readout — something pressable is a button),
 *  restyled by `.chip--cta` to sit in the status strip rather than reading as
 *  a seventh menu action. See the note in menuScreen's action column for why
 *  it isn't one. */
function unlockChipHTML(): string {
  return `<button class="btn chip--cta" data-action="paywall">${icon("star", 12)}Unlock Unlimited</button>`;
}

/** The developer sandbox's entry, in the chip row rather than the action column
 *  — see the note there on why that column is six buttons and no more. Only
 *  rendered by a build that compiled the sandbox in (lib/sandbox.ts). */
function sandboxChipHTML(): string {
  return `<button class="btn chip--cta" data-action="sandbox">⚙ Sandbox</button>`;
}

export function howtoScreen(): string {
  const steps = [
    ["01", "Aim & charge", `<b>Pull back</b> like a slingshot — the shot fires <b>opposite</b> your drag, and <b>distance sets the power</b>. Release to fire. On desktop use <span class="kbd">${keyLabel(keyFor("aimUp"))}</span><span class="kbd">${keyLabel(keyFor("aimDown"))}</span> to aim, <span class="kbd">${keyLabel(keyFor("powerDown"))}</span><span class="kbd">${keyLabel(keyFor("powerUp"))}</span> for power.`],
    ["02", "Rotate the piece", `Pieces turn in crisp <b>90° steps</b> — tap <span class="kbd">${keyLabel(keyFor("rotl"))}</span><span class="kbd">${keyLabel(keyFor("rotr"))}</span> or the <span class="kbd">⟲</span>/<span class="kbd">⟳</span> buttons. The glowing piece at the cannon shows the exact orientation before you fire; the conveyor belt carries the piece coming <b>after</b> it.`],
    ["03", "Watch the arc", `The dotted parabola previews exactly where the piece flies. Pieces are joined by breakable joints — hard hits shatter them.`],
    ["04", "Fill the rows", `Land enough cubes in a row on the right of the compactor to complete a full straight line.`],
    ["05", "The compactor", `The red bar sweeps right, <b>shattering pieces into loose cubes</b> and compacting them. Cubes only vanish when they form a complete line — so don't let the stack reach the top.`],
    ["06", "Mind the bankroll", `Every launch costs <b>$${LEVEL_1.launchCost}</b>, and a full line pays out <b>$${LEVEL_1.scorePerLine}</b>. Cargo that drops out short of the compactor is <b>fined $${LEVEL_1.penaltyPerLostPiece} a cube</b> — a red −$ marks the spot. Reach <b>$${LEVEL_1.targetScore}</b> before the bankroll runs dry <b>or the clock hits zero</b>. Watch the <b>Launches</b> readout — it turns red at ${LOW_LAUNCH_WARN} or fewer, and that's when a shot has to count.`],
    ["07", "Three currencies", `<b>Funds ($)</b> pay for launches and are the bay's own target. <b>Scrap (${scrapHTML()})</b> is earned per line and spent on your ship at refit stops. <b>Salvage (${salvageHTML()})</b> is banked at tier milestones — each first-clear Contract and your first run win at a tier pays a share — and buys permanent unlocks in the Workshop.`],
    ["08", "Refit the rig", `The compactor is your ship. After bays <b>3, 6 and 9</b> you dock and spend scrap on six systems — a <b>wider bay</b>, <b>launcher coils</b> (more power and a wind stabilizer), <b>hydraulics</b>, <b>magazine</b>, <b>reactor</b>, <b>bond emitter</b>. Three tiers each; they last the whole run.`],
    ["09", "Run the gauntlet", `Ten bays deep, each with a rising target and stiffer joints. Clear one and <b>ratchet a difficulty axis</b> — you pick which of the two on offer, and it sticks for the rest of the run. The axis you are equipped for is the one that costs you nothing. Go broke or run out the clock and the run ends there.`],
  ];
  return `<div class="screen neon-backdrop">
    <div class="howto">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div class="eyebrow">Briefing</div><h2 class="display" style="font-size:var(--fs-h1)">How to Play</h2></div>
        <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
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
        <button class="btn btn--primary btn--lg" data-action="play">${icon("play")}Start Run</button>
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
export function settingsScreen(
  s: Settings,
  store?: StoreState,
  /** Whether haptics can do anything on this platform (lib/platform's
   *  hapticsSupported). iOS Safari and the iOS PWA have no
   *  navigator.vibrate, so the toggle there was a switch wired to nothing —
   *  it hides instead. Defaults on so headless callers keep the full panel. */
  hapticsAvailable = true,
): string {
  return `<div class="screen neon-backdrop center">
    <div class="panel modal modal--settings pop">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 class="display" style="font-size:var(--fs-h1)">Settings</h2>
        <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="split settings__cols">
        <div class="settings__toggles">
          ${toggleHTML("sound", "Sound FX", "Launch, impact & line-clear cues", s.sound)}
          ${toggleHTML("music", "Music", "Ambient synth soundtrack", s.music)}
          ${hapticsAvailable ? toggleHTML("haptics", "Haptics", "Vibration feedback on mobile", s.haptics) : ""}
        </div>
        <div class="settings__actions">
          <button class="btn btn--secondary btn--block" data-action="controls">Controls</button>
          ${store?.available ? purchaseRowsHTML(store) : ""}
          <button class="btn btn--secondary btn--block" data-action="menu">Done</button>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * CONTROLS (canvas D1) — Settings → Controls: three input families on the
 * Workshop's tab pattern, every binding a row, keyboard and gamepad
 * rebindable with a live press-a-key capture state (main.ts drives the
 * capture; this only renders it). Bindings are read live from
 * game/bindings.ts — the same table the hints render from (D2), so a row
 * here and a hint in the coach can never disagree.
 */
export type ControlsTab = "touch" | "keyboard" | "gamepad";

export function controlsScreen(opts: {
  tab: ControlsTab;
  settings: Settings;
  /** Detected gamepad id, or null — browsers hide pads until a button is
   *  pressed, and the pane says so instead of reading as broken. */
  padName: string | null;
  /** The action currently capturing a rebind, if any. */
  rebinding: BindableAction | null;
}): string {
  const tabBtn = (id: ControlsTab, label: string) =>
    `<button class="workshop__tab${opts.tab === id ? " workshop__tab--on" : ""}" role="tab" data-action="controls-tab" data-tab="${id}" aria-selected="${opts.tab === id}">${label}</button>`;

  const bindRow = (a: BindableAction, label: string): string => {
    const capturing = opts.rebinding === a;
    return `<div class="bind-row${capturing ? " bind-row--capturing" : ""}">
      <span class="bind-row__label">${ACTION_LABELS[a]}</span>
      <span class="bind-row__key">${capturing ? (opts.tab === "gamepad" ? "Press a button…" : "Press a key…") : label}</span>
      <button class="btn btn--ghost bind-row__btn" data-action="rebind" data-bind="${a}">${capturing ? "Cancel" : "Rebind"}</button>
    </div>`;
  };
  const infoRow = (label: string, value: string): string =>
    `<div class="bind-row bind-row--info">
      <span class="bind-row__label">${label}</span>
      <span class="bind-row__key">${value}</span>
    </div>`;

  let pane = "";
  if (opts.tab === "touch") {
    pane = `${infoRow("Aim & fire", "drag anywhere · release fires")}
      ${infoRow("Cancel a launch", "second finger taps ✕")}
      ${infoRow("Rotate", "⟲ / ⟳ on the rail")}
      ${infoRow("Abilities", "rail buttons · plant chips")}
      ${toggleHTML("leftHandRail", "Left-handed rail", "Mirror the button rail to the left edge", opts.settings.leftHandRail)}`;
  } else if (opts.tab === "keyboard") {
    pane = BINDABLE_ACTIONS.map((a) => bindRow(a, keyLabel(keyFor(a)))).join("");
  } else {
    pane = `${infoRow("Detected", opts.padName ?? "No gamepad — press any button on one")}
      ${infoRow("Aim & power", "left stick · deflection sets power")}
      ${BINDABLE_ACTIONS.map((a) => bindRow(a, padLabel(padFor(a)))).join("")}
      ${toggleHTML("stickAssist", "Stick aiming assist", "Smooth the stick so the arc doesn't jitter", opts.settings.stickAssist)}`;
  }

  return `<div class="screen neon-backdrop">
    <div class="controls">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><div class="eyebrow">Settings</div><h2 class="display" style="font-size:var(--fs-h1)">Controls</h2></div>
        <button class="icon-btn" data-action="settings" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div class="workshop__tabs" role="tablist">
        ${tabBtn("touch", "Touch")}
        ${tabBtn("keyboard", "Keyboard")}
        ${tabBtn("gamepad", "Gamepad")}
      </div>
      <div class="controls__pane" id="controls-grid" role="tabpanel" data-scroll>${pane}</div>
      <div class="row" style="justify-content:center">
        <button class="btn btn--primary" data-action="settings">Done</button>
        ${opts.tab === "touch" ? "" : `<button class="btn btn--ghost" data-action="controls-reset">Reset ${opts.tab}</button>`}
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
        <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
      </div>
      <div id="lb-body" data-scroll>${rows}</div>
      <button class="btn btn--primary" data-action="play">${icon("play")}Play</button>
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

/** The transport's direction cue: eight CSS-drawn chevrons marching toward the
 *  cannon (see app.css's .belt__arrows). Eight, and elements rather than the
 *  "▸ ▸ ▸ ▸" text run this replaces, because the strip is twice the track wide
 *  and loops by scrolling exactly half its own width: with equal flex cells
 *  the seam lands chevron-on-chevron at any size on any device, which a text
 *  run's advance width cannot promise. (That run was drawing from a platform
 *  fallback anyway — U+25B8 is outside the bundled JetBrains Mono's
 *  unicode-range.)
 *
 *  `--i` is the cell's index, which app.css turns into a staggered start for
 *  the pulse that runs up the strip toward the cannon. */
const BELT_ARROWS = Array.from({ length: 8 }, (_, i) => `<i style="--i:${i}"></i>`).join("");

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
   *  tally in the plant panel (see components.ts's runNotchTallyHTML). */
  ratchets: Ratchets;
  /** The run's bought ship upgrade tiers — rendered as tier-pip plates
   *  (components.ts's shipPlatesHTML). */
  tiers: UpgradeTiers;
  /** The run's tier, for the bay banner's plate (canvas A4). Null in
   *  Contract mode, whose banner names the Contract instead. */
  tier?: number | null;
  /** The active input family (D2): the hint strip renders its bindings from
   *  this. main.ts re-patches the strip when the profile flips mid-bay. */
  profile?: InputProfile;
  /** What the cannon is HOLDING — the transport's first queue slot (canvas
   *  A5's two-deep read: loaded full-size, next behind it). The canvas draws
   *  the same piece at the muzzle; the housing is where it reads as a queue. */
  loaded?: BeltPreview | null;
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
    tier, loaded, contract,
  } = opts;
  // An empty belt is the honest render for the last shipment of a finite queue
  // — there IS no next piece, and drawing one would promise a shot that never
  // comes (see game.ts's BeltPreview.empty).
  const beltNextHTML = beltPreview.bomb
    ? beltBombHTML()
    : beltPreview.empty
      ? ""
      : beltPreview.hidden
        ? beltSealedHTML()
        : beltPieceHTML(beltPreview.type, beltPreview.quarterTurns, pieceSize, beltPreview.material);
  // The transport LIGHTS UP in the colour of what it is carrying (see
  // app.css's --belt-c): the marching arrows, the outfeed and the track's
  // inner glow all read it, so "what is coming" is legible from the belt
  // itself at a glance — which is the job the "NEXT" caption used to do
  // before the tiles grew into it on phones. Seeded here so the first paint
  // is already right; main.ts re-sets it whenever the queue advances.
  //
  // A SEALED shipment takes the neutral wash instead (see beltSealedHTML).
  // Every piece type has its own colour, so a belt glowing orange for a sealed
  // crate would name the L inside it, and the Blackout variant would be a lid
  // on a box with the answer painted down the side of it.
  const beltAccent = beltPreview.bomb
    ? "var(--danger)"
    : beltPreview.empty || beltPreview.hidden
      ? "var(--text-faint)"
      : shipmentColor(beltPreview.type, beltPreview.material);
  const beltLoadedHTML = !loaded
    ? ""
    : loaded.bomb
      ? beltBombHTML()
      : loaded.empty
        ? ""
        : beltPieceHTML(loaded.type, loaded.quarterTurns, pieceSize, loaded.material);
  // A5's size tag: the shipment class this bay runs on, said in one word at
  // the housing. Dropped at compact density (the phone rule) — the tile's own
  // cube count already carries the read there.
  const sizeTag = pieceSize === "tiny" ? "Micro" : pieceSize === "bulk" ? "Bulk" : "Std";
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
        <span class="g">${icon("bond", 15)}</span><span class="nm">BOND BRK</span><span class="stk">×<span class="bond-trigger__count">${bondCharges}</span></span><span class="key">B</span>
      </button>`
    : "";
  const bondRailBtn = bondBreakerOwned
    ? `<button class="icon-btn bond-btn bond-trigger" data-game="bond" id="bond-btn" aria-label="Bond Breaker — shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>${icon("bond", 20)}<span class="bond-btn__count bond-trigger__count">${bondCharges}</span></button>`
    : "";
  const demoChip = demoOwned
    ? `<button class="mod mod--demo demo-trigger" data-game="demo" id="demo-chip" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>
        <span class="g">${icon("demo", 15)}</span><span class="nm">DEMO</span><span class="stk">×<span class="demo-trigger__count">${bombCharges}</span></span><span class="key">X</span>
      </button>`
    : "";
  const demoRailBtn = demoOwned
    ? `<button class="icon-btn demo-btn demo-trigger" data-game="demo" id="demo-btn" aria-label="Arm a demolition charge"${bombCharges <= 0 ? " disabled" : ""}>${icon("demo", 20)}<span class="demo-btn__count demo-trigger__count">${bombCharges}</span></button>`
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
    : `<div class="bay-banner" role="status" aria-label="Bay ${bayNum} of ${RUN_LEVELS}${tier ? `, tier ${tier}` : ""}">
        ${tier ? tierPlateHTML(tier, "banner") : ""}
        <span class="bay-banner__mode">Bay</span>
        <span class="bay-banner__n">${bayNum}<span class="bay-banner__of">/${RUN_LEVELS}</span></span>
        <span class="bay-banner__pips" aria-hidden="true">${Array.from(
          { length: RUN_LEVELS },
          (_, i) => `<i class="${i + 1 < bayNum ? "done" : i + 1 === bayNum ? "cur" : ""}"></i>`,
        ).join("")}</span>
      </div>`;
  return `<div class="hud${contract ? " hud--contract" : ""}" id="hud">
    <!-- button rail: ONE same-width column of four base buttons — fullscreen,
         pause, rotate CCW/CW — plus a slot per drafted ability (Bond Breaker,
         Demolition, Autoloader). Where it SITS is decided by the layout solver
         (game/layout.ts): in the right letterbox gutter when one is wide
         enough, in a reserved right band on near-16:9 viewports where there is
         no natural gutter, or as a horizontal strip in the bottom band when the
         column genuinely cannot fit (see app.css's [data-layout] rules). The
         solver budgets the column for the buttons ACTUALLY here (main.ts's
         hudOpts feeds railSlotsFor), which is what keeps the vertical rail on
         360dp landscape phones. The column is TOP-ANCHORED, so the base four
         keep the same screen positions whether or not a run has drafted any
         abilities — ⟲/⟳ are the third and fourth button, always, and drafting
         Bond Breaker mid-run grows the rail downward instead of sliding the
         rotate pair out from under a thumb. There's no keyboard on mobile, so
         this rail IS the touch control surface. The aim-state
         cancel ✕ is only visible mid-drag (main.ts's syncHud toggles
         .hud--aiming) and does NOT own a slot: it swaps into the pause
         button's slot (a CSS order pair — it is last in the DOM but renders
         second), so nothing below it moves under a hovering thumb; a second
         finger taps it to abort the queued launch. Rotate taps mid-drag do NOT cancel (see input.ts).
         Desktop hides the game buttons and uses Q/E + B/X instead (see the
         @media (pointer: fine) rule in app.css), per the kbd-hint strip down
         in .hud__bottom. -->
    <div class="side-rail">
      <button class="icon-btn" id="fullscreen-btn" data-action="fullscreen" aria-label="Fullscreen">${icon("fullscreen", 22)}</button>
      <button class="icon-btn" data-action="pause" aria-label="Pause">${icon("pause", 22)}</button>
      <button class="icon-btn rotate-btn" data-game="rotl" aria-label="Rotate left">${icon("rotl", 22)}</button>
      <button class="icon-btn rotate-btn" data-game="rotr" aria-label="Rotate right">${icon("rotr", 22)}</button>
      ${bondRailBtn}
      ${demoRailBtn}
      ${autoRailBtn}
      <button class="icon-btn cancel-aim-btn" data-game="cancel" aria-label="Cancel launch">${icon("close", 22)}</button>
    </div>

    ${bayBanner}

    <!-- INFEED TRANSPORT (canvas A5, proposal A "infeed housing"): the feed
         head takes hazard stripes, the tread and its chevrons animate toward
         the cannon, and the queue reads TWO deep — the piece the cannon is
         HOLDING at the downhill (muzzle) end, the piece coming after it
         uphill, both opaque and both on top of the transport. Real queue data,
         not a mockup:
         components.ts's beltPieceHTML renders the exact shape/rotation/
         material, and the MATERIAL_SPEC colour makes cryo/slag legible before
         firing. The size tag names the bay's shipment class; compact drops it
         (A5's phone rule), and the whole transport hides under the coach card
         at compact (A6 — see app.css).

         There is no "◂ NEXT" caption any more. It sat above the track between
         the two tiles, and on a phone the tiles closed on it: the belt scales
         with the field but the caption and the tiles bottom out on their
         max() floors, so the gap between them shrank past what the words
         needed (70px of gap for 61px of label at 1280; 34px for 43px at 667)
         and the tiles painted over it. The transport says the same thing
         without words now — chevrons marching at the cannon, lit in the
         colour of the shipment they are carrying. -->
    <div class="belt" aria-label="Shipment feed" id="hud-belt" style="--belt-c:${beltAccent}">
      <span class="belt__feed" aria-hidden="true">Feed</span>
      <div class="belt__track"><div class="belt__tread"></div>
        <span class="belt__arrows" aria-hidden="true">${BELT_ARROWS}</span>
      </div>
      <div class="belt__roller belt__roller--l"><i></i></div>
      <div class="belt__roller belt__roller--r"><i></i></div>
      <div class="belt-piece belt-piece--next" id="hud-next">${beltNextHTML}</div>
      ${loaded ? `<div class="belt-piece belt-piece--loaded" id="hud-loaded">${beltLoadedHTML}</div>` : ""}
      <span class="belt__tag" aria-hidden="true">${sizeTag}</span>
    </div>

    <!-- the RECYCLING PLANT: PWR bar, the readout tiers described above, and
         the run's build (drafted mods, ship plates, abilities). -->
    <div class="plant">
      <div class="pl-pwr"><span class="lbl">PWR</span>
        <div class="pl-pwr__track"><div class="pl-pwr__fill" id="hud-power"></div></div>
        <span class="pl-pwr__val" id="hud-power-val">0%</span>
      </div>
      <div class="plant__body">
        <!-- NO TITLE ROW. "Recycling Plant" named the panel to a player who
             was already looking at it, and the bay banner across the top of
             the field carries the only naming a bay needs (tier, bay N/10,
             and in Contract mode the contract's name). The row went the way
             the bay position that used to trail the title went, and for the
             same reason: a second, quieter telling of a fact already told
             louder is the half worth dropping. What went with it — three
             decorative rivets that were the title's counterweight — was the
             row's whole remaining content, and a row of three dots is not a
             readout. Every row left in the panel is a live number. -->
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
          ${
            contract?.kind === "pattern"
              ? ""
              : `<span class="pl-meta__sep">·</span><span class="pl-meta__launch" id="hud-launch">Launch $${launchCost}</span>`
          }
          <span class="pl-meta__sep">·</span>
          <span>Scrap <b id="hud-scrap">0</b></span>
        </div>
        ${
          // The remaining manifest gets its OWN row rather than riding the
          // meta line: the tally is the widest thing the plant can hold (six
          // piece types × "I×3"), and inline it wrapped the meta line onto a
          // second and third line — which is what pushed the panel past its
          // design box on the tightest inset device (iPhone 13 mini). A row
          // can scroll its tail horizontally; a wrapped line can only grow.
          contract?.kind === "pattern"
            ? `<div class="pl-queue"><span class="lbl">Left</span><b id="hud-queue">${queueTallyHTML(contract.remaining)}</b></div>`
            : ""
        }
        ${
          // NOTCHES — the run's ratcheted axes, one dense line, and only in
          // Deep Run: a Contract has no ratchets at all (main.ts's
          // startContract nulls `run`, and the axes live on the run), so the
          // row would be a permanent em-dash there. That is also what keeps
          // the contract grid templates honest — they name no `notch` area,
          // and an area with nothing in it costs its share of the row gap.
          //
          // Rendered on EVERY Deep Run bay including the first, where it reads
          // "—". A row that appears the moment the first notch lands would
          // shift every row above it mid-run, and the panel has the ~9px this
          // costs: measured free space inside the panel's design box is 18.6px
          // on an iPhone 13 mini, the tightest in the matrix.
          contract
            ? ""
            : `<div class="pl-notch"><span class="lbl">Notches</span><b id="hud-notches">${runNotchTallyHTML(ratchets)}</b></div>`
        }
        <!-- Build row: ABILITY chips first, then the ship rack. The rack is
             seven fixed slots and all seven fit without scrolling on every
             device (components.ts's shipPlatesHTML, and the harness's "rack"
             assertion). The row keeps its horizontal scroll for the ability
             chips at roomy density, where the vertical BUILD tag and two 88px
             chips lead the row — but nothing informational hides behind it
             any more. The ratchet chips that used to trail the rack are the
             notch line above: they could not fit beside seven slots at any
             legible size, and a notch behind a scroll is a notch the player
             does not know they took. -->
        <div class="pl-mods" id="hud-mods">
          <span class="lbl">Build</span>
          ${bondChip}
          ${demoChip}
          ${plates}
        </div>
      </div>
    </div>

    <div class="hud__bottom">
      ${hintStripHTML(opts.profile ?? "keyboard", { bond: bondBreakerOwned, demo: demoOwned, auto: autoloaderOwned })}
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

/**
 * The HUD's input-hint strip (D2): rendered FROM the live bindings per
 * profile, never hardcoded — a rebound key changes the strip, and the
 * gamepad family gets its own strip (CSS shows it whenever the profile is
 * gamepad, whatever the pointer type). Touch renders the keyboard strip's
 * content — the strip itself is hidden on coarse pointers, where the rail is
 * the control surface.
 */
export function hintStripHTML(
  profile: InputProfile,
  owned: { bond: boolean; demo: boolean; auto: boolean },
): string {
  const kbd = (s: string) => `<span class="kbd">${s}</span>`;
  const sep = `<span class="kbd-hint__sep">·</span>`;
  const parts: string[] = [];
  if (profile === "gamepad") {
    parts.push(`${kbd(padLabel(padFor("rotl")))}/${kbd(padLabel(padFor("rotr")))} rotate`);
    parts.push(`${kbd("Stick")} aim + power`);
    parts.push(`${kbd(padLabel(padFor("fire")))} fire`);
    if (owned.bond) parts.push(`${kbd(padLabel(padFor("bond")))} break bonds`);
    if (owned.demo) parts.push(`${kbd(padLabel(padFor("demo")))} arm charge`);
    if (owned.auto) parts.push(`${kbd(padLabel(padFor("auto")))} hold to autofire`);
    parts.push(`${kbd(padLabel(padFor("pause")))} pause`);
  } else {
    parts.push(`${kbd(keyLabel(keyFor("rotl")))}/${kbd(keyLabel(keyFor("rotr")))} rotate`);
    parts.push(`${kbd(keyLabel(keyFor("aimUp")))}/${kbd(keyLabel(keyFor("aimDown")))} aim`);
    parts.push(`${kbd(keyLabel(keyFor("powerDown")))}/${kbd(keyLabel(keyFor("powerUp")))} power`);
    parts.push(`${kbd(keyLabel(keyFor("fire")))} fire`);
    if (owned.bond) parts.push(`${kbd(keyLabel(keyFor("bond")))} break bonds`);
    if (owned.demo) parts.push(`${kbd(keyLabel(keyFor("demo")))} arm charge`);
    if (owned.auto) parts.push(`${kbd(keyLabel(keyFor("auto")))} hold to autofire`);
    parts.push("drag to aim");
  }
  return `<div class="kbd-hint" aria-hidden="true">${parts.join(`\n        ${sep}\n        `)}</div>`;
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
 *  THIS bay's economy, not a stale example — and the GESTURE copy renders
 *  through the one hint table (D2, game/bindings.ts) per input family, so
 *  the coach can never tell a desktop player to tap a button that
 *  `pointer: fine` hides (which is exactly what it used to do).
 *
 *  EVERY BODY HERE IS HEIGHT-BUDGETED, and the budget is small enough to be
 *  a real constraint on the writing. The card shares the plant panel's column
 *  with the readout under a hard cap (52% of the field height — see app.css's
 *  `.hud[data-coach] .plant`), so a sentence that overruns does not push the
 *  panel: it pushes its own tail out of `.coach__body`, and the player reads
 *  a card ending mid-word. That is what the resources card did — 58px of
 *  hidden text on a 640x360 phone, with "that clears the bay" sliced through
 *  the middle — and it is the LAST card, whose last clause is the one that
 *  says how to win.
 *
 *  So the copy is trimmed to what the step cannot teach without: the economy
 *  card names the four figures and the two ways a bay ends, and the flourish
 *  it used to carry ("you'll see the red −$ where it vanished") lives on in
 *  How to Play's card 06, which has a whole card to spend on it. The harness
 *  asserts the result rather than trusting it — `.coach__body` is no longer
 *  an allowed scroller, and all four steps are fixtures (sim/uifit), so copy
 *  that outgrows the card fails CI instead of shipping half-read. */
export function coachSteps(level: {
  launchCost: number;
  scorePerLine: number;
  targetScore: number;
  penaltyPerLostPiece: number;
}, profile: InputProfile = "touch"): CoachStep[] {
  return [
    {
      title: "Aim & fire",
      body:
        profile === "touch"
          ? `<b>Pull back</b> anywhere on the field, like a slingshot — the cannon aims opposite, farther for <b>more power</b>. <b>Release to fire</b> along the dotted arc.`
          : `<b>${hintAim(profile)[0].toUpperCase()}${hintAim(profile).slice(1)}.</b> The dotted arc is exactly where the shipment flies.`,
    },
    {
      title: "Rotate",
      body: `Between shots, <b>${hintRotate(profile)}</b> to turn the next piece 90°. The glowing piece flies exactly as shown.`,
    },
    {
      title: "Complete a row",
      body: `Fill a <b>full row</b> in front of the red compactor: it vanishes and pays. Cubes <b>short of the bar</b> are lost.`,
    },
    {
      title: "Funds & Target",
      body: `Launches cost <b>$${level.launchCost}</b>; rows pay <b>$${level.scorePerLine}</b> plus <b>${scrapHTML("scrap")}</b>; lost cubes fine <b>$${level.penaltyPerLostPiece}</b>. Reach <b>$${level.targetScore}</b> before Funds or time runs out.`,
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
  profile: InputProfile = "touch",
): string {
  const steps = coachSteps(level, profile);
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
  // A8: the one NEXT STEP block, explaining the chain out of the wall the
  // player just hit — Contracts pay salvage, salvage buys the Reactor, the
  // Reactor is a bigger float for THIS bay. Tier-1 numbers, stated live,
  // because the coach only ever runs on a first-tier run.
  const milestone = tierMilestoneSalvage(1);
  const reactor = installById("reactor")!;
  const nextBlock = `<div class="coach__next">
          ${nextBadgeHTML()}
          <p>Contracts have no clock and no launch cost, and each first clear banks <b>${salvageHTML(milestone)}</b> — enough for <b>${upgradeById("reactor")!.name}</b> (${salvageHTML(reactor.cost)}), a bigger float for this exact bay.</p>
        </div>`;
  return `<div class="modal-scrim" id="scrim">
    <div class="coach coach--fail">
      <div class="coach__card">
        <div class="coach__eyebrow">Tutorial · ${bayName}</div>
        <div class="coach__title">${s.title}</div>
        <p class="coach__body">${s.body}</p>
        ${nextBlock}
        <div class="coach__foot coach__foot--fail">
          <button class="btn btn--primary btn--lg btn--block" data-action="coach-retry">${icon("retry", 13)}Try this bay again</button>
          <div class="row coach__foot-row">
            <button class="btn btn--secondary" data-action="contracts">View Contracts</button>
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
        <div class="stat"><b style="color:var(--warn)">${scrapHTML(opts.scrap, 22)}</b><span>scrap</span></div>
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
  // A14: ROWS on the leaderboard's scroll pattern, not cards. The grammar per
  // row: glyph · name over its state line · tier pips · the price button (in
  // B6's "T2 · <scrap> 35" words — the yard spends SCRAP, so the glyph on the
  // button is the cut plate, never the Workshop's salvage arcs). An
  // uninstalled track says where it IS bought —
  // the Workshop — instead of wearing a live-looking price, and the full
  // ladder survives in `title` for where hover exists.
  const tracks = refitTracks(opts.mark);
  const cards = tracks.map((u) => {
    const tier = Math.min(MAX_TIER, opts.tiers[u.id] ?? 0);
    const cost = nextTierCost(tier);
    const affordable = cost !== null && opts.scrap >= cost;
    const pips = Array.from({ length: MAX_TIER }, (_, i) =>
      `<i class="${i < tier ? "on" : ""}"></i>`,
    ).join("");
    // The button carries the whole purchase: which way the number moves, by how
    // much, and what it costs (B6's grammar for the price).
    const step = cost === null ? null : u.step(tier);
    // Tier 0 is NOT INSTALLED, and refit cannot install (run.ts's buyUpgrade
    // refuses it): a system is bought once, with salvage, in the Workshop.
    const btn =
      tier === 0
        ? `<span class="refit-row__locked">Not installed — buy it in the <b>Workshop</b></span>`
        : cost === null || step === null
        ? `<span class="refit-row__max">MAX</span>`
        : `<button class="btn btn--primary refit-card__buy" data-action="buy-upgrade" data-upgrade="${u.id}"${affordable ? "" : " disabled"}>
            <span class="refit-card__arrow refit-card__arrow--${step.dir}">${icon(step.dir, 10)}</span>
            <span class="refit-card__delta">${step.text}</span>
            <span class="refit-card__price">T${tier + 1}<span class="price__sep">·</span>${icon("scrap", 11)}${cost}</span>
          </button>`;
    const ladder = u.tiers.map((t, i) => `T${i + 1} ${t}`).join(" · ");
    return `<div class="refit-row${tier > 0 ? " refit-row--owned" : ""}" title="${u.name} — ${ladder}">
      <span class="refit-row__glyph">${icon(u.id as IconName, 26)}</span>
      <div class="refit-row__body">
        <span class="refit-row__name">${u.name}</span>
        <span class="refit-row__state">${u.current(tier)}</span>
      </div>
      <span class="refit-row__pips">${pips}</span>
      <div class="refit-row__foot">${btn}</div>
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
        <div class="chip chip--inline refit__scrap">
          <div class="chip__label">Scrap</div>
          <div class="chip__value" style="color:var(--warn)" id="refit-scrap">${scrapHTML(opts.scrap, 16)}</div>
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
 *
 * ONE COLUMN OF ROWS, whole copy, and the pane scrolls. The shelf used to run
 * as many columns as the width allowed, which meant every card's description
 * was clamped to one line and ellipsised — 90 of them across the device matrix,
 * i.e. every card on every device. The columns were bought to avoid scrolling,
 * and this pane is one of the three places allowed to scroll; trading the
 * sentence for a scrollbar it already had was the wrong way round.
 */
export function workshopScreen(meta: MetaState): string {
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
      // B6's grammar without a tier: an option is not a rung on a track, so
      // its price is just the salvage glyph and the number.
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-unlock" data-unlock="${u.id}"${affordable ? "" : " disabled"}>${icon("salvage", 11)}${u.cost}</button>`
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

  // ---- Systems -------------------------------------------------------------
  // Installs sit ABOVE the unlock cards: a system is permanent power the player
  // keeps, an unlock is an option that may or may not be dealt, and the shop
  // should lead with the one that is guaranteed to matter. The budget readout
  // rides on the section label because the cap, not the price, is what usually
  // stops a purchase here — a player staring at 400 salvage and a greyed card
  // needs to be told it is the Mark talking.
  // A11: the ONE next-step card — the cheapest system the player can both
  // reach and afford right now carries the badge and the warm border, so the
  // shelf answers "which of these should I buy" instead of just listing.
  const nextId = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) === 0)
    .filter((i) => installAvailable(meta, i) && meta.salvage >= i.cost)
    .sort((a, b) => a.cost - b.cost)[0]?.id;
  const installCards = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) === 0)
    .map((i) => {
      const def = upgradeById(i.id)!;
      const available = installAvailable(meta, i);
      const affordable = meta.salvage >= i.cost;
      const gates = installGates(meta, i);
      // B6: one price grammar — "T1 · <salvage> 15". An install is tier 1 of a
      // track by definition, and the button says so in the same words the refit
      // yard's buy buttons use for tiers 2 and 3 — with the one difference that
      // matters, the currency glyph: this purchase is salvage, that one scrap.
      const foot = available
        ? `<button class="btn btn--primary" data-action="buy-install" data-install="${i.id}"${affordable ? "" : " disabled"}>T1<span class="price__sep">·</span>${icon("salvage", 11)}${i.cost}</button>`
        : `<span class="shop-card__locked">Needs ${gates.join(" · ")}</span>`;
      return `<div class="shop-card${available ? "" : " shop-card--gated"}${i.id === nextId ? " shop-card--next" : ""}">
      <div class="shop-card__body">
        <div class="shop-card__name">${icon(i.id as IconName, 13)}${def.name}${i.id === nextId ? nextBadgeHTML() : ""}</div>
        <p class="shop-card__desc">${def.blurb} Installs at tier 1; refit stops raise it.</p>
      </div>
      <div class="shop-card__foot">${foot}</div>
    </div>`;
    })
    .join("");

  const installedStrip = INSTALLS.filter((i) => (meta.loadout[i.id] ?? 0) > 0)
    .map((i) => `<span class="workshop__owned-item">${upgradeById(i.id)!.name} ${"I".repeat(Math.min(MAX_TIER, meta.loadout[i.id] ?? 0))}</span>`)
    .join("");

  // ONE SHELF. The Systems/Options tabs are gone.
  //
  // They split the shop by a distinction the player does not have: both halves
  // are salvage, spent once, kept forever. What the split actually did was
  // hide merchandise — the tab bar had to carry per-tab COUNTS precisely
  // because, in its own words, "a tab that just says Options gives a player no
  // reason to look, and the cheapest unlock they can afford is behind it". A
  // shelf that needs a badge advertising the half you cannot see is one shelf
  // too many.
  //
  // Systems lead, which is the ordering the tab bar was already asserting by
  // putting them first: a system is power you are guaranteed to keep, an
  // option changes what a run may attempt. Same order, no click.
  const shelf = installCards + cards;
  const shelfEmpty = !shelf;

  // What you already have, at the FOOT of the shelf. Both strips used to ride
  // in the fixed aside beside it, and that was a fit bug waiting for a save
  // that owned anything: the aside cannot scroll (sim/uifit asserts it, and it
  // is not on the allowlist), so on a landscape phone a Mark-3 loadout ran its
  // five installed names straight down past the pane and level with Start Run.
  // The new `workshop-owned` fixture is what caught it — the old one was
  // `newMeta()` with three numbers on it, and owned nothing.
  //
  // Reference belongs where reference can scroll, and BELOW the merchandise:
  // the shop leads with what you can buy, exactly as the owned-collapse note
  // above argues, and the answer to "what do I already have" is one flick away
  // rather than in the way.
  const haveStrips =
    (installedStrip
      ? `<div class="workshop__owned"><span class="workshop__owned-label">✓ Installed</span>${installedStrip}</div>`
      : "") + ownedStrip;

  // The FIXED column, and now ONLY the budget. What stays pinned is what
  // CONSTRAINS a purchase — the cap the Mark sets is the usual reason a card is
  // greyed out, and scrolling it away from the cards it explains is the one
  // thing this pane must not do. Everything else in here was reference, and
  // reference does not need to be pinned; it needs to be readable, which is
  // what moving it into the scroller buys.
  const aside = `<aside class="workshop__aside">
        <div class="workshop__budget-box">
          <span class="workshop__aside-label">build budget</span>
          <span class="workshop__budget">${tiersCost(meta.loadout)}<span class="price__sep">/</span>${markBudget(meta)}</span>
        </div>
      </aside>`;

  return `<div class="screen neon-backdrop">
    <div class="workshop">
      <div class="workshop__hdr">
        <div style="text-align:left">
          <div class="eyebrow">Between runs</div>
          <h2 class="display" style="font-size:var(--fs-h1)">Workshop</h2>
          <p class="muted workshop__blurb" style="margin:0">Tier milestones pay salvage — each first-clear Contract and run win banks a share. Spend it on options you didn't have before.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <div class="chip chip--inline">
            <div class="chip__label">Salvage</div>
            <div class="chip__value" style="color:var(--warn)">${salvageHTML(meta.salvage, 16)}</div>
          </div>
          <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
        </div>
      </div>
      <div class="workshop__meta muted">${meta.runs} run${meta.runs === 1 ? "" : "s"} logged · deepest bay ${meta.bestBay || "—"} · ${
        // A11: the meta line carries tier progress, in the same grammar the
        // menu chip and the end modals use.
        (() => {
          const p = tierProgressFor(meta);
          return `Tier ${p.tier} — Deep Run ${p.runDone ? "✓" : "○"} · Contracts ${p.contracts}/${p.needed}${p.contracts >= p.needed ? " ✓" : ""}`;
        })()
      }</div>
      <div class="workshop__body">
        ${aside}
        <div class="workshop__shop" data-scroll>${
          shelfEmpty
            ? `<p class="muted" style="margin:0">Every system your tier allows is installed. Complete this tier to open the next one.</p>`
            : `<div class="workshop__grid">${shelf}</div>`
        }${haveStrips}</div>
      </div>
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
        <button class="btn btn--secondary" data-action="fullscreen" id="fullscreen-btn-modal">${icon("fullscreen", 14)} <span class="fs-label">Fullscreen</span></button>
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
      const mark = `<span class="mod-card__mark">${icon("check", 10)}</span> Selected${picks > 1 ? ` ×${picks}` : ""}`;
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
      // Both labels ship; app.css picks one by density. A landscape phone packs
      // this grid four across, and at ~63px of interior "Shots in the bank"
      // ellipsised to "S…" — with the ACTIVE tag beside it, four of the ten
      // tiles named nothing at all.
      const txt = `<span class="preview-stat__long">${r.label}</span><span class="preview-stat__short">${r.short}</span>`;
      const label = r.active
        ? `<span class="preview-stat__labeltxt">${txt}</span><span class="preview-stat__live">ACTIVE</span>`
        : txt;
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
        <div class="chip chip--accent chip--inline">
          <div class="chip__label">Ended $${opts.funds} — carries</div>
          <div class="chip__value">$${opts.carry}</div>
        </div>
        <div class="chip chip--inline">
          <div class="chip__label">Notches taken</div>
          <div class="chip__value" id="draft-notches">${banked}${pending > 0 ? `<span class="chip__pending">+${pending}</span>` : ""}</div>
        </div>
        <div class="chip chip--inline">
          <div class="chip__label">Scrap${
            opts.baysToRefit === null
              ? ""
              : opts.baysToRefit === 1
                ? " — refit next bay"
                : ` — refit in ${opts.baysToRefit} bays`
          }</div>
          <div class="chip__value" style="color:var(--warn)">${scrapHTML(opts.scrap, 16)}</div>
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
  /** Funds demolition charges refunded across the run (run.ts's
   *  RunState.salvagedFunds). Worded as FUNDS on the way out, never as
   *  "salvage": that word is the Workshop's permanent currency, and the two
   *  sitting on the same foot line would read as one number counted twice. */
  salvagedFunds: number;
  tiers: UpgradeTiers;
}): string {
  const title = opts.runComplete ? "Run Complete!" : opts.won ? "Level Cleared!" : "Game Over";
  // Demolition recovery, appended to whichever foot line the branch below
  // renders. Suppressed at zero rather than printed as "$0": a charge is a
  // draft pick most runs never make, so the line would be dead weight on the
  // majority of end screens — and the foot is already the densest row here.
  const demoFoot = opts.salvagedFunds > 0 ? ` · $${opts.salvagedFunds} recovered by demolition` : "";
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
  // Cause only, no advice. The "Try next time:" line that used to follow each
  // of these restated the rules to someone who had just spent a whole run
  // learning them, on the one screen where they are least able to act on it —
  // and it was the block pushing the score row and its breakdown down the
  // panel. Dropped rather than shortened: a tip nobody reads is not improved
  // by being briefer. The tips are gone from the table too, so this stays a
  // map of reason -> cause and cannot rot into a pair whose second half is
  // never rendered.
  const lossWhy: Record<string, string> = {
    broke: "You spent all your Funds on launches before reaching the target.",
    time: "The clock ran out before your Funds reached the target.",
    launches: "You used up every launch before hitting the goal.",
    topout: "The pile reached the ceiling.",
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
      ${!opts.won ? `<p class="muted end__where">Made it to Bay ${opts.bayNum}/${RUN_LEVELS} — ${opts.bayName}</p>` : ""}
      ${
        why
          ? `<div class="end__why"><p>${why}</p></div>`
          : ""
      }
      <div class="stat-row">
        <div class="stat"><b style="color:var(--accent)">${opts.score}</b><span>Score</span></div>
        <div class="stat"><b>${opts.lines}</b><span>Lines</span></div>
        <div class="stat"><b style="color:var(--piece-o)">${opts.best}</b><span>Best</span></div>
      </div>
      <div class="muted end__breakdown">
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
        <div class="salvage-row__amt">${salvageHTML(`+${opts.tierSalvage}`, 16)}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.tierCompleted} complete!</b>
          <span class="muted">Run beaten and ${opts.progress.needed} Contracts cleared — Tier ${opts.progress.tier} is open. <b>${opts.salvageTotal} salvage banked</b>, yours to keep.</span>
          <span class="muted salvage-row__foot">${opts.scrapEarned} scrap earned · ${tiersCost(opts.tiers)} refitted into the ship${demoFoot}</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
          : `<div class="salvage-row">
        <div class="salvage-row__amt salvage-row__amt--tier">${opts.tierSalvage > 0 ? salvageHTML(`+${opts.tierSalvage}`, 16) : `T${opts.progress.tier}`}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.progress.tier} progress</b>
          <span class="muted">${opts.tierSalvage > 0 ? `<b>${salvageHTML(`+${opts.tierSalvage}`)} banked</b> for beating the run at this tier. ` : ""}${opts.progress.runDone ? "✓" : "○"} Deep Run beaten · ${opts.progress.contracts >= opts.progress.needed ? "✓" : "○"} Contracts ${opts.progress.contracts}/${opts.progress.needed} — finish both to open Tier ${opts.progress.tier + 1}.</span>
          <span class="muted salvage-row__foot">${opts.scrapEarned} scrap earned · ${tiersCost(opts.tiers)} refitted into the ship · ${opts.salvageTotal} salvage banked${demoFoot}</span>
        </div>
        ${
          // Only when this end actually BANKED something. The row is a flex
          // three-up — figure, body, button — and the button is `flex: none`,
          // so on a run that earned nothing it took width off the one part
          // carrying information and wrapped the progress sentence into the
          // cramped block this screen is trying not to be. It was also an
          // invitation to go shopping with no new money: the Workshop spends
          // salvage, and a run that banked none has nothing there it did not
          // have before starting. Tier-complete keeps its button
          // unconditionally — that branch always carries an award.
          opts.tierSalvage > 0
            ? `<button class="btn btn--secondary" data-action="workshop">Workshop</button>`
            : ""
        }
      </div>`
      }
      ${
        // A15: a completed tier's end names what the NEXT rung actually
        // changes — truthfully. A Mark no longer scales the ladder's numbers
        // (level.ts's zeroed MARK_*_STEP), so what a tier opens is a hazard
        // axis and a bigger build budget, and that is what the line says.
        opts.runComplete && opts.tierCompleted !== null
          ? `<p class="muted end__next">Tier ${opts.progress.tier}: ${
              (() => {
                const opened = HAZARDS.find((h) => h.mark === opts.progress.tier);
                return opened ? `${opened.name} joins the draft, and ` : "";
              })()
            }the build budget rises to ${budgetForMark(opts.progress.tier)}.</p>`
          : ""
      }
      </div>
      <div class="end__side">
        <div class="submit-row" id="submit-row">
          <input class="name-input" id="name-input" maxlength="12" placeholder="YOUR NAME"
            value="${opts.name}" autocomplete="off" spellcheck="false" />
          <!-- Secondary, not primary (B2): the screen's one forward move is
               the restart button below — submitting a score is a sideways
               action, and two primaries made the exit compete with it. -->
          <button class="btn btn--secondary" data-action="submit-score">Submit</button>
        </div>
        <div id="lb-body" data-scroll>${opts.rows}</div>
      </div>
      <div class="row end__actions">
        <button class="btn btn--primary" data-action="restart">${
          // A15: the bay-10 primary carries the tier plate (the 26px size of
          // the one component) and names the rung it flies next.
          opts.runComplete
            ? `${tierPlateHTML(opts.progress.tier, "button")}Run Tier ${opts.progress.tier} →`
            : "Play Again"
        }</button>
        <button class="btn btn--ghost" data-action="menu">Menu</button>
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------------------
 * CONTRACTS — the generated, retryable half (see game/contracts.ts).
 * ------------------------------------------------------------------------ */

/** The day's Contract board. Failure costs nothing here, so the copy leans on
 *  "pick one and try it" rather than warning the player about anything.
 *
 *  The board is three offers to COMPARE, not three paragraphs to read, so every
 *  card states the same two facts in the same two slots — the goal, then what
 *  you get to reach it — and the badge above them names which kind of supply
 *  that second slot is. The old card wrote each kind as its own sentence
 *  ("4 lines in 17 launches" beside "O×4 → 2 lines"), which put the goal in a
 *  different place on each card and made the row unscannable.
 *
 *  Everything that was identical on all three cards has moved out of them. The
 *  reward terms ("First clear counts toward Tier 1 · fail free, retry free")
 *  were repeated verbatim three times, were the widest line in each card, and
 *  wrapped to two lines to say something about the SCREEN — they join the WHY
 *  strip as one footnote, and the salvage a first clear actually banks rides on
 *  the card as a value instead, which is the part that differs once the tier's
 *  quota is full.
 *
 *  The board is also its own block rather than a borrowed `.howto__grid`. That
 *  grid is the How-to deck's horizontal SNAP ROW, which is right for nine cards
 *  read once in order and wrong for three offers compared against each other —
 *  two of them were off-screen behind a sideways scroll, and a board you have to
 *  swipe to see is a board you cannot compare. Three cards fit the width they
 *  are given; nothing here scrolls in either axis. */
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
  /** The cheapest installable system, for the WHY strip's target price (A9). */
  nextInstall?: { name: string; cost: number } | null;
}): string {
  // Whether a first clear still banks anything. A tier pays its milestone share
  // for only the first TIER_CONTRACTS_REQUIRED Contracts (meta.ts), so once the
  // quota is full the remaining cards are practice — and saying so on the card
  // is the one piece of reward copy that is worth per-card space.
  const paying = !opts.progress || opts.progress.contracts < opts.progress.needed;
  const cards = opts.contracts
    .map((c, i) => {
      const done = opts.cleared.includes(c.id);
      // A pattern Contract advertises its exact inventory, because the whole
      // offer is "here is what you get — can you place it?". Knowing the set
      // before you accept is the planning the mode is made of. A lines Contract
      // advertises its launch budget for the same reason: it is the only thing
      // that can run out.
      const supply =
        c.kind === "pattern"
          ? queueTallyHTML(c.queue)
          : `<b>${c.launches}</b> launches`;
      // No progress data (the prop is optional) means no claim either way — the
      // slot goes empty rather than asserting "Practice", which would be wrong
      // for a player whose tier quota is in fact still open.
      const state = done
        ? `<span class="contract-card__state contract-card__state--done">✓ Cleared</span>`
        : !opts.progress
          ? ""
          : paying
            ? `<span class="contract-card__state contract-card__state--pays">${salvageHTML(`+${opts.progress.milestone}`)}</span>`
            : `<span class="contract-card__state">Practice</span>`;
      return `<button class="contract-card${done ? " contract-card--done" : ""}" data-action="contract" data-slot="${i}">
        <span class="contract-card__top">
          <span class="contract-card__kind">${c.kind === "pattern" ? "Pattern" : "Lines"}</span>
          ${state}
        </span>
        <span class="contract-card__name">${c.name}</span>
        <span class="contract-card__ask">
          <b class="contract-card__goal">${c.goal}</b>
          <span class="contract-card__unit">line${c.goal === 1 ? "" : "s"}</span>
        </span>
        <span class="contract-card__supply">
          <span class="contract-card__supply-lbl">${c.kind === "pattern" ? "Supply" : "Budget"}</span>
          <span class="contract-card__supply-val">${supply}</span>
        </span>
        <span class="contract-card__brief">${c.brief}</span>
      </button>`;
    })
    .join("");
  // Tier standing as the menu's tier chip rather than a sentence. The line it
  // replaces ran ~120 characters, wrapped on a landscape phone, and mixed three
  // different things — the two halves, the milestone payout and the unlock
  // condition — into one run of prose. The halves are a status readout, so they
  // get the readout shape the menu already uses for them, and the payout is now
  // a value on each card.
  const tierChip = opts.progress
    ? `<div class="chip chip--tier">
        <div class="chip__label">Tier</div>
        <div class="chip__value" style="color:var(--accent)">${opts.progress.tier}</div>
        <div class="tier-chip__halves">
          <span class="${opts.progress.runDone ? "done" : ""}">${opts.progress.runDone ? "✓" : "○"} Run</span>
          <span class="${opts.progress.contracts >= opts.progress.needed ? "done" : ""}">${opts.progress.contracts >= opts.progress.needed ? "✓" : "○"} Contracts ${opts.progress.contracts}/${opts.progress.needed}</span>
        </div>
      </div>`
    : "";
  // A9's WHY strip and the terms, as one line under the board — the terms used
  // to be a third copy of themselves on each card, and the two lines were
  // answering the same question from either end ("what does this cost me" and
  // "what is it for"). The A9 half is unchanged: the tier's total in its own
  // numbers, against the price of the thing it buys next.
  const foot = opts.progress
    ? `<p class="muted contracts__foot">${nextBadgeHTML("Why")} Fail free, retry free — and ${opts.progress.needed} first clears bank ${
        salvageHTML(opts.progress.milestone * opts.progress.needed)
      }${
        opts.nextInstall
          ? `, so ${opts.nextInstall.name} (${salvageHTML(opts.nextInstall.cost)}) is waiting in the Workshop before your next run`
          : " toward the Workshop"
      }.</p>`
    : `<p class="muted contracts__foot">Fail free, retry free — a cleared Contract stays replayable.</p>`;
  return `<div class="screen neon-backdrop">
    <div class="contracts">
      <div class="contracts__hdr">
        <div class="contracts__title">
          <!-- The tier lives in the chip opposite when there is one, so the
               eyebrow does not repeat it — it only names the thing the chip
               cannot, which is that the board is regenerated every day. -->
          <div class="eyebrow">${opts.progress ? "Resets daily" : `Tier ${opts.tier} · resets daily`}</div>
          <h2 class="display">Contracts</h2>
          <p class="contracts__sub muted">No rush, do it right.</p>
        </div>
        <div class="contracts__hdr-side">
          ${tierChip}
          <button class="icon-btn" data-action="menu" aria-label="Back">${icon("close", 18)}</button>
        </div>
      </div>
      <div class="contracts__board">${cards}</div>
      ${foot}
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
 * End-of-Contract modal — built from the ONE end-screen skeleton (canvas A10/
 * A15): eyebrow, display title, `.stat-row`, `.salvage-row`, one
 * `.end__actions` row. These are the run-end modal's own parts, so the two
 * ways a session ends read as one family; `.end--contract` drops only the
 * geometry the run modal grids around its leaderboard column, because there
 * is no leaderboard here. The old bespoke `.ce__*` layout is gone.
 *
 * Win and loss are still genuinely different screens: on a win the outcome is
 * the headline, the payout is stated plainly in the salvage row (with the
 * price it is walking toward, when the caller knows one — A10's "state the
 * target"), and the primary action moves forward. On a loss the primary is
 * the retry, and the margin missed by is the whole feedback.
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
  /** The cheapest system the player could install next, so the salvage row can
   *  name the price the payout is walking toward (A10). Null when everything
   *  reachable is installed. */
  nextInstall?: { name: string; cost: number } | null;
  /** Next unfinished card from the board this attempt came from. */
  nextContract?: { name: string } | null;
  /** All three cards on that board are now cleared. */
  boardComplete?: boolean;
}): string {
  const pattern = opts.kind === "pattern";
  const supplyLabel = pattern ? "Shipments" : "Launches";
  const supplyTotal = pattern ? opts.queue.length : opts.launches;
  const stats = `<div class="stat-row">
      <div class="stat"><b style="color:var(--accent)">${opts.lines}/${opts.goal}</b><span>Lines</span></div>
      <div class="stat"><b style="color:var(--warn)">${opts.launchesUsed}/${supplyTotal}</b><span>${supplyLabel}</span></div>
      ${
        pattern
          ? `<div class="stat"><b class="stat__tally">${queueTallyHTML(opts.queue)}</b><span>Manifest</span></div>`
          : ""
      }
    </div>`;

  if (!opts.won) {
    // A pattern Contract almost never ends with an empty queue and an unmet
    // goal — it ends the moment the cubes to finish it stop existing. Saying
    // how many were lost is the whole feedback: "you were one cube short" is
    // what makes the retry a decision rather than another roll.
    const heading = pattern ? "Manifest Short" : "Out of Launches";
    const why = pattern
      ? opts.cubesWasted > 0
        ? `<b>${opts.cubesWasted}</b> cube${opts.cubesWasted === 1 ? "" : "s"} never made it into a line — with an exact manifest, that's the whole margin.`
        : "The manifest ran out before the goal did."
      : "Nothing lost — a Contract costs you nothing to retry.";
    return `<div class="modal-scrim" id="scrim">
      <div class="panel modal end end--contract pop">
        <div class="end__main">
          <div class="eyebrow" style="color:var(--danger)">${opts.name}</div>
          <h2 class="display">${heading}</h2>
          <p class="muted" style="margin-top:-6px">${why}</p>
          ${stats}
        </div>
        <div class="row end__actions">
          <button class="btn btn--primary" data-action="contract-retry">${icon("retry", 12)}Try Again</button>
          <button class="btn btn--ghost" data-action="contracts">Contract Board</button>
        </div>
      </div>
    </div>`;
  }

  // Spare launches are the only skill expression left once it's cleared, so
  // they're called out — it's what makes replaying a paid Contract interesting.
  // A pattern Contract has no spare by construction, so clearing one at all IS
  // the flourish and the copy says that instead.
  const spare = pattern ? 0 : opts.launches - opts.launchesUsed;
  const p = opts.progress;
  // A10's "state the target": salvage in hand is only meaningful against the
  // next thing it buys, so the row names it whenever the caller knows one.
  const target = opts.nextInstall
    ? ` ${opts.nextInstall.name} costs ${salvageHTML(opts.nextInstall.cost)} in the Workshop.`
    : "";
  // Three outcomes, one salvage row: the clear COMPLETED the tier (the
  // celebration), the clear ticked tier progress (say what's still missing),
  // or it was a replay (free practice, nothing moved — the quiet variant).
  const salvageRow =
    opts.award?.firstClear && opts.award.completedTier !== null
      ? `<div class="salvage-row salvage-row--tier-done">
        <div class="salvage-row__amt">${salvageHTML(`+${opts.award.salvage}`, 16)}</div>
        <div class="salvage-row__body">
          <b>Tier ${opts.award.completedTier} complete!</b>
          <span class="muted">Run beaten and ${p.needed} Contracts cleared — Tier ${p.tier} is open. <b>${opts.salvageTotal} salvage banked.</b>${target}</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
      : opts.award?.firstClear
        ? `<div class="salvage-row">
        <div class="salvage-row__amt salvage-row__amt--tier">${opts.award.salvage > 0 ? salvageHTML(`+${opts.award.salvage}`, 16) : `T${p.tier}`}</div>
        <div class="salvage-row__body">
          <b>Tier ${p.tier} · Contracts ${p.contracts}/${p.needed}</b>
          <span class="muted">${
            opts.award.salvage > 0
              ? `<b>${salvageHTML(`+${opts.award.salvage}`)} banked</b> — ${opts.salvageTotal} salvage total.`
              : ""
          } ${
            p.contracts >= p.needed
              ? `Contracts done — ${p.runDone ? "" : "beat the Deep Run to "}complete the tier (${salvageHTML(p.award)} total per tier).`
              : `${p.needed - p.contracts} more Contract${p.needed - p.contracts === 1 ? "" : "s"}${p.runDone ? "" : " and the Deep Run"} to complete the tier (${salvageHTML(p.award)} total per tier).`
          }${target}</span>
        </div>
        <button class="btn btn--secondary" data-action="workshop">Workshop</button>
      </div>`
        : `<div class="salvage-row salvage-row--quiet">
        <div class="salvage-row__amt">✓</div>
        <div class="salvage-row__body">
          <b>Already logged</b>
          <span class="muted">This Contract counted on your first clear. Replays are free practice.</span>
        </div>
      </div>`;

  // One primary (B2): the forward move. The ghost board link only renders
  // when the primary is routing somewhere ELSE — a primary that already goes
  // to the board does not need a quieter twin.
  const primaryIsBoard = !opts.boardComplete && !opts.nextContract;
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal end end--contract pop">
      <div class="end__main">
        <div class="eyebrow" style="color:var(--success)">${opts.name} · cleared</div>
        <h2 class="display" style="color:var(--success)">Contract Complete</h2>
        <p class="muted" style="margin-top:-6px">
          ${
            pattern
              ? `${opts.goal} lines from the exact manifest — <b>nothing wasted</b>.`
              : `${opts.goal} lines delivered${spare > 0 ? ` with <b>${spare}</b> launch${spare === 1 ? "" : "es"} to spare` : ""}.`
          }
        </p>
        ${stats}
        ${salvageRow}
      </div>
      <div class="row end__actions">
        ${
          opts.boardComplete
            ? `<button class="btn btn--primary" data-action="workshop">Workshop →</button>`
            : opts.nextContract
              ? `<button class="btn btn--primary" data-action="contract-next">Next: ${opts.nextContract.name} →</button>`
              : `<button class="btn btn--primary" data-action="contracts">Contract Board →</button>`
        }
        <button class="btn btn--secondary" data-action="contract-retry">${icon("retry", 12)}Play Again</button>
        ${primaryIsBoard ? "" : `<button class="btn btn--ghost" data-action="contracts">Contract Board</button>`}
      </div>
    </div>
  </div>`;
}
