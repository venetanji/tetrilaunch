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
