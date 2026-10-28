# Steam Auto-Cloud progress

The owner selected Auto-Cloud rather than the previously proposed Remote Storage API.
We will give Steam a portable, versioned account-owned JSON file, never a Chromium database.
This draft does not change Steamworks settings or publish a build.

## Design

Main owns identity, paths, validation and serialized atomic file writes. Steam-only
renderer boot awaits an account save before constructing App. The renderer uses an
account-scoped memory adapter for progress; existing localStorage remains untouched
except device preferences. Web/mobile/direct downloads retain current behavior.
A local migration marker assigns legacy localStorage to the first Steam account;
existing downloaded progress always wins. Other accounts start separately. Missing
identity, invalid save, unknown version or ambiguous migration state blocks boot,
not silently replacing a save with defaults. Device preferences stay local; tutorial
and sandbox-discovery flags travel with progress. Steam handles whole-file conflicts.

## Alternatives

Watching LevelDB is rejected because it includes Chromium-owned multi-file state.
Remote Storage API is unnecessary for the chosen Auto-Cloud workflow. This design
uses an explicit JSON file, with no automatic economic merges.

## Non-goals

No live dynamic Cloud sync, active-run checkpointing, cloud APIs, release, deployment,
or Steamworks changes. Physical multi-machine Steam validation remains required.
