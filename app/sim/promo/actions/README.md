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
