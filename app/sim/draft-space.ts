/**
 * THE REACHABLE NOTCH-COMBO SPACE — every ratchet stack a run can actually
 * arrive at bay 10 carrying, and nothing else.
 *
 * SIM-ONLY, for the same reason `ratchet-model.ts` is — but this file is the
 * opposite kind of thing, and the pair is worth reading together.
 * `ratchet-model.ts` is a MODEL: it invents an average run's notches
 * round-robin over the number axes, and says outright that no player flies it.
 * This is an ENUMERATION: it deals the real hands (`hazards.ts`'s
 * `hazardOffers`), takes only picks the real draft would accept
 * (`togglePick`), and therefore every combo it produces is one a player could
 * genuinely reach on that seed.
 *
 * That difference is what lets a sweep say "unwinnable". A model's unwinnable
 * combo might be a combo nobody is ever dealt; an enumeration's is a bay a
 * player can walk into.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THE SPACE FINITE, AND SMALL
 *
 * A run takes RUN_LEVELS - 1 = 9 drafts. The last of them is the Final
 * Inspection (run.ts's `isFinalDraft`), which deals clauses rather than
 * notches, so 8 of the 9 are ratchet drafts. Each deals a TWO-CARD hand
 * (hazards.ts's `hazardOffers`: "two cards, at every Mark — the capstone
 * included"), and `picksPerBay` asks for one notch below Mark 10 and two at it.
 * So per draft the reachable hands are:
 *
 *   one pick  ->  2   (A, or B)
 *   two picks ->  3   (A twice, one of each, B twice — togglePick's double)
 *
 * Eight drafts gives 2^8 = 256 paths below the capstone and 3^8 = 6561 at it.
 * Both are exhaustively enumerable in milliseconds, which is the fact this
 * whole file rests on: the notch-combo space is NOT the thing that has to be
 * sampled. PLAYING a combo costs seconds; ENUMERATING one costs nothing, so
 * `winnability.ts` can always report the exact size of the space it is
 * sampling from rather than a bound.
 * ------------------------------------------------------------------------- */
import {
  hazardById, hazardOffers, isMaterialDraft, picksPerBay,
  type HazardDef, type HazardId, type Ratchets,
} from "../src/game/hazards";
import { isFinalDraft, RUN_LEVELS } from "../src/game/run";

/**
 * Every hand of exactly `need` picks the draft would accept from `hand`.
 *
 * Derived from `togglePick`'s rules rather than restated: a tap fills while
 * there is room and edits once full, so every multiset of size `need` drawn
 * from the cards on the table is reachable — EXCEPT that on a forced-material
 * hand a number-axis card is capped at one seat ("a forced hand's partner may
 * never absorb the whole quota"). `sim/systems.ts` pins this against a
 * brute-force fold of `togglePick` over every tap sequence, so the two
 * definitions cannot drift.
 *
 * Returned in the cards' own order, each hand sorted the same way, so a combo
 * has one spelling and two seeds' results can be keyed against each other.
 */
export function legalHands(
  hand: HazardDef[],
  need: number,
  forcedMaterial: boolean,
): HazardId[][] {
  const ids = hand.map((h) => h.id);
  const out: HazardId[][] = [];
  const walk = (start: number, acc: HazardId[]): void => {
    if (acc.length === need) { out.push([...acc]); return; }
    for (let i = start; i < ids.length; i++) {
      const id = ids[i];
      // The forced-hand cap. A content card may be doubled — "a doubled
      // material still satisfies the bay" — and a number card may not.
      if (forcedMaterial
        && hazardById(id)?.kind !== "content"
        && acc.includes(id)) continue;
      acc.push(id);
      walk(i, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/** One rung of a run's draft ladder: which bay was just cleared, what was
 *  dealt, and every pick the player could legally leave with. */
export interface DraftRung {
  /** 1-based bay just CLEARED — the way a player counts them, and the way
   *  MATERIAL_DRAFT_BAYS is written. */
  bay: number;
  /** 0-based level index, the argument `hazardOffers`/`isMaterialDraft` take. */
  levelIndex: number;
  hand: HazardDef[];
  need: number;
  forced: boolean;
  hands: HazardId[][];
}

/**
 * The whole reachable space for one (seed, mark), enumerated exhaustively.
 *
 * A DFS rather than a product, because the ladder is not quite a product: on a
 * forced hand with a single material on the table (Mark 4's case) `hazardOffers`
 * reads the run's ratchets so far to choose the partner (`hardestActive`), so
 * the hand dealt at bay 5 can depend on what was taken at bay 2. The DFS walks
 * the real dependency; a product would quietly assume it away.
 *
 * `paths` counts leaves and `vectors` counts DISTINCT terminal ratchet stacks —
 * the two differ because order does not matter to `applyRatchets` ("a run's
 * difficulty is a function of WHICH notches were taken rather than of the
 * sequence they arrived in"), so many paths land on one combo. The sweep quotes
 * both, and the gap between them is how much of the space is genuinely
 * different rather than merely re-ordered.
 */
export interface DraftSpace {
  seed: number;
  mark: number;
  rungs: DraftRung[];
  /** Distinct leaf paths through the ladder. */
  paths: number;
  /** Distinct terminal ratchet vectors, keyed by `comboKey`. */
  vectors: Map<string, Ratchets>;
}

/** A ratchet stack's canonical spelling — axes in ladder order, `id:n`, joined.
 *  The key the findings table is written in and the key two seeds are compared
 *  on. */
export function comboKey(r: Ratchets): string {
  const parts = Object.entries(r)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, n]) => `${id}:${n}`);
  return parts.length ? parts.join(" ") : "none";
}

/** Fold picks onto a stack, the way `advanceRun` does. */
export function withPicks(ratchets: Ratchets, picks: HazardId[]): Ratchets {
  const out: Ratchets = { ...ratchets };
  for (const id of picks) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/**
 * The rungs a run at (seed, mark) meets given the ratchets it arrives at each
 * one with. Threaded rather than recomputed globally because of the Mark-4
 * dependency described on `DraftSpace`.
 */
export function rungFor(
  seed: number,
  mark: number,
  levelIndex: number,
  ratchets: Ratchets,
  /** Notches this rung charges. Defaults to the LADDER's own rule
   *  (`hazards.ts`'s picksPerBay). A caller holding a RunState should pass
   *  `run.ts`'s picksForRun instead — the two agree on every ladder run and
   *  differ on a Skydeck one, which charges one notch at the capstone Mark
   *  where the ladder charges two. The default is the ladder because that is
   *  what `enumerateSpace` is enumerating; overriding it is how a driver stays
   *  honest about the mode it is actually flying. */
  need = picksPerBay(mark),
): DraftRung | null {
  if (levelIndex >= RUN_LEVELS - 1) return null;
  // The last draft deals the Final Inspection, not a notch — a clause is not a
  // member of this space and finals.ts prices it as its own exam. Stated with
  // the ladder's own predicate because enumerateSpace has no run to ask; a
  // driver that holds one asks run.ts's finalDraftFor before it gets here.
  if (isFinalDraft(levelIndex)) return null;
  const hand = hazardOffers(seed, levelIndex, mark, undefined, ratchets);
  const forced = isMaterialDraft(levelIndex);
  return {
    bay: levelIndex + 1,
    levelIndex,
    hand,
    need,
    forced,
    hands: legalHands(hand, need, forced),
  };
}

export function enumerateSpace(seed: number, mark: number): DraftSpace {
  const vectors = new Map<string, Ratchets>();
  const rungs: DraftRung[] = [];
  let paths = 0;
  // The rung list is recorded down the FIRST path only. Every rung but a Mark-4
  // forced one is a pure function of (seed, bay, mark), so this is the whole
  // ladder for every Mark the sweep actually flies; where it is not, the DFS
  // below still explores the real hands and only the printed summary is the
  // first path's. Stated rather than silently true.
  let recorded = false;

  const walk = (levelIndex: number, ratchets: Ratchets): void => {
    const rung = rungFor(seed, mark, levelIndex, ratchets);
    if (!rung) {
      if (levelIndex < RUN_LEVELS - 1) {
        // The Final Inspection rung — walk past it, it adds no notches.
        walk(levelIndex + 1, ratchets);
        return;
      }
      paths += 1;
      if (!recorded) recorded = true;
      vectors.set(comboKey(ratchets), ratchets);
      return;
    }
    if (!recorded) rungs.push(rung);
    for (const picks of rung.hands) walk(levelIndex + 1, withPicks(ratchets, picks));
  };
  walk(0, {});
  return { seed, mark, rungs, paths, vectors };
}

/* ---------------------------------------------------------------------------
 * DRAFT POLICIES — how a sampled combo is CHOSEN.
 *
 * A policy is a player, stated as a rule for reading a hand. The sweep does not
 * sample paths uniformly, and the reason is the whole sampling argument: an
 * unwinnable combo is not a random point in the space, it is a CORNER. Pouring
 * every notch into one axis is what finds the cliff; a uniform sample finds the
 * middle of the space, which is where nothing interesting lives.
 *
 * So `winnability.ts` runs the corners EXHAUSTIVELY (one `prefer` policy per
 * axis the Mark deals — a small, complete set) and samples the interior with
 * `spread`, `dodge` and seeded random walks. Every table it prints says which
 * of the two a row came from.
 * ------------------------------------------------------------------------- */

export interface DraftPolicy {
  name: string;
  /** Choose exactly `rung.need` picks from `rung.hands`. Must return one of the
   *  member arrays — the caller asserts it, so a policy cannot invent a combo
   *  the draft would refuse. */
  choose(rung: DraftRung, ratchets: Ratchets): HazardId[];
}

/** Total notches on a stack, ignoring axes absent from it. */
function depth(r: Ratchets, id: HazardId): number {
  return r[id] ?? 0;
}

/** Score a candidate hand for a policy that ranks by axis preference: a hand is
 *  worth the number of seats it gives the preferred axis, then (as a tie-break)
 *  the number of seats it gives whatever the run is already deepest in. */
function preferScore(picks: HazardId[], want: HazardId, ratchets: Ratchets): [number, number] {
  const seats = picks.filter((p) => p === want).length;
  const depthSum = picks.reduce((a, p) => a + depth(ratchets, p), 0);
  return [seats, depthSum];
}

/**
 * "Pour everything into `want`" — the corner policy.
 *
 * Two rules, and the second one is a correction worth its history. Where the
 * preferred axis IS on the table, take every seat it can have — that is the
 * corner. Where it is NOT, fall through to `spreadPolicy`.
 *
 * The first version fell through to the DEEPEST axis already taken, on the
 * argument that spreading "would make the resulting combo a blend wearing an
 * axis's name". Measured at Tier 10, that argument inverted itself: on the
 * FIRST draft of a run every axis sits at zero, so the deepest-axis tie-break
 * is vacuous and every corner policy took `hands[0]` — all ten of them dealt
 * the identical run (`wind:2`, dead at bay 2, ten rows of one measurement). A
 * corner set that collapses to one point covers nothing.
 *
 * Spreading the remainder keeps the ten runs genuinely distinct AND keeps each
 * one a corner where it matters: the preferred axis still takes every seat it
 * is ever offered, and the run's OTHER notches are the flattest background the
 * space allows, which is exactly the contrast an axis's cost should be read
 * against.
 */
export function preferPolicy(want: HazardId): DraftPolicy {
  return {
    name: `max:${want}`,
    choose(rung, ratchets) {
      let best = rung.hands[0];
      let bestScore = preferScore(best, want, ratchets);
      for (const picks of rung.hands) {
        const s = preferScore(picks, want, ratchets);
        if (s[0] > bestScore[0] || (s[0] === bestScore[0] && s[1] > bestScore[1])) {
          best = picks;
          bestScore = s;
        }
      }
      return bestScore[0] > 0 ? best : spreadPolicy.choose(rung, ratchets);
    },
  };
}

/**
 * Spread the run out — the interior of the space, and the closest policy here
 * to `ratchet-model.ts`'s round-robin (which is why the two are worth reading
 * against each other).
 *
 * Shallowest-first, and then — the half that is not decoration — MOST DISTINCT
 * AXES on a tie. At the capstone's two-pick draft every hand of a fresh run
 * ties at depth 0, so a policy that only ranks by depth takes `hands[0]`, which
 * is the first card DOUBLED. Measured at Tier 10 that turned the first draft of
 * every policy in the sweep into the same two notches on one axis, and a
 * "spread" that opens by doubling is not the strategy the name claims.
 */
export const spreadPolicy: DraftPolicy = {
  name: "spread",
  choose(rung, ratchets) {
    let best = rung.hands[0];
    let bestKey: [number, number] = [Infinity, 0];
    for (const picks of rung.hands) {
      const key: [number, number] = [
        picks.reduce((a, p) => a + depth(ratchets, p), 0),
        new Set(picks).size,
      ];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        best = picks;
        bestKey = key;
      }
    }
    return best;
  },
};

/** Refuse materials wherever the hand allows it — the run a player flies when
 *  their rack is empty. On the three forced bays the dodge is gone by
 *  construction, so this policy takes the shallowest material there, which is
 *  the hazards.ts note's own advice ("a player who cannot answer slag puts
 *  every pick on the other one") read as a rule. */
export const dodgePolicy: DraftPolicy = {
  name: "dodge",
  choose(rung, ratchets) {
    const contentCount = (picks: HazardId[]): number =>
      picks.filter((p) => hazardById(p)?.kind === "content").length;
    let best = rung.hands[0];
    let bestKey: [number, number] = [Infinity, Infinity];
    for (const picks of rung.hands) {
      const key: [number, number] = [
        contentCount(picks),
        picks.reduce((a, p) => a + depth(ratchets, p), 0),
      ];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = picks;
        bestKey = key;
      }
    }
    return best;
  },
};

/**
 * A seeded random walk through the space — the interior sampler.
 *
 * `seed` here is the stream, not the policy's published name: `randomSpec`
 * below mixes the run's own seed into it and keeps the name fixed, so a row
 * labelled `random:20973` means one SAMPLER across a table while every run
 * under it draws its own independent walk.
 */
export function randomPolicy(seed: number): DraftPolicy {
  const rng = mulberry32(seed >>> 0);
  return {
    name: `random:${seed}`,
    choose(rung) {
      return rung.hands[Math.floor(rng() * rung.hands.length) % rung.hands.length];
    },
  };
}

/* ---------------------------------------------------------------------------
 * POLICY SPECS — a policy is BUILT PER RUN, and that is a bug fix with a rule
 * behind it.
 *
 * `bots.ts` already states the rule, about itself: "Named presets, each a
 * FACTORY of (seed) -> Bot rather than a built Bot — the runner needs to
 * rebuild a fresh bot (fresh jitter RNG stream) per run so that two runs given
 * the same seed reproduce identically."
 *
 * This file shipped the opposite. `randomPolicy` captured its `rng` in a
 * closure, `policiesFor` built ONE policy object per row, and `sweepCombos`
 * reused that object across every seed, every Final clause and every `--build`
 * order in the row. So the stream carried over: a run's draft choices depended
 * on how many drafts all the runs before it happened to reach. Reproduced on
 * review — the same Mark-5 seed and options, one `random:20973`, gave
 * `cryo:1 time:1` and then `cryo:1 rebar:1 time:1`.
 *
 * Two things were broken by that, and the second is the one that would have
 * been hardest to notice:
 *
 *  - **Identical seeds stopped reproducing**, which is the assumption every
 *    other tool here rests on (`sweep.ts` runs one combination twice at
 *    startup and diffs it byte-for-byte precisely to keep that assumption
 *    honest).
 *  - **The best-build comparison stopped being paired.** `sweepCombos` picks
 *    the best of the named `--build` orders per row; with a carried stream the
 *    second build was flown on different draft choices from the first, so the
 *    comparison was between two different runs rather than two rigs.
 *
 * A spec is the fix and the shape `bots.ts` already uses: a name for the table,
 * and a `build(runSeed)` the driver calls once per run. The stateless policies
 * ignore the seed; the sampler mixes it into its stream.
 * ------------------------------------------------------------------------- */

export interface DraftPolicySpec {
  /** The row's published name — stable across seeds and builds, so a table
   *  groups by it. */
  name: string;
  /** The policy for ONE run. Called per run, never cached. */
  build(runSeed: number): DraftPolicy;
}

export const preferSpec = (want: HazardId): DraftPolicySpec =>
  ({ name: `max:${want}`, build: () => preferPolicy(want) });
export const spreadSpec: DraftPolicySpec = { name: "spread", build: () => spreadPolicy };
export const dodgeSpec: DraftPolicySpec = { name: "dodge", build: () => dodgePolicy };

/** The interior sampler, re-streamed per run. The mix is the same shape
 *  `hazards.ts` uses to keep two seeded draws from correlating — a run seed
 *  scattered by a large odd constant, then xored — so run 2's walk is
 *  independent of run 1's rather than a continuation of it. */
export function randomSpec(policySeed: number): DraftPolicySpec {
  return {
    name: `random:${policySeed}`,
    build: (runSeed) =>
      randomPolicy((policySeed ^ Math.imul(runSeed || 1, 0x9e3779b1)) >>> 0),
  };
}

/** Seeded PRNG — the same generator `hazards.ts` and `mods.ts` use, duplicated
 *  here for the same reason `hazards.ts` duplicates it from `mods.ts`: a
 *  sampler that shared a stream with the draft would correlate which combo is
 *  sampled with which hand was dealt. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
