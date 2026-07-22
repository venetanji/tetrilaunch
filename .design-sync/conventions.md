# Tetrilaunch — neon-arcade / pixel-retro design system

This is a **plain HTML + CSS** design system (no JS components, no React). You build
screens by composing the CSS classes and tokens below — every class ships compiled in
`tokens/app.css`, reachable from `styles.css`. The preview cards under `design/` are
working HTML: copy their compositions, don't invent parallel markup.

## Setup

- `styles.css` gives you everything: brand fonts (Orbitron, Rajdhani, JetBrains Mono,
  Press Start 2P — loaded from Google Fonts at runtime), all tokens, all component classes.
- Screens are **landscape 16:9** (the game is orientation-locked). Compose a screen inside
  a positioned frame, give it the `neon-backdrop` class for the radial-glow + scanline field,
  and lay a CRT overlay over the whole frame (recipe in the snippet below; in the app it's
  `#app::after` — see `design/screens/gameplay.html`).
- Dark theme only: page background `var(--bg-deep)`, UI text `var(--text)` in `var(--font-ui)`.

## Styling idiom — tokens + shipped classes, retro rules

Style with CSS custom properties and the shipped class vocabulary. Never hard-code colors,
radii, or shadows; the retro look lives in the tokens.

- Surfaces: `--bg` `--bg-deep` `--surface` `--surface-2` `--surface-3` `--line` `--line-strong`;
  text: `--text` `--text-dim` `--text-muted` `--text-faint`.
- Brand/status: `--accent` (cyan, drives the brand) `--accent-2` `--accent-ink` (text on accent
  fills) `--danger` `--warn` `--success`; tetromino hues `--piece-i/o/t/l/j/s/z`.
- **Retro geometry**: radii are square-ish — `--r-sm:2px` … `--r-xl:5px`, `--r-pill:3px` (no round
  pills). Borders are chunky: `--bw` (2px) standard, `--bw-thick` (3px) for primary CTAs.
- **Elevation**: hard offset shadows, no blur — `--shadow-hard-sm|--shadow-hard|--shadow-hard-lg`.
  Interactive elements "press in" on `:active` (`transform: translate(2px,2px); box-shadow: none`).
  Neon glows (`--glow-accent`, `--glow-soft`) are reserved for the canvas world, progress fills
  and deliberate accents — never on panels/buttons/chips.
- **Type**: `--font-pixel` (Press Start 2P) for UI chrome at small sizes — buttons 11px, chip
  labels 8-9px, eyebrows 9px, all uppercase. `--font-display` (Orbitron) for big headings
  (`--fs-h1`, `--fs-display`) — the pixel face is illegible at that scale, keep the brand mark on
  Orbitron. `--font-ui` (Rajdhani) for body copy, `--font-mono` (JetBrains Mono) for numbers/scores.
- Spacing `--sp-1`(4px)…`--sp-8`(64px); motion `--ease`, `--dur-fast|--dur|--dur-slow`.

Component classes (all in `tokens/app.css`): buttons `btn` + `btn--primary|secondary|ghost|danger|block|lg`,
`icon-btn` (+`icon-btn--c` compact); panels `panel`, modals `modal-scrim` > `panel modal`
(+ `modal h2`, `row`, `stat-row`/`stat`); HUD `hud`, `hud__top`, `hud__row`, chips `chip` +
`chip__label`/`chip__value` + `chip--accent|combo|danger` and compact `chip--c`, power meter
`power`/`power__track`/`power__fill`, next preview `next`/`next__grid`/`next__cell`/`next__bomb-tile`,
goal bar `goal`/`goal__bar`/`goal__fill`; FIRE button `shoot-btn`, `rotate-cluster`, `kbd-hint`;
settings `setting`/`setting__label` + `toggle` (aria-checked drives state); leaderboard `lb`/`lb__row`
(+`lb__row--me`)/`lb__rank`/`lb__name`/`lb__lines`/`lb__score`; name entry `submit-row`/`name-input`;
draft `draft__cards` + `mod-card` + `mod-card--boon|bane|tradeoff` + `mod-card__kind|name|desc`,
`run-mods`/`run-mods__chip`; how-to `howto`/`howto__grid`/`step`/`step__n`/`kbd`; misc `eyebrow`,
`display`, `neon-text`, `brand-gradient`, `muted`, `splash`, `loader`, `rotate-guard`, `pop`.

## Where the truth lives

Read before styling: `styles.css` → `tokens/app.css` (all component CSS; its `@import "./tokens.css"`
pulls every token). Each `design/<group>/<name>.html` card is self-contained working markup for its
component/screen — the fastest way to get a correct composition is to copy from the matching card.

## Idiomatic screen snippet

```html
<div style="width:960px;height:540px;position:relative;overflow:hidden;
            border-radius:var(--r-xl);border:var(--bw) solid var(--line)" class="crt-frame">
  <div class="screen neon-backdrop center">
    <div class="panel modal pop">
      <div class="eyebrow">Paused</div>
      <h2 class="display">Take a breath</h2>
      <div class="row">
        <button class="btn btn--primary">Resume</button>
        <button class="btn btn--secondary">⛶ Fullscreen</button>
        <button class="btn btn--ghost">Quit</button>
      </div>
    </div>
  </div>
</div>
<style>/* CRT scanlines over the whole frame (app: #app::after) */
.crt-frame::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:5;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px);
  mix-blend-mode:multiply;opacity:.3}</style>
```
