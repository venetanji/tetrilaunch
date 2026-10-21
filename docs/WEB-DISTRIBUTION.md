# Public website and game distribution

The public apex is a marketing site, not the full browser game. This separation
responds to the owner's report of Steam submission feedback. The exact reviewer
message has not yet been supplied; this implementation is not a claim of Steam
approval or a general statement of Valve policy.

## Build boundary

- Root `npm run build` creates `marketing/dist` from an explicit asset allowlist.
  Both production and staging Wrangler asset bindings use this directory.
- `app/` still builds the complete game for local development and native stores.
  Its `dist`, entry point, gameplay, entitlements and native packaging are unchanged.
- No full-game module, soundtrack, PWA manifest or desktop download is published
  by the marketing build. Missing game routes/assets return 404, not a SPA shell.
- `/api/*` remains on the existing Worker and D1 binding. Installed applications
  use this origin for scores and account operations; replacing the homepage must
  not remove their API or change production/staging database isolation.
- The existing branded screenshots describe the full product, not an available
  browser demo. A playable demo is deliberately not included in this PR.

## Returning web players

The old game was an offline PWA. Merely replacing index.html leaves returning
players under an old service worker that can still serve the game from cache.
The website therefore publishes a retirement worker at the old `/sw.js` URL.
It activates promptly, removes only this root game's Workbox cache, and retires
its registration. Browser tests cover the upgrade from a controlled cached game.
Local saves and unrelated caches are not deleted.

A client that never reconnects can retain a previously downloaded offline game.
This server change cannot remotely revoke offline copies or other distribution
channels. The migration needs an online update check. Keep the retirement worker
available during the transition; do not replace it with a 404 or game fallback.

## Store destinations and release checklist

On 2026-10-21, the official Steam URL for documented app ID 5270760 redirected to
the generic Steam homepage rather than a Tetrilaunch listing. No public Apple
App Store or Google Play listing URL was found in the repository. Pending stores
must remain honestly labelled, not buttons to guessed or unrelated pages.
Existing tester destinations are beta access, not public store availability.

Before publishing, the owner should:

1. Compare this change with the exact Steam review message, including whether a
   limited demo and any beta access are acceptable.
2. Confirm the public game-specific store URLs and availability labels. Decide
   how existing web purchasers obtain access or support after the web game is
   retired; retaining the API does not preserve its removed Player Account UI.
   The site directs these players to the existing support address without
   promising refunds, automatic save transfer or a replacement entitlement.
3. Inspect desktop and portrait/mobile previews, policy pages, and the legacy
   PWA upgrade test evidence.
4. Explicitly authorize the usual staging/production deployment. This draft PR
   neither deploys nor changes domain routes, release tags or store submissions.
5. After deployment, verify the served marketing build ID and retained API;
   check a returning installed PWA online, not just a fresh browser tab.

An eventual demo should have its own entry and bounded session/content, without
importing `app/src/main.ts`, progression, store entitlements, payments, sign-in,
achievements or leaderboard writes. A hidden full-game flag is not a demo build.

## Reproduce

From repository root:

```sh
npm ci --prefix app
npm run build
npm run test:marketing
npm run test:marketing:browser
cd app
npm run typecheck && npm test && npm run test:uifit && npm run build
```

For a preinstalled system Chromium, set `PLAYWRIGHT_EXECUTABLE_PATH` explicitly.
Do not change UI-fit baselines to conceal browser or layout differences.
The marketing checks are read-only and use local fixtures, not production APIs.

## Draft validation evidence (2026-10-21)

- Marketing build and two basic build/support regressions passed.
- Artifact checks passed: 27 allowlisted files, no game/native/audio/PWA payload;
  both Worker asset bindings and the root build command target marketing only.
- Service-worker VM checks passed for exact cache ownership, policy navigation,
  unregistration, and no fetch interception. This is not browser execution.
- App typecheck and production game build passed. All 5,529 systems assertions,
  API-routing checks, and trajectory-cache checks passed when the three test
  programs were invoked directly with `node --import tsx`.
- The normal `npm test` CLI wrapper could not create its IPC socket in this
  session. Browser/UI-fit execution was also blocked by environment socket
  permissions; the elevated execution path failed during environment setup.
  No UI-fit baseline counts, screenshots or real PWA migration success are
  claimed locally. The owner approved publishing the draft and using read-only GitHub CI for
  these blocked gates on 2026-10-21. Browser results remain pending until CI runs.
