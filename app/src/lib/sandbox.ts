/**
 * SANDBOX — the on-device developer gate.
 *
 * Testing a tier-7 Contract variant, or a Mark 9 bay with a maxed rig, means
 * playing the whole ladder up to it: ten bays a run, three Contracts a tier,
 * nine tiers. That is hours of correct play to reach one bay you want to look
 * at for ninety seconds, on a phone, and it is why almost none of the ladder
 * ever gets tested on real hardware. The sandbox is the answer: pick a tier,
 * pick a Contract variant or a bay, pick a rig, launch it.
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
 * stops folding, would silently ship a cheat menu to the store. So the sandbox
 * also carries a marker string that only exists on its own code path, and
 * scripts/verify-store-bundle.mjs fails the build if that marker appears in a
 * bundle that is not a sandbox build. The tree-shake is the optimisation; the
 * grep is the promise.
 *
 * WHY THE ENTRY IS A PLAIN BUTTON
 *
 * Because the gate above is the actual protection, a hidden gesture would be
 * guarding a door that is not in the wall. What it WOULD do is make the tool
 * hard to find on a phone, fight the menu's own decoration (the wordmark is
 * `pointer-events: none` by design, so a tap-counter on it never fires), and be
 * annoying to test. So the sandbox build shows a Sandbox button on the menu,
 * and every other build has neither the button nor the screen.
 */

/** Present in the bundle only when the sandbox is compiled in. Grepped by
 *  scripts/verify-store-bundle.mjs — do not rename without updating it. */
export const SANDBOX_MARKER = "TETRILAUNCH_SANDBOX_BUILD";

/**
 * Is the developer sandbox compiled into this build?
 *
 * True under `vite dev` (so the screen can be iterated on quickly) and under
 * `--mode sandbox` (so it can be put on a phone). False in every shippable
 * build, which is what makes the whole module fold away.
 */
export const SANDBOX: boolean =
  import.meta.env.DEV || import.meta.env.MODE === "sandbox";
