# Steam

The plan for shipping the Electron desktop build on Steam. The desktop shell,
Steam packaging path and provisional achievement integration are implemented.
Live achievement persistence, the overlay, Steam Cloud and store publication
still have separate validation or implementation work.

Read `app/desktop/README.md` first. It explains the `app://` scheme, the
`--mode native` bundle and the two-location `app/dist/` mapping, all of which
this builds on and none of which is repeated here.

## Public website

The owner reported submission feedback requiring the apex not serve the full
game. This branch prepares a separate marketing-only artifact and retires the
legacy web PWA; native game packaging is unchanged. See
[WEB-DISTRIBUTION.md](WEB-DISTRIBUTION.md) for the boundary and publication gates.
The supplied reviewer wording objects to the external website linking to direct
play, not explicitly to mobile free tiers. Public store links still need
confirmation; the separate bounded demo must not be linked from this apex yet.
No deployment or store approval is implied.

## Status

**Unblocked.** The Steamworks account cleared tax verification and the app was
approved — **App ID `5270760`**. The SteamPipe scripts are written and live in
`store/steam/` (App ID filled in; depot IDs assumed as AppID+1/+2/+3 and to be
confirmed against the dashboard), and CI can upload them — see Phase 5.

A correction to what this section used to claim: **there is no fully-offline
dry run.** `preview "1"` still requires a login and still contacts the server to
initialize the build — verified 2026-09-14 with SDK 1.65's `steamcmd`, which
gets as far as `Scanning content` and then fails `Failed to initialize build on
server (Access Denied)` under an anonymous login. What that *did* prove offline
(short of the credential wall) is that the VDFs parse, the App ID is recognised,
and the `ContentRoot`/file-mapping resolve against a real `win-unpacked/`. A real
dry run (and any upload) needs the build account logged in. `preview "1"` remains
the right safe default in the committed VDF — it is a build that uploads nothing,
not a build that runs without credentials.

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
  our code runs. See "Monetization" for the part that does need work, and
  "Direct download, post-Steam" for the one future that does force it to
  change.

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

**Done.** The gate is in `purchases.ts` at the two doors a purchase can come
through: `initPurchases` returns before configuring anything, and
`presentPaywall` refuses. Nothing else needed its own gate as a consequence —
with `initPurchases` short-circuiting, `ready` stays false and `webPurchases`
stays null, so `identifyPurchasesUser`, `resetPurchasesUser`,
`restorePurchases` and `refresh` all take the nothing-configured exits the
module already had. That is the module's normal degrade path, not a new one.

`scripts/verify-store-bundle.mjs --desktop` is the other half, and it asks the
question of the EMITTED bundle the way the rest of that script does:

- **No RevenueCat key of any shape** — `appl_`, `goog_`, `rcb_` or `test_`.
  Strict about all four rather than just the web one, because an `appl_`/`goog_`
  key is inert on desktop only for the same reason the web path was inert:
  something else happens not to be there. A depot bundle carries no billing
  credential.
- **The gate's two marker strings are present.** It would be nicer to assert
  the paywall is simply *absent*, and it cannot be done — `presentPaywall` is
  also a string the RevenueCat Capacitor bridge emits, and that bridge
  legitimately ships in this same bundle because iOS and Android build from it
  too. So the positive evidence is the gate itself. `isDesktop` is a runtime
  test (`location.protocol === "app:"`), not an inlined build constant, so
  nothing folds those branches away and their warning strings survive
  minification.

`npm run desktop:dist:steam` runs it. The four installer scripts deliberately
do not: they are the direct-download channel, they are unchanged, and a
developer with a populated `app/.env` building one locally is not doing
anything wrong. The Steam path is the one with a distribution agreement
attached.

The source half is pinned in `sim/systems.ts` ("The desktop monetization
boundary"), including the coupling between the two: the pins read the marker
literals out of `purchases.ts` and assert the verifier greps for exactly those,
because a reworded string would otherwise leave a check that passes forever
against a marker nobody emits.

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

Work in this phase — **done**:

- A `dir` target per platform block in `electron-builder.yml`, so the unpacked
  tree is a declared output rather than an artifact of building an installer,
  and a `desktop:dist:steam` script (`app/package.json` →
  `desktop/package.json`'s `dist:steam` → `electron-builder --dir`) that builds
  only that.
- The installer targets are untouched. They are the direct-download release and
  are not going away; Steam is an additional channel, not a replacement.
  `sim/systems.ts` pins that all four still exist, because the tempting
  "simplification" here is to trade them away.
- The per-platform output paths are pinned in **`store/steam/README.md`** — the
  depot scripts' future home — rather than globbed, so a rename fails loudly
  instead of uploading an empty depot. That file also records what must never
  reach a depot (`steam_appid.txt`) and the traps below, so whoever writes the
  `.vdf`s reads them first.

Measured on x64 Linux, 2026-09-01:

| Command | Emits |
| --- | --- |
| `npm run desktop:dist:steam` | `release/linux-unpacked/` only — **71 files, 315 MB**, launch binary `tetrilaunch` at the root, `resources/app.asar` 33.6 MB. No AppImage. |
| `npm run desktop:dist:linux` | the same tree **plus** `Tetrilaunch-1.0.2-linux-x86_64.AppImage`, 152 MB — unchanged. |

Windows and macOS are unbuilt here for the same reason `desktop/README.md`
records: no Wine and no Mac in this container. Their `dir` targets are declared
identically and their paths are pinned; CI is where they are first exercised.

## Phase 2 — linking Steamworks

**Implemented provisionally with `steamworks.js` 0.4.0.** The package is pinned
as a production dependency of `app/desktop/`, with N-API binaries for Windows
x64, Linux x64 and macOS x64/arm64. `npmRebuild: false` remains valid because
these binaries do not depend on Electron's Node ABI. The alternative
`steamworks-ffi-node` has not been spiked; no comparative runtime claim is made.
The older bundled SDK and maintenance history remain risks to check during
platform testing.

Source evidence for the pinned package is npm's `gitHead`
`fa6c6af2a40dc3923f88d41c2912aa041dfffc6f`:

- `index.js` calls native initialization and pumps callbacks at 30 Hz.
- `src/lib.rs` requests current stats during initialization. Stats readiness is
  asynchronous, so an immediate achievement attempt may fail and must retry.
- `src/api/achievement.rs` implements `activate(id)` as SetAchievement followed
  by StoreStats, returning true only when both calls succeed. `isActivated(id)`
  reads Steam's local achieved flag.
- The binding does not expose UserStatsStored/UserAchievementStored callbacks.
  An acknowledged request therefore means local SDK acceptance, not observed
  server persistence. No separate callback pump or duplicate StoreStats call is
  needed after successful activation.

### Process and launch boundary

`app/desktop/steam-achievements.js` owns all native calls. `preload.js` requires
only Electron's sandbox-permitted module and exposes exactly
`window.steam.unlockAchievement(apiName): Promise<boolean>`. The renderer keeps
`contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`; it never
receives generic IPC, native objects, cloud access or achievement reset methods.

The IPC handler accepts only a top-level `app://tetrilaunch` frame and an exact
API name from the committed achievement catalog. It reads the achieved flag
before activation to avoid duplicate writes. If activation sets the local flag
but StoreStats fails, the bridge tracks the pending store and retries it before
acknowledging that ID. Native load/init failures return false, with another
initialization attempt permitted after 30 seconds. Stats-not-ready results also
return false so the renderer can retry the saved earned IDs.

`desktop:dist:steam` selects `electron-builder.steam.yml`, which injects boolean
`steamBuild: true` into the packaged manifest. Only that explicit packaged
channel calls RestartAppIfNecessary before creating a window. Direct-download
installers start normally without Steam and never request a Steam relaunch.
The desktop Actions workflow also selects this config for all three platforms
when a `workflow_dispatch` has `steam_upload: true`, retaining the macOS signing
and notarization overrides. Tags, releases and regular dispatches keep the base
installer configuration.
Initialization passes App ID `5270760` explicitly; local development does not
need `steam_appid.txt`, and it must never ship in a depot.

### What the package verifies

The binding's native distributions are outside `app.asar` via `asarUnpack`,
including each native library beside its `.node` file. Linux's native binary
has `$ORIGIN` RUNPATH, verified with `readelf -d`. Each platform additionally
copies the Steam redistributable beside the launch executable as the package's
README requests. Installer targets remain available.

Windows has an additional OS prerequisite: the addon's PE import table includes
`VCRUNTIME140.dll`. Electron 44.0.0's
[Windows x64 distribution manifest](https://github.com/electron/electron/blob/v44.0.0/script/zip_manifests/dist_zip.win.x64.manifest)
does not include that DLL. Before Windows playtesting, enable the Microsoft
Visual C++ 2015-2022 x64 Common Redistributable (the v14 runtime) in Steamworks
App Admin, **Installation > Redistributables**, and publish the configuration.
[Valve's Common Redistributables guide](https://partner.steamgames.com/doc/features/common_redist)
describes Steam-managed installation and clean-OS testing. This is a Steamworks
configuration requirement; no VC runtime DLL is copied from this development
machine. Verify the Steam install on a clean Windows machine or VM, including
native initialization and one achievement write. Direct-download installations
also need that Microsoft runtime for Steam achievement support; a missing
runtime makes the bridge unavailable without preventing gameplay.

The afterPack hook in `app/desktop/scripts/verify-steam-package.cjs` opens the
actual ASAR and checks the preload, bridge, catalog equality, pinned production
dependency, native binary, shared libraries and Steam launch metadata. It rejects
`steam_appid.txt` inside the archive or anywhere in the unpacked output. Run
`npm --prefix desktop test` from `app/` for bridge and ASAR fixture tests.

### Validation still owed

On 2026-10-18, a read-only Linux probe loaded the native module, initialized the
running Steam client and read App ID `5270760` back from the SDK. A real
achievement write, persistence after restarting Steam,
offline-to-online reconciliation and Windows/macOS loading remain live checks.
Import and publish the provisional Steamworks definitions before testing writes.

The overlay is deliberately not enabled: no `in-process-gpu` switch or forced
frame invalidation was added. If overlay support is requested, measure it on the
reference machine against the recorded 120 fps baseline (median 8.30 ms, p95
8.40 ms in `app/desktop/README.md`) before accepting its frame-pacing cost.

## Phase 3 — achievements

The provisional 21-achievement catalog, Steam import CSVs and 256 px PNGs are in
`store/steam/achievements/`: ten tier-unlock achievements, four general play
feats and seven progression milestones. The catalog is the API-name authority for asset
generation, renderer achievement logic and the packaged main-process allowlist.
See that directory's README for criteria, import order and art generation.

Achievement progress travels one way: recorded local milestones imply Steam
achievements. Steam never grants gameplay unlocks or changes the local save.
The local earned ledger survives offline play; Steam delivery retries on launch
and while the app runs. Acknowledgements are session-only so later launches read
Steam state again. Achievements never clear an earned Steam flag, and temporary
dev-mode state is not a source of normal gameplay achievements.

Existing saves backfill only milestones supported by retained evidence. A past
congestion-free run or simultaneous triple/quad sweep cannot be reconstructed
from a high score; those must be earned after tracking is introduced. Future
retirement/refunds must preserve any already-earned ledger entry.

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
the repo (**`store/steam/`**, alongside the existing `store/play/`), because
they are ours and the SDK tree is a gitignored vendor download. That directory
exists now and holds a README with the content roots and launch binaries
already pinned — everything about the depots that does not need an App ID.

Two traps in the templates, both already noted in
`tools/steamworks/README.md` and repeated in `store/steam/README.md` where the
scripts will land:

- `app_build_1000.vdf` ships with **`"Preview" "1"`**. Copy it, forget the
  flag, and you get a green run that uploaded nothing.
- `ContentRoot` is relative **to the script file**, not the working directory.
  Ours points out of `store/steam/` at `app/desktop/release/`.

And one from Valve's docs: **the `default` branch cannot be set live
automatically.** `SetLive` works for beta branches only; promoting to default
is a deliberate click in the Steamworks web UI. That is a feature — it is the
thing standing between a tag push and shipping a broken build to everyone.

### CI — implemented

`.github/workflows/desktop.yml` now carries the upload. A `steam-upload` job,
`needs: package`, gated on `workflow_dispatch` with a `steam_upload` boolean so
it **never fires on a tag or a published release** — only on a deliberate,
box-ticked dispatch. When asked, the `package` matrix also uploads each
platform's unpacked tree as a `steam-*` artifact (the installers-only upload
omits them), and the `steam-upload` job downloads all three back into
`app/desktop/release/`, restores the build account's `config.vdf`, fetches
Valve's `steamcmd`, flips `Preview "1"→"0"` over a copy of the committed VDF, and
runs `run_app_build` with `SetLive "playtest"`. The desktop monetization gate
(`verify:store:desktop`) also runs in every matrix leg now, so a depot-bound tree
is proven store-free before it can be uploaded.

It needs one thing the workflow has never needed: a **Steam build account** — a
dedicated account with "Edit App Metadata" and "Publish App Changes To Steam",
never the owner account — supplied as the `STEAM_BUILD_ACCOUNT` and
`STEAM_CONFIG_VDF` secrets in the `desktop-build` environment.

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

> **The build runs and plays on a Steam Deck (2026-09-14).** The actionable
> release plan — store content (with exact image dimensions), the achievements
> design, controller/Deck-Verified work, and the timeline — is its own document:
> [steam-store-and-achievements-plan.md](./steam-store-and-achievements-plan.md).
> The summary below stays as the overview.

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

**Phase 1, the subtractive half of Monetization, and Phase 5's scripts + CI are
done** (this branch). What remains before a build lands on the Deck is not code:
the depots created and added to the package in the partner site, and the build
account logged in once so its `config.vdf` becomes a secret. Then a dispatch with
`steam_upload` ticked pushes to the `playtest` branch. Phase 6 (store page,
review, the two-week window) is gated on art and Valve, not on us. Phases 2–4
(Steamworks binding, achievements, Cloud) are deferred: the game is fully
unlocked on desktop, so none of them block a playable first upload.

The one thing worth doing before anything else is the Phase 2 spike, because
the binding choice decides how much of `electron-builder.yml` changes, and that
in turn decides how much of Phase 1 is throwaway.

## Direct download, post-Steam

**Analysis, not a plan, and deliberately sequenced after the Steam release.**
Recorded here because the conclusion constrains a decision Phase 1 has already
made ("leave `fullGame()` alone"), and a constraint nobody wrote down is a
constraint nobody honours.

The question: could the *direct-download* desktop build sell the full game the
way the web build does — buy on the site, unlock in the app?

### The entitlement check already works anywhere

This is the part that surprises. RevenueCat's `purchases-js` needs a store only
to *sell*. To **read** an entitlement it needs an identity and a key: configure
with the durable App User ID this repo already mints — `${provider}:${sub}`,
`auth.ts`, the same string the Worker derives — call `getCustomerInfo()`, and
ask whether `entitlements.active["full_game"]` is there. No checkout, no
billing surface, no Valve problem: a purchase made in a browser on
tetrilaunch.com would be visible to a desktop build that can prove who it is.

So the unlock is not the missing piece.

### The missing piece is desktop OAuth

Signing in is. `main.ts`'s `fullGame()` comment already names the reason the
desktop carve-out exists — "no workable OAuth to recover a web purchase with
(Google refuses embedded browsers)" — and that is accurate as far as it goes:
an in-app popup is dead. Google's policy on embedded user-agents rejects
exactly what an Electron `BrowserWindow` is, and the flow fails at Google's end
with `disallowed_useragent`, not at ours.

What replaces it is a well-trodden shape, and it is the *only* supported one:

1. A Google OAuth client of type **Desktop app** — a third client id beside the
   Web and iOS ones already in `.env.example`. Desktop clients are public
   clients: they have no usable secret, which is why the flow needs PKCE.
2. The **system browser**, opened with `shell.openExternal` from the main
   process. The user signs in in Chrome/Safari/Firefox, where their session and
   their password manager already are.
3. A **loopback redirect**: the main process listens on `127.0.0.1` on an
   ephemeral port and uses `http://127.0.0.1:<port>` as the redirect URI. Google
   allows loopback for desktop clients precisely for this.
4. **PKCE** ties the two together — the browser gets the code, the loopback
   listener receives it, and only the process holding the verifier can exchange
   it.
5. The id token's subject crosses into the renderer over the same narrow
   `contextBridge` Phase 2 builds for Steam. No `nodeIntegration`, no second
   security posture.

Two follow-on costs, both small and both easy to forget:

- **The Worker's audience allowlist** (`/api/account`, which verifies `aud`)
  would need the desktop client id added beside `GOOGLE_WEB_CLIENT_ID` and
  `GOOGLE_IOS_CLIENT_ID`. See `docs/AUTH.md`.
- **Apple has no loopback story.** Sign in with Apple requires an `https`
  redirect, so a desktop build is Google-only unless the flow bounces through a
  hosted redirect on tetrilaunch.com. Given that any purchase to recover was
  made on the web, Google-only is a defensible first cut.

### The policy consequence, which is why this waits

Doing this **forces `fullGame()` to change**, and that is the whole reason it
is post-Steam rather than pre-.

`fullGame()` is `isUnlimited() || isDesktop` today, and the carve-out is
honest: the desktop build has no way to sell the unlock and no way to restore
one, so gating it could only ever say "buy elsewhere and you still can't
restore it here". Give desktop a working entitlement check and that
justification evaporates — and, more sharply, **the carve-out cannot coexist
with a paid Steam SKU**. Selling the game on Steam while handing the identical
build away unlocked from our own download page is not a pricing strategy; it is
an argument with the players who paid.

So the shape it would have to take:

- Distributed desktop builds become **gated** — `fullGame()` drops `isDesktop`
  and reads the entitlement like everywhere else.
- The free-everything behaviour survives **only in development**: the
  unpackaged shell / `import.meta.env.DEV`, never a packaged build.
- Steam builds are unaffected either way. Ownership is the entitlement there
  and Steam enforces it before our code runs — which is also why the
  monetization gate above stays exactly as it is.

That is a change to a shipped entitlement, it touches `main.ts`, and it takes
something away from players who have the current build. Doing it *before* a
paid channel exists would be taking it away for a benefit that does not exist
yet. Doing it *with* the Steam release means the gate arrives alongside the
store that explains it. One PR, its own, after Steam ships.

### The other two storefronts

- **Mac App Store: possible, weak ROI, not scheduled.** Electron has a `mas`
  target, and paid-up-front works there on the same terms as Steam — ownership
  is the entitlement, no StoreKit wiring, no in-app purchase surface, so the
  monetization gate above covers it unchanged. Against it: the App Sandbox
  entitlements and provisioning profile are their own build leg, App Review is
  a real gate, it is 30%, and premium desktop games are not what that store
  sells. The certificate work it needs (Developer ID for direct download,
  3rd Party Mac Developer for MAS) partly overlaps what the macOS signing gap
  below already owes.
- **Microsoft Store: skipped.** Windows is where Steam is strongest, MSIX is a
  third packaging format to maintain, and the store adds another review queue
  for an audience Steam already reaches. Revisit only if something changes on
  the distribution side, not because the target exists.

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
- **Does the overlay work from the main process** with `contextIsolation: true`,
  and **what does `in-process-gpu` cost the frame?** First two things the spike
  answers, in that order, and "no overlay" is an allowed answer to the second.
- **Desktop OAuth** — a Google "Desktop app" client, system browser, PKCE,
  127.0.0.1 loopback — is scoped in "Direct download, post-Steam" and is
  deliberately not part of any phase above.
- **Achievement art** has no owner yet.
- **Steam's `--no-sandbox` question.** Some Electron games need it under Proton
  and in the Steam runtime. Untested here; find out on the Deck rather than from
  a forum post.
