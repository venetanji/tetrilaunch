// __APP_VERSION__/__APP_COMMIT__ are string literals substituted by vite.config.ts's
// `define` — declared locally rather than in a global .d.ts because sim/'s
// separate tsconfig doesn't include src/, and a global ambient declaration
// there wouldn't be visible to the copy of this file it pulls in transitively.
//
// The `typeof` guards are load-bearing, not defensive dressing: sim/systems.ts
// (npm test) and the uifit fixtures both pull this file in through screens.ts
// but run under tsx, not Vite, so no `define` substitution ever touches them —
// the bare identifier is never declared at runtime and a direct reference
// throws ReferenceError. `typeof` is the one operator that can name an
// undeclared identifier without throwing, which is what lets one module serve
// both the bundled build and the plain-Node harness.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

/** package.json's version at build time, or "dev" outside Vite (sim/, tests). */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** Short commit hash of the build, or "dev" outside Vite or a git checkout. */
export const APP_COMMIT = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev";
