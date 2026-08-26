# TIME RUNNING OUT / MONEY RUNNING OUT — generation and wiring plan

Six new effects, and a session you can run start to finish in one sitting. The
two pressure states a Deep Run bay can lose to — the clock and the bankroll —
are already said in colour and said nowhere else. `#hud-time-chip` turns
danger-red under 20s and `#hud-launches-chip` / `.pl-funds` turn red at three
launches, all of them pulsing on app.css's one shared `pulse-danger` (a 1s
cycle), and
a player whose eyes are on the pile hears none of it. That is the gap. Everything
below is derived from thresholds the game already computes; nothing here invents
a new rule.

**Contracts and drills are out of scope by construction.** A Contract has
`timeLimitSec = 0` (`contracts.ts:1161`) and no funds economy at all, and the
attract loop is untimed (`attract.ts:93`). Both families are Deep-Run-only, which
is also why every wire-up below lands in `startLevel` and in the
`!this.linesBay(g)` branch of `syncHud`.

---

## 1. Inventory — the six cues and the states they name

### TIME

| name | kind | fires at | code site |
|---|---|---|---|
| `timeLow` | one-shot tick, re-fired on the beat | `timeLeftMs < 20_000` — the existing danger threshold, a bare literal at `main.ts:3508` | `main.ts` `syncHud` |
| `timeFinal` | one-shot riser, once a bay | `timeLeftMs < 10_000` — new, and deliberately half the above | `main.ts` `syncHud` |
| `timeUp` | one-shot hit | the step `timeUpStep` is first set — `game.ts:1818`, `timeLeftMs <= 0` | new `GameEvents.onTimeUp` |

The **acceleration is `rate` and a halved beat, not a second asset.** `timeLow`
fires once per second in the 20s band and once per half-second under 10s, pitched
up as the clock falls. That is the repo's own doctrine — one `lineClear` file at
four rates, one `explosion` file read three ways — and a separate "fast ticks"
loop would be two assets saying one thing.

`timeUp` is **not the funeral.** The clock hitting zero opens OVERTIME
(`game.ts:1809-1822`): launches already paid for still land, their lines are still
pressed and paid, and a payout in overtime can still win the bay. The funeral is
the `gameOver` stinger `syncMusic` plays on the `lost` screen (`main.ts:747`).
`timeUp` is the horn that starts overtime.

### MONEY

| name | kind | fires at | code site |
|---|---|---|---|
| `fundsLow` | one-shot sting | crossing down into `launches <= LOW_LAUNCH_WARN` (3) — `screens.ts:1238`, read at `main.ts:3437` | `main.ts` `syncHud` |
| `lastLaunch` | one-shot warning | crossing down into `launches === 1` | `main.ts` `syncHud` |
| `broke` | one-shot hit | the step `brokeSinceStep` is first set — `game.ts:1743`: `score < launchCostNow` **and** every cube at rest | new `GameEvents.onBroke` |

`launches` is `Math.floor(g.score / Math.max(1, g.launchCostNow))` (`main.ts:3420`)
— an *estimate of purchasing power*, not an ammo counter. It falls when congestion
raises the price (`level.ts`'s `PILE_TIERS`) and **climbs again when a line pays
out**, which is exactly why both money cues fire on the crossing and re-arm on the
way back up.

`broke` is the grace countdown STARTING, not the loss. The loss is
`brokeGraceSteps` later (`game.ts:1762-1767`) — one full compactor round trip, so a
line already sitting in the zone gets its pressing stroke and can rescue the run.
The cue's job is to tell the player that clock exists.

---

## 2. Generation prompts

**House style.** Neon-arcade ambient synth, brief, synthetic — nothing
orchestral, nothing organic, no voice, no whoosh-of-air realism. Every cue must
survive being folded to **mono** and cut to its **first transient** by the
pipeline, so the character has to be in the front 200ms, not in a tail.

**On key and tempo.** The repo records no key or BPM for any of the twelve
masters — `audio/README.md` maps song titles to roles and the only metrical fact
written down anywhere is that bay 5's bed is in 5/4. So: **keep these atonal, or
on a bare perfect fifth**, which is consonant against almost any bed. Anything
more specific would be a guess that goes wrong on nine bays out of ten. Tempo is
likewise set in code, not in the file — the tick's beat comes from `syncHud`, and
matching `pulse-danger`'s 1s cycle is what makes the sound and the flashing
number the same event.

**Spectrum is the real constraint** — see §4. Nothing ducks the music for these,
so they cut through by *sitting above* it. Aim the body of every cue at
**1.5–4 kHz** and keep it off the sub.

### `timeLow` — the tick

- **0.10–0.20s one-shot.** Fired up to twice a second, so anything with a tail
  will smear into itself.
- Prompts:
  1. "Short dry synthetic clock tick, single hit, sine-blip at around 2 kHz with
     a tight click transient, no reverb, no tail, retro arcade countdown, 150ms"
  2. "One high resonant blip, digital countdown pip, narrow band around 2.5 kHz,
     instant attack and 80ms decay, dry, cold neon arcade UI, 150ms"
  3. "Single metallic tick, thin FM bell struck once, no low end, no room, sharp
     and clean, machine timer, 120ms"
- **Listen for:** a *single* hit. The generator's 2s minimum loves to return four
  or five ticks in a pattern (this is exactly how `uiClick.mp3` arrived — see its
  `OVERRIDES` entry) and only the first will ship. Reject anything with reverb
  tail, anything with body under 300 Hz, and anything whose transient is soft —
  pitched up 19% at full urgency, a soft tick turns to mush.

### `timeFinal` — the final-ten riser

- **1.5–2.5s one-shot**, played once a bay under the ticks that are still keeping
  the count.
- Prompts:
  1. "Rising synth riser, dark to bright, no percussion, filtered saw sweeping up
     over two seconds, neon arcade tension, ends unresolved, no impact at the end"
  2. "Slow upward pitch sweep on a detuned pad, cold and electronic, two seconds,
     building dread, no drums, no crash, tails off rather than landing"
  3. "Ascending shepard-tone style riser, synthetic, two seconds, tense arcade
     alarm bed, thin and midrange-focused, no bass, no cymbal"
- **Listen for:** *no terminal impact.* A riser that lands on a crash will collide
  with the ticks and, ten seconds later, with `timeUp`. It must end unresolved.
  Also check the take actually climbs — a riser that peaks at 60% and coasts reads
  as nothing.
- **Trim warning:** this is `bombArm`'s failure mode. A riser has no front
  transient, so the auto window ships nearly all of it — which here is correct.
  Check the printed window; if it clips the climb, pin `{ full: true }`.

### `timeUp` — the horn

- **0.4–0.8s one-shot.** Matches the loss screen's visual: a giant draining clock
  ring whose hand spins fast and **stops at 12** (`screens.ts:3118`).
- Prompts:
  1. "Hard synthetic buzzer hit, factory shift-end klaxon, two short blasts,
     square wave, cold and mechanical, dry, no reverb, 600ms"
  2. "Descending two-note alarm stab, low-high inverted, harsh detuned synth,
     abrupt cutoff, arcade time-out, 500ms"
  3. "Single deep electronic gong strike with a metallic edge, damped
     immediately, neon industrial, finality without a musical resolution, 700ms"
- **Listen for:** it must not sound like a *loss*. The `gameOver` stinger lands
  twenty seconds later and owns that job; this one says "the shift ended", and
  the bay is still live.

### `fundsLow` — the drain

- **0.5–1.0s one-shot sting**, one per approach.
- Prompts:
  1. "Descending three-note synth sting, minor, cold arcade, funds draining,
     dry with a short digital decay, 700ms"
  2. "Downward filter sweep on a thin saw with a soft click at the top, money
     running out, retro terminal warning, no bass, 800ms"
  3. "Short falling arpeggio, four notes, chiptune-adjacent but smooth, ends on a
     held unresolved tone, neon-noir, 900ms"
- **Listen for:** the *fall*. This is the first of the two money cues and it has
  to read as a direction, not a beep. Reject anything cheerful, and anything with
  a coin-jingle timbre — the loss screen already rains `$` glyphs
  (`screens.ts:3134`) and a coin sound here would read as being paid.

### `lastLaunch` — one shot left

- **0.3–0.6s one-shot.** Sharper and higher than `fundsLow`: this is the last
  rung, not the warning above it.
- Prompts:
  1. "Two-tone urgent synth alert, high and dry, second note higher than the
     first, cold arcade console warning, 400ms"
  2. "Sharp digital warning chirp, doubled, narrow-band around 3 kHz, no
     reverb, insistent, 350ms"
  3. "Single tense stab on a detuned square lead, short, unresolved, neon arcade
     low-ammo alert, 500ms"
- **Listen for:** it has to be distinguishable from `timeLow` at a glance —
  different pitch centre and a doubled rather than single hit, because both cues
  can be live in the same second.

### `broke` — stuck

- **0.6–1.2s one-shot.** The grace clock starting.
- Prompts:
  1. "Power-down sting, synth pitch collapsing downward into a dull thud, cold
     machinery losing power, dry, 900ms"
  2. "Heavy electronic clunk followed by a dying descending tone, a machine
     stopping, neon industrial, no reverb tail, 1 second"
  3. "Low synthetic drone stab with a downward bend and an abrupt gate, ominous,
     out of funds, arcade, 800ms"
- **Listen for:** weight without sub. It needs to feel like the heaviest cue in
  the set, but the pipeline folds it to mono and a phone speaker plays nothing
  under a few hundred hertz (see `PHONE_HP_HZ` in `prepare-audio.mjs`) — so the
  weight has to live in a low-mid, around 250–500 Hz, not at 60.

Generate **three takes of each** and audition them *against a bay bed*, not in
silence. Every one of these plays over music.

---

## 3. The session, step by step

### 3.0 Before anything — restore the masters

`audio/` is gitignored and a clean checkout does not have it (`audio/README.md`).
`prepare-audio.mjs` **deletes `app/public/audio/` before rebuilding it** and fails
on any mapped-but-absent master, so running it with only the six new files would
unship the entire soundtrack.

```bash
ls audio/tracks audio/stingers audio/fx   # all twelve tracks, four stingers, sixteen fx
which ffmpeg ffprobe                      # both, or the run cannot measure anything
```

### 3.1 Generate and name

Drop the winning takes into the repo-root `audio/fx/` folder, named for the game
callback exactly as everything else is:

```
audio/fx/timeLow.mp3
audio/fx/timeFinal.mp3
audio/fx/timeUp.mp3
audio/fx/fundsLow.mp3
audio/fx/lastLaunch.mp3
audio/fx/broke.mp3
```

Renaming on the way in is the step where you decide what a take *is*. Anything
unrecognised is reported and not shipped, rather than guessed at.

### 3.2 Map them

`app/scripts/prepare-audio.mjs`, the `FX` array:

```js
  "congestionLoop", "congestionLoop2", "congestionLoop3",
  // The two pressure families — the clock and the bankroll, said out loud.
  // Deep Run only: a Contract has no clock and no economy, so nothing here
  // ever fires on one.
  "timeLow", "timeFinal", "timeUp",
  "fundsLow", "lastLaunch", "broke",
```

### 3.3 Master

```bash
cd app && npm run audio:prepare
```

**Read the window column.** Two of the six are known trim hazards:

- `timeLow` — a multi-tick take merges into one "sound" and ships a flutter, the
  `uiClick` failure. If the window is longer than ~200ms, pin it:
  `"timeLow.mp3": { start: 0, dur: 0.15 }` in `OVERRIDES`.
- `timeFinal` — a riser has no front transient, the `bombArm` failure. If the
  window drops the climb, `"timeFinal.mp3": { full: true }`.

The run measures every finished file back and fails on anything more than
`FX_TOLERANCE_DB` (1.5 dB) off the −3 dBFS peak target. Do not commit a run that
prints `✗`.

Then commit `app/public/audio/fx/*.mp3` — that is the half that ships.

### 3.4 Wire-up checklist

**a) `app/src/lib/audio.ts`** — the `FxName` union and `FX_ONE_SHOTS`:

```ts
  | "congestionLoop3"
  | "timeLow"
  | "timeFinal"
  | "timeUp"
  | "fundsLow"
  | "lastLaunch"
  | "broke";
```

```ts
const FX_ONE_SHOTS: FxName[] = [
  "shoot", "impact", "lineClear", "pieceLost", "settleStart",
  "cryoShatter", "bondBreak", "bondBreak2", "reloadReady",
  "explosion", "uiClick", "bombArm", "uiConfirm",
  "timeLow", "timeFinal", "timeUp",
  "fundsLow", "lastLaunch", "broke",
];
```

…and the one helper that needs arithmetic, beside `playLineClear`:

```ts
/**
 * THE CLOCK, out loud. One file read at a sliding rate.
 *
 * The HUD already says this in colour — #hud-time-chip goes .pl-stat--danger
 * under LOW_TIME_WARN_MS and pulses on app.css's shared `pulse-danger`, a 1s
 * cycle — so this is that pulse offered to the ear, and `rate` is the whole of
 * the acceleration. A second "fast ticks" asset would be two files saying one
 * thing, exactly as a fourth lineClear would be.
 *
 * `urgency` is 0 at the warn threshold and 1 at zero, so the tick climbs about a
 * minor third across the last twenty seconds and comes up with it. It never
 * stacks: syncHud fires it on the beat, at most twice a second.
 */
export function playTimeTick(urgency: number): void {
  const u = Math.max(0, Math.min(1, urgency));
  playFx("timeLow", { rate: 1 + 0.19 * u, gain: 0.5 + 0.3 * u });
}
```

The other five fire through `playFx` at the call site, like `shoot` and
`pieceLost` already do.

**Do NOT add any of these to `STINGERS`.** `playStinger` calls `playMusic(null)` —
it *stops* the bed rather than ducking it, by design (see its note). A stinger
mid-bay would kill the bay's music.

**b) `app/src/ui/screens.ts`** — beside `LOW_LAUNCH_WARN` / `LOW_SUPPLY_WARN`:

```ts
/**
 * The clock's two thresholds, in ms. The first is not new — the TIME readout has
 * turned danger-red at twenty seconds since it was built; it was a bare literal
 * inside main.ts's syncHud. It lives here now because it is the same kind of
 * number as the two above it (the point at which the correct play changes) and
 * because the audio cue keys off exactly the same crossing the colour does.
 *
 * The second is half the first, and it is where the beat halves: twenty seconds
 * of even ticking is a state, and a state does not escalate. Ten is short enough
 * that a doubled beat reads as the end approaching rather than as a new tempo.
 */
export const LOW_TIME_WARN_MS = 20_000;
export const FINAL_TIME_WARN_MS = 10_000;
```

**c) `app/src/game/game.ts`** — two callbacks on `GameEvents`, after
`onBombArmed`:

```ts
  /** Fired the step the clock reaches zero and OVERTIME opens (see the time-up
   *  block in update()) — NOT the loss, which lands a settle window later and
   *  arrives through onStatus. Once a bay: timeUpStep latches. */
  onTimeUp?: () => void;
  /** Fired when the stuck-broke grace countdown STARTS, and again with `false`
   *  when a payout cancels it (see update()). The CROSSING, not the state, for
   *  the same reason onCongestion is one: everything between crossings is the
   *  same bay, and this one can cross back — a line clear pays more than a
   *  launch costs, so a rescue really does re-solvent the player. */
  onBroke?: (stuck: boolean) => void;
```

…and the two crossings in `update()`. The broke countdown (`game.ts:1739-1744`):

```ts
    if (this.score >= this.launchCostNow) {
      if (this.brokeSinceStep !== null) this.events.onBroke?.(false);
      this.brokeSinceStep = null;
    } else if (this.brokeSinceStep === null) {
      const allAtRest = this.cubes.every((c) => isAtRest(c.body));
      if (allAtRest) {
        this.brokeSinceStep = this.stepCount;
        this.events.onBroke?.(true);
      }
    }
```

…and the clock (`game.ts:1818`):

```ts
      if (this.timeUpStep === null) {
        this.timeUpStep = this.stepCount;
        this.events.onTimeUp?.();
      }
```

**d) `app/src/main.ts`** — the import, three fields, the reset, the two event
hooks and the two `syncHud` edges.

Import, beside the rest of the audio surface (`main.ts:122-124`):

```ts
  playExplosion, playUiClick, playUiConfirm, playTimeTick,
```

Fields, beside `reloadWasReady` (`main.ts:394`):

```ts
  /** Which tick of the low-time cue last fired, or -1 while the cue is not
   *  running. syncHud runs every drawn frame; the EDGE is the cue. */
  private timeBeat = -1;
  /** The final-ten riser is once a bay, not once a crossing. */
  private timeFinalPlayed = false;
  /** Launches-left as the bankroll cues last saw it, -1 before a bay's first
   *  frame. Both money cues fire on a fall through their rung and re-arm when a
   *  payout lifts the estimate back over it. */
  private lastLaunchesSeen = -1;
```

Reset them at the top of `startLevel()` (`main.ts:1861`), beside the other
per-bay state:

```ts
    this.timeBeat = -1;
    this.timeFinalPlayed = false;
    this.lastLaunchesSeen = -1;
```

The two events, in `startLevel`'s `GameEvents` literal beside `onCongestion`
(`main.ts:1896`) — and **only there**: a Contract has no clock and no economy, so
`startContract` and `startDrill` pass neither.

```ts
      // The shift ending, not the run ending. Overtime is still live and a
      // payout can still win the bay; the funeral is syncMusic's gameOver
      // stinger on the screen after.
      onTimeUp: () => { void impactHaptic(); playFx("timeUp"); },
      // The grace countdown starting. Silent on the way back out — a rescue is
      // its own reward and does not need a fanfare.
      onBroke: (stuck) => { if (stuck) { void impactHaptic(); playFx("broke"); } },
```

The clock, replacing `syncHud`'s time block (`main.ts:3506-3509`):

```ts
    if (g.timeLeftMs !== Infinity) {
      set("#hud-time", formatMMSS(g.timeLeftMs));
      // TWO predicates, not one — found in review. The COLOUR is a state:
      // the chip has always stayed red at zero and through overtime, because
      // time-expired is the most dangerous the clock ever gets, and a shared
      // "low" predicate that required positive time would snap the danger off
      // at the exact moment it peaks. The SOUND is a count: ticks only make
      // sense while there is a count left to keep, so ticking gates on
      // positive time on top of the colour's own condition.
      const danger = g.timeLeftMs < S.LOW_TIME_WARN_MS;
      const ticking = danger && g.timeLeftMs > 0;
      this.overlay.querySelector("#hud-time-chip")
        ?.classList.toggle("pl-stat--danger", danger);
      // THE TICK — the colour cue offered to the ear, on the BEAT rather than
      // per frame. syncHud runs every drawn frame, so a tick keyed to the
      // state alone would fire sixty times a second for twenty seconds; the
      // beat number changing IS the cue. It halves under FINAL_TIME_WARN_MS,
      // which together with playTimeTick's rate climb is the whole
      // acceleration.
      const beat = ticking
        ? Math.ceil(g.timeLeftMs / (g.timeLeftMs < S.FINAL_TIME_WARN_MS ? 500 : 1000))
        : -1;
      if (beat !== this.timeBeat) {
        if (ticking) playTimeTick(1 - g.timeLeftMs / S.LOW_TIME_WARN_MS);
        this.timeBeat = beat;
      }
      // The riser, once a bay: it says the count is nearly over, underneath the
      // ticks that are still keeping it.
      if (ticking && g.timeLeftMs < S.FINAL_TIME_WARN_MS && !this.timeFinalPlayed) {
        this.timeFinalPlayed = true;
        playFx("timeFinal", { gain: 0.8 });
      }
    }
```

The bankroll, inside the Deep-Run-only branch right after `launches` is computed
(`main.ts:3420`):

```ts
      // THE BANKROLL, out loud — on the CROSSING, and each rung once per
      // approach. `launches` is an estimate of purchasing power, not an ammo
      // count (see LOW_LAUNCH_WARN): it falls when congestion raises the price
      // and climbs again when a line pays out, so a rescue re-arms both cues.
      // The sharper rung wins a multi-step fall — going 5 -> 1 in one payout is
      // "last launch", not "funds low, also last launch".
      if (launches !== this.lastLaunchesSeen) {
        const was = this.lastLaunchesSeen;
        this.lastLaunchesSeen = launches;
        // Gated on the clock still SELLING launches, not merely on status —
        // found in review. Overtime keeps status "playing" while shoot()
        // rejects every launch (timeLeftMs <= 0), and payouts, lost-cube
        // penalties and congestion pricing all still move `launches` across
        // these rungs — a "funds low" fired then would be advertising
        // purchasing power the clock no longer honours, on top of timeUp.
        // The tracker still updates above, so a bay that somehow re-opened
        // would not fire a stale crossing.
        if (was >= 0 && g.status === "playing" && g.timeLeftMs > 0) {
          if (launches === 1 && was > 1) playFx("lastLaunch");
          else if (launches <= S.LOW_LAUNCH_WARN && was > S.LOW_LAUNCH_WARN) {
            playFx("fundsLow", { gain: 0.8 });
          }
        }
      }
```

### 3.5 Verify in game

`npm run dev`, then — the App instance is exposed as `window.__tl` in DEV builds
only (`main.ts:651`), which is the fastest door into every state below.

| cue | how to force it |
|---|---|
| `timeLow` | any Deep Run bay; console `__tl.game.timeLeftMs = 19_000`. Listen for one tick a second, in step with the red pulse. |
| `timeFinal` | `__tl.game.timeLeftMs = 10_500` and let it cross. Once only — cross it again by setting 19s and back down, and confirm it stays silent. |
| `timeUp` | `__tl.game.timeLeftMs = 300`. The horn fires as overtime opens, well before the loss modal. |
| `fundsLow` | `__tl.game.score = __tl.game.launchCostNow * 3` |
| `lastLaunch` | `__tl.game.score = __tl.game.launchCostNow` |
| `broke` | `__tl.game.score = 0` and stop shooting — the countdown needs every cube at rest. Then `__tl.game.score = 500` and confirm no cue on the way back out, and that `fundsLow` re-arms on the next fall. |

Without a console: **Tier S** — nine taps on the headhouse beacon on the menu
(`devmode.ts`'s `DEV_TAPS_REQUIRED`), then launch a bay at Mark 10 (144s clock,
`timeLimitFor`) with the **Shift Cut** axis ratcheted to 3 — the clock floors at
45s (`hazards.ts:343`). Fastest honest route to hearing the whole time family in
one bay.

Also check, once:

- **Both toggles.** Settings → Sound off silences all six (`FX_BUS_GAIN` → 0 in
  `setAudioEnabled`); Music off leaves them audible, which is correct — they are
  game cues, not score.
- **Pause mid-warning.** The bed drops to the lounge track and the ticks stop with
  the frame loop; resuming picks the beat back up without a burst.
- **A Contract.** Play one and confirm total silence from both families.
- **Congestion + low time together.** The static loop is the loudest thing on the
  fx bus (`STATIC_SAMPLE_GAIN` 1.0); the tick has to survive it.

### 3.6 Validate

```bash
cd app && npm run typecheck && npm test && npm run test:uifit && npm run build
```

`npm test` (`sim/systems.ts`) asserts the *music* set against `public/audio/music`
in both directions but has no equivalent for fx — a missing effect is silence by
design, so there is nothing to fail on. If you want the same guard for these, the
place for it is a new `check` beside the "Music beds" section.

---

## 4. Mixing constraints — what the code already does

**Levelling is two jobs and these six are the first one.** All six are
one-shots, so `prepare-audio.mjs` **peak**-normalises them to `PEAK_DBFS`
(−3 dBFS), folds them to mono, applies a ≤30ms fade-out (`fxChain`), and encodes
44.1 kHz / 128 kbps mono. The −15 LUFS target (`LONG_LUFS`, with `LONG_TP_DBFS`
−1.5 and `LONG_LRA` 11) governs **beds and stingers only** — none of these are
either, and putting one in `STINGERS` to get loudness normalisation would stop
the bay's music dead.

**Ceilings the script enforces.** −3 dBFS peak on every fx, verified against the
finished file and failing the run past `FX_TOLERANCE_DB` (1.5 dB). Trim window
capped at `MAX_FX_S` (2.5s), gaps under `GAP_MERGE_S` (50ms) treated as one
sound. `PHONE_SPREAD_DB` and `MASTER_EQ` are long-form checks and do not touch
these — but the reasoning behind them does: a phone speaker moves no air below a
few hundred hertz, so sub content in these cues is dead weight that still eats
headroom.

**There is no ducking.** Nothing in `audio.ts` lowers the music for an effect.
Three facts, all of them load-bearing here:

- Effects run through `fxBus` at `FX_BUS_GAIN` **0.45**, music at `MUSIC_GAIN`
  **0.55** — music is the foreground and effects are placed underneath it, on
  purpose.
- The only thing that ever touches the bed mid-bay is the congestion lowpass
  (`musicFilter`, `MUSIC_OPEN_HZ` 20 kHz → `MUSIC_MUFFLED_HZ` 900 Hz), driven by
  `setCongestion`. **Convenient:** a congested bay — the one most likely to also
  be running out of money and time — has already cleared the 1.5–4 kHz band these
  cues live in.
- `playStinger` *stops* the music rather than ducking it (its note explains why
  both ducking and pausing were tried and were wrong). That is the mechanism these
  six must not use.

So the cues cut through by **spectrum, not level**. Keep them in the presence
range, off the sub, and let the call-site `gain` do the balancing.

**Headroom.** Everything sums into one `DynamicsCompressorNode` master limiter
(threshold −4 dBFS, knee 0, ratio 20, attack 3ms, release 250ms). A bed reaches
~0.46 at the destination and one peak-normalised effect ~0.32, so a bed plus one
cue lands near 0.78. `playFx` applies **no voice cap** — the limiter is the only
thing between a burst and a clipped output — which is why the tick is fired on a
beat rather than per frame, and why the call-site gains above are 0.5–0.8 rather
than 1.0. If the limiter becomes audible during normal play, the mix underneath it
is too hot and the durable fix is in `prepare-audio.mjs`, not here.

**Graceful absence.** Until the masters land, all six names are missing files:
`loadEffects` swallows the 404, `buffers` never gets an entry, and `playFx`
returns at `if (!buf) return`. The game plays exactly as it does today. That is
also why this document ships ahead of the wiring — the code above is correct the
day the audio arrives and inert until then.
