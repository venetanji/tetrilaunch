# A second desktop window is a second writer on the save

`app/desktop/main.js` does nothing to stop a second instance. Two copies of the
game run happily side by side, and because Electron derives `userData` from the
package name, they share one directory — which is where Chromium's cache lives,
and where `localStorage` lives, and `localStorage` is the save.

PR #116 was titled "the game gets a desktop window, **and it needs its own origin
to keep the save**". A second unlocked instance is the other half of that
promise going unkept: the origin is stable, and two windows are both writing to
it.

## What was measured

On the packaged build (`release/win-unpacked/Tetrilaunch.exe`) from
`staging`, Windows 11:

| Run | Result |
| --- | --- |
| Packaged app **alone** | log completely empty — no warnings, no errors |
| Packaged app **while the dev shell was running** | `Unable to move the cache: Access is denied. (0x5)` ×3, `Unable to create cache` ×3, `Gpu Cache Creation failed: -2` ×3 |

Both processes were resolving the same `userData`. Only one directory exists —
`%APPDATA%\tetrilaunch-desktop` — confirmed by listing `%APPDATA%` for anything
matching `etrilaunch` after both had run.

Note the name: `tetrilaunch-desktop`, from `package.json`'s `name`.
`electron-builder.yml` sets `productName: Tetrilaunch`, but `package.json` has
no `productName`, so `app.getName()` resolves to the package name and the
packaged app lands in the same directory as the dev shell.

## Why it is worse than log noise

The cache errors are the visible symptom; the save is the real exposure.
`localStorage` on the `app://tetrilaunch` origin holds `tetrilaunch.settings`,
`.meta`, `.best`, `.bays`, `.name` and `.pads` — the whole of a player's
progress. Two windows each read that at boot and each write on their own
schedule, so the second one to quit wins. A run played in one window can be
erased by the other closing, with nothing anywhere saying so.

Ways a second instance actually happens: double-clicking the desktop shortcut
the NSIS installer creates (it is `oneClick: false`, per-user, so there is a
shortcut), impatience with a slow first launch, and Steam relaunching a title
while the previous process is still shutting down.

## Non-goals — and one trap

**Do not "fix" the `productName` mismatch.** Giving the packaged app its own
`userData` by setting `productName` in `package.json` looks like tidying and is
actually a data-loss bug: the owner's current progress lives in
`%APPDATA%\tetrilaunch-desktop`, and renaming the app points the packaged build
at a fresh empty directory. The save silently resets and the old one is still on
disk under a name nothing reads. If that rename is ever wanted it needs a
migration, and it is not this change.

Sharing one `userData` between the dev shell and the packaged app is otherwise a
feature: playtesting either one continues the same save.

Nothing here changes the window, the protocol handler, or the packaging.

---

## The fix

`requestSingleInstanceLock()` must be called **before** `app.whenReady()`, and
the losing process must quit without running the rest of the startup path.

```js
// A second launch must hand focus to the window that already exists rather
// than opening a rival one. Two instances share userData, and userData is
// where localStorage — the save — lives, so the second writer silently wins.
// Must run BEFORE whenReady: by the time the app is ready, the rival has
// already opened its own cache handles.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // ...existing body, unchanged
  });
}
```

The `if/else` shape rather than an early `return` at module scope, so this reads
the same whether the file is CommonJS or ESM.

`second-instance` firing means a player asked for the game and got nothing
visible; focusing the existing window is the answer they meant. Restoring from
minimised matters — a minimised window that merely gets `focus()` stays hidden,
which reads as the second launch having done nothing at all.

## Verification

Real launches, not reasoning — the failure only appears with two live processes:

1. Launch the packaged exe. Launch it **again**.
2. Expect: the second exits immediately, the first window comes to the front,
   and only one process tree survives (`Get-Process Tetrilaunch`).
3. Minimise the window, launch again — expect it to **restore**, not just take
   focus.
4. Check the first instance's stdout/stderr is still clean. The cache errors in
   the table above are the regression signal; if they appear, two instances got
   through.
5. Save continuity: change a setting, quit, relaunch, confirm it persisted —
   this guards against the `productName` trap being introduced alongside.

## Traps

- Called after `whenReady`, the lock is useless — both processes will already
  have touched the cache.
- macOS: the existing `activate` handler re-creates a window when the dock icon
  is clicked with none open. That is a different path and should be left alone.
- PRs target **`staging`** (`gh pr create --base staging`); `gh` defaults to
  `main`, which is wrong for this repo.
- Run **`npm run typecheck`**, not `npx tsc --noEmit` — the latter misses
  `tsconfig.sim.json`. (`main.js` itself is outside both, but any change that
  strays into `app/src` will be caught by the second one only.)
