# Desktop shell (Electron)

Runs the built game in a real desktop window, on the road to a Steam build.

```
npm --prefix desktop ci # from app/, once — this package's deps are its own,
                        # so `npm install` in app/ never provisions them
npm run desktop         # from app/ — runs the existing dist/
npm run desktop:build   # rebuilds dist/ in native mode first
npm run desktop:dist    # rebuilds, then packages for THIS platform
```

If the first launch dies with a missing-binary error, the provisioning step ran
but Electron's download didn't — see the postinstall gotcha below.

## Why its own package

Electron's binary is ~245 MB and lands **inside** `node_modules`, unlike
Playwright — the other heavyweight here — whose browsers live in a shared cache
outside it (`playwright` + `playwright-core` are only ~13 MB of `app/node_modules`).
Installing Electron into `app/` would take that tree from ~293 MB to ~670 MB, and
`app/node_modules` is the one worktrees junction and CI installs. So it lives in
`app/desktop/` with its own `package.json` and its own `node_modules`, which
`.gitignore`'s trailing-slash-free `node_modules` rule already covers at any depth.

npm has no real dependency *groups* — `optionalDependencies` installs by default,
and an optional `peerDependency` would keep the version out of the lockfile — so a
separate package is the honest mechanism, and it matches how `app/` already
relates to the repo root.

## Why a custom `app://` scheme rather than `file://`

Not stylistic. `file://` breaks two things, both quietly:

- **Sound.** Effects load through `fetch()` so they can reach `decodeAudioData`
  (`src/lib/audio.ts`), and Chromium blocks `fetch()` against `file://`. Music
  uses `new Audio()` and would have survived, so the failure mode is a game with
  a soundtrack and no effects — which reads as a mixing bug, not a protocol one.
- **The save.** Settings, player name and all meta-progression live in
  `localStorage` (`src/lib/store.ts`). `file://` documents get an opaque origin,
  so the store is unreliable across launches and can vanish.

A registered standard scheme gives the page a real, stable origin
(`app://tetrilaunch`) and restores both. The leaderboard then works with no
client change: `apiBase()` in `src/lib/api.ts` treats any non-worker host as
remote and points at production, whose `/api` responses are CORS-open.

## Why the `--mode native` bundle

The same reason the Capacitor shell uses it (see `vite.config.ts`): a service
worker inside a shell that already ships every asset caches local files against
local files and buys nothing, while adding a stale-code hazard that has already
shipped the previous build twice on Android. On Steam the argument is sharper —
Steam owns updating, and a worker outliving a depot update would silently run old
code with nothing to evict it.

## Packaging

`electron-builder.yml` produces three desktop packages. Release CI signs and
notarizes the macOS package; Windows remains unsigned and Linux has no platform
code-signing step:

| Platform | Target | Artifact |
| --- | --- | --- |
| Windows | NSIS, per-user, x64 | `Tetrilaunch-<version>-win-x64-setup.exe` |
| macOS | dmg + zip, x64 and arm64 | `Tetrilaunch-<version>-mac-<arch>.dmg` / `.zip` |
| Linux | AppImage, x64 | `Tetrilaunch-<version>-linux-x86_64.AppImage` |

Output goes to `release/` (gitignored). `npm run desktop:dist` from `app/`
builds the `--mode native` bundle first and then packages; `desktop:dist:win`,
`:mac` and `:linux` pin the platform. Cross-building is limited: a dmg needs
macOS, and a Windows installer built from Linux needs Wine — which is why CI
runs one runner per platform rather than three targets on one.

### Where the game bundle goes

`app/dist/` is a **sibling** of this package in the checkout and a **child** of
it once packaged. `files:` in `electron-builder.yml` maps `../dist` to `dist`
inside the asar; `main.js` branches on `app.isPackaged` and resolves one or the
other. Nothing is staged or copied into this directory, so `app/dist/` stays
the single build output the PWA and Capacitor also read.

Everything is inside the asar, audio included — verified with `npx asar list`
after a Linux build: 54 files, byte-identical to `app/dist/`, plus `main.js`
and `package.json` at the root and nothing else.

### Signing

What each platform does about it:

- **Windows.** SmartScreen shows "Windows protected your PC" on first run of
  the installer. More info → Run anyway. Only an EV code-signing certificate
  removes this, and reputation is per-certificate, so it will come back on the
  first build after buying one.
- **macOS release CI.** The app and dmg are signed with a **Developer ID
  Application** certificate, use the hardened runtime, and are notarized by
  Apple. Their bundle ID is `com.tetrilaunch.game`, matching the Apple-team App
  ID used by iOS. Local builds intentionally fall back to the ad-hoc signature
  described below rather than requiring release credentials on every Mac.
- **Linux.** AppImages have no signing story to fail. `chmod +x` and run.

One subtlety worth not undoing: `mac.identity` is `"-"`, not `null`. `null`
skips `codesign` entirely, and an *unsigned* arm64 Mach-O will not exec at all
on Apple Silicon — the build would be dead on arrival on every recent Mac.
`"-"` is the ad-hoc identity: no certificate, no authority, but a real
signature, which is what arm64 requires.

The macOS workflow requires these GitHub Actions repository secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64-encoded `.p12` containing the Developer ID Application certificate and private key |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting that `.p12` |
| `MACOS_SIGNING_IDENTITY` | Full identity, for example `Developer ID Application: Example Ltd (TEAMID)` |
| `APPLE_ID` | Apple Account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple Account |
| `APPLE_TEAM_ID` | Ten-character Apple Developer Team ID |

Export the certificate from Keychain Access, then encode it without line wraps
before storing it as `MACOS_CERTIFICATE`:

```bash
base64 < DeveloperIDApplication.p12 | tr -d '\n'
```

The workflow fails before packaging if any secret is missing; it never silently
publishes an ad-hoc build as a signed release.

### Icons

Three committed sets, all generated by `npm --prefix desktop run icons` from
`app/resources/icon.png` — the same neon mark the store listings use, no new
art. Regenerate only when that art changes.

- `build/icon.png`, 1024² — the macOS source; electron-builder derives the
  `.icns` from it.
- `build/icon.ico`, seven frames (16–256) — hand-built rather than left to
  electron-builder's automatic conversion, which emits a lone 256px frame and
  leaves Explorer to downscale it to the 16px the taskbar draws.
- `build/icons/`, seven sized PNGs (16–512) — a directory, because
  electron-builder only fans a source out into sizes when converting an
  `.icns`. Pointing `linux.icon` at the 1024² png installed exactly
  `hicolor/1024x1024`, which is not a size the icon theme spec lists.

The generator wants `sharp`, which is a dependency of `app/`, not of this
package — run `npm ci` in `app/` first.

### Versioning

`desktop/package.json` and `app/package.json` must carry the same version;
`npm --prefix desktop run check:version` asserts it and every `dist` script
runs it first. In CI the tag is checked against that version rather than
written into the build, because electron-builder bakes the number into the NSIS
uninstall entry, the macOS `Info.plist` and the AppImage's desktop entry — so a
tag that disagreed with the committed version would ship an app that disagrees
with the repo. Bump both files, commit, then tag.

### CI

`.github/workflows/desktop.yml` builds all three on a matrix and publishes to a
GitHub Release. A `workflow_dispatch` is the dry run — same build, artifacts
attached to the run, never a release, however the dispatch was pinned. Only the
release job holds any write permission.

A release starts one of two ways and both have to end in the same state —
desktop artifacts published *and* the signed Android bundle built:

- **A human publishes a release** from the GitHub UI. `release: published`
  reaches both workflows: android.yml builds the signed `.aab`, and desktop.yml
  uploads its artifacts into the release that already exists.
- **Someone pushes a `v*` tag.** desktop.yml creates the release itself, then
  **explicitly dispatches android.yml at the tag**. That dispatch is not
  belt-and-braces: GitHub suppresses workflow runs for events raised by
  `GITHUB_TOKEN`, so the `release: published` from our own `gh release create`
  reaches nobody, and android.yml's `push` trigger is branch-filtered to
  main/staging with no tags — so without the dispatch, the tag-first path would
  ship desktop builds and silently never produce the Android bundle.
  `workflow_dispatch` is the documented exception to that suppression, which is
  why it is the mechanism. android.yml needed no change: it already declares
  `workflow_dispatch`, and its `bundle` job already runs under it.

The dispatch fires **only** when this workflow created the release. If a human
published it, android.yml has already run on the real event, and dispatching
again would build the bundle twice — burning a second `versionCode`, which Play
never gives back.

The `.aab` lands as a workflow artifact for a human to upload to Play, exactly
as it did before; it is not attached to the public release.

## Known gotchas

- **Electron's postinstall may not fire.** On npm 11 the binary download was
  skipped on first `npm install`, leaving `node_modules/electron` without its
  `dist/` or `path.txt`. Reproduced again on npm 10.9.7 during the packaging
  work, so it is not one npm's bug. Fix: `cd node_modules/electron && node
  install.js`. The CI workflow checks for `path.txt` and runs that itself,
  because packaged against a missing binary the failure surfaces minutes later
  and looks like an electron-builder problem.
- **Range requests are not honoured.** `protocol.handle` returns whole files, so
  `<audio>` seeking re-reads a track rather than seeking into it. Harmless for
  local playback; matters if anything ever resumes music mid-track.
- **One instance at a time when debugging.** A second launch with
  `--remote-debugging-port` will not bind the port and CDP silently attaches to
  the older window.

## What this is not

No auto-update and no Steamworks. Achievements, Steam Cloud and an update
channel are their own piece of work; `publish` is explicitly `null` in
`electron-builder.yml` so nothing generates half an update manifest in the
meantime.

## Measured (2026-08-26, on the reference Windows box)

Frame pacing median **8.30 ms**, p95 **8.40 ms** (~120 fps, flat). SFX decode
0.9 s @ 48 kHz. Music track loads at 126.5 s. `localStorage` persists across
launches. Leaderboard returns live production JSON from the `app://` origin.
DualSense enumerates as `mapping: "standard"`, 18 buttons, 4 axes.

## Measured (2026-08-27, packaging, x64 Linux under Xvfb)

AppImage **157 MB**, asar **33.2 MB** around a 32 MB `app/dist/` — all 54 files
present and byte-identical, root holding only `main.js` and `package.json`.

The packaged app was launched and driven over CDP, which is what the two
paragraphs above about `file://` are ultimately for: it loads
`app://tetrilaunch/index.html` out of the asar (`readyState: complete`, 2
canvases, 9 font faces), `fetch()` of `/audio/fx/bombArm.mp3` returns
`200 audio/mpeg` and `decodeAudioData` yields 0.90 s @ 44.1 kHz, `localStorage`
is writable, and the containment check still answers `403` to
`/%2e%2e%2f%2e%2e%2fetc%2fpasswd` — the encoded form, which survives URL
normalisation and is the only kind that reaches the handler as `..`. The
unpackaged `npm run desktop` path was probed the same way and answers
identically, which is the point of the `app.isPackaged` branch.

Not tested here: the Windows and macOS packages. This container has no Wine and
no macOS, so NSIS and the dmg are built for the first time by CI.
