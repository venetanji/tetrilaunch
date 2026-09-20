# Project expert agents

Subagent definitions for routing tetrilaunch work to a domain expert that already
knows this codebase's architecture, conventions and rituals. Each file is a
Claude Code subagent: YAML frontmatter (the `description` is the routing text)
plus a system prompt written as an onboarding for one slice of the repo.

## Roster

| Agent | Owns |
| --- | --- |
| `gameplay-physics-expert` | Aiming, firing and flight: `cannon.ts` (the cone-sweep + ternary-refine solver, loft branch, `MIN_FIRE_RATIO`), `input.ts` (mouse targeting vs touch slingshot, wheel = loft, rotation chords), `gamepad.ts`, engine/level/compactor physics, the dots == solver == shot preview contract. |
| `ui-layout-expert` | DOM chrome and fit: `screens.ts`, `components.ts`, `icons.ts`, `app.css`/`tokens.css`, the `layout.ts` solver (wide/tall/snug), the uifit harness and its baseline discipline, the no-scroll allowlist, the D2 hints-render-from-bindings rule. |
| `game-design-balance-expert` | Difficulty, economy, progression: the hazards ratchet draft, finals, Contracts and tiling, meta currencies, the tier ladder, belt spacing caps — and the sim instruments (`bots.ts`, `sweep.ts`, `marks.ts`) that make balance claims measured, never asserted. |
| `audio-expert` | Sound: `lib/audio.ts` buses and semantics (stingers stop music by design, the congestion lowpass), the `prepare-audio.mjs` mastering pipeline (peak vs LUFS levelling, OVERRIDES), the gitignored-masters caveat. |
| `render-expert` | Canvas drawing and frame cost: `render.ts`'s sprite bake caches, the per-axis ceil gotcha (#106), shadowBlur baking, the background layer, the single viewport transform, the chute/crest canvas-vs-DOM seam, `sim/renderperf`. |
| `steam-expert` | Steam and desktop distribution: `docs/STEAM.md`'s phases, depots/SteamPipe and `store/steam/`, `electron-builder.yml` targets (the unpacked `dir` trees a depot wants, not the installers), the Steamworks binding spike and the main-process/`contextBridge` boundary, achievements and Cloud mapped onto `MetaState` — and the monetization gate that keeps a purchase surface out of a desktop build. |
| `pr-steward` | The review/merge lifecycle: PRs to `staging`, the codex bot loop (verify then fix, threads resolved after the fix lands), sequential merge trains with the ritual re-run on combined staging, hand-resolved conflicts, merged PRs never reused. |

## Routing rule of thumb

Route by the files the task will touch, not by its vocabulary: "the arc looks
wrong" is render if the drawing is wrong and gameplay if the solved shot is;
"this number feels off" is design-balance (and comes back with a sweep, not an
opinion); anything that ends in "…and open a PR / handle the review / merge
these" hands off to `pr-steward` for the last mile, and anything that ends in a
depot, an installer or `app/desktop/` goes to `steam-expert` — including the
parts that are packaging config rather than code, which is most of them. When a task genuinely spans
two domains, prefer the domain owning the invariant most at risk — and remember
every agent already carries the shared house rules (the validation ritual, the
three Settings fixture literals, the commit-message culture), so the split
never loses those.
