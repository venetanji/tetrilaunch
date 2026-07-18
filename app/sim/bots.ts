// Naive "player" stand-ins for the sim harness. Each bot is a pure function
// of the Game's public state (cannon/score/level) — no lookahead, no
// trajectory-aware targeting. The point is to answer "does just aiming at
// roughly the field middle and holding the trigger clear the early bays?",
// not to build a strong AI.
import type { Game } from "../src/game/game";
import { mulberry32 } from "../src/game/mods";
import { SPEED_MIN, SPEED_MAX } from "../src/game/cannon";

export interface Bot {
  name: string;
  act(g: Game, now: number): void;
}

/** ±60° — matches the cannon's own drag-aim clamp (see cannon.ts's
 *  aimFromDrag: Math.PI / 3 either side of straight ahead). */
const MAX_ANGLE_RAD = Math.PI / 3;

export interface FixedAimOpts {
  /** Uniform jitter half-width applied to the aim angle, in degrees. */
  jitterDeg?: number;
  /** Uniform jitter half-width applied to power, in px/step. */
  jitterPower?: number;
  /** If true, roll a random 0-3 quarter-turn spin on the loaded piece before
   *  every shot (approximates a player who bothers to rotate). */
  rotate?: boolean;
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
  const { jitterDeg = 0, jitterPower = 0, rotate = false, seed = 1 } = opts;
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

      if (rotate) {
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
};
