# secrets/

Signing material and API keys that have to exist on disk but must never reach
the repository. Everything here is gitignored except this file
(`secrets/*` + `!secrets/README.md` in the root `.gitignore`).

Nothing in the build reads from this path — it is a holding pen, not a
configured location. Values that a build *does* need go through `app/.env`
(also gitignored; `app/.env.example` is the committed template, and its own
header explains why real keys must never be pasted into it).

## ios/

Apple signing material for team **76LUX2KQMG** (SHI CHENG TRADING LIMITED),
generated 2026-09-01.

| File | What it is | Secret? |
| --- | --- | --- |
| `dist.key` | Private key for the distribution certificate | **yes** |
| `dist.csr` | The signing request that key was used to make (`CN=Tetrilaunch Distribution`) | no, but pointless without the key |
| `distribution.cer` | Apple Distribution certificate, DER, expires **2027-09-01** | no (public half) |
| `distribution.pem` | The same certificate, PEM | no (public half) |
| `dist.p12` | `dist.key` + the certificate, bundled — what Keychain and CI import | **yes** |
| `AuthKey_2LJZZAQXWR.p8` | App Store Connect API key `2LJZZAQXWR` | **yes** |

The `.cer`/`.pem` are public and the `.key`/`.p12`/`.p8` are not, but the folder
is ignored wholesale rather than per-file: a certificate and its key sitting in
one directory reconstruct the `.p12`, so the safe default is that nothing here
is committable.

### What this certificate is and is not

`Apple Distribution` signs **App Store** submissions — iOS, and Mac App Store.
It is *not* a `Developer ID Application` certificate, which is the separate one
required to sign and notarize the **direct-download macOS desktop build**
(`app/desktop/README.md`, "Signing"). A Developer ID cert has to be created
separately from the same team; the CI secret `MACOS_CERTIFICATE` wants *that*
one base64-encoded, not `dist.p12`.

### Feeding CI

The iOS workflow and the desktop macOS workflow read these from GitHub Actions
repository secrets, never from this folder. To encode a `.p12` or `.p8` without
line wraps:

```bash
base64 < secrets/ios/dist.p12 | tr -d '\n'
```

### If any of this leaks

Revoke first, regenerate second — Apple certificates are revocable from the
Developer portal and App Store Connect API keys from Users and Access → Keys.
Unlike the Play upload key (see the `.gitignore` comment), this is recoverable.
