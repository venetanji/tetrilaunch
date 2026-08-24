/**
 * TIER S STATE — what the sandbox screen is currently set to launch.
 *
 * Kept out of ui/ because it is a model, not a view: main.ts reads it to build
 * a run, sim/ can construct one to reproduce whatever a device session hit, and
 * the screen is only one way of editing it. See lib/devmode.ts for what ships
 * (the MODE) and lib/sandbox.ts for what does not (the save-editing CHEATS).
 *
 * Deliberately NOT persisted. A sandbox setting that survived a reload would be
 * indistinguishable from a bug in the real game the next time the app opened —
 * "why is my save at Mark 9" is not a question worth ever having to answer.
 * Everything here resets to the defaults on launch; what the dev cheats write
 * into the actual save is deliberate, explicit, and build-gated.
 */
import { VARIANTS, type ContractVariant } from "./contracts";
import { MARK_COUNT, MAX_TIER, newTiers, UPGRADES, type UpgradeTiers } from "./upgrades";
import { newRun, RUN_LEVELS, type RunState } from "./run";
import { finalsForTier, type FinalDef, type FinalId } from "./finals";
import { hazardsForMark, type HazardDef, type HazardId, type Ratchets } from "./hazards";
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
  /**
   * Difficulty axes pre-ratcheted onto the bay (hazards.ts).
   *
   * The single biggest thing the old screen could not reach. A ratchet is
   * taken at a BETWEEN-BAY DRAFT, so the only way to see a bay with three
   * notches of wind on it was to play six bays correctly and be dealt wind
   * three times — which is to say it was untestable, and unpractisable, which
   * are the same complaint from two directions. Setting them directly is the
   * whole point of a sandbox: `levelForRun` applies `run.ratchets` on every
   * bay it builds, so a run handed a pre-notched table plays exactly as one
   * that drafted its way there.
   */
  ratchets: Ratchets;
  /**
   * The Final Inspection clause forced onto the last bay (finals.ts), or null
   * for the bay the ladder would deal.
   *
   * The same complaint the ratchets above answer, one bay further on and one
   * degree worse. A clause is dealt by clearing bay 9 (run.ts's isFinalDraft),
   * so the only way to see one was to play a whole run correctly and then be
   * offered the half of the pair you were not trying to test — and the pair is
   * the Tier's own exam, the single most Tier-specific thing in the game. Ten
   * Tiers times two clauses is twenty bays that between them could only be
   * reached by twenty complete runs.
   *
   * Stored as one id rather than a Ratchets entry for the reason run.ts states
   * on RunState.final: it is a one-off clause on one bay, not a rate. And it
   * only bites where levelForRun applies it — bay 10 — which is why setting one
   * from the screen also parks the target there (main.ts's sbx-final).
   */
  final: FinalId | null;
}

/** Notches one axis may be pushed to from this screen.
 *
 *  Three, not unbounded: the notch sizes in hazards.ts are tuned for a
 *  ten-bay run where the same axis is rarely taken more than three times, and
 *  a practice bay at eight notches of clock is not a hard version of the game
 *  — it is a different one, with nothing to learn from. */
export const SANDBOX_RATCHET_MAX = 3;

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
 * queue's worth. The ladder's own path is untouched — this is only ever called
 * for a Tier S launch, and only when the choice is not "mix".
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
    // Same argument: an un-notched bay is what the ladder deals, so that is
    // what the screen opens on.
    ratchets: {},
    // And the last bay opens as the ladder's own: the inspection is a thing you
    // go looking for, not a condition the screen starts you under.
    final: null,
  };
}

export const SANDBOX_TIERS = Array.from({ length: MARK_COUNT }, (_, i) => i + 1);
export const SANDBOX_BAYS = Array.from({ length: RUN_LEVELS }, (_, i) => i + 1);

/** The bay a Final Inspection clause is flown on. RUN_LEVELS, not a literal 10,
 *  and derived here rather than at the two call sites so the screen and the
 *  action handler cannot disagree about which bay "the last one" is. */
export const SANDBOX_FINAL_BAY = RUN_LEVELS;

/** The two clauses `tier` can be examined on (finals.ts), for the screen's
 *  Inspection row. A pass-through, exactly as sandboxVariants and sandboxAxes
 *  are: the sandbox asks this module what a rung offers, and this module asks
 *  the table — so a clause added to FINALS reaches the screen with no edit. */
export function sandboxFinals(tier: number): FinalDef[] {
  return finalsForTier(clampTier(tier));
}

/** True when `id` is one of the clauses `tier` actually offers. The screen only
 *  ever draws the current rung's pair, so a selection left over from another
 *  rung would be in force with nothing lit to say so — main.ts clears it
 *  through this when the Mark moves. */
export function finalFitsTier(id: FinalId | null, tier: number): boolean {
  return id === null || sandboxFinals(tier).some((f) => f.id === id);
}

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

/**
 * The axes Tier S may pre-ratchet at `tier`, in ladder order.
 *
 * `hazardsForMark` rather than the whole table, so the screen offers exactly
 * what a real run at that Mark could have drafted — including its retirements.
 * Practising against an axis the ladder no longer deals would be practising
 * the wrong game, and the sandbox is worth less than nothing if what it
 * rehearses is not what the ladder asks.
 */
export function sandboxAxes(tier: number): HazardDef[] {
  return hazardsForMark(Math.max(1, Math.min(MARK_COUNT, tier)));
}

/** Cycle one axis 0 -> 1 -> ... -> SANDBOX_RATCHET_MAX -> 0, in place.
 *  Wrapping for the same reason the rig chips wrap: one button per axis beats a
 *  stepper pair under a thumb, and no axis can get stuck at a notch the thumb
 *  cannot walk back from. */
export function bumpSandboxRatchet(r: Ratchets, id: HazardId): Ratchets {
  const next = ((r[id] ?? 0) + 1) % (SANDBOX_RATCHET_MAX + 1);
  const out = { ...r };
  if (next === 0) delete out[id];
  else out[id] = next;
  return out;
}

/** Total notches taken — the one number that says how far from the ladder's
 *  own bay this configuration has been pushed. */
export function ratchetTotal(r: Ratchets): number {
  return Object.values(r).reduce<number>((a, n) => a + (n ?? 0), 0);
}

/**
 * The RunState a Tier S launch produces.
 *
 * ONE function, called by both the screen (to preview the bay through
 * `levelForRun`, the same pipeline the game builds from) and main.ts (to
 * actually fly it). The alternative — a preview that models the launch — is
 * the specific bug this mode cannot afford: a practice bay that is not the bay
 * it advertised teaches the wrong lesson, confidently.
 *
 * `sandbox: true` is the field that keeps all of this out of the player's
 * save. It is set here rather than at the call site so there is no way to
 * construct this run without it.
 */
export function sandboxRunFor(s: SandboxState, unlocks: string[] = []): RunState {
  const bay = s.target.kind === "bay" ? s.target.bay : 1;
  return {
    ...newRun(s.seed >>> 0, unlocks, 0, s.tiers, clampTier(s.tier)),
    // Start AT the chosen bay. Nothing else about the run is fast-forwarded:
    // carry stays 0 and the rig is exactly what was selected, because "bay 7,
    // cold, on this rig" is the state worth practising — a fabricated bankroll
    // from six bays that were never played would make it a different bay.
    levelIndex: Math.max(0, Math.min(RUN_LEVELS - 1, bay - 1)),
    ratchets: { ...s.ratchets },
    // Carried unconditionally, and it is levelForRun that decides whether it
    // means anything: it applies the clause on bay 10 and nowhere else, guarded
    // on the bay rather than on the field being set. So a clause left selected
    // while the target is walked back to bay 3 is inert rather than wrong, and
    // the screen never has to clear it to stay honest.
    final: s.final,
    sandbox: true,
  };
}

function clampTier(tier: number): number {
  return Math.max(1, Math.min(MARK_COUNT, Math.floor(tier)));
}
