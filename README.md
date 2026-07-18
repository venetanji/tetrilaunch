# Tetrilaunch 🚀

A neon-arcade **physics cannon puzzle**. Load the cannon, arc tetrominoes across the bay
with an Angry-Birds-style drag, and feed full rows into the sweeping compactor before it
clears them away.

> **This repo is a port** of the original Python/pygame prototype (`main.py`, kept for
> reference) to a **Capacitor.js** app targeting **Web (PWA) · Android · iOS**, deployed on
> **Cloudflare Workers** with a **D1-backed leaderboard**.

**Play:** https://tetrilaunch.venetanji.workers.dev/

## 🎮 How it plays

- **A run is 10 bays** (levels) of rising difficulty — stiffer, harder-breaking joints, a
  faster compactor, pricier launches, and cumulative bankroll targets. Each bay has a
  **countdown clock**; clear the target before it runs out.
- **Draft a modifier after every bay** — pick 1 of 3 seeded offers (or skip): Overclock,
  Wide Bay, Sturdy/Half/Bomb Shipments, Overtime, Premium Contracts, Short Lines, Heavy
  Cargo, Rapid Loader. Mods **stack for the rest of the run**, so the build is the strategy
  (e.g. Half Shipments' cheap dominoes + Rapid Loader tempo, paid for with Overclock's
  shorter clock).
- **Drag to aim** — direction sets the launch angle, distance sets the power (further =
  stronger). A dotted **parabola** previews the flight; release to fire. Keyboard fallback
  on desktop: `W/S` aim, `A/D` power, `Space` fire, `Q/E` rotate. The **ceiling is open** —
  max-power lobs arc above the screen and fall back in.
- **Rotate before you fire** — pieces turn in 90° steps; the ghost at the muzzle and the
  Next preview show the exact orientation you'll launch. With Bomb Shipments, the HUD
  telegraphs when the next launch is a 💣 — it detonates on contact, vaporizing nearby
  cubes penalty-free (great for junk piles, pays nothing).
- Tetrominoes are 4 cubes joined by **breakable joints** — hard hits shatter them.
- The **compactor** (bottom-half red bar) ping-pongs between the 12-cell and 8-cell marks,
  pressing cubes against the right wall. A row clears only when **every cell slot is filled
  by one settled, squared-up cube** (min 8, more when the zone is open); the pressing stroke
  grinds near-aligned cubes onto the grid. Cubes that bounce back out blink away and cost you.
- **Economy**: the bankroll doubles as the score and **carries across bays**. Every launch
  costs money, cleared lines pay out ($100 + combo, shattering in a burst of payout FX).
  Go broke, run out of time, or top out and the run ends — clear bay 10 and the run is
  complete.

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

### Deploy strategy

The app and the leaderboard Worker deploy independently — the Worker code rarely changes,
so it should not rebuild on every game commit:

- **App — Cloudflare Pages (auto, every branch).** The `tetrilaunch` Pages project builds
  each branch into its own preview URL (and `main` into the Pages production URL).
  Project settings: **root directory `app`**, build command **`npm run build`**, output
  **`dist`**. Nothing else is required: on a `*.pages.dev` host the app calls the
  production Worker API cross-origin (the Worker's `/api` responses are CORS-open), so
  every preview shares the live leaderboard.
- **Leaderboard Worker — manual, rare.** Turn **off** auto-deploy (Workers Builds) for the
  Worker in the Cloudflare dash. Deploy it with `npm run deploy` from the repo root only
  when `app/worker/`, `wrangler.jsonc`, or `migrations/` change (schema changes:
  `npm run db:migrate` first).

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

The roguelite core now ships: a **10-bay run** (`makeBaseLevel(i)` ladder in
`app/src/game/level.ts`), a **stacking modifier draft** between bays (10-mod pool in
`app/src/game/mods.ts`, seeded deterministic offers), per-bay **time limits**, **bomb** and
**half-size** shipments, bankroll carry-over (`app/src/game/run.ts`), and line-clear /
detonation FX. Everything is data-driven: a new bay is a formula tweak, a new mutator is a
`ModDef` with an `apply(cfg)` delta.

Next steps:

1. **Balance the ladder from playtests** — the knobs are `makeBaseLevel`'s formulas (target
   deltas vs `timeLimitSec`, `jointBreakStretch` / `jointStiffness` ramps, `launchCost`) and
   each mod's numbers in `mods.ts`. The bay-target growth (+$550 → +$1350 per bay) is a
   first guess; tune until a clean run is tense but fair, and mods feel like real decisions.
2. **Draft depth** — rarity weights and synergy tags on `ModDef` (e.g. tempo mods more
   likely once you own Overclock), a "reroll" costing bankroll, and 1–2 pure banes with a
   cash signing bonus for risk players.
3. **More mutators** — gravity flips, wind gusts, a second mini-compactor, sticky cubes,
   golden cubes (5× payout slot), shielded cubes that need a bomb; each is a `ModDef` plus,
   where needed, a small seam like `pieceCubes` / `bombEvery`.
4. **Meta-progression & daily seed** — persist unlocks (mods unlock as you reach deeper
   bays) and a shared daily `RunState.seed` so everyone drafts from the same offers;
   leaderboard per daily seed.
5. **7-bag shuffle** — `pieceSequence: null` is reserved for it in `LevelConfig`; implement
   the bag in `Cannon`, seeded from the run for fairness.
6. **Audio** — the Sound FX / Music settings toggles exist but no audio is wired up yet
   (launch, shatter, payout, bomb, clock-warning cues).
7. **Run history & boards** — the D1 schema keys scores by `level`; today everything posts
   to the single run board (level 1). Add bays-reached to submissions and a board switcher
   (overall run / daily seed).
8. **More juice** — screen shake on detonation, combo streak banner, draft-card flip-in;
   render/UI layer only (the FX event bus in `app/src/game/fx.ts` is the seam).

## 📄 License

Open source — use, modify, and distribute freely.
