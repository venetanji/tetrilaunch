# Steam depot scripts

Empty of scripts on purpose. This is where the SteamPipe `app_build_*.vdf` and
`depot_build_*.vdf` files will live once an App ID exists — copied out of
`tools/steamworks/sdk/tools/ContentBuilder/scripts/`, kept here rather than in
the SDK tree because that tree is a gitignored vendor download and these are
ours. It sits beside `store/play/` for the same reason that directory exists.

What the directory holds today is the one thing that does not need an App ID:
**the content roots, written down.**

The full plan is [docs/STEAM.md](../../docs/STEAM.md). Read its Phase 1 and
Phase 5 before adding anything here.

## The content roots

`npm run desktop:dist:steam` (from `app/`) builds the `--mode native` bundle,
runs the desktop monetization check over it, and then packages **only** the
unpacked application directory — the `dir` target each platform block in
`app/desktop/electron-builder.yml` now declares. Steam is the installer; a
depot wants that directory and not the NSIS/dmg/AppImage the other targets
produce.

Paths are relative to the repo root, and they are **pinned here rather than
globbed** deliberately. A glob that matches nothing uploads an empty depot and
reports success; a pinned path that stops existing fails loudly, at the step
that can still be fixed.

| Depot | Content root | Launch binary |
| --- | --- | --- |
| Windows | `app/desktop/release/win-unpacked/` | `Tetrilaunch.exe` |
| Linux | `app/desktop/release/linux-unpacked/` | `tetrilaunch` |
| macOS (x64) | `app/desktop/release/mac/` | `Tetrilaunch.app` |
| macOS (arm64) | `app/desktop/release/mac-arm64/` | `Tetrilaunch.app` |

Measured on x64 Linux, 2026-09-01: `desktop:dist:steam` emitted
`release/linux-unpacked/` and nothing else — **71 files, 315 MB**, `tetrilaunch`
at the root, `resources/app.asar` 33.6 MB, no AppImage. `desktop:dist:linux`
run afterwards still produced `Tetrilaunch-1.0.2-linux-x86_64.AppImage` at
152 MB, which is the installers-are-untouched half of the same claim. Windows
and macOS are unbuilt (no Wine, no Mac in that container); CI is where their
`dir` targets are first exercised.

Three things about that table:

- **The Linux binary is lowercase.** `tetrilaunch`, not `Tetrilaunch` — see
  `linux.executableName` in `electron-builder.yml` and the reason recorded
  there. A launch option that disagrees installs fine and never starts.
- **macOS has two roots, and which one ships is still open.** Two arches, two
  directories, one `.app` in each. Per-arch depots, a universal build, or
  arm64-only are all defensible and the choice belongs to Phase 5, so no path
  here is marked canonical yet.
- **`dist:steam` builds the host platform and host arch.** That is what makes
  it a fast local loop. For anything else, drive electron-builder directly
  (`npx electron-builder --dir --mac --arm64` and so on) from `app/desktop/`.
  Cross-building the unpacked tree is *less* constrained than the installers —
  there is no NSIS toolchain or dmg to make — but a macOS tree still wants a
  Mac to sign, ad-hoc or otherwise.

## What must never be in a depot

`steam_appid.txt` beside the binary is a local-development file: it lets
`SteamAPI_Init` succeed without launching through Steam. Shipping it in the
depot is a documented way to break the real launch path. Whatever writes it
must write it into the checkout, never into `release/`.

## Traps to expect when the scripts do land

All four cost a full build cycle to discover, and all four are already known:

- **`app_build_*.vdf` ships with `"Preview" "1"`.** Copy the template, forget
  the flag, and you get a green run that uploaded nothing. Useful on purpose
  before an App ID exists: `preview "1"` is a complete dry run that chunks and
  validates content offline.
- **`ContentRoot` is relative to the script file, not the working directory.**
  From here that means pointing back out at `app/desktop/release/`.
- **Alternate-platform depots must be added to the app's package.** If they are
  not, installing on that platform deploys **zero files** — not an error, not a
  partial install, nothing. Check it the first time a non-Windows depot goes
  live.
- **The `default` branch cannot be set live from a script.** `SetLive` works on
  beta branches only; promoting to default is a deliberate click in the
  Steamworks web UI. That is a feature, and the thing standing between a tag
  push and shipping a broken build to everyone.
