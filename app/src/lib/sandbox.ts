/**
 * SANDBOX — the on-device developer gate.
 *
 * READ THIS FIRST: what this flag gates has NARROWED. It used to gate the
 * whole sandbox — the screen, the mode, the entry point. It now gates only the
 * SAVE-EDITING CHEATS (lib/sandbox-cheats.ts): set the Mark, grant salvage,
 * unlock everything, wipe. Tier S itself — the level-select screen, the
 * practice runs, their separate leaderboard — ships in every build and is
 * gated by a player-facing setting instead (lib/devmode.ts, and the nine-tap
 * beacon that flips it).
 *
 * That split is the whole design. A mode that cannot pay salvage, cannot
 * advance a tier and files its scores on a board of its own is safe to hand to
 * anyone; four buttons that rewrite the save are not, at any level of
 * obscurity. Everything below is the argument for gating the second kind.
 *
 * Testing a tier-7 Contract variant, or a Mark 9 bay with a maxed rig, means
 * playing the whole ladder up to it: ten bays a run, three Contracts a tier,
 * nine tiers. That is hours of correct play to reach one bay you want to look
 * at for ninety seconds, on a phone, and it is why almost none of the ladder
 * ever gets tested on real hardware. Tier S is the answer: pick a tier, pick a
 * Contract variant or a bay, pick a rig, launch it.
 *
 * WHY A BUILD MODE AND NOT `import.meta.env.DEV`
 *
 * DEV is true only under the vite dev server, and a browser on a laptop is
 * exactly the thing this does not need to test — touch aim, device physics
 * timing and the real screen are the whole point. So the sandbox has to survive
 * a real `vite build`, which means it needs a gate that is a BUILD MODE, the
 * same argument src/lib/purchases.ts makes for the store gate.
 *
 * WHY THE MARKER STRING
 *
 * `import.meta.env.MODE` is inlined at build time, so in any other mode this
 * constant folds to `false` and every `if (SANDBOX)` below it is dead code the
 * minifier drops. That is the mechanism, and it is not the guarantee — a future
 * refactor that reads the flag through a function, or a bundler setting that
 * stops folding, would silently ship a cheat menu to the store. So the cheats
 * also carry a marker string that only exists on their own code path, and
 * scripts/verify-store-bundle.mjs fails the build if that marker appears in a
 * bundle that is not a sandbox build. The tree-shake is the optimisation; the
 * grep is the promise.
 *
 * The cheats live in their own MODULE for the same reason, and it is not
 * stylistic: a runtime guard inside a class method leaves every cheat's case
 * label, string and body in the bundle for the grep to find nothing wrong
 * with. Behind `if (SANDBOX)` at a module boundary, Rollup eliminates the
 * branch, the call, the import and the file. See lib/sandbox-cheats.ts.
 *
 * WHY THE CHEATS' ENTRY IS A PLAIN ROW
 *
 * Because the gate above is the actual protection, hiding them behind a
 * gesture would be guarding a door that is not in the wall. So in a sandbox
 * build they are simply a labelled row at the bottom of the Tier S screen,
 * under a rule and a warning, and in every other build they are absent. The
 * gesture on the tower's beacon (lib/devmode.ts) opens the MODE, which is a
 * different question with a different answer.
 */

/* The marker string lives in lib/sandbox-cheats.ts, beside the code path it
   marks. It cannot live here: this module reads `import.meta.env`, so anything
   importing it has to run under Vite — and sim/ imports the Tier S screen
   through tsx, where `import.meta.env` does not exist. Keeping the flag and
   the marker apart is what lets the mode be tested headlessly while the cheats
   stay gated. */

/**
 * Is the developer sandbox compiled into this build?
 *
 * True under `vite dev` (so the screen can be iterated on quickly) and under
 * `--mode sandbox` (so it can be put on a phone). False in every shippable
 * build, which is what makes the whole module fold away.
 */
export const SANDBOX: boolean =
  import.meta.env.DEV || import.meta.env.MODE === "sandbox";
