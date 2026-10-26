# Result: panning with and without the interaction pause against a stand-in busy job

- Date: 2026-10-26
- Backlog: VIEW-035 (model inference pause during camera motion)
- Kind: benchmark
- Commit: 03d8d64 with the VIEW-024, VIEW-035 and VIEW-023 changes on top, not yet committed
- Environment: MacBook with Apple M4, macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 155.0.8059.86 driven headless by `@playwright/test` 1.64.0 with `channel: "chrome"` and the SwiftShader flags of `packages/golden-images/src/playwright.ts`. Viewport 1280 × 720 CSS pixels at a device pixel ratio of 1. Other agents were running on the same machine during the runs.
- Data: none. The page uses a synthetic 80,000 × 60,000 slide and a renderer route that draws nothing.

## Question

There is no inference engine in the browser yet. This run measures a stand-in busy job, not a model. Does the engine's interaction signal keep a pan at 60 fps while a region pass is running, and does the pass resume about 200 ms after the camera rests? The backlog asks for 60 fps while panning during a region pass.

## Method

The test is `packages/viewer-engine/browser/interaction.spec.ts`, with the page in `browser/page/interaction-harness.ts` and the stand-in in `browser/page/region-pass.ts`. Run it with `pnpm --filter @parfocal/viewer-engine exec playwright test browser/interaction.spec.ts`.

The stand-in job processes 1000 regions. Each region spins the main thread for 40 ms and then yields to a `MessageChannel` task. In the `paused` mode the job awaits `engine.interaction.whenRested()` before every region. In the `unpaused` mode it never waits. In the `no-job` mode there is no job.

Each run opens a fresh page, mounts the engine, starts the job, pans for 500 ms to settle (not measured), sleeps 120 ms and then pans for 3000 ms. One pan step moves the camera by 2 CSS pixels on every animation frame. The frame times are the gaps between consecutive animation frame timestamps in the pan. After the pan the `paused` run polls for the next finished region and reports the time from the last pan step to it. Each mode ran 3 times in one session.

## Results

Frame statistics of the measured 3000 ms pan, per run.

| Mode | Run | Frames | fps | Median (ms) | p95 (ms) | Worst (ms) | Frames over 33 ms | Regions finished during the pan |
|---|---|---|---|---|---|---|---|---|
| no-job | 1 | 181 | 60.0 | 16.7 | 16.7 | 16.7 | 0 | 0 |
| no-job | 2 | 181 | 60.0 | 16.7 | 16.7 | 16.7 | 0 | 0 |
| no-job | 3 | 181 | 60.0 | 16.7 | 16.7 | 16.7 | 0 | 0 |
| unpaused | 1 | 76 | 25.1 | 33.3 | 50.0 | 50.0 | 76 | 77 |
| unpaused | 2 | 75 | 24.9 | 33.3 | 50.0 | 50.0 | 75 | 76 |
| unpaused | 3 | 76 | 24.9 | 33.3 | 50.0 | 50.0 | 76 | 77 |
| paused | 1 | 181 | 60.0 | 16.7 | 16.7 | 16.7 | 0 | 0 |
| paused | 2 | 181 | 60.0 | 16.7 | 16.7 | 16.7 | 0 | 0 |
| paused | 3 | 181 | 60.0 | 16.7 | 16.7 | 16.7 | 0 | 0 |

Time from the last pan step to the next finished region in the `paused` runs.

| Run | Delay (ms) |
|---|---|
| 1 | 284.7 |
| 2 | 280.5 |
| 3 | 280.6 |

## Interpretation

Facts. With a 40 ms slice the unpaused job held the pan near 25 fps and the paused job held 60 fps with no frame over 16.7 ms, the same as with no job. The paused job finished no region while the camera moved.

The resume delay is the 200 ms rest time plus up to one frame for the last pulse to land, the 40 ms slice itself and the 5 ms poll. It is not a measure of the signal alone. The test asserts it lies between 200 ms and 200 ms plus the slice plus 150 ms.

Assumptions. The 25 fps of the unpaused runs follows from the 40 ms slice that was chosen. A job with shorter slices would cost the pan less. The run says nothing about real inference, which runs in workers or on the GPU and competes for the main thread differently. It measures only that a job which waits on the signal stays out of the way of the pan. The first measured frame of an earlier run in the same session had a 283 ms frame from page start-up, so the harness now pans 500 ms before it measures.

## Follow-ups

The real check is the perf test of the first browser inference task once it exists. [ADR 0113](../adr/0113-interaction-signal-units-and-touch-gestures.md) records the design.
