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
  from the "Staging branch elevator tower design" handoff bundle, then
  rearranged over a device playtest into the shape that shipped:
  * LEFT is the shelf. The attract demo panel is now the TUTORIAL's door (a
    transparent `.menu__demo-hit` over the whole panel, tagged in the corner
    the bay never fills) — a bay playing itself is already the explanation.
    That freed the row under it for the entitlement entry, which is a
    full-size button there rather than the footnote it started as.
  * CENTRE is the tower: eleven floors, God on the roof, car rides to the
    tapped floor and sets the Mark the Deep Run flies.
  * RIGHT is the loop in the order you do it: the base-bay recap of the parked
    floor, then Deep Run / Contracts / Workshop.
  * The Tier/Best/Salvage chip strip is gone. Tier is the tower, Salvage was
    already on the Workshop button, Best is the recap's one-line header. The
    recap carries no "Tier N · Base bay" line either — the tower says it and
    the Deep Run plate says it again.
  * The tier plate's two halves now have FIXED slots (`min-width: 2ch` /
    `calc(4ch + 0.32em)`), and the number rolls like an odometer while the car
    travels. It used to blank to "··" and resize the primary button.
  `design/screens/menu.html` rewritten to match (it was still carrying the
  PRE-retro token values — `--r-md:10px`, rounded pills — so the card had been
  lying about the app's own corners since the retro pass).
  NOT YET UPLOADED, same reason as the 2026-08-22 entry: this ran from a Claude
  Code web session, where DesignSync has no design-system authorization. Next
  sync from a machine with `/design-login` owes the project, in one plan:
  `design/screens/menu.html` (group "Screens", replacing the old card),
  `design/screens/contracts.html` (group "Screens", still never uploaded), and
  a re-copy of `app/src/styles/app.css` over `tokens/app.css`.
