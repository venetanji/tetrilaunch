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

TABLE_CUSHION

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
