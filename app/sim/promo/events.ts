/**
 * One event recorder for both halves of the harness.
 *
 * The page (harness.ts) records what the App's own Game fires, on top of the
 * App's callbacks; the preroll (preroll.ts) records the same events from a
 * headless Game in node. Written once so the two logs are the same log, which
 * is what lets run.ts check that the browser reproduced the preroll's bay.
 *
 * Wraps the Game's `events` object IN PLACE rather than replacing it: the App
 * built that object and its handlers are what make a line clear play a sound
 * and flip a state, and every one of them has to keep running under the
 * recorder.
 */
import type { Game, GameEvents } from "../../src/game/game";
import { CELL, WALL_INNER, WORLD } from "../../src/game/engine";
import { bestGrade, type PromoEvent } from "./beats";

export function recordEvents(g: Game, now: () => number, push: (e: PromoEvent) => void): void {
  const ev = (g as unknown as { events: GameEvents }).events;
  const wrap = <K extends keyof GameEvents>(
    key: K,
    rec: (...args: Parameters<NonNullable<GameEvents[K]>>) => void,
  ): void => {
    const orig = ev[key] as ((...args: unknown[]) => void) | undefined;
    (ev as Record<string, unknown>)[key] = (...args: unknown[]) => {
      rec(...(args as Parameters<NonNullable<GameEvents[K]>>));
      orig?.(...args);
    };
  };
  const at = (e: Omit<PromoEvent, "t">): void => push({ t: now(), ...e });

  wrap("onShoot", () => at({ kind: "shoot" }));
  wrap("onLineClear", (lines, grades) => {
    const grade = bestGrade(grades);
    at({ kind: "clear", lines, grades: { ...grades }, grade });
    // The payout callout the player reads is the tally's best band, and
    // "excellent" is the one the precision beat waits for.
    at({ kind: "stamp", grade });
  });
  wrap("onExplosion", (kind) => at({ kind: "explosion", explosion: kind }));
  wrap("onCongestion", (tier, tiers) => at({ kind: "congestion", tier, tiers }));
  wrap("onThawLance", () => at({ kind: "thaw" }));
  wrap("onBondBreak", () => at({ kind: "bond" }));
  wrap("onSettleStart", () => at({ kind: "settle" }));
  wrap("onCryoShatter", () => at({ kind: "cryoShatter" }));
  wrap("onPieceLost", () => at({ kind: "pieceLost" }));
  wrap("onCushionAbsorb", () => at({ kind: "cushion" }));
  wrap("onStatus", (status) => {
    at({ kind: "status", status });
    if (status === "won") at({ kind: "bayclear" });
    if (status === "lost") {
      at({ kind: "loss", reason: g.lossReason });
      // The clock running out is the one loss with a sound of its own in the
      // storyboard: the buzzer.
      if (g.lossReason === "time") at({ kind: "buzzer" });
    }
  });
}

/* ---------------------------------------------------------------------------
 * THE CLOSING PIECE — which shipment closed a clear, and where.
 *
 * lineClear.ts's row/slot grid, restated here in the same terms it uses: row 0
 * sits on the floor (WORLD.height), rising one CELL per row; slot 0 sits flush
 * against the wall (WALL_INNER), one CELL further in per slot. Every clear
 * happens inside this same grid — it is how updateLineClear finds one — so
 * these are exactly its own coordinates, not a promo approximation of them.
 * ------------------------------------------------------------------------- */

const rowOf = (y: number): number => Math.round((WORLD.height - CELL / 2 - y) / CELL);
const slotOf = (x: number): number => Math.round((WALL_INNER - CELL / 2 - x) / CELL);

/** How close to the wall/floor counts as the "bottom-right corner" for the
 *  precision beat's decisive double: the bottom two rows, and within three
 *  cells of the wall — generous enough for a T or S piece's own footprint
 *  (three cells wide, however it landed) to fully qualify. */
const CORNER_MAX_ROW = 1;
const CORNER_MAX_SLOT = 2;

/**
 * Advance one physics step and, if it closed any rows, stamp the "clear"
 * event `recordEvents` just pushed with which shipment closed it, that
 * shipment's piece type, and where its cubes sat in the row/slot grid above.
 *
 * WHY THIS WRAPS THE STEP RATHER THAN THE EVENT. onLineClear's own payload is
 * a line count and a grade tally (game.ts) — lineClear.ts's updateLineClear
 * removes the cleared cubes from `g.cubes` before Game fires anything, so a
 * type or a position is nowhere in that callback by the time it runs. The one
 * moment they are still there to read is the step about to remove them: a
 * before/after snapshot of `g.cubes` BY IDENTITY finds exactly the cubes this
 * step removed, and each one still carries its own `.type` and `.shipment`
 * (pieces.ts, stamped at launch) and its last resting `.body.position` — Matter
 * leaves a removed body's fields alone; only stepping the world again would
 * move it, and a removed body is never stepped again.
 *
 * Caller supplies `before` (a shallow copy of `g.cubes` taken before this
 * step's own `g.update(t)`) and `startLen` (`events.length` at that same
 * moment), so this can run identically from harness.ts's hook (which also
 * runs a pilot before the real update) and preroll.ts's flyBay (which does
 * not) without either duplicating the snapshot.
 */
export function stampClosingPiece(
  g: Game, before: Game["cubes"], events: PromoEvent[], startLen: number,
): void {
  if (g.cubes.length === before.length) return; // nothing left the field this step
  const clear = events.slice(startLen).find((e) => e.kind === "clear");
  if (!clear) return; // a cube can also leave lost past the wall — not a clear
  const after = new Set(g.cubes);
  const removed = before.filter((c) => !after.has(c));
  if (removed.length === 0) return;
  // The most recently LAUNCHED shipment among the removed cubes — the one
  // that just landed and, if this is the moment, closed the row(s) with it.
  let closingShipment = -1;
  for (const c of removed) if ((c.shipment ?? -1) > closingShipment) closingShipment = c.shipment ?? -1;
  const closing = removed.filter((c) => c.shipment === closingShipment);
  if (closing.length === 0) return;
  const rows = [...new Set(closing.map((c) => rowOf(c.body.position.y)))].sort((a, b) => a - b);
  const slots = [...new Set(closing.map((c) => slotOf(c.body.position.x)))].sort((a, b) => a - b);
  clear.closingType = closing[0].type;
  clear.closingShipment = closingShipment;
  clear.closingRows = rows;
  clear.closingSlots = slots;
  clear.bottomRight = rows.every((r) => r <= CORNER_MAX_ROW) && slots.every((k) => k <= CORNER_MAX_SLOT);
}
