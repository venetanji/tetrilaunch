/**
 * BUILDABLE — can this exact queue actually be BUILT, in the order it arrives?
 *
 * tiling.ts answers a weaker question. It proves the multiset PACKS the goal
 * rectangle: that there exists some arrangement of these pieces with no gaps and
 * nothing left over. That is necessary, and it is what stopped the generator
 * shipping [I, O, J, J] for two lines. It is not sufficient, and the gap between
 * the two is where a zero-waste Contract still dies.
 *
 * What a packing ignores is that the player does not place the pieces; the belt
 * does. Shipments arrive ONE AT A TIME, in a fixed order, into a bay with
 * gravity and a compactor that clears a row the instant it fills. A packing can
 * demand that a cube sit under an overhang that the piece filling it arrives too
 * late to reach — or that a row NOT clear until three pieces later, when it in
 * fact clears the moment its eighth slot lands and drops everything above it.
 *
 * Concretely, the tier-5 board on 2026-08-22 dealt [I, I, L, L, L, J] for three
 * lines. It packs — tiling.ts is right about that — but of its 60 arrival
 * orders, 18 cannot be finished by a player who lands each shipment straight
 * down, and the canonical order the card advertises is one of them. That reads
 * to the player as exactly what they reported it as: impossible.
 *
 * So this module models the bay's actual constraints:
 *
 *   - pieces are consumed in queue order, one per shipment;
 *   - a piece comes to rest when it lands (nothing floats);
 *   - a row clears the instant all `cols` slots are filled, and what was above
 *     it falls by one;
 *   - the run succeeds only if the field ends EMPTY — that is what zero waste
 *     means, restated as a terminal condition rather than a cube count.
 *
 * Two readings of "comes to rest", because the bay is neither a Tetris well nor
 * a free placement puzzle:
 *
 *   "drop"  — the piece falls straight down onto the first thing it touches.
 *             The strict reading. It is how a player REASONS about the bay, and
 *             a Contract that fails it looks impossible even where it isn't.
 *   "tuck"  — the piece may come to rest in any pocket it fits, so long as
 *             something is under it. The generous reading, and the honest upper
 *             bound on this game's physics: shipments arrive on an arc, tumble,
 *             shatter on the press (pieces.ts's breakJointsInBand) and get shoved
 *             sideways toward the wall by the bar, all of which put cubes in
 *             places a straight drop never reaches.
 *
 * Neither is the physics. `drop` under-promises and `tuck` over-promises, and
 * the truth is between them — which is exactly why the generator PREFERS a drop
 * order and settles for a tuck one (see contracts.ts's dealPatternQueue) rather
 * than treating either as the definition of fair.
 */
import { SIZE_SPEC } from "./pieces";
import { ORIENTATIONS } from "./tiling";
import type { PieceSize, PieceType } from "./theme";

/** How a landed shipment is allowed to come to rest — see the header. */
export type BuildModel = "drop" | "tuck";

/** Field state: one bitmask per row, index 0 = FLOOR, empty top rows trimmed.
 *  Trimming is what makes two boards that differ only in headroom compare
 *  equal, which is the whole basis of the deduplication below. */
type Field = readonly number[];

/**
 * Orientations with y measured UPWARD from the floor.
 *
 * tiling.ts builds its tables row-major from the top, because it fills a
 * rectangle from the top-left corner and never asks which way is down. Here
 * down is the whole point, so the same tables are flipped once and cached
 * rather than re-derived per call.
 */
const UPRIGHT = new Map<string, ReadonlyArray<ReadonlyArray<readonly [number, number]>>>();
function orientations(
  type: PieceType, size: PieceSize,
): ReadonlyArray<ReadonlyArray<readonly [number, number]>> {
  const key = `${size}:${type}`;
  let hit = UPRIGHT.get(key);
  if (!hit) {
    hit = ORIENTATIONS[size][type].map((cells) => {
      const top = Math.max(...cells.map(([, y]) => y));
      return cells.map(([x, y]) => [x, top - y] as const);
    });
    UPRIGHT.set(key, hit);
  }
  return hit;
}

/** Row masks after adding `cells` at (ox, oy) and clearing whatever filled. */
function settle(
  f: Field, cols: number, cells: ReadonlyArray<readonly [number, number]>, ox: number, oy: number,
): number[] {
  const FULL = (1 << cols) - 1;
  const next = [...f];
  for (const [cx, cy] of cells) {
    while (next.length <= oy + cy) next.push(0);
    next[oy + cy] |= 1 << (ox + cx);
  }
  const kept = next.filter((row) => row !== FULL);
  while (kept.length > 0 && kept[kept.length - 1] === 0) kept.pop();
  return kept;
}

/** Every resting position for one orientation, under `model`. */
function restingSpots(
  f: Field, cols: number, height: number,
  cells: ReadonlyArray<readonly [number, number]>, model: BuildModel,
): Array<readonly [number, number]> {
  const width = Math.max(...cells.map(([x]) => x)) + 1;
  const top = Math.max(...cells.map(([, y]) => y));
  const filled = (x: number, y: number) => (y < f.length ? (f[y] >> x) & 1 : 0);
  const spots: Array<readonly [number, number]> = [];

  for (let ox = 0; ox + width <= cols; ox++) {
    if (model === "drop") {
      // Rest on the highest column the piece spans, offset by the piece's own
      // profile — the standard hard drop, and the only landing a player can
      // aim for without threading the shipment under something.
      let oy = 0;
      for (const [cx, cy] of cells) {
        let column = 0;
        for (let y = f.length - 1; y >= 0; y--) {
          if ((f[y] >> (ox + cx)) & 1) { column = y + 1; break; }
        }
        oy = Math.max(oy, column - cy);
      }
      if (oy + top < height) spots.push([ox, oy] as const);
      continue;
    }

    for (let oy = 0; oy + top < height; oy++) {
      let fits = true;
      for (const [cx, cy] of cells) {
        if (filled(ox + cx, oy + cy)) { fits = false; break; }
      }
      if (!fits) continue;
      // Resting means SOME cell of the piece has the floor or a settled cube
      // directly beneath it. A cell sitting on another cell of the same piece
      // is not support — that is the piece holding itself up.
      const own = new Set(cells.map(([cx, cy]) => (oy + cy) * cols + ox + cx));
      const rests = cells.some(([cx, cy]) => {
        const by = oy + cy - 1;
        if (by < 0) return true;
        if (own.has(by * cols + ox + cx)) return false;
        return filled(ox + cx, by) === 1;
      });
      if (rests) spots.push([ox, oy] as const);
    }
  }
  return spots;
}

/** A cell left empty with something above it. In "drop" it is fatal — nothing
 *  falling straight down can ever reach it — so a board carrying one is dead
 *  and the search can stop rather than explore its whole subtree. */
function hasCoveredHole(f: Field, cols: number): boolean {
  for (let x = 0; x < cols; x++) {
    let roofed = false;
    for (let y = f.length - 1; y >= 0; y--) {
      if ((f[y] >> x) & 1) roofed = true;
      else if (roofed) return true;
    }
  }
  return false;
}

/**
 * How ragged a board's surface is: its height plus the total step between
 * neighbouring columns. Pure move-ordering heuristic — it never rejects a
 * landing, only decides which to try first — so a bad score costs search time
 * and nothing else.
 */
function roughness(f: Field, cols: number): number {
  const h: number[] = [];
  for (let x = 0; x < cols; x++) {
    let top = 0;
    for (let y = f.length - 1; y >= 0; y--) {
      if ((f[y] >> x) & 1) { top = y + 1; break; }
    }
    h.push(top);
  }
  let bumps = 0;
  for (let x = 1; x < cols; x++) bumps += Math.abs(h[x] - h[x - 1]);
  return f.length * cols + bumps;
}

/** Cubes currently on the field. */
function cubeCount(f: Field, cols: number): number {
  let n = 0;
  for (const row of f) for (let x = 0; x < cols; x++) n += (row >> x) & 1;
  return n;
}

/**
 * Boards still alive after one more shipment of `type`, deduplicated.
 *
 * `piecesLeft` counts what follows this one, which is what bounds how tall the
 * pile may legally stand: every cube has to end inside a cleared row, so a pile
 * taller than the rows the queue can still complete is already waste.
 */
function advance(
  boards: Map<string, Field>, type: PieceType, cols: number, size: PieceSize,
  model: BuildModel, piecesLeft: number, standingCubes = 0,
): Map<string, Field> {
  const cubes = SIZE_SPEC[size].cubes;
  const left = piecesLeft * cubes;
  const height = Math.ceil((left + cubes + standingCubes) / cols) + SIZE_SPEC[size].cubes;
  const out = new Map<string, Field>();
  for (const f of boards.values()) {
    for (const cells of orientations(type, size)) {
      for (const [ox, oy] of restingSpots(f, cols, height, cells, model)) {
        const next = settle(f, cols, cells, ox, oy);
        if (model === "drop" && hasCoveredHole(next, cols)) continue;
        if (next.length > (cubeCount(next, cols) + left) / cols) continue;
        out.set(next.join(","), next);
      }
    }
  }
  return out;
}

/**
 * The field a bay OPENS on: a salvage wall already standing in the goal region.
 *
 * `standing[x]` is how many cells of column x are occupied, counted up from the
 * floor — the same profile tiling.ts's `prefilled` takes, in this module's
 * floor-up row order rather than that one's top-down one.
 *
 * Zero waste still means the field ends EMPTY, which is what makes a standing
 * wall an interesting opening rather than a handicap: those cubes are not spare,
 * they are cubes the queue is short by, and every one of them has to end up
 * inside a completed row too.
 */
function opening(cols: number, standing: readonly number[]): Field {
  const rows = Math.max(0, ...standing.map((h) => Math.max(0, h)));
  const f: number[] = Array.from({ length: rows }, () => 0);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < Math.max(0, standing[x] ?? 0); y++) f[y] |= 1 << x;
  }
  while (f.length > 0 && f[f.length - 1] === 0) f.pop();
  return f;
}

/**
 * Can this queue be played to a completely empty field, in exactly this order?
 *
 * Breadth-first over deduplicated boards rather than depth-first over move
 * sequences. Two boards reached by different openings pose the identical
 * remaining problem, and a depth-first walk re-solves each of them; collapsing
 * them makes the question exactly answerable at these sizes instead of
 * budget-limited, which matters because "we ran out of search" and "there is no
 * way to finish" must never be the same answer on a feasibility check.
 *
 * Independent of `buildOrder` below on purpose — the same reason tiling.ts's
 * `tilesRegion` is independent of `tilingQueue`. A guarantee re-derived by the
 * code that produced it only proves the copy agrees with itself.
 */
export function isBuildable(
  queue: readonly PieceType[], cols: number, size: PieceSize = "std",
  model: BuildModel = "drop", standing: readonly number[] = [],
): boolean {
  const start = opening(cols, standing);
  const standingCubes = cubeCount(start, cols);
  if (queue.length === 0) return standingCubes === 0;
  if ((queue.length * SIZE_SPEC[size].cubes + standingCubes) % cols !== 0) return false;
  let boards = new Map<string, Field>([[start.join(","), start]]);
  for (let i = 0; i < queue.length; i++) {
    boards = advance(boards, queue[i], cols, size, model, queue.length - 1 - i, standingCubes);
    if (boards.size === 0) return false;
  }
  return boards.has("");
}

/**
 * Search ceiling per attempt, in expanded boards, and how many independent
 * attempts to make — per model, because a tuck node costs about 25x a drop one.
 *
 * Split into repeated short walks rather than spent as one long one, because
 * the failures are not "no order exists" — they are one unlucky opening
 * explored to exhaustion. Measured on the seven eight-shipment inventories a
 * single 40,000-board walk could not solve: all seven fall to a re-run with
 * fresh randomization. A budget that big buys one sample of a distribution
 * where roughly every other sample succeeds, which is the worst possible way to
 * spend it.
 *
 * Tuck gets a much smaller one. It enumerates every pocket on the board rather
 * than one landing per column, so the same node count costs 25x the wall clock
 * — and since the move ordering landed, the drop search has not failed once
 * across all 624 inventories this generator can emit. Tuck is the safety net
 * under a path nothing currently takes, and a safety net is not worth three
 * seconds of a bay start.
 *
 * Exhausting every attempt reports "no order found", which is the safe
 * direction: the caller falls back rather than dealing an unproven queue.
 */
const ORDER_BUDGET: Record<BuildModel, number> = { drop: 8_000, tuck: 600 };
const ORDER_ATTEMPTS: Record<BuildModel, number> = { drop: 6, tuck: 3 };

function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * An arrival order for `queue` that is provably finishable, or null.
 *
 * Searching for the ORDER and the placements together, rather than shuffling
 * and re-checking, is what keeps this affordable at bay start: a re-check costs
 * a full solve per candidate order and most of that work is the same opening
 * over and over, while this pays for each opening once. The randomization is
 * what keeps it from handing back the same order every attempt — the whole
 * reason contracts.ts re-rolls the order per attempt is that a fixed one would
 * make a bad roll permanent, and a deterministic solver would quietly restore
 * exactly that.
 *
 * Returns the multiset in a playable order, so the caller can use it verbatim.
 */
export function buildOrder(
  queue: readonly PieceType[], cols: number, rng: () => number,
  size: PieceSize = "std", model: BuildModel = "drop",
  standing: readonly number[] = [],
): PieceType[] | null {
  const start = opening(cols, standing);
  const standingCubes = cubeCount(start, cols);
  if (queue.length === 0) return standingCubes === 0 ? [] : null;
  const cubes = SIZE_SPEC[size].cubes;
  if ((queue.length * cubes + standingCubes) % cols !== 0) return null;

  const height = Math.ceil((queue.length * cubes + standingCubes) / cols) + cubes;

  const counts = new Map<PieceType, number>();
  let dead = new Set<string>();
  let budget = 0;
  const order: PieceType[] = [];

  function walk(f: Field, left: number): boolean {
    if (left === 0) return f.length === 0;
    if (budget-- <= 0) return false;
    const key = `${left}|${f.join(",")}`;
    if (dead.has(key)) return false;

    const remainingCubes = (left - 1) * cubes;
    // `cubeCount(next) + remainingCubes` below already includes the standing
    // wall — it is on the board from the first node — so nothing extra is
    // needed here. Named for the reader who checks.
    for (const type of shuffle([...counts.keys()], rng)) {
      const n = counts.get(type)!;
      if (n <= 0) continue;
      counts.set(type, n - 1);
      order.push(type);
      const moves: Array<{ next: number[]; score: number }> = [];
      for (const cells of orientations(type, size)) {
        for (const [ox, oy] of restingSpots(f, cols, height, cells, model)) {
          const next = settle(f, cols, cells, ox, oy);
          if (model === "drop" && hasCoveredHole(next, cols)) continue;
          if (next.length > (cubeCount(next, cols) + remainingCubes) / cols) continue;
          moves.push({ next, score: roughness(next, cols) });
        }
      }
      // Flattest board first. Zero waste has exactly one shape of solution —
      // rows filling from the floor up with nothing stranded — so a landing that
      // leaves the surface ragged is nearly always the wrong one, and trying
      // those last is the difference between an order found in milliseconds and
      // one the budget never reaches. Measured on the eight-shipment queues that
      // used to exhaust six full walks: worst case 3558ms to 121ms.
      //
      // Shuffled BEFORE the sort, and sorted stably, so equally flat landings
      // stay randomly ordered — the ordering is a heuristic about which branch
      // to try first, and it must not quietly collapse the variety the caller
      // re-rolls the deal to get.
      for (const move of shuffle(moves, rng).sort((a, b) => a.score - b.score)) {
        if (walk(move.next, left - 1)) return true;
      }
      order.pop();
      counts.set(type, n);
    }
    dead.add(key);
    return false;
  }

  for (let attempt = 0; attempt < ORDER_ATTEMPTS[model]; attempt++) {
    counts.clear();
    for (const t of queue) counts.set(t, (counts.get(t) ?? 0) + 1);
    // A fresh memo per attempt, not a shared one. The point of retrying is a
    // different random walk; carrying the previous walk's dead boards forward
    // would prune the new walk down the old one's path and make the attempts
    // correlated, which is the one thing they must not be.
    dead = new Set<string>();
    budget = ORDER_BUDGET[model];
    order.length = 0;
    if (walk(start, queue.length)) return order;
  }
  return null;
}
