# Steam

The plan for shipping the Electron desktop build on Steam. Nothing here is
implemented yet; `app/desktop/README.md` describes what exists today and ends
with "No auto-update and no Steamworks" — this document is how that sentence
gets retired.

Read `app/desktop/README.md` first. It explains the `app://` scheme, the
`--mode native` bundle and the two-location `app/dist/` mapping, all of which
this builds on and none of which is repeated here.

## Status

**Blocked on tax verification** of the Steamworks account (submitted late
August 2026; Valve quotes a few business days and it has been about a week).
Until it clears there is no App ID, and without an App ID there are no depot
IDs, no store page and no upload.

That blocks less than it sounds like. Everything through Phase 4 below is local
work that needs no App ID, and even the SteamPipe scripts can be exercised
offline — `preview "1"` in an app_build script does a full dry run that chunks
and validates content without uploading, and `sdk/tools/ContentServer/` serves
depot content locally. The App ID is a find-and-replace at the end, not a
prerequisite.

## What is already true

The desktop shell is not a prototype. Measured on 2026-08-26/27 (numbers in
`app/desktop/README.md`): 120 fps flat frame pacing, working audio, persistent
`localStorage`, a live leaderboard, and a DualSense enumerating as
`mapping: "standard"` with 18 buttons and 4 axes. It packages to an NSIS
installer, a dmg + zip and an AppImage from `.github/workflows/desktop.yml` on
a `v*` tag.

Two things the port would normally have to solve are therefore already solved,
and both were solved for reasons that happen to be Steam reasons:

- **No service worker in the shell.** `--mode native` drops the PWA plugin. On
  Steam this matters more than it did on Android: Steam owns updating, and a
  worker surviving a depot update would serve the previous build's precache
  with nothing left to evict it.
- **The full game is already granted on desktop.** `main.ts`'s `fullGame()` is
  `isUnlimited() || isDesktop`, and its comment says "Revisit if the desktop
  build ever gets a store (Steam)." **The revisit resolves to: leave it
  alone.** Steam is a paid-up-front release, so ownership of the app *is* the
  entitlement, and Steam enforces that at the store — before a single line of
  our code runs. See "Monetization" for the part that does need work.

## Monetization

**Paid up front. Owning the app unlocks everything. RevenueCat plays no part in
the Steam build.**

`fullGame()` already returns true on desktop, so the tier gates
(`FREE_TIER_LIMIT = 3` vs `MARK_COUNT`), the daily-contract allowance and the
Skydeck are open with no change. What needs doing is subtractive: making sure
no *purchase surface* reaches the Steam build.

This is not cosmetic tidying. `purchases.ts` selects its SDK by platform, and
Electron is neither Capacitor platform — `Capacitor.getPlatform()` returns
`"web"` there, so the module falls through to RevenueCat's **web billing**
path. A Steam-distributed game offering its own web checkout for in-game
content is the shape of thing Valve's distribution agreement exists to prevent.
Today it is inert only because `VITE_REVENUECAT_WEB_KEY` is unset in the native
build and the store disables itself with a warning — which is an accident of
configuration, not a guarantee.

So: gate the purchase surface on `isDesktop` explicitly, and extend
`scripts/verify-store-bundle.mjs` — which already exists to stop the wrong key
reaching a shippable bundle — with an assertion that the desktop bundle carries
no RevenueCat key and no paywall entry point at all.

## Phase 1 — the packaging shape

**The single most important thing to get right, and the one most likely to be
got wrong: Steam does not want the installer.**

`electron-builder` currently emits an NSIS `.exe`, a `.dmg` and an `.AppImage`.
All three are *installers*, and all three are wrong for a depot. Steam is the
installer: it downloads a depot's files into `steamapps/common/Tetrilaunch/`
and runs a binary named in the app's launch options. Uploading an NSIS
installer to a depot ships the player a game whose only content is a setup
wizard.

What Steam wants is the **unpacked application directory**, which
electron-builder already produces as a by-product and which is sitting in the
checkout right now:

```
app/desktop/release/win-unpacked/    73 files, 398 MB, Tetrilaunch.exe at the root
```

That directory, verbatim, is the content root for the Windows depot.

Work in this phase:

- Add a `dir` target per platform so the unpacked tree is a declared output
  rather than an artifact of building an installer, and add a
  `desktop:dist:steam` script that builds only that.
- Keep the installer targets. They are the direct-download release and are not
  going away; Steam is an additional channel, not a replacement.
- Pin the per-platform output paths (`win-unpacked/`, `linux-unpacked/`, `mac/`
  and `mac-arm64/`) in the depot scripts rather than globbing, so a rename
  fails loudly instead of uploading an empty depot.

## Phase 2 — linking Steamworks

This is where the packaging assumptions in `electron-builder.yml` stop being
true. Three of its comments say, in effect, "there are no native modules here":

| Setting | Today's reason | What Steamworks does to it |
| --- | --- | --- |
| `asar: true` | Everything is JS and assets | A `.node` or a `.dll`/`.so`/`.dylib` **cannot be loaded from inside an asar**. Needs `asarUnpack`. |
| `npmRebuild: false` | "No native modules anywhere in this package" | True only if the binding is FFI or N-API prebuilt. A node-gyp binding puts a toolchain back on every CI runner. |
| `files:` (no `node_modules`) | "This package has no runtime dependencies" | The binding becomes the first real `dependency`, not a `devDependency`. |

### Choosing the binding — a spike, not a guess

Three candidates, and their npm metadata as of 2026-09-01 is the deciding
evidence:

| Package | Version | Last published | Mechanism |
| --- | --- | --- | --- |
| `steamworks.js` (ceifa) | 0.4.0 | **2024-08-06** | napi-rs native module, prebuilt |
| `@ai-zen/steamworks.js` | 0.3.6 | 2024-04-05 | fork of the above |
| `steamworks-ffi-node` | 0.11.2 | **2026-08-30** | Koffi FFI against an SDK you supply |

`steamworks.js` is the one every tutorial names, and it is **two years stale**.
N-API means Electron 44 is not an ABI problem — that is what napi-rs buys — but
it does mean a bundled Steamworks SDK from 2024 and two years of unfixed
issues.

`steamworks-ffi-node` was published two days ago and `dlopen`s the
redistributable at runtime, which has a specific attraction here: the
redistributable it would load is
`tools/steamworks/sdk/redistributable_bin/steam_api64.dll` — **SDK 1.65, the
version we actually downloaded**, ours to upgrade on our own schedule. It also
keeps `npmRebuild: false` honest, since there is nothing to rebuild. Against
it: a young single-maintainer package, and a wrong FFI signature is a segfault
rather than a type error.

Spike both against the smallest possible target — `SteamAPI_Init()`, the
player's persona name, and the overlay drawing over the game — on Windows
first. Decide on evidence. Record the decision and the losing option's failure
mode here, in the shape the rest of this repo's docs use.

### Where the SDK calls run

**In the main process, behind a preload and `contextBridge` — not in the
renderer.**

`steamworks.js`'s README tells you to set `nodeIntegration: true` and
`contextIsolation: false`. `app/desktop/main.js` currently sets exactly the
opposite, with a comment explaining why:

> No preload and nothing exposed: the game is a plain web app and asks for no
> privileged APIs. Keeping it that way means the shell adds no attack surface
> over the browser it already runs in.

Following the README would tear that down and hand full Node privileges to a
renderer that loads a live leaderboard over the network. It is also
unnecessary: achievements and cloud saves are a handful of coarse, async calls,
which is precisely the shape IPC is good at. The renderer gets a narrow, typed
`window.steam` surface — `unlockAchievement(id)`, `readCloud()`,
`writeCloud(json)` — and nothing else.

The overlay is the exception worth checking during the spike: it hooks the
graphics device, and whether that works from the main process without renderer
node integration is the first thing to verify, because the answer shapes the
whole boundary.

Also needed here: a `steam_appid.txt` beside the binary for local development
(so `SteamAPI_Init` succeeds without launching through Steam), which must
**not** ship in the depot, and `SteamAPI_RestartAppIfNecessary` at startup so
launching the executable directly re-launches it through Steam.

## Phase 3 — achievements

The mapping is favourable. Progression already lives in one place — `meta.ts`'s
`MetaState` — with discrete, named, monotonic milestones: `MARK_COUNT` mark
levels, the `UNLOCKS` tree, `INSTALLS` and their uprates, the Skydeck, and
per-board bests. These are achievement rows almost verbatim.

Two things to decide before defining the set, both easier to get right now than
to fix after the first player earns one:

- **Backfill.** Steam achievements are server-side and the save is local. A
  player who arrives on Steam having already unlocked half the tree offline —
  or who reinstalls — must have their existing `MetaState` reconciled *up* to
  Steam on first launch, once, rather than silently starting from zero. A
  one-way sync (local state implies achievement, never the reverse) is the safe
  direction.
- **Nothing that can be un-earned.** Steam has `ClearAchievement`, but using it
  is player-hostile. `refundRetiredUnlocks()` already removes retired unlocks
  from a save; no achievement may be keyed to anything a refund can take away.

Achievement art (an icon per achievement, earned and unearned) is a real
content task, not a code one, and it is the kind of thing that stalls a
release. `app/resources/` and `scripts/store-graphics.mjs` are the starting
point.

## Phase 4 — Steam Cloud

The save is **five discrete `localStorage` keys**, not an opaque blob:

```
tetrilaunch.settings   tetrilaunch.name   tetrilaunch.best*
tetrilaunch.meta       tetrilaunch.bays
```

That is the good case, and it makes the choice between Steam's two mechanisms
clear:

- **Auto-Cloud** syncs file paths that Steam watches. Pointing it at
  `localStorage` means pointing it at the LevelDB directory inside Electron's
  `userData` — a multi-file store with a write-ahead log that Chromium owns and
  may be mid-write when Steam reads it. That is a corruption vector, not a save
  system.
- **The Cloud API** (`ISteamRemoteStorage`) reads and writes named files we
  control. Serialize those five keys to one JSON document, write it through the
  API on meaningful state changes, read it on launch.

Take the API. It also gives a place to resolve the conflict Auto-Cloud can only
report: a player who played offline on two machines has two divergent
`MetaState`s, and merging them (take the max of every monotonic counter, union
the unlock sets) is strictly better than asking them to pick a file.

This phase depends on Phase 2's IPC boundary and on nothing else.

## Phase 5 — depots and upload

### Layout

One app, three depots, one per platform. Valve's own guidance, and the reason
is operational: a depot is the unit a package grants, and separating them lets
a macOS fix ship without re-uploading 400 MB of Windows.

| Depot | Content root | Launch option |
| --- | --- | --- |
| Windows | `app/desktop/release/win-unpacked/` | `Tetrilaunch.exe` |
| macOS | `app/desktop/release/mac*/Tetrilaunch.app` | the app bundle |
| Linux | `app/desktop/release/linux-unpacked/` | `tetrilaunch` (lowercase — see `linux.executableName`) |

**The gotcha Valve documents and everyone hits:** alternate-platform depots
must be explicitly added to the app's package. If they are not, the
installation deploys **zero files** on that platform — not an error, not a
partial install, nothing. Check this the first time a non-Windows depot goes
live.

### Scripts

Copied from `tools/steamworks/sdk/tools/ContentBuilder/scripts/` and kept in
the repo (`store/steam/`, alongside the existing `store/play/`), because they
are ours and the SDK tree is a gitignored vendor download.

Two traps in the templates, both already noted in
`tools/steamworks/README.md`:

- `app_build_1000.vdf` ships with **`"Preview" "1"`**. Copy it, forget the
  flag, and you get a green run that uploaded nothing.
- `ContentRoot` is relative **to the script file**, not the working directory.
  Ours points out of `store/steam/` at `app/desktop/release/`.

And one from Valve's docs: **the `default` branch cannot be set live
automatically.** `SetLive` works for beta branches only; promoting to default
is a deliberate click in the Steamworks web UI. That is a feature — it is the
thing standing between a tag push and shipping a broken build to everyone.

### CI

`.github/workflows/desktop.yml` already builds all three platforms on a matrix
and knows how to publish on a `v*` tag. The Steam upload is a new job gated on
that matrix, and it needs one thing the workflow has never needed: a **Steam
build account** — a dedicated account with "Edit App Metadata" and "Publish App
Changes To Steam", never the owner account.

Steam Guard is the awkward part, and it works differently from every other
credential in this repo. `steamcmd` cannot be given a 2FA code
non-interactively. The supported path is to log in interactively **once**, on a
developer machine, and preserve the resulting `config/config.vdf` as a
repository secret which CI restores before invoking `steamcmd`. Valve's own
warning is the operational catch: *"If you do login again and provide your
password, a new SteamGuard token will be issued and required"* — so logging in
by hand afterwards invalidates CI's token, and the failure surfaces on the next
release, not at the time.

## Phase 6 — store page and release

Not code, and the long pole once the account clears:

- **The $100 App ID fee**, payable after tax verification, before an App ID
  exists.
- **Store assets.** Capsules at several sizes, screenshots, a trailer. The
  existing `store/play/screenshots/` and `screenshots-16x9/` are a starting
  point but Steam's dimensions are its own.
- **Valve's app review**, which checks the build launches and the store page is
  complete. Budget several days, and note that the store page must be up for
  **two weeks** before release — this, not the build, is what sets the earliest
  possible launch date.
- **Steam Deck verification.** Worth pursuing: the game is landscape,
  controller-friendly, and the gamepad path is already exercised. The Linux
  depot is what makes it possible.

## Sequencing

Phases 1–4 need no App ID and can start now. Phase 5's scripts can be written
and dry-run with `preview "1"`; only the actual upload waits. Phase 6 is gated
on the account and on art.

The one thing worth doing before anything else is the Phase 2 spike, because
the binding choice decides how much of `electron-builder.yml` changes, and that
in turn decides how much of Phase 1 is throwaway.

## Open questions and known gaps

- **macOS signing is not actually wired up, despite the README.**
  `app/desktop/README.md` documents six `MACOS_*`/`APPLE_*` repository secrets,
  and `desktop.yml` reads them — but the workflow declares no `environment:`,
  and the repository has **zero repository-level secrets** (the iOS ones live in
  the `ios-build` environment, which `desktop.yml` does not join). The macOS leg
  has therefore never signed anything; it fails its own missing-secret guard.
- **And the certificate on hand is the wrong type.** `secrets/ios/` holds an
  **Apple Distribution** certificate (team 76LUX2KQMG, expires 2027-09-01),
  which signs App Store submissions. Signing a directly-distributed macOS app
  requires a **Developer ID Application** certificate — a separate cert created
  from the same team. For Steam specifically the hard requirement is weaker than
  for direct download: Steam does not apply the quarantine flag, so Gatekeeper
  is not the obstacle it is for a downloaded dmg, and the ad-hoc
  `identity: "-"` already in the config is enough for an arm64 binary to
  *execute*. Notarization remains the right thing to do and is what the
  direct-download channel needs regardless.
- **Which binding.** Phase 2's spike decides it. Do not pick from the tutorials.
- **Does the overlay work from the main process** with `contextIsolation: true`?
  First thing the spike answers.
- **Achievement art** has no owner yet.
- **Steam's `--no-sandbox` question.** Some Electron games need it under Proton
  and in the Steam runtime. Untested here; find out on the Deck rather than from
  a forum post.
