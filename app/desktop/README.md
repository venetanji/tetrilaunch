# Desktop shell (Electron)

Runs the built game in a real desktop window, on the road to a Steam build.

```
npm run desktop         # from app/ — runs the existing dist/
npm run desktop:build   # rebuilds dist/ in native mode first
```

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

## Known gotchas

- **Electron's postinstall may not fire.** On npm 11 the binary download was
  skipped on first `npm install`, leaving `node_modules/electron` without its
  `dist/` or `path.txt`. Fix: `cd node_modules/electron && node install.js`.
- **Range requests are not honoured.** `protocol.handle` returns whole files, so
  `<audio>` seeking re-reads a track rather than seeking into it. Harmless for
  local playback; matters if anything ever resumes music mid-track.
- **One instance at a time when debugging.** A second launch with
  `--remote-debugging-port` will not bind the port and CDP silently attaches to
  the older window.

## What this is not

No packaging, no icon, no auto-update, no Steamworks. `electron-builder`,
achievements and Steam Cloud are their own piece of work.

## Measured (2026-08-26, on the reference Windows box)

Frame pacing median **8.30 ms**, p95 **8.40 ms** (~120 fps, flat). SFX decode
0.9 s @ 48 kHz. Music track loads at 126.5 s. `localStorage` persists across
launches. Leaderboard returns live production JSON from the `app://` origin.
DualSense enumerates as `mapping: "standard"`, 18 buttons, 4 axes.
