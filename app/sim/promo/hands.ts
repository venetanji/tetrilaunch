/**
 * SCRIPTED HANDS — the three abilities a beat fires on cue, and the status
 * snapshot the cue is read from. Shared by the page (harness.ts) and the
 * headless preroll (preroll.ts) so a scripted charge lands at the same step
 * in both, which is what lets the preroll say when a beat's blast happens
 * before a frame of it is captured.
 *
 * Every hand goes through Game's own entry points — armBomb / shoot,
 * useThawLance, useBondBreaker — never around them. The one thing added is
 * WHERE the charge goes: bots.ts's demo hands only ever bomb dead cargo
 * (bestBlastSite reads slag alone), and the `improvise` beat wants a charge in
 * a live, congested pile on purpose. That is a choice about the trailer, not
 * about play, so it lives here and not in bots.ts.
 */
import { aimCandidates } from "../bots";
import { CELL, WALL_INNER } from "../../src/game/engine";
import type { Game } from "../../src/game/game";
import type { PromoStatus } from "./beats";

export function statusOf(g: Game | null, state: string, steps: number, now = 0): PromoStatus {
  return {
    state,
    hasGame: !!g,
    status: g ? g.status : null,
    ready: g ? g.cannon.canShoot(now) : false,
    lossReason: g ? g.lossReason : null,
    timeLeftMs: g ? (Number.isFinite(g.timeLeftMs) ? g.timeLeftMs : null) : null,
    elapsedMs: g ? g.elapsedMs : 0,
    cubes: g ? g.cubes.length : 0,
    lines: g ? g.linesTotal : 0,
    score: g ? g.score : 0,
    target: g ? g.target : 0,
    bombs: g ? g.bombCharges : 0,
    thaw: g ? g.thawCharges : 0,
    steps,
  };
}

/** Arm a charge and put it into the middle of whatever sits in the
 *  compaction zone — between the press's face and the wall. */
export function fireBomb(g: Game, now: number): boolean {
  if (g.status !== "playing" || g.bombCharges <= 0) return false;
  if (!g.cannon.canShoot(now)) return false;
  const face = g.compactor.x + g.compactor.width / 2;
  const zone = g.cubes.filter((c) => c.body.position.x > face && c.body.position.x < WALL_INNER);
  if (zone.length === 0) return false;
  const x = zone.reduce((s, c) => s + c.body.position.x, 0) / zone.length;
  if (!g.armBomb()) return false;
  const { best } = aimCandidates(g, x, CELL * 0.45);
  g.cannon.angle = (best.deg * Math.PI) / 180;
  g.cannon.power = best.power;
  g.updateTrajectory();
  if (g.shoot(now)) return true;
  // Disarm on the refused path, as bots.ts's fireCharge does: an armed bomb
  // left behind would turn the pilot's next shipment into one.
  g.armBomb();
  return false;
}

export function fireThaw(g: Game, now: number): boolean {
  if (g.status !== "playing") return false;
  return g.useThawLance(now);
}

export function fireBond(g: Game, now: number): boolean {
  if (g.status !== "playing") return false;
  return g.useBondBreaker(now);
}

export const HANDS = { bomb: fireBomb, thaw: fireThaw, bond: fireBond } as const;
