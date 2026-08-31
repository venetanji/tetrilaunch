# Player identity — social login without accounts

There is no account system. "Signing in" hands the app a provider ID token
(Google or Apple, via `@capgo/capacitor-social-login`), and the app keeps
exactly three things in localStorage: the provider, the token's `sub` claim
and a display label. The RevenueCat App User ID is `${provider}:${sub}` —
`google:1234…` / `apple:000123.abc…` — which is what makes a Full Game
purchase recoverable on any device that signs in with the same provider.

Nothing is stored server-side by us. No database row, no session, no token at
rest. The identity exists in two places only: the player's device and the
RevenueCat customer record it names. The client never verifies ID tokens
(there is no secret to protect on-device); the Worker verifies them — issuer,
signature against the provider JWKS, audience, expiry — for the single
privileged action, account deletion.

## The deletion path

`DELETE /api/account` with `Authorization: Bearer <raw ID token>`. The client
re-runs the provider login immediately before the call — ID tokens live about
an hour, so a stored token is stale by construction. The Worker verifies the
token, derives `${provider}:${sub}`, and deletes that customer from RevenueCat
(v2 API, secret key). Responses: 200 `{ok:true}` (a RevenueCat 404 is also ok
— deleting an identity that never bought anything must succeed), 401 for an
invalid/expired token, 503 when the Worker is missing its config.

## Environment matrix

Client (Vite, public identifiers — set in `app/.env` and in every workflow
that builds the app; a provider whose id is missing simply isn't offered):

| Variable | Used by |
| --- | --- |
| `VITE_GOOGLE_WEB_CLIENT_ID` | Google on web **and** Android (Credential Manager validates against the web client) |
| `VITE_GOOGLE_IOS_CLIENT_ID` | Google on native iOS |
| `VITE_APPLE_WEB_CLIENT_ID` | Apple on web (the Services ID). Native iOS Apple sign-in keys to the app's bundle id and needs no variable |

Worker (deploy-time secrets, uploaded by `.github/workflows/{staging,production}.yml`):

| Secret | Purpose |
| --- | --- |
| `GOOGLE_WEB_CLIENT_ID` | Google token `aud` allowlist |
| `GOOGLE_IOS_CLIENT_ID` | Google token `aud` allowlist (iOS-minted tokens carry the iOS client id) |
| `APPLE_WEB_CLIENT_ID` | Apple token `aud` allowlist (web) |
| `REVENUECAT_SECRET_KEY` | RevenueCat v2 API — deletion. The one true secret; never in a client |

Worker vars (`wrangler.jsonc`, public — not secrets):

| Var | Purpose |
| --- | --- |
| `APPLE_NATIVE_CLIENT_ID` | Apple token `aud` allowlist (native iOS = the app bundle id, `com.tetrilaunch.game`) |
| `REVENUECAT_PROJECT_ID` | The RevenueCat project whose customers deletion targets |

## Owner checklist

Google (one Cloud project for all three clients):

1. **Web application** client — authorized JavaScript origins:
   `https://tetrilaunch.com`, the staging Worker URL
   (`https://tetrilaunch-staging.<account>.workers.dev`), and
   `http://localhost:5173` for dev. This id is `VITE_GOOGLE_WEB_CLIENT_ID`
   and the Worker's `GOOGLE_WEB_CLIENT_ID`.
2. **iOS** client for bundle id `com.tetrilaunch.game` →
   `VITE_GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_CLIENT_ID`. Its REVERSED client
   id also goes into `Info.plist` as a URL scheme — see docs/ios.md.
3. **Android** client for package `com.tetrilaunch.app`, registering the
   SHA-1 of **both** the release keystore and the debug keystore (and Play
   App Signing's key once Play distribution starts) — Credential Manager
   refuses an APK whose signing cert isn't listed. No id from this client is
   configured anywhere; the package+SHA-1 registration is its whole job.

Apple:

1. Enable **Sign in with Apple** on the App ID `com.tetrilaunch.game`
   (docs/ios.md — the Xcode capability registers it).
2. Create a **Services ID** for the web popup, enable Sign in with Apple on
   it, and register the site origins (`tetrilaunch.com`, the staging Worker
   host) as its web domains/return URLs. That Services ID is
   `VITE_APPLE_WEB_CLIENT_ID` and the Worker's `APPLE_WEB_CLIENT_ID`.

## Test matrix

- guest → sign in → purchase → relaunch: entitlement active, same
  `${provider}:${sub}` customer.
- same provider on a second device (or a reinstall): sign-in alone restores
  the entitlement.
- sign out: back to an anonymous customer, no entitlement carried to the
  guest.
- delete: RevenueCat customer is gone (dashboard), app returns to guest.
- delete with an aged session: the flow re-runs the provider login for a
  fresh token — verify it does not fail with 401 an hour after sign-in.
