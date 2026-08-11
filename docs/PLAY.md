# Google Play — listing, Data safety, and store assets

Everything the Play Console asks for that isn't the build itself. The build side
(signing, `.aab`, versionCode) is in [docs/NATIVE.md](NATIVE.md#release-signing).

| | |
|---|---|
| Package name | `com.tetrilaunch.app` (`applicationId`, from `capacitor.config.ts`) |
| Category | Games → Puzzle |
| Orientation | Landscape only |
| Min / target SDK | 24 / 36 |
| Permissions | `INTERNET`, and nothing else |
| Contact | gio@shicheng.com.hk |

---

## Store assets

```bash
cd app && npm run store:graphics    # -> store/play/
```

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 PNG, no alpha | `store/play/icon-512.png` |
| Feature graphic | **exactly** 1024×500, no alpha | `store/play/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, 16:9-ish, 320–3840px per side | capture from a device, below |
| Tablet screenshots | optional, but needed to be listed as tablet-optimised | same method |

Both generated assets come from committed SVG in `app/resources/`, and
`store-graphics.mjs` asserts the exact dimensions and the absence of an alpha
channel rather than trusting the rasterizer — Play rejects both silently late in
the submission flow.

The feature graphic is **deliberately text-free**. The wordmark needs Orbitron
and the rasterizer has no access to it (the same constraint that stripped
"TETRI" out of `icon.svg`); a substituted system font would look worse than no
text, and Play draws the app name beside this graphic anyway.

### Capturing screenshots

Play wants real frames of the running game, so they come off a device rather
than a browser:

```bash
adb exec-out screencap -p > shot.png
```

On a 1080p phone in landscape that yields 2376×1080, which is inside Play's
limits and needs no resizing. Two gotchas, both of which produce a **completely
black PNG** rather than an error:

- The screen must be **on and unlocked**. A locked device screencaps as black.
- Check the device's **screen timeout** first. At the 15-second default you lose
  the screen between navigating and capturing, every time.

Worth including: the menu (it states the pitch in the game's own words), a mid-
flight shot with the aim arc live, a line clearing, the Workshop, and Contracts.

---

## Data safety

Play's Data safety form is a **declaration you are held to** — a mismatch
between it and observed network behaviour is an enforcement matter, not a
correction. So these answers are derived from the code, with the source noted.

What actually leaves the device, exhaustively:

| | Where it goes | Code |
|---|---|---|
| Display name, score, level, lines, timestamp | our Worker → D1 | `worker/index.ts`, `lib/api.ts` |
| Purchase / entitlement traffic | Google Play + RevenueCat | `lib/purchases.ts` |

And what does not: settings, chosen name, best score and all meta-progression
live in `localStorage` (`lib/store.ts`) and are never transmitted. The playtest
recorder (`lib/telemetry.ts`) is off by default, must be switched on from a
developer console, and **contains no network call at all** — it writes to
`localStorage` and is exported by hand.

There is no analytics SDK, no advertising SDK, no attribution SDK, and since the
fonts were self-hosted there is no third-party request during play either.

### Suggested answers

**Does your app collect or share any of the required user data types?** — Yes.

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Personal info → **Name** | Yes | No | App functionality | **Yes** |
| App activity → **Other actions** | Yes | No | App functionality | **Yes** |
| Financial info → **Purchase history** | Yes | No | App functionality | No |

- **Name** covers the leaderboard display name. Play defines Name as including a
  *nickname*, so a player-chosen handle belongs here even though the app never
  asks for a real one. It is sanitised to `[A-Z0-9 _-]` and 12 characters by
  `sanitizeName()`, and the privacy policy explicitly tells players not to use
  their real name.
- **Other actions** covers score, level and lines — gameplay stats, submitted
  with the name.
- Both are **optional**: they are transmitted only when the player chooses to
  submit a score. Play has a specific control for this ("Users can choose
  whether this data is collected") and it applies.
- **Shared: No.** Displaying a name on the in-app leaderboard is publication by
  the app, not a transfer to a third party, which is what Play means by shared.
- **Purchase history** is RevenueCat's. Data collected by Google Play billing
  itself is out of scope for the form, but RevenueCat is a third party that
  receives purchase state, so declare it. Cross-checked against RevenueCat's
  Data safety page (2026-08-11): declare it **required** (can't be turned off),
  not ephemeral, with purposes **App functionality + Analytics** — the
  Analytics purpose is theirs (dashboard charts), and omitting it would
  under-declare.
- Nothing goes under **Device or other IDs**. Confirmed by the same RevenueCat
  page: that category applies only when integrations forward advertising
  identifiers (`gpsAdId`, `androidId`), and the app has no integrations. The
  anonymous app-user ID is not an advertising identifier.

### Security section

- **Encrypted in transit** — Yes. `targetSdk 36` disables cleartext by default,
  the manifest sets no `usesCleartextTraffic` override and ships no
  `network_security_config.xml`, and `capacitor.config.ts` sets
  `androidScheme: "https"` with `allowMixedContent: false`.
- **Users can request deletion** — Yes. Both `/privacy.html` and `/support.html`
  commit to removing a leaderboard entry on request to the contact address.
  Honour it; the form is a commitment.
- **Committed to Play Families policy** — not applicable unless you target
  children; the app is not directed at them.

---

## Listing copy

**App name** (30 max): `Tetrilaunch`

**Short description** (80 max):

```
Fire tetrominoes from a cannon, stack the bay, and beat the compactor.
```

**Full description** (4000 max):

```
Tetrominoes, but you have to aim.

Tetrilaunch is a neon-arcade physics puzzle. You don't drop pieces — you load
them into a cannon and arc them across the bay. Where they land is up to you,
gravity, and whatever is already stacked down there.

Fill a row and the compactor takes it. Miss, and it sweeps anyway.

DEEP RUN
Ten bays, one run. Every stop drafts a new modifier onto your rig, and every
modifier changes how the next bay plays. Push your luck or bank what you have.

CONTRACTS
Short, sharp challenges with fixed objectives. Retry as often as you like —
these are for learning a technique, not for grinding.

WORKSHOP
Salvage from every run buys permanent unlocks. Rig strength is capped per Mark,
and only beating a Mark raises the ceiling, so the leaderboard stays honest.

WHAT MAKES IT DIFFERENT
• Real physics — pieces tumble, settle, and knock each other loose
• Aim is a skill, not a menu; the arc is yours to read
• Modifiers that genuinely change the run, not just the numbers
• Built for landscape, on phone and tablet
• Plays offline. No account, no sign-up, no ads

The whole game is on the device. Submit a score to the online leaderboard if you
want to, with whatever name you like — that is the only thing that ever leaves
your phone, and only when you choose to send it.
```

Both descriptions are length-checked by `npm run store:copy` against Play's
limits, because the Console truncates rather than warns.

### Content rating

The questionnaire is per-territory and generated by the IARC, so the answers
aren't stable enough to record verbatim. The substance:

- No violence, sexuality, profanity, gambling, or user-to-user communication.
- **Digital purchases: yes** — there is an in-app purchase.
- **Shares user location: no. Shares personal info: no.** The leaderboard name
  is user-entered and not tied to an identity; the questionnaire is asking about
  transmitting personal data to third parties, which the app does not do.

Expect an "Everyone" / PEGI 3 style outcome, plus the "In-app purchases" badge
that Play attaches automatically once a product exists.
