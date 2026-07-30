# Economy & progression design

The record of what the three-currency rework is trying to do, so the numbers can
be tuned later without re-deriving the intent.

## The problem it replaced

The old economy had one currency. Funds were the score, the bay target, the
launch cost and the leaderboard entry all at once. Two things fell out of that:

1. **Bombs were dominated at every funds level.** A bomb consumed a full-price
   launch and paid literally nothing. There was no funds level, no pile state and
   no bay where firing one was the correct play — it was strictly worse than
   firing a piece. The mod existed but had no economic argument for taking it.
2. **A lost run paid nothing.** Ten bays, one currency, and death wiped it. The
   runs where a player most needs a new option to try — the ones that ended badly
   — were the ones that gave them nothing.

Two observations from playtesting shaped the fix:

- *"When money is tight it forces you to aim well; with lots of money you can
  stash — invest in launches — then break bonds and clear lots of lines at the
  end."* Tight funds and loose funds produce genuinely different, both-valid
  play. That's worth protecting: funds stay the bay's operating constraint, and
  nothing else got layered onto them.
- *"Wind against sometimes makes it impossible to win unless you extend to 18
  lines — it can feel a bit unfair."* A bay whose rolled headwind puts the back
  of the field out of reach isn't difficulty, it's a dead run the player can see
  coming and can't act on. The answer had to be an **agentive** one: a system the
  player can choose to invest in.

## Three currencies, three horizons

| | Lifetime | Earned by | Spent on |
|---|---|---|---|
| **Funds `$`** | one bay | line payouts, bomb salvage | launches. Also the bay's own target. |
| **Scrap `♻`** | one run | 2/line, 10/bay cleared | ship upgrades at refit stops |
| **Salvage** | forever | every finished run, win or lose | permanent unlocks in the Workshop |

They are deliberately **not** interchangeable. Funds are operating budget, scrap
is capital, salvage is R&D. Banking a huge surplus never buys upgrades, and a
rough bay you barely survive still moves the build forward. That separation is
what keeps the three decisions distinct instead of collapsing into "get more
money".

## The ship (FTL layer)

The compactor rig **is** the ship: fixed stock size, refitted with scrap at
**refit stops after bays 3, 6 and 9**. Six systems, three tiers each, one shared
price ladder of **20 / 35 / 55** scrap (110 for a full track).

| Track | Tiers | What it's for |
|---|---|---|
| **BAY** | +2 / +4 / +6 open cells (→18) | The "extend to 18" lever, now earned capital rather than a random Wide Bay offer. |
| **LAUNCHER** | +6/12/18% muzzle speed · 20/40/60% wind cancelled | **The wind answer.** More speed to throw through a headwind, plus a stabilizer that cancels part of it outright. |
| **HYDRAULICS** | ×1.6/2.2/2.8 settle assist · +8/16/24% stroke | Turns "nearly a line" into a payout. The upgrade for builds that land loose cubes. |
| **MAGAZINE** | −15/30/45% cooldown | Tempo. |
| **REACTOR** | +$60/120/180 float · +$15/30/45 per line | The economy track. |
| **BONDS** | +1/2/3 Bond Breaker charges per bay | Compaction for builds whose pieces don't flatten their own pile. |

**Income sizing.** A clean bay clears ~8 lines → ~26 scrap. Stops arrive at
roughly 78 / 156 / 234 cumulative scrap, i.e. "one track nearly maxed, or two
opened" at the first stop. An FTL-shaped choice, not a shopping spree.

**Upgrades vs. mods** are different in kind, and both exist on purpose:

- A **mod** is a hand you were *dealt* — three seeded offers every bay, often a
  trade-off, sometimes a bane, and you don't pick which three you see.
- An **upgrade** is capital you *chose* to spend from a fully-visible menu with a
  known price. Nothing in a track is a downside; the cost is the opportunity cost
  of the scrap.

Application order is fixed in `run.ts`'s `levelForRun`: **upgrades, then mods**.
A contract's multipliers compound on top of whatever ship you refitted, which is
the intended reading ("this contract applies to the ship you're flying").

## Bombs, made legible

Demolition Charges are now a **consumable**, not a launch cadence:

- **Armed**, not fire-on-tap (💥 / `X`), so the shot still goes where the player
  aimed and the muzzle ghost promises what actually fires.
- **Free to fire** — no launch cost. It was already paid for when drafted.
- **Refunds `$8` per cube vaporized**, plus a stingy trickle of scrap.

That refund is the whole point: it gives the bomb a price the player can reason
about. A cube in a pile that will never complete a line is worth **$0** as line
material and **$8** as scrap metal — so demolishing junk is a positive-value
play, while blowing up a row you were two cubes from closing is a clear,
self-inflicted loss. Both sides of the trade now exist, which is exactly what the
old version lacked.

## Payload sizes

`pieceSize` drives cube count, per-cube **density** and joint **fragility**
together — so "tiny" isn't just smaller and "bulk" isn't just bigger.

| | Cubes | Density | Break threshold | Plays like |
|---|---|---|---|---|
| **tiny** (Micro) | 2 | ×0.70 | ×0.60 | Cheap, precise, brittle — and **too light for its own weight to square up the pile below it**. |
| **std** | 4 | ×1.00 | ×1.00 | Baseline. |
| **bulk** (Bulk) | 5 (pentominoes) | ×1.35 | ×1.60 | Expensive, rigid, and **heavy enough that landing presses the layers beneath flat**. |

The density asymmetry is the interesting part. A heavy shipment helps the
compactor reach the strict slot grid in `lineClear.ts` by physically settling
what's under it. A light one lands *on top of* a mess without ever fixing it — so
a micro build has to buy its compaction some other way, which is what makes
**Bond Breakers** a build requirement rather than a nice-to-have for that line.

Break thresholds are stamped **per constraint** at spawn, not read from one
global level value, because sizes coexist on the field: a micro run that later
drafts Bulk still has old dominoes lying around and they must keep the fragility
they were launched with.

## The Autoloader (micro endgame)

Gated behind the `auto` salvage unlock **and** owning Micro Shipments this run.
The cannon fires itself every 420ms at a ±9° spread around wherever the player
left it, at half launch cost, with a random rotation. Fast, cheap, probabilistic
— explicitly not trying to be a good player.

It only works on top of the build it belongs to: cheap enough payloads to survive
the waste, and Bond Breakers (or Hydraulics) to flatten what it piles up. Grabbing
the slingshot suspends it, so manual control is always one touch away.

## Salvage always pays

`salvageForRun = 3 + 5×bays + 1×⌊lines/2⌋ + 25 if the run completed`

The `+3` floor is deliberate. "Dying gives you resources" has to be true even for
a bay-1 flameout, or the worst runs pay nothing.

Unlocks add **options**, never flat stat bumps: a new modifier enters the draft
pool, a new consumable exists, the wind gets surveyed. That constraint keeps a
veteran's run harder-won rather than merely bigger-numbered, while still making a
failed run worth having played.

## Tuning

Everything is a named constant with a comment:

- `level.ts` — `makeBaseLevel` formulas, `SCRAP_PER_LINE`, `SCRAP_PER_BAY`
- `upgrades.ts` — `TIER_COSTS`, per-track `apply`
- `meta.ts` — `UNLOCKS` prices, `SALVAGE_*` weights
- `mods.ts` — per-mod numbers
- `pieces.ts` — `SIZE_SPEC`
- `run.ts` — `REFIT_EVERY`

`npm run sim:balance` sweeps bays × bots × mods. Two caveats it can't see past:
the bots never use abilities (Bond Breaker, Demolition read as 0 delta), and the
Autoloader *fights the bot for the cannon*, so its sweep numbers measure a
conflict that doesn't exist in real play. Both need human playtesting.
