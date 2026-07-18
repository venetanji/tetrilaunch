// Naive "player" stand-ins for the sim harness. Each bot is a pure function
// of the Game's public state (cannon/score/level) — no lookahead, no
// trajectory-aware targeting. The point is to answer "does just aiming at
// roughly the field middle and holding the trigger clear the early bays?",
// not to build a strong AI.
import type { Game } from "../src/game/game";
import { mulberry32 } from "../src/game/mods";
import { SPEED_MIN, SPEED_MAX } from "../src/game/cannon";
import type { PieceType } from "../src/game/theme";

export interface Bot {
  name: string;
  act(g: Game, now: number): void;
}

/** ±60° — matches the cannon's own drag-aim clamp (see cannon.ts's
 *  aimFromDrag: Math.PI / 3 either side of straight ahead). */
const MAX_ANGLE_RAD = Math.PI / 3;

/**
 * Quarter-turn count (0-3) that lays each piece FLAT — minimizes its
 * rotated bounding-box HEIGHT. Derivation: pieceOffsets (pieces.ts) rotates
 * each cube's centroid-relative (x, y) offset by a plain rotation matrix; a
 * 90° turn maps (x, y) -> (-y, x). Bounding-box extents only look at
 * min/max per axis, so a 90° turn just SWAPS a piece's bounding-box width
 * and height — signs don't matter. That means every piece has exactly two
 * distinct bounding boxes across its 4 orientations (turns 0/2 share one,
 * turns 1/3 share its transpose), so only "0 or 1" ever needs choosing here.
 * Per type, extents at turn 0 read straight off PIECE_SHAPES (theme.ts),
 * counting grid cells (col, row):
 *   I: cols 0-3, rows 0-0  -> 4 wide x 1 tall at turn 0. Already flattest.
 *   O: cols 0-1, rows 0-1  -> 2x2 square; rotation never changes height.
 *   T: cols 0-2, rows 0-1  -> 3 wide x 2 tall at 0, vs. 2 wide x 3 tall at 1.
 *      0 is flatter.
 *   L: cols 0-1, rows 0-2  -> 2 wide x 3 tall at 0, vs. 3 wide x 2 tall at 1.
 *      1 is flatter.
 *   J: cols 0-1, rows 0-2  -> same footprint as L (mirrored) -> 1 is flatter.
 *   S: cols 0-2, rows 0-1  -> 3 wide x 2 tall at 0, vs. 2 wide x 3 tall at 1.
 *      0 is flatter.
 *   Z: cols 0-2, rows 0-1  -> same as S -> 0 is flatter.
 */
const MIN_HEIGHT_TURNS: Record<PieceType, number> = {
  I: 0,
  O: 0,
  T: 0,
  L: 1,
  J: 1,
  S: 0,
  Z: 0,
};

/**
 * The deliberately-bad "stand it on end" rotation — maximizes bounding-box
 * height instead. Since every piece only has two distinct heights (see
 * MIN_HEIGHT_TURNS above), this is just "the other one": 1 wherever
 * MIN_HEIGHT_TURNS is 0, and 0 wherever it's 1. O has no "other one" (a
 * square's height is rotation-invariant), so it stays 0 for both tables.
 */
const MAX_HEIGHT_TURNS: Record<PieceType, number> = {
  I: 1,
  O: 0,
  T: 1,
  L: 0,
  J: 0,
  S: 1,
  Z: 1,
};

export interface FixedAimOpts {
  /** Uniform jitter half-width applied to the aim angle, in degrees. */
  jitterDeg?: number;
  /** Uniform jitter half-width applied to power, in px/step. */
  jitterPower?: number;
  /** If true, roll a random 0-3 quarter-turn spin on the loaded piece before
   *  every shot (approximates a player who bothers to rotate). */
  rotate?: boolean;
  /** If set, instead of a random spin, rotate the loaded piece to the
   *  quarter-turn orientation that minimizes ("min-height") or maximizes
   *  ("max-height") its bounding-box height — see MIN_HEIGHT_TURNS /
   *  MAX_HEIGHT_TURNS above. Mutually exclusive with `rotate` in practice
   *  (this takes priority if both are set, since it fully determines the
   *  rotation deterministically). */
  rotationStrategy?: "min-height" | "max-height";
  /** Seed for the bot's own jitter/rotation RNG stream — pass a fresh seed
   *  per run to get an independent, reproducible sequence of "misses". */
  seed?: number;
}

/**
 * A bot that always aims at the same base angle/power, with optional bounded
 * jitter (a rough model of a human's imprecise re-aim between shots) and an
 * optional random quarter-turn spin. Fires whenever the cannon is off
 * cooldown and funds cover the shot.
 */
export function fixedAimBot(
  name: string,
  angleDeg: number,
  power: number,
  opts: FixedAimOpts = {},
): Bot {
  const { jitterDeg = 0, jitterPower = 0, rotate = false, rotationStrategy, seed = 1 } = opts;
  const rng = mulberry32(seed);
  const baseAngleRad = (angleDeg * Math.PI) / 180;

  return {
    name,
    act(g, now) {
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      // Symmetric jitter: rng() is [0,1) -> remap to [-1, 1) before scaling.
      const jAngleRad = (rng() * 2 - 1) * ((jitterDeg * Math.PI) / 180);
      const jPower = (rng() * 2 - 1) * jitterPower;

      const angle = Math.max(
        -MAX_ANGLE_RAD,
        Math.min(MAX_ANGLE_RAD, baseAngleRad + jAngleRad),
      );
      const pw = Math.max(SPEED_MIN, Math.min(SPEED_MAX, power + jPower));

      g.cannon.angle = angle;
      g.cannon.power = pw;

      if (rotationStrategy) {
        // Deterministic target orientation for whatever piece is currently
        // loaded (cannon.currentType) — no RNG consumed, so this doesn't
        // perturb the jitter stream's reproducibility.
        const table = rotationStrategy === "min-height" ? MIN_HEIGHT_TURNS : MAX_HEIGHT_TURNS;
        const target = table[g.cannon.currentType];
        // markShot resets pieceRotation to 0 after every real shot, but a
        // bomb shot (markCooldown only) leaves it untouched — so rather than
        // assume we're starting from 0, read the cannon's actual current
        // orientation and turn forward just far enough to reach the target.
        const current = g.cannon.quarterTurns;
        const turns = (target - current + 4) % 4;
        for (let i = 0; i < turns; i++) g.cannon.rotateRight();
      } else if (rotate) {
        // 0-3 quarter turns covers every reachable orientation; direction
        // doesn't matter (rotateRight x0..3 reaches all 4 states), so we
        // always turn the same way for simplicity.
        const turns = Math.floor(rng() * 4);
        for (let i = 0; i < turns; i++) g.cannon.rotateRight();
      }

      g.shoot(now);
    },
  };
}

/**
 * A fully random "button masher": every time the cannon is off cooldown and
 * funds cover the shot, pick a uniformly random angle within [angleMinDeg,
 * angleMaxDeg], a uniformly random power within [SPEED_MIN, SPEED_MAX], spin
 * a random 0-3 quarter-turn rotation, and fire. No aim model at all — the
 * point is a robustness floor ("does anything beat pure noise") rather than
 * a plausible player.
 */
function randomAimBot(name: string, angleMinDeg: number, angleMaxDeg: number, seed = 1): Bot {
  const rng = mulberry32(seed);
  const minRad = (angleMinDeg * Math.PI) / 180;
  const maxRad = (angleMaxDeg * Math.PI) / 180;

  return {
    name,
    act(g, now) {
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      g.cannon.angle = minRad + rng() * (maxRad - minRad);
      g.cannon.power = SPEED_MIN + rng() * (SPEED_MAX - SPEED_MIN);

      const turns = Math.floor(rng() * 4);
      for (let i = 0; i < turns; i++) g.cannon.rotateRight();

      g.shoot(now);
    },
  };
}

/**
 * Named presets, each a FACTORY of (seed) -> Bot rather than a built Bot —
 * the runner needs to rebuild a fresh bot (fresh jitter RNG stream) per run
 * so that two runs given the same seed reproduce identically, and two runs
 * with different seeds sample independent "miss" sequences. The literal
 * fixedAimBot(...) call for each preset is exactly what running that preset
 * at a given seed means; `seed` is threaded in at build time.
 */
export const BOTS: Record<string, (seed: number) => Bot> = {
  // Approximates a player dragging back and firing toward the field middle.
  middle: (seed) => fixedAimBot("middle", 20, 19, { jitterDeg: 3, jitterPower: 1.5, seed }),
  // High, soft arc toward the back of the bay.
  lob: (seed) => fixedAimBot("lob", 35, 25, { jitterDeg: 2, jitterPower: 1, seed }),
  // Low, flat, fast shot.
  flat: (seed) => fixedAimBot("flat", 8, 22, { jitterDeg: 3, jitterPower: 1.5, seed }),
  // Same arc as `lob`, but also spins the piece before firing.
  "lob-rot": (seed) =>
    fixedAimBot("lob-rot", 35, 25, { jitterDeg: 2, jitterPower: 1, rotate: true, seed }),
  // Same arc as `lob`, but always rotates the loaded piece to its
  // minimal-height (flattest) orientation before firing — the deliberately
  // GOOD rotation strategy, for measuring the best case.
  "lob-flat": (seed) =>
    fixedAimBot("lob-flat", 35, 25, {
      jitterDeg: 2,
      jitterPower: 1,
      rotationStrategy: "min-height",
      seed,
    }),
  // Same arc as `lob`, but always rotates the loaded piece to its
  // maximal-height (standing on end) orientation before firing — the
  // deliberately BAD rotation strategy, for measuring the worst case.
  "lob-tall": (seed) =>
    fixedAimBot("lob-tall", 35, 25, {
      jitterDeg: 2,
      jitterPower: 1,
      rotationStrategy: "max-height",
      seed,
    }),
  // Fully random button-masher: uniform angle across the whole cannon cone
  // [-60°, +60°], uniform power, random rotation. A robustness floor — real
  // presets should always beat this.
  random: (seed) => randomAimBot("random", -60, 60, seed),
  // Same as `random`, but restricted to the upward half of the cone
  // [0°, +60°] — a random player who at least remembers to aim up. The
  // harder "random should never win" case.
  "random-up": (seed) => randomAimBot("random-up", 0, 60, seed),
};
