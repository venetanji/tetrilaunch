// Autopilot for the menu's attract demo (attract.ts) — a stand-in "player"
// that reads the pile, aims, rotates and fires, driving the real Game class
// rather than replaying a canned animation.
//
// This is the SHIPPED cousin of sim/bots.ts's `aim` preset, and it is a
// deliberate second copy rather than an import: sim/ is a headless harness
// compiled by its own tsconfig and excluded from the app bundle, and its bots
// are calibration instruments whose numbers must stay pinned to whatever a
// balance sweep last measured. Pulling one into the bundle would tie the
// menu's look to that, and any retune of the demo's showmanship (the three
// deliberate differences below) to a balance re-run. What they share is the
// approach, and the reasoning behind it lives there in full.
//
// The three differences, all because a demo is watched rather than scored:
//   - NO PATIENCE. The sim bot holds fire when its best candidate still misses
//     by more than a cell, which is correct play and reads on screen as a
//     cannon that has stopped working. This one always takes its best shot. On
//     the menu's bay, which is dead calm (attract.ts's MENU_BAY), "best" is a
//     near-perfect landing anyway and the two would rarely disagree; on a
//     ratcheted preview bay the wind makes them disagree often, and taking the
//     shot is still the right call — a cannon that waits out a gust is a cannon
//     the viewer watches do nothing.
//   - A COARSER SEARCH (5° steps, 3 powers vs. 2° and 4). Same landing
//     accuracy to well within a cube at this bay's ranges, a third of the
//     trajectory integrations — and this one runs on a phone that is sitting
//     on the main menu, not on a sweep machine.
//   - IT FIRES DEMOLITION CHARGES. The sim bot never has a rack to spend, and
//     until the Full Game preview (ui/screens.ts's previewScreen) neither did
//     this one: attract.ts flew a stock Tier 1 bay, where bombCharges is 0 and
//     every branch below is unreachable. A preview bay mounts a maxed rack, and
//     a rack nobody fires is a system the sheet claims and does not show. See
//     `congested` for when it spends one and why the threshold is the bay's own.
import type Matter from "matter-js";
import type { Game } from "./game";
import { CELL, WALL_INNER } from "./engine";
import { SPEED_MAX } from "./cannon";
import { pieceCells } from "./pieces";
import { mulberry32 } from "./mods";
import type { PieceSize, PieceType } from "./theme";

export interface Autopilot {
  /** Called once per physics step with the demo's own clock. Fires at most one
   *  shot, and only when the cannon is off cooldown. */
  act(g: Game, now: number): void;
}

/** ±60° — the cannon's own drag-aim clamp (cannon.ts's aimFromDrag). */
const MAX_ANGLE_RAD = Math.PI / 3;

/** Quarter-turns that lay each piece FLAT (minimum bounding-box height). A 90°
 *  turn only swaps a piece's bounding box's width and height, so every type has
 *  exactly two distinct boxes across its four orientations and "0 or 1" is the
 *  whole choice — see sim/bots.ts's MIN_HEIGHT_TURNS for the per-type
 *  derivation. Flat landings are what keep the pile low enough to keep
 *  completing rows, which is the only thing this demo has to show. */
const MIN_HEIGHT_TURNS: Record<PieceType, number> = {
  I: 0, O: 0, T: 0, L: 1, J: 1, S: 0, Z: 0,
};

/** Muzzle speeds searched, before the ship's launcher multiplier. Spans the
 *  useful part of SPEED_MAX (28) without a continuous 2D scan. */
const POWER_CANDIDATES = [19, 23, 27];

/** Slack (px) added to a piece's half-width for the wall-margin and
 *  bar-collision tests — contact isn't a mathematical point, so "just barely
 *  clear" shouldn't be allowed to become "just barely clips". */
const CLEARANCE_PX = 10;

/** Among candidates within this many px of the best landing, the STEEPEST
 *  wins. A flat, fast impact scatters the pile it lands on; a steep one drops
 *  into it. */
const TIE_TOL_PX = 20;

/** How long (ms) a just-fired shot's target slot counts as taken even though
 *  nothing has visibly landed there yet — roughly one flight's hang time.
 *  Without it two consecutive shots both read the slot as empty and stack onto
 *  each other. */
const PENDING_MS = 2200;

/** Half the widest bounding-box extent (px) of a shipment — the flattest
 *  orientation's width, since that is the one every shot fires in and a 90°
 *  turn just swaps the extents. The trajectory search scores a single point
 *  (the centre of mass), so this is what lets it reason about the piece's real
 *  footprint clearing the wall and the bar. Read off pieceCells rather than a
 *  per-type table because the footprint depends on the payload size class too. */
function pieceHalfWidthPx(type: PieceType, size: PieceSize): number {
  const cells = pieceCells(type, size);
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  return (Math.max(w, h) * CELL) / 2;
}

/** Where a candidate arc puts the piece down: the last plotted point once it
 *  has already fallen past the bar's top, or the interpolated crossing of that
 *  height on the way down for an arc the fixed preview window hasn't resolved
 *  that far. */
function estimateLandingX(
  traj: Matter.Vector[],
  compactorTopY: number,
  fallback: number,
): number {
  if (traj.length === 0) return fallback;
  const last = traj[traj.length - 1];
  if (last.y >= compactorTopY) return last.x;
  for (let i = traj.length - 1; i > 0; i--) {
    const a = traj[i - 1];
    const b = traj[i];
    if (a.y < compactorTopY && b.y >= compactorTopY) {
      const t = (compactorTopY - a.y) / (b.y - a.y);
      return a.x + t * (b.x - a.x);
    }
  }
  return last.x;
}

interface BarLike {
  x: number;
  dir: 1 | -1;
  speed: number;
  leftX: number;
  rightX: number;
  width: number;
  top: number;
}

/** The bar's x at each of the next `steps` physics steps (index i = i steps
 *  from now, so [0] is the current position — matching trajectory point i's
 *  timing), using the same ping-pong clamp compactor.ts applies each step.
 *  Walked ONCE per shot decision: hitsBar used to re-simulate the bar from
 *  scratch at every trajectory point, which made each of the ~27 aim
 *  candidates O(points²) — ~260k clamp iterations per shot on the one screen
 *  (the menu) that should be idling. */
function predictCompactorPath(c: BarLike, steps: number): number[] {
  const xs = new Array<number>(steps);
  let x = c.x;
  let dir = c.dir;
  for (let i = 0; i < steps; i++) {
    xs[i] = x;
    x += c.speed * dir;
    if (x >= c.rightX) {
      x = c.rightX;
      dir = -1;
    } else if (x <= c.leftX) {
      x = c.leftX;
      dir = 1;
    }
  }
  return xs;
}

/** True if this arc would carry the piece through the bar's swept column while
 *  still low enough to be hit by it. A shipment batted mid-air by the press is
 *  the ugliest thing the demo can do, so candidates that risk it are dropped.
 *  `barXs` is the shared per-decision path from predictCompactorPath. */
function hitsBar(
  traj: Matter.Vector[],
  c: BarLike,
  halfWidthPx: number,
  barXs: number[],
): boolean {
  const reach = c.width / 2 + halfWidthPx + CLEARANCE_PX;
  for (let i = 0; i < traj.length && i < barXs.length; i++) {
    const p = traj[i];
    if (p.y < c.top) continue; // above the bar's band entirely
    if (Math.abs(p.x - barXs[i]) < reach) return true;
  }
  return false;
}

interface GapTarget {
  /** World x to land the piece on. */
  x: number;
  /** Slot index claimed, or -1 for the nothing-to-read-yet fallback. */
  slot: number;
}

/**
 * Reads the flattest landing window in the compaction zone, over the fixed
 * slot grid a full line is measured on (level.compactorMinLineCells, anchored
 * to the wall). Averaged over the loaded piece's OWN width rather than picking
 * a single low column: a wide piece aimed at a narrow dip straddles its taller
 * neighbours and topples. Ties break toward the wall, which is where rows have
 * to complete.
 *
 * Stateful — the pending-slot memory is per-autopilot, not a pure function of
 * the Game — so it's built once per instance rather than per shot.
 */
function makeGapReader() {
  const pendingUntil = new Map<number, number>();

  return {
    read(g: Game, now: number): GapTarget {
      const face = g.compactor.x + g.compactor.width / 2;
      const zoneMid = (face + WALL_INNER) / 2;
      if (g.cubes.length === 0 && pendingUntil.size === 0) return { x: zoneMid, slot: -1 };

      const slots = g.level.compactorMinLineCells;
      const halfWidthPx = pieceHalfWidthPx(g.cannon.currentType, g.level.pieceSize);
      const widthCells = Math.max(1, Math.round((2 * halfWidthPx) / CELL));
      // Slots so close to the wall that this piece's far edge would clip it.
      const minSlot = Math.max(0, Math.ceil((halfWidthPx + CLEARANCE_PX - CELL / 2) / CELL));

      // Per-slot stack top (smaller y = taller). An untouched slot stays at
      // +Infinity, and since the search wants the GREATEST average top-y, empty
      // slots outrank occupied ones for free.
      const topY = new Array<number>(slots).fill(Number.POSITIVE_INFINITY);
      for (const c of g.cubes) {
        const slot = Math.round((WALL_INNER - CELL / 2 - c.body.position.x) / CELL);
        if (slot < 0 || slot >= slots) continue;
        const y = c.body.position.y;
        if (y < topY[slot]) topY[slot] = y;
      }
      // Shots still in flight own their slot until they land.
      for (const [slot, until] of pendingUntil) {
        if (until <= now) pendingUntil.delete(slot);
        else if (slot < slots) topY[slot] = Number.NEGATIVE_INFINITY;
      }

      const lastStart = Math.max(minSlot, slots - widthCells);
      let bestStart = Math.min(minSlot, lastStart);
      let bestAvg = Number.NEGATIVE_INFINITY;
      for (let s = minSlot; s <= lastStart; s++) {
        let sum = 0;
        for (let k = 0; k < widthCells; k++) sum += topY[s + k];
        const avg = sum / widthCells;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestStart = s;
        }
      }
      const centerSlot = bestStart + (widthCells - 1) / 2;
      return { x: WALL_INNER - CELL / 2 - centerSlot * CELL, slot: bestStart };
    },

    markFired(slot: number, now: number): void {
      if (slot >= 0) pendingUntil.set(slot, now + PENDING_MS);
    },
  };
}

/**
 * WHEN A CHARGE IS WORTH SPENDING: once the pile has passed the bay's OWN FIRST
 * congestion tier (level.ts's PILE_TIERS, carried on the config as pileTiers /
 * pileAllowance). That is the line at which the bay starts charging for the
 * pile — past it a launch costs more, reloads slower and pays less — so it is
 * the game's own definition of a congested field rather than a number invented
 * here, and reading it off the config means a rebalance of the tax moves this
 * with it instead of leaving a second copy behind.
 *
 * THE FIRST TIER RATHER THAN THE LAST, and that was measured rather than
 * assumed. Against the last one (the red band) a preview bay fired no charge at
 * all on two of five seeds across a full 90-second cycle: the autopilot clears
 * well enough that the pile hovers in the amber band and simply never reaches
 * the red, so the rack the sheet is advertising sat full for the whole visit.
 * Against the first, all eight measured seeds spend four to seven — and the pile
 * still crosses into the red about a fifth of the cycle, because slag arrives
 * faster than one charge at a time takes it away.
 *
 * Inert on a bay with no tiers (Contracts, lessons) and on any rig with no
 * charges, which is every bay the menu's demo has ever flown.
 */
function congested(g: Game): boolean {
  const tiers = g.level.pileTiers;
  const first = tiers[0];
  return !!first && g.cubes.length > first.cubes + g.level.pileAllowance;
}

/**
 * The x of the TALLEST column in the compaction zone — where a charge does the
 * most visible work. The exact inverse of the gap reader above, and deliberately
 * a separate walk rather than a flag on it: that one averages over the loaded
 * piece's width because a piece has one, and a blast is a radius about a point.
 *
 * `fallback` is returned when nothing is in the zone at all, which the congested
 * test makes unreachable in practice but which a charge left armed across a line
 * clear can still reach.
 */
function peakX(g: Game, fallback: number): number {
  const slots = g.level.compactorMinLineCells;
  let peakSlot = -1;
  let peakY = Number.POSITIVE_INFINITY;
  for (const c of g.cubes) {
    const slot = Math.round((WALL_INNER - CELL / 2 - c.body.position.x) / CELL);
    if (slot < 0 || slot >= slots) continue;
    const y = c.body.position.y;
    if (y < peakY) {
      peakY = y;
      peakSlot = slot;
    }
  }
  return peakSlot < 0 ? fallback : WALL_INNER - CELL / 2 - peakSlot * CELL;
}

interface AimCandidate {
  deg: number;
  power: number;
  err: number;
}

/** Best of a candidate pool: lowest landing error, and among everything within
 *  TIE_TOL_PX of it the steepest angle (see TIE_TOL_PX). */
function pickCandidate(pool: AimCandidate[]): AimCandidate | null {
  let best: AimCandidate | null = null;
  for (const c of pool) if (!best || c.err < best.err) best = c;
  if (!best) return null;
  // Seeded with the lowest-error candidate (which trivially clears its own
  // tolerance), then upgraded to any steeper arc that still lands within it.
  const tol = best.err + TIE_TOL_PX;
  let chosen = best;
  for (const c of pool) if (c.err <= tol && c.deg > chosen.deg) chosen = c;
  return chosen;
}

/**
 * Builds an autopilot. `seed` drives only the small aim jitter — the search
 * itself is deterministic — so two demos started with different seeds miss in
 * different places rather than playing out identically.
 */
export function createAutopilot(seed: number): Autopilot {
  const rng = mulberry32(seed >>> 0);
  const gaps = makeGapReader();

  return {
    act(g, now) {
      if (g.status !== "playing" || g.settling) return;
      if (!g.cannon.canShoot(now)) return;
      if (g.score < g.level.launchCost) return;

      // THE CHARGE DECISION COMES FIRST, because it changes what the shot is
      // aiming AT. `g.nextIsBomb` leads the test so a charge armed on an earlier
      // step that failed to leave the muzzle is fired rather than toggled back
      // off — armBomb() is a toggle, and calling it blind on an armed rack would
      // disarm the thing this branch exists to spend.
      const bombing = g.nextIsBomb
        || (g.bombCharges > 0 && congested(g) && g.armBomb());
      const gap = bombing ? null : gaps.read(g, now);
      const target = gap ? gap.x : peakX(g, (g.compactor.x + g.compactor.width / 2 + WALL_INNER) / 2);
      const halfWidthPx = pieceHalfWidthPx(g.cannon.currentType, g.level.pieceSize);
      const powerScale = g.cannon.speedMax / SPEED_MAX;
      // One bar forecast shared by every candidate — the bar's future doesn't
      // depend on where the cannon points. 140 = predictTrajectory's step cap.
      const barXs = predictCompactorPath(g.compactor, 140);

      const all: AimCandidate[] = [];
      const safe: AimCandidate[] = [];
      for (let deg = 15; deg <= 55; deg += 5) {
        for (const pwBase of POWER_CANDIDATES) {
          // The search drives the real cannon and reads the real preview arc
          // back out, so whatever it settles on is exactly what the dotted
          // line on screen promises and exactly what leaves the muzzle.
          g.cannon.angle = (deg * Math.PI) / 180;
          g.cannon.power = pwBase * powerScale;
          g.updateTrajectory();
          const err = Math.abs(
            estimateLandingX(g.trajectory, g.compactor.top, target) - target,
          );
          const cand: AimCandidate = { deg, power: g.cannon.power, err };
          all.push(cand);
          if (!hitsBar(g.trajectory, g.compactor, halfWidthPx, barXs)) safe.push(cand);
        }
      }

      // Prefer an arc that clears the bar even when its raw error is a little
      // worse; fall back only when every candidate is equally exposed.
      const chosen = pickCandidate(safe.length ? safe : all);
      if (!chosen) return;

      const jitterRad = (rng() * 2 - 1) * (Math.PI / 180);
      const jitterPower = (rng() * 2 - 1) * 0.5;
      g.cannon.angle = Math.max(
        -MAX_ANGLE_RAD,
        Math.min(MAX_ANGLE_RAD, (chosen.deg * Math.PI) / 180 + jitterRad),
      );
      g.cannon.power = Math.max(
        g.cannon.speedMin,
        Math.min(g.cannon.speedMax, chosen.power + jitterPower),
      );

      // Not while a charge is on the rail: the loaded shipment is not going
      // anywhere this shot (game.ts's shoot leaves it loaded), so squaring it up
      // now would spin the crate riding the belt for no reason and leave the
      // NEXT shot's rotation decided by a pile two launches old.
      if (!bombing) {
        const turns = (MIN_HEIGHT_TURNS[g.cannon.currentType] - g.cannon.quarterTurns + 4) % 4;
        for (let i = 0; i < turns; i++) g.cannon.rotateRight();
      }

      g.updateTrajectory();
      // Only a SHIPMENT claims a slot. A charge is about to take cubes out of
      // the one it lands in, so marking it pending would steer the next real
      // shipment away from the one place that just opened up.
      if (g.shoot(now) && gap) gaps.markFired(gap.slot, now);
    },
  };
}
