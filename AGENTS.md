# Tetrilaunch agent workflow

This file applies to repository work by coding agents. Read the relevant files in `.claude/agents/` for domain-specific invariants; those files are reference material, not a grant of permissions or a replacement for the instructions here.

## Routing

The project coordinator owns the request and reports one result. Pick the specialist by the files and invariant at risk, not by the wording of the request:

- Gameplay/physics: `.claude/agents/gameplay-physics-expert.md` (aim, input, simulation).
- UI/layout: `.claude/agents/ui-layout-expert.md` (DOM, CSS, layout, UI-fit).
- Game design/balance: `.claude/agents/game-design-balance-expert.md` (difficulty, economy, progression, measured sweeps).
- Audio: `.claude/agents/audio-expert.md` (playback and asset preparation).
- Rendering: `.claude/agents/render-expert.md` (canvas and frame cost).
- Steam/desktop: `.claude/agents/steam-expert.md` (Electron, packaging, Steam).
- PR stewardship: `.claude/agents/pr-steward.md` (review threads and staging integration).

Delegate bounded, non-overlapping work to a specialist when that agent is available. Provide the task, relevant paths, acceptance criteria, verification, and stop condition. A missing specialist is not a reason to claim delegation happened: read its reference file and do the work in the coordinator session, or report the blocker. The coordinator verifies the result and remains the human's point of contact.

## Change lifecycle

1. Inspect `git status`, the current branch, and any open PR before touching files. Never overwrite another worker's changes or reuse an in-flight checkout. Fetch `origin/staging` and create a separate worktree and topic branch from it; use one worktree per change. Do not branch from `main` or from the current checkout's HEAD.
2. Make the smallest coherent change with a regression test or reproducible measurement where applicable. Preserve the documented invariants in the relevant expert file. Never include secrets or generated local artifacts in a commit.
3. Before pushing a change, run from `app/`: `npm run typecheck && npm test && npm run test:uifit && npm run build`. Report the actual results, including UI-fit's new/stale/grown baseline counts; do not update a baseline merely to make a check pass. If a required check cannot run, stop before pushing and ask for a decision rather than calling it green.
4. Review the diff and commit with a message explaining why. Push the topic branch and open a PR against `staging` (not `main`) with the change, evidence, and risks. Ask the human to review the PR. Do not merge, deploy, or retarget someone else's PR without explicit authorization.
5. Check review feedback on every push. Verify findings against the code, fix confirmed problems in follow-up commits, and only resolve a thread after its fix is pushed. Leave the PR for human review; merging to `main` is a separate release decision.

Keep unrelated working trees and PRs untouched. For a docs-only change, still apply the same pre-push validation gate unless the human explicitly approves a narrower one. See `.claude/agents/pr-steward.md` for the full review and integration ritual.
