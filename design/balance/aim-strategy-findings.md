# AIMING STRATEGIES — what a system pays, and what a player does with it

> Companion to `winnability-sweep-findings.md`. That document prices notch
> combos and ship systems against **one** pilot; this one adds a second axis of
> player and re-runs the two measurements that were floors because of it.
>
> Instruments: `app/sim/aim-strategies.ts` (the policies),
> `app/sim/strategy-arms.ts` (the 2x2 harness), `app/sim/bots.ts`
> (`aimCandidates` — the shared aim search the policies re-rank rather than
> replace). Pins in `app/sim/systems.ts`.

---

## 0. THE PROBLEM THIS EXISTS TO FIX

`winnability.ts`'s §5b-ter closed with the sharpest open item in that document:

> *The rule asks for play — land the shipment soft in the liner, then close the
> row before something lands on it — and this pilot cannot make that play. […]
> the honest reading is "the instrument can no longer see what this system is
> for" rather than "the system does not work".*

And its §7 asked for the twin of it on the other side of the shop:

> *A cryo-striking bot. §5a measures the lance against a pilot that cannot
> strike cryo with a shipment at all.*

Both are the same defect: three ship systems — the Thaw Lance, the Impact
Cushion, and the Incinerator when it lands — are worth what a **decision**
makes them worth, and the harness had exactly one decision-maker. A price
measured against a pilot who cannot make the play is a fact about the pilot.

## 1. THE INSTRUMENT

A **strategy** is three optional hooks over the pilot the harness already flies,
never a second bot:

| hook | when | decides |
|---|---|---|
| `abilities(g, now)` | every tick, outside the cannon's cooldown | spend the consumables |
| `target(g, now, base)` | per shot | where to land this shipment |
| `select(g, now, pool, shot)` | per shot | which arc gets it there |

`select` re-ranks the candidates the aim search **already flew**. It never runs
a second search — two arms of one table have to be flying the same cannon, or
the row measures the search grid rather than the system.

`naive` has **no hooks at all** and is therefore the old pilot on the identical
code path, not a re-implementation of it. `systems.ts` pins that a bay flown
with it is byte-identical to one flown without a strategy, and pins separately
that the same comparison *can* see a strategy that changes the aim and one that
changes only the arc — the equality is worth nothing without them.

### The arms

Every table below is a **2x2**: system off/on crossed with pilot naive/aware,
one bay, one explicit ratchet stack, every cell on the same seed list inside one
process.

Two arms could not answer the question. What a two-arm sweep measures is
*(system + a pilot who cannot use it)* minus *(no system)*, and a pilot who
cannot use it is a floor of unknown depth. The split gives the system's
**passive** value and the strategy's **added** value separately, and their
**interaction** — which is the number that says a system is decision-shaped.

## 2. THE RELATIONSHIP NEITHER TABLE COULD SHOW

Pinned in `systems.ts`, found by a pin that failed:

- `lineClear.ts` sizes `VOLATILE_TRIGGER_SPEED` (22) against the whole power
  dial — its note records *"median impact runs 19.5 at power 0 to 25.5 at
  full — so 22 sits between the two halves of the dial: lob it and it survives
  (67% of launches)"*.
- **The aim search does not have the whole dial.** `AIM_POWER_CANDIDATES` is
  19/22/25/28; the softest is 19, and measured over the search's own 21x4 grid
  the arcs arrive at **22.7-25.6 px/step** — *entirely above* 22.

So `sim/README.md`'s standing caveat has a mechanism: **no bot lobs a volatile
shipment safely because no bot fires soft enough to.** Every volatile arrival
any pilot in this harness has ever made was a detonation waiting on geometry.

The liner is what closes the gap. Rung 1's threshold is **25.3**, which sits
*above* the grid's softest arrival — so with a liner aboard a soft shot is
insured and a cushion-aware pilot has something to choose. Rungs 2 (28.6) and
3 (30.8) sit above the grid's *hardest* arrival, so to this pilot they buy
**depth of liner and nothing else**. That is the whole explanation of the
non-monotone ladder §5b-ter reported, and it was invisible from either table
alone.

(The same measurement caught the impact estimate reading mid-flight: taken at
`compactor.top` the identical arcs read 16.4-21.5, below stock's 22, which would
have made the cushion's threshold gate dead code wearing a rule's name.)

---

## 3. THE IMPACT CUSHION

```sh
npm run sim:strategy -- --system cushion --mark 7 --bay 10 \
  --ratchets volatile:6 --seeds 96 --build material
```

**Tier 7 bay 10, `volatile:6` (the belt cap), material rig (330 pts), 96 paired
seeds.** The same bay, the same stack, the same seeds and the same rig as
`winnability-sweep-findings.md` §5b-ter.

| arm | pts | win | lines | shots | end $ | detonation bill |
|---|---:|---:|---:|---:|---:|---:|
| no liner / naive | 0 | 55/96 | 7.3 | 45.7 | $1188 | $687 |
| no liner / cushion | 0 | **55/96** | 7.3 | 45.7 | $1188 | $687 |
| Cushion 1 / naive | 20 | 56/96 | 6.6 | 38.6 | $1173 | $552 |
| Cushion 1 / **cushion** | 20 | **94/96** | 9.9 | 33.6 | $1953 | **$139** |
| Cushion 2 / naive | 55 | 63/96 | 7.3 | 40.0 | $1329 | $525 |
| Cushion 2 / **cushion** | 55 | **91/96** | 9.2 | 32.6 | $1883 | **$145** |
| Cushion 3 / naive | 110 | 59/96 | 6.7 | 37.3 | $1248 | $481 |
| Cushion 3 / **cushion** | 110 | **88/96** | 9.1 | 32.8 | $1822 | **$171** |

| rung | system effect | strategy effect | interaction | together |
|---|---:|---:|---:|---:|
| Cushion 1 | +1 | +38 | +38 | +39 |
| Cushion 2 | +8 | +28 | +28 | +36 |
| Cushion 3 | +4 | +29 | +29 | +33 |

### The naive rows reproduce §5b-ter exactly

55 / 56 / 63 / 59 of 96 — the same four numbers, from a different tool, on the
same seeds. That is the control that says everything below is the pilot and
nothing else has moved underneath it.

### The system is almost entirely a DECISION

The interaction column *is* the strategy column, to within a win. The rungs are
worth +1 / +8 / +4 to a pilot who buys one and carries on as before; they are
worth **+38 / +28 / +29** to one who lands volatile in the liner. **A player
who owns a maxed Impact Cushion and does not aim into it has bought almost
nothing.**

That is the strongest statement in this document and it is a shop-card problem
before it is a balance problem: the card sells insurance on a landing, and the
insurance only pays on landings the player chooses to make.

### It does not restore the monotone ladder. It inverts it.

The question this branch was opened on was whether an aware pilot recovers the
ascending 70/81/91 that #145's arrival gate turned into 56/63/59. The answer is
**no** — the aware ladder runs **94 / 91 / 88**, gently *descending*, and §2
says why in one line: **rung 1's threshold already insures every arc this
cannon can fire.** Rungs 2 and 3 raise a bar nothing was going to clear anyway.
What they buy is *depth of liner* — more slots to land in — and at 96 seeds
that is worth slightly less than it costs in landing further from the wall.

So the three rungs still do not separate upward, and the reason has changed
completely. Under the naive pilot they did not separate because the pilot could
not use any of them. Under the aware pilot they do not separate because **the
first one is already enough**, which is the same conclusion the proposal's own
§3b open item reached before the arrival gate closed ("tier 1 already restores
the baseline on its own, so the three-tier ladder as specified is not what the
data asks for") — arrived at from the opposite direction.

### The deferral is not the story any more either

§5b-ter's finding was that a liner "converts an arrival detonation into a later
one, in a bay that is fuller by the time it goes off": the bill fell only
$687 → $481 at maxed. Played, it falls to **$139**, and the shot count falls
with it (45.7 → 33.6). The deferred bomb is real, and it is a consequence of
*not playing around it* — which the aware pilot does, by refusing to drop a
non-volatile shipment onto a slot whose top cube is an intact volatile one.

### One measurement that was the instrument, not the system

The first version of the aware rule aimed every volatile shipment at a FIXED
lined window and read **90 / 82 / 77**. The window was `cells - widthCells` —
the lined slot nearest the advancing face — so it moved with the liner's depth,
putting cargo mid-liner at rung 1 and directly in front of the press at rung 3.
That is a confound wearing a tier number, and it is recorded here because the
descending shape survived the fix while the size of the drop did not: 90/82/77
became 94/91/88 once every rung was played by the same rule.

## 4. THE THAW LANCE

TABLE_LANCE

## 5. THE CHEAPEST WINNING STRATEGY, WITH A FOURTH LEVER

TABLE_CHEAPEST

## 6. THE INCINERATOR

Not measured. The track is not on `staging` (`claude/incinerator-system`), and
`aim-strategies.ts` carries no incinerator strategy — the placeholder **throws**
rather than quietly behaving like `naive`, because a stub that behaved like
`naive` would let an arms table report the system as worth nothing, which is the
exact mispricing this document exists to end.

The hooks it will need are already there and no interface change is expected for
the aiming half: `select` (the sky region is a band of world y, and every
candidate in the pool has flown its arc), and `abilities` (a charge fired at
cargo still above the field top is the cheapest sky kill available, and that is
a question of timing). The one thing that may need a field is a target *above*
the floor — `ShotTarget` carries a landing x today; add `y` there rather than
inventing a second target type.

## 7. THE LEDGER

Every bias still runs one way.

- **CLOSED here:** the pilot lobs volatile into a liner on purpose, refuses to
  drop hard cargo onto a volatile cube it has already saved, strikes frozen
  cubes with shipments, and rations lance charges against the press.
- **STILL OPEN:** no lookahead, no plan spanning more than the shot in hand, no
  re-planning of the draft, and no model of the belt beyond the one shipment it
  has already been shown. A human plays a bay; these play a shot.

So a number here is still a floor. It is a higher floor than the one in
`winnability-sweep-findings.md`, and the two are only comparable where this
document says they are.
