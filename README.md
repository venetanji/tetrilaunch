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
  on desktop: `W/S` aim, `A/D` power, `Space` fire, `Q/E` rotate. The **ceiling is open** —
  max-power lobs arc above the screen and fall back in.
- **Rotate before you fire** — pieces turn in 90° steps; the ghost at the muzzle and the
  Next preview show the exact orientation you'll launch.
- Tetrominoes are 4 cubes joined by **breakable joints** — hard hits shatter them.
- The **compactor** (bottom-half red bar) ping-pongs between the 12-cell and 8-cell marks,
  pressing cubes against the right wall. A row clears only when **every cell slot is filled
  by one settled, squared-up cube** (min 8, more when the zone is open); the pressing stroke
  grinds near-aligned cubes onto the grid. Cubes that bounce back out blink away and cost you.
- **Economy**: you start with a bankroll ($250), every launch costs money ($25), and cleared
  lines pay out ($100 + combo). Reach the **target ($800)** to win — go broke and the run is
  lost. Topping out the field also ends the run.

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

## 🗺️ Dev plan

Only **Level 1 (“Launch Bay”)** ships now, but the tuning surface is in place: `LevelConfig`
(`app/src/game/level.ts`) carries the compactor sweep (`compactorOpenCells` /
`compactorMinLineCells` / `compactorSpeed` / size), the joint breaking point
(`jointBreakStretch`), and the economy (`startingFunds` / `launchCost` / `scorePerLine` /
`penaltyPerLostPiece` / `targetScore`) — a new level or mutator is just a new config entry.

Next steps:

1. **Levels 2+** — a small ladder of configs that tighten the economy and speed up the
   compactor (e.g. narrower `compactorMinLineCells`, lower `startingFunds`, higher
   `launchCost`), plus a level-select/progression flow (`LEVELS[]` already exists).
2. **Balance pass on Launch Bay** — playtest the $250/$25/$100 economy and the strict-clear
   tolerances (`X_TOL`/`Y_TOL`/`ANGLE_TOL` and the settling rates in
   `app/src/game/lineClear.ts`); these are the difficulty knobs.
3. **7-bag shuffle** — `pieceSequence: null` is reserved for it in `LevelConfig`; implement
   the bag in `Cannon`.
4. **Audio** — the Sound FX / Music settings toggles exist but no audio is wired up yet
   (launch, shatter, line-clear payout, broke-warning cues).
5. **Roguelite mutators** — gravity flips/strength, multi-compactor, fragile/sturdy pieces
   (via `jointBreakStretch`), wind; each is a `LevelConfig` delta plus, where needed, a small
   seam like the existing ones.
6. **Per-level leaderboards UI** — the D1 schema already keys scores by `level`; the
   leaderboard screen needs a level switcher once level 2 lands.
7. **Juice** — screen shake on compaction, payout fly-up numbers on clears, particle burst on
   shatter; all render-layer only.

## 📄 License

Open source — use, modify, and distribute freely.
