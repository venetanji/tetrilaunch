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
import { NO_MATERIALS, type LevelConfig } from "./level";
import { SIZE_SPEC } from "./pieces";
import { MATERIALS, type Material } from "./theme";

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
  /** What the bay is allowed to ship — see SandboxMaterial. */
  material: SandboxMaterial;
}

/**
 * The sandbox's material override.
 *
 * Materials arrive through hazard content axes at 7-32% a shipment (hazards.ts's
 * materialRate), and only from Mark 4 up, and only if the draft happened to deal
 * that card. Testing how six materials READ against each other that way means
 * drafting the right hand and then waiting on a die roll, which is not a test —
 * it is a slot machine with a phone in your hand.
 *
 * So: "mix" leaves the bay exactly as the ladder built it, one material name
 * ships nothing but that, and "all" ships an even parade of all six. "all" is the
 * one that matters here, because the question a material's LOOK has to answer is
 * never "what is this" in isolation — it is "which of these two is this", and
 * that needs both of them on the belt within a few shipments of each other.
 */
export type SandboxMaterial = "mix" | "all" | Material;

/** Every material except standard, in MATERIALS order. */
export const SANDBOX_MATERIALS: Material[] = MATERIALS.filter((m) => m !== "standard");

/**
 * Point a level's material mix at whatever the sandbox selected.
 *
 * Writes `materialMix` directly rather than going through hazards.ts's ratchets:
 * the caps there (MATERIAL_CAP 0.32 per material, and the combined cap) exist to
 * keep a REAL run's difficulty honest, and honouring them here would mean the one
 * screen built to look at every material could never show more than a third of a
 * queue's worth. The shipping path is untouched — this is only ever called from
 * launchSandbox, behind the SANDBOX gate.
 *
 * Returns the same object it was handed, so callers can inline it.
 */
export function applySandboxMaterials(cfg: LevelConfig, choice: SandboxMaterial): LevelConfig {
  if (choice === "mix") return cfg;
  const mix = { ...NO_MATERIALS };
  // DE-NORMALIZED, because rollMaterial is normalized. It scales every
  // probability by std-cubes/own-cubes so that dead CUBES per launch stay
  // constant across size classes — correct for a real bay, and wrong for this
  // screen, which is asking for a mix of SHIPMENTS. Divide the scaling back out
  // or the parade is not the one that was selected: a Bulk bay handed a single
  // material still rolled 20% standard (1 x 0.8), and an ALL parade on a Micro
  // bay ran past cumulative 1.0 at the fourth material, so the last two could
  // never appear at all — on the one screen built to compare them.
  const denorm = SIZE_SPEC[cfg.pieceSize].cubes / SIZE_SPEC.std.cubes;
  if (choice === "all") {
    // Just under 1.0 in total, not exactly 1.0: cannon.ts's rollMaterial walks
    // the mix as cumulative probability and falls through to "standard" past the
    // end, so leaving a sliver keeps the occasional ordinary shipment in the
    // parade. Comparing a material against a plain one is half the job.
    const each = (0.94 / SANDBOX_MATERIALS.length) * denorm;
    for (const m of SANDBOX_MATERIALS) mix[m as Exclude<Material, "standard">] = each;
  } else if (choice !== "standard") {
    mix[choice as Exclude<Material, "standard">] = denorm;
  }
  cfg.materialMix = mix;
  return cfg;
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
    // The ladder's own mix by default: the sandbox opens showing the real game,
    // and forcing materials is something you turn on deliberately.
    material: "mix",
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
