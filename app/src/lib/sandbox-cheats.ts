/**
 * THE DEVELOPER CHEATS — the half of Tier S that does not ship.
 *
 * Split out of main.ts's sandbox handler for one reason: so a shippable
 * bundle does not contain them AT ALL, rather than containing them behind a
 * runtime `if`.
 *
 * The distinction matters more than it looks. Both forms are safe in the sense
 * that neither can execute — SANDBOX folds to false and the guard returns. But
 * a guard inside a class method leaves the case labels, the strings and the
 * save-rewriting bodies sitting in the bundle, one refactor away from being
 * reachable, and leaves scripts/verify-store-bundle.mjs's grep with nothing to
 * find. As a module whose only call site is inside `if (SANDBOX)`, Rollup
 * eliminates the branch, then the call, then the import, then this file. What
 * ships is a bundle in which "wipe the save" does not exist as a string.
 *
 * That is why the MARKER lives here now rather than on the screen. The screen
 * ships (Tier S is a game mode — see lib/devmode.ts); this does not, so this
 * is the code path whose presence in dist/ means the build is not shippable.
 */
import { newMeta, SLOT_CAP, UNLOCKS, type MetaState } from "../game/meta";
import { maxedTiers } from "../game/sandbox";

/** Present in the bundle only when the cheats are compiled in. Grepped by
 *  scripts/verify-store-bundle.mjs — do not rename without updating it.
 *
 *  Here rather than in lib/sandbox.ts because THIS is the module the marker is
 *  a statement about, and because lib/sandbox.ts reads `import.meta.env` and so
 *  cannot be imported outside a Vite build (sim/ renders the Tier S screen
 *  through tsx). Nothing in this file touches the environment; it is dropped
 *  from a shippable bundle by the tree-shake at its single call site, which is
 *  what the marker then proves. */
export const SANDBOX_MARKER = "TETRILAUNCH_SANDBOX_BUILD";

/** Every cheat, keyed by the data-action that fires it. */
export type CheatId =
  | "sbx-grant-mark" | "sbx-grant-salvage" | "sbx-unlock-all" | "sbx-wipe";

/**
 * Apply one cheat to a save, returning the new one — or null when `action` is
 * not a cheat at all, which is how the caller tells "handled" from "unknown".
 *
 * Deliberately blunt and deliberately total. A developer who taps "Mark :=
 * tier" has said exactly what they want to happen to their own save, and a
 * version of this that tried to be careful about it would just be a slower way
 * to reach the same state. Pure — the caller persists.
 */
export function applyCheat(action: string, meta: MetaState, tier: number): MetaState | null {
  switch (action as CheatId) {
    case "sbx-grant-mark":
      return { ...meta, mark: Math.max(0, tier - 1) };
    case "sbx-grant-salvage":
      return { ...meta, salvage: meta.salvage + 1000 };
    case "sbx-unlock-all":
      // THE RACK IS PART OF "EVERYTHING", and it is the half this button
      // silently stopped granting when system slots landed (codex, PR #157).
      // A maxed loadout on a base rack OWNS ten systems and FLIES four:
      // meta.ts's safeLoadout masks the rest to tier 0 on the way into a run,
      // so the developer who tapped this got a Deep Run on the first four
      // tracks in UPGRADES order and no indication why. The label was true of
      // the field it wrote and false of the run it produced, which is the one
      // thing a blunt cheat must never be — the whole contract of this file is
      // that a developer who taps it "has said exactly what they want to
      // happen to their own save".
      //
      // The shed is CLEARED rather than left alone for the same reason: a
      // developer who had stowed something before tapping this would otherwise
      // undock without it, which is the same lie one system smaller. Together
      // these two make safeLoadout equal maxedTiers() exactly, which is what
      // sim/systems.ts pins.
      return {
        ...meta,
        unlocks: UNLOCKS.map((u) => u.id),
        loadout: maxedTiers(),
        slots: SLOT_CAP,
        stowed: [],
      };
    case "sbx-wipe":
      return newMeta();
    default:
      return null;
  }
}

/** The save-editing row's markup. Lives beside the cheats it fires so the two
 *  are eliminated together — a row of buttons for actions that are not in the
 *  bundle is the same bug as the reverse. */
export function cheatRowHTML(meta: MetaState): string {
  return `<div class="sbx-dev" data-build="${SANDBOX_MARKER}">
    <div class="sbx-dev__lbl">Save<span>not in any shipped build</span></div>
    <div class="sbx-row__opts">
      <button class="sbx-chip" type="button" data-action="sbx-grant-mark">Mark := tier (now ${meta.mark})</button>
      <button class="sbx-chip" type="button" data-action="sbx-grant-salvage">+1000 salvage (${meta.salvage})</button>
      <button class="sbx-chip" type="button" data-action="sbx-unlock-all">Unlock everything</button>
      <button class="sbx-chip sbx-chip--warn" type="button" data-action="sbx-wipe">Wipe save</button>
    </div>
  </div>`;
}
