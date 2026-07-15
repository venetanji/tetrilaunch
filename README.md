# Tetrilaunch 🚀

A neon-arcade **physics cannon puzzle**. Load the cannon, arc tetrominoes across the bay
with an Angry-Birds-style drag, and feed full rows into the sweeping compactor before it
clears them away.

> **This repo is a port** of the original Python/pygame prototype (`main.py`, kept for
> reference) to a **Capacitor.js** app targeting **Web (PWA) · Android · iOS**, deployed on
> **Cloudflare Workers** with a **D1-backed leaderboard**.

**Play:** https://tetrilaunch.venetanji.workers.dev/

## 🎮 How it plays

- **Drag to aim** — direction sets the launch angle, distance sets the power (further =
  stronger). A dotted **parabola** previews the flight; release to fire. Keyboard fallback
  on desktop: `W/S` aim, `A/D` power, `Space` fire, `Q/E` rotate.
- Tetrominoes are 4 cubes joined by **breakable joints** — hard hits shatter them.
- The **compactor** (bottom-half red bar) sweeps right, compacting cubes against the wall.
  Complete a row to its right to **clear it for points**; cubes stuck on its left blink out
  and cost you.
- Reach the **target score** to clear the level, then post your score to the leaderboard.

Landscape only (fullscreen PWA on web, orientation-locked on mobile, with a rotate-device
guard in portrait).

## 🧱 Architecture

```
app/                      Capacitor + Vite + TypeScript web app
  src/game/               matter.js physics port of main.py
    engine, pieces, cannon, compactor, lineClear, render, input, level, state, game
  src/ui/                 screens + components (menu, HUD, pause, end, settings, leaderboard)
  src/lib/                api (leaderboard), store (settings/name), platform (orientation/haptics)
  src/styles/tokens.css   design tokens — single source of truth (mirrors design/foundations)
  worker/index.ts         Cloudflare Worker: serves the app + /api/scores (D1)
  capacitor.config.ts     native shell config
design/                   design-system source (synced to claude.ai/design via /design-sync)
  foundations/ components/ screens/    HTML preview cards
wrangler.jsonc            Worker config: static assets + D1 binding
migrations/               D1 schema
main.py                   original pygame prototype (reference)
```

**Tech:** matter.js (physics), HTML5 Canvas (gameplay render), HTML/CSS overlays (UI),
vite-plugin-pwa (installable fullscreen web), Capacitor (`@capacitor/screen-orientation`,
`@capacitor/haptics`), Cloudflare Workers + D1 (leaderboard).

## 🚀 Develop

```bash
cd app
npm install
npm run dev          # http://localhost:5173  (vite dev)
npm run build        # typecheck + production build → app/dist
```

### Cloudflare Worker + D1 (leaderboard)

From the repo root:

```bash
npm install                       # wrangler + workers-types
npm run build                     # builds app/dist
npm run db:migrate                # apply migrations to the remote D1 database
npx wrangler dev --local          # run worker + assets + local D1 at :8787
npm run deploy                    # build + wrangler deploy
```

The Worker serves the built app and exposes:

- `GET  /api/scores?level=1&limit=10` → top scores
- `POST /api/scores` `{ name, score, level, lines }` → inserts, returns `{ rank, scores }`

D1 database: `tetrilaunch-leaderboard` (id in `wrangler.jsonc`). Schema in
`migrations/0001_init.sql`.

> **CI note:** if the repo auto-deploys via Cloudflare Workers Builds, set the build command
> to `npm run build` and the deploy command to `npx wrangler deploy` at the repo root so the
> app bundle and D1 binding are picked up.

### Native (Android / iOS)

```bash
cd app
npm run build
npx cap add android      # or: npx cap add ios
npx cap sync
npx cap open android     # build/run in Android Studio / Xcode
```

Orientation is locked to landscape at runtime via `@capacitor/screen-orientation`.

## 🎨 Design system

The neon-arcade design system lives in `design/` as self-contained HTML preview cards
(foundations, components, all screens) and is synced to a **claude.ai/design** project with
`/design-sync`. `app/src/styles/tokens.css` is the shared single source of truth for tokens.

## 🗺️ Roadmap

Only **Level 1 (“Launch Bay”)** ships now. Clean seams are in place for what's next:

- `app/src/game/level.ts` `LevelConfig` — more levels + **roguelite mutators** (gravity
  flips, faster/multi compactors, custom piece bags, target modifiers) drop in as new configs.
- Difficulty scaling, run/upgrade screens, per-level leaderboards (the D1 schema already keys
  scores by `level`).

## 📄 License

Open source — use, modify, and distribute freely.
