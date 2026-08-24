# Design-sync notes — Tetrilaunch Design System

- The claude.ai/design project (`81efc3d1-…`) is HAND-SHAPED, not converter-built:
  the repo's `design/**/*.html` mockups upload verbatim as preview cards (each
  carries a `<!-- @dsCard group="…" -->` first line the app's self-check reads),
  `tokens/app.css` + `tokens/tokens.css` are verbatim copies of
  `app/src/styles/`, and the project's `styles.css` @imports them plus Google
  fonts. There is NO `_ds_sync.json` anchor and no converter layout — do not
  run the package converter against this project; sync by uploading changed
  mockups/stylesheets directly (sentinel-fenced), matching existing paths.
- The project also holds user-curated files (`uploads/`, `scraps/`,
  `_ds_bundle.js`, `_ds_manifest.json`, `README.md`) — never overwrite or
  reconcile-delete those from the repo side.
- 2026-07-23: updated `game-over.html`/`level-complete.html` to the composite
  Score + breakdown modal, added `game-over-time.html`/`game-over-broke.html`
  (animated loss screens), refreshed tokens CSS (adds `.lose-fx` rules).
  `game-over-time.html` offsets `.lose-fx__clock` into the open field
  (mockup-only) — the card's modal is taller than the in-game one and would
  hide the app's centered clock.
- 2026-08-22: contracts board redesigned (screens.ts `contractsScreen` + a new
  CONTRACTS BOARD section in app.css). Added `design/screens/contracts.html` —
  the board had no mockup before this. NOT YET UPLOADED: the sync ran from a
  Claude Code web session, where DesignSync has no design-system authorization,
  so the project still has neither the new card nor the refreshed
  `tokens/app.css`. Next sync from a machine with `/design-login` should upload
  `design/screens/contracts.html` (group "Screens") and re-copy
  `app/src/styles/app.css` over `tokens/app.css`.
- 2026-08-24: home screen rebuilt around the TIER TOWER (screens.ts's
  `tierTowerHTML` + `baseBayPanelHTML`, app.css's `.tower` / `.base-bay`),
  from the "Staging branch elevator tower design" handoff bundle. The menu is
  three columns now — brand, shaft, action rail — and the Tier/Best/Salvage
  chip strip is gone: Tier IS the tower, Best is the base-bay panel's header,
  and Salvage was already on the Workshop button. `design/screens/menu.html`
  rewritten to match (it was still carrying the PRE-retro token values —
  `--r-md:10px`, rounded pills — so the card had been lying about the app's
  own corners since the retro pass).
  NOT YET UPLOADED, same reason as the 2026-08-22 entry: this ran from a Claude
  Code web session, where DesignSync has no design-system authorization. Next
  sync from a machine with `/design-login` owes the project, in one plan:
  `design/screens/menu.html` (group "Screens", replacing the old card),
  `design/screens/contracts.html` (group "Screens", still never uploaded), and
  a re-copy of `app/src/styles/app.css` over `tokens/app.css`.
