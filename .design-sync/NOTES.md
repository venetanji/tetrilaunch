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
