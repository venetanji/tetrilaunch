# Steam Auto-Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Synchronize portable account progress with Steam Auto-Cloud.
**Architecture:** Trusted main-process JSON store, narrow IPC, awaited renderer bootstrap and account-local memory adapter.
**Tech Stack:** Electron, CommonJS, TypeScript, Node test runner.
**Spec:** docs/superpowers/specs/2026-10-28-steam-autocloud-design.md

## Global Constraints
- Topic branch from staging; draft PR to staging. No release/deployment/settings changes.
- No Chromium database syncing or machine-setting synchronization.
- No save writes when identity or input integrity is uncertain.
- Full existing pre-push validation ritual; report unavailable checks before push.

## Review Focus
- Corrupt/future/account-mismatched save remains untouched.
- Account switches cannot reuse another account's renderer state.
- Migration interruption cannot transfer legacy progress to a second account.
- Queued writes complete before exit and cannot reorder snapshots.
- Downloaded data is imported before constructor-side progression writes.

## Task 1: Native save and trust boundary
- [x] Write/run failing native tests for paths, validation, migration, queue and identity.
- [x] Implement app/desktop/steam-save.js and Steam identity accessor.
- [x] Run native tests; wire preload/main/package file list and quit drain.

## Task 2: Renderer account storage
- [x] Write/run failing adapter/bootstrap tests.
- [x] Implement app/src/lib/desktop-save.ts; hook store.ts and await before new App.
- [x] Verify existing web/mobile storage behavior and failure UI.

## Task 3: Delivery
- [x] Document exact paths, quotas, overrides, conflict/recovery and manual test matrix.
- [ ] Run typecheck, npm test, test:uifit, build and native tests.
- [ ] Independent review, verified fixes, draft PR to staging and CI verification.

## Validation record (2026-10-28)

- Native Node suite: 53 passed, including filesystem, journals, identity,
  preload/IPC, main-process lifecycle and actual ASAR packaging fixtures.
- Both TypeScript configurations passed.
- Full systems checks, API routing checks and trajectory-cache tests passed;
  renderer adapter tests are imported before the systems runner exits.
- Web build, native build and desktop store-boundary output check passed.
- This runtime denies the tsx CLI IPC socket. Tests ran with the supported
  `node --import tsx` loader instead, without changing repository test commands.
- UI-fit could not launch: the pinned Chromium executable is absent. No
  baseline new/stale/grown count is claimed and no baseline was changed.
- Independent save-safety review completed; identified corruption, retry,
  migration-journal and test-wiring issues were reproduced and fixed.
- Publication awaits the owner's explicit exception to the pre-push UI-fit gate.
  No Steamworks settings, builds or deployments were published.
