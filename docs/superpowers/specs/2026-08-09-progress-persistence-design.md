# Progress persistence: what the platforms already do, and what iOS still has to prove

**Date:** 2026-08-09
**Status:** Android measured and settled. **iOS unverified — blocked on a Mac.**
Server-side sync deliberately not built.

## Why

The app sells an entitlement, and all progression lives in `localStorage`
(`lib/store.ts`: salvage, unlocks, mark, run count, best score, claimed
contracts). The worry that started this: a player buys Unlimited, reinstalls,
and finds Tier 6 gone.

Two things need separating, because only one of them was ever at risk.

**Purchases were never exposed.** `restorePurchases()`
([lib/purchases.ts](../../../app/src/lib/purchases.ts)) ties the entitlement to
the Apple/Google account, so a reinstall recovers the unlock. Verified on device
against RevenueCat's Test Store on 2026-08-09.

**Progress is the real question**, and the answer turned out to be
platform-dependent in a way that matters.

## What was measured (Android — verified)

`android:allowBackup="true"` is Capacitor's default and nothing overrides it, so
**Android Auto Backup is live**. WebView `localStorage` lives under
`app_webview/` inside the app's data directory, which the default backup set
includes.

Tested end to end on a OnePlus 12, Android 14, with the local transport:

```bash
adb shell bmgr transport com.android.localtransport/.LocalTransport
adb shell bmgr backupnow com.tetrilaunch.app     # -> Success, 243712 bytes
adb uninstall com.tetrilaunch.app
adb install app-debug.apk                        # auto-restore runs at install
adb shell bmgr transport com.google.android.gms/.backup.BackupTransportService
```

The full save came back: salvage 81, mark 5, 17 runs, best 17896, all eight
claimed contracts, byte-identical. **On Android, reinstall is already solved,
for free, with no code.**

Critically, it backs up to the **player's own Google Drive**. We neither collect
nor receive it, which is why it needs no Data safety declaration and no
privacy-policy clause.

## The asymmetry iOS is expected to have

Do not assume iOS behaves like Android here. The mechanisms differ in a way that
changes the answer:

- **Android Auto Backup restores per app, at install time.** That is what makes
  "delete the app, reinstall it, progress returns" work.
- **iCloud Backup restores only as part of a full device restore.** Deleting an
  app on iOS deletes its container; reinstalling from the App Store does *not*
  bring it back.

If that holds, iOS covers "I got a new phone" but **not** "I deleted the app and
reinstalled it" — the more common case, and the one Android covers.

WKWebView `localStorage` lives in the app container (`Library/WebKit/…`), which
iCloud Backup includes unless excluded, so the data is *in* the backup. The
question is purely when iOS chooses to restore it.

**This is a hypothesis from documented platform behaviour, not something we
measured.** It needs confirming on hardware before it is treated as fact.

### The check to run (needs a Mac, a device, and an iCloud account)

1. Build and install the app; play far enough to bank distinctive state (a
   couple of Marks and some salvage, so a partial restore is obvious).
2. Force an iCloud backup: **Settings → [name] → iCloud → iCloud Backup → Back
   Up Now.** Wait for it to complete.
3. **Case A — reinstall.** Delete the app, reinstall it, launch. Is progress
   there?
4. **Case B — device restore.** Erase and restore the device from that backup,
   or restore onto a second device. Is progress there?

Read the actual values rather than trusting the menu chips — the leaderboard
`best` alone can be misleading. `Settings → Workshop` shows salvage, mark and
run count together.

Expected: **A fails, B passes.** If A passes, iOS matches Android and this whole
question closes.

## Decision table

| Case A (reinstall) | Case B (device restore) | Do this |
|---|---|---|
| passes | passes | Nothing. Record the result here and close it. |
| **fails** | passes | Expected. Ship as-is for v1, then pick an option below. Reinstall-loss is a real but recoverable support case; note it in [docs/PLAY.md](../../PLAY.md) and the support page. |
| fails | fails | Escalate. Something excludes the container from backup; check for a `.nosync` path or an `NSURLIsExcludedFromBackupKey` set by a plugin before designing anything bigger. |

## Options, if iOS needs covering

Listed cheapest first. **None of these are built.** Do not start one without
re-reading the privacy consequence at the bottom.

1. **Manual save code.** Export/import the `tetrilaunch.meta` blob as a short
   string from Settings. No account, no server, no privacy change, works
   everywhere including web. Costs the player an explicit action, which most
   will never take — but it makes support answerable ("send me your code").
2. **iCloud key-value store** (`NSUbiquitousKeyValueStore`). 1 MB, syncs across
   the user's devices, survives app deletion, needs no server and no account
   beyond the Apple ID they already have. iOS-only, so Android keeps Auto Backup
   and the two platforms stay asymmetric — acceptable, since both then work.
3. **Server-side sync**, Worker + D1. The only option that also fixes web and
   multi-device. Identity is the hard part: Game Center / Play Games Services as
   an identity provider with the blob in our own D1 keeps one storage
   implementation. This is the big one — see the consequence below.

## What server-side sync would cost, beyond the code

Currently `privacy.html` and the Play Data safety answers both say the
leaderboard submission is the only thing that ever leaves the device. Storing
progress against a stable ID makes that false.

- Progress tied to an identifier is **pseudonymous personal data under GDPR**,
  even though the contents are just salvage counts. It needs declaring.
- The Play Data safety form is a declaration Google holds you to; a mismatch
  with observed network behaviour is an enforcement matter, not a correction.
- It needs a **deletion path**, which the current pages already promise for
  leaderboard entries and would have to cover for saves too.
- The opt-out the product owner floated is cheaper than it sounds: "don't sync"
  is exactly today's behaviour, so it is a switch that skips the new path, not a
  second mode to build and test.

Do all of that **in the same change as the code**, never ahead of it. A privacy
policy describing a feature that does not exist yet is simply false.

## Status of the surrounding work

- Android Auto Backup finding is written up in
  [docs/NATIVE.md](../../NATIVE.md#progress-survives-reinstall-on-android-already).
- Purchase and restore paths verified on device via RevenueCat's Test Store; see
  [docs/NATIVE.md](../../NATIVE.md#testing-purchases-without-play-products).
  That testing also found and fixed a restore button that hung forever when the
  player was already entitled.
