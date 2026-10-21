# Tetrilaunch browser demo

A separate, bounded build of the existing game engine, renderer and inputs.
It contains the existing nine School lessons, then **only the first bay of
Tier 1**. A tier normally contains ten bays; the other nine are not reachable
from this session. Winning that one bay ends the demo with the full-game
availability link. Retry and restart remain available.

No account, checkout, leaderboard writes, campaign progression or save migration.
Keyboard bindings may be read from local storage by the reused input module;
no progress is persisted. Mobile free tiers and native game builds are unchanged.

## Build and test

From the repository root after `npm ci --prefix app`:

```sh
npm run build:demo
npm run test:demo
npm run test:demo:browser
```

`PLAYWRIGHT_EXECUTABLE_PATH` can select a preinstalled browser. Browser tests
use only a local server, with no production API requests. Output is `demo/dist`,
never `marketing/dist` or the native `app/dist`. The Vite build rejects imports
of the full app entry, progression, accounts, payments or native integrations.

The demo is intentionally not linked from the Steam-facing marketing homepage.
The supplied Steam feedback rejects the store's external link to a directly
playable site; it does not establish approval of links onward to this demo.

`wrangler.demo.jsonc` prepares an isolated static Worker artifact with no routes,
no workers.dev preview and no API/database bindings. Nothing in this PR deploys,
changes DNS, or binds `demo.tetrilaunch.com`; that prospective address requires
a separate owner-authorized rollout. The apex build/deploy scripts do not build
or publish the demo.
