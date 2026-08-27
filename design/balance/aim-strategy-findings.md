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
Cushion, and the Incinerator when it lands — were **assumed** to be worth what a
decision makes them worth, and the harness had exactly one decision-maker. A
price measured against a pilot who cannot make the play is a fact about the
pilot.

**The assumption turns out to hold for one of them and not the other**, which is
the single most useful thing in this document. At each system's top rung, the
same 2x2 splits the win change into what the rung pays a pilot who does not play
it and what the play adds on top:

| | rung, unplayed | play adds | net |
|---|---:|---:|---:|
| Impact Cushion (of 96) | +4 | **+29** | +33 |
| Thaw Lance (of 48) | **+16** | −15 | +1 |

The cushion is a decision the rung enables. The lance is a rung, and every
decision tried on top of it made the bay worse. One of them has to be taught;
the other only has to be sold.

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

**One change per step.** A strategy that alters two things produces one number
for both, and the lance's first table was exactly that. `--aware` runs the tool
against the same control with a different aware policy, so `naive → strike →
lance` reads as two measurements rather than one — the reason the registry
carries four policies (`naive`, `strike`, `lance`, `cushion`) rather than three.

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

## 4. THE THAW LANCE — a negative result, and the harness's own trigger wins

```sh
npm run sim:strategy -- --system lance --ratchets cryo:3 --seeds 48 \
  --build material --aware strike
npm run sim:strategy -- --system lance --ratchets cryo:3 --seeds 48 \
  --build material --aware lance
```

Two runs, one control. The lance-aware strategy changes **two** things —
shipments go at frozen cubes, and charges are rationed for the cube the press
is about to reach — so one table cannot attribute a result to either. `strike`
is the shipment half alone over the shipped greedy trigger; `lance` adds the
discipline. Reading naive → strike → lance, each step is exactly one change.

**Tier 7 bay 10, `cryo:3`, material rig (330 pts), 48 paired seeds:**

| arm | pts | win | lines | shots | end $ | charges used |
|---|---:|---:|---:|---:|---:|---:|
| no rack / naive | 0 | **18/48** | 6.9 | 34.5 | $819 | — |
| no rack / strike = lance | 0 | 16/48 | 9.1 | 42.4 | $692 | — |
| Lance 1 / naive | 20 | 19/48 | 7.7 | 36.5 | $824 | 3.0 of 3 |
| Lance 1 / strike | 20 | 11/48 | 8.7 | 44.1 | $554 | 3.0 |
| Lance 1 / lance | 20 | 15/48 | 9.1 | 42.4 | $723 | 2.9 |
| Lance 2 / naive | 55 | 18/48 | 8.5 | 40.3 | $773 | 6.0 of 6 |
| Lance 2 / strike | 55 | 20/48 | 9.8 | 41.3 | $937 | 6.0 |
| Lance 2 / lance | 55 | 18/48 | 8.4 | 38.0 | $807 | 5.7 |
| Lance 3 / naive | 110 | **34/48** | 7.7 | 30.8 | **$1373** | 8.9 of 9 |
| Lance 3 / strike | 110 | 31/48 | 8.5 | 34.9 | $1262 | 8.9 |
| Lance 3 / lance | 110 | 19/48 | 8.4 | 37.8 | $786 | 7.9 |

### The best pilot in the table is the one the harness already had

`Lance 3 / naive` — the shipped greedy trigger, a maxed rack, and shipments that
never go looking for ice — wins **34 of 48** where the bare bay wins 18. Every
proposed improvement is worse than it. That is the finding, and it is a
negative one: **the Thaw Lance is a passive system and this document's premise
does not apply to it.**

The two systems separate cleanly on the interaction column, which is the point
of measuring it:

| | rung 3 system effect | strategy effect | interaction |
|---|---:|---:|---:|
| Impact Cushion | +4 | +29 | **+29** |
| Thaw Lance | +16 | −15 | −13 |

The cushion's ladder is almost entirely interaction — it pays for a decision.
The lance's is almost entirely the system — it pays for owning it. **A shop
that sells both with the same card is teaching one of them wrong.**

### Why each half loses, which is the useful part

**Shipment-striking costs launches and money.** With no rack it takes the bay
from 18 to 16 wins while *raising* lines 6.9 → 9.1 — the frozen cubes do get
thawed and the rows do sell, and the bay goes broke anyway: 34.5 shots become
42.4 and end money falls $819 → $692. `level.ts`'s float "always buys eight
launches", and a pilot spending shipments on ice is spending its float on cargo
that is already on the field. §5a's finding that cryo "costs a shipment" is
confirmed, and the confirmation is that the shipment is **not affordable at
Tier 7's launch price**. The counter-play the game already has is real and is
priced above what the bay can pay.

**Rationing charges is worse than spending them.** At a maxed rack it costs 12
wins against `strike` (31 → 19) while saving one charge a bay (8.9 → 7.9). The
premise of the rule was that a charge spent on a cube a shipment could reach is
a wasted charge. It is not, because the shipment that would have reached it is
the shipment that could not be afforded. **`counters.ts`'s "pull the trigger
whenever it will do something" is not a placeholder for a smarter rule — it is
the right rule**, and its own note anticipated this ("the game is a better judge
of a wasted charge than a wrapper is").

### What this says about the lance's price

`Lance 3` is worth +16 bay wins passively at Tier 7's hardest cryo load, and
rungs 1 and 2 are worth +1 and 0. That is a ladder with everything at the top,
which is a different shape from the one §5a-bis measured (29/48 → 43/48 at the
capstone) and worth a look — but it is a claim about a *rung ladder*, not about
a strategy, and re-pricing it is outside what this branch measured. Recorded as
an open item rather than a finding.

## 5. THE CHEAPEST WINNING STRATEGY, WITH A FOURTH LEVER

`winnability.ts`'s cheapest-strategy search walked three levers — the loadout
ladder, the refit stance, the draft — and held a fourth fixed without saying so.
`--strategies` makes the pilot a dimension of the answer, paired on the same
seeds, and the search now reports the cheapest clear across every arm and names
which one found it.

Two `--build` orders exist so the dimension can mean anything: **`liner`**
(Impact Cushion first) and **`chill`** (Thaw Lance first). No other priority
order installs either track, so a cushion-aware pilot flown on `spatial` is a
pilot with no hands — the third time this harness has made that mistake, after
`demo` on a rig with no charges and `bondHands` on a rig with no emitter.

```sh
npm run sim:winnability -- --mode cheapest --marks 7 --seeds 3 \
  --build liner --strategies naive,cushion --policies max:volatile
```

**Tier 7, `liner` order, `max:volatile` draft, 3 seeds:**

| refit | aim | pts | clears | rig |
|---|---|---:|---:|---|
| none | naive | 330 | **1/3** | bay2 lau2 hyd2 rea2 bon2 cus2 |
| greedy:wide | naive | — | 0/3 | none found |
| none | cushion | — | 0/3 | none found |
| greedy:wide | cushion | — | 0/3 | none found |

**This is a null result and it is the one the tool predicted.** `winnability.ts`
already states why a run cannot price a counter: *"a counter changes the
physics, the physics changes where every subsequent shipment lands, and ten bays
of that is a different run — so the wall moves by more than the counter is worth
and the measurement is swamped by its own leverage."* A strategy is a bigger
perturbation than a counter, not a smaller one. Three seeds cannot see past it.

So the fourth lever is now **wired and reported**, and the honest statement
about it is that at this sample size it does not separate — while the same
strategy at bay level, on the same rig and 96 seeds, is worth +38 wins. The
resolution lives at the bay. Read §3 for the answer and this section for the
plumbing.

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

## 7. WHAT TO DO ABOUT IT, IN ORDER

1. **The Impact Cushion's card has to teach the play.** +1/+8/+4 bought and not
   played, +38/+28/+29 played, on the same rig and the same seeds. Nothing in
   the shop currently distinguishes "this system does something" from "this
   system lets you do something", and this is the first track where the
   difference is most of its value. The field drawing (`drawCushionBed`) already
   shows the liner; what is missing is the sentence that says *land volatile in
   it on purpose*.
2. **Re-open the cushion's rung ladder, now that a pilot can use it.** 94/91/88
   is not a ladder, and §2 says why: rung 1 already insures every arc the cannon
   can fire, so rungs 2 and 3 sell depth of liner at 35 and 55 points apiece.
   Either the rungs should sell something else, or the ladder is two rungs long.
   This is the item `winnability.ts` §5b-ter deferred, and it is now answerable
   with a measurement instead of a guess.
3. **Leave the Thaw Lance's trigger alone**, and record that its greedy rule was
   measured against two alternatives and beat both. `counters.ts`'s note gets to
   keep its claim.
4. **Cryo's counter-play is priced above what a bay can pay.** A shipment spent
   striking ice raises lines and loses the bay, at Tier 7's launch cost. That is
   an economy finding, not a cryo finding, and it lands on the same lever
   `winnability-sweep-findings.md` §6.1 already points at.
5. **Do not read the run-level table as a strategy result.** §5 is plumbing plus
   a null at three seeds. Anything said about a strategy in a Deep Run needs the
   seed count that a bay-level arm needed, and a run costs ten bays.

## 8. THE LEDGER

Every bias still runs one way.

- **CLOSED here:** the pilot lobs volatile into a liner on purpose, refuses to
  drop hard cargo onto a volatile cube it has already saved, strikes frozen
  cubes with shipments, and rations lance charges against the press. The last
  two are closed in the sense that matters — they were tried and measured — not
  in the sense that they helped.
- **STILL OPEN:** no lookahead, no plan spanning more than the shot in hand, no
  re-planning of the draft, and no model of the belt beyond the one shipment it
  has already been shown. A human plays a bay; these play a shot.

So a number here is still a floor. It is a higher floor than the one in
`winnability-sweep-findings.md`, and the two are only comparable where this
document says they are.
