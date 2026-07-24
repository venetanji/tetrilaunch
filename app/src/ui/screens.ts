import { PIECE_TYPES } from "../game/theme";
import { LEVEL_1 } from "../game/level";
import { SCORE_PER_BAY, SCORE_PER_LINE } from "../game/run";
import { toggleHTML, pieceCellsHTML, formatMMSS, beltPieceHTML, beltBombHTML, runModsHTML } from "./components";
import type { Settings } from "../lib/store";
import type { ScoreEntry } from "../lib/api";
import type { BeltPreview } from "../game/game";
import type { PieceType } from "../game/theme";
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

export function menuScreen(best: number): string {
  return `<div class="screen neon-backdrop">
    <div class="menu">
      <div class="menu__brand">
        <div class="eyebrow">Physics Cannon Puzzle</div>
        <h1 class="menu__title display neon-text brand-gradient">TETRILAUNCH</h1>
        <p class="menu__sub">Load the cannon, arc your tetrominoes across the bay, and feed
        full rows into the compactor before it sweeps them away — across a 10-bay gauntlet
        run that drafts stranger modifiers onto your bankroll every stop.</p>
        <div class="chip" style="flex-direction:row;align-items:center;gap:10px;max-width:220px">
          <div class="chip__label">Best</div>
          <div class="chip__value chip--accent" style="color:var(--accent)">${best}</div>
        </div>
      </div>
      <div class="menu__actions">
        <button class="btn btn--primary btn--lg btn--block" data-action="play">▶ Play</button>
        <button class="btn btn--secondary btn--block" data-action="howto">How to Play</button>
        <button class="btn btn--secondary btn--block" data-action="leaderboard">Leaderboard</button>
        <button class="btn btn--ghost btn--block" data-action="settings">Settings</button>
      </div>
    </div>
  </div>`;
}

export function howtoScreen(): string {
  const steps = [
    ["01", "Aim & charge", `<b>Pull back</b> like a slingshot — the shot fires <b>opposite</b> your drag, and <b>distance sets the power</b>. Release to fire. On desktop use <span class="kbd">W</span><span class="kbd">S</span> to aim, <span class="kbd">A</span><span class="kbd">D</span> for power.`],
    ["02", "Rotate the piece", `Pieces turn in crisp <b>90° steps</b> — tap <span class="kbd">Q</span><span class="kbd">E</span> or the <span class="kbd">⟲</span>/<span class="kbd">⟳</span> buttons. The glowing piece at the cannon shows the exact orientation before you fire; the conveyor belt carries the piece coming <b>after</b> it.`],
    ["03", "Watch the arc", `The dotted parabola previews exactly where the piece flies. Pieces are joined by breakable joints — hard hits shatter them.`],
    ["04", "Fill the rows", `Land enough cubes in a row on the right of the compactor to complete a full straight line.`],
    ["05", "The compactor", `The red bar sweeps right, <b>shattering pieces into loose cubes</b> and compacting them. Cubes only vanish when they form a complete line — so don't let the stack reach the top.`],
    ["06", "Mind the bankroll", `Every launch costs <b>$${LEVEL_1.launchCost}</b>, and a full line pays out <b>$${LEVEL_1.scorePerLine}</b>. Reach <b>$${LEVEL_1.targetScore}</b> before the bankroll runs dry <b>or the clock hits zero</b> — going broke, or running out the timer, ends the run.`],
    ["07", "Run the gauntlet", `Ten bays deep, each with a rising target, a stiffer clock, and stiffer joints. Clear a bay and <b>draft one of three modifiers</b> — it stacks for the rest of the run. Each bay funds a fresh <b>$250 float</b>, and any surplus you banked above the target carries on top — but so does every trade-off you picked up. Go broke or run out the clock and the run ends right there.`],
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

export function settingsScreen(s: Settings): string {
  return `<div class="screen neon-backdrop center">
    <div class="panel modal pop">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <h2 class="display" style="font-size:var(--fs-h1)">Settings</h2>
        <button class="icon-btn" data-action="menu" aria-label="Back">✕</button>
      </div>
      ${toggleHTML("sound", "Sound FX", "Launch, impact & line-clear cues", s.sound)}
      ${toggleHTML("music", "Music", "Ambient synth soundtrack", s.music)}
      ${toggleHTML("haptics", "Haptics", "Vibration feedback on mobile", s.haptics)}
      <button class="btn btn--secondary" data-action="menu">Done</button>
    </div>
  </div>`;
}

export function leaderboardRowsHTML(entries: ScoreEntry[], highlight?: string): string {
  if (!entries.length) {
    return `<div class="muted" style="padding:20px;text-align:center">No scores yet — be the first!</div>`;
  }
  const medals = ["🥇", "🥈", "🥉"];
  return `<div class="lb">${entries
    .map((e, i) => {
      const me = highlight && e.name === highlight;
      return `<div class="lb__row${me ? " lb__row--me" : ""}">
        <span class="lb__rank">${medals[i] ?? i + 1}</span>
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
 * In-game HUD overlay — 1d "recycling-plant" layout. `bayNum` is the 1-based
 * bay currently playing (out of RUN_LEVELS); `timeLimitSec` gates whether a
 * Time readout renders at all (0 = no limit, e.g. never happens today but
 * kept level-driven for future ladder entries); `timeLeftMs`/`pieceCubes`/
 * `beltPreview` seed the initial render so it matches whatever main.ts's
 * syncHud takes over from frame 2. `modIds` is the run's full drafted-mod
 * pick history (run.ts's RunState.modIds) — rendered as chips in the plant
 * panel (see components.ts's runModsHTML).
 *
 * The old single-row top chip bar is gone: funds/target/time/combo now live
 * in the RECYCLING PLANT panel bottom-left (below the cannon), the NEXT
 * preview rides a conveyor belt top-left, the power meter is a bar mounted
 * on the plant, and every button lives in one same-width vertically-centered
 * column in the letterbox gutter OUTSIDE the field's right wall (see
 * app.css's .side-rail). Two hydraulic
 * pistons "driving" the compactor toward the right wall are canvas-drawn
 * (see render.ts's drawPistons) since they must track the compactor's live
 * x-position every frame — nothing here positions them, this file only owns
 * the DOM chrome.
 */
export function hudHTML(opts: {
  /** What rides the belt: the shot AFTER the muzzle's (see game.ts's
   *  Game.beltPreview). */
  beltPreview: BeltPreview;
  target: number;
  score: number;
  /** Cost per launch this bay — shown in the plant readout together with how
   *  many launches the current funds afford (#hud-shots, live-synced). */
  launchCost: number;
  bayNum: number;
  timeLimitSec: number;
  timeLeftMs: number;
  pieceCubes: 2 | 4;
  /** Whether this bay's run has the Bond Breaker ability drafted — shows its
   *  glowing chip in the plant's mods row (see main.ts / game.ts's
   *  useBondBreaker). */
  bondBreakerOwned: boolean;
  /** Charges left this bay, shown on the chip. */
  bondCharges: number;
  /** The run's full drafted-mod pick history, in pick order — rendered as
   *  chips in the plant panel (see components.ts's runModsHTML). */
  modIds: string[];
}): string {
  const {
    beltPreview, target, score, launchCost, bayNum, timeLimitSec, timeLeftMs,
    pieceCubes, bondBreakerOwned, bondCharges, modIds,
  } = opts;
  const beltNextHTML = beltPreview.bomb
    ? beltBombHTML()
    : beltPieceHTML(beltPreview.type, beltPreview.quarterTurns, pieceCubes);
  const timeBlock =
    timeLimitSec > 0
      ? `<div class="pl-time" id="hud-time-chip"><div class="lbl">Time</div><div class="v" id="hud-time">${formatMMSS(timeLeftMs)}</div></div>`
      : "";
  // Bond Breaker: only rendered when the run drafted the ability. TWO
  // triggers share the same data-game="bond" click handling and are kept in
  // sync by main.ts's syncHud via the shared .bond-trigger/.bond-trigger__count
  // classes (both disable at 0 charges, both show the live count):
  //  - a status chip in the plant's mods row (bondChip, styled like a mod —
  //    matches the mockup, stays tappable)
  //  - a dedicated icon button in the touch-only top-right rail (bondRailBtn),
  //    the PRIMARY mobile control since there's no "B" key on a touchscreen.
  const bondChip = bondBreakerOwned
    ? `<button class="mod mod--bb k-boon bond-trigger" data-game="bond" id="bond-chip" aria-label="Bond Breaker — shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>
        <span class="g">⚡</span><span class="nm">BOND BRK</span><span class="stk">×<span class="bond-trigger__count">${bondCharges}</span></span><span class="key">B</span>
      </button>`
    : "";
  const bondRailBtn = bondBreakerOwned
    ? `<button class="icon-btn bond-btn bond-trigger" data-game="bond" id="bond-btn" aria-label="Bond Breaker — shatter all joints"${bondCharges <= 0 ? " disabled" : ""}>⚡<span class="bond-btn__count bond-trigger__count">${bondCharges}</span></button>`
    : "";
  return `<div class="hud" id="hud">
    <!-- right-side button rail: ONE same-width vertically-centered column
         in the letterbox gutter outside the field's right wall (see
         app.css's .side-rail) — every button on the same layer, max six:
         fullscreen, pause, rotate CCW/CW, Bond Breaker (if drafted), and
         the aim-state cancel ✕. There's no keyboard on mobile, so this
         column IS the touch control surface. The ✕ is only visible
         mid-drag (main.ts's syncHud toggles .hud--aiming) but its slot is
         always reserved so appearing never shifts the other buttons under
         a hovering thumb; a second finger taps it to abort the queued
         launch — releasing the aim finger then fires nothing. Rotate taps
         mid-drag do NOT cancel (see input.ts). Desktop hides the game
         buttons, keeps fullscreen + pause top-anchored, and uses Q/E + B
         instead (see the @media (pointer: fine) rule in app.css), per the
         kbd-hint strip down in .hud__bottom. -->
    <div class="side-rail">
      <button class="icon-btn" id="fullscreen-btn" data-action="fullscreen" aria-label="Fullscreen">⛶</button>
      <button class="icon-btn" data-action="pause" aria-label="Pause">⏸</button>
      <button class="icon-btn rotate-btn" data-game="rotl" aria-label="Rotate left">⟲</button>
      <button class="icon-btn rotate-btn" data-game="rotr" aria-label="Rotate right">⟳</button>
      ${bondRailBtn}
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

    <!-- the RECYCLING PLANT: PWR bar, funds/target/time/combo, and the run's
         drafted mods (+ Bond Breaker), below the cannon. -->
    <div class="plant">
      <div class="pl-pwr"><span class="lbl">PWR</span>
        <div class="pl-pwr__track"><div class="pl-pwr__fill" id="hud-power"></div></div>
        <span class="pl-pwr__val" id="hud-power-val">0%</span>
      </div>
      <div class="plant__body">
        <div class="plant__hdr">
          <div class="plant__title"><b>◊</b> Recycling Plant <span class="plant__bay">· Bay ${bayNum}/10</span></div>
          <div class="plant__rivets"><i></i><i></i><i></i></div>
        </div>
        <div class="pl-read">
          <div class="pl-funds">
            <div class="lbl">Funds / Target</div>
            <div class="v"><span id="hud-score">$${score}</span> <span class="tgt">/ ${target}</span></div>
            <div class="pl-goal"><i id="hud-goal" style="width:0%"></i></div>
            <div class="pl-meta">
              <span>Combo <b id="hud-combo">×0</b></span>
              <span class="pl-meta__sep">·</span>
              <span>Launch $${launchCost}</span>
              <span class="pl-meta__sep">·</span>
              <span><b id="hud-shots">${Math.floor(score / launchCost)}</b> launches left</span>
            </div>
          </div>
          ${timeBlock}
        </div>
        <div class="pl-mods" id="hud-mods">
          <span class="lbl">Run mods</span>
          ${runModsHTML(modIds)}
          ${bondChip}
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
        <span class="kbd-hint__sep">·</span>
        drag to aim
      </div>
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
 * scrim and offers a choice of up to 3 modifiers (fewer late in a run, once
 * the non-stackable pool thins out — render whatever `offers` holds). Picking
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
  const ownedRow = opts.owned.length
    ? `<div class="run-mods"><span>Run modifiers:</span>${opts.owned
        .map((m) => `<span class="run-mods__chip">${m.name}</span>`)
        .join("")}</div>`
    : "";
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal modal--draft pop" style="width:min(760px,94vw)">
      <div class="eyebrow">Bay ${opts.bayNum} cleared — ${opts.bayName}</div>
      <h2 class="display">Choose your contract</h2>
      <p class="muted" style="margin-top:-8px">Next up: ${opts.nextBayName}</p>
      <div class="chip chip--accent" style="flex-direction:row;align-items:center;gap:10px;align-self:center;max-width:260px">
        <div class="chip__label">Ended with $${opts.funds} — carries over</div>
        <div class="chip__value">$${opts.carry}</div>
      </div>
      <div class="draft__cards">${cards || `<p class="muted">No modifiers left to draft — onward.</p>`}</div>
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
function loseFxHTML(reason: "topout" | "broke" | "time"): string {
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
  reason?: "topout" | "broke" | "time" | null;
  /** 1-based bay the run reached (cleared, if won+runComplete; attempted, if lost). */
  bayNum: number;
  bayName: string;
  /** True only for the bay-10 win — every other win routes to draftScreen instead. */
  runComplete: boolean;
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
          : "The compactor won this round";
  const loseFx = !opts.won && opts.reason ? loseFxHTML(opts.reason) : "";
  return `<div class="modal-scrim" id="scrim">
    ${loseFx}
    <div class="panel modal pop" style="width:min(560px,94vw)">
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
      <div class="submit-row" id="submit-row">
        <input class="name-input" id="name-input" maxlength="12" placeholder="YOUR NAME"
          value="${opts.name}" autocomplete="off" spellcheck="false" />
        <button class="btn btn--primary" data-action="submit-score">Submit</button>
      </div>
      <div id="lb-body">${opts.rows}</div>
      <div class="row">
        <button class="btn btn--primary" data-action="restart">Play Again</button>
        <button class="btn btn--ghost" data-action="menu">Menu</button>
      </div>
    </div>
  </div>`;
}
