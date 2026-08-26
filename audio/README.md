# Audio masters — deliberately not in git

**This folder is gitignored.** The generated originals live outside the repo;
only the processed, shipped assets in `app/public/audio/` are committed.

## Why

Audio was 23 MB of a 36 MB repository, and the six largest objects in the
history were all mp3s. The tracks that exist today are already 44 MB of masters
on their own — and git history never shrinks, so every regenerated take keeps
its old blob forever. Iterate three times on a dozen tracks and the clone
carries all thirty-six.

The masters are also recoverable: they are in the Suno account that produced
them, and they are only needed when re-trimming or adding a sound. The shipped
assets, by contrast, must be committed — CI has no guaranteed ffmpeg, and they
are what `cap sync` copies into the app.

So: **derived assets in git, masters out of it.**

## Where the masters live

> **Fill this in.** Wherever you keep them — a Drive folder, Dropbox, an
> external disk — put the location here so the next person (or the next laptop)
> can find them. This file is committed precisely so that pointer survives.

## Layout

Filenames are the *code* names, not the generator's. An effect is named after
the game callback that fires it (`GameEvents` in `app/src/game/game.ts`), and
that name carries through to `app/public/audio/` and to the `playFx()` call, so
there is no translation step anywhere.

```
audio/
  fx/        one-shots, trimmed to their first transient
             shoot, impact, lineClear, pieceLost, settleStart,
             cryoShatter, bondBreak, bondBreak2, reloadReady,
             explosion, uiClick, bombArm, uiConfirm
             …plus the congestion loops (looping, not one-shots):
             congestionLoop, congestionLoop2, congestionLoop3
             (the full list is FX in app/scripts/prepare-audio.mjs, which
             FAILS the run on any mapped-but-missing master)
  stingers/  20–25s pieces, never trimmed, kept stereo
             bayClear, gameOver, gameOver2, refit
  tracks/    looping beds; these keep their SONG titles, since the track's
             name is a real thing and its role is an assignment that can
             change (the mapping lives in scripts/prepare-audio.mjs)
```

Renaming a generated file on the way in is the step where you decide what it
is. Anything unrecognised is reported and not shipped, rather than guessed at —
`tracks/` included, so a song dropped in and forgotten says so rather than
looking like a successful run that shipped nothing.

## The music roles

`menu` is the lounge bed, outside a bay. `bay-N` is the bed for that bay of a
Deep Run. `contract-rare` belongs to no bay — it is the 1-in-20 special a
Contract can draw (`contractBed` in `app/src/game/contracts.ts`).

Contracts have no theme of their own, by design: each borrows a bay's bed. In
precedence order — the special on a 5% roll, else bay 5's bed if the belt
carries **pentominoes** (that track is in 5/4 and a pentomino is five cubes),
else the bed for its slot in the board's TIER WINDOW. The roll is per ATTEMPT,
so a retry can surprise you twice.

The window is three consecutive bays anchored at the board's tier
(`contractSlotBed`): a tier-2 board plays bays 2, 3 and 4, a tier-7 board plays
7, 8 and 9. The anchor clamps at bay 8 — the last one whose three still fit
inside the ladder — so tiers 8, 9 and 10 all keep bays 8, 9 and 10. The board
tier is the player's unlocked Mark, so the daily deepens in sound as it deepens
in difficulty instead of restarting the arc at bay 1 every day.

| role     | song                | plays over            |
| -------- | ------------------- | --------------------- |
| `menu`   | lounge-menu-pause   | menus, pause, tutorial fail |
| `bay-1`  | chill beginning (Remastered) | bay 1, and a tier-1 board's first Contract |
| `bay-2`  | 2 chill             | bay 2, and a Contract in tiers 1-2's window |
| `bay-3`  | Threes              | bay 3, and a Contract in tiers 1-3's window |
| `bay-4`  | Level Four on the floor | bay 4, and a Contract in tiers 2-4's window |
| `bay-5`  | level 5             | bay 5 — it is in 5/4, which is why it is pinned to the NUMBER — any pentomino Contract, and tiers 3-5's window |
| `bay-6`  | raggae circuit      | bay 6, and a Contract in tiers 4-6's window |
| `bay-7`  | Chipdisco           | bay 7, and a Contract in tiers 5-7's window |
| `bay-8`  | Neon Circuit        | bay 8, and a Contract in tiers 6-10's window |
| `bay-9`  | Neon Static         | bay 9, and a Contract in tiers 7-10's window |
| `bay-10` | Neon Pixel Pulse    | bay 10, the closer, and a Contract in tiers 8-10's window |
| `contract-rare` | Whale Circuit | 5% of Contract attempts, beating both rules |

## Adding a track

Two steps, because a bed has both a sound and a job:

1. **`app/scripts/prepare-audio.mjs`** — add `"Your Song.mp3": "bay-N"` to
   `MUSIC`. The role is the shipped filename and the only name the code knows,
   so this is also where you re-score an existing bay: change the key, not the
   ladder.
2. **`app/src/game/run.ts`** — point that bay's row in `BAY_TRACKS` at the new
   role. Every bay has its own song today, so this only moves if you are adding
   a bay; a role outside `bay-1`…`bay-10` also needs adding to the `BayTrack`
   union above the table.

Then `npm run audio:prepare` and `npm run sim:systems`. The harness asserts the
beds the game can ask for and the shipped `app/public/audio/music/` are the SAME
SET in both directions, so doing only step 1 (a file nothing claims — dead
megabytes in the PWA precache) and doing only step 2 (a role with no file, which
is a bay that plays in SILENCE, because `playMusic` swallows the 404 by design)
each fail there rather than in play. It also checks that no bay borrows a
*later* bay's bed, and pins the Contract rules including the order they override
each other in.

`audio:prepare` **deletes `app/public/audio/` before rebuilding it**, so running
it without the masters would unship the whole soundtrack. It exits non-zero if
any mapped role has no master, rather than reporting a cheerful 0.00 MB.

## Regenerating

```bash
cd app && npm run audio:prepare
```

Trims each effect to its first sound, folds effects to mono, strips cover art,
and writes `app/public/audio/`. It needs `ffmpeg` **and `ffprobe`** on PATH.

Levelling is two jobs, not one:

- **Effects** are peak-normalised to −3 dBFS. A 200 ms transient *is* its peak,
  and integrated loudness is not even defined below the 400 ms gate.
- **Music and stingers** are loudness-normalised to −15 LUFS (two-pass EBU
  R128, `linear=true`, −1.5 dBTP ceiling). Peak-normalising a three-minute
  track measures nothing you can hear: the ten bay beds all hit −3 dBFS exactly
  as asked and still came out 2.3 LU apart.

Both folders get the same LUFS target on purpose. A stinger is not *baked*
louder than a bed, it is *played* louder, and by how much is `STINGER_GAIN` in
`app/src/lib/audio.ts` — one number, tunable by ear, no re-encoding.

Every run prints the trim window it chose for each effect — check that column,
because the trim is a heuristic over generated audio and will eventually pick
wrong. `OVERRIDES` in the script is the escape hatch.

It also measures every **finished** file back and fails the run if one missed
its target. That is not belt-and-braces: a wrong level is the one defect that
leaves no other trace — the encode succeeds, the asset is the right length, it
plays, it is merely wrong in the mix. `impact.mp3` shipped 2.7 dB under target
that way and was diagnosed as a bad sample.

Commit the resulting `app/public/audio/` changes; that is the half that ships.
