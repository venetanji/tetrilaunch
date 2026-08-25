# Tetrilaunch 🚀

A neon-arcade **physics cannon puzzle**. Load the cannon, arc tetrominoes across the bay
with an Angry-Birds-style drag, and feed full rows into the sweeping compactor before it
clears them away.

> **This repo is a port** of the original Python/pygame prototype (`main.py`, kept for
> reference) to a **Capacitor.js** app targeting **Web (PWA) · Android · iOS**, deployed on
> **Cloudflare Workers** with a **D1-backed leaderboard**.

**Play:** https://tetrilaunch.com/ (workers.dev fallback: https://tetrilaunch.venetanji.workers.dev/)

## 🎮 How it plays

**Two halves.** *Deep Run* is the exam — long, permadeath, it can beat you.
*Contracts* are the opposite by design: short, free to fail, endlessly retryable.

- **Deep Run is 10 bays** (levels) of rising difficulty — stiffer joints, a faster
  compactor, pricier launches, a tighter clock. Each bay has its own **funding
  target** and **countdown**; bank the target before the clock or the bankroll
  runs out.
- **Two bay restarts a run**, and they are priced in score rather than money.
  Restarting is free and can never be bought — but your **score restarts with
  it**, counted from the bay you restarted, and a **continued run cannot raise
  your Tier**. That keeps the retry a beginner needs (restarting on bay 2
  forfeits almost nothing, because you had almost nothing) without softening
  the ladder (restarting on bay 8 forfeits seven bays and every line). A Tier
  is still won by a clean run.
- **Ten Tiers** are the difficulty ladder over Deep Run. Each one states harder
  terms — the opening bay's funding target climbs from **$600 to $780** (and the
  per-bay climb steepens with it, so a run ends at **$1500** at Tier 1 and
  **$1842** at Tier 10), the shift shortens **180s → 144s**, a shot costs
  **$20 → $30** against a float that always buys the same eight launches — and
  hands you a larger **build budget** to spend on the ship to meet them. The Tier you may
  attempt is always **one above your best clear**. Nothing purchasable raises it —
  a Tier is *won*, never bought, which is what keeps "cleared Tier 7" worth the
  same for everyone. **Every Tier keeps its own leaderboard**, so a heavier one
  can't out-score a lighter one.
- **Three daily Contracts** — one bay, **no clock, no launch cost**, failing costs
  nothing and you can retry forever. What replaces time and money pressure is a
  **launch budget**: N shipments to hit the goal. One of the three is a **pattern
  Contract** — instead of a budget you're handed the *exact* inventory that tiles
  the goal, so every single cube has to end up inside a completed row. **Zero
  waste.** They're generated from a daily seed, so everyone gets the same three.
- **Three currencies, three horizons** (see [docs/ECONOMY.md](docs/ECONOMY.md)):
  - **Funds `$`** last one bay. They pay for launches and *are* the bay's target.
  - **Scrap `♻`** lasts one run (2/line, 10/bay). Spent on the **ship**.
  - **Salvage** is forever, paid out at the end of **every** run — win or lose —
    and spent in the **Workshop** on permanent unlocks.
- **The compactor is your ship.** After bays **3, 6 and 9** you dock at a
  **refit stop** and spend scrap on six systems, three **Grades** each: **Bay
  Extension** (12→18 open cells), **Launcher Coils** (muzzle power + a wind
  stabilizer), **Press Hydraulics**, **Loader Magazine**, **Reactor Output**,
  **Bond Emitter**. Upgrades last the whole run. Grade 1 of a system is a
  Workshop purchase made with salvage and is yours forever; Grades 2 and 3 are
  bought with scrap here. **Grade** is kept verbally distinct from the **Tier**
  ladder above, because they used to both be "tier" — which put "G1 · ♻15" one
  row above "Needs Tier 2" on the Workshop shelf. (Internally they are `tier`
  and `mark` respectively — see the note atop `app/src/game/guide.ts`.)
- **Draft a modifier after every bay** — **2 seeded offers** (or skip), and a
  **third slot once you've cleared 5 daily Contracts**. Twelve mods: Overclock,
  Sturdy/Micro/Bulk Shipments, Demolition Charges, Autoloader, Overtime, Premium
  Contracts, Short Lines, Ballast Load, Bond Breaker, Rapid Loader. Most need a
  **Workshop unlock before they can be OFFERED** — salvage buys the option, never
  the mod, so the draft still deals you a real choice. Four stay free (Overtime,
  Premium Contracts, Ballast Load, Rapid Loader) so a first run isn't an empty
  one. Mods **stack for the rest of the run**, and compound on top of whatever
  ship you refitted.
- **How to Play is a catalogue, not a briefing.** Every material, axis, ship
  system, currency and mode has its own entry (`src/game/guide.ts`), and most of
  them have a **drill** attached — a mock bay with no clock and no bankroll that
  puts that one thing on the belt and nothing else. A drill banks nothing, costs
  nothing and can be retried forever; material drills unlock at the tier whose
  draft can actually deal that material.
- **Drag to aim** — direction sets the launch angle, distance sets the power. A
  dotted **parabola** previews the flight; release to fire. Keyboard on desktop:
  `W/S` aim, `A/D` power, `Space` fire, `Q/E` rotate, `B` bond breaker, `X` arm a
  demolition charge, `F` **hold** the Autoloader trigger. The **ceiling is open** —
  max-power lobs arc above the screen and fall back in. On screen, the **Bond
  Breaker trigger is held for a second** (a charge meter fills it) rather than
  tapped: a charge is a run-long consumable, and a thumb grazing the rail
  mid-drag must not be able to spend one. `B` stays a single press.
- **Shipments come in three sizes**, and size changes weight and rigidity as well
  as shape. **Micro** dominoes are cheap, precise and brittle — but too light for
  their own weight to square up the pile below them. **Bulk** pentominoes are
  expensive, rigid, and heavy enough that landing presses the layers beneath them
  flat. Standard tetrominoes sit between.
- **Demolition charges** are armed consumables, not launches: free to fire, and
  each cube they vaporize **refunds $8**. Blowing up a junk pile that will never
  complete a line is a positive-value play; blowing up a row you were two cubes
  from closing is not.
- The **compactor** (bottom-half red bar) ping-pongs between its open and
  full-advance stops, pressing cubes against the right wall. A row clears only
  when **every cell slot is filled by one settled, squared-up cube**; the pressing
  stroke grinds near-aligned cubes onto the grid. Cubes that bounce back out blink
  away and cost you.
- **The bay settles before it ends.** Cross the funding target and launches stop,
  but the world keeps running: shots already in the air land, and a line your last
  shot completed still gets its pressing stroke and pays out. Then the bay
  celebrates.
- **The HUD tells you when to worry.** Launches-left turns red and pulses at 3 or
  fewer; the reload shows as a bar in the plant and a ring around the muzzle; the
  wind gauge shows the live gust, your stabilizer's cut, and (with the Weather
  Survey unlock) the bay's steady prevailing wind.

Landscape only. The field is authored at 1280×720 and **letterboxed by a layout
solver** that adapts to the viewport's aspect ratio and safe-area insets — see
[docs/NATIVE.md](docs/NATIVE.md#display-what-the-layout-solver-does-and-why-native-needed-it).

## 🅢 Tier S — the sandbox

A practice mode, under the tower rather than on it. Tap the beacon on the
headhouse — the blinking lamp on the tower's roof — **nine times in a row** and
a basement floor appears below the building's slab. The elevator does not serve
it; tapping it opens a level-select screen instead.

From there: any Tier 1-10, any of the ten bays started cold, any Contract
variant, any rig from stock to maxed, any belt (one material, or a parade of all
six), and any difficulty axis pre-ratcheted up to three notches — states a real
run can only reach by drafting its way there across six correct bays.

It is a **game mode, not a cheat menu**, and the difference is enforced:

- No salvage, no tier progress, no mark on the ladder — `RunState.sandbox` makes
  `finishRun` skip `recordRunEnd` entirely, and a Tier S Contract never reaches
  `recordContractClear`.
- Scores go to **their own leaderboard** (`BOARD_SANDBOX`), with its own personal
  best. A run started on bay 9 at Tier 10 on a rig nobody paid for can never
  place against an honest one.
- The gesture toggles, and Settings carries the same switch once found.

The **save-editing tools** (set the Tier, grant salvage, unlock everything, wipe)
are a different thing and stay behind the build gate they always had: they live
in `src/lib/sandbox-cheats.ts`, are reached only through `if (SANDBOX)`, and
`npm run verify:store` fails any bundle their marker string appears in. Build one
with `npm run build:sandbox` / `npm run android:apk:sandbox`.

## 🧱 Architecture

```
app/                      Capacitor + Vite + TypeScript web app
  src/game/               matter.js physics port of main.py
    engine, pieces, cannon, compactor, lineClear, render, input, game
    layout      viewport/aspect-ratio solver (wide | snug | tall + safe areas)
    level       per-bay tunables (the 10-bay ladder)
    upgrades    ship upgrade tracks bought with scrap at refit stops
    mods        drafted modifier pool
    run         one run's state: carry, scrap, tiers, mods
    meta        salvage + permanent unlocks (persists across runs)
    guide       the knowledge catalogue behind How to Play — one row per rule,
                the tier it opens at, and the drill that teaches it
    drills      mock bays, one per lesson: no clock, no bankroll, one material
                on the belt, and nothing banked either way
  src/ui/                 screens + components (menu, HUD, bay-clear, refit,
                          draft, workshop, pause, end, settings, leaderboard)
  src/lib/                api (leaderboard: two boards, Deep Run + Tier S),
                          store (settings/name/meta/per-board best),
                          platform (orientation/haptics/safe-area),
                          purchases (RevenueCat: entitlement, paywall, restore),
                          devmode (the Tier S gesture — ships),
                          sandbox + sandbox-cheats (the save-editing dev tools —
                          build-gated, and grepped out of dist by verify:store)
  src/styles/tokens.css   design tokens — single source of truth (mirrors design/foundations)
  sim/                    headless harnesses: sweep (balance), perf (physics
                          cost), systems (systems smoke test — npm run test)
  worker/index.ts         Cloudflare Worker: serves the app + /api/scores (D1)
  capacitor.config.ts     native shell config
  ios/                    committed Xcode project (see docs/ios.md)
  resources/              icon/splash SVG sources → native asset catalogs
design/                   design-system source (synced to claude.ai/design via /design-sync)
  foundations/ components/ screens/    HTML preview cards
docs/ECONOMY.md           three-currency economy + ship-upgrade design rationale
docs/NATIVE.md            Android/iOS pipeline + the layout solver
wrangler.jsonc            Worker config: static assets + D1 binding
migrations/               D1 schema
main.py                   original pygame prototype (reference)
```

**Tech:** matter.js (physics), HTML5 Canvas (gameplay render), HTML/CSS overlays (UI),
vite-plugin-pwa (installable fullscreen web), Capacitor 8 (`@capacitor/screen-orientation`,
`@capacitor/haptics`), RevenueCat (`@revenuecat/purchases-capacitor` + paywalls, native
only), Cloudflare Workers + D1 (leaderboard).

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
npm run dev:worker                # worker + assets + local D1 at :8787 (staging env)
npm run db:migrate                # apply migrations to the LIVE D1
npm run db:migrate:staging        # ...or to the staging one
npm run deploy                    # build + wrangler deploy --env="" (production)
```

The Worker serves the built app and exposes:

- `GET  /api/scores?mark=7&limit=10` → that **Tier's** top scores
- `GET  /api/scores?limit=10` → combined board, every Tier (the pre-tier shape, kept
  so shipped store builds still see a populated list)
- `POST /api/scores` `{ name, score, mark, level, lines }` → inserts, returns
  `{ rank, mark, scores }`. `rank` is within `mark`. A body with no `mark` stores `0`
  — "untiered", never a real Tier — so an older client cannot 400.

**Boards are per Tier**, because the Tier *is* the build budget
(`upgrades.ts`'s `budgetForMark`): a Tier 1 score and a Tier 9 score are not
comparable, and one shared list ranks players by which Tier they attempted before it
ranks them by how well they flew it. That matters more now the home tower lets a
player drop back down the ladder at will — on a single board, farming Tier 1 would
top it. `level` is the bay the run ended on; it is carried for display and is *not*
the board's key (every client hardcoded it to `1` until tier boards landed).

D1 database: `tetrilaunch-leaderboard` (id in `wrangler.jsonc`). Schema in
`migrations/` — `0001_init.sql`, then `0002_tier_boards.sql`.

### Deploy strategy

**The Worker is the site.** `wrangler.jsonc` binds `tetrilaunch.com` and
`www.tetrilaunch.com` to it as custom domains and serves `app/dist` through the `ASSETS`
binding, with `run_worker_first: ["/api/*"]`. So the app and the Worker do **not** deploy
independently any more: a game commit changes `app/dist`, and `app/dist` is shipped by
`wrangler deploy`. Nothing reaches the live site until that command runs.

(This section used to describe the opposite — Cloudflare Pages building every branch and
serving production, with the Worker deployed "rarely", only when `app/worker/` changed.
That was true before the apex moved onto the Worker and false afterwards, and following it
would deploy a release to a Pages URL nobody visits while `tetrilaunch.com` kept serving
the previous build. Pages branch previews may still exist and are still useful for looking
at layout, but they have no Worker behind them: `/api/scores` on a `*.pages.dev` host
answers the SPA fallback, i.e. `text/html`, not JSON.)

Three environments, and the difference between them is the DATABASE, not the URL:

| | serves | D1 | deployed by |
|---|---|---|---|
| **production** | `tetrilaunch.com`, `www.` | `tetrilaunch-leaderboard` | `npm run deploy`, by hand |
| **staging** | `tetrilaunch-staging.*.workers.dev` | `tetrilaunch-leaderboard-preview` | `.github/workflows/staging.yml`, on every push to `staging` |
| **local** | `:8787` | local (miniflare) | `npm run dev:worker` |

**Releasing to production** — from the repo root, deliberately, by a person:

```bash
git checkout main && git merge --ff-only staging
npm run db:migrate       # applies 0002_tier_boards.sql to the LIVE D1
npm run deploy           # build + wrangler deploy --env=""
```

**Clearing the board is a separate, deliberate command** — not part of the migration.
This release changes the economy across 247 commits, so scores banked under the old
balance are not comparable to anything set after it, and the decision was to start
clean rather than rank two different games together:

```bash
npx wrangler d1 execute tetrilaunch-leaderboard --remote --env="" \
  --command "DELETE FROM scores"
```

It lives here rather than in `migrations/0002` on purpose: a migration runner is a
thing people run without reading, and `DELETE FROM scores` against the live database
is not a thing to discover by running it. `0002` is purely additive, so applying
migrations early is safe and this line is the only irreversible step in the release.

`--env=""` is not decoration. With more than one environment defined, a bare
`wrangler deploy` warns that no target was named and falls back to the top level; naming it
means the release command cannot start resolving somewhere else after a wrangler upgrade.

**The staging environment needs `CLOUDFLARE_API_TOKEN`** in *Settings → Secrets → Actions*
(scopes: Workers Scripts:Edit, D1:Edit). Without it `staging.yml` fails at its token guard,
which is what every run of it has done so far — so there is currently no deployed staging
Worker, and anything reviewed on a `*.pages.dev` URL was the SPA with no API behind it.
`staging.yml` deliberately does not run migrations; apply them with
`npm run db:migrate:staging` when a schema change is what you actually intend.

### Native (iOS / Android)

The **iOS Xcode project is committed** at `app/ios/` (Capacitor 8 + SPM, bundle ID
`com.tetrilaunch.app`, universal, landscape-only, icons generated from `app/resources/`).
On a Mac with Xcode 16+ — no CocoaPods needed:

```bash
cd app
npm install
cp .env.example .env     # RevenueCat public SDK keys
npm run ios:sync         # vite build → verify store bundle → copy into ios/
npm run ios:open         # opens App.xcodeproj
```

Signing, RevenueCat/App Store Connect setup, TestFlight and the App Privacy answers are
written up in **[docs/ios.md](docs/ios.md)**.

Android isn't generated in the repo — full pipeline and prerequisites in
**[docs/NATIVE.md](docs/NATIVE.md)**:

```bash
cd app
npm run cap:add:android   # one-time; needs the Android SDK
npm run android:open      # build + verify + sync + open in Android Studio
npm run android:apk       # build + verify + sync + assembleDebug -> installable APK
```

`app/android/` is gitignored and regenerated from `capacitor.config.ts` by
`cap add`; CI (`.github/workflows/android.yml`) builds a debug APK on every push
touching `app/`, which keeps that regeneration honest. **`app/ios/` is committed**
— see [docs/ios.md](docs/ios.md).

Orientation is locked to landscape at runtime via
`@capacitor/screen-orientation` (and declared landscape-only in the iOS
`Info.plist`); safe-area insets are measured at runtime and fed to the layout
solver (`src/game/layout.ts`).

### Tests

```bash
cd app
npm run test          # systems smoke test (economy, upgrades, sizes, layout, Tier S)
npm run test:uifit    # every screen x 13 devices: fit, tap floor, scroll, clipping
npm run verify:store  # asserts the RevenueCat SDK survived into dist/ — and that
                      # the save-editing dev cheats did NOT
npm run sim:balance   # bays x bots x mods win-rate sweep
npm run sim:perf      # physics step cost vs. cube count
```


## 🎨 Design system

The neon-arcade design system lives in `design/` as self-contained HTML preview cards
(foundations, components, all screens) and is synced to a **claude.ai/design** project with
`/design-sync`. `app/src/styles/tokens.css` is the shared single source of truth for tokens.

## 🗺️ Dev plan

**Shipped.** The roguelite core (a 10-bay `makeBaseLevel(i)` ladder, a stacking
modifier draft, per-bay time limits, bankroll carry-over, line-clear FX) plus the
**refit phase**:

- **Three-currency economy** — funds (bay) / scrap (run) / salvage (forever). See
  [docs/ECONOMY.md](docs/ECONOMY.md) for the full rationale.
- **Ship upgrades** — six tracks × three tiers, bought with scrap at refit stops
  after bays 3/6/9 (`upgrades.ts`). Launcher Coils are the sanctioned answer to
  an unwinnable headwind bay; Bay Extension makes "extend to 18" earned capital.
- **Meta-progression** — every finished run pays salvage, win or lose, spent in
  the Workshop on unlocks that add *options* rather than stat bumps (`meta.ts`).
- **Bombs with an economic argument** — armed consumables, free to fire, refund
  per cube vaporized.
- **Three payload sizes** — micro dominoes / tetrominoes / bulk pentominoes,
  differing in weight and rigidity as well as shape, with the Autoloader as the
  micro build's endgame — a **held** trigger (`⚡`/`F`) at 420ms, so volume is
  something you commit to for a burst rather than a mode you switch on.
- **Contracts** — the short, generated, retryable half. Three a day from a shared
  seed, budgeted in launches rather than strokes so thinking is free. **Pattern
  Contracts** hand you an exact inventory and demand zero waste; a backtracking
  tiler (`tiling.ts`) *proves* the queue fills the goal before the Contract ships,
  because the one failure this mode can't survive is an unwinnable puzzle.
- **The Tier ladder** — ten difficulty steps over Deep Run, each with its own
  bay terms (target, clock, launch cost), its own build budget and its own
  leaderboard, each raised only by beating the one below. Calibrated with a
  headless harness (`sim/`), which is also how we learned the ladder's original
  knobs weren't difficulty at all.
- **Playtest telemetry** — opt-in, per-origin, recording what the sim bots
  structurally cannot: real aim time, where in the compactor's sweep each shot is
  taken, which rows get rejected and why.
- **Settle-then-celebrate** — the bay no longer ends mid-flight; it settles, pays
  out, then plays a BAY CLEARED beat.
- **Aspect-ratio layout solver** + safe-area handling, so the controls stop being
  drawn over the play field on 16:9 and tablet aspects
  ([docs/NATIVE.md](docs/NATIVE.md#display-what-the-layout-solver-does-and-why-native-needed-it)).
- **HUD hierarchy** — launches-left goes red under 3, reload is visible as both a
  plant bar and a muzzle ring.
- **Native path** — platform packages, config, npm scripts, CI debug APK.

Next steps:

1. **Playtest the refit balance.** `TIER_COSTS` (20/35/55) against
   `SCRAP_PER_LINE`/`SCRAP_PER_BAY` (2/10) is a first guess: it lands the player
   at ~78 scrap by the first stop, i.e. one track nearly maxed or two opened.
   Tune until each stop is a real dilemma. The sweep can't measure this — the
   bots never use abilities, and they never hold the Autoloader trigger, so both
   read as a clean 0 delta.
2. **Draft depth** — rarity weights and synergy tags on `ModDef` (tempo mods more
   likely once you own Overclock), a scrap-priced reroll, and 1–2 pure banes with
   a signing bonus for risk players.
3. **Materials** — the next phase, and the one the difficulty ladder is waiting
   on. **Slag** (occupies a slot, can never complete a line), **Cryo** (must be
   struck before it will compact), then Rebar, Volatile, Tar, Magnetic. Each is a
   cube *type*, not a new system — the match-3 trick of getting a thousand levels
   out of one verb. See
   [docs/DESIGN.md](docs/DESIGN.md#materials--the-content-engine); the older
   wishlist here (gravity flips, a second mini-compactor, golden cubes) is
   superseded by it.
4. **Daily seed for Deep Run** — Contracts already share one; give the run itself
   a `RunState.seed` so everyone drafts the same offers, with a per-seed board.
5. **7-bag shuffle** — `pieceSequence: null` is reserved for it in `LevelConfig`;
   implement the bag in `Cannon`, seeded from the run.
6. **Audio gaps** — the sixteen effects (the volatile blast now has its own
   `playExplosion` reading), four stingers, the congestion loops and the Deep
   Run's per-bay music ladder are all wired (`lib/audio.ts`; `bayMusic` in
   `game/run.ts` is which bed covers which bay). Still silent: the payout and
   the salvage refund.
7. **Run history & boards** — the D1 schema keys scores by `level`; everything
   posts to the single run board today. Add bays-reached and a board switcher.
8. **More juice** — screen shake on detonation, combo streak banner, draft-card
   flip-in, refit-purchase clunk. `fx.ts` is the seam.

## 📄 License

Open source — use, modify, and distribute freely.
