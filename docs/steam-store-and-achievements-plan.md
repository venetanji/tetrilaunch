# Steam store & achievements — release plan

The work between "the build runs on a Steam Deck" (done) and "the game is
publicly for sale on Steam." Read [docs/STEAM.md](./STEAM.md) first for the
technical picture (App ID, depots, CI); this document is the **release** plan and
is written to be executed in its own focused session.

## Where we are (2026-09-14)

**Done — do not redo:**

- App ID **5270760**, three depots: `5270761` Windows, `5270762` macOS (x64),
  `5270763` Linux. All three built, uploaded, and committed to the `playtest`
  beta branch by CI (`.github/workflows/desktop.yml` → `steam-upload`, dispatch
  with `steam_upload=true` on `staging`). A build is also live on `default`.
- Launch options set per OS (Linux is `tetrilaunch` + `--no-sandbox`), OS support
  in sync, and the game **runs and plays on the Steam Deck**.
- The desktop monetization boundary is closed (paid-up-front; no purchase
  surface in the depot) — `purchases.ts` + `verify-store-bundle.mjs --desktop`.

**Not done — this plan:** the store page (all manual, the long pole), controller
parity for Deck Verified, achievements (designed here, built later), and the
release timeline.

**Deferred (not blocking launch):** Steamworks binding + overlay (Phase 2),
Steam Cloud (Phase 4). The game is fully unlocked on desktop, so none of these
gate a paid release. Achievements (Phase 3) are designed below but need Phase 2's
IPC boundary to implement.

---

## Part 1 — Store content (one self-contained session)

Everything here is **manual in the Steamworks partner web UI** — there is no API
for store content (confirmed). The session's job is to *prepare* the copy and
images so filling the UI is paste-and-upload, then walk the checklist to green.

### 1a. Copy to draft (prepare, then paste into the store page editor)

Match the existing Play listing's voice (`store/play/`) and the game's real
mechanics (a neon-arcade physics cannon puzzle: fire blocks into orbit, clear
the bays).

- [ ] **Short description** — ≤ 300 characters, the hook.
- [ ] **Full description** — "About This Game" with a few short sections
      (the loop, the tiers/Marks, the contracts, the endgame). Keep it honest;
      no feature we don't ship.
- [ ] **System requirements** — min + recommended, per OS. It's an Electron app:
      a modern dual-core, ~2 GB RAM, ~1 GB disk, any GPU with a browser-grade
      WebGL/canvas. Linux: glibc-based, SteamOS covered.
- [ ] **Controller support description** — full controller support (see Part 2's
      Deck work); write it to match what actually ships.
- [ ] **Store tags** — pick from Steam's list: Puzzle, Arcade, Physics, Casual,
      Singleplayer, Difficult, Colorful, 2D, Score Attack, Controller.
- [ ] **Support info** — support URL/email.
- [ ] **Developer / Publisher names** — decide the exact strings (they show on
      the page and can't be casually changed later).

### 1b. Images — produce at Steam's exact dimensions

Sources: `store/play/screenshots/`, `store/play/screenshots-16x9/`,
`app/resources/`, and `scripts/store-graphics.mjs`. Steam's sizes differ from
Play's, so these are re-exports, not copies.

| Asset | Dimensions (px) | Notes |
| --- | --- | --- |
| Header capsule | 460 × 215 | the store-page banner |
| Small capsule | 231 × 87 | search/rows — legible logo at this size |
| Main capsule | 616 × 353 | front-page features |
| Vertical capsule | 374 × 448 | daily-deal / some shelves |
| Library capsule | 600 × 900 | the box art in a player's library |
| Library hero | 3840 × 1240 | the wide banner on the library page |
| Library logo | transparent PNG | overlaid on the hero |
| Page background | 1438 × 810 | optional |
| Screenshots | 1920 × 1080 (16:9) | **5 minimum**; show real gameplay |

Watch the colour-vision constraint: every distinction the capsules and
screenshots rely on must survive a deutan simulation (carry it on shape, not just
red/green). See the palette memory before exporting.

### 1c. Steamworks form entries (you, in the UI — can't be prepared offline)

- [ ] **Content Survey** — the maturity/content questionnaire.
- [ ] **Pricing** — set *and publish* pricing for package **1822574** (the store
      package). Paid up front.
- [ ] **Trailer** — record and upload (recommended, not strictly required).
- [ ] **Release date** — see Part 3 for the constraint.

### 1d. Exit criteria

The store checklist is all ✔, and the page is submitted and approved as **"Coming
Soon."** That submission starts the clock in Part 3.

---

## Part 2 — Controller parity & Steam Deck Verified

Deck Verified requires *all* functionality reachable by controller. Playtest
already found one gap (the tier-unlock ceremony/banner dismissed only by pointer,
not the A button) — being fixed separately. Before applying:

- [ ] Land the ceremony/banner A-button fix and sweep for other pointer-only
      "dismiss/continue" spots (tutorial/coach, lesson flow).
- [ ] Upload a **default Steam Input controller configuration** and declare
      controller support, so players get the gamepad layout automatically instead
      of having to switch it by hand (as we had to on the test Deck).
- [ ] Full controller playthrough on the Deck — menus, tutorial, a full run,
      contracts, refit, sandbox — nothing needs the touchscreen.
- [ ] Apply for **Deck Verified** (only after the store page is live).

---

## Part 3 — Achievements (provisional implementation)

The proposed 21-achievement catalogue, exact-template Steamworks CSVs, achieved
and grayscale PNGs, and upload instructions now live in
`store/steam/achievements/`. The catalogue is shared with the game and the
main-process allowlist. This replaces the older milestone suggestions here;
retired licences are not achievement requirements.

- Ten tier-unlock achievements, including the initially available Tier 1.
- Four global feats: finish a ten-bay run without congestion, empty the board
  with a line clear, and clear at least three/four lines in one event.
- First real daily Contract, five/all ten owned Workshop systems (including
  stowed systems and the stock Reactor), a full-chain run bay, opening/winning
  the Skydeck, and the hidden Tier S beacon discovery.

Real daily Contracts, ordinary Deep Runs (including lower-tier replays) and
Skydeck runs qualify for clear feats. Training and developer practice do not.
Congestion history survives bay changes and retries. The congestion-free feat
requires a full Deep Run or Skydeck win; retrying alone does not disqualify it.

Progress reconciles one way from the local save to Steam, and earned proofs are
never retracted. Existing saves backfill tiers, system ownership, real Contract
wins, Skydeck access and previously discovered Tier S. Historic skill feats are
not inferred because older saves did not record the evidence.

The sandboxed preload and native binding are implemented; see `docs/STEAM.md`
Phase 2 for packaging and remaining platform checks. Upload and publish the
provisional definitions, then validate actual unlock writes and Steam
persistence before advertising the feature. The overlay and Cloud remain
separate work.

---

## Part 3.5 — Optional: Steam Cloud (Phase 4)

Not required for launch. When wanted: serialize the five `localStorage` keys
(`tetrilaunch.settings/name/best*/meta/bays`) to one JSON doc through the Cloud
API (`ISteamRemoteStorage`), not Auto-Cloud (which would point at Chromium's
LevelDB — a corruption vector). Depends on Phase 2's IPC boundary. Merge divergent
saves by taking the max of every monotonic counter and the union of unlock sets.

---

## Part 4 — Release timeline (the roadmap)

The store page, not the build, sets the earliest launch date:

1. **Store page up as "Coming Soon" for ≥ 2 weeks** before release — this is the
   binding constraint.
2. **Valve reviews** the store page and the build (budget several days); the
   build must launch cleanly (it does, on all three OSes).
3. **Promote a build to the `default` branch** — a deliberate manual click in App
   Admin → Builds (can't be scripted; the guard against shipping a broken build).
4. **Deck Verified** decision comes back (if applied).
5. **Set the release date** and launch.

## Suggested order

Store copy + images (Part 1a/1b) and achievement art (Part 3) can start now in
parallel — they're the long poles. The controller fixes (Part 2) gate Deck
Verified but not the store submission. Get the page to "Coming Soon" as early as
possible to start the two-week clock; everything else fits inside it.
