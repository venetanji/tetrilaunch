# Lane 10 — Audio (PR #225, "the three alternates")

Reviewed tree: `bde8746`. Review only; nothing changed.

**Instruments used** (so you know which findings are measured vs. read):
- `npm run build` — green; Workbox printed the real precache figure.
- `npm test` (`tsx sim/systems.ts`) — green, including all nine `MUSIC_TAKES` pins.
- A node harness re-implementing `takeOf` byte-for-byte over 7,000,000 seeds.
- A Playwright/Chromium harness fetching each shipped bed over HTTP, decoding with `decodeAudioData`
  (the same decoder that plays them) and measuring peak, RMS, 500 Hz-highpassed "phone band" RMS,
  head/tail envelopes and digital silence.
- A pure-node MP3 frame/side-info parser for bitrate, channel mode, Xing/LAME gapless fields.

**`npm run audio:prepare` was deliberately NOT run.** `audio/` contains only `README.md` — the masters
are not on this tree, and the script `rm`s `app/public/audio/` before rebuilding, so running it here
would unship the soundtrack and could not rebuild it.

---

## P2 — `takeOf`'s coin is not two coins. Bays 1 and 2 are perfectly anti-correlated.

`app/src/lib/audio.ts:396-409`; claim at `:393-395`, repeated in `docs/releases/1.0.6.md:151, 439-441`.

```ts
return takes[h % takes.length];   // audio.ts:408
```

FNV-1a is `h = (h ^ byte) * 0x01000193`, and `0x01000193` is **odd**, so bit 0 of the output is a pure
XOR (parity) of bit 0 of every input byte with bit 0 of the basis. `% 2` reads exactly that bit.
The input is `` `${salt}:${role}` ``, and `"bay-1"` vs `"bay-2"` differ in one character whose low bit
differs (`'1'`=0x31, `'2'`=0x32). Therefore `takeOf("bay-1", s) !== takeOf("bay-2", s)` for **every** salt.

**INDEPENDENTLY VERIFIED** over 3,000,000 seeds by this reviewer, and over 7,000,000 by the lane agent:

```
bay-1 === bay-2 (same take): 0
pairing distribution [bay1][bay2]: {"10":1500000,"11":0,"00":0,"01":1500000}
marginals -> bay-1 alt 50.00%  bay-2 alt 50.00%  menu alt 50.00%
```

Marginals are perfect, which is exactly why this survives a casual listen.

**Why it bites:** the two bays share one salt. `main.ts:5334` builds every bay's `Game` with
`this.run.seed`; `advanceRun` carries `seed: run.seed` forward unchanged (`run.ts:896`); `main.ts:1699`
passes `this.game?.seed` as the salt. So bay 1 and bay 2 of one run are salted identically.

**What the player hears:** only two of four pairings ever occur. If bay 1 plays the original, bay 2
*always* plays the alternate, and vice versa — for the life of the game, on every device. "Both
originals" and "both alternates" are unreachable. Per-bay variety across runs is intact, so this
surfaces as "the second bay always changes when the first one doesn't".

The irony is one file over: `game.ts:1172` and `:1186` mix the same seed with `level.id` before seeding
the wind and the autopilot, precisely so consecutive bays roll differently. The music pick is the one
consumer of that seed that skipped the mix.

### The fix — the obvious ones do NOT work

The lane agent proposed `takes[(h >>> 27) % takes.length]`. **That is wrong**, and so is reordering the
hash input. Measured over 2,000,000 seeds each (ideal is same=50.00%, each pairing 25.00%):

| candidate | same-take | 00 | 01 | 10 | 11 |
|---|---|---|---|---|---|
| **A.** current `h % 2` | **0.00%** | 0.00 | 50.00 | 50.00 | 0.00 |
| **B.** `(h >>> 27) % 2` *(agent's proposal)* | **75.02%** | 37.50 | 12.49 | 12.49 | 37.52 |
| **C.** `(h >>> 16) % 2` | **98.77%** | 49.41 | 0.61 | 0.61 | 49.37 |
| **D.** top bit `h >= 0x80000000` | **98.45%** | 49.22 | 0.78 | 0.77 | 49.22 |
| **E.** role-first `fnv(role + ":" + salt)` | **0.00%** | 0.00 | 50.00 | 50.00 | 0.00 |
| **F.** double-hash `fnv(fnv(salt) + ":" + role)` | **0.00%** | 0.00 | 50.01 | 49.99 | 0.00 |
| **G.** popcount parity of `h` | 49.70% | 24.82 | 25.12 | 25.18 | 24.87 |
| **H. `fmix32(h) % 2`** | **49.95%** | **24.98** | **25.02** | **25.03** | **24.97** |

Picking a different single bit fails because the two role strings differ by one bit, so most output
bits stay correlated. Reordering fails because the parity argument is order-independent.
**Only a proper avalanche finalizer decorrelates.** Recommended:

```ts
// murmur3 fmix32 — avalanches before the modulo so adjacent role names decorrelate
let h = 0x811c9dc5;
for (const ch of `${salt >>> 0}:${role}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
h ^= h >>> 16;
return takes[(h >>> 0) % takes.length];
```

**Nothing tests it.** `takeOf` appears nowhere in `app/sim/systems.ts` — the nine pins at
`:15337-15382` read `MUSIC_TAKES` as *source text* (the module cannot load in Node) and assert names,
not behaviour. One of them even reasons about fairness ("a coin flip over [x, x] is not a coin flip")
while the actual flip is unexercised. A pin needs `takeOf` in a tiny pure module both sides import,
then: over N seeds, all four bay-1 x bay-2 combinations must appear. Per the house rule, prove it red
against today's code first — it will be.

---

## P2 — Two of three alternates have a markedly worse loop seam than the take they alternate with

Measured in Chromium off the shipped files: head + tail time during which the 20 ms-window RMS sits
more than 12 dB below the track's own median.

| file | fade-in | fade-out | seam hole | duration |
|---|---|---|---|---|
| `menu.mp3` | 0 ms | 520 ms | **520 ms** | 179.8 s |
| `menu-alt.mp3` | 160 ms | 1360 ms | **1520 ms** | 193.6 s |
| `bay-1.mp3` | 0 ms | 1160 ms | **1160 ms** | 126.5 s |
| `bay-1-alt.mp3` | 120 ms | 620 ms | **740 ms** | 154.7 s |
| `bay-2.mp3` | 0 ms | 140 ms | **140 ms** | 153.7 s |
| `bay-2-alt.mp3` | 820 ms | 800 ms | **1620 ms** | 162.4 s |

`bay-2.mp3` is the tightest loop in the set (140 ms); its alternate is **11.6x looser**, and is the only
bed that fades *in* for most of a second. `menu-alt` is 2.9x looser than `menu`. These are
`el.loop = true` elements (`audio.ts:1753`), so the hole is heard, not faded over.

Reachable: a Tier-1 bay's clock is 180 s (`level.ts:527`), so a full-length bay 1 passes bay-1's loop
point at 2:06 and bay-1-alt's at 2:35; bay 2 loops at 2:34 / 2:42. The lounge loops at 3:00 / 3:14 — a
hub + Workshop + Contracts visit clears that easily.

**Not an encode defect:** all six carry the same Lavc62.11 Info tag with `encDelay 576` and padding
720-1600 samples, i.e. identical gapless metadata. The hole is in the master's own head/tail, so the
fix is a trim window or a different generation, not the pipeline.

---

## P1 by rubric, but PRE-EXISTING (not from #225) — three shipped beds loop through real digital silence

Absolute-silence measurement (|sample| < 1e-4 to end of file):

- **`bay-3.mp3` — 1331.8 ms of digital silence** at the tail, on top of a 3.6 s decay: 4920 ms below
  median before the loop restarts. Its last five 20 ms windows read -101 dBFS.
- `bay-8.mp3` — 822.9 ms.
- `bay-4.mp3` — 369.4 ms (total seam hole 2940 ms).
- `bay-5.mp3` — 100.6 ms.

A looping bed with a 1.3-second hole is a broken loop, hence P1 by rubric — but it **predates this
release** (`bay-3.mp3` unchanged since before `v1.0.5`; `283c044` touched only the three new files).
The three 1.0.6 alternates measure **0 ms** of trailing digital silence, so #225 did not add to this.
Worth an `OVERRIDES` trim window on bay-3 next masters pass; it is the worst-sounding loop in the set.

---

## P2 — `audio/README.md`'s master pointer is still the unfilled placeholder

`audio/README.md:21-25` is still the literal `> **Fill this in.**` block, under a heading explaining
the file is committed *precisely so that pointer survives*. `audio/` contains only `README.md`.
#225's three masters came out of an owner-local session and nothing in the repo says where they went.

**Consequence:** nobody but that one machine can re-trim a mis-trimmed alternate, re-run the
phone-band check, or execute the aac-64k experiment the same README sets up — and the one command that
would rebuild the assets destroys them first. **Cheapest P2 on the list: one line of prose.**

---

## P2 — #232 inverted the two UI voices on the practice-bay offer

`app/src/ui/screens.ts:8780-8781`:
```html
<button class="btn btn--primary"   data-action="sys-drill-skip">Back to the shop</button>
<button class="btn btn--secondary" data-action="sys-drill-go">${opts.drill} →</button>
```
`main.ts:9796-9797` chooses the sound purely off the class: `btn--primary` → `playUiConfirm()`, else
`playUiClick()`. `playUiConfirm` is documented at `audio.ts:1544-1548` as *"THE COMMITTING PRESS — play,
buy, undock, confirm … navigation says 'tk', commitment says 'bl-blip'"*.

After #232 swapped which button is primary (for a good UX reason), **the dismissal now blips like a
commit and launching the practice bay ticks like navigation.** The card is two buttons wide, so both
voices are heard within a second of each other, in the wrong order. #232's commit reasons carefully
about pad focus and the label; the audio rode along on the class and nobody looked.

**Fix:** a `data-action` allowlist beside `SPEND_ACTIONS` (`main.ts:417`) rather than a class test.

---

## P3 findings

**`bay-1-alt` gets no `MASTER_EQ` entry, and measures 1.18 dB darker than the sibling that needed one.**
`prepare-audio.mjs:291-293` keys `MASTER_EQ` by role filename with entries for `"bay-1"` and `"menu"` —
the two roles whose masters were too dark for a phone speaker. `"bay-1-alt"` / `"menu-alt"` match
neither, so they ship with no shelf and no limiter. Measured (relative, sibling-to-sibling):

| role | original | alternate | delta |
|---|---|---|---|
| menu | -21.26 dB | -22.30 dB | -1.04 |
| bay-1 | -20.53 dB | -21.71 dB | **-1.18** |
| bay-2 | -22.21 dB | -23.17 dB | -0.96 |

All three alternates are ~1 dB darker in the phone band and *hotter* full-band (+0.27 to +1.20 dB) —
i.e. they carry more low end, exactly the shape `bay-1`'s shelf exists to remove. Inside the 3.0 dB
`PHONE_SPREAD_DB` budget, so not a failed gate, but the same defect class the `bay-1` entry was written
for, consistently in the same direction.

**Related harness gap:** `PHONE_SPREAD_DB` and `LONG_SPREAD_LU` bound the **set** (min vs max across 15
beds), never a **pair**. The one comparison the player now makes directly — the two takes of one role,
same screen, different visit — is the one the pipeline never prints. A per-role take-spread line with a
tighter budget (say 1.5 dB) is six lines and would have caught the table above.

**The unlock ceremony always cuts its own stinger 3.3-5.0 s short.** `unlockFanfare.mp3` measures
**14.08 s**. `main.ts:382` sets `UNLOCK_MUSIC_TAIL_MS = 6000` and `:2827-2835` hands the lounge back at
`towerCelebrationMs + 6000` with a `stopStinger()` first. `towerCelebrationMs` is 3.04 s (Tier 2) to
4.75 s (Skydeck) per `screens.ts:660-676`. So the piece is faded at 9.04-10.75 s — **64-76% of its
length — every time.** The comment at `main.ts:378-380` states the intended cue is "9-11s" and does not
note the asset is 14.08 s, so whoever tunes this next will not know the tail is discarded.

**`audio/README.md`'s stinger and size claims no longer match the files.**
- `:41-42` lists `stingers/` as "20-25s pieces" and names four; **eight ship**. Measured: bayClear 20.4s,
  gameOver 24.8s, gameOver2 24.6s, refit 24.6s — but contractClear **11.7s**, timeFinal **12.1s**,
  brokeSettle **9.7s**, unlockFanfare **14.1s**. Both the list and the band are stale.
- `:147-149` still says "The twelve shipped beds are ~29 MB of a ~32 MB app". It is **fifteen beds and
  36.57 MiB**. That paragraph frames an open owner decision (aac-64k, -48%) worth ~4 MB more than stated.
- `:110-116` (role table) is **correct** — maps to "Fire inside", "Ecstasy of the senses", "Oasis in
  Paradise", matching `prepare-audio.mjs:171-173` exactly.

**The front door's Play plays the commit blip for a pure navigation.** `screens.ts:2496` —
`class="btn btn--primary" data-action="tiers"`. Since #223 that button no longer starts anything; it
opens the hub, where `data-action="play"` (also primary) starts the run. The player hears the "you
committed" blip **twice** on the way into a bay, the first time for a screen change. New with the split;
it dilutes the one sound that means commitment.

**`menu-alt.mp3` is now the largest single precached asset, 1.05 MiB under the Workbox ceiling.**
3,098,941 B (2.96 MiB) against `maximumFileSizeToCacheInBytes: 4 * 1024 * 1024` (`vite.config.ts:169`),
whose own comment records that exceeding it drops files **silently**. A fourth, longer alternate lands
on that ceiling with no build error. Worth a pin next to the existing `LONG_EXT`/glob pin.

---

## Install size — measured, not estimated

`npm run build` prints: **precache 92 entries, 42,711.40 KiB (41.71 MiB / 43.74 MB)**.

| | bytes | MiB | share of precache |
|---|---|---|---|
| `app/public/audio` total | 41,599,790 | 39.67 | **95.1%** |
| └ `music/` (15 beds) | 38,344,073 | 36.57 | 87.7% |
| └ `stingers/` (8) | 2,272,567 | 2.17 | 5.2% |
| └ `fx/` (32) | 983,150 | 0.94 | 2.2% |
| **the three alternates** | **8,174,619** | **7.80** | **18.7%** |
| └ menu-alt | 3,098,941 | 2.96 | |
| └ bay-1-alt | 2,476,610 | 2.36 | |
| └ bay-2-alt | 2,599,068 | 2.48 | |
| whole `dist/` | 45,426,703 | 43.32 | |

**The PR's open question resolves at the TOP of its 6-8 MB band: +7.80 MiB (+8.17 MB)**, taking the
precache from 34,728 KiB to 42,711 KiB — **+23.0%**. All fifteen beds are in `dist/sw.js`'s manifest,
i.e. every install downloads both takes of all three roles even though a session plays one of each.
**95% of the precache is now audio**; the codec decision in `audio/README.md` is where those megabytes live.

**Format consistency** — all fifteen beds including alternates: 128 kbps CBR, 44.1 kHz, joint stereo,
`Info` (CBR Xing) header, `Lavc62.11`, `encDelay 576`. **No format defect.**

---

## Checked and found correct (suspicions cleared)

- **No screen resolves to silence, and no role lookup resolves to nothing.** `syncMusic`
  (`main.ts:1621-1755`) names nine in-run cases and lets everything else fall to `default:` →
  `playMusic("menu")`, covering `splash`, the new front door, the new hub (`"tiers"`), `workshop`,
  `contracts`, `ws-short`, `preview`, `settings`, `controls`, `account`, `leaderboard`, `howto`,
  `tutorial-offer`, `sys-drill-offer`, `lesson-end`. `MusicName` is a closed union, so a role keyed to a
  dead screen would be a type error, not a 404 — the `hub`/`theme`/`contracts` roles the old runbook
  described were never typed and cannot be reached. **The doc's correction at `1.0.6.md:439-441` is accurate.**
- **No doubled beds across the new boundaries.** Front door → hub asks for the same `"menu"` and
  `playMusic` no-ops (`audio.ts:1708-1746`), so the lounge does not restart on every hub visit. The
  superseded-element guard (`:1758-1763`) and the `wasMusicOn` guard (`:762-775`) both exist with
  measured bug reports attached. No path leaves the hub permanently silent.
- **The shortfall card is not silent** — `refuseShort` plays `playFx("broke", { gain: 0.6 })`
  (`main.ts:6881`). The short buttons keep their `data-action` and are in `SPEND_ACTIONS`.
- **Every new control carries `data-action`** — hub run/Workshop/Contract cards, `claim-tier`, the `!`
  acknowledgement, `pick-tier`, `ws-short-close`, the drill offer. The only defect is which voice #232's
  swap picks, not a missing one.
- **Stingers, buses and the congestion lowpass are take-agnostic.** `FX_BUS_GAIN` 0.45 / `MUSIC_GAIN`
  0.55 / `STINGER_UNDER_DB` -6 untouched by #225. An alternate is ducked, cut and muffled exactly as its
  sibling.
- **The name seam is intact end to end:** FX 32 mapped / 32 shipped, STINGERS 8 / 8, MUSIC 15 / 15, zero
  missing and zero unclaimed in either direction.

## Fix order

1. `takeOf`'s bit 0 — use the **verified** `fmix32` finalizer above, with the sim pin that fails first.
2. The `menu-alt` / `bay-2-alt` loop seams — needs the masters, so needs #4 first.
3. #232's inverted UI voices — one allowlist entry.
4. The `audio/README.md` master pointer, then the stale stinger/size claims.
5. `bay-3`'s 1.33 s silent tail — next masters pass, with an `OVERRIDES` window.
