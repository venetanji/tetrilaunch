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
player's persona name, one achievement **written**, and the overlay drawing
over the game — on Windows first. Decide on evidence. Record the decision and
the losing option's failure mode here, in the shape the rest of this repo's
docs use.

**The write is not optional, and it is the point.** A spike that only reads
(init, persona name) exercises the easy half of an FFI surface: return values
that are pointers to strings the library owns. Writes take our data across the
boundary — a `const char*` achievement id, a struct, a callback registration —
and a wrong FFI signature there is a **segfault**, not a type error. That is
the specific risk `steamworks-ffi-node`'s youth carries, and reads will not
find it. Unlock a test achievement, `StoreStats()`, and confirm it in the
Steamworks web UI; a binding that survives one write survives the shape of
everything Phase 3 asks of it.

**And the overlay has a wrinkle beyond process placement.** The overlay hooks
the GPU process, and Electron games commonly need

```js
app.commandLine.appendSwitch("in-process-gpu");
```

for it to draw at all — steamworks.js's own docs mention it. That flag is not
free on a game whose whole rendering story is one canvas: it moves GPU work
into the browser process, and the thing this shell has that most Electron apps
do not is a **measured** 120 fps flat frame pacing (median 8.30 ms, p95
8.40 ms, `app/desktop/README.md`). Measure with the switch on before accepting
it — same box, same method, and `sim/renderperf` for the drawing half — and
compare against those numbers rather than against a feeling.

If the overlay costs that flatness, **"no overlay" is a legitimate outcome**.
The overlay buys chat, invites and the browser; this game has no chat surface,
no invites and no multiplayer. Achievements and Cloud do not need it — they are
API calls, not overlay features — and a Steam game with achievements, Cloud
saves and no overlay is unremarkable. A game that stutters is not.

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

Phases 1–4 need no App ID and can start now. **Phase 1 and the subtractive half
of Monetization are done** (this branch); Phase 5's scripts can be written and
dry-run with `preview "1"`, and only the actual upload waits. Phase 6 is gated
on the account and on art.

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
