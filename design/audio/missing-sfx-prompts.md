# Missing sound effects — Suno prompt sheet

**Read this in one sitting, generate in one sitting.** Every prompt below is
three takes of one cue. Drop the winner into `audio/fx/` (or `audio/stingers/`)
under the **code name in the heading** — that name is the filename, the `FxName`,
and the `playFx()` argument, all the way through, so renaming on the way in is
the step where you decide what a take *is*.

- Masters folder: `audio/` at the repo root. **Gitignored, and main-checkout
  only** — a worktree cannot run `audio:prepare` until the masters are copied in.
- After dropping files in: `cd app && npm run audio:prepare` (needs `ffmpeg`
  **and** `ffprobe`), then commit `app/public/audio/`.
- `audio:prepare` **deletes `app/public/audio/` before rebuilding**, and **fails
  on any mapped-but-missing master.** So map a name in the same pass you add its
  file, or the run unships the whole soundtrack.

---

## How to prompt Suno for a one-shot

Suno makes songs, not sound effects, and every master in this repo arrived with
that friction baked in. Four rules that come from the files we already shipped:

1. **Ask for "instrumental", no vocals.** A stray vocal in the front 200ms is
   the whole asset.
2. **Suno has a ~2s minimum.** A 150ms tick comes back as 150ms of sound plus
   1.85s of silence — *or*, more often, as four or five hits in a rhythmic
   pattern. The pipeline trims to the **first transient**, so only the first hit
   ships. This is exactly how `uiClick.mp3` arrived (see its `OVERRIDES` entry).
   Judge takes by their **front 200ms**, not by the loop.
3. **The character has to be in the attack.** Everything one-shot is folded to
   **mono**, peak-normalised to −3 dBFS and cut short. A cue that lives in its
   reverb tail ships as a click.
4. **Aim the body at 1.5–4 kHz and keep it off the sub.** Nothing ducks the
   music (`FX_BUS_GAIN` 0.45 under `MUSIC_GAIN` 0.55) — these cues cut through by
   *spectrum*, not level. A phone speaker moves no air under a few hundred hertz,
   so sub content is dead weight that still eats headroom.

**House style, for every prompt below:** neon-arcade industrial synth. Synthetic,
cold, dry. Nothing orchestral, nothing organic, no voice, no cinematic whoosh.
**Keep them atonal or on a bare perfect fifth** — the twelve beds are in twelve
unrecorded keys (the only metrical fact written down anywhere is that bay 5's bed
is in 5/4), so anything more specific goes wrong on nine bays out of ten.

**Generate three takes of each, and audition them against a bay bed, not in
silence.** All of these play over music.

---

## What we already have (so nothing here is a duplicate)

| bucket | names |
|---|---|
| **fx one-shots (21)** | `shoot` `impact` `lineClear` `pieceLost` `settleStart` `cryoShatter` `bondBreak` `bondBreak2` `reloadReady` `explosion` `uiClick` `bombArm` `uiConfirm` `thawLance` `timeLow` `lastLaunch` `broke` `compactorStroke` `crate` `transactionConfirm` `holdCharge` |
| **fx loops (3)** | `congestionLoop` `congestionLoop2` `congestionLoop3` |
| **stingers (7)** | `bayClear` `gameOver` `gameOver2` `refit` `contractClear` `timeFinal` `brokeSettle` |
| **beds (13)** | `menu`, `bay-1`…`bay-10`, `contract-rare` |

**Present but NOT mapped**, so reported by the pipeline and not shipped:
`windLoop` (needs a continuous driver off `|windNow|/windMax`; unmapped rather
than shipped dead), `explosion2` (a second take nothing claims), and
`chilled beginning` (bay-1's superseded master).

**Still missing from the plan doc:** `timeUp` and `fundsLow`. `timeFinal` became
the time-up cue when it moved to STINGERS, so `timeUp` may now be redundant —
decide before generating it.

One file often does several jobs already, and that is the doctrine, not a
shortcut: `lineClear` is one file at four rates, `explosion` is one file read
three ways (bomb / volatile / chute), `uiClick` and `uiConfirm` are two cuts of
one master. **Do not generate a new asset for something `rate` and `gain` can
say.** Every entry below is a moment that is currently *silent* or *wrong*.

---

# TIER 0 — the skill moment, and the two that are wrong today

## `excellentClear` — one-shot, 0.15–0.35s

**Why:** EXCELLENT is the game's clearest statement that a shot was *deliberate*,
and it is silent. Three gates have to line up at once (`grades.ts`): the row
closed within **100ms** of the landing that closed it, the player's own shipment
was **in** the row — a row the press ground shut on its own does not count — and
the bay was **not congested**, because congestion caps the grade at *swept*. It
pays **1.5x**, the highest multiplier in the game, and it draws a toast.

`playLineClear` cannot cover it: that is one file at four rates keyed to LINE
COUNT, and grade is an orthogonal axis. A four-line sweep closed by grinding and
a single row closed on the shot sound identical today.

**It LAYERS on top of `lineClear`, it does not replace it** — the clear still
happened and its own cue still has to say how many rows. So this is a second
voice in the same frame, and that is the whole design constraint: `lineClear` is
a sweep that pitches up to rate 1.27 at four rows, so this has to stay clearly
ABOVE it and clearly SHORTER, or the two smear into one muddy event.

**Prompts:**

1. `instrumental single bright bell chime, one struck note high and clean, silver and precise, instant attack with a short shimmering decay, no reverb wash, neon arcade reward, 250ms`
2. `instrumental one crisp high synth ping, glassy FM bell struck once, narrow and bright around 4 kHz, confident and affirmative, dry, no tail, 200ms`
3. `instrumental short ascending two-note sparkle, high register, clean digital bell, resolves upward, tight and unfussy, no reverb, 300ms`

**Listen for:** it fires **several times in a good bay**, so it must be small.
Anything that reads as a fanfare becomes unbearable by the third one — this is a
tick of approval, not a celebration. Reject anything with a reverb tail (it will
collide with the next clear), anything below ~1.5 kHz (that is `lineClear`'s
territory and they will fight), and anything more than about three notes.

**A note on frequency:** because congestion caps the grade, this cue can only
ever fire in a **clean** bay. That makes it self-limiting and is why it can
afford to be bright — it is the sound of a bay under control.

# The two that are wrong today

## `contractClear` — stinger, 20–25s

**Why:** `main.ts:1062` is `case "lost": case "contract-end": playStinger("gameOver")`.
A **cleared** daily Contract — a banked milestone that pays salvage — currently
gets the run's **funeral sting**. The drill screen right below it already does
this correctly (`drill-end` branches on `game.status === "won"`); Contracts never
got the same treatment. This is the highest-value item on the page and it is half
a wiring fix.

**Prompts** (stinger — *not* trimmed, kept **stereo**, loudness-normalised to
−15 LUFS, so this one may breathe):

1. `instrumental neon arcade victory sting, 22 seconds, bright synth arpeggio resolving upward over a warm pad, industrial shipping-yard flavour, confident but not triumphant, no drums after the first bar, no vocals`
2. `instrumental short electronic fanfare, 20 seconds, chiptune-adjacent lead over a sustained synth bed, a contract signed and paid, cool blues and cyans, settles into a held chord, no vocals`
3. `instrumental synthwave completion cue, 24 seconds, clean bell arpeggio and a slow filter opening, satisfying and workmanlike rather than heroic, ends resolved, no vocals, no drums`

**Listen for:** it must be **smaller than `bayClear`**. A Contract is a daily
side-job, not a cleared bay of a Deep Run, and a bigger fanfare here would
mis-rank the two. Also: it plays *under the result card* for its whole length, so
it has to be listenable while someone is reading numbers.

**Also needs (do this even if the audio slips):** the wiring fix in `syncMusic` —
split `contract-end` off from `lost` and branch on the win, the way `drill-end`
already does. Until the master lands, `playStinger` on a missing file degrades to
silence, which is *still* better than a funeral over a win.

---

## `thawLance` — one-shot, 0.15–0.3s

**Why:** `game.ts:1301` fires `onThawLance`, and `main.ts:3136` answers with a
haptic and **nothing else**. Its sibling ability, Bond Breaker, has *two* takes
(`bondBreak` / `bondBreak2`). Every other ability in the game speaks.

The comment at the call site already specifies the design: *"The cue is a TAP,
not the Bond Breaker's thump: one cube changed state, and a field-wide impact for
it would tell the player something bigger happened than did."*

**Prompts:**

1. `instrumental single short cryo-thaw tick, one hit, thin glassy crackle with an instant attack and an 80ms decay, ice releasing, no reverb, no tail, cold synthetic, 200ms`
2. `instrumental one dry electric zap, narrow band around 3 kHz, a small energy discharge striking a single point, sharp transient then gone, arcade UI, 180ms`
3. `instrumental single high frost chime struck once and damped immediately, brittle and metallic, no low end, no room, 150ms`

**Listen for:** it has to sit *below* `cryoShatter` (a whole frozen row breaking)
and *below* `bondBreak`. One cube. If a take sounds impressive, it is wrong.

---

# TIER 1 — specified, never generated (six)

These six already have a full wiring plan in
[`timeout-broke-sfx-plan.md`](./timeout-broke-sfx-plan.md) — call sites,
thresholds, `OVERRIDES` hazards, verification recipe. **Nothing there is
implemented and none of the masters exist.** The prompts are reproduced here so
this page is the whole shopping list; the plan is the whole wiring list.

The gap they close: the two pressure states a Deep Run bay can lose to — the
clock and the bankroll — are said in **colour only**. `#hud-time-chip` goes red
under 20s, the launches chip goes red at 3, both pulsing on one 1s CSS cycle, and
a player whose eyes are on the pile hears none of it.

> Contracts and drills are out of scope by construction — a Contract has no
> clock and no funds economy.

### `timeLow` — the tick · one-shot, 0.10–0.20s

Fires on the beat: once a second under 20s, twice a second under 10s, pitched up
as the clock falls. **The acceleration is `rate`, not a second asset.**

1. `instrumental short dry synthetic clock tick, single hit, sine blip around 2 kHz with a tight click transient, no reverb, no tail, retro arcade countdown, 150ms`
2. `instrumental one high resonant blip, digital countdown pip, narrow band around 2.5 kHz, instant attack and 80ms decay, dry, cold neon arcade UI, 150ms`
3. `instrumental single metallic tick, thin FM bell struck once, no low end, no room, sharp and clean, machine timer, 120ms`

**Listen for:** a *single* hit, and a hard transient — pitched up 19% at full
urgency, a soft tick turns to mush. **Trim hazard:** if the printed window is
longer than ~200ms, pin `"timeLow.mp3": { start: 0, dur: 0.15 }`.

### `timeFinal` — the final-ten riser · one-shot, 1.5–2.5s

Once a bay, under the ticks still keeping the count.

1. `instrumental rising synth riser, dark to bright, filtered saw sweeping up over two seconds, neon arcade tension, ends unresolved, no impact at the end, no drums`
2. `instrumental slow upward pitch sweep on a detuned pad, cold and electronic, two seconds, building dread, no drums, no crash, tails off rather than landing`
3. `instrumental ascending shepard-tone style riser, synthetic, two seconds, tense arcade alarm bed, thin and midrange focused, no bass, no cymbal`

**Listen for:** **no terminal impact.** A riser that lands on a crash collides
with the ticks and with `timeUp`. Check it actually climbs — one that peaks at
60% and coasts reads as nothing. **Trim hazard:** this is `bombArm`'s failure
mode (no front transient). If the window clips the climb, pin `{ full: true }`.

### `timeUp` — the horn · one-shot, 0.4–0.8s

The clock hitting zero opens **overtime**, it does not end the bay.

1. `instrumental hard synthetic buzzer hit, factory shift-end klaxon, two short blasts, square wave, cold and mechanical, dry, no reverb, 600ms`
2. `instrumental descending two-note alarm stab, harsh detuned synth, abrupt cutoff, arcade time-out, 500ms`
3. `instrumental single deep electronic gong strike with a metallic edge, damped immediately, neon industrial, finality without musical resolution, 700ms`

**Listen for:** it must **not sound like a loss.** `gameOver` lands seconds later
and owns that job. This says "the shift ended" over a bay that is still live.

### `fundsLow` — the drain · one-shot, 0.5–1.0s

Crossing down into 3 launches' worth of purchasing power.

1. `instrumental descending three-note synth sting, minor, cold arcade, funds draining, dry with a short digital decay, 700ms`
2. `instrumental downward filter sweep on a thin saw with a soft click at the top, money running out, retro terminal warning, no bass, 800ms`
3. `instrumental short falling arpeggio, four notes, chiptune adjacent but smooth, ends on a held unresolved tone, neon noir, 900ms`

**Listen for:** the *fall* — a direction, not a beep. **Reject any coin-jingle
timbre**: the loss screen already rains `$` glyphs, and a coin sound here reads as
being paid.

### `lastLaunch` — one shot left · one-shot, 0.3–0.6s

1. `instrumental two-tone urgent synth alert, high and dry, second note higher than the first, cold arcade console warning, 400ms`
2. `instrumental sharp digital warning chirp, doubled, narrow band around 3 kHz, no reverb, insistent, 350ms`
3. `instrumental single tense stab on a detuned square lead, short, unresolved, neon arcade low ammo alert, 500ms`

**Listen for:** distinguishable from `timeLow` **in the same second** — both can
be live at once. Different pitch centre, doubled rather than single.

### `broke` — stuck · one-shot, 0.6–1.2s

The grace countdown starting, not the loss.

1. `instrumental power-down sting, synth pitch collapsing downward into a dull thud, cold machinery losing power, dry, 900ms`
2. `instrumental heavy electronic clunk followed by a dying descending tone, a machine stopping, neon industrial, no reverb tail, 1 second`
3. `instrumental low synthetic drone stab with a downward bend and an abrupt gate, ominous, out of funds, arcade, 800ms`

**Listen for:** weight **without sub** — the heaviest cue in the set, but its
weight has to live around 250–500 Hz, because the phone speaker plays nothing
below that.

---

# TIER 2 — silent machinery

The bay is a machine and most of it makes no noise. These are the ones a player
would notice if you pointed at them, which is the definition of a polish pass.

## `compactorStroke` — one-shot, 0.3–0.6s

**Why:** the compactor is the metronome the whole game is played on — telemetry
says a player fires about **once per stroke and waits out the rest** — and it is
**completely silent**. `compactor.ts` has no audio of any kind. One asset covers
both ends of the ping-pong: play it at `rate: 1` on the forward stroke and
`rate: 0.8, gain: 0.6` on the retreat, the way `explosion` covers three blasts.

1. `instrumental single hydraulic press stroke, one short pneumatic hiss into a damped metal thunk, industrial machinery, dry, no reverb, mono, 400ms`
2. `instrumental one heavy servo actuation, motor whirr with a hard stop at the end, factory press bar advancing, cold and mechanical, 500ms`
3. `instrumental short compressed air release followed by a low mechanical clack, machine shop, tight and dry, no tail, 350ms`

**Listen for:** it fires **every few seconds for a whole bay.** Anything with
personality becomes torture by bay 4. Quiet, short, and *under* everything —
budget it at `gain: 0.25` or so and expect to tune down, not up.

## `windLoop` — LOOP, 10–20s uniform

**Why:** `level.ts:247` gives every bay a steady lateral wind that drunk-walks
around its own average, and it bends every shot. The player can only learn it by
watching the trajectory preview. It has no sound.

Wire it like the congestion loops: a looping bed on the fx bus whose **gain
tracks `|windNow| / windMax`**, so a still bay is silent and a gusty one is
audible. **It is a loop, not a one-shot** — it needs an `OVERRIDES` entry pinning
a *uniform interior region*, or the take's own fade-in puts a dip in every cycle.

1. `instrumental steady synthetic wind bed, filtered pink noise with a slow moving resonance, no melody, no rhythm, uniform throughout, twenty seconds, cold industrial gantry`
2. `instrumental continuous airy drone, high-passed noise sweeping gently, atmospheric, featureless, no events, no build, twenty seconds`
3. `instrumental sustained metallic wind texture, thin whistling through a structure, even level from start to end, no crescendo, twenty seconds`

**Listen for:** **uniform level end to end, and no events.** Any swell, dip or
identifiable moment becomes a tic once it loops. Take 2 of `congestionLoop` is the
reference for "uniform to both edges".

## `holdCharge` — LOOP, 2–4s

**Why:** the hold-to-confirm gesture (`startHold`, `BOND_HOLD_MS`) puts a charge
meter under the player's thumb — Bond Breaker, and the pause-button hold that
retries a bay — and the only feedback is one tap at the start and a haptic at the
end. The **filling** is silent, which is the part the gesture is asking them to
trust.

Loop it from press to release, stop it on cancel.

1. `instrumental rising electrical charge loop, capacitor whine climbing steadily, synthetic, seamless, no percussion, three seconds`
2. `instrumental continuous energy build, filtered saw rising in pitch and brightness, machine spooling up, loopable, three seconds, no impact`
3. `instrumental steady synth charge hum with a slow upward glide, cold and electronic, tension without release, four seconds`

**Listen for:** it must **stop cleanly at any point** — the gesture is abandoned
more often than it completes. And it must not resolve, because whatever the hold
does has its own cue.

## `beltLoad` — one-shot, 0.15–0.35s

**Why:** the transport advances a shipment to the muzzle on a ~180ms animation
after every launch, and it is silent. `reloadReady` covers the *cannon* being
ready; nothing covers the *cargo arriving*.

1. `instrumental short conveyor clunk, a crate seating into a cradle, one dull mechanical knock with a metallic edge, dry, no reverb, 250ms`
2. `instrumental single mechanical latch engaging, servo tick into a solid stop, industrial, tight, 200ms`
3. `instrumental one soft pneumatic chuck, cargo indexing forward on a belt, low-mid body, no sub, 300ms`

**Listen for:** it fires after **every shot**, immediately behind `shoot`. Keep
it quiet, short and dull — if it competes with the launch it will read as a
double-fire. Budget `gain: 0.3`.

---

# TIER 3 — meta and economy

Every button in the overlay already speaks (`uiClick` for navigation, `uiConfirm`
for primary actions), so none of these are *silent* — they just say "button"
where something larger happened.

## `purchase` — one-shot, 0.4–0.8s

**Why:** Workshop unlock, install, rack slot, and the refit commit all spend a
currency and all currently answer with the same confirmation blip a Back button
gets. Spending is the loudest decision in the meta and it has no voice.

1. `instrumental short synthetic transaction confirm, two ascending clean tones over a soft mechanical stamp, industrial terminal, dry, 600ms`
2. `instrumental brief electronic purchase chime, warm and affirmative, resolves upward, no coins, no cash register, neon arcade UI, 500ms`
3. `instrumental one authoritative synth stamp, low mechanical thunk with a bright digital confirm on top, workshop, 700ms`

**Listen for:** **not a coin sound.** This economy is scrap and salvage, not
gold. It should read as *authorised* rather than *rewarded*.

## `unlockFanfare` — stinger, 20–25s

**Why:** the tier-unlock ceremony rides the elevator up the tower for up to 4.5s
and gets a **borrowed** bed (`contract-rare`, the Contract special). The single
biggest progression moment in the game has no sound of its own and instead plays
a track the player associates with a daily side-job.

Cheapest honest fix is a dedicated bed; a stinger over the ride works too. Ask
for a bed if you want it to loop under the menu for the ceremony's tail.

1. `instrumental triumphant neon synthwave opening, 25 seconds, wide bright pad swelling under a rising lead, ascent and arrival, industrial optimism, no vocals, no drums until halfway`
2. `instrumental grand electronic reveal cue, 22 seconds, slow filter opening on a huge pad, a structure rising into view, cinematic but synthetic, no vocals`
3. `instrumental ascending arcade fanfare bed, 24 seconds, arpeggiated synth climbing over sustained chords, celebratory and clean, loopable ending, no vocals`

**Listen for:** it plays over a **moving elevator** for 4.5s and then keeps going
under the menu. The first four seconds carry the ceremony; the rest has to be
happy sitting under a home screen.

## `sealBreak` — one-shot, 0.5–1.0s

**Why:** breaking a Mark's seal to retry a bay is the one genuinely costly,
irreversible press in the meta, and it confirms with the same blip as "Play".

1. `instrumental single sharp crack of a heavy seal breaking, brittle snap into a low resonant drop, cold and consequential, dry, 700ms`
2. `instrumental one hard mechanical latch releasing under load, metallic snap with a downward tail, industrial, ominous, 800ms`
3. `instrumental short synthetic fracture, glass-and-metal break pitched low, abrupt, no reverb wash, 600ms`

**Listen for:** it should feel like **something was spent**, not like something
opened. This is the sound of a stamp being voided.

## `penalty` — one-shot, 0.3–0.6s

**Why:** money *in* has had a moment since forever (`lineClear` plus the payout
toast). Money *out* got its toast in the 2026-08-09 playtest pass — the `−$`
floater at three call sites — but shares `pieceLost`'s thud, so the *cargo* is
audible and the *charge* is not.

**Optional, and genuinely arguable.** It stacks on top of `pieceLost` in the same
frame, so it has to be tiny or it doubles up. Skip it if the mix is already busy.

1. `instrumental short descending two-note debit tone, dry synthetic, funds deducted, terminal readout, quiet and matter of fact, 400ms`
2. `instrumental one low negative blip, downward pitch bend, cold accounting cue, no reverb, unobtrusive, 350ms`
3. `instrumental brief muted buzz stepping down a minor third, machine rejecting, thin and midrange, 500ms`

---

# Considered and deliberately NOT added

Answering "are we forgetting anything" means saying what was looked at and left.

- **In-game rail buttons** (rotate, cancel, Autoloader hold) — silent by design.
  They fire during aiming, they get haptics, and `main.ts:6418`'s own comment
  argues the press is confirmed by feel. Adding clicks here would put UI chatter
  over every shot.
- **Congestion tier crossings** — already covered continuously by the three
  congestion loops plus the music lowpass. A one-shot on the crossing would be a
  third statement of one fact.
- **Leaderboard submit** — a network round trip with a visible row appearing.
  `uiConfirm` plus the haptic is proportionate.
- **Paywall / restore success** — native store UI owns that moment; a second
  celebration cue over it would be the app talking across the OS.
- **A second explosion, a fourth lineClear, a smaller bondBreak** — `rate` and
  `gain` already say these. See the doctrine note above.
- **A distinct volatile / chute blast** — same, and the reasoning is written into
  `playExplosion`.

---

# Wiring checklist (per asset)

1. Drop the master in `audio/fx/` or `audio/stingers/`, named **exactly** as the
   heading.
2. `app/scripts/prepare-audio.mjs` — add the name to `FX` (or `STINGERS`). The
   run **fails** on mapped-but-missing, which is the loud TODO by design.
3. `app/src/lib/audio.ts` — add to the `FxName` union **and** to `FX_ONE_SHOTS`
   (or `LOOP_TAKES` for `windLoop` / `holdCharge`; stingers go in `StingerName`).
4. Wire the call site. Anything needing arithmetic gets a helper beside
   `playLineClear` / `playExplosion` rather than maths at the call site.
5. `cd app && npm run audio:prepare` — **read the trim-window column**, and use
   `OVERRIDES` for anything mis-cut. Do not commit a run that prints an X.
6. `npm run typecheck && npm test && npm run test:uifit && npm run build`.
7. Commit `app/public/audio/` — that is the half that ships.

**Do not put any one-shot in `STINGERS`.** `playStinger` calls `playMusic(null)`:
it *stops* the bed. A stinger fired mid-bay kills the bay's music.
