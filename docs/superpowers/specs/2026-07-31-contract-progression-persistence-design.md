# Contract progression and durable player identity

**Date:** 2026-07-31
**Status:** approved, not yet implemented

## Why

`DESIGN.md`'s mode table already says a Contract earns **permanent rig
upgrades**. The implementation deliberately punted — Contract mode clears
`this.run` rather than threading "unless it's a contract" through the run
machinery, so today a Contract awards nothing at all. Completing one is
currently worth exactly as much as not playing it.

Paying out means the award has to survive the session, and localStorage alone
does not: a cleared cache or a reinstall wipes it, and the player has no way to
tell that from the game forgetting.

## Decisions

Three, taken deliberately, each closing off a larger design that was considered
and rejected for now.

**1. Durable on one device, not cross-device accounts.** An anonymous device ID
minted on first launch, mirrored to D1. No login screen, no friction, offline
play preserved. It does *not* follow a player to a new phone; adding that later
means linking the device ID to a real identity (Sign in with Apple, per
`DESIGN.md`'s monetization notes), which this schema is shaped to allow without
migration.

**2. Only the three daily Contracts pay.** This is a paywall-integrity
requirement, not a balance preference. `DESIGN.md` states Unlimited "never buys
build budget, Marks, leaderboard position, or anything usable in Deep Run" — but
Unlimited *does* buy "the daily Contract cap lifted". If every Contract awarded
salvage, then subscription → more Contracts → more salvage → more unlocks →
stronger Deep Runs, which is precisely the path the design forbids, and
uncapped. Awarding only the dailies keeps the subscription buying **throughput,
never power**. Extra Contracts remain unlimited practice.

**3. Salvage only; no new currency and no career score.** `meta.ts` defines
three currencies on three horizons, and salvage is already the "forever" one,
spent in the Workshop on unlocks. Contracts feed it. Adding a fourth number
would need its own progression design and buys nothing here.

## Identity

On first launch the client asks the Worker to mint a player. The Worker returns
`{ id, token }`; the client stores both in localStorage.

**The token is not optional.** A bare device UUID in a request body is a
username with no password: anyone who learns another player's ID could overwrite
their progress. The Worker stores only a hash of the token and requires it on
every write.

This is deliberately *not* a security boundary against the player themselves —
see [Threat model](#threat-model).

## Schema

Three tables beside the existing `scores`:

```sql
CREATE TABLE players (
  id           TEXT PRIMARY KEY,   -- uuid, client-visible
  token_hash   TEXT NOT NULL,      -- SHA-256 of the mint-time token
  name         TEXT,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);

CREATE TABLE progress (
  player_id    TEXT PRIMARY KEY REFERENCES players(id),
  salvage      INTEGER NOT NULL DEFAULT 0,
  unlocks      TEXT    NOT NULL DEFAULT '[]',  -- JSON array of unlock ids
  mark         INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  version      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE contract_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    TEXT    NOT NULL REFERENCES players(id),
  contract_id  TEXT    NOT NULL,   -- "<seed>-<tier>-<slot>", from contracts.ts
  won          INTEGER NOT NULL,
  lines        INTEGER NOT NULL,
  launches     INTEGER NOT NULL,
  secs         REAL    NOT NULL,
  salvage      INTEGER NOT NULL,   -- awarded for THIS completion
  created_at   INTEGER NOT NULL,
  UNIQUE (player_id, contract_id)
);
```

**`UNIQUE (player_id, contract_id)` is the load-bearing line.** Contract ids are
deterministic (`generateContract` builds them from seed, tier and slot), so a
daily Contract is completable once per player and replaying it cannot farm
salvage. Decision 2 is enforced by the database rather than by client
good-behaviour, and the same constraint doubles as the idempotency key the
offline queue needs — a retried award is a no-op, not a double payout.

## API

All under `/api`, all requiring `Authorization: Bearer <token>` except the mint.

| Route | Purpose |
|---|---|
| `POST /api/player` | Mint a player. Returns `{ id, token }` **once**; the token is never retrievable again. |
| `GET /api/progress` | Read the mirrored progress for the bearer. |
| `PUT /api/progress` | Push local progress. Salvage merges as `max(local, server)`. |
| `POST /api/contract` | Report a completion. Awards salvage, or returns the existing row unchanged if already claimed. |

`POST /api/contract` returns the awarded amount and the resulting balance, so a
client that queued an award offline learns whether it actually counted.

### Award size

Derived from the Contract's own difficulty rather than flat, so the tier ladder
means something: a function of `goal` and the complications drawn. The exact
curve is a balance question this spec does not settle — it needs the same
treatment `salvageForRun` got, and should be checked against `UNLOCKS` prices so
a week of dailies buys a visible amount of the tree without trivialising it.

## Offline and sync

**localStorage stays the source of truth for gameplay.** D1 is a mirror. The
game must remain fully playable with the Worker unreachable, which it is today
and should not lose.

- Awards queue locally, keyed by `contract_id`, and retry on next launch.
- Restore takes `max(local, server)` for salvage. Salvage is monotonically
  earned, so max is safe and cannot lose a legitimately earned award.
- `unlocks` merges as a set union — buying an unlock is irreversible.
- `version` gives last-write-wins detection for the single-device case; genuine
  multi-device conflict resolution is out of scope by decision 1.

## Threat model

Stated plainly so nobody later mistakes this for something it is not.

**Protected:** one player overwriting another's progress; replaying a daily
Contract to farm salvage; a retried offline award paying twice.

**Not protected:** a player forging their own Contract completion. Verifying one
server-side would mean replaying Matter.js inside a Worker — non-deterministic
across platforms and a physics engine in a request handler. Client-reported
outcomes are accepted for progression.

That is an acceptable trade because progression is single-player. The
competitive surface is the leaderboard, which is *already* unauthenticated and
forgeable (`POST /api/scores` accepts any name and score today). Hardening it is
a separate piece of work; this spec should not be read as having done it.

## Client changes

| File | Change |
|---|---|
| `lib/store.ts` | Device id + token; queue of unsynced awards |
| `lib/api.ts` *(new)* | Worker client; all calls fail soft and never block play |
| `game/contracts.ts` | Award size from Contract difficulty |
| `main.ts` | On Contract win, award locally and enqueue the sync |
| `worker/index.ts` | The four routes above |
| `migrations/0002_players.sql` | The schema above |

## Testing

- `sim/systems.ts`: award size is monotone in tier, and a week of dailies buys a
  sane fraction of the unlock tree.
- Worker tests: minting returns a usable token; a second `POST /api/contract`
  for the same `(player, contract)` pays nothing and reports the original award;
  a write with a wrong token is rejected.
- Offline: with the Worker unreachable the game is fully playable, awards land
  locally, and the queue drains on reconnect without double-paying.

## Out of scope

- Cross-device accounts and real identity (Sign in with Apple).
- Leaderboard authentication or anti-forgery.
- Moving salvage into RevenueCat virtual currencies — `DESIGN.md` already
  defers this until a currency bundle is actually sold.
- A career score or any fourth currency.
