# Tagging a release should put the build on Play

`android.yml`'s `bundle` job already builds a signed `.aab` on a tag and stops
at `actions/upload-artifact`. Someone then downloads it and uploads it to the
Play Console by hand — which is how the bundle currently on internal testing got
there, and why an `.aab` sitting on disk can silently fall behind the version it
claims to be. The last step is the only manual one left, and it is automatable.

## What the owner has already set up

- A repository **environment** named `android-build`
- One secret in it: **`PLAY_SERVICE_ACCOUNT_JSON`** — the Google Cloud service
  account key, granted *Release to testing tracks* on this app in the Play
  Console

## The gap this spec has to close first

**`PLAY_SERVICE_ACCOUNT_JSON` is the only secret that exists in this
repository.** Verified with `gh secret list` (repo scope: empty), `gh secret
list --env` for all three environments, and `gh secret list --org venetanji`
(404 — `venetanji` is a user account, so there are no organization secrets to
inherit).

Every other secret `bundle` reads is unset:

| Secret | Read at | Behaviour when unset |
| --- | --- | --- |
| `VITE_REVENUECAT_ANDROID_KEY` | "Require store keys" | **hard fail**, by design |
| `VITE_REVENUECAT_IOS_KEY` | "Typecheck + build web bundle" | silent — inlined as empty |
| `ANDROID_KEYSTORE_BASE64` | "Write the keystore" | **hard fail**, by design |
| `ANDROID_KEYSTORE_PASSWORD` | "Build signed bundle" | Gradle signing fails |
| `ANDROID_KEY_ALIAS` | "Build signed bundle" | Gradle signing fails |
| `ANDROID_KEY_PASSWORD` | "Build signed bundle" | optional — falls back to the store password for a PKCS12 keystore |

So `bundle` cannot have produced a signed bundle from CI yet: it exits at
"Require store keys" before it reaches anything else. Adding a publish step to a
job that has never run green would produce a workflow that fails one step later
than it does today.

**This is the first thing to fix, and it is the owner's to do, not the
implementer's** — the values are credentials. The RevenueCat keys live in
`app/.env` in the main checkout; the keystore is the upload key the current Play
listing was signed with, and Play will reject a bundle signed with any other.

## Non-goals

Production releases stay manual. This spec automates the **internal** track
only: that track publishes in minutes without review, and it is the one whose
audience is the owner's own devices. Promotion to open testing or production
stays a deliberate click in the Play Console, because it is the irreversible
half and nothing here is worth making it one keystroke.

Nothing about the signing, versioning or bundle contents changes.

---

## 1. Point the job at the environment

`bundle` currently declares no `environment:`, so it cannot see anything in
`android-build`. Add it:

```yaml
  bundle:
    if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    environment: android-build
```

Put the **other five secrets in `android-build` too**, rather than at repo
scope. They are the same class of credential doing the same job on the same
workflow, and an environment can carry protection rules — required reviewers,
or a branch/tag restriction — that repo secrets cannot. One job, one place,
one set of rules.

## 2. Publish to the internal track

After the existing `actions/upload-artifact` step. Keep the artifact upload: a
publish that fails should still leave the bundle downloadable.

```yaml
      # Tags only. A workflow_dispatch build is a rehearsal — it burns a
      # versionCode and produces a bundle to inspect, and pushing those to a
      # track the owner's phone auto-updates from would make every rehearsal a
      # release.
      - name: Publish to the internal track
        if: startsWith(github.ref, 'refs/tags/v')
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.tetrilaunch.app
          releaseFiles: app/android/app/build/outputs/bundle/release/app-release.aab
          track: internal
          status: completed
```

`serviceAccountJsonPlainText` takes the raw JSON, which is what the secret
holds. (`serviceAccountJson` is the other input and wants a *path* — passing the
JSON itself to it fails with an unhelpful error.)

Precede it with the same fail-loudly guard the rest of the file uses, so a
missing secret reports itself instead of surfacing as an auth error from inside
the action:

```yaml
      - name: Require the Play service account
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          PLAY_JSON: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
        run: |
          if [ -z "$PLAY_JSON" ]; then
            echo "::error::PLAY_SERVICE_ACCOUNT_JSON is not set — the bundle is built but cannot be published."
            exit 1
          fi
```

Note `working-directory: app` is set at the job level, so `releaseFiles` — read
by the action, not by a `run:` step — needs the repo-root-relative path shown
above, not `android/app/...`.

## What was checked

- **versionCode is safe.** `ANDROID_VERSION_CODE` is `github.run_number`, which
  is at **490** for `android.yml`, against **4** live on internal testing. Play
  requires strictly increasing, not contiguous, so the jump is fine and no
  collision is possible.
- **The first-release rule does not apply.** Play cannot create an app's *first*
  release over the API, but `com.tetrilaunch.app` is already published to
  internal testing, so the API has an existing listing to add to.
- **Package name** is `com.tetrilaunch.app`, confirmed against the installed
  debug build on the test device.

## Traps

- The service account needs its Play Console grant at **app level**, not
  account level. It is a long-lived credential in a CI system; scope it so a
  leak costs one app's testing track rather than the whole developer account.
- A `workflow_dispatch` run has no tag, so `ANDROID_VERSION_NAME` is unset and
  the version name falls back to whatever `build.gradle` holds — another reason
  the publish step is tag-gated.
- Secrets are never exposed to `pull_request` runs from forks, so this cannot
  leak through a PR. It also means the publish path can only be exercised by
  tagging.
- PRs target **`staging`** (`gh pr create --base staging`); `gh` defaults to
  `main`, which is wrong for this repo.

## Verification

Cannot be dry-run: the only honest test is a real tag, and every attempt burns a
versionCode. So verify in this order, stopping at the first failure.

1. Set the five missing secrets in `android-build`.
2. Run `android.yml` via **workflow_dispatch** first. This exercises everything
   except the publish (which is tag-gated) and proves the signed bundle builds
   at all — the step that has never run green.
3. Only then tag `vX.Y.Z`. Expect the bundle job to build, publish, and the
   release to appear on the internal track within a few minutes.
4. Confirm in the Play Console that the versionCode is ~491 and the track is
   internal, **not** production.
