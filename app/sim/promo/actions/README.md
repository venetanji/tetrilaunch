# Native Steam trailer capture

This capture-only adapter runs the existing promo driver and original scene recipes in an isolated Electron desktop window. It does not change game physics or player saves.

## Pilot

From `app/`, with the app and desktop lockfile dependencies, ffmpeg, and Xvfb installed:

```sh
xvfb-run -a -s "-screen 0 1920x1080x24" node --import tsx sim/promo/actions/capture.ts --fps=60 --seconds=4 --scene=congestion --shot-gap=0.9 --out=sim/results/steam-trailer
```

The dedicated `Steam trailer capture` workflow runs only on the capture branch or manual dispatch. It performs typecheck, tests, UI-fit, and build before capture. It uses a standard Ubuntu 22.04 runner, read-only repository permission, no secrets, and no release/deployment/store steps. Artifacts expire after seven days.

Outputs include an MP4, per-frame timing and shot evidence JSON, a contact sheet, and sample PNGs. The JSON records actual Electron/Chromium versions and source commit.

## Timing contract

The original virtual-clock driver advances by 1000/fps milliseconds per rendered frame. The product keeps its fixed 60 Hz physics. A four-second pilot must contain 240 physics steps and four seconds of game countdown. PNG hashes detect repeated captures; no frame duplication or optical-flow conversion is used.

During capture, the original bot is attached until it fires, then detached for at least 0.9 seconds. Reattaching reconstructs the seeded pilot. This is deliberately different capture choreography, not a game-speed change or the old bot's uninterrupted trajectory.

Only 60 and 120 fps are accepted. A 120 fps run still requires the same 60 Hz physics evidence and unique rendered frames before being described as genuine high-frame-rate output.

## Scope

The initial pilot is silent and supports non-scripted-hand gameplay scenes. It is not the finished trailer. Full eight-scene effect choreography, music assembly, and final visual pacing review remain follow-up work. Do not submit this pilot to a store.

The screenshot-era capture provenance used a visible Electron window. This workflow supplies that display explicitly through Xvfb so the launch procedure is reproducible.

## Runner compatibility

The native capture job pins standard `ubuntu-22.04`. On the Ubuntu 24.04 runner, Electron 44's native launch aborted in `setuid_sandbox_host.cc` because the unpacked npm sandbox helper was not configured for SUID execution (diagnostic run 40482058465). The Node-mode identity probe succeeded. We select the supported 22.04 host rather than disabling Electron's sandbox or changing host security settings; no `--no-sandbox`, SUID permission edits, or sysctl changes are made. This does not change the shipped game.

Compatibility references: [locked Playwright 1.56.1 requirements](https://github.com/microsoft/playwright/blob/v1.56.1/docs/src/intro-js.md), [standard GitHub runner list](https://github.com/actions/runner-images), [Electron 44 platform policy](https://github.com/electron/electron/blob/v44.0.0/README.md), and [Ubuntu support lifecycle](https://ubuntu.com/about/release-cycle).

## Full progression capture

After the validated 60/120 fps pilots, run from `app/`:

```sh
xvfb-run -a -s "-screen 0 1920x1080x24" node --import tsx sim/promo/actions/trailer.ts --fps=120 --shot-gap=0.95 --out=sim/results/steam-trailer
```

The eight original progression recipes are probed then replayed in fresh native windows. Each filmed section is at least six seconds, with fixed 60 Hz physics and scene-specific visible-event gates. Independent scene failures retain completed sections and continue; `capture-status.json` names failures. Retry one scene with `--scene=blast` (or another original scene ID). A combined gameplay master is produced only when all eight pass. The 60 fps derivative drops alternate 120 fps frames without changing duration.

The workflow allows up to 90 minutes on one standard runner and uploads all partial evidence even on failure. It does not assemble or submit a store trailer automatically. Final media assembly appends the original two-second logo ending and mixes `public/audio/music/menu.mp3` starting at 13.8 seconds; preserve the final assembly command and provenance with the delivered media. The original endcard is 30 fps-origin material, not native 120 fps gameplay.

### Mid-bay framing correction

Measured retry diagnostics showed the original nominal 22-cube still-photo cue never occurred within 30 seconds (maximum 20 cubes; many real-ready frames). The recovered delivered screenshot manifest actually recorded 12 cubes. The video therefore deliberately uses a real 20-cube working pile after 16 seconds with real cannon readiness, then verifies at least 0.5 seconds of visible aiming and an actual launch. This is a documented filming criterion, not a game change or a claim that the old 22-cube predicate passed. Per-scene metadata records both predicates and the actual stage snapshot.
