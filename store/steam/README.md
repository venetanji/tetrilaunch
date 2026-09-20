# Steam depot scripts

The SteamPipe scripts that upload Tetrilaunch's desktop build to its depots.
App ID **5270760**. Kept here rather than under the gitignored Steamworks SDK
tree because they are ours; sits beside `store/play/` for the same reason.

The full plan is [docs/STEAM.md](../../docs/STEAM.md). Read its Phase 1 and
Phase 5 before touching anything here.

## The scripts

| File | Role |
| --- | --- |
| `app_build_5270760.vdf` | The build. App ID, `ContentRoot`, `Preview`, `SetLive`, and the depot → depot-script map. |
| `depot_build_5270761.vdf` | Windows depot ← `win-unpacked/` |
| `depot_build_5270762.vdf` | macOS depot ← `mac/` (x64; runs everywhere via Rosetta 2 — see the file) |
| `depot_build_5270763.vdf` | Linux depot ← `linux-unpacked/` (the Steam Deck one) |

**`output/` is gitignored** — it is the `BuildOutput` cache and logs.

> **Depot IDs confirmed 2026-09-14:** `5270761` Windows, `5270762` macOS,
> `5270763` Linux. Note macOS and Linux are NOT in AppID order — set each depot's
> **Operating Systems** field in App Admin to match, or Steam serves the wrong
> tree to a platform with no error.

## Two safety defaults baked into `app_build`

- **`Preview "1"` — a DRY RUN.** As committed, `steamcmd` chunks and validates
  the content and uploads **nothing**. This is deliberate: the roadmap's #1 trap
  is a green run that uploaded nothing because someone forgot the flag was on, so
  here forgetting it is the *safe* direction. The real upload flips it to `"0"`,
  and **CI does that over a copy**, never by editing the committed file.
- **`SetLive "playtest"` — a BETA branch.** Beta branches can be set live from
  the script; the **default branch cannot** (that is a manual click in App Admin
  → Builds — the guard between a CI run and shipping to everyone). Point the Deck
  at the `playtest` branch once and every upload lands there.

## Running it

### Dry run — no login, no App-ID access needed

Validates the VDF and that the content chunks cleanly. Do this after any build
before trusting a real upload. `ContentRoot` is relative to the script file, so
run it against the tree `desktop:dist:steam` (or CI) left under
`app/desktop/release/`:

```sh
# from repo root, using the SDK's bundled steamcmd
tools/steamworks/sdk/tools/ContentBuilder/builder/steamcmd.exe \
  +run_app_build "$(pwd)/store/steam/app_build_5270760.vdf" +quit
```

(`builder_linux/steamcmd.sh` on Linux/CI.) A dry run prints the depot manifests
it *would* upload; the exit code and the `output/` logs are the evidence.

### Real upload — CI, to the `playtest` beta branch

`.github/workflows/desktop.yml`'s `steam-upload` job stages the three platforms'
unpacked trees into `app/desktop/release/`, restores the build account's
`config.vdf` from a secret, copies `app_build_5270760.vdf` with `Preview "0"`,
and runs `steamcmd +login <build account> +run_app_build … +quit`.

## The content roots

`npm run desktop:dist:steam` (from `app/`) builds the `--mode native` bundle,
runs the desktop monetization check over it, and packages **only** the unpacked
application directory — the `dir` target each platform block in
`app/desktop/electron-builder.yml` declares. Steam is the installer; a depot
wants that directory, not the NSIS/dmg/AppImage the other targets produce.

Paths are relative to the repo root and **pinned here rather than globbed**: a
glob that matches nothing uploads an empty depot and reports success; a pinned
path that stops existing fails loudly.

| Depot | Content root | Launch binary / target |
| --- | --- | --- |
| Windows `5270761` | `app/desktop/release/win-unpacked/` | `Tetrilaunch.exe` |
| macOS `5270762` | `app/desktop/release/mac/` (x64) | `Tetrilaunch.app` |
| Linux `5270763` | `app/desktop/release/linux-unpacked/` | `tetrilaunch` (lowercase) |

Three things about that table:

- **The Linux binary is lowercase.** `tetrilaunch`, not `Tetrilaunch` — see
  `linux.executableName`. A launch option that disagrees installs and never
  starts.
- **macOS ships x64, on purpose.** A Steam depot is chosen by OS, not CPU, so one
  Mac depot must run on every Mac; x64 does (native on Intel, Rosetta 2 on Apple
  Silicon) from an artifact CI already builds. Native-arm64 / universal is a
  documented follow-up (`docs/STEAM.md`), not the first cut. `release/mac-arm64/`
  holds the arm64 tree if we switch.
- **`dist:steam` builds the host platform and host arch only.** For anything
  else, drive electron-builder directly (`npx electron-builder --dir --linux`
  and so on) from `app/desktop/`, or let CI's matrix do it.

## What must never be in a depot

`steam_appid.txt` beside the binary is a local-development file: it lets
`SteamAPI_Init` succeed without launching through Steam. Shipping it in the depot
breaks the real launch path. Whatever writes it writes it into the checkout,
never into `release/`. (Nothing here writes one yet — there is no Steamworks
binding in the build. That is Phase 2.)

## Manual prerequisites (partner site — not scriptable)

These gate the first real upload and cannot be done via API:

1. **Create the three depots** under App 5270760 and **add every one to the
   app's package.** The alternate-platform trap: a depot not added to the package
   deploys **zero files** on that platform — not an error, nothing. Confirm the
   IDs back into these four files.
2. **Set each depot's launch options** (Windows `Tetrilaunch.exe`, Linux
   `tetrilaunch`, macOS `Tetrilaunch.app`).
3. **A dedicated build account** (email Steam Guard) with depot-build rights, not
   the owner account. Log it in interactively once with `steamcmd`, then preserve
   `config/config.vdf` as the CI secret. Re-supplying a password re-issues the
   token and breaks CI on the *next* release, not at the time.

## Traps (all four cost a full build cycle to discover)

- **`Preview "1"` uploads nothing.** Useful on purpose for the dry run; a trap
  only when it survives into the real upload. CI flips it over a copy.
- **`ContentRoot` is relative to the script file**, not the working directory —
  hence `../../app/desktop/release/`.
- **Alternate-platform depots must be added to the package** (see prerequisite 1).
- **The `default` branch cannot be set live from a script.** `SetLive` is
  beta-only; promoting to default is a deliberate click in App Admin → Builds.
