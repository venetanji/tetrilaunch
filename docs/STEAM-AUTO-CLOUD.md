# Steam Auto-Cloud setup and verification

This implementation writes a dedicated JSON document. Do **not** sync Electron's
profile, Local Storage/LevelDB, settings, caches, or the installation directory.
Only explicitly packaged Steam builds (`steamBuild: true`) use this persistence.
Direct-download installers, web and mobile keep their existing localStorage saves.
Nothing in this PR changes Steamworks configuration or distributes a build.

## File contract

`progress.json` is a version-1 envelope with the current Steam user's decimal
64-bit ID and allowlisted progression values. The main process obtains that ID
from pinned `steamworks.js@0.4.0`'s `localplayer.getSteamId().steamId64` bigint,
not the app owner or a renderer-supplied ID. It never converts the ID to Number.

Explicit paths, independent of Electron's product/package name:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Tetrilaunch\saves\<SteamID64>\progress.json` |
| macOS | `~/Library/Application Support/Tetrilaunch/saves/<SteamID64>/progress.json` |
| Native Linux / Steam Deck | `~/.config/Tetrilaunch/saves/<SteamID64>/progress.json` |

Linux intentionally uses `~/.config`, even when `XDG_CONFIG_HOME` differs, because
Steam's `LinuxHome` override below watches that exact location. Windows uses
Electron's `appData` OS lookup, honoring redirected Roaming AppData.

The file holds meta-progression, best and sandbox-best scores, name, bays played,
and the progress flags `seenDragHint`, `seenTutorial`, `devMode`. Graphics, audio,
haptics, cursor and control preferences stay local. This is the same progression
that localStorage previously persisted; it does not add mid-run checkpoints.

## Steamworks fields (after a build with this code is installed)

In **Application > Steam Cloud**, assign nonzero per-user storage and file quotas.
Suggested initial limits: **10,485,760 bytes** and **10 files** (one progress file
is expected; application validation caps its values at 1 MiB). These are proposed
admin values, not assertions about current Steamworks configuration.

Add **one** Auto-Cloud path:

| Field | Value |
|---|---|
| Root | `WinAppDataRoaming` |
| Subdirectory | `Tetrilaunch/saves/{64BitSteamID}` |
| Pattern | `progress.json` |
| OS restriction | `Cross-Platform` (called All OSes in older UI/docs) |
| Recursive | No |

Add root overrides:

| Original root | OS | New root | Add/Replace path | Replace Path |
|---|---|---|---|---|
| `WinAppDataRoaming` | macOS | `MacAppSupport` | empty | No |
| `WinAppDataRoaming` | Linux | `LinuxHome` | `.config` | No |

Do not add separate platform-specific cloud roots: overrides preserve the same
cloud filename across OSes. Do not use LinuxXdgDataHome (that is not `.config`).
The filename filter excludes `progress.json.tmp`, `progress.json.bak` and the
local migration journal `Tetrilaunch/migration.json`. Do not enable Dynamic Cloud
Sync for this implementation: it imports at process/window startup, not during
live suspend/resume. Ordinary Auto-Cloud synchronizes around game launch/exit.

Enable Cloud support, publish the Steamworks configuration and wait for the Steam
client to receive it. This is an owner action, not performed by this PR.
See [Valve's Steam Cloud documentation](https://partner.steamgames.com/doc/features/cloud).

## Safety and recovery

- Bootstrap waits for native read before constructing App, whose constructor
  immediately writes progression. A downloaded valid file takes precedence over
  stale Chromium state. Steam progress is kept in an account-specific in-memory
  adapter rather than copied back into shared localStorage.
- First migration belongs to the first Steam account opening the legacy profile.
  A durable local journal records its owner and a pending legacy snapshot before
  writing the first save. A crash resumes that snapshot for its owner; a second
  account receives independent defaults, never that legacy save. A downloaded
  account save also consumes legacy eligibility on that machine.
- An already-initialized account whose file disappears is blocked, rather than
  silently remigrated. Invalid JSON, invalid envelope/fields, future versions,
  mismatched account, invalid migration journal and unavailable/changing Steam
  identity block load/write. Existing files are not replaced with defaults.
- Writes are serialized, temporary-file data is flushed before rename, and POSIX
  directories are fsynced after rename. The previous valid document is retained
  as `.bak`, outside the Cloud pattern. The single-instance lock remains in place.
- Close/quit freezes progression changes, pauses gameplay and awaits renderer
  acknowledgement plus native draining before destruction. Write errors are
  visible and retryable; a failed close offers an explicit choice to retain the
  game or close without saving this session's pending changes.
- Steam handles divergent offline copies as whole-file conflicts. Do not blindly
  merge/max salvage balances or union purchases: that can duplicate currency.
  Keep both copies before resolving a conflict if uncertain.

If blocked: keep copies of `progress.json`, `.bak`, `migration.json`, and the old
profile before recovery. Restore a known-good same-account file while the game is
closed. Never delete the journal just to make an error disappear: doing so can
assign old shared progress to the wrong account. Future schema files require a
compatible build. If Steam is unavailable, restart through Steam; Steam offline
mode works only when the SDK can still identify the logged-in user. No fallback
account is guessed. Existing localStorage is not deleted by migration.

## Required live test matrix (not performed by automated tests)

1. Publish the configuration only for testing; run the intended Steam depot build.
2. On Windows, earn progression, change device preferences, exit normally, and
   verify exactly `progress.json` uploads in Steam's Cloud log/remote file listing.
3. Launch the same account on native Linux/Deck and macOS. Verify progression and
   name restore while graphics/audio/control preferences remain device-local.
4. Reverse the direction; change progression on Deck, exit and wait for sync,
   reopen Windows and verify no constructor-side rollback.
5. Test first legacy migration, a second Steam account on the same OS user,
   returning to the first account, and macOS close-window/reopen without quitting.
6. Play offline on two machines; reconnect and exercise Steam's conflict choice.
   Verify the chosen file, not a stale browser cache, supplies the next launch.
7. In backed-up test saves only, exercise malformed/future JSON, removed file after
   migration, unavailable SDK and interrupted first write. Verify originals remain.
8. Force a disk-write failure, use Retry, then close with saves pending. Verify
   acknowledged progress and backups; explicitly test cancel and discard close.
9. Test Windows build under Proton separately from the native Linux depot. Proton
   uses the Windows Roaming path in its prefix, not the native Linux save path.

Automated tests cover filesystem/journal/identity/payload failures, real renderer
adapter isolation, narrow preload/IPC, lifecycle ordering and ASAR file inclusion.
They do not establish Steam server synchronization or physical OS durability.
