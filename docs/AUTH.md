# Player accounts — Supabase OAuth

Player accounts make a RevenueCat Full Game purchase recoverable across web,
iOS and Android. Guest play remains available; the PWA requires an account only
when the player starts a purchase.

## Supabase project

The authentication project is `edgsqtivfkivqbzzlvth`, with API URL
`https://edgsqtivfkivqbzzlvth.supabase.co`.

1. In project `edgsqtivfkivqbzzlvth`, enable Google and Apple under
   Authentication → Providers.
2. Add the production site, local development URL and native callback
   `com.tetrilaunch.app://auth/callback` to Authentication → URL Configuration.
3. Configure Google's web, iOS and Android OAuth clients in one Google project.
4. Configure Apple's Services ID and native Sign in with Apple capability. The
   web OAuth client secret must be rotated on Apple's schedule.
5. Put the public values in `app/.env` and in each build environment:

   ```text
   VITE_SUPABASE_URL=https://edgsqtivfkivqbzzlvth.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   ```

The publishable key is safe in clients. Never put the service-role key in Vite
variables or the app bundle.

## Account deletion

The Cloudflare Worker implements `DELETE /api/account`. It validates the
caller's Supabase access token, derives the UUID from Supabase, then calls the
admin deletion endpoint. Configure these Worker secrets/variables:

```sh
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_URL
```

Configure both production and staging separately. The service-role key belongs
only in the Worker environment.

## RevenueCat identity

After OAuth, the Supabase user UUID becomes RevenueCat's App User ID. RevenueCat
aliases an existing anonymous customer on first sign-in; later sessions change
to the same UUID. Signing out switches purchases back to a new anonymous ID so
one player's entitlement never remains active for the next guest.

Test these paths before release:

- guest → Google → purchase → relaunch;
- guest → Apple → purchase → relaunch;
- purchase anonymously on native → sign in → same entitlement;
- sign in as the same account on another platform;
- sign out does not leave Full Game active for the guest;
- delete account invalidates sign-in and removes the Supabase user;
- Apple and Google provider revocation followed by a fresh sign-in.
