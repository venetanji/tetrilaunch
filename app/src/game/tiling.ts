/**
 * TILING — can this exact set of shipments actually fill these rows?
 *
 * Only PATTERN Contracts need this (contracts.ts). Their whole premise is a
 * zero-waste inventory: the queue holds precisely the cubes the goal needs and
 * not one more, so every launched cube has to end up inside a completed row.
 *
 * That makes the goal a rectangle. A row clears only when every slot from the
 * wall out to the compaction zone's width holds exactly one settled, aligned
 * cube (lineClear.ts's updateLineClear), and at full advance that width is
 * `compactorMinLineCells` = 8. So a `goal`-line pattern Contract is asking the
 * player to fill a goal x 8 rectangle, exactly, with the pieces it hands them.
 *
 * The generator used to assume this needed no proof, on the grounds that the
 * compactor shatters whatever it presses (pieces.ts's breakJointsInBand), so
 * shapes dissolve into loose cubes and geometry stops mattering. Shattering is
 * real, but it does not buy that: it lets a piece's cubes separate, it never
 * moves a cube sideways under an overhang or conjures one to fill a hole. The
 * counting constraint survives it untouched. What that assumption actually
 * produced was unplayable Contracts — [I, O, J, J] for two lines, which no
 * arrangement tiles, and [I, I, I, T, S, Z] for three, likewise.
 *
 * So piece geometry is now a hard constraint on what the generator may emit,
 * and `tilingQueue` builds the inventory FROM a tiling rather than rolling one
 * and hoping. `tilesRegion` is the independent checker the tests assert with.
 *
 * What this does NOT claim: that a tiling is reachable through the physics. The
 * cannon, the wind and the order the queue arrives in all sit between a valid
 * arrangement and a landed one. This rules out the impossible; it does not
 * promise the easy.
 */
import { PIECE_SHAPES, type PieceType } from "./theme";

export type Cell = readonly [number, number];

/** Row-major order: top row first, then left to right. The solver relies on
 *  this — see the anchoring note in `search`. */
function normalize(cells: Cell[]): Cell[] {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells
    .map(([x, y]) => [x - minX, y - minY] as Cell)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function rotateCW(cells: Cell[]): Cell[] {
  return normalize(cells.map(([x, y]) => [-y, x] as Cell));
}

/**
 * The distinct orientations of each tetromino, derived from PIECE_SHAPES rather
 * than written out again — the shapes are shared with the renderer and the
 * physics spawner, and a second hand-maintained copy would drift.
 *
 * Pieces rotate freely in flight, so all four quarter-turns are legal; the
 * de-duplication is only to stop the solver exploring O four times over.
 */
export const ORIENTATIONS: Record<PieceType, Cell[][]> = (() => {
  const out = {} as Record<PieceType, Cell[][]>;
  for (const type of Object.keys(PIECE_SHAPES) as PieceType[]) {
    const seen: Cell[][] = [];
    let cells = normalize(PIECE_SHAPES[type]);
    for (let i = 0; i < 4; i++) {
      const key = JSON.stringify(cells);
      if (!seen.some((s) => JSON.stringify(s) === key)) seen.push(cells);
      cells = rotateCW(cells);
    }
    out[type] = seen;
  }
  return out;
})();

/**
 * Ceiling on solver nodes. A goal x 8 region is at most 32 cells, so a real
 * answer is found in well under a thousand nodes; this only exists so a
 * pathological pool (S and Z tile no rectangle at all, and searches around them
 * thrash) can never hang a launch. Exhausting it is reported as "no tiling",
 * which is the safe direction: the generator falls back rather than shipping an
 * unproven queue.
 */
const NODE_BUDGET = 200_000;

/** Where the solver draws pieces from. The two callers differ only here: the
 *  checker has a finite multiset to spend, the generator an unlimited pool. */
interface Supply {
  /** Types worth trying at this node, in the order to try them. */
  available(): PieceType[];
  take(type: PieceType): void;
  give(type: PieceType): void;
}

function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Fill `grid` completely, appending each placed type to `placed`.
 *
 * Anchoring: the target is always the FIRST empty cell in row-major order, and
 * the piece is positioned so its own row-major-first cell lands there. That
 * loses no solutions — every cell before the target is already filled, so
 * whichever piece covers the target must be covering it with its first cell —
 * and it collapses the branching factor from "every position" to "every
 * orientation", which is what keeps the search trivial at this size.
 *
 * `rng`, when given, shuffles the type and orientation order so repeated calls
 * on the same region produce different tilings; without it the walk is
 * deterministic, which is what the checker wants.
 */
function search(
  grid: Uint8Array,
  rows: number,
  cols: number,
  remaining: number,
  supply: Supply,
  placed: PieceType[],
  budget: { nodes: number },
  rng?: () => number,
): boolean {
  if (remaining === 0) return true;
  if (budget.nodes++ > NODE_BUDGET) return false;

  const target = grid.indexOf(0);
  const ty = Math.floor(target / cols);
  const tx = target % cols;

  for (const type of supply.available()) {
    const orientations = rng ? shuffled(ORIENTATIONS[type], rng) : ORIENTATIONS[type];
    for (const cells of orientations) {
      const [ax, ay] = cells[0];
      const covered: number[] = [];
      let fits = true;
      for (const [cx, cy] of cells) {
        const gx = tx + cx - ax;
        const gy = ty + cy - ay;
        if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) {
          fits = false;
          break;
        }
        const at = gy * cols + gx;
        if (grid[at]) {
          fits = false;
          break;
        }
        covered.push(at);
      }
      if (!fits) continue;

      for (const at of covered) grid[at] = 1;
      supply.take(type);
      placed.push(type);
      if (search(grid, rows, cols, remaining - cells.length, supply, placed, budget, rng)) {
        return true;
      }
      placed.pop();
      supply.give(type);
      for (const at of covered) grid[at] = 0;
    }
  }
  return false;
}

const CUBES_PER_PIECE = 4;

/**
 * True when this exact multiset of tetrominoes tiles a `rows` x `cols`
 * rectangle with no gaps and nothing left over.
 *
 * Independent of `tilingQueue` on purpose: the generator's guarantee is worth
 * something only if the test re-derives it by a different route than the one
 * that built the answer.
 */
export function tilesRegion(queue: readonly PieceType[], rows: number, cols: number): boolean {
  if (queue.length * CUBES_PER_PIECE !== rows * cols) return false;

  const counts = new Map<PieceType, number>();
  for (const type of queue) counts.set(type, (counts.get(type) ?? 0) + 1);

  const supply: Supply = {
    available: () => [...counts.keys()].filter((t) => (counts.get(t) ?? 0) > 0),
    take: (t) => counts.set(t, counts.get(t)! - 1),
    give: (t) => counts.set(t, counts.get(t)! + 1),
  };

  return search(
    new Uint8Array(rows * cols),
    rows,
    cols,
    rows * cols,
    supply,
    [],
    { nodes: 0 },
  );
}

/** Attempts to spend chasing a tiling that uses EXACTLY `maxDistinct` types
 *  before settling for one that came in under. Small on purpose: the cap is a
 *  difficulty dial, and one shipment type fewer than intended is a slightly
 *  easier Contract, not a broken one. */
const EXACT_ATTEMPTS = 6;

/**
 * An inventory that provably tiles a `rows` x `cols` rectangle, drawn from
 * `pool` and using at most `maxDistinct` different shipment types. Returns the
 * pieces in placement order, or null if the region cannot be tiled under those
 * constraints.
 *
 * `maxDistinct` IS the difficulty ladder for a pattern Contract. Four O
 * shipments that make two rows is a puzzle you can see whole; the same two rows
 * from four different shapes has to be planned. That reads as difficulty in a
 * way "which types are in the pool" never quite did, because it scales the
 * thinking rather than the piece-by-piece delivery risk — the right axis for a
 * mode whose premise is planning.
 *
 * Null is reachable in principle — a pool of only S and Z tiles no rectangle —
 * but not from the pools the generator actually uses, since every tier's pool
 * contains I, `cols` is 8, and a stack of horizontal I pieces tiles any height.
 * Callers still handle it rather than assert it: the cost of being wrong is an
 * unwinnable Contract, which is the one failure this module exists to prevent.
 */
export function tilingQueue(
  rows: number,
  cols: number,
  pool: readonly PieceType[],
  rng: () => number,
  maxDistinct = pool.length,
): PieceType[] | null {
  const cap = Math.max(1, Math.min(maxDistinct, pool.length));

  // A tiling under the cap, preferring one that actually spends it. The cap is
  // a ceiling, not a quota — the solver reaches a full region by whatever route
  // it finds first, and on a small region that route often repeats a type it
  // has already placed. Retrying costs a handful of trivial searches and turns
  // "at most N shapes" into "N shapes" most of the time.
  let best: PieceType[] | null = null;
  let bestDistinct = 0;

  for (let attempt = 0; attempt < EXACT_ATTEMPTS; attempt++) {
    // Counts, not a plain set: `give` must only retire a type once the LAST
    // placement of it is undone, or backtracking would free a cap slot that is
    // still occupied and let the search exceed `cap`.
    const used = new Map<PieceType, number>();
    const supply: Supply = {
      available: () =>
        shuffled(used.size >= cap ? [...used.keys()] : pool, rng),
      take: (t) => used.set(t, (used.get(t) ?? 0) + 1),
      give: (t) => {
        const n = used.get(t)! - 1;
        if (n > 0) used.set(t, n);
        else used.delete(t);
      },
    };

    const placed: PieceType[] = [];
    const ok = search(
      new Uint8Array(rows * cols),
      rows,
      cols,
      rows * cols,
      supply,
      placed,
      { nodes: 0 },
      rng,
    );
    if (!ok) continue;

    const distinct = new Set(placed).size;
    if (distinct > bestDistinct) {
      best = placed;
      bestDistinct = distinct;
    }
    if (distinct === cap) break;
  }

  return best;
}
