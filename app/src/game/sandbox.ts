/**
 * SANDBOX STATE — what the developer screen is currently set to launch.
 *
 * Kept out of ui/ because it is a model, not a view: main.ts reads it to build
 * a Game, sim/ can construct one to reproduce whatever a device session hit, and
 * the screen is only one way of editing it. See lib/sandbox.ts for the build
 * gate and why this ships nowhere.
 *
 * Deliberately NOT persisted. A sandbox setting that survived a reload would be
 * indistinguishable from a bug in the real game the next time the app opened —
 * "why is my save at Mark 9" is not a question worth ever having to answer.
 * Everything here resets to the defaults on launch; what the sandbox writes into
 * the actual save (see main.ts's applySandboxRig) is deliberate and explicit.
 */
import { VARIANTS, type ContractVariant } from "./contracts";
import { MARK_COUNT, MAX_TIER, newTiers, UPGRADES, type UpgradeTiers } from "./upgrades";
import { RUN_LEVELS } from "./run";

/** What the sandbox will launch when the LAUNCH button is pressed. */
export type SandboxTarget =
  /** A pattern Contract of a chosen variant, at the chosen tier. */
  | { kind: "pattern"; variant: ContractVariant }
  /** The chosen tier's launch-budget Contract (daily slot 0). */
  | { kind: "lines" }
  /** A Deep Run bay, started directly at `bay` with the chosen rig. */
  | { kind: "bay"; bay: number };

export interface SandboxState {
  /** Contract tier / Deep Run Mark — the ladder rung being tested. */
  tier: number;
  /** Re-rolled by the RESEED button. A generated Contract is a function of
   *  (seed, tier, slot, variant), so this is the dial that walks through the
   *  whole space of what one variant can produce at one tier — which is the
   *  thing a device session is actually for. */
  seed: number;
  target: SandboxTarget;
  /** The rig a Deep Run bay launches with. Contracts ignore it: a Contract
   *  bay is stripped of the run economy entirely (contracts.ts). */
  tiers: UpgradeTiers;
}

export function newSandbox(): SandboxState {
  return {
    tier: 1,
    // A fixed opening seed rather than Date.now(): the first thing the screen
    // shows must be the same Contract every time it is opened, or "does this
    // reproduce" has no starting point.
    seed: 20260101,
    target: { kind: "pattern", variant: "plain" },
    tiers: newTiers(),
  };
}

export const SANDBOX_TIERS = Array.from({ length: MARK_COUNT }, (_, i) => i + 1);
export const SANDBOX_BAYS = Array.from({ length: RUN_LEVELS }, (_, i) => i + 1);

/** Every upgrade track at full tier — the "maxed rig" button. */
export function maxedTiers(): UpgradeTiers {
  const t = newTiers();
  for (const u of UPGRADES) t[u.id] = MAX_TIER;
  return t;
}

/** Variants a tier can actually produce, plus why the others are missing.
 *  The screen shows ALL of them and greys the locked ones rather than hiding
 *  them: a developer looking for "where did Guided go" is better served by a
 *  row that says "tier 9" than by an absence. */
export function sandboxVariants(tier: number): Array<{
  id: ContractVariant; name: string; tier: number; locked: boolean;
}> {
  return VARIANTS.map((v) => ({
    id: v.id, name: v.name, tier: v.tier, locked: v.tier > tier,
  }));
}
