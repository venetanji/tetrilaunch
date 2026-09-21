# Lane 6 — Release plumbing: versioning, CI, store metadata, build config

Reviewed tree: `bde8746` (`origin/staging` @ #232 + `origin/release/1.0.6`).
Method: the app was built twice (native + web), every verify script was run, the emitted bundle and
service worker were parsed, and the live GitHub Actions history was queried to check monotonicity
claims against real run numbers. No files modified, nothing deployed.

---

## P1 — would stop or damage the release

### 1. A macOS packaging failure silently cancels the entire Android release

**VERIFIED by reading the workflow graph end to end.**

- `android.yml:32-44` triggers on `push: branches:[staging]`, `pull_request`, `release:` and
  `workflow_dispatch`. **There is no tag trigger.**
- `desktop.yml:334-341` — the `release` job is `needs: package` (all three matrix legs) with
  **no `always()`**, so any failed leg skips it:
  ```yaml
  release:
    needs: package
    if: github.event_name != 'workflow_dispatch' && startsWith(github.ref, 'refs/tags/v')
  ```
- The only thing that starts Android on a tag is `desktop.yml:416-427`, a
  `gh workflow run android.yml` step **inside that job**, further gated on
  `steps.publish.outputs.created == 'true'`.

**Failure mode:** the macOS leg dies → no GitHub Release, no desktop artifacts, **no Play upload at
all** — while `ios.yml` ships to TestFlight independently off the same tag. Nothing anywhere reports
that Android was skipped; the error at `desktop.yml:424` fires only if the *dispatch call* fails,
never if the matrix did.

**Why this is live rather than theoretical:** desktop.yml has 18 runs, **4 failed** (13, 14, 17), and
run 18 needed `run_attempt: 3`. Those failures are the macOS signing/notarization pain in the git log
(`9287e06`, `def5580`, `11a3795`). **desktop.yml has not run since 2026-09-14 — it has never been
exercised against the 1.0.6 tree.** Confirmed empirically: android.yml has exactly **one**
`workflow_dispatch` in its 847-run history — run 805, actor `github-actions[bot]`, ref `v1.0.5`,
started two minutes after desktop.yml run 16 finished.

**Recovery is narrow and belongs in the runbook:** you must **re-run the failed job on the tag run**
(a re-run preserves `event_name: push`). A fresh `workflow_dispatch` can never rescue it, because
`desktop.yml:340` is `if: github.event_name != 'workflow_dispatch'`.

**Suggested fix:** either give `android.yml` its own `push: tags: ['v*']` trigger, or make the
dispatch step a separate job with `needs: package` + `if: always() && ...` so Android survives a
desktop failure.

### 2. The tag-version guard protects desktop only; the other two platforms disagree by construction

`app/desktop/scripts/check-version.mjs` is sound — **run three ways and verified**: bare →
`version 1.0.6 (app and desktop agree)`; `RELEASE_TAG=v1.0.6` → `matches tag v1.0.6`;
`RELEASE_TAG=v1.0.7` → exits 1 correctly. But it is invoked from **`desktop.yml:141-144` only.**

| Platform | version source | tag cross-check |
|---|---|---|
| Desktop | `app/package.json` | **yes** |
| iOS | `app/package.json` (`ios.yml:181`) | **none** |
| Android | **the tag** (`android.yml:274`, `${github.ref_name}` minus `v`) | **none** |

Tag `v1.0.7` against a 1.0.6 tree: desktop fails loudly (correct), **iOS uploads 1.0.6 to
TestFlight**, **Android publishes versionName 1.0.7 to Play** and burns a versionCode Play never
gives back. This is exactly the v1.0.3 incident recorded at `app/desktop/README.md:266-267` — the fix
was applied to one workflow of three.

Today's tree is internally consistent at 1.0.6, so **this will not bite this tag**. The guard is
still missing. One line in `android.yml`'s `bundle` job and in `ios.yml` closes it.

### 3. The data-safety declaration contradicts what the app actually sends

`auth.ts:101-105` defines `appUserIdFor()` as `` `${user.provider}:${user.sub}` ``, and
`purchases.ts:256` hands exactly that to `Purchases.logIn({ appUserID })`. That is a persistent user
identifier transmitted to RevenueCat on every signed-in launch.

`store/play/data-safety.csv:26` — `PSL_DATA_TYPES_PERSONAL,PSL_USER_ACCOUNT` ("Personal info /
User IDs") is **blank**. Only Name, Purchase history and Other app activity are declared.
An undeclared collected data type is a Play policy violation.

Second, related: `data-safety.csv:8` declares `PSL_ACM_NONE` = true (*"My app does not allow users to
create an account"*) while the app ships Google and Apple OAuth and the worker exposes
`DELETE /api/account` (`worker/index.ts:271-303`), with UI reading "Player Account" / "Sign In"
(`screens.ts:3012-3014`). `PSL_ACM_OAUTH` (line 7) is blank. The team's position is defensible on its
own terms — `auth.ts:3-8` states "There is no server session and no account database anywhere" — but
the app's own vocabulary and endpoint name say "account", and this is the answer a Play reviewer
queries. **If you flip it to OAuth, note `PSL_ACCOUNT_DELETION_URL` (line 11) is empty and becomes
required.**

**Checked and clear — do not re-spend effort:** the leaderboard name is a player-typed handle, not
the auth label (`main.ts:10735` → `(input?.value || loadName() || "ACE").toUpperCase().slice(0,12)`).
No email reaches the public board. `telemetry.ts` is genuinely local-only and opt-in with no network
call. The D1 `scores` table stores only `name, score, level, lines, created_at, mark, day`.

### 4. No iOS privacy manifest anywhere in the repo

`find . -iname '*.xcprivacy'` returns nothing; the App target carries no `PrivacyInfo.xcprivacy` and
the pbxproj references none. Capacitor's WKWebView shell touches required-reason APIs
(`UserDefaults`, CA92.1). **Expect the ITMS-91053 "Missing API declaration" mail after the TestFlight
upload.** `docs/ios.md` never mentions privacy manifests, required-reason APIs or ITMS-91053, so
nobody is watching for it. (The SPM-vendored RevenueCat/capgo SDKs ship their own manifests; the gap
is the app target, which is the part this repo owns.)

---

## P2 — will cause a scramble

### 5. The "paste-ready" release notes are 10x over Play's field cap
`docs/releases/1.0.6.md:24` calls the draft *"Paste-ready for the release body and the store
'what's new' fields."* Measured: **5,028 code points.**

- Play "What's new" limit **500** → over by 4,528.
- App Store "What's New" limit **4,000** → over by 1,028.

`verify-store-copy.mjs`'s own header notes the Console *"truncates over-length copy at paste time
rather than refusing it"* — so the listing silently ships a fragment cut mid-sentence inside the first
subsection. Nothing catches it: `verify-store-copy.mjs:19-25` checks exactly three fields (App name
30, Short description 80, Full description 4000) pulled from `docs/PLAY.md`, which **has no
"What's new" section at all**. There is no App Store copy check of any kind.

### 6. `ios.yml` calls a dispatch a rehearsal; it uploads to TestFlight regardless
`ios.yml:8-12` says *"A dispatch is the rehearsal button."* **VERIFIED:** `ios.yml:203` ("Upload to
TestFlight") has **no `if:` at all**. Confirmed against history: **run 21 was a `workflow_dispatch` on
`main` that completed successfully** — a real TestFlight upload at build 21.

Both siblings gate this properly (`desktop.yml:340`; `android.yml:308,315` behind the `publish`
input). iOS is the odd one out, and it is the irreversible one — a burned build number and a build
visible to testers.

### 7. The Steam upload job can go green having uploaded nothing
`desktop.yml:506-508` seds `Preview "1"` → `"0"` over a copy, then only `echo`/`grep`s the result.
**There is no assertion that the flip happened.** If the sed stops matching (VDF reformatted, quoting
changed), steamcmd performs a dry run, uploads nothing, and the job succeeds.

Also `store/steam/app_build_5270760.vdf:28` annotates `Desc` with `// CI overwrites with the
tag/run`. **CI does not** — the sed touches only `Preview`. Every Steam build would be labelled
"Tetrilaunch depot build" with no version, indistinguishable in App Admin.

The VDFs themselves are internally consistent (app 5270760; depots 5270761/62/63 → win/mac/linux;
each `DepotID` matches its filename; `ContentRoot ../../app/desktop/release/`).

### 8. The Steam artifact round-trip is path-fragile and has never run
`desktop.yml:322-332` uploads `win-unpacked/**`, `linux-unpacked/**`, `mac/**`; `desktop.yml:451-466`
downloads with `merge-multiple: true` and requires those prefixes to have survived.
`upload-artifact` roots the archive at the least-common-ancestor of the search paths — it *should*
resolve to `app/desktop/release` and preserve the prefixes, but that is version-dependent and the job
has **zero runs**. If the prefix is stripped on a single-match leg, all three platforms merge into one
flat directory and the depot ships a mixed tree. Verify with a `steam_upload` dispatch dry run before
trusting it. Not on the tag's critical path — `1.0.6.md:428` lists Steam-for-1.0.6 as open.

---

## P3 — stale claims and hygiene

**Three release-page claims that don't hold** (in the spirit of `774a9c7`):

9. **"about 3.7 MB of marketing"** (`1.0.6.md:141`) — actual saving is **1,666,104 bytes = 1.59 MB**.
   3.57 MB was the size at `e4961ca`; `6735bfc` regenerated the screenshots and more than halved it.
   `vite.config.ts:56`'s "~2 MB of PNG, or about 6% of the bundle" is stale the same way.
10. **`wrangler.jsonc:82-85`** — *"all 46 runs of that workflow died at its token guard… It has not
    happened only because CLOUDFLARE_API_TOKEN was never added."* staging.yml now has **222 runs and
    the last six are all `success`**. The `routes: []` protection at line 95 is genuinely in the tree
    and working, but the comment's premise is false, and someone reasoning about apex safety from
    "this has never actually run" would reason wrongly.
11. **`vite.config.ts:138-140`** — *"~30.3 MB of a ~30.7 MB total."* Measured precache is
    **41.97 MiB across 92 entries**. Stale by ~11 MB.

**Everything else:**

12. iOS pbxproj still carries `MARKETING_VERSION = 1.0` and `CURRENT_PROJECT_VERSION = 1` (lines 304,
    311, 329, 336); only the `xcodebuild` CLI overrides at `ios.yml:198-199` correct them.
    `docs/ios.md:209-211` still instructs a human to bump them in Xcode and archive from Organizer —
    that manual path ships "1.0 (1)", which ASC rejects as a duplicate build number.
13. **No in-app marketing version.** The footer shows only the git short SHA (`VITE_BUILD_ID`,
    `screens.ts:2409`, `main.ts:10425`). A QA tester cannot confirm from inside the app whether they
    are on 1.0.6.
14. **6 duplicate precache entries** — `favicon.svg` and five `icons/*`, because `includeAssets`
    (`vite.config.ts:103`) overlaps `globPatterns`. Revisions are identical so Workbox dedupes and it
    is benign — but two entries for one URL with *differing* revisions throws at SW install, so it is
    a latent trap worth removing.
15. **Console logging ships**: dist/assets carries 56 `console.warn`, 19 `error`, 17 `log`, 4 `debug`,
    2 `info`. Source contributes only 21 `console.warn` (disciplined); the rest is vendored SDK noise.
    No `esbuild.drop` / terser `drop_console` in `vite.config.ts`.
16. `android.yml:313` uses **`r0adkll/upload-google-play@v1`** — an unpinned third-party action at a
    mutable major tag, holding `PLAY_SERVICE_ACCOUNT_JSON`. The repo avoids third-party actions
    everywhere else for exactly this reason (`desktop.yml:360-363`). **Pin to a SHA.**
17. **`store/play/certificates.zip` is NOT a leak** — extracted and parsed: three DER files, all
    public X.509 certificates issued by `O=Google Inc., OU=Android` (the Play App Signing public
    halves). `openssl asn1parse` finds no private key material. **Downgrading the alarm: fine to
    keep.** Two real nits — `.zip` is a blind spot in the extension-based signing-material ignore
    rules (`*.jks`, `*.keystore`, `*.p8`, `*.p12`, `*.mobileprovision` — none match), and the file has
    no README saying what it is.
18. `store/play/iap-full-game-512.png` carries an alpha channel (the other four store graphics don't).
    Fine for a Play IAP icon; flagged only for consistency.
19. **Ordering hazard in the runbook**: step 4 (tag → TestFlight + Play internal) precedes step 5
    (manual `production.yml` dispatch). A 1.0.6 native client can reach testers while tetrilaunch.com
    still runs the 1.0.5 worker. Low risk *this* release (no new worker routes in 1.0.6) but the
    ordering is backwards for any release that adds one.

---

## Verified clean — do not re-spend effort here

**Version coherence (full table, on this tree):**

| Site | Value | Notes |
|---|---|---|
| `app/package.json:3` | **1.0.6** | ok |
| `app/desktop/package.json:4` | **1.0.6** | ok |
| `app/package-lock.json:3,9` | **1.0.6** | both root entries |
| `app/desktop/package-lock.json:3,9` | **1.0.6** | both root entries |
| root `package.json` | none | workspace, unversioned — correct |
| iOS `MARKETING_VERSION` | `1.0` in pbxproj → **1.0.6** via CI | see #12 |
| iOS `CURRENT_PROJECT_VERSION` | `1` in pbxproj → **25** via CI | v1.0.5 was 24 |
| Android `versionName` | **1.0.6** from the tag | `signing.gradle:122-124` |
| Android `versionCode` | **~858+** from `run_number` | latest is 857 |
| electron-builder | reads `desktop/package.json` | NSIS/plist/AppImage |
| PWA manifest / SW | no version field | by design |
| In-app string | git SHA only | see #13 |

**Build-number monotonicity — the classic trap did NOT fire.** `05f47db` renamed the workflows.
Verified against the API that `run_number` **continued** across the rename (runs 20-23 old name, run
24 new name, same `workflow_id` 347165839) — renaming `name:` does not reset the counter. iOS next
build = 25 > 24. Android next versionCode ≈ 858. **Both monotonic.**

**Dev/cheat/sandbox stripping — genuinely compile-time, verified on a real build.** The gate is
`import.meta.env.DEV || import.meta.env.MODE === "sandbox"` (`sandbox.ts:74-75`), both inlined by Vite
and folded by Rollup at a *module boundary*, so the import chain dies with it. On the emitted native
bundle: **0 hits** for `TETRILAUNCH_SANDBOX_BUILD` and **0** for each of `sbx-wipe`,
`sbx-grant-salvage`, `sbx-unlock-all`, `sbx-grant-mark`. Not a runtime flag; not flippable.
Tier S (the *mode*) ships in every build by design and cannot pay salvage, advance a tier or touch the
real board (`devmode.ts:8-19`).

**Build modes and the `about/**` strip — works in both variants.** `NATIVE_MODES =
{native, teststore, sandbox}` (`vite.config.ts:50`) so the `closeBundle` strip covers all three.
After `npm run build:native`: `dist/about` and `dist/about.html` **absent**. Web build keeps them and
`globIgnores` keeps them out of the precache (**0** about-prefixed SW entries). Also confirmed
`sourcemap: false`, **0** `.map` files, and **no service worker** emitted in native mode.

**Workbox size ceiling — nothing is being silently dropped.** Parsed `dist/sw.js`'s manifest and
diffed against every glob-eligible file on disk: **92 entries, 41.97 MiB, DROPPED = 0**. Largest
precached file is `menu-alt.mp3` at **2.96 MiB** against the 4 MiB
`maximumFileSizeToCacheInBytes` — **1.04 MiB of headroom**. The three new alternates are safely under.
*Forward-looking note:* nothing **pins** that ceiling, so a future master over 4 MiB drops silently
with a clean build log — the exact failure `vite.config.ts:165-169` was written to prevent, one tier up.

**Verify scripts, run for real:**
- `verify:store` → `✓ RevenueCat SDK present across 11 chunks`
- `verify:store:desktop` → `✓ no RevenueCat key, isDesktop gate present in 11 chunks`
- `store:copy` → `11/30, 70/80, 1442/4000` — matches `1.0.6.md:483` exactly
- 0 RevenueCat keys of any prefix (`appl_|goog_|rcb_|test_`) in dist

**What `verify-store-bundle.mjs` does NOT check:** it reads only `dist/assets/*.js`, non-recursively.
A key or marker in `index.html`, a CSS file, a nested chunk directory or `sw.js` is invisible to it.
It also cannot prove a *real* platform key was set — compensated by the "Require store keys" guards in
`android.yml:206` and `ios.yml:115`.

**Store graphics all correct**: Play icon 512x512 no alpha; feature graphic exactly 1024x500 no alpha;
App Store icon 1024x1024 **no alpha** (Apple rejects alpha here). `store-graphics.mjs:53-57` asserts
both dimensions and alpha and throws on either.

**Secrets hygiene is right.** `secrets/` contains only the tracked `README.md`. The rule is
`secrets/*` + `!secrets/README.md` (`.gitignore:46-47`) — the correct idiom; a `secrets/` *directory*
rule would have silently broken the negation. `git check-ignore` confirms. No key material committed.

**Worker/DB:** `wrangler.jsonc`'s `env.staging` carries `routes: []` (the documented apex-hijack fix
is in the tree) plus its own D1 `tetrilaunch-leaderboard-preview`. Migrations are `0001`-`0003` only,
none added for 1.0.6. **CORS is `Access-Control-Allow-Origin: *`** (`worker/index.ts:78`) — there is no
allowlist that could reject the 1.0.6 native build's `capacitor://`, `https://localhost` or `app://`
origin. **No release-day CORS risk.** Schema skew is safe by construction: `mark` and `day` are both
additive `DEFAULT 0` and `/api/scores` kept its original domain.

---

## Could not verify (flagged honestly)

- Whether the `ios-build` / `android-build` / `desktop-build` environment secrets are populated — not
  readable from here. **Given #1, confirm the macOS six before tagging, not after.**
- `promo:verify` — needs two full 30-minute shoots.
- Whether migrations 0001-0003 are actually *applied* to the production D1.
- `git diff v1.0.5..HEAD` — the checkout is shallow (235 commits, no tags). Claims of the form
  "unchanged since v1.0.5" rest on file listings and the API tag list, not a diff.

## If you only fix three

1. **Confirm the macOS signing secrets and re-run desktop.yml by dispatch against this tree before
   tagging** — never run on 1.0.6, 4-in-18 failure record, and its failure takes the whole Android
   release with it silently (#1).
2. **Add `check:version` with `RELEASE_TAG` to `android.yml` and `ios.yml`** — two lines, closes the
   split-brain that already cost v1.0.3 (#2).
3. **Add `PSL_USER_ACCOUNT` to `data-safety.csv`** and settle `PSL_ACM_NONE` vs OAuth before the Play
   submission (#3).
