# Steam Achievements Implementation Plan

**Goal:** Prepare a provisional Steam import pack and implement achievements for the desktop app.

**Architecture:** A shared catalogue names every API ID used by the CSVs, icons, game recorder and desktop allowlist. The game saves earned IDs monotonically in MetaState and reconciles them to a narrow Electron preload API. Native Steamworks calls run only in the main process; unavailable Steam never interrupts gameplay.

**Scope:** One achievement for unlocking each tier from 1 through 10. Four global skill feats cover a ten-bay run without congestion, an all-clear caused by selling lines, and at least three/four lines in a single clear. Seven additional milestones cover a real daily Contract, five/all ten Workshop systems (including stowed and the stock Reactor), a full-chain bay, opening/winning the Skydeck, and the hidden Tier S discovery. Real daily Contracts qualify for clear feats; Deep Runs and Skydeck runs qualify for run and bay feats. Training, generated practice, and developer play cannot earn ordinary gameplay achievements. Congestion history survives retries, so retrying alone does not disqualify an otherwise clean run.

**Constraints:** Preserve context isolation, desktop monetization gates, progression/economy, and all installer targets. Keep downloaded root templates untouched. No achievement sets exist; export their original header without invented IDs. Existing saves backfill only facts they actually contain; never infer historic congestion, all-clears or multi-clears.

## Work Items

- [x] Produce catalogue, exact-template English CSVs, 256px achieved/grayscale PNG pairs, reproducible generator and upload instructions (assets specialist).
- [x] Add failing headless pins for challenge boundaries, mode exclusions, monotonic persistence, backfill, and offline/retry Steam delivery (coordinator).
- [x] Implement pure achievement recorders, defensive save loading, run-long congestion tracking, and real gameplay hooks (coordinator).
- [x] Implement and test packaged Steamworks bridge, sandbox preload and sender/ID validation (desktop specialist).
- [x] Inspect icon contact sheet and review the complete diff, including failure modes and catalogue parity.
- [x] Run typecheck, systems tests, UI-fit and build from app; record new/stale/grown counts, then native packaging/output checks.
- [x] Prepare reviewed diff, commit rationale and draft-PR evidence for delivery against staging.

Delivery follows this verified checkpoint: commit, push the topic branch, open a draft PR against staging, inspect review feedback, and leave for human review. The PR records delivery status.

## Verification

The achievement pins must reject early run completion, congestion in any bay (even before a retry), clear totals accumulated across separate events, partial emptying and practice modes. System ownership counts owned tracks rather than slots, installed levels or mounted-only tracks. Steam transport retries rejected/false deliveries and serializes overlapping syncs, with no durable delivery flags that could suppress reconciliation to another Steam account. Test native code against an injected SDK boundary; record live Steam unlock, Windows and overlay checks as outstanding unless exercised on real clients.

Final local validation passed: both TypeScript configs; 5,529 system assertions plus API and trajectory checks; Chromium UI-fit across 3,795 combinations with 0 new, 0 stale and 0 grown baseline entries; web build; 12 real-App browser scenarios; 28 desktop tests; CSV/art/archive parity; and Linux Steam packaging with actual ASAR verification. Normal base-config Linux packaging also passed with Steam relaunch metadata absent. Review caught and verified fixes for CI's Steam-config selection, catalogue collection by electron-builder, and preserving a practice Contract's sandbox flag on paused restart. Live achievement writes, server persistence and Windows/macOS execution remain pending.
