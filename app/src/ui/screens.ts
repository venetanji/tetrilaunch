import { PIECE_TYPES } from "../game/theme";
import { LEVEL_1 } from "../game/level";
import { nextPreviewHTML, toggleHTML, pieceCellsHTML, bombNextHTML, formatMMSS } from "./components";
import type { Settings } from "../lib/store";
import type { ScoreEntry } from "../lib/api";
import type { Cannon } from "../game/cannon";
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
    ["02", "Rotate the piece", `Pieces turn in crisp <b>90° steps</b> — tap <span class="kbd">Q</span><span class="kbd">E</span> or the <span class="kbd">⟲</span>/<span class="kbd">⟳</span> buttons. The glowing piece at the cannon and the <b>Next</b> preview both show the exact orientation before you fire.`],
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

/** In-game HUD overlay. `bayNum` is the 1-based bay currently playing (out of
 *  RUN_LEVELS); `timeLimitSec` gates whether a Time chip renders at all (0 =
 *  no limit, e.g. never happens today but kept level-driven for future
 *  ladder entries); `timeLeftMs`/`pieceCubes`/`nextIsBomb` seed the initial
 *  render so it matches whatever main.ts's syncHud takes over from frame 2. */
export function hudHTML(opts: {
  cannon: Cannon;
  target: number;
  score: number;
  launchCost: number;
  bayNum: number;
  timeLimitSec: number;
  timeLeftMs: number;
  pieceCubes: 2 | 4;
  nextIsBomb: boolean;
}): string {
  const { cannon, target, score, launchCost, bayNum, timeLimitSec, timeLeftMs, pieceCubes, nextIsBomb } = opts;
  const timeChip =
    timeLimitSec > 0
      ? `<div class="chip chip--c" id="hud-time-chip"><span class="chip__label">Time</span><span class="chip__value" id="hud-time">${formatMMSS(timeLeftMs)}</span></div>`
      : "";
  const nextHTML = nextIsBomb ? bombNextHTML() : nextPreviewHTML(cannon.currentType, cannon.quarterTurns, pieceCubes);
  // Single slim row: everything the player needs to read at a glance sits in
  // one ~48-64px-tall strip (see tokens.css's --hud-bar-h) instead of the old
  // two-cluster block, so it stops eating the top ~30% of a phone screen and
  // covering high-lob apexes (see render.ts's drawTrajectory). Chips go
  // label+value inline (`.chip--c`, not stacked) and the panels are
  // semi-transparent with no blur so the dotted trajectory stays legible
  // through them (see app.css's --panel-alpha).
  return `<div class="hud" id="hud">
    <div class="hud__top">
      <div class="hud__row">
        <div class="chip chip--c"><span class="chip__label">Bay</span><span class="chip__value">${bayNum}/10</span></div>
        <div class="chip chip--c chip--accent"><span class="chip__label">Funds</span><span class="chip__value" id="hud-score">$${score}</span></div>
        <div class="chip chip--c chip--combo"><span class="chip__label">Combo</span><span class="chip__value" id="hud-combo">×0</span></div>
        ${timeChip}
        <div class="goal goal--c">
          <span class="chip__label">Tgt ${target}</span>
          <div class="goal__bar"><div class="goal__fill" id="hud-goal" style="width:0%"></div></div>
        </div>
        <div class="power power--c"><span class="chip__label">Pwr</span>
          <div class="power__track"><div class="power__fill" id="hud-power"></div></div></div>
        <div id="hud-next">${nextHTML}</div>
        <button class="icon-btn icon-btn--c" id="fullscreen-btn" data-action="fullscreen" aria-label="Fullscreen">⛶</button>
        <button class="icon-btn icon-btn--c" data-action="pause" aria-label="Pause">⏸</button>
      </div>
    </div>
    <div class="hud__bottom">
      <button class="shoot-btn" data-game="shoot" id="shoot-btn">FIRE<span class="shoot-btn__cost">-$${launchCost}</span></button>
      <div class="rotate-cluster">
        <button class="icon-btn" data-game="rotl" aria-label="Rotate left">⟲</button>
        <button class="icon-btn" data-game="rotr" aria-label="Rotate right">⟳</button>
      </div>
      <div class="kbd-hint" aria-hidden="true">
        <span class="kbd">Q</span>/<span class="kbd">E</span> rotate
        <span class="kbd-hint__sep">·</span>
        <span class="kbd">W</span>/<span class="kbd">S</span> aim
        <span class="kbd-hint__sep">·</span>
        <span class="kbd">A</span>/<span class="kbd">D</span> power
        <span class="kbd-hint__sep">·</span>
        <span class="kbd">Space</span> fire
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
    <div class="panel modal pop" style="width:min(760px,94vw)">
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

export function endModal(opts: {
  won: boolean;
  score: number;
  lines: number;
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
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal pop" style="width:min(560px,94vw)">
      <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--danger)"}">${eyebrow}</div>
      <h2 class="display">${title}</h2>
      ${!opts.won ? `<p class="muted" style="margin-top:-8px">Made it to Bay ${opts.bayNum} — ${opts.bayName}</p>` : ""}
      <div class="stat-row">
        <div class="stat"><b style="color:var(--accent)">${opts.score}</b><span>Funds</span></div>
        <div class="stat"><b>${opts.lines}</b><span>Lines</span></div>
        <div class="stat"><b style="color:var(--piece-o)">${opts.best}</b><span>Best</span></div>
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
