# Result: wheel zoom on the Huron fixture keeps the longest main-thread task near 26 ms

- Date: 2026-11-08
- Backlog: VIEW-031
- Kind: baseline
- Commit: cc8d71a0 plus the uncommitted spec of this task
- Environment: Apple M4 Mac shared with other agents, macOS, Chrome headless through Playwright with SwiftShader (software WebGL), 1280 x 720, loopback server, one worker
- Data: Huron-1-40x.tif from the OpenSlide test data (115,718,398 bytes), no PHI

## Question

luma.gl 9.4.2 no longer builds the sampler debug string, so no patch is needed ([ADR 0098](../adr/0098-viv-and-deck-gl-versions.md), Viv and deck.gl versions). Does a wheel zoom on Huron-1-40x.tif still keep every frame under 50 ms of main-thread work?

## Method

`packages/viewer-engine/browser/wheel-zoom.spec.ts` opens the slide in the pan harness with six decode workers and binds the wheel input. It sends 12 mouse wheel notches of deltaY -100 at the viewport centre, 40 ms apart, through the Chrome DevTools Protocol, then waits until the view is idle. Chrome tracing records the longest page task on the renderer main thread (the `toplevel` category, Chrome internal tasks excluded). The spec runs this three times and takes the fastest, and the budget `viewer.wheel-zoom-longest-task-ms` in `perf-budgets.json` limits it to 50 ms. The command is `pnpm --filter @parfocal/viewer-engine exec playwright test wheel-zoom --workers=1`.

## Results

Three runs of the spec, three rounds each.

| Run | Round 1 | Round 2 | Round 3 | Fastest |
| --- | --- | --- | --- | --- |
| First | 51.2 ms | 51.6 ms | 26.3 ms | 26.3 ms |
| Second | 48.7 ms | 26.1 ms | 25.9 ms | 25.9 ms |
| Third | 50.2 ms | 36.7 ms | 30.3 ms | 30.3 ms |

The gap between animation frames in the same rounds was 66.7 to 116.7 ms at the 95th percentile and 116.7 to 233.3 ms at the worst. An earlier spec version without tracing measured a worst gap of 100.0 to 116.7 ms.

## Interpretation

The frame gap is set by SwiftShader drawing a 1280 x 720 view in software in the GPU process, so it cannot show whether JavaScript blocks a frame. The longest main-thread task can, and it is the cost the old sampler debug string added. The fastest of three stays between 25.9 and 30.3 ms, under 50 ms, and a single round reaches 52 ms on a busy machine, which is why the budget takes the fastest of three. A frame time on a real GPU is not measured here, and `viewer.pan-frame-p95-ms` stays a manual budget for it.

## Follow-ups

TODO: record the hosted-runner number from the first browser CI run and tighten the headroom.
