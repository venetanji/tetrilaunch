# tools/steamworks/

The Steamworks SDK, unpacked. Everything here is gitignored except this file
(`tools/steamworks/*` + `!tools/steamworks/README.md` in the root
`.gitignore`) — it is a versioned vendor download, not source, and the tree is
~25 MB compressed with redistributable binaries and a ContentBuilder that bakes
absolute paths into its output folder.

## Fetching it

Download from <https://partner.steamgames.com/downloads/list> — the "Steamworks
SDK" row, which requires a signed-in partner account. Unzip *into this folder*
so the tree lands at `tools/steamworks/sdk/`:

```
tools/steamworks/
  steamworks_sdk_165.zip   <- the download, kept so the version is provable
  sdk/                     <- unzipped
```

Current version: **1.65** (23 July 2026). Nothing in the build resolves this
path yet; when something does, it should read a `STEAMWORKS_SDK` env var rather
than hard-coding it, because CI fetches its own copy.

## What is in here, and which parts we actually need

| Path | What it is | Us? |
| --- | --- | --- |
| `sdk/tools/ContentBuilder/` | `steamcmd` for win/linux/linuxarm64/osx, plus the `run_build.bat` wrapper and example VDF scripts | **yes** — this is how a build is uploaded to a depot |
| `sdk/tools/ContentBuilder/scripts/` | `simple_app_build.vdf`, `app_build_1000.vdf`, `depot_build_100*.vdf` — the templates our app/depot scripts get copied from | **yes** |
| `sdk/redistributable_bin/` | `steam_api64.dll`, `libsteam_api.so`, `libsteam_api.dylib` for every platform | **indirectly** — `steamworks.js` ships its own copies; these are the reference |
| `sdk/public/steam/` | The C++ headers (`isteamuser.h`, `isteamuserstats.h`, …) | reference only — we bind through Node, not C++ |
| `sdk/tools/ContentServer/` | A local content server, for testing depot content without uploading | maybe, later |
| `sdk/tools/codesigning/` | Valve's DRM wrapper signing tools | no — we are not wrapping |
| `sdk/steamworksexample/`, `sdk/glmgr/` | Valve's sample game (105 of the 270 entries) | no |

## The ContentBuilder shape

`steamcmd` uploads whatever sits under a **content root** according to a VDF
script. The minimal form, from `sdk/tools/ContentBuilder/scripts/simple_app_build.vdf`:

```
"AppBuild"
{
    "AppID"       "1000"
    "Desc"        "build description"
    "preview"     "0"          // "1" = dry run, nothing uploaded
    "ContentRoot" "..\content\"
    "BuildOutput" "..\output\"
    "Depots" { "1001" { "FileMapping" { "LocalPath" "*"  "DepotPath" "."  "recursive" "1" } } }
}
```

Two things about it that bite:

- **`preview "1"` is the dry run** and it is what the shipped examples default
  to in `app_build_1000.vdf`. Copying that template and forgetting the flag
  produces a green run that uploaded nothing.
- **`ContentRoot` is relative to the script file**, not to the working
  directory. Our content root will be `app/desktop/release/`'s unpacked output,
  which is not under `sdk/`, so the script we write lives with the repo and
  points out at an absolute or repo-relative path.

App ID and depot IDs are `1000`/`1001` in every example and are placeholders —
the real ones only exist once the Steamworks app is created, which is blocked on
tax verification.
