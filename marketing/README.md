# Apex marketing artifact

Build from the repository root with `node scripts/build-marketing.mjs`. The
Worker output is **marketing/dist**. It is a separate, dependency-free
static site adapted from the existing branded landing page and real gameplay
screenshots. The explicit file allowlist is the distribution boundary: no game
bundle, audio, manifest, checkout, native installer, or hidden full-game route
is copied. Native/desktop game builds remain unchanged.

The existing Cloudflare Pages integration builds from `app/` and publishes
`app/dist`. Pages sets `CF_PAGES=1`, so `npm run build` there emits the same
marketing allowlist into that output directory. Local app builds still build
the full game; `npm run build:game` selects it explicitly. Native packaging
continues to use `build:native`.

The homepage and /about describe the game, show screenshots, and present store
availability. The separate browser demo reuses School plus the first bay of Tier 1 in its own
bounded artifact. It is not copied here or linked as play from this Steam-facing
landing page; an onward playable link has not been approved by the reviewer.

## Store readiness

On 2026-10-21, the official Steam URL for the documented App ID 5270760 redirected
to the generic Steam homepage, not a public Tetrilaunch product listing. The
Steam card therefore says coming soon and is non-interactive. iOS and Android
public store listings are also pending; no product IDs or release date are
invented. Replace the matching pending card with a real link only after the
specific public product page is verified. Do not link a generic store homepage
or GitHub Releases (which would bypass the paid desktop store).

Existing TestFlight and Android closed-testing entry points remain under a
collapsed, explicitly labeled testing section. They are not public store links.
The original privacy and terms documents are copied without changing legal text;
their home-link label changes from “Play Tetrilaunch” to “Tetrilaunch home”. The marketing-specific support page
explains the browser transition, retained local saves, lack of automatic save
transfer, and the existing support email for prior web purchase/account help.
The native support source is unchanged.

Before deployment, the owner must confirm how previous web buyers can resolve
purchase access and account requests. Keeping backend APIs and local saves is
not itself a customer-access or entitlement migration plan. This draft makes no
refund, automatic store entitlement, or save-transfer promise.

## Old PWA migration

Keep /sw.js deployed at the historical root service-worker URL. The replacement
has no fetch handler and imports no game code. On activation it removes only the
exact Workbox default precache for that registration scope, unregisters itself,
and navigates its controlled tabs to the marketing site (preserving legal/help
pages). It never touches localStorage, IndexedDB, or unrelated caches. The tiny
first-party retire-pwa.js nudges an existing root /sw.js registration to update;
new visitors receive no service worker. The /sw.js response must not be cached
by a proxy; _headers specifies no-store.

A browser that stays offline cannot receive this replacement. Already downloaded
code cannot be retroactively revoked, and an old tab can still run until its
browser receives and activates the update. Verify this migration online with an
old PWA profile before any production rollout. No production deployment is part
of this change.

Every generated HTML document includes a tetrilaunch-build meta tag with the
full Git commit SHA. build.json exposes the same revision and artifact type for
staging smoke checks. Unknown routes return 404, not the game or an SPA fallback.

`node --test marketing/build.test.mjs` exercises the basic artifact boundary.
The repository-level marketing tests cover the detailed distribution and browser
migration behavior. Run the existing app validation gates before pushing.
