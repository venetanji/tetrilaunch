import { PIECE_TYPES } from "../game/theme";
import { LEVEL_1 } from "../game/level";
import { nextPreviewHTML, toggleHTML, pieceCellsHTML } from "./components";
import type { Settings } from "../lib/store";
import type { ScoreEntry } from "../lib/api";
import type { Cannon } from "../game/cannon";
import type { PieceType } from "../game/theme";

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
        full rows into the compactor before it sweeps them away.</p>
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
    ["06", `Hit ${LEVEL_1.targetScore}`, `Reach the target score to clear Launch Bay. More levels & roguelite mutators are coming.`],
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
      <button class="btn btn--primary btn--lg" data-action="play" style="align-self:center">▶ Start Level 1</button>
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

/** In-game HUD overlay. */
export function hudHTML(cannon: Cannon, target: number): string {
  return `<div class="hud" id="hud">
    <div class="hud__top">
      <div class="hud__cluster">
        <div class="chip chip--accent"><div class="chip__label">Score</div><div class="chip__value" id="hud-score">0</div></div>
        <div class="chip chip--combo"><div class="chip__label">Combo</div><div class="chip__value" id="hud-combo">×0</div></div>
        <div class="goal">
          <div class="chip__label">Target ${target}</div>
          <div class="goal__bar"><div class="goal__fill" id="hud-goal" style="width:0%"></div></div>
        </div>
      </div>
      <div class="hud__cluster">
        <div class="power"><span class="chip__label">Pwr</span>
          <div class="power__track"><div class="power__fill" id="hud-power"></div></div></div>
        <div id="hud-next">${nextPreviewHTML(cannon.currentType, cannon.quarterTurns)}</div>
        <button class="icon-btn" data-action="pause" aria-label="Pause">⏸</button>
      </div>
    </div>
    <div class="hud__bottom">
      <div class="controls">
        <div class="rotate-cluster">
          <button class="icon-btn" data-game="rotl" aria-label="Rotate left">⟲</button>
          <button class="icon-btn" data-game="rotr" aria-label="Rotate right">⟳</button>
        </div>
        <button class="shoot-btn" data-game="shoot" id="shoot-btn">FIRE</button>
      </div>
      <div class="hint muted">Pull back to aim · release to fire</div>
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
        <button class="btn btn--secondary" data-action="restart">Restart</button>
        <button class="btn btn--ghost" data-action="menu">Quit</button>
      </div>
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
}): string {
  const title = opts.won ? "Level Cleared!" : "Game Over";
  const eyebrow = opts.won ? "Launch Bay complete" : "The compactor won this round";
  return `<div class="modal-scrim" id="scrim">
    <div class="panel modal pop" style="width:min(560px,94vw)">
      <div class="eyebrow" style="color:${opts.won ? "var(--success)" : "var(--danger)"}">${eyebrow}</div>
      <h2 class="display">${title}</h2>
      <div class="stat-row">
        <div class="stat"><b style="color:var(--accent)">${opts.score}</b><span>Score</span></div>
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
