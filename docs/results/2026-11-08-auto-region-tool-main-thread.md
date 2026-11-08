# Result: the auto region tool keeps the main thread under 50 ms during a four tile pass

- Date: 2026-11-08
- Backlog: AISEG-017 (auto region tool on screen)
- Kind: benchmark
- Commit: the AISEG-017 commit on its branch
- Environment: Apple M4 (24 GB, shared with other agents), macOS, Chrome headless through Playwright, Vite dev server, 1280 x 720
- Data: the fake model and fake slide reader of the browser tests (`apps/web/src/aiseg/fake-sam.ts`), no real slide and no model weights

## Question

After the per tile AIS post-processing moved into a worker, does any main thread task pass 50 ms while a multi tile auto region pass runs? The budget is `aiseg.region-main-thread-task-ms` in `perf-budgets.json`.

## Method

`apps/web/e2e/auto-region.spec.ts`, the test "no main thread task passes 50 ms during a multi tile pass". It opens a fixture slide, presses U, installs a PerformanceObserver for long tasks and a 4 ms timer loop that records the largest gap beyond 4 ms, drags a region that plans four tiles, waits until the pass is done and reads both. Each tile gets 121 synthetic nuclei on 256 by 256 AIS maps from the fake model, so the worker does real post-processing. The command is `PARFOCAL_E2E_PORT=5191 npx playwright test e2e/auto-region.spec.ts --workers=1`.

## Results

| Run | Tiles | Long task entries | Longest main thread gap (ms) |
| --- | --- | --- | --- |
| 1 | 4 | 0 | 33.8 |
| 2 | 4 | 0 | 31.7 |
| 3 | 4 | 0 | 29.6 |
| 4 | 4 | 0 | 29.1 |
| 5 | 4 | 0 | 28.5 |

## Interpretation

The longest main thread gap was 33.8 ms over five runs and the browser reported no long task. These numbers use the fake model, so they measure the screen, the worker hand-off and the rendering of proposals, and not the real encoder and decoder. The real graphs run in their own worker (ADR 0253, one inference worker). Assumption, not measured: the remaining 28.5 to 33.8 ms gaps come from React rendering of the growing proposal layer and the structured clone of each tile's outlines. The limit of 50 ms is the long task line, and the budget baseline is 34 ms, the worst run.

## Follow-ups

- TODO: repeat the check with the real WebGPU graphs on a slide in Chrome, which needs the models cache and a free machine.
