---
description: Bring every open PR targeting staging onto the USB test phone for review
---

Check open PRs against `staging` on `venetanji/tetrilaunch`, merge the ones not
yet on the phone onto a disposable local test branch, build a debug APK, and
install it — so the user can play-test everything in flight without leaving
this session. This is a review tool, not a merge tool: never merge a PR on
GitHub, only bring its code onto the device.

## 0. Setup (once per session/worktree)

- Device is the OnePlus CPH2573 (serial `2d496b5a`), USB only — no wireless
  adb on this network. `adb devices -l` should show it before doing anything
  else; if not, stop and tell the user to plug it in.
- Prefer the PowerShell tool over Bash in this repo's sessions. If Bash hangs
  on two or three unrelated calls in a row (even `echo`/`pwd`), stop retrying
  it and do everything in PowerShell instead — don't alternate.
- If `app/.env` is missing: `Copy-Item C:\Users\giova\dev\tetrilaunch\app\.env app\.env`
  (RevenueCat keys live only in the main checkout; without this the APK
  builds fine and silently ships with no purchases).
- If `app/node_modules` is missing:
  `New-Item -ItemType Junction -Path app\node_modules -Target C:\Users\giova\dev\tetrilaunch\app\node_modules`
  — instant, and sufficient for the full build (`npm run android:apk`), not
  just typecheck.
- If `app/android` is missing or `npm run android:sync` says "android
  platform has not been added yet": `npm run cap:add:android` (this
  regenerates `app/android`; it's gitignored so a worktree cold-starts
  without it, and a *different* stale `app/native/android` from unrelated
  work can be a false positive — check for `app/android` specifically).
- Never use `git stash` for anything in this repo. `.git` (and its stash
  ref) is shared across every worktree, and concurrent Claude sessions in
  other worktrees collide on it — a push/pop here can silently apply a
  different session's stashed changes to your working tree, or vice versa.
  Commit WIP as a real commit instead; it's cheap to `git reset --soft
  HEAD~1` later if it needs un-committing.

## 1. Find the work

```
gh pr list --repo venetanji/tetrilaunch --base staging --state open --json number,title,headRefName,url
```

For each open PR, briefly summarize what it does (read the PR body) — the
user is going to play-test blind, so they need to know what to look for.
Flag anything the PR author explicitly asks the reviewer to confirm (open
design questions, deliberate tradeoffs left unresolved) — call these out
distinctly, they need a human decision, not a merge.

Also check each PR for review comments worth addressing before it's fair to
test:

```
gh api repos/venetanji/tetrilaunch/pulls/<N>/comments --jq '.[] | {path, line, body}'
```

A Codex/automated review finding is not automatically right — verify it
against the actual code before fixing it (or before dismissing it). If you
fix something, push the fix to the PR's own branch (`git push origin
<headRefName>`) so it survives past this local test build, not just to the
local test branch.

## 2. Build the local test stack

Recreate the test branch from `origin/staging` fresh each time (don't keep
piling merges onto an old local branch — once PRs actually land on
`origin/staging` for real, your old local merges of the same content are
just dead weight and a source of spurious conflicts):

```
git fetch origin staging
git branch -f device-review origin/staging
git checkout device-review
```

Then for each PR to include:

```
git fetch origin <headRefName>
git merge --no-ff FETCH_HEAD -m "Merge PR #<N>: <title>"
```

**On conflict:** read both sides' actual diffs (`git show <base>:<file>` /
`git show <branch>:<file>`) to understand each change's *intent* before
resolving — don't just pick a side. Check whether the surrounding
non-conflicting hunks already reveal what the combined shape should look
like (an auto-merged caller elsewhere in the same file is often the
strongest clue). After resolving, grep the file for stray `<<<<<<<`
markers before staging.

## 3. Verify before installing

```
npm run typecheck
npm run test
npm run test:uifit    # if any merged PR touches layout, CSS, or rendering
```

`test:uifit`'s baseline is empty, so ANY reported violation is real — but
check whether it's actually new (`total N (baselined M, new K)` — K is what
matters) and whether it predates the PR you just merged (`git log -S"<text>"
--oneline -- <file>` to find which commit introduced it) before reporting it
as caused by your merge.

## 4. Build and install

```
npm run android:apk
adb install -r -d app\android\app\build\outputs\apk\debug\app-debug.apk
```

`-d` allows the version-code downgrade that's normal for local debug builds
(Capacitor's generated build.gradle doesn't bump versionCode) and preserves
save data — no need to uninstall first.

## 5. Confirm on-device

```
adb shell dumpsys package com.tetrilaunch.app | Select-String lastUpdateTime
```

should show a timestamp from just now. For a visual check:

```
adb shell dumpsys window | Select-String isKeyguardShowing
```

If `true`, the phone has a secure lock screen up — don't try to bypass it
(no PIN-guessing, no forcing through). Just report the install succeeded via
the package metadata and let the user unlock it themselves. If `false`:

```
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell am start -n com.tetrilaunch.app/.MainActivity
adb shell screencap -p /sdcard/check.png
adb pull /sdcard/check.png <temp path>
adb shell rm /sdcard/check.png
```

then Read the pulled PNG to confirm the build actually renders (not just
that `adb install` exit-coded 0).

## 6. Report

One paragraph per PR: what it changes, what to actually go test for, any
open questions the author left for a human, any review findings you fixed
(and pushed) or flagged. If a PR is a big enough change that it's worth its
own focused playtest, say so rather than burying it in a list.
